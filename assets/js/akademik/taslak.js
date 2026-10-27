/*
 * assets/js/akademik/taslak.js — ÇEVRİMDIŞI/ELEKTRİK KESİNTİSİNE DAYANIKLI "taslak kutusu" (IndexedDB).
 * Okuyucuda her değişiklik ÖNCE bu cihazdaki kalıcı depoya (taslak) yazılır, SONRA veritabanına gönderilir; veritabanı onayı gelince taslak silinir.
 * İnternet ya da elektrik giderse taslak kalır: okuyucu bir sonraki açılışta taslağı geri yükler; ayrıca kütüphane açılınca / internet gelince
 * (online olayı) bekleyen taslaklar okuyucu açılmadan da veritabanına gönderilir. IndexedDB yazımı işlem onayından sonra kalıcıdır.
 * Taslak yalnızca açıklama özetidir (küçük JSON); PDF dosyası burada tutulmaz → tarayıcı depolamasını şişirmez.
 */
const DB_AD = "aea-ak-taslak", DEPO = "taslaklar";
function ac() {
  return new Promise((coz, red) => {
    try {
      const r = indexedDB.open(DB_AD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DEPO, { keyPath: "kaynakId" });
      r.onsuccess = () => coz(r.result); r.onerror = () => red(r.error);
    } catch (h) { red(h); }
  });
}
async function islem(mod, fn) {
  const db = await ac();
  try { return await new Promise((coz, red) => { const tx = db.transaction(DEPO, mod); const s = fn(tx.objectStore(DEPO)); tx.oncomplete = () => coz(s?.result); tx.onerror = () => red(tx.error); tx.onabort = () => red(tx.error); }); }
  finally { db.close(); }
}
export const taslakYaz = (kaynakId, ozet) => islem("readwrite", (s) => s.put({ kaynakId, ozet, t: Date.now() })).catch(() => {});
export const taslakOku = (kaynakId) => islem("readonly", (s) => s.get(kaynakId)).catch(() => null);
/** Yalnızca verilen zamandan SONRA değişmemişse siler (gönderim sürerken yeni değişiklik yazıldıysa taslağı korur). */
export async function taslakSil(kaynakId, t) {
  try { const m = await taslakOku(kaynakId); if (m && (!t || m.t <= t)) await islem("readwrite", (s) => s.delete(kaynakId)); } catch { /* yok say */ }
}
const tumu = () => islem("readonly", (s) => s.getAll()).catch(() => []);

/** Bekleyen tüm taslakları veritabanına gönderir. @returns {Promise<number>} gönderilen kaynak sayısı */
let gonderiliyor = false;
export async function bekleyenleriGonder(supabase) {
  if (gonderiliyor) return 0;
  gonderiliyor = true; let n = 0;
  try {
    for (const m of await tumu()) {
      const { error } = await supabase.rpc("akademik_aciklamalari_esitle", { p_kaynak_id: m.kaynakId, p_aciklamalar: m.ozet });
      if (!error) { await taslakSil(m.kaynakId, m.t); n++; }
      else if (/does not exist|not found|42501|permission|JWT/i.test(error.message || "")) { /* kaynak silinmiş / yetki yok: tekrar deneme */ if (/does not exist|violates foreign key/i.test(error.message || "")) await taslakSil(m.kaynakId, m.t); }
    }
  } catch { /* ağ yok: sonra */ }
  finally { gonderiliyor = false; }
  return n;
}
