/*
 * assets/js/donusturucu/donusturucu.js — Evrensel Dosya Dönüştürücü & Tarayıcı İçi Belge Düzenleyici (panel girişi).
 * -----------------------------------------------------------------------
 *  GİZLİLİK : Dosyalar yalnızca bu sekmenin belleğinde (File/Blob/ArrayBuffer) tutulur. Supabase'e, R2'ye, Worker'a ya da
 *             herhangi bir sunucuya gönderilmez. Ağ trafiği yalnızca açık kaynak kütüphane kodunun (CDN) indirilmesidir.
 *  GUARD    : Modül, kütüphane yüklemeden ve arayüz kurmadan ÖNCE donusturucu_yetkisi_var_mi() RPC'sini sorar
 *             (menü gizleme + hash yönlendirme dashboard.js'te; bu ikinci, derinlemesine savunma katmanıdır).
 *  BELLEK   : her indirme sonrası URL.revokeObjectURL; düzenleyici kapanınca PDF.js belgeleri/tuvaller serbest bırakılır.
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { el, bos, dugme, ilerlemeCubugu, bayt, indir, tumUrlleriSerbestBirak, onayIste, formIste, hataMetni, adsizAl, dosyaAdiTemizle, metinOku, isBaglami, IptalHatasi } from "./ortak.js";
import { FORMATLAR, turBul, hedefler, cokluDegerlendir, duzenleyiciTuru, vurguDili } from "./tur-matrisi.js";
import { donustur, zipPaketle, pdfBirlestir, htmldenCikti, pdfSayfaGorselleri } from "./donustur.js";
import { cikisDestekleniyor } from "./motor-gorsel.js";
import { belgeHtmlAl } from "./belge-oku.js";
import { veriDonustur } from "./motor-veri.js";
import { kutuphaneListesi } from "./cdn.js";
import { yetkiPaneliniKur } from "./yetki-ortak.js";

const MAKS_TEK = 250 * 1024 * 1024;
const MAKS_TOPLAM = 500 * 1024 * 1024;
const KABUL = ".pdf,.docx,.html,.htm,.md,.markdown,.txt,.epub,.jpg,.jpeg,.png,.webp,.avif,.bmp,.ico,.svg,.gif,.heic,.heif,.csv,.tsv,.json,.xml,.js,.ts,.css,.py,.yml,.yaml,.sql,.sh,.ini,.log";

const kok = document.getElementById("dn-kok");
const mesajEl = document.getElementById("dn-mesaj");
const bildir = (m, t = "info") => { if (mesajEl) { if (!m) { mesajEl.hidden = true; mesajEl.textContent = ""; } else showMessage(mesajEl, m, t); } };

let dosyalar = []; // {file, tur, uzanti, kod}
let hedef = null;
let calisiyor = null; // isBaglami
let duzenleyici = null; // {tur, nesne, dosyaAdi, ...}
let kirliBekci = null;

const girdi = el("input", { type: "file", multiple: true, accept: KABUL, hidden: true, "aria-label": "Dosya seç" });
const liste = el("ul", { class: "dn-dosyalar", "aria-label": "Seçilen dosyalar" });
const ilerleme = ilerlemeCubugu();
const kontrolAlani = el("div", { class: "dn-kontrol" });
const ana = el("div", { class: "dn-ana" });
const calismaAlani = el("div", { class: "dn-calisma", hidden: true });

/* ------------------------------ dosya seçimi ------------------------------ */

function dosyalariAl(fl) {
  bildir("");
  const yeni = [];
  const reddedilen = [];
  for (const f of fl) {
    const t = turBul(f);
    if (!t.tur) reddedilen.push(f.name);
    else if (f.size === 0) reddedilen.push(`${f.name} (boş)`);
    else if (f.size > MAKS_TEK) reddedilen.push(`${f.name} (${bayt(f.size)} > 250 MB sınırı)`);
    else yeni.push({ file: f, ...t });
  }
  const toplam = [...dosyalar, ...yeni].reduce((a, d) => a + d.file.size, 0);
  if (toplam > MAKS_TOPLAM) { bildir("Toplam boyut 500 MB'ı aşıyor; tarayıcı belleği için dosyaları parçalara böl.", "error"); return; }
  dosyalar = [...dosyalar, ...yeni];
  if (reddedilen.length) bildir(`Desteklenmeyen/uygunsuz dosya atlandı: ${reddedilen.join(", ")}`, "error");
  hedef = null;
  ciz();
}

