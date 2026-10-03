/*
 * assets/js/r2-arsiv/r2-arsiv.js — R2 Dosya Yöneticisi (dashboard modülü "arsiv")
 *
 * KOTA İLKESİ: liste / gezinme / arama / klasör işlemleri YALNIZCA Supabase `r2_arsiv`
 * tablosundan çalışır; R2'ye ListObjectsV2 atılmaz. R2'ye sadece yükleme (PUT), indirme (GET)
 * ve doğrulama (HEAD) gider; hepsi presigned URL ile tarayıcıdan, Worker yalnızca imzalar
 * ve kotayı sayar.
 *
 * CSP: inline style/handler yok; DOM yalnızca createElement/textContent ile kurulur.
 */
import { supabase } from "../core/supabase-client.js";
import { anahtarlariHazirla, aliciAnahtarlariniGetir, dosyaCoz, anahtariYenidenZarfla } from "./e2ee.js";
import {
  el, btn, boyutYaz, tarihYaz, aramaKelimeleri, normalize, vurgulu, worker, adGecerli,
  kategori, KATEGORI_IKON, basHarfler, avatarSinifi, ROL_ETIKETI,
} from "./ortak.js";
import { aliciSeciciKur } from "./alici-secici.js";
import { dosyalariTopla, kuyrukKur } from "./yukleme.js";
import { paylasilanGorunumuKur, paylastiklarimGorunumuKur } from "./ozel-gorunumler.js";

const SAYFA = 100;
const SUTUNLAR = "id,tur,ad,klasor_yolu,boyut,mime,gercek_mime,sifreli,sahip_id,created_at";
const GUVENLI_BLOB_TURLERI = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "text/plain", "text/csv", "application/json", "application/zip",
]);
const GORSEL_TURLERI = /^image\/(png|jpeg|gif|webp|avif)$/;
// "ad" sıralaması Türkçe alfabeye göredir (ç, ğ, ı, ö, ş, ü yerinde): sunucuda ad_sira sütunu (0063).
// 0063 henüz çalıştırılmadıysa sütun yoktur; o zaman sessizce düz "ad" sıralamasına düşülür.
const SIRA_ALANI = { ad: "ad_sira", tarih: "created_at", boyut: "boyut" };

const durum = {
  uid: null, yetki: { oku: false, yukle: false, sil: false, paylasilan_var: false },
  sekme: "arsiv", yol: "", arama: "", filtre: "hepsi", sirala: "ad-asc", gorunum: "liste",
  sayfa: 0, veri: [], dahaVar: false, secili: new Set(),
  istekNo: 0, yuklenenArama: false, adSiraYok: false,
};
let k = {};
let kuyruk = null;
let gPaylasilan = null, gPaylastiklarim = null;   // ayrı ekranlar (ozel-gorunumler.js)

/* ------------------------------ küçük yardımcılar ------------------------------ */
let toastZamanlayici = null;
function bildir(metin, tur = "hata") {
  clearTimeout(toastZamanlayici);
  k.mesaj.textContent = metin || "";
  k.mesaj.hidden = !metin;
  k.mesaj.className = `ra-toast ${tur === "hata" ? "ra-toast-hata" : "ra-toast-ok"}`;
  if (metin) toastZamanlayici = setTimeout(() => { k.mesaj.hidden = true; }, tur === "hata" ? 12000 : 5000);
}
function tercihOku(anahtar, varsayilan) { try { return localStorage.getItem(anahtar) || varsayilan; } catch { return varsayilan; } }
function tercihYaz(anahtar, deger) { try { localStorage.setItem(anahtar, deger); } catch { /* özel pencere vb. */ } }

const arsivSekmesi = () => durum.sekme === "arsiv";
const yukleyebilir = () => durum.yetki.yukle;
const kendimin = (s) => s.sahip_id === durum.uid;

/* --------------------------------- diyaloglar --------------------------------- */
function metinSor({ baslik, etiket, deger = "", tamam = "Tamam", dogrula }) {
  const dlg = k.dlgMetin, girdi = k.dlgMetinGirdi, hata = k.dlgMetinHata, form = k.dlgMetinForm;
  k.dlgMetinBaslik.textContent = baslik; k.dlgMetinEtiket.textContent = etiket;
  k.dlgMetinTamam.textContent = tamam; girdi.value = deger; hata.hidden = true;
  return new Promise((coz) => {
    const bitir = (v) => {
      form.removeEventListener("submit", gonder); k.dlgMetinIptal.removeEventListener("click", vazgec);
      dlg.removeEventListener("cancel", vazgec); if (dlg.open) dlg.close(); coz(v);
    };
    const vazgec = (e) => { e?.preventDefault?.(); bitir(null); };
    const gonder = (e) => {
      e.preventDefault();
      const v = girdi.value.trim();
      const h = dogrula?.(v);
      if (h) { hata.textContent = h; hata.hidden = false; girdi.focus(); return; }
      bitir(v);
    };
    form.addEventListener("submit", gonder); k.dlgMetinIptal.addEventListener("click", vazgec); dlg.addEventListener("cancel", vazgec);
    dlg.showModal(); girdi.focus(); girdi.select();
  });
}

