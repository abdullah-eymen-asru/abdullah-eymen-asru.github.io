/*
 * assets/js/auth-pages.js
 * hesap/giris.html, hesap/kayit.html, hesap/sifremi-unuttum.html,
 * hesap/sifre-guncelle.html tarafından ortak kullanılan fonksiyonlar. Her
 * sayfa sadece ihtiyacı olan init fonksiyonunu çağırır (aşağıya bkz).
 */
import { supabase, showMessage, showSpamNotice, KVKK_METIN_SURUMU, turkceOtpHatasi } from "./supabase-client.js";

const REDIRECT_AFTER_LOGIN = "/panel/panel.html";
// Google OAuth ve "şifre sıfırlama" e-postası kullanıcıyı bu sayfaya
// geri döndürür; Supabase SDK URL'deki token'ı otomatik yakalar.
const SITE_ORIGIN = window.location.origin;

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

/**
 * KVKK onayı olmadan (ör. "Google ile Giriş Yap"tan, hiç kayıt olmadan)
 * oluşmuş bir hesabı TAMAMEN siler. Önceden burada sadece signOut()
 * çağrılıyordu — bu, auth.users + profiles satırının veritabanında
 * "kvkk_onay_verildi = false" durumunda KALICI olarak kalmasına yol
 * açıyordu (admin panelinde/Supabase'te "üye" olarak görünmeye devam
 * ediyordu). delete-account Edge Function'ı hedef id GÖNDERİLMEDEN
 * çağrıldığında "çağıranın kendi hesabını sil" olarak çalışır — tam
 * burada ihtiyacımız olan şey bu, çünkü kullanıcı şu an kendi (henüz
 * KVKK onaylamamış) oturumuyla giriş yapmış durumda.
 */
async function kvkkOnaysizHesabiSilVeCikis() {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}), // hedef yok -> kendini sil
      });
    }
  } catch (err) {
    // Silme isteği ağ hatasıyla başarısız olsa bile en azından oturumu
    // kapatıyoruz — hesap veritabanında kalsa da kullanıcı bu tarayıcıda
    // giriş yapmış görünmeyecek. (Kalıntı hesap, migration'daki tek
    // seferlik temizlik betiğiyle veya admin panelinden silinebilir.)
    console.error("KVKK onaysız hesap silinemedi:", err);
  } finally {
    await supabase.auth.signOut();
  }
}

/*
 * GOOGLE İLE GİRİŞ/KAYIT — KVKK ONAYI SORUNU
 * ---------------------------------------------------------------------
 * Eskiden "Google ile Giriş Yap" (giris.html) hiçbir KVKK kontrolü
 * yapmadan doğrudan oturum açtırıyordu: Supabase, Google ile ilk kez
 * gelen bir e-postayı otomatik olarak YENİ bir kullanıcı/profil olarak
 * oluşturuyor (handle_new_user trigger'ı), yani "Giriş Yap" fiilen
 * "Kayıt Ol" gibi de çalışabiliyordu — üye hiç KVKK Aydınlatma Metni +
 * Açık Rıza onayı vermeden sisteme girmiş oluyordu.
 *
 * Çözüm:
 *  - "Google ile Kayıt Ol" (kayit.html): SADECE yukarıdaki KVKK
 *    checkbox'ı işaretliyse OAuth başlatılır; dönüşte kvkk_onayini_ver()
 *    RPC'siyle onay veritabanına yazılır (kvkk_onay_verildi = true).
 *  - "Google ile Giriş Yap" (giris.html): OAuth her zaman izin verir
 *    (Supabase bunu engelleyemeyiz), ama dönüşte profildeki
 *    kvkk_onay_verildi bayrağına bakarız. Bu bayrak SADECE "Kayıt Ol"
 *    akışından (e-posta/şifre ya da Google ile kayıt) geçmiş
 *    kullanıcılarda true olur. Bayrak false ise (üye hiç kayıt olmadan
 *    doğrudan "Giriş Yap"a tıklamış demektir) oturumu hemen kapatıp
 *    "kullanıcı bulunamadı, kayıt ol" mesajı gösteririz — erişim
 *    verilmez.
 *
 * Her iki akışta da redirectTo'yu BİLEREK ilgili sayfanın kendisine
 * (giris.html / kayit.html) sabitliyoruz ki OAuth dönüşünde bu kontrolü
 * yapabilelim; asıl istenen hedefe (donus / panel) kontrolden SONRA biz
 * yönlendiriyoruz.
 */
const GOOGLE_GIRIS_INTENT_KEY = "aea_google_giris_intent";
const GOOGLE_GIRIS_DONUS_KEY = "aea_google_giris_donus";
const GOOGLE_KAYIT_INTENT_KEY = "aea_google_kayit_intent";

