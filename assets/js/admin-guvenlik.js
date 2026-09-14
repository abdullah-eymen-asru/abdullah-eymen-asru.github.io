/*
 * assets/js/admin-guvenlik.js — /panel/admin-guvenlik.html
 *
 * "Adminlerin birbirinin yetkisini düşürmesi / hesabı askıya alması"
 * akışının frontend'i. Sadece admin VEYA owner (Site Sahibi) girebilir
 * (bkz. requireAuth({role:"admin"}) — auth-guard.js'te 'owner' de admin
 * gibi her zaman geçer). Askıdaki bir admin bu sayfaya GİREMEZ (auth-guard
 * askidaAdminEngeli), dolayısıyla bu dosyanın kendisi "askıdaki kullanıcı
 * ne görür" durumunu ele almaz.
 *
 * Tüm gerçek yetki kontrolü veritabanı tarafında (migration
 * 0021_admin_karsilikli_denetim_owner_rolu.sql) — bu dosya sadece o
 * RPC'leri çağıran bir arayüz katmanıdır:
 *   - guvenlik_admin_listesi_getir()  -> admin/owner listesi + askı durumu
 *   - denetim_vakalarini_listele()    -> açık + geçmiş vakalar + oy sayıları
 *     + hedef adminin e-postası (bkz. migration 0024 § C)
 *   - admin_askiya_al(hedef, sebep)   -> "Acil Fren"
 *   - admin_denetim_oy_kullan(id, oy) -> çoğunluk oylaması
 *   - owner_denetim_karar(id, karar)  -> sadece owner, tek başına kapatır
 *   - denetim_vakasi_sil(id)          -> SADECE owner, tek bir vakayı siler
 *     (bkz. migration 0024 § B) — liste sayfalanmış (bkz. VAKA_SAYFA*
 *     altındaki not) çünkü çok sayıda vaka birikince tek uzun liste sayfayı
 *     taşırıyordu.
 *   - owner_kayitlari_ac_kapat(acik)  -> SADECE owner, üyelik kayıtlarını
 *     (site_settings.kayitlar_acik) açar/kapatır (bkz. migration
 *     0031_uyelik_kayitlarini_ac_kapat.sql). Bu sayfadaki ".sadece-owner"
 *     bölümü ("Üyelik Kayıtları") admin'den de tamamen gizlenir.
 *   - owner_kilit_modu_ayarla(aktif) -> SADECE owner, kilit modunu
 *     (site_settings.kilit_modu) açar/kapatır — açıkken owner DIŞINDA
 *     kimse github-yonetim panelinden içerik yazamaz/silemez (bkz.
 *     migration 0052_denetim_kaydi_ve_kilit_modu.sql ve
 *     github_icerik_yonetim_worker/worker.js'teki kontrol).
 *   - denetim_kayitlari tablosu (doğrudan select, RPC değil) -> SADECE
 *     owner okuyabilir (RLS) — github-yonetim Worker'ının verdiği her
 *     yazma denemesinin izi (kim/ne zaman/hangi dosya/sonuç).
 *   - owner_denetim_kaydi_sil(id) / owner_denetim_kayitlarini_temizle(tarih)
 *     -> SADECE owner, tek bir denetim kaydını ya da (parametre boşsa
 *     tümünü, doluysa o tarihten eskisini) topluca siler.
 */
import { supabase, showMessage, escapeHtml } from "./core/supabase-client.js";
import { requireAuthOrShowError } from "./auth/auth-guard.js";

const DURUM_ETIKETLERI = {
  askida: "🔴 Askıda — karar bekleniyor",
  kalici_dusuruldu: "⛔ Kalıcı olarak düşürüldü",
  iptal_edildi: "✅ İptal edildi (yetki iade edildi)",
  suresi_doldu_geri_acildi: "⏱️ Süresi doldu, otomatik geri açıldı",
};

// v.ben_oyum ("dusur"/"geri_ac") değerini "Oyumu Geri Al" butonunda
// okunabilir Türkçe metne çevirir (bkz. migration 0037 — RPC artık çağıran
// kişinin kendi oyunu da döndürüyor).
const OY_ETIKETLERI = {
  dusur: "Kalıcı Düşür",
  geri_ac: "Geri Aç",
};

