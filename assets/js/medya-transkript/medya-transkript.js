/*
 * assets/js/medya-transkript/medya-transkript.js — Araçlar › Medya Araçları › Transkript Stüdyosu
 *
 * AKIŞ (3 adım): ① Kayıt seç (süre anında görünür; "Ses çözülüyor" beklemesi YOK) → ② Aralık + ayarlar → ③ Sonuç (Okuma · Satırlar · Konuşmacılar · İndir).
 *  • Ses tarayıcıda PARÇA PARÇA çözülür (ses-akis.js, WebCodecs) ve 16 kHz mono MP3'e sıkıştırılır; seçilen aralık dışı hiç çözülmez/gönderilmez.
 *  • Yazıya dökme: transkript-worker → Groq Whisper (zaman damgalı satırlar).
 *  • KONUŞMACILAR OTOMATİK: her parça için aynı ses + döküm Worker'ın /konusmaci ucuna (Gemini) gider; kişiler parçalar arası aynı etiketle izlenir.
 *    Servis kapalıysa/başarısızsa döküm yine hazırdır; konuşmacı elle atanır ya da duraklamaya göre TAHMİNİ ayrılır.
 *  • Okuma görünümü: konuşma turları + kısa paragraflar (kendi kaydırma alanında; sayfa uzamaz). Dışa aktarma çıktıları aynı yapıyı kullanır (PDF/Word/TXT/MD/HTML).
 *  • Kota (kullanıcı + genel) ve isteğe bağlı KENDİ Groq anahtarı: medya-kota.js. Yerel geçmiş yalnızca bu tarayıcının IndexedDB'sindedir.
 * GİZLİLİK: ses yalnızca Worker üzerinden Groq'a (ve konuşmacı ayrımı açıksa Google Gemini'ye) gider; Worker kayıt tutmaz. CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, dosyaAdiTemizle } from "../donusturucu/ortak.js";
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
import { SINIR } from "../medya-donustur/ses-ortak.js";
import { ilerlemeKur } from "../medya-donustur/ses-ortak.js";
import { kotaPaneli, kaynakSecici, kotaDurumuOku } from "../medya-kota/medya-kota.js";
import { sureOku, sesAkisi, mp3Kodla, mp3Dilim, uyanikTut } from "./ses-akis.js";
import { kendiAnahtarlar, konusmaciAyirKendi, anahtarEkle, SAGLAYICILAR, SAGLAYICI_SIRASI } from "./konusmaci-ai.js";
import { RENKLER, saat, gunSaniyesi, gunSaati, kelimeSay, istatistik, tahminiAyir, dolguTemizle, anahtarKelimeler, baslikOner, metinUret, turlariUret, belgeBloklari, kunyeMetni, kisaSaat } from "./transkript-mantik.js";

const kok = document.getElementById("ts-kok");
const WORKER = "https://transkript-worker.aeymena.workers.dev";
const SAYFA = 200, TUR_ADIM = 40;
const DILLER = [["", "Otomatik algıla"], ["tr", "Türkçe"], ["en", "İngilizce"], ["de", "Almanca"], ["fr", "Fransızca"], ["es", "İspanyolca"], ["it", "İtalyanca"], ["pt", "Portekizce"], ["nl", "Felemenkçe"], ["ru", "Rusça"], ["ar", "Arapça"], ["fa", "Farsça"], ["zh", "Çince"], ["ja", "Japonca"], ["ko", "Korece"], ["hi", "Hintçe"], ["uk", "Ukraynaca"], ["pl", "Lehçe"]];
const p2 = (n) => String(n).padStart(2, "0");
const sureYaz = (sn) => { sn = Math.round(sn); const s = Math.floor(sn / 3600), d = Math.floor((sn % 3600) / 60), k = sn % 60; return s ? `${s} sa ${d} dk` : d ? `${d} dk${k ? ` ${k} sn` : ""}` : `${k} sn`; };
const sureGoster = (sn) => { sn = Math.max(0, Math.round(sn)); const s = Math.floor(sn / 3600); return `${s ? `${s}:` : ""}${p2(Math.floor((sn % 3600) / 60))}:${p2(sn % 60)}`; };
/** "90" · "1:30" · "1:02:03" → saniye; geçersizse null. */
const sureCoz = (t) => { const m = String(t || "").trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})$|^(\d+(?:[.,]\d+)?)$/); if (!m) return null; if (m[4]) return Number(m[4].replace(",", ".")); return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]); };
const tercih = { oku(a, v) { try { const x = localStorage.getItem(`mt:${a}`); return x == null ? v : x; } catch { return v; } }, yaz(a, v) { try { localStorage.setItem(`mt:${a}`, String(v)); } catch { /* yerel depolama yok */ } } };

