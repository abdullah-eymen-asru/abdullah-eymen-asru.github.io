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
