/**
 * hikaye.js — HavaStil v8 · "tek hikâye" katmanı (saf JS: DOM yok, ağ yok, AI yok; karar motoruna DOKUNMAZ).
 * Amaç: aynı meteorolojik gerçeği (PoP, model uyumu, yayılım, beklenen mm, CAPE, tür) kartlarda tekrar tekrar anlatmak yerine
 *   1) teknik terimlere halk dilinde karşılık + tek satırlık ipucu (TERIM),
 *   2) en üstte 4 temel sorunun cevabı: şemsiye · ıslanır mıyım · fırtına var mı · ne giymeli (hizliCevaplar),
 *   3) günün tek cümlelik özeti (gunHikayesi): "Yağmur olası ve yaygın, fakat fırtınalı değil.",
 *   4) CAPE ↔ yağış riski çelişki algısını gideren not (capeNotu),
 *   5) "kesinlik" izlenimi vermeyen model uyumu dili (uyumGoster),
 *   6) "Sahte alarm engelleyici" kuralının GÜN DÜZEYİNDE doğru anlatımı (cisentiFiltresiDurumu).
 * Hesaplar yagis-fizigi.js'ten gelir; burada yalnızca sözcük seçimi ve eşleme vardır.
 */
import { saatAnaliz, suMiktari, efektifSiddet, capeSeviye } from "./yagis-fizigi.js";

const n1 = (x) => (Math.round(Number(x) * 10) / 10).toFixed(1);

/** Teknik terim → halk dili. `ad` ekranda görünen ad; `teknik` parantez içinde/uzman ipucunda; `ipucu` tek cümlelik açıklama. */
export const TERIM = Object.freeze({
  cape: { ad: "Fırtına enerjisi", teknik: "CAPE", ipucu: "Havanın gök gürültülü fırtınaya ne kadar “yakıt” biriktirdiğini gösterir. Düşük olması yağmur olmayacağı demek değildir; yalnızca fırtına, dolu ve ani sağanak ihtimalinin düşük olduğunu söyler." },
  konvektif: { ad: "Ani sağanak", teknik: "konvektif yağış", ipucu: "Isınan havanın hızla yükselmesiyle oluşan, kısa süren, dar bir alana düşen sert yağmur." },
  genis: { ad: "Yaygın, düzenli yağmur", teknik: "geniş cephe yağışı", ipucu: "Cephe ya da alçak basınçla gelen, geniş alana yayılan ve saatlerce süren düzenli yağmur. Fırtına gerektirmez." },
  guven: { ad: "Model uyumu", teknik: "Güven", ipucu: "Farklı hava modellerinin (ana tahmin, ECMWF, ICON, GFS) o saatte yağış görme oranı. Yüksek olması “kesin yağar” demek değildir; modellerin aynı yönde baktığını gösterir." },
  kapsam: { ad: "Yayılım", teknik: "Kapsam", ipucu: "Yağış olursa bölgenin ne kadarına düşeceğinin tahmini. Düşükse yağmur yerel hücreler hâlinde gelir; bazı yerlere düşer, bazılarına düşmez." },
  efektif: { ad: "Beklenen yağış miktarı", teknik: "efektif yağış", ipucu: "Her saatin yağış ihtimali ile yağış miktarı çarpılıp toplanır: “ihtimalleri de hesaba katınca ortalama ne kadar su düşer?” sorusunun cevabı. Garanti edilen miktar değil, beklentidir." },
  pop: { ad: "Yağış ihtimali", teknik: "PoP", ipucu: "Seçili saatte ölçülebilir yağış görülme olasılığı." },
  cisenti: { ad: "Çisenti filtresi", teknik: "sahte alarm engelleyici", ipucu: "İhtimal yüksek ama düşen su çok az olan saatleri “zararsız çisenti” sayar; böylece gereksiz yere şemsiye/bot önerilmez. Yağmur olmayacağı anlamına gelmez." },
});

