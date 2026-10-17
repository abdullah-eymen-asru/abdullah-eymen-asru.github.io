/**
 * hava-kodlari.js — Saf yardımcılar: WMO hava durumu kodu → Türkçe metin/ikon, rüzgâr yönü, UV/AQI seviyeleri, ay evresi, saat/tarih biçimleri.
 * DOM ve ağ yok; arayüz ve motor ortak kullanır.
 */
const GUNDUZ = {
  0: ["Açık", "☀️"], 1: ["Çoğunlukla açık", "🌤️"], 2: ["Parçalı bulutlu", "⛅"], 3: ["Kapalı", "☁️"], 45: ["Sisli", "🌫️"], 48: ["Kırağılı sis", "🌫️"],
  51: ["Hafif çise", "🌦️"], 53: ["Çise", "🌦️"], 55: ["Yoğun çise", "🌧️"], 56: ["Dondurucu çise", "🌧️"], 57: ["Yoğun dondurucu çise", "🌧️"],
  61: ["Hafif yağmur", "🌦️"], 63: ["Yağmur", "🌧️"], 65: ["Kuvvetli yağmur", "🌧️"], 66: ["Dondurucu yağmur", "🌧️"], 67: ["Kuvvetli dondurucu yağmur", "🌧️"],
  71: ["Hafif kar", "🌨️"], 73: ["Kar", "🌨️"], 75: ["Yoğun kar", "❄️"], 77: ["Kar taneleri", "❄️"],
  80: ["Hafif sağanak", "🌦️"], 81: ["Sağanak", "🌧️"], 82: ["Şiddetli sağanak", "⛈️"], 85: ["Kar sağanağı", "🌨️"], 86: ["Yoğun kar sağanağı", "❄️"],
  95: ["Gök gürültülü fırtına", "⛈️"], 96: ["Hafif dolulu fırtına", "⛈️"], 99: ["Dolulu fırtına", "⛈️"],
};
export function havaKodu(kod, gunduz = true) {
  const g = GUNDUZ[kod] || ["—", "🌡️"];
  const ikon = !gunduz && (kod === 0 || kod === 1) ? "🌙" : !gunduz && kod === 2 ? "☁️" : g[1];
  return { ad: g[0], ikon };
}
export const yagmurluKod = (kod) => [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(kod);

const YONLER = ["K", "KKD", "KD", "DKD", "D", "DGD", "GD", "GGD", "G", "GGB", "GB", "BGB", "B", "BKB", "KB", "KKB"];
export const ruzgarYonu = (derece) => (Number.isFinite(derece) ? YONLER[Math.round(((derece % 360) + 360) % 360 / 22.5) % 16] : "—");
/** Rüzgârın ESTİĞİ yön (derece) → ok işaretinin döneceği açı (ok, rüzgârın gittiği yönü gösterir). */
export const ruzgarOkAcisi = (derece) => Math.round(((derece + 180) % 360 + 360) % 360);

export function uvSeviye(uv) {
  if (uv < 3) return { ad: "Düşük", sinif: "d1", oneri: "Koruma gerekmez." };
  if (uv < 6) return { ad: "Orta", sinif: "d2", oneri: "Gölgeyi ve güneş gözlüğünü düşün." };
  if (uv < 8) return { ad: "Yüksek", sinif: "d3", oneri: "SPF 30+, şapka ve gözlük." };
  if (uv < 11) return { ad: "Çok yüksek", sinif: "d4", oneri: "SPF 50, 10–16 arası gölge." };
  return { ad: "Aşırı", sinif: "d5", oneri: "Mümkünse dışarıda kalma." };
}
/** Avrupa Hava Kalitesi İndeksi (EAQI) bantları */
export function aqiSeviye(aqi) {
  if (!Number.isFinite(aqi)) return { ad: "—", sinif: "d0", oneri: "" };
  if (aqi <= 20) return { ad: "Çok iyi", sinif: "d1", oneri: "Her aktivite uygun." };
  if (aqi <= 40) return { ad: "İyi", sinif: "d1", oneri: "Sorun yok." };
  if (aqi <= 60) return { ad: "Orta", sinif: "d2", oneri: "Hassas kişiler yoğun efordan kaçınsın." };
  if (aqi <= 80) return { ad: "Kötü", sinif: "d3", oneri: "Dışarıda uzun egzersizi azalt; maske düşün." };
  if (aqi <= 100) return { ad: "Çok kötü", sinif: "d4", oneri: "Mümkünse dışarıda kalma süresini kısalt; maske tak." };
  return { ad: "Aşırı kötü", sinif: "d5", oneri: "Dışarı çıkmaktan kaçın; maske şart." };
}
export function gorusSeviye(m) {
  if (!Number.isFinite(m)) return "—";
  return m >= 10000 ? `${Math.round(m / 1000)} km (çok iyi)` : m >= 4000 ? `${(m / 1000).toFixed(1)} km (iyi)` : m >= 1000 ? `${(m / 1000).toFixed(1)} km (zayıf)` : `${Math.round(m)} m (sis)`;
}
export const nemSeviye = (n) => (n >= 85 ? "Çok nemli" : n >= 65 ? "Nemli" : n >= 35 ? "Konforlu" : "Kuru");
export function cigNoktasiKonfor(c) { return c >= 21 ? "Bunaltıcı" : c >= 16 ? "Nemli, yapışkan" : c >= 10 ? "Konforlu" : c >= 0 ? "Kuru, rahat" : "Çok kuru"; }

/** Ay evresi (0=yeni ay … 0.5=dolunay). Conway yaklaşımı; ±1 gün doğruluk. */
export function ayEvresi(tarih = new Date()) {
  const sinodik = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  let f = ((tarih.getTime() - ref) / 864e5 / sinodik) % 1;
  if (f < 0) f += 1;
  const adlar = ["Yeni ay", "Hilal (büyüyen)", "İlk dördün", "Şişkin ay (büyüyen)", "Dolunay", "Şişkin ay (küçülen)", "Son dördün", "Hilal (küçülen)"];
  const ikonlar = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  const i = Math.round(f * 8) % 8;
  return { oran: f, ad: adlar[i], ikon: ikonlar[i], aydinlik: Math.round((1 - Math.cos(2 * Math.PI * f)) / 2 * 100) };
}

export const saatMetni = (iso) => String(iso || "").slice(11, 16);
export const gunAdi = (tarihStr) => {
  const [y, a, g] = String(tarihStr).slice(0, 10).split("-").map(Number);
  return ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"][new Date(Date.UTC(y, a - 1, g)).getUTCDay()];
};
export const kisaGun = (tarihStr) => gunAdi(tarihStr).slice(0, 3);
export function sureMetni(saniye) { const s = Math.round(saniye / 60); return `${Math.floor(s / 60)} sa ${s % 60} dk`; }
