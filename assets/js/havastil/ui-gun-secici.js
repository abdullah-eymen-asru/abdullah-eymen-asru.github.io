/**
 * ui-gun-secici.js — Ortak GÜN SEÇİCİ (v6): 16 güne kadar tek bakışta, yatay kaydırma OLMADAN.
 *  • Izgara: dar ekranda 4 sütun × 4 satır, geniş ekranda 8 × 2 → tüm günler aynı anda görünür (kaydırmak/aramak gerekmez).
 *  • Üstte ‹ Önceki / Sonraki › düğmeleri + "Salı · 21.10 · 3/16" etiketi; günlük hızlı atlama: Bugün, +7.
 *  • Klavye: ← → (±1 gün), ↑ ↓ (±1 satır), Home/End, PageUp/PageDown (±7). Seçim sonrası odak korunur (sekme yeniden çizilse de).
 *  • Erişilebilirlik: her gün bir düğme (aria-pressed), seçili gün aria-current; düğme boyutu ≥ 44 px dokunma hedefi.
 *  • Saf DOM; satır içi stil yok (CSP). Veri/seçim durumu çağıranda: onSec(i) çağrılır, çağıran yeniden çizer.
 */
import { el, olay } from "./ui-temel.js";
import { gunAdi } from "./hava-kodlari.js";

let odakIste = false;                    // klavyeyle seçim yapıldıysa bir sonraki çizimde odak seçili güne taşınır
const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const kisaGun = (t, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(t).slice(0, 3));
const uzunGun = (t, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(t));
const tarihKisa = (t) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const tarihUzun = (t) => `${Number(t.slice(8, 10))} ${AY_KISA[Number(t.slice(5, 7)) - 1]}`;

/**
 * @param {{gunler:{tarih:string, alt?:string, noktalar?:{sinif:string,baslik:string}[], baslik?:string}[], aktif:number, onSec:(i:number)=>void, etiket?:string}} o
 */
export function gunIzgarasi({ gunler, aktif, onSec, etiket = "Gün seç" }) {
  const n = gunler.length;
  const git = (i, klavye = false) => { const j = Math.max(0, Math.min(n - 1, i)); if (j === aktif) return; odakIste = klavye; onSec(j); };

  const onceki = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-gun-ok", "aria-label": "Önceki gün", disabled: aktif <= 0 }, el("span", { "aria-hidden": "true", text: "‹" })), "click", () => git(aktif - 1));
  const sonraki = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-gun-ok", "aria-label": "Sonraki gün", disabled: aktif >= n - 1 }, el("span", { "aria-hidden": "true", text: "›" })), "click", () => git(aktif + 1));
  const G = gunler[aktif];
  const baslik = el("div", { class: "hv-gun-baslik", role: "status", "aria-live": "polite" },
    el("strong", { text: `${uzunGun(G.tarih, aktif)} · ${tarihUzun(G.tarih)}` }), el("small", { text: `${aktif + 1} / ${n}. gün` }));
  const hizli = el("div", { class: "hv-gun-hizli" },
    olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Bugün", disabled: aktif === 0 }), "click", () => git(0)),
    n > 7 ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "+7 gün", disabled: aktif + 7 > n - 1 }), "click", () => git(aktif + 7)) : null,
    n > 8 ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Son gün", disabled: aktif === n - 1 }), "click", () => git(n - 1)) : null);

  const dugmeler = gunler.map((g, i) => olay(el("button", {
    type: "button", class: `hv-gun-chip${i === aktif ? " secili" : ""}${i === 0 ? " bugun" : ""}`, "aria-pressed": String(i === aktif), "aria-current": i === aktif ? "date" : null,
    title: g.baslik || `${uzunGun(g.tarih, i)} ${tarihKisa(g.tarih)}`, tabindex: i === aktif ? "0" : "-1",
  }, el("strong", { text: kisaGun(g.tarih, i) }), el("small", { text: tarihKisa(g.tarih) }),
  g.alt ? el("span", { class: "hv-gun-chip-alt", text: g.alt }) : null,
  g.noktalar?.length ? el("span", { class: "hv-gunchip-nokta" }, ...g.noktalar.map((p) => el("i", { class: p.sinif, title: p.baslik }))) : null), "click", () => git(i)));

  const izgara = el("div", { class: "hv-gun-izgara", role: "group", "aria-label": etiket }, ...dugmeler);
  olay(izgara, "keydown", (e) => {
    const sutun = window.matchMedia?.("(min-width: 640px)").matches ? 8 : 4;
    const adim = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -sutun, ArrowDown: sutun, PageUp: -7, PageDown: 7 }[e.key];
    if (adim != null) { e.preventDefault(); git(aktif + adim, true); }
    else if (e.key === "Home") { e.preventDefault(); git(0, true); }
    else if (e.key === "End") { e.preventDefault(); git(n - 1, true); }
  });

  const kok = el("div", { class: "hv-gun-secici" }, el("div", { class: "hv-gun-ust" }, onceki, baslik, sonraki), izgara, hizli);
  if (odakIste) { odakIste = false; requestAnimationFrame(() => dugmeler[aktif]?.focus({ preventScroll: true })); }
  return kok;
}
