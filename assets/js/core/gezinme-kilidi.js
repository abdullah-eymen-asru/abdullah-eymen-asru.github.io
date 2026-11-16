/*
 * assets/js/core/gezinme-kilidi.js — Panel sekmesinden AYRILMA KALKANI.
 * Bir modül (ör. Dönüştürücü) açık/kaydedilmemiş bir belge tuttuğunda, kullanıcı başka sekmeye geçmeden önce
 * `izinVarMi()` çağrılır; modül modal ile sorar. dashboard.js showView() bunu kullanır.
 * Aynı modül örneği (aynı URL) hem dashboard.js'te hem modüllerde olduğu için ortak durum güvenlidir.
 */
const kancalar = new Map(); // viewId -> async (hedefViewId) => boolean

export function ayrilmaKancasiKaydet(viewId, fn) {
  kancalar.set(viewId, fn);
  return () => { if (kancalar.get(viewId) === fn) kancalar.delete(viewId); };
}

/** true → geçişe izin; false → kullanıcı vazgeçti (geçiş iptal). Kanca hata verirse geçişi ENGELLEMEZ. */
export async function ayrilmayaIzinVarMi(nereden, nereye) {
  const f = kancalar.get(nereden);
  if (!f) return true;
  try { return (await f(nereye)) !== false; } catch (h) { console.warn("gezinme-kilidi:", h); return true; }
}

/* ------------------------------------------------------------------------------------------------
 * SEKME SIFIRLAMA KAYDI — bir araç sekmesinden (veya Çalışma Alanı alt sekmesinden) ayrılınca o aracın
 * seçili dosya/öğe durumunu (state), dosya girdilerini ve nesne URL'lerini otomatik temizler.
 * Neden: araçlar modül kapsamında durum tutar; sekme değişince eski seçim (dosya listesi, sayfa seçimi,
 * düzenleyici) kalıyor ve başka araçla birlikte bozulmaya yol açıyordu.
 *   sekmeSifirlamaKaydet("tool-pdfbol", () => { ... })   ← araç modülü, kendi temizliğini kaydeder
 *   sekmeSifirla("tool-pdfbol")                          ← dashboard.js, sekmeden çıkarken çağırır
 * Kayıtlı kanca yoksa da (veya hata verirse) genel yedek çalışır: sekmedeki tüm <input type="file">
 * değerleri boşaltılır ve "dash:sekme-sifirla" olayı yayınlanır.
 * ---------------------------------------------------------------------------------------------- */
const sifirlamaKancalari = new Map(); // viewId -> () => void

export function sekmeSifirlamaKaydet(viewId, fn) {
  sifirlamaKancalari.set(viewId, fn);
  return () => { if (sifirlamaKancalari.get(viewId) === fn) sifirlamaKancalari.delete(viewId); };
}

export function sekmeSifirla(viewId, kok = null) {
  try { sifirlamaKancalari.get(viewId)?.(); } catch (h) { console.warn("sekme-sifirla:", viewId, h); }
  try {
    const alan = kok || document.getElementById(`view-${viewId}`);
    alan?.querySelectorAll('input[type="file"]').forEach((i) => { try { i.value = ""; } catch { /* yok say */ } });
    window.dispatchEvent(new CustomEvent("dash:sekme-sifirla", { detail: { viewId } }));
  } catch { /* yok say */ }
}
