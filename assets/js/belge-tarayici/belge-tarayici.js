/*
 * assets/js/belge-tarayici/belge-tarayici.js — Belge Tarayıcı, Kümülatif Çoklu Birleştirici, Evrensel Sıkıştırma & Bellek Korumalı Dönüştürücü.
 * -----------------------------------------------------------------------
 *  SIFIR SUNUCU MALİYETİ : dosyalar yalnızca bu sekmenin belleğinde işlenir; Worker / Supabase / R2'ye HİÇBİR istek gitmez
 *                          (tek ağ trafiği: açık kaynak kütüphane kodunun CDN'den indirilmesi; Supabase yalnızca yetki RPC'si için).
 *  GUARD                 : donusturucu_yetkisi_var_mi() (migration 0077) — Dönüştürücü ile aynı anahtar (yeni migration gerekmez).
 *  BELLEK                : bellek-kalkani.js (tuval 0×0, URL revoke, tampon null, sıralı boru hattı).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { ayrilmaKancasiKaydet } from "../core/gezinme-kilidi.js";
import { el, bos, dugme, ilerlemeCubugu, bayt, onayIste, isBaglami, IptalHatasi, hataMetni } from "../donusturucu/ortak.js";
import { girdiTuru, dosyayiAyikla, KABUL } from "./girdi.js";
import { ogeyiIsle } from "./tarama.js";
import { koseDuzenle } from "./perspektif-arayuz.js";
import { PROFILLER, COZUNURLUKLER, varsayilanAyar, profilUygula, tahminiBoyut, tuvalBlob, webpDestekli } from "./sikistir.js";
import { pdfIndir, gorselleriIndir, zipIndir } from "./disa-aktar.js";
import { tuvalBirak, nesneUrl, urlBirak, bellekDurumu, hepsiniBirak } from "./bellek-kalkani.js";
import { kosalariDondur } from "./tarama.js";

const MAKS_OGE = 300;
const MAKS_DOSYA = 250 * 1024 * 1024;

const kok = document.getElementById("bt-kok");
const mesajEl = document.getElementById("bt-mesaj");
const bildir = (m, t = "info") => { if (!mesajEl) return; if (!m) { mesajEl.hidden = true; mesajEl.textContent = ""; } else showMessage(mesajEl, m, t); };

let ogeler = [];
let idSayac = 0;
let ayar = varsayilanAyar();
let ayikla = null; // isBaglami (yükleme)
let calisiyor = null; // isBaglami (dışa aktarma)
let surukleId = null;

const ilerleme = ilerlemeCubugu();
const listeEl = el("ul", { class: "bt-izgara", "aria-label": "Sayfa kuyruğu" });
const sayacEl = el("span", { class: "bt-sayac", role: "status", "aria-live": "polite" });
const tahminEl = el("output", { class: "bt-tahmin", "aria-live": "polite" });
const bellekEl = el("span", { class: "dn-muted bt-bellek", title: "Açık tuval ve Object URL sayısı: işlem bitince tuval 0 olmalıdır" });
const girdiEl = el("input", { type: "file", multiple: true, accept: KABUL, hidden: true, "aria-label": "Dosya seç" });
const kameraEl = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, "aria-label": "Kamera ile çek" });
let butonlar = {};
let kontrolEl = null;

/* ------------------------------ kuyruk ------------------------------ */

const etkinMod = (o) => (o.mod && o.mod !== "genel" ? o.mod : ayar.mod);

let onizlemeZinciri = Promise.resolve();
function onizlemeYenile(o) {
  onizlemeZinciri = onizlemeZinciri.then(async () => {
    if (!ogeler.includes(o)) return;
    try {
      const c = await ogeyiIsle(o, { mod: etkinMod(o), maksKenar: 380, maksKisa: 380, kaynakMaksKenar: 1100 });
      try {
        const b = await tuvalBlob(c, "image/jpeg", 0.72);
        const eski = o.onizUrl;
        o.onizUrl = nesneUrl(b);
        if (eski) urlBirak(eski);
      } finally { tuvalBirak(c); }
    } catch (h) { o.onizHata = h?.message || String(h); }
    ciz();
  }).catch(() => {});
  return onizlemeZinciri;
}

function ogeEkle(veri) {
  const o = { id: ++idSayac, v: 0, dondur: 0, kose: null, mod: "genel", onizUrl: null, ...veri };
  ogeler.push(o);
  onizlemeYenile(o);
  return o;
}

