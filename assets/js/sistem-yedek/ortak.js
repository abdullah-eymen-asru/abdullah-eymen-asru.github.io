/*
 * assets/js/sistem-yedek/ortak.js — Sistem Yedekleme modülünün ortak yardımcıları.
 * innerHTML YOK, inline stil YOK (CSP): DOM yalnızca el() ile kurulur.
 */
import { supabase } from "../core/supabase-client.js";

// Worker adresi: Cloudflare > Workers & Pages > sistem-yedek-worker > adres (rehber § 4.10, adım 7).
export const SISTEM_YEDEK_WORKER_URL = "https://sistem-yedek-worker.aeymena.workers.dev";

// Kota referansları (Supabase ücretsiz plan 500 MB, Cloudflare R2 ücretsiz katman 10 GB).
// Asıl değerler veritabanından (sistem_depolama_durumu) gelir; bu sabitler yalnızca yedektir.
export const VARSAYILAN_DB_KOTA = 524288000;
export const VARSAYILAN_R2_KOTA = 10737418240;

export function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

export function bayt(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  const birimler = ["KB", "MB", "GB", "TB"];
  let v = x / 1024;
  let i = 0;
  while (v >= 1024 && i < birimler.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${birimler[i]}`;
}

export function tarihMetni(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

export const bugunDamga = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function hataMetni(h) {
  const m = h?.message || String(h || "");
  if (/does not exist|42883|PGRST202|schema cache/i.test(m)) return "Gerekli migration (0074 / 0075 / 0081) henüz çalıştırılmamış.";
  return m;
}

export async function erisimJetonu() {
  const { data } = await supabase.auth.getSession();
  const t = data?.session?.access_token;
  if (!t) throw new Error("Oturum bulunamadı; yeniden giriş yap.");
  return t;
}

export async function workerFetch(yol, { sinyal, yontem = "GET", govde, basliklar } = {}) {
  const jeton = await erisimJetonu();
  return fetch(`${SISTEM_YEDEK_WORKER_URL}${yol}`, {
    method: yontem,
    headers: { Authorization: `Bearer ${jeton}`, ...(basliklar || {}) },
    body: govde,
    signal: sinyal,
  });
}

/** JSON döndüren Worker çağrısı: HTTP hatasını anlamlı bir Error'a çevirir (gövdedeki "error" alanı). */
export async function workerJson(yol, { yontem = "GET", govde, sinyal } = {}) {
  const r = await workerFetch(yol, {
    yontem, sinyal,
    govde: govde === undefined ? undefined : JSON.stringify(govde),
    basliklar: govde === undefined ? undefined : { "Content-Type": "application/json" },
  });
  const g = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(g.error || `HTTP ${r.status}`); e.durum = r.status; e.govde = g; throw e; }
  return g;
}

/** Worker'ın kabul ettiği R2 anahtar biçimleri (worker.js ANAHTAR_DESENLERI ile AYNI; yalnızca erken uyarı içindir —
 *  gerçek sınır Worker'dadır). */
export const R2_DESENLERI = {
  arsiv: /^arsiv\/[0-9a-f-]{36}$/i,
  notek: /^notlar\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i,
  akademik: /^akademik-kutuphane\/users\/[0-9a-f-]{36}\/[^\\]{1,400}$/i,
};
export const R2_KAYNAK_ADLARI = { arsiv: "Dosya Yöneticisi", akademik: "Akademik Kütüphane", notek: "Not ekleri" };
export const r2AnahtarGecerli = (kaynak, k) => !!R2_DESENLERI[kaynak] && typeof k === "string" && !k.includes("..") && R2_DESENLERI[kaynak].test(k);

/* ------------------------------ ikonlar (inline SVG, CSP uyumlu) ------------------------------ */

const IKON_YOLLARI = {
  indir: "M12 3v12|M8 11l4 4 4-4|M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  cop: "M3 6h18|M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2|M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6|M10 11v6|M14 11v6",
  ara: "M11 19a8 8 0 100-16 8 8 0 000 16z|M21 21l-4.3-4.3",
  kapat: "M18 6L6 18|M6 6l12 12",
  yenile: "M21 12a9 9 0 11-3-6.7|M21 4v5h-5",
  tik: "M5 13l4 4L19 7",
  kisi: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8z",
  kisiler: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8z|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  kalkan: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  uyari: "M12 9v4|M12 17h.01|M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  durdur: "M6 6h12v12H6z",
  kilit: "M5 11h14v10H5z|M8 11V7a4 4 0 118 0v4",
  klasor: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  dosya: "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z|M14 3v5h5",
  yukle: "M12 21V9|M8 13l4-4 4 4|M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2",
  geri: "M3 12a9 9 0 109-9 9 9 0 00-6.7 3|M3 4v5h5",
  goz: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z|M12 15a3 3 0 100-6 3 3 0 000 6z",
};

export function ikon(ad) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "18");
  s.setAttribute("height", "18");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("sy-ikon");
  for (const d of (IKON_YOLLARI[ad] || "").split("|")) {
    if (!d) continue;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

/**
 * Tutarlı düğme: sy-btn + varyant (birincil | ikincil | tehlike | tehlike-hafif | hayalet) + isteğe bağlı ikon.
 * Tüm düğmeler en az 44px yüksekliğindedir (dokunma hedefi) ve koyu/açık temada okunur renkler taşır.
 */
export function dugme({ metin, ikonAdi, tur = "ikincil", kucuk = false, ...oz } = {}) {
  const b = el("button", { type: "button", ...oz, class: `sy-btn sy-btn--${tur}${kucuk ? " sy-btn--kucuk" : ""}${oz.class ? ` ${oz.class}` : ""}` });
  if (ikonAdi) b.append(ikon(ikonAdi));
  if (metin) b.append(el("span", { text: metin }));
  return b;
}

/**
 * window.confirm yerine uygulama içi onay penceresi (<dialog>). Tehlikeli işlemlerde kırmızı onay düğmesi.
 * <dialog> desteklenmiyorsa (çok eski tarayıcı) güvenli geri dönüş olarak window.confirm kullanılır.
 * @returns {Promise<boolean>}
 */
export function onayIste({ baslik, metin, tamam = "Onayla", vazgec = "Vazgeç", tehlike = false }) {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
    return Promise.resolve(window.confirm(`${baslik}\n\n${metin}`));
  }
  return new Promise((coz) => {
    const d = document.createElement("dialog");
    d.className = "sy-dialog";
    const metinler = (Array.isArray(metin) ? metin : [metin]).filter(Boolean).map((m) => el("p", { text: m }));
    const iptal = dugme({ metin: vazgec, tur: "ikincil" });
    const onay = dugme({ metin: tamam, tur: tehlike ? "tehlike" : "birincil" });
    d.append(
      el("div", { class: "sy-dialog-govde" },
        el("h3", { text: baslik, class: "sy-dialog-baslik" }),
        ...metinler,
        el("div", { class: "sy-dialog-eylem" }, iptal, onay)
      )
    );
    let sonuc = false;
    iptal.addEventListener("click", () => d.close());
    onay.addEventListener("click", () => { sonuc = true; d.close(); });
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    d.addEventListener("cancel", () => { sonuc = false; });
    document.body.append(d);
    d.showModal();
    iptal.focus();
  });
}

/**
 * GERİ ALINAMAZ SİLME için ÇİFT AŞAMALI onay penceresi.
 *   Aşama 1: ne kadar kayıt / bayt silineceğinin ÖZETİ (satır satır) → "Devam et"
 *   Aşama 2: onay metni ("SİL") yazılmadan kırmızı düğme AKTİF OLMAZ.
 * @returns {Promise<boolean>}
 */
export function silOnayiIste({ baslik, ozet = [], uyari = [], onayMetni = "SİL", tamam = "Kalıcı olarak sil" }) {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
    const t = window.prompt(`${baslik}\n\n${[...ozet, ...uyari].join("\n")}\n\nDevam etmek için ${onayMetni} yaz:`);
    return Promise.resolve((t || "").trim().toLocaleUpperCase("tr") === onayMetni);
  }
  return new Promise((coz) => {
    const d = document.createElement("dialog");
    d.className = "sy-dialog";
    const govde = el("div", { class: "sy-dialog-govde" });
    d.append(govde);
    let sonuc = false;

    const asama1 = () => {
      const iptal = dugme({ metin: "Vazgeç", tur: "ikincil" });
      const devam = dugme({ metin: "Devam et", tur: "tehlike" });
      iptal.addEventListener("click", () => d.close());
      devam.addEventListener("click", asama2);
      govde.replaceChildren(
        el("h3", { class: "sy-dialog-baslik", text: baslik }),
        el("p", { class: "sy-dialog-asama", text: "Adım 1/2 · Ne silineceğini kontrol et" }),
        el("ul", { class: "sy-dialog-ozet" }, ozet.map((m) => el("li", { text: m }))),
        ...uyari.map((m) => el("p", { class: "sy-bilgi sy-bilgi--uyari", text: m })),
        el("div", { class: "sy-dialog-eylem" }, iptal, devam)
      );
      iptal.focus();
    };
    const asama2 = () => {
      const girdi = el("input", { type: "text", class: "sy-girdi", autocomplete: "off", spellcheck: "false", "aria-label": `Onay için ${onayMetni} yaz`, placeholder: onayMetni });
      const iptal = dugme({ metin: "Vazgeç", tur: "ikincil" });
      const sil = dugme({ metin: tamam, tur: "tehlike", disabled: true });
      girdi.addEventListener("input", () => {
        const v = girdi.value.trim().toLocaleUpperCase("tr");
        sil.disabled = !(v === onayMetni || v === onayMetni.replace("İ", "I"));
      });
      iptal.addEventListener("click", () => d.close());
      sil.addEventListener("click", () => { sonuc = true; d.close(); });
      govde.replaceChildren(
        el("h3", { class: "sy-dialog-baslik", text: "Son onay — geri alınamaz" }),
        el("p", { class: "sy-dialog-asama", text: "Adım 2/2 · Onay metnini yaz" }),
        el("p", {}, "Bu işlem ", el("strong", { text: "GERİ ALINAMAZ" }), `. Devam etmek için aşağıya büyük harflerle ${onayMetni} yaz.`),
        girdi,
        el("div", { class: "sy-dialog-eylem" }, iptal, sil)
      );
      girdi.focus();
    };
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    d.addEventListener("cancel", () => { sonuc = false; });
    document.body.append(d);
    asama1();
    d.showModal();
  });
}

export const BILESENLER = [
  { id: "veritabani", ikon: "🗃️", ad: "Supabase Veritabanı", aciklama: "Tablolar JSON ve/veya SQL dump olarak. Yetki kapsamına göre filtrelenir." },
  { id: "r2", ikon: "☁️", ad: "R2 Arşiv Dosyaları", aciklama: "Kütüphane PDF'leri ve Dosya Yöneticisi belgeleri. Yönetici yalnızca kendi dosyalarını alır. TÜM SİSTEM yedeğinde (Site Sahibi) herkesin şifreli not ekleri de gelir." },
  { id: "icerik_md", ikon: "📝", ad: "İçerik & Markdown (.md)", aciklama: "Deponun tüm .md yazıları, sayfaları ve araştırma içerikleri (klasör yapısıyla)." },
  { id: "notlar", ikon: "🗒️", ad: "Kişisel Notlar & Alıntılar", aciklama: "SENİN notların, alıntıların, kaynakların ve şifreli eklerin + Yedek Kurtarma Kodu bilgisi (notlar/ekler/ klasörüne R2'den iner). Notlar ve Mesajlar için TEK kodla açılır: yedeği başka hesapta içe aktarırken aynı kodu girersin; kod doğrulaması dışa aktarırken yapılır." },
  { id: "akademik", ikon: "📚", ad: "Akademik Kütüphane", aciklama: "Kaynak künyeleri, vurgu/notlar (akademik_kaynaklar, akademik_notlar) ve PDF dosyaları; kullanıcı klasörüyle. Yönetici/üye yalnızca KENDİ kütüphanesini, Site Sahibi seçili üyeleri ya da tüm sistemi alır." },
  { id: "github", ikon: "🐙", ad: "GitHub Kaynak Kodu (.zip)", aciklama: "Site deposunun güncel kodu, tek zip olarak." },
];
