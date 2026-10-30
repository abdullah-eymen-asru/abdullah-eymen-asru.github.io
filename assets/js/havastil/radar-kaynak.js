/* radar-kaynak.js — Radar gözlem kaynağı tercihi (RainViewer-uyumlu sunucu). Anahtar/gizli veri TUTMAZ; yalnızca bu cihazdaki https adres. */
import { lsOku, lsYaz } from "./ui-temel.js";

const ANAHTAR = "hv_radar_kaynak_v1";
export const VARSAYILAN_RADAR = "https://api.rainviewer.com";

/** Adres doğrulama: yalnızca https, kullanıcı bilgisi/sorgu/parça yok, localhost/özel ağ yok (SSRF/yanlış yapılandırma koruması). */
export function radarAdresiDogrula(ham) {
  let u; try { u = new URL(String(ham || "").trim()); } catch { throw new Error("Geçerli bir adres yaz (örn. https://radar.ornek.com)."); }
  if (u.protocol !== "https:") throw new Error("Yalnızca https:// adresleri kabul edilir.");
  if (u.username || u.password) throw new Error("Adreste kullanıcı adı/şifre olamaz.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(u.hostname) || /\.local$/i.test(u.hostname)) throw new Error("Yerel/özel ağ adresleri kullanılamaz.");
  return u.origin;                                                              // yol/sorgu atılır; sondaki / yok
}
export function radarKaynakOku() {
  const k = lsOku(ANAHTAR, null);
  if (k?.kaynak === "kendi" && k.adres) { try { return { kaynak: "kendi", adres: radarAdresiDogrula(k.adres) }; } catch { /* bozuk kayıt → varsayılan */ } }
  return { kaynak: "otomatik", adres: VARSAYILAN_RADAR };
}
export function radarKaynakYaz(kaynak, adres) {
  if (kaynak === "kendi") lsYaz(ANAHTAR, { kaynak: "kendi", adres: radarAdresiDogrula(adres) });
  else lsYaz(ANAHTAR, { kaynak: "otomatik" });
}
