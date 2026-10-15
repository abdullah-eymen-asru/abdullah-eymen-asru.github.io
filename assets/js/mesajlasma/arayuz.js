/*
 * assets/js/mesajlasma/arayuz.js — birleşik (üye + yönetici) mesajlaşma arayüzü.   [2026-10 nihai mimari]
 *  • ✕ yalnızca açık sohbeti KAPATIR (panel temiz başlangıca döner); sohbeti çöpe atmak AYRI "🗑️ Çöp kutusuna taşı" düğmesidir (✕'in solunda).
 *  • "Herkesten sil" YALNIZCA mesajın GÖNDERENİ içindir (Site Sahibi dahil kimse karşı tarafın mesajını herkesten silemez; sunucu da reddeder).
 *  • Üye: hazır "Yönetim ile İletişim" kartları. Yönetici/Site Sahibi: üye seçici (ad + rol; e-posta ASLA gösterilmez, e-posta ile aranabilir).
 *  • İletildi/Okundu: ✓ (gri) = sunucuya ulaştı, ✓✓ (mavi) = karşı taraf okudu (grupta herkes okuyunca).
 *  • Gruplar: "Yönetim Ekip Odası" gibi ekip grupları; seçilen normal üyeler de eklenebilir (yalnızca Site Sahibi/yönetici kurar).
 *  • Bildirim: yalnızca bu sayfanın sağ üstündeki "🔔 Bildirimleri Aç" anahtarı; sohbet bazında "Sessize al".
 *  • E2EE kilidi: "Özel anahtar açılamadı" artık hata değil, Kurtarma Parolası paneli (kurtarma.js).
 *  • Realtime: TEK kanal (canli.js); sekme değişince dinleyici çıkarılır (dash:gorunum olayı) → çift abonelik/sızıntı yok.
 * Güvenlik: tüm içerik textContent ile basılır (innerHTML yok), inline stil/olay yok (CSP).
 */
import { supabase } from "../core/supabase-client.js";
import { aliciSeciciKur } from "../mesaj-alici-secici.js";
import { h, doldur, saatMetni, modalSor } from "./dom.js";
import * as V from "./veri.js";
import * as S from "./sifre.js";
import { okunmamisYenile } from "./okunmamis.js";
import { canliBaslat, canliDinle } from "./canli.js";
import { kilitPaneli, kurtarmaAyariAc } from "./kurtarma.js";
import { bildirimDurumu, bildirimAc, bildirimKapat, acikSohbetAyarla, bildirimTiklamasiniDinle } from "./bildirim.js";
import { anahtarDurumu } from "../r2-arsiv/e2ee.js";

let AKTIF_ORNEK = null; // SPA'da ikinci kurulumda eskisi temizlenir (çift dinleyici/zamanlayıcı yok)
const SOHBET_GORUNUMU = "users-mesajlar";
const kilitMi = (e) => e?.kod === "OZEL_ANAHTAR_ACILAMADI";

