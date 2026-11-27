/**
 * assets/js/core/worker-kapi.js — KOTA KORUMASI: İSTEMCİ KAPISI (migration 0088 · public.worker_anahtarlari)
 * -----------------------------------------------------------------------------------------------------------
 * Site Sahibi / yetkili yönetici bir Worker'ı panelden (Yedekleme & Verilerim › Worker anahtarları) KAPATTIĞINDA, bu sitenin
 * tarayıcıları o Worker'a HİÇ istek göndermez: istek ağa çıkmadan, anlaşılır bir 503 JSON yanıtı ({ error, kapali:true })
 * ile yerinde reddedilir. Böylece kapatılan servis için Cloudflare'e tek istek bile gitmez (kota kesilir).
 *
 * Nasıl: window.fetch bir kez sarılır; yalnızca https://<ad>.<hesap>.workers.dev adreslerine bakar, diğer her şey aynen geçer.
 * Kapalı listesi (yalnızca kapalı servislerin adları) en çok 60 sn'de bir, yalnızca bir Worker çağrılacağı anda okunur
 * (localStorage'da paylaşılır; sekmeler arası tek istek). Okunamazsa AÇIK kabul edilir (fail-open): bu koruma kesinti sebebi olmaz.
 * Muaf: sistem-yedek-worker (anahtarları yöneten panelin kendisi), admin-guvenlik-bildirim-worker.
 * ZAMAN AŞIMI + BEKLEME MESAJI: Worker'a giden her istek yanıt BAŞLIĞI gelene kadar süre sınırına tabidir (normal 30 sn, uzun işlem yapan
 * medya/transkript/dönüştürme/yedek/arşiv/imza worker'ları 120 sn). Yanıt 5 sn'yi aşarsa ortak-arayuz.js "Veriler hazırlanıyor, lütfen bekleyin…"
 * bandını gösterir. GET istekleri süre aşımında bir kez kendiliğinden yeniden denenir; yine olmazsa Türkçe hata fırlatılır ve band "Tekrar dene" sunar.
 * Büyük gövdeli yüklemelerde (>256 KB, FormData, akış) süre sınırı UYGULANMAZ — yükleme yarıda kesilmesin.
 * innerHTML YOK, inline stil YOK (CSP).
 */
