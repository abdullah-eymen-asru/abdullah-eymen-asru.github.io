/**
 * katalog.js — HavaStil giysi KATALOĞU (tek doğruluk kaynağı). Saf veri, ağ/DOM yok.
 * Her satır: [id, ad, slot, clo, etiketler, stiller, kumaş]
 *   slot : b = çekirdek (iç kat) · m = modüler/orta kat · o = dış kabuk · p = alt giyim · a = ayakkabı
 *   clo  : tek parçanın yalıtım değeri (ISO 9920 mertebesinde yaklaşık değerler; toplam hesabı cekirdek.js'te)
 *   etiket: n=nefes alır · t=nem taşır/hızlı kurur · r=rüzgâr geçirmez · s=su itici · g=su geçirmez · p=kolay çıkar/çantaya girer ·
 *           a=ağır/kalın (sıcak ofis çekirdeğinde yasak) · y=yün · o=ofis/klasik ortamla uyumlu · u=UV'ye karşı kapalı/koruyucu ·
 *           h=katlanır/hafif · k=kaymaz taban · x=ıslakta uygunsuz (süet/bez)
 *   stil : K=klasik · S=sportif · C=sokak/günlük · M=minimalist · D=dış mekân/teknik
 * Worker'daki yapay zekâ sözlüğü bu dosyadan ÜRETİLİR: `node "cloudflare worker/havastil_worker/katalog-esitle.mjs"`.
 */
