/*
 * assets/js/donusturucu/sunucu-donustur.js — Sunum dönüştürmede "BİREBİR" mod (isteğe bağlı, KULLANICI ONAYLI).
 * Eski .ppt ikili biçimi tarayıcıda yalnızca düz metne indirilebilir; birebir sonuç (slayt, şekil, resim, yazı tipi, tablo) için dosya
 * belge-donusturucu-worker → ücretsiz sunucudaki (Render / Hugging Face Space) LibreOffice (açık kaynak) ile dönüştürülür.
 * GİZLİLİK: yalnızca kullanıcı kutuyu işaretlerse çalışır; dosya saklanmaz (Space'te işlem süresince geçici klasör, sonra silinir). Hesap günlük kotası vardır.
 */
import { supabase } from "../core/supabase-client.js";
import { sunucuTahminSn } from "./sunucu-matris.js";

export const BELGE_WORKER = "https://belge-donusturucu-worker.aeymena.workers.dev";
export { sunucuDestekler, sunucuHedefleri } from "./sunucu-matris.js";
const MAX = 55 * 1024 * 1024;

export async function sunucudaDonustur(dosya, hedef, { ilerle } = {}) {
  if (dosya.size > MAX) throw new Error("Dosya sunucu sınırını (55 MB) aşıyor.");
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token;
  if (!jwt) throw new Error("Oturum gerekli; yeniden giriş yap.");
  ilerle?.(0.15, "Sunucuya gönderiliyor (LibreOffice ile dönüştürülecek)…");
  let r;
  // Sunucu işi tek istekte biter; ilerleme çubuğu tahmini süreye göre yumuşakça ilerler (gerçek bitişte %80'e atlar).
  const t0 = Date.now(), tahmin = Math.max(sunucuTahminSn(dosya.size), 5);
  const tik = setInterval(() => { const g = (Date.now() - t0) / 1000; ilerle?.(0.15 + 0.62 * (1 - Math.exp(-g / tahmin)), g > tahmin * 1.6 ? "Sunucu hâlâ çalışıyor (uykudan uyanıyor ya da dosya karmaşık olabilir)…" : "Sunucuda dönüştürülüyor (LibreOffice)…"); }, 1000);
  try {
    r = await fetch(`${BELGE_WORKER}/donustur?hedef=${hedef}&ad=${encodeURIComponent(dosya.name)}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/octet-stream" }, body: dosya, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch { throw new Error("Dönüştürme sunucusuna ulaşılamadı (ücretsiz sunucu uykuda olabilir; 1 dk sonra tekrar dene)."); }
  finally { clearInterval(tik); }
  ilerle?.(0.8, "Sonuç indiriliyor…");
  if (!r.ok) {
    let m = ""; try { const j = await r.json(); m = j.hata || j.error || ""; } catch { /* gövde yok */ }
    throw new Error(m || `Sunucu hatası (${r.status}).`);
  }
  const blob = await r.blob();
  if (blob.size < 200) throw new Error("Sunucu boş sonuç döndürdü.");
  return blob;
}

/** Sunucudaki TÜM geçici belge klasörlerini hemen sildirir ("Belleği ve sunucuyu sıfırla"). Hata fırlatmaz → {ok, mesaj}. */
export async function sunucuyuTemizle() {
  try {
    const jwt = (await supabase.auth.getSession()).data?.session?.access_token;
    if (!jwt) return { ok: false, mesaj: "Oturum yok." };
    const r = await fetch(`${BELGE_WORKER}/temizle`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(50000) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, mesaj: `Sunucudaki geçici klasörler silindi (${j.silinen ?? 0}).` } : { ok: false, mesaj: j.hata || `Sunucu yanıtı ${r.status}.` };
  } catch { return { ok: false, mesaj: "Sunucuya ulaşılamadı (uykuda olabilir; uykudaki sunucuda belge tutulmaz)." }; }
}