function onayAl({ baslik, metin, tamam = "Sil" }) {
  const dlg = k.dlgOnay;
  k.dlgOnayBaslik.textContent = baslik; k.dlgOnayMetin.textContent = metin; k.dlgOnayTamam.textContent = tamam;
  return new Promise((coz) => {
    const form = dlg.querySelector("form");
    const bitir = (v) => {
      form.removeEventListener("submit", gonder); k.dlgOnayIptal.removeEventListener("click", vazgec);
      dlg.removeEventListener("cancel", vazgec); if (dlg.open) dlg.close(); coz(v);
    };
    const vazgec = (e) => { e?.preventDefault?.(); bitir(false); };
    const gonder = (e) => { e.preventDefault(); bitir(true); };
    form.addEventListener("submit", gonder); k.dlgOnayIptal.addEventListener("click", vazgec); dlg.addEventListener("cancel", vazgec);
    dlg.showModal(); k.dlgOnayIptal.focus();
  });
}

/* --------------------------------- liste çekme --------------------------------- */
async function listele(devam = false) {
  if (!arsivSekmesi()) return;                      // özel ekranların kendi yükleyicisi var
  const no = ++durum.istekNo;
  if (!devam) {
    durum.sayfa = 0; durum.veri = []; durum.secili.clear(); durum.dahaVar = false;
    k.liste.setAttribute("aria-busy", "true");
    secimGuncelle();
  }

  let veri = null, hata = null;
  const [alan, yon] = durum.sirala.split("-");

  if (durum.arama) {
    const r = await supabase.rpc("r2_arsiv_ara", { p_q: durum.arama, p_sinir: 100 });
    veri = (r.data || []).filter((s) => !s.sifreli);          // Arşiv = yalnızca şifresiz içerik
    hata = r.error; durum.dahaVar = false;
  } else {
    const bas = durum.sayfa * SAYFA;
    const sorgu = (siraAlani) => {
      let q = supabase.from("r2_arsiv").select(SUTUNLAR).eq("durum", "hazir").eq("sifreli", false).eq("klasor_yolu", durum.yol);
      q = q.order("tur", { ascending: false }).order(siraAlani, { ascending: yon === "asc" });
      if (alan !== "ad") q = q.order("ad");
      return q.range(bas, bas + SAYFA - 1);
    };
    const siraAlani = alan === "ad" && durum.adSiraYok ? "ad" : SIRA_ALANI[alan];
    let r = await sorgu(siraAlani);
    if (r.error && siraAlani === "ad_sira") { durum.adSiraYok = true; r = await sorgu("ad"); }   // 0063 yok: eski sıralama
    veri = r.data; hata = r.error;
    durum.dahaVar = (veri?.length || 0) === SAYFA;
  }
  if (no !== durum.istekNo) return;                 // daha yeni bir istek var; bunu at

  k.liste.setAttribute("aria-busy", "false");
  if (hata) {
    console.warn("liste:", hata.message);
    bildir("Liste alınamadı. 0057, 0058, 0062 ve 0063 SQL dosyalarının Supabase'te çalıştığından emin ol.");
    durum.veri = []; ciz(true); return;
  }
  durum.veri = durum.veri.concat(veri || []);
  durum.sayfa++;
  ciz();
}

/* -------------------------------- çizim -------------------------------- */
function gorunenler() {
  let v = durum.veri;
  if (!arsivSekmesi() && durum.arama) {            // diğer sekmelerde arama istemci tarafında
    const kel = aramaKelimeleri(durum.arama);
    v = v.filter((s) => { const n = normalize(s.ad); return kel.every((x) => n.includes(x)); });
  }
  if (durum.filtre === "sifreli") return v.filter((s) => s.sifreli);
  if (durum.filtre !== "hepsi") return v.filter((s) => kategori(s) === durum.filtre);
  return v;
}

function bosMesaji(hataVar) {
  if (hataVar) return "Liste yüklenemedi.";
  if (durum.arama) return `“${durum.arama}” için sonuç bulunamadı. Daha kısa ya da farklı bir kelime dene.`;
  if (durum.filtre !== "hepsi") return "Bu filtreyle eşleşen öğe yok.";
  return yukleyebilir() ? "Bu klasör boş. Dosyaları buraya sürükleyip bırakabilir ya da yukarıdan yükleyebilirsin." : "Bu klasör boş.";
}

function ciz(hataVar = false) {
  const liste = gorunenler();
  const kel = arsivSekmesi() && durum.arama ? aramaKelimeleri(durum.arama) : [];
  k.liste.replaceChildren(...liste.map((s) => satirYap(s, kel)));
  k.bos.hidden = liste.length > 0;
  if (!liste.length) k.bos.textContent = bosMesaji(hataVar);
  k.daha.hidden = !durum.dahaVar;
  k.liste.classList.toggle("ra-izgara", durum.gorunum === "izgara");
  yolCiz(liste.length);
  secimGuncelle();
}

