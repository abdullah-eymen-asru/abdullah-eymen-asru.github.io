/**
 * assets/js/havastil/cekirdek.js — HavaStil DETERMİNİSTİK KARAR MOTORU (saf JS, DOM yok, ağ yok, AI yok).
 * -----------------------------------------------------------------------------------------------------------
 * Girdi: hava özeti (bkz. veri.js → ozetle). Çıktı: katmanlar, CLO, ayakkabı, renk, aksesuar, tek cümlelik hüküm.
 * Aynı girdi HER ZAMAN aynı çıktıyı verir; sunucu/AI faturası riski yoktur. AI (Groq) yalnızca sonradan eklenen
 * "stilist dokunuşu"dur ve bu motorun kararını ASLA değiştirmez.
 *
 * FORMÜL (şartname § 2.F):
 *   Hedef CLO = (33 − T_etkin) / 15 − Aktivite Katsayısı        T_etkin = T_hissedilen + Kişisel Tolerans (°C)
 *   Kişisel tolerans: Çabuk üşürüm = −3 °C (daha soğuk hisseder → daha kalın giyer), Normal = 0, Çabuk terlerim = +3 °C.
 *   (Prototipte işaret ters uygulanıyordu: "üşürüm" seçen kişiye daha İNCE kıyafet öneriliyordu. Düzeltildi.)
 *
 * KATMAN KODLARI: b_* (çekirdek), m_* (modüler/orta), o_* (kabuk). Aynı kodlar sunucudaki sözlükte
 * (cloudflare worker/havastil_worker/worker.js → KOD_ETIKET) vardır; Worker serbest metin değil YALNIZCA kod kabul eder.
 */

export const SENARYOLAR = {
  toplu:        { ad: "🚶 Yaya / Toplu taşıma",     aktivite: 0.15, ipucu: "Kısa yürüyüşler, dur-kalk." },
  yuruyus_ofis: { ad: "🏢 Yürüyüş + sıcak ofis",    aktivite: 0.10, ipucu: "≈40 dk yürüyüş, ardından 21–23 °C ofis." },
  disari:       { ad: "🌳 Gün boyu dışarıda",       aktivite: 0.10, ipucu: "Sabah–akşam farkı için çıkarılabilir katman." },
  arac:         { ad: "🚗 Araç / kapıdan kapıya",   aktivite: 0.25, ipucu: "Isıtmalı araç, kısa mesafe." },
};
export const TOLERANSLAR = { "-3": "❄️ Çabuk üşürüm", "0": "⚖️ Normal", "3": "🔥 Çabuk terlerim" };

export const KATMAN = {
  b_hafif:       { ad: "Hafif keten / bol kesim tişört",                 kumas: "Keten veya saf pamuk (nem tutar → terde dikkat)" },
  b_klasik:      { ad: "Pamuklu tişört veya ince gömlek",                kumas: "Nefes alan poplin / penye pamuk" },
  b_uzunkol:     { ad: "Uzun kollu pamuk / penye üst",                   kumas: "Modal veya pamuk penye" },
  b_termal:      { ad: "Termal içlik veya merino fanila",                kumas: "Merino yün / teknik termal (nem taşır, terletmez)" },
  b_ofis_hafif:  { ad: "Nefes alan pamuk/keten gömlek veya tişört",      kumas: "Pamuk / keten — 21–23 °C ofis çekirdeği" },
  b_ofis_uzun:   { ad: "İnce pamuk uzun kollu veya gömlek",              kumas: "İnce pamuk / modal — ofis çekirdeği" },
  m_yok:         { ad: "Orta katmana gerek yok",                          kumas: "—" },
  m_cikarilabilir:{ ad: "İnce fermuarlı hırka veya polar (çıkarılabilir)", kumas: "İki iplik penye / hafif yün — öğlen çantaya" },
  m_ince_ofis:   { ad: "İnce, kolay çıkan hırka (opsiyonel)",             kumas: "İnce penye — kalın yün YOK" },
  m_orta:        { ad: "Orta kalınlıkta hırka veya polar",                kumas: "Polar / orta örgü" },
  m_kalin:       { ad: "Kalın triko veya yün kazak",                      kumas: "Kalın örgü yün / kaşmir" },
  o_yok:         { ad: "Dış kabuğa gerek yok",                            kumas: "—" },
  o_ruzgarlik:   { ad: "Katlanabilir rüzgarlık",                          kumas: "Su/rüzgâr itici teknik naylon" },
  o_hafif_kabuk: { ad: "Hafif teknik kabuk ceket",                        kumas: "Rüzgâr kesici, nefes alan membran" },
  o_yagmurluk:   { ad: "Su geçirmez, nefes alan yağmurluk",               kumas: "Membranlı (dikişleri bantlı) kumaş" },
  o_orta:        { ad: "Trençkot, bomber veya deri ceket",                kumas: "Su itici gabardin / deri" },
  o_teknik_dolgulu:{ ad: "Nefes alan dolgulu teknik mont",                kumas: "Rüzgâr geçirmez teknik kabuk + ince dolgu (ofiste çıkar)" },
  o_kalin:       { ad: "Kalın kaban veya dolgulu şişme mont",             kumas: "Rüzgâr geçirmez kapitone / yün kaban" },
};

