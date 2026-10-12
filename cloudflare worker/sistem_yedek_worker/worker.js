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
 *   POST /uye-temizle {hedef, arsiv_anahtarlari}  → (yalnızca owner; delete-account Edge Function çağırır) silinen üyenin
 *                                                   R2 nesnelerini siler: Dosya Yöneticisi anahtarları + notlar/<id>/ + akademik-kutuphane/users/<id>/
 *                                                   Yanıt: {ok, silinen:{arsiv,notek,akademik}, bagsiz:[bağlı olmayan kovalar]}
 *                                                   İşlem bütçesi aşılırsa 409 (kısmi silme) → Edge Function DB satırlarına DOKUNMAZ; tekrar çalıştırmak güvenlidir.
 *
 * v2 (migration 0081) — YENİ uç noktalar (hepsi YALNIZCA owner; yetki is_owner() RPC'siyle doğrulanır):
 *   GET  /r2/gezgin?b=<kaynak>&o=<önek>&c=<imleç>  → klasörler + nesneler (sayfa başına 200) + veritabanı kayıt durumu
 *   GET  /r2/boyut?b=<kaynak>&o=<önek>             → önek altındaki toplam adet/bayt (sınırlı tarama)
 *   POST /r2/sil {kaynak, anahtarlar[], islem}     → ÖNCE DB indeks satırı + silme kuyruğu (atomik RPC), SONRA R2 silme.
 *                                                    Anahtar deseni bilinen biçimlerden biriyle eşleşmezse (korumalı) 400.
 *                                                    Kova (bucket) silme uç noktası YOKTUR: kovalar bu Worker'dan silinemez.
 *   POST /r2/kuyruk-isle                           → silme kuyruğunda kalmış (yarım) işlemleri tamamlar
 *   PUT  /r2/yukle?b=&k=&m=eksikleri|uzerine       → geri yükleme: tek R2 nesnesi yazar (gövde = dosya baytları)
 *   GET  /uye/dosya?u=<üye>&b=&k=                  → silme kuyruğundaki üyenin dosyasını akıtır (önizleme/indirme)
 * v3 (migration 0084):
 *   PUT  /uye/yukle?b=&k=&m=eksikleri|uzerine      → HER ÜYE: kendi yedeğini geri yüklerken R2'ye dosya yazar. Yalnızca üyenin KENDİ
 *                                                    kaydının işaret ettiği anahtara izin verilir (uye_r2_yukleme_izinli_mi RPC).
 *   GET  /kota                                     → (owner) Cloudflare ücretsiz GraphQL Analytics: bugünkü (UTC) Worker istek sayısı.
 *                                                    Secret'lar: CF_ACCOUNT_ID, CF_API_TOKEN (izin: Account › Account Analytics › Read).
 *                                                    Sonuç 60 sn edge cache'te tutulur (Analytics API'yi yormaz).
 *
 * Ortam değişkenleri (Worker > Settings > Variables and Secrets):
 *   SUPABASE_URL        https://<proje-ref>.supabase.co          (Text)
 *   SUPABASE_ANON_KEY   herkese açık anon key                     (Text)
 *   GITHUB_OWNER        GitHub kullanıcı adın                     (Text)  — GitHub zip için
 *   GITHUB_REPO         site reposunun adı                        (Text)  — GitHub zip için
 *   GITHUB_PAT          Contents: Read-only fine-grained token    (Secret, YALNIZCA repo özelse gerekir)
 *   GITHUB_REF          (isteğe bağlı) dal adı, varsayılan main   (Text)
 *   MAX_TARAMA_SAYFA    (isteğe bağlı) /depolama + /r2/boyut TOPLAM sayfa (list çağrısı) bütçesi, varsayılan 40 (Text).
 *                       Cloudflare Workers Free planda istek başına 50 alt-istek sınırı vardır; bütçe TÜM kovalar için ORTAKTIR.
 *   CF_ACCOUNT_ID, CF_API_TOKEN  (isteğe bağlı) /kota için. Yoksa panel sayacı "yapılandırılmadı" der, başka hiçbir şey bozulmaz.
 *   GUNLUK_ISTEK_LIMITI (isteğe bağlı, Text) varsayılan 100000 (Workers Free günlük istek sınırı).
 *   MAX_YUKLEME_MB     (isteğe bağlı) /r2/yukle tek dosya üst sınırı, varsayılan 95 (Text). Workers istek gövdesi sınırı
 *                       Free/Pro planda 100 MB'dır; daha büyük dosyalar geri yüklenemez ve raporda "atlandı" görünür.
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