/* ---------------------------------------------------------------------- */
/* GİRİŞ SAYFASI (hesap/giris.html)                                       */
/* ---------------------------------------------------------------------- */
export function initGirisPage() {
  const form = document.getElementById("giris-form");
  const msg = document.getElementById("auth-message");
  const googleBtn = document.getElementById("google-giris-btn");

  // Panelde "E-posta Değiştir" ile gönderilen onay linklerinden birine
  // tıklandığında Supabase kullanıcıyı buraya "#message=...&type=email_change"
  // (veya benzeri) hash'iyle geri gönderir. detectSessionInUrl bunu arka
  // planda otomatik işler. "Secure email change" açık olduğu için TEK bir
  // link değişikliği TAMAMLAMAZ — diğer adresteki linkin/kodun da
  // onaylanması gerekir; o yüzden burada "değişti" değil, "bu adres
  // onaylandı" diyoruz.
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hashParams.get("type") === "email_change" || hashParams.get("message")?.includes("mail")) {
    showMessage(
      msg,
      "Bu e-posta adresi onaylandı. E-posta değişikliğinin tamamlanması için diğer adresine gelen linke de tıklaman (veya panelden kodla onaylaman) gerekiyor.",
      "success"
    );
  } else if (hashParams.get("error")) {
    showMessage(msg, "Linkin süresi dolmuş veya geçersiz. Panelden yeni bir onay linki iste.");
    // Google girişi sırasında kullanıcı OAuth ekranını iptal ettiyse ya da
    // bir hata döndüyse, bir sonraki normal ziyarette yanlışlıkla tekrar
    // "Google dönüşü" sanılmasın diye bekleyen bayrağı temizliyoruz.
    sessionStorage.removeItem(GOOGLE_GIRIS_INTENT_KEY);
    sessionStorage.removeItem(GOOGLE_GIRIS_DONUS_KEY);
  }

  // "Google ile Giriş Yap" butonuna tıklandıktan sonra Supabase bizi buraya
  // (giris.html) geri gönderdiyse: oturum kurulur kurulmaz kaydın GERÇEKTEN
  // var olup olmadığını kontrol ediyoruz (bkz. yukarıdaki açıklama).
  if (sessionStorage.getItem(GOOGLE_GIRIS_INTENT_KEY) === "1") {
    googleGirisDonusunuIsle(msg);
  }

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
    // Hedefi (donus) hemen kullanmıyoruz — redirectTo'yu bilerek bu sayfaya
    // sabitliyoruz ki OAuth dönüşünde "kayıtlı mı" kontrolünü yapabilelim;
    // hedefi sessionStorage'da saklayıp kontrolden SONRA oraya gideceğiz.
    sessionStorage.setItem(GOOGLE_GIRIS_INTENT_KEY, "1");
    sessionStorage.setItem(GOOGLE_GIRIS_DONUS_KEY, donus);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${SITE_ORIGIN}/hesap/giris.html` },
    });
    if (error) {
      sessionStorage.removeItem(GOOGLE_GIRIS_INTENT_KEY);
      sessionStorage.removeItem(GOOGLE_GIRIS_DONUS_KEY);
      showMessage(msg, "Google ile giriş başlatılamadı: " + error.message);
    }
  });
}

/**
 * "Google ile Giriş Yap" sonrası bu sayfaya (giris.html) dönüldüğünde
 * çağrılır. Oturum kurulunca profildeki kvkk_onay_verildi bayrağına bakar:
 *  - true  -> bu üye gerçekten kayıtlı (bir zamanlar KVKK onayı vererek
 *             kayıt olmuş), istenen hedefe yönlendirilir.
 *  - false/yok -> bu Google hesabıyla hiç kayıt olunmamış (handle_new_user
 *             trigger'ı OAuth ile gelen HERKES için otomatik bir profil
 *             satırı açar, ama kvkk_onay_verildi varsayılan olarak false'tur)
 *             -> oturum kapatılır, "kullanıcı bulunamadı" mesajı gösterilir,
 *             panele erişim VERİLMEZ.
 */
function googleGirisDonusunuIsle(msg) {
  let tamamlandi = false;

  async function kontrolEt() {
    if (tamamlandi) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return; // henüz oturum kurulmadı, aşağıdaki dinleyici/yedek tekrar dener

    tamamlandi = true;
    authListener?.subscription?.unsubscribe();
    sessionStorage.removeItem(GOOGLE_GIRIS_INTENT_KEY);
    const donus = sessionStorage.getItem(GOOGLE_GIRIS_DONUS_KEY) || REDIRECT_AFTER_LOGIN;
    sessionStorage.removeItem(GOOGLE_GIRIS_DONUS_KEY);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("kvkk_onay_verildi")
      .eq("id", session.user.id)
      .single();

    if (!error && profile?.kvkk_onay_verildi) {
      window.location.href = donus;
      return;
    }

    // KVKK onayı yok -> bu Google hesabıyla hiç GERÇEK bir kayıt
    // yapılmamış demektir. Önceden burada sadece signOut() yapılıyordu ve
    // handle_new_user trigger'ının oluşturduğu auth.users + profiles
    // satırı veritabanında KALICI olarak "üye" gibi görünmeye devam
    // ediyordu (bkz. admin panel / Supabase Table Editor ekran
    // görüntüleri). Şimdi hesabı gerçekten SİLİYORUZ.
    showMessage(
      msg,
      'Bu Google hesabıyla kayıtlı bir kullanıcı bulunamadı. Lütfen önce "Kayıt Ol" sayfasından Google ile kayıt ol.'
    );
    await kvkkOnaysizHesabiSilVeCikis();
  }

  const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") kontrolEt();
  });

  // Oturum, dinleyici bağlanmadan ÖNCE zaten kurulmuş olabilir — hemen bir
  // kez de biz deniyoruz. detectSessionInUrl bazen bir sonraki mikro
  // görevde tamamlandığından, kısa bir yedek gecikmeyle son bir kez daha.
  kontrolEt();
  setTimeout(kontrolEt, 1200);
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
  // KVKK checkbox'ı artık HEM e-posta/şifre formunu HEM "Google ile Kayıt
  // Ol" butonunu birlikte gater — bu yüzden <form>'un dışında, sayfanın en
  // üstünde duruyor (bkz. kayit.md) ve form="kayit-form" ile forma bağlı.
  // Doğrudan id ile okuyoruz ki Google butonunun click dinleyicisi de
  // (form submit olmadan) durumuna bakabilsin.
  const kvkkCheckbox = document.getElementById("kvkk_onay");

  // Google OAuth dönüşünde (bkz. aşağıdaki googleBtn dinleyicisi) Supabase
  // bizi buraya (kayit.html) geri gönderdiyse KVKK onayını veritabanına
  // yaz ve panele yönlendir.
  if (sessionStorage.getItem(GOOGLE_KAYIT_INTENT_KEY) === "1") {
    googleKayitDonusunuIsle(msg);
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');

    const email = form.email.value.trim();
    const password = form.password.value;
    const passwordAgain = form.password_again.value;
    const firstName = form.first_name.value.trim();
    const lastName = form.last_name.value.trim();
    const kvkkOnay = kvkkCheckbox?.checked ?? false;

    if (password !== passwordAgain) {
      showMessage(msg, "Şifreler birbiriyle eşleşmiyor.");
      return;
    }
    if (password.length < 8) {
      showMessage(msg, "Şifre en az 8 karakter olmalı.");
      return;
    }
    if (!firstName || !lastName) {
      showMessage(msg, "Ad ve soyadını gir.");
      return;
    }
    if (!kvkkOnay) {
      showMessage(msg, "Kayıt olmak için KVKK Aydınlatma Metni ve Açık Rıza onayını işaretlemelisin.");
      return;
    }

    submitBtn.disabled = true;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName, // handle_new_user() trigger'ı bunu profiles.first_name'e kopyalar
          last_name: lastName,   // handle_new_user() trigger'ı bunu profiles.last_name'e kopyalar
          kvkk_onay: true,
          kvkk_versiyon: KVKK_METIN_SURUMU,
        },
        emailRedirectTo: `${SITE_ORIGIN}/hesap/giris.html`,
      },
    });
    submitBtn.disabled = false;

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already been registered")) {
        showMessage(msg, "Bu e-postayla zaten bir hesabın var, kayıt olmana gerek yok. Giriş yapmayı dene.");
      } else {
        showMessage(msg, "Kayıt olunamadı: " + error.message);
      }
      return;
    }

    // NOT: Supabase, "Enable email confirmations" açıkken ve girilen e-posta
    // zaten ONAYLANMIŞ bir hesaba aitse HATA DÖNDÜRMEZ (e-posta numarası
    // taraması/enumeration yapılabilmesin diye) — bunun yerine identities
    // dizisi BOŞ olan, gerçek olmayan ("obfuscated") bir kullanıcı nesnesi
    // döner. Bu, "hesap zaten var" durumunun tek güvenilir istemci taraflı
    // göstergesidir; bu kontrol olmadan kullanıcı "kayıt alındı, e-postanı
    // kontrol et" mesajını görür ama gerçekte hiçbir mail gelmez ve hiçbir
    // yeni hesap açılmaz (Google ile kayıtta da aynı e-posta zaten kayıtlıysa
    // aynı otomatik-bağlama davranışı geçerlidir, bkz. googleKayitDonusunuIsle).
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      showMessage(msg, "Bu e-postayla zaten bir hesabın var, kayıt olmana gerek yok. Giriş yapmayı dene.");
      return;
    }

    showMessage(
      msg,
      "Kayıt alındı! E-posta adresine gönderdiğimiz doğrulama linkine tıklayıp hesabını aktifleştir. Linke tıklayamıyorsan aşağıdan kodla da onaylayabilirsin.",
      "success"
    );
    showSpamNotice(document.getElementById("auth-spam-notice"));
    if (kodOnayLink) {
      kodOnayLink.href = kodOnayLink.href.split("?")[0] + "?email=" + encodeURIComponent(email);
    }
    form.reset();
  });

  googleBtn?.addEventListener("click", async () => {
    // Google OAuth kendi ekranında bir KVKK onayı almıyor — bu yüzden
    // OAuth'u BAŞLATMADAN ÖNCE checkbox'ın işaretli olmasını zorunlu
    // tutuyoruz. İşaretli değilse hiç Google penceresi açılmaz.
    if (!kvkkCheckbox?.checked) {
      showMessage(
        msg,
        "Google ile kayıt olmak için önce yukarıdaki KVKK Aydınlatma Metni ve Açık Rıza onayını işaretlemelisin."
      );
      return;
    }
    sessionStorage.setItem(GOOGLE_KAYIT_INTENT_KEY, "1");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${SITE_ORIGIN}/hesap/kayit.html` },
    });
    if (error) {
      sessionStorage.removeItem(GOOGLE_KAYIT_INTENT_KEY);
      showMessage(msg, "Google ile kayıt başlatılamadı: " + error.message);
    }
  });
}

