/*
 * assets/js/panel.js — /panel.html
 * Profil görüntüleme (salt bilgi), şifre değiştirme, 2FA (TOTP) kurulumu,
 * KVKK onay durumu/yeniden onay, "Hesabımı Sil" ve kullanıcıya atanmış
 * özel içeriklerin listesi (okundu durumu + son geçerlilik tarihiyle).
 *
 * NOT: Profil fotoğrafı yükleme ve "Hakkımda" (bio) düzenleme alanları
 * BİLİNÇLİ OLARAK KALDIRILDI (Supabase Storage kullanılmaması ve site
 * genelindeki "Hakkımda" metninin sadece admin panelinden yönetilmesi
 * istendiği için). Ad Soyad hâlâ düzenlenebilir.
 */
import { supabase, showMessage, escapeHtml, KVKK_METIN_SURUMU } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

async function init() {
  const { session, profile } = await requireAuth({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  renderProfile(profile);
  wireProfileForm(profile);
  wirePasswordChange();
  wireDeleteAccount(session, profile);
  wireKvkk(profile);
  await wireMfa();
  await loadOzelIcerikler();
  wireLogout();
}

function renderProfile(profile) {
  document.getElementById("panel-email").textContent = profile.email;
  document.getElementById("panel-rol").textContent = rolEtiketi(profile.role);
  document.getElementById("full_name").value = profile.full_name ?? "";
}

function rolEtiketi(role) {
  return { admin: "Yönetici", special_user: "Özel Üye", user: "Üye" }[role] ?? role;
}

function wireProfileForm(profile) {
  const form = document.getElementById("profil-form");
  const msg = document.getElementById("profil-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = form.full_name.value.trim();

    const { error } = await supabase
      .from("profiles")
      .update({ full_name }) // "role" kolonu burada YOK — trigger zaten engeller ama en baştan göndermiyoruz
      .eq("id", profile.id);

    if (error) {
      showMessage(msg, "Kaydedilemedi: " + error.message);
      return;
    }
    showMessage(msg, "Profil güncellendi.", "success");
  });
}

function wirePasswordChange() {
  const form = document.getElementById("sifre-degistir-form");
  const msg = document.getElementById("sifre-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const yeniSifre = form.yeni_sifre.value;
    const yeniSifreTekrar = form.yeni_sifre_tekrar.value;

    if (yeniSifre !== yeniSifreTekrar) {
      showMessage(msg, "Yeni şifreler eşleşmiyor.");
      return;
    }
    if (yeniSifre.length < 8) {
      showMessage(msg, "Şifre en az 8 karakter olmalı.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: yeniSifre });
    if (error) {
      showMessage(msg, "Şifre değiştirilemedi: " + error.message);
      return;
    }
    showMessage(msg, "Şifre değiştirildi.", "success");
    form.reset();
  });
}

/* ---------------------------------------------------------------------- */
/* KVKK ONAYI                                                              */
/* ---------------------------------------------------------------------- */
function wireKvkk(profile) {
  const box = document.getElementById("kvkk-durum");
  if (!box) return;

  const guncelMi = profile.kvkk_onay_verildi && profile.kvkk_onay_versiyonu === KVKK_METIN_SURUMU;

  if (guncelMi) {
    box.innerHTML = `
      <p class="auth-message auth-message--success" style="position:static;">
        ✓ KVKK Aydınlatma Metni ve Açık Rıza onayını verdin
        (${new Date(profile.kvkk_onay_tarihi).toLocaleDateString("tr-TR")}).
      </p>`;
    return;
  }

  box.innerHTML = `
    <p class="auth-message auth-message--error" style="position:static;">
      ${profile.kvkk_onay_verildi ? "Gizlilik politikası/KVKK metni güncellendi, lütfen yeniden onayla." : "Henüz KVKK onayı vermemişsin."}
    </p>
    <label style="display:flex; gap:8px; align-items:flex-start; margin:10px 0;">
      <input type="checkbox" id="kvkk-checkbox" style="margin-top:3px;">
      <span>
        <a href="/gizlilik-politikasi.html" target="_blank">KVKK Aydınlatma Metni ve Gizlilik Politikası</a>'nı
        okudum, kişisel verilerimin belirtilen şekilde işlenmesine açık rıza gösteriyorum.
      </span>
    </label>
    <button id="kvkk-onayla-btn" type="button" class="btn-primary" style="width:auto;">Onayla</button>`;

  document.getElementById("kvkk-onayla-btn").addEventListener("click", async () => {
    const checked = document.getElementById("kvkk-checkbox").checked;
    if (!checked) {
      showMessage(box.querySelector(".auth-message") || box, "Devam etmek için kutuyu işaretlemelisin.");
      return;
    }
    const { error } = await supabase.rpc("kvkk_onayini_ver", { p_versiyon: KVKK_METIN_SURUMU });
    if (error) {
      alert("Onay kaydedilemedi: " + error.message);
      return;
    }
    profile.kvkk_onay_verildi = true;
    profile.kvkk_onay_versiyonu = KVKK_METIN_SURUMU;
    profile.kvkk_onay_tarihi = new Date().toISOString();
    wireKvkk(profile);
  });
}

/* ---------------------------------------------------------------------- */
/* 2FA (TOTP) — Supabase Auth yerleşik MFA API'si                         */
/* ---------------------------------------------------------------------- */
async function wireMfa() {
  const box = document.getElementById("mfa-alani");
  if (!box) return;

  await renderMfaDurumu(box);
}

async function renderMfaDurumu(box) {
  box.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    box.innerHTML = `<p class="muted">2FA durumu okunamadı: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const dogrulanmisFactors = (data.totp || []).filter((f) => f.status === "verified");

  if (dogrulanmisFactors.length > 0) {
    box.innerHTML = `
      <p class="auth-message auth-message--success" style="position:static;">
        ✓ İki faktörlü doğrulama (2FA) aktif.
      </p>
      <button id="mfa-kaldir-btn" type="button" class="btn-danger" style="width:auto;">2FA'yı Kaldır</button>
      <div id="mfa-message" class="auth-message" hidden></div>`;

    document.getElementById("mfa-kaldir-btn").addEventListener("click", async () => {
      if (!confirm("2FA'yı kaldırmak istediğine emin misin? Hesabın tekrar sadece şifreyle korunacak.")) return;
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: dogrulanmisFactors[0].id,
      });
      const msg = document.getElementById("mfa-message");
      if (unenrollErr) {
        showMessage(msg, "Kaldırılamadı: " + unenrollErr.message);
        return;
      }
      await renderMfaDurumu(box);
    });
    return;
  }

  box.innerHTML = `
    <p class="muted">
      2FA aktif değil. Google Authenticator, Authy veya benzeri bir uygulamayla
      QR kodu okutarak hesabını ekstra korumaya alabilirsin.
    </p>
    <button id="mfa-baslat-btn" type="button" class="btn-primary" style="width:auto;">2FA'yı Etkinleştir</button>
    <div id="mfa-kurulum-alani" hidden style="margin-top:16px;">
      <div id="mfa-qr-wrap" style="margin-bottom:12px;"></div>
      <p class="muted" style="font-size:0.85rem;">
        QR kodu okutamıyorsan bu kodu uygulamana elle girebilirsin:
        <code id="mfa-secret" style="user-select:all;"></code>
      </p>
      <div class="form-field">
        <label for="mfa-kod-input">Uygulamada görünen 6 haneli kodu gir</label>
        <input id="mfa-kod-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
      </div>
      <button id="mfa-dogrula-btn" type="button" class="btn-primary" style="width:auto;">Doğrula ve Etkinleştir</button>
    </div>
    <div id="mfa-message" class="auth-message" hidden></div>`;

  document.getElementById("mfa-baslat-btn").addEventListener("click", async () => {
    const msg = document.getElementById("mfa-message");
    const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });
    if (enrollErr) {
      showMessage(msg, "Başlatılamadı: " + enrollErr.message);
      return;
    }

    document.getElementById("mfa-kurulum-alani").hidden = false;
    document.getElementById("mfa-baslat-btn").hidden = true;
    document.getElementById("mfa-qr-wrap").innerHTML =
      `<img src="${enrollData.totp.qr_code}" alt="2FA QR kodu" style="background:#fff;padding:8px;border-radius:8px;max-width:220px;">`;
    document.getElementById("mfa-secret").textContent = enrollData.totp.secret;

    document.getElementById("mfa-dogrula-btn").addEventListener("click", async () => {
      const kod = document.getElementById("mfa-kod-input").value.trim();
      if (!/^\d{6}$/.test(kod)) {
        showMessage(msg, "6 haneli kodu eksiksiz gir.");
        return;
      }

      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId: enrollData.id,
      });
      if (challengeErr) {
        showMessage(msg, "Doğrulama başlatılamadı: " + challengeErr.message);
        return;
      }

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrollData.id,
        challengeId: challengeData.id,
        code: kod,
      });
      if (verifyErr) {
        showMessage(msg, "Kod hatalı veya süresi doldu: " + verifyErr.message);
        return;
      }

      showMessage(msg, "2FA başarıyla etkinleştirildi.", "success");
      await renderMfaDurumu(box);
    });
  });
}

/* ---------------------------------------------------------------------- */
/* HESABI SİL (herkes kendi hesabını, admin dahil, aynı yoldan siler)      */
/* ---------------------------------------------------------------------- */
function wireDeleteAccount(session, profile) {
  const btn = document.getElementById("hesap-sil-btn");
  const confirmInput = document.getElementById("hesap-sil-onay");
  const msg = document.getElementById("hesap-sil-message");

  btn.addEventListener("click", async () => {
    // Yanlışlıkla tıklamayı önlemek için kullanıcı "SİL" yazmalı.
    if (confirmInput.value.trim().toUpperCase() !== "SİL") {
      showMessage(msg, 'Onaylamak için kutuya büyük harflerle "SİL" yaz.');
      return;
    }
    const ekstraUyari =
      profile.role === "admin"
        ? "\n\nDİKKAT: Bu hesap bir YÖNETİCİ hesabıdır. Silersen ve başka bir admin yoksa siteyi yönetecek kimse kalmaz."
        : "";
    const sure = window.confirm(
      "Bu işlem GERİ ALINAMAZ. Hesabın ve tüm verilerin kalıcı olarak silinecek. Emin misin?" + ekstraUyari
    );
    if (!sure) return;

    btn.disabled = true;
    btn.textContent = "Siliniyor...";

    try {
      const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        // hedef_kullanici_id GÖNDERMİYORUZ -> Edge Function bunu "kendini
        // sil" olarak yorumlar. Admin dahil HERKES bu yoldan kendini silebilir.
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bilinmeyen hata");

      await supabase.auth.signOut();
      alert("Hesabın silindi. Anasayfaya yönlendiriliyorsun.");
      window.location.href = "/";
    } catch (err) {
      showMessage(msg, "Hesap silinemedi: " + err.message);
      btn.disabled = false;
      btn.textContent = "Hesabımı Kalıcı Olarak Sil";
    }
  });
}

/* ---------------------------------------------------------------------- */
/* ÖZEL İÇERİKLERİM (okundu durumu + son geçerlilik tarihiyle)             */
/* ---------------------------------------------------------------------- */
async function loadOzelIcerikler() {
  const list = document.getElementById("ozel-icerik-list");
  const { data, error } = await supabase
    .from("special_content")
    .select(
      "id, title, slug, summary, created_at, content_access(okundu_mu, okundu_tarihi, son_gecerlilik_tarihi)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p class="muted">Özel içerikler yüklenemedi.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<p class="muted">Henüz sana atanmış özel bir içerik yok.</p>`;
    return;
  }

  // NOT: Bu sorgu RLS sayesinde zaten sadece admin'in veya bize
  // content_access ile açıkça atadığı (ve süresi geçmemiş) satırları
  // döndürür — ekstra bir "erişimim var mı" filtresi frontend'de
  // YAZMIYORUZ, çünkü güvenlik veritabanı seviyesinde zaten sağlanıyor.
  list.innerHTML = data
    .map((item) => {
      const erisim = item.content_access?.[0];
      const okunduEtiketi = erisim?.okundu_mu
        ? `<span class="rol-durum--ok">✓ Okundu · ${new Date(erisim.okundu_tarihi).toLocaleDateString("tr-TR")}</span>`
        : `<span class="muted">Henüz okunmadı</span>`;
      const sonGecerlilik = erisim?.son_gecerlilik_tarihi
        ? `<span class="muted"> · Erişim sonu: ${new Date(erisim.son_gecerlilik_tarihi).toLocaleDateString("tr-TR")}</span>`
        : "";
      return `
      <a class="post-card" href="/ozel-icerik.html?id=${encodeURIComponent(item.id)}">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${new Date(item.created_at).toLocaleDateString("tr-TR")} · ${okunduEtiketi}${sonGecerlilik}</p>
        <p>${escapeHtml(item.summary ?? "")}</p>
      </a>`;
    })
    .join("");
}

function wireLogout() {
  document.getElementById("cikis-btn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  });
}

init(); // sayfa modülü yüklenince otomatik çalışır; #app'i requireAuth() gösterir
