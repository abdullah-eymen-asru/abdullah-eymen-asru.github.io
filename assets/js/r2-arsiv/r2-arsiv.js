/*
 * assets/js/r2-arsiv/r2-arsiv.js — R2 Dosya Yöneticisi (dashboard modülü "arsiv")
 *
 * KOTA İLKESİ: liste/gezinme/arama/klasör işlemleri YALNIZCA Supabase `r2_arsiv`
 * tablosundan (PostgREST) yapılır — R2'ye ListObjectsV2 atılmaz. R2'ye sadece
 * yükleme (PUT), indirme (GET) ve doğrulama (HEAD) gider; hepsi presigned URL
 * ile tarayıcıdan doğrudan, Worker sadece imzalar ve kotayı sayar.
 *
 * CSP: inline style/handler yok; DOM yalnızca createElement/textContent ile kurulur
 * (kullanıcı verisi asla innerHTML'e girmez).
 */
import { supabase } from "../core/supabase-client.js";
import {
  ARSIV_WORKER_URL, E2EE_MAX_BAYT, anahtarlariHazirla, aliciAnahtarlariniGetir,
  sifreliBoyut, dosyaSifrele, anahtariZarfla, dosyaCoz,
} from "./e2ee.js";

const SAYFA = 100;
const ESZAMANLI = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Şifreli dosya çözüldükten sonra Blob'a verilecek tür: yalnızca güvenli bir alt küme.
const GUVENLI_BLOB_TURLERI = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "text/plain", "text/csv", "application/json", "application/zip",
]);

const durum = {
  uid: null, yetki: { oku: false, yukle: false, sil: false, paylasilan_var: false },
  sekme: "arsiv", yol: "", arama: "", sayfa: 0, alicilar: new Map(), kuyruk: [], aktif: 0,
};
let k = {}; // DOM referansları

/* ------------------------------ yardımcılar ------------------------------ */
function el(etiket, sinif, metin) {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin != null) e.textContent = metin;
  return e;
}
function btn(metin, sinif, tikla, ozellikler = {}) {
  const b = el("button", sinif || "ra-btn", metin);
  b.type = "button";
  Object.entries(ozellikler).forEach(([a, v]) => b.setAttribute(a, v));
  b.addEventListener("click", tikla);
  return b;
}
function mesaj(metin, tur = "hata") {
  k.mesaj.textContent = metin || "";
  k.mesaj.hidden = !metin;
  k.mesaj.className = `auth-message ${tur === "hata" ? "error" : "success"}`;
}
function boyutYaz(b) {
  if (b == null) return "";
  const birim = ["B", "KB", "MB", "GB"]; let i = 0, v = b;
  while (v >= 1024 && i < birim.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${birim[i]}`;
}
const likeKacis = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const adGecerli = (a) => a.length >= 1 && a.length <= 200 && !/[\/\\\u0000-\u001f\u007f]/.test(a) && a !== "." && a !== "..";

async function worker(yol, govde) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Oturum bulunamadı.");
  const r = await fetch(`${ARSIV_WORKER_URL}${yol}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(govde),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.hata || `İşlem başarısız (${r.status}).`);
  return j;
}

function r2yePutla(url, basliklar, govde, ilerleme) {
  return new Promise((coz, red) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    Object.entries(basliklar).forEach(([a, v]) => x.setRequestHeader(a, v));
    x.upload.addEventListener("progress", (e) => e.lengthComputable && ilerleme(e.loaded / e.total));
    x.addEventListener("load", () => (x.status >= 200 && x.status < 300 ? coz()
      : red(new Error(`R2 yüklemeyi reddetti (${x.status}).`))));
    x.addEventListener("error", () => red(new Error("R2'ye ulaşılamadı (ağ ya da bucket CORS ayarı).")));
    x.send(govde);
  });
}

