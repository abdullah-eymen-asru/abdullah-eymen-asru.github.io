/*
 * assets/js/yorumlar/yorumlar.js — Yerli (Supabase) yorum sistemi; Giscus'un yerini alır (0137).
 * Herkes okur; yorum yazmak için site üyeliği/girişi gerekir. Yazar kendi yorumunu düzenler/siler ("(Düzenlendi - YYYY-MM-DD)", saat yok).
 * Yönetici/Site Sahibi yalnızca GİZLER/SİLER; metni düzenleyemez. Üçüncü taraf çerez/iframe yok. CSP: inline stil/olay yok; DOM üzerinden (innerHTML kullanılmaz).
 */
import { supabase } from "../core/supabase-client.js";

const kok = document.getElementById("yorumlar-kok");
const anahtar = kok?.getAttribute("data-anahtar") || location.pathname.replace(/\/+$/, "") || "/";
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f) { const b = el("button", `yk-btn ${c || ""}`.trim(), m); b.type = "button"; if (f) b.addEventListener("click", f); return b; }
const tarihYaz = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${t}T00:00:00Z`)); } catch { return String(t || ""); } };

async function kur() {
  if (!kok) return;
  let oturum = null; try { oturum = (await supabase.auth.getSession()).data.session; } catch { oturum = null; }
  const mesaj = el("p", "yk-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("yk-hata", !!h); };
  const liste = el("div", "yk-liste"), form = el("div", "yk-form");
  let yorumlar = [], yanit = null;

  async function yukle() {
    if (oturum) { try { await supabase.rpc("yorum_sahipligi_geri_al"); } catch { /* 0137 yok */ } }
    const { data, error } = await supabase.rpc("yorum_listele", { p_anahtar: anahtar });
    if (error) { liste.replaceChildren(el("p", "yk-soluk", /yorum_listele/.test(error.message) ? "Yorumlar için veritabanı güncellemesi (0137) gerekli." : error.message)); return; }
    yorumlar = data || []; ciz();
  }
  function yorumKutusu(y, derinlik) {
    const k = el("article", `yk-yorum${y.gizli ? " yk-gizli" : ""}`); k.dataset.derinlik = String(Math.min(derinlik, 3));
    const ust = el("div", "yk-ust"); ust.append(el("strong", null, y.ad), el("span", "yk-soluk", ` · ${tarihYaz(y.tarih)}${y.duzenlendi ? ` (Düzenlendi - ${y.duzenlendi})` : ""}${y.gizli ? " · 🙈 gizli" : ""}`));
    const m = el("p", "yk-metin", y.metin), eylem = el("div", "yk-eylem");
    if (oturum) eylem.append(dg("↩ Yanıtla", "", () => { yanit = y; formCiz(); form.scrollIntoView({ block: "center", behavior: "smooth" }); }));
    if (y.benim) {
      eylem.append(dg("✏️ Düzenle", "", () => {
        const t = el("textarea", "yk-girdi"); t.value = y.metin; t.rows = 4; t.setAttribute("aria-label", "Yorumu düzenle");
        const kaydet = dg("Kaydet", "yk-birincil", async () => { const r = await supabase.rpc("yorum_duzenle", { p_id: y.id, p_metin: t.value }); if (r.error) bildir(r.error.message, true); else { bildir("✔ Yorum güncellendi."); await yukle(); } });
        m.replaceWith(t); eylem.replaceChildren(kaydet, dg("Vazgeç", "", () => ciz())); t.focus();
      }), dg("🗑 Sil", "yk-tehlike", async () => { if (!window.confirm("Yorumun silinsin mi? Geri alınamaz.")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(r.error.message, true); else await yukle(); }));
    } else if (y.yonetici) {
      // Yönetici: yalnızca gizle / sil. Metni düzenleme yolu YOKTUR.
      eylem.append(dg(y.gizli ? "👁 Göster" : "🙈 Gizle", "", async () => { const r = await supabase.rpc("yorum_gizle", { p_id: y.id, p_gizli: !y.gizli }); if (r.error) bildir(r.error.message, true); else await yukle(); }),
        dg("🗑 Sil", "yk-tehlike", async () => { if (!window.confirm("Bu yorum kalıcı olarak silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(r.error.message, true); else await yukle(); }));
    }
    k.append(ust, m, eylem); return k;
  }
  function ciz() {
    liste.replaceChildren(); const cocuklar = new Map();
    yorumlar.forEach((y) => { const a = y.ust_id || "kok"; if (!cocuklar.has(a)) cocuklar.set(a, []); cocuklar.get(a).push(y); });
    const kokler = cocuklar.get("kok") || []; const ids = new Set(yorumlar.map((y) => y.id));
    yorumlar.filter((y) => y.ust_id && !ids.has(y.ust_id)).forEach((y) => kokler.push(y));
    const yaz = (y, d) => { liste.append(yorumKutusu(y, d)); (cocuklar.get(y.id) || []).forEach((c) => yaz(c, d + 1)); };
    kokler.forEach((y) => yaz(y, 0));
    if (!yorumlar.length) liste.append(el("p", "yk-soluk", "Henüz yorum yok. İlk yorumu sen yaz."));
  }
  function formCiz() {
    form.replaceChildren();
    if (!oturum) { const g = el("a", "yk-btn yk-birincil", "Yorum yazmak için giriş yap"); g.href = `/hesap/giris.html?geri=${encodeURIComponent(location.pathname)}`; form.append(el("p", "yk-soluk", "Yorumları herkes okuyabilir; yazmak için giriş yapmalısın."), g); return; }
    const t = el("textarea", "yk-girdi"); t.rows = 4; t.placeholder = yanit ? `${yanit.ad} kişisine yanıt…` : "Yorumun…"; t.setAttribute("aria-label", "Yorum");
    const an = el("input"); an.type = "checkbox"; an.id = "yk-anonim"; const al = el("label", "yk-onay"); al.setAttribute("for", "yk-anonim"); al.append(an, el("span", null, " Anonim yaz (adın gösterilmez)"));
    const g = dg("Gönder", "yk-birincil", async () => { if (!t.value.trim()) { bildir("Yorum boş olamaz.", true); return; } g.disabled = true;
      const r = await supabase.rpc("yorum_ekle", { p_anahtar: anahtar, p_ust_id: yanit?.id || null, p_metin: t.value, p_anonim: an.checked }); g.disabled = false;
      if (r.error) bildir(r.error.message, true); else { t.value = ""; yanit = null; bildir("✔ Yorumun eklendi."); formCiz(); await yukle(); } });
    form.append(...(yanit ? [el("p", "yk-soluk", `↩ ${yanit.ad} kişisine yanıt veriyorsun.`), dg("Yanıtı iptal et", "", () => { yanit = null; formCiz(); })] : []), t, al, g);
  }
  kok.replaceChildren(el("h2", null, "Yorumlar"), el("p", "yk-soluk", "Yorumlar bu sitenin kendi veritabanında tutulur (üçüncü taraf çerezi yok). Yazar kendi yorumunu düzenleyip silebilir; yönetim yalnızca gizleyebilir veya silebilir."), liste, form, mesaj);
  formCiz(); await yukle();
}
kur().catch((h) => { console.error("yorumlar.js:", h); if (kok) kok.textContent = "Yorumlar yüklenemedi."; });
