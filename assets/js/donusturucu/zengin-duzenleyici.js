/*
 * assets/js/donusturucu/zengin-duzenleyici.js — Hafif, bağımlılıksız zengin metin düzenleyici (contenteditable).
 * -----------------------------------------------------------------------
 *  Neden Tiptap/Quill DEĞİL? Tiptap çalışma zamanında bir ESM bağımlılık grafiği (ProseMirror) indirir; sürüm/çift örnek
 *  sorunları ve tedarik zinciri yüzeyi büyür, Quill ise tablo düzenlemez. Bu düzenleyici: 0 harici bağımlılık, CSP uyumlu
 *  (inline stil üretmez: hizalama `align` özniteliğiyle), kendi geri al/yinele geçmişi (tablo işlemleri dahil) ve
 *  yapıştırma/bırakma içeriğini HER ZAMAN temizleyiciden geçirir.
 *  Desteklenen: başlık 1-4, paragraf, kalın/italik/altı çizili/üstü çizili, madde ve numaralı liste, alıntı, kod bloğu, bağlantı,
 *  hizalama, tablo (ekle, satır/sütun ekle-sil, tabloyu sil), görsel (gömülü), biçimi temizle, geri al/yinele, kelime sayacı.
 * -----------------------------------------------------------------------
 */
import { el, dugme, formIste, bos, baytlariOku, baytlardanDataUrl } from "./ortak.js";
import { temizHtml, yerlesikTemizle } from "./temizle.js";

const BLOKLAR = "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,div";
const MAKS_GORSEL_BAYT = 6 * 1024 * 1024;

function guvenliUrl(u) {
  const s = String(u || "").trim();
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return null;
}

function secimKaydet(kok) {
  const s = getSelection();
  if (!s.rangeCount || !kok.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0);
  const olc = (kap, ofs) => { const x = document.createRange(); x.selectNodeContents(kok); x.setEnd(kap, ofs); return x.toString().length; };
  return { bas: olc(r.startContainer, r.startOffset), son: olc(r.endContainer, r.endOffset) };
}