/* --------------------------------- liste --------------------------------- */
async function listele(devam = false) {
  if (!devam) { durum.sayfa = 0; k.liste.replaceChildren(); }
  let q = supabase.from("r2_arsiv")
    .select("id,tur,ad,klasor_yolu,boyut,gercek_mime,sifreli,sahip_id,created_at")
    .eq("durum", "hazir");

  if (durum.sekme === "paylasilan") q = q.eq("sifreli", true).neq("sahip_id", durum.uid);
  else if (durum.arama) q = q.ilike("ad", `%${likeKacis(durum.arama)}%`);
  else q = q.eq("klasor_yolu", durum.yol);

  const bas = durum.sayfa * SAYFA;
  const { data, error } = await q.order("tur", { ascending: false }).order("ad").range(bas, bas + SAYFA - 1);
  if (error) { mesaj("Liste alınamadı."); return; }
  mesaj("");

  data.forEach((s) => k.liste.appendChild(satirYap(s)));
  if (!devam && data.length === 0) k.liste.appendChild(Object.assign(el("li", "ra-bos", durum.arama ? "Sonuç yok." : "Bu klasör boş.")));
  k.daha.hidden = data.length < SAYFA;
  durum.sayfa++;
  yolCiz();
}

function satirYap(s) {
  const li = el("li", "ra-satir");
  li.appendChild(el("span", "ra-ikon", s.tur === "klasor" ? "📁" : s.sifreli ? "🔒" : "📄"));

  const orta = el("div");
  const ad = el("button", `ra-ad${s.tur === "klasor" ? " ra-tiklanir" : ""}`, s.ad);
  ad.type = "button";
  if (s.tur === "klasor") ad.addEventListener("click", () => klasoreGit(s.klasor_yolu + s.ad + "/"));
  orta.appendChild(ad);
  const meta = [];
  if (s.tur === "dosya") meta.push(boyutYaz(s.boyut));
  if (s.sifreli) meta.push("uçtan uca şifreli");
  if (durum.arama && s.klasor_yolu) meta.push(`/${s.klasor_yolu}`);
  meta.push(new Date(s.created_at).toLocaleDateString("tr-TR"));
  orta.appendChild(el("span", "ra-meta", meta.filter(Boolean).join(" · ")));
  li.appendChild(orta);

  const islem = el("div", "ra-islemler");
  if (s.tur === "dosya") islem.appendChild(btn("İndir", "ra-btn", (e) => indir(s, e.currentTarget)));
  if (durum.sekme === "arsiv" && durum.yetki.yukle) islem.appendChild(btn("Adlandır", "ra-btn", () => adlandir(s)));
  if (durum.sekme === "arsiv" && durum.yetki.sil) islem.appendChild(btn("Sil", "ra-btn ra-btn-tehlike", (e) => sil(s, e.currentTarget)));
  li.appendChild(islem);
  return li;
}

function yolCiz() {
  k.yol.replaceChildren();
  const parcalar = durum.yol.split("/").filter(Boolean);
  const ekle = (etiket, hedef, sonMu) => {
    const li = el("li");
    const b = btn(etiket, "", () => !sonMu && klasoreGit(hedef));
    li.appendChild(b); k.yol.appendChild(li);
  };
  ekle("Ana klasör", "", parcalar.length === 0);
  let birikim = "";
  parcalar.forEach((p, i) => { birikim += p + "/"; ekle(p, birikim, i === parcalar.length - 1); });
  k.yol.hidden = durum.sekme !== "arsiv" || !!durum.arama;
}

function klasoreGit(yol) { durum.yol = yol; durum.arama = ""; k.ara.value = ""; listele(); }

/* ----------------------------- klasör / ad işlemleri ----------------------------- */
async function klasorOlustur() {
  const ad = k.klasorAd.value.trim();
  if (!adGecerli(ad)) return mesaj("Geçerli bir klasör adı gir ('/' ve '\\' içeremez).");
  k.klasorEkle.disabled = true;
  const { error } = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: durum.yol, p_ad: ad });
  k.klasorEkle.disabled = false;
  if (error) return mesaj(error.message || "Klasör oluşturulamadı.");
  k.klasorAd.value = ""; listele();
}

