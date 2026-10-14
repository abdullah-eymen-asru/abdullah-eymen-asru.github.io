/*
 * assets/js/belge-tarayici/belge-tarayici.js — Belge Tarayıcı & Birleştirici (kompakt arayüz).
 * -----------------------------------------------------------------------
 *  SIFIR SUNUCU MALİYETİ : dosyalar yalnızca bu sekmenin belleğinde işlenir; Worker / Supabase / R2'ye HİÇBİR dosya gitmez
 *                          (tek ağ trafiği: açık kaynak kütüphane kodunun CDN'den indirilmesi; Supabase yalnızca yetki RPC'si için).
 *  GUARD                 : donusturucu_yetkisi_var_mi() (migration 0077) — Dönüştürücü ile aynı anahtar.
 *  AKIŞ (3 adım)         : 1) Ekle  2) Ayarla (Tarama · Kalite · Çıktı; "Gelişmiş" katlanır)  3) İndir / Paylaş.
 *  OTOMATİK BELGE        : fotoğraflarda kâğıt algılanır (belge-bul.js), arka plan kesilir, perspektif düzeltilir (WhatsApp "belge tara" gibi).
 *  BELLEK                : bellek-kalkani.js (tuval 0×0, URL revoke, tampon null, sıralı boru hattı).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { ayrilmaKancasiKaydet } from "../core/gezinme-kilidi.js";
import { el, bos, dugme, ilerlemeCubugu, bayt, onayIste, isBaglami, IptalHatasi, hataMetni } from "../donusturucu/ortak.js";
import { girdiTuru, dosyayiAyikla, KABUL } from "./girdi.js";
import { ogeyiIsle, belgeyiAlgila, kosalariDondur } from "./tarama.js";
import { koseDuzenle } from "./perspektif-arayuz.js";
import { PROFILLER, COZUNURLUKLER, varsayilanAyar, profilUygula, tahminiBoyut, tuvalBlob } from "./sikistir.js";
import { uret, indir, paylas, paylasilabilir, toplamBayt } from "./disa-aktar.js";
import { nesneUrl, urlBirak, bellekDurumu, hepsiniBirak, tuvalBirak } from "./bellek-kalkani.js";

const MAKS_OGE = 300;
const MAKS_DOSYA = 250 * 1024 * 1024;

const kok = document.getElementById("bt-kok");
const mesajEl = document.getElementById("bt-mesaj");
const bildir = (m, t = "info") => { if (!mesajEl) return; if (!m) { mesajEl.hidden = true; mesajEl.textContent = ""; } else showMessage(mesajEl, m, t); };

let ogeler = [];
let idSayac = 0;
let ayar = varsayilanAyar();
let ayikla = null;   // yükleme bağlamı
let calisiyor = null; // dışa aktarma bağlamı
let surukleId = null;
const kartlar = new Map(); // id → <li>

const ilerleme = ilerlemeCubugu();
const listeEl = el("ul", { class: "bt-izgara", "aria-label": "Sayfa kuyruğu" });
const sayacEl = el("span", { class: "bt-sayac", role: "status", "aria-live": "polite" });
const tahminEl = el("output", { class: "bt-tahmin", "aria-live": "polite" });
const bellekEl = el("span", { class: "bt-bellek", title: "Açık tuval ve Object URL sayısı: işlem bitince tuval 0 olmalıdır" });
const girdiEl = el("input", { type: "file", multiple: true, accept: KABUL, hidden: true, "aria-label": "Dosya seç" });
const kameraEl = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, "aria-label": "Kamera ile çek" });
let butonlar = {};
let bosAlanEl = null;
let ayarKapEl = null;

const MOD_AD = { sihirli: "Renkli", bw: "Siyah-beyaz", orijinal: "Orijinal" };
const MOD_SIRA = ["genel", "sihirli", "bw", "orijinal"];
const etkinMod = (o) => (o.mod && o.mod !== "genel" ? o.mod : ayar.mod);

/* ------------------------------ kuyruk ------------------------------ */