function dosyalariTemizle() {
  dosyalar = [];
  hedef = null;
  bildir("");
  ilerleme.gizle();
  ciz();
}

/* ------------------------------ arayüz ------------------------------ */

function gizlilikRozeti() {
  return el("div", { class: "dn-gizlilik", role: "note" },
    el("span", { "aria-hidden": "true", text: "🔒" }),
    el("span", {}, el("b", { text: "Verileriniz cihazınızdan asla dışarı çıkmaz, işlem tarayıcınızda gerçekleşir." }),
      " Dosyalar sunucuya, Supabase'e ya da R2'ye gönderilmez; yalnızca açık kaynak kütüphane kodu indirilir."));
}

function dropzone() {
  const dz = el("div", { class: "dn-dropzone", role: "button", tabindex: "0", "aria-label": "Dosya seçmek için tıkla ya da dosyaları buraya bırak" },
    el("span", { class: "dn-dropzone-ikon", "aria-hidden": "true", text: "📂" }),
    el("strong", { text: "Dosyanı buraya bırak ya da seçmek için dokun" }),
    el("span", { class: "dn-muted", text: "PDF, Word, Markdown, metin/kod, EPUB, HTML, görsel (JPG, PNG, WebP, AVIF, SVG, BMP, ICO, GIF, HEIC), CSV, JSON, XML" }));
  dz.addEventListener("click", () => girdi.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); girdi.click(); } });
  for (const o of ["dragenter", "dragover"]) dz.addEventListener(o, (e) => { e.preventDefault(); dz.classList.add("dn-surukle"); });
  for (const o of ["dragleave", "drop"]) dz.addEventListener(o, (e) => { e.preventDefault(); dz.classList.remove("dn-surukle"); });
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) dosyalariAl([...e.dataTransfer.files]); });
  return dz;
}
girdi.addEventListener("change", () => { dosyalariAl([...girdi.files]); girdi.value = ""; });

function dosyaListesiCiz() {
  bos(liste);
  dosyalar.forEach((d, i) => {
    const sil = dugme({ ikon: "✕", kucuk: true, tur: "hayalet", "aria-label": `${d.file.name} dosyasını kaldır`, title: "Kaldır" });
    sil.addEventListener("click", () => { dosyalar.splice(i, 1); hedef = null; ciz(); });
    liste.append(el("li", { class: "dn-dosya" }, el("span", { class: "dn-rozet", text: FORMATLAR[d.tur].ad }), el("span", { class: "dn-dosya-ad", title: d.file.name, text: d.file.name }), el("span", { class: "dn-dosya-meta", text: bayt(d.file.size) }), sil));
  });
}

async function hedefSecenekleri(turler) {
  const adaylar = turler;
  const sonuc = [];
  for (const h of adaylar) {
    if (h === "webp" && !(await cikisDestekleniyor("image/webp"))) continue;
    if (h === "avif" && !(await cikisDestekleniyor("image/avif"))) continue;
    sonuc.push(h);
  }
  return sonuc;
}