async function adlandir(s) {
  const yeni = window.prompt("Yeni ad:", s.ad)?.trim();
  if (!yeni || yeni === s.ad) return;
  if (!adGecerli(yeni)) return mesaj("Geçersiz ad.");
  const { error } = await supabase.rpc("r2_arsiv_yeniden_adlandir", { p_id: s.id, p_yeni_ad: yeni });
  if (error) return mesaj(error.message || "Yeniden adlandırılamadı.");
  listele(); // R2 işlemi yok: anahtarlar opak, yalnızca DB satırı değişti
}

async function sil(s, dugme) {
  const uyari = s.tur === "klasor"
    ? `"${s.ad}" klasörü ve İÇİNDEKİ HER ŞEY kalıcı olarak silinecek. Emin misin?`
    : `"${s.ad}" kalıcı olarak silinecek. Emin misin?`;
  if (!window.confirm(uyari)) return;
  dugme.disabled = true;
  try { await worker("/sil", { id: s.id }); mesaj("Silindi.", "ok"); listele(); }
  catch (e) { mesaj(e.message); dugme.disabled = false; }
}

/* ---------------------------------- indirme ---------------------------------- */
function blobIndir(blob, ad) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = ad; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function indir(s, dugme) {
  dugme.disabled = true; mesaj("");
  try {
    const { url, sifreli } = await worker("/indir", { id: s.id });
    if (!sifreli) { window.location.assign(url); return; } // Content-Disposition: attachment (imzalı)

    // Şifreli: indir -> zarfı Supabase'ten al -> TARAYICIDA çöz -> Blob.
    const [{ data: zarf, error }, r] = await Promise.all([
      supabase.from("ozel_icerik_anahtarlar").select("sarili_dosya_anahtari")
        .eq("dosya_id", s.id).eq("alici_id", durum.uid).maybeSingle(),
      fetch(url),
    ]);
    if (error || !zarf) throw new Error("Bu dosya için anahtarın yok.");
    if (!r.ok) throw new Error("Dosya R2'den alınamadı.");
    const duz = await dosyaCoz(await r.arrayBuffer(), zarf.sarili_dosya_anahtari, s.id);
    const tur = GUVENLI_BLOB_TURLERI.has(s.gercek_mime) ? s.gercek_mime : "application/octet-stream";
    blobIndir(new Blob([duz], { type: tur }), s.ad);
  } catch (e) { mesaj(e.message); }
  finally { dugme.disabled = false; }
}

/* ---------------------------------- yükleme ---------------------------------- */
function kuyrugaEkle(dosyalar) {
  if (!durum.yetki.yukle) return mesaj("Yükleme yetkin yok.");
  const sifreli = k.sifreli.checked;
  for (const dosya of dosyalar) {
    const li = el("li");
    const ad = el("span", "", dosya.name);
    const durumEtiketi = el("span", "ra-meta", "Sırada");
    const ilerleme = document.createElement("progress");
    ilerleme.max = 1; ilerleme.value = 0;
    li.append(ad, durumEtiketi, ilerleme);
    k.kuyruk.appendChild(li);
    durum.kuyruk.push({ dosya, sifreli, klasor: durum.yol, alicilar: [...durum.alicilar.keys()], durumEtiketi, ilerleme });
  }
  kuyrukIsle();
}

function kuyrukIsle() {
  while (durum.aktif < ESZAMANLI && durum.kuyruk.length) {
    const is = durum.kuyruk.shift();
    durum.aktif++;
    yukle(is).catch((e) => {
      is.durumEtiketi.textContent = e.message; is.durumEtiketi.className = "ra-meta ra-durum-hata";
    }).finally(() => { durum.aktif--; kuyrukIsle(); });
  }
}