function ogeSil(o) {
  const i = ogeler.indexOf(o);
  if (i < 0) return;
  ogeler.splice(i, 1);
  if (o.onizUrl) urlBirak(o.onizUrl);
  o.blob = null; o.onizUrl = null;
  tahminiTetikle(); ciz();
}

function tasi(o, yon) {
  const i = ogeler.indexOf(o); const j = i + yon;
  if (i < 0 || j < 0 || j >= ogeler.length) return;
  [ogeler[i], ogeler[j]] = [ogeler[j], ogeler[i]];
  ciz();
}

function degisti(o) { o.v += 1; onizlemeYenile(o); tahminiTetikle(); }

async function dosyalariAl(fl) {
  bildir("");
  if (ayikla) { bildir("Önceki yükleme sürüyor; bitmesini bekle ya da iptal et.", "info"); return; }
  const adaylar = []; const red = [];
  for (const f of fl) {
    if (!girdiTuru(f)) red.push(`${f.name} (desteklenmeyen tür)`);
    else if (!f.size) red.push(`${f.name} (boş)`);
    else if (f.size > MAKS_DOSYA) red.push(`${f.name} (250 MB sınırı)`);
    else adaylar.push(f);
  }
  const uyarilar = [];
  const ctx = isBaglami((o, m) => ilerleme.ayarla(o, m));
  ayikla = ctx; ciz();
  let eklenen = 0;
  try {
    for (let i = 0; i < adaylar.length; i += 1) {
      const f = adaylar[i];
      ctx.kontrol();
      ilerleme.ayarla(i / adaylar.length, `${f.name} okunuyor (${i + 1}/${adaylar.length})…`);
      try {
        await dosyayiAyikla(f, {
          ctx, uyar: (m) => uyarilar.push(m),
          onOge: async (veri) => {
            if (ogeler.length >= MAKS_OGE) throw new Error(`Kuyruk sınırı (${MAKS_OGE} sayfa) doldu.`);
            ogeEkle(veri); eklenen += 1; ciz();
          },
        });
      } catch (h) {
        if (h instanceof IptalHatasi) throw h;
        red.push(`${f.name}: ${h.message || h}`);
      }
    }
  } catch (h) { if (!(h instanceof IptalHatasi)) red.push(h.message || String(h)); } finally {
    ayikla = null; ilerleme.gizle();
  }
  tahminiTetikle(); ciz();
  const parcalar = [];
  if (eklenen) parcalar.push(`${eklenen} sayfa eklendi (toplam ${ogeler.length}).`);
  if (uyarilar.length) parcalar.push(uyarilar.join(" "));
  if (red.length) parcalar.push(`Atlanan: ${red.join("; ")}`);
  if (parcalar.length) bildir(parcalar.join(" "), red.length && !eklenen ? "error" : "info");
}

/* ------------------------------ canlı boyut tahmini ------------------------------ */

let tahminZamani = null;
function tahminiTetikle() {
  clearTimeout(tahminZamani);
  if (!ogeler.length) { tahminEl.textContent = "Kuyruk boş."; return; }
  tahminEl.textContent = "Tahmini boyut hesaplanıyor…";
  tahminZamani = setTimeout(async () => {
    try {
      const t = await tahminiBoyut(ogeler.slice(), { ...ayar });
      if (t.iptal) return;
      const yuzde = (a, b) => (a > 0 ? Math.max(0, Math.round((1 - b / a) * 100)) : 0);
      const fark = t.pdf <= t.once ? `%${yuzde(t.once, t.pdf)} küçülme` : "kaynağa göre büyür (vektör PDF/küçük kaynak görüntüye çevrilir)";
      const parca = [`PDF: ${bayt(t.once)} → ~${bayt(t.pdf)} (${fark})`];
      if (ayar.format !== "jpeg") parcaEkle(parca, t);
      else parca.push(`Görseller/ZIP: ~${bayt(t.gorsel)}`);
      tahminEl.textContent = parca.join(" · ");
    } catch (h) { tahminEl.textContent = `Tahmin yapılamadı: ${h.message || h}`; }
  }, 600);
}
const parcaEkle = (p, t) => p.push(`${ayar.format.toUpperCase()} görseller/ZIP: ~${bayt(t.gorsel)}`);

/* ------------------------------ arayüz ------------------------------ */

