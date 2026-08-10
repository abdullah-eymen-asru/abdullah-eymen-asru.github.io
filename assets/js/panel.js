/*
 * assets/js/panel.js — /panel/panel.html
 * Profil görüntüleme (salt bilgi), şifre değiştirme, 2FA (TOTP) kurulumu,
 * KVKK onay durumu/yeniden onay, "Hesabımı Sil" ve kullanıcıya atanmış
 * özel içeriklerin listesi (okundu durumu + son geçerlilik tarihiyle).
 *
 * NOT: Profil fotoğrafı yükleme ve "Hakkımda" (bio) düzenleme alanları
 * BİLİNÇLİ OLARAK KALDIRILDI (Supabase Storage kullanılmaması ve site
 * genelindeki "Hakkımda" metninin sadece admin panelinden yönetilmesi
 * istendiği için). Ad Soyad hâlâ düzenlenebilir.
 */
import { supabase, showMessage, showSpamNotice, escapeHtml, KVKK_METIN_SURUMU } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";
import { wireUserChat } from "./chat.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

async function init() {
  const { session, profile } = await requireAuth({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  renderProfile(profile);
  wireProfileForm(profile);
  wireEmailChange(profile);
  wirePasswordChange();
  wireDeleteAccount(session, profile);
  wireKvkk(profile);
  await wireMfa();
  await loadOzelIcerikler();
  await wireUserChat(profile);
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

/* ---------------------------------------------------------------------- */
/* E-POSTA DEĞİŞTİR                                                        */
/* Hem e-posta/şifreyle hem Google ile kayıt olmuş kullanıcılar için aynı  */
/* şekilde çalışır: supabase.auth.updateUser({ email }) çağrıldığında      */
/* Supabase varsayılan olarak YENİ adrese bir onay linki gönderir; kadın   */
/* giriş e-postası, kullanıcı o linke tıklayana kadar DEĞİŞMEZ. (Dashboard */
/* > Authentication > Email > "Secure email change" açıksa eski adrese de */
/* ayrıca bir onay maili gider — bkz. README, "Çift Onaylı E-posta         */
/* Değişikliği" bölümü.)                                                   */
/* ---------------------------------------------------------------------- */
function wireEmailChange(profile) {
  const form = document.getElementById("eposta-degistir-form");
  const msg = document.getElementById("eposta-message");
  const spamNotice = document.getElementById("eposta-spam-notice");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const yeniEposta = form.yeni_eposta.value.trim();

    if (spamNotice) spamNotice.hidden = true;

    if (!yeniEposta) {
      showMessage(msg, "Yeni e-posta adresini gir.");
      return;
    }
    if (yeniEposta.toLowerCase() === profile.email?.toLowerCase()) {
      showMessage(msg, "Bu zaten kayıtlı e-posta adresin.");
      return;
    }

    submitBtn.disabled = true;
    const { error } = await supabase.auth.updateUser(
      { email: yeniEposta },
      { emailRedirectTo: `${window.location.origin}/hesap/giris.html` }
    );
    submitBtn.disabled = false;

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already been registered")) {
        showMessage(msg, "Bu e-posta zaten başka bir hesapta kayıtlı.");
      } else {
        showMessage(msg, "E-posta değiştirilemedi: " + error.message);
      }
      return;
    }

    showMessage(
      msg,
      `${yeniEposta} adresine bir onay linki gönderdik. Linke tıklayana kadar giriş e-postan (${profile.email}) değişmeden kalır.`,
      "success"
    );
    showSpamNotice(spamNotice);
    form.reset();
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
/* KVKK ONAYI                                                             */
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
        <a href="/kurumsal/gizlilik-politikasi.html" target="_blank">KVKK Aydınlatma Metni ve Gizlilik Politikası</a>'nı
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
    // İYİLEŞTİRME: optimistik (yerel) güncelleme yerine profili VERİTABANINDAN
    // yeniden çekiyoruz — "onayladım ama her yerde onaylı görünmüyor"
    // şikayetinin bir sebebi, yazma işlemi sessizce başarısız olsa bile
    // (ör. oturum/RLS kenar durumu) arayüzün hep "başarılı" göstermesiydi.
    // Artık gerçek DB durumunu okuyup ona göre çiziyoruz.
    const { data: guncelProfil, error: fetchErr } = await supabase
      .from("profiles")
      .select("kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi")
      .eq("id", profile.id)
      .single();
    if (!fetchErr && guncelProfil) {
      Object.assign(profile, guncelProfil);
    } else {
      profile.kvkk_onay_verildi = true;
      profile.kvkk_onay_versiyonu = KVKK_METIN_SURUMU;
      profile.kvkk_onay_tarihi = new Date().toISOString();
    }
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
    const baslatBtn = document.getElementById("mfa-baslat-btn");
    baslatBtn.disabled = true;

    try {
      const enrollData = await mfaBaslatTemizVeTekrarDene();
      if (!enrollData) {
        showMessage(msg, "2FA başlatılamadı, lütfen sayfayı yenileyip tekrar dene.");
        baslatBtn.disabled = false;
        return;
      }

      document.getElementById("mfa-kurulum-alani").hidden = false;
      document.getElementById("mfa-baslat-btn").hidden = true;

      // BUG FİX: enrollData.totp.qr_code bir data-URI SVG string'idir ve
      // İÇİNDE ÇOK SAYIDA çift tırnak (") karakteri barındırır (SVG
      // özniteliklerinin kendi tırnakları). Bunu `<img src="${...}">`
      // şeklinde bir HTML string'ine gömmek, o iç tırnaklardan biri src
      // özniteliğini ERKEN kapatıp geri kalanının (alt=... style=...) düz
      // METİN olarak sayfada görünmesine yol açıyordu (ekran görüntüsündeki
      // "bozuk yazı" tam olarak buydu). Çözüm: img elemanını innerHTML
      // string birleştirmesiyle DEĞİL, DOM API'siyle oluşturup src'yi bir
      // JS ÖZELLİĞİ (property) olarak atamak — bu şekilde tırnak/HTML
      // özel karakterleri hiç parse edilmez, olduğu gibi kullanılır.
      const qrWrap = document.getElementById("mfa-qr-wrap");
      qrWrap.innerHTML = "";
      const img = document.createElement("img");
      img.src = enrollData.totp.qr_code;
      img.alt = "2FA QR kodu";
      img.style.background = "#fff";
      img.style.padding = "8px";
      img.style.borderRadius = "8px";
      img.style.maxWidth = "220px";
      qrWrap.appendChild(img);

      document.getElementById("mfa-secret").textContent = enrollData.totp.secret;
      mfaDogrulamayiBagla(enrollData, msg, box);
    } catch (err) {
      showMessage(msg, "Başlatılamadı: " + err.message);
      baslatBtn.disabled = false;
    }
  });
}

