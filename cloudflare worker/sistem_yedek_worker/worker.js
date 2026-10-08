/**
 * sistem-yedek-worker — Cloudflare Worker
 * -----------------------------------------------------------------------
 * "Sistem Yedekleme & Depolama Yönetimi" modülünün sunucu kapısı (migration 0074).
 * Bu Worker ZIP ÜRETMEZ ve veritabanı satırı taşımaz: yalnızca tarayıcının yedek paketine koyacağı
 * BÜYÜK parçaları (R2 dosyaları, GitHub kaynak zip'i) yetkiyi doğrulayarak AKIŞ olarak iletir.
 * ZIP tarayıcıda kurulur → Worker'da CPU/bellek sınırına takılmaz (Free planda 10 ms CPU yeter,
 * çünkü baytlar sadece aktarılır; CRC/sıkıştırma hesabı yok).
 *
 * YETKİ — service_role YOK. Worker kullanıcının KENDİ JWT'siyle Supabase RPC çağırır:
 *   - Her istek bir dışa aktarma OTURUMU kimliği (?e=<uuid>) taşır; oturumu sistem_export_baslat()
 *     açar (denetim günlüğüne önce yazılır) ve yalnızca sahibi, 6 saat boyunca kullanabilir.
 *   - R2: sistem_export_r2_izinli_mi(oturum, kaynak, anahtar) — anahtar, oturumun kapsamındaki
 *     dosya listesinde değilse 403. Yönetici yalnızca kendi dosyalarını, owner (tam kapsamda) hepsini.
 *   - GitHub: sistem_export_bilesen_izinli_mi(oturum, 'github' | 'icerik_md').
 *   - /depolama: yalnızca owner (is_owner()).
 *
 * API (Authorization: Bearer <supabase access_token>; GET /saglik hariç)
 *   GET /saglik                                   → {ok, kaynaklar:{...bağlı kovalar}, github:bool}
 *   GET /r2/liste?e=<oturum>                      → [{kaynak, anahtar, ad, boyut, sifreli}]
 *   GET /r2/dosya?e=<oturum>&b=<kaynak>&k=<anahtar> → dosya baytları (akış)
 *   GET /github/zip?e=<oturum>&b=github|icerik_md → deponun zipball'ı (akış)
 *   GET /depolama                                 → R2 kovalarının GERÇEK tarama özeti (owner)
 *
 * Ortam değişkenleri (Worker > Settings > Variables and Secrets):
 *   SUPABASE_URL        https://<proje-ref>.supabase.co          (Text)
 *   SUPABASE_ANON_KEY   herkese açık anon key                     (Text)
 *   GITHUB_OWNER        GitHub kullanıcı adın                     (Text)  — GitHub zip için
 *   GITHUB_REPO         site reposunun adı                        (Text)  — GitHub zip için
 *   GITHUB_PAT          Contents: Read-only fine-grained token    (Secret, YALNIZCA repo özelse gerekir)
 *   GITHUB_REF          (isteğe bağlı) dal adı, varsayılan main   (Text)
 *   MAX_TARAMA_SAYFA    (isteğe bağlı) /depolama sayfa üst sınırı, varsayılan 40 (Text)
 * R2 Binding'leri (hepsi isteğe bağlı; bağlamadığın kaynak pakete girmez, hata vermez):
 *   AKADEMIK_BUCKET → Akademik Kütüphane kovası   (akademik_kutuphane_worker ile AYNI kova)
 *   ARSIV_BUCKET    → Dosya Yöneticisi kovası      (r2_arsiv_worker'daki MY_R2_BUCKET ile AYNI kova)
 *   NOT_EK_BUCKET   → Not ekleri kovası            (r2_not_ek_worker ile AYNI kova)
 * -----------------------------------------------------------------------
 */

const IZINLI_ORIGINLER = [
  "https://abdullah-eymen-asru.github.io",
  "https://abdullah-eymen-asru.pages.dev",
  "http://localhost:4000",
  "http://127.0.0.1:5500",
];