async function kontrolCiz() {
  bos(kontrolAlani);
  if (!dosyalar.length) return;
  const turler = dosyalar.map((d) => d.tur);
  let hedefListesi;
  let uyum;
  if (dosyalar.length === 1) { hedefListesi = hedefler(turler[0]); uyum = { uygun: true }; }
  else {
    uyum = cokluDegerlendir(turler);
    hedefListesi = uyum.uygun ? uyum.hedefler : [];
  }
  const edTur = dosyalar.length === 1 ? duzenleyiciTuru(turler[0]) : (uyum.aile === "pdf" ? "pdf" : null);

  const modKart = el("div", { class: "dn-kart" }, el("h2", { text: "Ne yapmak istersin?" }));
  const modlar = el("div", { class: "dn-modlar" });
  const hizli = dugme({ tur: "ikincil", class: "dn-mod", "aria-pressed": "true" });
  hizli.append(el("strong", { text: "⚡ Hızlı Dönüştür" }), el("small", { text: "Hedef biçimi seç, tek tıkla dönüştür ve indir." }));
  const duzenle = dugme({ tur: "ikincil", class: "dn-mod", disabled: !edTur });
  duzenle.append(el("strong", { text: "✏️ Aç ve Düzenle" }), el("small", { text: edTur ? "Tarayıcı içi düzenleyicide aç, düzenle, istediğin biçimde kaydet." : "Bu dosya türü/kombinasyonu için düzenleyici yok." }));
  duzenle.addEventListener("click", () => duzenleyiciAc());
  modlar.append(hizli, duzenle);
  modKart.append(modlar);
  kontrolAlani.append(modKart);

  if (dosyalar.length > 1 && !uyum.uygun) { kontrolAlani.append(el("div", { class: "dn-uyari", role: "alert", text: uyum.mesaj || "Bu dosya kombinasyonu desteklenmiyor." })); return; }
  if (!hedefListesi.length) { kontrolAlani.append(el("div", { class: "dn-uyari", text: "Bu dosya için dönüştürme hedefi yok." })); return; }

  const suzulmus = await hedefSecenekleri(hedefListesi.filter((h) => h !== "pdf-birlestir"));
  const tumHedefler = hedefListesi.includes("pdf-birlestir") ? ["pdf-birlestir", ...suzulmus] : suzulmus;
  if (!tumHedefler.includes(hedef)) hedef = null;

  const kart = el("div", { class: "dn-kart" }, el("h2", { text: "Hedef biçim" }));
  const hedefSatiri = el("div", { class: "dn-hedefler", role: "group", "aria-label": "Hedef biçim" });
  for (const h of tumHedefler) {
    const ad = h === "pdf-birlestir" ? "PDF'leri birleştir" : (h === "pdf" && uyum.aile === "gorsel" && dosyalar.length > 1 ? "Tek PDF (birleştir)" : FORMATLAR[h].ad);
    const d = dugme({ metin: ad, "aria-pressed": String(h === hedef) });
    d.addEventListener("click", () => { hedef = h; kontrolCiz(); });
    hedefSatiri.append(d);
  }
  kart.append(hedefSatiri);

  const secenek = secenekCiz(turler, hedef, uyum);
  if (secenek) kart.append(secenek);

  const git = dugme({ metin: "Dönüştür ve indir", ikon: "⬇", tur: "birincil", disabled: !hedef || !!calisiyor });
  const iptal = dugme({ metin: "İptal", hidden: !calisiyor });
  git.addEventListener("click", () => hizliDonustur(git, iptal));
  iptal.addEventListener("click", () => calisiyor?.iptal());
  kart.append(el("div", { class: "dn-eylemler" }, git, iptal), ilerleme.el);
  if (turler.includes("pdf") && hedef && !["png", "jpg", "webp", "pdf-birlestir"].includes(hedef)) kart.append(el("p", { class: "dn-muted", text: "Not: PDF'ten dönüştürmede düzen birebir korunmaz; metin ve başlıklar yeniden oluşturulur. Taranmış PDF'lerde OCR yapılmaz." }));
  kontrolAlani.append(kart);
}

