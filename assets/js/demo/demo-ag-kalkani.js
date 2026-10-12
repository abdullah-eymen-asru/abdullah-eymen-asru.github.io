/*
 * assets/js/demo/demo-ag-kalkani.js — Demo modunda YAZMA / İNDİRME / KOTA KALKANI (egress koruması)
 * -----------------------------------------------------------------------
 * Amaç: demo ziyaretçisinin tarayıcısından Supabase, Cloudflare Worker (100k istek kotası) ve R2'ye
 * (veri çıkış/egress) GİDEN HER İSTEĞİ istemci katmanında yakalamak. İstek ağa HİÇ çıkmaz.
 *
 * Savunma katmanları (hepsi yalnızca demo modunda kurulur):
 *   1) fetch  : hedef host Supabase/Worker/R2/GitHub-API ise → mock yanıt ya da 403 + toast.
 *   2) XHR    : akademik PDF yükleme (xhrPut) gibi XMLHttpRequest çağrıları → aynı kural.
 *   3) sendBeacon : aynı kural.
 *   4) (demo-supabase.js) supabase istemcisi zaten sahte; yazma → toast + hata.
 *   5) (demo-gorunum.js) kritik düğmelere (yükle/sil/yedek/senkron/kota) tıklama capture fazında yakalanır.
 *
 * İzinli (ağa çıkar): aynı origin (statik site dosyaları) ve CDN'ler (PDF.js, pdf-lib — kendi sunucumuz değil).
 * Tek istisna: demo-durum.js'in yakaladığı gerçek fetch ile demo_config_getir() (yalnızca görünürlük JSON'u).
 *
 * Okuma isteklerinden BİRKAÇI sahte yanıtla karşılanır (örnek PDF'in açılabilmesi için): bkz. sahteYanit().
 */
import { demoBildir, demoModuAktifMi, DEMO_MESAJI } from "./demo-durum.js";

/** Demo'da sunulan, herkese açık ÖRNEK dosyalar (statik, repoda; R2'de değil). id → {url, ad, mime} */
export const DEMO_DOSYALARI = Object.freeze({
  "d3a10000-0000-4000-8000-000000000001": { ad: "Örnek Makale Taslağı.pdf", url: "/assets/demo/ornek-makale-taslagi.pdf", mime: "application/pdf" },
  "d3a10000-0000-4000-8000-000000000002": { ad: "Örnek Arşiv Paketi.zip", url: "/assets/demo/ornek-arsiv.zip", mime: "application/zip" },
  "d3a10000-0000-4000-8000-000000000003": { ad: "Kapak Görseli (örnek).svg", url: "/assets/demo/ornek-gorsel.svg", mime: "image/svg+xml" },
  "d3a10000-0000-4000-8000-0000000000a1": { ad: "Örnek Makale Taslağı (kopya).pdf", url: "/assets/demo/ornek-makale-taslagi.pdf", mime: "application/pdf" },
});
export const DEMO_AKADEMIK_PDF_ID = "d3b20000-0000-4000-8000-000000000001"; // akademik_kaynaklar örnek kaynağı

const ENGELLI_HOST = [
  /(^|\.)supabase\.(co|in|net)$/i,
  /\.workers\.dev$/i,
  /(^|\.)r2\.cloudflarestorage\.com$/i,
  /\.r2\.dev$/i,
  /(^|\.)api\.github\.com$/i,
  /(^|\.)githubusercontent\.com$/i,
];

const asilFetch = window.fetch.bind(window);
const AsilXHR = window.XMLHttpRequest;
let kuruldu = false;

function urlCoz(girdi) {
  try {
    const u = typeof girdi === "string" ? girdi : girdi instanceof URL ? girdi.href : girdi?.url;
    return new URL(u, window.location.href);
  } catch {
    return null;
  }
}

/** true → bu istek demo'da AĞA ÇIKMAMALI. */
export function istekEngelliMi(url) {
  if (!url) return false;
  if (url.origin === window.location.origin) return false;
  return ENGELLI_HOST.some((r) => r.test(url.hostname));
}