function ikonButonu(simge, etiket, tikla, ekSinif = "") {
  return btn(simge, `ra-ikon-btn ${ekSinif}`.trim(), tikla, { "aria-label": etiket, title: etiket });
}

function satirYap(s, kelimeler) {
  const kat = kategori(s);
  const li = el("li", `ra-satir ra-k-${kat}`);
  li.dataset.id = s.id;
  if (durum.secili.has(s.id)) li.classList.add("ra-secili");

  const secilebilir = arsivSekmesi() && durum.yetki.sil;
  if (secilebilir) {
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "ra-sec"; cb.checked = durum.secili.has(s.id);
    cb.setAttribute("aria-label", `${s.ad} seç`);
    cb.addEventListener("change", () => {
      if (cb.checked) durum.secili.add(s.id); else durum.secili.delete(s.id);
      li.classList.toggle("ra-secili", cb.checked); secimGuncelle();
    });
    li.appendChild(cb);
  } else li.appendChild(el("span", "ra-sec-yer"));

  li.appendChild(el("span", "ra-ikon", s.sifreli && s.tur === "dosya" ? "🔒" : KATEGORI_IKON[kat]));

  const govde = el("div", "ra-govde");
  const adBtn = el("button", `ra-ad ${s.tur === "klasor" || kat === "gorsel" || kat === "pdf" ? "ra-tiklanir" : ""}`.trim());
  adBtn.type = "button"; adBtn.title = s.ad;
  vurgulu(adBtn, s.ad, kelimeler);
  adBtn.addEventListener("click", () => {
    if (s.tur === "klasor") klasoreGit(s.klasor_yolu + s.ad + "/");
    else if (kat === "gorsel" || (kat === "pdf" && !s.sifreli)) onizle(s);
    else indir(s);
  });
  govde.appendChild(adBtn);

  const meta = el("div", "ra-meta-satir");
  if (s.tur === "dosya") meta.appendChild(el("span", "ra-meta", boyutYaz(s.boyut)));
  meta.appendChild(el("span", "ra-meta", tarihYaz(s.created_at)));
  if (s.sifreli) meta.appendChild(el("span", "ra-rozet", "Şifreli"));
  if (arsivSekmesi() && durum.arama && s.klasor_yolu) {
    meta.appendChild(btn(`📁 /${s.klasor_yolu}`, "ra-yol-chip", () => klasoreGit(s.klasor_yolu), { title: "Klasörü aç" }));
  }
  govde.appendChild(meta);
  li.appendChild(govde);

  const islem = el("div", "ra-islemler");
  if (s.tur === "dosya") {
    if (kat === "gorsel" || (kat === "pdf" && !s.sifreli)) islem.appendChild(ikonButonu("👁", "Önizle", () => onizle(s)));
    islem.appendChild(ikonButonu("⬇", "İndir", (e) => indir(s, e.currentTarget)));
    if (s.sifreli && kendimin(s)) islem.appendChild(ikonButonu("👥", "Paylaşımı yönet", () => paylasAc(s)));
  }
  if (arsivSekmesi() && yukleyebilir() && (!s.sifreli || kendimin(s))) islem.appendChild(ikonButonu("✏️", "Yeniden adlandır", () => adlandir(s)));
  if (durum.yetki.sil && (arsivSekmesi() || durum.sekme === "paylastiklarim")) islem.appendChild(ikonButonu("🗑", "Sil", () => sil(s), "ra-btn-tehlike"));
  li.appendChild(islem);
  return li;
}

function yolCiz(sonucSayisi) {
  k.yol.replaceChildren();
  k.yol.hidden = !arsivSekmesi();
  if (!arsivSekmesi()) return;
  if (durum.arama) {
    const li = el("li", "ra-yol-bilgi");
    li.append(el("span", "", `“${durum.arama}” için ${sonucSayisi} sonuç${durum.veri.length >= 100 ? " (ilk 100)" : ""}`));
    li.appendChild(btn("Aramayı temizle", "ra-yol-chip", () => aramayiTemizle()));
    k.yol.appendChild(li); return;
  }
  const parcalar = durum.yol.split("/").filter(Boolean);
  const ekle = (etiket, hedef, son) => {
    const li = el("li"); const b = btn(etiket, "", () => { if (!son) klasoreGit(hedef); });
    if (son) b.setAttribute("aria-current", "page");
    li.appendChild(b); k.yol.appendChild(li);
  };
  ekle("🏠 Ana klasör", "", parcalar.length === 0);
  let birikim = "";
  parcalar.forEach((p, i) => { birikim += p + "/"; ekle(p, birikim, i === parcalar.length - 1); });
}

function hedefYaz() { k.hedef.textContent = `Arşiv yükleme hedefi: /${durum.yol}`; }

function klasoreGit(yol) {
  if (durum.sekme !== "arsiv") sekmeDegistir("arsiv", false);
  durum.yol = yol; durum.arama = ""; k.ara.value = ""; k.araTemizle.hidden = true; k.sirala.disabled = false;
  hedefYaz(); listele();
}