let onizlemeZinciri = Promise.resolve();
function onizlemeYenile(o) {
  onizlemeZinciri = onizlemeZinciri.then(async () => {
    if (!ogeler.includes(o)) return;
    try {
      if (o.algi === "bekliyor") await algila(o);
      if (!ogeler.includes(o)) return;
      const c = await ogeyiIsle(o, { mod: etkinMod(o), maksKenar: 380, maksKisa: 380, kaynakMaksKenar: 1100 });
      try {
        const b = await tuvalBlob(c, "image/jpeg", 0.72);
        const eski = o.onizUrl;
        if (ogeler.includes(o)) { o.onizUrl = nesneUrl(b); o.onizHata = null; if (eski) urlBirak(eski); } 
      } finally { tuvalBirak(c); }
    } catch (h) { o.onizHata = h?.message || String(h); }
    kartGuncelle(o);
  }).catch(() => {});
  return onizlemeZinciri;
}

/** Fotoğraftaki belgeyi bulur; bulamazsa kırpma yapılmaz (o.algi = "yok"). */
async function algila(o) {
  try {
    const r = await belgeyiAlgila(o.blob, o.ad, o.dondur || 0);
    if (r && r.kose) { o.kose = r.kose; o.algi = "otomatik"; } else if (r && r.tam) o.algi = "tam"; else o.algi = "yok";
  } catch { o.algi = "yok"; }
}

const algilanabilir = (o) => o.tur === "foto";

function ogeEkle(veri) {
  const o = { id: ++idSayac, v: 0, dondur: 0, kose: null, mod: "genel", onizUrl: null, algi: "atla", ...veri };
  if (ayar.otoBelge && algilanabilir(o)) o.algi = "bekliyor";
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
  kartlar.get(o.id)?.remove(); kartlar.delete(o.id);
  tahminiTetikle(); ciz();
}

function tasi(o, yon) {
  const i = ogeler.indexOf(o); const j = i + yon;
  if (i < 0 || j < 0 || j >= ogeler.length) return;
  [ogeler[i], ogeler[j]] = [ogeler[j], ogeler[i]];
  ciz();
}

function degisti(o) { o.v += 1; onizlemeYenile(o); tahminiTetikle(); }

/** "Belgeyi otomatik bul" anahtarı değişince tüm uygun sayfalar yeniden değerlendirilir; elle yapılan kırpmalara dokunulmaz. */
function otoBelgeDegisti() {
  for (const o of ogeler) {
    if (!algilanabilir(o) || o.algi === "elle") continue;
    if (ayar.otoBelge) { if (o.algi !== "otomatik") { o.algi = "bekliyor"; degisti(o); } } else if (o.algi === "otomatik" || o.algi === "yok" || o.algi === "tam") { o.kose = null; o.algi = "atla"; degisti(o); }
  }
}

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
  if (eklenen) parcalar.push(`${eklenen} sayfa eklendi.`);
  if (uyarilar.length) parcalar.push(uyarilar.join(" "));
  if (red.length) parcalar.push(`Atlanan: ${red.join("; ")}`);
  if (parcalar.length) bildir(parcalar.join(" "), red.length && !eklenen ? "error" : "info");
}

/* ------------------------------ canlı boyut tahmini ------------------------------ */

let tahminZamani = null;
const ciktiEtiketi = () => (ayar.cikti === "pdf" ? "PDF" : ayar.format === "ayni" ? "Görseller" : ayar.format.toUpperCase());
function tahminiTetikle() {
  clearTimeout(tahminZamani);
  if (!ogeler.length) { tahminEl.textContent = ""; return; }
  tahminEl.textContent = "Boyut hesaplanıyor…";
  tahminZamani = setTimeout(async () => {
    try {
      const t = await tahminiBoyut(ogeler.slice(), { ...ayar, format: ayar.format === "ayni" ? "jpeg" : ayar.format });
      if (t.iptal) return;
      const hedef = ayar.cikti === "pdf" ? t.pdf : t.gorsel;
      tahminEl.textContent = `${ciktiEtiketi()} ≈ ${bayt(hedef)}${t.once ? ` (kaynak ${bayt(t.once)})` : ""}`;
    } catch (h) { tahminEl.textContent = `Tahmin yapılamadı: ${h.message || h}`; }
  }, 600);
}

/* ------------------------------ ayar bileşenleri ------------------------------ */

