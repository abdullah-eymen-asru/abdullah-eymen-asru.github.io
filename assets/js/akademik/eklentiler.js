/*
 * assets/js/akademik/eklentiler.js — PDF okuyucu EKLENTİLERİ (Zotero'nun "seçili metinle yap" eklentilerinin güvenli karşılığı).
 * -----------------------------------------------------------------------------------------------------------------
 * TASARIM KARARLARI (kota ve güvenlik):
 *  • HİÇBİR eklenti kodu sunucudan/başka siteden çalıştırılmaz: katalog bu dosyada SABİTTİR (denetlenmiş). Kullanıcı yalnızca
 *    "arama bağlantısı eklentisi" ekleyebilir (https://… {metin} …) — bu bir bağlantı açar, kod çalıştırmaz → XSS/CSP riski yok.
 *  • Supabase/R2 kotasından YEMEZ: ayarlar kullanıcı başına tek küçük satır (≤ 8 KB, jsonb); PDF'ler/çeviri sonuçları hiçbir yere
 *    kaydedilmez. İstekler tarayıcıdan doğrudan ücretsiz, anahtarsız genel servislere gider (Worker'dan geçmez).
 *  • Tarayıcı depolamasını şişirmez: çeviri varsayılanı İNTERNET servisidir. Cihaz-içi çeviri (Chrome Translator API) yalnızca
 *    kullanıcı açıkça seçerse kullanılır (tarayıcı dil paketi indirir — kullanıcıya açıkça söylenir).
 *  • Yetki: Yetki Ayarları › "Akademik Okuyucu Eklentileri" anahtarı (varsayılan AÇIK; rol bazında kapatılabilir). Kapalıysa eklenti
 *    düğmeleri ve ayar paneli görünmez. Site Sahibi her zaman kullanır.
 * Ayar biçimi: { v:1, acik:[id,…], ayar:{ [id]:{…} }, ozel:[{id, ad, simge, url}] }
 */
import { supabase } from "./ortak.js";

const YEREL_ANAHTAR = "aea_ak_eklenti_v1";
const ZAMAN_ASIMI = 12000;
const DILLER = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça", ru: "Rusça" };

/* ------------------------------ yardımcılar ------------------------------ */
const kisalt = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/* ------------------------------ GİZLİLİK İLKESİ ------------------------------
 * Bu sürümde hiçbir eklenti seçili metni sitemizden bir üçüncü tarafa GÖNDERMEZ. İki tür eklenti vardır:
 *  • "yerel": her şey tarayıcında çalışır (veri cihazından çıkmaz).
 *  • "bağlantı": yalnızca SEN tıklayınca, seçili metinle yeni sekmede bir adres açar (Google/DeepL gibi). Metni o sitede sen gönderirsin;
 *    sitemiz hiçbir isteği kendisi yapmaz. Bu eklentiler varsayılan KAPALIDIR (kullanıcı tercihi).
 * Önceki sürümdeki MyMemory/dictionaryapi/Vikipedi/Crossref API çağrıları gizlilik nedeniyle KALDIRILDI. */

/** Cihaz içi çeviri: Chrome/Edge'in yerleşik Translator API'si (model tarayıcıda çalışır; metin hiçbir sunucuya gitmez). */
async function cihazCeviri(metin, kaynak, hedef) {
  if (!("Translator" in self)) {
    throw new Error("Bu tarayıcıda cihaz-içi çeviri yok (Chrome/Edge 138+ gerekir). Safari/Mac/iPhone'da: metni seçip sistem menüsünden “Çevir”i kullan (o da cihazda çalışır); ya da Ayarlar'dan Google/DeepL bağlantı eklentisini aç.");
  }
  let src = kaynak;
  if (src === "auto" && "LanguageDetector" in self) {
    try { const det = await self.LanguageDetector.create(); src = (await det.detect(metin))?.[0]?.detectedLanguage || "en"; } catch { src = "en"; }
  }
  if (src === "auto") src = "en";
  if (src === hedef) return { metin, yontem: "Kaynak ve hedef dil aynı" };
  const durum = await self.Translator.availability({ sourceLanguage: src, targetLanguage: hedef });
  if (durum === "unavailable") throw new Error(`Bu dil çifti (${src}→${hedef}) cihazda desteklenmiyor.`);
  const tr = await self.Translator.create({ sourceLanguage: src, targetLanguage: hedef });
  return { metin: await tr.translate(metin), yontem: `Cihaz içi (${src}→${hedef}) — veri cihazdan çıkmadı` };
}