function aramayiTemizle() {
  k.ara.value = ""; durum.arama = ""; k.araTemizle.hidden = true; k.sirala.disabled = false; listele();
}

/** Aktif ekranı yeniden yükler (Arşiv ya da özel ekranlar). */
function yenile() {
  if (arsivSekmesi()) listele();
  else if (durum.sekme === "paylastiklarim") gPaylastiklarim?.yukle();
  else if (durum.sekme === "paylasilan") gPaylasilan?.yukle();
  ozetYukle();
}

/* ------------------------------- seçim / toplu işlem ------------------------------- */
function secimGuncelle() {
  const n = durum.secili.size;
  k.secimBar.hidden = n === 0;
  k.secimSayi.textContent = `${n} öğe seçili`;
  const gorunen = gorunenler();
  k.hepsiniSec.checked = n > 0 && gorunen.length > 0 && gorunen.every((s) => durum.secili.has(s.id));
}

async function topluSil() {
  const idler = [...durum.secili];
  if (!idler.length) return;
  const ok = await onayAl({ baslik: `${idler.length} öğe silinsin mi?`, metin: "Seçilen dosyalar ve klasörlerin (içindekiler dahil) kalıcı olarak silinecek. Bu işlem geri alınamaz.", tamam: "Hepsini sil" });
  if (!ok) return;
  let basarili = 0, basarisiz = 0;
  for (const id of idler) {
    bildir(`Siliniyor… ${basarili + basarisiz + 1}/${idler.length}`, "ok");
    try { await worker("/sil", { id }); basarili++; }
    catch (e) { if (e.durum === 404) basarili++; else basarisiz++; }   // üst klasörle birlikte zaten gitmiş olabilir
  }
  bildir(basarisiz ? `${basarili} öğe silindi, ${basarisiz} öğe silinemedi.` : `${basarili} öğe silindi.`, basarisiz ? "hata" : "ok");
  listele(); ozetYukle();
}

/* ---------------------------- klasör / ad / silme ---------------------------- */
async function yeniKlasor() {
  const ad = await metinSor({
    baslik: "Yeni klasör", etiket: `Klasör adı (/${durum.yol})`, tamam: "Oluştur",
    dogrula: (v) => (adGecerli(v) ? "" : "Geçerli bir ad gir ('/' ve '\\' kullanılamaz)."),
  });
  if (!ad) return;
  const { error } = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: durum.yol, p_ad: ad });
  if (error) return bildir(error.message || "Klasör oluşturulamadı.");
  bildir("Klasör oluşturuldu.", "ok"); listele();
}

async function adlandir(s) {
  const yeni = await metinSor({
    baslik: s.tur === "klasor" ? "Klasörü yeniden adlandır" : "Dosyayı yeniden adlandır",
    etiket: "Yeni ad", deger: s.ad, tamam: "Kaydet",
    dogrula: (v) => (!adGecerli(v) ? "Geçerli bir ad gir ('/' ve '\\' kullanılamaz)." : ""),
  });
  if (!yeni || yeni === s.ad) return;
  const { error } = await supabase.rpc("r2_arsiv_yeniden_adlandir", { p_id: s.id, p_yeni_ad: yeni });
  if (error) return bildir(error.message || "Yeniden adlandırılamadı.");
  bildir("Ad güncellendi.", "ok"); listele();             // R2 işlemi yok: anahtarlar opak
}

async function sil(s) {
  const ok = await onayAl({
    baslik: s.tur === "klasor" ? "Klasör silinsin mi?" : "Dosya silinsin mi?",
    metin: s.tur === "klasor" ? `“${s.ad}” klasörü ve İÇİNDEKİ HER ŞEY kalıcı olarak silinecek.` : `“${s.ad}” kalıcı olarak silinecek.`,
  });
  if (!ok) return;
  try { await worker("/sil", { id: s.id }); bildir("Silindi.", "ok"); yenile(); }
  catch (e) { bildir(e.message); }
}

/* ---------------------------- indirme / önizleme ---------------------------- */
function blobIndir(blob, ad) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = ad; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function sifreliBlob(s) {
  const { url } = await worker("/indir", { id: s.id });
  const [{ data: zarf, error }, r] = await Promise.all([
    supabase.from("ozel_icerik_anahtarlar").select("sarili_dosya_anahtari").eq("dosya_id", s.id).eq("alici_id", durum.uid).maybeSingle(),
    fetch(url),
  ]);
  if (error || !zarf) throw new Error("Bu dosya için anahtarın yok.");
  if (!r.ok) throw new Error("Dosya R2'den alınamadı.");
  const duz = await dosyaCoz(await r.arrayBuffer(), zarf.sarili_dosya_anahtari, s.id);
  const tur = GUVENLI_BLOB_TURLERI.has(s.gercek_mime) ? s.gercek_mime : "application/octet-stream";
  return new Blob([duz], { type: tur });
}

