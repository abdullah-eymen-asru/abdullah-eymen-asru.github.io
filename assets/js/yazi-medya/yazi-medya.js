/*
 * assets/js/yazi-medya/yazi-medya.js — Yönetim paneli › İçerik formu › "📎 Yazı Medyası (R2)"
 * Blog yazısı / akademik proje / veri seti için dosya yönetimi, 4 basit adımda:
 *   1) Dosyaları seç (sürükle-bırak ya da düğme; her format, birden çok)   2) Adresteki adı gözden geçir/düzenle
 *   3) Yükle (R2)                                                           4) Metne ekle / PDF ya da Veri Seti alanına yaz
 * Ek olarak PDF Bağlantısı ve Veri Seti URL alanlarının altına "Cihazdan yükle" ve "Yüklenenlerden seç" düğmeleri koyar.
 * Depolama: Arşiv'de "Yazılar/<başlık>/" klasörü (aynı R2 kotası). Adres: /m/<anahtar>/<dosya> ya da temiz biçim <site>/<anahtar>/<dosya.uzanti>.
 * Bu dosya github-yonetim.js'e DOKUNMAZ; form bir <template> klonu olduğu için gözlemciyle her açılışta kendini ekler. CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";
import { dosyalariTopla, kuyrukKur } from "../r2-arsiv/yukleme.js";
import { worker, boyutYaz } from "../r2-arsiv/ortak.js";

const GH = "https://abdullah-eymen-asru.github.io", PAGES = "https://abdullah-eymen-asru.pages.dev";
const REZERVE = new Set(["assets", "panel", "icerik", "kurumsal", "blog", "d", "m", "feed", "sitemap", "robots", "api", "auth", "giris", "kayit", "projeler", "akademik", "iletisim"]);
const ASCII = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ç": "c", "Ç": "c", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u" };
const asciiYap = (s) => String(s || "").replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => ASCII[c]).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const anahtarYap = (s) => asciiYap(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
export function dosyaAdiYap(ad, kullanilan = new Set()) {
  const m = /(\.[A-Za-z0-9]{1,10})$/.exec(String(ad)); const uz = m ? m[1].toLowerCase() : "";
  const g = asciiYap(String(ad).slice(0, uz ? -uz.length : undefined)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 120) || "dosya";
  let aday = `${g}${uz}`, n = 2;
  while (kullanilan.has(aday.toLowerCase())) aday = `${g}-${n++}${uz}`;
  return aday;
}
const klasorAdiYap = (b) => String(b || "").normalize("NFC").replace(/[\/\\\u0000-\u001f\u007f]/g, "-").trim().slice(0, 190);
const gorselMi = (ad) => /\.(png|jpe?g|gif|webp|avif)$/i.test(ad), pdfMi = (ad) => /\.pdf$/i.test(ad);
const veriMi = (ad) => /\.(csv|tsv|xlsx?|json|ods|parquet|sav|dta|zip|7z|gz|txt|rds|rdata)$/i.test(ad);
const ikon = (ad) => (gorselMi(ad) ? "🖼️" : pdfMi(ad) ? "📕" : veriMi(ad) ? "📊" : "📄");

function el(etiket, sinif, metin) { const e = document.createElement(etiket); if (sinif) e.className = sinif; if (metin != null) e.textContent = metin; return e; }
function dugme(metin, sinif, tikla, oz = {}) { const b = el("button", `ym-btn ${sinif || ""}`.trim(), metin); b.type = "button"; for (const [k, v] of Object.entries(oz)) b.setAttribute(k, v); if (tikla) b.addEventListener("click", tikla); return b; }

async function kur() {
  const govde = document.getElementById("ic-body");
  if (!govde || document.getElementById("ym-panel")) return;
  const baslikGirdi = document.getElementById("ic-title"), slugGirdi = document.getElementById("ic-slug");
  const pdfAlani = document.getElementById("ic-pdf-url"), veriAlani = document.getElementById("ic-veri-url");

  const panel = el("details", "ym-panel"); panel.id = "ym-panel"; panel.open = true;
  panel.append(el("summary", "ym-ozet", "📎 Yazı Medyası (R2) — görsel, PDF, veri seti ve her tür dosya"));
  const ic = el("div", "ym-ic"); panel.append(ic);
  const mesaj = el("p", "ym-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, hata = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("ym-hata", !!hata); if (m) mesaj.scrollIntoView?.({ block: "nearest" }); };

  /* ---------- adres anahtarı + kayıt yeri ---------- */
  const anahtarGirdi = el("input", "ym-girdi"); anahtarGirdi.type = "text"; anahtarGirdi.autocomplete = "off"; anahtarGirdi.spellcheck = false; anahtarGirdi.setAttribute("aria-label", "Yazı adres anahtarı");
  const yerBilgi = el("p", "ym-yer");
  let anahtarElle = false;
  const anahtar = () => anahtarGirdi.value;
  const klasorAdi = () => klasorAdiYap(baslikGirdi?.value || anahtar());
  /** Düzenleme: yazının metninde zaten R2 dosyası varsa anahtar OTOMATİK oradan alınır (başlık/adres yeniden yazılmak zorunda kalmaz). */
  const metindenAnahtar = () => (/data-r2="([a-z0-9][a-z0-9-]{0,119})\//.exec(govde.value) || /\]\(\/m\/([a-z0-9][a-z0-9-]{0,119})\//.exec(govde.value) || /\/m\/([a-z0-9][a-z0-9-]{0,119})\/[A-Za-z0-9]/.exec(govde.value) || [])[1] || "";
  function yerGuncelle() {
    const m = metindenAnahtar();
    if (!anahtarElle) anahtarGirdi.value = m || anahtarYap(slugGirdi?.value || baslikGirdi?.value || "");
    yerBilgi.textContent = klasorAdi() ? `📁 Kayıt yeri: Arşiv › Yazılar › ${klasorAdi()}   ·   🔗 Adres: …/${anahtar() || "yazi-adresi"}/dosya-adi` : "Önce yazının başlığını yaz. Dosyalar o başlıkla bir klasöre kaydedilir.";
  }
  anahtarGirdi.addEventListener("input", () => { anahtarElle = true; anahtarGirdi.value = anahtarYap(anahtarGirdi.value); yerGuncelle(); listeYenile(); });
  [baslikGirdi, slugGirdi].forEach((g) => { g?.addEventListener("input", yerGuncelle); g?.addEventListener("change", () => { yerGuncelle(); listeYenile(); }); });
  function hazirMi() {
    if (!anahtar() || !klasorAdi()) { bildir("Önce yazının başlığını yaz (dosyalar o başlıkla bir klasöre kaydedilir).", true); baslikGirdi?.focus(); return false; }
    if (REZERVE.has(anahtar())) { bildir(`“${anahtar()}” sitenin kendi adresi; “Gelişmiş” bölümünden başka bir adres anahtarı yaz.`, true); return false; }
    return true;
  }

  /* ---------- yükleme hattı ---------- */
  let bekleyen = null;                                            // { adlar: Map(orijinalAd → adres adı), cozum }
  const kuyrukListe = el("ul", "ym-kuyruk"), kuyrukOzet = el("p", "ym-soluk"), kuyrukTemizle = dugme("Temizle", "ym-kucuk"); kuyrukOzet.hidden = true; kuyrukTemizle.hidden = true;
  let kuyruk = null;
  const kuyrukHazirla = () => kuyruk ||= kuyrukKur({ liste: kuyrukListe, ozet: kuyrukOzet, temizleBtn: kuyrukTemizle,
    baglam: () => ({ yukleyebilir: true, klasor: "Yazılar/", sifreli: false, alicilar: [], uid: null }),
    bitti: async () => { const b = bekleyen; bekleyen = null; try { const yeni = await kaydetYuklenenleri(b?.adlar); b?.cozum?.(yeni); } catch (h) { bildir(h.message, true); b?.cozum?.([]); } } });
  /** Dosyaları R2'ye yükler ve yazıya bağlar. adlar: Map(orijinal dosya adı → istenen adres adı). Çözüm: yeni kayıtlar. */
  async function yukleVeKaydet(dosyalar, adlar) {
    if (!hazirMi()) return [];
    if (bekleyen) { bildir("Önceki yükleme sürüyor; bitince tekrar dene.", true); return []; }
    bildir("Klasör hazırlanıyor…");
    const k = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: "", p_ad: "Yazılar" });
    if (k.error && !/zaten var/i.test(k.error.message || "")) throw new Error(k.error.message);
    const girdiler = (await dosyalariTopla({ files: dosyalar })).map((g) => ({ file: g.file, altYol: `${klasorAdi()}/` }));
    bildir("");
    return new Promise((coz) => { bekleyen = { adlar, cozum: coz }; kuyrukHazirla().ekle(girdiler).catch((h) => { bekleyen = null; bildir(h.message || String(h), true); coz([]); }); });
  }
  async function kaydetYuklenenleri(adlar = new Map()) {
    const k = anahtar();
    const { data: dosyalar, error } = await supabase.from("r2_arsiv").select("id,ad,boyut").eq("tur", "dosya").eq("sifreli", false).eq("durum", "hazir").eq("klasor_yolu", `Yazılar/${klasorAdi()}/`).limit(500);
    if (error) throw new Error(error.message);
    const { data: mevcut } = await supabase.rpc("yazi_medya_listele", { p_yazi: k });
    const kayitli = new Set((mevcut || []).map((m) => m.arsiv_id)), kullanilan = new Set((mevcut || []).map((m) => m.dosya_ad.toLowerCase()));
    const yeniler = [];
    for (const d of dosyalar || []) {
      if (kayitli.has(d.id)) continue;
      const istenen = adlar.get(d.ad) || d.ad, ad = dosyaAdiYap(istenen, kullanilan); kullanilan.add(ad.toLowerCase());
      const r = await supabase.rpc("yazi_medya_kaydet", { p_yazi: k, p_ad: ad, p_arsiv_id: d.id });
      if (r.error) throw new Error(`${d.ad}: ${r.error.message}`); yeniler.push({ id: r.data, ad });
    }
    bildir(yeniler.length ? `✔ ${yeniler.length} dosya yüklendi ve yazıya bağlandı.` : "Yeni dosya bulunamadı."); await listeYenile();
    return yeniler;
  }

  /* ---------- 1-2) seçim + adlandırma (yüklemeden önce) ---------- */
  const dosyaGirdi = el("input"); dosyaGirdi.type = "file"; dosyaGirdi.multiple = true; dosyaGirdi.hidden = true;
  const birak = el("div", "ym-birak"); birak.tabIndex = 0; birak.setAttribute("role", "button"); birak.setAttribute("aria-label", "Dosya seçmek için tıkla ya da buraya sürükle");
  birak.append(el("strong", null, "Dosyaları buraya sürükle"), el("span", "ym-soluk", "ya da tıkla ve seç · her format · birden çok dosya"));
  const hazirListe = el("ul", "ym-hazir"), yukleDugme = dugme("", "ym-birincil", null); yukleDugme.hidden = true;
  let hazir = [];                                                 // [{file, girdi}]
  const aracAcik = () => dosyaGirdi.click();
  birak.addEventListener("click", aracAcik); birak.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aracAcik(); } });
  ["dragenter", "dragover"].forEach((o) => birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.add("surukle"); }));
  ["dragleave", "drop"].forEach((o) => birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.remove("surukle"); }));
  birak.addEventListener("drop", (e) => ekleHazir(e.dataTransfer?.files));
  dosyaGirdi.addEventListener("change", () => { ekleHazir(dosyaGirdi.files); dosyaGirdi.value = ""; });
  function ekleHazir(dosyalar) {
    if (!dosyalar?.length) return;
    const kullanilan = new Set(hazir.map((h) => h.girdi.value.toLowerCase()).concat(kayitlar.map((k) => k.dosya_ad.toLowerCase())));
    for (const f of dosyalar) { const g = el("input", "ym-girdi ym-ad"); g.type = "text"; g.value = dosyaAdiYap(f.name, kullanilan); kullanilan.add(g.value.toLowerCase()); g.setAttribute("aria-label", `${f.name} için adres adı`); g.spellcheck = false; hazir.push({ file: f, girdi: g }); }
    hazirCiz();
  }
  function hazirCiz() {
    hazirListe.replaceChildren(...hazir.map((h, i) => {
      const li = el("li", "ym-hazir-oge"), ust = el("div", "ym-hazir-ust");
      ust.append(el("span", "ym-oge-ad", `${ikon(h.file.name)} ${h.file.name}`), el("small", "ym-soluk", boyutYaz(h.file.size)), dugme("✕", "ym-kucuk", () => { hazir.splice(i, 1); hazirCiz(); }, { "aria-label": `${h.file.name} dosyasını listeden çıkar` }));
      const alt = el("label", "ym-ad-etiket"); alt.append(el("span", "ym-soluk", "Adresteki adı (boşluk ve Türkçe harf otomatik düzeltilir):"), h.girdi);
      h.girdi.addEventListener("blur", () => { h.girdi.value = dosyaAdiYap(h.girdi.value || h.file.name); });
      li.append(ust, alt); return li;
    }));
    yukleDugme.hidden = !hazir.length; yukleDugme.textContent = `⬆ ${hazir.length} dosyayı R2'ye yükle ve yazıya bağla`;
  }
  yukleDugme.addEventListener("click", async () => {
    if (!hazir.length) return; yukleDugme.disabled = true;
    try {
      const adlar = new Map(hazir.map((h) => [h.file.name, h.girdi.value.trim() || h.file.name]));
      const yeni = await yukleVeKaydet(hazir.map((h) => h.file), adlar); if (yeni.length) { hazir = []; hazirCiz(); }
    } catch (h) { bildir(h.message || String(h), true); } finally { yukleDugme.disabled = false; }
  });

  /* ---------- 4) yüklenenler ---------- */
  const liste = el("ul", "ym-liste"), ozetSatir = el("p", "ym-soluk");
  let kayitlar = [], sekmeGuncelle = () => {}, ilkListe = () => {}, ilkGoruldu = false;
  async function listeYenile() {
    if (!anahtar()) { liste.replaceChildren(); ozetSatir.textContent = ""; return; }
    const { data, error } = await supabase.rpc("yazi_medya_listele", { p_yazi: anahtar() });
    if (error) { ozetSatir.textContent = /42501|Yetkisiz/i.test(error.message) ? "Yazı medyası için Arşiv yükleme yetkisi gerekir (Yetki Ayarları › Arşiv)." : error.message; liste.replaceChildren(); kayitlar = []; return; }
    kayitlar = data || []; ciz(); sekmeGuncelle(); if (!ilkGoruldu && kayitlar.length) { ilkGoruldu = true; ilkListe(); }
  }
  const mYol = (ad) => `/m/${anahtar()}/${ad}`;
  const genelUrl = (ad, alan = GH) => (/\.[A-Za-z0-9]{1,10}$/.test(ad) ? `${alan}/${anahtar()}/${ad}` : `${alan}/m/${anahtar()}/${ad}`);
  function metneEkle(parca) {
    let bas = govde.selectionStart ?? govde.value.length, son = govde.selectionEnd ?? bas;
    // İmleç daha önce eklenmiş bir medya bloğunun (<figure…</figure> / <div data-r2…></div>) İÇİNDEYSE bloğun hemen SONRASINA ekle: kod bölünüp bozulmasın.
    for (const m of govde.value.matchAll(/<figure\b[\s\S]*?<\/figure>|<div\b[^>]*data-r2[^>]*>\s*<\/div>/gi)) { const bit = m.index + m[0].length; if (bas > m.index && bas < bit) { bas = bit; son = bit; break; } }
    const onceki = govde.value.slice(0, bas), sonraki = govde.value.slice(son);
    const bosluk = onceki && !onceki.endsWith("\n") ? "\n\n" : "";
    govde.value = `${onceki}${bosluk}${parca}\n\n${sonraki.replace(/^\n+/, "")}`;
    const imlec = (onceki + bosluk + parca + "\n\n").length; govde.focus(); govde.setSelectionRange(imlec, imlec); govde.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const alanaYaz = (girdi, url, ad) => { girdi.value = url; girdi.dispatchEvent(new Event("input", { bubbles: true })); girdi.dispatchEvent(new Event("change", { bubbles: true })); bildir(`✔ ${ad} alanına yazıldı.`); };
  async function kopyala(metin, d) { let ok = false; try { await navigator.clipboard.writeText(metin); ok = true; } catch { ok = false; } const e = d.textContent; d.textContent = ok ? "✔ Kopyalandı" : "Kopyalanamadı"; setTimeout(() => { d.textContent = e; }, 1500); }
  /** "Metne ekle" seçenekleri: dosya türüne göre nerede/nasıl görüneceği. Üretilen HTML tek satırdır (kramdown bloğu). */
  const kac = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r?\n/g, " ").trim();
  const tur = (ad) => (gorselMi(ad) ? "gorsel" : pdfMi(ad) ? "pdf" : /\.(mp3|m4a|wav|ogg|oga|flac|aac|opus)$/i.test(ad) ? "ses" : /\.(mp4|webm|mov|m4v|ogv)$/i.test(ad) ? "video" : "dosya");
  function secimAlani(etiket, secenekler, varsayilan) { const l = el("label", "ym-ek-alan"), s2 = el("select", "ym-girdi"); secenekler.forEach(([v, a]) => { const o = el("option", null, a); o.value = v; s2.append(o); }); s2.value = varsayilan; l.append(el("span", "ym-soluk", etiket), s2); return { kok: l, deger: () => s2.value }; }
  function ekleSecenekleri(k) {
    const kutu = el("div", "ym-ekle"), t = tur(k.dosya_ad), yolu = `${anahtar()}/${k.dosya_ad}`, bos = k.dosya_ad.replace(/\.[^.]+$/, "");
    const baslik = el("input", "ym-girdi"); baslik.type = "text"; baslik.placeholder = t === "gorsel" ? "Altyazı (görselin altında görünür, isteğe bağlı)" : "Başlık (kartta görünür, isteğe bağlı)"; baslik.setAttribute("aria-label", "Başlık / altyazı");
    const alanlar = [];
    let konum, boyut, gom, yuk;
    if (t === "gorsel") {
      konum = secimAlani("Konum", [["orta", "Ortada (satır arası)"], ["sol", "Sola yasla — yazı sağından aksın"], ["sag", "Sağa yasla — yazı solundan aksın"], ["tam", "Tam genişlik"]], "orta");
      boyut = secimAlani("Boyut (sayfa genişliğine göre)", [["25", "Küçük (%25)"], ["50", "Orta (%50)"], ["75", "Büyük (%75)"], ["100", "Tam (%100)"]], "75"); alanlar.push(konum.kok, boyut.kok);
    } else if (t === "pdf") {
      gom = secimAlani("Gösterim", [["1", "Yazının içinde okuyucu (Burada oku düğmesiyle açılır) + indirme"], ["0", "Yalnızca indirme kartı"]], "1");
      yuk = secimAlani("Okuyucu yüksekliği", [["600", "Normal"], ["800", "Yüksek"]], "600"); alanlar.push(gom.kok, yuk.kok);
    } else alanlar.push(el("p", "ym-soluk", t === "ses" ? "Ses oynatıcı olarak gösterilir (oynat tuşuna basılınca yüklenir; kota harcanmaz)." : t === "video" ? "Video oynatıcı olarak gösterilir (oynat tuşuna basılınca yüklenir)." : "İndirme kartı olarak gösterilir; tıklayınca dosya bilgi sayfası ve İndir düğmesi açılır."));
    const onizleme = el("code", "ym-kod");
    const uret = () => {
      const b = kac(baslik.value);
      if (t === "gorsel") return `<figure class="r2-fig r2-konum-${konum.deger()} r2-w${boyut.deger()}" data-r2="${yolu}" data-tur="gorsel"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="${kac(b || bos)}">${b ? `<figcaption>${b}</figcaption>` : ""}</figure>`;
      if (t === "pdf") return `<div data-r2="${yolu}" data-tur="pdf" data-gom="${gom.deger()}" data-yukseklik="${yuk.deger()}"${b ? ` data-baslik="${b}"` : ""}></div>`;
      return `<div data-r2="${yolu}" data-tur="${t}"${b ? ` data-baslik="${b}"` : ""}></div>`;
    };
    const guncelle = () => { onizleme.textContent = uret(); };
    [baslik, ...alanlar.flatMap((a) => (a.querySelector ? [...a.querySelectorAll("select")] : []))].forEach((g) => g.addEventListener("input", guncelle)); guncelle();
    kutu.append(...alanlar, baslik, dugme("✔ Metne ekle (imleç konumuna)", "ym-birincil", () => { metneEkle(uret()); bildir("✔ Metne eklendi. Yayınlanan sayfada böyle görünür; konumu değiştirmek için kodu düzenleyebilir ya da yeniden ekleyebilirsin."); kutu.hidden = true; }),
      el("details", "ym-kod-kutu", "").appendChild(el("summary", null, "Üretilen kodu göster")).parentNode);
    kutu.lastChild.append(onizleme);
    return kutu;
  }
  function ciz() {
    const toplam = kayitlar.reduce((t, k) => t + Number(k.boyut || 0), 0);
    ozetSatir.textContent = kayitlar.length ? `${kayitlar.length} dosya · ${boyutYaz(toplam)} (bu yazının R2 kullanımı)` : "Bu yazıya bağlı dosya yok. Yukarıdan dosya seç.";
    liste.replaceChildren(...kayitlar.map((k) => {
      const li = el("li", "ym-oge"), ust = el("div", "ym-oge-ust"), ad = el("span", "ym-oge-ad", `${ikon(k.dosya_ad)} ${k.dosya_ad}`);
      const adDegistir = dugme("✏️ Adı değiştir", "ym-kucuk", () => {
        const g = el("input", "ym-girdi"); g.type = "text"; g.value = k.dosya_ad; g.setAttribute("aria-label", "Yeni adres adı");
        const kaydet = dugme("Kaydet", "ym-kucuk ym-birincil", async () => { const r = await supabase.rpc("yazi_medya_adlandir", { p_id: k.id, p_yeni_ad: dosyaAdiYap(g.value) }); if (r.error) bildir(r.error.message, true); else { bildir("✔ Ad değişti. Metinde eski adı kullandıysan güncelle."); await listeYenile(); } });
        const iptal = dugme("Vazgeç", "ym-kucuk", () => ciz()); ust.replaceChildren(g, kaydet, iptal); g.focus(); g.select();
      });
      ust.append(ad, el("small", "ym-soluk", boyutYaz(k.boyut)));
      const alt = el("div", "ym-oge-alt"), ekleKutu = ekleSecenekleri(k); ekleKutu.hidden = true;
      alt.append(dugme("➕ Metne ekle…", "ym-kucuk ym-birincil", () => { ekleKutu.hidden = !ekleKutu.hidden; }));
      if (pdfAlani && pdfMi(k.dosya_ad)) alt.append(dugme("📕 PDF Bağlantısı alanına yaz", "ym-kucuk", () => alanaYaz(pdfAlani, genelUrl(k.dosya_ad), "PDF Bağlantısı")));
      if (veriAlani) alt.append(dugme("📊 Veri Seti alanına yaz", "ym-kucuk", () => alanaYaz(veriAlani, genelUrl(k.dosya_ad), "Veri Seti URL")));
      alt.append(dugme("📋 Adresi kopyala", "ym-kucuk", (e) => kopyala(genelUrl(k.dosya_ad), e.currentTarget), { title: genelUrl(k.dosya_ad) }),
        dugme("📋 pages.dev", "ym-kucuk", (e) => kopyala(genelUrl(k.dosya_ad, PAGES), e.currentTarget), { title: genelUrl(k.dosya_ad, PAGES) }), adDegistir,
        dugme("🗑 Sil", "ym-kucuk ym-tehlike", async () => {
          if (!window.confirm(`“${k.dosya_ad}” yazıdan kaldırılsın ve R2'den silinsin mi?\n\nBu işlem geri alınamaz. Metinde bu dosyayı kullandıysan o satırı da sil.`)) return;
          try { const { data, error } = await supabase.rpc("yazi_medya_sil", { p_id: k.id }); if (error) throw new Error(error.message);
            try { await worker("/sil", { id: data }); } catch (h) { bildir(`Kayıt kaldırıldı ama R2 dosyası silinemedi: ${h.message} (Dosya Yöneticisi'nden silebilirsin)`, true); }
            await listeYenile(); } catch (h) { bildir(h.message, true); }
        }));
      li.append(ust, alt, ekleKutu); return li;
    }));
  }

  /* ---------- PDF / Veri Seti alanları: cihazdan yükle + yüklenenlerden seç ---------- */
  function alanYardimcisi(girdi, ad, kabul, uygun) {
    if (!girdi || girdi.dataset.ymEklendi) return; girdi.dataset.ymEklendi = "1";
    const satir = el("div", "ym-alan-satir"), dg = el("input"); dg.type = "file"; dg.hidden = true; if (kabul) dg.accept = kabul;
    const sec = el("select", "ym-girdi ym-secim"); sec.setAttribute("aria-label", `${ad}: bu yazıya yüklenmiş dosyalardan seç`);
    const yenileSecenek = () => { sec.replaceChildren(); const o0 = el("option", null, "📂 Yüklenenlerden seç…"); o0.value = ""; sec.append(o0); kayitlar.filter((k) => uygun(k.dosya_ad)).forEach((k) => { const o = el("option", null, k.dosya_ad); o.value = k.dosya_ad; sec.append(o); }); };
    sec.addEventListener("focus", yenileSecenek); sec.addEventListener("mousedown", yenileSecenek);
    sec.addEventListener("change", () => { if (sec.value) alanaYaz(girdi, genelUrl(sec.value), ad); sec.value = ""; });
    const yukle = dugme("📤 Cihazdan yükle", "ym-kucuk ym-birincil", () => { if (hazirMi()) dg.click(); });
    dg.addEventListener("change", async () => {
      const f = dg.files?.[0]; dg.value = ""; if (!f) return;
      try { yukle.disabled = true; const yeni = await yukleVeKaydet([f], new Map([[f.name, f.name]])); if (yeni[0]) alanaYaz(girdi, genelUrl(yeni[0].ad), ad); }
      catch (h) { bildir(h.message || String(h), true); } finally { yukle.disabled = false; }
    });
    satir.append(yukle, sec, dg, el("small", "ym-soluk", "Ya da yukarıya bir bağlantı (https://…) yapıştır: Drive, Zotero, Zenodo vb."));
    girdi.insertAdjacentElement("afterend", satir);
  }
  alanYardimcisi(pdfAlani, "PDF Bağlantısı", ".pdf,application/pdf", pdfMi);
  alanYardimcisi(veriAlani, "Veri Seti URL", "", () => true);

  /* ---------- gelişmiş: adres anahtarı ---------- */
  const gelismis = el("details", "ym-gelismis"); gelismis.append(el("summary", null, "⚙ Gelişmiş: adres anahtarı"),
    el("p", "ym-soluk", "Dosya adreslerinin yazıya özel kısmı (örn. china-turkiye-relations). Normalde başlıktan otomatik oluşur; değiştirirsen daha önce metne eklediğin adresler eski anahtarla kalır."), anahtarGirdi);

  /* ---------- link ile ekle (yedek) ---------- */
  const linkAd = el("input", "ym-girdi"); linkAd.type = "text"; linkAd.placeholder = "Görünen ad (örn. Rapor)"; linkAd.setAttribute("aria-label", "Bağlantı adı");
  const linkUrl = el("input", "ym-girdi"); linkUrl.type = "url"; linkUrl.placeholder = "https://… (Google Drive, Zotero, başka bulut)"; linkUrl.setAttribute("aria-label", "Bağlantı adresi");
  const linkTur = el("select", "ym-girdi"); [["baglanti", "Metne bağlantı olarak ekle"], ["gorsel", "Metne görsel olarak ekle (doğrudan resim adresi)"], ["pdf", "PDF Bağlantısı alanına yaz"], ["veri", "Veri Seti URL alanına yaz"]].forEach(([v, a]) => { const o = el("option", null, a); o.value = v; linkTur.append(o); });
  const linkKutu = el("div", "ym-link"); linkKutu.append(el("strong", null, "🔗 Dosyayı yüklemek yerine hazır bir bağlantı ekle"), el("p", "ym-soluk", "Dosya zaten Drive, Zotero ya da başka bir bulutta duruyorsa adresini buraya yapıştır; R2 kotası harcanmaz."), linkAd, linkUrl, linkTur,
    dugme("➕ Ekle", "ym-birincil", () => {
      let u; try { u = new URL(linkUrl.value.trim()); } catch { bildir("Geçerli bir adres yaz.", true); return; }
      if (u.protocol !== "https:") { bildir("Yalnızca https:// adresleri kabul edilir.", true); return; }
      const ad = linkAd.value.trim() || u.hostname;
      if (linkTur.value === "pdf" && pdfAlani) alanaYaz(pdfAlani, u.href, "PDF Bağlantısı");
      else if (linkTur.value === "veri" && veriAlani) alanaYaz(veriAlani, u.href, "Veri Seti URL");
      else if (linkTur.value === "gorsel") { metneEkle(`![${ad}](${u.href})`); bildir("Görsel metne eklendi (adres doğrudan bir resim dosyasına gitmeli; Drive paylaşım sayfaları resim olarak görünmez)."); }
      else { metneEkle(`[${ad}](${u.href})`); bildir("Bağlantı metne eklendi."); }
    }));

  /* ---------- site sahibi: R2 medya aç/kapa ---------- */
  const ayarKutu = el("div", "ym-ayar"); ayarKutu.hidden = true;
  (async () => {
    try {
      const { data: sahip } = await supabase.rpc("is_owner"); if (sahip !== true) return;
      const { data: a } = await supabase.rpc("r2_medya_ayar_oku"); let durum = a || { acik: true, gorsel_otomatik: true };
      const onay = (etiket, ipucu, anahtarAdi) => { const l = el("label", "ym-onay"), c = el("input"); c.type = "checkbox"; c.checked = durum[anahtarAdi] !== false;
        c.addEventListener("change", async () => { c.disabled = true; const r = await supabase.rpc("r2_medya_ayar_yaz", { p_acik: anahtarAdi === "acik" ? c.checked : null, p_gorsel_otomatik: anahtarAdi === "gorsel_otomatik" ? c.checked : null });
          c.disabled = false; if (r.error) { c.checked = !c.checked; bildir(r.error.message, true); } else { durum = r.data; bildir("✔ Ayar kaydedildi (en geç 1 dakika içinde tüm ziyaretçilerde etkili olur)."); } });
        const t = el("span"); t.append(el("strong", null, etiket), el("small", "ym-soluk", ` — ${ipucu}`)); l.append(c, t); return l; };
      ayarKutu.append(el("h4", "ym-baslik2", "🛡 Site sahibi: R2 kota koruması"),
        onay("Yazı medyası açık", "kapatırsan sitedeki görseller ve dosya adresleri R2'ye hiç istek göndermez (kota korunur).", "acik"),
        onay("Görseller sayfa açılınca otomatik yüklensin", "kapatırsan her görsel “Görseli göster” düğmesine basılınca yüklenir.", "gorsel_otomatik")); ayarKutu.hidden = false;
    } catch { /* ayar yok */ }
  })();

  /* ---------- sekmeler: Yükle · Yüklenenler · Hazır bağlantı ---------- */
  const bolumYukle = el("div", "ym-bolum"), bolumListe = el("div", "ym-bolum"), bolumLink = el("div", "ym-bolum");
  bolumYukle.append(birak, dosyaGirdi, hazirListe, yukleDugme, kuyrukListe, kuyrukOzet, kuyrukTemizle);
  bolumListe.append(ozetSatir, liste);
  bolumLink.append(linkKutu);
  const sekmeBar = el("div", "ym-sekmeler"); sekmeBar.setAttribute("role", "tablist");
  const sekmeler = {};
  const bolumler = { yukle: bolumYukle, liste: bolumListe, link: bolumLink };
  const etiketler = { yukle: "① Dosya yükle", liste: "② Bu yazının dosyaları", link: "③ Hazır bağlantı" };
  function sekmeGit(ad) { Object.entries(bolumler).forEach(([k, b]) => { b.hidden = k !== ad; sekmeler[k].setAttribute("aria-selected", String(k === ad)); }); }
  Object.keys(bolumler).forEach((k) => { const b = dugme(etiketler[k], "ym-sekme", () => sekmeGit(k)); b.setAttribute("role", "tab"); sekmeler[k] = b; sekmeBar.append(b); });
  sekmeGit("yukle");
  sekmeGuncelle = () => { sekmeler.liste.textContent = `② Bu yazının dosyaları (${kayitlar.length})`; };
  ilkListe = () => { if (kayitlar.length) sekmeGit("liste"); };
  ic.append(
    el("p", "ym-soluk", "Görsel, PDF, ses, video, veri seti — her türlü dosya. Yükle, sonra “Bu yazının dosyaları”ndan metne ekle. Dosyalar R2'de yazıya özel klasörde durur."),
    yerBilgi, sekmeBar, bolumYukle, bolumListe, bolumLink, gelismis, ayarKutu, mesaj);
  govde.insertAdjacentElement("afterend", panel);
  panel.addEventListener("toggle", () => { if (panel.open) { yerGuncelle(); listeYenile(); } });
  yerGuncelle(); listeYenile().catch(() => {});
  // Düzenleme formu metni programatik doldurur (input olayı yok): kısa aralıklarla metinden anahtarı yeniden dene
  [400, 1200, 2800].forEach((ms) => setTimeout(() => { if (!anahtarElle && metindenAnahtar() && metindenAnahtar() !== anahtarGirdi.value) { yerGuncelle(); listeYenile(); } else if (!kayitlar.length) listeYenile(); }, ms));
  govde.addEventListener("input", () => { if (!anahtarElle && metindenAnahtar() && metindenAnahtar() !== anahtarGirdi.value) { yerGuncelle(); listeYenile(); } });
  const arac = govde.previousElementSibling;
  if (arac && !arac.querySelector("[data-ym]")) { const grup = el("span", "gy-editor-grup"); grup.append(dugme("📎", "", () => { panel.open = true; panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, { title: "R2 medya: dosya yükle / metne ekle", "aria-label": "R2 medya paneli", "data-ym": "1" })); arac.append(grup); }
}
/* Form bir <template>'ten HER açılışta yeniden klonlanır; gözlemle her görünüşünde paneli ve alan yardımcılarını yeniden ekleriz. */
let kuruyor = false;
const dene = () => { if (kuruyor || !document.getElementById("ic-body") || document.getElementById("ym-panel")) return; kuruyor = true; kur().catch((h) => console.error("yazi-medya.js:", h)).finally(() => { kuruyor = false; }); };
new MutationObserver(dene).observe(document.documentElement, { childList: true, subtree: true });
dene();
