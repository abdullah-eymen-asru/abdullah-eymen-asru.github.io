/*
 * assets/js/mesajlasma/arayuz.js — birleşik (üye + yönetici) mesajlaşma arayüzü.   [2026-10 nihai mimari]
 *  • ✕ yalnızca açık sohbeti KAPATIR (panel temiz başlangıca döner); sohbeti çöpe atmak AYRI "🗑️ Çöp kutusuna taşı" düğmesidir (✕'in solunda).
 *  • "Herkesten sil" YALNIZCA mesajın GÖNDERENİ içindir (Site Sahibi dahil kimse karşı tarafın mesajını herkesten silemez; sunucu da reddeder).
 *  • Üye: hazır "Yönetim ile İletişim" kartları. Yönetici/Site Sahibi: üye seçici (ad + rol; e-posta ASLA gösterilmez, e-posta ile aranabilir).
 *  • İletildi/Okundu: ✓ (gri) = sunucuya ulaştı, ✓✓ (mavi) = karşı taraf okudu (grupta herkes okuyunca).
 *  • Gruplar: "Yönetim Ekip Odası" gibi ekip grupları; seçilen normal üyeler de eklenebilir (yalnızca Site Sahibi/yönetici kurar).
 *  • Bildirim: yalnızca bu sayfanın sağ üstündeki "🔔 Bildirimleri Aç" anahtarı; sohbet bazında "Sessize al".
 *  • E2EE kilidi: "Özel anahtar açılamadı" artık hata değil, kilit paneli (kurtarma.js): giriş/Kasa parolası ya da Yedek Kurtarma Kodu.
 *  • 2026-10: WhatsApp tarzı yanıtla (kaydır/hover), yukarı sabitle, yıldızla + Yıldızlı Mesajlar paneli (migration 0096).
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
import { kilitPaneli, kitKartiAc } from "./kurtarma.js";
import * as Kit from "../kurtarma-kiti/kit.js";
import * as E from "../r2-arsiv/e2ee.js";
import * as Kasa from "../notlar/kasa.js";
import { bildirimDurumu, bildirimAc, bildirimKapat, acikSohbetAyarla, bildirimTiklamasiniDinle } from "./bildirim.js";

let AKTIF_ORNEK = null; // SPA'da ikinci kurulumda eskisi temizlenir (çift dinleyici/zamanlayıcı yok)
const SOHBET_GORUNUMU = "users-mesajlar";
const kilitMi = (e) => e?.kod === "OZEL_ANAHTAR_ACILAMADI";

export async function mesajlasmaKur(kok, { profile, adminMi, konuOnDolgu = "" }) {
  AKTIF_ORNEK?.sayfadanAyril?.();
  const benim = profile.id;
  const durum = { mod: "gelen", sohbetler: [], cop: [], secili: null, ara: "", yukleniyor: false, mesajlar: [], karsiOkundu: null, yonetim: null, kilitli: false, copAdet: 0, yanit: null, sabit: null };
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
  const yanitKart = h("div", { class: "msj-yanit-kart", hidden: true });
  const sabitBar = h("div", { class: "msj-sabit-bar", hidden: true });
  const sag = h("section", { class: "msj-sag" }, h("div", { class: "msj-sag-ust" }, geriBtn, baslikEl, uyelerBtn, sabitBtn, sessizBtn, copeTasiBtn, kapatBtn), sabitBar, govde, yanitKart, form);
  const panel = h("div", { class: "msj-panel" }, sol, sag);

  // Üst şerit: SAĞ ÜSTTE bildirim anahtarı (+ kurtarma parolası). İzin ASLA kendiliğinden istenmez.
  const bildirimBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-bildirim-btn", "aria-pressed": "false" });
  const kurtarmaBtn = V.E2EE_AKTIF ? h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kurtarma-btn", title: "Notlar + Mesajlaşma için tek Yedek Kurtarma Kodu" }, "🔑 Yedek Kurtarma Kodu") : null;
  const yildizBtn = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-yildiz-btn", title: "Yıldızladığın mesajlar" }, "⭐ Yıldızlı mesajlar");
  const taniBtn = V.E2EE_AKTIF ? h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-tani-btn", title: "Şifreleme / anahtar durumunu kontrol et ve onar" }, "🩺 Tanılama") : null;
  const ustbar = h("div", { class: "msj-ustbar" }, h("span", { class: "msj-ustbar-bilgi", text: "Mesajlar uçtan uca şifrelidir." }), h("div", { class: "msj-ustbar-eylem" }, yildizBtn, kurtarmaBtn, taniBtn, bildirimBtn));
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
  kurtarmaBtn?.addEventListener("click", async () => { if (await kitKartiAc(duyur)) uyariKontrol(true); });
  yildizBtn.addEventListener("click", () => yildizPaneliAc());
  taniBtn?.addEventListener("click", () => taniAc());

  // ---------- 🩺 Tanılama: hesap + kasa + anahtar + sohbet bazında durum raporu ve tek tıkla onarım ----------
  async function taniRaporu() {
    const satirlar = [];
    const ekle = (m) => satirlar.push(m);
    ekle(`Kasa (Notlar): ${Kasa.kasaAcikMi() ? "AÇIK" : "KİLİTLİ"}`);
    try { const d = await E.anahtarDurumu(); ekle(`Anahtar kaydı: ${d.var ? "var" : "YOK"} · Giriş bağlı (DEK) sarmal: ${d.dek_var ? "var" : "yok"} · Yedek Kurtarma Kodu: ${d.kit_var ? "var" : "yok"}${d.kurtarma_var ? " · eski kurtarma parolası var" : ""}`); }
    catch (e) { ekle(`Anahtar durumu okunamadı: ${e.message || e}`); }
    let anahtarTamam = false;
    try { anahtarTamam = await E.anahtarCiftiTutarliMi(); ekle(`Özel anahtar ↔ açık anahtar eşleşmesi: ${anahtarTamam ? "TUTARLI ✓" : "TUTARSIZ ✗ (anahtar açılamıyor ya da başka anahtar yüklü)"}`); }
    catch (e) { ekle(`Özel anahtar açılamadı: ${e.message || e}`); }
    try { await S.zarflarimiYukle(); } catch { ekle("Zarflarım okunamadı."); }
    const sorunlu = [];
    for (const c of durum.sohbetler.filter((x) => x.e2ee)) {
      const t = await S.sohbetTani(c.id);
      const ad = `${c.grup ? "Grup" : karsiTaraf(c)} · ${c.id.slice(0, 8)}`;
      const d = !t.zarfVar ? "ZARFIN YOK (anahtarı bilen taraf sohbeti açınca paylaşılır)" : t.anahtarAcilir ? "açılıyor ✓" : "ZARF BAYAT/AÇILMIYOR ✗";
      ekle(`• ${ad}: ${d}${t.eksik ? ` · zarfı eksik kişi: ${t.eksik}` : ""}`);
      if (!t.anahtarAcilir || t.eksik) sorunlu.push(c.id);
    }
    if (!durum.sohbetler.some((x) => x.e2ee)) ekle("Şifreli sohbet yok.");
    return { satirlar, sorunlu, anahtarTamam };
  }
  async function taniAc() {
    const onceki = document.activeElement;
    const pre = h("pre", { class: "msj-tani", text: "Kontrol ediliyor…" });
    const kopyala = h("button", { type: "button", class: "msj-btn msj-btn--ikincil", text: "Kopyala" });
    const onar = h("button", { type: "button", class: "msj-btn msj-btn--birincil", text: "Onar", disabled: true });
    const kapat = h("button", { type: "button", class: "msj-btn msj-btn--ikincil", text: "Kapat" });
    const kutu = h("div", { class: "msj-modal msj-modal--genis", role: "dialog", "aria-modal": "true", "aria-label": "Şifreleme tanılama" },
      h("h3", { class: "msj-modal-baslik", text: "🩺 Şifreleme tanılama" }), pre,
      h("p", { class: "msj-modal-metin", text: "Onar: açılabilen sohbetlerde eksik zarfları hemen tamamlar, bayat zarfları siler (anahtarı bilen taraf sohbeti açınca yeniden paylaşır). Hiçbir mesaj silinmez." }),
      h("div", { class: "msj-modal-eylem" }, kopyala, kapat, onar));
    const kaplama = h("div", { class: "msj-modal-kaplama" }, kutu);
    const bitir = () => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); };
    const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); bitir(); } };
    kaplama.addEventListener("mousedown", (e) => { if (e.target === kaplama) bitir(); });
    kapat.addEventListener("click", bitir);
    document.body.append(kaplama); document.addEventListener("keydown", tus, true);
    let son = null;
    const calistir = async () => { onar.disabled = true; pre.textContent = "Kontrol ediliyor…"; son = await taniRaporu(); pre.textContent = son.satirlar.join("\n"); onar.disabled = !son.sorunlu.length; };
    kopyala.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pre.textContent); kopyala.textContent = "Kopyalandı ✓"; } catch { kopyala.textContent = "Kopyalanamadı"; } });
    onar.addEventListener("click", async () => {
      onar.disabled = true; pre.textContent = "Onarılıyor…";
      for (const id of son.sorunlu) { try { await S.sohbetiOnar(id); } catch { /* sıradaki */ } }
      await calistir();
      pre.textContent += "\n\nOnarım denendi. Hâlâ ✗ varsa: anahtarı bilen taraf (karşı hesap) bu sohbeti bir kez açmalı; ikisi de kaybettiyse o eski sohbet geri gelmez.";
    });
    await calistir();
  }
  // Anahtar sahibi olduğum sohbetlerde eksik/bayat kalan zarfları listeyi açar açmaz tamamla (sohbeti tek tek açmak gerekmesin).
  async function arkaplandaZarfTamamla() { let n = 0; for (const c of durum.sohbetler) { if (n >= 25) break; if (c.e2ee && S.zarfimVarMi(c.id)) { n++; await S.eksikZarflariTamamla(c.id); } } }

  // Yedek Kurtarma Kodu henüz üretilmediyse bir kez (oturum başına) nazikçe hatırlat.
  async function uyariKontrol(gizle = false) {
    if (!V.E2EE_AKTIF) return;
    let atla = false; try { atla = sessionStorage.getItem("aea_msj_kit_sonra") === "1"; } catch { /* depo kapalı */ }
    if (gizle || atla) { uyari.hidden = true; return; }
    try {
      const d = await Kit.kitDurumu();
      if (d.kitVar) { uyari.hidden = true; return; }
      const olustur = h("button", { type: "button", class: "msj-btn msj-btn--birincil msj-kucuk", text: "Kodu oluştur" });
      const sonra = h("button", { type: "button", class: "msj-btn msj-btn--ikincil msj-kucuk", text: "Sonra" });
      olustur.addEventListener("click", async () => { if (await kitKartiAc(duyur)) uyari.hidden = true; });
      sonra.addEventListener("click", () => { try { sessionStorage.setItem("aea_msj_kit_sonra", "1"); } catch { /* yok say */ } uyari.hidden = true; });
      doldur(uyari, h("span", { text: "🔑 Yedeğini başka bir hesaba/altyapıya taşıyabilmek ve parolanı unutursan notlarını + sohbetlerini açabilmek için tek bir Yedek Kurtarma Kodu oluştur." }), h("span", { class: "msj-uyari-eylem" }, olustur, sonra));
      uyari.hidden = false;
    } catch { /* migration 0096 yoksa sessiz */ }
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
    durum.kilitli = true; durum.secili = null; kokEl.dataset.kilit = "1"; // kilitliyken sade tek sütun (sol liste/başlık gizlenir)
    kapatBtn.hidden = copeTasiBtn.hidden = sabitBtn.hidden = sessizBtn.hidden = uyelerBtn.hidden = true; form.hidden = true;
    baslikEl.textContent = "Şifreli sohbetler kilitli";
    doldur(liste, h("p", { class: "msj-bos", text: "Kilit açılınca sohbetlerin burada listelenir." }));
    doldur(govde, kilitPaneli({
      durum: e?.durum || {},
      onAcildi: async (r) => {
        durum.kilitli = false; delete kokEl.dataset.kilit; S.anahtarlariBirak(); V.aramaIndeksiniTemizle();
        duyur(r?.sifirlandi ? "Anahtar sıfırlandı. Eski sohbetler, karşı taraf geçmişi paylaşınca ekrana gelir." : r?.yenilendi ? "Kilit açıldı; mesaj anahtarın yenilendi. Eski Yedek Kurtarma Kodun (Notlar'ı da kapsar) geçersiz oldu — yenisini indir." : r?.onarildi ? "Kilit açıldı ve kasa sarmalı onarıldı." : "Kilit açıldı.");
        sagiSifirla(); await yukle(); await uyariKontrol();
        // Anahtar yenilendiyse/ilk kurulumda Yedek Kurtarma Kodu henüz yoksa, kodu şimdi indirtmek için kartı kendiliğinden aç (bir kez).
        if (r?.yenilendi || r?.sifirlandi) { try { if (!(await Kit.kitDurumu()).kitVar && !uyari.hidden && (await kitKartiAc(duyur))) uyari.hidden = true; } catch { /* migration 0096 yoksa sessiz */ } }
      },
    }));
    mobilGoster("sohbet");
  }

  async function yukle(sessiz) {
    if (durum.yukleniyor) return; durum.yukleniyor = true;
    try {
      durum.sohbetler = await V.sohbetleriYukle();
      durum.kilitli = false; delete kokEl.dataset.kilit;
      if (V.E2EE_AKTIF) { const c = await V.copKutusu().catch(() => []); durum.copAdet = c.length; if (durum.mod === "cop") durum.cop = c; }
      await listeyiCiz();
      if (V.E2EE_AKTIF) arkaplandaZarfTamamla();
      if (durum.secili) { const g = durum.sohbetler.find((x) => x.id === durum.secili.id); if (g) { durum.secili = g; } sabitCiz(); }
    } catch (e) {
      if (kilitMi(e)) kilitGoster(e);
      else if (!sessiz) duyur("Sohbetler yüklenemedi: " + (e.message || e), true);
    } finally { durum.yukleniyor = false; }
  }
  const yenileErtele = () => { clearTimeout(yenileZaman); yenileZaman = setTimeout(() => yukle(true), 700); };

  // ---------- sohbet görünümü ----------
  const okunduMu = (m) => !!durum.karsiOkundu && new Date(durum.karsiOkundu) >= new Date(m.created_at);
  const gonderenAdi = (m) => (m.sender_id === benim ? "Sen" : m.gonderen?.ad || "—");
  const yanitMetni = (m) => (m.cozulemedi ? "🔒 Şifresi çözülemeyen mesaj" : String(m.metin || "").slice(0, 120));

  // ---- yanıtla ----
  function yanitiAyarla(m) {
    durum.yanit = m || null;
    if (!m) { yanitKart.hidden = true; yanitKart.replaceChildren(); return; }
    doldur(yanitKart, h("div", { class: "msj-yanit-ic" }, h("strong", { text: `↩ ${gonderenAdi(m)}` }), h("span", { text: yanitMetni(m) })),
      h("button", { type: "button", class: "msj-yanit-kapat", "aria-label": "Yanıtı iptal et", onclick: () => yanitiAyarla(null) }, "✕"));
    yanitKart.hidden = false; alan.focus();
  }
  // ---- mesaja git (parıltılı) ----
  function mesajaGit(id) {
    const el = govde.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) { duyur("Bu mesaj yüklenen son 500 mesaj arasında değil.", true); return false; }
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.remove("msj-mesaj--parilda"); void el.offsetWidth; el.classList.add("msj-mesaj--parilda");
    setTimeout(() => el.classList.remove("msj-mesaj--parilda"), 1800);
    return true;
  }
  // ---- yıldız / sabit ----
  async function yildizToggle(m) {
    try { await V.mesajiYildizla(m.id, !m.yildizli); m.yildizli = !m.yildizli; mesajlariCiz(false); }
    catch (e) { duyur("Yıldız güncellenemedi: " + (e.message || e), true); }
  }
  async function sabitToggle(m) {
    const c = durum.secili; if (!c) return;
    try { if (durum.sabit?.id === m.id) await V.mesajSabitiniKaldir(c.id); else await V.mesajiSabitle(m.id); await sabitCiz(); }
    catch (e) { duyur("Sabitlenemedi: " + (e.message || e), true); }
  }
  async function sabitCiz() {
    const c = durum.secili;
    if (!c || !V.E2EE_AKTIF) { durum.sabit = null; sabitBar.hidden = true; return; }
    const id = await V.sabitMesajKimligi(c.id);
    if (durum.secili?.id !== c.id) return;
    const m = id ? (durum.mesajlar.find((x) => x.id === id) || await V.tekMesaj(c, id).catch(() => null)) : null;
    if (!m) { durum.sabit = null; sabitBar.hidden = true; return; }
    durum.sabit = m;
    doldur(sabitBar,
      h("button", { type: "button", class: "msj-sabit-icerik", title: "Mesaja git", onclick: () => mesajaGit(m.id) }, h("span", { class: "msj-sabit-ikon", "aria-hidden": "true", text: "📌" }),
        h("span", { class: "msj-sabit-yazi" }, h("strong", { text: `Sabit mesaj · ${gonderenAdi(m)}` }), h("span", { text: yanitMetni(m) }))),
      h("button", { type: "button", class: "msj-sabit-kaldir", "aria-label": "Sabitlemeyi kaldır", title: "Sabitlemeyi kaldır", onclick: async () => { try { await V.mesajSabitiniKaldir(c.id); durum.sabit = null; sabitBar.hidden = true; mesajlariCiz(false); } catch (e) { duyur("Kaldırılamadı: " + (e.message || e), true); } } }, "✕"));
    sabitBar.hidden = false;
  }
  // ---- mesaj menüsü (⋯) ----
  function menuKapat() { document.querySelectorAll(".msj-menu").forEach((x) => x.remove()); }
  document.addEventListener("click", (e) => { if (!e.target.closest?.(".msj-menu, .msj-eylem-btn--menu")) menuKapat(); });
  function menuAc(m, dugme) {
    const var_ = !!document.querySelector(".msj-menu"); menuKapat(); if (var_) return;
    const oge = (metin, fn) => h("button", { type: "button", role: "menuitem", class: "msj-menu-oge", onclick: () => { menuKapat(); fn(); } }, metin);
    const menu = h("div", { class: "msj-menu", role: "menu" },
      oge("↩ Yanıtla", () => yanitiAyarla(m)),
      oge(m.yildizli ? "☆ Yıldızı kaldır" : "⭐ Yıldızla", () => yildizToggle(m)),
      oge(durum.sabit?.id === m.id ? "📌 Sabitlemeyi kaldır" : "📌 Yukarı sabitle", () => sabitToggle(m)),
      oge("🗑 Sil…", () => mesajSilEylem(m)));
    dugme.closest(".msj-mesaj").append(menu);
    menu.querySelector("button")?.focus();
  }
  // ---- mobil: kaydırarak yanıtla (sağa/sola, hafif titreşim) ----
  function kaydirmaBagla(el, m) {
    let x0 = 0, y0 = 0, dx = 0, aktif = false, karar = false;
    const sifirla = () => { el.style.removeProperty("--kay"); el.classList.remove("msj-mesaj--kayiyor"); };
    el.addEventListener("touchstart", (e) => { if (e.touches.length !== 1 || e.target.closest("button, a, input, textarea")) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; aktif = true; karar = false; }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (!aktif) return;
      const ax = e.touches[0].clientX - x0, ay = e.touches[0].clientY - y0;
      if (!karar) { if (Math.abs(ay) > 12 && Math.abs(ay) > Math.abs(ax)) { aktif = false; return; } if (Math.abs(ax) > 10) karar = true; else return; }
      dx = Math.max(-80, Math.min(80, ax));
      el.classList.add("msj-mesaj--kayiyor"); el.style.setProperty("--kay", `${dx}px`);
      el.classList.toggle("msj-mesaj--esik", Math.abs(dx) >= 56);
    }, { passive: true });
    const bitir = () => { const tetik = aktif && Math.abs(dx) >= 56; aktif = false; dx = 0; sifirla(); el.classList.remove("msj-mesaj--esik"); if (tetik) { try { navigator.vibrate?.(12); } catch { /* destek yok */ } yanitiAyarla(m); } };
    el.addEventListener("touchend", bitir);
    el.addEventListener("touchcancel", () => { aktif = false; dx = 0; sifirla(); el.classList.remove("msj-mesaj--esik"); });
  }
  function balon(m) {
    const ben = m.sender_id === benim;
    const sil = h("button", { type: "button", class: "msj-mesaj-sil", "aria-label": "Mesajı sil", onclick: () => mesajSilEylem(m) }, "Sil");
    const okundu = ben && okunduMu(m);
    const tik = ben ? h("span", { class: `msj-tik${okundu ? " msj-tik--okundu" : ""}`, role: "img", "aria-label": okundu ? "Okundu" : "İletildi", title: okundu ? "Okundu" : "İletildi", text: okundu ? "✓✓" : "✓" }) : null;
    const hedef = m.yanit_id ? durum.mesajlar.find((x) => x.id === m.yanit_id) : null;
    const alinti = m.yanit_id ? h("button", { type: "button", class: "msj-alinti", title: "Alıntılanan mesaja git", onclick: () => mesajaGit(m.yanit_id) },
      h("strong", { text: hedef ? gonderenAdi(hedef) : "Mesaj" }), h("span", { text: hedef ? yanitMetni(hedef) : "Silinmiş ya da yüklenmemiş mesaj" })) : null;
    const eylemler = h("span", { class: "msj-eylemler" },
      h("button", { type: "button", class: "msj-eylem-btn", title: "Yanıtla", "aria-label": "Yanıtla", onclick: () => yanitiAyarla(m) }, "↩"),
      h("button", { type: "button", class: "msj-eylem-btn", title: m.yildizli ? "Yıldızı kaldır" : "Yıldızla", "aria-label": m.yildizli ? "Yıldızı kaldır" : "Yıldızla", "aria-pressed": String(!!m.yildizli), onclick: () => yildizToggle(m) }, m.yildizli ? "★" : "☆"),
      h("button", { type: "button", class: "msj-eylem-btn msj-eylem-btn--menu", title: "Diğer", "aria-label": "Mesaj menüsü", "aria-haspopup": "menu", onclick: (e) => { e.stopPropagation(); menuAc(m, e.currentTarget); } }, "⋯"));
    const el = h("div", { class: `msj-mesaj ${ben ? "msj-mesaj--ben" : "msj-mesaj--karsi"}${m.yildizli ? " msj-mesaj--yildizli" : ""}${durum.sabit?.id === m.id ? " msj-mesaj--sabit" : ""}`, "data-id": m.id },
      h("span", { class: "msj-gonderen", text: m.gonderen ? `${m.gonderen.ad} (${V.rolEtiketi(m.gonderen.rol)})` : "—" }),
      alinti,
      h("div", { class: `msj-metin-balon${m.cozulemedi ? " msj-metin-balon--hata" : ""}`, text: m.cozulemedi ? "🔒 Bu mesajın şifresi çözülemedi (anahtar bu cihaza/hesaba henüz paylaşılmamış)." : m.metin }),
      h("span", { class: "msj-meta" }, h("span", { title: m.sifreli ? "Uçtan uca şifreli" : "Eski mesaj: şifresiz saklanmış", text: m.sifreli ? "🔒" : "🔓" }), ` ${m.yildizli ? "⭐ " : ""}${durum.sabit?.id === m.id ? "📌 " : ""}${saatMetni(m.created_at)} `, tik, sil),
      eylemler);
    if (V.E2EE_AKTIF) kaydirmaBagla(el, m);
    return el;
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
    durum.secili = c; durum.karsiOkundu = null; yanitiAyarla(null); durum.sabit = null; sabitBar.hidden = true; mobilGoster("sohbet"); acikSohbetAyarla(c.id);
    baslikEl.textContent = c.grup ? `👥 ${c.konu_gosterim}` : `${c.konu_gosterim} — ${karsiTaraf(c)}`;
    ustDugmeleriAyarla(c);
    doldur(govde, h("p", { class: "msj-bos", text: "Yükleniyor…" }));
    try {
      durum.mesajlar = await V.mesajlariYukle(c);
      durum.karsiOkundu = await V.karsiOkundu(c.id);
      await sabitCiz();
      mesajlariCiz(true);
      if (c.e2ee && S.zarfimVarMi(c.id)) S.eksikZarflariTamamla(c.id);
      else if (c.e2ee) duyur("Bu sohbetin şifre anahtarı sana henüz paylaşılmadı; karşı taraf sohbeti açınca otomatik tamamlanır.", true);
      if (c.okunmamis) { c.okunmamis = 0; await V.okunduIsaretle(c.id); okunmamisYenile(); }
      else V.okunduIsaretle(c.id);
      okunduZamanla();
      listeyiCiz();
    } catch (e) { if (kilitMi(e)) kilitGoster(e); else doldur(govde, h("p", { class: "msj-bos", text: "Mesajlar yüklenemedi: " + (e.message || e) })); }
  }

 /** ⭐ Yıldızlı Mesajlar paneli: tüm sohbetlerdeki yıldızlı mesajlar; tıklayınca ilgili sohbete + mesaja gider. */
  async function yildizPaneliAc() {
    sohbetiKapat();
    baslikEl.textContent = "⭐ Yıldızlı mesajlar"; kapatBtn.hidden = false; mobilGoster("sohbet");
    doldur(govde, h("p", { class: "msj-bos", text: "Yükleniyor…" }));
    let liste_;
    try { liste_ = await V.yildizliMesajlar(durum.sohbetler); }
    catch (e) { if (kilitMi(e)) return kilitGoster(e); return doldur(govde, h("p", { class: "msj-bos", text: "Yüklenemedi: " + (e.message || e) })); }
    const filtre = h("input", { type: "search", class: "msj-yildiz-ara", placeholder: "Yıldızlılarda ara…", "aria-label": "Yıldızlı mesajlarda ara" });
    const kap = h("div", { class: "msj-yildiz-liste", role: "list" });
    const ciz = () => {
      const q = filtre.value.trim().toLocaleLowerCase("tr");
      const gor = liste_.filter((m) => !q || `${m.metin || ""} ${m.gonderen?.ad || ""}`.toLocaleLowerCase("tr").includes(q));
      doldur(kap, gor.length ? gor.map((m) => {
        const c = durum.sohbetler.find((x) => x.id === m.sohbetId);
        return h("button", { type: "button", role: "listitem", class: "msj-yildiz-oge", onclick: async () => { await sohbetAc(m.sohbetId); setTimeout(() => mesajaGit(m.id), 60); } },
          h("small", { text: `${c?.konu_gosterim || "Sohbet"} · ${saatMetni(m.created_at)}` }), h("strong", { text: gonderenAdi(m) }), h("span", { text: yanitMetni(m) }));
      }) : [h("p", { class: "msj-bos", text: liste_.length ? "Eşleşen yıldızlı mesaj yok." : "Henüz yıldızladığın mesaj yok. Bir mesajın ☆ simgesine dokun." })]);
    };
    filtre.addEventListener("input", ciz); ciz();
    doldur(govde, filtre, kap);
  }

  /** ✕: yalnızca AÇIK SOHBETİ KAPATIR — silmez, çöpe atmaz. Panel temiz (seçimsiz) başlangıç durumuna döner. */
  function sohbetiKapat() {
    durum.secili = null; durum.mesajlar = []; durum.karsiOkundu = null; acikSohbetAyarla(null); clearTimeout(okunduZaman); yanitiAyarla(null); sabitBar.hidden = true; durum.sabit = null;
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
      await V.mesajGonder(c, metin, durum.yanit?.id || null);
      alan.value = ""; yanitiAyarla(null);
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