async function indir(s, dugme) {
  if (dugme) dugme.disabled = true;
  try {
    if (!s.sifreli) { const { url } = await worker("/indir", { id: s.id }); window.location.assign(url); }
    else { bildir("Çözülüyor…", "ok"); blobIndir(await sifreliBlob(s), s.ad); bildir(""); }
  } catch (e) { bildir(e.message); }
  finally { if (dugme) dugme.disabled = false; }
}

let onizlemeUrl = null;
function onizlemeKapat() {
  if (onizlemeUrl) { URL.revokeObjectURL(onizlemeUrl); onizlemeUrl = null; }
  k.onizlemeImg.removeAttribute("src");
  if (k.dlgOnizleme.open) k.dlgOnizleme.close();
}

async function onizle(s) {
  const kat = kategori(s);
  try {
    if (kat === "pdf" && !s.sifreli) {                 // PDF: yeni sekmede (satır içi imzalı bağlantı)
      const { url } = await worker("/indir", { id: s.id, satir_ici: true });
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); a.remove(); return;
    }
    if (kat !== "gorsel") return indir(s);
    k.onizlemeBaslik.textContent = s.ad; k.onizlemeImg.alt = s.ad; k.onizlemeHata.hidden = true;
    k.onizlemeImg.removeAttribute("src");
    k.onizlemeIndir.onclick = () => indir(s, k.onizlemeIndir);
    k.dlgOnizleme.showModal();
    if (s.sifreli) {
      const blob = await sifreliBlob(s);
      if (!GORSEL_TURLERI.test(blob.type)) throw new Error("Bu dosya görsel olarak önizlenemiyor; indir.");
      onizlemeUrl = URL.createObjectURL(blob); k.onizlemeImg.src = onizlemeUrl;
    } else {
      const { url } = await worker("/indir", { id: s.id, satir_ici: true });
      k.onizlemeImg.src = url;
    }
  } catch (e) {
    if (k.dlgOnizleme.open) { k.onizlemeHata.textContent = e.message; k.onizlemeHata.hidden = false; }
    else bildir(e.message);
  }
}

/* ------------------------------ paylaşım yönetimi ------------------------------ */
let paylasDosya = null;
let paylasIdler = new Set();
function paylasHata(m) { k.paylasHata.textContent = m || ""; k.paylasHata.hidden = !m; }

async function paylasListele() {
  const { data, error } = await supabase.rpc("ozel_icerik_alicilari_getir", { p_dosya_id: paylasDosya.id });
  k.paylasListe.replaceChildren();
  if (error) { paylasHata("Alıcılar alınamadı."); return; }
  paylasIdler = new Set((data || []).map((u) => u.kullanici_id));
  if (!data.length) k.paylasListe.appendChild(el("li", "ra-bos ra-bos-kucuk", "Şu an yalnızca sen erişebiliyorsun."));
  data.forEach((u) => {
    const li = el("li", "ra-paylas-oge");
    li.appendChild(el("span", `ra-avatar ${avatarSinifi(u.ad)}`, basHarfler(u.ad)));
    const m = el("span", "ra-as-metin");
    m.append(el("span", "ra-as-ad", u.ad), el("span", "ra-meta", ROL_ETIKETI[u.rol] || u.rol));
    li.appendChild(m);
    li.appendChild(btn("Kaldır", "ra-btn ra-btn-kucuk ra-btn-tehlike", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const { error: h } = await supabase.rpc("ozel_icerik_alici_kaldir", { p_dosya_id: paylasDosya.id, p_alici_id: u.kullanici_id });
      if (h) { paylasHata(h.message || "Kaldırılamadı."); b.disabled = false; return; }
      paylasHata(""); paylasListele();
    }));
    k.paylasListe.appendChild(li);
  });
}

async function paylasEkle(u) {
  paylasHata("");
  try {
    const { harita, eksik } = await aliciAnahtarlariniGetir([u.id]);
    if (eksik.length) throw new Error(`${u.ad} panele henüz giriş yapmadığı için şifreli dosya alamaz.`);
    const { data: zarf, error } = await supabase.from("ozel_icerik_anahtarlar").select("sarili_dosya_anahtari")
      .eq("dosya_id", paylasDosya.id).eq("alici_id", durum.uid).maybeSingle();
    if (error || !zarf) throw new Error("Bu dosyanın anahtarı bulunamadı.");
    const yeni = await anahtariYenidenZarfla(zarf.sarili_dosya_anahtari, harita.get(u.id));
    const { error: ek } = await supabase.from("ozel_icerik_anahtarlar").insert({ dosya_id: paylasDosya.id, alici_id: u.id, sarili_dosya_anahtari: yeni });
    if (ek) throw new Error(ek.code === "23505" ? `${u.ad} zaten erişebiliyor.` : "Paylaşım kaydedilemedi.");
  } catch (e) { paylasHata(e.message); }
  await paylasListele();
}

