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
  if (!("Translator" in self)) throw new Error("Bu tarayıcıda cihaz-içi çeviri yok (Chrome/Edge 138+ gerekir).");
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

/* ------------------------------ SİTE İÇİ ÇEVİRİ (çevrimiçi sağlayıcılar, açık rıza ile) ------------------------------
 * Hiçbir yeni sunucu/Worker/anahtar gerekmez: tarayıcı doğrudan genel çeviri uçlarına gider (Cloudflare kotası harcanmaz).
 * GİDEN VERİ: yalnızca seçtiğin metin (en çok 1500 karakter) + dil çifti + (her web isteğinde olduğu gibi) IP adresin. Hesap/kaynak bilgisi GİTMEZ.
 * Sağlayıcılar: Google Çeviri (gayriresmî genel uç; en iyi kalite) · MyMemory (açık, ücretsiz çeviri belleği; kalite orta, 500 karakter parça sınırı).
 * "Otomatik": önce cihaz içi (varsa; veri çıkmaz) → Google → MyMemory. Rıza tarayıcıda saklanır (localStorage), Ayarlar'dan geri alınır. */
const RIZA_ANAHTARI = "aea_ak_ceviri_riza_v1";
export const cevirRizasiVarMi = () => { try { return localStorage.getItem(RIZA_ANAHTARI) === "1"; } catch { return false; } };
export const cevirRizasiVer = () => { try { localStorage.setItem(RIZA_ANAHTARI, "1"); } catch { /* yok say */ } };
export const cevirRizasiGeriAl = () => { try { localStorage.removeItem(RIZA_ANAHTARI); } catch { /* yok say */ } };
export const RIZA_METNI = "Çevrimiçi çeviri için seçtiğin metin (en çok 1500 karakter), kaynak/hedef dil ve IP adresin çeviri servisine (Google Çeviri veya MyMemory) gönderilir. Hesabın, kütüphane bilgilerin ve PDF'in kendisi GÖNDERİLMEZ. Servis metni kendi gizlilik koşullarına göre işleyebilir. Cihaz-içi çeviri (Chrome/Edge) kullanılabiliyorsa önce o denenir ve hiçbir şey gönderilmez. Onaylıyor musun? (Ayarlar'dan istediğin an geri alabilirsin.)";
async function zamanAsimliFetch(url, secenek = {}, ms = ZAMAN_ASIMI) {
  const k = new AbortController(), z = setTimeout(() => k.abort(), ms);
  try { const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: k.signal, ...secenek }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
  finally { clearTimeout(z); }
}
async function googleCeviri(metin, kaynak, hedef) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(kaynak)}&tl=${encodeURIComponent(hedef)}&dt=t&q=${encodeURIComponent(metin)}`;
  const j = await (await zamanAsimliFetch(url)).json();
  const parcalar = Array.isArray(j?.[0]) ? j[0].map((x) => x?.[0] || "").join("") : "";
  if (!parcalar) throw new Error("Google boş yanıt verdi.");
  return { metin: parcalar, algilanan: j?.[2] || "", yontem: `Google Çeviri (${j?.[2] || kaynak}→${hedef}) — metin Google'a gönderildi` };
}
function parcala(metin, n) {
  const cumleler = metin.match(/[^.!?;:。]+[.!?;:。]?\s*/g) || [metin], cikti = [];
  let cur = "";
  for (const c of cumleler) {
    if ((cur + c).length > n && cur) { cikti.push(cur.trim()); cur = ""; }
    if (c.length > n) { for (let i = 0; i < c.length; i += n) cikti.push(c.slice(i, i + n).trim()); } else cur += c;
  }
  if (cur.trim()) cikti.push(cur.trim());
  return cikti;
}
async function myMemoryCeviri(metin, kaynak, hedef) {
  const cift = `${kaynak === "auto" ? "Autodetect" : kaynak}|${hedef}`;
  const sonuc = [];
  for (const p of parcala(metin, 450)) {
    const j = await (await zamanAsimliFetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${encodeURIComponent(cift)}`)).json();
    if (j?.responseStatus && Number(j.responseStatus) !== 200) throw new Error(j.responseDetails || "MyMemory hata verdi.");
    sonuc.push(j?.responseData?.translatedText || "");
  }
  const m = sonuc.join(" ").trim();
  if (!m) throw new Error("MyMemory boş yanıt verdi.");
  return { metin: m, yontem: `MyMemory (açık çeviri belleği, ${cift}) — metin MyMemory'ye gönderildi` };
}
/** Motor sırasıyla dener; çevrimiçi motorlar için rıza ister.
 *  motor: "google" | "mymemory" | "cihaz" | "cihaz_sonra" (önce cihaz içi, olmazsa çevrimiçi) | "auto" (= doğrudan çevrimiçi: Google → MyMemory).
 *  NEDEN: eskiden "auto" her seferinde önce cihaz içi çeviriyi (Chrome Translator API) deniyordu; bu API çoğu tarayıcıda olmadığı için
 *  her çeviri gereksiz bir hata + gecikmeyle başlıyordu. Artık cihaz içi motor YALNIZCA kullanıcı seçtiyse ("cihaz"/"cihaz_sonra") denenir. */
export const cihazCeviriVarMi = () => typeof self !== "undefined" && "Translator" in self;
export async function ceviriYap(metin, { kaynak = "auto", hedef = "tr", motor = "auto" } = {}) {
  const hatalar = [];
  const dene = async (ad, fn) => { try { return await fn(); } catch (h) { hatalar.push(`${ad}: ${h.message}`); return null; } };
  const onayAl = () => {
    if (cevirRizasiVarMi()) return true;
    if (typeof window.confirm === "function" && window.confirm(RIZA_METNI)) { cevirRizasiVer(); return true; }
    return false;
  };
  if (motor === "cihaz" || motor === "cihaz_sonra") {
    const c = cihazCeviriVarMi() ? await dene("Cihaz içi", () => cihazCeviri(metin, kaynak, hedef)) : (hatalar.push("Cihaz içi: bu tarayıcıda yok (Chrome/Edge 138+ gerekir)."), null);
    if (c) return c;
    if (motor === "cihaz") throw new Error(`Cihaz içi çeviri yapılamadı. ${hatalar.join(" · ")} Ayarlar'dan çevrimiçi motoru seç.`);
  }
  if (!onayAl()) throw new Error("Çevrimiçi çeviri için onay vermedin; hiçbir veri gönderilmedi.");
  const sira = motor === "mymemory" ? ["mymemory"] : motor === "google" ? ["google"] : ["google", "mymemory"];
  for (const m of sira) {
    const sonuc = m === "google" ? await dene("Google", () => googleCeviri(metin, kaynak, hedef)) : await dene("MyMemory", () => myMemoryCeviri(metin, kaynak, hedef));
    if (sonuc) return sonuc;
  }
  throw new Error(`Çeviri servislerine ulaşılamadı. ${hatalar.join(" · ")}`);
}

/* ------------------------------ DOI bulma (satır sonu/tire/boşluk bozulmalarına dayanıklı) ------------------------------ */
const DOI_BASLANGIC = /10\.\d{4,9}\//g;
export function doiBul(ham) {
  const t = String(ham || "").normalize("NFKC").replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s*\n\s*/g, " ");
  const bulunan = [];
  for (const m of t.matchAll(DOI_BASLANGIC)) {
    const bas = m.index + m[0].length;
    const jetonlar = t.slice(bas).split(/\s+/);
    let govde = jetonlar.shift() || "";
    while (jetonlar.length) {
      const son = govde.slice(-1), sonraki = jetonlar[0];
      if (!sonraki || /^(https?:|doi:|10\.\d{4,9}\/|www\.)/i.test(sonraki)) break;
      // satır kırılması: önceki parça - / _ ile ya da (nokta ile bitip sonraki küçük harf/rakamla başlıyorsa) ve sonraki parça kısa/DOI benzeri ise birleştir
      if (/[-/_]$/.test(govde) || (son === "." && /^[a-z0-9]/.test(sonraki) && sonraki.length < 25 && !/[a-z]{4,}\b[^a-z0-9.-]/i.test(sonraki))) { govde += jetonlar.shift(); continue; }
      if (/^[A-Za-z0-9._()\-/]{1,12}$/.test(sonraki) && /\d$/.test(govde) && /^\d/.test(sonraki) && govde.length < 14) { govde += jetonlar.shift(); continue; }   // "10.1016/j.x.2020. 1234" gibi bölünmüş sayı
      break;
    }
    govde = govde.replace(/[,;:"'’”]+$/g, "");
    while (/[.)\]>}]$/.test(govde)) {                                  // dengesiz kapanış/cümle sonu noktası at
      const k = govde.slice(-1);
      if (k === ".") govde = govde.slice(0, -1);
      else { const acik = { ")": "(", "]": "[", ">": "<", "}": "{" }[k]; if ((govde.split(acik).length) >= (govde.split(k).length)) break; govde = govde.slice(0, -1); }
    }
    const doi = `${m[0]}${govde}`;
    if (/^10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>+#%]+$/.test(doi) && govde.length >= 2) bulunan.push(doi);
  }
  return [...new Set(bulunan)];
}
async function crossrefDogrula(doi) {
  try {
    const j = await (await zamanAsimliFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: "application/json" } })).json();
    const m = j?.message, baslik = (m?.title || [])[0] || "(başlıksız)", yil = m?.issued?.["date-parts"]?.[0]?.[0] || m?.created?.["date-parts"]?.[0]?.[0] || "";
    return { ok: true, metin: `✓ Doğrulandı: ${baslik}${yil ? ` (${yil})` : ""}${m?.["container-title"]?.[0] ? ` — ${m["container-title"][0]}` : ""}` };
  } catch (h) {
    return { ok: false, metin: /404/.test(h.message) ? "✗ Crossref'te bu DOI yok. Hatalı kopyalanmış olabilir ya da DOI başka bir kayıt kurumunda (örn. DataCite) kayıtlıdır." : `Doğrulanamadı: ${h.message}` };
  }
}

