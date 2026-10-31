/*
 * assets/js/yazi-medya/yazi-medya.js — Yönetim paneli › İçerik formu › "📎 Yazı medyası (R2)"
 * Blog yazısı / akademik proje / veri seti için: dosya yükle (HER format; birden çok), metne imleç konumuna ekle, PDF / veri alanına bağla,
 * adres kopyala, "link ile ekle" (Google Drive, Zotero, başka bulut) yedeği, site sahibi için R2 medya aç/kapa anahtarı.
 * Depolama: Arşiv'de "Yazılar/<başlık>/" klasörü (aynı R2 kotası); adres: /m/<anahtar>/<dosya> (migration 0128, Worker /m/).
 * Bu dosya github-yonetim.js'e DOKUNMAZ: #ic-body, #ic-title, #ic-slug, #ic-pdf-url, #ic-veri-url alanlarını bulup kendini ekler.
 * CSP: inline stil/olay işleyici yok.
 */
import { supabase } from "../core/supabase-client.js";
import { dosyalariTopla, kuyrukKur } from "../r2-arsiv/yukleme.js";
import { worker, boyutYaz } from "../r2-arsiv/ortak.js";

const SITE_ALANLARI = ["https://abdullah-eymen-asru.github.io", "https://abdullah-eymen-asru.pages.dev"];
const ASCII = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ç": "c", "Ç": "c", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u" };
const asciiYap = (s) => String(s || "").replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => ASCII[c]).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const anahtarYap = (s) => asciiYap(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
export function dosyaAdiYap(ad, kullanilan = new Set()) {
  const m = /(\.[A-Za-z0-9]{1,10})$/.exec(String(ad)); const uz = m ? m[1].toLowerCase() : "";
  let g = asciiYap(String(ad).slice(0, uz ? -uz.length : undefined)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 120) || "dosya";
  let aday = `${g}${uz}`, n = 2;
  while (kullanilan.has(aday.toLowerCase())) aday = `${g}-${n++}${uz}`;
  return aday;
}
const klasorAdiYap = (b) => String(b || "").normalize("NFC").replace(/[\/\\\u0000-\u001f\u007f]/g, "-").trim().slice(0, 190);
const gorselMi = (ad) => /\.(png|jpe?g|gif|webp|avif)$/i.test(ad);
const pdfMi = (ad) => /\.pdf$/i.test(ad);
const veriMi = (ad) => /\.(csv|tsv|xlsx?|json|ods|parquet|sav|dta|zip|7z|gz|txt)$/i.test(ad);

function el(etiket, sinif, metin) { const e = document.createElement(etiket); if (sinif) e.className = sinif; if (metin != null) e.textContent = metin; return e; }
function dugme(metin, sinif, tikla, ozellik = {}) { const b = el("button", `ym-btn ${sinif || ""}`.trim(), metin); b.type = "button"; for (const [k, v] of Object.entries(ozellik)) b.setAttribute(k, v); if (tikla) b.addEventListener("click", tikla); return b; }

async function kur() {
  const govde = document.getElementById("ic-body");
  if (!govde || document.getElementById("ym-panel")) return;
  const baslikGirdi = document.getElementById("ic-title"), slugGirdi = document.getElementById("ic-slug");
  const pdfAlani = document.getElementById("ic-pdf-url"), veriAlani = document.getElementById("ic-veri-url");

  const panel = el("details", "ym-panel"); panel.id = "ym-panel";
  panel.append(el("summary", "ym-ozet", "📎 Yazı medyası (R2): görsel, PDF, veri seti"));
  const ic = el("div", "ym-ic"); panel.append(ic);
  const mesaj = el("p", "ym-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, hata = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("ym-hata", !!hata); };

  /* --- anahtar (URL parçası) + klasör bilgisi --- */
  const anahtarGirdi = el("input", "ym-girdi"); anahtarGirdi.type = "text"; anahtarGirdi.autocomplete = "off"; anahtarGirdi.spellcheck = false; anahtarGirdi.placeholder = "yazi-anahtari (küçük harf, rakam, tire)";
  anahtarGirdi.setAttribute("aria-label", "Medya adres anahtarı");
  const klasorBilgi = el("p", "ym-soluk");
  let anahtarElle = false;
  const anahtarGuncelle = () => {
    if (!anahtarElle) anahtarGirdi.value = anahtarYap(slugGirdi?.value || baslikGirdi?.value || "");
    const k = klasorAdiYap(baslikGirdi?.value || anahtarGirdi.value);
    klasorBilgi.textContent = k ? `Dosyalar R2/Arşiv'de “Yazılar/${k}/” klasörüne kaydedilir. Adres: /m/${anahtarGirdi.value || "…"}/dosya-adi` : "Önce yazının başlığını yaz; klasör adı başlıktan oluşur.";
  };
  anahtarGirdi.addEventListener("input", () => { anahtarElle = true; anahtarGirdi.value = anahtarYap(anahtarGirdi.value); anahtarGuncelle(); listeYenile(); });
  [baslikGirdi, slugGirdi].forEach((g) => g?.addEventListener("input", () => { anahtarGuncelle(); }));
  [baslikGirdi, slugGirdi].forEach((g) => g?.addEventListener("change", () => { listeYenile(); }));

  /* --- yükleme --- */
  const dosyaGirdi = el("input"); dosyaGirdi.type = "file"; dosyaGirdi.multiple = true; dosyaGirdi.hidden = true;
  const yukleListe = el("ul", "ym-kuyruk"), yukleOzet = el("p", "ym-soluk"), yukleTemizle = dugme("Temizle", "ym-kucuk"); yukleOzet.hidden = true; yukleTemizle.hidden = true;
  let kuyruk = null;
  const kuyrukHazirla = () => kuyruk ||= kuyrukKur({ liste: yukleListe, ozet: yukleOzet, temizleBtn: yukleTemizle,
    baglam: () => ({ yukleyebilir: true, klasor: "Yazılar/", sifreli: false, alicilar: [], uid: null }), bitti: () => kaydetYuklenenleri().catch((h) => bildir(h.message, true)) });
  const yuklemeDugmesi = dugme("📤 Dosya yükle (her format, birden çok)", "ym-birincil", () => {
    if (!anahtarGirdi.value || !klasorAdiYap(baslikGirdi?.value || anahtarGirdi.value)) { bildir("Önce yazının başlığını (ya da medya anahtarını) yaz.", true); return; }
    dosyaGirdi.click();
  });
  dosyaGirdi.addEventListener("change", async () => {
    const klasor = klasorAdiYap(baslikGirdi?.value || anahtarGirdi.value);
    try {
      bildir("Klasör hazırlanıyor…");
      const k = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: "", p_ad: "Yazılar" });
      if (k.error && !/zaten var/i.test(k.error.message || "")) throw new Error(k.error.message);
      const girdiler = (await dosyalariTopla({ files: dosyaGirdi.files })).map((g) => ({ file: g.file, altYol: `${klasor}/` }));
      bildir(""); await kuyrukHazirla().ekle(girdiler);
    } catch (h) { bildir(h.message || String(h), true); }
    dosyaGirdi.value = "";
  });

  /* --- kayıtlı medya listesi --- */
  const liste = el("ul", "ym-liste"), ozetSatir = el("p", "ym-soluk");
  let kayitlar = [];
  async function listeYenile() {
    const k = anahtarGirdi.value; if (!k) { liste.replaceChildren(); ozetSatir.textContent = ""; return; }
    const { data, error } = await supabase.rpc("yazi_medya_listele", { p_yazi: k });
    if (error) { ozetSatir.textContent = /42501|Yetkisiz/i.test(error.message) ? "Yazı medyası için Arşiv yükleme yetkisi gerekir (Yetki Ayarları)." : error.message; liste.replaceChildren(); return; }
    kayitlar = data || []; ciz();
  }
  async function kaydetYuklenenleri() {
    const k = anahtarGirdi.value, klasor = klasorAdiYap(baslikGirdi?.value || k);
    const { data: dosyalar, error } = await supabase.from("r2_arsiv").select("id,ad,boyut").eq("tur", "dosya").eq("sifreli", false).eq("durum", "hazir").eq("klasor_yolu", `Yazılar/${klasor}/`).limit(500);
    if (error) throw new Error(error.message);
    const { data: mevcut } = await supabase.rpc("yazi_medya_listele", { p_yazi: k });
    const kayitliIdler = new Set((mevcut || []).map((m) => m.arsiv_id)), kullanilan = new Set((mevcut || []).map((m) => m.dosya_ad.toLowerCase()));
    let say = 0;
    for (const d of dosyalar || []) {
      if (kayitliIdler.has(d.id)) continue;
      const ad = dosyaAdiYap(d.ad, kullanilan); kullanilan.add(ad.toLowerCase());
      const r = await supabase.rpc("yazi_medya_kaydet", { p_yazi: k, p_ad: ad, p_arsiv_id: d.id });
      if (r.error) throw new Error(`${d.ad}: ${r.error.message}`); say++;
    }
    bildir(say ? `${say} dosya yazıya bağlandı.` : "Yeni dosya yok."); await listeYenile();
  }
  const yol = (ad) => `/m/${anahtarGirdi.value}/${ad}`;
  function metneEkle(parca) {
    const bas = govde.selectionStart ?? govde.value.length, son = govde.selectionEnd ?? bas;
    const onceki = govde.value.slice(0, bas), sonraki = govde.value.slice(son);
    const bosluk = onceki && !onceki.endsWith("\n") ? "\n\n" : "";
    govde.value = `${onceki}${bosluk}${parca}\n\n${sonraki.replace(/^\n+/, "")}`;
    const imlec = (onceki + bosluk + parca + "\n\n").length; govde.focus(); govde.setSelectionRange(imlec, imlec);
    govde.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function kopyala(metin, dugme2) {
    let ok = false; try { await navigator.clipboard.writeText(metin); ok = true; } catch { ok = false; }
    const eski = dugme2.textContent; dugme2.textContent = ok ? "✔ Kopyalandı" : "Kopyalanamadı"; setTimeout(() => { dugme2.textContent = eski; }, 1500);
  }
  function ciz() {
    const toplam = kayitlar.reduce((t, k) => t + Number(k.boyut || 0), 0);
    ozetSatir.textContent = kayitlar.length ? `${kayitlar.length} dosya · ${boyutYaz(toplam)} (bu yazının R2 kullanımı)` : "Bu yazıya bağlı dosya yok.";
    liste.replaceChildren(...kayitlar.map((k) => {
      const li = el("li", "ym-oge"), ust = el("div", "ym-oge-ust");
      ust.append(el("span", "ym-oge-ad", `${gorselMi(k.dosya_ad) ? "🖼️" : pdfMi(k.dosya_ad) ? "📕" : veriMi(k.dosya_ad) ? "📊" : "📄"} ${k.dosya_ad}`), el("small", "ym-soluk", boyutYaz(k.boyut)));
      const alt = el("div", "ym-oge-alt");
      alt.append(dugme(gorselMi(k.dosya_ad) ? "➕ Metne görsel ekle" : "➕ Metne bağlantı ekle", "ym-kucuk ym-birincil", () => metneEkle(gorselMi(k.dosya_ad) ? `![${k.dosya_ad.replace(/\.[^.]+$/, "")}](${yol(k.dosya_ad)})` : `[${k.dosya_ad}](${yol(k.dosya_ad)})`)));
      if (pdfMi(k.dosya_ad) && pdfAlani) alt.append(dugme("📕 PDF alanına yaz", "ym-kucuk", () => { pdfAlani.value = yol(k.dosya_ad); pdfAlani.dispatchEvent(new Event("input", { bubbles: true })); bildir("PDF alanına yazıldı."); }));
      if (veriMi(k.dosya_ad) && veriAlani) alt.append(dugme("📊 Veri seti alanına yaz", "ym-kucuk", () => { veriAlani.value = yol(k.dosya_ad); veriAlani.dispatchEvent(new Event("input", { bubbles: true })); bildir("Veri seti alanına yazıldı."); }));
      SITE_ALANLARI.forEach((alan) => { const kisa = alan.replace("https://", "").replace(".github.io", " (github)").replace(".pages.dev", " (pages)");
        alt.append(dugme(`📋 ${kisa}`, "ym-kucuk", (e) => kopyala(`${alan}/${anahtarGirdi.value}/${k.dosya_ad}`, e.currentTarget), { title: `${alan}/${anahtarGirdi.value}/${k.dosya_ad}` })); });
      alt.append(dugme("🗑 Sil", "ym-kucuk ym-tehlike", async () => {
        if (!window.confirm(`“${k.dosya_ad}” yazıdan kaldırılsın mı?\n\nTamam: yazıdan kaldır VE R2'den de sil.\nİptal: hiçbir şey yapma.`)) return;
        try { const { data, error } = await supabase.rpc("yazi_medya_sil", { p_id: k.id }); if (error) throw new Error(error.message);
          try { await worker("/sil", { id: data }); } catch (h) { bildir(`Kayıt kaldırıldı ama R2 dosyası silinemedi: ${h.message} (Dosya Yöneticisi'nden silebilirsin)`, true); }
          await listeYenile(); } catch (h) { bildir(h.message, true); }
      }));
      li.append(ust, alt); return li;
    }));
  }

  /* --- link ile ekle (yedek) --- */
  const linkAd = el("input", "ym-girdi"); linkAd.type = "text"; linkAd.placeholder = "Görünen ad (örn. Rapor)"; linkAd.setAttribute("aria-label", "Bağlantı adı");
  const linkUrl = el("input", "ym-girdi"); linkUrl.type = "url"; linkUrl.placeholder = "https://… (Google Drive, Zotero, başka bulut)"; linkUrl.setAttribute("aria-label", "Bağlantı adresi");
  const linkTur = el("select", "ym-girdi"); [["baglanti", "Bağlantı"], ["gorsel", "Görsel (doğrudan resim adresi)"], ["pdf", "PDF alanına yaz"], ["veri", "Veri seti alanına yaz"]].forEach(([v, a]) => { const o = el("option", null, a); o.value = v; linkTur.append(o); });
  const linkEkle = dugme("➕ Link ile ekle", "", () => {
    let u; try { u = new URL(linkUrl.value.trim()); } catch { bildir("Geçerli bir adres yaz.", true); return; }
    if (u.protocol !== "https:") { bildir("Yalnızca https:// adresleri kabul edilir.", true); return; }
    const ad = linkAd.value.trim() || u.hostname;
    if (linkTur.value === "pdf" && pdfAlani) { pdfAlani.value = u.href; pdfAlani.dispatchEvent(new Event("input", { bubbles: true })); bildir("PDF alanına yazıldı."); }
    else if (linkTur.value === "veri" && veriAlani) { veriAlani.value = u.href; veriAlani.dispatchEvent(new Event("input", { bubbles: true })); bildir("Veri seti alanına yazıldı."); }
    else if (linkTur.value === "gorsel") { metneEkle(`![${ad}](${u.href})`); bildir("Görsel metne eklendi (adres doğrudan bir resim dosyasına gitmeli; Drive paylaşım sayfaları resim olarak görünmez)."); }
    else { metneEkle(`[${ad}](${u.href})`); bildir("Bağlantı metne eklendi."); }
  });
  const linkKutu = el("details", "ym-link"); linkKutu.append(el("summary", null, "🔗 Link ile ekle (Drive, Zotero, başka bulut)"), linkAd, linkUrl, linkTur, linkEkle);

  /* --- site sahibi: R2 medya aç/kapa --- */
  const ayarKutu = el("div", "ym-ayar"); ayarKutu.hidden = true;
  (async () => {
    try {
      const { data: sahip } = await supabase.rpc("is_owner"); if (sahip !== true) return;
      const { data: a } = await supabase.rpc("r2_medya_ayar_oku"); let durum = a || { acik: true, gorsel_otomatik: true };
      const onay = (etiket, anahtar) => { const l = el("label", "ym-onay"), c = el("input"); c.type = "checkbox"; c.checked = durum[anahtar] !== false;
        c.addEventListener("change", async () => { c.disabled = true; const r = await supabase.rpc("r2_medya_ayar_yaz", { p_acik: anahtar === "acik" ? c.checked : null, p_gorsel_otomatik: anahtar === "gorsel_otomatik" ? c.checked : null });
          c.disabled = false; if (r.error) { c.checked = !c.checked; bildir(r.error.message, true); } else { durum = r.data; bildir("Ayar kaydedildi (en geç 1 dk içinde etkili olur)."); } });
        l.append(c, el("span", null, etiket)); return l; };
      ayarKutu.append(el("strong", null, "Site sahibi: R2 medya anahtarı"), onay("Yazı medyası AÇIK (kapatınca /m/ adresleri R2'ye hiç gitmez; kota korunur)", "acik"), onay("Görseller sayfa açılınca otomatik yüklensin (kapalıysa “Görseli göster” düğmesi çıkar)", "gorsel_otomatik")); ayarKutu.hidden = false;
    } catch { /* ayar yok */ }
  })();

  ic.append(el("p", "ym-soluk", "Görsel, PDF, veri seti ya da her tür dosya yükle; imleç neredeyse oraya ekle. Dosyalar bu yazıya özel R2 klasöründe durur."),
    el("label", "ym-alan", "Medya adres anahtarı"), anahtarGirdi, klasorBilgi, yuklemeDugmesi, dosyaGirdi, yukleListe, yukleOzet, yukleTemizle, ozetSatir, liste, linkKutu, ayarKutu, mesaj);
  govde.insertAdjacentElement("afterend", panel);
  panel.open = true;                                              // varsayılan AÇIK: "Dosya yükle" düğmesi hemen görünür
  panel.addEventListener("toggle", () => { if (panel.open) { anahtarGuncelle(); listeYenile(); } });
  anahtarGuncelle(); listeYenile().catch(() => {});
  /* Editör araç çubuğuna 📎 kısayolu: paneli açar ve görünür yere kaydırır */
  const arac = govde.previousElementSibling;
  if (arac && !arac.querySelector("[data-ym]")) {
    const grup = el("span", "gy-editor-grup"), b = dugme("📎", "", () => { panel.open = true; panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, { title: "R2 medya: dosya yükle / metne ekle", "aria-label": "R2 medya paneli", "data-ym": "1" });
    grup.append(b); arac.append(grup);
  }
}
/* Form bir <template>'ten HER açılışta yeniden klonlanır (github-yonetim.js); bu yüzden sayfa yüklenirken #ic-body YOKTUR.
 * Formu gözleyip her görünüşünde paneli yeniden ekleriz (panel formun içinde olduğu için eski form silinince birlikte gider). */
let kuruyor = false;
const dene = () => {
  if (kuruyor || !document.getElementById("ic-body") || document.getElementById("ym-panel")) return;
  kuruyor = true;
  kur().catch((h) => console.error("yazi-medya.js:", h)).finally(() => { kuruyor = false; });
};
new MutationObserver(dene).observe(document.documentElement, { childList: true, subtree: true });
dene();