const SECENEK = {};
function secenekCiz(turler, h, uyum) {
  if (!h) return null;
  const alanlar = [];
  const sec = (ad, etiket, secenekler, varsayilan) => {
    const s = el("select", { class: "dn-select", "aria-label": etiket }, ...secenekler.map(([d, e]) => el("option", { value: d, text: e })));
    s.value = SECENEK[ad] ?? varsayilan;
    s.addEventListener("change", () => { SECENEK[ad] = s.value; });
    return el("label", {}, etiket, s);
  };
  const gorselKaynak = (uyum.aile === "gorsel") || FORMATLAR[turler[0]]?.aile === "gorsel";
  if (gorselKaynak && ["jpg", "webp", "avif"].includes(h)) {
    const r = el("input", { type: "range", min: 40, max: 100, step: 1, value: SECENEK.kalite ?? 92, "aria-label": "Kalite" });
    const v = el("span", { text: `%${r.value}` });
    r.addEventListener("input", () => { SECENEK.kalite = r.value; v.textContent = `%${r.value}`; });
    alanlar.push(el("label", {}, "Kalite", r, v));
  }
  if (gorselKaynak && h === "ico") alanlar.push(sec("ico", "Simge boyutları", [["coklu", "Çoklu (16–256 px)"], ["32", "Yalnız 32 px"], ["64", "Yalnız 64 px"], ["256", "Yalnız 256 px"]], "coklu"));
  if (gorselKaynak && h === "pdf") alanlar.push(sec("sayfa", "Sayfa boyutu", [["gorsel", "Görselin boyutu"], ["a4", "A4'e sığdır"]], "gorsel"));
  if (turler.includes("pdf") && ["png", "jpg", "webp"].includes(h)) alanlar.push(sec("olcek", "Çözünürlük", [["1", "Düşük (1×)"], ["1.5", "Orta (1,5×)"], ["2", "Yüksek (2×)"], ["3", "Çok yüksek (3×)"]], "2"));
  if (FORMATLAR[turler[0]]?.aile === "veri") {
    alanlar.push(sec("ayirac", "CSV ayracı", [["", "Otomatik / virgül"], [",", "Virgül ( , )"], [";", "Noktalı virgül ( ; )"], ["\t", "Sekme"], ["|", "Dikey çizgi ( | )"]], ""));
    if (h === "csv") alanlar.push(sec("bom", "UTF-8 BOM (Excel'de Türkçe karakterler)", [["1", "Ekle (önerilir)"], ["0", "Ekleme"]], "1"));
  }
  return alanlar.length ? el("div", { class: "dn-secenekler" }, ...alanlar) : null;
}

function ctxOlustur(uyarilar, isCtx) {
  const s = SECENEK;
  return {
    ilerle: (o, m) => ilerleme.ayarla(o, m),
    iptalKontrol: () => isCtx.kontrol(),
    uyarilar,
    kalite: s.kalite ? Number(s.kalite) / 100 : undefined,
    sayfaBoyutu: s.sayfa || "gorsel",
    icoBoyutlari: s.ico && s.ico !== "coklu" ? [Number(s.ico)] : undefined,
    olcek: s.olcek ? Number(s.olcek) : 2,
    ayirac: s.ayirac || undefined,
    bom: s.bom !== "0",
    parola: async (yanlis) => { const v = await formIste({ baslik: "PDF parola korumalı", aciklama: yanlis ? "Parola yanlış, tekrar dene." : "Bu PDF'i okumak için parola gerekli (parola cihazından çıkmaz).", alanlar: [{ ad: "p", etiket: "Parola", tur: "password" }], tamam: "Aç" }); return v ? v.p : null; },
  };
}

