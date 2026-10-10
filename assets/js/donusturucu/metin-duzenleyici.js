/*
 * assets/js/donusturucu/metin-duzenleyici.js — Markdown / düz metin / kod / veri (CSV-JSON-XML) düzenleyici.
 *  - Üst üste bindirme tekniği: şeffaf <textarea> + arkasında vurgulu <pre>; kaydırma ve ölçüler eşitlenir.
 *  - Biçimler: Düzenle | Böl | Önizle (md & html için canlı, temizlenmiş önizleme; csv için tablo; json/xml için doğrulama).
 *  - Çok büyük metinlerde (>250 bin karakter) vurgulama kapanır (donmayı önlemek için).
 */
import { el, dugme, bos } from "./ortak.js";
import { vurgula } from "./vurgu.js";
import { mdDenHtml } from "./belge-oku.js";
import { temizHtml, metinDenHtml } from "./temizle.js";
import { csvAyristir } from "./motor-veri.js";

const VURGU_SINIRI = 250_000;

/**
 * @param {HTMLElement} kap
 * @param {{metin:string, tur:string, dil:string, onDegisim?:()=>void}} s  tur: md|txt|csv|json|xml|html
 */
export function metinDuzenleyiciKur(kap, { metin = "", tur = "txt", dil = "duz", onDegisim } = {}) {
  bos(kap);
  const onizlemeVar = tur === "md" || tur === "csv" || tur === "json" || tur === "xml";
  const ta = el("textarea", { class: "dn-kod-girdi", spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "soft", "aria-label": "Metin düzenleme alanı" });
  ta.value = metin;
  const kod = el("code", { class: "dn-kod-kod" });
  const pre = el("pre", { class: "dn-kod-vurgu", "aria-hidden": "true" }, kod);
  const kutu = el("div", { class: "dn-kod" }, pre, ta);
  const onizleme = el("div", { class: "dn-onizleme dn-belge", tabindex: "0", "aria-label": "Önizleme" });
  const durum = el("span", { class: "dn-editor-durum", role: "status" });
  let gorunum = onizlemeVar ? "bol" : "duzenle";
  let kirli = false;
  let bekleyen = 0;
  let satirKaydir = true;

  const alanlar = el("div", { class: `dn-metin-alanlar dn-gorunum-${gorunum}` }, kutu, onizleme);

  function vurguYenile() {
    const v = ta.value;
    if (v.length > VURGU_SINIRI) { kod.textContent = `${v}\n`; return; }
    kod.innerHTML = `${vurgula(dil, v)}\n`; // vurgula() her metni HTML-kaçışlar
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  let onizlemeZamani = 0;
  async function onizlemeYenile() {
    if (!onizlemeVar || gorunum === "duzenle") return;
    const v = ta.value;
    try {
      if (tur === "md") { onizleme.innerHTML = await mdDenHtml(v); durum.textContent = ""; }
      else if (tur === "csv") {
        const sat = csvAyristir(v).slice(0, 200);
        const t = el("table", {}, ...sat.map((r, i) => el("tr", {}, ...r.map((h) => el(i === 0 ? "th" : "td", { text: h })))));
        bos(onizleme); onizleme.append(t);
        durum.textContent = `${csvAyristir(v).length.toLocaleString("tr-TR")} satır${sat.length >= 200 ? " (ilk 200 gösteriliyor)" : ""}`;
      } else if (tur === "json") {
        bos(onizleme);
        try { JSON.parse(v); onizleme.append(el("p", { class: "dn-iyi", text: "✓ Geçerli JSON" })); durum.textContent = "Geçerli JSON"; }
        catch (h) { onizleme.append(el("p", { class: "dn-hata-metin", text: `✗ ${h.message}` })); durum.textContent = "Geçersiz JSON"; }
      } else if (tur === "xml") {
        bos(onizleme);
        const d = new DOMParser().parseFromString(v, "application/xml");
        const hata = d.getElementsByTagName("parsererror")[0];
        onizleme.append(hata ? el("p", { class: "dn-hata-metin", text: `✗ ${hata.textContent.replace(/\s+/g, " ").trim().slice(0, 240)}` }) : el("p", { class: "dn-iyi", text: "✓ Geçerli XML" }));
        durum.textContent = hata ? "Geçersiz XML" : "Geçerli XML";
      }
    } catch (h) { bos(onizleme); onizleme.append(el("p", { class: "dn-hata-metin", text: h.message })); }
  }

  const sayacGuncelle = () => {
    const v = ta.value;
    sayac.textContent = `${v.split("\n").length.toLocaleString("tr-TR")} satır · ${v.length.toLocaleString("tr-TR")} karakter`;
  };

  function degisti() {
    kirli = true;
    onDegisim?.();
    vurguYenile();
    sayacGuncelle();
    cancelAnimationFrame(bekleyen);
    clearTimeout(onizlemeZamani);
    onizlemeZamani = setTimeout(onizlemeYenile, 250);
  }

  ta.addEventListener("input", degisti);
  ta.addEventListener("scroll", () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });

  // Sekme tuşu: girinti (Esc → bir sonraki Tab odağı bırakır; klavye tuzağı olmasın)
  let sekmeSerbest = false;
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { sekmeSerbest = true; return; }
    if (e.key !== "Tab" || sekmeSerbest) { if (e.key !== "Tab") sekmeSerbest = false; else sekmeSerbest = false; return; }
    e.preventDefault();
    const b = ta.selectionStart;
    const s = ta.selectionEnd;
    const v = ta.value;
    if (e.shiftKey) {
      const satirBas = v.lastIndexOf("\n", b - 1) + 1;
      if (v.slice(satirBas, satirBas + 2) === "  ") {
        ta.setRangeText("", satirBas, satirBas + 2, "preserve");
        ta.selectionStart = Math.max(satirBas, b - 2); ta.selectionEnd = Math.max(satirBas, s - 2);
        degisti();
      }
      return;
    }
    ta.setRangeText("  ", b, s, "end");
    degisti();
  });
  ta.addEventListener("blur", () => { sekmeSerbest = false; });

  /* ---- araç çubuğu ---- */
  const gorunumDugmeleri = {};
  const gorunumSec = (g) => {
    gorunum = g;
    alanlar.className = `dn-metin-alanlar dn-gorunum-${g}`;
    for (const [k, d] of Object.entries(gorunumDugmeleri)) d.setAttribute("aria-pressed", String(k === g));
    onizlemeYenile();
  };
  const gorunumGrup = onizlemeVar ? el("div", { class: "dn-arac-grup", role: "group", "aria-label": "Görünüm" },
    ...[["duzenle", "Düzenle"], ["bol", "Böl"], ["onizle", "Önizle"]].map(([k, e]) => {
      const d = dugme({ metin: e, kucuk: true, tur: "hayalet", "aria-pressed": String(k === gorunum) });
      d.addEventListener("click", () => gorunumSec(k));
      gorunumDugmeleri[k] = d;
      return d;
    })) : null;

  const sarma = dugme({ metin: "Satır kaydır", kucuk: true, tur: "hayalet", "aria-pressed": "true" });
  sarma.addEventListener("click", () => {
    satirKaydir = !satirKaydir;
    kutu.classList.toggle("dn-kod--sarma-yok", !satirKaydir);
    ta.setAttribute("wrap", satirKaydir ? "soft" : "off");
    sarma.setAttribute("aria-pressed", String(satirKaydir));
    vurguYenile();
  });

  const bicimle = (tur === "json" || tur === "xml") ? dugme({ metin: "Biçimlendir", kucuk: true, tur: "hayalet", title: "Girintileri düzenle" }) : null;
  bicimle?.addEventListener("click", () => {
    try {
      if (tur === "json") ta.value = `${JSON.stringify(JSON.parse(ta.value), null, 2)}\n`;
      else {
        const d = new DOMParser().parseFromString(ta.value, "application/xml");
        if (d.getElementsByTagName("parsererror")[0]) throw new Error("XML geçersiz; önce hatayı düzelt.");
        ta.value = girintiliXml(d);
      }
      degisti();
    } catch (h) { durum.textContent = h.message; }
  });

  const sayac = el("span", { class: "dn-rte-sayac" });
  const cubuk = el("div", { class: "dn-arac-cubugu", role: "toolbar", "aria-label": "Metin araçları" },
    gorunumGrup, el("div", { class: "dn-arac-grup" }, sarma, bicimle));

  kap.append(el("div", { class: "dn-editor dn-metin" }, cubuk, alanlar, el("div", { class: "dn-editor-alt" }, sayac, durum)));
  vurguYenile();
  sayacGuncelle();
  if (onizlemeVar) onizlemeYenile();

  return {
    metinAl: () => ta.value,
    /** HTML pivotu (md önizleme mantığıyla) — pdf/docx/epub dışa aktarma için. */
    async htmlAl() {
      const v = ta.value;
      if (tur === "md") return mdDenHtml(v);
      if (tur === "html") return temizHtml(v);
      return metinDenHtml(v);
    },
    odak: () => ta.focus(),
    kirli: () => kirli,
    yokEt() { clearTimeout(onizlemeZamani); bos(kap); },
  };
}

function girintiliXml(doc) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const attr = (e) => [...e.attributes].map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`).join("");
  const git = (e, d) => {
    const g = "  ".repeat(d);
    const cocuk = [...e.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()) || c.nodeType === 4);
    if (!cocuk.length) { out.push(`${g}<${e.nodeName}${attr(e)}/>`); return; }
    if (cocuk.every((c) => c.nodeType !== 1)) { out.push(`${g}<${e.nodeName}${attr(e)}>${esc(e.textContent.trim())}</${e.nodeName}>`); return; }
    out.push(`${g}<${e.nodeName}${attr(e)}>`);
    for (const c of cocuk) { if (c.nodeType === 1) git(c, d + 1); else out.push(`${g}  ${esc(c.nodeValue.trim())}`); }
    out.push(`${g}</${e.nodeName}>`);
  };
  git(doc.documentElement, 0);
  return `${out.join("\n")}\n`;
}
