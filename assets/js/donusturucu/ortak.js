/*
 * assets/js/donusturucu/ortak.js — Evrensel Dönüştürücü & Belge Düzenleyici ortak yardımcıları.
 * -----------------------------------------------------------------------
 *  - innerHTML YOK, inline stil/olay YOK (CSP): DOM yalnızca el() ile kurulur; dinamik boyutlar CSSOM ile.
 *  - Bellek yönetimi: oluşturulan HER blob URL'si bu dosyadaki kayıt defterinden geçer ve
 *    indirme/kapatma sonrası URL.revokeObjectURL ile serbest bırakılır (gizlilik + RAM).
 *  - Bu dosya Supabase'e / ağa DOKUNMAZ: dosya içeriği hiçbir koşulda buradan dışarı çıkmaz.
 * -----------------------------------------------------------------------
 */

export function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler || {})) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of cocuklar.flat()) if (c != null && c !== false) d.append(c);
  return d;
}

export const bos = (d) => d.replaceChildren();

/* ------------------------------ dosya adı yardımcıları ------------------------------ */

export function uzantiAl(ad) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(ad || ""));
  return m ? m[1].toLowerCase() : "";
}

export function adsizAl(ad) {
  const s = String(ad || "belge").replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return s || "belge";
}

/** Dosya adı güvenliği: yol ayırıcıları, kontrol karakterleri ve Windows'un yasakladıkları atılır. */
export function dosyaAdiTemizle(ad, yedek = "belge") {
  let s = String(ad || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  if (!s) s = yedek;
  return s.slice(0, 120);
}

export function bayt(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  const b = ["KB", "MB", "GB"];
  let v = x / 1024;
  let i = 0;
  while (v >= 1024 && i < b.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${b[i]}`;
}

export const bugunDamga = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ------------------------------ asenkron yardımcılar ------------------------------ */

/** Tarayıcıya nefes aldırır: uzun işlemler arasında arayüz donmasın, ilerleme çubuğu çizilsin. */
export const nefes = () => new Promise((coz) => setTimeout(coz, 0));

export class IptalHatasi extends Error {
  constructor(m = "İşlem iptal edildi.") { super(m); this.name = "IptalHatasi"; }
}

/** İptal edilebilir iş bağlamı: { sinyal, ilerle(oran, metin), iptal() }. */
export function isBaglami(ilerlemeCb = () => {}) {
  let iptalEdildi = false;
  return {
    get iptalEdildi() { return iptalEdildi; },
    iptal() { iptalEdildi = true; },
    kontrol() { if (iptalEdildi) throw new IptalHatasi(); },
    ilerle(oran, metin) { ilerlemeCb(Math.max(0, Math.min(1, oran)), metin || ""); },
  };
}

/* ------------------------------ bellek / indirme ------------------------------ */

const AKTIF_URLLER = new Set();

export function urlOlustur(blob) {
  const u = URL.createObjectURL(blob);
  AKTIF_URLLER.add(u);
  return u;
}

export function urlSerbest(u) {
  if (!u) return;
  try { URL.revokeObjectURL(u); } catch { /* yok say */ }
  AKTIF_URLLER.delete(u);
}

export function tumUrlleriSerbestBirak() {
  for (const u of [...AKTIF_URLLER]) urlSerbest(u);
}

export const aktifUrlSayisi = () => AKTIF_URLLER.size;

/**
 * Blob'u indirir ve URL'yi serbest bırakır. Revoke, tıklamadan hemen sonra yapılırsa bazı tarayıcılarda
 * (Safari/Firefox) indirme başlamadan iptal olabilir; bu yüzden kısa bir gecikmeyle yapılır.
 */
export function indir(blob, ad) {
  const u = urlOlustur(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = dosyaAdiTemizle(ad, "indirilen-dosya");
  a.rel = "noopener";
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => urlSerbest(u), 4000);
}

/* ------------------------------ ilerleme çubuğu ------------------------------ */

/** Yerel <progress> öğesi: inline stil gerektirmez (CSP), erişilebilir. */
export function ilerlemeCubugu() {
  const bar = el("progress", { class: "dn-ilerleme-bar", max: "100", value: "0", "aria-label": "İşlem ilerlemesi" });
  const metin = el("span", { class: "dn-ilerleme-metin", role: "status", "aria-live": "polite" });
  const kap = el("div", { class: "dn-ilerleme", hidden: true }, bar, metin);
  return {
    el: kap,
    goster(m = "") { kap.hidden = false; metin.textContent = m; },
    ayarla(oran, m) {
      kap.hidden = false;
      if (oran == null) bar.removeAttribute("value");
      else bar.value = Math.round(Math.max(0, Math.min(1, oran)) * 100);
      if (m != null) metin.textContent = m;
    },
    gizle() { kap.hidden = true; bar.value = 0; metin.textContent = ""; },
  };
}

/* ------------------------------ düğme + diyaloglar ------------------------------ */

export function dugme({ metin, tur = "ikincil", kucuk = false, ikon, ...oz } = {}) {
  const sinif = `dn-btn dn-btn--${tur}${kucuk ? " dn-btn--kucuk" : ""}${oz.class ? ` ${oz.class}` : ""}`;
  const { class: _s, ...kalan } = oz;
  const b = el("button", { type: "button", ...kalan, class: sinif });
  if (ikon) b.append(el("span", { class: "dn-btn-ikon", "aria-hidden": "true", text: ikon }));
  if (metin) b.append(el("span", { class: "dn-btn-metin", text: metin }));
  return b;
}

function dialogDestekli() {
  return typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal === "function";
}

/** window.confirm yerine uygulama içi onay (<dialog>). */
export function onayIste({ baslik, metin, tamam = "Onayla", vazgec = "Vazgeç", tehlike = false }) {
  if (!dialogDestekli()) return Promise.resolve(window.confirm(`${baslik}\n\n${metin}`));
  return new Promise((coz) => {
    const d = el("dialog", { class: "dn-dialog" });
    const iptal = dugme({ metin: vazgec });
    const onay = dugme({ metin: tamam, tur: tehlike ? "tehlike" : "birincil" });
    d.append(el("div", { class: "dn-dialog-govde" },
      el("h3", { class: "dn-dialog-baslik", text: baslik }),
      ...(Array.isArray(metin) ? metin : [metin]).filter(Boolean).map((m) => el("p", { text: m })),
      el("div", { class: "dn-dialog-eylem" }, iptal, onay)));
    let sonuc = false;
    iptal.addEventListener("click", () => d.close());
    onay.addEventListener("click", () => { sonuc = true; d.close(); });
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    document.body.append(d);
    d.showModal();
    iptal.focus();
  });
}

/**
 * Genel amaçlı form diyaloğu. alanlar: [{ad, etiket, tur:"text"|"number"|"textarea"|"select"|"password"|"checkbox",
 * deger, secenekler:[{d,e}], min, max, yerTutucu}] → Promise<{ad:deger}|null>
 */
export function formIste({ baslik, aciklama, alanlar, tamam = "Tamam", vazgec = "Vazgeç" }) {
  return new Promise((coz) => {
    if (!dialogDestekli()) { coz(null); return; }
    const d = el("dialog", { class: "dn-dialog" });
    const girdiler = {};
    const satirlar = alanlar.map((a, i) => {
      const id = `dn-f-${Date.now().toString(36)}-${i}`;
      let g;
      if (a.tur === "textarea") g = el("textarea", { id, rows: a.satir || 4, placeholder: a.yerTutucu || "" });
      else if (a.tur === "select") g = el("select", { id }, ...a.secenekler.map((s) => el("option", { value: s.d, text: s.e })));
      else if (a.tur === "checkbox") g = el("input", { id, type: "checkbox" });
      else g = el("input", { id, type: a.tur || "text", min: a.min, max: a.max, step: a.adim, placeholder: a.yerTutucu || "", autocomplete: "off" });
      if (a.tur === "checkbox") g.checked = !!a.deger;
      else if (a.deger != null) g.value = String(a.deger);
      girdiler[a.ad] = g;
      return a.tur === "checkbox"
        ? el("label", { class: "dn-form-satir dn-form-satir--onay", for: id }, g, el("span", { text: a.etiket }))
        : el("div", { class: "dn-form-satir" }, el("label", { for: id, text: a.etiket }), g);
    });
    const iptal = dugme({ metin: vazgec });
    const onay = dugme({ metin: tamam, tur: "birincil" });
    d.append(el("form", { class: "dn-dialog-govde", method: "dialog" },
      el("h3", { class: "dn-dialog-baslik", text: baslik }),
      aciklama ? el("p", { class: "dn-muted", text: aciklama }) : null,
      ...satirlar,
      el("div", { class: "dn-dialog-eylem" }, iptal, onay)));
    let sonuc = null;
    const topla = () => {
      const o = {};
      for (const a of alanlar) {
        const g = girdiler[a.ad];
        o[a.ad] = a.tur === "checkbox" ? g.checked : a.tur === "number" ? Number(g.value) : g.value;
      }
      return o;
    };
    iptal.addEventListener("click", (e) => { e.preventDefault(); d.close(); });
    onay.addEventListener("click", (e) => { e.preventDefault(); sonuc = topla(); d.close(); });
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    document.body.append(d);
    d.showModal();
    Object.values(girdiler)[0]?.focus();
  });
}

export function hataMetni(h) {
  const m = h?.message || String(h || "");
  if (/does not exist|42883|PGRST202|schema cache/i.test(m)) return "Gerekli migration (0077) henüz çalıştırılmamış.";
  return m;
}

export function htmlKacis(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const IOS_MU = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Dosyayı ArrayBuffer olarak okur (Blob.arrayBuffer her yerde var; yoksa FileReader). */
export function baytlariOku(blob) {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((coz, red) => {
    const r = new FileReader();
    r.onload = () => coz(r.result);
    r.onerror = () => red(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export async function metinOku(blob) {
  const buf = await baytlariOku(blob);
  const u8 = new Uint8Array(buf);
  // BOM'a göre çöz; yoksa UTF-8, geçersizse Windows-1254 (Türkçe) dene.
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf ? u8.subarray(3) : u8);
  } catch {
    try { return new TextDecoder("windows-1254").decode(u8); } catch { return new TextDecoder("utf-8").decode(u8); }
  }
}

export function dataUrlBaytlari(url) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(url || "");
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const b64 = /;base64/i.test(m[2]);
  const veri = m[3];
  if (b64) {
    const bin = atob(veri.replace(/\s+/g, ""));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { mime, bayt: u8 };
  }
  return { mime, bayt: new TextEncoder().encode(decodeURIComponent(veri)) };
}

export function baytlardanDataUrl(u8, mime) {
  let s = "";
  const parca = 0x8000;
  for (let i = 0; i < u8.length; i += parca) s += String.fromCharCode.apply(null, u8.subarray(i, i + parca));
  return `data:${mime};base64,${btoa(s)}`;
}
