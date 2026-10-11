/*
 * assets/js/notlar/kasa-kancalari.js
 * -----------------------------------------------------------------------
 * Not Kasası'nın "ikinci parola İSTEMEYEN" davranışı için üç küçük kanca.
 * auth-pages.js ve panel.js'e TEK SATIR bile dokunmaz — sadece DOM olaylarını
 * (capture fazında) dinler.
 *
 *  1) girisKancasiKur()          hesap/giris.html: şifreli girişin submit anında
 *                                parolayı dışa aktarılamaz bir PBKDF2 baz
 *                                anahtarına çevirir, HAM PAROLAYI sıfırlar.
 *  2) sifreDegisimKancasiKur()   dashboard: Panelim > Şifre Değiştir başarılı
 *                                olursa (USER_UPDATED), kasa zarfı yeni parolayla
 *                                yeniden sarılır → notlar kaybolmaz.
 *  3) cikisTemizligiKur()        SIGNED_OUT: cihazdaki tüm anahtar malzemesi silinir.
 *  4) sifirlamaKancasiKur()      hesap/sifre-guncelle.html ("şifremi unuttum" sonrası yeni parola):
 *                                updateUser BAŞARILI olunca yeni parola malzemesi "doğrulanmış"
 *                                olarak saklanır; aynı cihazda Notlar açılınca zarf yeni parolaya
 *                                taşınır, kurtarma anahtarı gerekmez (kasa-js girisParolasiniUyumla).
 *
 * NEDEN GİRİŞ SAYFASINDA YAKALIYORUZ?
 *   Giriş başarılı olunca auth-pages.js hemen başka sayfaya yönlendiriyor; yani
 *   "girişten sonra parolayla bir şey türet" demek yarışta kaybetmek demek.
 *   Parolayı görebildiğimiz TEK an submit'tir. O anda yaptığımız iş çok kısa
 *   (importKey + IndexedDB put, birkaç ms) ve ağ isteği (signInWithPassword)
 *   bitmeden tamamlanır. Tuz sunucuda olduğundan ve oturum henüz yokken
 *   okunamadığından, ağır PBKDF2 türetmesi dashboard'da (oturum varken) yapılır.
 *
 * GOOGLE İLE GİRİŞ: giriş parolası yok → kanca hiçbir şey yakalamaz. Google kullanıcısı
 *   Notlar'ı ilk açtığında BAĞIMSIZ bir "Kasa Parolası" belirler (migration 0082,
 *   parola_tur='kasa'); bu parola giriş parolasından tamamen ayrıdır, Şifre Değiştir
 *   kancası bu zarfa DOKUNMAZ. Akışı notlar.js + kasa.js anlatır.
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import {
  parolaMalzemesiOlustur,
  bekleyenParolaMalzemesiKaydet,
  parolaDegisimindeZarfiYenile,
  tumAnahtarlariTemizle,
} from "./kasa.js";

/* ------------------------------------------------------------------ */
/* 1) Giriş sayfası                                                    */
/* ------------------------------------------------------------------ */

export function girisKancasiKur() {
  // document + capture: formun KENDİ dinleyicilerinden (auth-pages.js) her koşulda önce çalışır.
  document.addEventListener(
    "submit",
    (olay) => {
      const form = olay.target;
      if (!(form instanceof HTMLFormElement) || form.id !== "giris-form") return;

      let eposta = form.elements.email?.value || "";
      let parola = form.elements.password?.value || "";
      if (!eposta || !parola) return;

      // Beklemiyoruz (await YOK): auth-pages.js akışı bizi beklemeden devam eder.
      // Hata olursa sessizce geç — giriş akışı ASLA bizim yüzümüzden bozulmamalı.
      parolaMalzemesiOlustur(parola)
        .then((baz) => bekleyenParolaMalzemesiKaydet(eposta, baz))
        .catch((hata) => console.warn("Not Kasası: parola malzemesi saklanamadı (giriş etkilenmedi):", hata))
        .finally(() => {
          eposta = null;
        });

      parola = null; // ham parola referansı bırakıldı (bayt kopyası parolaMalzemesiOlustur içinde sıfırlanıyor)
    },
    true
  );
}

