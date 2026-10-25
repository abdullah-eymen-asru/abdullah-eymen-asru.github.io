/*
 * assets/js/core/oturum-koruyucu.js — OTURUM KORUYUCU: "kod güncelledim, herkes çıkış yaptı" sorununun mimari çözümü.
 * -----------------------------------------------------------------------------------------------------------------
 * İLKE (güvenlik bozulmadan kullanışlılık): Çıkışı yalnızca KULLANICI ya da SUNUCU kararı verir; tarayıcı tarafındaki bir
 * aksilik (aynı anda iki sekmenin token yenilemesi, depo kaydının silinmesi, ağ kesintisi) oturumu düşüremez.
 *
 *  • BİLİNÇLİ çıkış (Hemen Çıkış Yap, Çıkış, hesap silme, tüm cihazlar): supabase.auth.signOut() sarmalanır; yedek ÖNCE silinir,
 *    böylece hiçbir "kurtarma" devreye girmez. scope:"others" çıkışı bu cihazın oturumunu etkilemez, yedeği silmez.
 *  • SUNUCU kararı (admin zorla çıkış, askıya alma, süresi dolan/iptal edilen refresh token): kurtarma denemesi sunucuda reddedilir
 *    → yedek silinir → kullanıcı gerçekten çıkmış kalır. Yani güvenlik kararları (0009/0032 zorla çıkış) AYNEN geçerlidir.
 *  • BEKLENMEDİK düşüş (bilinçli çıkış yok, ama SDK SIGNED_OUT yaydı ya da oturum kaydı kayboldu): 1,2 sn beklenir (öteki sekme
 *    token'ı yenilemiş olabilir; öyleyse onun oturumu alınır). Hâlâ yoksa, YEDEKTEKİ refresh token ile TEK bir sessiz yenileme
 *    denenir (10 dk'da en çok 1 kez). Başarılıysa kullanıcı hiçbir şey fark etmez.
 *  • Yedek: IndexedDB "aea-oturum" (refresh token + kullanıcı kimliği). localStorage'daki Supabase kaydıyla AYNI kaynak/aynı
 *    erişim düzeyi (JS okuyabilir) → yeni bir saldırı yüzeyi açmaz. "Oturumumu hatırla" kapalıysa (aea_oturumu_hatirla=0) YEDEK TUTULMAZ.
 *    Yedek 30 günden eskiyse kullanılmaz.
 * Sıfır sunucu isteği ekler: yalnızca beklenmedik düşüşte tek bir token yenileme isteği.
 */
const DB_AD = "aea-oturum", DEPO = "yedek", ANAHTAR = "son", OMUR_MS = 30 * 24 * 3600 * 1000;
const DENEME_ANAHTARI = "aea_oturum_kurtarma_t", BILINCLI_ANAHTARI = "aea_bilincli_cikis_t";

function hatirlaAcikMi() { try { return localStorage.getItem("aea_oturumu_hatirla") !== "0"; } catch { return true; } }
function idb() {
  return new Promise((coz, red) => {
    try {
      const r = indexedDB.open(DB_AD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DEPO);
      r.onsuccess = () => coz(r.result);
      r.onerror = () => red(r.error);
    } catch (h) { red(h); }
  });
}
async function idbIs(mod, fn) {
  const db = await idb();
  try { return await new Promise((coz, red) => { const tx = db.transaction(DEPO, mod); const sonuc = fn(tx.objectStore(DEPO)); tx.oncomplete = () => coz(sonuc?.result); tx.onerror = () => red(tx.error); tx.onabort = () => red(tx.error); }); }
  finally { db.close(); }
}
const yedekOku = () => idbIs("readonly", (s) => s.get(ANAHTAR)).catch(() => null);
const yedekYaz = (v) => idbIs("readwrite", (s) => s.put(v, ANAHTAR)).catch(() => {});
const yedekSil = () => idbIs("readwrite", (s) => s.delete(ANAHTAR)).catch(() => {});