/** Seçenek düğmeli kısa kontrol + seçili seçeneğin tek satırlık açıklaması ("bu ne işe yarar?"). */
function segment({ baslik, secenekler, deger, degisince }) {
  const ipucu = el("p", { class: "bt-ipucu" });
  const dugmeler = secenekler.map(([v, t, aciklama]) => {
    const b = el("button", { type: "button", class: "bt-seg-btn", "aria-pressed": String(v === deger), text: t });
    b.dataset.v = v; b.dataset.ipucu = aciklama || "";
    return b;
  });
  const guncelle = (v) => { dugmeler.forEach((b) => { const a = b.dataset.v === v; b.setAttribute("aria-pressed", String(a)); if (a) ipucu.textContent = b.dataset.ipucu; }); };
  dugmeler.forEach((b) => b.addEventListener("click", () => { guncelle(b.dataset.v); degisince(b.dataset.v); }));
  guncelle(deger);
  return { el: el("div", { class: "bt-satir" }, el("span", { class: "bt-satir-baslik", text: baslik }), el("div", { class: "bt-seg", role: "group", "aria-label": baslik }, ...dugmeler), ipucu), guncelle };
}

function aralik({ id, etiket, aciklama, min, max, adim, deger, bicim, degisince }) {
  const r = el("input", { type: "range", id, min: String(min), max: String(max), step: String(adim), value: String(deger), "aria-label": etiket });
  const o = el("output", { for: id, text: bicim(deger) });
  r.addEventListener("input", () => { o.textContent = bicim(Number(r.value)); degisince(Number(r.value)); });
  return { r, o, el: el("div", { class: "bt-gel" }, el("div", { class: "bt-gel-ust" }, el("label", { for: id, text: etiket }), o), r, el("p", { class: "bt-ipucu", text: aciklama })) };
}

function secimAlani(etiket, id, secenekler, deger, degisince, aciklama) {
  const s = el("select", { id, class: "dn-select" }, ...secenekler.map(([v, t]) => el("option", { value: v, text: t })));
  s.value = deger;
  s.addEventListener("change", () => degisince(s.value));
  return { s, el: el("div", { class: "bt-gel" }, el("label", { for: id, text: etiket }), s, el("p", { class: "bt-ipucu", text: aciklama })) };
}