let BEN = null; // { session, profile }
let ADMIN_LISTESI = [];

// Denetim vakaları sayfalaması — bkz. dosya başındaki not: RPC zaten en
// fazla 100 vaka döndürüyordu ama hepsini tek seferde çizmek, çok vakalı
// kurulumlarda sayfayı aşırı uzatıp taşırıyordu. uye-ayarlari.js'teki
// SAYFA/SAYFA_BOYUTU deseniyle AYNI, sadece bu sayfaya özel (ag- önekli).
let TUM_VAKALAR = [];
let VAKA_SAYFA = 1;
const VAKA_SAYFA_BOYUTU = 10;

async function init() {
  BEN = await requireAuthOrShowError({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  if (BEN.profile.role !== "owner") {
    document.querySelectorAll(".sadece-owner").forEach((el) => el.setAttribute("hidden", ""));
  }

  wireAskiyaAlForm();
  wireKayitlarToggle();
  wireKilitModuToggle();
  wireDenetimKaydiKontrolleri();
  // KARARLILIK: Promise.all([...]) önceden kullanılıyordu — bunlardan
  // BİRİ bile hata fırlatırsa (ör. beklenmeyen bir istisna) Promise.all
  // hemen reddolur, wireRealtime() HİÇ çalışmaz VE henüz başarıyla
  // tamamlanabilecek diğer bölümlerin varsa geç gelen DOM güncellemeleri
  // de "yarım" bir izlenim bırakabilir. Promise.allSettled ile her
  // bölüm birbirinden BAĞIMSIZ ele alınıyor — biri başarısız olsa bile
  // diğerleri ve wireRealtime() normal çalışmaya devam ediyor (panel.js/
  // admin.js'teki "her bölüm bağımsız" prensibiyle tutarlı).
  const sonuclar = await Promise.allSettled([
    loadAdminListesi(),
    loadVakalar(),
    loadKayitDurumu(),
    loadKilitDurumu(),
    loadDenetimKayitlari(),
  ]);
  sonuclar.forEach((sonuc, i) => {
    if (sonuc.status === "rejected") {
      console.error(`admin-guvenlik.js: init adım ${i} başarısız:`, sonuc.reason);
    }
  });
  wireRealtime();
}

/* ---------------------------------------------------------------------- */
/* ÜYELİK KAYITLARI AÇ/KAPAT — SADECE owner (bkz. panel/admin-guvenlik.md   */
/* ".sadece-owner" bölümü ve migration 0031_uyelik_kayitlarini_ac_kapat.sql) */
/* ---------------------------------------------------------------------- */
async function loadKayitDurumu() {
  const etiket = document.getElementById("ag-kayitlar-durum");
  if (!etiket) return;

  // site_settings herkese açık okunabilir (bkz. migration 0001
  // "settings_select_anyone") — admin/owner ayrımı yapmaya gerek yok,
  // düz select yeterli.
  const { data, error } = await supabase
    .from("site_settings")
    .select("kayitlar_acik")
    .eq("id", 1)
    .single();

  if (error || !data) {
    etiket.textContent = "Okunamadı";
    return;
  }

  etiket.textContent = data.kayitlar_acik !== false ? "🟢 Açık" : "🔴 Kapalı";
}

function wireKayitlarToggle() {
  const acBtn = document.getElementById("ag-kayitlari-ac-btn");
  const kapatBtn = document.getElementById("ag-kayitlari-kapat-btn");
  const msg = document.getElementById("ag-kayitlar-message");
  if (!acBtn || !kapatBtn) return;

  async function ayarla(p_acik, btn) {
    btn.disabled = true;
    // owner_kayitlari_ac_kapat: SADECE owner çağırabilir (bkz. migration
    // 0031) — admin bu RPC'yi çağırsa bile veritabanı reddeder, burada
    // sadece bu düğmeleri ".sadece-owner" ile admin'den zaten gizliyoruz.
    const { error } = await supabase.rpc("owner_kayitlari_ac_kapat", { p_acik });
    btn.disabled = false;

    if (error) {
      showMessage(msg, "Değiştirilemedi: " + error.message, "error");
      return;
    }

    showMessage(
      msg,
      p_acik ? "Üyelik kayıtları açıldı." : "Üyelik kayıtları kapatıldı — yeni hesap oluşturulamayacak.",
      "success"
    );
    await loadKayitDurumu();
  }

  acBtn.addEventListener("click", () => ayarla(true, acBtn));
  kapatBtn.addEventListener("click", () => {
    if (!confirm("Üyelik kayıtlarını kapatmak istediğine emin misin? Kapalıyken kimse (Google ile de) yeni hesap oluşturamayacak.")) {
      return;
    }
    ayarla(false, kapatBtn);
  });
}

/* ---------------------------------------------------------------------- */
/* KİLİT MODU (Panic Button) — SADECE owner (bkz. panel/admin-guvenlik.md   */
/* ".sadece-owner" bölümü ve migration 0052_denetim_kaydi_ve_kilit_modu.sql) */
/* ---------------------------------------------------------------------- */
async function loadKilitDurumu() {
  const etiket = document.getElementById("ag-kilit-durum");
  if (!etiket) return;

  // site_settings herkese açık okunabilir (bkz. migration 0001
  // "settings_select_anyone") — loadKayitDurumu ile AYNI mantık.
  const { data, error } = await supabase
    .from("site_settings")
    .select("kilit_modu")
    .eq("id", 1)
    .single();

  if (error || !data) {
    etiket.textContent = "Okunamadı";
    return;
  }

  etiket.textContent = data.kilit_modu === true ? "🔴 AKTİF — sadece Site Sahibi yazabilir" : "🟢 Kapalı — herkes kendi yetkisince yazabilir";
}

function wireKilitModuToggle() {
  const acBtn = document.getElementById("ag-kilit-ac-btn");
  const kapatBtn = document.getElementById("ag-kilit-kapat-btn");
  const msg = document.getElementById("ag-kilit-message");
  if (!acBtn || !kapatBtn) return;

  async function ayarla(p_aktif, btn) {
    btn.disabled = true;
    // owner_kilit_modu_ayarla: SADECE owner çağırabilir (bkz. migration
    // 0052) — admin bu RPC'yi çağırsa bile veritabanı reddeder, burada
    // sadece bu düğmeleri ".sadece-owner" ile admin'den zaten gizliyoruz.
    const { error } = await supabase.rpc("owner_kilit_modu_ayarla", { p_aktif });
    btn.disabled = false;

    if (error) {
      showMessage(msg, "Değiştirilemedi: " + error.message, "error");
      return;
    }

    showMessage(
      msg,
      p_aktif
        ? "Kilit modu AÇILDI — Site Sahibi dışında kimse içerik ekleyemez/düzenleyemez/silemez."
        : "Kilit modu kapatıldı — herkes kendi rol yetkisince yazabilir.",
      "success"
    );
    await loadKilitDurumu();
  }

  acBtn.addEventListener("click", () => {
    if (
      !confirm(
        "Kilit modunu açmak üzeresin: sen dışındaki TÜM admin/manager/editor'lerin içerik ekleme/düzenleme/silme yetkisi anında durur. Emin misin?"
      )
    ) {
      return;
    }
    ayarla(true, acBtn);
  });
  kapatBtn.addEventListener("click", () => ayarla(false, kapatBtn));
}

/* ---------------------------------------------------------------------- */
/* DENETİM KAYDI (Audit Log) — SADECE owner (bkz. panel/admin-guvenlik.md   */
/* ".sadece-owner" bölümü ve migration 0052). github_icerik_yonetim_worker  */
/* tarafından service_role ile yazılan satırları listeler; owner tek tek   */
/* ya da toplu (owner_denetim_kaydi_sil / owner_denetim_kayitlarini_temizle) */
/* silebilir. Sayfalama ag-vaka-* ile AYNI istemci-taraflı desen.          */
/* ---------------------------------------------------------------------- */
let TUM_DENETIM_KAYITLARI = [];
let DENETIM_SAYFA = 1;
const DENETIM_SAYFA_BOYUTU = 20;

async function loadDenetimKayitlari() {
  const kutu = document.getElementById("ag-denetim-listesi");
  if (!kutu) return;

  // RLS (migration 0052 "denetim_kayitlari_select_owner") zaten sadece
  // owner'ın SELECT yapmasına izin veriyor — admin bu sorguyu atsa bile
  // boş sonuç alır, bu bölüm admin'den ".sadece-owner" ile zaten gizli.
  const { data, error } = await supabase
    .from("denetim_kayitlari")
    .select("id, olusturuldu, aktor_email, aktor_rol, yontem, hedef_yol, sonuc, ret_nedeni")
    .order("olusturuldu", { ascending: false })
    .limit(500);

  if (error) {
    kutu.innerHTML = `<p class="muted">Denetim kaydı yüklenemedi: ${escapeHtml(error.message)}</p>`;
    renderDenetimSayfalama(0, 0);
    return;
  }

  TUM_DENETIM_KAYITLARI = data || [];
  renderDenetimListesi();
}

function denetimFiltreDegeri() {
  return document.getElementById("ag-denetim-filtre")?.value || "hepsi";
}

function renderDenetimListesi() {
  const kutu = document.getElementById("ag-denetim-listesi");
  if (!kutu) return;

  const filtre = denetimFiltreDegeri();
  const filtreliListe =
    filtre === "hepsi" ? TUM_DENETIM_KAYITLARI : TUM_DENETIM_KAYITLARI.filter((k) => k.sonuc === filtre);

  if (filtreliListe.length === 0) {
    kutu.innerHTML = `<p class="muted">Bu filtreyle eşleşen kayıt yok.</p>`;
    renderDenetimSayfalama(0, 0);
    return;
  }

  const toplamSayfa = Math.max(1, Math.ceil(filtreliListe.length / DENETIM_SAYFA_BOYUTU));
  if (DENETIM_SAYFA > toplamSayfa) DENETIM_SAYFA = toplamSayfa;
  const baslangic = (DENETIM_SAYFA - 1) * DENETIM_SAYFA_BOYUTU;
  const sayfaVerisi = filtreliListe.slice(baslangic, baslangic + DENETIM_SAYFA_BOYUTU);

  kutu.innerHTML = sayfaVerisi.map((k) => denetimKayitKartHtml(k)).join("");
  wireDenetimKayitOlaylari(kutu);
  renderDenetimSayfalama(toplamSayfa, filtreliListe.length);
}

function denetimKayitKartHtml(k) {
  const basariliMi = k.sonuc === "izin_verildi";
  return `
    <div class="uya-kart" data-id="${k.id}">
      <div class="uya-kart-ust">
        <div class="uya-kart-kimlik">
          <strong>${escapeHtml(k.aktor_email || "—")}</strong>
          <span class="uya-email muted">${escapeHtml(k.aktor_rol || "—")} · ${escapeHtml(k.yontem)}</span>
        </div>
        <span class="uya-rol-etiket">${basariliMi ? "🟢 İzin verildi" : "🔴 Reddedildi"}</span>
      </div>
      <p><strong>Yol:</strong> ${escapeHtml(k.hedef_yol)}</p>
      ${k.ret_nedeni ? `<p class="muted"><strong>Neden:</strong> ${escapeHtml(k.ret_nedeni)}</p>` : ""}
      <div class="uya-kart-meta">
        <span>${new Date(k.olusturuldu).toLocaleString("tr-TR")}</span>
      </div>
      <div class="uya-kart-aksiyonlar">
        <button class="btn-danger tablo-aksiyon-btn ag-denetim-sil-btn" data-id="${k.id}">🗑️ Bu Kaydı Sil</button>
      </div>
    </div>`;
}

function renderDenetimSayfalama(toplamSayfa, toplamSonuc) {
  const alan = document.getElementById("ag-denetim-sayfalama");
  if (!alan) return;

  if (toplamSonuc === 0 || toplamSayfa <= 1) {
    alan.innerHTML = "";
    return;
  }

  alan.innerHTML = `
    <button type="button" class="uya-sayfa-btn" id="ag-denetim-sayfa-onceki" ${DENETIM_SAYFA <= 1 ? "disabled" : ""}>‹ Önceki</button>
    <span class="uya-sayfa-gosterge">Sayfa ${DENETIM_SAYFA} / ${toplamSayfa} (${toplamSonuc} kayıt)</span>
    <button type="button" class="uya-sayfa-btn" id="ag-denetim-sayfa-sonraki" ${DENETIM_SAYFA >= toplamSayfa ? "disabled" : ""}>Sonraki ›</button>
  `;

  document.getElementById("ag-denetim-sayfa-onceki")?.addEventListener("click", () => {
    if (DENETIM_SAYFA <= 1) return;
    DENETIM_SAYFA--;
    renderDenetimListesi();
    document.getElementById("ag-denetim-listesi")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("ag-denetim-sayfa-sonraki")?.addEventListener("click", () => {
    DENETIM_SAYFA++;
    renderDenetimListesi();
    document.getElementById("ag-denetim-listesi")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function wireDenetimKayitOlaylari(kutu) {
  kutu.querySelectorAll(".ag-denetim-sil-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu denetim kaydını kalıcı olarak silmek istediğine emin misin? Bu işlem GERİ ALINAMAZ.")) return;

      btn.disabled = true;
      const { error } = await supabase.rpc("owner_denetim_kaydi_sil", { p_id: btn.dataset.id });
      btn.disabled = false;

      if (error) {
        alert("Kayıt silinemedi: " + error.message);
        return;
      }
      await loadDenetimKayitlari();
    });
  });
}

function wireDenetimKaydiKontrolleri() {
  const filtre = document.getElementById("ag-denetim-filtre");
  const yenileBtn = document.getElementById("ag-denetim-yenile-btn");
  const otuzGunBtn = document.getElementById("ag-denetim-30gun-temizle-btn");
  const hepsiBtn = document.getElementById("ag-denetim-hepsi-temizle-btn");
  const msg = document.getElementById("ag-denetim-message");
  if (!filtre) return;

  filtre.addEventListener("change", () => {
    DENETIM_SAYFA = 1;
    renderDenetimListesi();
  });

  yenileBtn?.addEventListener("click", () => loadDenetimKayitlari());

  otuzGunBtn?.addEventListener("click", async () => {
    if (
      !confirm(
        "30 günden eski TÜM denetim kayıtları kalıcı olarak silinecek. Bu işlem GERİ ALINAMAZ. Emin misin?"
      )
    ) {
      return;
    }

    otuzGunBtn.disabled = true;
    const otuzGunOnce = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.rpc("owner_denetim_kayitlarini_temizle", {
      p_su_tarihten_once: otuzGunOnce,
    });
    otuzGunBtn.disabled = false;

    if (error) {
      showMessage(msg, "Temizlenemedi: " + error.message, "error");
      return;
    }
    showMessage(msg, `${data ?? 0} kayıt silindi.`, "success");
    await loadDenetimKayitlari();
  });

  hepsiBtn?.addEventListener("click", async () => {
    if (
      !confirm(
        "TÜM denetim kayıtları (istisnasız hepsi) kalıcı olarak silinecek. Bu işlem GERİ ALINAMAZ. Emin misin?"
      )
    ) {
      return;
    }
    if (!confirm("Son bir kez soruyoruz: gerçekten TÜM denetim kaydını silmek istiyor musun?")) {
      return;
    }

    hepsiBtn.disabled = true;
    const { data, error } = await supabase.rpc("owner_denetim_kayitlarini_temizle", {
      p_su_tarihten_once: null,
    });
    hepsiBtn.disabled = false;

    if (error) {
      showMessage(msg, "Temizlenemedi: " + error.message, "error");
      return;
    }
    showMessage(msg, `${data ?? 0} kayıt silindi.`, "success");
    await loadDenetimKayitlari();
  });
}

/* ---------------------------------------------------------------------- */
/* ADMİN LİSTESİ + "Askıya Al" formunun hedef dropdown'ı                   */
/* ---------------------------------------------------------------------- */
async function loadAdminListesi() {
  const kutu = document.getElementById("ag-admin-listesi");
  const hedefSecim = document.getElementById("ag-hedef-admin");
  if (!kutu) return;

  const { data, error } = await supabase.rpc("guvenlik_admin_listesi_getir");
  if (error) {
    kutu.innerHTML = `<p class="muted">Liste yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }
  ADMIN_LISTESI = data || [];

  kutu.innerHTML = ADMIN_LISTESI.map(
    (u) => `
    <div class="uya-kart" data-id="${u.id}">
      <div class="uya-kart-ust">
        <div class="uya-kart-kimlik">
          <strong>${escapeHtml(u.full_name || u.email)}</strong>
          <span class="uya-email muted">${escapeHtml(u.email)}</span>
        </div>
        <span class="uya-rol-etiket uya-rol-etiket--${u.role}">
          ${u.role === "owner" ? "Site Sahibi" : "Yönetici"}${u.is_suspended ? " · 🔴 Askıda" : ""}
        </span>
      </div>
    </div>`
  ).join("");

  if (hedefSecim) {
    const secilebilirler = ADMIN_LISTESI.filter(
      (u) => u.role === "admin" && !u.is_suspended && u.id !== BEN.session.user.id
    );
    hedefSecim.innerHTML =
      secilebilirler.length === 0
        ? `<option value="">Askıya alınabilecek başka admin yok</option>`
        : secilebilirler
            .map((u) => `<option value="${u.id}">${escapeHtml(u.full_name || u.email)}</option>`)
            .join("");
  }
}

/* ---------------------------------------------------------------------- */
/* ASKIYA ALMA ("Acil Fren")                                               */
/* ---------------------------------------------------------------------- */
function wireAskiyaAlForm() {
  const form = document.getElementById("ag-askiya-al-form");
  const msg = document.getElementById("ag-askiya-al-message");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hedefId = document.getElementById("ag-hedef-admin").value;
    const sebep = document.getElementById("ag-sebep").value.trim();

    if (!hedefId) {
      showMessage(msg, "Askıya alınacak bir admin seç.", "error");
      return;
    }
    if (sebep.length < 5) {
      showMessage(msg, "Sebep en az 5 karakter olmalı — bu, denetim kaydına (audit log) geçer.", "error");
      return;
    }
    if (
      !confirm(
        "Bu admin'in TÜM oturumları anında sonlandırılacak ve hesabı denetim vakası kapanana kadar askıya alınacak. Emin misin?"
      )
    ) {
      return;
    }

    const { error } = await supabase.rpc("admin_askiya_al", {
      p_hedef_admin_id: hedefId,
      p_sebep: sebep,
    });

    if (error) {
      showMessage(msg, "Askıya alma başarısız: " + error.message, "error");
      return;
    }

    showMessage(msg, "Admin askıya alındı, tüm oturumları sonlandırıldı. Karar için aşağıdaki vakayı takip et.", "success");
    form.reset();
    await Promise.all([loadAdminListesi(), loadVakalar()]);
  });
}

/* ---------------------------------------------------------------------- */
/* DENETİM VAKALARI LİSTESİ + OYLAMA + OWNER KARARI                        */
/* ---------------------------------------------------------------------- */
async function loadVakalar() {
  const kutu = document.getElementById("ag-vaka-listesi");
  if (!kutu) return;

  const { data, error } = await supabase.rpc("denetim_vakalarini_listele");
  if (error) {
    kutu.innerHTML = `<p class="muted">Vakalar yüklenemedi: ${escapeHtml(error.message)}</p>`;
    renderVakaSayfalama(0, 0);
    return;
  }
  TUM_VAKALAR = data || [];

  if (TUM_VAKALAR.length === 0) {
    kutu.innerHTML = `<p class="muted">Henüz hiç denetim vakası yok.</p>`;
    renderVakaSayfalama(0, 0);
    return;
  }

  renderVakaListesi();
}

function renderVakaListesi() {
  const kutu = document.getElementById("ag-vaka-listesi");
  if (!kutu) return;

  const toplamSayfa = Math.max(1, Math.ceil(TUM_VAKALAR.length / VAKA_SAYFA_BOYUTU));
  if (VAKA_SAYFA > toplamSayfa) VAKA_SAYFA = toplamSayfa;
  const baslangic = (VAKA_SAYFA - 1) * VAKA_SAYFA_BOYUTU;
  const sayfaVerisi = TUM_VAKALAR.slice(baslangic, baslangic + VAKA_SAYFA_BOYUTU);

  kutu.innerHTML = sayfaVerisi.map((v) => vakaKartHtml(v)).join("");
  wireVakaOlaylari(kutu);

  if (BEN.profile.role !== "owner") {
    kutu.querySelectorAll(".sadece-owner").forEach((el) => el.setAttribute("hidden", ""));
  }

  renderVakaSayfalama(toplamSayfa, TUM_VAKALAR.length);
}

function renderVakaSayfalama(toplamSayfa, toplamSonuc) {
  const alan = document.getElementById("ag-vaka-sayfalama");
  if (!alan) return;

  if (toplamSonuc === 0 || toplamSayfa <= 1) {
    alan.innerHTML = "";
    return;
  }

  alan.innerHTML = `
    <button type="button" class="uya-sayfa-btn" id="ag-vaka-sayfa-onceki" ${VAKA_SAYFA <= 1 ? "disabled" : ""}>‹ Önceki</button>
    <span class="uya-sayfa-gosterge">Sayfa ${VAKA_SAYFA} / ${toplamSayfa} (${toplamSonuc} vaka)</span>
    <button type="button" class="uya-sayfa-btn" id="ag-vaka-sayfa-sonraki" ${VAKA_SAYFA >= toplamSayfa ? "disabled" : ""}>Sonraki ›</button>
  `;

  document.getElementById("ag-vaka-sayfa-onceki")?.addEventListener("click", () => {
    if (VAKA_SAYFA <= 1) return;
    VAKA_SAYFA--;
    renderVakaListesi();
    document.getElementById("ag-vaka-listesi")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("ag-vaka-sayfa-sonraki")?.addEventListener("click", () => {
    VAKA_SAYFA++;
    renderVakaListesi();
    document.getElementById("ag-vaka-listesi")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function vakaKartHtml(v) {
  const askida = v.durum === "askida";
  const benKendiVakamMi = v.hedef_admin_id === BEN.session.user.id;
  const gerekliOyMetni =
    v.gerekli_oy_sayisi === null
      ? "Oylamayla otomatik sonuçlanamaz — sadece Owner kararı veya süre dolumu (2 adminlik senaryo, bkz. yardım metni)"
      : `${v.gerekli_oy_sayisi} oy gerekiyor`;

  return `
    <div class="uya-kart ag-vaka-kart" data-id="${v.id}">
      <div class="uya-kart-ust">
        <div class="uya-kart-kimlik">
          <strong>${escapeHtml(v.hedef_ad || "—")}</strong>
          ${v.hedef_email ? `<span class="uya-email muted">${escapeHtml(v.hedef_email)}</span>` : ""}
          <span class="muted">Başlatan: ${escapeHtml(v.baslatan_ad || "—")}</span>
        </div>
        <span class="uya-rol-etiket">${DURUM_ETIKETLERI[v.durum] || v.durum}</span>
      </div>
      <p><strong>Sebep:</strong> ${escapeHtml(v.sebep)}</p>
      <div class="uya-kart-meta">
        <span>Açıldı: ${new Date(v.created_at).toLocaleString("tr-TR")}</span>
        <span>Karar süresi: ${new Date(v.karar_son_tarihi).toLocaleString("tr-TR")}</span>
        <span>Oylar — Düşür: ${v.dusur_oylari} · Geri Aç: ${v.geri_ac_oylari} (${escapeHtml(gerekliOyMetni)})</span>
      </div>
      ${
        askida && !benKendiVakamMi
          ? `
        <div class="uya-kart-aksiyonlar">
          <button class="btn-danger tablo-aksiyon-btn ag-oy-btn" data-id="${v.id}" data-oy="dusur">Kalıcı Düşür (oy ver)</button>
          <button class="btn-secondary tablo-aksiyon-btn ag-oy-btn" data-id="${v.id}" data-oy="geri_ac">Geri Aç (oy ver)</button>
          ${
            v.ben_oyum
              ? `<button class="btn-secondary tablo-aksiyon-btn ag-oy-geri-al-btn" data-id="${v.id}">↩️ Oyumu Geri Al (şu an: ${OY_ETIKETLERI[v.ben_oyum] || v.ben_oyum})</button>`
              : ""
          }
          <span class="sadece-owner">
            <button class="btn-danger tablo-aksiyon-btn ag-owner-karar-btn" data-id="${v.id}" data-karar="dusur">Owner: Kesin Düşür</button>
            <button class="btn-secondary tablo-aksiyon-btn ag-owner-karar-btn" data-id="${v.id}" data-karar="iptal">Owner: Kesin İptal</button>
          </span>
        </div>`
          : askida && benKendiVakamMi
          ? `<p class="muted">Bu senin kendi vakan — kendi lehine/aleyhine oy kullanamazsın.</p>`
          : ""
      }
      ${
        !askida
          ? `
        <div class="uya-kart-aksiyonlar sadece-owner">
          <button class="btn-danger tablo-aksiyon-btn ag-vaka-sil-btn" data-id="${v.id}">🗑️ Vakayı Sil</button>
        </div>`
          : ""
      }
    </div>`;
}

function wireVakaOlaylari(kutu) {
  kutu.querySelectorAll(".ag-oy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.rpc("admin_denetim_oy_kullan", {
        p_denetim_id: btn.dataset.id,
        p_oy: btn.dataset.oy,
      });
      if (error) {
        alert("Oy kaydedilemedi: " + error.message);
        return;
      }
      await Promise.all([loadAdminListesi(), loadVakalar()]);
    });
  });

  // Oy geri alma (bkz. migration 0037) — sadece daha önce oy kullanmış
  // kişide görünen buton (vakaKartHtml içinde v.ben_oyum kontrolü var).
  kutu.querySelectorAll(".ag-oy-geri-al-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu vakadaki oyunu geri almak istediğine emin misin?")) return;

      btn.disabled = true;
      const { error } = await supabase.rpc("admin_denetim_oy_geri_al", {
        p_denetim_id: btn.dataset.id,
      });
      btn.disabled = false;

      if (error) {
        alert("Oy geri alınamadı: " + error.message);
        return;
      }
      await Promise.all([loadAdminListesi(), loadVakalar()]);
    });
  });

  kutu.querySelectorAll(".ag-owner-karar-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const karar = btn.dataset.karar;
      const uyari =
        karar === "dusur"
          ? "Owner kararıyla bu admin KALICI olarak düşürülecek. Emin misin?"
          : "Owner kararıyla askı iptal edilip yetki iade edilecek. Emin misin?";
      if (!confirm(uyari)) return;

      const { error } = await supabase.rpc("owner_denetim_karar", {
        p_denetim_id: btn.dataset.id,
        p_karar: karar,
      });
      if (error) {
        alert("Owner kararı uygulanamadı: " + error.message);
        return;
      }
      await Promise.all([loadAdminListesi(), loadVakalar()]);
    });
  });

  // Vaka silme (bkz. dosya başındaki not, migration 0024 § B) — SADECE
  // owner'a görünür (sadece-owner sınıfı), tek seferde tek bir vaka siler.
  kutu.querySelectorAll(".ag-vaka-sil-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (
        !confirm(
          "Bu denetim vakasını kalıcı olarak silmek üzeresin. Bu işlem GERİ ALINAMAZ (audit izinin kendisi ayrıca loglanır, ama bu vaka kartı bir daha görünmez). Emin misin?"
        )
      ) {
        return;
      }

      btn.disabled = true;
      const { error } = await supabase.rpc("denetim_vakasi_sil", { p_denetim_id: btn.dataset.id });
      btn.disabled = false;

      if (error) {
        alert("Vaka silinemedi: " + error.message);
        return;
      }
      await loadVakalar();
    });
  });
}

/* ---------------------------------------------------------------------- */
/* GERÇEK ZAMANLI GÜNCELLEME                                               */
/* Başka bir admin bir vakayı değiştirdiğinde (oy verdi, owner karar       */
/* verdi, zaman aşımı işlendi) sayfa yenilemeden anında yansısın diye.     */
/* ---------------------------------------------------------------------- */
function wireRealtime() {
  supabase
    .channel("admin-guvenlik-degisiklikler")
    .on("postgres_changes", { event: "*", schema: "public", table: "admin_denetim" }, () => {
      loadVakalar();
      loadAdminListesi();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "admin_denetim_oylari" }, () => {
      loadVakalar();
    })
    .subscribe();
}

init();
