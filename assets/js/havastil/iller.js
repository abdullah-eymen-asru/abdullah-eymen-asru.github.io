/**
 * iller.js — 81 il (yaklaşık merkez koordinatı + coğrafi bölge) ve il/bölge adı eşleştirme yardımcıları. Ağ yok, saf JS.
 * GİZLİLİK: GPS koordinatından il bulma TARAYICIDA, en yakın il merkezi ile yapılır (üçüncü tarafa ters-geokodlama isteği YOK).
 * Sınır: büyük illerde (Konya, Sivas…) il sınırına yakın noktalar komşu ile karışabilir → arayüzde il elle değiştirilebilir.
 */
export const BOLGELER = {
  marmara: { ad: "Marmara", desen: /(^|[^a-z0-9])(marmara|trakya)([^a-z0-9]|$)/ },
  ege: { ad: "Ege", desen: /(^|[^a-z0-9])ege( bolgesi| bolgesinde| kiyilari| kiyi seridi)?([^a-z0-9]|$)/ },
  akdeniz: { ad: "Akdeniz", desen: /(^|[^a-z0-9])akdeniz( bolgesi| bolgesinde| kiyilari)?([^a-z0-9]|$)/ },
  ic_anadolu: { ad: "İç Anadolu", desen: /(^|[^a-z0-9])ic anadolu([^a-z0-9]|$)/ },
  karadeniz: { ad: "Karadeniz", desen: /(^|[^a-z0-9])karadeniz([^a-z0-9]|$)/ },
  dogu_anadolu: { ad: "Doğu Anadolu", desen: /(^|[^a-z0-9])dogu anadolu([^a-z0-9]|$)/ },
  guneydogu: { ad: "Güneydoğu Anadolu", desen: /(^|[^a-z0-9])(guneydogu anadolu|guneydogu)([^a-z0-9]|$)/ },
};

/** [ad, bölge anahtarı, enlem, boylam, takma adlar (normalize), belirsiz?]  belirsiz = gündelik dilde başka anlamı olan ad */
const HAM = [
  ["Balıkesir","marmara",39.65,27.88],["Bilecik","marmara",40.14,29.98],["Bursa","marmara",40.19,29.06],["Çanakkale","marmara",40.15,26.41],
  ["Edirne","marmara",41.68,26.56],["İstanbul","marmara",41.01,28.98],["Kırklareli","marmara",41.73,27.22],["Kocaeli","marmara",40.77,29.94],
  ["Sakarya","marmara",40.78,30.40],["Tekirdağ","marmara",40.98,27.51],["Yalova","marmara",40.65,29.27],
  ["Afyonkarahisar","ege",38.76,30.54,["afyon"]],["Aydın","ege",37.85,27.84,[],true],["Denizli","ege",37.78,29.09],["İzmir","ege",38.42,27.14],
  ["Kütahya","ege",39.42,29.98],["Manisa","ege",38.61,27.43],["Muğla","ege",37.22,28.36],["Uşak","ege",38.68,29.41],
  ["Adana","akdeniz",37.00,35.32],["Antalya","akdeniz",36.90,30.70],["Burdur","akdeniz",37.72,30.29],["Hatay","akdeniz",36.20,36.16],
  ["Isparta","akdeniz",37.76,30.55],["Kahramanmaraş","akdeniz",37.58,36.94,["maras"]],["Mersin","akdeniz",36.81,34.64],["Osmaniye","akdeniz",37.07,36.25],
  ["Aksaray","ic_anadolu",38.37,34.03],["Ankara","ic_anadolu",39.93,32.86],["Çankırı","ic_anadolu",40.60,33.62],["Eskişehir","ic_anadolu",39.78,30.52],
  ["Karaman","ic_anadolu",37.18,33.23],["Kayseri","ic_anadolu",38.72,35.49],["Kırıkkale","ic_anadolu",39.85,33.52],["Kırşehir","ic_anadolu",39.15,34.17],
  ["Konya","ic_anadolu",37.87,32.48],["Nevşehir","ic_anadolu",38.62,34.71],["Niğde","ic_anadolu",37.97,34.68],["Sivas","ic_anadolu",39.75,37.02],["Yozgat","ic_anadolu",39.82,34.80],
  ["Amasya","karadeniz",40.65,35.83],["Artvin","karadeniz",41.18,41.82],["Bartın","karadeniz",41.64,32.34],["Bayburt","karadeniz",40.26,40.23],
  ["Bolu","karadeniz",40.74,31.61],["Çorum","karadeniz",40.55,34.95],["Düzce","karadeniz",40.84,31.16],["Giresun","karadeniz",40.91,38.39],
  ["Gümüşhane","karadeniz",40.46,39.48],["Karabük","karadeniz",41.20,32.62],["Kastamonu","karadeniz",41.38,33.78],["Ordu","karadeniz",40.98,37.88,[],true],
  ["Rize","karadeniz",41.02,40.52],["Samsun","karadeniz",41.29,36.33],["Sinop","karadeniz",42.03,35.15],["Tokat","karadeniz",40.31,36.55],
  ["Trabzon","karadeniz",41.00,39.72],["Zonguldak","karadeniz",41.46,31.80],
  ["Ağrı","dogu_anadolu",39.72,43.05],["Ardahan","dogu_anadolu",41.11,42.70],["Bingöl","dogu_anadolu",38.88,40.50],["Bitlis","dogu_anadolu",38.40,42.11],
  ["Elazığ","dogu_anadolu",38.67,39.22],["Erzincan","dogu_anadolu",39.75,39.49],["Erzurum","dogu_anadolu",39.90,41.27],["Hakkari","dogu_anadolu",37.58,43.74],
  ["Iğdır","dogu_anadolu",39.92,44.04],["Kars","dogu_anadolu",40.60,43.10],["Malatya","dogu_anadolu",38.35,38.31],["Muş","dogu_anadolu",38.75,41.51],
  ["Tunceli","dogu_anadolu",39.11,39.55],["Van","dogu_anadolu",38.49,43.38,[],true],
  ["Adıyaman","guneydogu",37.76,38.28],["Batman","guneydogu",37.88,41.13,[],true],["Diyarbakır","guneydogu",37.91,40.24],["Gaziantep","guneydogu",37.07,37.38,["antep"]],
  ["Kilis","guneydogu",36.72,37.12],["Mardin","guneydogu",37.31,40.74],["Siirt","guneydogu",37.93,41.94],["Şanlıurfa","guneydogu",37.16,38.79,["urfa"]],["Şırnak","guneydogu",37.52,42.46],
];

