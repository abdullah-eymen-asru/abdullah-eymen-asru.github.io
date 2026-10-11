/*
 * assets/js/silme-onayi/silme-onayi.js — "Silinen Hesap Verileri" sekmesi (migration 0078).
 * Hesabını silen üyelerin geride kalan verisini listeler. Gerçek yetki VERİTABANINDADIR (RPC'ler) ve Edge Function'dadır:
 *   - owner  : özeti görür, veri dökümünü indirir, kategorileri seçip KALICI siler (son onay).
 *   - admin  : yalnızca Yetki Ayarları'ndan açıldıysa; inceler ve silme ÖNERİSİ gönderir, kalıcı silemez.
 * Kalıcı silme: delete-account Edge Function (R2 + Storage + satırlar + auth hesabı). innerHTML YOK, inline stil YOK (CSP).
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { dosyaPaneliKur } from "./dosyalar.js";

const DELETE_ACCOUNT_FUNCTION_URL = "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

function el(etiket, oz = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(oz)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null && c !== false) d.append(c);
  return d;
}
const tarih = (iso) => (iso ? new Date(iso).toLocaleString("tr-TR") : "—");
const sayi = (n) => Number(n || 0).toLocaleString("tr-TR");
const hata = (h) => h?.message || String(h);

const kok = document.getElementById("so-kok");
const mesaj = document.getElementById("so-mesaj");
const bildir = (m, t = "info") => { if (mesaj) showMessage(mesaj, m, t); };

let talepler = [];
const secimDurumu = new Map(); // user_id -> {arsiv, icerik}
const hesapSecili = new Set(); // toplu işlem için

function secimAl(t) {
  if (!secimDurumu.has(t.user_id)) {
    const o = t.oneri || {};
    secimDurumu.set(t.user_id, { arsiv: o.arsiv !== false, icerik: o.icerik !== false });
  }
  return secimDurumu.get(t.user_id);
}

async function kaliciSil(t) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hedef_kullanici_id: t.user_id, mod: "kalici", secimler: secimAl(t) }),
  });
  const govde = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(govde.error || `Silinemedi (${res.status})`);
  return govde;
}

async function silmeyiGeriAl(t) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hedef_kullanici_id: t.user_id, mod: "geri_al" }),
  });
  const govde = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(govde.error || `Geri alınamadı (${res.status})`);
}

function onayYaz(metin) {
  const c = window.prompt(`${metin}\n\nDevam etmek için büyük harflerle SİL yaz:`);
  return (c || "").trim().toLocaleUpperCase("tr") === "SİL";
}

async function jsonIndir(t) {
  const { data, error } = await supabase.rpc("hesap_silme_veri_ver", { p_user: t.user_id });
  if (error) throw error;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const u = URL.createObjectURL(blob);
  const a = el("a", { href: u, download: `silinen-uye-${t.user_id.slice(0, 8)}.json`, hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

function satirKutu(etiket, aciklama, kutu) {
  return el("label", { class: "so-secim" }, kutu, el("span", {}, el("strong", { text: etiket }), el("small", { class: "muted", text: aciklama })));
}

function kart(t) {
  const o = t.ozet || {};
  const owner = t.owner_mi === true;
  const sec = secimAl(t);
  const arsivK = el("input", { type: "checkbox", "aria-label": "Dosya Yöneticisi dosyalarını sil" });
  arsivK.checked = sec.arsiv;
  arsivK.addEventListener("change", () => { sec.arsiv = arsivK.checked; });
  const icerikK = el("input", { type: "checkbox", "aria-label": "Yazdığı taslak ve özel içerikleri sil" });
  icerikK.checked = sec.icerik;
  icerikK.addEventListener("change", () => { sec.icerik = icerikK.checked; });
  const sabit = () => { const k = el("input", { type: "checkbox", disabled: true, "aria-hidden": "true" }); k.checked = true; return k; };

  const ad = t.ad || "(adsız üye)";
  const hesapK = owner ? el("input", { type: "checkbox", "aria-label": `${ad} hesabını toplu işleme dahil et` }) : null;
  if (hesapK) { hesapK.checked = hesapSecili.has(t.user_id); hesapK.addEventListener("change", () => { if (hesapK.checked) hesapSecili.add(t.user_id); else hesapSecili.delete(t.user_id); }); }

  const eylem = el("div", { class: "so-eylem" });
  const dosyaKutu = el("div", { class: "so-dosya-kok" });
  let dosyaPanel = null;
  const mesajKart = el("p", { class: "muted so-kart-mesaj", role: "status" });
  const calistir = async (dugme, f) => {
    dugme.disabled = true;
    try { await f(); } catch (h) { mesajKart.textContent = `Hata: ${hata(h)}`; dugme.disabled = false; }
  };

  if (owner) {
    const indir = el("button", { type: "button", class: "so-btn", text: "⬇ Veri dökümü (JSON)" });
    indir.addEventListener("click", () => calistir(indir, async () => { await jsonIndir(t); indir.disabled = false; mesajKart.textContent = "Döküm indirildi. Dosyalar için “Dosyaları incele / indir” düğmesini kullan."; }));
    const sil = el("button", { type: "button", class: "so-btn so-btn-tehlike", text: t.durum === "onerildi" ? "Öneriyi onayla ve kalıcı sil" : "Kalıcı sil (son onay)" });
    sil.addEventListener("click", () => {
      if (!onayYaz(`${ad} hesabının seçili TÜM verileri kalıcı silinecek ve geri alınamaz.`)) return;
      calistir(sil, async () => { await kaliciSil(t); bildir(`${ad}: veriler kalıcı silindi.`, "success"); await yukle(); });
    });
    const geriAl = el("button", { type: "button", class: "so-btn so-btn-birincil", text: "↩ Silmeyi iptal et, erişimi geri ver" });
    geriAl.addEventListener("click", () => {
      if (!window.confirm(`${ad} hesabının silinmesi iptal edilecek ve üye eski erişimine geri dönecek (yeniden giriş yapması gerekir). Devam edilsin mi?`)) return;
      calistir(geriAl, async () => { await silmeyiGeriAl(t); bildir(`${ad}: silme iptal edildi, hesap eski erişimine döndü.`, "success"); await yukle(); });
    });
    // Fiziksel dosyalar (R2): listele / önizle / ZIP olarak indir (migration 0081)
    const dosyaBtn = el("button", { type: "button", class: "so-btn", text: "📁 Dosyaları incele / indir" });
    dosyaBtn.addEventListener("click", () => {
      if (dosyaPanel) { dosyaPanel.temizle(); dosyaPanel = null; dosyaKutu.replaceChildren(); dosyaBtn.textContent = "📁 Dosyaları incele / indir"; return; }
      dosyaPanel = dosyaPaneliKur(dosyaKutu, t.user_id, (m, tur = "error") => { mesajKart.textContent = m; mesajKart.dataset.tur = tur; });
      dosyaBtn.textContent = "📁 Dosya panelini kapat";
    });
    eylem.append(geriAl, dosyaBtn, indir, sil);
    if (t.durum === "onerildi") {
      const sifirla = el("button", { type: "button", class: "so-btn", text: "Öneriyi reddet" });
      sifirla.addEventListener("click", () => calistir(sifirla, async () => { const { error } = await supabase.rpc("hesap_silme_oneri_sifirla", { p_user: t.user_id }); if (error) throw error; await yukle(); }));
      eylem.append(sifirla);
    }
  } else {
    const oner = el("button", { type: "button", class: "so-btn so-btn-birincil", text: t.durum === "onerildi" ? "Öneriyi güncelle" : "Silme önerisi gönder" });
    oner.addEventListener("click", () => calistir(oner, async () => {
      const { error } = await supabase.rpc("hesap_silme_oneri_gonder", { p_user: t.user_id, p_secimler: secimAl(t) });
      if (error) throw error;
      bildir(`${ad}: öneri Site Sahibi'ne iletildi.`, "success");
      await yukle();
    }));
    eylem.append(oner, el("span", { class: "muted", text: "Kalıcı silmenin son onayı Site Sahibi'ndedir." }));
  }

  const ozetSatiri = el("summary", { class: "so-ozet" },
    hesapK,
    el("span", { class: "so-kimlik" },
      el("strong", { text: ad }),
      el("span", { class: "muted", text: [owner && t.eposta ? t.eposta : null, t.rol].filter(Boolean).join(" · ") })),
    el("span", { class: "so-tarih muted", text: tarih(t.created_at) }),
    el("span", { class: `so-rozet ${t.durum === "onerildi" ? "so-rozet-oneri" : ""}`, text: t.durum === "onerildi" ? "Admin önerisi" : "İnceleme bekliyor" }));
  if (hesapK) hesapK.addEventListener("click", (e) => e.stopPropagation());

  const kart = el("details", { class: "so-kart" },
    ozetSatiri,
    el("div", { class: "so-detay" },
      el("dl", { class: "so-bilgi" },
        el("div", {}, el("dt", { text: "Üye" }), el("dd", { text: ad })),
        owner && t.eposta ? el("div", {}, el("dt", { text: "E-posta" }), el("dd", { text: t.eposta })) : null,
        el("div", {}, el("dt", { text: "Rol" }), el("dd", { text: t.rol || "—" })),
        el("div", {}, el("dt", { text: "Silme talebi" }), el("dd", { text: `${tarih(t.created_at)} · ${t.talep_turu === "owner" ? "Site sahibi sildi" : "üye kendisi sildi"}` })),
        t.durum === "onerildi" ? el("div", {}, el("dt", { text: "Admin önerisi" }), el("dd", { text: tarih(t.oneri_at) })) : null),
      el("div", { class: "so-secimler" },
        satirKutu("Dosya Yöneticisi dosyaları", `${sayi(o.arsiv_dosya)} dosya, ${sayi(o.arsiv_klasor)} klasör (R2 dahil kalıcı silinir)`, arsivK),
        satirKutu("Yazdığı taslak ve özel içerikler", `${sayi(o.taslak)} taslak, ${sayi(o.ozel_icerik)} özel içerik (+ ekli dosyaları)`, icerikK),
        satirKutu("Not ekleri ve notlar", `${sayi(o.not_ek)} ek, ${sayi(o.notlar)} şifreli not — hesapla birlikte silinir`, sabit()),
        satirKutu("Akademik Kütüphane", `${sayi(o.akademik)} kaynak, ${sayi(o.akademik_pdf)} PDF — hesapla birlikte silinir`, sabit()),
        satirKutu("Mesajlar, erişim atamaları, onay geçmişi, indirme kayıtları", `${sayi(o.mesaj)} mesaj, ${sayi(o.erisim)} erişim, ${sayi(o.indirme_logu)} kayıt — hesapla birlikte silinir`, sabit())),
      eylem, mesajKart, dosyaKutu));
  kart.open = acikKartlar.has(t.user_id);
  kart.addEventListener("toggle", () => { if (kart.open) acikKartlar.add(t.user_id); else acikKartlar.delete(t.user_id); });
  return kart;
}

const acikKartlar = new Set();
const aramaGirdi = el("input", { type: "search", class: "so-arama", placeholder: "Ad veya e-posta ile ara…", "aria-label": "Silinen hesaplarda ad veya e-posta ara", autocomplete: "off", enterkeyhint: "search" });
const sayac = el("p", { class: "muted so-sayac", role: "status", "aria-live": "polite" });
const ustKab = el("div", { class: "so-ust" });
const listeKab = el("div", { class: "so-liste" });
aramaGirdi.addEventListener("input", () => ciz());

/** Aramaya uyan talepler (ad + e-posta; e-posta yalnızca owner'a gelir). */
function gorunenler() {
  const k = aramaGirdi.value.toLocaleLowerCase("tr").split(/\s+/).filter(Boolean);
  if (!k.length) return talepler;
  return talepler.filter((t) => { const h = `${t.ad || ""} ${t.eposta || ""}`.toLocaleLowerCase("tr"); return k.every((x) => h.includes(x)); });
}