const DIL_SECENEKLERI = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", es: "İspanyolca", ar: "Arapça", ru: "Rusça" };
const DILLER_URL = { tr: "tr", en: "en", de: "de", fr: "fr", es: "es", ar: "ar", ru: "ru" };

export const KATALOG = Object.freeze({
  ceviri: {
    ad: "Çeviri (site içinde)", simge: "🌐", gizlilik: "karma", grup: "ceviri",
    aciklama: "Seçili metni bu pencerede çevirir (yeni sekme açmaz). Otomatik modda cihaz içi çeviri DENENMEZ; onayınla doğrudan Google Çeviri, olmazsa MyMemory kullanılır. Veri çıkmasın istersen motoru «Yalnızca cihaz içi» seç. Giden veri: yalnızca seçtiğin metin ve dil çifti.",
    ayarlar: [
      { anahtar: "hedef", etiket: "Hedef dil", tur: "secim", secenekler: DIL_SECENEKLERI, varsayilan: "tr" },
      { anahtar: "kaynak", etiket: "Kaynak dil", tur: "secim", secenekler: { auto: "Otomatik algıla", ...DIL_SECENEKLERI }, varsayilan: "auto" },
      { anahtar: "motor", etiket: "Çeviri motoru", tur: "secim", secenekler: { auto: "Otomatik (önerilen): doğrudan Google, olmazsa MyMemory", cihaz_sonra: "Önce cihaz içi (varsa), olmazsa çevrimiçi", cihaz: "Yalnızca cihaz içi (veri çıkmaz)", google: "Yalnızca Google Çeviri", mymemory: "Yalnızca MyMemory" }, varsayilan: "auto" },
    ],
    async calistir({ metin, ayar }) {
      const c = await ceviriYap(metin.slice(0, 1500), { kaynak: ayar.kaynak || "auto", hedef: ayar.hedef || "tr", motor: ayar.motor || "auto" });
      return { baslik: "Çeviri", metin: c.metin, not: c.yontem };
    },
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
    ad: "DOI bul", simge: "🔗", gizlilik: "yerel", grup: "metin",
    aciklama: "Seçili metindeki DOI'yi (satır sonu/tire bozulmalarını düzelterek) bulur, kopyalanmaya hazır verir ve panoya alır. “Doğrula” düğmesi isteğe bağlıdır (yalnızca DOI Crossref'e gider).",
    ayarlar: [],
    async calistir({ metin }) {
      const doi = doiBul(metin);
      const url = [...metin.matchAll(/https?:\/\/[^\s"<>]+/g)].map((m) => m[0].replace(/[.,;)\]]+$/, "")).filter((u) => !/doi\.org\//i.test(u));
      if (!doi.length && !url.length) throw new Error("Seçili metinde DOI ya da adres bulunamadı. DOI “10.xxxx/…” biçimindedir; tüm satırı birlikte seç.");
      const duz = doi.length ? doi.join("\n") : url.join("\n");
      try { await navigator.clipboard.writeText(duz); } catch { /* pano izni yok */ }
      return {
        baslik: doi.length ? `DOI bulundu${doi.length > 1 ? ` (${doi.length})` : ""} — panoya kopyalandı` : "Adres bulundu — panoya kopyalandı",
        metin: duz, baglanti: doi.length ? `https://doi.org/${doi[0]}` : url[0],
        eylemler: doi.length ? [{ ad: "Doğrula (Crossref'e DOI gider)", calistir: () => crossrefDogrula(doi[0]) }, { ad: "doi.org adresi olarak kopyala", kopyala: doi.map((d) => `https://doi.org/${d}`).join("\n") }] : [],
      };
    },
  },
  akademik: { ad: "Google Akademik'te ara", simge: "🎓", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili metinle Google Akademik'i yeni sekmede açar (arama metni Google'a gider). Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://scholar.google.com/scholar?q=${encodeURIComponent(kisalt(metin, 300))}` },
  semantic: { ad: "Semantic Scholar'da ara", simge: "🧠", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili metinle Semantic Scholar'ı yeni sekmede açar. Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(kisalt(metin, 300))}` },
  vikipedi: { ad: "Vikipedi'de ara", simge: "🧭", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili terimi Vikipedi'de yeni sekmede arar (kâr amacı gütmeyen, açık kaynak). Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://tr.wikipedia.org/w/index.php?search=${encodeURIComponent(kisalt(metin, 100))}` },
  dergipark: { ad: "DergiPark'ta ara", simge: "📰", gizlilik: "baglanti", grup: "arama", varsayilanKapali: true, aciklama: "Seçili metinle DergiPark'ı yeni sekmede açar (Türkçe akademik dergiler).", ayarlar: [], baglanti: ({ metin }) => `https://dergipark.org.tr/tr/search?q=${encodeURIComponent(kisalt(metin, 200))}` },
  crossref: { ad: "Crossref'te ara", simge: "🔎", gizlilik: "baglanti", grup: "arama", varsayilanKapali: true, aciklama: "Seçili metinle Crossref arama sayfasını yeni sekmede açar (DOI/künye bulmak için).", ayarlar: [], baglanti: ({ metin }) => `https://search.crossref.org/?q=${encodeURIComponent(kisalt(metin, 250))}` },
  wiktionary: { ad: "Vikisözlük'te ara", simge: "📖", gizlilik: "baglanti", varsayilanKapali: true, aciklama: "Seçili kelimeyi Vikisözlük'te yeni sekmede arar. Tercihe bağlı.", ayarlar: [], baglanti: ({ metin }) => `https://tr.wiktionary.org/w/index.php?search=${encodeURIComponent(kisalt(metin, 60))}` },
});

export const VARSAYILAN_AYAR = Object.freeze({ v: 1, acik: ["ceviri", "istatistik", "temizle", "doi_cikar"], ayar: {}, ozel: [], aramalar: [] });

/* ------------------------------ ayar saklama (yerel + küçük bulut satırı) ------------------------------ */
function temizle(a) {
  const o = { v: 1, acik: [], ayar: {}, ozel: [], aramalar: [] };
  if (!a || typeof a !== "object") return { ...VARSAYILAN_AYAR, acik: [...VARSAYILAN_AYAR.acik] };
  const ozel = (Array.isArray(a.ozel) ? a.ozel : []).filter((x) => x && typeof x.id === "string" && ozelUrlGecerli(x.url)).slice(0, 10)
    .map((x) => ({ id: String(x.id).slice(0, 40), ad: kisalt(String(x.ad || "Arama"), 40), simge: kisalt(String(x.simge || "🔗"), 4), url: String(x.url).slice(0, 500) }));
  const gecerli = new Set([...Object.keys(KATALOG), ...ozel.map((x) => x.id)]);
  // Eski dış-bağlantılı çeviri eklentileri (Google/DeepL sekmede açılan) artık site içi "ceviri" eklentisine taşınır.
  const eskiCeviri = (Array.isArray(a.acik) ? a.acik : []).some((x) => x === "ceviri_google" || x === "ceviri_deepl");
  o.acik = [...new Set([...(eskiCeviri ? ["ceviri"] : []), ...(Array.isArray(a.acik) ? a.acik : [])])].filter((x) => gecerli.has(x)).slice(0, 30);
  // Kayıtlı aramalar (Zotero "Kayıtlı Aramalar"): ad + arama metni + filtreler + klasör; en fazla 30
  o.aramalar = (Array.isArray(a.aramalar) ? a.aramalar : []).filter((x) => x && typeof x.ad === "string").slice(-30)
    .map((x) => ({ ad: x.ad.slice(0, 60), ara: String(x.ara || "").slice(0, 200), klasor: typeof x.klasor === "string" ? x.klasor.slice(0, 40) : "", f: Object.fromEntries(Object.entries(x.f && typeof x.f === "object" ? x.f : {}).filter(([k, v]) => ["tur", "etiket", "yazar", "yilBas", "yilSon", "gorunurluk", "pdfli"].includes(k) && ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : v])) }));
  o.ozel = ozel;
  for (const [id, v] of Object.entries(a.ayar && typeof a.ayar === "object" ? a.ayar : {})) {
    if (!KATALOG[id]) continue;
    o.ayar[id] = {};
    for (const s of KATALOG[id].ayarlar) if (v && typeof v[s.anahtar] === "string" && s.secenekler[v[s.anahtar]]) o.ayar[id][s.anahtar] = v[s.anahtar];
  }
  return o;
}
/** Kullanıcı sitede "test" kelimesini aratıp çıkan adresi yapıştırır → {metin} yer tutucusuna çevrilir. */
export function aramaAdresiniCevir(adres) {
  const u = String(adres || "").trim();
  if (u.includes("{metin}")) return u;
  if (!/^https:\/\//i.test(u)) return null;
  const yeni = u.replace(/test/i, "{metin}");
  return yeni !== u ? yeni : null;
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