async function paylasAc(s) {
  paylasDosya = s; paylasIdler = new Set();
  k.paylasDosyaAd.textContent = `📄 ${s.ad}`;
  paylasHata(""); k.paylasKok.replaceChildren();
  aliciSeciciKur({
    kok: k.paylasKok, yerTutucu: "Paylaşmak için isim ara…", anahtarGerekli: true,
    haric: () => new Set([durum.uid, ...paylasIdler]), sec: paylasEkle,
  });
  k.dlgPaylas.showModal();
  await paylasListele();
}

/* ------------------------------- özet / kota ------------------------------- */
async function ozetYukle() {
  try {
    const { data, error } = await supabase.rpc("r2_arsiv_ozet");
    if (error || !data?.length) { k.ozet.hidden = true; return; }
    const o = data[0];
    const parca = [`${o.dosya_sayisi} dosya`, `${o.klasor_sayisi} klasör`, boyutYaz(o.toplam_boyut)];
    if (yukleyebilir()) {
      const { data: kota } = await supabase.rpc("r2_kota_durumu");
      if (kota?.length) {
        const a = kota.find((x) => x.sinif === "A")?.sayi ?? 0, b = kota.find((x) => x.sinif === "B")?.sayi ?? 0;
        parca.push(`bu ay R2: ${a} yazma · ${b} okuma işlemi`);
      }
    }
    k.ozet.textContent = parca.join(" · "); k.ozet.hidden = false;
  } catch { k.ozet.hidden = true; }
}

/* ------------------------------- sekmeler / kurulum ------------------------------- */
const SEKMELER = [["sekmeArsiv", "arsiv"], ["sekmePaylastiklarim", "paylastiklarim"], ["sekmePaylasilan", "paylasilan"]];

function kontrolleriGuncelle() {
  k.gArsiv.hidden = durum.sekme !== "arsiv";
  k.gPaylastiklarim.hidden = durum.sekme !== "paylastiklarim";
  k.gPaylasilan.hidden = durum.sekme !== "paylasilan";
  k.eylem.hidden = !(arsivSekmesi() && yukleyebilir());
  SEKMELER.forEach(([id, ad]) => k[id].setAttribute("aria-selected", String(durum.sekme === ad)));
}

function sekmeDegistir(sekme, yenileEkran = true) {
  durum.sekme = sekme; durum.arama = ""; k.ara.value = ""; k.araTemizle.hidden = true; k.sirala.disabled = false;
  durum.filtre = "hepsi"; k.filtreler.querySelectorAll(".ra-filtre").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filtre === "hepsi")));
  kontrolleriGuncelle(); hedefYaz();
  if (!yenileEkran) return;
  if (sekme === "arsiv") listele();
  else if (sekme === "paylastiklarim") gPaylastiklarim.yukle();
  else { gPaylasilan.yukle().then(() => rozetGuncelle(0)); }
}

function rozetGuncelle(n) {
  k.sekmePaylasilanSayi.textContent = n ? `${n} yeni` : "";
  k.sekmePaylasilanSayi.hidden = !n;
}

function yuklemeBaslat(girdiSozu) {
  Promise.resolve(girdiSozu).then(async (girdiler) => {
    k.kuyrukKart.hidden = false;
    const r = await kuyruk.ekle(girdiler);
    if (r.kisaltildi) bildir("Tek seferde en fazla 500 dosya alınır; ilk 500 dosya kuyruğa eklendi.", "ok");
    else if (r.duzlestirildi) bildir("Özel gönderimde klasör yapısı korunmaz; dosyalar tek tek gönderiliyor.", "ok");
  }).catch((e) => bildir(e.message || "Yükleme başlatılamadı."));
}

function surukleBirak() {
  let sayac = 0;
  const dosyaVar = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const hedefEkran = () => (arsivSekmesi() && yukleyebilir()) || (durum.sekme === "paylastiklarim" && yukleyebilir());
  const goster = (v) => { k.katman.hidden = !v; };
  k.kok.addEventListener("dragenter", (e) => {
    if (!dosyaVar(e)) return; e.preventDefault(); sayac++;
    if (!hedefEkran()) return;
    k.katmanAlt.textContent = arsivSekmesi()
      ? ` → Arşiv /${durum.yol}`
      : (gPaylastiklarim.aliciSayisi() ? ` → ${gPaylastiklarim.aliciSayisi()} kişiye şifreli gönderim` : " → yalnızca sana (şifreli)");
    goster(true);
  });
  k.kok.addEventListener("dragover", (e) => { if (dosyaVar(e)) e.preventDefault(); });
  k.kok.addEventListener("dragleave", (e) => { if (!dosyaVar(e)) return; sayac = Math.max(0, sayac - 1); if (!sayac) goster(false); });
  k.kok.addEventListener("drop", (e) => {
    if (!dosyaVar(e)) return;
    e.preventDefault(); sayac = 0; goster(false);
    if (!hedefEkran()) return bildir("Bu ekranda yükleme yapılamaz.");
    yuklemeBaslat(dosyalariTopla(e.dataTransfer));   // entry'ler senkron okunur (dosyalariTopla'nın ilk satırları)
  });
}

