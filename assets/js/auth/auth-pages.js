/*
 * assets/js/auth/auth-pages.js — Giriş / Kayıt / Şifremi Unuttum / Hesabı Onayla / Şifre Güncelle sayfalarının mantığı.
 * ---------------------------------------------------------------------------------------------------------------
 * Dışa aktarılanlar (hesap/*.md sayfaları bunları import eder):
 *   initGirisPage · initKayitPage · initSifremiUnuttumPage · initHesapOnaylaPage · initSifreGuncellePage
 *
 * ÖNEMLİ — BU DOSYANIN KÖKENİ: repodaki orijinal auth-pages.js kayıptı (canlı sitede 404 → tüm form/Google düğmeleri ölüydü).
 * Bu sürüm; supabase/migrations (handle_new_user meta verisi, kvkk_onayini_ver, yedek_kod_ile_2fa_kaldir, KAYITLAR_KAPALI),
 * core/supabase-client.js, core/kesinti.js (çevrimdışı giriş kasası), auth/auth-guard.js (AAL2 zorunluluğu, KVKK rıza modalı)
 * ve rehber/02-supabase-sistemi.md'deki davranış tariflerine göre YENİDEN yazıldı. Sayfaların id'leri/DOM sözleşmesi aynıdır.
 *
 * BOT KORUMASI: Bu dosyada captcha kodu YOKTUR. signInWithPassword / signUp / resetPasswordForEmail çağrılarına
 * `captchaToken`'ı auth/turnstile.js (captchaKur) kendiliğinden ekler.
 *
 * HUKUKİ AYRIM (KVKK): Aydınlatma beyanı (kvkk_onay) ile yurt dışı aktarım AÇIK RIZASI (yurtdisi_onay) AYRI sinyallerdir.
 * Rıza kutusu varsayılan işaretsizdir, hem e-posta kaydında hem "Google ile Kayıt Ol"da OAuth başlamadan önce ayrıca denetlenir.
 * Sürüm etiketlerini istemci değil DB belirler (guncel_kvkk_surumu); buradan gönderilen değerler yalnızca yedektir.
 */
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  showMessage,
  showSpamNotice,
  hideSpamNotice,
  turkceOtpHatasi,
  sifreKuraliHatasi,
  turkceSifreHatasi,
  eskiSifreUyarisiniIsaretle,
  oturumHatirlamaTercihiniKaydet,
  guncelOnaySurumleri,
  kayitlarAcikMi,
  KAYITLAR_KAPALI_ISARETI,
} from "../core/supabase-client.js";
import { kasaVarMi, cevrimdisiGiris, girisSonrasi, kesintiOturumu, durum as kesintiDurumu } from "../core/kesinti.js";
import { demoModuAktifMi } from "../demo/demo-durum.js";

/* ------------------------------------------------------------------------------------------------ */
/* Ortak yardımcılar                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

// supabase-js, OAuth/e-posta linki dönüşünde URL'deki token'ı hemen temizler: hata/tür bilgisini ŞİMDİ yakala.
const ILK_HASH = typeof location !== "undefined" ? location.hash || "" : "";
const ILK_SORGU = typeof location !== "undefined" ? location.search || "" : "";

const VARSAYILAN_HEDEF = "/panel/dashboard.html";
const GOOGLE_BAYRAGI = "aea_google_donus"; // "giris" | "kayit" — OAuth'a gitmeden önce yazılır, dönüşte okunup silinir
const KAYIT_RIZA_BAYRAGI = "aea_kayit_riza"; // kayıt sayfasında OAuth'tan ÖNCE verilen açık rıza (dönüşte DB'ye yazılır)
const SON_EPOSTA = "aea_son_eposta";
const YENI_HESAP_PENCERESI_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);

function urlParam(ad) {
  try {
    return new URLSearchParams(ILK_SORGU).get(ad);
  } catch {
    return null;
  }
}
function hashParam(ad) {
  try {
    return new URLSearchParams(ILK_HASH.replace(/^#/, "")).get(ad);
  } catch {
    return null;
  }
}
function oturumDepoOku(k) {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function oturumDepoYaz(k, v) {
  try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* depo kapalı */ }
}

