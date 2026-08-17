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
 */
import { supabase, showMessage, escapeHtml } from "./core/supabase-client.js";
import { requireAuth } from "./auth/auth-guard.js";

const DURUM_ETIKETLERI = {
  askida: "🔴 Askıda — karar bekleniyor",
  kalici_dusuruldu: "⛔ Kalıcı olarak düşürüldü",
  iptal_edildi: "✅ İptal edildi (yetki iade edildi)",
  suresi_doldu_geri_acildi: "⏱️ Süresi doldu, otomatik geri açıldı",
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
  BEN = await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  if (BEN.profile.role !== "owner") {
    document.querySelectorAll(".sadece-owner").forEach((el) => el.setAttribute("hidden", ""));
  }

  wireAskiyaAlForm();
  await Promise.all([loadAdminListesi(), loadVakalar()]);
  wireRealtime();
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