function ciz() {
  const sahip = talepler[0]?.owner_mi === true;
  const liste = gorunenler();
  sayac.textContent = talepler.length ? `${liste.length} / ${talepler.length} hesap gösteriliyor.` : "";
  ustKab.replaceChildren();
  if (sahip && liste.length) {
    const hepsi = el("input", { type: "checkbox", id: "so-hepsi" });
    hepsi.checked = liste.every((t) => hesapSecili.has(t.user_id));
    hepsi.addEventListener("change", () => { liste.forEach((t) => (hepsi.checked ? hesapSecili.add(t.user_id) : hesapSecili.delete(t.user_id))); ciz(); });
    const toplu = el("button", { type: "button", class: "so-btn so-btn-tehlike", text: "Seçili hesapların verilerini kalıcı sil" });
    toplu.addEventListener("click", async () => {
      const secilen = liste.filter((t) => hesapSecili.has(t.user_id));
      if (!secilen.length) { bildir("Önce en az bir hesap seç.", "error"); return; }
      if (!onayYaz(`${secilen.length} hesabın seçili TÜM verileri kalıcı silinecek ve geri alınamaz.`)) return;
      toplu.disabled = true;
      let tamam = 0;
      for (const t of secilen) {
        try { await kaliciSil(t); tamam += 1; hesapSecili.delete(t.user_id); } catch (h) { bildir(`${t.ad || t.user_id}: ${hata(h)} — işlem durduruldu.`, "error"); break; }
      }
      if (tamam) bildir(`${tamam} hesabın verileri kalıcı silindi.`, "success");
      await yukle();
    });
    ustKab.append(el("label", { class: "so-hepsi" }, hepsi, el("span", { text: "Görünenleri seç" })), toplu);
  }
  listeKab.replaceChildren(...(liste.length
    ? liste.map(kart)
    : [el("p", { class: "muted", text: talepler.length ? "Aramayla eşleşen hesap yok." : "Bekleyen silme talebi yok. Hesabını silen üyelerin verileri burada site sahibinin onayını bekler." })]));
}

async function yukle() {
  const { data, error } = await supabase.rpc("hesap_silme_talepleri_getir");
  if (error) {
    listeKab.replaceChildren(el("p", { class: "auth-message error", text: /does not exist|PGRST202|schema cache/i.test(error.message) ? "Gerekli migration (0078) henüz çalıştırılmamış." : error.message }));
    return;
  }
  talepler = data || [];
  for (const id of [...secimDurumu.keys()]) if (!talepler.some((t) => t.user_id === id)) secimDurumu.delete(id);
  ciz();
}

if (kok) kok.replaceChildren(aramaGirdi, sayac, ustKab, listeKab);
if (kok) yukle().catch((h) => { console.error("silme-onayi:", h); kok.replaceChildren(el("p", { class: "auth-message error", text: hata(h) })); });