const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));
const yuvarla = (x) => Math.round(x);

/** Hedef CLO. Tek kaynak: hem çekirdek hem arayüz rozeti bunu kullanır. */
export function hedefClo(hissedilen, tolerans, senaryo) {
  const s = SENARYOLAR[senaryo] || SENARYOLAR.toplu;
  const etkin = hissedilen + (Number(tolerans) || 0);
  return { clo: sinirla((33 - etkin) / 15 - s.aktivite, 0.3, 2.5), etkin };
}

/**
 * @param {object} h  { apparent, raw, wind, uv, rainProb, delta, minApp, maxApp, minRaw, recentPrecip, ... }
 * @param {{tolerans:number, senaryo:string}} t
 */
export function degerlendir(h, t) {
  const senaryo = SENARYOLAR[t.senaryo] ? t.senaryo : "toplu";
  const tol = Number(t.tolerans) || 0;
  const { clo, etkin } = hedefClo(h.apparent, tol, senaryo);
  const ofis = senaryo === "yuruyus_ofis";
  const yagisli = h.rainProb >= 40;
  const ruzgarli = h.wind >= 28;
  // Gün içi fark kişisel toleransla aynı yönde kayar (üşüyen kişi için sabah/akşam daha sert)
  const moduler = h.delta >= 8 && senaryo !== "arac";

  /* ---- 1) ÇEKİRDEK ---- */
  let b;
  if (ofis) b = clo >= 1.15 ? "b_ofis_uzun" : "b_ofis_hafif";
  else if (clo < 0.55) b = "b_hafif";
  else if (clo < 0.85) b = "b_klasik";
  else if (clo < 1.45) b = "b_uzunkol";
  else b = "b_termal";

  /* ---- 2) MODÜLER / ORTA ---- */
  let m;
  if (ofis) {
    // Kabuk & Çekirdek: kalın tek parça yün kazak ofiste bunaltır → bu senaryoda YASAK; yalnız ince/çıkarılabilir.
    m = clo >= 0.85 || moduler ? "m_ince_ofis" : "m_yok";
  } else if (moduler && clo < 1.6) m = "m_cikarilabilir"; // gün içi fark ≥ 8 °C: orta katman her zaman ÇIKARILABİLİR olmalı
  else if (clo < 0.7) m = "m_yok";
  else if (clo < 1.0) m = "m_cikarilabilir";
  else if (clo < 1.6) m = "m_orta";
  else m = "m_kalin";

  /* ---- 3) KABUK ---- */
  let o;
  if (clo >= 1.35) o = ofis ? "o_teknik_dolgulu" : moduler && clo < 1.7 ? "o_orta" : "o_kalin"; // modüler günde öğlen taşınacak kabuk ağır kaban olmasın
  else if (clo >= 1.05) o = ofis ? "o_hafif_kabuk" : "o_orta";
  else if (clo >= 0.75) o = yagisli ? "o_yagmurluk" : ofis || ruzgarli || moduler ? "o_hafif_kabuk" : "o_ruzgarlik";
  else if (clo >= 0.55 && (yagisli || ruzgarli)) o = yagisli ? "o_yagmurluk" : "o_ruzgarlik";
  else if (moduler && etkin < 16) o = "o_ruzgarlik"; // sabah ayazı / akşam serinliği için hafif kabuk
  else o = "o_yok";
  // Yağışta kalın kabuk da su geçirmez olmalı: kabuk türü korunur, kumaş notu eklenir (aşağıda)
  const kabukSuGecirmez = yagisli && !["o_yok", "o_yagmurluk"].includes(o);

  /* ---- AYAKKABI / ZEMİN (gerçek sıcaklığa bakar, kişisel toleransa DEĞİL) ---- */
  let ayakkabi;
  if (h.minRaw <= 1) {
    ayakkabi = "Gizli buzlanma riski var: kauçuk, tırtıklı/kaymaz tabanlı bot veya ayakkabı giy.";
  } else if (h.recentPrecip >= 1 || yagisli) {
    ayakkabi = "Zemin ıslak olabilir: süet/bez ayakkabıdan kaçın; su itici deri veya kauçuk tabanlı model seç.";
  } else {
    ayakkabi = "Zemin kuru görünüyor: rahat sneaker veya loafer uygun.";
  }

  /* ---- RENK / GÜVENLİK ---- */
  let renk;
  if (h.uv >= 6 || etkin > 24) renk = "Yüksek UV/sıcak: güneşi yansıtan açık tonlar (beyaz, bej, açık gri).";
  else if (yagisli || h.sis || ruzgarli) renk = "Yağış/sis/rüzgârda trafikte fark edilmek için en az bir kontrast veya canlı renkli dış parça seç.";
  else if (etkin < 8 && h.uv > 1) renk = "Soğukta güneşten ısı toplayan koyu tonlar (lacivert, antrasit, siyah) işe yarar.";
  else renk = "Hava dengeli: renk tercihi serbest.";

  /* ---- AKSESUAR ---- */
  const aks = [];
  if (yagisli) aks.push("🌂 Katlanır şemsiye");
  if (ruzgarli) aks.push("🧣 Boğazı koruyan ince atkı");
  if (etkin < 6) aks.push("🧤 Eldiven", "🧢 Bere");
  if (h.uv >= 6) aks.push("🕶️ UV korumalı gözlük", "🧴 Güneş kremi");
  if (moduler) aks.push("🎒 Çıkarılan katman için çanta");

  /* ---- HÜKÜM (3 saniye kuralı) ---- */
  let hukum;
  if (h.minRaw <= 1) hukum = "Buzlanma riski: kalın giyin ve kaymaz tabanlı ayakkabı seçin.";
  else if (ofis && clo >= 0.55) hukum = "Kabuk & çekirdek: ofiste rahat bir alt kat, yürüyüşte koruyan teknik bir dış kat giyin.";
  else if (moduler) hukum = `Gün içinde ${h.delta}°C fark var: çıkarılabilir fermuarlı bir orta katmanla çıkın.`;
  else if (yagisli) hukum = h.modelFarki
    ? "Hava modelleri yağışta ayrışıyor: riskten kaçınıp şemsiye ve su itici ayakkabı alın."
    : "Yağış ihtimali var: şemsiye ve su itici ayakkabı hazırlayın.";
  else if (clo >= 1.35) hukum = "Soğuk: kalın giyinin, dış katmanı sıkı tutun.";
  else if (clo >= 0.95) hukum = "Serin: orta katman ve ceketle çıkın.";
  else if (clo < 0.55) hukum = "Sıcak/ılık: hafif ve açık renk giyinin, su içmeyi unutmayın.";
  else hukum = "Dengeli bir gün: hafif katmanlarla rahat çıkabilirsiniz.";

  const al = (k) => ({ kod: k, ...KATMAN[k] });
  const dis = al(o);
  if (kabukSuGecirmez) dis.kumas += " · yağış için su geçirmez/itici olmalı";

  return {
    clo: Math.round(clo * 100) / 100,
    etkinSicaklik: yuvarla(etkin),
    senaryo, moduler, yagisli, ruzgarli,
    katmanlar: { cekirdek: al(b), orta: al(m), kabuk: dis },
    kodlar: { b, m, o },
    ayakkabi, renk, aksesuar: aks, hukum,
    gorunenKatmanMetni: [KATMAN[b].ad, m !== "m_yok" ? KATMAN[m].ad : null, o !== "o_yok" ? KATMAN[o].ad : null].filter(Boolean).join(" + "),
  };
}
