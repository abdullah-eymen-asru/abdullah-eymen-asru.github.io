/*
 * assets/js/demo/demo-yetki-paneli.js — "Demo Yetki & Görünürlük" paneli (dashboard modülü "demoYetki", sekme sys-demo)
 * -----------------------------------------------------------------------
 *  • EN ÜSTTE global anahtar: "Adminler bu demo yetkilerini değiştirebilsin mi?" — YALNIZCA Site Sahibi (owner) değiştirir
 *    (RPC: owner_demo_admin_izni_ayarla). Kapalıyken adminler matrisi yalnızca OKUR.
 *  • "Herkese açık demo girişi" (migration 0085): VARSAYILAN KAPALI. Kapalıyken giriş sayfasında demo düğmesi görünmez ve hesapsız ziyaretçi
 *    demoya giremez; yalnızca 'demo' rollü gerçek üyeler girer. YALNIZCA Site Sahibi açar/kapatır (RPC: owner_demo_herkese_acik_ayarla).
 *  • Granüler matris: Hub kartları, PDF (sayfa + araç çubuğu), Arşiv (sayfa + ZIP inceleme), Notlar (sayfa + filtre çipleri),
 *    Sistem/Metrik. Üst sayfa kapalıysa alt özellikler pasif görünür.
 *  • Depolama: Supabase `demo_config` (tek satır). Okuma demo_config_getir(), yazma demo_config_kaydet() — yetki kararı
 *    VERİTABANINDA (owner her zaman; admin yalnızca global anahtar açıksa). Buradaki disabled durumları yalnızca arayüzdür.
 *  • Bu modül yalnızca GERÇEK (demo olmayan) oturumda yüklenir; sekme demoda zaten yoktur.
 *  • innerHTML yok; CSP uyumlu.
 *  • v2 (0103): iki üst anahtar (adminler değiştirebilsin / herkese açık demo) ARTIK görünür durum bandı, meşgul göstergesi, satır içi onay
 *    (window.confirm yok: bazı tarayıcılar onay penceresini bastırınca anahtar sessizce geri dönüyordu), sunucudan DÖNEN değerle çizim
 *    ve hata sınıflandırması (eksik SQL / yetki / ağ) kullanır. Hata artık sayfanın en altında değil, anahtarların hemen üstünde görünür.
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { requireAuthOrShowError } from "../auth/auth-guard.js";
import { VARSAYILAN_CONFIG, configBirlestir } from "./demo-durum.js";

const kok = document.getElementById("demo-yetki-kok");

const el = (tag, ozellik = {}, ...cocuk) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(ozellik)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuk.flat()) if (c != null && c !== false) n.append(c);
  return n;
};

// Matris tanımı: bölüm → { başlık, anahtar yolu, alt özellikler }
const BOLUMLER = [
  { yol: "hub.aktif", baslik: "🧭 Hub (Ana Ekran)", aciklama: "Vitrin ana ekranı. Kartları tek tek seçebilirsin.", kartlar: true },
  { yol: "pdf.aktif", baslik: "📖 PDF Kütüphanesi & Okuyucu", aciklama: "Örnek PDF'li kütüphane ve okuyucu.", alt: [["pdf.duzenlemeAraclari", "PDF Düzenleme Araçları Çubuğu"]] },
  { yol: "arsiv.aktif", baslik: "🗄️ Arşiv & Dosya Gezgini", aciklama: "Sahte klasör/dosya ağacı.", alt: [["arsiv.zipInceleme", "Örnek ZIP İnceleme"]] },
  { yol: "notlar.aktif", baslik: "🗒️ Notlar", aciklama: "Sahte, şifreli not örnekleri.", alt: [["notlar.filtreCipleri", "Filtreleme Çipleri / Etiket Arama"]] },
  { yol: "mesajlar.aktif", baslik: "💬 Sohbet / Mesajlar", aciklama: "Örnek sohbetler (salt-okunur): demo hesabı mesajları görür, gönderemez/silemez." },
  { yol: "sistem.aktif", baslik: "📊 Sistem / Metrik", aciklama: "Statik vitrin grafikleri." },
  // v5: HavaStil vitrini artık arayüzden yönetilir (eskiden "SQL ile kapat" gerekiyordu). 'misafir' anahtarı sayfa anahtarından BAĞIMSIZDIR.
  { yol: "havastil.aktif", baslik: "🌦️ HavaStil (Giyim Danışmanı)", aciklama: "Demo menüsünde İstanbul vitrini: 16 günlük saatlik plan, kar/don analizi, veri doğrulama. Konum kaydı ve yapay zekâ (Mod B) her zaman kilitli.", bagimsizAlt: true, alt: [["havastil.misafir", "Oturumsuz misafir erişimi (/panel/havastil/ doğrudan açılır, giriş sayfasına yönlendirmez)"]] },
];
const KART_ETIKETLERI = {
  "content-notlar": "Notlar kartı",
  "media-arsiv": "Arşiv & Dosya Gezgini kartı",
  "lib-kutuphane": "PDF Kütüphanesi kartı",
  "users-mesajlar": "Sohbet / Mesajlar kartı",
  "sys-metrik": "Sistem / Metrik kartı",
};

const oku = (cfg, yol) => yol.split(".").reduce((n, p) => n?.[p], cfg);
function yaz(cfg, yol, v) {
  const p = yol.split(".");
  const son = p.pop();
  p.reduce((n, k) => n[k], cfg)[son] = v;
}

async function baslat() {
  if (!kok) return;
  const { profile } = await requireAuthOrShowError({ role: "admin" });
  const mesaj = el("div", { class: "auth-message demo-bant", role: "status", "aria-live": "polite", hidden: true }); // anahtarların ÜSTÜNDE: hata/başarı burada görünür

  let cfg = configBirlestir(VARSAYILAN_CONFIG, null);
  let durum = { is_owner: profile.role === "owner", can_edit: profile.role === "owner", admin_degistirebilir: false, herkese_acik: false };
  let kirli = false;
  let onayBekliyor = false;                 // "Herkese açık" AÇILMADAN önce satır içi onay
  const mesgul = new Set();                 // işlem süren anahtarlar ("admin" | "herkes")

  /** Sunucu/ağ hatasını anlaşılır Türkçe metne çevirir (ham mesaj sonda parantez içinde kalır). */
  function hataMetni(err, hangiSql) {
    const kod = String(err?.code || "");
    const ham = String(err?.message || err || "bilinmeyen hata");
    if (kod === "42501" || /yetkisiz/i.test(ham)) return `Yetkisiz: bu anahtarı yalnızca Site Sahibi değiştirebilir. (${ham})`;
    if (kod === "PGRST202" || kod === "42883" || /could not find the function|schema cache/i.test(ham))
      return `Veritabanında gerekli fonksiyon yok. Supabase SQL Editor'de ${hangiSql} migration'ını çalıştır (en güvenlisi 0103_demo_ust_anahtarlar_onarim.sql). (${ham})`;
    if (kod === "P0002" || /satırı bulunamadı/i.test(ham)) return `demo_config satırı yok. 0103_demo_ust_anahtarlar_onarim.sql dosyasını çalıştır. (${ham})`;
    if (/failed to fetch|network|load failed/i.test(ham)) return `Sunucuya ulaşılamadı (ağ). Bağlantını kontrol edip tekrar dene. (${ham})`;
    if (/jwt|expired|not authenticated/i.test(ham)) return `Oturum süresi dolmuş olabilir: sayfayı yenileyip tekrar giriş yap. (${ham})`;
    return ham;
  }
  const bildir = (metin, tur = "error") => {
    showMessage(mesaj, metin, tur);
    try { mesaj.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch { /* eski tarayıcı */ }
  };

  async function yukle() {
    const [c, d] = await Promise.all([supabase.rpc("demo_config_getir"), supabase.rpc("demo_config_yonetim_durumu")]);
    if (c.error) { bildir("Yapılandırma okunamadı: " + hataMetni(c.error, "0083"), "error"); return; }
    cfg = configBirlestir(VARSAYILAN_CONFIG, c.data);
    if (d.data) durum = { herkese_acik: false, ...d.data };
    durum.herkese_acik = c.data?.herkeseAcik === true;
    durum.admin_degistirebilir = c.data?.adminlerDegistirebilir === true;
    kirli = false;
    ciz();
  }

  async function kaydet() {
    kaydetBtn.disabled = true;
    const { adminlerDegistirebilir, herkeseAcik, ...govde } = cfg; // global anahtarlar ayrı RPC'lerle yönetilir
    const { error } = await supabase.rpc("demo_config_kaydet", { p_config: govde });
    if (error) bildir("Kaydedilemedi: " + hataMetni(error, "0083/0090/0101/0102"));
    else {
      kirli = false;
      bildir("Kaydedildi. Demo ziyaretçileri en geç ~90 sn içinde (yeni açılışta) değişikliği görür.", "success");
    }
    guncelleDugme();
  }

  /**
   * İki global anahtar için ORTAK akış: RPC → sunucunun döndürdüğü değerle durum → taze okumayla doğrulama.
   * İyimser çizim yok: anahtar, sunucu onaylayana dek "işleniyor" (pasif + dönen simge) gösterilir; hata olursa eski konuma döner
   * VE nedeni anahtarların üstündeki bantta yazar.
   */
  async function globalYaz(kimlik, rpcAd, acik, basari, hangiSql) {
    if (mesgul.has(kimlik)) return;
    mesgul.add(kimlik); bildir("Kaydediliyor…", "info"); ciz();
    let veri = null, hata = null;
    try { ({ data: veri, error: hata } = await supabase.rpc(rpcAd, { p_acik: acik })); } catch (e) { hata = e; }
    if (hata) {
      mesgul.delete(kimlik);
      bildir("Değiştirilemedi: " + hataMetni(hata, hangiSql));
      return ciz();
    }
    // Sunucu yanıtı (0103: jsonb). Eski void sürümde yanıt boştur → taze okumaya güveniriz.
    if (veri && typeof veri === "object") {
      if (typeof veri.admin_degistirebilir === "boolean") durum.admin_degistirebilir = veri.admin_degistirebilir;
      if (typeof veri.herkese_acik === "boolean") durum.herkese_acik = veri.herkese_acik;
    }
    let dogrulandi = false;
    try {
      const { data: taze, error: e2 } = await supabase.rpc("demo_config_getir");
      if (!e2 && taze) {
        durum.herkese_acik = taze.herkeseAcik === true;
        durum.admin_degistirebilir = taze.adminlerDegistirebilir === true;
        cfg.adminlerDegistirebilir = durum.admin_degistirebilir; cfg.herkeseAcik = durum.herkese_acik;
        dogrulandi = true;
      }
    } catch { /* doğrulama okunamadı: yazma yine de başarılı */ }
    mesgul.delete(kimlik);
    const hedef = kimlik === "admin" ? durum.admin_degistirebilir : durum.herkese_acik;
    if (dogrulandi && hedef !== acik) bildir("Sunucu değişikliği kabul etti ama değer tutmadı (başka bir oturum ya da çakışan bir politika olabilir). Sayfayı yenile.");
    else bildir(basari(hedef), "success");
    ciz();
  }

  const globalDegis = (acik) =>
    globalYaz("admin", "owner_demo_admin_izni_ayarla", acik,
      (v) => (v ? "Adminler artık demo yetkilerini değiştirebilir." : "Yalnızca Site Sahibi demo yetkilerini değiştirebilir."), "0083");

  function herkeseAcikDegis(acik) {
    if (acik) { onayBekliyor = true; bildir("Onay bekleniyor: aşağıdaki kutudan “Evet, herkese aç” seçeneğine bas.", "warning"); return ciz(); }
    onayBekliyor = false;
    return globalYaz("herkes", "owner_demo_herkese_acik_ayarla", false,
      () => "Demo girişi kapatıldı: hesapsız ziyaretçiler giriş sayfasına yönlendirilir; yalnızca “demo” rollü üyeler demoya girer. Açık demo oturumları bir sonraki yenilemede sonlanır.", "0085");
  }
  const herkeseOnayla = () => {
    onayBekliyor = false;
    return globalYaz("herkes", "owner_demo_herkese_acik_ayarla", true,
      () => "Demo girişi artık HERKESE açık: hesapsız ziyaretçi /panel/ ve HavaStil'e girişe zorlanmadan vitrin (örnek veri, salt-okunur) modunda girer.", "0085");
  };

  const anahtar = (etiket, secili, pasif, degisti, ek = "", islem = false) =>
    el("label", { class: `demo-anahtar${pasif || islem ? " demo-anahtar--pasif" : ""}${islem ? " demo-anahtar--islem" : ""}`, "aria-busy": islem ? "true" : null },
      (() => {
        const i = el("input", { type: "checkbox", role: "switch", checked: secili, disabled: pasif || islem });
        i.checked = !!secili;
        i.addEventListener("change", () => degisti(i.checked));
        return i;
      })(),
      el("span", { class: "demo-anahtar-iz", "aria-hidden": "true" }),
      el("span", { class: "demo-anahtar-etiket", text: etiket }),
      islem ? el("span", { class: "demo-dondur", "aria-hidden": "true" }) : null,
      ek ? el("small", { class: "muted", text: ek }) : null);

  const kaydetBtn = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Değişiklikleri Kaydet" });
  kaydetBtn.addEventListener("click", kaydet);
  const guncelleDugme = () => (kaydetBtn.disabled = !durum.can_edit || !kirli);

  function ciz() {
    const duzenle = !!durum.can_edit;
    const degis = (yol) => (v) => { yaz(cfg, yol, v); kirli = true; ciz(); };

    const sahip = !!durum.is_owner;
    const onayKutusu = onayBekliyor
      ? el("div", { class: "demo-onay", role: "alertdialog", "aria-label": "Herkese açık demo onayı" },
          el("p", { text: "Demo girişi HERKESE açılacak: hesapsız her ziyaretçi, panele/HavaStil'e girişe zorlanmadan vitrin (örnek veri, salt-okunur) modunu açabilir. Gerçek verilere erişilmez (RLS izolasyonu). Açılsın mı?" }),
          el("div", { class: "demo-onay-dugme" },
            (() => { const b2 = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Evet, herkese aç" }); b2.addEventListener("click", herkeseOnayla); return b2; })(),
            (() => { const b2 = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Vazgeç" }); b2.addEventListener("click", () => { onayBekliyor = false; mesaj.hidden = true; ciz(); }); return b2; })()))
      : null;

    const ust = el("section", { class: "panel-section demo-global" },
      el("h2", { text: "Yetki Kontrolü" }),
      mesaj,
      anahtar("Adminler Bu Demo Yetkilerini Değiştirebilsin mi?", durum.admin_degistirebilir, !sahip, globalDegis,
        sahip ? "Kapalıyken yalnızca Site Sahibi değiştirir; adminler sadece okur." : "Bu anahtarı yalnızca Site Sahibi değiştirebilir.", mesgul.has("admin")),
      anahtar("Herkese açık demo girişi (hesapsız ziyaretçiler)", durum.herkese_acik && !onayBekliyor, !sahip, herkeseAcikDegis,
        sahip
          ? (durum.herkese_acik ? "AÇIK: hesapsız ziyaretçi /panel/ ve HavaStil'e giriş sayfasına atılmadan vitrin olarak girer; giriş sayfasında “Canlı Demo” düğmesi de görünür." : "KAPALI (önerilen): ziyaretçi giriş sayfasına yönlendirilir; yalnızca Üye Ayarları'nda rolü “Demo (vitrin)” yapılan üyeler demoya girer.")
          : "Bu anahtarı yalnızca Site Sahibi değiştirebilir.", mesgul.has("herkes")),
      onayKutusu,
      !duzenle ? el("p", { class: "auth-message auth-message--warning", text: "Salt-okunur: bu ayarları değiştirme yetkin yok (Site Sahibi adminlere izin vermemiş)." }) : null);

    const matris = BOLUMLER.map((b) => {
      const acik = oku(cfg, b.yol) === true;
      const govde = el("div", { class: "demo-alt" });
      for (const [yol, etiket] of b.alt || []) govde.append(anahtar(etiket, oku(cfg, yol), !duzenle || (!acik && !b.bagimsizAlt), degis(yol)));
      if (b.kartlar) {
        for (const [id, etiket] of Object.entries(KART_ETIKETLERI)) {
          govde.append(anahtar(etiket, cfg.hub.kartlar[id] !== false, !duzenle || !acik, (v) => { cfg.hub.kartlar[id] = v; kirli = true; ciz(); },
            "Kartın gösterilmesi için ilgili sayfa da açık olmalı."));
        }
      }
      return el("section", { class: "panel-section demo-bolum" },
        el("h3", { text: b.baslik }),
        el("p", { class: "muted", text: b.aciklama }),
        anahtar("Sayfa açık", acik, !duzenle, degis(b.yol)),
        govde);
    });

    kok.replaceChildren(
      el("p", { class: "muted", text: "Demo / vitrin ziyaretçisinin hangi sayfa ve alt özellikleri göreceğini canlı olarak belirle. Ayarlar Supabase'de (demo_config) tutulur; demo oturumu açıldığında okunur." }),
      ust, el("div", { class: "panel-grid" }, matris), el("div", { class: "csp-mt-16" }, kaydetBtn));
    guncelleDugme();
  }

  ciz();
  await yukle();
}

baslat().catch((h) => console.error("demo-yetki-paneli.js:", h));