/**
 * BUG FİX: "A factor with the friendly name "" for this user already
 * exists" hatası — kullanıcı 2FA kurulumunu yarıda bırakıp (QR'ı okutmadan
 * sayfadan ayrılıp) tekrar denediğinde, önceki denemeden kalan
 * DOĞRULANMAMIŞ ("unverified") kayıt, aynı (boş) friendly name ile
 * çakışıyordu. Eski kod bu temizliği deniyordu ama (a) unenroll'un kendi
 * hatasını YOK SAYIYORDU (silme başarısız olsa bile fark edilmiyordu) ve
 * (b) her seferinde AYNI (boş) friendly name ile enroll ediyordu, yani
 * temizlik bir sebeple başarısız olursa çakışma KESİN tekrarlıyordu.
 * Burada: 1) tüm eski "unverified" kayıtları silmeyi DENE (hata olsa bile
 * devam et), 2) HER ZAMAN benzersiz bir friendly name kullan (aynı isimle
 * çakışma ihtimalini baştan ortadan kaldırır), 3) yine de "already exists"
 * hatası gelirse bir kez daha agresif temizlik yapıp TEKRAR dene.
 */
async function mfaBaslatTemizVeTekrarDene() {
  async function eskiKayitlariTemizle() {
    const { data: factorList } = await supabase.auth.mfa.listFactors();
    const factors = factorList?.totp || factorList?.all || [];
    for (const factor of factors) {
      if (factor.status === "unverified") {
        try {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        } catch (_e) {
          // Sessizce geç — aşağıdaki benzersiz friendly name zaten
          // çakışmayı büyük ölçüde engelliyor, bu sadece ek bir temizlik.
        }
      }
    }
  }

  function benzersizIsim() {
    return `totp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  await eskiKayitlariTemizle();

  let { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: benzersizIsim(),
  });

  if (enrollErr && /already exists/i.test(enrollErr.message)) {
    // Bir kez daha, daha agresif temizlik + yeni bir isimle tekrar dene.
    await eskiKayitlariTemizle();
    const tekrar = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: benzersizIsim(),
    });
    enrollData = tekrar.data;
    enrollErr = tekrar.error;
  }

  if (enrollErr) throw enrollErr;
  return enrollData;
}

function mfaDogrulamayiBagla(enrollData, msg, box) {

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
      <a class="post-card" href="/panel/ozel-icerik.html?id=${encodeURIComponent(item.id)}">
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
