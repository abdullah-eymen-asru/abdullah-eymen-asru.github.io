/*
 * assets/js/onay-kutusu/onay-kutusu.js — İçerik Yönetimi › Onay Kutusu (migration 0133)
 * Onaya gönderilen taslak yazıları (blog / akademik proje) yetkili inceler: ✅ Onayla · 🛠 Düzeltme iste (not yazılır) · ⛔ İptal · ✏️ Düzenle · 🗑 Sil.
 * Yazar kendi taslaklarının durumunu ve düzeltme notlarını burada görür, düzeltip yeniden onaya gönderir.
 * Notlar yalnızca yazan kişi tarafından silinebilir; yazı yayına alınınca ya da taslak silinince OTOMATİK silinir (depolama dolmaz).
 * Kurallar sunucuda uygulanır: kimse kendi yazısını onaylayamaz (Site Sahibi hariç); onaylayanın rol sırası yazarınkinden yüksek olmalı. CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";

const kok = document.getElementById("ok-kok");
const DURUM = { bekliyor: ["⏳ Onay bekliyor", "bekle"], duzeltme_istendi: ["🛠 Düzeltme istendi", "duzelt"], onaylandi: ["✅ Onaylandı — yayına hazır", "tamam"], iptal: ["⛔ İptal edildi", "iptal"], adina_onay: ["🔏 Adına-yayın onayı bekliyor", "bekle"] };
const TUR = { blog: "Blog", proje: "Akademik proje" };
const FILTRELER = [["bekleyen", "Bekleyenler", (d) => d === "bekliyor" || d === "adina_onay"], ["duzeltme", "Düzeltme istenenler", (d) => d === "duzeltme_istendi"], ["onayli", "Onaylananlar", (d) => d === "onaylandi"], ["iptal", "İptaller", (d) => d === "iptal"], ["hepsi", "Hepsi", () => true]];

function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f, oz = {}) { const b = el("button", `ok-btn ${c || ""}`.trim(), m); b.type = "button"; for (const [k, v] of Object.entries(oz)) b.setAttribute(k, v); if (f) b.addEventListener("click", f); return b; }
const tarih = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(t)); } catch { return ""; } };

async function kur() {
  if (!kok) return;
  const { data: { session } } = await supabase.auth.getSession(); const uid = session?.user?.id;
  if (!uid) { kok.replaceChildren(el("p", "auth-message error", "Oturum bulunamadı.")); return; }
  let liste = [], filtre = "bekleyen";
  const mesaj = el("p", "ok-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("ok-hata", !!h); };
  const alan = el("div", "ok-liste"), cubuk = el("div", "ok-filtre"), gonderKutu = el("div", "ok-gonder");

  async function yukle() {
    const { data, error } = await supabase.rpc("yazi_inceleme_listele");
    if (error) { bildir(/yazi_inceleme_listele/.test(error.message) ? "Onay Kutusu için veritabanı güncellemesi (0133) gerekli." : error.message, true); liste = []; } else liste = data || [];
    await gonderSecenekleri(); ciz();
  }
  /* kendi taslaklarımdan onaya gönder */
  async function gonderSecenekleri() {
    gonderKutu.replaceChildren();
    const { data } = await supabase.from("taslak_icerikler").select("id,baslik,tur").eq("created_by", uid).order("updated_at", { ascending: false }).limit(100);
    const var_ = new Set(liste.map((x) => x.taslak_id)), adaylar = (data || []).filter((t) => !var_.has(t.id));
    if (!adaylar.length) return;
    const sec = el("select", "ok-girdi"); sec.setAttribute("aria-label", "Onaya gönderilecek taslak");
    const o0 = el("option", null, "📤 Onaya göndermek için kendi taslaklarımdan seç…"); o0.value = ""; sec.append(o0);
    adaylar.forEach((t) => { const o = el("option", null, `${t.baslik || "(başlıksız)"} · ${TUR[t.tur] || t.tur}`); o.value = t.id; sec.append(o); });
    const git = dg("Onaya gönder", "ok-birincil", async () => { if (!sec.value) return; const { error } = await supabase.rpc("yazi_onaya_gonder", { p_taslak_id: sec.value }); if (error) bildir(error.message, true); else { bildir("✔ Onaya gönderildi."); await yukle(); } });
    gonderKutu.append(sec, git);
  }

  function ciz() {
    cubuk.replaceChildren(...FILTRELER.map(([id, ad, f]) => { const n = liste.filter((x) => f(x.durum)).length; const b = dg(`${ad} (${n})`, "ok-sekme", () => { filtre = id; ciz(); }); b.setAttribute("aria-pressed", String(filtre === id)); return b; }));
    const f = FILTRELER.find(([id]) => id === filtre)[2], goster = liste.filter((x) => f(x.durum));
    alan.replaceChildren(...(goster.length ? goster.map(kart) : [el("p", "ok-soluk", filtre === "bekleyen" ? "Onay bekleyen yazı yok. 🎉" : "Bu filtrede yazı yok.")]));
  }

  function kart(x) {
    const k = el("article", "ok-kart"), [dEt, dSinif] = DURUM[x.durum] || [x.durum, ""];
    const ust = el("div", "ok-kart-ust"); ust.append(el("strong", "ok-baslik", x.baslik || "(başlıksız)"), el("span", `ok-rozet ok-${dSinif}`, dEt));
    k.append(ust, el("p", "ok-meta", `${TUR[x.tur] || x.tur} · ${x.benim ? "Senin yazın" : `Yazar: ${x.yazar_adi}`} · ${tarih(x.guncelleme)}${x.not_sayisi ? ` · 🗒 ${x.not_sayisi} not` : ""}`));
    const eylem = el("div", "ok-eylem"), duzenAlan = el("div", "ok-duzen"); duzenAlan.hidden = true;
    if (x.onizleme_kod) { const a = el("a", "ok-btn", "👁 Önizle"); a.href = `/onizleme/?tur=${encodeURIComponent(x.tur)}&kod=${encodeURIComponent(x.onizleme_kod)}`; a.target = "_blank"; a.rel = "noopener"; eylem.append(a); }
    if (x.durum === "adina_onay") {
      eylem.append(dg("📋 Yazılar listesinde aç", "", () => { location.hash = "#content-all"; }));
      k.append(el("p", "ok-soluk", "Bu yazı başka biri adına yayın onayı bekliyor: kararı “Tüm Yazılar & Projeler” listesindeki onay düğmeleriyle ver."));
    } else {
      eylem.append(dg("✏️ Düzenle", "", () => { duzenAlan.hidden = !duzenAlan.hidden; if (!duzenAlan.hidden && !duzenAlan.firstChild) duzenleKur(x, duzenAlan); }));
      if (x.karar_verebilir && x.durum !== "onaylandi") eylem.append(dg("✅ Onayla", "ok-birincil", () => karar(x, "onayla", null)));
      if (x.karar_verebilir && x.durum !== "duzeltme_istendi") eylem.append(dg("🛠 Düzeltme iste", "", () => notAlani(x, k, "duzeltme_iste")));
      if (x.karar_verebilir && x.durum !== "iptal") eylem.append(dg("⛔ İptal", "", () => notAlani(x, k, "iptal")));
      if (x.benim && (x.durum === "duzeltme_istendi" || x.durum === "iptal")) eylem.append(dg("📤 Düzelttim, yeniden gönder", "ok-birincil", async () => { const { error } = await supabase.rpc("yazi_onaya_gonder", { p_taslak_id: x.taslak_id }); if (error) bildir(error.message, true); else { bildir("✔ Yeniden onaya gönderildi."); await yukle(); } }));
    }
    if (x.benim || x.karar_verebilir) eylem.append(dg("🗑 Sil", "ok-tehlike", async () => {
      if (!window.confirm(`“${x.baslik || "taslak"}” silinsin mi? Düzeltme notları da silinir. Geri alınamaz.`)) return;
      const { error } = await supabase.from("taslak_icerikler").delete().eq("id", x.taslak_id); if (error) bildir(error.message, true); else { bildir("Silindi."); await yukle(); }
    }));
    k.append(eylem, duzenAlan, notlar(x));
    return k;
  }

  async function karar(x, tur, metin) {
    const { error } = await supabase.rpc("yazi_inceleme_karar", { p_taslak_id: x.taslak_id, p_karar: tur, p_not: metin });
    if (error) { bildir(error.message, true); return; }
    bildir(tur === "onayla" ? "✔ Onaylandı. Yazar (ya da yetkili) artık yayına alabilir." : tur === "duzeltme_iste" ? "✔ Düzeltme isteği ve not yazara iletildi." : "✔ İptal edildi."); await yukle();
  }
  function notAlani(x, k, tur) {
    if (k.querySelector(".ok-not-form")) return;
    const f = el("div", "ok-not-form"), t = el("textarea", "ok-girdi"); t.rows = 4; t.placeholder = tur === "duzeltme_iste" ? "Neleri düzeltmeli? Yazarın bakıp kolayca düzenleyebileceği net maddeler yaz…" : "İptal gerekçesi (isteğe bağlı)…";
    t.setAttribute("aria-label", "Not"); const g = dg(tur === "duzeltme_iste" ? "Düzeltme iste" : "İptal et", "ok-birincil", () => { if (tur === "duzeltme_iste" && !t.value.trim()) { bildir("Ne düzeltileceğini yaz.", true); return; } karar(x, tur, t.value.trim() || null); });
    f.append(t, g, dg("Vazgeç", "", () => f.remove())); k.insertBefore(f, k.querySelector(".ok-duzen")); t.focus();
  }
  async function duzenleKur(x, hedef) {
    hedef.append(el("p", "ok-soluk", "Yükleniyor…"));
    const { data, error } = await supabase.from("taslak_icerikler").select("baslik,ozet,govde").eq("id", x.taslak_id).maybeSingle();
    if (error || !data) { hedef.replaceChildren(el("p", "ok-soluk", error?.message || "Taslak okunamadı.")); return; }
    const b = el("input", "ok-girdi"); b.type = "text"; b.value = data.baslik || ""; b.setAttribute("aria-label", "Başlık");
    const o = el("textarea", "ok-girdi"); o.rows = 2; o.value = data.ozet || ""; o.setAttribute("aria-label", "Özet");
    const g = el("textarea", "ok-girdi ok-govde"); g.rows = 14; g.value = data.govde || ""; g.setAttribute("aria-label", "İçerik (Markdown)");
    const kaydet = dg("💾 Kaydet", "ok-birincil", async () => { const { error: e } = await supabase.from("taslak_icerikler").update({ baslik: b.value.trim(), ozet: o.value, govde: g.value }).eq("id", x.taslak_id); if (e) bildir(e.message, true); else { bildir("✔ Kaydedildi."); await yukle(); } });
    hedef.replaceChildren(el("label", "ok-etiket", "Başlık"), b, el("label", "ok-etiket", "Özet"), o, el("label", "ok-etiket", "İçerik (Markdown)"), g, el("div", "ok-eylem", kaydet));
  }
  function notlar(x) {
    const d = el("details", "ok-notlar"); d.append(el("summary", null, `🗒 Düzeltme notları${x.not_sayisi ? ` (${x.not_sayisi})` : ""}`));
    const ic = el("div", "ok-not-ic"); d.append(ic);
    async function yenile() {
      const { data, error } = await supabase.rpc("yazi_inceleme_notlari_getir", { p_taslak_id: x.taslak_id });
      ic.replaceChildren(el("p", "ok-soluk", "Not'lar yazı yayına alınınca ya da taslak silinince otomatik silinir; notu yazan kişi istediğinde de silebilir."));
      if (error) { ic.append(el("p", "ok-soluk", error.message)); return; }
      (data || []).forEach((n) => { const s = el("div", "ok-not"); s.append(el("div", "ok-not-ust", `${n.yazan_ad} · ${tarih(n.created_at)}`), el("div", "ok-not-metin", n.metin));
        if (n.benim) s.append(dg("🗑 Notumu sil", "ok-kucuk", async () => { const r = await supabase.rpc("yazi_not_sil", { p_id: n.id }); if (r.error) bildir(r.error.message, true); else { await yenile(); } })); ic.append(s); });
      if (!(data || []).length) ic.append(el("p", "ok-soluk", "Henüz not yok."));
      const t = el("textarea", "ok-girdi"); t.rows = 2; t.placeholder = "Not / yanıt ekle…"; t.setAttribute("aria-label", "Yeni not");
      ic.append(t, dg("Not ekle", "", async () => { if (!t.value.trim()) return; const r = await supabase.rpc("yazi_not_ekle", { p_taslak_id: x.taslak_id, p_metin: t.value }); if (r.error) bildir(r.error.message, true); else await yenile(); }));
    }
    d.addEventListener("toggle", () => { if (d.open) yenile(); });
    return d;
  }

  kok.classList.add("ok-kok");
  kok.replaceChildren(el("p", "ok-soluk", "Onaya gönderilen taslaklar burada incelenir. Yetkili: onaylar, düzeltme ister (not yazar) ya da iptal eder. Yazar: düzeltme notlarını görür, yazıyı düzenleyip yeniden gönderir. Onaylanan yazı “Tüm Yazılar & Projeler”den yayına alınır."), gonderKutu, cubuk, alan, mesaj);
  await yukle();
}
kur().catch((h) => { console.error("onay-kutusu.js:", h); if (kok) kok.replaceChildren(el("p", "auth-message error", `Onay Kutusu yüklenemedi: ${h?.message || h}`)); });
