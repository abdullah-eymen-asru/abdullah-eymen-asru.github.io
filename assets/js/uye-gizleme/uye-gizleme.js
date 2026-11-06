/* assets/js/uye-gizleme/uye-gizleme.js — Üye Ayarları: YALNIZCA Site Sahibi'ne "Siteden gizle" anahtarı (her üye kartında) ve "Geçici körlük" anahtarı (üstte). 0136. */
import { supabase } from "../core/supabase-client.js";

function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
let korlukEklendi = false, gizliler = null;

export async function anahtarlariEkle(liste, profil) {
  if (profil?.role !== "owner" || !liste) return;
  if (!gizliler) { const { data, error } = await supabase.rpc("owner_gizli_uyeler"); if (error) return; gizliler = new Set((data || []).map((x) => x.user_id)); }
  // Geçici körlük (üstte, bir kez)
  if (!korlukEklendi && !document.getElementById("uya-korluk")) {
    const { data: acik } = await supabase.rpc("owner_blind_mode", { p_ayarla: null });
    const kutu = el("label", "uya-korluk"); kutu.id = "uya-korluk"; const c = el("input"); c.type = "checkbox"; c.checked = acik === true; c.setAttribute("role", "switch");
    c.addEventListener("change", async () => { c.disabled = true; const r = await supabase.rpc("owner_blind_mode", { p_ayarla: c.checked }); c.disabled = false; if (r.error) { c.checked = !c.checked; window.alert(r.error.message); } else window.location.reload(); });
    kutu.append(c, el("span", null, " 🕶 Geçici körlük: açıkken sen de gizli üyeleri ve hareketlerini göremezsin; kapatınca hepsi anında geri gelir."));
    liste.parentElement.insertBefore(kutu, liste); korlukEklendi = true;
  }
  liste.querySelectorAll(".uya-kart[data-id]").forEach((kart) => {
    if (kart.querySelector(".uya-gizle")) return;
    const id = kart.getAttribute("data-id"); const l = el("label", "uya-gizle"), c = el("input"); c.type = "checkbox"; c.setAttribute("role", "switch"); c.checked = gizliler.has(id);
    c.addEventListener("change", async () => { c.disabled = true; const r = await supabase.rpc("owner_uye_gizle", { p_user_id: id, p_gizli: c.checked }); c.disabled = false;
      if (r.error) { c.checked = !c.checked; window.alert(r.error.message); } else { if (c.checked) gizliler.add(id); else gizliler.delete(id); kart.classList.toggle("uya-gizli", c.checked); } });
    l.append(c, el("span", null, " 🙈 Siteden gizle (yalnızca sen görürsün)")); kart.classList.toggle("uya-gizli", c.checked); kart.append(l);
  });
}
