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
  const mesaj = el("div", { class: "auth-message", hidden: true });

  let cfg = configBirlestir(VARSAYILAN_CONFIG, null);
  let durum = { is_owner: profile.role === "owner", can_edit: profile.role === "owner", admin_degistirebilir: false, herkese_acik: false };
  let kirli = false;

  async function yukle() {
    const [c, d] = await Promise.all([supabase.rpc("demo_config_getir"), supabase.rpc("demo_config_yonetim_durumu")]);
    if (c.error) return showMessage(mesaj, "Yapılandırma okunamadı: " + c.error.message + " (0083 migration'ı çalıştırıldı mı?)");
    cfg = configBirlestir(VARSAYILAN_CONFIG, c.data);
    if (d.data) durum = { herkese_acik: false, ...d.data };
    durum.herkese_acik = c.data?.herkeseAcik === true;
    kirli = false;
    ciz();
  }

  async function kaydet() {
    kaydetBtn.disabled = true;
    const { adminlerDegistirebilir, herkeseAcik, ...govde } = cfg; // global anahtarlar ayrı RPC'lerle yönetilir
    const { error } = await supabase.rpc("demo_config_kaydet", { p_config: govde });
    if (error) showMessage(mesaj, "Kaydedilemedi: " + error.message);
    else {
      kirli = false;
      showMessage(mesaj, "Kaydedildi. Demo ziyaretçileri en geç ~90 sn içinde (yeni açılışta) değişikliği görür.", "success");
    }
    guncelleDugme();
  }

  async function globalDegis(acik) {
    const { error } = await supabase.rpc("owner_demo_admin_izni_ayarla", { p_acik: acik });
    if (error) {
      showMessage(mesaj, "Değiştirilemedi: " + error.message);
      return ciz();
    }
    durum.admin_degistirebilir = acik;
    cfg.adminlerDegistirebilir = acik;
    showMessage(mesaj, acik ? "Adminler artık demo yetkilerini değiştirebilir." : "Yalnızca Site Sahibi demo yetkilerini değiştirebilir.", "success");
    ciz();
  }

  async function herkeseAcikDegis(acik) {
    if (acik && !window.confirm("Demo girişi HERKESE açılacak: giriş sayfasında düğme görünür ve hesapsız herkes vitrin (örnek veri, salt-okunur) modunu açabilir. Gerçek verilere erişilmez. Açılsın mı?")) return ciz();
    const { error } = await supabase.rpc("owner_demo_herkese_acik_ayarla", { p_acik: acik });
    if (error) {
      showMessage(mesaj, "Değiştirilemedi: " + error.message + " (0085 migration'ı çalıştırıldı mı?)");
      return ciz();
    }
    durum.herkese_acik = acik;
    showMessage(mesaj, acik ? "Demo girişi artık HERKESE açık." : "Demo girişi kapatıldı: yalnızca 'demo' rollü üyeler girebilir. Açık demo oturumları bir sonraki yenilemede sonlanır.", "success");
    ciz();
  }

  const anahtar = (etiket, secili, pasif, degisti, ek = "") =>
    el("label", { class: `demo-anahtar${pasif ? " demo-anahtar--pasif" : ""}` },
      (() => {
        const i = el("input", { type: "checkbox", role: "switch", checked: secili, disabled: pasif });
        i.checked = !!secili;
        i.addEventListener("change", () => degisti(i.checked));
        return i;
      })(),
      el("span", { class: "demo-anahtar-iz", "aria-hidden": "true" }),
      el("span", { class: "demo-anahtar-etiket", text: etiket }),
      ek ? el("small", { class: "muted", text: ek }) : null);

  const kaydetBtn = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Değişiklikleri Kaydet" });
  kaydetBtn.addEventListener("click", kaydet);
  const guncelleDugme = () => (kaydetBtn.disabled = !durum.can_edit || !kirli);

  function ciz() {
    const duzenle = !!durum.can_edit;
    const degis = (yol) => (v) => { yaz(cfg, yol, v); kirli = true; ciz(); };

    const ust = el("section", { class: "panel-section demo-global" },
      el("h2", { text: "Yetki Kontrolü" }),
      anahtar("Adminler Bu Demo Yetkilerini Değiştirebilsin mi?", durum.admin_degistirebilir, !durum.is_owner, globalDegis,
        durum.is_owner ? "Kapalıyken yalnızca Site Sahibi değiştirir; adminler sadece okur." : "Bu anahtarı yalnızca Site Sahibi değiştirebilir."),
      anahtar("Herkese açık demo girişi (hesapsız ziyaretçiler)", durum.herkese_acik, !durum.is_owner, herkeseAcikDegis,
        durum.is_owner
          ? (durum.herkese_acik ? "AÇIK: giriş sayfasında “Canlı Demo” düğmesi görünür; herkes girebilir." : "KAPALI (önerilen): düğme görünmez; yalnızca Üye Ayarları'nda rolü “Demo (vitrin)” yapılan üyeler demoya girer.")
          : "Bu anahtarı yalnızca Site Sahibi değiştirebilir."),
      !duzenle ? el("p", { class: "auth-message auth-message--warning", text: "Salt-okunur: bu ayarları değiştirme yetkin yok (Site Sahibi adminlere izin vermemiş)." }) : null);

    const matris = BOLUMLER.map((b) => {
      const acik = oku(cfg, b.yol) === true;
      const govde = el("div", { class: "demo-alt" });
      for (const [yol, etiket] of b.alt || []) govde.append(anahtar(etiket, oku(cfg, yol), !duzenle || !acik, degis(yol)));
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
      ust, el("div", { class: "panel-grid" }, matris), el("div", { class: "csp-mt-16" }, kaydetBtn), mesaj);
    guncelleDugme();
  }

  ciz();
  await yukle();
}

baslat().catch((h) => console.error("demo-yetki-paneli.js:", h));