/** Türkçe normalize: küçük harf + aksan/ünlü katlama (ı→i, ğ→g, ü→u, ş→s, ö→o, ç→c, â→a…). Eşleştirme için. */
export function normalize(s) {
  return String(s ?? "")
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/[ıîï]/g, "i").replace(/[ğ]/g, "g").replace(/[üûù]/g, "u").replace(/[ş]/g, "s").replace(/[öô]/g, "o").replace(/[çć]/g, "c").replace(/[â]/g, "a")
    .replace(/[’‘`´]/g, "'");
}

export const ILLER = HAM.map(([ad, bolge, lat, lon, takma = [], belirsiz = false]) => ({ ad, bolge, lat, lon, takma, belirsiz, anahtar: normalize(ad) }));
export const IL_ADLARI = ILLER.map((i) => i.ad).sort((a, b) => a.localeCompare(b, "tr"));

const kmArasi = (a1, o1, a2, o2) => {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** Koordinattan en yakın il merkezi. Türkiye dışındaysa (en yakın merkez > 220 km) null. */
export function enYakinIl(lat, lon) {
  let en = null, mesafe = Infinity;
  for (const il of ILLER) { const m = kmArasi(lat, lon, il.lat, il.lon); if (m < mesafe) { mesafe = m; en = il; } }
  return mesafe <= 220 ? en : null;
}

/** Serbest metinden (admin1, görünen ad…) il bul: tam ad ya da takma ad. */
export function ilAdindan(metin) {
  const t = normalize(metin).replace(/ ili$| province$/, "").trim();
  if (!t) return null;
  return ILLER.find((i) => i.anahtar === t || i.takma.includes(t) || t === normalize(i.ad.replace(/ı/g, "i"))) || null;
}

/** Virgüllü adres metninde (Nominatim display_name) geçen ilk ili bul. */
export function ilAdresten(adres) {
  for (const parca of String(adres || "").split(",")) { const i = ilAdindan(parca); if (i) return i; }
  return null;
}

/** Ad (ya da il nesnesi) → il nesnesi */
export const ilBul = (ad) => ILLER.find((i) => i.ad === ad) || ilAdindan(ad);

/**
 * Normalize edilmiş metin il adını ya da bölgesini anıyor mu? (Başlık/özet için)
 * Ek alan kuralı: Türkçe ekler apostrofla gelir ("İstanbul'da"); apostrofsuz ekler (≤5 harf) uzun adlarda (≥5) kabul edilir.
 * Belirsiz adlar (Ordu, Van, Aydın, Batman): yalnızca apostroflu ek ya da "ili/ilinde/ilimiz/merkez" ile kabul → "Ordu'da"/"Van ilinde" evet, "Van Gölü"/"ordu komutanı" hayır.
 */
export function ilAniliyor(normMetin, il) {
  const adlar = [il.anahtar, ...il.takma];
  for (const ad of adlar) {
    const kacis = ad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let desen;
    if (il.belirsiz) desen = new RegExp(`(^|[^a-z0-9])${kacis}('[a-z]+| (ili|ilinde|ilimiz|merkez|merkezli|valiligi)([^a-z0-9]|$))`);
    else if (ad.length >= 5) desen = new RegExp(`(^|[^a-z0-9])${kacis}([a-z]{0,5}|'[a-z]+)([^a-z0-9]|$)`);
    else desen = new RegExp(`(^|[^a-z0-9])${kacis}('[a-z]+|[^a-z0-9]|$)`);
    if (desen.test(normMetin)) return true;
  }
  return false;
}
export function bolgeAniliyor(normMetin, il) { return BOLGELER[il.bolge].desen.test(normMetin); }


/** Yazılan metne göre il önerileri (İNTERNETSİZ): önce baştan eşleşenler ("ank" → Ankara), sonra içinde geçenler. Yanlış yere düşmeyi önler. */
export function yerelIlAra(q, en = 6) {
  const t = normalize(q).trim();
  if (t.length < 2) return [];
  const bas = [], ic = [];
  for (const il of ILLER) {
    const adlar = [il.anahtar, ...il.takma];
    if (adlar.some((a) => a.startsWith(t))) bas.push(il);
    else if (t.length >= 3 && adlar.some((a) => a.includes(t))) ic.push(il);
  }
  return [...bas, ...ic].slice(0, en);
}
