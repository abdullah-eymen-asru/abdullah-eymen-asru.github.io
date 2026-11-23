/**
 * ui-zaman.js — HavaStil · "Bu veri en son ne zaman çekildi?" göstergeleri ve yenileme düğmeleri.
 *   sonCekilme(d, kb, kaynak)  → kartların içine konan tek satır: "🕒 Çekildi 14:32 (5 dk önce) · ⟳ Yenile"
 *   veriDurumu(d, kb)          → sayfanın üstündeki açılır "Veri durumu" listesi: her kaynak için durum + çekilme saati + yenile.
 * Kaynak kimlikleri: "model" (hava tahmini + Copernicus hava kalitesi modeli) · "mgm" · "metar" · "openaq" · "haber".
 *   model  → tüm modeller yeniden çekilir.   mgm/metar → yalnızca resmî gözlem yeniden çekilir (modeller çekilmez).
 *   openaq → yalnızca hava kalitesi istasyonları yeniden çekilir.   haber → yalnızca uyarılar.
 * VİTRİN/MİSAFİR: yalnızca "model" gösterilir (Open-Meteo, herkese açık veri). Resmî kaynak/haber satırı ve düğmesi HİÇ çizilmez; böylece
 * demo ziyaretçisi bu kaynakların varlığını, ayarını ya da durumunu göremez.
 * CSP: inline stil/işleyici yok.
 */
import { el, olay } from "./ui-temel.js";
import { resmiBaglanti } from "./hava-kaynak.js";