async function yukle({ dosya, sifreli, klasor, alicilar, durumEtiketi, ilerleme }) {
  const aciklama = (m) => { durumEtiketi.textContent = m; };
  if (sifreli && dosya.size > E2EE_MAX_BAYT)
    throw new Error(`Şifreli yüklemede en fazla ${E2EE_MAX_BAYT / 1048576} MB desteklenir.`);

  let anahtarlar = null;
  if (sifreli) {
    aciklama("Anahtarlar hazırlanıyor…");
    const ben = await anahtarlariHazirla();
    const hepsi = [...new Set([durum.uid, ...alicilar])];
    const { harita, eksik } = await aliciAnahtarlariniGetir(hepsi);
    if (eksik.length) throw new Error("Bazı alıcılar henüz panele girmediği için anahtarları yok; panele bir kez girince tekrar dene.");
    harita.set(durum.uid, ben.acik);
    anahtarlar = harita;
  }

  aciklama("Hazırlanıyor…");
  const baslat = await worker("/yukle-baslat", {
    ad: dosya.name, klasor_yolu: klasor, mime: dosya.type || "application/octet-stream",
    boyut: sifreli ? sifreliBoyut(dosya.size) : dosya.size, sifreli,
  });

  try {
    let govde = dosya, ham = null;
    if (sifreli) {
      aciklama("Şifreleniyor…");
      const s = await dosyaSifrele(dosya, baslat.id);
      govde = s.blob; ham = s.hamAnahtar;
    }
    aciklama("Yükleniyor…");
    await r2yePutla(baslat.url, baslat.basliklar, govde, (o) => { ilerleme.value = o; });
    aciklama("Doğrulanıyor…");
    await worker("/yukle-bitir", { id: baslat.id });

    if (sifreli) {
      const satirlar = [];
      for (const [kid, acik] of anahtarlar) {
        satirlar.push({ dosya_id: baslat.id, alici_id: kid, sarili_dosya_anahtari: await anahtariZarfla(ham, acik) });
      }
      const { error } = await supabase.from("ozel_icerik_anahtarlar").insert(satirlar);
      if (error) throw new Error("Şifre zarfları kaydedilemedi.");
    }
    ilerleme.value = 1;
    durumEtiketi.textContent = sifreli ? "Şifrelendi ve yüklendi ✓" : "Yüklendi ✓";
    durumEtiketi.className = "ra-meta ra-durum-tamam";
    if (durum.sekme === "arsiv" && !durum.arama && durum.yol === klasor) listele();
  } catch (e) {
    // Yarım kalan kaydı/nesneyi temizle (anahtarsız şifreli dosya erişilemez olurdu).
    await worker("/sil", { id: baslat.id }).catch(() => {});
    throw e;
  }
}

/* --------------------------- alıcı seçimi (E2EE) --------------------------- */
let aliciZamanlayici = null;
function aliciAra() {
  clearTimeout(aliciZamanlayici);
  const q = k.aliciAra.value.trim();
  k.aliciSonuc.replaceChildren();
  if (q.length < 2) return;
  aliciZamanlayici = setTimeout(async () => {
    const { data, error } = await supabase.rpc("arsiv_kullanici_ara", { p_q: q });
    if (error) return mesaj("Kullanıcı aranamadı.");
    k.aliciSonuc.replaceChildren();
    (data || []).filter((u) => u.id !== durum.uid && !durum.alicilar.has(u.id)).forEach((u) => {
      const li = el("li");
      li.appendChild(btn(`+ ${u.full_name || "(adsız)"}`, "ra-chip", () => {
        durum.alicilar.set(u.id, u.full_name || "(adsız)"); aliciCiz(); k.aliciSonuc.replaceChildren(); k.aliciAra.value = "";
      }));
      k.aliciSonuc.appendChild(li);
    });
  }, 300);
}
function aliciCiz() {
  k.aliciSecili.replaceChildren();
  durum.alicilar.forEach((ad, id) => {
    const li = el("li");
    li.appendChild(btn(`${ad} ✕`, "ra-chip", () => { durum.alicilar.delete(id); aliciCiz(); }, { "aria-label": `${ad} alıcısını kaldır` }));
    k.aliciSecili.appendChild(li);
  });
}