const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KAYNAKLAR = { akademik: "AKADEMIK_BUCKET", arsiv: "ARSIV_BUCKET", notek: "NOT_EK_BUCKET" };

/* ----------------------------- yardımcılar ----------------------------- */

function corsBasliklari(istek) {
  const origin = istek.headers.get("Origin") || "";
  const izinli = IZINLI_ORIGINLER.includes(origin);
  return {
    "Access-Control-Allow-Origin": izinli ? origin : IZINLI_ORIGINLER[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, X-Dosya-Boyut",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };
}

function json(govde, durum, cors) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function anahtarGuvenliMi(k) {
  return typeof k === "string" && k.length > 0 && k.length <= 600 && !k.includes("..") && !k.includes("\\") && !k.startsWith("/");
}

/** Kullanıcının KENDİ jetonuyla RPC. PostgREST hata (400/401/403) → {hata}. */
async function rpc(env, kimlik, ad, govde) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${ad}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: kimlik, "Content-Type": "application/json" },
    body: JSON.stringify(govde || {}),
  });
  let veri = null;
  try { veri = await r.json(); } catch { /* boş gövde */ }
  if (!r.ok) return { hata: veri?.message || `rpc ${r.status}`, durum: r.status };
  return { veri };
}

const yetkisizMi = (s) => s === 401 || s === 400 || s === 403;

/* ------------------------------ uç noktalar ----------------------------- */

async function r2Liste(env, kimlik, oturum, cors) {
  const s = await rpc(env, kimlik, "sistem_export_r2_listesi", { p_id: oturum });
  if (s.hata) return json({ error: s.hata }, yetkisizMi(s.durum) ? 403 : 502, cors);
  const baglilar = Object.entries(KAYNAKLAR).filter(([, b]) => env[b]).map(([k]) => k);
  const liste = (s.veri || []).map((x) => ({ ...x, bagli: baglilar.includes(x.kaynak) }));
  return json(liste, 200, cors);
}

async function r2Dosya(env, kimlik, url, cors) {
  const oturum = url.searchParams.get("e") || "";
  const kaynak = url.searchParams.get("b") || "";
  const anahtar = url.searchParams.get("k") || "";
  if (!UUID_DESENI.test(oturum) || !KAYNAKLAR[kaynak] || !anahtarGuvenliMi(anahtar)) {
    return json({ error: "Geçersiz istek." }, 400, cors);
  }
  const kova = env[KAYNAKLAR[kaynak]];
  if (!kova) return json({ error: `${KAYNAKLAR[kaynak]} binding'i bağlı değil.` }, 501, cors);

  const s = await rpc(env, kimlik, "sistem_export_r2_izinli_mi", { p_id: oturum, p_kaynak: kaynak, p_anahtar: anahtar });
  if (s.hata) return json({ error: s.hata }, yetkisizMi(s.durum) ? 403 : 502, cors);
  if (s.veri !== true) return json({ error: "Bu dosya bu dışa aktarma kapsamında değil." }, 403, cors);

  const nesne = await kova.get(anahtar);
  if (!nesne) return json({ error: "Dosya R2'de bulunamadı." }, 404, cors);
  return new Response(nesne.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(nesne.size),
      "X-Dosya-Boyut": String(nesne.size),
      "Cache-Control": "no-store",
    },
  });
}