const SATIRLAR = [
  // ---- b: çekirdek ----
  ["b_ince_tisort", "İnce pamuklu tişört", "b", 0.09, "n", "SCM", "Pamuk"],
  ["b_keten_tisort", "Keten karışımlı tişört", "b", 0.10, "no", "CM", "Keten/pamuk"],
  ["b_teknik_tisort", "Teknik hızlı kuruyan tişört", "b", 0.09, "nt", "SD", "Polyester/elastan"],
  ["b_polo", "Polo yaka tişört", "b", 0.14, "no", "KC", "Pikê pamuk"],
  ["b_keten_gomlek_kisa", "Kısa kollu keten gömlek", "b", 0.12, "no", "KC", "Keten"],
  ["b_pamuk_gomlek", "Uzun kollu ince pamuk gömlek", "b", 0.22, "nou", "K", "Poplin pamuk"],
  ["b_oxford", "Oxford gömlek", "b", 0.25, "no", "K", "Oxford pamuk"],
  ["b_penye_uzun", "Uzun kollu penye üst", "b", 0.20, "no", "MC", "Penye pamuk/modal"],
  ["b_henley", "Henley (düğmeli basic) uzun kollu", "b", 0.22, "n", "C", "Pamuk"],
  ["b_teknik_uzun", "Teknik uzun kollu iç kat", "b", 0.22, "nt", "SD", "Teknik sentetik"],
  ["b_merino_ince", "İnce merino uzun kollu", "b", 0.28, "nty" + "o", "MDK", "Merino yün"],
  ["b_termal_ic", "Termal iç giyim (üst)", "b", 0.32, "t", "SD", "Termal sentetik"],
  ["b_merino_orta", "Orta ağırlık merino iç kat", "b", 0.38, "ty", "D", "Merino yün"],
  // ---- m: modüler / orta ----
  ["m_ince_hirka", "İnce fermuarlı hırka", "m", 0.20, "po", "KMC", "İnce penye/yün"],
  ["m_yelek_ince", "İnce dolgulu yelek", "m", 0.22, "ph", "SCD", "Naylon + ince dolgu"],
  ["m_polar_ince", "İnce polar", "m", 0.25, "pt", "SD", "Polar"],
  ["m_merino_kazak", "İnce merino kazak", "m", 0.28, "yon", "KM", "Merino yün"],
  ["m_softshell", "Softshell ara kat", "m", 0.30, "prst", "SD", "Softshell"],
  ["m_kasmir", "Kaşmir karışımlı kazak", "m", 0.34, "yo", "K", "Kaşmir/yün"],
  ["m_sweatshirt", "Pamuklu sweatshirt", "m", 0.32, "", "SC", "Pamuk"],
  ["m_dolgulu_yelek", "Dolgulu yelek (kalın)", "m", 0.32, "phr", "SD", "Naylon + dolgu"],
  ["m_kazak_orta", "Orta örgü kazak", "m", 0.36, "y", "KC", "Yün karışımı"],
  ["m_polar_orta", "Orta kalınlıkta polar", "m", 0.38, "pt", "SD", "Polar"],
  ["m_hoodie_fermuarli", "Fermuarlı kapüşonlu üst", "m", 0.40, "p", "SC", "Pamuk/polyester"],
  ["m_kalin_kazak", "Kalın yün kazak", "m", 0.50, "ya", "KC", "Kalın yün"],
  ["m_polar_kalin", "Kalın polar", "m", 0.50, "pta", "D", "Kalın polar"],
  // ---- o: dış kabuk ----
  ["o_ruzgarlik", "Katlanabilir rüzgarlık", "o", 0.12, "rsht", "SD", "Naylon (su/rüzgâr itici)"],
  ["o_yagmurluk_ince", "Hafif su geçirmez yağmurluk", "o", 0.15, "grh", "SD", "Membranlı naylon"],
  ["o_yagmurluk", "Nefes alan membranlı yağmurluk", "o", 0.20, "grn", "D", "Membran (dikişleri bantlı)"],
  ["o_hafif_kabuk", "Hafif teknik kabuk ceket", "o", 0.22, "rsn", "MD", "Teknik kabuk"],
  ["o_blazer", "İnce blazer ceket", "o", 0.26, "o", "K", "Yün/pamuk karışımı"],
  ["o_softshell_ceket", "Softshell ceket", "o", 0.28, "rsn", "SD", "Softshell"],
  ["o_denim_ceket", "Kot ceket", "o", 0.28, "", "C", "Denim"],
  ["o_bomber", "Bomber ceket", "o", 0.30, "r", "C", "Naylon/pamuk"],
  ["o_trenckot", "Trençkot", "o", 0.32, "so", "K", "Su itici gabardin"],
  ["o_deri", "Deri ceket", "o", 0.34, "ro", "CK", "Deri"],
  ["o_teknik_dolgulu_ince", "İnce dolgulu teknik mont", "o", 0.45, "rsho", "SD", "Teknik kabuk + ince dolgu"],
  ["o_kaban", "Yün kaban", "o", 0.55, "yo", "K", "Yün"],
  ["o_mont", "Orta kalınlıkta mont", "o", 0.55, "rs", "C", "Naylon + dolgu"],
  ["o_parka_hafif", "Hafif parka", "o", 0.60, "rs", "C", "Naylon + dolgu"],
  ["o_sisme", "Şişme mont", "o", 0.75, "rs", "CD", "Kapitone naylon"],
  ["o_parka", "Kalın parka", "o", 0.85, "rsg", "D", "Su geçirmez kabuk + kalın dolgu"],
  ["o_kayak", "Kar montu (membran + dolgu)", "o", 0.90, "grs", "D", "Membran + yalıtım"],
  // ---- p: alt giyim ----
  ["p_sort", "Şort", "p", 0.06, "n", "SC", "Pamuk/teknik"],
  ["p_bermuda", "Bermuda", "p", 0.09, "n", "C", "Pamuk/keten"],
  ["p_keten_pantolon", "Keten pantolon", "p", 0.14, "no", "KM", "Keten"],
  ["p_chino_ince", "İnce chino pantolon", "p", 0.18, "no", "KM", "İnce pamuk"],
  ["p_teknik", "Teknik hızlı kuruyan pantolon", "p", 0.20, "nts", "SD", "Teknik sentetik"],
  ["p_chino", "Chino pantolon", "p", 0.22, "o", "KMC", "Pamuk twill"],
  ["p_kumas", "Kumaş pantolon", "p", 0.24, "o", "K", "Polyviskon/yün"],
  ["p_jogger", "Jogger / eşofman altı", "p", 0.24, "t", "SC", "Pamuk/polyester"],
  ["p_su_itici", "Su itici teknik pantolon", "p", 0.24, "rs", "D", "Teknik kabuk"],
  ["p_kot", "Kot pantolon", "p", 0.26, "", "C", "Denim"],
  ["p_yun_pantolon", "Yün karışımlı pantolon", "p", 0.32, "yo", "K", "Yün karışımı"],
  ["p_kalin_kot", "Kalın kot / kadife pantolon", "p", 0.34, "", "C", "Kalın denim/kadife"],
  ["p_termal_alt", "Termal alt + pantolon", "p", 0.42, "t", "D", "Termal sentetik + pantolon"],
  ["p_kar", "Yalıtımlı kar pantolonu", "p", 0.55, "grs", "D", "Membran + yalıtım"],
  // ---- a: ayakkabı ----
  ["a_sandalet", "Sandalet / açık ayakkabı", "a", 0.02, "n", "C", "Açık model"],
  ["a_sneaker_bez", "Bez sneaker", "a", 0.04, "nx", "CM", "Bez/kanvas"],
  ["a_sueded", "Süet ayakkabı", "a", 0.05, "x", "KC", "Süet"],
  ["a_loafer", "Loafer / klasik deri ayakkabı", "a", 0.05, "ox", "K", "Deri"],
  ["a_kosu", "Yürüyüş/koşu ayakkabısı (file)", "a", 0.05, "nt", "S", "Mesh"],
  ["a_sneaker_deri", "Su itici deri sneaker", "a", 0.06, "s", "CM", "Su itici deri"],
  ["a_chelsea", "Su itici Chelsea bot", "a", 0.10, "so", "K", "Su itici deri"],
  ["a_kosu_su_gecirmez", "Su geçirmez yürüyüş ayakkabısı", "a", 0.10, "gk", "SD", "Membranlı"],
  ["a_yagmur_cizme", "Yağmur çizmesi", "a", 0.10, "gk", "C", "Kauçuk"],
  ["a_bot_deri", "Deri bot (kauçuk taban)", "a", 0.12, "sko", "K", "Deri + kauçuk taban"],
  ["a_bot_kaucuk", "Derin kauçuk dişli kaymaz bot", "a", 0.14, "gsk", "D", "Kauçuk dişli taban"],
  ["a_kis_botu", "Yalıtımlı kışlık bot", "a", 0.22, "gsk", "D", "Membran + yalıtım"],
  ["a_kar_botu", "Kar botu (yalıtımlı, kaymaz)", "a", 0.30, "gk", "D", "Membran + yalıtım"],
];

