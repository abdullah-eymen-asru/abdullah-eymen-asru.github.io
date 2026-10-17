/**
 * ui-temel.js — HavaStil arayüz yapı taşları. CSP uyumu: innerHTML YOK, satır içi stil/olay YOK; metinler textContent ile basılır
 * (dış kaynaklı konum adı/haber başlığı güvenle gösterilir). Dinamik ölçüler CSSOM (el.style.x = …) ile verilir; bu CSP'de serbesttir.
 */
import { tarayiciTespit, braveMi, izinAdimlari, digerTarayicilar, TARAYICI_ADLARI } from "./izin-yardim.js";

export const el = (e, oz = {}, ...c) => {
  const d = document.createElement(e);
  for (const [k, v] of Object.entries(oz)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v; else if (k === "text") d.textContent = v; else d.setAttribute(k, v === true ? "" : v);
  }
  for (const x of c.flat()) if (x != null && x !== false) d.append(x);
  return d;
};
export const svgEl = (tag, oz = {}, ...c) => {
  const d = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(oz)) if (v != null) d.setAttribute(k, v);
  for (const x of c.flat()) if (x != null) d.append(x);
  return d;
};
export const olay = (n, ev, fn) => { n.addEventListener(ev, fn); return n; };
export const lsOku = (k, v) => { try { const x = JSON.parse(localStorage.getItem(k)); return x ?? v; } catch { return v; } };
export const lsYaz = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depo kapalı */ } };
export const gec = (ms) => new Promise((r) => setTimeout(r, ms));
export const bosalt = (n) => { n.replaceChildren(); return n; };
/** Gerçek DOM'da append(null) ekrana "null" yazar; bu yardımcılar null/false'ları atar. */
const temizCocuk = (c) => c.flat().filter((x) => x != null && x !== false);
export const ekle = (n, ...c) => { n.append(...temizCocuk(c)); return n; };
export const doldur = (n, ...c) => { n.replaceChildren(...temizCocuk(c)); return n; };

export const rozet = (metin, sinif = "") => el("span", { class: `hv-rozet ${sinif}`.trim(), text: metin });
export const etiket = (metin) => el("span", { class: "hv-etiket", text: metin });
export const ipucu = (metin) => el("p", { class: "hv-ipucu", text: metin });