function depoAnahtari(url) { try { return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`; } catch { return ""; } }
function depodaOturumVar(url) {
  const k = depoAnahtari(url); if (!k) return false;
  try { if (localStorage.getItem(k)) return true; } catch { /* yok */ }
  try { if (sessionStorage.getItem(k)) return true; } catch { /* yok */ }
  return false;
}
const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
function sonBilincliCikis() { try { return Number(sessionStorage.getItem(BILINCLI_ANAHTARI) || 0); } catch { return 0; } }

export function oturumKoruyucuKur(supabase, supabaseUrl) {
  if (typeof window === "undefined" || window.__aeaOturumKoruyucu || !supabase?.auth || typeof indexedDB === "undefined") return;
  window.__aeaOturumKoruyucu = true;

  // 1) Bilinçli çıkışı işaretle ve yedeği ÖNCE sil. (scope:"others" bu cihazın oturumunu kapatmaz → dokunma.)
  const asilCikis = supabase.auth.signOut.bind(supabase.auth);
  supabase.auth.signOut = async (secenek) => {
    if (secenek?.scope !== "others") {
      try { sessionStorage.setItem(BILINCLI_ANAHTARI, String(Date.now())); } catch { /* yok */ }
      await yedekSil();
    }
    return asilCikis(secenek);
  };

  // 2) Her başarılı oturum olayında yedeği tazele (refresh token döndükçe güncel kalır).
  async function yedekle(oturum) {
    if (!oturum?.refresh_token || !hatirlaAcikMi()) return;
    await yedekYaz({ rt: oturum.refresh_token, uid: oturum.user?.id || null, t: Date.now() });
  }

  // 3) Sessiz kurtarma (en çok 10 dk'da bir). true → oturum geri geldi.
  async function kurtar(neden) {
    try {
      const son = Number(localStorage.getItem(DENEME_ANAHTARI) || 0);
      if (Date.now() - son < 10 * 60 * 1000) return false;
      const y = await yedekOku();
      if (!y?.rt || Date.now() - (y.t || 0) > OMUR_MS || !hatirlaAcikMi()) return false;
      localStorage.setItem(DENEME_ANAHTARI, String(Date.now()));
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: y.rt });
      if (error || !data?.session) {
        // Sunucu reddetti (iptal/süre/zorla çıkış): gerçek çıkış → yedek geçersiz, sil. Ağ hatasıysa (status 0/5xx) yedeği KORU.
        const ag = !error || error.status === 0 || error.status >= 500 || /fetch|network/i.test(error.message || "");
        if (!ag) await yedekSil();
        return false;
      }
      await yedekle(data.session);
      console.info(`oturum-koruyucu: oturum sessizce geri alındı (${neden}).`);
      return true;
    } catch { return false; }
  }

  supabase.auth.onAuthStateChange((olay, oturum) => {
    if (oturum && (olay === "SIGNED_IN" || olay === "TOKEN_REFRESHED" || olay === "INITIAL_SESSION")) { yedekle(oturum); return; }
    if (olay !== "SIGNED_OUT") return;
    // onAuthStateChange içinde await'li Supabase çağrısı kilitlenmeye yol açar → bir sonraki tura al.
    setTimeout(async () => {
      if (Date.now() - sonBilincliCikis() < 20000) return;        // kullanıcı kendisi çıktı
      if (!(await yedekOku())) return;                            // yedek yok = bilinçli/sunucu çıkışı ya da hiç yedeklenmemiş
      await bekle(1200);                                          // öteki sekme token'ı yenilemiş olabilir
      if (depodaOturumVar(supabaseUrl)) { try { await supabase.auth.getSession(); } catch { /* yok */ } return; }
      await kurtar("beklenmedik SIGNED_OUT");
    }, 0);
  });

  // 4) Açılışta: depoda oturum kaydı yok ama yedek var (depo silinmiş) ve kullanıcı bilinçli çıkmamış → bir kez kurtar.
  setTimeout(async () => {
    if (depodaOturumVar(supabaseUrl) || Date.now() - sonBilincliCikis() < 20000) return;
    if (!(await yedekOku())) return;
    await kurtar("depo kaydı kayıp");
  }, 800);
}