function secim(etiket, id, secenekler, deger, degisince, yardim) {
  const s = el("select", { id, class: "dn-select" }, ...secenekler.map(([v, t]) => el("option", { value: v, text: t })));
  s.value = deger;
  s.addEventListener("change", () => degisince(s.value));
  return el("div", { class: "bt-alan" }, el("label", { for: id, text: etiket }), s, yardim ? el("small", { class: "dn-muted", text: yardim }) : null);
}

function ayarKarti() {
  const profilBtn = Object.entries(PROFILLER).map(([k, p]) => {
    const b = dugme({ metin: p.ad, class: "bt-profil", "aria-pressed": ayar.profil === k ? "true" : "false", title: p.aciklama });
    b.dataset.profil = k;
    b.append(el("small", { class: "dn-muted", text: `${p.dpi} DPI · %${p.kalite}` }));
    b.addEventListener("click", () => { ayar = profilUygula(ayar, k); ayarCiz(); ogeler.forEach((o) => onizlemeYenile(o)); tahminiTetikle(); });
    return b;
  });
  const kalite = el("input", { type: "range", id: "bt-kalite", min: "10", max: "100", step: "1", value: String(ayar.kalite), "aria-label": "Görsel kalitesi yüzdesi" });
  const kaliteDeger = el("output", { for: "bt-kalite", text: `%${ayar.kalite}` });
  kalite.addEventListener("input", () => { ayar.kalite = Number(kalite.value); ayar.profil = "ozel"; kaliteDeger.textContent = `%${ayar.kalite}`; profilIsaret(); tahminiTetikle(); });
  const dpi = el("input", { type: "range", id: "bt-dpi", min: "72", max: "300", step: "2", value: String(ayar.dpi), "aria-label": "A4 çözünürlüğü (DPI)" });
  const dpiDeger = el("output", { for: "bt-dpi", text: `${ayar.dpi} DPI` });
  dpi.addEventListener("input", () => { ayar.dpi = Number(dpi.value); ayar.profil = "ozel"; dpiDeger.textContent = `${ayar.dpi} DPI`; profilIsaret(); tahminiTetikle(); });
  const profilIsaret = () => profilBtn.forEach((b) => b.setAttribute("aria-pressed", ayar.profil === b.dataset.profil ? "true" : "false"));
  const cozunurluk = secim("Maksimum çözünürlük", "bt-cozunurluk", Object.entries(COZUNURLUKLER), ayar.cozunurluk, (v) => { ayar.cozunurluk = v; ayar.profil = "ozel"; profilIsaret(); dpi.disabled = v !== "a4"; tahminiTetikle(); });
  dpi.disabled = ayar.cozunurluk !== "a4";
  const mod = secim("Tarama modu", "bt-mod", [["orijinal", "Orijinal"], ["sihirli", "Renkli Temiz Belge (Magic Color)"], ["bw", "B&W Tarayıcı"]], ayar.mod, (v) => { ayar.mod = v; ogeler.forEach((o) => onizlemeYenile(o)); tahminiTetikle(); });
  const format = secim("Görsel/ZIP biçimi", "bt-format", [["jpeg", "JPEG"], ["webp", "WebP"], ["png", "PNG (kayıpsız, kalite uygulanmaz)"]], ayar.format, (v) => { ayar.format = v; tahminiTetikle(); }, "PDF her zaman JPEG gömer.");
  const sayfa = secim("PDF sayfa boyutu", "bt-sayfa", [["a4", "A4 (sığdır, ortala)"], ["gorsel", "Görsel boyutunda"]], ayar.sayfa, (v) => { ayar.sayfa = v; });
  const zip = secim("ZIP sıkıştırma (DEFLATE)", "bt-zip", [["6", "Seviye 6 (hızlı)"], ["7", "Seviye 7"], ["8", "Seviye 8"], ["9", "Seviye 9 (en küçük)"]], String(ayar.zipSeviye), (v) => { ayar.zipSeviye = Number(v); }, "JPEG zaten sıkışıktır; kazanç küçüktür.");
  webpDestekli().then((ok) => { if (!ok) { const o = format.querySelector('option[value="webp"]'); if (o) o.textContent = "WebP (bu tarayıcıda yok → JPEG)"; } });
  return el("section", { class: "dn-kart bt-ayarlar", "aria-labelledby": "bt-ayar-baslik" },
    el("h3", { id: "bt-ayar-baslik", text: "⚙️ Çıktı & Sıkıştırma" }),
    el("div", { class: "bt-profiller", role: "group", "aria-label": "Hızlı profiller" }, ...profilBtn),
    el("div", { class: "bt-alan bt-alan--aralik" }, el("label", { for: "bt-kalite", text: "Görsel kalitesi" }), kalite, kaliteDeger),
    el("div", { class: "bt-alan bt-alan--aralik" }, el("label", { for: "bt-dpi", text: "A4 yoğunluğu" }), dpi, dpiDeger),
    el("div", { class: "bt-ayar-izgara" }, cozunurluk, mod, format, sayfa, zip),
    el("div", { class: "bt-tahmin-kutu" }, el("strong", { text: "Tahmini boyut: " }), tahminEl));
}

