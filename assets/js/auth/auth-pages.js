/*
 * assets/js/auth/auth-pages.js
 * hesap/giris.html, hesap/kayit.html, hesap/sifremi-unuttum.html,
 * hesap/sifre-guncelle.html tarafından ortak kullanılan fonksiyonlar. Her
 * sayfa sadece ihtiyacı olan init fonksiyonunu çağırır (aşağıya bkz).
 */
import {
  supabase,
  showMessage,
  showSpamNotice,
  KVKK_METIN_SURUMU,
  KAYITLAR_KAPALI_ISARETI,
  kayitlarAcikMi,
  turkceOtpHatasi,
  oturumHatirlamaTercihiniKaydet,
} from "../core/supabase-client.js";

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

/*
 * GÜVENLİK DÜZELTMESİ — 2FA (TOTP) girişte hiç sorulmuyordu
 * ---------------------------------------------------------------------
 * ÖNCEDEN: Panelde "2FA'yı Etkinleştir" ile bir TOTP faktörü kayıt
 * edilmiş (verified) olsa bile, giris.html'deki signInWithPassword() (ve
 * Google OAuth dönüşü) çağrısı BAŞARILI bir session döndüğü an kullanıcı
 * doğrudan panele yönlendiriliyordu — authenticator uygulamasındaki 6
 * haneli kod hiçbir zaman İSTENMİYORDU. Kök neden: Supabase'te
 * signInWithPassword / signInWithOAuth SADECE şifreyi (ya da OAuth
 * kimliğini) doğrular ve oturumu "AAL1" (Authenticator Assurance Level 1)
 * seviyesinde açar; kullanıcının ayrıca bir doğrulanmış TOTP faktörü
 * varsa oturumun "AAL2"ye YÜKSELTİLMESİ ayrı bir adımdır
 * (mfa.challenge + mfa.verify) ve bu adım hiçbir sayfada
 * ÇAĞRILMIYORDU — yani 2FA sadece "kurulabiliyor" ama girişte hiç
 * ZORUNLU KILINMIYORDU.
 *
 * ÇÖZÜM: Her iki giriş yolundan (şifre ile / Google ile) sonra, hedefe
 * yönlendirmeden HEMEN ÖNCE bu fonksiyon çağrılır:
 *  - supabase.auth.mfa.getAuthenticatorAssuranceLevel() ile mevcut
 *    (currentLevel) ve GEREKEN (nextLevel) seviyeye bakılır.
 *  - nextLevel === "aal2" ve currentLevel !== "aal2" ise (yani kullanıcının
 *    doğrulanmış bir TOTP faktörü var ama bu oturum henüz o faktörle
 *    doğrulanmamış) yönlendirme YAPILMAZ; bunun yerine 6 haneli kod
 *    isteyen bir form gösterilir. Kod mfa.challenge + mfa.verify ile
 *    doğrulanınca oturum gerçekten AAL2'ye yükselir ve YALNIZCA O ZAMAN
 *    hedefe yönlendirilir.
 *  - nextLevel zaten currentLevel'a eşitse (2FA hiç kurulmamış, ya da bu
 *    zaten AAL2 bir oturum) hiçbir ek adım olmadan normal akış devam
 *    eder — 2FA kurmamış kullanıcılar için davranış DEĞİŞMEZ.
 *
 * NOT (savunma derinliği): panelde requireAuth() (bkz. auth-guard.js) de
 * aynı kontrolü ayrıca yapar — biri atlanırsa/bypass edilmeye çalışılırsa
 * (ör. konsoldan doğrudan panel.html'e gidilirse) ikinci katman devreye
 * girer.
 */
async function mfaGerekirseDogrulaVeYonlendir(msg, hedefUrl) {
  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalErr) {
    // AAL sorgusu başarısız olursa güvenli tarafta kal: giriş engellenmez
    // (kullanıcı 2FA kurmamış olabilir ve bu bir servis hatası olabilir),
    // ama hatayı konsola yazıp normal yönlendirmeye devam ediyoruz —
    // requireAuth() panelde ikinci bir kontrol katmanı olarak kalıyor.
    console.error("MFA seviyesi kontrol edilemedi:", aalErr);
    window.location.href = hedefUrl;
    return;
  }

  if (aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
    await mfaKoduIste(msg, hedefUrl);
    return;
  }

  window.location.href = hedefUrl;
}