/* ---------------- Yerel geçmiş (IndexedDB; yalnızca bu tarayıcı) ---------------- */
const gecmis = {
  ac() { return new Promise((coz, red) => { try { const r = indexedDB.open("mt-gecmis", 1); r.onupgradeneeded = () => r.result.createObjectStore("kayit", { keyPath: "id" }); r.onsuccess = () => coz(r.result); r.onerror = () => red(r.error); } catch (h) { red(h); } }); },
  async islem(mod, fn) { const db = await this.ac(); return new Promise((coz, red) => { const t = db.transaction("kayit", mod), s = t.objectStore("kayit"), r = fn(s); t.oncomplete = () => { db.close(); coz(r?.result); }; t.onerror = () => { db.close(); red(t.error); }; }); },
  kaydet(k) { return this.islem("readwrite", (s) => s.put(k)); },
  sil(id) { return this.islem("readwrite", (s) => s.delete(id)); },
  liste() { return this.islem("readonly", (s) => s.getAll()); },
};

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("arac_yetkisi_var_mi", { p_arac: "transkript" });
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Transkript aracına erişim yetkin yok. Site Sahibi, Yetki Ayarları › Özellikler bölümünden açabilir." }))); return; }

  /* ---------------- Durum ---------------- */
  let dosya = null, kayitSure = 0, sesUrl = null, iptal = null, devam = null, ayirKapali = null;
  let T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] };
  let nid = 1, sayfaBas = 0, secili = new Set(), bulunan = [], bulIdx = -1, aramaMetni = "", geriAl = [], kayitId = null, baslikElleMi = false, sekme = "okuma", turSayisi = TUR_ADIM;
  const yeniSeg = (o) => ({ id: nid++, ...o });

  const mesaj = el("p", { class: "md-mesaj", role: "status", "aria-live": "polite" }), bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("md-hata", !!h); };
  const { ilr, cubuk, sureYazi } = ilerlemeKur(bildir);
  const kota = kotaPaneli("transkript"), kaynak = kaynakSecici("transkript");
  const dugme = (m, f, t = "", sinif = "md-btn") => { const b = el("button", { type: "button", class: sinif, text: m, title: t }); b.addEventListener("click", f); return b; };
  const renk = (k) => (k == null ? "#94a3b8" : T.konusmacilar[k]?.renk || RENKLER[k % RENKLER.length]);
  const topSure = () => (T.segmentler.length ? T.segmentler[T.segmentler.length - 1].s : 0);
  const atanmisVar = () => T.segmentler.some((s) => s.k != null && T.konusmacilar[s.k]);

  /* ---------------- ① Kayıt seç ---------------- */
  const girdi = el("input", { type: "file", accept: "audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm", hidden: true });
  const birakAlani = el("button", { type: "button", class: "ts-birak" },
    el("span", { class: "ts-birak-ikon", text: "🎙", "aria-hidden": "true" }), el("strong", { text: "Ses ya da video dosyası seç" }), el("span", { class: "md-soluk", text: "veya buraya sürükle · MP3, M4A, WAV, OGG, MP4, MOV, WEBM · en çok 400 MB" }));
  const dosyaBilgi = el("div", { class: "ts-dosya", hidden: true });
  birakAlani.addEventListener("click", () => girdi.click());
  for (const o of ["dragenter", "dragover"]) birakAlani.addEventListener(o, (e) => { e.preventDefault(); birakAlani.classList.add("ts-ustunde"); });
  for (const o of ["dragleave", "drop"]) birakAlani.addEventListener(o, (e) => { e.preventDefault(); birakAlani.classList.remove("ts-ustunde"); });
  birakAlani.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) yukle(f); });
  const oynatici = el("audio", { controls: true, preload: "metadata", class: "ts-oynatici", "aria-label": "Kayıt" });

  /* ---------------- ② Aralık ---------------- */
  const tumKayit = el("input", { type: "radio", name: "ts-aralik", checked: true }), ozelAralik = el("input", { type: "radio", name: "ts-aralik" });
  const basGirdi = el("input", { class: "md-girdi", type: "text", inputmode: "numeric", placeholder: "0:00", value: "0:00", "aria-label": "Başlangıç (dk:sn)" });
  const sonGirdi = el("input", { class: "md-girdi", type: "text", inputmode: "numeric", placeholder: "sona kadar", "aria-label": "Bitiş (dk:sn)" });
  const basKaydir = el("input", { type: "range", min: "0", max: "100", step: "1", value: "0", class: "ts-kaydir", "aria-label": "Başlangıç kaydırıcı" }), sonKaydir = el("input", { type: "range", min: "0", max: "100", step: "1", value: "100", class: "ts-kaydir", "aria-label": "Bitiş kaydırıcı" });
  const aralikOzet = el("p", { class: "ts-aralikozet" });
  const aralikKutu = el("div", { class: "ts-aralikkutu", hidden: true });
  const aralikDegeri = () => {
    if (!ozelAralik.checked) return { bas: 0, son: Infinity };
    let b = sureCoz(basGirdi.value) ?? 0, s = sonGirdi.value.trim() ? sureCoz(sonGirdi.value) : Infinity; if (s == null) s = Infinity;
    if (kayitSure) { b = Math.min(Math.max(0, b), kayitSure); s = Math.min(s, kayitSure); }
    return { bas: b, son: s };
  };
  function aralikOzetle() {
    const { bas, son } = aralikDegeri(), bitis = Number.isFinite(son) ? son : kayitSure;
    aralikKutu.hidden = !ozelAralik.checked;
    aralikOzet.textContent = !ozelAralik.checked ? (kayitSure ? `Tüm kayıt yazıya dökülecek (${sureYaz(kayitSure)}).` : "Tüm kayıt yazıya dökülecek.") : bitis && bitis > bas ? `Yalnızca ${sureGoster(bas)} → ${sureGoster(bitis)} arası dökülecek (${sureYaz(bitis - bas)}).` : "Bitiş, başlangıçtan sonra olmalı.";
    aralikOzet.classList.toggle("md-hata", ozelAralik.checked && !(bitis > bas));
    if (kayitSure) { basKaydir.value = String(Math.round(bas)); sonKaydir.value = String(Math.round(Math.min(bitis || kayitSure, kayitSure))); }
  }
  for (const r of [tumKayit, ozelAralik]) r.addEventListener("change", aralikOzetle);
  for (const g of [basGirdi, sonGirdi]) g.addEventListener("input", aralikOzetle);
  basKaydir.addEventListener("input", () => { let v = Number(basKaydir.value); if (v >= Number(sonKaydir.value)) { v = Math.max(0, Number(sonKaydir.value) - 1); basKaydir.value = String(v); } basGirdi.value = sureGoster(v); aralikOzetle(); });
  sonKaydir.addEventListener("input", () => { let v = Number(sonKaydir.value); if (v <= Number(basKaydir.value)) { v = Number(basKaydir.value) + 1; sonKaydir.value = String(v); } sonGirdi.value = v >= kayitSure ? "" : sureGoster(v); aralikOzetle(); });
  const basiAl = dugme("⏱ Başlangıç = şu an", () => { basGirdi.value = sureGoster(oynatici.currentTime); ozelAralik.checked = true; aralikOzetle(); }, "Oynatıcıda durduğun yeri başlangıç yapar");
  const sonuAl = dugme("⏱ Bitiş = şu an", () => { sonGirdi.value = sureGoster(oynatici.currentTime); ozelAralik.checked = true; aralikOzetle(); }, "Oynatıcıda durduğun yeri bitiş yapar");
  aralikKutu.append(
    el("div", { class: "ts-izgara" }, el("label", { class: "ts-alan" }, el("span", { class: "ts-alan-ad", text: "Başlangıç" }), basGirdi, el("small", { class: "md-soluk", text: "dk:sn ya da sa:dk:sn" })), el("label", { class: "ts-alan" }, el("span", { class: "ts-alan-ad", text: "Bitiş" }), sonGirdi, el("small", { class: "md-soluk", text: "boş = kaydın sonuna kadar" }))),
    el("div", { class: "ts-kaydirlar" }, basKaydir, sonKaydir), el("div", { class: "md-eylem" }, basiAl, sonuAl),
    el("p", { class: "md-soluk", text: "İpucu: oynatıcıdan kaydı dinle, istediğin yerde durdurup “şu an” düğmelerine bas." }));

  /* ---------------- ② Ayarlar ---------------- */
  const mod = el("select", { class: "md-girdi", "aria-label": "Çıktı dili" }, el("option", { value: "orijinal", text: "Konuşulan dilde yaz" }), el("option", { value: "tr", text: "Türkçe'ye çevirerek yaz" }), el("option", { value: "en", text: "İngilizce'ye çevirerek yaz" }));
  const dil = el("select", { class: "md-girdi", "aria-label": "Kayıttaki konuşma dili" }, ...DILLER.map(([v, a]) => el("option", { value: v, text: a })));
  const kisiOto = el("input", { type: "checkbox", checked: tercih.oku("kisiOto", "1") === "1" });
  const kisiSayisi = el("select", { class: "md-girdi", "aria-label": "Konuşmacı sayısı" }, el("option", { value: "0", text: "Sayıyı kendin bul" }), ...[1, 2, 3, 4, 5, 6, 8].map((n) => el("option", { value: String(n), text: `${n} kişi` })));
  const alan = (ad, g, ip) => el("label", { class: "ts-alan" }, el("span", { class: "ts-alan-ad", text: ad }), g, ip ? el("small", { class: "md-soluk", text: ip }) : null);
  /* Konuşmacı ayrımı kaynağı: sistem (Gemini, Worker) ya da KENDİ anahtarın (HavaStil şifreli kasası — oradaki anahtarlar burada da geçerlidir) */
  const kisiKaynak = el("select", { class: "md-girdi", "aria-label": "Konuşmacı ayrımı için yapay zekâ" }, el("option", { value: "sistem", text: "Site yapay zekâsı (Gemini) — kotaya sayılır" }));
  const kisiKaynakIpucu = el("small", { class: "md-soluk" });
  let kayitliAi = {};
  const aiSaglayici = el("select", { class: "md-girdi", "aria-label": "Sağlayıcı" }, ...SAGLAYICI_SIRASI.map((k) => el("option", { value: k, text: SAGLAYICILAR[k].ad })));
  const aiAnahtar = el("input", { class: "md-girdi", type: "password", autocomplete: "off", spellcheck: "false", "aria-label": "API anahtarı" });
  const aiModel = el("input", { class: "md-girdi", type: "text", autocomplete: "off", spellcheck: "false", "aria-label": "Model adı" });
  const aiMesaj = el("p", { class: "md-soluk", role: "status" });
  const aiIpucuGuncelle = () => { const S = SAGLAYICILAR[aiSaglayici.value]; aiAnahtar.placeholder = S.anahtarIpucu; aiModel.placeholder = S.varsayilan; };
  aiSaglayici.addEventListener("change", aiIpucuGuncelle); aiIpucuGuncelle();
  const kisiKaynakIpucuYaz = () => {
    const v = kisiKaynak.value;
    kisiKaynakIpucu.textContent = v === "sistem" ? "Ses, sitenin Gemini anahtarıyla işlenir (günlük kotaya sayılır)." : v === "gemini" ? "Kendi Gemini anahtarın: ses doğrudan Google'a gider, kaydı DİNLEYEREK ayırır (en doğru). Site kotasından düşmez." : `Kendi ${SAGLAYICILAR[v]?.kisa || v} anahtarın: ses gönderilmez; yalnızca döküm METNİNDEN çıkarım yapılır (Gemini'ye göre daha az kesin).`;
  };
  async function aiKaynaklariYukle() {
    const { kayitli } = await kendiAnahtarlar(); kayitliAi = kayitli;
    const secili = kisiKaynak.value || tercih.oku("kisiKaynak", "sistem");
    kisiKaynak.replaceChildren(el("option", { value: "sistem", text: "Site yapay zekâsı (Gemini) — kotaya sayılır" }), ...SAGLAYICI_SIRASI.filter((k) => kayitli[k]).map((k) => el("option", { value: k, text: `Kendi anahtarım — ${SAGLAYICILAR[k].kisa}${k === "gemini" ? " (sesi dinler)" : " (yalnızca metin)"}` })));
    kisiKaynak.value = [...kisiKaynak.options].some((o) => o.value === secili) ? secili : "sistem"; kisiKaynakIpucuYaz();
  }
  kisiKaynak.addEventListener("change", () => { tercih.yaz("kisiKaynak", kisiKaynak.value); kisiKaynakIpucuYaz(); });
  const aiKaydet = el("button", { type: "button", class: "md-btn", text: "🔐 Şifreli kasaya kaydet" });
  aiKaydet.addEventListener("click", async () => {
    if (!aiAnahtar.value.trim()) { aiMesaj.textContent = "Önce API anahtarını yapıştır."; return; }
    aiKaydet.disabled = true; aiMesaj.textContent = "Kaydediliyor…";
    try { await anahtarEkle(aiSaglayici.value, aiAnahtar.value, aiModel.value); aiAnahtar.value = ""; await aiKaynaklariYukle(); kisiKaynak.value = aiSaglayici.value; tercih.yaz("kisiKaynak", kisiKaynak.value); kisiKaynakIpucuYaz(); aiMesaj.textContent = "✔ Kaydedildi; konuşmacı ayrımı artık bu anahtarla yapılacak. Aynı anahtar HavaStil'de de geçerlidir."; }
    catch (h) { aiMesaj.textContent = h.message || String(h); }
    finally { aiKaydet.disabled = false; }
  });
  const aiKutu = el("details", { class: "ts-gelismis" }, el("summary", { text: "🔑 Kendi API anahtarımı kullan (Gemini · ChatGPT · Claude · OpenRouter)" }),
    el("p", { class: "md-soluk", text: "HavaStil'deki şifreli anahtar kasasıyla ORTAK: orada girdiğin anahtar burada da hazırdır. Anahtarın tarayıcında şifrelenir; bu sitenin sunucusuna düz metin olarak gitmez, istekler doğrudan sağlayıcıya yapılır. Kendi anahtarınla yapılan işler site kotasından düşmez." }),
    el("div", { class: "ts-izgara" }, alan("Sağlayıcı", aiSaglayici), alan("Model (boşsa varsayılan)", aiModel)), alan("API anahtarı", aiAnahtar), el("div", { class: "md-eylem" }, aiKaydet), aiMesaj);
  const baslangic = el("input", { class: "md-girdi", type: "text", inputmode: "numeric", placeholder: "boş bırak (isteğe bağlı) — örn. 14:30", maxlength: "8", autocomplete: "off", "aria-label": "Kaydın gerçek başlangıç saati (isteğe bağlı)" });
  mod.value = tercih.oku("mod", "orijinal"); dil.value = tercih.oku("dil", ""); kisiSayisi.value = tercih.oku("kisiSayisi", "0");
  for (const [a, g] of [["mod", mod], ["dil", dil], ["kisiSayisi", kisiSayisi]]) g.addEventListener("change", () => tercih.yaz(a, g.value));
  const aiDurumGuncelle = () => { kisiSayisi.disabled = !kisiOto.checked; kisiKaynak.disabled = !kisiOto.checked; };
  kisiOto.addEventListener("change", () => { tercih.yaz("kisiOto", kisiOto.checked ? "1" : "0"); aiDurumGuncelle(); }); aiDurumGuncelle();
  const basla = el("button", { type: "button", class: "md-btn md-birincil ts-basla", text: "▶ Yazıya dökmeye başla" }), durdur = el("button", { type: "button", class: "md-btn", text: "⏸ Durdur", title: "Durdurursan o ana kadar bitmiş kısım korunur; aynı dosyayla “Devam ettir”e basınca baştan başlamaz.", hidden: true });
  basla.disabled = true;
  const devamBilgi = el("div", { class: "ts-devam-bilgi", hidden: true }), devamYazi = el("span"), bastanBtn = el("button", { type: "button", class: "md-btn ts-kucuk", text: "↺ Baştan başla" });
  devamBilgi.append(devamYazi, bastanBtn);
  const yardimYazi = el("p", { class: "md-soluk ts-yardim", text: "ℹ️ Durdurursan ya da bir hata olursa o ana kadar bitmiş kısım korunur ve bu cihazda saklanır; aynı dosyayı seçip “Devam ettir”e basarsan baştan başlamaz. İş sürerken panelde başka sekmeye geçebilirsin (iş arkada sürer, sağ altta göstergesi çıkar); sayfayı kapatırsan kalan kısım için dosyayı yeniden seçmen yeter. Sonuçlar sen “Belleği temizle” ya da “Sil” demedikçe silinmez." });

  /* Yapay zekâ seçimi KAYITTAN ÖNCE: hangi yapay zekâyla ayrılacağı dosya yüklenmeden belirlenir. */
  const aiBlok = el("div", { class: "ts-aiblok" },
    el("div", { class: "ts-adim" }, el("span", { class: "ts-no", text: "🤖", "aria-hidden": "true" }), el("h2", { text: "Yapay zekâ (konuşmacı ayrımı)" })),
    el("label", { class: "ts-anahtar-satir" }, kisiOto, el("span", {}, el("strong", { text: "Konuşmacıları otomatik bul" }), el("small", { class: "md-soluk", text: "Yapay zekâ kimin konuştuğunu ayırır. Kapatırsan metin tek akış olur ve ses Gemini'ye hiç gönderilmez." }))),
    alan("Hangi yapay zekâ ayırsın?", kisiKaynak), kisiKaynakIpucu, aiKutu);
  const kurulum = el("section", { class: "md-kart ts-kurulum" }, aiBlok,
    el("div", { class: "ts-adim" }, el("span", { class: "ts-no", text: "1" }), el("h2", { text: "Kaydı seç" })), birakAlani, girdi, dosyaBilgi,
    el("div", { class: "ts-ayarlar", hidden: true },
      el("div", { class: "ts-adim" }, el("span", { class: "ts-no", text: "2" }), el("h2", { text: "Ne kadarını döküm yapalım?" })),
      el("div", { class: "ts-oynat" }, oynatici),
      el("div", { class: "ts-secimler" }, el("label", { class: "ts-secim" }, tumKayit, el("span", { text: "Tüm kayıt" })), el("label", { class: "ts-secim" }, ozelAralik, el("span", { text: "Belirli bir bölüm" }))),
      el("div", { class: "ts-aralikkutu-dis" }, aralikKutu), aralikOzet,
      el("div", { class: "ts-adim" }, el("span", { class: "ts-no", text: "3" }), el("h2", { text: "Ayarlar" })),
      el("div", { class: "ts-izgara" }, alan("Konuşma dili", dil, "Bilmiyorsan “Otomatik algıla” bırak."), alan("Yazı dili", mod, "Çeviri istersen metin seçtiğin dilde yazılır.")),
      el("div", { class: "ts-izgara" }, alan("Konuşmacı sayısı", kisiSayisi, "Biliyorsan seç; daha doğru olur. (Konuşmacı ayrımı yukarıdaki “Yapay zekâ” kutusundan açılır/kapatılır.)")),
      el("details", { class: "ts-gelismis" }, el("summary", { text: "Gelişmiş: kaydın gerçek başlangıç saati" }),
        el("p", { class: "md-soluk", text: "Normalde zamanlar kaydın başından sayılır (00:00:00, 00:00:12 …). Bu kayıt belirli bir saatte başladıysa (örn. toplantı 14:30'da başladı) buraya yaz; istersen çıktıda zamanlar gün saati olarak da yazılır (14:30:12). Boş bırakırsan hiçbir şey değişmez." }), baslangic),
      devamBilgi, el("div", { class: "ts-basla-satiri" }, basla, durdur), cubuk, sureYazi, yardimYazi), mesaj);
  const sirket = kurulum.querySelector(".ts-ayarlar");

  /* ---------------- ③ Sonuç alanı ---------------- */
  const stud = el("div", { class: "ts-studyo", hidden: true });
  const baslikGirdi = el("input", { class: "md-girdi ts-baslik", type: "text", maxlength: "140", placeholder: "Başlık", "aria-label": "Transkript başlığı" });
  const baslikOneri = dugme("✨", () => { T.baslik = baslikOner(T.segmentler); baslikGirdi.value = T.baslik; baslikElleMi = false; }, "Başlığı konuşmanın içeriğinden öner", "md-btn ts-ikon");
  const meta = el("p", { class: "md-soluk ts-meta" }), anahtarlar = el("p", { class: "md-soluk ts-anahtar" }), kisiDurum = el("p", { class: "ts-durum", hidden: true });
  const geriBtn = dugme("↩ Geri al", () => { const x = geriAl.pop(); if (!x) return; const o = JSON.parse(x); T.segmentler = o.s; T.konusmacilar = o.k; T.baslik = o.b; baslikGirdi.value = o.b; secili.clear(); hepsiniCiz(); geriBtn.disabled = !geriAl.length; }); geriBtn.disabled = true;
  const anlik = () => JSON.stringify({ s: T.segmentler, k: T.konusmacilar, b: T.baslik });
  function kaydetGeri() { geriAl.push(anlik()); if (geriAl.length > 25) geriAl.shift(); geriBtn.disabled = false; }
  const baslangicSn = () => (gunSaatiSec.checked ? gunSaniyesi(baslangic.value) : null);
  const zamanYazi = (sn) => { const b = gunSaniyesi(baslangic.value); return b != null ? `${saat(sn)} (${gunSaati(b + sn)})` : saat(sn); };

  /* seçenekler (İndir sekmesi) */
  const zamanSec = el("input", { type: "checkbox", checked: tercih.oku("zaman", "1") === "1" }), kSec = el("input", { type: "checkbox", checked: true }), gunSaatiSec = el("input", { type: "checkbox" });
  zamanSec.addEventListener("change", () => tercih.yaz("zaman", zamanSec.checked ? "1" : "0"));
  const secenek = () => ({ zaman: zamanSec.checked, konusmaci: kSec.checked && atanmisVar(), baslangicSn: baslangicSn() });

  /* arama */
  const ara = el("input", { class: "md-girdi", type: "search", placeholder: "Transkriptte ara…", "aria-label": "Ara", autocomplete: "off" }), araSay = el("span", { class: "md-soluk ts-arasay" });
  const onceki = dugme("▲", () => { if (!bulunan.length) return; bulIdx = (bulIdx - 1 + bulunan.length) % bulunan.length; bulunanaGit(); }, "Önceki sonuç", "md-btn ts-ikon"), sonraki = dugme("▼", () => { if (!bulunan.length) return; bulIdx = (bulIdx + 1) % bulunan.length; bulunanaGit(); }, "Sonraki sonuç", "md-btn ts-ikon");
  const degis = el("input", { class: "md-girdi", type: "text", placeholder: "Şununla değiştir…", "aria-label": "Değiştirilecek metin", autocomplete: "off" });

  /* ---- Okuma görünümü: konuşma turları ---- */
  const okuma = el("div", { class: "ts-okuma", tabindex: "0", "aria-label": "Transkript metni" });
  function vurgula(m) {
    if (!aramaMetni) return [m];
    const alt = m.toLocaleLowerCase("tr"), out = []; let i = 0, j;
    while ((j = alt.indexOf(aramaMetni, i)) >= 0) { out.push(m.slice(i, j), el("mark", { class: "ts-isaret", text: m.slice(j, j + aramaMetni.length) })); i = j + aramaMetni.length; }
    out.push(m.slice(i)); return out.filter((x) => x !== "");
  }
  let turlar = [];
  function okumaCiz() {
    const uzun = (T.sure || topSure()) >= 3600, grup = atanmisVar();
    turlar = turlariUret(T, { konusmaci: grup });
    const son = aramaMetni ? turlar.length : Math.min(turlar.length, turSayisi), kutular = [];
    for (const t of turlar.slice(0, son)) {
      const baslik = el("div", { class: "ts-turbaslik" });
      if (t.ad) baslik.append(el("span", { class: "ts-nokta" }), el("strong", { class: "ts-turad", text: t.ad }));
      baslik.append(el("button", { type: "button", class: "ts-zaman", "data-git": String(t.b), title: "Buradan oynat", text: `▶ ${kisaSaat(t.b, uzun)} – ${kisaSaat(t.s, uzun)}` }));
      const kutu = el("section", { class: "ts-tur" }, baslik, ...t.paragraflar.map((p) => el("p", { class: "ts-par" }, ...vurgula(p.m))));
      kutu.style.setProperty("--renk", renk(t.k)); kutular.push(kutu);
    }
    if (son < turlar.length) kutular.push(dugme(`Daha fazla göster (${turlar.length - son} bölüm daha)`, () => { turSayisi += TUR_ADIM * 3; okumaCiz(); }, "", "md-btn ts-daha"));
    okuma.replaceChildren(...(kutular.length ? kutular : [el("p", { class: "md-soluk", text: "Henüz metin yok." })]));
  }
  okuma.addEventListener("click", (e) => { const g = e.target.closest("[data-git]"); if (g) zamanaGit(Number(g.dataset.git)); });
  function zamanaGit(sn) { if (!sesUrl) { bildir("Oynatmak için önce kayıt dosyasını seç (Kayıt dosyasını bağla).", true); return; } oynatici.currentTime = sn; oynatici.play().catch(() => {}); }

  /* ---- Satırlar sekmesi ---- */
  const liste = el("div", { class: "ts-liste", role: "list" }), sayfaYeri = el("div", { class: "ts-sayfa md-eylem" });
  const topluSec = el("select", { class: "md-girdi", "aria-label": "Seçili satırlara atanacak konuşmacı" });
  function satirYap(s, i) {
    const k = el("select", { class: "ts-kisi", "aria-label": "Konuşmacı" }, el("option", { value: "", text: "—" }), ...T.konusmacilar.map((x, j) => el("option", { value: String(j), text: x.ad })));
    k.value = s.k == null ? "" : String(s.k);
    const ta = el("textarea", { class: "ts-metin", rows: Math.max(1, Math.ceil(s.m.length / 60)), "aria-label": `Satır ${i + 1} metni`, spellcheck: "false" }); ta.value = s.m;
    const sat = el("div", { class: "ts-satir", role: "listitem", "data-i": String(i) },
      el("input", { type: "checkbox", class: "ts-sec", "aria-label": "Satırı seç", checked: secili.has(s.id) }),
      el("button", { type: "button", class: "ts-zaman", "data-islem": "git", title: "Buradan oynat", text: `▶ ${saat(s.b)}` }), k, ta,
      el("span", { class: "ts-islem" }, el("button", { type: "button", "data-islem": "bol", title: "İmleçten böl", "aria-label": "İmleçten böl", text: "✂" }), el("button", { type: "button", "data-islem": "birles", title: "Sonrakiyle birleştir", "aria-label": "Sonrakiyle birleştir", text: "⤵" }), el("button", { type: "button", "data-islem": "sil", title: "Sil", "aria-label": "Satırı sil", text: "🗑" })));
    sat.style.setProperty("--renk", renk(s.k));
    if (bulunan.includes(i)) sat.classList.add("ts-bulundu");
    return sat;
  }
  function listeCiz() {
    const son = Math.min(T.segmentler.length, sayfaBas + SAYFA);
    liste.replaceChildren(...T.segmentler.slice(sayfaBas, son).map((s, j) => satirYap(s, sayfaBas + j)));
    sayfaYeri.replaceChildren();
    if (T.segmentler.length > SAYFA) {
      const o = el("button", { type: "button", class: "md-btn", text: "◀ Önceki", disabled: sayfaBas === 0 }), n = el("button", { type: "button", class: "md-btn", text: "Sonraki ▶", disabled: son >= T.segmentler.length });
      o.addEventListener("click", () => { sayfaBas = Math.max(0, sayfaBas - SAYFA); listeCiz(); }); n.addEventListener("click", () => { sayfaBas += SAYFA; listeCiz(); });
      sayfaYeri.append(o, el("span", { class: "md-soluk", text: `${sayfaBas + 1}–${son} / ${T.segmentler.length}` }), n);
    }
  }
  liste.addEventListener("input", (e) => { const sat = e.target.closest(".ts-satir"); if (!sat || !e.target.classList.contains("ts-metin")) return; const s = T.segmentler[Number(sat.dataset.i)]; s.m = e.target.value; e.target.rows = Math.max(1, Math.ceil(s.m.length / 60)); ozetGuncelle(); okumaPlanla(); });
  liste.addEventListener("change", (e) => {
    const sat = e.target.closest(".ts-satir"); if (!sat) return; const i = Number(sat.dataset.i), s = T.segmentler[i];
    if (e.target.classList.contains("ts-sec")) { e.target.checked ? secili.add(s.id) : secili.delete(s.id); return; }
    if (e.target.classList.contains("ts-kisi")) { kaydetGeri(); s.k = e.target.value === "" ? null : Number(e.target.value); sat.style.setProperty("--renk", renk(s.k)); konusmacilariCiz(); okumaPlanla(); }
  });
  liste.addEventListener("click", (e) => {
    const d = e.target.closest("[data-islem]"); if (!d) return; const sat = d.closest(".ts-satir"), i = Number(sat.dataset.i), s = T.segmentler[i];
    if (d.dataset.islem === "git") zamanaGit(s.b);
    else if (d.dataset.islem === "sil") { kaydetGeri(); T.segmentler.splice(i, 1); secili.delete(s.id); hepsiniCiz(); }
    else if (d.dataset.islem === "birles") { const n = T.segmentler[i + 1]; if (!n) return; kaydetGeri(); s.m = `${s.m} ${n.m}`.trim(); s.s = n.s; T.segmentler.splice(i + 1, 1); hepsiniCiz(); }
    else if (d.dataset.islem === "bol") {
      const ta = sat.querySelector(".ts-metin"), p = ta.selectionStart; if (!p || p <= 0 || p >= ta.value.length) { bildir("Bölmek için metinde imleci bölünecek yere koy.", true); return; }
      kaydetGeri(); const a = ta.value.slice(0, p).trim(), b = ta.value.slice(p).trim(), oran = a.length / (a.length + b.length || 1), orta = s.b + (s.s - s.b) * oran;
      T.segmentler.splice(i, 1, { ...s, m: a, s: orta }, yeniSeg({ b: orta, s: s.s, m: b, k: s.k })); hepsiniCiz();
    }
  });
  const seciliIndeksler = () => T.segmentler.map((s, i) => (secili.has(s.id) ? i : -1)).filter((i) => i >= 0);
  const topluBar = el("div", { class: "ts-toplu md-eylem" }, topluSec,
    dugme("Seçililere ata", () => { const l = seciliIndeksler(); if (!l.length) return bildir("Önce satırların solundaki kutuları işaretle.", true); kaydetGeri(); const v = topluSec.value === "" ? null : Number(topluSec.value); l.forEach((i) => { T.segmentler[i].k = v; }); hepsiniCiz(); }),
    dugme("İlk seçiliden sona kadar ata", () => { const l = seciliIndeksler(); if (!l.length) return bildir("Önce başlangıç satırını işaretle.", true); kaydetGeri(); const v = topluSec.value === "" ? null : Number(topluSec.value); for (let i = l[0]; i < T.segmentler.length; i++) T.segmentler[i].k = v; hepsiniCiz(); }),
    dugme("Sayfadakileri seç / bırak", () => { const s = T.segmentler.slice(sayfaBas, sayfaBas + SAYFA), hepsi = s.every((q) => secili.has(q.id)); s.forEach((q) => (hepsi ? secili.delete(q.id) : secili.add(q.id))); listeCiz(); }));

  /* ---- Konuşmacılar sekmesi ---- */
  const kPanel = el("div", { class: "ts-konusmacilar" });
  function konusmacilariCiz() {
    topluSec.replaceChildren(el("option", { value: "", text: "— (atanmamış)" }), ...T.konusmacilar.map((x, j) => el("option", { value: String(j), text: x.ad })));
    const ist = istatistik(T.segmentler, T.konusmacilar), toplam = Math.max(topSure(), 1);
    const kartlar = ist.filter((x) => x.k != null || x.bolum).map((x) => {
      const kisi = x.k == null ? null : T.konusmacilar[x.k];
      const ad = kisi ? el("input", { class: "md-girdi ts-kad", type: "text", value: kisi.ad, maxlength: "40", "aria-label": "Konuşmacı adı" }) : el("strong", { text: "Atanmamış satırlar" });
      if (kisi) ad.addEventListener("change", () => { kisi.ad = ad.value.trim() || `Konuşmacı ${x.k + 1}`; kisi.adElle = true; listeCiz(); konusmacilariCiz(); okumaPlanla(); });
      const sil = kisi ? dugme("Kaldır", () => { kaydetGeri(); T.segmentler.forEach((s) => { if (s.k === x.k) s.k = null; else if (s.k > x.k) s.k -= 1; }); T.konusmacilar.splice(x.k, 1); hepsiniCiz(); }, "Konuşmacıyı kaldır (satırları atanmamış olur)") : null;
      const cizgi = el("div", { class: "ts-zamanserit", "aria-hidden": "true" });
      for (const s of T.segmentler.filter((q) => (x.k == null ? q.k == null || !T.konusmacilar[q.k] : q.k === x.k))) { const b = el("span", { class: "ts-parca" }); b.style.left = `${(s.b / toplam) * 100}%`; b.style.width = `${Math.max(0.25, ((s.s - s.b) / toplam) * 100)}%`; cizgi.append(b); }
      cizgi.style.setProperty("--renk", renk(x.k));
      const aralik = x.aralik.length ? el("ul", { class: "ts-aralik" }, ...x.aralik.map((a) => el("li", {}, el("button", { type: "button", class: "ts-zaman", "data-git": String(a.b), text: `▶ ${zamanYazi(a.b)} – ${zamanYazi(a.s)}` })))) : null;
      const kart = el("div", { class: "ts-kkart" },
        el("div", { class: "ts-kust" }, el("span", { class: "ts-nokta" }), ad, sil),
        el("p", { class: "md-soluk", text: `${sureYaz(x.sn)} konuştu · %${Math.round(x.pay * 100)} · ${x.kelime.toLocaleString("tr-TR")} kelime${x.wpm ? ` · ~${x.wpm} kelime/dk` : ""}${kisi?.ozellik ? ` · ${kisi.ozellik}` : ""}` }),
        cizgi, aralik ? el("details", { class: "ts-detay" }, el("summary", { text: `Konuştuğu aralıklar (${x.aralik.length})` }), aralik) : null);
      kart.style.setProperty("--renk", renk(x.k)); return kart;
    });
    const nSec = el("select", { class: "md-girdi", "aria-label": "Konuşmacı sayısı" }, ...[2, 3, 4, 5, 6].map((n) => el("option", { value: String(n), text: `${n} kişi` })));
    const esik = el("select", { class: "md-girdi", "aria-label": "Duraklama eşiği" }, ...[["1", "≥ 1 sn duraklama"], ["1.5", "≥ 1,5 sn duraklama"], ["2.5", "≥ 2,5 sn duraklama"], ["4", "≥ 4 sn duraklama"]].map(([v, a]) => el("option", { value: v, text: a }))); esik.value = "1.5";
    const yeni = () => ({ ad: `Konuşmacı ${T.konusmacilar.length + 1}`, renk: RENKLER[T.konusmacilar.length % RENKLER.length] });
    kPanel.replaceChildren(
      el("div", { class: "ts-oto" }, el("div", {}, el("strong", { text: "🤖 Yapay zekâ ile otomatik ayır" }), el("p", { class: "md-soluk", text: "Kaydı yeniden dinletip her satırı konuşana atar. Kayıt dosyası bu oturumda seçili olmalı." })),
        dugme("Konuşmacıları bul", () => konusmacilariAlgila(), "", "md-btn md-birincil")),
      el("div", { class: "ts-kizgara" }, ...(kartlar.length ? kartlar : [el("p", { class: "md-soluk", text: "Henüz konuşmacı yok. Otomatik bul ya da elle ekle." })])),
      el("div", { class: "md-eylem" }, dugme("➕ Konuşmacı ekle", () => { kaydetGeri(); T.konusmacilar.push(yeni()); hepsiniCiz(); })),
      el("details", { class: "ts-gelismis" }, el("summary", { text: "Yapay zekâsız seçenek: duraklamaya göre tahmini ayır" }),
        el("div", { class: "md-eylem ts-tahmin" }, nSec, esik, dugme("🪄 Tahmini ayır", () => { kaydetGeri(); const n = Number(nSec.value); while (T.konusmacilar.length < n) T.konusmacilar.push(yeni()); tahminiAyir(T.segmentler, n, Number(esik.value)); hepsiniCiz(); bildir("Tahmini ayrım uygulandı (yalnızca duraklamalara bakar). Yanlış satırları Satırlar sekmesinden düzelt."); })),
        el("p", { class: "md-soluk", text: "Bu yöntem sesi dinlemez; sessizlikte sıradaki kişiye geçer. Kesin sonuç için yukarıdaki yapay zekâ ayrımını ya da elle atamayı kullan." })),
      el("div", { class: "ts-toplu-kutu" }, el("strong", { text: "Toplu atama" }), el("p", { class: "md-soluk", text: "Satırlar sekmesinde satırları işaretle, kişiyi seç, ata." }), topluBar));
  }
  kPanel.addEventListener("click", (e) => { const g = e.target.closest("[data-git]"); if (g) zamanaGit(Number(g.dataset.git)); });

  /* ---- İndir sekmesi ---- */
  const adTaban = () => dosyaAdiTemizle(T.baslik || "transkript", "transkript");
  const TURLER = { txt: ["text/plain;charset=utf-8", "txt"], md: ["text/markdown;charset=utf-8", "md"], html: ["text/html;charset=utf-8", "html"], srt: ["application/x-subrip;charset=utf-8", "srt"], vtt: ["text/vtt;charset=utf-8", "vtt"], csv: ["text/csv;charset=utf-8", "csv"], json: ["application/json;charset=utf-8", "json"] };
  const tamT = () => ({ ...T, sure: T.sure || topSure(), baslik: T.baslik || "Transkript" });
  async function disaAktar(tur) {
    if (!T.segmentler.length) return;
    try {
      if (TURLER[tur]) { indir(new Blob([metinUret(tamT(), tur, secenek())], { type: TURLER[tur][0] }), `${adTaban()}.${TURLER[tur][1]}`); return bildir(`✔ ${tur.toUpperCase()} indirildi.`); }
      bildir(`${tur.toUpperCase()} hazırlanıyor…`);
      const bl = belgeBloklari(tamT(), secenek(), kunyeMetni(tamT()));
      if (tur === "docx") { const { irDenDocx } = await import("../donusturucu/belge-docx.js"); indir(await irDenDocx(bl, { baslik: tamT().baslik, altBilgi: tamT().baslik }), `${adTaban()}.docx`); }
      else { const { irDenPdf } = await import("../donusturucu/belge-pdf.js"); indir(await irDenPdf(bl, { baslik: tamT().baslik, altBilgi: tamT().baslik }), `${adTaban()}.pdf`); }
      bildir(`✔ ${tur.toUpperCase()} indirildi.`);
    } catch (h) { bildir(`Dışa aktarılamadı: ${h.message || h}`, true); }
  }
  const kopyala = async () => { try { await navigator.clipboard.writeText(metinUret(tamT(), "txt", secenek())); bildir("✔ Panoya kopyalandı."); } catch { bildir("Pano erişimi reddedildi.", true); } };
  const bicim = (ikon, ad, ac, t) => { const b = el("button", { type: "button", class: "ts-bicim" }, el("span", { class: "ts-bicim-ikon", text: ikon, "aria-hidden": "true" }), el("strong", { text: ad }), el("small", { class: "md-soluk", text: ac })); b.addEventListener("click", () => disaAktar(t)); return b; };
  const indirPanel = el("div", { class: "ts-indir" },
    el("div", { class: "ts-secenekler" },
      el("label", { class: "mk-onay" }, zamanSec, " Zaman bilgisi ekle"), el("label", { class: "mk-onay" }, kSec, " Konuşmacı adlarını ekle"),
      el("label", { class: "mk-onay" }, gunSaatiSec, " Zamanları gün saati olarak yaz (Gelişmiş › başlangıç saati gerekir)")),
    el("h3", { text: "Okunacak belgeler" }),
    el("div", { class: "ts-bicimler" }, bicim("📕", "PDF", "Yazdırmaya ve paylaşmaya uygun", "pdf"), bicim("📘", "Word", "Düzenlenebilir belge (.docx)", "docx"), bicim("📄", "Metin", "Düz yazı (.txt)", "txt"), bicim("🌐", "Web sayfası", "Tarayıcıda açılan (.html)", "html"), bicim("🧾", "Markdown", "Notlar ve bloglar için", "md")),
    el("h3", { text: "Altyazı ve veri" }),
    el("div", { class: "ts-bicimler" }, bicim("🎞", "SRT", "Video altyazısı", "srt"), bicim("🎞", "VTT", "Web video altyazısı", "vtt"), bicim("📊", "CSV", "Tablo (Excel)", "csv"), bicim("🧩", "JSON", "Program kullanımı için", "json")),
    el("div", { class: "md-eylem" },
      dugme("📝 Yeni İçerik taslağına aktar", () => { sessionStorage.setItem("gy_onbilgi", JSON.stringify({ baslik: T.baslik || "Transkript", govde: metinUret({ ...tamT(), baslik: "" }, "md", { zaman: false, konusmaci: atanmisVar() }).replace(/^#\s*\n+/, "") })); location.hash = "#content-new"; }),
      dugme("💾 Bu cihazda sakla", kaydetYerel, "Yalnızca bu tarayıcının IndexedDB'sine; sunucuya gitmez")));

  /* ---- Araçlar: ara / değiştir / dolgu ---- */
  function aramaYap(git = true) {
    aramaMetni = ara.value.trim().toLocaleLowerCase("tr"); bulunan = aramaMetni ? T.segmentler.map((s, i) => (s.m.toLocaleLowerCase("tr").includes(aramaMetni) ? i : -1)).filter((i) => i >= 0) : [];
    araSay.textContent = aramaMetni ? `${bulunan.length} sonuç` : ""; bulIdx = bulunan.length ? 0 : -1;
    if (sekme === "okuma") { okumaCiz(); if (git && aramaMetni) bulunanaGit(); } else { if (git && bulIdx >= 0) bulunanaGit(); else listeCiz(); }
  }
  function bulunanaGit() {
    araSay.textContent = `${bulIdx + 1} / ${bulunan.length}`;
    if (sekme === "okuma") { const m = okuma.querySelectorAll(".ts-isaret"); okuma.querySelectorAll(".ts-aktifisaret").forEach((x) => x.classList.remove("ts-aktifisaret")); const h = m[Math.min(bulIdx, m.length - 1)]; h?.classList.add("ts-aktifisaret"); h?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const i = bulunan[bulIdx]; sayfaBas = Math.floor(i / SAYFA) * SAYFA; listeCiz(); liste.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  ara.addEventListener("input", () => aramaYap());
  ara.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); (e.shiftKey ? onceki : sonraki).click(); } });
  const araclar = el("details", { class: "ts-araclar" }, el("summary", { text: "Düzenleme araçları: değiştir · dolgu temizle · geri al" }),
    el("div", { class: "ts-arac" }, degis, dugme("Tümünü değiştir", () => {
      const a = ara.value.trim(); if (!a) return bildir("Önce yukarıdaki arama kutusuna aranacak metni yaz.", true);
      const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"); kaydetGeri(); let n = 0;
      for (const s of T.segmentler) s.m = s.m.replace(re, () => { n += 1; return degis.value; });
      hepsiniCiz(); bildir(`${n} yer değiştirildi.`);
    })),
    el("div", { class: "ts-arac" }, dugme("🧹 Dolgu seslerini temizle (eee, ııı…)", () => { kaydetGeri(); let n = 0; for (const s of T.segmentler) { const y = dolguTemizle(s.m); if (y !== s.m) { n += 1; s.m = y; } } T.segmentler = T.segmentler.filter((s) => s.m.length > 0); hepsiniCiz(); bildir(`${n} satırda dolgu sesleri temizlendi.`); }), geriBtn));

  /* ---- Sekmeler ---- */
  const SEKMELER = [["okuma", "📖 Okuma", "Metni rahatça oku"], ["satirlar", "✏ Satırlar", "Düzelt, böl, birleştir"], ["kisiler", "👥 Konuşmacılar", "Kim ne kadar konuştu"], ["indir", "⬇ İndir", "PDF, Word, altyazı…"]];
  const sekmeSerit = el("div", { class: "ts-sekmeler", role: "tablist" }), sekmeGovde = {};
  const bolme = { okuma: el("div", { class: "ts-bolme", role: "tabpanel" }, okuma), satirlar: el("div", { class: "ts-bolme", role: "tabpanel", hidden: true }, liste, sayfaYeri), kisiler: el("div", { class: "ts-bolme", role: "tabpanel", hidden: true }, kPanel), indir: el("div", { class: "ts-bolme", role: "tabpanel", hidden: true }, indirPanel) };
  for (const [id, ad, ip] of SEKMELER) { const b = el("button", { type: "button", class: "ts-sekme", role: "tab", "data-sekme": id, title: ip, text: ad }); sekmeGovde[id] = b; b.addEventListener("click", () => sekmeAc(id)); sekmeSerit.append(b); }
  function sekmeAc(id) {
    sekme = id; for (const [k, b] of Object.entries(sekmeGovde)) { b.setAttribute("aria-selected", String(k === id)); b.classList.toggle("ts-sekme-aktif", k === id); bolme[k].hidden = k !== id; }
    if (id === "okuma") okumaCiz(); else if (id === "satirlar") listeCiz(); else if (id === "kisiler") konusmacilariCiz();
  }
  let okumaZaman = 0; const okumaPlanla = () => { clearTimeout(okumaZaman); okumaZaman = setTimeout(() => { if (sekme === "okuma") okumaCiz(); }, 250); };

  function ozetGuncelle() {
    const metin = T.segmentler.map((s) => s.m).join(" "), kel = kelimeSay(metin), sn = topSure();
    meta.textContent = `${sureYaz(T.sure || sn)} · ${kel.toLocaleString("tr-TR")} kelime · ${T.segmentler.length} satır${T.dil ? ` · dil: ${(DILLER.find(([v]) => v === T.dil) || [, T.dil])[1]}` : ""} · okuma ≈ ${Math.max(1, Math.round(kel / 220))} dk`;
    const k = anahtarKelimeler(metin); anahtarlar.textContent = k.length ? `Öne çıkan sözcükler: ${k.map((x) => `${x.kelime} (${x.adet})`).join(" · ")}` : "";
  }
  function hepsiniCiz() { if (sayfaBas >= T.segmentler.length) sayfaBas = Math.max(0, Math.floor((T.segmentler.length - 1) / SAYFA) * SAYFA); aramaYap(false); if (sekme === "satirlar") listeCiz(); konusmacilariCiz(); okumaCiz(); ozetGuncelle(); }

  /* ---- Oynatıcı ---- */
  let aktifI = -1;
  oynatici.addEventListener("timeupdate", () => {
    if (stud.hidden || sekme !== "satirlar") return;
    const t = oynatici.currentTime, i = T.segmentler.findIndex((s) => t >= s.b && t < s.s); if (i === aktifI) return; aktifI = i;
    liste.querySelectorAll(".ts-aktif").forEach((x) => x.classList.remove("ts-aktif"));
    if (i < 0) return; if (i < sayfaBas || i >= sayfaBas + SAYFA) { sayfaBas = Math.floor(i / SAYFA) * SAYFA; listeCiz(); }
    liste.querySelector(`[data-i="${i}"]`)?.classList.add("ts-aktif");
  });
  function sesBagla(f) { if (sesUrl) URL.revokeObjectURL(sesUrl); sesUrl = URL.createObjectURL(f); oynatici.src = sesUrl; }
  const bagGirdi = el("input", { type: "file", accept: "audio/*,video/*", hidden: true });
  const sesBaglaBtn = dugme("🔗 Kayıt dosyasını bağla", () => bagGirdi.click(), "Metne tıklayınca kaydın o yerden çalması için dosyayı seç");
  bagGirdi.addEventListener("change", () => { const f = bagGirdi.files?.[0]; if (f) { dosya = f; sesBagla(f); sesBaglaBtn.textContent = "🔗 Kayıt bağlandı"; } bagGirdi.value = ""; });
  baslikGirdi.addEventListener("input", () => { T.baslik = baslikGirdi.value; baslikElleMi = true; });

  /* ---- Yerel geçmiş ---- */
  const gecmisKart = el("section", { class: "md-kart" }), gecmisListe = el("div", { class: "ts-gecmis" });
  gecmisKart.append(el("h2", { text: "🗂 Bu cihazdaki kayıtlı transkriptler" }), el("p", { class: "md-soluk", text: "Yalnızca bu tarayıcıda saklanır (sunucuya gitmez). Ses dosyası saklanmaz — oynatmak için yeniden bağla." }), gecmisListe);
  async function gecmisCiz() {
    let l = []; try { l = (await gecmis.liste()) || []; } catch { gecmisListe.replaceChildren(el("p", { class: "md-soluk", text: "Yerel depolama bu tarayıcıda kullanılamıyor." })); return; }
    l.sort((a, b) => b.tarih - a.tarih);
    gecmisListe.replaceChildren(...(l.length ? l.map((k) => el("div", { class: "ts-gkayit" }, el("div", {}, el("strong", { text: k.baslik || k.dosyaAdi || "Başlıksız transkript" }), k.yarim ? el("span", { class: "ts-yarim", text: "  · YARIM KALDI" }) : null, el("small", { class: "md-soluk", text: `${new Date(k.tarih).toLocaleString("tr-TR")} · ${k.yarim ? `${sureGoster(k.devam?.sonraki || 0)} konumuna kadar` : sureYaz(k.sure)} · ${k.T.segmentler.length} satır${k.yarim && k.dosyaAdi ? ` · dosya: ${k.dosyaAdi}` : ""}` })),
      el("div", { class: "md-eylem" }, dugme("Aç", () => ac(k)), k.yarim ? dugme("Devam et (dosyayı seç)", () => girdi.click(), `“${k.dosyaAdi || "aynı dosya"}” dosyasını seç; kaldığı yerden devam eder`) : null, dugme("Sil", async () => { await gecmis.sil(k.id); gecmisCiz(); yarimDevamKontrol(); })))) : [el("p", { class: "md-soluk", text: "Henüz kayıt yok." })]));
  }
  async function kaydetYerel() { try { kayitId ||= `t${Date.now()}`; await gecmis.kaydet({ id: kayitId, baslik: T.baslik, tarih: Date.now(), sure: topSure(), T }); bildir("✔ Bu cihaza kaydedildi."); gecmisCiz(); } catch { bildir("Yerel depolamaya yazılamadı (özel pencere ya da kota).", true); } }
  function ac(k) { T = k.T; kayitId = k.id; nid = Math.max(0, ...T.segmentler.map((s) => s.id || 0)) + 1; T.segmentler.forEach((s) => { s.id ||= nid++; }); studyoGoster(); bildir("Kayıt açıldı."); }
  function studyoGoster(sekmeId = null) {
    stud.hidden = false; baslikGirdi.value = T.baslik; secili.clear(); sayfaBas = 0; turSayisi = TUR_ADIM; kSec.checked = true;
    ara.value = ""; aramaMetni = ""; bulunan = []; araSay.textContent = ""; ozetGuncelle(); konusmacilariCiz();
    sekmeAc(sekmeId || sekme); if (sekmeId === null && !geriAl.length) { geriBtn.disabled = true; }
  }

  /* ---------------- Yarım kalan işi saklama / geri yükleme ---------------- */
  const yarimId = (ad, boyut) => `yarim:${ad}|${boyut}`;
  let durduruldu = false;   // kullanıcı durdurdu / hata aldı: açık bir “Devam ettir” göster (henüz biten parça olmasa da)
  const baslaEtiketi = () => { basla.textContent = devam?.segs?.length ? `▶ Devam ettir (${sureGoster(devam.sonraki)}'den)` : durduruldu ? "▶ Devam ettir (durdurulan parçayı yeniden başlatır)" : "▶ Yazıya dökmeye başla"; };
  function yarimDevamKontrol() {
    const var_ = (!!(devam?.segs?.length) || durduruldu) && !!dosya;
    devamBilgi.hidden = !var_;
    if (var_) devamYazi.textContent = devam?.segs?.length ? `⏸ Durduruldu. ${sureGoster(devam.sonraki)} konumuna kadar ${devam.segs.length} satır hazır. “Devam ettir” baştan başlamaz.` : "⏸ Durduruldu. Henüz tamamlanmış bir parça yok (parçalar 20 dk'lık bloklardır); “Devam ettir” kesilen parçayı yeniden başlatır.";
    baslaEtiketi();
  }
  async function yarimKaydet() {
    if (!dosya || !devam?.segs?.length) return;
    try { await gecmis.kaydet({ id: yarimId(dosya.name, dosya.size), yarim: true, dosyaAdi: dosya.name, dosyaBoyut: dosya.size, baslik: T.baslik, tarih: Date.now(), sure: topSure(), b0: aralikDegeri().bas, s0: Number.isFinite(aralikDegeri().son) ? aralikDegeri().son : null, ozel: ozelAralik.checked, mod: mod.value, dil: dil.value, devam: { anahtar: devam.anahtar, sonraki: devam.sonraki, dil: devam.dil }, T }); gecmisCiz(); } catch { /* yerel depolama kapalı: iş yine de bellekte sürer */ }
  }
  async function yarimSil(f) { try { await gecmis.sil(yarimId(f.name, f.size)); } catch { /* yok */ } }
  /** Seçilen dosya için saklanmış yarım iş var mı? Varsa ayarlar + metin geri yüklenir ve kaldığı yerden devam hazırlanır. */
  async function yarimBul(f) {
    let k = null; try { k = (await gecmis.liste() || []).find((x) => x.id === yarimId(f.name, f.size)); } catch { return false; }
    if (!k?.yarim || !k.T?.segmentler?.length) return false;
    ozelAralik.checked = !!k.ozel; tumKayit.checked = !k.ozel; basGirdi.value = sureGoster(k.b0 || 0); sonGirdi.value = k.s0 ? sureGoster(k.s0) : ""; mod.value = k.mod || mod.value; dil.value = k.dil ?? dil.value; aralikOzetle();
    T = k.T; nid = Math.max(0, ...T.segmentler.map((x) => x.id || 0)) + 1; devam = { anahtar: k.devam.anahtar, sonraki: k.devam.sonraki, segs: T.segmentler, dil: k.devam.dil };
    studyoGoster("okuma"); yarimDevamKontrol(); bildir(`Önceki işten ${sureGoster(devam.sonraki)} konumuna kadar ${devam.segs.length} satır geri yüklendi. “Devam ettir”e basabilirsin.`);
    return true;
  }
  bastanBtn.addEventListener("click", async () => { if (dosya) await yarimSil(dosya); devam = null; durduruldu = false; T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] }; stud.hidden = true; nid = 1; yarimDevamKontrol(); gecmisCiz(); bildir("Baştan başlanacak."); });

  /* ---------------- Dosya seçimi (anında; çözme yok) ---------------- */
  async function yukle(f) {
    try {
      if (f.size > SINIR) throw new Error(`Dosya çok büyük (${bayt(f.size)}); üst sınır ${bayt(SINIR)}.`);
      dosya = f; devam = null; durduruldu = false; ayirKapali = null; kayitSure = 0; sesBagla(f); devamBilgi.hidden = true; baslaEtiketi();
      dosyaBilgi.hidden = false; dosyaBilgi.replaceChildren(el("strong", { text: f.name }), el("span", { class: "md-soluk", text: ` · ${bayt(f.size)} · süre okunuyor…` }));
      sirket.hidden = false; basla.disabled = false; bildir("");
      kayitSure = await sureOku(f);
      dosyaBilgi.replaceChildren(el("strong", { text: f.name }), el("span", { class: "md-soluk", text: ` · ${bayt(f.size)}${kayitSure ? ` · ${sureYaz(kayitSure)}` : ""}` }), dugme("Değiştir", () => girdi.click(), "Başka dosya seç", "md-btn ts-kucuk"));
      for (const k of [basKaydir, sonKaydir]) { k.max = String(Math.floor(kayitSure || 100)); k.disabled = !kayitSure; }
      sonKaydir.value = String(Math.floor(kayitSure || 100)); basKaydir.value = "0"; basGirdi.value = "0:00"; sonGirdi.value = ""; tumKayit.checked = true;
      aralikOzetle(); bildir("Hazır. İstersen aralığı ve ayarları değiştir, sonra “Yazıya dökmeye başla”ya bas.");
      if (!(await yarimBul(f))) yarimDevamKontrol();
    } catch (h) { bildir(h.message, true); }
  }
  girdi.addEventListener("change", () => { if (girdi.files?.[0]) yukle(girdi.files[0]); girdi.value = ""; });
  durdur.addEventListener("click", () => iptal?.abort());

  /* ---------------- Worker istekleri ---------------- */
  const bekle = (ms) => new Promise((q) => setTimeout(q, ms));
  async function parcaGonder(blob, ofset, sure, sunucu, oturum) {
    const fd = new FormData(); fd.append("dosya", new File([blob], "parca.mp3", { type: "audio/mpeg" })); fd.append("mod", mod.value); if (dil.value) fd.append("dil", dil.value); fd.append("ofset", String(Math.round(ofset * 100) / 100)); fd.append("sure", String(Math.ceil(sure)));
    for (let deneme = 0; ; deneme++) {
      let r, j;
      try { r = await fetch(`${WORKER}/transkript`, { method: "POST", headers: { Authorization: `Bearer ${oturum.access_token}`, ...sunucu.basliklar }, body: fd, signal: iptal.signal }); j = await r.json().catch(() => ({})); }
      catch (h) { if (h.name === "AbortError") throw h; if (deneme < 1) { await bekle(1500); continue; } throw new Error("Transkript hizmetine ulaşılamadı (ağ ya da Worker kapalı olabilir)."); }
      if (r.ok) return j;
      if (r.status >= 500 && deneme < 1) { await bekle(2000); continue; }
      throw new Error(j.kapali ? "Transkript servisi Site Sahibi tarafından geçici olarak kapatılmış." : (j.hata || j.error || `Transkript hatası (${r.status})`));
    }
  }
  const dkSn = (sn) => `${p2(Math.floor(sn / 60))}:${p2(Math.floor(sn % 60))}`;
  /** Bir ses parçası + o parçanın döküm satırları → { atamalar:{id:etiket}, konusmacilar:[…] } ; hata → fırlatır (h.kalici: tekrar denemeye değmez). */
  async function ayirIstegi(blob, segs, ofset, oturum, sinyal) {
    const satirMetni = segs.map((s) => `${s.id}|${dkSn(s.b - ofset)}|${s.m.replace(/\s+/g, " ").replace(/\|/g, "/")}`).join("\n");
    const bilinen = T.konusmacilar.filter((k) => k.etiket).map((k) => ({ etiket: k.etiket, ad: k.adElle || k.adOto ? k.ad : "", ozellik: k.ozellik || "" }));
    if (kisiKaynak.value !== "sistem") {                      // KENDİ anahtarın: tarayıcıdan doğrudan sağlayıcıya (Worker/kota yok)
      try { return await konusmaciAyirKendi({ saglayici: kisiKaynak.value, model: kayitliAi[kisiKaynak.value]?.model, blob, satirlar: satirMetni, onceki: bilinen, sayi: Number(kisiSayisi.value) || 0, sinyal }); }
      catch (h) { if (h.name === "AbortError") throw h; h.kalici = h.durum === 401 || h.durum === 403 || /bulunamadı ya da şifreli kasa/.test(h.message || ""); throw h; }
    }
    const fd = new FormData(); fd.append("dosya", new File([blob], "parca.mp3", { type: "audio/mpeg" }));
    fd.append("satirlar", satirMetni);
    if (bilinen.length) fd.append("onceki", JSON.stringify(bilinen));
    if (Number(kisiSayisi.value)) fd.append("sayi", kisiSayisi.value);
    let r, j;
    try { r = await fetch(`${WORKER}/konusmaci`, { method: "POST", headers: { Authorization: `Bearer ${oturum.access_token}` }, body: fd, signal: sinyal }); j = await r.json().catch(() => ({})); }
    catch (h) { if (h.name === "AbortError") throw h; throw new Error("Konuşmacı ayrımı servisine ulaşılamadı."); }
    if (!r.ok) { const e = new Error(j.hata || `Konuşmacı ayrımı hatası (${r.status})`); e.kalici = r.status === 503 || r.status === 401 || r.status === 403 || r.status === 404; throw e; }
    return j;
  }
  /**
   * Bir ses parçasını (≈20 dk) ≤10 dk'lık pencerelere bölüp her biri için konuşmacı ayrımı ister (daha kısa ses = daha doğru ve zaman aşımına dayanıklı).
   * Ses, mevcut MP3'ten bayt dilimiyle alınır (yeniden kodlama yok). Hatalı pencere diğerlerini durdurmaz (kalıcı hata hariç). Dönüş: { n: atanan satır, hatalar:[mesaj] }
   */
  const AYIR_SN = 600;
  async function ayirPencereli(blob, blobBas, blobSure, segs, oturum, sinyal) {
    const son = blobBas + blobSure; let n = 0; const hatalar = [];
    for (let w = blobBas; w < son - 0.001;) {
      let w2 = Math.min(son, w + AYIR_SN); if (son - w2 < 90) w2 = son;          // çok kısa artık pencere bırakma
      const sonPencere = w2 >= son - 0.001, dilim = segs.filter((x) => x.b >= w - 0.001 && (sonPencere || x.b < w2));
      if (dilim.length && !ayirKapali) {
        try { n += atamalariUygula(await ayirIstegi(mp3Dilim(blob, blobBas, blobSure, w, w2), dilim, w, oturum, sinyal), dilim); }
        catch (h) { if (h.name === "AbortError") throw h; hatalar.push(`${sureGoster(w)}–${sureGoster(w2)}: ${h.message}`); if (h.kalici) { ayirKapali = h.message; break; } }
      }
      w = w2;
    }
    return { n, hatalar };
  }
  /** Gemini sonucunu T'ye işle: etiket → konuşmacı dizini (parçalar arası aynı kişi aynı etiket). */
  function atamalariUygula(sonuc, segs) {
    const idx = new Map(); T.konusmacilar.forEach((k, i) => { if (k.etiket) idx.set(k.etiket, i); });
    const bilgi = new Map((sonuc.konusmacilar || []).map((k) => [k.etiket, k]));
    const edin = (et) => {
      let i = idx.get(et); const b = bilgi.get(et);
      if (i == null) { i = T.konusmacilar.length; T.konusmacilar.push({ ad: b?.ad || `Konuşmacı ${i + 1}`, renk: RENKLER[i % RENKLER.length], etiket: et, adOto: !!b?.ad, ozellik: b?.ozellik || "" }); idx.set(et, i); }
      else { const k = T.konusmacilar[i]; if (b?.ad && !k.adElle && (!k.adOto || k.ad.startsWith("Konuşmacı "))) { k.ad = b.ad; k.adOto = true; } if (b?.ozellik && !k.ozellik) k.ozellik = b.ozellik; }
      return i;
    };
    let n = 0; for (const s of segs) { const et = sonuc.atamalar?.[String(s.id)]; if (et) { s.k = edin(et); n++; } }
    return n;
  }
  function kisiMesaji(m, hata = false) { kisiDurum.hidden = !m; kisiDurum.textContent = m || ""; kisiDurum.classList.toggle("md-hata", hata); }

  /* ---------------- Yazıya dökme hattı ---------------- */
  basla.addEventListener("click", async () => {
    if (!dosya) return;
    const uyanikBirak = uyanikTut();                                   // tıklama anında başlat (tarayıcılar ses/uyku kilidini yalnızca kullanıcı hareketiyle verir); sekme arka plandayken kısılmayı azaltır
    const { bas: b0, son: s0 } = aralikDegeri(); if (ozelAralik.checked && !(Math.min(s0, kayitSure || s0) > b0)) { uyanikBirak(); return bildir("Bitiş, başlangıçtan sonra olmalı.", true); }
    let sunucu; try { sunucu = kaynak.hazirla(); } catch (h) { uyanikBirak(); return bildir(h.message, true); }
    /* Sistem anahtarı Site Sahibi tarafından kapatıldıysa, ses hiç sıkıştırılmadan/yüklenmeden önce net uyar (Worker da ayrıca reddeder). */
    const kd = await kotaDurumuOku("transkript");
    if (kd?.sistem_anahtari_acik === false && !sunucu.kendi) { uyanikBirak(); return bildir("Sistem anahtarı Site Sahibi tarafından kapatılmış: aşağıdaki “Hangi anahtarla çalışsın?” bölümünden KENDİ Groq anahtarını seç.", true); }
    if (kd?.sistem_anahtari_acik === false && kisiOto.checked && kisiKaynak.value === "sistem") { uyanikBirak(); return bildir("Sistem anahtarı kapalı olduğu için konuşmacı ayrımında “Site yapay zekâsı” kullanılamaz: yukarıdaki Yapay zekâ kutusundan KENDİ Gemini anahtarını seç ya da “Konuşmacıları otomatik bul”u kapat.", true); }
    const anahtar = `${dosya.name}|${dosya.size}|${b0}|${s0}|${mod.value}|${dil.value}`;
    basla.disabled = true; durdur.hidden = false; durduruldu = false; devamBilgi.hidden = true; iptal = new AbortController(); kisiMesaji("");
    let ayirZinciri = Promise.resolve(); const ayirHatalari = []; let ayirBekleyen = 0;
    if (!devam || devam.anahtar !== anahtar) { devam = { anahtar, sonraki: b0, segs: [], dil: null }; if (!baslikElleMi) T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] }; else T = { ...T, konusmacilar: [], segmentler: [], dil: null }; nid = 1; ayirKapali = null; }
    else { /* yarım kalan işe devam */ }
    const toplamSn = Math.max(1, (Number.isFinite(s0) ? Math.min(s0, kayitSure || s0) : kayitSure) - b0);
    try {
      const { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error("Oturum gerekli.");
      ilr.baslat("Ses hazırlanıyor", Math.max(2, toplamSn / 40));
      const sonuc = await sesAkisi(dosya, {
        bas: devam.sonraki, son: s0, signal: iptal.signal,
        ilerle: (o, m) => { if (m) ilr.etiket = m; },
        parca: async ({ bas, sure, f32 }) => {
          const adim = (m, o) => ilr.guncelle(Math.min(0.99, (bas - b0 + sure * o) / toplamSn), m);
          adim("Ses sıkıştırılıyor", 0.1);
          const blob = await mp3Kodla(f32, { signal: iptal.signal, ilerle: (o) => adim("Ses sıkıştırılıyor", 0.1 + o * 0.2) });
          adim(`${sureGoster(bas)} – ${sureGoster(bas + sure)} yazıya dökülüyor`, 0.4);
          const j = await parcaGonder(blob, bas, sure, sunucu, session);
          const yeni = (j.segmentler || []).map((s) => yeniSeg({ b: s.b, s: s.s, m: s.m, k: null }));
          devam.segs.push(...yeni); devam.dil ||= j.dil; if (j.kota) kota.yenile(j.kota);
          T = { ...T, dil: devam.dil, sure: kayitSure || T.sure, segmentler: devam.segs };
          if (kisiOto.checked && !ayirKapali && yeni.length) {            // ayrım, sıradaki parçanın dökümüyle PARALEL yürür (zincir: konuşmacı sürekliliği için sırayla)
            ayirBekleyen++;
            ayirZinciri = ayirZinciri.then(async () => {
              try { const { hatalar } = await ayirPencereli(blob, bas, sure, yeni, session, iptal?.signal); ayirHatalari.push(...hatalar); }
              catch (h) { if (h.name !== "AbortError") ayirHatalari.push(h.message || String(h)); }
              finally { ayirBekleyen--; if (!stud.hidden) hepsiniCiz(); }
            });
          }
          if (!baslikElleMi) T.baslik = baslikOner(T.segmentler);
          devam.sonraki = bas + sure; adim("Parça tamamlandı", 1); yarimKaydet();
          studyoGoster(stud.hidden ? "okuma" : null);
        },
      });
      if (ayirBekleyen > 0) ilr.etiket = "Konuşmacılar ayrılıyor";
      await ayirZinciri; if (iptal?.signal.aborted) throw Object.assign(new Error("İptal edildi."), { name: "AbortError" });
      if (!T.segmentler.length) throw new Error("Bu aralıkta konuşma bulunamadı. Başka bir bölüm ya da dil seçmeyi dene.");
      if (sonuc?.sure && !kayitSure) kayitSure = sonuc.sure; T.sure = ozelAralik.checked ? topSure() : (kayitSure || topSure());
      const atanan = T.segmentler.filter((x) => x.k != null).length;
      if (kisiOto.checked && ayirHatalari.length) kisiMesaji(`Konuşmacı ayrımı ${atanan ? `kısmen tamamlandı (${atanan}/${T.segmentler.length} satır atandı)` : "yapılamadı"}: ${[...new Set(ayirHatalari.map((m) => m.replace(/^[\d:–-]+:\s*/, "")))].slice(0, 2).join(" · ")} Metin hazır; “Konuşmacılar” sekmesindeki “Konuşmacıları bul” ile tekrar deneyebilir ya da elle atayabilirsin.`, true);
      else if (kisiOto.checked && T.konusmacilar.length) kisiMesaji(`✔ ${T.konusmacilar.length} konuşmacı otomatik ayrıldı (${atanan}/${T.segmentler.length} satır). Adlara dokunarak düzeltebilirsin (Konuşmacılar sekmesi).`);
      else if (kisiOto.checked && !kisiDurum.textContent) kisiMesaji("Konuşmacı ayrımı sonuç vermedi; “Konuşmacılar” sekmesinden tekrar deneyebilirsin.", true);
      ilr.bitir(); studyoGoster("okuma"); bildir(`✔ Transkript hazır: ${T.segmentler.length} satır. Aşağıdaki sekmelerden oku, düzenle ve indir.`); await yarimSil(dosya); devam = null; durduruldu = false; kayitId = null; gecmisCiz();
      stud.scrollIntoView?.({ block: "start", behavior: "smooth" });
    } catch (h) {
      ilr.bitir();
      durduruldu = true;
      if (devam?.segs.length) { await ayirZinciri.catch(() => {}); await yarimKaydet(); }
      if (h.name === "AbortError") bildir(devam?.segs.length ? `⏸ Durduruldu. ${sureGoster(devam.sonraki)} konumuna kadar olan kısım korundu ve bu cihazda saklandı; “Devam ettir”e basarak sürdürebilirsin.` : "Durduruldu.");
      else bildir(`${h.message || h}${devam?.segs.length ? " — Tamamlanan kısım korundu ve saklandı; “Devam ettir”e basınca baştan başlamaz." : ""}`, true);
      kota.yenile();
    } finally { uyanikBirak(); basla.disabled = !dosya; durdur.hidden = true; iptal = null; yarimDevamKontrol(); yuzenGuncelle(); }
  });

  /* Mevcut metin için konuşmacıları sonradan bul (kayıt dosyası gerekir). */
  async function konusmacilariAlgila() {
    if (!dosya) return bildir("Önce kayıt dosyasını seç (üstteki “Kayıt dosyasını bağla”).", true);
    if (!T.segmentler.length) return;
    iptal = new AbortController(); durdur.hidden = false; kisiMesaji(""); ayirKapali = null;
    const uyanikBirak = uyanikTut();
    try {
      const { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error("Oturum gerekli.");
      kaydetGeri(); T.konusmacilar = []; T.segmentler.forEach((s) => { s.k = null; });
      const bas = T.segmentler[0].b, son = topSure() + 1; let n = 0; const hatalarTum = [];
      ilr.baslat("Konuşmacılar ayrılıyor", 60);
      await sesAkisi(dosya, { bas, son, signal: iptal.signal, ilerle: (o) => ilr.guncelle(o * 0.9), parca: async (p) => {
        const dilim = T.segmentler.filter((s) => s.b >= p.bas - 0.01 && s.b < p.bas + p.sure); if (!dilim.length) return;
        const blob = await mp3Kodla(p.f32, { signal: iptal.signal });
        const { n: k, hatalar } = await ayirPencereli(blob, p.bas, p.sure, dilim, session, iptal.signal); n += k; hatalarTum.push(...hatalar); hepsiniCiz();
      } });
      ilr.bitir(); hepsiniCiz();
      if (hatalarTum.length) kisiMesaji(`${n ? `Kısmen tamamlandı (${n}/${T.segmentler.length} satır atandı). ` : ""}${[...new Set(hatalarTum.map((m) => m.replace(/^[\d:–-]+:\s*/, "")))].slice(0, 2).join(" · ")}`, true);
      else kisiMesaji(`✔ ${T.konusmacilar.length} konuşmacı bulundu (${n} satır atandı).`);
      bildir("");
    } catch (h) { ilr.bitir(); if (h.name === "AbortError") bildir("Durduruldu."); else { kisiMesaji(h.message || String(h), true); bildir(h.message || String(h), true); } hepsiniCiz(); }
    finally { uyanikBirak(); durdur.hidden = true; iptal = null; }
  }

  const temizle = dugme("🧹 Belleği temizle", () => { dosya = null; kayitSure = 0; devam = null; T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] }; secili.clear(); geriAl = []; baslikElleMi = false; if (sesUrl) { URL.revokeObjectURL(sesUrl); sesUrl = null; } oynatici.removeAttribute("src"); stud.hidden = true; sirket.hidden = true; dosyaBilgi.hidden = true; ilr.bitir(); basla.disabled = true; bildir("🧹 Bellek temizlendi (yerel kayıtlar silinmez)."); });
  /* Sekme değişince iş/sonuç SİLİNMEZ (iş arkada sürer; silmek kullanıcının isteğine bağlı: “Belleği temizle” / geçmişten “Sil”). Dosya girdilerini boşaltan genel yedek zararsızdır: seçili dosya bellekte tutulur. */
  sekmeSifirlamaKaydet("tool-medya-transkript", () => { yuzenGuncelle(); });

  /* ---------------- Çalışan iş göstergesi + sayfadan ayrılma uyarısı ---------------- */
  const yuzen = el("button", { type: "button", class: "ts-yuzen", hidden: true, "aria-live": "polite", title: "Transkript sekmesine dön" }, el("span", { class: "ts-yuzen-nokta", "aria-hidden": "true" }), el("span", { class: "ts-yuzen-metin" }, el("strong", { text: "Transkript sürüyor" }), el("small", { class: "ts-yuzen-alt" })));
  yuzen.addEventListener("click", () => { try { location.hash = "#tool-medya"; } catch { /* yok */ } kok.scrollIntoView?.({ block: "start" }); });
  document.body.append(yuzen);
  function yuzenGuncelle() {
    const calisiyor = !!iptal, gorunur = kok.offsetParent !== null;
    yuzen.hidden = !(calisiyor && !gorunur);
    if (!yuzen.hidden) yuzen.querySelector(".ts-yuzen-alt").textContent = `${ilr.etiket || "Çalışıyor"}${ilr.oran != null ? ` — %${Math.round(ilr.oran * 100)}` : ""} · açmak için dokun`;
  }
  const yuzenZaman = setInterval(() => { if (!document.body.contains(kok)) { clearInterval(yuzenZaman); yuzen.remove(); return; } yuzenGuncelle(); }, 1000);
  window.addEventListener("beforeunload", (e) => { if (iptal) { e.preventDefault(); e.returnValue = ""; } });   // iş sürerken sayfayı kapatma/yenilemeye karşı uyar (sekme değiştirmek serbest)
  window.addEventListener("hashchange", yuzenGuncelle);

  /* ---------------- Yerleşim ---------------- */
  const ustBar = el("div", { class: "ts-ustbar" },
    dugme("📋 Kopyala", kopyala, "Metni panoya kopyala"), dugme("⬇ PDF", () => disaAktar("pdf"), "PDF olarak indir", "md-btn md-birincil"), dugme("⬇ Word", () => disaAktar("docx")), dugme("⬇ TXT", () => disaAktar("txt")), dugme("Tüm biçimler ›", () => { sekmeAc("indir"); stud.scrollIntoView?.({ block: "start" }); }, "SRT, VTT, CSV, HTML, Markdown…"));
  stud.append(el("section", { class: "md-kart ts-sonuc" },
    el("div", { class: "ts-baslikalani" }, baslikGirdi, baslikOneri), meta, kisiDurum, anahtarlar,
    ustBar, sekmeSerit,
    el("div", { class: "ts-arac ts-arabar" }, ara, onceki, sonraki, araSay), araclar, el("div", { class: "md-eylem" }, sesBaglaBtn, bagGirdi),
    bolme.okuma, bolme.satirlar, bolme.kisiler, bolme.indir));
  kok.classList.add("md-kok");
  kok.replaceChildren(
    el("div", { class: "md-kart ts-giris" }, el("h2", { text: "📝 Transkript Stüdyosu" }), el("p", { class: "md-soluk", text: "Ses ya da videoyu yazıya dök; konuşmacıları otomatik ayır; PDF, Word, altyazı ve daha fazlası olarak indir." }),
      el("p", { class: "md-soluk ts-gizlilik", text: "🔒 Kayıt tarayıcında küçültülür; yalnızca ses Worker üzerinden Groq Whisper'a gider (kendi anahtarını seçersen doğrudan Groq'a). Konuşmacı ayrımı açıksa ses Google Gemini'ye (site anahtarıyla Worker üzerinden ya da kendi anahtarınla doğrudan) gider. Worker hiçbir şey kaydetmez." })),
    kurulum, stud, kota.kok, kaynak.kok, gecmisKart, temizle);
  gecmisCiz(); aralikOzetle(); aiKaynaklariYukle().catch(() => {}); yarimDevamKontrol();
}
kur().catch((h) => { console.error("medya-transkript.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` })); });
