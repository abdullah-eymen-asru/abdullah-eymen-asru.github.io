/**
 * assets/js/duyuru/duyuru-yonetim.js — Panel › Sistem › "Site Duyuruları" (migration 0113).
 * Site sahibi ve (Yetki Ayarları › "Site Duyuruları" AÇIKSA) yönetici: duyuru yazar/düzenler/yayına alır-kapatır, kimlerin okuduğunu görür ve arar.
 * SİLME yalnızca Site Sahibi: duyuruyu silmek ve okuma kayıtlarını silmek (tek üye / hepsi). Yönetici bu düğmeleri hiç görmez; asıl sınır SQL'dedir
 * (duyuru_sil / duyuru_okuma_kayitlarini_sil → is_owner()). innerHTML YOK; tüm metinler textContent (XSS yok). CSP: inline stil yok.
 */
import { supabase } from "../core/supabase-client.js";

const kok = document.getElementById("dy-kok");
const TUR = { bilgi: "ℹ️ Bilgi", uyari: "⚠️ Uyarı", kritik: "🚨 Kritik" };
const HEDEF = { hepsi: "Ziyaretçiler + üyeler", ziyaretci: "Yalnızca ziyaretçiler (açılış penceresi)", uye: "Yalnızca üyeler (panel şeridi)" };

function el(etiket, ozellik = {}, ...cocuk) {
  const n = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "hidden" || k === "disabled" || k === "checked" || k === "required") n[k] = !!v; else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuk.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const tarihYaz = (iso) => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");
const yerelGirdi = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const hata = (h) => (/42501|Yetkisiz|yalnızca Site Sahibi/i.test(h?.message || "") ? "Bu işlem için yetkin yok." : /does not exist|schema cache/i.test(h?.message || "") ? "Duyuru tabloları yok: Supabase'de 0113 migration'ı çalıştırılmalı." : h?.message || "Beklenmeyen hata.");

