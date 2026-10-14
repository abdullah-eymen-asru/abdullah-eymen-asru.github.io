/*
 * assets/js/mesajlasma/arayuz.js — birleşik (üye + yönetici) mesajlaşma arayüzü.
 * Önceki chat.js'teki çift tanımlı wireAdminChat (modül SyntaxError → "Sohbet açılmıyor") bu dosyayla ortadan kalktı.
 * Güvenlik: tüm içerik textContent ile basılır (innerHTML yok). Bellek: sohbet değişince/çıkışta dinleyiciler, kanal,
 * zamanlayıcılar ve arama indeksi temizlenir (sayfadanAyril).
 */
import { supabase } from "../core/supabase-client.js";
import { aliciSeciciKur } from "../mesaj-alici-secici.js";
import { h, doldur, saatMetni, modalSor } from "./dom.js";
import * as V from "./veri.js";
import * as S from "./sifre.js";
import { okunmamisYenile } from "./okunmamis.js";

export async function mesajlasmaKur(kok, { profile, adminMi, konuOnDolgu = "" }) {
  const benim = profile.id;
  const durum = { mod: "gelen", sohbetler: [], cop: [], secili: null, ara: "", arama: null, yukleniyor: false, mesajlar: [] };
  let kanal = null; let yoklama = null; let yenileZaman = null; let aramaZaman = null;

  // ---------- iskelet ----------
  const bildirim = h("div", { class: "auth-message msj-bildirim", role: "status", hidden: true });
  const liste = h("div", { class: "msj-liste", role: "list" });
  const aramaKutu = h("input", { type: "search", class: "msj-ara", placeholder: "Sohbetlerde ara (konu ve içerik)…", "aria-label": "Sohbetlerde ara", autocomplete: "off", maxlength: 80 });
  const yeniBtn = h("button", { type: "button", class: "msj-btn msj-btn--birincil msj-yeni-btn" }, adminMi ? "＋ Yeni mesaj" : "＋ Yeni sohbet");
  const copBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-cop-btn", "aria-pressed": "false" }, "🗑️ Çöp kutusu");
  const yeniAlan = h("div", { class: "msj-yeni-alan", hidden: true });
  const solUst = h("div", { class: "msj-sol-ust" }, yeniBtn, copBtn);
  const copEylem = h("div", { class: "msj-cop-eylem", hidden: true });
  const sol = h("aside", { class: "msj-sol" }, solUst, yeniAlan, aramaKutu, copEylem, liste);

  const baslikEl = h("span", { class: "msj-baslik", text: "Bir sohbet seç" });
  const geriBtn = h("button", { type: "button", class: "msj-geri", "aria-label": "Sohbet listesine dön" }, "←");
  const sabitBtn = h("button", { type: "button", class: "msj-ikon-btn", title: "En üste sabitle", hidden: true }, "📌");
  const copeBtn = h("button", { type: "button", class: "msj-ikon-btn msj-ikon-btn--tehlike", title: "Sohbeti çöp kutusuna taşı", "aria-label": "Sohbeti çöp kutusuna taşı", hidden: true }, "✕");
  const govde = h("div", { class: "msj-govde", role: "log", "aria-live": "polite" }, h("p", { class: "msj-bos", text: "Soldan bir sohbet seç ya da yenisini başlat." }));
  const alan = h("textarea", { class: "msj-metin", placeholder: "Mesajını yaz… (Enter gönderir, Shift+Enter alt satır)", rows: 2, maxlength: 2000, "aria-label": "Mesaj" });
  const gonderBtn = h("button", { type: "submit", class: "msj-btn msj-btn--birincil msj-gonder" }, "Gönder");
  const form = h("form", { class: "msj-form", novalidate: true, hidden: true }, alan, gonderBtn);
  const sag = h("section", { class: "msj-sag" }, h("div", { class: "msj-sag-ust" }, geriBtn, baslikEl, sabitBtn, copeBtn), govde, form);
  const panel = h("div", { class: "msj-panel" }, sol, sag);
  doldur(kok, h("div", { class: "msj-kok", "data-acik": "liste" }, panel, bildirim));
  const kokEl = kok.querySelector(".msj-kok");

  const duyur = (m, hata = false) => { bildirim.textContent = m; bildirim.hidden = !m; bildirim.classList.toggle("auth-message--error", hata); clearTimeout(duyur.z); if (m) duyur.z = setTimeout(() => (bildirim.hidden = true), 6000); };
  const mobilGoster = (n) => (kokEl.dataset.acik = n);

  // ---------- liste ----------
  const kisiAdi = (k) => k?.ad || "—";
  function karsiTaraf(c) {
    if (c.user_id === benim) return c.hedef ? `${kisiAdi(c.hedef)} (${V.rolEtiketi(c.hedef.rol)})` : "Yönetim";
    return `${kisiAdi(c.uye)} (${V.rolEtiketi(c.uye?.rol)})`;
  }
  function satir(c, cop) {
    const sec = () => { if (!cop) sohbetAc(c.id); };
    const ust = h("div", { class: "msj-satir-ust" },
      c.sabit ? h("span", { class: "msj-pin", title: "Sabitlendi", "aria-label": "Sabitlendi" }, "📌") : null,
      h("span", { class: "msj-satir-konu", text: c.konu_gosterim }),
      c.okunmamis ? h("span", { class: "msj-rozet", "aria-label": `${c.okunmamis} okunmamış mesaj`, text: c.okunmamis > 99 ? "99+" : String(c.okunmamis) }) : null);
    const alt = h("div", { class: "msj-satir-alt" }, h("span", { class: "msj-satir-kisi", text: karsiTaraf(c) }), h("span", { class: "msj-satir-zaman", text: c.son ? saatMetni(c.son) : (c.gizlendi_at ? saatMetni(c.gizlendi_at) : "") }));
    const onizle = !cop && c.onizleme ? h("div", { class: "msj-satir-onizleme", text: c.onizleme.slice(0, 90) }) : null;
    const eylem = cop ? h("div", { class: "msj-satir-eylem" },
      h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", onclick: () => geriAlEylem(c) }, "↩ Geri al"),
      h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk", onclick: () => kaliciSilEylem(c) }, "Kalıcı sil")) : null;
    return h("div", { class: `msj-satir${c.id === durum.secili?.id && !cop ? " msj-satir--aktif" : ""}${c.okunmamis ? " msj-satir--yeni" : ""}`, role: "listitem", tabindex: cop ? null : "0",
      onclick: sec, onkeydown: (e) => { if (!cop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sec(); } } }, ust, alt, onizle, eylem);
  }

  async function listeyiCiz() {
    const cop = durum.mod === "cop";
    let kaynak = cop ? durum.cop : V.siralaSohbetler(durum.sohbetler);
    const q = durum.ara.trim().toLocaleLowerCase("tr");
    if (q) {
      let indeks = null;
      if (!cop) indeks = await V.aramaIndeksi(durum.sohbetler);
      kaynak = kaynak.filter((c) => `${c.konu_gosterim} ${karsiTaraf(c)}`.toLocaleLowerCase("tr").includes(q) || (indeks?.get(c.id) || "").includes(q));
    }
    if (!kaynak.length) {
      doldur(liste, h("p", { class: "msj-bos", text: q ? "Eşleşen sohbet yok." : cop ? "Çöp kutusu boş." : adminMi ? "Henüz sohbet yok. “Yeni mesaj” ile başlat." : "Henüz sohbetin yok. “Yeni sohbet” ile başlat." }));
    } else doldur(liste, kaynak.map((c) => satir(c, cop)));
    copBtn.textContent = cop ? "← Gelen kutusu" : `🗑️ Çöp kutusu${durum.copAdet ? ` (${durum.copAdet})` : ""}`;
    copBtn.setAttribute("aria-pressed", String(cop));
    copEylem.hidden = !(cop && durum.cop.length);
    yeniBtn.hidden = cop;
  }

  async function yukle(sessiz) {
    if (durum.yukleniyor) return; durum.yukleniyor = true;
    try {
      durum.sohbetler = await V.sohbetleriYukle();
      if (V.E2EE_AKTIF) { const c = await V.copKutusu().catch(() => []); durum.copAdet = c.length; if (durum.mod === "cop") durum.cop = c; }
      await listeyiCiz();
      if (durum.secili) { const g = durum.sohbetler.find((x) => x.id === durum.secili.id); if (g) { durum.secili = g; } }
    } catch (e) { if (!sessiz) duyur("Sohbetler yüklenemedi: " + (e.message || e), true); }
    finally { durum.yukleniyor = false; }
  }
  const yenileErtele = () => { clearTimeout(yenileZaman); yenileZaman = setTimeout(() => yukle(true), 700); };

  // ---------- sohbet görünümü ----------
  function balon(m) {
    const ben = m.sender_id === benim;
    const sil = h("button", { type: "button", class: "msj-mesaj-sil", "aria-label": "Mesajı sil", onclick: () => mesajSilEylem(m) }, "Sil");
    return h("div", { class: `msj-mesaj ${ben ? "msj-mesaj--ben" : "msj-mesaj--karsi"}`, "data-id": m.id },
      h("span", { class: "msj-gonderen", text: m.gonderen ? `${m.gonderen.ad} (${V.rolEtiketi(m.gonderen.rol)})` : "—" }),
      h("div", { class: `msj-metin-balon${m.cozulemedi ? " msj-metin-balon--hata" : ""}`, text: m.cozulemedi ? "🔒 Bu mesajın şifresi çözülemedi (anahtar bu cihaza/hesaba henüz paylaşılmamış)." : m.metin }),
      h("span", { class: "msj-meta" }, h("span", { title: m.sifreli ? "Uçtan uca şifreli" : "Eski mesaj: şifresiz saklanmış", text: m.sifreli ? "🔒" : "🔓" }), ` ${saatMetni(m.created_at)} `, sil));
  }
  function mesajlariCiz(otoKaydir) {
    const enAltta = otoKaydir || govde.scrollHeight - govde.scrollTop - govde.clientHeight < 80;
    if (!durum.mesajlar.length) doldur(govde, h("p", { class: "msj-bos", text: "Henüz mesaj yok. İlk mesajı sen gönder." }));
    else doldur(govde, durum.mesajlar.map(balon));
    if (enAltta) govde.scrollTop = govde.scrollHeight;
  }

  async function sohbetAc(id) {
    const c = durum.sohbetler.find((x) => x.id === id); if (!c) return;
    durum.secili = c; mobilGoster("sohbet");
    baslikEl.textContent = `${c.konu_gosterim} — ${karsiTaraf(c)}`;
    sabitBtn.hidden = !V.E2EE_AKTIF; copeBtn.hidden = false; form.hidden = false;
    sabitBtn.classList.toggle("msj-ikon-btn--aktif", c.sabit);
    sabitBtn.title = c.sabit ? "Sabitlemeyi kaldır" : "En üste sabitle";
    doldur(govde, h("p", { class: "msj-bos", text: "Yükleniyor…" }));
    try {
      durum.mesajlar = await V.mesajlariYukle(c);
      mesajlariCiz(true);
      if (c.e2ee && S.zarfimVarMi(c.id)) S.eksikZarflariTamamla(c.id);
      else if (c.e2ee) duyur("Bu sohbetin şifre anahtarı sana henüz paylaşılmadı; karşı taraf sohbeti açınca otomatik tamamlanır.", true);
      if (c.okunmamis) { c.okunmamis = 0; await V.okunduIsaretle(c.id); okunmamisYenile(); }
      else V.okunduIsaretle(c.id);
      listeyiCiz();
    } catch (e) { doldur(govde, h("p", { class: "msj-bos", text: "Mesajlar yüklenemedi: " + (e.message || e) })); }
  }

  // ---------- eylemler ----------
  async function gonder() {
    const metin = alan.value.trim(); const c = durum.secili;
    if (!metin || !c) return;
    gonderBtn.disabled = true;
    try {
      await V.mesajGonder(c, metin);
      alan.value = "";
      durum.mesajlar = await V.mesajlariYukle(c); mesajlariCiz(true);
      V.okunduIsaretle(c.id); yenileErtele();
    } catch (e) { duyur("Mesaj gönderilemedi: " + (e.message || e), true); }
    finally { gonderBtn.disabled = false; alan.focus(); }
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); gonder(); });
  alan.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); gonder(); } });

  async function mesajSilEylem(m) {
    const ben = m.sender_id === benim;
    const secenekler = [{ metin: "Sadece benden sil", deger: "ben", tur: "birincil" }];
    if (ben || profile.role === "owner") secenekler.push({ metin: "Herkesten sil", deger: "herkes", tur: "tehlike" });
    secenekler.push({ metin: "Vazgeç", deger: null });
    const s = await modalSor({ baslik: "Mesajı sil", metin: "“Sadece benden sil” mesajı yalnızca senin ekranından kaldırır; karşı taraf görmeye devam eder.", secenekler });
    if (!s) return;
    if (s === "herkes") {
      const o = await modalSor({ baslik: "Herkesten sil", metin: "Bu mesaj karşı tarafın ekranından da silinecektir. Emin misiniz?", secenekler: [{ metin: "Evet, herkesten sil", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
      if (!o) return;
    }
    try {
      await V.mesajiSil(m.id, s === "herkes");
      durum.mesajlar = durum.mesajlar.filter((x) => x.id !== m.id); mesajlariCiz(false); V.aramaIndeksiniTemizle(); yenileErtele();
    } catch (e) { duyur("Mesaj silinemedi: " + (e.message || e), true); }
  }

  copeBtn.addEventListener("click", async () => {
    const c = durum.secili; if (!c) return;
    const o = await modalSor({ baslik: "Çöp kutusuna taşı", metin: "Sohbet çöp kutusuna taşınır; oradan geri alabilir ya da kalıcı olarak silebilirsin. Karşı taraftaki sohbet etkilenmez.", secenekler: [{ metin: "Çöp kutusuna taşı", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    const { error } = await V.copeAt(c.id);
    if (error) return duyur("Taşınamadı: " + error.message, true);
    durum.secili = null; sagiSifirla(); await yukle(); okunmamisYenile();
  });
  sabitBtn.addEventListener("click", async () => {
    const c = durum.secili; if (!c) return;
    const { error } = await V.sabitle(c.id, !c.sabit);
    if (error) return duyur(error.message, true);
    c.sabit = !c.sabit; c.sabit_at = c.sabit ? new Date().toISOString() : null;
    sabitBtn.classList.toggle("msj-ikon-btn--aktif", c.sabit); sabitBtn.title = c.sabit ? "Sabitlemeyi kaldır" : "En üste sabitle";
    listeyiCiz();
  });
  function sagiSifirla() { baslikEl.textContent = "Bir sohbet seç"; sabitBtn.hidden = true; copeBtn.hidden = true; form.hidden = true; doldur(govde, h("p", { class: "msj-bos", text: "Soldan bir sohbet seç ya da yenisini başlat." })); mobilGoster("liste"); }
  geriBtn.addEventListener("click", () => mobilGoster("liste"));

  async function geriAlEylem(c) { const { error } = await V.geriAl(c.id); if (error) return duyur(error.message, true); durum.cop = durum.cop.filter((x) => x.id !== c.id); await yukle(); okunmamisYenile(); }
  async function kaliciSilEylem(c) {
    const o = await modalSor({ baslik: "Kalıcı olarak sil", metin: "Bu sohbetin şifre anahtarın yok edilir ve geri alınamaz. Tüm taraflar kalıcı sildiğinde mesajlar veritabanından tamamen silinir.", secenekler: [{ metin: "Kalıcı sil", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    try { await V.kaliciSil(c.id); durum.cop = durum.cop.filter((x) => x.id !== c.id); durum.copAdet = durum.cop.length; V.aramaIndeksiniTemizle(); await listeyiCiz(); } catch (e) { duyur("Silinemedi: " + (e.message || e), true); }
  }
  const tumunuTemizleBtn = h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk" }, "Tümünü temizle (toplu kalıcı sil)");
  tumunuTemizleBtn.addEventListener("click", async () => {
    const o = await modalSor({ baslik: "Çöp kutusunu boşalt", metin: `Çöp kutusundaki ${durum.cop.length} sohbet kalıcı olarak silinecek. Geri alınamaz.`, secenekler: [{ metin: "Tümünü kalıcı sil", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    try { const r = await V.copuBosalt(); duyur(`${r.islenen} sohbet kalıcı silindi (${r.tamamen_silinen} tanesi veritabanından tamamen kaldırıldı).`); durum.cop = []; durum.copAdet = 0; V.aramaIndeksiniTemizle(); await listeyiCiz(); } catch (e) { duyur("Boşaltılamadı: " + (e.message || e), true); }
  });
  copEylem.append(tumunuTemizleBtn);

  copBtn.addEventListener("click", async () => {
    durum.mod = durum.mod === "cop" ? "gelen" : "cop";
    if (durum.mod === "cop") { try { durum.cop = await V.copKutusu(); durum.copAdet = durum.cop.length; } catch (e) { durum.mod = "gelen"; return duyur("Çöp kutusu açılamadı: " + (e.message || e), true); } }
    await listeyiCiz();
  });
  if (!V.E2EE_AKTIF) copBtn.hidden = true;

  aramaKutu.addEventListener("input", () => { clearTimeout(aramaZaman); aramaZaman = setTimeout(async () => { durum.ara = aramaKutu.value; if (!durum.ara) V.aramaIndeksiniTemizle(); await listeyiCiz(); }, 250); });

  // ---------- yeni sohbet ----------
  let yeniAktif = false;
  function yeniKapat() { yeniAktif = false; yeniAlan.hidden = true; doldur(yeniAlan); yeniBtn.setAttribute("aria-expanded", "false"); }
  async function konuFormu(hedefKullanici, hedefAdmin, kimEtiket, onDolgu) {
    const konu = h("input", { type: "text", maxlength: 120, placeholder: "Konu (ör. Ödeme sorunu)", required: true, "aria-label": "Konu", value: onDolgu || "" });
    const baslat = h("button", { type: "submit", class: "msj-btn msj-btn--birincil" }, "Başlat");
    const f = h("form", { class: "msj-yeni-form", novalidate: true },
      h("div", { class: "msj-yeni-kime" }, h("strong", { text: "Kime: " }), h("span", { text: kimEtiket })), konu,
      h("div", { class: "msj-yeni-btnler" }, baslat, h("button", { type: "button", class: "msj-btn msj-btn--ikincil", onclick: yeniKapat }, "Vazgeç")));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const k = konu.value.trim(); if (!k) return konu.focus();
      baslat.disabled = true;
      try {
        const id = await V.sohbetBaslat({ konu: k, hedefKullanici, hedefAdmin });
        yeniKapat(); await yukle(); await sohbetAc(id); alan.focus();
      } catch (er) { duyur("Sohbet başlatılamadı: " + (er.message || er), true); baslat.disabled = false; }
    });
    doldur(yeniAlan, f); konu.focus();
  }
  async function uyeYeniSohbet(onDolgu) {
    let adaylar = [];
    const { data } = await supabase.rpc("mesaj_hedef_listesi_getir"); adaylar = data || [];
    let secili = null;
    const etiket = h("span", { class: "msj-hedef-deger", text: "Yönetici (fark etmez)" });
    const sec = h("select", { class: "msj-hedef-sec", "aria-label": "Kime" },
      h("option", { value: "", text: "Yönetici (fark etmez — herkes görsün)" }),
      adaylar.map((a) => h("option", { value: a.id, text: `${a.full_name || "—"} (${V.rolEtiketi(a.role)})` })));
    const konu = h("input", { type: "text", maxlength: 120, placeholder: "Konu (ör. Ödeme sorunu)", required: true, "aria-label": "Konu", value: onDolgu || "" });
    const baslat = h("button", { type: "submit", class: "msj-btn msj-btn--birincil" }, "Başlat");
    const f = h("form", { class: "msj-yeni-form", novalidate: true }, h("label", { class: "msj-yeni-kime" }, h("strong", { text: "Kime: " }), sec), konu,
      h("div", { class: "msj-yeni-btnler" }, baslat, h("button", { type: "button", class: "msj-btn msj-btn--ikincil", onclick: yeniKapat }, "Vazgeç")));
    void etiket; void secili;
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const k = konu.value.trim(); if (!k) return konu.focus();
      baslat.disabled = true;
      try { const id = await V.sohbetBaslat({ konu: k, hedefAdmin: sec.value || null }); yeniKapat(); await yukle(); await sohbetAc(id); alan.focus(); }
      catch (er) { duyur("Sohbet başlatılamadı: " + (er.message || er), true); baslat.disabled = false; }
    });
    doldur(yeniAlan, f); (onDolgu ? konu : sec).focus();
  }
  function adminYeniSohbet() {
    const kap = h("div", { class: "msg-alici" });
    doldur(yeniAlan, kap);
    aliciSeciciKur({ kok: kap, onKapat: yeniKapat, onSec: (u) => konuFormu(u.id, null, `${u.isim} (${V.rolEtiketi(u.rol)})`, "") });
  }
  yeniBtn.addEventListener("click", () => {
    if (yeniAktif) return yeniKapat();
    yeniAktif = true; yeniAlan.hidden = false; yeniBtn.setAttribute("aria-expanded", "true"); mobilGoster("liste");
    adminMi ? adminYeniSohbet() : uyeYeniSohbet("");
  });

  // ---------- canlı güncelleme ----------
  kanal = supabase.channel(`msj-${benim}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (p) => {
      const m = p.new;
      if (durum.secili && m.conversation_id === durum.secili.id && !durum.mesajlar.some((x) => x.id === m.id)) {
        durum.mesajlar.push(await V.mesajiCoz(m, m.conversation_id)); mesajlariCiz(false);
        if (m.sender_id !== benim) V.okunduIsaretle(m.conversation_id);
      }
      V.aramaIndeksiniTemizle(); yenileErtele(); if (m.sender_id !== benim) okunmamisYenile();
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (p) => {
      const id = p.old?.id; if (id && durum.mesajlar.some((x) => x.id === id)) { durum.mesajlar = durum.mesajlar.filter((x) => x.id !== id); mesajlariCiz(false); }
      V.aramaIndeksiniTemizle(); yenileErtele(); okunmamisYenile();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, yenileErtele)
    .subscribe();
  yoklama = setInterval(() => { if (!document.hidden) yukle(true); }, 60000); // yedek; asıl güncelleme realtime

  function sayfadanAyril() {
    clearInterval(yoklama); clearTimeout(yenileZaman); clearTimeout(aramaZaman);
    if (kanal) supabase.removeChannel(kanal); kanal = null;
    V.aramaIndeksiniTemizle(); S.anahtarlariBirak();
  }
  window.addEventListener("pagehide", sayfadanAyril, { once: true });

  await yukle();
  if (konuOnDolgu) {
    if (durum.sohbetler.length) await sohbetAc(V.siralaSohbetler(durum.sohbetler)[0].id);
    else { yeniAktif = true; yeniAlan.hidden = false; adminMi ? adminYeniSohbet() : uyeYeniSohbet(konuOnDolgu); }
  }
  return { sayfadanAyril };
}