async function hizliDonustur(git, iptal) {
  if (!hedef || calisiyor) return;
  bildir("");
  const uyarilar = [];
  calisiyor = isBaglami((o, m) => ilerleme.ayarla(o, m));
  git.disabled = true; iptal.hidden = false;
  ilerleme.goster("Başlıyor…");
  try {
    const ctx = ctxOlustur(uyarilar, calisiyor);
    const toplam = dosyalar.length;
    let ciktilar = [];
    if (hedef === "pdf-birlestir") {
      ciktilar = [{ blob: await pdfBirlestir(dosyalar.map((d) => d.file), { ilerle: ctx.ilerle }), ad: `birlesik-${new Date().toISOString().slice(0, 10)}.pdf` }];
    } else if (toplam > 1 && hedef === "pdf" && dosyalar.every((d) => FORMATLAR[d.tur].aile === "gorsel")) {
      const { gorsellerdenPdf } = await import("./motor-gorsel.js");
      ciktilar = [{ blob: await gorsellerdenPdf(dosyalar.map((d) => ({ blob: d.file, ad: d.file.name })), { sayfaBoyutu: ctx.sayfaBoyutu, ilerle: ctx.ilerle, uyarilar }), ad: `gorseller-${new Date().toISOString().slice(0, 10)}.pdf` }];
    } else {
      for (let i = 0; i < toplam; i++) {
        calisiyor.kontrol();
        const d = dosyalar[i];
        const alt = { ...ctx, ilerle: (o, m) => ilerleme.ayarla((i + o) / toplam, toplam > 1 ? `${i + 1}/${toplam} · ${d.file.name}${m ? ` — ${m}` : ""}` : m) };
        ciktilar.push(...(await donustur(d.file, d.tur, hedef, alt)));
      }
    }
    ilerleme.ayarla(0.95, "İndirmeye hazırlanıyor…");
    if (ciktilar.length === 1) indir(ciktilar[0].blob, ciktilar[0].ad);
    else {
      const adi = dosyalar.length === 1 ? adsizAl(dosyalar[0].file.name) : "donusturulen";
      indir(await zipPaketle(ciktilar), `${dosyaAdiTemizle(adi)}-${hedef}.zip`);
    }
    ilerleme.ayarla(1, "Tamamlandı");
    bildir(`${ciktilar.length === 1 ? ciktilar[0].ad : `${ciktilar.length} dosya (ZIP)`} indirildi.${uyarilar.length ? `\n${[...new Set(uyarilar)].join("\n")}` : ""}`, uyarilar.length ? "info" : "success");
    setTimeout(() => ilerleme.gizle(), 1500);
  } catch (h) {
    ilerleme.gizle();
    bildir(h instanceof IptalHatasi ? "İşlem iptal edildi." : `Dönüştürülemedi: ${hataMetni(h)}`, h instanceof IptalHatasi ? "info" : "error");
  } finally {
    calisiyor = null;
    kontrolCiz();
  }
}

/* ------------------------------ düzenleyici çalışma alanı ------------------------------ */

