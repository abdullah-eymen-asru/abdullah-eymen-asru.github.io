/*
 * assets/js/auth-pages.js
 * hesap/giris.html, hesap/kayit.html, hesap/sifremi-unuttum.html,
 * hesap/sifre-guncelle.html tarafından ortak kullanılan fonksiyonlar. Her
 * sayfa sadece ihtiyacı olan init fonksiyonunu çağırır (aşağıya bkz).
 */
import { supabase, showMessage, KVKK_METIN_SURUMU, turkceOtpHatasi } from "./supabase-client.js";

const REDIRECT_AFTER_LOGIN = "/panel/panel.html";
// Google OAuth ve "şifre sıfırlama" e-postası kullanıcıyı bu sayfaya
// geri döndürür; Supabase SDK URL'deki token'ı otomatik yakalar.
const SITE_ORIGIN = window.location.origin;

/* ---------------------------------------------------------------------- */
/* GİRİŞ SAYFASI (hesap/giris.html)                                       */
/* ---------------------------------------------------------------------- */
export function initGirisPage() {
  const form = document.getElementById("giris-form");
  const msg = document.getElementById("auth-message");
  const googleBtn = document.getElementById("google-giris-btn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const email = form.email.value.trim();
    const password = form.password.value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;

    if (error) {
      // Supabase hata mesajlarını kullanıcı dostu Türkçeye çeviriyoruz.
      if (error.message.includes("Email not confirmed")) {
        showMessage(msg, "E-posta adresini henüz doğrulamadın. Gelen kutunu kontrol et.");
      } else if (error.message.includes("Invalid login credentials")) {
        showMessage(msg, "E-posta veya şifre hatalı.");
      } else {
        showMessage(msg, "Giriş yapılamadı: " + error.message);
      }
      return;
    }

    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get("donus") || REDIRECT_AFTER_LOGIN;
  });

  googleBtn?.addEventListener("click", async () => {
    const params = new URLSearchParams(window.location.search);
    const donus = params.get("donus") || REDIRECT_AFTER_LOGIN;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${SITE_ORIGIN}${donus}` },
    });
  });
}

/* ---------------------------------------------------------------------- */
/* KAYIT SAYFASI (hesap/kayit.html)                                       */
/* ---------------------------------------------------------------------- */
export function initKayitPage() {
  const form = document.getElementById("kayit-form");
  const msg = document.getElementById("auth-message");
  const googleBtn = document.getElementById("google-kayit-btn");
  // "Kod ile onayla" linki: kayıt başarılı olunca bu linkin href'ine
  // ?email=... ekliyoruz ki hesap-onayla.html açılınca e-posta alanı
  // otomatik dolu gelsin (kullanıcı tekrar yazmak zorunda kalmasın).
  const kodOnayLink = document.getElementById("kod-ile-onayla-link");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');

    const email = form.email.value.trim();
    const password = form.password.value;
    const passwordAgain = form.password_again.value;
    const fullName = form.full_name.value.trim();
    const kvkkOnay = form.kvkk_onay?.checked ?? false;

    if (password !== passwordAgain) {
      showMessage(msg, "Şifreler birbiriyle eşleşmiyor.");
      return;
    }
    if (password.length < 8) {
      showMessage(msg, "Şifre en az 8 karakter olmalı.");
      return;
    }
    if (!kvkkOnay) {
      showMessage(msg, "Kayıt olmak için KVKK Aydınlatma Metni ve Açık Rıza onayını işaretlemelisin.");
      return;
    }

    submitBtn.disabled = true;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName, // handle_new_user() trigger'ı bunu profiles.full_name'e kopyalar
          kvkk_onay: true,
          kvkk_versiyon: KVKK_METIN_SURUMU,
        },
        emailRedirectTo: `${SITE_ORIGIN}/hesap/giris.html`,
      },
    });
    submitBtn.disabled = false;

    if (error) {
      if (error.message.includes("already registered")) {
        showMessage(msg, "Bu e-posta zaten kayıtlı. Giriş yapmayı dene.");
      } else {
        showMessage(msg, "Kayıt olunamadı: " + error.message);
      }
      return;
    }

    showMessage(
      msg,
      "Kayıt alındı! E-posta adresine gönderdiğimiz doğrulama linkine tıklayıp hesabını aktifleştir. Linke tıklayamıyorsan aşağıdan kodla da onaylayabilirsin.",
      "success"
    );
    if (kodOnayLink) {
      kodOnayLink.href = kodOnayLink.href.split("?")[0] + "?email=" + encodeURIComponent(email);
    }
    form.reset();
  });

  googleBtn?.addEventListener("click", async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${SITE_ORIGIN}${REDIRECT_AFTER_LOGIN}` },
    });
  });
}