async function githubZip(env, kimlik, url, cors) {
  const oturum = url.searchParams.get("e") || "";
  const bilesen = url.searchParams.get("b") === "icerik_md" ? "icerik_md" : "github";
  if (!UUID_DESENI.test(oturum)) return json({ error: "Geçersiz istek." }, 400, cors);
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return json({ error: "GITHUB_OWNER / GITHUB_REPO tanımlı değil." }, 501, cors);
  }
  const s = await rpc(env, kimlik, "sistem_export_bilesen_izinli_mi", { p_id: oturum, p_bilesen: bilesen });
  if (s.hata) return json({ error: s.hata }, yetkisizMi(s.durum) ? 403 : 502, cors);
  if (s.veri !== true) return json({ error: "Bu bileşen bu oturumda yok." }, 403, cors);

  const dal = env.GITHUB_REF || "main";
  const basliklar = {
    "User-Agent": "sistem-yedek-worker",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_PAT) basliklar.Authorization = `Bearer ${env.GITHUB_PAT}`;
  const r = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/zipball/${encodeURIComponent(dal)}`,
    { headers: basliklar, redirect: "follow" }
  );
  if (!r.ok || !r.body) {
    return json({ error: `GitHub zip alınamadı (${r.status}). Repo özelse GITHUB_PAT gerekir.` }, 502, cors);
  }
  const ek = {};
  const uzunluk = r.headers.get("Content-Length");
  if (uzunluk) ek["Content-Length"] = uzunluk;
  return new Response(r.body, {
    status: 200,
    headers: { ...cors, ...ek, "Content-Type": "application/zip", "Cache-Control": "no-store" },
  });
}

/** Owner: R2 kovalarının gerçek (DB'den bağımsız) taraması. Sayfa sayısı sınırlı → "kismi" bayrağı. */
async function depolamaTara(env, kimlik, cors) {
  const s = await rpc(env, kimlik, "is_owner", {});
  if (s.hata || s.veri !== true) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);

  const ust = Math.max(1, Math.min(parseInt(env.MAX_TARAMA_SAYFA || "40", 10) || 40, 200));
  const sonuc = {};
  for (const [kaynak, bagAdi] of Object.entries(KAYNAKLAR)) {
    const kova = env[bagAdi];
    if (!kova) { sonuc[kaynak] = { bagli: false }; continue; }
    let adet = 0, bayt = 0, imlec, sayfa = 0, kismi = false;
    for (;;) {
      const l = await kova.list({ limit: 1000, cursor: imlec });
      for (const o of l.objects) { adet += 1; bayt += o.size; }
      sayfa += 1;
      if (!l.truncated) break;
      if (sayfa >= ust) { kismi = true; break; }
      imlec = l.cursor;
    }
    sonuc[kaynak] = { bagli: true, adet, bayt, kismi };
  }
  return json({ kaynaklar: sonuc }, 200, cors);
}

/* -------------------------------- giriş -------------------------------- */

export default {
  async fetch(istek, env) {
    const cors = corsBasliklari(istek);
    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(istek.url);
    const yol = url.pathname.replace(/\/+$/, "") || "/";

    if (yol === "/saglik") {
      return json({
        ok: true,
        kaynaklar: Object.fromEntries(Object.entries(KAYNAKLAR).map(([k, b]) => [k, !!env[b]])),
        github: !!(env.GITHUB_OWNER && env.GITHUB_REPO),
      }, 200, cors);
    }

    if (istek.method !== "GET") return json({ error: "Yöntem desteklenmiyor." }, 405, cors);
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({ error: "Worker yapılandırması eksik (SUPABASE_URL, SUPABASE_ANON_KEY)." }, 500, cors);
    }
    const kimlik = istek.headers.get("Authorization") || "";
    if (!kimlik.startsWith("Bearer ")) return json({ error: "Oturum gerekli." }, 401, cors);

    try {
      if (yol === "/r2/liste") {
        const oturum = url.searchParams.get("e") || "";
        if (!UUID_DESENI.test(oturum)) return json({ error: "Geçersiz istek." }, 400, cors);
        return await r2Liste(env, kimlik, oturum, cors);
      }
      if (yol === "/r2/dosya") return await r2Dosya(env, kimlik, url, cors);
      if (yol === "/github/zip") return await githubZip(env, kimlik, url, cors);
      if (yol === "/depolama") return await depolamaTara(env, kimlik, cors);
    } catch (hata) {
      return json({ error: "Beklenmeyen hata: " + (hata?.message || hata) }, 500, cors);
    }
    return json({ error: "Bulunamadı." }, 404, cors);
  },
};
