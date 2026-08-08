/*
 * assets/js/panel.js — /panel.html
 * Profil görüntüleme/düzenleme, avatar değiştirme, şifre değiştirme,
 * "Hesabımı Sil" ve kullanıcıya atanmış özel içeriklerin listesi.
 */
import { supabase, showMessage, escapeHtml } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

// ---- BURAYI DOLDUR: delete-account Edge Function URL'in ----
const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

async function init() {
  const { session, profile } = await requireAuth({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  renderProfile(profile);
  wireProfileForm(profile);
  wireAvatarUpload(session);
  wirePasswordChange();
  wireDeleteAccount(session);
  await loadOzelIcerikler();
  wireLogout();
}

function renderProfile(profile) {
  document.getElementById("panel-email").textContent = profile.email;
  document.getElementById("panel-rol").textContent = rolEtiketi(profile.role);
  document.getElementById("full_name").value = profile.full_name ?? "";
  document.getElementById("bio").value = profile.bio ?? "";
  const avatarImg = document.getElementById("avatar-preview");
  if (profile.avatar_url) avatarImg.src = profile.avatar_url;
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
    const bio = form.bio.value.trim();

    const { error } = await supabase
      .from("profiles")
      .update({ full_name, bio }) // "role" kolonu burada YOK — trigger zaten engeller ama en baştan göndermiyoruz
      .eq("id", profile.id);

    if (error) {
      showMessage(msg, "Kaydedilemedi: " + error.message);
      return;
    }
    showMessage(msg, "Profil güncellendi.", "success");
  });
}

function wireAvatarUpload(session) {
  const input = document.getElementById("avatar-input");
  const msg = document.getElementById("avatar-message");

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showMessage(msg, "Sadece resim dosyası yükleyebilirsin.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      showMessage(msg, "Dosya 3MB'tan küçük olmalı.");
      return;
    }

    const ext = file.name.split(".").pop();
    const path = `${session.user.id}/avatar.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("avatarlar")
      .upload(path, file, { upsert: true, cacheControl: "3600" });

    if (uploadErr) {
      showMessage(msg, "Yükleme hatası: " + uploadErr.message);
      return;
    }

    const { data: pub } = supabase.storage.from("avatarlar").getPublicUrl(path);
    // Tarayıcı önbelleğini kırmak için sona zaman damgası ekliyoruz
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", session.user.id);

    if (updateErr) {
      showMessage(msg, "Profil güncellenemedi: " + updateErr.message);
      return;
    }

    document.getElementById("avatar-preview").src = publicUrl;
    showMessage(msg, "Profil fotoğrafı güncellendi.", "success");
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

function wireDeleteAccount(session) {
  const btn = document.getElementById("hesap-sil-btn");
  const confirmInput = document.getElementById("hesap-sil-onay");
  const msg = document.getElementById("hesap-sil-message");

  btn.addEventListener("click", async () => {
    // Yanlışlıkla tıklamayı önlemek için kullanıcı "SİL" yazmalı.
    if (confirmInput.value.trim().toUpperCase() !== "SİL") {
      showMessage(msg, 'Onaylamak için kutuya büyük harflerle "SİL" yaz.');
      return;
    }
    const sure = window.confirm(
      "Bu işlem GERİ ALINAMAZ. Hesabın ve tüm verilerin kalıcı olarak silinecek. Emin misin?"
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

async function loadOzelIcerikler() {
  const list = document.getElementById("ozel-icerik-list");
  const { data, error } = await supabase
    .from("special_content")
    .select("id, title, slug, summary, created_at")
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
  // content_access ile açıkça atadığı satırları döndürür — ekstra bir
  // "erişimim var mı" filtresi frontend'de YAZMIYORUZ, çünkü güvenlik
  // veritabanı seviyesinde zaten sağlanıyor (bkz. RLS politikaları).
  list.innerHTML = data
    .map(
      (item) => `
      <a class="post-card" href="/ozel-icerik.html?id=${encodeURIComponent(item.id)}">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${new Date(item.created_at).toLocaleDateString("tr-TR")}</p>
        <p>${escapeHtml(item.summary ?? "")}</p>
      </a>`
    )
    .join("");
}

function wireLogout() {
  document.getElementById("cikis-btn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  });
}

init(); // sayfa modülü yüklenince otomatik çalışır; #app'i requireAuth() gösterir
