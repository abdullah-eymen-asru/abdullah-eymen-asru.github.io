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
const buton = document.getElementById("demo-giris-btn");

function goster(acik) {
  if (kutu) kutu.hidden = !acik;
  // Kapalıyken yalnızca ziyaretçi demoyu aramışsa (yönlendirmeyle ?demo=kapali) bilgi notu göster; normal girişte sessiz kal.
  if (kapaliNot) kapaliNot.hidden = acik || new URLSearchParams(location.search).get("demo") !== "kapali";
}

demoHerkeseAcikMi(SUPABASE_URL, SUPABASE_ANON_KEY).then(goster);

buton?.addEventListener("click", async () => {
  buton.disabled = true;
  const acik = await demoHerkeseAcikMi(SUPABASE_URL, SUPABASE_ANON_KEY); // tıklama anında yeniden doğrula
  if (!acik) {
    goster(false);
    if (kapaliNot) kapaliNot.hidden = false;
    return;
  }
  demoBaslat();
  window.location.href = "/panel/dashboard.html#me-hub";
});
