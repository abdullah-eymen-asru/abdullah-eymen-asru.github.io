/*
 * assets/js/demo/demo-giris.js — Giriş sayfasındaki "Canlı Demo / Vitrin Modu" düğmesi.
 * Anonim demo girişi VARSAYILAN KAPALIDIR: Site Sahibi, "Demo Yetki & Görünürlük" ekranındaki "Herkese açık demo girişi"
 * anahtarını açana dek düğme hiç gösterilmez ve tıklanamaz. Durum her seferinde taze okunur (önbellek yok); okunamazsa kapalı sayılır.
 * Gerçek giriş YAPILMAZ: yalnızca bu sekmeye özel demo bayrağı (sessionStorage) açılır ve panele gidilir.
 * Panelde `supabase` sahte istemcidir (demo-supabase.js); hiçbir gerçek veri/R2/Worker erişimi yoktur.
 * ('demo' rollü GERÇEK hesapla giriş yapan üye bu anahtardan bağımsızdır: auth-guard.js onu doğrudan demoya alır.)
 */
import { demoBaslat, demoHerkeseAcikMi } from "./demo-durum.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/supabase-client.js";

const kutu = document.getElementById("demo-giris-kutu");
const kapaliNot = document.getElementById("demo-kapali-not");
const depoNot = document.getElementById("demo-depo-not");
const buton = document.getElementById("demo-giris-btn");

// Bilgilendirme HER İKİ durumda da görünür (kullanıcı kararı): açıkken "hesapsız dene" düğmesinin yanında, kapalıyken
// (ya da durum okunamadıysa) "hesapsız demo kapalı, demo hesabın varsa forma gir" notu. Böylece demo hesabı olan biri
// anahtarın durumundan bağımsız olarak nasıl gireceğini bilir. Ek olarak ?demo=depo (tarayıcı depolaması kapalı) uyarısı.
if (depoNot) depoNot.hidden = new URLSearchParams(location.search).get("demo") !== "depo";

function goster(acik) {
  if (kutu) kutu.hidden = !acik;
  if (kapaliNot) kapaliNot.hidden = acik;
}

demoHerkeseAcikMi(SUPABASE_URL, SUPABASE_ANON_KEY).then(goster);

buton?.addEventListener("click", async () => {
  buton.disabled = true;
  const acik = await demoHerkeseAcikMi(SUPABASE_URL, SUPABASE_ANON_KEY); // tıklama anında yeniden doğrula
  if (!acik) {
    goster(false);
    buton.disabled = false; // anahtar sonradan açılırsa (sayfa yenilenmeden) düğme kilitli kalmasın
    return;
  }
  demoBaslat();
  window.location.href = "/panel/dashboard.html#me-hub";
});
