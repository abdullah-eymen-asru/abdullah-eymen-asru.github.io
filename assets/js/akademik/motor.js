/*
 * assets/js/akademik/motor.js — PDF okuyucu motorunun (PDF.js) ve pdf-lib'in CDN'den, SÜRÜM SABİTLİ yüklenmesi.
 *
 *  - Kod tabanına PDF.js gömülmez; resmi npm paketi (pdfjs-dist) jsDelivr'den, yedek olarak unpkg'den gelir.
 *  - Sürüm seçimi İKİ katmanlıdır:
 *      1) SİTE VARSAYILANI (Site Sahibi): veritabanındaki tek satır (akademik_okuyucu_ayarlari). Herkesin "Otomatik" modu bunu kullanır.
 *      2) KİŞİSEL TERCİH (her kullanıcı, kendi tarayıcısında — localStorage): "otomatik" | "en-yeni" | "sabit" + sürüm.
 *    Çözüm sırası: kişisel tercih → site varsayılanı → sınanmış MOTOR_VARSAYILAN. Seçilen sürüm yüklenemezse bir
 *    sonrakine düşülür; okuyucu hiçbir zaman "bozuk" kalmaz. Hangisinin gerçekten yüklendiği motorDurumu() ile okunur.
 *  - Sürüm listesi CANLI olarak data.jsdelivr.com'dan çekilir (6 sa önbellek); kaynağı/zamanı/URL'si "kanıt" olarak
 *    arayüze verilir (bkz. sureumListesiGetir). Çevrimdışıysa eski önbellek AÇIKÇA "önbellek" diye işaretlenir.
 *  - CSP: sitenin script-src'si https: kaynaklara izin verir; Worker için ayrıca "worker-src 'self' blob:"
 *    gerekir (_layouts/default.html ve _headers'a eklendi). Eklenmemişse PDF.js ana iş parçacığında çalışır (yavaş ama çalışır).
 */
import { supabase, MOTOR_VARSAYILAN } from "./ortak.js";

const SURUM_RE = /^\d+\.\d+\.\d+$/;
const EN_AZ_ANA_SURUM = 4;
export const SURUM_API_URL = "https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist";
export const NPM_SAYFA_URL = "https://www.npmjs.com/package/pdfjs-dist?activeTab=versions";
export const JSDELIVR_SAYFA_URL = "https://www.jsdelivr.com/package/npm/pdfjs-dist";
const TERCIH_ANAHTARI = "aea_ak_motor_tercih_v1";
const LISTE_ONBELLEK = "aea_ak_motor_surumler_v1";
const LISTE_TTL_MS = 6 * 3600 * 1000;

const CDN_TABANLARI = [
  (s) => `https://cdn.jsdelivr.net/npm/pdfjs-dist@${s}`,
  (s) => `https://unpkg.com/pdfjs-dist@${s}`,
];
const PDFLIB_URL = (s) => `https://cdn.jsdelivr.net/npm/pdf-lib@${s}/dist/pdf-lib.min.js`;

let yuklemeSozu = null;
/** Bu sayfa ömründe gerçekte yüklenen motorun bilgisi (arayüz "şu an kullanılan"ı buradan gösterir). */
let sonDurum = null;

export async function motorAyarlari() {
  try {
    const { data, error } = await supabase.from("akademik_okuyucu_ayarlari").select("pdfjs_surum, pdflib_surum, updated_at").eq("id", 1).maybeSingle();
    if (!error && data) return { pdfjs: data.pdfjs_surum, pdflib: data.pdflib_surum, guncelleme: data.updated_at };
  } catch { /* varsayılan */ }
  return { ...MOTOR_VARSAYILAN, guncelleme: null };
}