/* ------------------------------------------------------------------ */
/* 2) Şifre değiştirme                                                 */
/* ------------------------------------------------------------------ */

let sifreKancasiKuruldu = false;

export function sifreDegisimKancasiKur() {
  if (sifreKancasiKuruldu) return;
  sifreKancasiKuruldu = true;

  let bekleyenBaz = null; // dışa aktarılamaz CryptoKey (ham parola DEĞİL)
  let zamanAsimi = null;

  document.addEventListener(
    "submit",
    (olay) => {
      const form = olay.target;
      if (!(form instanceof HTMLFormElement) || form.id !== "sifre-degistir-form") return;

      let yeni = form.elements.yeni_sifre?.value || "";
      let tekrar = form.elements.yeni_sifre_tekrar?.value || "";
      // panel.js aynı doğrulamaları yapıyor; geçersizse updateUser hiç çağrılmaz,
      // USER_UPDATED gelmez ve aşağıdaki zaman aşımı bekleyen malzemeyi atar.
      if (yeni.length < 8 || yeni !== tekrar) {
        yeni = tekrar = null;
        return;
      }

      parolaMalzemesiOlustur(yeni)
        .then((baz) => {
          bekleyenBaz = baz;
          clearTimeout(zamanAsimi);
          zamanAsimi = setTimeout(() => (bekleyenBaz = null), 60_000);
        })
        .catch((hata) => console.warn("Not Kasası: yeni parola malzemesi üretilemedi:", hata));

      yeni = tekrar = null;
    },
    true
  );

  // updateUser() BAŞARILI olunca Supabase USER_UPDATED yayar. Zarfı SADECE o zaman yenileriz:
  // parola gerçekten değişmeden zarfı değiştirmek notları kilitleyebilirdi.
  supabase.auth.onAuthStateChange((olay, oturum) => {
    if (olay !== "USER_UPDATED" || !bekleyenBaz || !oturum?.user) return;
    const baz = bekleyenBaz;
    bekleyenBaz = null;
    clearTimeout(zamanAsimi);

    // onAuthStateChange içinde await'li supabase çağrısı yapmak kilitlenmeye yol açabilir → bir sonraki tura al.
    setTimeout(async () => {
      try {
        const sonuc = await parolaDegisimindeZarfiYenile(oturum.user.id, baz);
        if (sonuc.yapildi) {
          bildir("🔐 Not Kasası yeni parolanla yeniden şifrelendi; notların etkilenmedi.", "success");
        } else if (sonuc.sebep === "kilitli" || sonuc.sebep === "eski-anahtar-gecersiz") {
          bildir(
            "⚠️ Not Kasası bu cihazda kilitliydi, zarf yenilenemedi. Bir sonraki girişte Notlar sekmesi " +
              "kurtarma anahtarını isteyecek — onu hazır tut.",
            "warning"
          );
        }
      } catch (hata) {
        console.error("Not Kasası zarf yenileme hatası:", hata);
        bildir("⚠️ Not Kasası zarfı yenilenemedi. Kurtarma anahtarını sakla; sorun olursa onunla açarsın.", "warning");
      }
    }, 0);
  });
}

function bildir(metin, tur) {
  const kutu = document.getElementById("sifre-message");
  if (!kutu) return;
  // panel.js kendi başarı mesajını yazdıktan sonra araya girmemek için bir sonraki ekran çiziminde ekle.
  const not = document.createElement("p");
  not.className = `auth-message auth-message--${tur}`;
  not.textContent = metin;
  kutu.insertAdjacentElement("afterend", not);
  setTimeout(() => not.remove(), 15_000);
}

