/*
 * assets/js/demo/demo-giris.js — Giriş sayfasındaki "Canlı Demo / Vitrin Modu" düğmesi.
 * Gerçek giriş YAPILMAZ: yalnızca bu sekmeye özel demo bayrağı (sessionStorage) açılır ve panele gidilir.
 * Panelde `supabase` sahte istemcidir (demo-supabase.js); hiçbir gerçek veri/R2/Worker erişimi yoktur.
 */
import { demoBaslat } from "./demo-durum.js";

document.getElementById("demo-giris-btn")?.addEventListener("click", () => {
  demoBaslat();
  window.location.href = "/panel/dashboard.html#me-hub";
});