const MUAF = new Set(["sistem-yedek-worker", "admin-guvenlik-bildirim-worker"]);
const ONBELLEK_ANAHTARI = "aea_wk_v1";
const OMUR_MS = 60 * 1000;
const UZUN_ISLEM = /(medya|transkript|donustur|yedek|arsiv|imza)/i;
const ZAMAN_ASIMI_MS = 30 * 1000;
const ZAMAN_ASIMI_UZUN_MS = 120 * 1000;
const YAVAS_BAND_MS = 5 * 1000;
const WORKER_ADRESI = /^https:\/\/([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev(?:[/?#]|$)/i;

export function workerKapisiKur(supabaseUrl, anonAnahtar) {
  if (typeof window === "undefined" || window.__aeaWorkerKapisi) return;
  window.__aeaWorkerKapisi = true;
  const asilFetch = window.fetch.bind(window);
  let ucusta = null;

  function onbellekOku() {
    try {
      const k = JSON.parse(localStorage.getItem(ONBELLEK_ANAHTARI) || "null");
      if (k && Array.isArray(k.kapali) && Date.now() - k.t < OMUR_MS) return k.kapali;
    } catch { /* depo kapalı / bozuk */ }
    return null;
  }

  async function kapaliListesi() {
    const var_ = onbellekOku();
    if (var_) return var_;
    if (!ucusta) {
      ucusta = (async () => {
        let liste = [];
        try {
          const kontrol = new AbortController();
          const zamanAsimi = setTimeout(() => kontrol.abort(), 2500);
          const r = await asilFetch(`${supabaseUrl}/rest/v1/worker_anahtarlari?acik=eq.false&select=ad`, {
            headers: { apikey: anonAnahtar, Authorization: `Bearer ${anonAnahtar}` },
            signal: kontrol.signal,
          });
          clearTimeout(zamanAsimi);
          if (r.ok) liste = (await r.json()).map((x) => x.ad);
        } catch { /* fail-open: liste boş = hepsi açık */ }
        try { localStorage.setItem(ONBELLEK_ANAHTARI, JSON.stringify({ t: Date.now(), kapali: liste })); } catch { /* yok say */ }
        return liste;
      })().finally(() => { ucusta = null; });
    }
    return ucusta;
  }


  const olayYolla = (ad, detay) => { try { window.dispatchEvent(new CustomEvent(ad, { detail: detay || {} })); } catch { /* yok say */ } };
  function govdeBuyukMu(init, girdi) {
    if (typeof Request !== "undefined" && girdi instanceof Request) return true;   // Request nesnesinin gövdesini bilemeyiz → dokunma
    const b = init && init.body;
    if (!b) return false;
    if (typeof Blob !== "undefined" && b instanceof Blob) return b.size > 262144;
    if (b instanceof ArrayBuffer) return b.byteLength > 262144;
    if (ArrayBuffer.isView(b)) return b.byteLength > 262144;
    if (typeof b === "string") return b.length > 262144;
    return true;   // FormData, ReadableStream, URLSearchParams vb. → süre sınırı yok
  }
  function sureliFetch(girdi, init, ad) {
    const ms = UZUN_ISLEM.test(ad) ? ZAMAN_ASIMI_UZUN_MS : ZAMAN_ASIMI_MS;
    const dene = () => {
      const k = new AbortController();
      const dis = init && init.signal;
      if (dis) { if (dis.aborted) k.abort(dis.reason); else dis.addEventListener("abort", () => k.abort(dis.reason), { once: true }); }
      const yavas = setTimeout(() => olayYolla("aea:yavas", { acik: true }), YAVAS_BAND_MS);
      let yavasGosterildi = false;
      const yavasIsaretle = setTimeout(() => { yavasGosterildi = true; }, YAVAS_BAND_MS);
      const sinir = setTimeout(() => k.abort(new DOMException("Sunucu geç yanıt verdi. Lütfen tekrar dene.", "TimeoutError")), ms);
      return asilFetch(girdi, Object.assign({}, init || {}, { signal: k.signal })).finally(() => {
        clearTimeout(sinir); clearTimeout(yavas); clearTimeout(yavasIsaretle);
        if (yavasGosterildi) olayYolla("aea:yavas", { acik: false });
      });
    };
    const yontem = String((init && init.method) || "GET").toUpperCase();
    return dene().catch((h) => {
      if (h && h.name === "TimeoutError" && yontem === "GET" && !(init && init.signal && init.signal.aborted)) {
        return dene().catch((h2) => { if (h2 && h2.name === "TimeoutError") olayYolla("aea:zaman-asimi", {}); throw h2; });
      }
      if (h && h.name === "TimeoutError") olayYolla("aea:zaman-asimi", {});
      throw h;
    });
  }

  window.fetch = async function workerKapisiFetch(girdi, init) {
    try {
      const url = typeof girdi === "string" ? girdi : girdi instanceof URL ? girdi.href : girdi && girdi.url;
      const m = url ? WORKER_ADRESI.exec(url) : null;
      if (m && !MUAF.has(m[1].toLowerCase())) {
        const kapali = await kapaliListesi();
        if (kapali.includes(m[1].toLowerCase())) {
          return new Response(JSON.stringify({ error: "Bu servis geçici olarak kapatıldı.", kapali: true }), {
            status: 503,
            headers: { "Content-Type": "application/json", "Retry-After": "300" },
          });
        }
      }
      if (m && !govdeBuyukMu(init, girdi)) return sureliFetch(girdi, init, m[1]);
    } catch (h) { if (h && h.name === "TimeoutError") throw h; /* kapı hatası asıl isteği engellemez */ }
    return asilFetch(girdi, init);
  };
}
