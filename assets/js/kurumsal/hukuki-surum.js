/*
 * assets/js/kurumsal/hukuki-surum.js — hukuki metin sayfalarında yürürlükteki sürüm etiketini veritabanından gösterir.
 * [data-hukuki-surum="kvkk" | "riza"] öğelerinin içeriği, site_ayarlari'ndaki güncel sürümle değiştirilir; okunamazsa
 * sayfadaki sabit değer kalır (hiçbir şey bozulmaz). innerHTML YOK (CSP).
 */
import { guncelOnaySurumleri } from "../core/supabase-client.js";

(async () => {
  const kutular = document.querySelectorAll("[data-hukuki-surum]");
  if (!kutular.length) return;
  try {
    const s = await guncelOnaySurumleri();
    for (const k of kutular) {
      const v = s[k.dataset.hukukiSurum];
      if (v) k.textContent = v;
    }
  } catch (e) {
    console.warn("Hukuki sürüm okunamadı:", e);
  }
})();