/** Açık-yönlendirme (open redirect) koruması: yalnızca bu sitenin kendi yolları. */
function guvenliHedef(ham) {
  if (!ham || typeof ham !== "string") return null;
  if (!ham.startsWith("/") || ham.startsWith("//") || ham.includes("\\")) return null;
  try {
    const u = new URL(ham, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}
const DONUS_ANAHTARI = "aea_donus";
function donusAdresiniHatirla() {
  const d = guvenliHedef(urlParam("donus"));
  if (d) oturumDepoYaz(DONUS_ANAHTARI, d);
}
function donusAdresi() {
  return guvenliHedef(urlParam("donus")) || guvenliHedef(oturumDepoOku(DONUS_ANAHTARI)) || VARSAYILAN_HEDEF;
}
function yonlendir(adres) {
  oturumDepoYaz(DONUS_ANAHTARI, null);
  location.replace(adres);
}
function sayfaYolu(ad) {
  return `${location.origin}/hesap/${ad}.html`;
}

function agHatasiMi(h) {
  if (!h) return false;
  return (
    h.name === "AuthRetryableFetchError" ||
    h.status === 0 ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(String(h.message || ""))
  );
}

function bekletBtn(form, mesgul, metin) {
  const b = form?.querySelector('button[type="submit"]');
  if (!b) return;
  if (mesgul) {
    b.dataset.eskiMetin = b.textContent;
    b.disabled = true;
    b.textContent = metin || "Lütfen bekle…";
  } else {
    b.disabled = false;
    if (b.dataset.eskiMetin) b.textContent = b.dataset.eskiMetin;
  }
}

function epostaGecerliMi(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function epostaOnDoldur(girdi) {
  if (!girdi) return;
  let e = urlParam("email");
  if (!e) {
    try { e = localStorage.getItem(SON_EPOSTA); } catch { /* yok say */ }
  }
  if (e && epostaGecerliMi(e) && !girdi.value) girdi.value = e;
}
function sonEpostayiHatirla(e) {
  try { localStorage.setItem(SON_EPOSTA, e); } catch { /* yok say */ }
}

/** Mesajın yanına tıklanabilir bağlantı ekler (innerHTML kullanmadan). */
function mesajaBaglantiEkle(kutu, metin, href) {
  if (!kutu) return;
  const a = document.createElement("a");
  a.href = href;
  a.textContent = metin;
  kutu.append(" ", a);
}

/** Supabase Auth hatasını anlaşılır Türkçeye çevirir (ham İngilizce göstermez). */
function girisHatasiMetni(h) {
  const kod = h?.code || "";
  const m = String(h?.message || "");
  if (/güvenlik doğrulaması/i.test(m)) return m; // turnstile.js zaten Türkçe yazdı
  if (kod === "email_not_confirmed" || /email not confirmed/i.test(m)) {
    return "E-posta adresini henüz doğrulamadın. Mailine gönderilen linke tıkla ya da kodla onayla.";
  }
  if (kod === "invalid_credentials" || /invalid login credentials/i.test(m)) return "E-posta veya şifre hatalı.";
  if (kod === "user_banned" || /banned/i.test(m)) return "Bu hesap askıya alınmış. Yöneticiyle iletişime geç.";
  if (kod === "over_request_rate_limit" || kod === "over_email_send_rate_limit" || /rate limit|too many/i.test(m)) {
    return "Çok sık denedin. Biraz bekleyip tekrar dene.";
  }
  if (agHatasiMi(h)) return "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.";
  return m || "Giriş yapılamadı. Lütfen tekrar dene.";
}

function kayitHatasiMetni(h) {
  const kod = h?.code || "";
  const m = String(h?.message || "");
  if (m.includes(KAYITLAR_KAPALI_ISARETI)) return "Üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamıyor.";
  if (/güvenlik doğrulaması/i.test(m)) return m;
  if (kod === "user_already_exists" || /already registered|already been registered/i.test(m)) {
    return "Bu e-posta ile zaten bir hesap var. Giriş yap ya da şifreni sıfırla.";
  }
  if (kod === "weak_password" || /weak|should contain|at least/i.test(m)) return turkceSifreHatasi(h);
  if (kod === "over_email_send_rate_limit" || kod === "over_request_rate_limit" || /rate limit/i.test(m)) {
    return "Çok sık denedin ya da e-posta gönderim sınırına ulaşıldı. Biraz bekleyip tekrar dene.";
  }
  if (kod === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(m)) return "Geçerli bir e-posta adresi gir.";
  if (agHatasiMi(h)) return "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.";
  return m || "Kayıt yapılamadı. Lütfen tekrar dene.";
}

/** Dönüş adresindeki (hash/sorgu) Supabase hata bilgisini Türkçe gösterir. true → hata gösterildi. */
function donusHatasiniGoster(kutu) {
  const hata = hashParam("error_description") || urlParam("error_description") || hashParam("error") || urlParam("error");
  if (!hata) return false;
  const kod = hashParam("error_code") || urlParam("error_code") || "";
  let metin;
  if (hata.includes(KAYITLAR_KAPALI_ISARETI)) metin = "Üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamıyor.";
  else if (kod === "otp_expired" || /expired|invalid/i.test(hata)) metin = "Bu bağlantının süresi dolmuş ya da daha önce kullanılmış. Yeni bir bağlantı/kod iste.";
  else if (/access_denied/i.test(hata)) metin = "İşlem iptal edildi.";
  else metin = "İşlem tamamlanamadı: " + hata.replaceAll("+", " ");
  showMessage(kutu, metin, "error");
  return true;
}

/** Gerçek (demo/kesinti sahte oturumu olmayan) oturum var mı? */
async function gercekOturum() {
  try {
    if (demoModuAktifMi() || kesintiOturumu()) return null;
    const { data } = await supabase.auth.getSession();
    const s = data?.session;
    return s && !s.aeaEskiBelirtec ? s : null;
  } catch {
    return null;
  }
}

async function mfaGerekiyorMu() {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return !error && data?.nextLevel === "aal2" && data?.currentLevel !== "aal2";
  } catch {
    return false;
  }
}

/** Yeni oluşmuş hesap mı? (Google ile kayıtsız hesap oluşumunu ayırt etmek için) */
function yeniHesapMi(kullanici) {
  const t = Date.parse(kullanici?.created_at || "");
  return Number.isFinite(t) && Date.now() - t < YENI_HESAP_PENCERESI_MS;
}

/** Rıza verilmeden (Google ile) oluşmuş boş hesabı siler. delete-account fonksiyonu yalnızca kvkk_onay_verildi=false hesabı kalıcı siler. */
async function yetimHesabiSil(oturum) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${oturum.access_token}`,
      },
      body: "{}",
    });
  } catch (h) {
    console.warn("Yetim hesap silinemedi (kritik değil):", h);
  }
}

/** Google OAuth'u başlatır. Dönüş adresi, Supabase Redirect URLs listesindeki ADRESLERLE birebir aynıdır (sorgu eklenmez). */
async function googleBaslat(hedefSayfa, kutu) {
  oturumDepoYaz(GOOGLE_BAYRAGI, hedefSayfa);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: sayfaYolu(hedefSayfa), queryParams: { prompt: "select_account" } },
  });
  if (error) {
    oturumDepoYaz(GOOGLE_BAYRAGI, null);
    showMessage(kutu, "Google ile bağlantı başlatılamadı: " + (error.message || "bilinmeyen hata"), "error");
    return false;
  }
  return true; // tarayıcı Google'a yönleniyor
}

/* ------------------------------------------------------------------------------------------------ */
/* 2FA (TOTP) adımı — hesap/giris.md içindeki #mfa-adimi                                              */
/* ------------------------------------------------------------------------------------------------ */

/**
 * 2FA doğrulamasını ister. Doğrulanınca (ya da yedek kodla 2FA kaldırılınca) true döner.
 * Vazgeçilirse oturum kapatılır ve sayfa yenilenir (promise hiç çözülmez).
 */
function mfaKoduIste() {
  return new Promise((coz) => {
    const adim = $("mfa-adimi");
    const ana = $("giris-adimi");
    const msg = $("auth-message");
    if (!adim) {
      showMessage(msg, "İki adımlı doğrulama gerekiyor ancak doğrulama formu bulunamadı. Sayfayı yenileyip tekrar dene.", "error");
      return;
    }
    if (ana) ana.hidden = true;
    adim.hidden = false;
    msg && (msg.hidden = true);
    const mfaForm = $("mfa-form");
    const yedekForm = $("yedek-kod-form");
    const kod = $("mfa-kod");
    kod?.focus();

    mfaForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const deger = (kod.value || "").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(deger)) return showMessage(msg, "6 haneli doğrulama kodunu gir.", "error");
      bekletBtn(mfaForm, true, "Doğrulanıyor…");
      try {
        const { data: f, error: fe } = await supabase.auth.mfa.listFactors();
        const faktor = (f?.totp || []).find((x) => x.status === "verified");
        if (fe || !faktor) throw fe || new Error("Doğrulanmış 2FA faktörü bulunamadı.");
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: faktor.id, code: deger });
        if (error) throw error;
        coz(true);
      } catch (h) {
        const m = String(h?.message || "");
        showMessage(msg, /invalid|incorrect|expired/i.test(m) ? "Kod hatalı ya da süresi dolmuş. Tekrar dene." : "Doğrulama başarısız: " + m, "error");
        bekletBtn(mfaForm, false);
        kod.select();
      }
    });

    $("mfa-yedek-ac")?.addEventListener("click", () => {
      yedekForm.hidden = !yedekForm.hidden;
      if (!yedekForm.hidden) $("yedek-kod")?.focus();
    });

    yedekForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const yk = ($("yedek-kod").value || "").trim();
      if (!yk) return showMessage(msg, "Yedek kodunu gir.", "error");
      bekletBtn(yedekForm, true, "Kontrol ediliyor…");
      const { data, error } = await supabase.rpc("yedek_kod_ile_2fa_kaldir", { p_kod: yk });
      if (error || data !== true) {
        showMessage(msg, error?.message || "Yedek kod geçersiz ya da daha önce kullanılmış.", "error");
        bekletBtn(yedekForm, false);
        return;
      }
      // Faktör silindi: oturumu AAL1 ile yenile ve devam et. Kullanıcıya 2FA'yı yeniden kurması önerilir.
      try { await supabase.auth.refreshSession(); } catch { /* yok say */ }
      oturumDepoYaz("aea_2fa_kaldirildi", "1");
      coz(true);
    });

    $("mfa-iptal")?.addEventListener("click", async () => {
      try { await supabase.auth.signOut(); } catch { /* yok say */ }
      location.reload();
    });
  });
}

/** Oturum kurulduktan sonra ortak son adım: 2FA → kasa → yönlendirme. */
async function girisiTamamla({ eposta, parola, uid, kasaIste }) {
  if (await mfaGerekiyorMu()) await mfaKoduIste();
  if (eposta && parola) {
    try {
      await girisSonrasi({ eposta, parola, uid, kasaIste: !!kasaIste });
    } catch (h) {
      console.warn("Çevrimdışı giriş kasası güncellenemedi (giriş etkilenmedi):", h);
    }
  }
  yonlendir(donusAdresi());
}

/* ------------------------------------------------------------------------------------------------ */
/* GİRİŞ                                                                                               */
/* ------------------------------------------------------------------------------------------------ */

async function googleGirisDonusunuIsle(oturum, msg) {
  // Giriş sayfasından Google ile gelen biri KAYITLI DEĞİLSE Supabase hesabı kendiliğinden oluşturur.
  // Rıza verilmeden oluşan bu boş hesap silinir; kullanıcı Kayıt Ol'a yönlendirilir.
  if (yeniHesapMi(oturum.user)) {
    const { data: prof } = await supabase.from("profiles").select("kvkk_onay_verildi").eq("id", oturum.user.id).maybeSingle();
    if (prof && prof.kvkk_onay_verildi === false) {
      await yetimHesabiSil(oturum);
      try { await supabase.auth.signOut(); } catch { /* yok say */ }
      showMessage(msg, "Bu Google hesabıyla kayıtlı bir üyelik bulunamadı. Önce Kayıt Ol sayfasından üye ol (KVKK onayı gerekir).", "error");
      mesajaBaglantiEkle(msg, "Kayıt Ol", "/hesap/kayit.html");
      return false;
    }
  }
  await girisiTamamla({ uid: oturum.user.id });
  return true;
}

export async function initGirisPage() {
  const form = $("giris-form");
  if (!form) return;
  const msg = $("auth-message");
  donusAdresiniHatirla();
  epostaOnDoldur(form.elements.email);

  // 1) Başka bir akıştan dönüş (e-posta linki / Google / hata)
  const googleDonus = oturumDepoOku(GOOGLE_BAYRAGI) === "giris";
  if (googleDonus) oturumDepoYaz(GOOGLE_BAYRAGI, null);
  const hataGosterildi = donusHatasiniGoster(msg);
  if (hashParam("type") === "email_change" || urlParam("message")) {
    showMessage(msg, "E-posta değişikliği için bu adres onaylandı. İki adresin de onaylanması gerekiyorsa diğerini de onayla, sonra giriş yap.", "success");
  }

  const oturum = hataGosterildi ? null : await gercekOturum();
  if (oturum) {
    // DÖNGÜ KORUMASI: panel (auth-guard) oturumu kabul etmeyip bizi geri atarsa (ör. profil okunamadı) sonsuz yönlendirme olmasın.
    const sonYonlendirme = Number(oturumDepoOku("aea_otomatik_yon") || 0);
    if (!googleDonus && Date.now() - sonYonlendirme < 8000) {
      showMessage(msg, "Oturumun açık ancak panele erişilemedi. Çıkış yapıp yeniden giriş yapmayı dene.", "error");
      const cikis = document.createElement("button");
      cikis.type = "button";
      cikis.className = "btn-secondary";
      cikis.textContent = "Çıkış yap";
      cikis.addEventListener("click", async () => {
        try { await supabase.auth.signOut(); } catch { /* yok say */ }
        oturumDepoYaz("aea_otomatik_yon", null);
        location.reload();
      });
      msg.after(cikis);
      return;
    }
    oturumDepoYaz("aea_otomatik_yon", String(Date.now()));
    try {
      if (googleDonus) await googleGirisDonusunuIsle(oturum, msg);
      else await girisiTamamla({ uid: oturum.user.id });
    } catch (h) {
      console.warn("Oturumlu giriş sayfası akışı:", h);
    }
    return;
  }

  // 2) E-posta + şifre
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eposta = (form.elements.email.value || "").trim();
    const parola = form.elements.password.value || "";
    if (!eposta || !parola) return showMessage(msg, "E-posta ve şifreni gir.", "error");
    if (!epostaGecerliMi(eposta)) return showMessage(msg, "Geçerli bir e-posta adresi gir.", "error");

    const hatirla = $("remember-me") ? $("remember-me").checked : true;
    const kasaIste = $("offline-kasa") ? $("offline-kasa").checked : false;
    msg.hidden = true;
    bekletBtn(form, true, "Giriş yapılıyor…");
    oturumHatirlamaTercihiniKaydet(hatirla); // signIn'den HEMEN ÖNCE (bkz. supabase-client.js)
    sonEpostayiHatirla(eposta);

    let sonuc;
    try {
      sonuc = await supabase.auth.signInWithPassword({ email: eposta, password: parola });
    } catch (h) {
      sonuc = { data: null, error: h };
    }
    const { data, error } = sonuc;

    if (error) {
      // Sunucu kesintisi: bu cihazdaki şifreli kasa varsa çevrimdışı (kısıtlı) giriş dene
      const kesintiVar = agHatasiMi(error) || ["kesinti", "cevrimdisi", "giris"].includes(kesintiDurumu?.durum);
      if (kesintiVar) {
        const sonucCd = (await kasaVarMi(eposta)) ? await cevrimdisiGiris(eposta, parola) : { ok: false, neden: "kasa-yok" };
        if (sonucCd.ok) {
          showMessage(msg, "Sunucuya ulaşılamıyor: bu cihazdan kısıtlı (çevrimdışı) modda giriş yapıldı.", "success");
          setTimeout(() => yonlendir(donusAdresi()), 900);
          return;
        }
        const neden = {
          kilit: `Çok fazla hatalı deneme. ${sonucCd.saniye || 30} sn sonra tekrar dene.`,
          parola: "Parola hatalı (çevrimdışı doğrulama).",
          "suresi-doldu": "Bu cihazdaki çevrimdışı giriş kasasının süresi dolmuş. Sunucu açılınca normal giriş yap.",
          "kasa-yok": "Sunucuya ulaşılamıyor ve bu cihazda çevrimdışı giriş kasası yok. Biraz sonra tekrar dene.",
        }[sonucCd.neden];
        showMessage(msg, neden || girisHatasiMetni(error), "error");
      } else {
        showMessage(msg, girisHatasiMetni(error), "error");
        if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message || "")) {
          mesajaBaglantiEkle(msg, "Kodla onayla", `/hesap/hesap-onayla.html?email=${encodeURIComponent(eposta)}`);
        }
      }
      bekletBtn(form, false);
      return;
    }

    eskiSifreUyarisiniIsaretle(parola);
    try {
      await girisiTamamla({ eposta, parola, uid: data.user.id, kasaIste });
    } catch (h) {
      showMessage(msg, "Giriş yapıldı ancak yönlendirme başarısız: " + (h?.message || h), "error");
      bekletBtn(form, false);
    }
  });

  // 3) Google ile giriş
  $("google-giris-btn")?.addEventListener("click", async () => {
    msg.hidden = true;
    oturumHatirlamaTercihiniKaydet($("remember-me") ? $("remember-me").checked : true);
    await googleBaslat("giris", msg);
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* KAYIT                                                                                               */
/* ------------------------------------------------------------------------------------------------ */

async function googleKayitDonusunuIsle(oturum, msg) {
  const rizaVerildi = oturumDepoOku(KAYIT_RIZA_BAYRAGI) === "1";
  oturumDepoYaz(KAYIT_RIZA_BAYRAGI, null);

  if (!yeniHesapMi(oturum.user)) {
    // Zaten üyeymiş: Supabase aynı e-postayı mevcut hesaba bağlar; yeni hesap AÇILMAZ.
    showMessage(msg, "Bu Google hesabıyla zaten bir üyeliğin var; giriş yapıldı.", "success");
    await new Promise((r) => setTimeout(r, 900));
    await girisiTamamla({ uid: oturum.user.id });
    return;
  }
  if (!rizaVerildi) {
    // Rıza kutusu işaretlenmeden OAuth'a gidilmişse (ör. başka sekmeden): boş hesabı sil, çıkış yap.
    await yetimHesabiSil(oturum);
    try { await supabase.auth.signOut(); } catch { /* yok say */ }
    showMessage(msg, "Kayıt tamamlanamadı: KVKK onayları verilmeden hesap oluşturulamaz. Lütfen onay kutusunu işaretleyip tekrar dene.", "error");
    return;
  }
  const surum = await guncelOnaySurumleri();
  const { error } = await supabase.rpc("kvkk_onayini_ver", {
    p_versiyon: surum.kvkk || "v1.0",
    p_yurtdisi_onay: true,
    p_yurtdisi_versiyon: surum.riza || surum.kvkk || "v1.0",
  });
  if (error) {
    // Onay damgası yazılamadıysa kullanıcıyı kilitlemeyiz: panelde rıza modalı zaten isteyecek.
    console.warn("KVKK onayı yazılamadı (panel modalı isteyecek):", error);
  }
  showMessage(msg, "Kayıt tamamlandı, hoş geldin!", "success");
  await new Promise((r) => setTimeout(r, 700));
  await girisiTamamla({ uid: oturum.user.id });
}

export async function initKayitPage() {
  const form = $("kayit-form");
  if (!form) return;
  const msg = $("auth-message");
  const spam = $("auth-spam-notice");
  const kapaliKutu = $("kayit-kapali-uyari");
  const aktifAlan = $("kayit-aktif-alan");
  const rizaKutusu = $("kvkk-yurtdisi-onay");
  epostaOnDoldur(form.elements.email);

  const googleDonus = oturumDepoOku(GOOGLE_BAYRAGI) === "kayit";
  if (googleDonus) oturumDepoYaz(GOOGLE_BAYRAGI, null);

  // Üyelik kayıtları kapalı mı? (deneyim katmanı; bağlayıcı kural DB trigger'ındadır)
  const acik = await kayitlarAcikMi();
  if (!acik) {
    if (kapaliKutu) kapaliKutu.hidden = false;
    if (aktifAlan) aktifAlan.hidden = true;
    donusHatasiniGoster(msg);
    return;
  }

  if (donusHatasiniGoster(msg)) {
    oturumDepoYaz(KAYIT_RIZA_BAYRAGI, null);
  } else if (googleDonus) {
    const oturum = await gercekOturum();
    if (oturum) {
      try {
        await googleKayitDonusunuIsle(oturum, msg);
      } catch (h) {
        showMessage(msg, "Kayıt sonrası işlem tamamlanamadı: " + (h?.message || h), "error");
      }
      return;
    }
  }

  // E-posta + şifre ile kayıt
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideSpamNotice(spam);
    const ad = (form.elements.first_name.value || "").trim();
    const soyad = (form.elements.last_name.value || "").trim();
    const eposta = (form.elements.email.value || "").trim();
    const parola = form.elements.password.value || "";
    const tekrar = form.elements.password_again.value || "";

    if (!ad || !soyad) return showMessage(msg, "Ad ve soyadını gir.", "error");
    if (!epostaGecerliMi(eposta)) return showMessage(msg, "Geçerli bir e-posta adresi gir.", "error");
    const kuralHatasi = sifreKuraliHatasi(parola);
    if (kuralHatasi) return showMessage(msg, kuralHatasi, "error");
    if (parola !== tekrar) return showMessage(msg, "Şifreler birbiriyle eşleşmiyor.", "error");
    if (!rizaKutusu?.checked) {
      return showMessage(msg, "Kayıt olmak için yurt dışı aktarım açık rızasını onaylaman gerekiyor.", "error");
    }

    msg.hidden = true;
    bekletBtn(form, true, "Kayıt yapılıyor…");
    sonEpostayiHatirla(eposta);
    const surum = await guncelOnaySurumleri();

    let sonuc;
    try {
      sonuc = await supabase.auth.signUp({
        email: eposta,
        password: parola,
        options: {
          emailRedirectTo: sayfaYolu("giris"),
          data: {
            first_name: ad,
            last_name: soyad,
            kvkk_onay: true,
            kvkk_versiyon: surum.kvkk || "v1.0",
            yurtdisi_onay: true,
            yurtdisi_versiyon: surum.riza || surum.kvkk || "v1.0",
          },
        },
      });
    } catch (h) {
      sonuc = { data: null, error: h };
    }
    const { data, error } = sonuc;
    bekletBtn(form, false);

    if (error) return showMessage(msg, kayitHatasiMetni(error), "error");

    // Supabase, kayıtlı bir e-posta için hata vermez (e-posta numaralandırmayı önlemek için); identities boş döner.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return showMessage(msg, "Bu e-posta ile zaten bir hesap var. Giriş yap ya da şifreni sıfırla.", "error");
    }

    // "E-posta onayı" kapalıysa oturum hemen açılır
    if (data?.session) {
      showMessage(msg, "Kayıt tamamlandı, hoş geldin!", "success");
      setTimeout(() => yonlendir(donusAdresi()), 700);
      return;
    }

    showMessage(msg, "Kayıt alındı! E-postana bir onay linki ve kod gönderdik. Linke tıklayarak hesabını onayla.", "success");
    showSpamNotice(spam);
    form.hidden = true;
    aktifAlan?.querySelectorAll(".auth-divider, #google-kayit-btn").forEach((el) => (el.hidden = true));
    const kodLink = $("kod-ile-onayla-link");
    if (kodLink) kodLink.href = `/hesap/hesap-onayla.html?email=${encodeURIComponent(eposta)}`;
  });

  // Google ile kayıt: OAuth BAŞLAMADAN ÖNCE açık rıza denetlenir
  $("google-kayit-btn")?.addEventListener("click", async () => {
    if (!rizaKutusu?.checked) {
      return showMessage(msg, "Google ile kayıt olmak için önce yurt dışı aktarım açık rızasını onaylaman gerekiyor.", "error");
    }
    msg.hidden = true;
    oturumHatirlamaTercihiniKaydet(true);
    oturumDepoYaz(KAYIT_RIZA_BAYRAGI, "1");
    const basladi = await googleBaslat("kayit", msg);
    if (!basladi) oturumDepoYaz(KAYIT_RIZA_BAYRAGI, null);
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* ŞİFREMİ UNUTTUM                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

export function initSifremiUnuttumPage() {
  const form = $("sifremi-unuttum-form");
  if (!form) return;
  const msg = $("auth-message");
  const spam = $("auth-spam-notice");
  epostaOnDoldur(form.elements.email);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideSpamNotice(spam);
    const eposta = (form.elements.email.value || "").trim();
    if (!epostaGecerliMi(eposta)) return showMessage(msg, "Geçerli bir e-posta adresi gir.", "error");
    msg.hidden = true;
    bekletBtn(form, true, "Gönderiliyor…");
    let sonuc;
    try {
      sonuc = await supabase.auth.resetPasswordForEmail(eposta, { redirectTo: sayfaYolu("sifre-guncelle") });
    } catch (h) {
      sonuc = { error: h };
    }
    bekletBtn(form, false);
    const { error } = sonuc;
    if (error) {
      const m = String(error.message || "");
      if (/güvenlik doğrulaması/i.test(m)) return showMessage(msg, m, "error");
      if (error.code === "over_email_send_rate_limit" || /rate limit/i.test(m)) {
        return showMessage(msg, "Çok sık denedin ya da e-posta gönderim sınırına ulaşıldı. Biraz bekleyip tekrar dene.", "error");
      }
      if (agHatasiMi(error)) return showMessage(msg, "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.", "error");
      return showMessage(msg, m || "İstek gönderilemedi.", "error");
    }
    // Hesap var/yok bilgisini sızdırmamak için her durumda aynı mesaj
    showMessage(msg, "Bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı ve kodu gönderildi.", "success");
    showSpamNotice(spam);
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* HESABI ONAYLA (kodla)                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export function initHesapOnaylaPage() {
  const form = $("hesap-onayla-form");
  if (!form) return;
  const msg = $("auth-message");
  epostaOnDoldur(form.elements.email);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eposta = (form.elements.email.value || "").trim();
    const kod = (form.elements.code.value || "").replace(/\s+/g, "");
    if (!epostaGecerliMi(eposta)) return showMessage(msg, "Geçerli bir e-posta adresi gir.", "error");
    if (!kod) return showMessage(msg, "Mailde gelen kodu gir.", "error");
    msg.hidden = true;
    bekletBtn(form, true, "Doğrulanıyor…");
    const { data, error } = await supabase.auth.verifyOtp({ email: eposta, token: kod, type: "signup" });
    if (error) {
      showMessage(msg, turkceOtpHatasi(error.message), "error");
      bekletBtn(form, false);
      return;
    }
    sonEpostayiHatirla(eposta);
    showMessage(msg, "Hesabın onaylandı!", "success");
    setTimeout(() => yonlendir(data?.session ? donusAdresi() : "/hesap/giris.html"), 900);
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* ŞİFRE GÜNCELLE (sıfırlama linki / kodu sonrası)                                                     */
/* ------------------------------------------------------------------------------------------------ */

export async function initSifreGuncellePage() {
  const form = $("sifre-guncelle-form");
  if (!form) return;
  const msg = $("auth-message");
  const sureDoldu = $("auth-expired");
  const otpToggle = $("auth-otp-toggle");
  const otpForm = $("auth-otp-form");

  const formuGoster = (goster) => {
    form.hidden = !goster;
    if (sureDoldu) sureDoldu.hidden = true;
  };

  // Sıfırlama linkiyle gelindiyse supabase-js token'ı URL'den alıp (PASSWORD_RECOVERY) oturum kurar.
  let hazir = false;
  const dinleyici = supabase.auth.onAuthStateChange((olay, oturum) => {
    if (olay === "PASSWORD_RECOVERY" || (olay === "SIGNED_IN" && oturum)) hazir = true;
  });
  const linkVar = /type=recovery|access_token|code=/.test(ILK_HASH + ILK_SORGU);
  const hataVar = donusHatasiniGoster(msg);
  if (linkVar && !hataVar) {
    for (let i = 0; i < 20 && !hazir; i++) {
      const { data } = await supabase.auth.getSession();
      if (data?.session) hazir = true;
      else await new Promise((r) => setTimeout(r, 150));
    }
  }
  try { dinleyici?.data?.subscription?.unsubscribe(); } catch { /* yok say */ }

  if (!hazir) {
    // Link yok/süresi dolmuş: şifre formu gizlenir; kod ile devam etme yolu açık kalır.
    form.hidden = true;
    if (sureDoldu) sureDoldu.hidden = false;
  }

  otpToggle?.addEventListener("click", () => {
    otpForm.hidden = !otpForm.hidden;
    if (!otpForm.hidden) $("otp_email")?.focus();
  });
  epostaOnDoldur($("otp_email"));

  otpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eposta = ($("otp_email").value || "").trim();
    const kod = ($("otp_code").value || "").replace(/\s+/g, "");
    if (!epostaGecerliMi(eposta) || !kod) return showMessage(msg, "E-postanı ve mailde gelen kodu gir.", "error");
    bekletBtn(otpForm, true, "Doğrulanıyor…");
    const { error } = await supabase.auth.verifyOtp({ email: eposta, token: kod, type: "recovery" });
    bekletBtn(otpForm, false);
    if (error) return showMessage(msg, turkceOtpHatasi(error.message), "error");
    showMessage(msg, "Kod doğrulandı. Şimdi yeni şifreni belirle.", "success");
    otpForm.hidden = true;
    formuGoster(true);
    $("password")?.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const yeni = form.elements.password.value || "";
    const tekrar = form.elements.password_again.value || "";
    const kuralHatasi = sifreKuraliHatasi(yeni);
    if (kuralHatasi) return showMessage(msg, kuralHatasi, "error");
    if (yeni !== tekrar) return showMessage(msg, "Şifreler birbiriyle eşleşmiyor.", "error");
    msg.hidden = true;
    bekletBtn(form, true, "Güncelleniyor…");
    const { error } = await supabase.auth.updateUser({ password: yeni });
    if (error) {
      showMessage(msg, turkceSifreHatasi(error), "error");
      bekletBtn(form, false);
      return;
    }
    showMessage(msg, "Şifren güncellendi. Giriş sayfasına yönlendiriliyorsun…", "success");
    // signOut ÇAĞRILMAZ: Not Kasası kancası (USER_UPDATED) yeni parola malzemesini bu oturumda saklar.
    setTimeout(() => yonlendir("/hesap/giris.html"), 1400);
  });
}