const SAAT = (ms) => new Date(ms).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
export function zamanYazisi(ms) {
  if (!Number.isFinite(ms)) return "";
  const dk = Math.max(0, Math.round((Date.now() - ms) / 60000));
  const once = dk < 1 ? "az önce" : dk < 90 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} sa önce` : `${Math.round(dk / 1440)} gün önce`;
  const bugunMu = new Date(ms).toDateString() === new Date().toDateString();
  return `${bugunMu ? "" : `${new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} `}${SAAT(ms)} (${once})`;
}

/** Resmî kaynağın KENDİ sayfasına bağlantı ("↗" yeni sekmede açılır). Veri nereden çekildiyse orada doğrulanabilsin. Bağlantı yoksa null. */
export function resmiSiteBaglantisi(g, { sinif = "hv-resmi-link", kisa = false } = {}) {
  const b = resmiBaglanti(g);
  if (!b || !/^https:\/\//.test(b.url)) return null;
  return el("a", { class: sinif, href: b.url, target: "_blank", rel: "noopener noreferrer", title: `${b.kurum} — veriyi kaynağında kendin gör`, "aria-label": `${b.yazi} (yeni sekmede açılır)` }, el("span", { text: kisa ? "Resmî site ↗" : `${b.yazi} ↗` }));
}

const AD = { model: "Hava tahmini ve hava kalitesi modeli", mgm: "Meteoroloji Genel Müdürlüğü (MGM)", metar: "Havalimanı resmî raporu (METAR)", openaq: "Hava kalitesi istasyonları (OpenAQ)", haber: "Uyarılar ve haberler" };
const IKON = { model: "🛰️", mgm: "🏛️", metar: "✈️", openaq: "📡", haber: "📰" };
const SON_YENILEME = new Map();                          // kaynak → son yenileme (ms): art arda tıklamayı engeller
const BEKLEME_MS = 20 * 1000;

const resmiMi = (kaynak) => kaynak !== "model";
const kapaliMi = (d) => !!(d.vitrin || d.misafir);

/** Kaynağın en son çekildiği an (ms) ya da null. Resmî kaynaklarda teşhis kaydındaki an kullanılır. */
export function kaynakZamani(d, kaynak) {
  if (kaynak === "model") return d.hava?.alinma ?? null;
  if (kaynak === "haber") return d.haber?.guncelleme ?? null;
  const t = (d.hava?.kaynakTeshis || []).find((x) => x.kaynak === kaynak);
  if (t?.alinma) return t.alinma;
  const g = d.hava?.gozlem;
  return g && g.saglayici === kaynak ? g.alinma ?? null : null;
}

async function yenile(d, kb, kaynak) {
  if (kaynak === "model") return kb.yenile(true);
  if (kaynak === "haber") return kb.haberYenile(true);
  return kb.kaynakYenile(kaynak === "openaq" ? "aq" : "gozlem");
}

/** ⟳ düğmesi; çalışırken pasif, tamamlanınca eski yazıya döner; 20 sn içinde ikinci tıklama yeni istek yapmaz. */
export function yenileDugmesi(d, kb, kaynak, { kisa = false } = {}) {
  const yaz = kisa ? "⟳" : "⟳ Yenile";
  const b = el("button", { type: "button", class: "hv-btn hv-btn-ince hv-yenile-btn", "aria-label": `${AD[kaynak]} verisini yenile`, title: `${AD[kaynak]} yeniden çekilir`, text: yaz });
  return olay(b, "click", async () => {
    if (b.disabled) return;
    const son = SON_YENILEME.get(kaynak) || 0;
    if (Date.now() - son < BEKLEME_MS) { b.textContent = "Az önce yenilendi"; setTimeout(() => { if (b.isConnected) b.textContent = yaz; }, 2200); return; }
    SON_YENILEME.set(kaynak, Date.now());
    b.disabled = true; b.textContent = "Yenileniyor…";
    try { await yenile(d, kb, kaynak); } catch { /* ekran zaten eski veriyi gösterir */ }
    finally { if (b.isConnected) { b.disabled = false; b.textContent = yaz; } }
  });
}

/** Kartın içine konan tek satır. Vitrin/misafirde resmî kaynak için null döner (hiçbir şey çizilmez). */
export function sonCekilme(d, kb, kaynak, { olcumZamani = null } = {}) {
  if (kapaliMi(d) && resmiMi(kaynak)) return null;
  const t = kaynakZamani(d, kaynak);
  if (!t) return null;
  return el("p", { class: "hv-cekilme" },
    el("span", { class: "hv-cekilme-yazi" }, el("span", { "aria-hidden": "true", text: "🕒 " }), el("span", { text: `Son çekilme: ${zamanYazisi(t)}` }),
      olcumZamani ? el("span", { class: "muted", text: ` · ölçüm saati ${SAAT(Date.parse(olcumZamani))}` }) : null),
    yenileDugmesi(d, kb, kaynak));
}

/** Kaynağın durumu: { sinif: ok|uyari|kapali|yok, yazi }. Teşhis kaydı yoksa ve gözlem başka kaynaktan geldiyse "gerekmedi". */
function durumSatiri(d, kaynak) {
  if (kaynak === "model") return d.hava?.kalite ? { sinif: "ok", yazi: "Çekildi" } : { sinif: "uyari", yazi: "Tahmin alındı; hava kalitesi modeli yanıt vermedi" };
  if (kaynak === "haber") return !d.haberAcik ? { sinif: "kapali", yazi: "Kapalı (Ayarlar'dan açılır)" } : d.haber?.durum === "ok" ? { sinif: "ok", yazi: "Çekildi" } : d.haber ? { sinif: "uyari", yazi: d.haber.durum === "ulasilamadi" ? "Ulaşılamadı" : "Uyarı yok" } : { sinif: "yok", yazi: "Henüz çekilmedi" };
  const t = (d.hava?.kaynakTeshis || []).find((x) => x.kaynak === kaynak);
  if (t) {
    if (t.kapali) return { sinif: "kapali", yazi: "Kapalı (yönetici ayarı)" };
    if (t.anahtarYok) return { sinif: "kapali", yazi: "Anahtar tanımlı değil" };
    if (t.atlandi) return { sinif: "kapali", yazi: t.not };
    return t.ok ? { sinif: t.not && /yok/.test(t.not) ? "uyari" : "ok", yazi: `Çekildi${t.not ? ` · ${t.not}` : ""}` } : { sinif: "uyari", yazi: `Alınamadı · ${t.not}` };
  }
  if (!d.hava?.kaynakTeshis) return { sinif: "yok", yazi: "Resmî kaynaklar bu oturumda kullanılmadı" };
  return { sinif: "yok", yazi: kaynak === "metar" && d.hava?.gozlem ? "Gerekmedi (daha öncelikli kaynak yanıt verdi)" : "Denenmedi" };
}

/** Satırın altındaki "resmî sitede aç" bağlantısı: gözlem bu kaynaktansa kayda özel sayfa (örn. Ataşehir istasyonu), değilse kaynağın genel sayfası. */
const GENEL_SAYFA = { model: "https://open-meteo.com/en/docs", mgm: "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx", metar: "https://aviationweather.gov/data/metar/", openaq: "https://explore.openaq.org/" };
function resmiSatirBaglantisi(d, kaynak) {
  if (!GENEL_SAYFA[kaynak]) return null;
  const g = d.hava?.gozlem?.saglayici === kaynak ? d.hava.gozlem : kaynak === "openaq" ? (d.hava?.kalite?.istasyonlar || [])[0] : null;
  const ozel = g ? resmiSiteBaglantisi(g, { sinif: "hv-resmi-link hv-resmi-link--satir" }) : null;
  return ozel || el("a", { class: "hv-resmi-link hv-resmi-link--satir", href: GENEL_SAYFA[kaynak], target: "_blank", rel: "noopener noreferrer", "aria-label": "Resmî kaynağın sitesini aç (yeni sekmede açılır)" }, el("span", { text: kaynak === "model" ? "Open-Meteo (Copernicus CAMS) ↗" : "Resmî siteyi aç ↗" }));
}

/** Sayfanın üstündeki açılır liste. Her satır: kaynak adı · durum · son çekilme · yenile. */
export function veriDurumu(d, kb) {
  const kaynaklar = kapaliMi(d) ? ["model"] : ["model", "mgm", "metar", "openaq", "haber"];
  const satirlar = kaynaklar.map((k) => {
    const dur = durumSatiri(d, k), t = kaynakZamani(d, k);
    const yenilenebilir = k === "model" || k === "haber" ? true : dur.sinif !== "kapali";
    return el("li", { class: `hv-vd-satir ${dur.sinif}` },
      el("span", { class: "hv-vd-ikon", "aria-hidden": "true", text: IKON[k] }),
      el("span", { class: "hv-vd-metin" }, el("strong", { text: AD[k] }), el("small", { text: `${dur.yazi}${t ? ` · ${zamanYazisi(t)}` : ""}` }), resmiSatirBaglantisi(d, k)),
      yenilenebilir ? yenileDugmesi(d, kb, k, { kisa: true }) : null);
  });
  const kok = el("details", { class: "hv-veri-durumu" },
    el("summary", {}, el("span", { "aria-hidden": "true", text: "🗂️ " }), el("span", { text: "Veri durumu" }), el("small", { class: "muted", text: " · hangi veri ne zaman çekildi" })),
    el("ul", { class: "hv-vd-liste" }, ...satirlar),
    el("p", { class: "hv-ipucu", text: kapaliMi(d) ? "Veriler Open-Meteo'dan alınır. Sayfayı açtığında ve ⟳ ile yenilediğinde güncellenir." : "Her satırdaki ⟳ yalnızca o kaynağı yeniden çeker. Veriler sayfayı açtığında, konumu değiştirdiğinde ve 30 dakikada bir kendiliğinden yenilenir." }));
  kok.open = d.vdAcik === true;                                      // yenileme ekranı yeniden çizse de liste açık kalır
  kok.addEventListener("toggle", () => { d.vdAcik = kok.open; });
  return kok;
}