function ayarCiz() { const eski = document.querySelector(".bt-ayarlar"); if (eski) eski.replaceWith(ayarKarti()); }

function kartCiz(o, i) {
  const sil = dugme({ ikon: "✕", kucuk: true, tur: "hayalet", "aria-label": `${o.ad} sayfasını kaldır`, title: "Kaldır" });
  const sol = dugme({ ikon: "◀", kucuk: true, tur: "hayalet", "aria-label": "Öne al", title: "Öne al" });
  const sag = dugme({ ikon: "▶", kucuk: true, tur: "hayalet", "aria-label": "Sona al", title: "Sona al" });
  const don = dugme({ ikon: "↻", kucuk: true, tur: "hayalet", "aria-label": "90° döndür", title: "90° döndür" });
  const kose = dugme({ ikon: "✂", kucuk: true, tur: "hayalet", "aria-label": "Köşeleri düzelt (perspektif)", title: "Köşeleri düzelt", ...(o.kose ? { "aria-pressed": "true" } : {}) });
  sil.disabled = !!calisiyor; sol.disabled = i === 0; sag.disabled = i === ogeler.length - 1;
  sil.addEventListener("click", () => ogeSil(o));
  sol.addEventListener("click", () => tasi(o, -1));
  sag.addEventListener("click", () => tasi(o, 1));
  don.addEventListener("click", () => { o.dondur = (o.dondur + 90) % 360; if (o.kose) o.kose = kosalariDondur(o.kose, 1); degisti(o); });
  kose.addEventListener("click", async () => {
    try {
      const k = await koseDuzenle(o);
      if (k) { o.kose = k; degisti(o); ciz(); }
    } catch (h) { bildir(h.message || String(h), "error"); }
  });
  const modSec = el("select", { class: "dn-select bt-oge-mod", "aria-label": `${o.ad} için tarama modu` },
    ...[["genel", "Genel mod"], ["orijinal", "Orijinal"], ["sihirli", "Magic Color"], ["bw", "B&W"]].map(([v, t]) => el("option", { value: v, text: t })));
  modSec.value = o.mod;
  modSec.addEventListener("change", () => { o.mod = modSec.value; degisti(o); });
  const gorsel = o.onizUrl
    ? el("img", { class: "bt-kucuk", src: o.onizUrl, alt: `Sayfa ${i + 1}: ${o.ad}`, draggable: "false" })
    : el("div", { class: "bt-kucuk bt-kucuk--bos", text: o.onizHata ? "Önizleme yok" : "…" });
  const li = el("li", { class: "bt-kart", draggable: "true", "data-id": String(o.id) },
    el("span", { class: "bt-sira", text: String(i + 1) }), gorsel,
    el("span", { class: "bt-ad", title: o.ad, text: o.ad }),
    el("span", { class: "dn-muted bt-meta", text: `${o.w}×${o.h}${o.kose ? " · düzeltildi" : ""}` }),
    modSec, el("div", { class: "bt-kart-eylem" }, sol, sag, don, kose, sil));
  li.addEventListener("dragstart", (e) => { surukleId = o.id; li.classList.add("bt-surukleniyor"); try { e.dataTransfer.setData("text/plain", String(o.id)); e.dataTransfer.effectAllowed = "move"; } catch { /* yok say */ } });
  li.addEventListener("dragend", () => { surukleId = null; li.classList.remove("bt-surukleniyor"); });
  li.addEventListener("dragover", (e) => { if (surukleId != null) { e.preventDefault(); li.classList.add("bt-hedef"); } });
  li.addEventListener("dragleave", () => li.classList.remove("bt-hedef"));
  li.addEventListener("drop", (e) => {
    li.classList.remove("bt-hedef");
    if (surukleId == null || surukleId === o.id) return;
    e.preventDefault(); e.stopPropagation();
    const kaynak = ogeler.find((x) => x.id === surukleId);
    if (!kaynak) return;
    ogeler.splice(ogeler.indexOf(kaynak), 1);
    ogeler.splice(ogeler.indexOf(o), 0, kaynak);
    ciz();
  });
  return li;
}