/* ------------------------------------------------------------------ */
/* 2b) Şifre sıfırlama sayfası ("şifremi unuttum" → yeni parola)       */
/* ------------------------------------------------------------------ */

let sifirlamaKancasiKuruldu = false;

export function sifirlamaKancasiKur() {
  if (sifirlamaKancasiKuruldu) return;
  sifirlamaKancasiKuruldu = true;

  let bekleyenBaz = null; // dışa aktarılamaz CryptoKey (ham parola DEĞİL)
  let zamanAsimi = null;

  document.addEventListener(
    "submit",
    (olay) => {
      const form = olay.target;
      if (!(form instanceof HTMLFormElement) || form.id !== "sifre-guncelle-form") return;

      let yeni = form.elements.password?.value || "";
      let tekrar = form.elements.password_again?.value || "";
      // auth-pages.js aynı doğrulamaları yapar; geçersizse updateUser çağrılmaz, USER_UPDATED gelmez.
      if (yeni.length < 8 || yeni !== tekrar) {
        yeni = tekrar = null;
        return;
      }
      parolaMalzemesiOlustur(yeni)
        .then((baz) => {
          bekleyenBaz = baz;
          clearTimeout(zamanAsimi);
          zamanAsimi = setTimeout(() => (bekleyenBaz = null), 60_000);
        })
        .catch((hata) => console.warn("Not Kasası: yeni parola malzemesi üretilemedi (sıfırlama etkilenmedi):", hata));
      yeni = tekrar = null;
    },
    true
  );

  // Parola SUNUCUDA gerçekten değişince (USER_UPDATED) malzeme "doğrulanmış" olarak saklanır.
  // Sayfa hemen yönlendirildiği için ağır PBKDF2 burada değil, Notlar açılırken yapılır.
  supabase.auth.onAuthStateChange((olay, oturum) => {
    if (olay !== "USER_UPDATED" || !bekleyenBaz || !oturum?.user?.email) return;
    const baz = bekleyenBaz;
    bekleyenBaz = null;
    clearTimeout(zamanAsimi);
    setTimeout(() => {
      bekleyenParolaMalzemesiKaydet(oturum.user.email, baz, true).catch((hata) =>
        console.warn("Not Kasası: sıfırlama sonrası parola malzemesi saklanamadı:", hata)
      );
    }, 0);
  });
}

/* ------------------------------------------------------------------ */
/* 3) Çıkış temizliği                                                  */
/* ------------------------------------------------------------------ */

let cikisKancasiKuruldu = false;

export function cikisTemizligiKur() {
  if (cikisKancasiKuruldu) return;
  cikisKancasiKuruldu = true;
  supabase.auth.onAuthStateChange((olay) => {
    if (olay === "SIGNED_OUT") tumAnahtarlariTemizle();
  });
}

/* ------------------------------------------------------------------ */
/* Dashboard'un tek çağrılık girişi                                    */
/* ------------------------------------------------------------------ */

export function dashboardKancalariniKur() {
  sifreDegisimKancasiKur();
  cikisTemizligiKur();
}

// giris.md bu dosyayı <script type="module" src> ile yükler; form varsa kancayı kendisi kurar.
// NOT: giriş sayfasında SIGNED_OUT DİNLEMİYORUZ — giriş sırasında Supabase'in yayabileceği
// bir SIGNED_OUT, az önce yakaladığımız parola malzemesini yanlışlıkla silebilirdi. Onun
// yerine: sayfa AÇILIRKEN oturum yoksa (başka bir sayfadan çıkış yapılmıştır) eski anahtarlar
// silinir. Bu, submit'ten ÖNCE olduğundan yeni yakalanan malzemeyle yarışmaz.
if (document.getElementById("sifre-guncelle-form")) sifirlamaKancasiKur();

if (document.getElementById("giris-form")) {
  girisKancasiKur();
  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (!data?.session) return tumAnahtarlariTemizle();
    })
    .catch(() => {});
}