/** "Ad (Teknik)" biçimi: sade kullanıcıya ad, meraklıya teknik karşılık. */
export const terimTam = (k) => `${TERIM[k].ad} (${TERIM[k].teknik})`;

/** Model uyumu yüzdesini kesinlik hissi vermeden anlatır. %100 → "Modellerin tamamı aynı yönde" + açık uyarı. */
export function uyumGoster(g) {
  if (g == null) return { deger: "—", etiket: "Model verisi yok", uyari: "" };
  if (g >= 100) return { deger: "%100", etiket: "Modellerin tamamı yağış görüyor", uyari: "Modeller aynı fikirde ama bu bir tahmindir; yağışın tam saatini ve yerini garanti etmez." };
  if (g >= 75) return { deger: `%${g}`, etiket: "Modellerin büyük çoğunluğu yağış görüyor", uyari: "" };
  if (g >= 50) return { deger: `%${g}`, etiket: "Modellerin yarısından fazlası yağış görüyor", uyari: "" };
  if (g >= 25) return { deger: `%${g}`, etiket: "Modeller kararsız", uyari: "" };
  return { deger: `%${g}`, etiket: "Çok az model yağış görüyor", uyari: "" };
}

/** Yayılım yüzdesinin halk dili karşılığı. */
export function yayilimMetni(k) {
  if (k == null) return "—";
  if (k >= 80) return "yaygın (bölgenin neredeyse tamamı)";
  if (k >= 55) return "geniş alanlı";
  if (k >= 30) return "yer yer";
  return "dağınık, yerel";
}

/** CAPE düşük/yüksek ile yağış riskinin birlikte görünmesinin yarattığı "çelişki" algısını gideren not (yoksa null). */
export function capeNotu(pop, capeMax) {
  const p = Number(pop) || 0, c = Number(capeMax) || 0;
  if (p >= 50 && c < 500) return "Bu bir çelişki değil: yağmur yaygın bulutlardan gelir ve fırtına enerjisi gerektirmez. Fırtına enerjisinin düşük olması yalnızca gök gürültüsü, dolu ve ani sağanak ihtimalinin düşük olduğunu gösterir.";
  if (p < 30 && c >= 1000) return "Yağış ihtimali düşük görünse de atmosfer enerjili: yerel ve ani bir sağanak çıkabilir. İhtimal düşüktür ama gelirse sert gelir.";
  if (p >= 50 && c >= 1500) return "Hem yağış ihtimali hem fırtına enerjisi yüksek: sağanak, gök gürültüsü ve ani rüzgâr birlikte gelebilir.";
  return null;
}

/**
 * "Çisenti filtresi" (eski adıyla Sahte alarm engelleyici) GÜN düzeyinde nasıl okunmalı?
 * Kural saat saat çalışır; bir saat bile "ihtimal yüksek ama miktar küçük" olsa gün için "tetiklendi" yazmak, günün genelinde 5 mm yağış
 * beklenirken "sahte alarm" izlenimi veriyordu. Artık: günün genel seviyesi 1 (zararsız) ise "Gün genelinde devrede", daha yüksekse
 * "Yalnızca birkaç hafif saatte" denir ve günün yağış uyarısını DEĞİŞTİRMEDİĞİ açıkça yazılır. (Karar motoru aynıdır; yalnızca anlatım.)
 */
export function cisentiFiltresiDurumu(f) {
  const saatSayisi = (f.saatler || []).filter((s) => s.zararsiz).length;
  if (!f.kural1 || !saatSayisi) return { etkin: false, metin: "Gerekmedi: yağış ihtimali yüksek olup da miktarı çok küçük kalan saat yok.", saatSayisi: 0 };
  if (f.seviye <= 1) return { etkin: true, metin: `Gün genelinde devrede: ihtimal yüksek görünse de düşen su çok az (toplam ≈ ${n1(f.toplamMm)} mm). Zararsız çisenti sayıldı; şemsiye gerekmez.`, saatSayisi };
  return { etkin: false, metin: `Yalnızca ${saatSayisi} hafif saatte devreye girdi (ihtimal yüksek, miktar çok küçük). Günün genelinde yağış önemli olduğu için yağış uyarısı DEĞİŞMEDİ.`, saatSayisi, kismi: true };
}

