/**
 * belge_donusturucu_worker/worker.js — Sunum/Belge dönüştürme için ince, KAYIT TUTMAYAN aracı (LibreOffice, açık kaynak).
 *
 * Neden: eski .ppt ikili biçimi tarayıcıda yalnızca düz metne indirgenebilir (tasarım, resim, şekil kaybolur). LibreOffice sunumu
 * gerçekten açıp pptx/pdf olarak yeniden yazar → slayt sayfaları, şekiller, resimler, yazı tipleri, tablolar korunur.
 * Cloudflare Worker LibreOffice çalıştıramaz; bu yüzden dosya, ÜCRETSİZ Hugging Face Space'teki /belge uç noktasına iletilir
 * (aynı Space: cloudflare worker/medya_indirici_worker/ytdlp-hf-space). Worker yalnızca kapı bekçisidir: oturum + yetki + kota + boyut.
 *
 * Uç nokta:  POST /donustur?hedef=pptx|pdf&ad=sunum.ppt     (Authorization: Bearer <Supabase JWT>; gövde = ham dosya, en çok 55 MB)
 *   Yetki: donusturucu_yetkisi_var_mi()  ·  Kota: medya_kota_durumu('belge_donustur') önce, başarıdan sonra medya_kota_harca (iade yok).
 *   Yanıt: dönüştürülmüş dosya baytları (200) | {hata} (4xx/5xx)
 *
 * GİZLİLİK: Dosya Worker'da saklanmaz/okunmaz (akış olarak geçer); Space'te yalnızca işlem süresince geçici klasördedir ve hemen silinir.
 *   Hiçbir günlük (console.log) yoktur. Dönüştürme yalnızca kullanıcı AÇIKÇA onay verdiğinde (arayüzde) yapılır.
 *
 * Secret/Var:  SUPABASE_URL, SUPABASE_ANON_KEY (herkese açık anon)  ·  BELGE_API_URL (örn. https://kullanici-space.hf.space)  ·  BELGE_API_KEY (Space'teki API_KEY ile aynı)
 *              BELGE_ORIGINLERI (isteğe bağlı, virgüllü ek origin listesi)
 */
const VARSAYILAN_ORIGINLER = ["https://abdullah-eymen-asru.github.io", "http://127.0.0.1:5500", "http://localhost:5500"];
const MAX_BAYT = 55 * 1024 * 1024;
const UZANTILAR = new Set(["ppt", "pps", "pot", "pptx", "ppsx", "potx", "odp"]);
const HEDEFLER = new Set(["pptx", "pdf"]);
const ARAC = "belge_donustur";

class HttpHata extends Error { constructor(kod, mesaj) { super(mesaj); this.kod = kod; } }
const izinliOrigin = (env, o) => !!o && (VARSAYILAN_ORIGINLER.includes(o) || String(env.BELGE_ORIGINLERI || "").split(",").map((s) => s.trim()).includes(o));
const cors = (o) => ({ "Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
const json = (veri, durum, o) => new Response(JSON.stringify(veri), { status: durum, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(o ? cors(o) : {}) } });

async function rpc(env, auth, ad, govde) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${ad}`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(govde || {}) });
  if (r.status === 401) throw new HttpHata(401, "Oturum geçersiz veya süresi dolmuş.");
  return r;
}

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    const yol = new URL(istek.url).pathname.replace(/\/+$/, "") || "/";
    if (istek.method === "OPTIONS") return izinliOrigin(env, origin) ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (!izinliOrigin(env, origin)) return json({ hata: "Bu kaynak için izin yok." }, 403);
    try {
      if (istek.method !== "POST" || yol !== "/donustur") throw new HttpHata(404, "Bulunamadı.");
      const auth = istek.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ")) throw new HttpHata(401, "Oturum gerekli.");
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.BELGE_API_URL || !env.BELGE_API_KEY) throw new HttpHata(503, "Belge dönüştürme sunucusu yapılandırılmamış.");

      const u = new URL(istek.url), hedef = u.searchParams.get("hedef") || "", ad = (u.searchParams.get("ad") || "").slice(0, 200);
      const uz = ad.includes(".") ? ad.split(".").pop().toLowerCase() : "";
      if (!HEDEFLER.has(hedef) || !UZANTILAR.has(uz)) throw new HttpHata(400, "Desteklenmeyen dönüşüm.");
      const boyut = Number(istek.headers.get("Content-Length") || 0);
      if (!Number.isFinite(boyut) || boyut < 512) throw new HttpHata(400, "Dosya boş ya da bozuk.");
      if (boyut > MAX_BAYT) throw new HttpHata(413, "Dosya çok büyük (en fazla 55 MB).");

      const y = await rpc(env, auth, "donusturucu_yetkisi_var_mi");
      if (!y.ok) throw new HttpHata(502, "Yetki doğrulanamadı.");
      if ((await y.json().catch(() => false)) !== true) throw new HttpHata(403, "Dönüştürücü aracına erişim yetkin yok.");

      const k = await rpc(env, auth, "medya_kota_durumu", { p_arac: ARAC });
      if (!k.ok) throw new HttpHata(502, "Kota durumu okunamadı.");
      const kd = await k.json().catch(() => null);
      if (kd?.kullanici?.kalan === 0) throw new HttpHata(429, "Bugünkü sunucu dönüştürme hakkın doldu. Yarın (Türkiye saati gece yarısı) yenilenir.");
      if (kd?.genel?.kalan === 0) throw new HttpHata(429, "Tüm site için bugünkü sunucu dönüştürme hakkı doldu. Yarın yenilenir.");

      const ust = await fetch(`${String(env.BELGE_API_URL).replace(/\/+$/, "")}/belge?hedef=${hedef}&ad=${encodeURIComponent(ad)}`, {
        method: "POST", headers: { Authorization: `Bearer ${env.BELGE_API_KEY}`, "Content-Type": "application/octet-stream", "Content-Length": String(boyut) }, body: istek.body, duplex: "half",
      }).catch(() => null);
      if (!ust) throw new HttpHata(502, "Dönüştürme sunucusuna ulaşılamadı (ücretsiz Space uykuda olabilir; 1 dk sonra tekrar dene).");
      if (!ust.ok) { const j = await ust.json().catch(() => null); throw new HttpHata(ust.status === 401 ? 502 : ust.status >= 500 && ust.status !== 504 ? 502 : ust.status, j?.hata || "Dönüştürme başarısız."); }

      // Başarı → kota düş (iade yolu yoktur). Hata verirse dönüştürme yine teslim edilir.
      let kota = null; try { const h = await rpc(env, auth, "medya_kota_harca", { p_arac: ARAC, p_miktar: 1, p_kendi: false }); if (h.ok) kota = await h.json(); } catch { /* yoksay */ }
      const basliklar = { "Content-Type": ust.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Access-Control-Expose-Headers": "X-Kota", ...cors(origin) };
      if (kota) basliklar["X-Kota"] = JSON.stringify({ k: kota.kullanici?.kalan ?? null, g: kota.genel?.kalan ?? null });
      return new Response(ust.body, { status: 200, headers: basliklar });
    } catch (h) {
      if (h instanceof HttpHata) return json({ hata: h.message }, h.kod, origin);
      return json({ hata: "Beklenmeyen hata." }, 500, origin);
    }
  },
};