/**
 * Giriş formunu gizleyip yerine "authenticator uygulamandaki 6 haneli
 * kodu gir" formunu gösterir; kod doğrulanınca hedefUrl'e yönlendirir.
 * Aynı DOM iskeleti (#auth-message'ın hemen üstüne eklenen bir kutu)
 * hem giris.html hem de Google OAuth dönüşü için kullanılır.
 */
async function mfaKoduIste(msg, hedefUrl) {
  const { data: factorList, error: factorErr } = await supabase.auth.mfa.listFactors();
  const factor = !factorErr && (factorList?.totp || []).find((f) => f.status === "verified");

  if (!factor) {
    // Beklenmedik durum: nextLevel aal2 dedi ama doğrulanmış faktör
    // bulunamadı. Güvenli tarafta kalıp yönlendirmiyoruz, kullanıcıyı
    // tekrar denemeye yönlendiriyoruz.
    showMessage(msg, "2FA doğrulaması başlatılamadı. Lütfen tekrar giriş yapmayı dene.");
    return;
  }

  // Formu gizle, giriş kutusunun olduğu auth-box içine 2FA formunu bas.
  const authBox = msg?.closest(".auth-box") || document.querySelector(".auth-box");
  const girisForm = document.getElementById("giris-form");
  const googleBtn = document.getElementById("google-giris-btn");
  const divider = document.querySelector(".auth-divider");
  girisForm?.setAttribute("hidden", "");
  googleBtn?.setAttribute("hidden", "");
  divider?.setAttribute("hidden", "");
  document.querySelectorAll(".auth-links").forEach((el) => el.setAttribute("hidden", ""));

  let mfaKutu = document.getElementById("mfa-giris-kutu");
  if (!mfaKutu) {
    mfaKutu = document.createElement("div");
    mfaKutu.id = "mfa-giris-kutu";
    mfaKutu.innerHTML = `
      <p class="muted" id="mfa-giris-aciklama" style="margin-bottom:12px;">
        Hesabında iki adımlı doğrulama (2FA) açık. Authenticator
        uygulamandaki 6 haneli kodu gir.
      </p>
      <div class="form-field">
        <label for="mfa-giris-kod" id="mfa-giris-label">Doğrulama kodu</label>
        <input id="mfa-giris-kod" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
      </div>
      <button type="button" id="mfa-giris-dogrula-btn" class="btn-primary">Doğrula ve Giriş Yap</button>
      <p style="margin-top:12px;">
        <a href="#" id="mfa-yedek-kod-toggle" style="font-size:0.9rem;">Authenticator'a erişemiyorum, yedek kod kullanacağım</a>
      </p>
    `;
    authBox?.appendChild(mfaKutu);
  }
  mfaKutu.removeAttribute("hidden");

  const kodInput = document.getElementById("mfa-giris-kod");
  const kodLabel = document.getElementById("mfa-giris-label");
  const aciklama = document.getElementById("mfa-giris-aciklama");
  const dogrulaBtn = document.getElementById("mfa-giris-dogrula-btn");
  const toggleLink = document.getElementById("mfa-yedek-kod-toggle");
  kodInput?.focus();

  // false: authenticator'daki 6 haneli TOTP kodu. true: tek seferlik yedek
  // (kurtarma) kodu — bkz. panel.js "Yedek Kodlar" bölümü / migration
  // 0017_2fa_yedek_kodlar.sql. İki mod aynı input'u ve aynı "Doğrula ve
  // Giriş Yap" butonunu paylaşır, sadece doğrulama yolu değişir.
  let yedekKodModu = false;

  const modaGoreGuncelle = () => {
    if (yedekKodModu) {
      aciklama.textContent =
        "Authenticator'a erişemiyorsan, 2FA'yı etkinleştirirken kaydettiğin yedek kodlardan birini gir. Bu, hesabındaki 2FA'yı kaldırır — girişten sonra panelden tekrar kurabilirsin.";
      kodLabel.textContent = "Yedek kod";
      kodInput.setAttribute("maxlength", "11");
      kodInput.setAttribute("placeholder", "XXXXX-XXXXX");
      kodInput.setAttribute("inputmode", "text");
      kodInput.removeAttribute("autocomplete");
      toggleLink.textContent = "Bunun yerine authenticator kodu kullanacağım";
    } else {
      aciklama.textContent =
        "Hesabında iki adımlı doğrulama (2FA) açık. Authenticator uygulamandaki 6 haneli kodu gir.";
      kodLabel.textContent = "Doğrulama kodu";
      kodInput.setAttribute("maxlength", "6");
      kodInput.setAttribute("placeholder", "123456");
      kodInput.setAttribute("inputmode", "numeric");
      kodInput.setAttribute("autocomplete", "one-time-code");
      toggleLink.textContent = "Authenticator'a erişemiyorum, yedek kod kullanacağım";
    }
    kodInput.value = "";
    kodInput.focus();
  };

  toggleLink.addEventListener("click", (e) => {
    e.preventDefault();
    yedekKodModu = !yedekKodModu;
    modaGoreGuncelle();
  });

  const totpIleDogrula = async (kod) => {
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (challengeErr) {
      showMessage(msg, "Doğrulama başlatılamadı: " + challengeErr.message);
      return false;
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challengeData.id,
      code: kod,
    });

    if (verifyErr) {
      showMessage(msg, "Kod hatalı veya süresi doldu.");
      return false;
    }
    return true;
  };

  const yedekKodIleDogrula = async (kod) => {
    const { error: rpcErr } = await supabase.rpc("yedek_kod_ile_2fa_kaldir", { p_kod: kod });
    if (rpcErr) {
      showMessage(msg, rpcErr.message || "Kod geçersiz ya da daha önce kullanılmış.");
      return false;
    }
    return true;
  };

  const dogrula = async () => {
    const kod = kodInput.value.trim();

    if (yedekKodModu) {
      if (!kod) {
        showMessage(msg, "Yedek kodu gir.");
        return;
      }
    } else if (!/^\d{6}$/.test(kod)) {
      showMessage(msg, "6 haneli kodu eksiksiz gir.");
      return;
    }

    dogrulaBtn.disabled = true;
    const basarili = yedekKodModu ? await yedekKodIleDogrula(kod) : await totpIleDogrula(kod);
    dogrulaBtn.disabled = false;

    if (!basarili) {
      kodInput.value = "";
      kodInput.focus();
      return;
    }

    if (yedekKodModu) {
      // Kullanıcı "2FA kaldırıldı" mesajını görebilsin diye yönlendirmeden
      // önce kısa bir gecikme — TOTP yolunda anlık yönlendirme yeterliydi
      // ama bu, kullanıcının bilmesi gereken önemli bir güvenlik bilgisi.
      showMessage(
        msg,
        "Giriş yapıldı, 2FA kaldırıldı. Güvenliğin için panelden tekrar kurmanı öneririz.",
        "success"
      );
      setTimeout(() => {
        window.location.href = hedefUrl;
      }, 1800);
      return;
    }

    window.location.href = hedefUrl;
  };

  dogrulaBtn.addEventListener("click", dogrula);
  kodInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dogrula();
    }
  });
}

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
    // ÜYELİK KAYITLARI KAPALIYKEN "Google ile Giriş Yap"a hiç kayıtlı
    // olmayan bir Google hesabıyla tıklanmışsa: Supabase bu e-postayı yeni
    // bir kullanıcı olarak auth.users'a yazmaya çalışır, migration
    // 0031'deki handle_new_user() trigger'ı bunu reddeder ve OAuth dönüşü
    // buraya bir hata hash'iyle döner. Bu durumu genel "linkin süresi
    // dolmuş" mesajından ayırmak için (GoTrue'nun hata metnini AYNEN
    // yansıtacağı garanti olmadığından) durumu bağımsızca, güncel
    // site_settings'ten tekrar sorup ayırt ediyoruz — sadece bu Google
    // giriş akışı sırasındaysak (GOOGLE_GIRIS_INTENT_KEY) anlamlı.
    const googleGirisimiSirasindaydi = sessionStorage.getItem(GOOGLE_GIRIS_INTENT_KEY) === "1";
    sessionStorage.removeItem(GOOGLE_GIRIS_INTENT_KEY);
    sessionStorage.removeItem(GOOGLE_GIRIS_DONUS_KEY);

    if (googleGirisimiSirasindaydi) {
      kayitlarAcikMi().then((acik) => {
        if (!acik) {
          showMessage(
            msg,
            'Bu Google hesabıyla kayıtlı bir kullanıcı bulunamadı ve üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamıyor.'
          );
        } else {
          showMessage(msg, "Linkin süresi dolmuş veya geçersiz. Panelden yeni bir onay linki iste.");
        }
      });
    } else {
      showMessage(msg, "Linkin süresi dolmuş veya geçersiz. Panelden yeni bir onay linki iste.");
    }
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

    // signInWithPassword'dan ÖNCE kaydedilmeli — bkz. supabase-client.js
    // içindeki oturumHatirlamaTercihiniKaydet() açıklaması.
    oturumHatirlamaTercihiniKaydet(document.getElementById("remember-me")?.checked ?? true);

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

    // GÜVENLİK DÜZELTMESİ: şifre doğru olsa bile, hesapta doğrulanmış bir
    // 2FA (TOTP) faktörü varsa oturum henüz sadece AAL1'dedir — panele
    // yönlendirmeden ÖNCE authenticator kodu istenir (bkz.
    // mfaGerekirseDogrulaVeYonlendir başındaki ayrıntılı açıklama).
    const params = new URLSearchParams(window.location.search);
    const hedef = params.get("donus") || REDIRECT_AFTER_LOGIN;
    await mfaGerekirseDogrulaVeYonlendir(msg, hedef);
  });

  googleBtn?.addEventListener("click", async () => {
    const params = new URLSearchParams(window.location.search);
    const donus = params.get("donus") || REDIRECT_AFTER_LOGIN;
    // Hedefi (donus) hemen kullanmıyoruz — redirectTo'yu bilerek bu sayfaya
    // sabitliyoruz ki OAuth dönüşünde "kayıtlı mı" kontrolünü yapabilelim;
    // hedefi sessionStorage'da saklayıp kontrolden SONRA oraya gideceğiz.
    sessionStorage.setItem(GOOGLE_GIRIS_INTENT_KEY, "1");
    sessionStorage.setItem(GOOGLE_GIRIS_DONUS_KEY, donus);
    // Google ile girişte de aynı checkbox'a bakıyoruz — OAuth dönüşünde
    // (googleGirisDonusunuIsle) oturum bu sayfada kurulur, o an dinamik
    // depo zaten burada kaydettiğimiz tercihi kullanır.
    oturumHatirlamaTercihiniKaydet(document.getElementById("remember-me")?.checked ?? true);
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
      // GÜVENLİK DÜZELTMESİ: Google ile giriş de aynı şekilde AAL2
      // kontrolünden geçmeli — hesapta 2FA açıksa Google kimliği tek
      // başına yeterli değildir, authenticator kodu da istenir (bkz.
      // mfaGerekirseDogrulaVeYonlendir başındaki açıklama).
      await mfaGerekirseDogrulaVeYonlendir(msg, donus);
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
export async function initKayitPage() {
  const msg = document.getElementById("auth-message");
  const aktifAlan = document.getElementById("kayit-aktif-alan");
  const kapaliUyari = document.getElementById("kayit-kapali-uyari");

  // ÜYELİK KAYITLARI KAPALI MI? (bkz. migration 0031 + supabase-client.js
  // -> kayitlarAcikMi). Bu SADECE kullanıcı deneyimi katmanı — formu hiç
  // göstermeyip erkenden çıkıyoruz ki kimse boşuna doldurmasın; asıl
  // bağlayıcı kısıt veritabanındaki handle_new_user() trigger'ıdır (aşağıda
  // form submit / Google buton dinleyicileri hiç bağlanmadığı için, formu
  // DOM'dan gizlemek yetmiyormuş gibi bir durumda bile submit çalışmaz).
  if (!(await kayitlarAcikMi())) {
    aktifAlan?.setAttribute("hidden", "");
    if (kapaliUyari) kapaliUyari.hidden = false;
    // Google ile kayıt denemesi TAM BU SIRADA (kayıtlar kapanmadan hemen
    // önce başlatılmış ve şimdi) reddedilmiş olabilir — bekleyen bayrağı
    // temizliyoruz ki kayıtlar tekrar açıldığında bir sonraki ziyarette
    // bu sayfa yanlışlıkla "Google dönüşü" sanıp işlemeye çalışmasın.
    sessionStorage.removeItem(GOOGLE_KAYIT_INTENT_KEY);
    return;
  }

  const form = document.getElementById("kayit-form");
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
      } else if (error.message.includes(KAYITLAR_KAPALI_ISARETI)) {
        // Sayfa açılırken kayıtlar açıktı ama tam bu sırada (nadir bir
        // yarış durumu) owner kapattı — asıl bağlayıcı kontrol veritabanı
        // trigger'ında (bkz. migration 0031), burada sadece kullanıcı
        // dostu bir mesaja çeviriyoruz.
        showMessage(msg, "Üyelik kayıtları az önce kapatıldı, kayıt tamamlanamadı.");
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