/* ---------------------------------- kurulum ---------------------------------- */
function sekmeDegistir(sekme) {
  durum.sekme = sekme; durum.arama = ""; k.ara.value = "";
  k.sekmeArsiv.setAttribute("aria-selected", String(sekme === "arsiv"));
  k.sekmePaylasilan.setAttribute("aria-selected", String(sekme === "paylasilan"));
  const arsivModu = sekme === "arsiv";
  k.arac.hidden = !arsivModu; k.yuklemeBolumu.hidden = !(arsivModu && durum.yetki.yukle);
  k.klasorBolumu.hidden = !(arsivModu && durum.yetki.yukle);
  listele();
}

function surukleBirak() {
  const bolge = k.birak;
  ["dragenter", "dragover"].forEach((o) => bolge.addEventListener(o, (e) => { e.preventDefault(); bolge.classList.add("ra-surukleniyor"); }));
  ["dragleave", "drop"].forEach((o) => bolge.addEventListener(o, (e) => { e.preventDefault(); bolge.classList.remove("ra-surukleniyor"); }));
  bolge.addEventListener("drop", (e) => kuyrugaEkle([...e.dataTransfer.files]));
  k.dosyaSec.addEventListener("change", () => { kuyrugaEkle([...k.dosyaSec.files]); k.dosyaSec.value = ""; });
}

async function basla() {
  const slot = document.getElementById("slot-arsiv");
  const sablon = document.getElementById("tmpl-dosya-yonetici");
  if (!slot || !sablon || slot.dataset.hazir) return;
  slot.dataset.hazir = "1";
  slot.replaceChildren(sablon.content.cloneNode(true));

  const q = (id) => slot.querySelector(`#${id}`);
  k = {
    mesaj: q("ra-mesaj"), yol: q("ra-yol"), liste: q("ra-liste"), daha: q("ra-daha"), ara: q("ra-ara"), arac: q("ra-arac"),
    sekmeArsiv: q("ra-sekme-arsiv"), sekmePaylasilan: q("ra-sekme-paylasilan"),
    yuklemeBolumu: q("ra-yukleme"), klasorBolumu: q("ra-klasor-bolum"), klasorAd: q("ra-klasor-ad"), klasorEkle: q("ra-klasor-ekle"),
    birak: q("ra-birak"), dosyaSec: q("ra-dosya-sec"), kuyruk: q("ra-kuyruk"),
    sifreli: q("ra-sifreli"), aliciBlok: q("ra-alici-blok"), aliciAra: q("ra-alici-ara"),
    aliciSonuc: q("ra-alici-sonuc"), aliciSecili: q("ra-alici-secili"),
  };

  const { data: oturum } = await supabase.auth.getSession();
  durum.uid = oturum.session?.user.id;
  const { data: yetki } = await supabase.rpc("r2_arsiv_yetkilerim");
  if (yetki) durum.yetki = yetki;

  // Şifreli paylaşımı kullanabilecek herkes için anahtarlar sessizce hazırlanır (alıcı olabilsinler).
  anahtarlariHazirla().catch((e) => console.warn("e2ee:", e.message));

  const arsivGorunur = durum.yetki.oku || durum.yetki.yukle;
  k.sekmeArsiv.hidden = !arsivGorunur;
  k.sekmePaylasilan.hidden = !(durum.yetki.paylasilan_var || arsivGorunur);

  k.sekmeArsiv.addEventListener("click", () => sekmeDegistir("arsiv"));
  k.sekmePaylasilan.addEventListener("click", () => sekmeDegistir("paylasilan"));
  k.daha.addEventListener("click", () => listele(true));
  k.klasorEkle.addEventListener("click", klasorOlustur);
  k.klasorAd.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); klasorOlustur(); } });
  let aramaZ = null;
  k.ara.addEventListener("input", () => { clearTimeout(aramaZ); aramaZ = setTimeout(() => { durum.arama = k.ara.value.trim(); listele(); }, 300); });
  k.sifreli.addEventListener("change", () => { k.aliciBlok.hidden = !k.sifreli.checked; });
  k.aliciAra.addEventListener("input", aliciAra);
  surukleBirak();

  sekmeDegistir(arsivGorunur ? "arsiv" : "paylasilan");
}

basla().catch((e) => console.error("r2-arsiv.js:", e));