/** Günün tek cümlelik hikâyesi + rozetleri. G: ui-uzman gün nesnesi ({tarih, saatler, fizik}). */
export function gunHikayesi(G) {
  const f = G.fizik, a = G.saatler.map(saatAnaliz);
  const zirve = a.reduce((m, x) => (x.pop > (m?.pop ?? -1) ? x : m), null);
  const pop = zirve?.pop ?? 0, kapsam = zirve?.kapsam, guven = zirve?.guven;
  const firtinali = f.firtina || f.surpriz || f.capeMax > 1500;
  const olasi = f.seviye >= 2 || pop >= 50;

  let ana;
  if (f.kar?.var) ana = `Kar yağışı var (≈ ${n1(f.kar.toplamCm)} cm taze kar).`;
  else if (f.seviye === 0 && pop < 30) ana = "Yağış beklenmiyor.";
  else if (f.seviye === 1) ana = "Hafif çisenti var ama zararsız.";
  else if (f.seviye === 3 || f.surpriz) ana = "Ani ve sert bir sağanak olası.";
  else {
    const yayil = kapsam == null ? "" : kapsam >= 70 ? " ve yaygın" : kapsam >= 35 ? " ve yer yer" : ", dağınık hücreler hâlinde";
    ana = `Yağmur ${pop >= 70 ? "olası" : "mümkün"}${yayil}.`;
  }
  let firtinaCumle;
  if (f.firtina && f.hamleMax > 40) firtinaCumle = `Rüzgâr sert (hamle ${f.hamleMax} km/s).`;
  else if (firtinali) firtinaCumle = "Fırtına enerjisi yüksek: gök gürültüsü ve dolu görülebilir.";
  else if (f.capeMax >= 500) firtinaCumle = "Gök gürültüsü ihtimali düşük ama sıfır değil.";
  else firtinaCumle = olasi || f.seviye >= 1 ? "Fırtınalı değil." : "";
  const sure = f.aralik ? `${f.aralik} arası` : "";
  const tur = { genis: "düzenli ve uzun süren", konvektif: "kısa ve ani", karma: "kesintili, arada sağanak hücreleriyle", cise: "ince ve hafif", kar: "kar", yok: "" }[f.tur] || "";
  const miktar = f.toplamMm >= 0.1 ? `Toplam ≈ ${n1(f.toplamMm)} mm · ${suMiktari(f.toplamMm)}${sure ? `, ${sure}` : ""}${tur ? `, ${tur} yağış` : ""}.` : "";
  const sd = efektifSiddet(f.beklenenMm);
  const cumle = firtinaCumle === "Fırtınalı değil." && olasi ? `${ana.replace(/\.$/, "")}, fakat fırtınalı değil.` : [ana, firtinaCumle].filter(Boolean).join(" ");
  const rozetler = [];
  rozetler.push({ ad: `Yağış ihtimali %${pop}`, sinif: pop >= 70 ? "s2" : pop >= 30 ? "s1" : "s0" });
  if (guven != null) rozetler.push({ ad: `Model uyumu ${uyumGoster(guven).deger}${zirve.tahmini ? "*" : ""}`, sinif: "" });
  if (kapsam != null) rozetler.push({ ad: `Yayılım %${kapsam}${zirve.tahmini ? "*" : ""}`, sinif: "" });
  if (f.toplamMm >= 0.1) rozetler.push({ ad: `Beklenen ${n1(f.beklenenMm)} mm · ${sd.ad}`, sinif: sd.sinif });
  rozetler.push({ ad: `Fırtına enerjisi: ${capeSeviye(f.capeMax).ad}`, sinif: capeSeviye(f.capeMax).sinif });
  return { cumle: cumle || "Sakin bir gün.", miktar, rozetler, not: capeNotu(pop, f.capeMax), uyari: guven != null ? uyumGoster(guven).uyari : "" };
}

