/*
 * assets/js/auth/nav-auth-init.js
 *
 * "HESABIM ▾" GEÇ RENDER OLMASI DÜZELTMESİ — parça 2/3 (bkz. nav-auth-hint.js
 * ve nav-auth.js için 1/3 ve 3/3).
 *
 * ÖNCEDEN bu dosyanın yaptığı iş, _layouts/default.html içinde bir INLINE
 * <script type="module"> bloğuydu ve initAuthNav() çağrısını BİLEREK
 * window "load" olayına VE ardından requestIdleCallback'e (ya da onu
 * desteklemeyen tarayıcılarda ekstra bir setTimeout(1000)'e) erteliyordu.
 * Amaç LCP/FCP'yi (ilk anlamlı çizimi) hiç etkilememekti — ama pratikte bu
 * ÇİFT gecikme (önce TÜM sayfa+resimler+alt kaynaklar yüklenene kadar, SONRA
 * tarayıcının boşta kalmasını bekleyip, o da olmazsa 1 saniye daha) "Hesabım"
 * menüsünün olması gerekenden ÇOK GEÇ belirmesine yol açıyordu (raporlanan
 * "geç render olması" sorunu).
 *
 * DÜZELTME: initAuthNav() artık BURADA, modülün en üst seviyesinde,
 * hiçbir ek bekleme SARMALAYICISI (load/idle/timeout) OLMADAN çağrılıyor.
 * Bu, LCP'yi YİNE ETKİLEMEZ çünkü:
 *   1) type="module" script'ler zaten spec gereği ERTELENMİŞ (defer ile
 *      aynı zamanlama) çalışır — belge ayrıştırması bitmeden ÇALIŞMAZLAR,
 *      yani ilk boyayı BLOKLAMAZLAR.
 *   2) initAuthNav()'ın kendisi supabase-client.js'i (ve Supabase SDK'yi)
 *      DİNAMİK import() ETMİYOR artık zaten üst seviyede import edildiği
 *      için modül grafiği tarayıcı tarafından paralel/arka planda
 *      indirilir; getSession() çağrısı da ASENKRONDUR (ana thread'i
 *      bloklamaz).
 * Yani "sayfa boyanmasını geciktirmeme" hedefi module/async doğası
 * gereği zaten sağlanıyor — window.load + requestIdleCallback + 1sn
 * setTimeout katmanları GEREKSİZ bir gecikme EKLİYORDU, LCP'yi
 * KORUMUYORDU (LCP genelde sayfa içeriği/görselle ilgilidir, küçük bir
 * nav düğmesiyle değil).
 *
 * Hata durumunda (ağ sorunu, import başarısız) initAuthNav() zaten kendi
 * içinde try/catch ile ele alıyor (bkz. nav-auth.js) — statik/ipuçlu
 * yedek (nav-auth-hint.js) her zaman yerinde kaldığı için kullanıcı hiçbir
 * zaman boş bir menüyle kalmaz.
 */
import { initAuthNav } from "./nav-auth.js";

initAuthNav().catch((err) => {
  // initAuthNav() kendi try/catch'i içinde zaten hataları loglar; bu
  // .catch() sadece initAuthNav() fonksiyonunun KENDİSİ (ör. import
  // aşamasında beklenmedik bir senkron hata) reddederse "unhandled
  // promise rejection" olarak kalmasını önlemek için bir güvenlik ağı.
  console.error("nav-auth-init.js: initAuthNav() beklenmedik şekilde başarısız oldu:", err);
});