export function zamanOnce(ms) {
  const dk = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return dk < 1 ? "az önce" : dk < 60 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} sa önce` : `${Math.round(dk / 1440)} gün önce`;
}
export const isoZamanOnce = (iso) => zamanOnce(Date.parse(iso));

/** Çip grubu (segmented): tek seçim. @param {Array<[any,string]>} secenekler */
export function cipGrubu({ baslik, secenekler, aktif, onSec, kucuk = false }) {
  const kutu = el("div", { class: `hv-cipgrup${kucuk ? " hv-cipgrup-kucuk" : ""}`, role: "group", "aria-label": baslik });
  const ciz = () => kutu.replaceChildren(...secenekler.map(([deger, metin]) => {
    const b = el("button", { type: "button", class: "hv-cip-btn", "aria-pressed": String(aktif() === deger), text: metin });
    b.addEventListener("click", () => { onSec(deger); ciz(); });
    return b;
  }));
  ciz();
  return { kok: el("div", { class: "hv-cipblok" }, baslik ? etiket(baslik) : null, kutu), ciz };
}

export function kart(sinif, ...c) { return el("section", { class: `hv-kart ${sinif || ""}`.trim() }, ...c); }
export function bolumBasligi(metin, sag) { return el("div", { class: "hv-bolum-ust" }, el("h2", { text: metin }), sag || null); }

/** Küçük gösterge çubuğu (UV, AQI vb.) — değer 0..1 arası oran */
export function olcek(oran, sinif = "d1") {
  const ic = el("span", { class: `hv-olcek-ic ${sinif}` });
  ic.style.width = `${Math.round(Math.min(1, Math.max(0.04, oran)) * 100)}%`;
  return el("span", { class: "hv-olcek" }, ic);
}

/**
 * "ⓘ İzin nasıl açılır?" kartı — kullanıcının KENDİ tarayıcısına/cihazına özel adımlar önde, diğerleri açılır listede.
 * @param {"konum"|"bildirim"} konu
 */
export function izinYardimKarti(konu, { acik = true, mesaj = "" } = {}) {
  const t = tarayiciTespit();
  const kutu = el("details", { class: "hv-yardim", open: acik });
  kutu.append(el("summary", { text: `ⓘ ${konu === "konum" ? "Konum" : "Bildirim"} izni nasıl açılır?` }));
  const doldur = (tarayici) => {
    const a = izinAdimlari(konu, tarayici, t.os);
    const govde = el("div", { class: "hv-yardim-govde" });
    if (mesaj) govde.append(el("p", { class: "hv-uyari", text: mesaj }));
    govde.append(el("p", { class: "hv-yardim-baslik", text: `Senin cihazın: ${TARAYICI_ADLARI[tarayici] || "Tarayıcı"} · ${a.baslik.split("(")[1]?.replace(")", "") || ""}` }));
    govde.append(el("ol", { class: "hv-adimlar" }, ...a.adimlar.map((x) => el("li", { text: x }))));
    if (a.osNotu) govde.append(el("p", { class: "hv-ipucu", text: `🖥️ ${a.osNotu}` }));
    if (konu === "bildirim" && t.os === "ios" && !t.standalone) govde.append(el("p", { class: "hv-uyari", text: "iPhone/iPad'de bildirim için önce uygulamayı Ana Ekrana eklemelisin." }));
    return govde;
  };
  let sabit = doldur(t.ad);
  kutu.append(sabit);
  // Brave kendini UA'da gizler → asenkron düzelt
  braveMi().then((b) => { if (b) { const y = doldur("brave"); sabit.replaceWith(y); sabit = y; } });
  const dig = el("details", { class: "hv-yardim-diger" }, el("summary", { text: "Diğer tarayıcılar için adımlar" }),
    ...digerTarayicilar(konu, t.ad, t.os).map((x) => el("div", { class: "hv-yardim-blok" }, el("strong", { text: TARAYICI_ADLARI[x.id] }), el("ol", { class: "hv-adimlar" }, ...x.adimlar.map((s) => el("li", { text: s }))))));
  kutu.append(dig);
  return kutu;
}

/** Saatlik grafik: sıcaklık (çizgi), hissedilen (kesikli), yağış olasılığı (çubuk). SVG, bağımlılık yok. */
export function saatlikGrafik(saatler, { yukseklik = 170 } = {}) {
  const W = 720, H = yukseklik, sol = 30, sag = 8, ust = 14, alt = 26;
  const n = saatler.length;
  if (n < 2) return el("div");
  const isi = saatler.flatMap((s) => [s.temp, s.app]);
  const mn = Math.floor(Math.min(...isi) - 1), mx = Math.ceil(Math.max(...isi) + 1);
  const x = (i) => sol + (i / (n - 1)) * (W - sol - sag);
  const y = (v) => ust + (1 - (v - mn) / (mx - mn || 1)) * (H - ust - alt);
  const yol = (anah) => saatler.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[anah]).toFixed(1)}`).join(" ");
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "hv-grafik", role: "img", "aria-label": "Saatlik sıcaklık ve yağış grafiği" });
  // yatay kılavuz
  for (let v = Math.ceil(mn / 5) * 5; v <= mx; v += 5) svg.append(svgEl("line", { x1: sol, x2: W - sag, y1: y(v), y2: y(v), class: "hv-g-kilavuz" }), svgEl("text", { x: 2, y: y(v) + 4, class: "hv-g-metin" }, document.createTextNode(`${v}°`)));
  // yağış çubukları
  const bw = Math.max(3, (W - sol - sag) / n - 3);
  saatler.forEach((s, i) => { if (s.yagisOlasi > 0) { const h = (s.yagisOlasi / 100) * (H - ust - alt) * 0.55; svg.append(svgEl("rect", { x: x(i) - bw / 2, y: H - alt - h, width: bw, height: h, class: "hv-g-yagis" })); } });
  svg.append(svgEl("path", { d: yol("app"), class: "hv-g-hissedilen" }), svgEl("path", { d: yol("temp"), class: "hv-g-sicaklik" }));
  saatler.forEach((s, i) => { if (i % Math.max(1, Math.round(n / 8)) === 0) svg.append(svgEl("text", { x: x(i), y: H - 8, class: "hv-g-metin hv-g-orta" }, document.createTextNode(`${String(s.saat).padStart(2, "0")}`))); });
  return svg;
}
