/* assets/js/yorumlarim/yorumlarim.js — Hesabım › Yorumlarım: kullanıcı kendi yorumlarını (blog/akademik) düzenler/siler; yönetici ek olarak tüm yorumları GİZLER/SİLER (metin düzenleyemez). 0137. */
import { supabase } from "../core/supabase-client.js";
const kok = document.getElementById("yy-kok");
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f) { const b = el("button", `yk-btn ${c || ""}`.trim(), m); b.type = "button"; if (f) b.addEventListener("click", f); return b; }
const tarih = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${t}T00:00:00Z`)); } catch { return String(t || ""); } };
async function kur() {
  if (!kok) return;
  const yonetici = (await supabase.rpc("is_manager_or_admin")).data === true;
  const mesaj = el("p", "yk-mesaj"); mesaj.setAttribute("role", "status");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("yk-hata", !!h); };
  const benimKutu = el("div", "yk-liste"), yonKutu = el("div", "yk-liste"), ara = el("input", "yk-girdi"); ara.type = "search"; ara.placeholder = "Yorumlarda ara (metin, ad, sayfa)…";
  const yazi = (a) => el("a", "yk-soluk", a).constructor && Object.assign(el("a", "yk-link", a), { href: a.startsWith("/") ? a : `/${a}` });
  async function benimYukle() {
    const { data, error } = await supabase.rpc("yorumlarim_listele");
    benimKutu.replaceChildren(el("h2", null, "Yorumlarım"));
    if (error) { benimKutu.append(el("p", "yk-soluk", error.message)); return; }
    if (!(data || []).length) benimKutu.append(el("p", "yk-soluk", "Henüz yorum yazmadın."));
    (data || []).forEach((y) => {
      const k = el("article", "yk-yorum"), a = yazi(y.icerik_anahtari), m = el("p", "yk-metin", y.metin), e = el("div", "yk-eylem");
      k.append(el("div", "yk-ust", `${tarih(y.tarih)}${y.duzenlendi ? ` (Düzenlendi - ${y.duzenlendi})` : ""}${y.gizli ? " · 🙈 yönetim tarafından gizlendi" : ""} · `), m, e); k.firstChild.append(a);
      e.append(dg("✏️ Düzenle", "", () => { const t = el("textarea", "yk-girdi"); t.value = y.metin; t.rows = 4; m.replaceWith(t); e.replaceChildren(dg("Kaydet", "yk-birincil", async () => { const r = await supabase.rpc("yorum_duzenle", { p_id: y.id, p_metin: t.value }); if (r.error) bildir(r.error.message, true); else { bildir("✔ Güncellendi."); await benimYukle(); } }), dg("Vazgeç", "", benimYukle)); }),
        dg("🗑 Sil", "yk-tehlike", async () => { if (!window.confirm("Yorumun silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(r.error.message, true); else await benimYukle(); }));
      benimKutu.append(k);
    });
  }
  async function yonYukle() {
    const { data, error } = await supabase.rpc("yorum_yonetim_listele", { p_ara: ara.value || null });
    yonKutu.replaceChildren(el("h2", null, "Yorum yönetimi (gizle / sil)"), ara);
    if (error) { yonKutu.append(el("p", "yk-soluk", error.message)); return; }
    (data || []).forEach((y) => {
      const k = el("article", `yk-yorum${y.gizli ? " yk-gizli" : ""}`), e = el("div", "yk-eylem");
      k.append(el("div", "yk-ust", `${y.ad}${y.anonim ? " (anonim yazdı)" : ""} · ${tarih(y.tarih)} · ${y.icerik_anahtari}${y.gizli ? " · 🙈 gizli" : ""}`), el("p", "yk-metin", y.metin), e);
      e.append(dg(y.gizli ? "👁 Göster" : "🙈 Gizle", "", async () => { const r = await supabase.rpc("yorum_gizle", { p_id: y.id, p_gizli: !y.gizli }); if (r.error) bildir(r.error.message, true); else await yonYukle(); }),
        dg("🗑 Sil", "yk-tehlike", async () => { if (!window.confirm("Bu yorum kalıcı olarak silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(r.error.message, true); else await yonYukle(); }));
      yonKutu.append(k);
    });
  }
  let z; ara.addEventListener("input", () => { clearTimeout(z); z = setTimeout(yonYukle, 300); });
  kok.replaceChildren(benimKutu, ...(yonetici ? [yonKutu] : []), mesaj);
  await benimYukle(); if (yonetici) await yonYukle();
}
kur().catch((h) => { console.error("yorumlarim.js:", h); if (kok) kok.textContent = "Yorumlar yüklenemedi."; });