function ayarKarti() {
  const yenidenIsle = () => { ogeler.forEach((o) => onizlemeYenile(o)); tahminiTetikle(); };

  const oto = el("input", { type: "checkbox", id: "bt-oto", role: "switch", class: "bt-anahtar" });
  oto.checked = ayar.otoBelge;
  oto.addEventListener("change", () => { ayar.otoBelge = oto.checked; otoBelgeDegisti(); });
  const otoSatir = el("label", { class: "bt-oto", for: "bt-oto" },
    el("span", {}, el("strong", { text: "Belgeyi otomatik bul ve arka planı kes" }),
      el("small", { text: "Fotoğraftaki kâğıdı algılar, masa/el gibi arka planı atar, eğik çekimi düzleştirir. PDF ve taramalara uygulanmaz." })), oto);

  const tarama = segment({ baslik: "Tarama", deger: ayar.mod, secenekler: [
    ["sihirli", "Renkli temiz", "Gölgeyi ve sararmayı siler, kâğıdı beyazlatır; mühür/imza rengi korunur. Faturalar için en iyisi."],
    ["bw", "Siyah-beyaz", "Fotokopi gibi keskin siyah yazı; dosya en küçük. Düz metin belgeleri için."],
    ["orijinal", "Orijinal", "Renklere dokunmaz (yalnızca kırpma/düzeltme). Fotoğraf ve renkli çizimler için."]],
  degisince: (v) => { ayar.mod = v; yenidenIsle(); } });

  const kalite = segment({ baslik: "Kalite", deger: ayar.profil, secenekler: Object.entries(PROFILLER).map(([k, p]) => [k, p.ad.replace(" (Önerilen)", ""), `${p.aciklama} · ${p.dpi} DPI · %${p.kalite}. ${k === "web" ? "E-posta/form yüklemek için küçük dosya." : k === "dengeli" ? "Çoğu iş için ideal." : "Arşiv; en büyük dosya."}`]),
    degisince: (v) => { ayar = profilUygula(ayar, v); ayarCiz(); yenidenIsle(); } });

  const cikti = segment({ baslik: "Çıktı", deger: ayar.cikti === "pdf" ? "pdf" : ayar.format, secenekler: [
    ["pdf", "PDF", "Tüm sayfalar tek PDF dosyası."],
    ["jpeg", "JPG", "Her sayfa ayrı JPG görsel (küçük, her yerde açılır)."],
    ["png", "PNG", "Kayıpsız görsel; büyük dosya, kalite ayarı uygulanmaz."],
    ["webp", "WebP", "JPG'den küçük modern görsel (bazı eski uygulamalar açamaz)."],
    ["ayni", "Aynı biçim", "Her sayfa yüklediğin dosyanın biçiminde (JPG→JPG, PNG→PNG; PDF/HEIC → JPG) çıkar."]],
  degisince: (v) => { if (v === "pdf") ayar.cikti = "pdf"; else { ayar.cikti = "gorsel"; ayar.format = v; } paketSatiri.hidden = ayar.cikti === "pdf"; eylemGuncelle(); tahminiTetikle(); } });

  const paket = segment({ baslik: "Paket", deger: ayar.paket, secenekler: [["zip", "ZIP", "Görseller tek ZIP dosyasında iner."], ["tek", "Tek tek", "Her görsel ayrı iner (tarayıcı birden çok indirme için izin isteyebilir)."]],
    degisince: (v) => { ayar.paket = v; eylemGuncelle(); } });
  const paketSatiri = paket.el; paketSatiri.hidden = ayar.cikti === "pdf";

  // Gelişmiş
  const kal = aralik({ id: "bt-kalite", etiket: "Görsel kalitesi", aciklama: "Yüksek = net ama büyük dosya. 80 çoğu belge için fark edilmez; 55 altı yazıda bulanıklık yapabilir.", min: 10, max: 100, adim: 1, deger: ayar.kalite, bicim: (v) => `%${v}`,
    degisince: (v) => { ayar.kalite = v; ayar.profil = "ozel"; kalite.guncelle("ozel"); tahminiTetikle(); } });
  const dpi = aralik({ id: "bt-dpi", etiket: "A4 yoğunluğu (DPI)", aciklama: "Sayfanın piksel yoğunluğu. 150-200 ekran/e-posta, 300 baskı. Küçük kaynak büyütülmez.", min: 72, max: 300, adim: 2, deger: ayar.dpi, bicim: (v) => `${v} DPI`,
    degisince: (v) => { ayar.dpi = v; ayar.profil = "ozel"; kalite.guncelle("ozel"); tahminiTetikle(); } });
  const coz = secimAlani("Çözünürlük sınırı", "bt-cozunurluk", Object.entries(COZUNURLUKLER), ayar.cozunurluk, (v) => { ayar.cozunurluk = v; ayar.profil = "ozel"; kalite.guncelle("ozel"); dpi.r.disabled = v !== "a4"; tahminiTetikle(); }, "Sayfanın en fazla ulaşacağı boyut. \"A4\" seçiliyken yukarıdaki DPI geçerlidir.");
  dpi.r.disabled = ayar.cozunurluk !== "a4";
  const sayfa = secimAlani("PDF sayfa boyutu", "bt-sayfa", [["a4", "A4 (sığdır, ortala)"], ["gorsel", "Görsel boyutunda"]], ayar.sayfa, (v) => { ayar.sayfa = v; }, "A4: standart yazdırılabilir sayfa. Görsel boyutu: kenar boşluğu olmayan, belgenin kendi ölçüsü.");
  const zip = secimAlani("ZIP sıkıştırma", "bt-zip", [["6", "Seviye 6 (hızlı)"], ["7", "Seviye 7"], ["8", "Seviye 8"], ["9", "Seviye 9 (en küçük)"]], String(ayar.zipSeviye), (v) => { ayar.zipSeviye = Number(v); }, "JPG zaten sıkışıktır; kazanç küçüktür.");

  const gelismis = el("details", { class: "bt-gelismis" }, el("summary", { text: "Gelişmiş ayarlar" }), el("div", { class: "bt-gel-izgara" }, kal.el, dpi.el, coz.el, sayfa.el, zip.el));

  return el("section", { class: "dn-kart bt-ayarlar", "aria-labelledby": "bt-ayar-baslik" },
    el("h3", { id: "bt-ayar-baslik", text: "Ayarlar" }), otoSatir, tarama.el, kalite.el, cikti.el, paketSatiri, gelismis);
}

function ayarCiz() { const eski = ayarKapEl?.querySelector(".bt-ayarlar"); const yeni = ayarKarti(); if (eski) eski.replaceWith(yeni); else ayarKapEl?.append(yeni); }

/* ------------------------------ sayfa kartları ------------------------------ */