// Silinebilir / geri yüklenebilir R2 anahtarlarının BİLİNEN biçimleri. Bunlara uymayan her anahtar KORUMALIDIR
// (silinemez, üzerine yazılamaz). Biçimler veritabanı CHECK kısıtlarıyla birebir aynıdır (0057, 0056, 0072).
const ANAHTAR_DESENLERI = {
  arsiv: /^arsiv\/[0-9a-f-]{36}$/i,
  notek: /^notlar\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i,
  akademik: /^akademik-kutuphane\/users\/[0-9a-f-]{36}\/[^\\]{1,400}$/i,
};
const anahtarSilinebilirMi = (kaynak, k) => !!ANAHTAR_DESENLERI[kaynak] && anahtarGuvenliMi(k) && ANAHTAR_DESENLERI[kaynak].test(k);
const ONIZLEME_TURLERI = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/* ----------------------------- yardımcılar ----------------------------- */

function corsBasliklari(istek) {
  const origin = istek.headers.get("Origin") || "";
  const izinli = IZINLI_ORIGINLER.includes(origin);
  return {
    "Access-Control-Allow-Origin": izinli ? origin : IZINLI_ORIGINLER[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

/** Owner: R2 kovalarının gerçek (DB'den bağımsız) taraması. Sayfa bütçesi TÜM kovalar için ORTAKTIR (alt-istek sınırı). */
async function depolamaTara(env, kimlik, cors) {
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);

  let butce = Math.max(3, Math.min(parseInt(env.MAX_TARAMA_SAYFA || "40", 10) || 40, 200));
  const sonuc = {};
  const bagli = Object.entries(KAYNAKLAR).filter(([, b]) => env[b]);
  for (const [kaynak, bagAdi] of Object.entries(KAYNAKLAR)) {
    const kova = env[bagAdi];
    if (!kova) { sonuc[kaynak] = { bagli: false }; continue; }
    // Kalan bütçeyi kalan kovalara eşit paylaştır (ilk kova tüm bütçeyi yutmasın).
    const kalanKova = bagli.findIndex(([k]) => k === kaynak);
    const pay = Math.max(1, Math.floor(butce / Math.max(1, bagli.length - kalanKova)));
    let adet = 0, bayt = 0, imlec, sayfa = 0, kismi = false;
    for (;;) {
      const l = await kova.list({ limit: 1000, cursor: imlec });
      for (const o of l.objects) { adet += 1; bayt += o.size; }
      sayfa += 1;
      if (!l.truncated) break;
      if (sayfa >= pay) { kismi = true; break; }
      imlec = l.cursor;
    }
    butce -= sayfa;
    sonuc[kaynak] = { bagli: true, adet, bayt, kismi };
  }
  return json({ kaynaklar: sonuc }, 200, cors);
}

/** Owner: silinen üyenin R2 nesnelerini kalıcı siler (hesap silme onayı sonrası; bkz. migration 0078).
 *  İşlem bütçesi (alt-istek sınırı) aşılırsa 409 döner: kısmi silme OLDUĞU için çağıran DB satırlarına dokunmamalı,
 *  aynı isteği tekrarlamalıdır (silme idempotent; kalan nesneler sonraki turda gider). */
async function uyeTemizle(env, kimlik, istek, cors) {
  let govde;
  try { govde = await istek.json(); } catch { return json({ error: "Geçersiz gövde." }, 400, cors); }
  const hedef = String(govde?.hedef || "");
  if (!UUID_DESENI.test(hedef)) return json({ error: "Geçersiz hedef." }, 400, cors);
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);

  const silinen = { arsiv: 0, notek: 0, akademik: 0 };
  const bagsiz = [];
  let butce = 40; // 50 alt-istek sınırının altında kal (is_owner RPC'si + pay)

  // Dosya Yöneticisi: yalnızca r2_key biçimine uyan anahtarlar (arsiv/<uuid>)
  const anahtarlar = (Array.isArray(govde?.arsiv_anahtarlari) ? govde.arsiv_anahtarlari : [])
    .filter((k) => anahtarSilinebilirMi("arsiv", k));
  if (anahtarlar.length) {
    if (!env.ARSIV_BUCKET) bagsiz.push("arsiv");
    else {
      for (let i = 0; i < anahtarlar.length; i += 1000) {
        if (butce-- <= 0) return json({ error: "Çok fazla nesne: işlem bütçesi doldu (kısmi silme). Aynı işlemi tekrar çalıştır." }, 409, cors);
        await env.ARSIV_BUCKET.delete(anahtarlar.slice(i, i + 1000));
      }
      silinen.arsiv = anahtarlar.length;
    }
  }

  // Not ekleri ve Akademik PDF'ler: üyeye ait önek altındaki HER ŞEY (DB satırı olmasa da yetim kalmasın)
  const onekler = [
    ["notek", "NOT_EK_BUCKET", `notlar/${hedef}/`],
    ["akademik", "AKADEMIK_BUCKET", `akademik-kutuphane/users/${hedef}/`],
  ];
  for (const [ad, bagAdi, onek] of onekler) {
    const kova = env[bagAdi];
    if (!kova) { bagsiz.push(ad); continue; }
    let imlec;
    for (;;) {
      if (butce-- <= 0) return json({ error: "Çok fazla nesne: işlem bütçesi doldu (kısmi silme). Aynı işlemi tekrar çalıştır." }, 409, cors);
      const l = await kova.list({ prefix: onek, limit: 1000, cursor: imlec });
      const keys = l.objects.map((o) => o.key);
      if (keys.length) {
        if (butce-- <= 0) return json({ error: "Çok fazla nesne: işlem bütçesi doldu (kısmi silme). Aynı işlemi tekrar çalıştır." }, 409, cors);
        await kova.delete(keys);
        silinen[ad] += keys.length;
      }
      if (!l.truncated) break;
      imlec = l.cursor;
    }
  }
  return json({ ok: true, silinen, bagsiz }, 200, cors);
}

/* ------------------------- v2: owner uç noktaları (migration 0081) ------------------------- */

async function ownerMi(env, kimlik) {
  const s = await rpc(env, kimlik, "is_owner", {});
  return !s.hata && s.veri === true;
}

function kaynakKovasi(env, kaynak, cors) {
  if (!KAYNAKLAR[kaynak]) return { hata: json({ error: "Geçersiz kaynak." }, 400, cors) };
  const kova = env[KAYNAKLAR[kaynak]];
  if (!kova) return { hata: json({ error: `${KAYNAKLAR[kaynak]} binding'i bağlı değil.` }, 501, cors) };
  return { kova };
}

function onekGuvenliMi(o) {
  return o === "" || (typeof o === "string" && o.length <= 600 && o.endsWith("/") && !o.includes("..") && !o.includes("\\") && !o.startsWith("/"));
}

async function r2Gezgin(env, kimlik, url, cors) {
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const kaynak = url.searchParams.get("b") || "";
  const onek = url.searchParams.get("o") || "";
  const imlec = url.searchParams.get("c") || undefined;
  if (!onekGuvenliMi(onek)) return json({ error: "Geçersiz önek." }, 400, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;

  const l = await kova.list({ prefix: onek, delimiter: "/", limit: 200, cursor: imlec });
  const anahtarlar = l.objects.map((o) => o.key);
  let durum = {};
  if (anahtarlar.length) {
    const s = await rpc(env, kimlik, "sistem_r2_kayit_durumu", { p_kaynak: kaynak, p_anahtarlar: anahtarlar });
    if (!s.hata) durum = s.veri || {};
  }
  return json({
    kaynak,
    onek,
    klasorler: (l.delimitedPrefixes || []).map((p) => ({ onek: p, ad: p.slice(onek.length).replace(/\/$/, "") })),
    nesneler: l.objects.map((o) => ({
      anahtar: o.key,
      ad: o.key.slice(onek.length),
      boyut: o.size,
      yuklenme: o.uploaded ? new Date(o.uploaded).toISOString() : null,
      kayitli: !!durum[o.key]?.kayitli,
      sahip: durum[o.key]?.sahip || null,
      etiket: durum[o.key]?.ad || null,
      sifreli: !!durum[o.key]?.sifreli,
      silinebilir: anahtarSilinebilirMi(kaynak, o.key),
    })),
    imlec: l.truncated ? l.cursor : null,
  }, 200, cors);
}

async function r2Boyut(env, kimlik, url, cors) {
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const kaynak = url.searchParams.get("b") || "";
  const onek = url.searchParams.get("o") || "";
  if (!onekGuvenliMi(onek)) return json({ error: "Geçersiz önek." }, 400, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;
  const ust = Math.max(1, Math.min(parseInt(env.MAX_TARAMA_SAYFA || "40", 10) || 40, 200) - 3);
  let adet = 0, bayt = 0, imlec, sayfa = 0, kismi = false;
  for (;;) {
    const l = await kova.list({ prefix: onek, limit: 1000, cursor: imlec });
    for (const o of l.objects) { adet += 1; bayt += o.size; }
    sayfa += 1;
    if (!l.truncated) break;
    if (sayfa >= ust) { kismi = true; break; }
    imlec = l.cursor;
  }
  return json({ adet, bayt, kismi }, 200, cors);
}

/** Silme: ÖNCE veritabanı (indeks satırı kaldır + kuyruğa yaz; atomik RPC), SONRA R2. Ağ/zaman aşımı olsa bile
 *  anahtarlar kuyrukta kalır → /r2/kuyruk-isle ile tamamlanır; "DB'de kayıt yok ama dosya duruyor" kalıcı olmaz. */
async function r2Sil(env, kimlik, istek, cors) {
  let g;
  try { g = await istek.json(); } catch { return json({ error: "Geçersiz gövde." }, 400, cors); }
  const kaynak = String(g?.kaynak || "");
  const liste = Array.isArray(g?.anahtarlar) ? [...new Set(g.anahtarlar)] : [];
  const islem = UUID_DESENI.test(String(g?.islem || "")) ? g.islem : null;
  if (!liste.length || liste.length > 500) return json({ error: "1–500 anahtar gerekli." }, 400, cors);
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;
  const reddedilen = liste.filter((k) => !anahtarSilinebilirMi(kaynak, k));
  if (reddedilen.length) {
    return json({ error: `${reddedilen.length} anahtar korumalı/bilinmeyen biçimde; hiçbir şey silinmedi.`, korumali: reddedilen.slice(0, 20) }, 400, cors);
  }

  const h = await rpc(env, kimlik, "sistem_r2_silme_hazirla", { p_kaynak: kaynak, p_anahtarlar: liste, p_islem: islem });
  if (h.hata) return json({ error: h.hata }, yetkisizMi(h.durum) ? 403 : 502, cors);

  try {
    await kova.delete(liste);
  } catch (e) {
    await rpc(env, kimlik, "sistem_r2_kuyruk_tamamla", { p_kaynak: kaynak, p_silinen: [], p_hatali: liste, p_hata: String(e?.message || e) });
    return json({ error: "R2 silme yarım kaldı; anahtarlar kuyrukta bekliyor (Depolama Gezgini › Bekleyen silmeler › Tekrar dene).", kuyrukta: liste.length }, 502, cors);
  }
  await rpc(env, kimlik, "sistem_r2_kuyruk_tamamla", { p_kaynak: kaynak, p_silinen: liste, p_hatali: [], p_hata: null });
  return json({ ok: true, silinen: liste.length, indeks: h.veri }, 200, cors);
}

async function r2KuyrukIsle(env, kimlik, cors) {
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const k = await rpc(env, kimlik, "sistem_r2_kuyruk_listesi", { p_limit: 500 });
  if (k.hata) return json({ error: k.hata }, 502, cors);
  const gruplar = {};
  for (const o of k.veri?.ogeler || []) {
    if (anahtarSilinebilirMi(o.kaynak, o.anahtar)) (gruplar[o.kaynak] ||= []).push(o.anahtar);
  }
  let silinen = 0, kalan = 0;
  for (const [kaynak, anahtarlar] of Object.entries(gruplar)) {
    const kova = env[KAYNAKLAR[kaynak]];
    if (!kova) { kalan += anahtarlar.length; continue; }
    try {
      await kova.delete(anahtarlar);
      await rpc(env, kimlik, "sistem_r2_kuyruk_tamamla", { p_kaynak: kaynak, p_silinen: anahtarlar, p_hatali: [], p_hata: null });
      silinen += anahtarlar.length;
    } catch (e) {
      await rpc(env, kimlik, "sistem_r2_kuyruk_tamamla", { p_kaynak: kaynak, p_silinen: [], p_hatali: anahtarlar, p_hata: String(e?.message || e) });
      kalan += anahtarlar.length;
    }
  }
  return json({ ok: true, silinen, kalan, toplam_kuyruk: Number(k.veri?.adet) || 0 }, 200, cors);
}

/** Geri yükleme: tek R2 nesnesi. Gövde dosya baytlarıdır; Content-Length ZORUNLU (akış boyutu belli olmalı). */
async function r2Yukle(env, kimlik, istek, url, cors) {
  const kaynak = url.searchParams.get("b") || "";
  const anahtar = url.searchParams.get("k") || "";
  const mod = url.searchParams.get("m") === "uzerine" ? "uzerine" : "eksikleri";
  if (!anahtarSilinebilirMi(kaynak, anahtar)) return json({ error: "Anahtar bilinen biçimlerden biriyle eşleşmiyor (korumalı)." }, 400, cors);
  const boy = parseInt(istek.headers.get("Content-Length") || "", 10);
  if (!Number.isFinite(boy) || boy < 0) return json({ error: "Content-Length gerekli." }, 411, cors);
  const ust = (parseInt(env.MAX_YUKLEME_MB || "95", 10) || 95) * 1024 * 1024;
  if (boy > ust) return json({ error: `Dosya ${Math.round(boy / 1048576)} MB; Worker yükleme sınırı ${Math.round(ust / 1048576)} MB.` }, 413, cors);
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;
  if (mod === "eksikleri" && (await kova.head(anahtar))) return json({ ok: true, durum: "atlandi" }, 200, cors);
  const tur = kaynak === "akademik" ? "application/pdf" : "application/octet-stream";
  await kova.put(anahtar, istek.body, { httpMetadata: { contentType: tur }, customMetadata: { geriyukleme: "1" } });
  return json({ ok: true, durum: "yazildi", boyut: boy }, 200, cors);
}

/** HER ÜYE: kendi geri yüklemesi için R2 yazımı. Yetki, üyenin kendi DB kaydının işaret ettiği anahtarla sınırlıdır. */
async function uyeYukle(env, kimlik, istek, url, cors) {
  const kaynak = url.searchParams.get("b") || "";
  const anahtar = url.searchParams.get("k") || "";
  const mod = url.searchParams.get("m") === "uzerine" ? "uzerine" : "eksikleri";
  if (!anahtarSilinebilirMi(kaynak, anahtar)) return json({ error: "Anahtar bilinen biçimlerden biriyle eşleşmiyor." }, 400, cors);
  const boy = parseInt(istek.headers.get("Content-Length") || "", 10);
  if (!Number.isFinite(boy) || boy < 0) return json({ error: "Content-Length gerekli." }, 411, cors);
  const ust = (parseInt(env.MAX_YUKLEME_MB || "95", 10) || 95) * 1024 * 1024;
  if (boy > ust) return json({ error: `Dosya ${Math.round(boy / 1048576)} MB; yükleme sınırı ${Math.round(ust / 1048576)} MB.` }, 413, cors);
  const iz = await rpc(env, kimlik, "uye_r2_yukleme_izinli_mi", { p_kaynak: kaynak, p_anahtar: anahtar });
  if (iz.hata) return json({ error: iz.hata }, yetkisizMi(iz.durum) ? 403 : 502, cors);
  if (iz.veri !== true) return json({ error: "Bu dosya için kaydın yok: önce tablolar geri yüklenmeli (kayıt olmadan dosya yazılmaz)." }, 403, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;
  if (mod === "eksikleri" && (await kova.head(anahtar))) return json({ ok: true, durum: "atlandi" }, 200, cors);
  const tur = kaynak === "akademik" ? "application/pdf" : "application/octet-stream";
  await kova.put(anahtar, istek.body, { httpMetadata: { contentType: tur }, customMetadata: { geriyukleme: "uye" } });
  return json({ ok: true, durum: "yazildi", boyut: boy }, 200, cors);
}

/**
 * Owner: bugünkü (UTC) istek sayısı — Cloudflare ücretsiz GraphQL Analytics API. 60 sn edge cache.
 *
 * BUG FİX (panel sayacı Cloudflare'in "Requests today" değerinden çok küçük çıkıyordu — örn. 34 vs 84):
 * Cloudflare'in 100.000/gün ücretsiz kotası Workers VE Pages Functions isteklerini BİRLİKTE sayar. Eski kod yalnızca
 * `workersInvocationsAdaptive` (Workers betikleri) okuyordu; Pages Functions (functions/_middleware.js — Gatekeeper "kasa"
 * katmanı, pages.dev'e gelen HER sayfa isteğinde çalışır) ayrı bir veri kümesinde (`pagesFunctionsInvocationsAdaptiveGroups`)
 * durduğu için sayıya hiç girmiyordu. Artık iki küme AYRI sorgularla okunur ve toplanır (biri başarısız olsa diğeri
 * görünür kalır). Yanıt: istek = workers + pages (kotaya sayılan toplam), workers, pages (null = okunamadı).
 * Not: Cloudflare panelindeki Worker kartlarındaki sayılar SON 24 SAAT'tir; burası UTC günüdür (gün başı 03:00 TR).
 */
async function kotaGetir(env, kimlik, cors) {
  if (!(await ownerMi(env, kimlik))) return json({ error: "Yalnızca Site Sahibi." }, 403, cors);
  const limit = parseInt(env.GUNLUK_ISTEK_LIMITI || "100000", 10) || 100000;
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ yapilandirilmadi: true, limit }, 200, cors);
  const anahtar = new Request(`https://kota.invalid/v2/${env.CF_ACCOUNT_ID}`);
  const onbellek = caches.default;
  const var_ = await onbellek.match(anahtar);
  if (var_) return new Response(var_.body, { status: 200, headers: { ...cors, "Content-Type": "application/json", "X-Onbellek": "hit" } });

  const simdi = new Date();
  const gun = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), simdi.getUTCDate())).toISOString();
  const graphql = async (sorgu) => {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sorgu, variables: { acc: env.CF_ACCOUNT_ID, from: gun, to: simdi.toISOString() } }),
    });
    const g = await r.json().catch(() => ({}));
    return { ok: r.ok && !(Array.isArray(g.errors) && g.errors.length), g };
  };

  const workersSorgu = `query($acc:String!,$from:Time!,$to:Time!){viewer{accounts(filter:{accountTag:$acc}){workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$from,datetime_leq:$to}){sum{requests errors subrequests}dimensions{scriptName}}}}}`;
  const pagesSorgu = `query($acc:String!,$from:Time!,$to:Time!){viewer{accounts(filter:{accountTag:$acc}){pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:{datetime_geq:$from,datetime_leq:$to}){sum{requests}}}}}`;

  let w, p;
  try {
    [w, p] = await Promise.all([graphql(workersSorgu), graphql(pagesSorgu).catch(() => ({ ok: false, g: {} }))]);
  } catch (e) { return json({ error: "Cloudflare Analytics'e ulaşılamadı.", limit }, 502, cors); }

  const satirlar = w.g?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (!w.ok || !Array.isArray(satirlar)) {
    return json({ error: "Analytics yanıtı alınamadı (token izni: Account Analytics › Read olmalı).", limit }, 502, cors);
  }
  const perScript = {};
  let workers = 0, hataSayisi = 0, alt = 0;
  for (const s of satirlar) {
    const n = Number(s.sum?.requests) || 0;
    workers += n; hataSayisi += Number(s.sum?.errors) || 0; alt += Number(s.sum?.subrequests) || 0;
    const ad = s.dimensions?.scriptName || "?";
    perScript[ad] = (perScript[ad] || 0) + n;
  }

  // Pages Functions: okunamazsa null (kullanıcıya "dahil değil" denir; Workers sayısı yine de gösterilir).
  const pagesSatirlari = p.g?.data?.viewer?.accounts?.[0]?.pagesFunctionsInvocationsAdaptiveGroups;
  let pages = null;
  if (p.ok && Array.isArray(pagesSatirlari)) {
    pages = pagesSatirlari.reduce((t, x) => t + (Number(x.sum?.requests) || 0), 0);
    if (pages > 0) perScript["Pages Functions (Gatekeeper)"] = pages;
  }

  const istek = workers + (pages || 0);
  const govde = JSON.stringify({
    istek, workers, pages, hata: hataSayisi, subistek: alt, limit, gun: gun.slice(0, 10), guncelleme: simdi.toISOString(),
    scriptler: Object.entries(perScript).map(([ad, n]) => ({ ad, istek: n })).sort((a, b) => b.istek - a.istek).slice(0, 12),
  });
  await onbellek.put(anahtar, new Response(govde, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }));
  return new Response(govde, { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Silme kuyruğundaki üyenin dosyası: yalnızca hesap_silme_dosya_izinli_mi() onaylarsa akıtılır.
 *  Önizleme güvenliği: yalnızca izinli türler (PDF/PNG/JPEG/WebP/GIF) "inline" sayılır; SVG/HTML asla. */
async function uyeDosya(env, kimlik, url, cors) {
  const uye = url.searchParams.get("u") || "";
  const kaynak = url.searchParams.get("b") || "";
  const anahtar = url.searchParams.get("k") || "";
  if (!UUID_DESENI.test(uye) || !anahtarSilinebilirMi(kaynak, anahtar)) return json({ error: "Geçersiz istek." }, 400, cors);
  const { kova, hata } = kaynakKovasi(env, kaynak, cors);
  if (hata) return hata;
  const s = await rpc(env, kimlik, "hesap_silme_dosya_izinli_mi", { p_user: uye, p_kaynak: kaynak, p_anahtar: anahtar });
  if (s.hata) return json({ error: s.hata }, yetkisizMi(s.durum) ? 403 : 502, cors);
  if (s.veri !== true) return json({ error: "Bu dosya bu üyenin silme kuyruğundaki verisi değil." }, 403, cors);
  const nesne = await kova.get(anahtar);
  if (!nesne) return json({ error: "Dosya R2'de bulunamadı." }, 404, cors);
  const tur = (nesne.httpMetadata?.contentType || "").toLowerCase().split(";")[0].trim();
  return new Response(nesne.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": ONIZLEME_TURLERI.has(tur) ? tur : "application/octet-stream",
      "Content-Length": String(nesne.size),
      "X-Dosya-Boyut": String(nesne.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "no-store",
    },
  });
}

/* -------------------------------- giriş -------------------------------- */

/**
 * SERT KAPATMA (isteğe bağlı, kota koruması): bir Worker'ın workers.dev adresini Cloudflare API ile KAPATIR/AÇAR. Kapalıyken o
 * adrese gelen istekler Worker çalışmadan reddedilir → Cloudflare kotasına SAYILMAZ (yumuşak anahtar yalnızca erken 503 döner ve
 * yine sayılır). Gereken secret'lar: CF_ACCOUNT_ID (zaten /kota için var) + CF_WORKERS_TOKEN (izin: Workers Scripts › Edit —
 * Account Analytics token'ından AYRI, daha geniş yetkili; yoksa bu uç 501 döner, hiçbir şey bozulmaz).
 * Yetki: Site Sahibi ya da sistem yedekleme yetkisi olan roller (sistem_export_yetkisi_var_mi). Yalnızca worker_anahtarlari'nda
 * kayıtlı, tur='worker' ve korumali=false servisler (sistem-yedek-worker kendini kapatamaz).
 */
async function workerSert(env, kimlik, istek, cors) {
  const yetki = await rpc(env, kimlik, "sistem_export_yetkisi_var_mi", {});
  if (yetki.hata || yetki.veri !== true) return json({ error: "Yetkisiz işlem." }, 403, cors);
  if (!env.CF_ACCOUNT_ID || !env.CF_WORKERS_TOKEN) {
    return json({ error: "Sert kapatma yapılandırılmamış (CF_WORKERS_TOKEN: Workers Scripts › Edit).", yapilandirilmadi: true }, 501, cors);
  }
  let g;
  try { g = await istek.json(); } catch { return json({ error: "Geçersiz istek." }, 400, cors); }
  const ad = String(g?.ad || "");
  if (!/^[a-z0-9-]{3,64}$/.test(ad) || typeof g?.acik !== "boolean") return json({ error: "Geçersiz istek." }, 400, cors);

  const kayit = await fetch(`${env.SUPABASE_URL}/rest/v1/worker_anahtarlari?ad=eq.${encodeURIComponent(ad)}&select=tur,korumali`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  const satirlar = kayit.ok ? await kayit.json().catch(() => []) : [];
  if (!Array.isArray(satirlar) || satirlar.length !== 1) return json({ error: "Bilinmeyen servis." }, 404, cors);
  if (satirlar[0].tur !== "worker" || satirlar[0].korumali) return json({ error: "Bu servis için sert kapatma yapılamaz." }, 403, cors);

  const adres = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(ad)}/subdomain`;
  let r, j = {};
  for (const yontem of ["POST", "PUT"]) { // API sürümüne göre yöntem farkı olabilir: 404/405'te diğerini dene
    r = await fetch(adres, {
      method: yontem,
      headers: { Authorization: `Bearer ${env.CF_WORKERS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: g.acik }),
    });
    j = await r.json().catch(() => ({}));
    if (r.status !== 404 && r.status !== 405) break;
  }
  if (!r.ok || j.success === false) {
    return json({ error: `Cloudflare reddetti: ${j?.errors?.[0]?.message || "HTTP " + r.status}` }, 502, cors);
  }
  return json({ ok: true, ad, workersDev: g.acik }, 200, cors);
}

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

    if (istek.method === "POST" && yol === "/uye-temizle") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Worker yapılandırması eksik (SUPABASE_URL, SUPABASE_ANON_KEY)." }, 500, cors);
      const k = istek.headers.get("Authorization") || "";
      if (!k.startsWith("Bearer ")) return json({ error: "Oturum gerekli." }, 401, cors);
      try { return await uyeTemizle(env, k, istek, cors); } catch (hata) { return json({ error: "Beklenmeyen hata: " + (hata?.message || hata) }, 500, cors); }
    }
    if (istek.method === "POST" || istek.method === "PUT") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Worker yapılandırması eksik (SUPABASE_URL, SUPABASE_ANON_KEY)." }, 500, cors);
      const k = istek.headers.get("Authorization") || "";
      if (!k.startsWith("Bearer ")) return json({ error: "Oturum gerekli." }, 401, cors);
      try {
        if (istek.method === "POST" && yol === "/worker-sert") return await workerSert(env, k, istek, cors);
        if (istek.method === "POST" && yol === "/r2/sil") return await r2Sil(env, k, istek, cors);
        if (istek.method === "POST" && yol === "/r2/kuyruk-isle") return await r2KuyrukIsle(env, k, cors);
        if (istek.method === "PUT" && yol === "/r2/yukle") return await r2Yukle(env, k, istek, url, cors);
        if (istek.method === "PUT" && yol === "/uye/yukle") return await uyeYukle(env, k, istek, url, cors);
      } catch (hata) { return json({ error: "Beklenmeyen hata: " + (hata?.message || hata) }, 500, cors); }
      return json({ error: "Bulunamadı." }, 404, cors);
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
      if (yol === "/kota") return await kotaGetir(env, kimlik, cors);
      if (yol === "/worker-sert/durum") return json({ yapilandirildi: !!(env.CF_ACCOUNT_ID && env.CF_WORKERS_TOKEN) }, 200, cors);
      if (yol === "/r2/gezgin") return await r2Gezgin(env, kimlik, url, cors);
      if (yol === "/r2/boyut") return await r2Boyut(env, kimlik, url, cors);
      if (yol === "/uye/dosya") return await uyeDosya(env, kimlik, url, cors);
    } catch (hata) {
      return json({ error: "Beklenmeyen hata: " + (hata?.message || hata) }, 500, cors);
    }
    return json({ error: "Bulunamadı." }, 404, cors);
  },
};