function secimGeriYukle(kok, k) {
  if (!k) return;
  const yaprak = document.createTreeWalker(kok, NodeFilter.SHOW_TEXT);
  let sayac = 0;
  let basN; let basO; let sonN; let sonO;
  for (let n = yaprak.nextNode(); n; n = yaprak.nextNode()) {
    const u = n.nodeValue.length;
    if (!basN && sayac + u >= k.bas) { basN = n; basO = k.bas - sayac; }
    if (!sonN && sayac + u >= k.son) { sonN = n; sonO = k.son - sayac; break; }
    sayac += u;
  }
  const r = document.createRange();
  if (basN) { r.setStart(basN, basO); r.setEnd(sonN || basN, sonN ? sonO : basO); } else { r.selectNodeContents(kok); r.collapse(false); }
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/**
 * @param {HTMLElement} kap  @param {{html:string, onDegisim?:()=>void}} secenek
 * @returns {{htmlAl:()=>Promise<string>, odak:()=>void, kirli:()=>boolean, yokEt:()=>void}}
 */
export function zenginDuzenleyiciKur(kap, { html = "", onDegisim } = {}) {
  bos(kap);
  const alan = el("div", { class: "dn-rte-alan dn-belge", contenteditable: "true", spellcheck: "true", lang: "tr", role: "textbox", "aria-multiline": "true", "aria-label": "Belge düzenleme alanı", tabindex: "0" });
  alan.innerHTML = yerlesikTemizle(html) || "<p><br></p>";
  const sayac = el("span", { class: "dn-rte-sayac", "aria-live": "off" });

  try { document.execCommand("styleWithCSS", false, false); document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* eski tarayıcı */ }

  /* ---- geçmiş ---- */
  const gecmis = [{ html: alan.innerHTML, sec: null }];
  let imlec = 0;
  let kirli = false;
  let zamanlayici = null;
  let atla = false;

  const sayaciGuncelle = () => {
    const t = alan.textContent.trim();
    const k = t ? t.split(/\s+/).length : 0;
    sayac.textContent = `${k.toLocaleString("tr-TR")} sözcük · ${t.length.toLocaleString("tr-TR")} karakter`;
  };

  function kaydet(zorla = false) {
    if (atla) return;
    const h = alan.innerHTML;
    if (!zorla && h === gecmis[imlec].html) return;
    gecmis.splice(imlec + 1);
    gecmis.push({ html: h, sec: secimKaydet(alan) });
    if (gecmis.length > 150) gecmis.shift();
    imlec = gecmis.length - 1;
    kirli = true;
    onDegisim?.();
    sayaciGuncelle();
    durumGuncelle();
  }
  const ertele = () => { clearTimeout(zamanlayici); zamanlayici = setTimeout(() => kaydet(), 350); };

  function git(yon) {
    clearTimeout(zamanlayici);
    kaydet(); // bekleyen yazımı önce kaydet
    const yeni = imlec + yon;
    if (yeni < 0 || yeni >= gecmis.length) return;
    imlec = yeni;
    atla = true;
    alan.innerHTML = gecmis[imlec].html;
    secimGeriYukle(alan, gecmis[imlec].sec || (yon < 0 ? gecmis[imlec + 1]?.sec : null));
    atla = false;
    kirli = true;
    onDegisim?.();
    sayaciGuncelle();
    durumGuncelle();
    alan.focus();
  }

  const yapisalIslem = (fn) => {
    alan.focus();
    clearTimeout(zamanlayici);
    kaydet();
    fn();
    kaydet();
  };

  /* ---- yardımcılar ---- */
  const komut = (ad, deger = null) => yapisalIslem(() => document.execCommand(ad, false, deger));

  function hucreBul() {
    const s = getSelection();
    if (!s.rangeCount) return null;
    let n = s.anchorNode;
    n = n?.nodeType === 1 ? n : n?.parentElement;
    const h = n?.closest?.("td,th");
    return h && alan.contains(h) ? h : null;
  }

  function bloklarSecim() {
    const s = getSelection();
    if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const sonuc = new Set();
    const kok = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const ekle = (n) => { const b = n?.closest?.(BLOKLAR); if (b && alan.contains(b) && b !== alan) sonuc.add(b); };
    ekle(r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
    ekle(r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement);
    if (kok && kok !== alan) kok.querySelectorAll?.(BLOKLAR).forEach((b) => { if (r.intersectsNode(b)) sonuc.add(b); });
    return [...sonuc];
  }

  function hizala(v) {
    yapisalIslem(() => {
      for (const b of bloklarSecim()) {
        if (v === "left") b.removeAttribute("align"); else b.setAttribute("align", v);
      }
    });
  }

  function tabloEkle() {
    const kayit = secimKaydet(alan);
    formIste({ baslik: "Tablo ekle", alanlar: [
      { ad: "satir", etiket: "Satır sayısı", tur: "number", deger: 3, min: 1, max: 50 },
      { ad: "sutun", etiket: "Sütun sayısı", tur: "number", deger: 3, min: 1, max: 12 },
      { ad: "baslik", etiket: "İlk satır başlık olsun", tur: "checkbox", deger: true },
    ], tamam: "Ekle" }).then((v) => {
      if (!v) return;
      const s = Math.max(1, Math.min(50, v.satir | 0));
      const c = Math.max(1, Math.min(12, v.sutun | 0));
      const satir = (th) => `<tr>${Array.from({ length: c }, () => `<${th ? "th" : "td"}><br></${th ? "th" : "td"}>`).join("")}</tr>`;
      alan.focus();
      if (kayit) secimGeriYukle(alan, kayit);
      else { const r = document.createRange(); r.selectNodeContents(alan); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }
      yapisalIslem(() => {
        const t = `<table><tbody>${v.baslik ? satir(true) : satir(false)}${Array.from({ length: s - 1 }, () => satir(false)).join("")}</tbody></table><p><br></p>`;
        document.execCommand("insertHTML", false, t);
      });
    });
  }

  function tabloIslem(tur) {
    const h = hucreBul();
    if (!h) return;
    const tr = h.parentElement;
    const tablo = h.closest("table");
    const idx = [...tr.children].indexOf(h);
    yapisalIslem(() => {
      const yeniHucre = (src) => { const d = document.createElement(src && src.localName === "th" && tr.parentElement.localName !== "tbody" ? "th" : "td"); d.innerHTML = "<br>"; return d; };
      if (tur === "satir-ust" || tur === "satir-alt") {
        const y = document.createElement("tr");
        for (let i = 0; i < tr.children.length; i++) { const d = document.createElement("td"); d.innerHTML = "<br>"; y.append(d); }
        tr.parentElement.insertBefore(y, tur === "satir-ust" ? tr : tr.nextSibling);
      } else if (tur === "sutun-sol" || tur === "sutun-sag") {
        for (const r of tablo.rows) {
          const kaynak = r.children[idx];
          const d = document.createElement(kaynak?.localName === "th" ? "th" : "td");
          d.innerHTML = "<br>";
          r.insertBefore(d, tur === "sutun-sol" ? kaynak || null : (kaynak?.nextSibling || null));
        }
      } else if (tur === "satir-sil") {
        if (tablo.rows.length <= 1) tablo.remove(); else tr.remove();
      } else if (tur === "sutun-sil") {
        if (tr.children.length <= 1) tablo.remove(); else for (const r of [...tablo.rows]) r.children[idx]?.remove();
      } else if (tur === "tablo-sil") tablo.remove();
      if (!alan.firstChild) alan.innerHTML = "<p><br></p>";
    });
  }

  async function baglantiEkle() {
    const secimMetni = getSelection().toString();
    const kayit = secimKaydet(alan);
    const v = await formIste({ baslik: "Bağlantı ekle", alanlar: [{ ad: "url", etiket: "Adres (https://…, mailto:, tel:)", tur: "text", yerTutucu: "https://ornek.com" }, ...(secimMetni ? [] : [{ ad: "metin", etiket: "Bağlantı metni", tur: "text" }])], tamam: "Ekle" });
    if (!v) return;
    const url = guvenliUrl(v.url);
    if (!url) { await formIste({ baslik: "Geçersiz adres", aciklama: "Yalnızca http, https, mailto, tel ve # bağlantıları kabul edilir.", alanlar: [], tamam: "Tamam" }); return; }
    alan.focus();
    secimGeriYukle(alan, kayit);
    yapisalIslem(() => {
      if (secimMetni) document.execCommand("createLink", false, url);
      else document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${(v.metin || url).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</a>`);
    });
  }

  async function gorselEkle(dosya) {
    if (!dosya || !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(dosya.type)) return;
    if (dosya.size > MAKS_GORSEL_BAYT) { await formIste({ baslik: "Görsel çok büyük", aciklama: "En fazla 6 MB'lık görsel eklenebilir.", alanlar: [], tamam: "Tamam" }); return; }
    const url = baytlardanDataUrl(new Uint8Array(await baytlariOku(dosya)), dosya.type);
    alan.focus();
    yapisalIslem(() => document.execCommand("insertHTML", false, `<img src="${url}" alt="${(dosya.name || "görsel").replace(/[<>&"]/g, "")}">`));
  }

  /* ---- araç çubuğu ---- */
  const dugmeler = {};
  const B = (id, etiket, ikon, eylem, baslik) => {
    const d = dugme({ ikon, metin: etiket, kucuk: true, tur: "hayalet", "aria-label": baslik, title: baslik, class: "dn-ar" });
    d.addEventListener("mousedown", (e) => e.preventDefault()); // seçimi kaybetme
    d.addEventListener("click", eylem);
    dugmeler[id] = d;
    return d;
  };
  const grup = (...c) => el("div", { class: "dn-arac-grup", role: "group" }, ...c);

  const blokSecici = el("select", { class: "dn-select dn-select--kucuk", "aria-label": "Blok biçimi" },
    ...[["p", "Paragraf"], ["h1", "Başlık 1"], ["h2", "Başlık 2"], ["h3", "Başlık 3"], ["h4", "Başlık 4"], ["blockquote", "Alıntı"], ["pre", "Kod bloğu"]].map(([d, e]) => el("option", { value: d, text: e })));
  blokSecici.addEventListener("change", () => { yapisalIslem(() => document.execCommand("formatBlock", false, blokSecici.value)); });

  const tabloMenu = el("select", { class: "dn-select dn-select--kucuk", "aria-label": "Tablo işlemleri", disabled: true },
    el("option", { value: "", text: "Tablo işlemi…" }),
    ...[["satir-ust", "Üste satır ekle"], ["satir-alt", "Alta satır ekle"], ["sutun-sol", "Sola sütun ekle"], ["sutun-sag", "Sağa sütun ekle"], ["satir-sil", "Satırı sil"], ["sutun-sil", "Sütunu sil"], ["tablo-sil", "Tabloyu sil"]].map(([d, e]) => el("option", { value: d, text: e })));
  tabloMenu.addEventListener("change", () => { const v = tabloMenu.value; tabloMenu.value = ""; if (v) tabloIslem(v); });

  const gorselGirdi = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp", hidden: true });
  gorselGirdi.addEventListener("change", () => { gorselEkle(gorselGirdi.files[0]); gorselGirdi.value = ""; });

  const cubuk = el("div", { class: "dn-arac-cubugu", role: "toolbar", "aria-label": "Biçimlendirme araçları" },
    grup(B("geri", "", "↶", () => git(-1), "Geri al (Ctrl+Z)"), B("ileri", "", "↷", () => git(1), "Yinele (Ctrl+Y)")),
    grup(blokSecici),
    grup(B("b", "", "B", () => komut("bold"), "Kalın (Ctrl+B)"), B("i", "", "I", () => komut("italic"), "İtalik (Ctrl+I)"), B("u", "", "U", () => komut("underline"), "Altı çizili (Ctrl+U)"), B("s", "", "S̶", () => komut("strikeThrough"), "Üstü çizili")),
    grup(B("ul", "", "• ", () => komut("insertUnorderedList"), "Madde işaretli liste"), B("ol", "", "1.", () => komut("insertOrderedList"), "Numaralı liste")),
    grup(B("sol", "", "⇤", () => hizala("left"), "Sola hizala"), B("orta", "", "↔", () => hizala("center"), "Ortala"), B("sag", "", "⇥", () => hizala("right"), "Sağa hizala"), B("iki", "", "☰", () => hizala("justify"), "İki yana yasla")),
    grup(B("link", "", "🔗", baglantiEkle, "Bağlantı ekle"), B("gorsel", "", "🖼", () => gorselGirdi.click(), "Görsel ekle"), B("tablo", "", "▦", tabloEkle, "Tablo ekle"), tabloMenu),
    grup(B("temiz", "", "⌫", () => komut("removeFormat"), "Biçimi temizle")),
    gorselGirdi);

  function durumGuncelle() {
    dugmeler.geri.disabled = imlec <= 0;
    dugmeler.ileri.disabled = imlec >= gecmis.length - 1;
    for (const [id, c] of [["b", "bold"], ["i", "italic"], ["u", "underline"], ["s", "strikeThrough"], ["ul", "insertUnorderedList"], ["ol", "insertOrderedList"]]) {
      let a = false;
      try { a = document.queryCommandState(c); } catch { /* yok say */ }
      dugmeler[id].setAttribute("aria-pressed", String(a));
    }
    tabloMenu.disabled = !hucreBul();
    const blok = bloklarSecim()[0];
    if (blok) { const ad = blok.localName; if (["p", "h1", "h2", "h3", "h4", "blockquote", "pre"].includes(ad)) blokSecici.value = ad; }
  }

  /* ---- olaylar ---- */
  alan.addEventListener("input", () => { ertele(); });
  alan.addEventListener("keyup", durumGuncelle);
  alan.addEventListener("mouseup", durumGuncelle);
  const secimDinle = () => { if (document.activeElement === alan) durumGuncelle(); };
  document.addEventListener("selectionchange", secimDinle);

  alan.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); git(-1); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); git(1); }
    }
  });
  alan.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo") { e.preventDefault(); git(-1); }
    else if (e.inputType === "historyRedo") { e.preventDefault(); git(1); }
  });

  // YAPIŞTIR: içerik her zaman temizleyiciden geçer; dosya (görsel) varsa görsel eklenir.
  alan.addEventListener("paste", async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const dosya = [...(cd.files || [])].find((f) => f.type.startsWith("image/"));
    e.preventDefault();
    if (dosya) { await gorselEkle(dosya); return; }
    const h = cd.getData("text/html");
    if (h) {
      const t = await temizHtml(h);
      document.execCommand("insertHTML", false, t);
    } else document.execCommand("insertText", false, cd.getData("text/plain"));
    ertele();
  });
  // BIRAK: dışarıdan gelen ham HTML'in sayfaya girmesini engelle
  alan.addEventListener("drop", async (e) => {
    e.preventDefault();
    const dosya = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (dosya) { await gorselEkle(dosya); return; }
    const m = e.dataTransfer?.getData("text/plain");
    if (m) { alan.focus(); document.execCommand("insertText", false, m); ertele(); }
  });
  alan.addEventListener("dragstart", (e) => e.preventDefault());

  kap.append(el("div", { class: "dn-editor dn-rte" }, cubuk, alan, el("div", { class: "dn-editor-alt" }, sayac)));
  sayaciGuncelle();
  durumGuncelle();

  return {
    /** Temizlenmiş, güvenli HTML (gövde içeriği). */
    async htmlAl() { clearTimeout(zamanlayici); kaydet(); return temizHtml(alan.innerHTML); },
    odak() { alan.focus(); },
    kirli: () => kirli,
    yokEt() { clearTimeout(zamanlayici); document.removeEventListener("selectionchange", secimDinle); bos(kap); },
  };
}