/* ---------------------------------------------------------------------- */
/* HESABI KODLA ONAYLA (hesap/hesap-onayla.html)                          */
/* Kayıt e-postasındaki linke tıklayamayan kullanıcılar için: e-posta +   */
/* mailde gelen kodu girerek hesabı doğrudan doğrulama (verifyOtp).       */
/* ---------------------------------------------------------------------- */
export function initHesapOnaylaPage() {
  const form = document.getElementById("hesap-onayla-form");
  const msg = document.getElementById("auth-message");
  if (!form) return;

  // Kayıt sayfasından "?email=..." ile gelindiyse e-posta alanını
  // otomatik dolduruyoruz.
  const params = new URLSearchParams(window.location.search);
  const prefillEmail = params.get("email");
  if (prefillEmail) form.email.value = prefillEmail;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const email = form.email.value.trim();
    const token = form.code.value.trim();

    submitBtn.disabled = true;
    // type: "signup" → bu, kayıt onay maili için üretilen kodun/linkin
    // doğrulama türüdür. Başarılı olursa hesap doğrulanır VE kullanıcı
    // otomatik olarak oturum açmış olur (linke tıklamakla aynı sonuç).
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
    submitBtn.disabled = false;

    if (error) {
      showMessage(msg, "Hesap onaylanamadı: " + turkceOtpHatasi(error.message));
      return;
    }

    showMessage(msg, "Hesabın onaylandı! Panele yönlendiriliyorsun...", "success");
    setTimeout(() => (window.location.href = REDIRECT_AFTER_LOGIN), 1200);
  });
}