function ciz() {
  bos(listeEl);
  ogeler.forEach((o, i) => listeEl.append(kartCiz(o, i)));
  const toplam = ogeler.reduce((a, o) => a + (o.orijinalBayt || 0), 0);
  sayacEl.textContent = ogeler.length ? `${ogeler.length} sayfa · kaynak ${bayt(toplam)}` : "Kuyruk boş — dosya ekle.";
  const durum = bellekDurumu();
  bellekEl.textContent = `RAM kalkanı: ${durum.tuval} açık tuval · ${durum.url} açık URL`;
  const bos0 = !ogeler.length; const mesgul = !!calisiyor || !!ayikla;
  for (const [ad, b] of Object.entries(butonlar)) b.disabled = ad === "iptal" ? !(calisiyor || ayikla) : (bos0 || mesgul);
  if (butonlar.temizle) butonlar.temizle.disabled = bos0 || mesgul;
}

function dropzone() {
  const dz = el("div", { class: "dn-dropzone bt-dropzone", role: "button", tabindex: "0", "aria-label": "Dosya eklemek için tıkla ya da dosyaları buraya bırak" },
    el("span", { class: "dn-dropzone-ikon", "aria-hidden": "true", text: "🗂️" }),
    el("strong", { text: "Sayfaları buraya bırak ya da eklemek için dokun" }),
    el("span", { class: "dn-muted", text: "JPG, PNG, WebP, TIFF, HEIC, PDF, DOCX (içindeki görseller). Yeni dosyalar listenin sonuna EKLENİR; mevcut sayfalar silinmez." }));
  dz.addEventListener("click", () => girdiEl.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); girdiEl.click(); } });
  const dosyaMi = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  for (const o of ["dragenter", "dragover"]) dz.addEventListener(o, (e) => { if (dosyaMi(e)) { e.preventDefault(); dz.classList.add("dn-surukle"); } });
  for (const o of ["dragleave", "drop"]) dz.addEventListener(o, () => dz.classList.remove("dn-surukle"));
  dz.addEventListener("drop", (e) => { if (dosyaMi(e)) { e.preventDefault(); dosyalariAl([...e.dataTransfer.files]); } });
  return dz;
}

girdiEl.addEventListener("change", () => { dosyalariAl([...girdiEl.files]); girdiEl.value = ""; });
kameraEl.addEventListener("change", () => { dosyalariAl([...kameraEl.files]); kameraEl.value = ""; });

/* ------------------------------ dışa aktarma ------------------------------ */

async function aktar(ad, fn, etiket) {
  if (calisiyor || !ogeler.length) return;
  bildir("");
  const ctx = isBaglami((o, m) => ilerleme.ayarla(o, m));
  calisiyor = ctx; ciz();
  ilerleme.ayarla(0, "Başlıyor…");
  try {
    const r = await fn(ogeler.slice(), { ...ayar }, ctx);
    bildir(`${etiket} hazır: ${r.adet} sayfa, ${bayt(r.boyut)}.${r.not ? ` ${r.not}` : ""}`, "success");
  } catch (h) {
    if (h instanceof IptalHatasi) bildir("İşlem iptal edildi; geçici bellek serbest bırakıldı.", "info");
    else bildir(`${etiket} oluşturulamadı: ${hataMetni(h)}`, "error");
  } finally {
    calisiyor = null; ilerleme.gizle(); ciz();
  }
}