const DILLER_URL = { tr: "tr", en: "en", de: "de", fr: "fr", es: "es", ar: "ar", ru: "ru" };

export const KATALOG = Object.freeze({
  ceviri: {
    ad: "Çeviri (cihaz içi · özel)", simge: "🌐", gizlilik: "yerel",
    aciklama: "Seçili metni tarayıcının yerleşik çeviri motoruyla çevirir. Metin cihazından ÇIKMAZ. (Chrome/Edge 138+; ilk kullanımda dil paketi tarayıcı tarafından indirilebilir.)",
    ayarlar: [
      { anahtar: "hedef", etiket: "Hedef dil", tur: "secim", secenekler: { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça", ru: "Rusça" }, varsayilan: "tr" },
      { anahtar: "kaynak", etiket: "Kaynak dil", tur: "secim", secenekler: { auto: "Otomatik algıla", tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça", ru: "Rusça" }, varsayilan: "auto" },
    ],
    async calistir({ metin, ayar }) {
      const c = await cihazCeviri(metin, ayar.kaynak || "auto", ayar.hedef || "tr");
      return { baslik: "Çeviri", metin: c.metin, not: c.yontem };
    },
  },
  ceviri_google: {
    ad: "Google Çeviri'de aç", simge: "🔤", gizlilik: "baglanti", varsayilanKapali: true,
    aciklama: "Seçili metni Google Çeviri'de yeni sekmede açar. UYARI: metni o sitede sen göndermiş olursun (Google'a gider). Yalnızca tercih edersen aç.",
    ayarlar: [{ anahtar: "hedef", etiket: "Hedef dil", tur: "secim", secenekler: { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça", ru: "Rusça" }, varsayilan: "tr" }],
    baglanti: ({ metin, ayar }) => `https://translate.google.com/?sl=auto&tl=${DILLER_URL[ayar.hedef] || "tr"}&text=${encodeURIComponent(kisalt(metin, 1500))}&op=translate`,
  },
  ceviri_deepl: {
    ad: "DeepL'de aç", simge: "🅳", gizlilik: "baglanti", varsayilanKapali: true,
    aciklama: "Seçili metni DeepL'de yeni sekmede açar (genelde en iyi çeviri kalitesi). UYARI: metin DeepL'e gider. Yalnızca tercih edersen aç.",
    ayarlar: [{ anahtar: "hedef", etiket: "Hedef dil", tur: "secim", secenekler: { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ru: "Rusça" }, varsayilan: "tr" }],
    baglanti: ({ metin, ayar }) => `https://www.deepl.com/translator#auto/${DILLER_URL[ayar.hedef] || "tr"}/${encodeURIComponent(kisalt(metin, 1500))}`,
  },
  istatistik: {
    ad: "Metin bilgisi", simge: "🔢", gizlilik: "yerel",
    aciklama: "Seçilen metnin kelime/karakter sayısını ve tahmini okuma süresini gösterir. Tamamen yerel.", ayarlar: [],
    async calistir({ metin }) {
      const k = metin.split(/\s+/).filter(Boolean).length;
      return { baslik: "Metin bilgisi", metin: `${k} kelime · ${metin.length} karakter · ≈ ${Math.max(1, Math.round(k / 220 * 60))} sn okuma` };
    },
  },
  temizle: {
    ad: "Temiz kopyala", simge: "🧹", gizlilik: "yerel",
    aciklama: "PDF'ten gelen satır sonu tirelerini ve kopuk satırları düzelterek metni tek paragraf halinde panoya kopyalar. Yerel.", ayarlar: [],
    async calistir({ metin }) {
      const temiz = metin.replace(/-\s*\n?\s*(?=\p{Ll})/gu, "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
      try { await navigator.clipboard.writeText(temiz); } catch { /* pano izni yok */ }
      return { baslik: "Temiz metin (panoya kopyalandı)", metin: temiz };
    },
  },
  doi_cikar: {
    ad: "DOI / adres bul", simge: "🔗", gizlilik: "yerel",
    aciklama: "Seçili metindeki DOI ve web adreslerini bulur ve tıklanabilir yapar. Yerel — hiçbir istek yapılmaz.", ayarlar: [],
    async calistir({ metin }) {
      const doi = [...metin.matchAll(/\b10\.\d{4,9}\/[^\s"<>]+/g)].map((m) => m[0].replace(/[.,;)\]]+$/, ""));
      const url = [...metin.matchAll(/https?:\/\/[^\s"<>]+/g)].map((m) => m[0].replace(/[.,;)\]]+$/, ""));
      if (!doi.length && !url.length) throw new Error("Seçili metinde DOI ya da adres bulunamadı.");
      return { baslik: "Bulunanlar", metin: [...doi.map((x) => `DOI: ${x}`), ...url].join("\n"), baglanti: doi.length ? `https://doi.org/${doi[0]}` : url[0] };
    },
  },
  akademik: { ad: "Google Akademik'te ara", simge: "🎓", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili metinle Google Akademik'i yeni sekmede açar (arama metni Google'a gider). Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://scholar.google.com/scholar?q=${encodeURIComponent(kisalt(metin, 300))}` },
  semantic: { ad: "Semantic Scholar'da ara", simge: "🧠", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili metinle Semantic Scholar'ı yeni sekmede açar. Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(kisalt(metin, 300))}` },
  vikipedi: { ad: "Vikipedi'de ara", simge: "🧭", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili terimi Vikipedi'de yeni sekmede arar (kâr amacı gütmeyen, açık kaynak). Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://tr.wikipedia.org/w/index.php?search=${encodeURIComponent(kisalt(metin, 100))}` },
  wiktionary: { ad: "Vikisözlük'te ara", simge: "📖", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili kelimeyi Vikisözlük'te yeni sekmede arar. Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://tr.wiktionary.org/w/index.php?search=${encodeURIComponent(kisalt(metin, 60))}` },
});

export const VARSAYILAN_AYAR = Object.freeze({ v: 1, acik: ["ceviri", "istatistik", "temizle", "doi_cikar"], ayar: {}, ozel: [] });

/* ------------------------------ ayar saklama (yerel + küçük bulut satırı) ------------------------------ */
function temizle(a) {
  const o = { v: 1, acik: [], ayar: {}, ozel: [] };
  if (!a || typeof a !== "object") return { ...VARSAYILAN_AYAR, acik: [...VARSAYILAN_AYAR.acik] };
  const ozel = (Array.isArray(a.ozel) ? a.ozel : []).filter((x) => x && typeof x.id === "string" && ozelUrlGecerli(x.url)).slice(0, 10)
    .map((x) => ({ id: String(x.id).slice(0, 40), ad: kisalt(String(x.ad || "Arama"), 40), simge: kisalt(String(x.simge || "🔗"), 4), url: String(x.url).slice(0, 500) }));
  const gecerli = new Set([...Object.keys(KATALOG), ...ozel.map((x) => x.id)]);
  o.acik = (Array.isArray(a.acik) ? a.acik : []).filter((x) => gecerli.has(x)).slice(0, 30);
  o.ozel = ozel;
  for (const [id, v] of Object.entries(a.ayar && typeof a.ayar === "object" ? a.ayar : {})) {
    if (!KATALOG[id]) continue;
    o.ayar[id] = {};
    for (const s of KATALOG[id].ayarlar) if (v && typeof v[s.anahtar] === "string" && s.secenekler[v[s.anahtar]]) o.ayar[id][s.anahtar] = v[s.anahtar];
  }
  return o;
}
export function ozelUrlGecerli(u) {
  try { const x = new URL(String(u).replace(/\{metin\}/g, "x")); return x.protocol === "https:" && String(u).includes("{metin}") && String(u).length <= 500; } catch { return false; }
}
export function yerelOku() { try { return temizle(JSON.parse(localStorage.getItem(YEREL_ANAHTAR) || "null")); } catch { return temizle(null); } }
function yerelYaz(a) { try { localStorage.setItem(YEREL_ANAHTAR, JSON.stringify(a)); } catch { /* depo kapalı */ } }

let onbellek = null, ozellikAcik = null;
/** Bu kullanıcı için eklentiler açık mı? (Yetki Ayarları anahtarı; hata olursa AÇIK — kütüphane yetkisi zaten ayrıca denetlenir.) */
export async function eklentilerAcikMi() {
  if (ozellikAcik !== null) return ozellikAcik;
  try { const { data, error } = await supabase.rpc("ozellik_erisimi_var_mi", { p_ozellik: "akademik_eklentiler" }); ozellikAcik = error ? true : data !== false; }
  catch { ozellikAcik = true; }
  return ozellikAcik;
}
/** Ayarları getirir: önce yerel (anında), sonra bulut satırı (cihazlar arası). Bulut yoksa yerel kalır. */
export async function ayarYukle() {
  if (onbellek) return onbellek;
  onbellek = yerelOku();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("akademik_eklenti_ayarlari").select("ayar").eq("user_id", user.id).maybeSingle();
      if (data?.ayar) { onbellek = temizle(data.ayar); yerelYaz(onbellek); }
    }
  } catch { /* tablo/ağ yok: yerel ayar yeterli */ }
  return onbellek;
}
export async function ayarKaydet(a) {
  onbellek = temizle(a); yerelYaz(onbellek);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("akademik_eklenti_ayarlari").upsert({ user_id: user.id, ayar: onbellek, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) return { bulut: false, hata: error.message };
    }
    return { bulut: true };
  } catch (h) { return { bulut: false, hata: h.message }; }
}

/* ------------------------------ çalıştırma ------------------------------ */
/** Okuyucu balonunda gösterilecek açık eklentiler: [{id, ad, simge}] */
export function acikEklentiler(a) {
  const liste = [];
  for (const id of a.acik) {
    if (KATALOG[id]) liste.push({ id, ad: KATALOG[id].ad, simge: KATALOG[id].simge });
    else { const o = a.ozel.find((x) => x.id === id); if (o) liste.push({ id, ad: o.ad, simge: o.simge }); }
  }
  return liste;
}
/** @returns {Promise<{baslik:string, metin?:string, not?:string, baglanti?:string, ac?:string}>} — ac: yeni sekmede açılacak adres */
export async function eklentiCalistir(id, metin, a) {
  const temiz = String(metin || "").replace(/\s+/g, " ").trim();
  if (!temiz) throw new Error("Önce metin seç.");
  const kat = KATALOG[id];
  const ayar = (a.ayar && a.ayar[id]) || {};
  const tam = Object.fromEntries((kat?.ayarlar || []).map((s) => [s.anahtar, ayar[s.anahtar] || s.varsayilan]));
  if (kat?.baglanti) return { baslik: kat.ad, ac: kat.baglanti({ metin: temiz, ayar: tam }) };
  if (kat?.calistir) return kat.calistir({ metin: id === "temizle" ? String(metin).slice(0, 6000) : temiz.slice(0, 4000), ayar: tam });
  const o = a.ozel.find((x) => x.id === id);
  if (o) return { baslik: o.ad, ac: o.url.replace(/\{metin\}/g, encodeURIComponent(kisalt(temiz, 300))) };
  throw new Error("Bu eklenti bulunamadı.");
}
