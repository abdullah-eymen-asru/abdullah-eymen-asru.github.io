/*
 * assets/js/donusturucu/sunucu-donustur.js — Sunum dönüştürmede "BİREBİR" mod (isteğe bağlı, KULLANICI ONAYLI).
 * Eski .ppt ikili biçimi tarayıcıda yalnızca düz metne indirilebilir; birebir sonuç (slayt, şekil, resim, yazı tipi, tablo) için dosya
 * belge-donusturucu-worker → ücretsiz Hugging Face Space'teki LibreOffice (açık kaynak) ile dönüştürülür.
 * GİZLİLİK: yalnızca kullanıcı kutuyu işaretlerse çalışır; dosya saklanmaz (Space'te işlem süresince geçici klasör, sonra silinir). Hesap günlük kotası vardır.
 */
import { supabase } from "../core/supabase-client.js";

export const BELGE_WORKER = "https://belge-donusturucu-worker.aeymena.workers.dev";
export const SUNUCU_DESTEKLI = new Set(["ppt", "pptx"]);          // kaynak türleri
export const SUNUCU_HEDEFLER = new Set(["pptx", "pdf"]);           // doğrudan hedefler
const MAX = 55 * 1024 * 1024;

export async function sunucudaDonustur(dosya, hedef, { ilerle } = {}) {
  if (dosya.size > MAX) throw new Error("Dosya sunucu sınırını (55 MB) aşıyor.");
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token;
  if (!jwt) throw new Error("Oturum gerekli; yeniden giriş yap.");
  ilerle?.(0.15, "Sunucuya gönderiliyor (LibreOffice ile dönüştürülecek)…");
  let r;
  try {
    r = await fetch(`${BELGE_WORKER}/donustur?hedef=${hedef}&ad=${encodeURIComponent(dosya.name)}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/octet-stream" }, body: dosya });
  } catch { throw new Error("Dönüştürme sunucusuna ulaşılamadı."); }
  ilerle?.(0.8, "Sonuç indiriliyor…");
  if (!r.ok) {
    let m = ""; try { const j = await r.json(); m = j.hata || j.error || ""; } catch { /* gövde yok */ }
    throw new Error(m || `Sunucu hatası (${r.status}).`);
  }
  const blob = await r.blob();
  if (blob.size < 200) throw new Error("Sunucu boş sonuç döndürdü.");
  return blob;
}