const json = (govde, durum = 200, ek = {}) =>
  new Response(JSON.stringify(govde), { status: durum, headers: { "Content-Type": "application/json", ...ek } });

const engelYaniti = () => json({ error: DEMO_MESAJI, hata: DEMO_MESAJI, demo: true }, 403);

/** Okuma niteliğindeki birkaç Worker çağrısına sahte (yerel) yanıt. null → genel engel. */
async function sahteYanit(url, init) {
  const yol = url.pathname;
  const yontem = String(init?.method || "GET").toUpperCase();

  // Akademik Kütüphane Worker: GET /pdf/<id>  → yerel örnek PDF
  if (/^akademik-kutuphane-worker\./i.test(url.hostname) && yontem === "GET" && /^\/pdf\/[^/]+$/.test(yol)) {
    const r = await asilFetch(new URL(DEMO_DOSYALARI["d3a10000-0000-4000-8000-000000000001"].url, window.location.origin));
    const tampon = await r.arrayBuffer();
    return new Response(tampon, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Length": String(tampon.byteLength), "X-Pdf-Rev": "1" },
    });
  }

  // R2 Dosya Yöneticisi Worker: POST /indir {id}  → imzalı R2 bağlantısı YERİNE yerel örnek dosya adresi
  if (/^r2-arsiv-worker\./i.test(url.hostname) && yol === "/indir") {
    let id = null;
    try {
      id = JSON.parse(init?.body || "{}").id;
    } catch {
      /* yok say */
    }
    const d = DEMO_DOSYALARI[id];
    if (d) return json({ url: new URL(d.url, window.location.origin).href });
    return engelYaniti();
  }

  // Sağlık denetimi (yalnızca "çalışıyor" bilgisi; gerçek Worker'a gitmez)
  if (yol === "/saglik" || yol === "/health") return json({ ok: true, demo: true });

  return null;
}

async function demoFetch(girdi, init) {
  const url = urlCoz(girdi);
  if (!istekEngelliMi(url)) return asilFetch(girdi, init);
  const sahte = await sahteYanit(url, init || (girdi instanceof Request ? { method: girdi.method } : undefined));
  if (sahte) return sahte;
  demoBildir();
  return engelYaniti();
}

function xhrSar() {
  class DemoXHR extends AsilXHR {
    open(yontem, url, ...geri) {
      this.__demoUrl = urlCoz(url);
      this.__demoYontem = String(yontem || "GET").toUpperCase();
      return super.open(yontem, url, ...geri);
    }
    send(govde) {
      if (istekEngelliMi(this.__demoUrl)) {
        demoBildir();
        // Ağa HİÇ çıkmadan hata olayı: çağıran taraf "Ağ hatası" yerine kendi hata akışını çalıştırır.
        setTimeout(() => {
          try {
            this.abort();
          } catch {
            /* yok say */
          }
          this.dispatchEvent(new ProgressEvent("error"));
          if (typeof this.onerror === "function") this.onerror(new ProgressEvent("error"));
        }, 0);
        return;
      }
      return super.send(govde);
    }
  }
  window.XMLHttpRequest = DemoXHR;
}

export function kalkaniKur() {
  if (kuruldu || !demoModuAktifMi()) return;
  kuruldu = true;
  window.fetch = demoFetch;
  xhrSar();
  if (typeof navigator.sendBeacon === "function") {
    const asil = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (adres, veri) => (istekEngelliMi(urlCoz(adres)) ? true : asil(adres, veri));
  }
  // WebSocket (Supabase Realtime): demo'da kesinlikle açılmasın.
  const AsilWS = window.WebSocket;
  window.WebSocket = new Proxy(AsilWS, {
    construct(hedef, args) {
      const u = urlCoz(String(args[0]).replace(/^wss?:/i, "https:"));
      if (istekEngelliMi(u)) throw new Error(DEMO_MESAJI);
      return new hedef(...args);
    },
  });
}

// Modül yüklenir yüklenmez (demo ise) kur: sonradan yüklenen hiçbir modül kalkanı atlayamaz.
kalkaniKur();