function cssEkle(href) {
  if (document.querySelector(`link[data-ak-motor-css="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.dataset.akMotorCss = href;
  document.head.append(l);
}

function scriptYukle(src) {
  return new Promise((coz, red) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = coz;
    s.onerror = () => red(new Error(`Yüklenemedi: ${src}`));
    document.head.append(s);
  });
}

/** PDF.js 5.x'in "modern" derlemesi yeni JS özelliklerine (Uint8Array.toHex, Promise.try…) dayanır.
 *  Tarayıcıda yoksa aynı sürümün "legacy" derlemesi (çok-dolgulu, her tarayıcıda çalışan) kullanılır. */
export const MODERN_DERLEME_UYGUN = () =>
  typeof Uint8Array.prototype.toHex === "function" &&
  typeof Uint8Array.fromBase64 === "function" &&
  typeof Promise.try === "function" &&
  typeof Promise.withResolvers === "function";

/* ------------------------------ kişisel tercih ------------------------------ */

/** @returns {{mod:"otomatik"|"en-yeni"|"sabit", surum:string|null}} — bozuk/eksik kayıt "otomatik"e düşer. */
export function tercihOku() {
  try {
    const t = JSON.parse(localStorage.getItem(TERCIH_ANAHTARI) || "null");
    if (t && (t.mod === "en-yeni" || (t.mod === "sabit" && SURUM_RE.test(t.surum || "")))) return { mod: t.mod, surum: t.mod === "sabit" ? t.surum : null };
  } catch { /* depo kapalı / bozuk JSON */ }
  return { mod: "otomatik", surum: null };
}

/** Tercihi kaydeder. Depo kapalıysa false döner (arayüz uyarır). */
export function tercihYaz(tercih) {
  try {
    if (tercih.mod === "otomatik") localStorage.removeItem(TERCIH_ANAHTARI);
    else localStorage.setItem(TERCIH_ANAHTARI, JSON.stringify({ mod: tercih.mod, surum: tercih.mod === "sabit" ? tercih.surum : null }));
    return true;
  } catch { return false; }
}

/** Sürüm karşılaştırma (x.y.z, sayısal). */
export const surumKarsilastir = (a, b) => a.localeCompare(b, "en", { numeric: true });

/* ------------------------------ canlı sürüm listesi ------------------------------ */

function listeOnbellekOku() {
  try {
    const o = JSON.parse(localStorage.getItem(LISTE_ONBELLEK) || "null");
    if (o && Array.isArray(o.surumler) && o.surumler.every((v) => SURUM_RE.test(v)) && typeof o.t === "number") return o;
  } catch { /* yok say */ }
  return null;
}

function surumleriAyikla(j) {
  const surumler = (j?.versions || [])
    .map((v) => (typeof v === "string" ? v : v?.version))
    .filter((v) => typeof v === "string" && SURUM_RE.test(v) && Number(v.split(".")[0]) >= EN_AZ_ANA_SURUM)
    .sort((a, b) => surumKarsilastir(b, a));
  const etiket = typeof j?.tags?.latest === "string" && SURUM_RE.test(j.tags.latest) ? j.tags.latest : null;
  return { surumler, latestEtiketi: etiket };
}

/**
 * Yayımlanmış kararlı sürümler (yalnızca x.y.z, ana sürüm >= 4), yeniden eskiye.
 * Dönen nesne aynı zamanda KANIT'tır: { surumler, en_yeni, kaynak: "canli"|"onbellek", cekildi (ISO), url, sureMs, hata? }
 *  - zorla=true: önbelleği atlar, internetten taze çeker.
 *  - Ağ hatasında eski önbellek varsa onu döner ama kaynak:"onbellek" ve hata alanıyla DÜRÜSTÇE işaretler; hiç yoksa hata fırlatır.
 *  - en_yeni: jsDelivr'in "latest" etiketi (resmî); yoksa listedeki en büyük kararlı sürüm.
 */
export async function surumListesiGetir({ zorla = false } = {}) {
  const onb = listeOnbellekOku();
  if (!zorla && onb && Date.now() - onb.t < LISTE_TTL_MS) {
    return { surumler: onb.surumler, en_yeni: onb.en_yeni || onb.surumler[0] || null, kaynak: "onbellek", cekildi: new Date(onb.t).toISOString(), url: SURUM_API_URL, sureMs: 0, taze: true };
  }
  const ctrl = new AbortController();
  const zamanAsimi = setTimeout(() => ctrl.abort(), 8000);
  const basla = performance.now();
  try {
    const r = await fetch(SURUM_API_URL, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`jsDelivr yanıtı: HTTP ${r.status}`);
    const { surumler, latestEtiketi } = surumleriAyikla(await r.json());
    if (!surumler.length) throw new Error("jsDelivr'den geçerli sürüm listesi gelmedi.");
    const en_yeni = latestEtiketi && surumler.includes(latestEtiketi) ? latestEtiketi : surumler[0];
    const t = Date.now();
    try { localStorage.setItem(LISTE_ONBELLEK, JSON.stringify({ t, surumler, en_yeni })); } catch { /* depo kapalı */ }
    return { surumler, en_yeni, kaynak: "canli", cekildi: new Date(t).toISOString(), url: SURUM_API_URL, sureMs: Math.round(performance.now() - basla) };
  } catch (h) {
    const hata = h?.name === "AbortError" ? "Zaman aşımı (8 sn): jsDelivr'e ulaşılamadı." : h?.message || String(h);
    if (onb) return { surumler: onb.surumler, en_yeni: onb.en_yeni || onb.surumler[0] || null, kaynak: "onbellek", cekildi: new Date(onb.t).toISOString(), url: SURUM_API_URL, sureMs: 0, hata };
    throw new Error(hata);
  } finally {
    clearTimeout(zamanAsimi);
  }
}

/** Geriye dönük uyumluluk: yalnızca sürüm dizisi. */
export async function yayimlananSurumler() {
  return (await surumListesiGetir()).surumler;
}

/* ------------------------------ yükleme ------------------------------ */

async function pdfjsYukle(surum) {
  let sonHata;
  const dizin = MODERN_DERLEME_UYGUN() ? "" : "/legacy";
  for (const taban of CDN_TABANLARI.map((f) => f(surum))) {
    try {
      const pdfjsLib = await import(/* @vite-ignore */ `${taban}${dizin}/build/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${taban}${dizin}/build/pdf.worker.min.mjs`;
      // pdf_viewer.mjs bu global'i bekler. BUG FİX: eskiden "globalThis.pdfjsLib || pdfjsLib" idi — ilk (başarısız
      // olmuş) sürümün kütüphanesi global'de kalırsa varsayılan sürüme düşüldüğünde görüntüleyici YANLIŞ sürümle
      // eşleşirdi. Artık her denemede, görüntüleyici içe aktarılmadan hemen önce üzerine yazılır.
      globalThis.pdfjsLib = pdfjsLib;
      const pdfjsViewer = await import(/* @vite-ignore */ `${taban}${dizin}/web/pdf_viewer.mjs`);
      cssEkle(`${taban}/web/pdf_viewer.css`);
      return { pdfjsLib, pdfjsViewer, taban, surum, legacy: !!dizin, cdn: new URL(taban).hostname };
    } catch (h) {
      sonHata = h;
    }
  }
  throw sonHata || new Error("PDF.js yüklenemedi.");
}

async function pdfLibYukle(surum) {
  if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
  await scriptYukle(PDFLIB_URL(surum));
  if (!globalThis.PDFLib?.PDFDocument) throw new Error("pdf-lib yüklenemedi.");
  return globalThis.PDFLib;
}


async function kullaniciKimligi() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch { return null; }
}

/** Kişisel tercih + site varsayılanı → denenecek sürüm SIRASI [{surum, kaynak}] (yinelenenler elenir). */
async function adaySurumler(ayar) {
  const t = tercihOku();
  const adaylar = [];
  if (t.mod === "sabit") adaylar.push({ surum: t.surum, kaynak: "tercih-sabit" });
  else if (t.mod === "en-yeni") {
    try { const l = await surumListesiGetir(); if (l.en_yeni) adaylar.push({ surum: l.en_yeni, kaynak: "tercih-en-yeni" }); } catch { /* ağ yok: site varsayılanına düşer */ }
  }
  adaylar.push({ surum: ayar.pdfjs, kaynak: "site" }, { surum: MOTOR_VARSAYILAN.pdfjs, kaynak: "varsayilan" });
  const gorulen = new Set();
  return adaylar.filter((a) => SURUM_RE.test(a.surum || "") && !gorulen.has(a.surum) && gorulen.add(a.surum));
}

/** Motoru (bir kez) yükler. { pdfjsLib, pdfjsViewer, taban, surum, legacy, cdn, kaynak, PDFLib… } döner. */
export function motoruYukle() {
  if (!yuklemeSozu) {
    yuklemeSozu = (async () => {
      await kullaniciKimligi(); // oturum hazır olsun (kişisel tercih tarayıcıya bağlıdır; kimlik yalnızca ısınma)
      const ayar = await motorAyarlari();
      const basla = performance.now();
      let pdfjs;
      let sonHata;
      const denenen = [];
      for (const aday of await adaySurumler(ayar)) {
        try {
          pdfjs = { ...(await pdfjsYukle(aday.surum)), kaynak: aday.kaynak };
          break;
        } catch (e) {
          sonHata = e;
          denenen.push(aday.surum);
          console.warn(`PDF.js ${aday.surum} (${aday.kaynak}) yüklenemedi, sıradakine geçiliyor:`, e);
        }
      }
      if (!pdfjs) throw sonHata || new Error("PDF.js yüklenemedi.");
      sonDurum = {
        surum: pdfjs.surum,
        gercekSurum: pdfjs.pdfjsLib.version || null, // kütüphanenin KENDİ bildirdiği sürüm (kanıt)
        kaynak: pdfjs.kaynak, taban: pdfjs.taban, cdn: pdfjs.cdn, legacy: pdfjs.legacy,
        sureMs: Math.round(performance.now() - basla), yuklendi: new Date().toISOString(), atlanan: denenen,
      };
      // pdf-lib yalnızca kaydederken gerekir; ayrı, tembel yüklenir.
      return { ...pdfjs, pdflibSurumu: ayar.pdflib };
    })().catch((h) => { yuklemeSozu = null; throw h; });
  }
  return yuklemeSozu;
}

/** Bu sayfada motor yüklendi mi? (Yüklendiyse sürüm değişikliği ancak sayfa yenilenince geçer — iki PDF.js aynı sayfada karışmasın.) */
export const motorYuklendiMi = () => !!sonDurum;
export const motorDurumu = () => sonDurum;

export async function pdfLibAl() {
  const m = await motoruYukle();
  try {
    return await pdfLibYukle(m.pdflibSurumu);
  } catch {
    return pdfLibYukle(MOTOR_VARSAYILAN.pdflib);
  }
}

/** Sonraki açılışta hangi sürümün kullanılacağının TAHMİNİ (yalnız arayüz için; ağ gerektirmeyen yol önbelleğe bakar). */
export async function planlananSurum() {
  const ayar = await motorAyarlari();
  const t = tercihOku();
  if (t.mod === "sabit") return { surum: t.surum, kaynak: "tercih-sabit", site: ayar.pdfjs };
  if (t.mod === "en-yeni") {
    const onb = listeOnbellekOku();
    if (onb?.en_yeni) return { surum: onb.en_yeni, kaynak: "tercih-en-yeni", site: ayar.pdfjs };
  }
  return { surum: ayar.pdfjs, kaynak: t.mod === "en-yeni" ? "tercih-en-yeni-bekliyor" : "site", site: ayar.pdfjs };
}

/* ------------------------------ gerçek sınama ------------------------------ */

/** Geçerli, 1 sayfalık en küçük PDF (xref ofsetleri hesaplanır). */
function minimalPdf() {
  const nesneler = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>",
  ];
  let govde = "%PDF-1.4\n";
  const ofsetler = [];
  nesneler.forEach((n, i) => { ofsetler.push(govde.length); govde += `${i + 1} 0 obj\n${n}\nendobj\n`; });
  const xref = govde.length;
  govde += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n` + ofsetler.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  govde += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(govde);
}

/**
 * Bir sürümü AKTİF yapmadan, yalıtılmış olarak GERÇEKTEN sınar: modülü içe aktarır, worker dosyasını getirir,
 * minimal bir PDF'i açar. Döner: { ok, surum (istenen), gercekSurum (kütüphanenin bildirdiği), taban, cdn, legacy, sayfa, sureMs, hata? }
 */
export async function surumuDene(surum) {
  if (!SURUM_RE.test(surum || "")) return { ok: false, hata: "Geçersiz sürüm biçimi." };
  const basla = performance.now();
  let sonHata = "";
  for (const taban of CDN_TABANLARI.map((f) => f(surum))) {
    let gorev;
    try {
      const dizin = MODERN_DERLEME_UYGUN() ? "" : "/legacy";
      const m = await import(/* @vite-ignore */ `${taban}${dizin}/build/pdf.min.mjs`);
      if (typeof m.getDocument !== "function") throw new Error("getDocument yok");
      const workerUrl = `${taban}${dizin}/build/pdf.worker.min.mjs`;
      const w = await fetch(workerUrl, { method: "GET", cache: "force-cache" });
      if (!w.ok) throw new Error(`worker dosyası alınamadı (HTTP ${w.status})`);
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      gorev = m.getDocument({ data: minimalPdf(), isEvalSupported: false, useWasm: false, enableXfa: false });
      const belge = await Promise.race([gorev.promise, new Promise((_, red) => setTimeout(() => red(new Error("PDF açma sınaması zaman aşımına uğradı (10 sn)")), 10000))]);
      const sayfa = belge.numPages;
      await gorev.destroy(); // BUG FİX: belge.destroy() yerine loadingTask.destroy() — worker'ı da kapatır, sızıntı olmaz
      if (sayfa !== 1) throw new Error("Sınama PDF'i beklenen sayfa sayısıyla açılmadı.");
      return { ok: true, surum, gercekSurum: m.version || null, taban, cdn: new URL(taban).hostname, legacy: !!dizin, sayfa, sureMs: Math.round(performance.now() - basla) };
    } catch (h) {
      sonHata = h?.message || String(h);
      try { await gorev?.destroy(); } catch { /* yok say */ }
    }
  }
  return { ok: false, surum, hata: sonHata || "Sürüm yüklenemedi." };
}

/** Site varsayılanını (herkes için "Otomatik") değiştirir — yalnızca Site Sahibi (RPC de kontrol eder). */
export async function surumuSabitle(pdfjs, pdflib = null) {
  const { error } = await supabase.rpc("owner_akademik_okuyucu_surumu_ayarla", { p_pdfjs: pdfjs, p_pdflib: pdflib });
  if (error) throw new Error(error.message);
}