async function basla() {
  const slot = document.getElementById("slot-arsiv");
  const sablon = document.getElementById("tmpl-dosya-yonetici");
  if (!slot || !sablon || slot.dataset.hazir) return;
  slot.dataset.hazir = "1";
  slot.replaceChildren(sablon.content.cloneNode(true));

  const q = (id) => slot.querySelector(`#${id}`);
  k = {
    kok: q("ra-kok"), mesaj: q("ra-mesaj"), ozet: q("ra-ozet"), yol: q("ra-yol"), liste: q("ra-liste"), bos: q("ra-bos"), daha: q("ra-daha"),
    ara: q("ra-ara"), araTemizle: q("ra-ara-temizle"), sirala: q("ra-sirala"), filtreler: q("ra-filtreler"),
    gorunumListe: q("ra-gorunum-liste"), gorunumIzgara: q("ra-gorunum-izgara"),
    sekmeArsiv: q("ra-sekme-arsiv"), sekmePaylastiklarim: q("ra-sekme-paylastiklarim"), sekmePaylasilan: q("ra-sekme-paylasilan"),
    eylem: q("ra-eylem"), hedef: q("ra-hedef"), girdiDosya: q("ra-girdi-dosya"), girdiKlasor: q("ra-girdi-klasor"),
    gArsiv: q("ra-gorunum-arsiv"), gPaylastiklarim: q("ra-gorunum-paylastiklarim"), gPaylasilan: q("ra-gorunum-paylasilan"),
    paylastiklarimKok: q("ra-paylastiklarim-kok"), paylasilanKok: q("ra-paylasilan-kok"), sekmePaylasilanSayi: q("ra-sekme-paylasilan-sayi"),
    kuyrukKart: q("ra-kuyruk-kart"), kuyrukListe: q("ra-kuyruk"), kuyrukOzet: q("ra-kuyruk-ozet"), kuyrukTemizle: q("ra-kuyruk-temizle"),
    secimBar: q("ra-secim-bar"), secimSayi: q("ra-secim-sayi"), hepsiniSec: q("ra-hepsini-sec"),
    katman: q("ra-katman"), katmanAlt: q("ra-katman-alt"),
    dlgMetin: q("ra-dlg-metin"), dlgMetinForm: q("ra-dlg-metin-form"), dlgMetinBaslik: q("ra-dlg-metin-baslik"), dlgMetinEtiket: q("ra-dlg-metin-etiket"),
    dlgMetinGirdi: q("ra-dlg-metin-girdi"), dlgMetinHata: q("ra-dlg-metin-hata"), dlgMetinIptal: q("ra-dlg-metin-iptal"), dlgMetinTamam: q("ra-dlg-metin-tamam"),
    dlgOnay: q("ra-dlg-onay"), dlgOnayBaslik: q("ra-dlg-onay-baslik"), dlgOnayMetin: q("ra-dlg-onay-metin"), dlgOnayIptal: q("ra-dlg-onay-iptal"), dlgOnayTamam: q("ra-dlg-onay-tamam"),
    dlgPaylas: q("ra-dlg-paylas"), paylasDosyaAd: q("ra-dlg-paylas-dosya"), paylasKok: q("ra-paylas-kok"), paylasListe: q("ra-paylas-liste"), paylasHata: q("ra-paylas-hata"),
    dlgOnizleme: q("ra-dlg-onizleme"), onizlemeBaslik: q("ra-dlg-onizleme-baslik"), onizlemeImg: q("ra-onizleme-img"), onizlemeHata: q("ra-onizleme-hata"), onizlemeIndir: q("ra-onizleme-indir"),
  };

  const { data: oturum } = await supabase.auth.getSession();
  durum.uid = oturum.session?.user.id;
  const { data: yetki } = await supabase.rpc("r2_arsiv_yetkilerim");
  if (yetki) durum.yetki = yetki;
  anahtarlariHazirla().catch((e) => console.warn("e2ee:", e.message));   // alıcı olabilmek için sessizce

  durum.gorunum = tercihOku("ra-gorunum", "liste") === "izgara" ? "izgara" : "liste";
  const arsivGorunur = durum.yetki.oku || durum.yetki.yukle;
  k.sekmeArsiv.hidden = !arsivGorunur;
  k.sekmePaylastiklarim.hidden = !yukleyebilir();
  k.sekmePaylasilan.hidden = !(durum.yetki.paylasilan_var || arsivGorunur);

  kuyruk = kuyrukKur({
    liste: k.kuyrukListe, ozet: k.kuyrukOzet, temizleBtn: k.kuyrukTemizle,
    // Gönderim türü SEKMEYE göre belirlenir (onay kutusu yok):
    //   Arşiv sekmesi          -> şifresiz, seçili klasöre
    //   Özel gönderimlerim     -> şifreli, klasörsüz, seçilen alıcılara (kimse seçilmediyse yalnızca gönderene)
    baglam: () => (durum.sekme === "paylastiklarim"
      ? { yukleyebilir: yukleyebilir(), klasor: "", sifreli: true, alicilar: gPaylastiklarim.alicilar(), uid: durum.uid }
      : { yukleyebilir: yukleyebilir(), klasor: durum.yol, sifreli: false, alicilar: [], uid: durum.uid }),
    bitti: () => { if ((arsivSekmesi() && !durum.arama) || durum.sekme === "paylastiklarim") yenile(); else ozetYukle(); },
  });

  const eylemler = { indir, onizle, paylasAc, sil, silebilir: () => durum.yetki.sil };
  gPaylastiklarim = paylastiklarimGorunumuKur({
    kok: k.paylastiklarimKok, eylemler, bildir, yetkili: yukleyebilir(),
    gonder: (girdi) => yuklemeBaslat(dosyalariTopla(girdi)),   // dosyalariTopla ilk satırlarda FileList'i senkron okur
  });
  gPaylasilan = paylasilanGorunumuKur({ kok: k.paylasilanKok, uid: durum.uid, eylemler, bildir });

  /* sekmeler, arama, filtre, sıralama, görünüm */
  SEKMELER.forEach(([id, ad]) => k[id].addEventListener("click", () => sekmeDegistir(ad)));
  let aramaZ = null;
  k.ara.addEventListener("input", () => {
    k.araTemizle.hidden = !k.ara.value;
    clearTimeout(aramaZ);
    aramaZ = setTimeout(() => { durum.arama = k.ara.value.trim(); k.sirala.disabled = !!durum.arama && arsivSekmesi(); listele(); }, 250);
  });
  k.ara.addEventListener("keydown", (e) => { if (e.key === "Escape" && k.ara.value) { e.preventDefault(); aramayiTemizle(); } });
  k.araTemizle.addEventListener("click", () => { aramayiTemizle(); k.ara.focus(); });
  k.filtreler.addEventListener("click", (e) => {
    const b = e.target.closest(".ra-filtre"); if (!b) return;
    durum.filtre = b.dataset.filtre;
    k.filtreler.querySelectorAll(".ra-filtre").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    ciz();
  });
  k.sirala.addEventListener("change", () => { durum.sirala = k.sirala.value; listele(); });
  const gorunumUygula = () => {
    k.gorunumListe.setAttribute("aria-pressed", String(durum.gorunum === "liste"));
    k.gorunumIzgara.setAttribute("aria-pressed", String(durum.gorunum === "izgara"));
    k.liste.classList.toggle("ra-izgara", durum.gorunum === "izgara");
  };
  k.gorunumListe.addEventListener("click", () => { durum.gorunum = "liste"; tercihYaz("ra-gorunum", "liste"); gorunumUygula(); });
  k.gorunumIzgara.addEventListener("click", () => { durum.gorunum = "izgara"; tercihYaz("ra-gorunum", "izgara"); gorunumUygula(); });
  gorunumUygula();
  k.daha.addEventListener("click", () => listele(true));

  /* seçim */
  k.hepsiniSec.addEventListener("change", () => {
    gorunenler().forEach((s) => { if (k.hepsiniSec.checked) durum.secili.add(s.id); else durum.secili.delete(s.id); });
    ciz();
  });
  q("ra-secim-iptal").addEventListener("click", () => { durum.secili.clear(); ciz(); });
  q("ra-secim-sil").addEventListener("click", topluSil);

  /* yükleme */
  q("ra-yukle-dosya").addEventListener("click", () => k.girdiDosya.click());
  q("ra-yukle-klasor").addEventListener("click", () => k.girdiKlasor.click());
  q("ra-klasor-yeni").addEventListener("click", yeniKlasor);
  [k.girdiDosya, k.girdiKlasor].forEach((g) => g.addEventListener("change", () => {
    yuklemeBaslat(dosyalariTopla(g)); // FileList'i await'ten ÖNCE kopyalanır (dosyalariTopla ilk satırlarda okur)
    setTimeout(() => { g.value = ""; }, 0);
  }));
  surukleBirak();

  /* diyalog kapatma */
  q("ra-dlg-paylas-kapat").addEventListener("click", () => { k.dlgPaylas.close(); yenile(); });
  k.dlgPaylas.addEventListener("click", (e) => { if (e.target === k.dlgPaylas) k.dlgPaylas.close(); });
  q("ra-onizleme-kapat").addEventListener("click", onizlemeKapat);
  k.dlgOnizleme.addEventListener("click", (e) => { if (e.target === k.dlgOnizleme) onizlemeKapat(); });
  k.dlgOnizleme.addEventListener("close", onizlemeKapat);

  kontrolleriGuncelle(); hedefYaz();
  ozetYukle();
  sekmeDegistir(arsivGorunur ? "arsiv" : "paylasilan");
  if (durum.sekme !== "paylasilan" && !k.sekmePaylasilan.hidden) gPaylasilan.yeniSayisi().then(rozetGuncelle);   // sekme rozeti: görülmemiş gönderimler
}

basla().catch((e) => console.error("r2-arsiv.js:", e));