function durumMetni(o) {
  if (o.algi === "bekliyor") return ["bt-durum--bekle", "Belge aranıyor…"];
  if (o.algi === "otomatik") return ["bt-durum--iyi", "✓ Belge kesildi"];
  if (o.algi === "elle") return ["bt-durum--iyi", "✂ Elle ayarlandı"];
  if (o.algi === "yok") return ["bt-durum--uyari", "Kenar bulunamadı · ayarla"];
  return ["", ""];
}

function kartOlustur(o) {
  const btn = (ikon, ad, fn) => { const b = dugme({ ikon, kucuk: true, tur: "hayalet", "aria-label": ad, title: ad }); b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
  const sol = btn("◀", "Öne al", () => tasi(o, -1));
  const sag = btn("▶", "Sona al", () => tasi(o, 1));
  const don = btn("↻", "90° döndür", () => { o.dondur = (o.dondur + 90) % 360; if (o.kose) o.kose = kosalariDondur(o.kose, 1); degisti(o); });
  const mod = btn("◐", "Bu sayfanın tarama modunu değiştir (genel → renkli → siyah-beyaz → orijinal)", () => { o.mod = MOD_SIRA[(MOD_SIRA.indexOf(o.mod) + 1) % MOD_SIRA.length]; degisti(o); });
  const kes = btn("✂", "Kenarları düzelt (4 köşe)", async () => {
    try { const k = await koseDuzenle(o); if (k) { o.kose = k; o.algi = "elle"; degisti(o); } } catch (h) { bildir(h.message || String(h), "error"); }
  });
  const sil = btn("✕", "Sayfayı kaldır", () => ogeSil(o));
  const resimKap = el("div", { class: "bt-resim" });
  const sira = el("span", { class: "bt-sira" });
  const durum = el("span", { class: "bt-durum" });
  const ad = el("span", { class: "bt-ad", title: o.ad, text: o.ad });
  const li = el("li", { class: "bt-kart", draggable: "true", "data-id": String(o.id) }, sira, resimKap, durum, ad, el("div", { class: "bt-kart-eylem" }, sol, sag, don, mod, kes, sil));
  resimKap.addEventListener("click", () => kes.click());
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
  li._ref = { sol, sag, sil, sira, resimKap, durum, mod, ad };
  return li;
}

/** Tek kartın içeriğini günceller (tüm listeyi yeniden kurmaz → önizleme gelince titreme/yeniden çizim yok). */
function kartGuncelle(o) {
  const li = kartlar.get(o.id); if (!li) return;
  const r = li._ref;
  const img = r.resimKap.firstElementChild;
  if (o.onizUrl) {
    if (img?.tagName === "IMG") { if (img.getAttribute("src") !== o.onizUrl) img.src = o.onizUrl; } else r.resimKap.replaceChildren(el("img", { class: "bt-kucuk", src: o.onizUrl, alt: `Sayfa: ${o.ad}`, draggable: "false" }));
  } else if (!img || img.tagName === "IMG") r.resimKap.replaceChildren(el("div", { class: "bt-kucuk bt-kucuk--bos", text: o.onizHata ? "Önizleme yok" : "…" }));
  const [sinif, metin] = durumMetni(o);
  r.durum.className = `bt-durum ${sinif}`; r.durum.textContent = metin;
  const m = o.mod !== "genel" ? ` · ${MOD_AD[o.mod]}` : "";
  r.ad.textContent = `${o.ad}${m}`;
  r.mod.classList.toggle("bt-aktif", o.mod !== "genel");
}

function ciz() {
  const sirali = [];
  ogeler.forEach((o, i) => {
    let li = kartlar.get(o.id);
    if (!li) { li = kartOlustur(o); kartlar.set(o.id, li); kartGuncelle(o); }
    li._ref.sira.textContent = String(i + 1);
    li._ref.sol.disabled = i === 0; li._ref.sag.disabled = i === ogeler.length - 1; li._ref.sil.disabled = !!calisiyor;
    sirali.push(li);
  });
  listeEl.replaceChildren(...sirali);
  const toplam = ogeler.reduce((a, o) => a + (o.orijinalBayt || 0), 0);
  sayacEl.textContent = ogeler.length ? `${ogeler.length} sayfa · kaynak ${bayt(toplam)}` : "Henüz sayfa yok";
  const durum = bellekDurumu();
  bellekEl.textContent = `RAM: ${durum.tuval} tuval · ${durum.url} URL`;
  const bos0 = !ogeler.length; const mesgul = !!calisiyor || !!ayikla;
  if (bosAlanEl) bosAlanEl.hidden = !bos0;
  listeEl.hidden = bos0;
  if (ayarKapEl) ayarKapEl.hidden = bos0;
  for (const [ad, b] of Object.entries(butonlar)) b.disabled = ad === "iptal" ? !(calisiyor || ayikla) : (ad === "ekle" || ad === "kamera") ? !!calisiyor : (bos0 || mesgul);
}

function bosAlan() {
  const dz = el("div", { class: "dn-dropzone bt-dropzone", role: "button", tabindex: "0", "aria-label": "Dosya eklemek için tıkla ya da dosyaları buraya bırak" },
    el("span", { class: "dn-dropzone-ikon", "aria-hidden": "true", text: "🗂️" }),
    el("strong", { text: "Belge fotoğrafı, PDF veya Word ekle" }),
    el("span", { class: "dn-muted", text: "Sürükle-bırak ya da dokun. JPG, PNG, WebP, HEIC, TIFF, PDF, DOCX. Yeni dosyalar listenin sonuna eklenir." }));
  dz.addEventListener("click", () => girdiEl.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); girdiEl.click(); } });
  return dz;
}