/* ---------------------------------------------------------------------- */
/* ŞİFREMİ UNUTTUM (hesap/sifremi-unuttum.html)                           */
/* ---------------------------------------------------------------------- */
export function initSifremiUnuttumPage() {
  const form = document.getElementById("sifremi-unuttum-form");
  const msg = document.getElementById("auth-message");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const email = form.email.value.trim();

    submitBtn.disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_ORIGIN}/hesap/sifre-guncelle.html`,
    });
    submitBtn.disabled = false;

    // NOT: Kullanıcı numarası taraması (email enumeration) yapılabilmesin
    // diye e-posta var/yok fark etmeksizin HER ZAMAN aynı mesajı gösteriyoruz.
    if (error) console.error(error);
    showMessage(
      msg,
      "Eğer bu adres sistemde kayıtlıysa, şifre sıfırlama linki gönderildi.",
      "success"
    );
    form.reset();
  });
}

/* ---------------------------------------------------------------------- */
/* ŞİFRE GÜNCELLE (hesap/sifre-guncelle.html) — e-postadaki linkten gelinen sayfa */
/* ---------------------------------------------------------------------- */
export function initSifreGuncellePage() {
  const form = document.getElementById("sifre-guncelle-form");
  const msg = document.getElementById("auth-message");
  const expiredBox = document.getElementById("auth-expired");
  const otpToggle = document.getElementById("auth-otp-toggle");
  const otpForm = document.getElementById("auth-otp-form");
  // İkisini de en başta "let" ile tanımlıyoruz: aşağıda hash'te "error"
  // varsa fonksiyon erken "return" ediyor — ama otp formu dinleyicileri
  // (otpForm submit) o return'den ÖNCE bağlandığı için, kullanıcı süresi
  // dolmuş ekranındayken kodu girip oturumHazirOldu() çağırdığında
  // sessionHazir'e hâlâ erişebilmesi lazım. Bu değişkenler daha aşağıda
  // (early return'den SONRA) tanımlansaydı, erken dönüş durumunda hiç
  // atanmamış olur ve sonraki erişimde TDZ (temporal dead zone) hatası
  // alırdık.
  let authListener;
  let sessionHazir = false;

  function suresiDolmusEkraniGoster() {
    authListener?.subscription?.unsubscribe();
    if (form) form.hidden = true;
    if (expiredBox) expiredBox.hidden = false;
    showMessage(
      msg,
      "Bu şifre sıfırlama linkinin süresi dolmuş veya link daha önce kullanılmış. Aşağıdan yeni link isteyebilir ya da (elindeki kod hâlâ geçerliyse) kodla devam edebilirsin."
    );
  }

  // Link üzerinden VEYA aşağıdaki "kod ile doğrula" formu üzerinden geçici
  // bir recovery oturumu kurulduğunda ikisi de burayı çağırır: şifre
  // formunu göster, süresi-dolmuş kutusunu ve kod formunu gizle.
  function oturumHazirOldu() {
    sessionHazir = true;
    if (form) form.hidden = false;
    if (expiredBox) expiredBox.hidden = true;
    if (otpForm) otpForm.hidden = true;
    if (otpToggle) otpToggle.hidden = true;
  }

  otpToggle?.addEventListener("click", () => {
    otpForm.hidden = !otpForm.hidden;
  });

  otpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = otpForm.querySelector('button[type="submit"]');
    const email = otpForm.otp_email.value.trim();
    const token = otpForm.otp_code.value.trim();

    submitBtn.disabled = true;
    // type: "recovery" → şifre sıfırlama maili için üretilen kod. Bu, aynı
    // e-postadaki linkin taşıdığı token ile aynı geçerlilik süresine
    // sahiptir; link süresi dolmuşsa kod da dolmuş olur (ikisi de aynı
    // "Email OTP expiration" ayarına bağlı).
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
    submitBtn.disabled = false;

    if (error) {
      showMessage(msg, "Kod doğrulanamadı: " + turkceOtpHatasi(error.message));
      return;
    }

    showMessage(msg, "Kod doğrulandı! Şimdi yeni şifreni belirleyebilirsin.", "success");
    oturumHazirOldu();
  });

  // E-postadaki link süresi dolmuşsa / geçersizse Supabase kullanıcıyı bu
  // sayfaya "#error=access_denied&error_code=otp_expired&..." hash'iyle
  // geri gönderir. Bu durumda form hiç işe yaramaz (submit edilince zaten
  // "Auth session missing!" hatası alınıyordu) — onun yerine direkt yeni
  // link isteme ekranını gösteriyoruz.
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hashParams.get("error")) {
    suresiDolmusEkraniGoster();
    return;
  }

  // Link geçerliyse detectSessionInUrl sayesinde SDK, URL'deki recovery
  // token'ını arka planda geçici bir oturuma çeviriyor ve "PASSWORD_RECOVERY"
  // event'ini tetikliyor. Link bozuk/eski bir formattaysa hiçbir event
  // gelmeyebilir; bir süre sonra hâlâ oturum yoksa yine süresi dolmuş
  // ekranını gösteriyoruz (kullanıcı artık sessizce forma yazıp "Auth
  // session missing!" hatasıyla karşılaşmıyor).
  ({ data: authListener } = supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") oturumHazirOldu();
  }));

  setTimeout(async () => {
    if (sessionHazir) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) suresiDolmusEkraniGoster();
  }, 2500);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const password = form.password.value;
    const passwordAgain = form.password_again.value;

    if (password !== passwordAgain) {
      showMessage(msg, "Şifreler birbiriyle eşleşmiyor.");
      return;
    }
    if (password.length < 8) {
      showMessage(msg, "Şifre en az 8 karakter olmalı.");
      return;
    }

    submitBtn.disabled = true;
    // detectSessionInUrl: true sayesinde, e-postadaki linkten gelindiğinde
    // Supabase SDK URL'deki recovery token'ını otomatik olarak geçici bir
    // oturuma çeviriyor. Bu noktada updateUser çağırmak yeterli.
    const { error } = await supabase.auth.updateUser({ password });
    submitBtn.disabled = false;

    if (error) {
      // Link süresi dolmuş/kullanılmışsa updateUser "Auth session missing!"
      // hatasıyla döner — kullanıcıya ham İngilizce hata yerine anlaşılır
      // "yeni link iste" ekranını gösteriyoruz.
      if (error.message.includes("Auth session missing")) {
        suresiDolmusEkraniGoster();
      } else {
        showMessage(msg, "Şifre güncellenemedi: " + error.message);
      }
      return;
    }

    // Şifre başarıyla değiştiğinde, güvenlik amacıyla bu tarayıcı dışındaki
    // TÜM diğer cihaz/oturumlardan otomatik çıkış yapılır (scope: "others").
    // Böylece biri hesabı ele geçirmişse şifre değiştirilir değiştirilmez
    // erişimi kesilir. Bu tarayıcıdaki oturum etkilenmez, kullanıcı panele
    // yönlendirilmeye devam eder.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) console.error("Diğer oturumlardan çıkış yapılamadı:", signOutError);

    showMessage(msg, "Şifren güncellendi! Diğer cihazlardaki oturumların kapatıldı. Panele yönlendiriliyorsun...", "success");
    setTimeout(() => (window.location.href = "/panel/panel.html"), 1500);
  });
}
