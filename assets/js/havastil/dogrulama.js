/**
 * dogrulama.js — HavaStil · RESMÎ ÖLÇÜM ↔ TAHMİN MODELİ DOĞRULAMASI (saf fonksiyonlar; DOM ve ağ yok, Node'da test edilebilir).
 * -----------------------------------------------------------------------------------------------------------------
 * Girdi : veri (veri.js ozetle() çıktısı — tahmin modeli), gozlem (hava-kaynak.js: MGM ya da havalimanı rasadı), ayar (yönetici ayarı).
 * Çıktı : veri.dogrulama — ekranda "Ölçüm doğrulaması" kartı, Bugün/Kombin satırı ve yapay zekâ veri paketi bunu okur.
 *
 * NE YAPAR
 *   1) KARŞILAŞTIRIR  sıcaklık · hissedilen · nem · rüzgâr · basınç: ölçüm − model farkı, eşiklerle "uyumlu / küçük fark / belirgin fark".
 *   2) GÜVEN PUANI    ölçümün konuma uzaklığı ve yaşı: yüksek / orta / düşük. Düşük güvenli ölçüm HİÇBİR ŞEYİ DEĞİŞTİRMEZ (yalnızca gösterilir).
 *   3) DÜZELTİR       (yönetici açtıysa) yakın saatlerin SICAKLIK ve HİSSEDİLEN değerini ölçüme doğru kaydırır: fark ≤ ±4°, güven "orta" ise yarısı,
 *                     etki saat geçtikçe doğrusal sönümlenir (varsayılan 3 saatte sıfır). Böylece kombin ve yağış motoru, sabah modelin 2° ılık gösterdiği
 *                     bir günde ölçülmüş gerçeği kullanır; ama tek bir istasyonun kusuru bütün gün tahmini bozamaz.
 *   4) YAĞIŞ KONTROLÜ ölçüm şu an yağış (≥ 0,2 mm) gösteriyor, model ise kuru/düşük olasılıklı diyorsa "ölçüm yağış görüyor" işaretlenir ve şu an için
 *                     yağış olasılığı en az %80'e çekilir (şemsiye kararı gerçeğe uysun). Tersi (model yağıyor diyor, ölçüm kuru) yalnızca not düşer.
 *   Rüzgâr, nem ve basınç YALNIZCA karşılaştırılır: yerel etkilere (bina, tepe, deniz) çok bağlıdırlar; bir istasyonun değeri tahmini değiştirmez.
 * Ham model değerleri (veri.ham → "Veri doğrulama" sekmesi) DEĞİŞTİRİLMEZ; düzeltme yalnızca motorun kullandığı alanlardadır ve ekranda açıkça yazar.
 */

const yuv = (x) => Math.round(x);
const sayiMi = (x) => typeof x === "number" && Number.isFinite(x);
const kisit = (x, a, b) => Math.max(a, Math.min(b, x));
const yerelMs = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN; };

/** Eşikler: [uyumlu üst sınırı, küçük fark üst sınırı] — bunun üstü "belirgin fark". */
export const ESIK = { sicaklik: [1, 2.5], hissedilen: [1.5, 3.5], nem: [8, 18], ruzgar: [6, 14], basinc: [1.5, 4] };
const AD = { sicaklik: "Sıcaklık", hissedilen: "Hissedilen sıcaklık", nem: "Nem", ruzgar: "Rüzgâr hızı", basinc: "Hava basıncı" };
const BIRIM = { sicaklik: "°C", hissedilen: "°C", nem: "%", ruzgar: "km/s", basinc: "hPa" };
const ONDALIK = { sicaklik: 1, hissedilen: 1, nem: 0, ruzgar: 0, basinc: 1 };

/** Güven: uzaklık ve yaş. MGM ilçe merkezi için 8/20 km, havalimanı için 12/30 km (havalimanları şehre göre farklı mikro-iklimdedir). */
export function guvenHesapla(gozlem, simdiMs = Date.now()) {
  if (!gozlem) return { duzey: "yok", puan: 0, neden: "Resmî ölçüm yok." };
  const yasDk = Math.max(0, Math.round((simdiMs - Date.parse(gozlem.zaman)) / 60000)), km = gozlem.mesafeKm;
  const [y, o] = gozlem.saglayici === "mgm" ? [8, 20] : [12, 30];
  let duzey = "yuksek", neden = "Ölçüm taze ve konumuna yakın.";
  if (!Number.isFinite(yasDk) || yasDk > 150) { duzey = "dusuk"; neden = "Ölçüm eski (2,5 saatten fazla)."; }
  else if (km != null && km > o) { duzey = "dusuk"; neden = `İstasyon ${String(km).replace(".", ",")} km uzakta; yerel farklar büyük olabilir.`; }
  else if (yasDk > 75) { duzey = "orta"; neden = "Ölçüm 75 dakikadan eski."; }
  else if (km != null && km > y) { duzey = "orta"; neden = `İstasyon ${String(km).replace(".", ",")} km uzakta.`; }
  return { duzey, puan: { yuksek: 1, orta: 0.6, dusuk: 0, yok: 0 }[duzey], yasDk, neden };
}