async function baslat() {
  if (!kok) return;
  let yetkili = false, sahip = false;
  try {
    const [y, u] = await Promise.all([supabase.rpc("duyuru_yonetim_yetkili"), supabase.auth.getUser()]);
    yetkili = !y.error && y.data === true;
    if (yetkili && u.data?.user) { const { data } = await supabase.from("profiles").select("role").eq("id", u.data.user.id).maybeSingle(); sahip = data?.role === "owner"; }
  } catch { yetkili = false; }
  if (!yetkili) { kok.replaceChildren(el("p", { class: "muted", text: "Site Duyuruları bu hesap için açık değil. Site Sahibi, Yetki Ayarları › Özellikler tablosundan yönetici için açabilir." })); return; }

  const durum = el("p", { class: "auth-message", role: "status", hidden: true });
  const bildir = (m, tur = "success") => { durum.hidden = !m; durum.textContent = m || ""; durum.className = `auth-message ${tur}`; };
  const liste = el("div", { class: "dy-liste" });
  let duzenle = null, tum = [];

  /* ------------------------------- form ------------------------------- */
  const g = { baslik: el("input", { type: "text", class: "dy-girdi", maxlength: "120", required: true, "aria-label": "Başlık", placeholder: "Örn. Planlı bakım: site 02:00–03:00 arası kapalı" }),
    metin: el("textarea", { class: "dy-girdi dy-metin", rows: "4", maxlength: "2000", required: true, "aria-label": "Mesaj", placeholder: "Ziyaretçilere ve üyelere gösterilecek mesaj (düz metin; satır sonları korunur)" }),
    tur: el("select", { class: "dy-girdi", "aria-label": "Tür" }, ...Object.entries(TUR).map(([k, v]) => el("option", { value: k, text: v }))),
    hedef: el("select", { class: "dy-girdi", "aria-label": "Kime gösterilsin" }, ...Object.entries(HEDEF).map(([k, v]) => el("option", { value: k, text: v }))),
    url: el("input", { type: "url", class: "dy-girdi", maxlength: "500", "aria-label": "Bağlantı (https://…)", placeholder: "https://… (isteğe bağlı)" }),
    urlMetin: el("input", { type: "text", class: "dy-girdi", maxlength: "40", "aria-label": "Bağlantı yazısı", placeholder: "Bağlantı yazısı (örn. Ayrıntılar)" }),
    bas: el("input", { type: "datetime-local", class: "dy-girdi", "aria-label": "Başlangıç" }), bit: el("input", { type: "datetime-local", class: "dy-girdi", "aria-label": "Bitiş" }),
    aktif: el("input", { type: "checkbox", id: "dy-aktif" }), yeniden: el("input", { type: "checkbox", id: "dy-yeniden" }) };
  g.aktif.checked = true;
  const sayac = el("small", { class: "muted", text: "0 / 2000" });
  g.metin.addEventListener("input", () => { sayac.textContent = `${g.metin.value.length} / 2000`; onizle(); });
  const onizlemeKutu = el("div", { class: "dy-onizleme", "aria-live": "polite" });
  function onizle() {
    onizlemeKutu.className = `dy-onizleme dy-tur-${g.tur.value}`;
    onizlemeKutu.replaceChildren(el("strong", { text: g.baslik.value || "Başlık burada görünür" }), ...(g.metin.value || "Mesaj burada görünür.").split("\n").map((s) => el("p", { text: s })));
  }
  for (const a of [g.baslik, g.tur]) { a.addEventListener("input", onizle); a.addEventListener("change", onizle); }
  const yenidenEtiket = el("label", { class: "dy-onay", for: "dy-yeniden", hidden: true }, g.yeniden, el("span", { text: "Daha önce okuyanlara yeniden göster (içerik değişmese de)" }));
  const kaydetBtn = el("button", { type: "submit", class: "btn dy-btn", text: "Kaydet" });
  const iptalBtn = el("button", { type: "button", class: "btn secondary dy-btn", text: "Yeni duyuru / Temizle" });
  const formBaslik = el("h2", { text: "Yeni duyuru" });
  function formSifirla() {
    duzenle = null; formBaslik.textContent = "Yeni duyuru";
    g.baslik.value = ""; g.metin.value = ""; g.tur.value = "bilgi"; g.hedef.value = "hepsi"; g.url.value = ""; g.urlMetin.value = ""; g.bas.value = ""; g.bit.value = ""; g.aktif.checked = true; g.yeniden.checked = false;
    yenidenEtiket.hidden = true; sayac.textContent = "0 / 2000"; kaydetBtn.textContent = "Kaydet"; onizle();
  }
  function formDoldur(d) {
    duzenle = d.id; formBaslik.textContent = "Duyuruyu düzenle";
    g.baslik.value = d.baslik; g.metin.value = d.metin; g.tur.value = d.tur; g.hedef.value = d.hedef; g.url.value = d.baglanti_url || ""; g.urlMetin.value = d.baglanti_metin || "";
    g.bas.value = yerelGirdi(d.baslangic); g.bit.value = yerelGirdi(d.bitis); g.aktif.checked = d.aktif; g.yeniden.checked = false; yenidenEtiket.hidden = false;
    sayac.textContent = `${d.metin.length} / 2000`; kaydetBtn.textContent = "Değişiklikleri kaydet"; onizle(); form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const form = el("form", { class: "dy-form", novalidate: true }, formBaslik,
    el("label", { class: "dy-etiket", text: "Başlık" }), g.baslik, el("label", { class: "dy-etiket", text: "Mesaj" }), g.metin, sayac,
    el("div", { class: "dy-iki" }, el("div", {}, el("label", { class: "dy-etiket", text: "Tür" }), g.tur), el("div", {}, el("label", { class: "dy-etiket", text: "Kime" }), g.hedef)),
    el("div", { class: "dy-iki" }, el("div", {}, el("label", { class: "dy-etiket", text: "Bağlantı (isteğe bağlı, yalnızca https)" }), g.url), el("div", {}, el("label", { class: "dy-etiket", text: "Bağlantı yazısı" }), g.urlMetin)),
    el("div", { class: "dy-iki" }, el("div", {}, el("label", { class: "dy-etiket", text: "Başlangıç (boşsa hemen)" }), g.bas), el("div", {}, el("label", { class: "dy-etiket", text: "Bitiş (boşsa sınırsız)" }), g.bit)),
    el("label", { class: "dy-onay", for: "dy-aktif" }, g.aktif, el("span", { text: "Yayında (kapalıysa taslak olarak saklanır)" })), yenidenEtiket,
    el("p", { class: "muted dy-not", text: "Önizleme (ziyaretçi penceresi ve üye şeridi aynı metni gösterir):" }), onizlemeKutu,
    el("div", { class: "dy-eylem" }, kaydetBtn, iptalBtn));
  iptalBtn.addEventListener("click", formSifirla);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); bildir("");
    if (!g.baslik.value.trim() || !g.metin.value.trim()) return bildir("Başlık ve mesaj zorunlu.", "error");
    if (g.url.value.trim() && !/^https:\/\//i.test(g.url.value.trim())) return bildir("Bağlantı https:// ile başlamalı.", "error");
    const bas = g.bas.value ? new Date(g.bas.value).toISOString() : null, bit = g.bit.value ? new Date(g.bit.value).toISOString() : null;
    if (bas && bit && new Date(bit) <= new Date(bas)) return bildir("Bitiş, başlangıçtan sonra olmalı.", "error");
    kaydetBtn.disabled = true;
    try {
      const { error } = await supabase.rpc("duyuru_kaydet", { p_id: duzenle, p_baslik: g.baslik.value, p_metin: g.metin.value, p_tur: g.tur.value, p_hedef: g.hedef.value, p_baglanti_url: g.url.value, p_baglanti_metin: g.urlMetin.value, p_aktif: g.aktif.checked, p_baslangic: bas, p_bitis: bit, p_yeniden_goster: g.yeniden.checked });
      if (error) throw error;
      bildir(duzenle ? "Duyuru güncellendi." : "Duyuru kaydedildi."); formSifirla(); await yukle();
    } catch (h) { bildir(hata(h), "error"); } finally { kaydetBtn.disabled = false; }
  });

  /* ------------------------------- liste ------------------------------- */
  function durumRozeti(d) {
    const simdi = Date.now();
    if (!d.aktif) return ["Kapalı", "kapali"];
    if (d.baslangic && new Date(d.baslangic) > simdi) return ["Zamanlanmış", "zaman"];
    if (d.bitis && new Date(d.bitis) <= simdi) return ["Süresi doldu", "kapali"];
    return ["Yayında", "yayin"];
  }
  function okuyanPaneli(d, kutu) {
    let ofset = 0, toplam = 0, ara = "", zaman = null;
    const arama = el("input", { type: "search", class: "dy-girdi", "aria-label": "Okuyanlarda ara (ad, soyad, e-posta)", placeholder: "Okuyanlarda ara: ad, soyad ya da e-posta (en az 2 harf)", autocomplete: "off" });
    const sonuc = el("div", { class: "dy-okuyanlar" }), daha = el("button", { type: "button", class: "btn secondary dy-btn", text: "Daha fazla", hidden: true }), bilgi = el("small", { class: "muted" });
    async function getir(sifirla) {
      if (sifirla) { ofset = 0; sonuc.replaceChildren(); }
      bilgi.textContent = "Yükleniyor…";
      try {
        const { data, error } = await supabase.rpc("duyuru_okuyanlar", { p_id: d.id, p_ara: ara || null, p_limit: 30, p_offset: ofset });
        if (error) throw error;
        toplam = data?.[0]?.toplam ? Number(data[0].toplam) : sifirla ? 0 : toplam;
        for (const r of data || []) {
          const sil = sahip ? el("button", { type: "button", class: "dy-sil", "aria-label": `${r.ad} okuma kaydını sil`, text: "Kaydı sil" }) : null;
          const satir = el("div", { class: "dy-okuyan" }, el("div", { class: "dy-okuyan-bilgi" }, el("strong", { text: r.ad }), el("small", { class: "muted", text: `${r.eposta_maskeli || "—"} · ${r.rol || "üye"}` })),
            el("small", { class: "muted", text: tarihYaz(r.okundu) }), sil);
          sil?.addEventListener("click", async () => {
            if (!window.confirm(`${r.ad} için okuma kaydı silinsin mi? (Duyuru aktifse bu üyeye yeniden gösterilir.)`)) return;
            try { const { error: e } = await supabase.rpc("duyuru_okuma_kayitlarini_sil", { p_id: d.id, p_user: r.user_id }); if (e) throw e; satir.remove(); bildir("Okuma kaydı silindi."); } catch (h) { bildir(hata(h), "error"); }
          });
          sonuc.append(satir);
        }
        ofset += (data || []).length;
        bilgi.textContent = toplam ? `${toplam} kayıttan ${Math.min(ofset, toplam)} tanesi gösteriliyor.` : ara ? "Eşleşen okuyan yok." : "Henüz kimse kapatmadı/okumadı.";
        daha.hidden = ofset >= toplam;
      } catch (h) { bilgi.textContent = hata(h); }
    }
    arama.addEventListener("input", () => { clearTimeout(zaman); const v = arama.value.trim(); if (v.length === 1) { bilgi.textContent = "En az 2 harf yaz."; return; } zaman = setTimeout(() => { ara = v; getir(true); }, 300); });
    daha.addEventListener("click", () => getir(false));
    const hepsiniSil = sahip ? el("button", { type: "button", class: "btn secondary dy-btn dy-tehlike", text: "Bu duyurunun TÜM okuma kayıtlarını sil" }) : null;
    hepsiniSil?.addEventListener("click", async () => {
      if (!window.confirm("Bu duyurunun TÜM okuma kayıtları kalıcı olarak silinecek. Duyuru yayındaysa herkese yeniden gösterilir. Devam edilsin mi?")) return;
      try { const { data, error } = await supabase.rpc("duyuru_okuma_kayitlarini_sil", { p_id: d.id, p_user: null }); if (error) throw error; bildir(`${data ?? 0} okuma kaydı silindi.`); await yukle(); } catch (h) { bildir(hata(h), "error"); }
    });
    kutu.replaceChildren(el("p", { class: "muted dy-not", text: "E-postalar maskelidir (ab***@g***.com); arama yine de tam e-postaya göre sunucuda yapılır. Yalnızca duyuruyu kapatan üyeler listelenir." }), arama, bilgi, sonuc, daha, hepsiniSil);
    getir(true);
  }
  function kartCiz(d) {
    const [dt, dsinif] = durumRozeti(d);
    const okuKutu = el("div", { class: "dy-oku-kutu", hidden: true });
    const yuzde = d.uye_sayisi ? Math.min(100, Math.round((Number(d.okuyan_sayisi) / Number(d.uye_sayisi)) * 100)) : 0;
    const okuBtn = el("button", { type: "button", class: "btn secondary dy-btn", text: `👁 Okuyanlar (${d.okuyan_sayisi})`, "aria-expanded": "false" });
    okuBtn.addEventListener("click", () => { okuKutu.hidden = !okuKutu.hidden; okuBtn.setAttribute("aria-expanded", String(!okuKutu.hidden)); if (!okuKutu.hidden && !okuKutu.childElementCount) okuyanPaneli(d, okuKutu); });
    const durumBtn = el("button", { type: "button", class: "btn secondary dy-btn", text: d.aktif ? "⏸ Yayından kaldır" : "▶ Yayına al" });
    durumBtn.addEventListener("click", async () => { try { const { error } = await supabase.rpc("duyuru_durum_ayarla", { p_id: d.id, p_aktif: !d.aktif }); if (error) throw error; bildir(d.aktif ? "Duyuru yayından kaldırıldı." : "Duyuru yayına alındı."); await yukle(); } catch (h) { bildir(hata(h), "error"); } });
    const duzBtn = el("button", { type: "button", class: "btn secondary dy-btn", text: "✏️ Düzenle" }); duzBtn.addEventListener("click", () => formDoldur(d));
    const silBtn = sahip ? el("button", { type: "button", class: "btn secondary dy-btn dy-tehlike", text: "🗑 Sil" }) : null;
    silBtn?.addEventListener("click", async () => { if (!window.confirm("Duyuru VE tüm okuma kayıtları kalıcı olarak silinecek. Devam edilsin mi?")) return; try { const { error } = await supabase.rpc("duyuru_sil", { p_id: d.id }); if (error) throw error; bildir("Duyuru silindi."); if (duzenle === d.id) formSifirla(); await yukle(); } catch (h) { bildir(hata(h), "error"); } });
    return el("article", { class: `dy-kart dy-tur-${d.tur}` },
      el("div", { class: "dy-kart-ust" }, el("strong", { text: d.baslik }), el("span", { class: `dy-rozet dy-${dsinif}`, text: dt })),
      el("small", { class: "muted", text: `${TUR[d.tur]} · ${HEDEF[d.hedef]} · sürüm ${d.surum} · güncelleme ${tarihYaz(d.guncelleme)}${d.baslangic ? ` · başlangıç ${tarihYaz(d.baslangic)}` : ""}${d.bitis ? ` · bitiş ${tarihYaz(d.bitis)}` : ""}` }),
      el("p", { class: "dy-metin-onizle", text: d.metin.length > 220 ? `${d.metin.slice(0, 220)}…` : d.metin }),
      el("div", { class: "dy-oran", role: "img", "aria-label": `Üyelerin %${yuzde}'i okudu` }, el("span", { class: `dy-oran-dolgu dy-oran-${Math.round(yuzde / 10) * 10}` })),
      el("small", { class: "muted", text: `${d.okuyan_sayisi} / ${d.uye_sayisi} üye kapattı (%${yuzde})` }),
      el("div", { class: "dy-eylem" }, duzBtn, durumBtn, okuBtn, silBtn), okuKutu);
  }
  async function yukle() {
    try {
      const { data, error } = await supabase.rpc("duyuru_listele"); if (error) throw error;
      tum = data || [];
      liste.replaceChildren(...(tum.length ? tum.map(kartCiz) : [el("p", { class: "muted", text: "Henüz duyuru yok. Yukarıdaki formdan ilkini oluştur." })]));
    } catch (h) { liste.replaceChildren(el("p", { class: "auth-message error", text: hata(h) })); }
  }

  kok.replaceChildren(
    el("p", { class: "muted", text: sahip ? "Site Sahibi: duyuru oluşturabilir, yayından kaldırabilir, okuyanları görüp arayabilir, duyuruyu ve okuma kayıtlarını silebilirsin." : "Yönetici: duyuru oluşturabilir, düzenleyebilir, yayına alıp kaldırabilir, okuyanları görüp arayabilirsin. Duyuru ve okuma kaydı SİLME yetkisi yalnızca Site Sahibindedir." }),
    el("p", { class: "muted dy-not", text: "Ziyaretçiler siteye girince bir uyarı penceresi görür; üyeler panelde kapatana kadar üstte ince bir şerit görür. Kapatan üyenin adı ve zamanı burada listelenir." }),
    durum, form, el("h2", { text: "Duyurular" }), liste);
  formSifirla(); await yukle();
}
baslat();