function bagliSurukle(hedef) {
  const dosyaMi = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  for (const o of ["dragenter", "dragover"]) hedef.addEventListener(o, (e) => { if (dosyaMi(e)) { e.preventDefault(); hedef.classList.add("dn-surukle"); } });
  for (const o of ["dragleave", "drop"]) hedef.addEventListener(o, () => hedef.classList.remove("dn-surukle"));
  hedef.addEventListener("drop", (e) => { if (dosyaMi(e)) { e.preventDefault(); dosyalariAl([...e.dataTransfer.files]); } });
}

girdiEl.addEventListener("change", () => { dosyalariAl([...girdiEl.files]); girdiEl.value = ""; });
kameraEl.addEventListener("change", () => { dosyalariAl([...kameraEl.files]); kameraEl.value = ""; });

/* ------------------------------ dışa aktarma ------------------------------ */

async function aktar(paylasim) {
  if (calisiyor || !ogeler.length) return;
  bildir("");
  const ctx = isBaglami((o, m) => ilerleme.ayarla(o, m));
  calisiyor = ctx; ciz();
  ilerleme.ayarla(0, "Başlıyor…");
  try {
    const r = await uret(ogeler.slice(), { ...ayar }, ctx);
    const boyut = toplamBayt(r.dosyalar);
    let sonuc = "indirildi";
    if (paylasim) {
      try { await paylas(r.dosyalar); sonuc = "paylaşıldı"; } catch (h) {
        if (h?.name === "AbortError") sonuc = "iptal";
        else { await indir(r.dosyalar, ctx); sonuc = "indirildi (paylaşım bu tarayıcıda/an kullanılamadı)"; }
      }
    } else await indir(r.dosyalar, ctx);
    if (sonuc !== "iptal") bildir(`${ciktiEtiketi()} ${sonuc}: ${ogeler.length} sayfa, ${bayt(boyut)}.${r.not ? ` ${r.not}` : ""}`, "success");
  } catch (h) {
    if (h instanceof IptalHatasi) bildir("İşlem iptal edildi; geçici bellek serbest bırakıldı.", "info");
    else bildir(`Oluşturulamadı: ${hataMetni(h)}`, "error");
  } finally {
    calisiyor = null; ilerleme.gizle(); ciz();
  }
}

function eylemGuncelle() {
  if (!butonlar.indir) return;
  const m = butonlar.indir.querySelector(".dn-btn-metin");
  if (m) m.textContent = ayar.cikti === "pdf" ? "PDF indir" : ayar.paket === "tek" || ogeler.length === 1 ? `${ciktiEtiketi()} indir` : `${ciktiEtiketi()} (ZIP) indir`;
}

