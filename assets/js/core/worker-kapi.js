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
 * innerHTML YOK, inline stil YOK (CSP).
 */
const MUAF = new Set(["sistem-yedek-worker", "admin-guvenlik-bildirim-worker"]);
const ONBELLEK_ANAHTARI = "aea_wk_v1";
const OMUR_MS = 60 * 1000;
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
    } catch { /* kapı hatası asıl isteği engellemez */ }
    return asilFetch(girdi, init);
  };
}