/** Ana ekran: 4 temel sorunun kısa cevabı. d = HavaStil durum nesnesi (fizik, sonuc, tercih). */
export function hizliCevaplar(d) {
  const f = d.fizik, s = d.sonuc;
  if (!f || !s) return [];
  const cantaYok = d.tercih?.canta === "yok";
  let semsiye, semsiyeTon = "sakin";
  if (f.karZorunlu || f.kar?.var) { semsiye = "Hayır — kar/buz var; kar botu ve kapüşon"; semsiyeTon = "dikkat"; }
  else if (f.semsiyeYasak) { semsiye = "Açma — rüzgâr/fırtına var; kapüşonlu kabuk giy"; semsiyeTon = "tehlike"; }
  else if (f.seviye >= 2) { semsiye = cantaYok ? "Yağmurluk giy" : "Evet, yanına al"; semsiyeTon = "dikkat"; }
  else if (f.seviye === 1) { semsiye = "Gerekmez (hafif çisenti)"; }
  else semsiye = "Gerekmez";

  let islanir, islanirTon = "sakin";
  if (f.kar?.var) { islanir = "Kar yağıyor — nemli ve soğuk; su geçirmez giy"; islanirTon = "dikkat"; }
  else if (f.seviye >= 3) { islanir = "Evet — sağanak; korunaksız kalma"; islanirTon = "tehlike"; }
  else if (f.seviye === 2) { islanir = f.toplamMm >= 3 ? "Evet — korumasız kalırsan ıslanırsın" : "Büyük olasılıkla, hafifçe"; islanirTon = "dikkat"; }
  else if (f.seviye === 1) { islanir = "Çok az — çisenti zar zor ıslatır"; }
  else islanir = "Hayır — yağış beklenmiyor";

  let firtina, firtinaTon = "sakin";
  if (f.surpriz) { firtina = "Ani sağanak/dolu riski var (ihtimal düşük görünse de)"; firtinaTon = "tehlike"; }
  else if (f.hamleMax > 55 || f.capeMax >= 2500) { firtina = f.hamleMax > 55 ? `Evet — çok sert rüzgâr (hamle ${f.hamleMax} km/s)` : "Evet — güçlü fırtına enerjisi"; firtinaTon = "tehlike"; }
  else if (f.firtina) { firtina = f.hamleMax > 40 ? `Sert rüzgâr (hamle ${f.hamleMax} km/s)` : "Fırtına ihtimali var"; firtinaTon = "dikkat"; }
  else if (f.capeMax >= 1000) { firtina = "Düşük ihtimalle gök gürültüsü"; firtinaTon = "dikkat"; }
  else firtina = "Hayır — fırtına enerjisi düşük";

  const p = s.kombinler[Math.min(d.kombinNo || 0, s.kombinler.length - 1)].parcalar;
  const giyim = ["b", "m", "o", "p", "a"].map((x) => p[x]?.ad).filter(Boolean).slice(0, 4).join(" · ") || s.hukum || "—";
  return [
    { ikon: "☂️", soru: "Şemsiye almalı mıyım?", cevap: semsiye, ton: semsiyeTon },
    { ikon: "💧", soru: "Islanır mıyım?", cevap: islanir, ton: islanirTon },
    { ikon: "⛈️", soru: "Fırtına var mı?", cevap: firtina, ton: firtinaTon },
    { ikon: "🧥", soru: "Ne giymeliyim?", cevap: giyim, ton: "sakin" },
  ];
}