export const SLOTLAR = { b: "Çekirdek", m: "Modüler katman", o: "Koruyucu kabuk", p: "Alt giyim", a: "Ayakkabı" };
export const STILLER = { K: "Klasik", S: "Sportif", C: "Sokak / günlük", M: "Minimalist", D: "Dış mekân / teknik" };

export const KATALOG = Object.fromEntries(SATIRLAR.map(([id, ad, slot, clo, et, stil, kumas]) => [id, {
  id, ad, slot, clo, kumas, etiket: new Set(et.split("")), stil: new Set(stil.split("")),
}]));
export const SLOT_LISTE = (slot) => Object.values(KATALOG).filter((x) => x.slot === slot);
export const IDLER = Object.keys(KATALOG);
/** Worker eşitleme için: id → ad */
export const ETIKET_SOZLUGU = Object.fromEntries(Object.values(KATALOG).map((x) => [x.id, x.ad]));

/**
 * Parçanın MANTIKLI olduğu etkin sıcaklık aralığı [en düşük, en yüksek] °C. Aralığın dışına çıktıkça puan düşer (cekirdek.js);
 * çok uzaktaki parçalar adaylardan elenir. Böylece "12 °C'de kar pantolonu" gibi saçma kombinler çıkmaz.
 */
export const ARALIK = {
  b_ince_tisort: [14, 99], b_keten_tisort: [18, 99], b_teknik_tisort: [12, 99], b_polo: [16, 99], b_keten_gomlek_kisa: [20, 99], b_pamuk_gomlek: [8, 99],
  b_oxford: [6, 28], b_penye_uzun: [4, 26], b_henley: [4, 24], b_teknik_uzun: [-99, 26], b_merino_ince: [-99, 17], b_termal_ic: [-99, 8], b_merino_orta: [-99, 6],
  m_ince_hirka: [10, 24], m_yelek_ince: [8, 22], m_polar_ince: [6, 20], m_merino_kazak: [4, 20], m_softshell: [4, 16], m_kasmir: [2, 18], m_sweatshirt: [6, 19],
  m_dolgulu_yelek: [-4, 12], m_kazak_orta: [-2, 14], m_polar_orta: [-4, 12], m_hoodie_fermuarli: [4, 18], m_kalin_kazak: [-99, 6], m_polar_kalin: [-99, 5],
  o_ruzgarlik: [10, 26], o_yagmurluk_ince: [8, 26], o_yagmurluk: [4, 24], o_hafif_kabuk: [10, 20], o_blazer: [12, 24], o_softshell_ceket: [6, 18], o_denim_ceket: [12, 22],
  o_bomber: [8, 18], o_trenckot: [6, 20], o_deri: [8, 20], o_teknik_dolgulu_ince: [-2, 12], o_kaban: [-6, 10], o_mont: [-4, 8], o_parka_hafif: [-4, 10],
  o_sisme: [-12, 6], o_parka: [-99, 6], o_kayak: [-99, -1],
  p_sort: [22, 99], p_bermuda: [19, 99], p_keten_pantolon: [18, 99], p_chino_ince: [14, 30], p_teknik: [8, 99], p_chino: [8, 24], p_kumas: [4, 24], p_jogger: [6, 22],
  p_su_itici: [2, 20], p_kot: [4, 26], p_yun_pantolon: [-4, 14], p_kalin_kot: [-6, 8], p_termal_alt: [-99, 3], p_kar: [-99, -2],
  a_sandalet: [22, 99], a_sneaker_bez: [12, 99], a_sueded: [10, 26], a_loafer: [10, 30], a_kosu: [10, 99], a_sneaker_deri: [5, 99], a_chelsea: [-2, 18],
  a_kosu_su_gecirmez: [2, 25], a_yagmur_cizme: [-2, 22], a_bot_deri: [-6, 14], a_bot_kaucuk: [-99, 8], a_kis_botu: [-99, 4], a_kar_botu: [-99, 0],
};
/** Yalnızca belirli koşulda önerilebilen özel parçalar: (k = kısıtlar, etkin) → true/false */
export const OZEL = {
  o_kayak: (k) => k.kar,
  p_kar: (k) => k.kar,
  a_kar_botu: (k) => k.kar || k.buz,
  a_kis_botu: (k, e) => k.kar || k.buz || e <= 4,
  a_bot_kaucuk: (k, e) => k.buz || k.yagis >= 2 || e <= 2,
  a_yagmur_cizme: (k) => k.yagis >= 2,
  o_parka: (k, e) => e <= 6 || k.kar,
};