/**
 * "Google ile Kayıt Ol" sonrası bu sayfaya (kayit.html) dönüldüğünde
 * çağrılır. Oturum kurulur kurulmaz kvkk_onayini_ver() RPC'siyle KVKK
 * onayını (checkbox işaretliyken OAuth başlatıldığı için) veritabanına
 * yazar ve panele yönlendirir. Bu, hem YENİ bir Google hesabı hem de
 * (nadiren) daha önce "Giriş Yap"tan denenip kvkk_onay_verildi=false
 * kalmış bir profil için de çalışır — ikisinde de sonuç aynıdır: onay artık
 * kayıtlıdır.
 */
function googleKayitDonusunuIsle(msg) {
  let tamamlandi = false;

  async function kontrolEt() {
    if (tamamlandi) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    tamamlandi = true;
    authListener?.subscription?.unsubscribe();
    sessionStorage.removeItem(GOOGLE_KAYIT_INTENT_KEY);

    // Supabase, aynı (onaylı) e-postayla gelen bir OAuth girişini OTOMATİK
    // olarak var olan hesaba bağlar — yeni bir hesap AÇMAZ. Yani bu Google
    // girişi aslında daha önce e-posta/şifre (ya da başka bir yoldan) zaten
    // kayıt olmuş birine denk geliyor olabilir. kvkk_onay_verildi=true ise
    // bu hesap zaten GERÇEKTEN kayıtlı demektir — kullanıcıya "tekrar kayıt
    // olmana gerek yok" diyoruz ve onun önceden verdiği KVKK onayının
    // ÜZERİNE YAZMIYORUZ.
    const { data: mevcutProfil, error: profilHata } = await supabase
      .from("profiles")
      .select("kvkk_onay_verildi")
      .eq("id", session.user.id)
      .single();

    if (!profilHata && mevcutProfil?.kvkk_onay_verildi) {
      showMessage(
        msg,
        "Bu e-postayla zaten bir hesabın var, kayıt olmana gerek yok. Seni hesabına giriş yaptırdık, panele yönlendiriliyorsun...",
        "success"
      );
      setTimeout(() => (window.location.href = REDIRECT_AFTER_LOGIN), 1500);
      return;
    }

    const { error } = await supabase.rpc("kvkk_onayini_ver", { p_versiyon: KVKK_METIN_SURUMU });
    if (error) {
      console.error("Google ile kayıtta KVKK onayı kaydedilemedi:", error);
      showMessage(
        msg,
        "Google ile giriş yapıldı ama KVKK onayın kaydedilemedi. Panele yönlendiriliyorsun, lütfen oradan tekrar onayla.",
        "success"
      );
      setTimeout(() => (window.location.href = REDIRECT_AFTER_LOGIN), 1800);
      return;
    }

    window.location.href = REDIRECT_AFTER_LOGIN;
  }

  const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") kontrolEt();
  });

  kontrolEt();
  setTimeout(kontrolEt, 1200);
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
    showSpamNotice(document.getElementById("auth-spam-notice"));
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
