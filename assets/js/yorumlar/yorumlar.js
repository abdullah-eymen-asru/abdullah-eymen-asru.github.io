/*
 * assets/js/yorumlar/yorumlar.js — Yerli (Supabase) yorum sistemi; Giscus'un yerini alır (0137/0138).
 * Önce ANA yorumlar görünür; yanıtlar "N yanıtı göster" ile açılır (sayfa şişmez). Yanıt kutusu ilgili yorumun altında açılır. Ana yorumlar 10'arlı sayfalanır.
 * Yazarken ad seçimi: gerçek adım · anonim · takma ad. Yazar kendi yorumunu düzenler/siler ("(Düzenlendi - YYYY-MM-DD)"); yönetim yalnızca gizler/siler.
 * Üçüncü taraf çerez/iframe yok. CSP: inline stil/olay yok; innerHTML kullanılmaz.
 */
import { supabase } from "../core/supabase-client.js";
import { hata as trHata } from "../core/hata-metni.js";

const kok = document.getElementById("yorumlar-kok");
const anahtar = kok?.getAttribute("data-anahtar") || location.pathname.replace(/\/+$/, "") || "/";
const SAYFA = 10;
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f) { const b = el("button", `yk-btn ${c || ""}`.trim(), m); b.type = "button"; if (f) b.addEventListener("click", f); return b; }
const tarihYaz = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${t}T00:00:00Z`)); } catch { return String(t || ""); } };
const LS = "yk_ad_tercihi";

async function kur() {
  if (!kok) return;
  let oturum = null; try { oturum = (await supabase.auth.getSession()).data.session; } catch { oturum = null; }
  const mesaj = el("p", "yk-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("yk-hata", !!h); };
  const liste = el("div", "yk-liste"), anaForm = el("div", "yk-form"), baslikSayi = el("h2", null, "Yorumlar");
  let yorumlar = [], gorunen = SAYFA; const acik = new Set();
  const daha = dg("Daha fazla yorum göster", "", () => { gorunen += SAYFA; ciz(); });

  async function yukle() {
    if (oturum) { try { await supabase.rpc("yorum_sahipligi_geri_al"); } catch { /* 0137 yok */ } }
    const { data, error } = await supabase.rpc("yorum_listele", { p_anahtar: anahtar });
    if (error) { liste.replaceChildren(el("p", "yk-soluk", /yorum_listele/.test(error.message) ? "Yorumlar için veritabanı güncellemesi (0137/0138) gerekli." : error.message)); return; }
    yorumlar = data || []; const hedefId = (location.hash.match(/^#yorum-([0-9a-f-]{36})$/i) || [])[1];
    if (hedefId) { gorunen = Math.max(gorunen, yorumlar.length); let h = yorumlar.find((c) => c.id === hedefId); while (h?.ust_id) { acik.add(h.ust_id); h = yorumlar.find((c) => c.id === h.ust_id); } }
    ciz();
    if (hedefId) { const d = document.getElementById(`yorum-${hedefId}`); if (d) { d.classList.add("yk-vurgu"); d.scrollIntoView({ block: "center" }); } }
  }

  function formKur(ust, hedef, bitince) {
    hedef.replaceChildren();
    if (!oturum) { const g = el("a", "yk-btn yk-birincil", "Yorum yazmak için giriş yap"); g.href = `/hesap/giris.html?geri=${encodeURIComponent(location.pathname)}`; hedef.append(el("p", "yk-soluk", "Yorumları herkes okuyabilir; yazmak için giriş yapmalısın."), g); return; }
    const t = el("textarea", "yk-girdi"); t.rows = ust ? 3 : 4; t.placeholder = ust ? `${ust.ad} kişisine yanıt…` : "Yorumun…"; t.setAttribute("aria-label", "Yorum");
    let tercih = "gercek", takma = ""; try { const k = JSON.parse(localStorage.getItem(LS) || "null"); if (k) { tercih = k.tercih || "gercek"; takma = k.takma || ""; } } catch { /* yok say */ }
    const sec = el("select", "yk-girdi yk-ad-sec"); sec.setAttribute("aria-label", "Yorumun nasıl görünsün");
    [["gercek", "👤 Adımla yaz"], ["anonim", "🕶 Anonim yaz"], ["takma", "🏷 Takma adla yaz"]].forEach(([v, a]) => { const o = el("option", null, a); o.value = v; sec.append(o); }); sec.value = tercih;
    const rumuz = el("input", "yk-girdi"); rumuz.type = "text"; rumuz.maxLength = 40; rumuz.placeholder = "Takma ad (2–40 karakter)"; rumuz.value = takma; rumuz.setAttribute("aria-label", "Takma ad");
    const ipucu = el("p", "yk-soluk");
    const guncelle = () => { rumuz.hidden = sec.value !== "takma"; ipucu.textContent = sec.value === "anonim" ? "Anonim: sayfada adın görünmez. Kötüye kullanımı önlemek için kimliğin yalnızca site yönetiminde kayıtlı kalır." : sec.value === "takma" ? "Takma ad: yorumda yalnızca bu ad görünür; gerçek adın sayfada gösterilmez." : "Yorumda hesabındaki adın görünür."; };
    sec.addEventListener("change", guncelle); guncelle();
    const g = dg("Gönder", "yk-birincil", async () => {
      if (!t.value.trim()) { bildir("Yorum boş olamaz.", true); return; }
      if (sec.value === "takma" && rumuz.value.trim().length < 2) { bildir("Takma ad en az 2 karakter olmalı.", true); return; }
      try { localStorage.setItem(LS, JSON.stringify({ tercih: sec.value, takma: rumuz.value.trim() })); } catch { /* yok say */ }
      g.disabled = true; const r = await supabase.rpc("yorum_ekle", { p_anahtar: anahtar, p_ust_id: ust?.id || null, p_metin: t.value, p_anonim: sec.value === "anonim", p_takma_ad: sec.value === "takma" ? rumuz.value.trim() : null }); g.disabled = false;
      if (r.error) bildir(trHata(r.error), true); else { bildir("✔ Yorumun eklendi."); if (ust) acik.add(ust.id); bitince?.(); await yukle(); } });
    const alt = el("div", "yk-form-alt"); alt.append(sec, rumuz); const eylem = el("div", "yk-eylem"); eylem.append(g, ...(ust ? [dg("Vazgeç", "", () => bitince?.())] : []));
    hedef.append(t, alt, ipucu, eylem);
  }

  function kart(y, cocuklar, derinlik) {
    const k = el("article", `yk-yorum${y.gizli ? " yk-gizli" : ""}`); k.id = `yorum-${y.id}`; k.dataset.derinlik = String(Math.min(derinlik, 2));
    const ust = el("div", "yk-ust"); ust.append(el("strong", null, y.ad), ...(y.rumuz ? [el("span", "yk-rozet", "takma ad")] : []), el("span", "yk-soluk", ` · ${tarihYaz(y.tarih)}${y.duzenlendi ? ` (Düzenlendi - ${y.duzenlendi})` : ""}${y.gizli ? " · 🙈 gizli" : ""}`));
    const m = el("p", "yk-metin", y.metin), eylem = el("div", "yk-eylem"), yanitKutu = el("div", "yk-yanit-kutu"); yanitKutu.hidden = true;
    if (oturum) eylem.append(dg("↩ Yanıtla", "yk-kucuk", () => { yanitKutu.hidden = !yanitKutu.hidden; if (!yanitKutu.hidden) { formKur(y, yanitKutu, () => { yanitKutu.hidden = true; }); yanitKutu.querySelector("textarea")?.focus(); } }));
    if (cocuklar.length) { const a = acik.has(y.id); eylem.append(dg(a ? `▲ Yanıtları gizle (${cocuklar.length})` : `▼ ${cocuklar.length} yanıtı göster`, "yk-kucuk yk-ac", () => { if (acik.has(y.id)) acik.delete(y.id); else acik.add(y.id); ciz(); })); }
    if (y.benim) {
      eylem.append(dg("✏️ Düzenle", "yk-kucuk", () => {
        const t = el("textarea", "yk-girdi"); t.value = y.metin; t.rows = 4; t.setAttribute("aria-label", "Yorumu düzenle");
        const kaydet = dg("Kaydet", "yk-birincil", async () => { const r = await supabase.rpc("yorum_duzenle", { p_id: y.id, p_metin: t.value }); if (r.error) bildir(trHata(r.error), true); else { bildir("✔ Yorum güncellendi."); await yukle(); } });
        m.replaceWith(t); eylem.replaceChildren(kaydet, dg("Vazgeç", "", () => ciz())); t.focus();
      }), dg("🗑 Sil", "yk-kucuk yk-tehlike", async () => { if (!window.confirm("Yorumun silinsin mi? Geri alınamaz.")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }));
    } else if (y.yonetici) {
      eylem.append(dg(y.gizli ? "👁 Göster" : "🙈 Gizle", "yk-kucuk", async () => { const r = await supabase.rpc("yorum_gizle", { p_id: y.id, p_gizli: !y.gizli }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }),
        dg("🗑 Sil", "yk-kucuk yk-tehlike", async () => { if (!window.confirm("Bu yorum kalıcı olarak silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }));
    }
    k.append(ust, m, eylem, yanitKutu);
    const sar = el("div", "yk-sarma"); sar.append(k);
    if (cocuklar.length && acik.has(y.id)) { const alt = el("div", "yk-yanitlar"); cocuklar.forEach((c) => alt.append(kart(c.y, c.cocuklar, derinlik + 1))); sar.append(alt); }
    return sar;
  }
  function agac() {
    const harita = new Map(yorumlar.map((y) => [y.id, { y, cocuklar: [] }])), kokler = [];
    yorumlar.forEach((y) => { const d = harita.get(y.id), ata = y.ust_id && harita.get(y.ust_id); if (ata) ata.cocuklar.push(d); else kokler.push(d); });
    return kokler;
  }
  function ciz() {
    liste.replaceChildren(); const kokler = agac();
    kokler.slice(0, gorunen).forEach((d) => liste.append(kart(d.y, d.cocuklar, 0)));
    if (!kokler.length) liste.append(el("p", "yk-soluk", "Henüz yorum yok. İlk yorumu sen yaz."));
    daha.hidden = kokler.length <= gorunen; if (!daha.hidden) daha.textContent = `Daha fazla yorum göster (${kokler.length - gorunen} yorum daha)`;
    baslikSayi.textContent = `Yorumlar${yorumlar.length ? ` (${yorumlar.length})` : ""}`;
  }
  kok.replaceChildren(baslikSayi, liste, daha, el("h3", "yk-yaz-baslik", "Yorum yaz"), anaForm, mesaj);
  formKur(null, anaForm, null); await yukle();
}
kur().catch((h) => { console.error("yorumlar.js:", h); if (kok) kok.textContent = "Yorumlar yüklenemedi."; });