function kirliBekciKur() {
  kirliBekci = (e) => { if (duzenleyici?.nesne?.kirli?.()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", kirliBekci);
}

async function duzenleyiciKapat(sor = true) {
  if (!duzenleyici) return;
  if (sor && duzenleyici.nesne.kirli?.()) {
    const ok = await onayIste({ baslik: "Kaydedilmemiş değişiklikler", metin: "Düzenleyiciyi kapatırsan değişiklikler kaybolur (hiçbir şey sunucuda saklanmıyor). Kapatılsın mı?", tamam: "Kapat", tehlike: true });
    if (!ok) return;
  }
  try { duzenleyici.nesne.yokEt(); } catch { /* yok say */ }
  if (kirliBekci) { window.removeEventListener("beforeunload", kirliBekci); kirliBekci = null; }
  duzenleyici = null;
  bos(calismaAlani);
  calismaAlani.hidden = true;
  ana.hidden = false;
  tumUrlleriSerbestBirak(); // bellek temizliği
  bildir("");
}

const DISA_BELGE = ["docx", "pdf", "md", "html", "txt", "epub"];

async function duzenleyiciAc() {
  if (!dosyalar.length) return;
  const edTur = dosyalar.length === 1 ? duzenleyiciTuru(dosyalar[0].tur) : "pdf";
  if (!edTur) return;
  bildir("");
  ilerleme.goster("Düzenleyici hazırlanıyor…");
  ilerleme.ayarla(null, "Düzenleyici hazırlanıyor…");
  const kap = el("div", { class: "dn-editor-kap" });
  const d0 = dosyalar[0];
  const dosyaAdi = adsizAl(d0.file.name);
  try {
    let nesne;
    let hedefListesi;
    if (edTur === "pdf") {
      const { pdfDuzenleyiciKur } = await import("./pdf-duzenleyici.js");
      nesne = await pdfDuzenleyiciKur(kap, { dosyalar: dosyalar.map((d) => d.file), mesaj: bildir });
      hedefListesi = [["pdf", "PDF (düzenlenmiş)"], ["png-zip", "Sayfa görselleri (ZIP)"], ["docx", "Word (.docx)"], ["md", "Markdown"], ["txt", "Düz metin"], ["html", "HTML"], ["epub", "EPUB"]];
    } else if (edTur === "zengin") {
      const { zenginDuzenleyiciKur } = await import("./zengin-duzenleyici.js");
      const b = await belgeHtmlAl(d0.file, d0.tur, { parola: null });
      nesne = zenginDuzenleyiciKur(kap, { html: b.html });
      hedefListesi = DISA_BELGE.map((h) => [h, FORMATLAR[h].ad]);
    } else {
      const { metinDuzenleyiciKur } = await import("./metin-duzenleyici.js");
      const metin = await metinOku(d0.file);
      nesne = metinDuzenleyiciKur(kap, { metin, tur: d0.tur, dil: vurguDili(d0.tur, d0.uzanti) });
      const veri = FORMATLAR[d0.tur].aile === "veri";
      hedefListesi = veri
        ? [[d0.tur, `${FORMATLAR[d0.tur].ad} (kaydet)`], ...hedefler(d0.tur).map((h) => [h, FORMATLAR[h].ad])]
        : [[d0.tur === "md" ? "md" : "txt", d0.tur === "md" ? "Markdown (kaydet)" : `Metin (.${d0.uzanti || "txt"}) (kaydet)`], ...DISA_BELGE.filter((h) => h !== (d0.tur === "md" ? "md" : "txt")).map((h) => [h, FORMATLAR[h].ad])];
    }
    duzenleyici = { tur: edTur, nesne, dosyaAdi, kaynak: d0 };
    kirliBekciKur();

    const secici = el("select", { class: "dn-select", "aria-label": "Kayıt biçimi" }, ...hedefListesi.map(([d, e]) => el("option", { value: d, text: e })));
    const kaydetBtn = dugme({ metin: "Kaydet / indir", ikon: "⬇", tur: "birincil" });
    const kapat = dugme({ metin: "Kapat", ikon: "✕" });
    const durum = ilerlemeCubugu();
    kaydetBtn.addEventListener("click", async () => {
      kaydetBtn.disabled = true;
      durum.goster("Hazırlanıyor…"); durum.ayarla(null, "Hazırlanıyor…");
      try { await duzenleyiciKaydet(secici.value, durum); } catch (h) { bildir(`Kaydedilemedi: ${hataMetni(h)}`, "error"); } finally { kaydetBtn.disabled = false; setTimeout(() => durum.gizle(), 1200); }
    });
    kapat.addEventListener("click", () => duzenleyiciKapat(true));

    bos(calismaAlani);
    calismaAlani.append(
      el("div", { class: "dn-editor-ust" }, el("h2", { text: `✏️ ${d0.file.name}${dosyalar.length > 1 ? ` (+${dosyalar.length - 1})` : ""}` }),
        el("div", { class: "dn-eylemler" }, el("label", { class: "dn-muted" }, "Kayıt biçimi ", secici), kaydetBtn, kapat)),
      durum.el, kap);
    ana.hidden = true;
    calismaAlani.hidden = false;
    ilerleme.gizle();
    nesne.odak?.();
    calismaAlani.scrollIntoView?.({ block: "start" });
  } catch (h) {
    ilerleme.gizle();
    bildir(`Düzenleyici açılamadı: ${hataMetni(h)}`, "error");
  }
}

async function duzenleyiciKaydet(hedefTur, durum) {
  const ed = duzenleyici;
  const ad = ed.dosyaAdi;
  const ctx = { ilerle: (o, m) => durum.ayarla(o, m), uyarilar: [], parola: null };
  let ciktilar;
  if (ed.tur === "pdf") {
    const blob = await ed.nesne.pdfAl((o, m) => durum.ayarla(o * 0.8, m));
    const duzenlenmis = new File([blob], `${ad}-duzenlendi.pdf`, { type: "application/pdf" });
    if (hedefTur === "pdf") ciktilar = [{ blob, ad: `${ad}-duzenlendi.pdf` }];
    else if (hedefTur === "png-zip") ciktilar = await pdfSayfaGorselleri(duzenlenmis, "png", ctx);
    else ciktilar = await donustur(duzenlenmis, "pdf", hedefTur, ctx);
  } else if (ed.tur === "zengin") {
    const html = await ed.nesne.htmlAl();
    ciktilar = await htmldenCikti(html, hedefTur, { baslik: ad, ctx });
  } else {
    const metin = ed.nesne.metinAl();
    const k = ed.kaynak;
    const veri = FORMATLAR[k.tur].aile === "veri";
    if (hedefTur === k.tur || (k.tur === "txt" && hedefTur === "txt")) {
      ciktilar = [{ blob: new Blob([metin], { type: `${FORMATLAR[k.tur].mime};charset=utf-8` }), ad: `${ad}.${k.uzanti || FORMATLAR[k.tur].uzanti}` }];
    } else if (veri) {
      const s = veriDonustur(k.tur, hedefTur, metin, { bom: true });
      ciktilar = [{ blob: new Blob([s.metin], { type: `${s.mime};charset=utf-8` }), ad: `${ad}.${s.uzanti}` }];
    } else {
      const html = await ed.nesne.htmlAl();
      ciktilar = await htmldenCikti(html, hedefTur, { baslik: ad, ctx });
    }
  }
  if (ciktilar.length === 1) indir(ciktilar[0].blob, ciktilar[0].ad);
  else indir(await zipPaketle(ciktilar), `${dosyaAdiTemizle(ad)}-${hedefTur}.zip`);
  durum.ayarla(1, "İndirildi");
  const u = [...new Set(ctx.uyarilar)];
  bildir(`${ciktilar.length === 1 ? ciktilar[0].ad : "ZIP"} indirildi.${u.length ? `\n${u.join("\n")}` : ""}`, "success");
}

/* ------------------------------ ana çizim ------------------------------ */

async function ciz() {
  dosyaListesiCiz();
  const temizle = dugme({ metin: "Hepsini temizle", kucuk: true, tur: "hayalet", hidden: !dosyalar.length });
  temizle.addEventListener("click", dosyalariTemizle);
  bos(ana);
  ana.append(dropzone(), dosyalar.length ? el("div", { class: "dn-kart" }, el("div", { class: "dn-editor-ust" }, el("h2", { text: `Seçilen dosyalar (${dosyalar.length})` }), temizle), liste) : null, kontrolAlani);
  await kontrolCiz();
}

function kutuphaneKarti() {
  const d = el("details", { class: "dn-kart" }, el("summary", { text: "Kullanılan açık kaynak kütüphaneler" }));
  const ul = el("ul", { class: "dn-muted" });
  for (const k of [{ ad: "pdfjs-dist", surum: "5.6.205", lisans: "Apache-2.0", amac: "PDF gösterimi / metin çıkarma" }, { ad: "pdf-lib", surum: "1.17.1", lisans: "MIT", amac: "PDF sayfa işlemleri ve kayıt" }, ...kutuphaneListesi()]) {
    ul.append(el("li", { text: `${k.ad} ${k.surum} (${k.lisans}) — ${k.amac}` }));
  }
  d.append(ul, el("p", { class: "dn-muted", text: "Hepsi sürüme sabitlenmiş jsDelivr/unpkg adreslerinden yüklenir; dosyanız bu kütüphanelere gönderilmez." }));
  return d;
}

async function yonetimKarti() {
  const { data } = await supabase.rpc("donusturucu_yonetim_yetkisi_var_mi");
  if (data !== true) return null;
  const d = el("details", { class: "dn-kart" }, el("summary", { text: "⚙️ Erişim yönetimi (kimler bu aracı kullanabilir?)" }));
  const icerik = el("div", {});
  const m = el("div", { class: "auth-message", hidden: true, role: "status" });
  d.append(icerik, m);
  let yuklendi = false;
  d.addEventListener("toggle", () => {
    if (d.open && !yuklendi) { yuklendi = true; yetkiPaneliniKur(icerik, m).catch((h) => showMessage(m, hataMetni(h), "error")); }
  });
  return d;
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
  kok.classList.add("dn-kok");
  const yonetim = await yonetimKarti();
  kok.replaceChildren(gizlilikRozeti(), ana, calismaAlani, girdi, ...(yonetim ? [yonetim] : []), kutuphaneKarti());
  await ciz();
  window.addEventListener("pagehide", () => { try { duzenleyici?.nesne?.yokEt?.(); } catch { /* yok say */ } tumUrlleriSerbestBirak(); });
}

kur().catch((h) => {
  console.error("donusturucu/donusturucu.js:", h);
  bildir(`Araç yüklenemedi: ${h.message || h}`, "error");
});
