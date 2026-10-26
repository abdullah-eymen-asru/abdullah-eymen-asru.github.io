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

/* ------------------------------ ağ yardımcısı ------------------------------ */
async function getJson(url) {
  const k = new AbortController(); const z = setTimeout(() => k.abort(), ZAMAN_ASIMI);
  try {
    const r = await fetch(url, { signal: k.signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } });
    if (!r.ok) { const e = new Error(`Servis ${r.status} döndürdü.`); e.durum = r.status; throw e; }
    return await r.json();
  } catch (h) {
    if (h.name === "AbortError") throw new Error("Servis zamanında yanıt vermedi.");
    if (h.durum) throw h;
    throw new Error("Servise ulaşılamadı (ağ ya da tarayıcı engeli).");
  } finally { clearTimeout(z); }
}
const kisalt = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/* ------------------------------ eklentiler ------------------------------ */
async function cihazCeviri(metin, kaynak, hedef) {
  if (!("Translator" in self)) return null;
  let src = kaynak;
  if (src === "auto" && "LanguageDetector" in self) {
    try { const det = await self.LanguageDetector.create(); src = (await det.detect(metin))?.[0]?.detectedLanguage || "en"; } catch { src = "en"; }
  }
  if (src === "auto") src = "en";
  if (src === hedef) return { metin, yontem: "Kaynak ve hedef dil aynı" };
  const durum = await self.Translator.availability({ sourceLanguage: src, targetLanguage: hedef });
  if (durum === "unavailable") return null;
  const tr = await self.Translator.create({ sourceLanguage: src, targetLanguage: hedef });
  return { metin: await tr.translate(metin), yontem: `Cihaz içi (${src}→${hedef})` };
}
async function bulutCeviri(metin, kaynak, hedef) {
  // MyMemory: ücretsiz, anahtarsız (günlük anonim sınır var). İstek başına ≈500 bayt → cümle cümle parçala.
  const parcalar = []; let sira = "";
  for (const c of metin.replace(/\s+/g, " ").split(/(?<=[.!?;:])\s+/)) {
    if ((sira + " " + c).length > 420 && sira) { parcalar.push(sira); sira = c; } else sira = sira ? `${sira} ${c}` : c;
  }
  if (sira) parcalar.push(sira);
  const cikti = [];
  for (const p of parcalar.slice(0, 6)) {
    const j = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p.slice(0, 450))}&langpair=${encodeURIComponent(`${kaynak === "auto" ? "Autodetect" : kaynak}|${hedef}`)}`);
    const t = j?.responseData?.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error(/WARNING/i.test(t || "") ? "Ücretsiz çeviri servisinin günlük sınırı doldu. Yarın tekrar dene ya da Ayarlar'dan cihaz-içi çeviriyi aç." : "Çeviri alınamadı.");
    cikti.push(t);
  }
  return { metin: cikti.join(" ") + (parcalar.length > 6 ? " …(uzun seçim: ilk bölüm çevrildi)" : ""), yontem: "İnternet servisi (MyMemory)" };
}

export const KATALOG = Object.freeze({
  ceviri: {
    ad: "Çeviri", simge: "🌐", aciklama: "Seçili metni istediğin dile çevirir. Varsayılan: ücretsiz internet servisi (hiçbir şey depolanmaz).",
    ayarlar: [
      { anahtar: "hedef", etiket: "Hedef dil", tur: "secim", secenekler: DILLER, varsayilan: "tr" },
      { anahtar: "kaynak", etiket: "Kaynak dil", tur: "secim", secenekler: { auto: "Otomatik algıla", ...DILLER }, varsayilan: "auto" },
      { anahtar: "yontem", etiket: "Yöntem", tur: "secim", secenekler: { bulut: "İnternet servisi (önerilen · depolama kullanmaz)", cihaz: "Cihaz içi (Chrome · dil paketi indirir, tarayıcı depolamasını kullanır)" }, varsayilan: "bulut" },
    ],
    async calistir({ metin, ayar }) {
      const hedef = ayar.hedef || "tr", kaynak = ayar.kaynak || "auto";
      if (ayar.yontem === "cihaz") {
        const c = await cihazCeviri(metin, kaynak, hedef).catch(() => null);
        if (c) return { baslik: "Çeviri", metin: c.metin, not: c.yontem };
      }
      const b = await bulutCeviri(metin, kaynak, hedef);
      return { baslik: "Çeviri", metin: b.metin, not: ayar.yontem === "cihaz" ? `${b.yontem} · bu tarayıcıda cihaz-içi çeviri yok` : b.yontem };
    },
  },
  sozluk: {
    ad: "Sözlük (İngilizce)", simge: "📖", aciklama: "Seçili İngilizce kelimenin anlamlarını ve okunuşunu gösterir (dictionaryapi.dev).",
    ayarlar: [],
    async calistir({ metin }) {
      const kelime = metin.trim().split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "").toLowerCase();
      if (!kelime) throw new Error("Bir kelime seç.");
      let j; try { j = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(kelime)}`); } catch (h) { if (h.durum === 404) throw new Error(`“${kelime}” İngilizce sözlükte bulunamadı.`); throw h; }
      const e = j[0]; const satirlar = [];
      for (const m of (e.meanings || []).slice(0, 3)) for (const d of (m.definitions || []).slice(0, 2)) satirlar.push(`(${m.partOfSpeech}) ${d.definition}`);
      return { baslik: `${e.word}${e.phonetic ? `  ${e.phonetic}` : ""}`, metin: satirlar.join("\n") || "Tanım bulunamadı." };
    },
  },
  vikipedi: {
    ad: "Vikipedi özeti", simge: "🧭", aciklama: "Seçili terimin Vikipedi özetini getirir.",
    ayarlar: [{ anahtar: "dil", etiket: "Vikipedi dili", tur: "secim", secenekler: { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca" }, varsayilan: "tr" }],
    async calistir({ metin, ayar }) {
      const dil = ayar.dil || "tr", q = kisalt(metin.replace(/\s+/g, " ").trim(), 80);
      const ara = await getJson(`https://${dil}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=1`);
      const s = ara?.pages?.[0]; if (!s) throw new Error("Vikipedi'de eşleşen madde yok.");
      const o = await getJson(`https://${dil}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s.key)}`);
      return { baslik: o.title || s.title, metin: o.extract || "Özet yok.", baglanti: o.content_urls?.desktop?.page };
    },
  },
  crossref: {
    ad: "Künye bul (Crossref)", simge: "🔎", aciklama: "Seçili kaynakça satırından/başlıktan DOI ve künye bulur (Crossref).",
    ayarlar: [],
    async calistir({ metin }) {
      const j = await getJson(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(kisalt(metin.replace(/\s+/g, " ").trim(), 300))}&rows=3&select=DOI,title,author,issued,container-title`);
      const o = j?.message?.items || []; if (!o.length) throw new Error("Eşleşen kayıt bulunamadı.");
      return { baslik: "Olası eşleşmeler", metin: o.map((x) => `• ${(x.title || ["(başlıksız)"])[0]}\n  ${(x.author || []).slice(0, 3).map((a) => a.family).filter(Boolean).join(", ")} · ${x["issued"]?.["date-parts"]?.[0]?.[0] || "t.y."} · ${(x["container-title"] || [""])[0]}\n  DOI: ${x.DOI}`).join("\n\n"), baglanti: `https://doi.org/${o[0].DOI}` };
    },
  },
  akademik: { ad: "Google Akademik'te ara", simge: "🎓", aciklama: "Seçili metni Google Akademik'te yeni sekmede arar.", ayarlar: [], baglanti: "https://scholar.google.com/scholar?q={metin}" },
  semantic: { ad: "Semantic Scholar'da ara", simge: "🧠", aciklama: "Seçili metni Semantic Scholar'da arar.", ayarlar: [], baglanti: "https://www.semanticscholar.org/search?q={metin}" },
});

export const VARSAYILAN_AYAR = Object.freeze({ v: 1, acik: ["ceviri", "sozluk"], ayar: {}, ozel: [] });

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
  if (kat?.baglanti) return { baslik: kat.ad, ac: kat.baglanti.replace("{metin}", encodeURIComponent(kisalt(temiz, 300))) };
  if (kat?.calistir) return kat.calistir({ metin: temiz.slice(0, 2000), ayar: a.ayar[id] || {} });
  const o = a.ozel.find((x) => x.id === id);
  if (o) return { baslik: o.ad, ac: o.url.replace(/\{metin\}/g, encodeURIComponent(kisalt(temiz, 300))) };
  throw new Error("Bu eklenti bulunamadı.");
}