export async function mesajlasmaKur(kok, { profile, adminMi, konuOnDolgu = "" }) {
  AKTIF_ORNEK?.sayfadanAyril?.();
  const benim = profile.id;
  const durum = { mod: "gelen", sohbetler: [], cop: [], secili: null, ara: "", yukleniyor: false, mesajlar: [], karsiOkundu: null, yonetim: null, kilitli: false, copAdet: 0 };
  let yoklama = null; let yenileZaman = null; let aramaZaman = null; let okunduZaman = null; let canliCik = null; let tiklamaCik = null; let duraklatildi = false;

  // ---------- iskelet ----------
  const bildirim = h("div", { class: "auth-message msj-bildirim", role: "status", hidden: true });
  const uyari = h("div", { class: "msj-uyari", hidden: true });
  const liste = h("div", { class: "msj-liste", role: "list" });
  const aramaKutu = h("input", { type: "search", class: "msj-ara", placeholder: "Sohbetlerde ara (konu ve içerik)…", "aria-label": "Sohbetlerde ara", autocomplete: "off", maxlength: 80 });
  const yeniBtn = h("button", { type: "button", class: "msj-btn msj-btn--birincil msj-yeni-btn" }, adminMi ? "＋ Yeni mesaj" : "＋ Yeni sohbet");
  const grupBtn = adminMi ? h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-grup-btn", title: "Ekip / grup sohbeti kur" }, "👥 Yeni grup") : null;
  const copBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-cop-btn", "aria-pressed": "false" }, "🗑️ Çöp kutusu");
  const yeniAlan = h("div", { class: "msj-yeni-alan", hidden: true });
  const solUst = h("div", { class: "msj-sol-ust" }, yeniBtn, grupBtn, copBtn);
  const copEylem = h("div", { class: "msj-cop-eylem", hidden: true });
  const sol = h("aside", { class: "msj-sol" }, solUst, yeniAlan, aramaKutu, copEylem, liste);

  const baslikEl = h("span", { class: "msj-baslik", text: "Bir sohbet seç" });
  const geriBtn = h("button", { type: "button", class: "msj-geri", "aria-label": "Sohbet listesine dön" }, "←");
  const uyelerBtn = h("button", { type: "button", class: "msj-ikon-btn", title: "Grup üyeleri", "aria-label": "Grup üyeleri", hidden: true }, "👥");
  const sabitBtn = h("button", { type: "button", class: "msj-ikon-btn", title: "En üste sabitle", hidden: true }, "📌");
  const sessizBtn = h("button", { type: "button", class: "msj-ikon-btn", title: "Bu sohbeti sessize al", "aria-label": "Bu sohbeti sessize al", "aria-pressed": "false", hidden: true }, "🔔");
  const copeTasiBtn = h("button", { type: "button", class: "msj-ikon-btn msj-ikon-btn--etiketli msj-ikon-btn--tehlike", title: "Çöp Kutusuna Taşı", "aria-label": "Sohbeti çöp kutusuna taşı", hidden: true }, h("span", { "aria-hidden": "true", text: "🗑️" }), h("span", { class: "msj-ikon-etiket", text: "Çöp kutusuna taşı" }));
  const kapatBtn = h("button", { type: "button", class: "msj-ikon-btn", title: "Sohbeti kapat", "aria-label": "Sohbeti kapat", hidden: true }, "✕");
  const govde = h("div", { class: "msj-govde", role: "log", "aria-live": "polite" }, h("p", { class: "msj-bos", text: "Soldan bir sohbet seç ya da yenisini başlat." }));
  const alan = h("textarea", { class: "msj-metin", placeholder: "Mesajını yaz… (Enter gönderir, Shift+Enter alt satır)", rows: 2, maxlength: 2000, "aria-label": "Mesaj" });
  const gonderBtn = h("button", { type: "submit", class: "msj-btn msj-btn--birincil msj-gonder" }, "Gönder");
  const form = h("form", { class: "msj-form", novalidate: true, hidden: true }, alan, gonderBtn);
  const sag = h("section", { class: "msj-sag" }, h("div", { class: "msj-sag-ust" }, geriBtn, baslikEl, uyelerBtn, sabitBtn, sessizBtn, copeTasiBtn, kapatBtn), govde, form);
  const panel = h("div", { class: "msj-panel" }, sol, sag);

  // Üst şerit: SAĞ ÜSTTE bildirim anahtarı (+ kurtarma parolası). İzin ASLA kendiliğinden istenmez.
  const bildirimBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-bildirim-btn", "aria-pressed": "false" });
  const kurtarmaBtn = V.E2EE_AKTIF ? h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kurtarma-btn", title: "Başka cihazda sohbetlerini açabilmek için kurtarma parolası" }, "🔑 Kurtarma parolası") : null;
  const ustbar = h("div", { class: "msj-ustbar" }, h("span", { class: "msj-ustbar-bilgi", text: "Mesajlar uçtan uca şifrelidir." }), h("div", { class: "msj-ustbar-eylem" }, kurtarmaBtn, bildirimBtn));
  doldur(kok, h("div", { class: "msj-kok", "data-acik": "liste" }, ustbar, uyari, panel, bildirim));
  const kokEl = kok.querySelector(".msj-kok");

  const duyur = (m, hata = false) => { bildirim.textContent = m; bildirim.hidden = !m; bildirim.classList.toggle("auth-message--error", hata); clearTimeout(duyur.z); if (m) duyur.z = setTimeout(() => (bildirim.hidden = true), 6000); };
  const mobilGoster = (n) => (kokEl.dataset.acik = n);

  // ---------- bildirim anahtarı ----------
  function bildirimBtnCiz() {
    const d = bildirimDurumu();
    bildirimBtn.disabled = d === "desteklenmiyor" || d === "reddedildi";
    bildirimBtn.setAttribute("aria-pressed", String(d === "acik"));
    bildirimBtn.textContent = d === "acik" ? "🔔 Bildirimler açık — kapat" : d === "reddedildi" ? "🔕 Tarayıcıda engelli" : d === "desteklenmiyor" ? "🔕 Bildirim desteklenmiyor" : "🔔 Bildirimleri Aç";
    bildirimBtn.title = d === "reddedildi" ? "Tarayıcı ayarlarından bu site için bildirim iznini açman gerekir." : "";
  }
  bildirimBtn.addEventListener("click", async () => {
    bildirimBtn.disabled = true;
    try {
      const d = bildirimDurumu();
      if (d === "acik") { await bildirimKapat(); duyur("Bildirimler kapatıldı."); }
      else { const s = await bildirimAc(); duyur(s === "acik" ? "Bildirimler açıldı. Bildirimde mesaj metni görünmez; tıklayınca sohbet açılır." : "Bildirim izni verilmedi.", s !== "acik"); }
    } finally { bildirimBtnCiz(); }
  });
  bildirimBtnCiz();
  kurtarmaBtn?.addEventListener("click", async () => { if (await kurtarmaAyariAc(duyur)) uyariKontrol(true); });

  // Kurtarma parolası yoksa bir kez (oturum başına) nazikçe hatırlat.
  async function uyariKontrol(gizle = false) {
    if (!V.E2EE_AKTIF) return;
    let atla = false; try { atla = sessionStorage.getItem("aea_msj_kurtarma_sonra") === "1"; } catch { /* depo kapalı */ }
    if (gizle || atla) { uyari.hidden = true; return; }
    try {
      const d = await anahtarDurumu();
      if (d.kurtarma_var) { uyari.hidden = true; return; }
      const belirle = h("button", { type: "button", class: "msj-btn msj-btn--birincil msj-kucuk", text: "Kurtarma parolası belirle" });
      const sonra = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", text: "Sonra" });
      belirle.addEventListener("click", async () => { if (await kurtarmaAyariAc(duyur)) uyari.hidden = true; });
      sonra.addEventListener("click", () => { try { sessionStorage.setItem("aea_msj_kurtarma_sonra", "1"); } catch { /* yok say */ } uyari.hidden = true; });
      doldur(uyari, h("span", { text: "🔑 Farklı bir cihazdan girince ya da kasa anahtarı değişirse sohbetlerini açabilmek için bir kurtarma parolası belirle." }), h("span", { class: "msj-uyari-eylem" }, belirle, sonra));
      uyari.hidden = false;
    } catch { /* migration 0095 yoksa sessiz */ }
  }

  // ---------- liste ----------
  const kisiAdi = (k) => k?.ad || "—";
  function karsiTaraf(c) {
    if (c.grup) return "Grup sohbeti";
    if (c.user_id === benim) return c.hedef ? `${kisiAdi(c.hedef)} (${V.rolEtiketi(c.hedef.rol)})` : "Yönetim";
    return `${kisiAdi(c.uye)} (${V.rolEtiketi(c.uye?.rol)})`;
  }
  function satir(c, cop) {
    const sec = () => { if (!cop) sohbetAc(c.id); };
    const ust = h("div", { class: "msj-satir-ust" },
      c.sabit ? h("span", { class: "msj-pin", title: "Sabitlendi", "aria-label": "Sabitlendi" }, "📌") : null,
      c.grup ? h("span", { class: "msj-pin", title: "Grup sohbeti", "aria-label": "Grup" }, "👥") : null,
      h("span", { class: "msj-satir-konu", text: c.konu_gosterim }),
      c.sessiz ? h("span", { class: "msj-pin", title: "Sessize alındı", "aria-label": "Sessize alındı" }, "🔕") : null,
      c.okunmamis ? h("span", { class: "msj-rozet", "aria-label": `${c.okunmamis} okunmamış mesaj`, text: c.okunmamis > 99 ? "99+" : String(c.okunmamis) }) : null);
    const alt = h("div", { class: "msj-satir-alt" }, h("span", { class: "msj-satir-kisi", text: karsiTaraf(c) }), h("span", { class: "msj-satir-zaman", text: c.son ? saatMetni(c.son) : (c.gizlendi_at ? saatMetni(c.gizlendi_at) : "") }));
    const onizle = !cop && c.onizleme ? h("div", { class: "msj-satir-onizleme", text: c.onizleme.slice(0, 90) }) : null;
    const eylem = cop ? h("div", { class: "msj-satir-eylem" },
      h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", onclick: () => geriAlEylem(c) }, "↩ Geri al"),
      h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk", onclick: () => kaliciSilEylem(c) }, "Kalıcı sil")) : null;
    return h("div", { class: `msj-satir${c.id === durum.secili?.id && !cop ? " msj-satir--aktif" : ""}${c.okunmamis ? " msj-satir--yeni" : ""}`, role: "listitem", tabindex: cop ? null : "0",
      onclick: sec, onkeydown: (e) => { if (!cop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sec(); } } }, ust, alt, onizle, eylem);
  }

  /** Üyeler için HAZIR "Yönetim ile İletişim" kartları (boş ekran yok): tek dokunuşla konu formu açılır. */
  async function yonetimKartlari(secildi) {
    if (!durum.yonetim) { try { durum.yonetim = (await V.yonetimListesi()).filter((a) => a.id !== benim); } catch { durum.yonetim = []; } }
    const kart = (ad, not, hedefId, ikon) => h("button", { type: "button", class: "msj-yonetim-kart", onclick: () => secildi(hedefId, ad) },
      h("span", { class: "msj-yonetim-ikon", "aria-hidden": "true", text: ikon }), h("span", { class: "msj-yonetim-ad" }, h("strong", { text: ad }), h("small", { text: not })));
    return h("div", { class: "msj-yonetim", role: "list", "aria-label": "Yönetim ile iletişim" },
      kart("Tüm yönetim", "Hangi yetkili müsaitse yanıtlar", null, "🛡️"),
      durum.yonetim.map((a) => kart(a.full_name || "—", V.rolEtiketi(a.role), a.id, a.role === "owner" ? "👑" : "👤")));
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
      if (!q && !cop && !adminMi && !durum.kilitli) {
        // Üye: boş mesaj yerine ulaşılabilir yönetim listesi
        const k = await yonetimKartlari((hedef, ad) => { yeniAktif = true; yeniAlan.hidden = false; konuFormu(null, hedef, ad, konuOnDolgu || ""); });
        doldur(liste, h("h3", { class: "msj-bolum-baslik", text: "Yönetim ile iletişim" }), h("p", { class: "msj-bos msj-bos--kisa", text: "Henüz sohbetin yok. Yazmak istediğin kişiyi seç:" }), k);
      } else doldur(liste, h("p", { class: "msj-bos", text: q ? "Eşleşen sohbet yok." : cop ? "Çöp kutusu boş." : adminMi ? "Henüz sohbet yok. “Yeni mesaj” ya da “Yeni grup” ile başlat." : "Henüz sohbetin yok." }));
    } else doldur(liste, kaynak.map((c) => satir(c, cop)));
    copBtn.textContent = cop ? "← Gelen kutusu" : `🗑️ Çöp kutusu${durum.copAdet ? ` (${durum.copAdet})` : ""}`;
    copBtn.setAttribute("aria-pressed", String(cop));
    copEylem.hidden = !(cop && durum.cop.length);
    yeniBtn.hidden = cop; if (grupBtn) grupBtn.hidden = cop;
  }

  function kilitGoster(e) {
    durum.kilitli = true; durum.secili = null;
    kapatBtn.hidden = copeTasiBtn.hidden = sabitBtn.hidden = sessizBtn.hidden = uyelerBtn.hidden = true; form.hidden = true;
    baslikEl.textContent = "Şifreli sohbetler kilitli";
    doldur(liste, h("p", { class: "msj-bos", text: "Kilit açılınca sohbetlerin burada listelenir." }));
    doldur(govde, kilitPaneli({
      kurtarmaVar: !!e?.durum?.kurtarmaVar,
      onAcildi: async (r) => {
        durum.kilitli = false; S.anahtarlariBirak(); V.aramaIndeksiniTemizle();
        duyur(r?.sifirlandi ? "Anahtar sıfırlandı. Eski sohbetler, karşı taraf geçmişi paylaşınca ekrana gelir." : r?.onarildi ? "Kilit açıldı ve kasa sarmalı onarıldı." : "Kilit açıldı.");
        sagiSifirla(); await yukle(); uyariKontrol();
      },
    }));
    mobilGoster("sohbet");
  }

  async function yukle(sessiz) {
    if (durum.yukleniyor) return; durum.yukleniyor = true;
    try {
      durum.sohbetler = await V.sohbetleriYukle();
      durum.kilitli = false;
      if (V.E2EE_AKTIF) { const c = await V.copKutusu().catch(() => []); durum.copAdet = c.length; if (durum.mod === "cop") durum.cop = c; }
      await listeyiCiz();
      if (durum.secili) { const g = durum.sohbetler.find((x) => x.id === durum.secili.id); if (g) { durum.secili = g; } }
    } catch (e) {
      if (kilitMi(e)) kilitGoster(e);
      else if (!sessiz) duyur("Sohbetler yüklenemedi: " + (e.message || e), true);
    } finally { durum.yukleniyor = false; }
  }
  const yenileErtele = () => { clearTimeout(yenileZaman); yenileZaman = setTimeout(() => yukle(true), 700); };

  // ---------- sohbet görünümü ----------
  const okunduMu = (m) => !!durum.karsiOkundu && new Date(durum.karsiOkundu) >= new Date(m.created_at);
  function balon(m) {
    const ben = m.sender_id === benim;
    const sil = h("button", { type: "button", class: "msj-mesaj-sil", "aria-label": "Mesajı sil", onclick: () => mesajSilEylem(m) }, "Sil");
    const okundu = ben && okunduMu(m);
    const tik = ben ? h("span", { class: `msj-tik${okundu ? " msj-tik--okundu" : ""}`, role: "img", "aria-label": okundu ? "Okundu" : "İletildi", title: okundu ? "Okundu" : "İletildi", text: okundu ? "✓✓" : "✓" }) : null;
    return h("div", { class: `msj-mesaj ${ben ? "msj-mesaj--ben" : "msj-mesaj--karsi"}`, "data-id": m.id },
      h("span", { class: "msj-gonderen", text: m.gonderen ? `${m.gonderen.ad} (${V.rolEtiketi(m.gonderen.rol)})` : "—" }),
      h("div", { class: `msj-metin-balon${m.cozulemedi ? " msj-metin-balon--hata" : ""}`, text: m.cozulemedi ? "🔒 Bu mesajın şifresi çözülemedi (anahtar bu cihaza/hesaba henüz paylaşılmamış)." : m.metin }),
      h("span", { class: "msj-meta" }, h("span", { title: m.sifreli ? "Uçtan uca şifreli" : "Eski mesaj: şifresiz saklanmış", text: m.sifreli ? "🔒" : "🔓" }), ` ${saatMetni(m.created_at)} `, tik, sil));
  }
  function mesajlariCiz(otoKaydir) {
    const enAltta = otoKaydir || govde.scrollHeight - govde.scrollTop - govde.clientHeight < 80;
    if (!durum.mesajlar.length) doldur(govde, h("p", { class: "msj-bos", text: "Henüz mesaj yok. İlk mesajı sen gönder." }));
    else doldur(govde, durum.mesajlar.map(balon));
    if (enAltta) govde.scrollTop = govde.scrollHeight;
  }

  // Okundu bilgisi: yalnızca sohbet açık + sekme görünür + okunmamış (gri tikli) benim mesajım varsa 15 sn'de bir RPC.
  async function okunduYenile() {
    const c = durum.secili; if (!c || !V.E2EE_AKTIF) return;
    const t = await V.karsiOkundu(c.id);
    if (durum.secili?.id !== c.id) return;
    if (String(t) !== String(durum.karsiOkundu)) { durum.karsiOkundu = t; mesajlariCiz(false); }
  }
  function okunduZamanla() {
    clearTimeout(okunduZaman);
    if (duraklatildi || !durum.secili || !V.E2EE_AKTIF) return;
    okunduZaman = setTimeout(async () => {
      if (!document.hidden && durum.mesajlar.some((m) => m.sender_id === benim && !okunduMu(m))) await okunduYenile();
      okunduZamanla();
    }, 15000);
  }

  function ustDugmeleriAyarla(c) {
    kapatBtn.hidden = false; copeTasiBtn.hidden = false; form.hidden = false;
    sabitBtn.hidden = !V.E2EE_AKTIF; sessizBtn.hidden = !V.E2EE_AKTIF; uyelerBtn.hidden = !c.grup;
    sabitBtn.classList.toggle("msj-ikon-btn--aktif", c.sabit); sabitBtn.title = c.sabit ? "Sabitlemeyi kaldır" : "En üste sabitle";
    sessizBtn.setAttribute("aria-pressed", String(!!c.sessiz)); sessizBtn.textContent = c.sessiz ? "🔕" : "🔔";
    sessizBtn.title = sessizBtn.ariaLabel = c.sessiz ? "Sessizi kaldır" : "Bu sohbeti sessize al";
  }

  async function sohbetAc(id) {
    const c = durum.sohbetler.find((x) => x.id === id); if (!c) return;
    durum.secili = c; durum.karsiOkundu = null; mobilGoster("sohbet"); acikSohbetAyarla(c.id);
    baslikEl.textContent = c.grup ? `👥 ${c.konu_gosterim}` : `${c.konu_gosterim} — ${karsiTaraf(c)}`;
    ustDugmeleriAyarla(c);
    doldur(govde, h("p", { class: "msj-bos", text: "Yükleniyor…" }));
    try {
      durum.mesajlar = await V.mesajlariYukle(c);
      durum.karsiOkundu = await V.karsiOkundu(c.id);
      mesajlariCiz(true);
      if (c.e2ee && S.zarfimVarMi(c.id)) S.eksikZarflariTamamla(c.id);
      else if (c.e2ee) duyur("Bu sohbetin şifre anahtarı sana henüz paylaşılmadı; karşı taraf sohbeti açınca otomatik tamamlanır.", true);
      if (c.okunmamis) { c.okunmamis = 0; await V.okunduIsaretle(c.id); okunmamisYenile(); }
      else V.okunduIsaretle(c.id);
      okunduZamanla();
      listeyiCiz();
    } catch (e) { if (kilitMi(e)) kilitGoster(e); else doldur(govde, h("p", { class: "msj-bos", text: "Mesajlar yüklenemedi: " + (e.message || e) })); }
  }

  /** ✕: yalnızca AÇIK SOHBETİ KAPATIR — silmez, çöpe atmaz. Panel temiz (seçimsiz) başlangıç durumuna döner. */
  function sohbetiKapat() {
    durum.secili = null; durum.mesajlar = []; durum.karsiOkundu = null; acikSohbetAyarla(null); clearTimeout(okunduZaman);
    sagiSifirla(); listeyiCiz();
  }
  function sagiSifirla() {
    baslikEl.textContent = "Bir sohbet seç";
    for (const b of [sabitBtn, sessizBtn, copeTasiBtn, kapatBtn, uyelerBtn]) b.hidden = true;
    form.hidden = true; durum.secili = null; acikSohbetAyarla(null);
    doldur(govde, h("p", { class: "msj-bos", text: "Soldan bir sohbet seç ya da yenisini başlat." })); mobilGoster("liste");
  }
  kapatBtn.addEventListener("click", sohbetiKapat);
  sag.addEventListener("keydown", (e) => { if (e.key === "Escape" && durum.secili && !document.querySelector(".msj-modal-kaplama")) { e.preventDefault(); sohbetiKapat(); } });

  // ---------- eylemler ----------
  async function gonder() {
    const metin = alan.value.trim(); const c = durum.secili;
    if (!metin || !c) return;
    gonderBtn.disabled = true;
    try {
      await V.mesajGonder(c, metin);
      alan.value = "";
      durum.mesajlar = await V.mesajlariYukle(c); mesajlariCiz(true); okunduZamanla();
      V.okunduIsaretle(c.id); yenileErtele();
    } catch (e) { if (kilitMi(e)) kilitGoster(e); else duyur("Mesaj gönderilemedi: " + (e.message || e), true); }
    finally { gonderBtn.disabled = false; alan.focus(); }
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); gonder(); });
  alan.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); gonder(); } });

  async function mesajSilEylem(m) {
    const ben = m.sender_id === benim;
    // KURAL: "Herkesten sil" YALNIZCA gönderen için. Site Sahibi/yönetici dahi karşı tarafın mesajında yalnızca "Sadece benden sil" görür.
    const secenekler = [{ metin: "Sadece benden sil", deger: "ben", tur: "birincil" }];
    if (ben) secenekler.push({ metin: "Herkesten sil", deger: "herkes", tur: "tehlike" });
    secenekler.push({ metin: "Vazgeç", deger: null });
    const s = await modalSor({ baslik: "Mesajı sil", metin: ben ? "“Sadece benden sil” mesajı yalnızca senin ekranından kaldırır; karşı taraf görmeye devam eder." : "Bu mesaj karşı tarafındır: yalnızca kendi ekranından kaldırabilirsin; karşı tarafın mesajını herkesten silemezsin.", secenekler });
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

  copeTasiBtn.addEventListener("click", async () => {
    const c = durum.secili; if (!c) return;
    const o = await modalSor({ baslik: "Çöp kutusuna taşı", metin: "Sohbet çöp kutusuna taşınır; oradan geri alabilir ya da kalıcı olarak silebilirsin. Karşı taraftaki sohbet etkilenmez.", secenekler: [{ metin: "Çöp kutusuna taşı", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    const { error } = await V.copeAt(c.id);
    if (error) return duyur("Taşınamadı: " + error.message, true);
    sagiSifirla(); await yukle(); okunmamisYenile();
  });
  sabitBtn.addEventListener("click", async () => {
    const c = durum.secili; if (!c) return;
    const { error } = await V.sabitle(c.id, !c.sabit);
    if (error) return duyur(error.message, true);
    c.sabit = !c.sabit; c.sabit_at = c.sabit ? new Date().toISOString() : null; ustDugmeleriAyarla(c); listeyiCiz();
  });
  sessizBtn.addEventListener("click", async () => {
    const c = durum.secili; if (!c) return;
    const { error } = await V.sessize(c.id, !c.sessiz);
    if (error) return duyur(/does not exist|PGRST202|42883/i.test(error.message) ? "0095 numaralı migration henüz çalıştırılmamış." : error.message, true);
    c.sessiz = !c.sessiz; ustDugmeleriAyarla(c); listeyiCiz();
    duyur(c.sessiz ? "Bu sohbet sessize alındı: bildirim gelmez (mesajlar yine ulaşır)." : "Sohbetin sesi açıldı.");
  });
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
      } catch (er) { if (kilitMi(er)) { yeniKapat(); kilitGoster(er); } else { duyur("Sohbet başlatılamadı: " + (er.message || er), true); baslat.disabled = false; } }
    });
    yeniAlan.hidden = false; doldur(yeniAlan, f); konu.focus();
  }
  async function uyeYeniSohbet(onDolgu) {
    const k = await yonetimKartlari((hedef, ad) => konuFormu(null, hedef, ad, onDolgu || ""));
    doldur(yeniAlan, h("h3", { class: "msj-bolum-baslik", text: "Yönetim ile iletişim" }), h("p", { class: "msj-yeni-ipucu", text: "Kime yazmak istiyorsun?" }), k,
      h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", onclick: yeniKapat }, "Vazgeç"));
  }
  function adminYeniSohbet() {
    const kap = h("div", { class: "msg-alici" });
    doldur(yeniAlan, kap);
    aliciSeciciKur({ kok: kap, onKapat: yeniKapat, onSec: (u) => konuFormu(u.id, null, `${u.isim} (${V.rolEtiketi(u.rol)})`, "") }).ac();
  }
  yeniBtn.addEventListener("click", () => {
    if (yeniAktif) return yeniKapat();
    yeniAktif = true; yeniAlan.hidden = false; yeniBtn.setAttribute("aria-expanded", "true"); mobilGoster("liste");
    adminMi ? adminYeniSohbet() : uyeYeniSohbet("");
  });

  // ---------- grup sohbeti (yalnızca Site Sahibi / yönetici kurar) ----------
  async function grupFormu() {
    if (yeniAktif) yeniKapat();
    yeniAktif = true; yeniAlan.hidden = false; mobilGoster("liste");
    const secili = new Map();
    const ad = h("input", { type: "text", maxlength: 80, placeholder: "Grup adı (ör. Yönetim Ekip Odası)", required: true, "aria-label": "Grup adı" });
    const cipler = h("div", { class: "msj-cipler", "aria-live": "polite" });
    const cipCiz = () => doldur(cipler, secili.size ? [...secili.entries()].map(([id, k]) => h("span", { class: "msj-cip" }, `${k.isim} (${V.rolEtiketi(k.rol)}) `, h("button", { type: "button", "aria-label": `${k.isim} kişisini çıkar`, onclick: () => { secili.delete(id); cipCiz(); } }, "✕"))) : h("small", { class: "muted", text: "Henüz kimse eklenmedi." }));
    cipCiz();
    const sablon = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", title: "Tüm yönetici ve site sahiplerini ekler" }, "🛡️ Yönetim Ekip Odası şablonu");
    sablon.addEventListener("click", async () => {
      try { for (const a of await V.yonetimListesi()) if (a.id !== benim) secili.set(a.id, { isim: a.full_name || "—", rol: a.role }); ad.value ||= "Yönetim Ekip Odası"; cipCiz(); } catch (e) { duyur("Yönetim listesi alınamadı: " + (e.message || e), true); }
    });
    const secici = h("div", { class: "msg-alici", hidden: true });
    const sc = aliciSeciciKur({ kok: secici, onKapat: () => { secici.hidden = true; ekleBtn.hidden = false; }, onSec: () => {}, coklu: { secili, onDegisti: cipCiz } });
    const ekleBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk" }, "＋ Kişi ekle (üye de olabilir)");
    ekleBtn.addEventListener("click", () => { secici.hidden = false; ekleBtn.hidden = true; sc.ac(); });
    const kur = h("button", { type: "submit", class: "msj-btn msj-btn--birincil" }, "Grubu kur");
    const f = h("form", { class: "msj-yeni-form", novalidate: true }, h("h3", { class: "msj-bolum-baslik", text: "Yeni grup" }), ad, sablon, cipler, ekleBtn, secici,
      h("small", { class: "muted", text: "Grup mesajları uçtan uca şifrelidir. Site Sahibi tüm sohbetlere erişebildiği için gruptaki mesajları görebilir." }),
      h("div", { class: "msj-yeni-btnler" }, kur, h("button", { type: "button", class: "msj-btn msj-btn--ikincil", onclick: yeniKapat }, "Vazgeç")));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const a = ad.value.trim(); if (!a) return ad.focus();
      if (!secili.size) return duyur("Gruba en az bir kişi ekle.", true);
      kur.disabled = true;
      try { const id = await V.grupBaslat({ ad: a, uyeIdler: [...secili.keys()] }); yeniKapat(); await yukle(); await sohbetAc(id); alan.focus(); }
      catch (er) { if (kilitMi(er)) { yeniKapat(); kilitGoster(er); } else { duyur("Grup kurulamadı: " + (er.message || er), true); kur.disabled = false; } }
    });
    doldur(yeniAlan, f); ad.focus();
  }
  grupBtn?.addEventListener("click", grupFormu);

  async function uyeleriGoster() {
    const c = durum.secili; if (!c?.grup) return;
    const onceki = document.activeElement;
    const kapat = () => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); };
    const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(); } };
    const listeKap = h("div", { class: "msj-uye-liste" });
    const ekleKap = h("div", { class: "msg-alici", hidden: true });
    const ciz = async () => {
      try {
        const u = await V.grupUyeleri(c.id);
        doldur(listeKap, u.map((k) => h("div", { class: "msj-uye-satir" }, h("span", { text: `${k.full_name || "—"} (${V.rolEtiketi(k.role)})` }),
          adminMi && k.id !== benim ? h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk", onclick: async () => { try { await V.grupUyeCikar(c.id, k.id); await ciz(); } catch (e) { duyur(e.message || String(e), true); } } }, "Çıkar") : null)));
      } catch (e) { doldur(listeKap, h("p", { class: "msj-bos", text: "Üyeler alınamadı: " + (e.message || e) })); }
    };
    const ekle = adminMi ? h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", text: "＋ Kişi ekle" }) : null;
    ekle?.addEventListener("click", () => {
      ekleKap.hidden = false; ekle.hidden = true;
      aliciSeciciKur({ kok: ekleKap, onKapat: () => { ekleKap.hidden = true; ekle.hidden = false; }, onSec: async (u) => { try { await V.grupUyeEkle(c.id, u.id); ekleKap.hidden = true; ekle.hidden = false; await ciz(); duyur(`${u.isim} gruba eklendi. Anahtarı, sohbeti açan bir üye tamamlayınca görebilir.`); } catch (e) { duyur(e.message || String(e), true); } } }).ac();
    });
    const kutu = h("div", { class: "msj-modal msj-modal--genis", role: "dialog", "aria-modal": "true", "aria-label": "Grup üyeleri" }, h("h3", { class: "msj-modal-baslik", text: `👥 ${c.konu_gosterim}` }), listeKap, ekle, ekleKap,
      h("div", { class: "msj-modal-eylem" }, h("button", { type: "button", class: "msj-btn msj-btn--ikincil", onclick: kapat }, "Kapat")));
    const kaplama = h("div", { class: "msj-modal-kaplama" }, kutu);
    kaplama.addEventListener("mousedown", (e) => { if (e.target === kaplama) kapat(); });
    document.body.append(kaplama); document.addEventListener("keydown", tus, true);
    await ciz();
  }
  uyelerBtn.addEventListener("click", uyeleriGoster);

  // ---------- canlı güncelleme (tek kanal: canli.js; burada yalnızca dinleyici) ----------
  async function canliOlayi(o) {
    if (o.tur === "mesaj-ekle") {
      const m = o.yeni;
      if (durum.secili && m.conversation_id === durum.secili.id && !durum.mesajlar.some((x) => x.id === m.id)) {
        try { durum.mesajlar.push(await V.mesajiCoz(m, m.conversation_id)); mesajlariCiz(false); } catch { /* anahtar yoksa liste yenilemesi düzeltir */ }
        if (m.sender_id !== benim) { V.okunduIsaretle(m.conversation_id); }
        okunduZamanla();
      }
      V.aramaIndeksiniTemizle(); yenileErtele(); if (m.sender_id !== benim) okunmamisYenile();
    } else if (o.tur === "mesaj-sil") {
      const id = o.eski?.id; if (id && durum.mesajlar.some((x) => x.id === id)) { durum.mesajlar = durum.mesajlar.filter((x) => x.id !== id); mesajlariCiz(false); }
      V.aramaIndeksiniTemizle(); yenileErtele(); okunmamisYenile();
    } else if (o.tur === "sohbet") yenileErtele();
  }
  function surdur() {
    duraklatildi = false;
    canliCik?.(); canliCik = canliDinle(canliOlayi);
    canliBaslat().catch(() => {});
    clearInterval(yoklama); yoklama = setInterval(() => { if (!document.hidden) yukle(true); }, 60000); // yedek; asıl güncelleme realtime
    acikSohbetAyarla(durum.secili?.id || null); okunduZamanla();
  }
  function duraklat() {
    duraklatildi = true; canliCik?.(); canliCik = null; clearInterval(yoklama); clearTimeout(yenileZaman); clearTimeout(okunduZaman); acikSohbetAyarla(null);
  }
  // Panel (SPA) sekme geçişi: sohbet görünümünden çıkınca dinleyici/zamanlayıcılar bırakılır, dönünce yeniden kurulur.
  const gorunumDinle = (e) => { const id = e.detail?.id; if (id === SOHBET_GORUNUMU) { if (duraklatildi) { surdur(); yukle(true); } } else if (id) duraklat(); };
  document.addEventListener("dash:gorunum", gorunumDinle);

  function sayfadanAyril() {
    duraklat(); clearTimeout(aramaZaman); document.removeEventListener("dash:gorunum", gorunumDinle); tiklamaCik?.(); tiklamaCik = null;
    window.removeEventListener("pagehide", sayfadanAyril);
    V.aramaIndeksiniTemizle(); S.anahtarlariBirak();
    if (AKTIF_ORNEK?.sayfadanAyril === sayfadanAyril) AKTIF_ORNEK = null;
  }
  window.addEventListener("pagehide", sayfadanAyril, { once: true });
  AKTIF_ORNEK = { sayfadanAyril };

  async function sohbetKimligiAc(id) { if (!id) return; if (!durum.sohbetler.some((x) => x.id === id)) await yukle(true); if (durum.sohbetler.some((x) => x.id === id)) await sohbetAc(id); }
  tiklamaCik = bildirimTiklamasiniDinle(sohbetKimligiAc);

  surdur();
  await yukle();
  uyariKontrol();
  const url = new URLSearchParams(window.location.search).get("sohbet");
  if (url && /^[0-9a-f-]{36}$/i.test(url)) await sohbetKimligiAc(url);
  else if (konuOnDolgu) {
    if (durum.sohbetler.length) await sohbetAc(V.siralaSohbetler(durum.sohbetler)[0].id);
    else if (!durum.kilitli) { yeniAktif = true; yeniAlan.hidden = false; adminMi ? adminYeniSohbet() : uyeYeniSohbet(konuOnDolgu); }
  }
  return { sayfadanAyril };
}