const durumOf = (id, fark) => { const [u, k] = ESIK[id], m = Math.abs(fark); return m < u ? "uyumlu" : m < k ? "kucuk" : "belirgin"; };
const DURUM_AD = { uyumlu: "Uyumlu", kucuk: "Küçük fark", belirgin: "Belirgin fark" };
export { DURUM_AD, AD as ALAN_AD, BIRIM as ALAN_BIRIM };

/** Karşılaştırma satırları (saf). model: { raw, apparent, hum, wind, basinc } (veri.js alanları). */
export function karsilastir(veri, g) {
  const model = { sicaklik: veri.raw, hissedilen: veri.apparent, nem: veri.hum, ruzgar: veri.wind, basinc: veri.basinc };
  const olcum = { sicaklik: g.sicaklik, hissedilen: g.hissedilen, nem: g.nem, ruzgar: g.ruzgar, basinc: g.basinc };
  const satirlar = [];
  for (const id of ["sicaklik", "hissedilen", "nem", "ruzgar", "basinc"]) {
    const o = olcum[id], m = model[id];
    if (!sayiMi(o) || !sayiMi(m)) continue;
    const k = 10 ** ONDALIK[id], fark = Math.round((o - m) * k) / k;
    satirlar.push({ id, ad: AD[id], birim: BIRIM[id], olcum: Math.round(o * k) / k, model: Math.round(m * k) / k, fark, durum: durumOf(id, fark) });
  }
  return satirlar;
}

/**
 * Ana giriş. veri'yi YERİNDE günceller (düzeltme açıksa) ve veri.dogrulama'yı yazar. gozlem yoksa hiçbir şey yapmaz.
 * ayar: { dogrulama_acik, duzeltme_acik, duzeltme_saat }.
 */
export function olcumleDogrula(veri, gozlem, ayar = {}, simdiMs = Date.now()) {
  if (!veri || !gozlem || ayar.dogrulama_acik === false) return null;
  const guven = guvenHesapla(gozlem, simdiMs), satirlar = karsilastir(veri, gozlem);
  const ozel = satirlar.filter((s) => s.id === "sicaklik" || s.id === "hissedilen");
  const kotu = satirlar.filter((s) => s.durum === "belirgin").length, kucuk = satirlar.filter((s) => s.durum === "kucuk").length;
  const genel = !satirlar.length ? { durum: "yok", yazi: "Karşılaştırılacak ortak değer yok." }
    : kotu ? { durum: "belirgin", yazi: `${kotu} değerde belirgin fark var; ölçüm tahminden ayrışıyor.` }
      : kucuk ? { durum: "kucuk", yazi: "Küçük farklar var; tahmin genel olarak ölçümle uyumlu." }
        : { durum: "uyumlu", yazi: "Tahmin, resmî ölçümle uyumlu." };

  // --- yağış kontrolü ---
  const modelSimdiYagis = Array.isArray(veri.saatListe) && veri.saatListe[0] ? veri.saatListe[0].yagis : null;
  const modelOlasi = Array.isArray(veri.saatListe) && veri.saatListe[0] ? veri.saatListe[0].yagisOlasi : null;
  const yagis = { olcumMm: sayiMi(gozlem.yagis) ? gozlem.yagis : null, durum: "bilinmiyor", yazi: "" };
  if (yagis.olcumMm != null) {
    if (yagis.olcumMm >= 0.2 && !(sayiMi(modelSimdiYagis) && modelSimdiYagis >= 0.1) && !(sayiMi(modelOlasi) && modelOlasi >= 50)) { yagis.durum = "olcumGoruyor"; yagis.yazi = "Ölçüm şu an yağış gösteriyor; tahmin modeli kuru görünüyordu."; }
    else if (yagis.olcumMm >= 0.2) { yagis.durum = "uyumluYagis"; yagis.yazi = "Ölçüm de modeli doğruluyor: şu an yağış var."; }
    else if (sayiMi(modelSimdiYagis) && modelSimdiYagis >= 0.3) { yagis.durum = "modelGoruyor"; yagis.yazi = "Model şu an yağış diyor ama istasyonda yağış ölçülmedi (yağış çok yerel olabilir)."; }
    else { yagis.durum = "kuru"; yagis.yazi = "Ölçüm ve model şu an kuru diyor."; }
  }

  // --- düzeltme ---
  const duzeltme = { uygulandi: false, saat: 0, sicaklik: 0, hissedilen: 0, oran: 0, neden: "" };
  const saatPenceresi = kisit(Math.round(Number(ayar.duzeltme_saat) || 3), 1, 6);
  if (ayar.duzeltme_acik === false) duzeltme.neden = "Ölçüme göre düzeltme yönetici tarafından kapatılmış.";
  else if (guven.duzey === "dusuk" || guven.duzey === "yok") duzeltme.neden = `Düzeltme yapılmadı: ${guven.neden}`;
  else {
    const t = satirlar.find((s) => s.id === "sicaklik"), a = satirlar.find((s) => s.id === "hissedilen");
    const dT = t && Math.abs(t.fark) >= 1 ? kisit(t.fark * guven.puan, -4, 4) : 0;
    const dA = a && Math.abs(a.fark) >= 1.5 ? kisit(a.fark * guven.puan, -4, 4) : dT;     // MGM hissedileni yoksa sıcaklık farkı kullanılır
    if (dT || dA) {
      duzeltme.uygulandi = true; duzeltme.saat = saatPenceresi; duzeltme.sicaklik = Math.round(dT * 10) / 10; duzeltme.hissedilen = Math.round(dA * 10) / 10; duzeltme.oran = guven.puan;
      duzeltme.once = { raw: veri.raw, apparent: veri.apparent };
      duzeltmeUygula(veri, dT, dA, saatPenceresi);
      duzeltme.neden = `Yakın saatlerin sıcaklığı ölçüme doğru ${duzeltme.sicaklik > 0 ? "+" : ""}${String(duzeltme.sicaklik).replace(".", ",")}° kaydırıldı; etki ${saatPenceresi} saatte sönümlenir.`;
    } else duzeltme.neden = "Ölçüm ve tahmin zaten uyumlu; düzeltme gerekmedi.";
  }
  if (yagis.durum === "olcumGoruyor" && ayar.duzeltme_acik !== false && guven.duzey !== "dusuk") {
    veri.rainProb = Math.max(veri.rainProb ?? 0, 80); veri.olcumYagis = true; duzeltme.yagis = true;
    if (Array.isArray(veri.segmentler) && veri.segmentler[0]?.ad === "Şimdi") veri.segmentler[0].rain = Math.max(veri.segmentler[0].rain ?? 0, 80);
  }
  void ozel;
  return (veri.dogrulama = { kaynak: gozlem.saglayici, ad: gozlem.ad, kod: gozlem.kod || null, mesafeKm: gozlem.mesafeKm ?? null, zaman: gozlem.zaman, guven, satirlar, genel, yagis, duzeltme });
}