function eylemKarti() {
  const mk = (ad, ikon, metin, tur) => (butonlar[ad] = dugme({ ikon, metin, tur }));
  const pdf = mk("pdf", "📄", "PDF indir", "birincil");
  const gor = mk("gorsel", "🖼️", "Görselleri tek tek indir");
  const zip = mk("zip", "🗜️", "ZIP olarak indir");
  const iptal = mk("iptal", "⏹️", "İptal et");
  const temizle = mk("temizle", "🗑️", "Kuyruğu boşalt", "tehlike-hafif");
  pdf.addEventListener("click", () => aktar("pdf", pdfIndir, "PDF"));
  gor.addEventListener("click", () => aktar("gorsel", gorselleriIndir, "Görseller"));
  zip.addEventListener("click", () => aktar("zip", zipIndir, "ZIP"));
  iptal.addEventListener("click", () => { ayikla?.iptal(); calisiyor?.iptal(); });
  temizle.addEventListener("click", async () => {
    if (!(await onayIste({ baslik: "Kuyruk boşaltılsın mı?", metin: "Tüm sayfalar bellekten silinir.", tamam: "Boşalt", tehlike: true }))) return;
    oturumuSifirla(); bildir("Kuyruk boşaltıldı, bellek temizlendi.", "success");
  });
  return el("section", { class: "dn-kart", "aria-labelledby": "bt-aktar-baslik" },
    el("h3", { id: "bt-aktar-baslik", text: "📤 Dışa aktar" }),
    el("div", { class: "bt-eylemler" }, pdf, gor, zip, iptal, temizle), ilerleme.el);
}

/* ------------------------------ bellek / yaşam döngüsü ------------------------------ */

function oturumuSifirla() {
  ayikla?.iptal(); calisiyor?.iptal();
  for (const o of ogeler) { if (o.onizUrl) urlBirak(o.onizUrl); o.blob = null; o.onizUrl = null; }
  ogeler = [];
  hepsiniBirak();
  tahminEl.textContent = "Kuyruk boş.";
  ciz();
}

function ayrilirkenSor() {
  if (!ogeler.length) return Promise.resolve(true);
  return onayIste({ baslik: "Sekmeden ayrılıyorsun", metin: `Kuyruktaki ${ogeler.length} sayfa bellekten silinecek (sunucuda zaten kopya yok).`, tamam: "Sil ve ayrıl", vazgec: "Burada kal", tehlike: true })
    .then((ok) => { if (ok) oturumuSifirla(); return ok; });
}

async function kur() {
  if (!kok) return;
  // GUARD (derinlemesine savunma): yetki yoksa hiçbir arayüz/kütüphane yüklenmez.
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) {
    kok.replaceChildren(el("div", { class: "dn-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "dn-muted", text: "Bu araca erişim yetkin bulunmuyor. Gerekirse site sahibinden talep et." })));
    return;
  }
  kok.classList.add("dn-kok", "bt-kok");
  const rozet = el("div", { class: "dn-gizlilik", role: "note" }, el("span", { "aria-hidden": "true", text: "🔒" }),
    el("span", {}, el("b", { text: "Sıfır sunucu isteği: dosyalar cihazından çıkmaz." }), " Tarama, sıkıştırma ve birleştirme tarayıcında yapılır; Worker/Supabase/R2'ye dosya gönderilmez."));
  const sifirla = dugme({ metin: "Oturumu Sıfırla", ikon: "🧹", class: "dn-sifirla", title: "Tüm sayfaları, önizlemeleri ve tuvalleri bellekten siler" });
  sifirla.addEventListener("click", async () => {
    if (!ogeler.length) { bildir("Bellekte silinecek sayfa yok.", "info"); return; }
    if (await onayIste({ baslik: "Oturum sıfırlansın mı?", metin: "Kuyruktaki tüm sayfalar bellekten silinecek.", tamam: "Sıfırla ve sil", tehlike: true })) { oturumuSifirla(); bildir("Oturum sıfırlandı.", "success"); }
  });
  const kamera = dugme({ metin: "Kamera ile çek", ikon: "📷" });
  kamera.addEventListener("click", () => kameraEl.click());
  kontrolEl = el("div", { class: "bt-seritler" }, sayacEl, kamera);
  kok.replaceChildren(rozet, el("div", { class: "dn-guvenli-serit" }, sifirla, bellekEl), dropzone(), kontrolEl, listeEl, ayarKarti(), eylemKarti(), girdiEl, kameraEl);
  ciz(); tahminiTetikle();
  window.addEventListener("pagehide", () => { try { oturumuSifirla(); } catch { /* yok say */ } });
  ayrilmaKancasiKaydet("tool-belge-tarayici", ayrilirkenSor);
}

kur().catch((h) => { console.error("belge-tarayici.js:", h); bildir(`Araç yüklenemedi: ${h.message || h}`, "error"); });