function eylemKarti() {
  const mk = (ad, ikon, metin, tur) => (butonlar[ad] = dugme({ ikon, metin, tur }));
  const ind = mk("indir", "⬇️", "PDF indir", "birincil");
  const pay = mk("paylas", "📤", "Paylaş");
  const iptal = mk("iptal", "⏹️", "İptal");
  ind.addEventListener("click", () => aktar(false));
  pay.addEventListener("click", () => aktar(true));
  iptal.addEventListener("click", () => { ayikla?.iptal(); calisiyor?.iptal(); });
  const destek = typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";
  pay.hidden = !destek; // yalnızca dosya paylaşımı destekleyen cihazda (telefon/Safari/Chrome Android) görünür
  return el("div", { class: "bt-eylemler" }, el("div", { class: "bt-eylem-dugmeler" }, ind, pay, iptal), tahminEl, ilerleme.el);
}

/* ------------------------------ bellek / yaşam döngüsü ------------------------------ */

function oturumuSifirla() {
  ayikla?.iptal(); calisiyor?.iptal();
  for (const o of ogeler) { if (o.onizUrl) urlBirak(o.onizUrl); o.blob = null; o.onizUrl = null; }
  ogeler = []; kartlar.clear();
  hepsiniBirak();
  tahminEl.textContent = "";
  ciz();
}

function ayrilirkenSor() {
  if (!ogeler.length) return Promise.resolve(true);
  return onayIste({ baslik: "Sekmeden ayrılıyorsun", metin: `Kuyruktaki ${ogeler.length} sayfa bellekten silinecek (sunucuda zaten kopya yok).`, tamam: "Sil ve ayrıl", vazgec: "Burada kal", tehlike: true })
    .then((ok) => { if (ok) oturumuSifirla(); return ok; });
}

async function yonetimNotu() {
  const { data } = await supabase.rpc("donusturucu_yonetim_yetkisi_var_mi");
  if (data !== true) return null;
  return el("p", { class: "dn-muted", }, "Bu aracı kimlerin kullanabileceği: ", el("a", { href: "#sys-yetki", text: "Sistem & Güvenlik → Yetki Ayarları" }), ".");
}

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) {
    kok.replaceChildren(el("div", { class: "dn-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "dn-muted", text: "Bu araca erişim yetkin bulunmuyor. Gerekirse site sahibinden talep et." })));
    return;
  }
  kok.classList.add("dn-kok", "bt-kok");

  const ekle = dugme({ metin: "Dosya ekle", ikon: "＋", tur: "birincil" });
  const kamera = dugme({ metin: "Kamera", ikon: "📷" });
  const bosalt = dugme({ metin: "Boşalt", ikon: "🗑️", tur: "hayalet", title: "Tüm sayfaları, önizlemeleri ve tuvalleri bellekten siler" });
  butonlar.ekle = ekle; butonlar.kamera = kamera; butonlar.bosalt = bosalt;
  ekle.addEventListener("click", () => girdiEl.click());
  kamera.addEventListener("click", () => kameraEl.click());
  bosalt.addEventListener("click", async () => {
    if (!ogeler.length) return;
    if (await onayIste({ baslik: "Kuyruk boşaltılsın mı?", metin: "Tüm sayfalar bellekten silinir.", tamam: "Boşalt", tehlike: true })) { oturumuSifirla(); bildir("Kuyruk boşaltıldı, bellek temizlendi.", "success"); }
  });

  const gizlilik = el("p", { class: "bt-gizlilik" }, "🔒 Dosyaların cihazından çıkmaz; her şey tarayıcında işlenir.");
  const ust = el("div", { class: "bt-ust" }, el("div", { class: "bt-ust-sol" }, ekle, kamera, sayacEl), el("div", { class: "bt-ust-sag" }, bellekEl, bosalt));
  bosAlanEl = bosAlan();
  ayarKapEl = el("div", { class: "bt-ayar-kap" });
  const eylem = el("section", { class: "dn-kart bt-eylem-kart" }, eylemKarti());
  ayarKapEl.append(ayarKarti(), eylem);
  kok.replaceChildren(gizlilik, ust, bosAlanEl, listeEl, ayarKapEl, girdiEl, kameraEl);
  bagliSurukle(kok);
  ciz(); eylemGuncelle();
  yonetimNotu().then((n) => { if (n) kok.append(n); }).catch(() => {});
  window.addEventListener("pagehide", () => { try { oturumuSifirla(); } catch { /* yok say */ } });
  ayrilmaKancasiKaydet("tool-belge-tarayici", ayrilirkenSor);
}

kur().catch((h) => { console.error("belge-tarayici.js:", h); bildir(`Araç yüklenemedi: ${h.message || h}`, "error"); });