/** Düzeltmeyi motorun kullandığı alanlara uygular (ham model verisi — veri.ham — dokunulmaz). */
function duzeltmeUygula(veri, dT, dA, N) {
  const simdi = yerelMs(`${String(veri.guncelleme || "").slice(0, 13)}:00`);
  const w = (iso) => { const h = (yerelMs(iso) - simdi) / 3600000; return Number.isFinite(h) && h >= 0 && h < N ? 1 - h / N : 0; };
  const kaydir = (liste) => { for (const o of liste || []) { const k = w(o.t); if (!k) continue; if (sayiMi(o.temp)) o.temp = yuv(o.temp + dT * k); if (sayiMi(o.app)) o.app = yuv(o.app + dA * k); } };
  kaydir(veri.saatListe); kaydir(veri.tumSaatler); kaydir(veri.yagisPencere);
  if (sayiMi(veri.raw)) veri.raw = yuv(veri.raw + dT);
  if (sayiMi(veri.apparent)) veri.apparent = yuv(veri.apparent + dA);
  if (Array.isArray(veri.segmentler) && veri.segmentler[0]?.ad === "Şimdi") { const s = veri.segmentler[0]; if (sayiMi(s.raw)) s.raw = yuv(s.raw + dT); if (sayiMi(s.app)) s.app = yuv(s.app + dA); }
  if (Array.isArray(veri.saatlik)) for (const s of veri.saatlik) { const h = s.saat - veri.saat; if (veri.gun === "bugün" && h >= 0 && h < N && sayiMi(s.app)) s.app = yuv(s.app + dA * (1 - h / N)); }
  if (sayiMi(veri.apparent)) { veri.minApp = Math.min(veri.minApp ?? veri.apparent, veri.apparent); veri.maxApp = Math.max(veri.maxApp ?? veri.apparent, veri.apparent); veri.delta = yuv(veri.maxApp - veri.minApp); }
  if (sayiMi(veri.raw)) { veri.minRaw = Math.min(veri.minRaw ?? veri.raw, veri.raw); veri.maxRaw = Math.max(veri.maxRaw ?? veri.raw, veri.raw); }
}

/** Yapay zekâ veri paketi için kısa özet (sayılar + sabit kelimeler; serbest metin yok). */
export function dogrulamaOzeti(dg) {
  if (!dg) return null;
  return {
    kaynak: dg.kaynak === "mgm" ? "Meteoroloji Genel Müdürlüğü (MGM) resmî ölçümü" : "havalimanı resmî rasadı (METAR)", istasyon: dg.ad, mesafe_km: dg.mesafeKm, yas_dk: dg.guven.yasDk, guven: dg.guven.duzey, genel: dg.genel.durum,
    farklar: dg.satirlar.map((s) => ({ alan: s.ad, olcum: s.olcum, model: s.model, fark: s.fark, birim: s.birim, durum: DURUM_AD[s.durum] })),
    yagis: dg.yagis.durum, duzeltme: dg.duzeltme.uygulandi ? { sicaklik: dg.duzeltme.sicaklik, hissedilen: dg.duzeltme.hissedilen, saat: dg.duzeltme.saat } : null,
  };
}
