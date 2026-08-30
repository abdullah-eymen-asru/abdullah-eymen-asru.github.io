/*
 * assets/js/core/supabase-client.js
 *
 * Tüm auth/panel/admin sayfalarının import ettiği TEK Supabase istemcisi.
 * SUPABASE_URL ve SUPABASE_ANON_KEY tamamen PUBLIC değerlerdir — bunları
 * gizlemene gerek yok, Supabase'in tasarımı zaten bu ikisinin tarayıcıda
 * açıkta olmasına göre kuruludur. Gerçek güvenlik veritabanındaki RLS
 * politikalarından gelir (bkz. 0001_schema_rbac_rls.sql). service_role
 * anahtarını ise HİÇBİR ZAMAN buraya yazma.
 */

// ---- BURAYI DOLDUR (Supabase Dashboard > Project Settings > API) ----
const SUPABASE_URL = "https://eahvcirspmvntffzphye.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhaHZjaXJzcG12bnRmZnpwaHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTgxODMsImV4cCI6MjEwMTc3NDE4M30._f-GKSsffxFo66w3g0NJfmOWEhlsjU4Y6mlcTlcPJ2E"; // "anon public" anahtarı
// -----------------------------------------------------------------------

// Supabase JS SDK — artık CDN'den (esm.sh) ESM import DEĞİL, YEREL vendor
// dosyasından (assets/js/vendor/supabase.js, Supabase'in resmi UMD build'i)
// alınıyor. Bu build build sistemi gerektirmez, GitHub Pages / Cloudflare
// Pages gibi saf statik hosting ile hâlâ tam uyumludur.
//
// DEĞİŞİKLİK SEBEBİ (WebView uyumluluğu): önceki `import ... from
// "https://esm.sh/..."` STATİK bir modül import'uydu. Android WebView
// içinde bu istek zaman aşımına uğradığında/engellendiğinde modül HİÇ
// değerlendirilemiyor — bu da bu dosyayı import eden HER script'in
// (panel.js, auth-guard.js, akademik-projeler.md, blog.md, ...) tamamen
// çalışmadan iptal olmasına ve #loading ekranının sonsuza dek "Yükleniyor…"
// durumunda kalmasına yol açıyordu. UMD bundle harici bir import zincirine
// bağımlı olmadığı (tek dosya, self-contained) için bu riski ortadan
// kaldırıyor.
//
// Vendor dosyası _layouts/default.html <head>'inde
//   <script defer src="{{ '/assets/js/vendor/supabase.js' | relative_url }}"></script>
// ile, document sırasına göre TÜM type="module" scriptlerinden önce
// yükleniyor (defer'lı klasik scriptler ile modül scriptleri, spec gereği
// belge sırasına göre ve DOMContentLoaded'dan önce çalışır) — yani
// aşağıdaki window.supabase, bu satır çalıştığında HER ZAMAN hazırdır.
if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error(
    "Supabase JS bulunamadı: assets/js/vendor/supabase.js eksik ya da " +
      "_layouts/default.html'deki <script defer> etiketinden sonra " +
      "çalıştırılmış olabilir."
  );
}
const { createClient } = window.supabase;

/*
 * "OTURUMUMU HATIRLA" (bkz. hesap/giris.md + assets/js/auth/auth-pages.js)
 * ---------------------------------------------------------------------
 * Supabase SDK, persistSession:true olduğunda oturumu varsayılan olarak
 * HER ZAMAN localStorage'a yazar — yani tarayıcı kapatılıp açılsa bile
 * kullanıcı oturumu açık kalır. Giriş sayfasına eklenen "Oturumumu
 * hatırla" checkbox'ı işaretini kaldırırsa bunun yerine sessionStorage
 * kullanılmasını (sekme/tarayıcı kapanınca oturumun sona ermesini)
 * istiyoruz. SDK'nın kendisi böyle bir "sadece bu oturumluk" seçeneği
 * sunmadığından, kendi "dinamik" storage adaptörümüzü veriyoruz: her
 * getItem/setItem/removeItem çağrısında O ANKİ tercihe (localStorage'da
 * saklanan aea_oturumu_hatirla bayrağı) bakıp doğru depoya yönlendiriyor.
 * Tercih localStorage'da saklanıyor (bilerek — bu bayrağın kendisi kalıcı
 * olmalı ki bir sonraki ziyarette de hatırlanabilsin), ama asıl oturum
 * TOKEN'ı tercihe göre localStorage YA DA sessionStorage'a gidiyor.
 */
const OTURUM_HATIRLA_ANAHTARI = "aea_oturumu_hatirla"; // "0" ise sessionStorage kullanılır.

// WEBVIEW UYUMLULUĞU: Android WebView'lerde DOM Storage (localStorage/
// sessionStorage) uygulama tarafından setDomStorageEnabled(true) ile
// AÇIKÇA etkinleştirilmediği sürece VARSAYILAN OLARAK KAPALIDIR. Kapalıyken
// localStorage/sessionStorage'a erişim SecurityError fırlatır. Bu dosya
// modül seviyesinde (top-level) createClient() çağrısı sırasında SDK
// storage.getItem()'ı hemen çağırdığı için, bu hata try/catch'siz
// yakalanmazsa TÜM modül değerlendirmesi başarısız olur — yani bu dosyayı
// import eden HER script (panel.js, auth-guard.js, vs.) hiç çalışmaz ve
// #loading ekranı sonsuza dek takılı kalır (esm.sh CDN import hatasıyla
// AYNI sonuç sınıfı, farklı bir kök neden). Bu yüzden depo erişimi burada
// try/catch ile sarmalanıp, storage kullanılamıyorsa sessizce "oturum
// hatırlanamıyor" moduna (bellekte kalan oturum) düşülüyor.
function aktifOturumDeposu() {
  try {
    return localStorage.getItem(OTURUM_HATIRLA_ANAHTARI) === "0" ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

const dinamikOturumDeposu = {
  getItem: (anahtar) => {
    try {
      return aktifOturumDeposu()?.getItem(anahtar) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (anahtar, deger) => {
    try {
      aktifOturumDeposu()?.setItem(anahtar, deger);
    } catch {
      // Depo kullanılamıyor (WebView'de DOM Storage kapalı, gizli sekme,
      // kota dolu vb.) — oturum bu ziyaret boyunca bellekte kalır ama
      // sayfalar arası/kalıcı olarak saklanamaz. Kritik değil, sessizce geç.
    }
  },
  removeItem: (anahtar) => {
    try {
      aktifOturumDeposu()?.removeItem(anahtar);
    } catch {
      // yukarıdaki ile aynı sebep — sessizce geç.
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // OAuth / e-posta linki dönüşünde token'ı otomatik yakalar
    storage: dinamikOturumDeposu,
  },
});

/**
 * Giriş sayfasındaki "Oturumumu hatırla" checkbox'ının durumunu kaydeder.
 * ÖNEMLİ: signInWithPassword / signInWithOAuth çağrılmadan HEMEN ÖNCE
 * çağrılmalı — SDK oturumu kurduğu anda storage.setItem() çağırıyor ve
 * dinamikOturumDeposu o anki tercihe bakıyor, sonradan değiştirmenin bir
 * etkisi olmuyor.
 * Diğer depoda önceki bir girişten kalmış olabilecek eski bir oturum
 * token'ı da temizlenir — yoksa örn. kullanıcı bu sefer "hatırlama" dese
 * bile, tarayıcı kapatılıp tekrar açıldığında localStorage'daki ESKİ token
 * oturumu sessizce geri getirebilirdi.
 */
export function oturumHatirlamaTercihiniKaydet(hatirla) {
  try {
    localStorage.setItem(OTURUM_HATIRLA_ANAHTARI, hatirla ? "1" : "0");
    const projeRef = new URL(SUPABASE_URL).hostname.split(".")[0];
    const digerDepo = hatirla ? sessionStorage : localStorage;
    digerDepo.removeItem(`sb-${projeRef}-auth-token`);
  } catch {
    // localStorage/sessionStorage kullanılamıyor (WebView'de DOM Storage
    // kapalı vb.) YA DA SUPABASE_URL ayrıştırılamadı — sessizce geç,
    // kritik değil (oturum bellekte kalmaya devam eder).
  }
}

/** Basit HTML escape — kullanıcıdan/DB'den gelen metni innerHTML'e basmadan önce kullan. */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * GÜVENLİK: veritabanından gelen bir "link" alanını <a href="..."> içine
 * basmadan önce şema kontrolü. escapeHtml TEK BAŞINA yeterli DEĞİL —
 * "javascript:..." gibi bir URI, tırnak/açı parantezi hiç kullanmadan
 * href özniteliğinin İÇİNDE geçerli kalıp tıklanınca çalışabilir. Bu
 * fonksiyon SADECE http:// ve https:// ile başlayan adreslere izin verir;
 * biri projelerine (ör. akademik proje linki) böyle bir alanı kötü amaçlı
 * doldurursa (ör. ele geçirilmiş bir editör/admin hesabı ile), o link
 * artık HİÇ render edilmez (bkz. onizleme.js / supabase-yazi.js —
 * "proje linki" render'ı burayı kullanır).
 */
export function guvenliDisUrlMi(url) {
  if (!url || typeof url !== "string") return false;
  return /^https?:\/\//i.test(url.trim());
}

/** Küçük bir toast/uyarı yardımcı fonksiyonu — auth.css ile stillenir. */
export function showMessage(el, text, type = "error") {
  if (!el) return;
  el.textContent = text;
  el.className = `auth-message auth-message--${type}`;
  el.hidden = false;
}

/**
 * Standart "SPAM klasörünü kontrol et" uyarısı. Mail gönderilen HER ekranda
 * (kayıt, şifremi unuttum, hesap onayla, panelde e-posta değiştirme) aynı
 * metin/mantıkla kullanılır ki kullanıcı her yerde aynı şeyi görsün.
 * showMessage() ile karışmasın diye AYRI bir kutuda (auth-spam-notice)
 * gösterilir — başarı/hata mesajı her değiştiğinde bu uyarının kaybolmaması
 * için showMessage()'dan bağımsız çalışır.
 */
export function showSpamNotice(el) {
  if (!el) return;
  el.textContent =
    "Mail birkaç dakika içinde gelmezse SPAM (Gereksiz/Junk) klasörünü de kontrol et.";
  el.hidden = false;
}

export function hideSpamNotice(el) {
  if (!el) return;
  el.hidden = true;
}

/**
 * Supabase'in verifyOtp() / OTP doğrulama akışlarından dönen İngilizce hata
 * mesajlarını kullanıcı dostu Türkçeye çevirir. hesap/sifre-guncelle.html
 * (kod ile şifre sıfırlama) ve hesap/hesap-onayla.html (kod ile hesap
 * onaylama) tarafından ortak kullanılır.
 */
export function turkceOtpHatasi(message) {
  if (!message) return "Bilinmeyen bir hata oluştu.";
  if (message.includes("expired") || message.includes("invalid") || message.includes("Token")) {
    return "Kod hatalı veya süresi dolmuş. Yeni bir link/kod iste.";
  }
  if (message.includes("Auth session missing")) {
    return "Oturum bulunamadı, tekrar dene.";
  }
  return message;
}

/**
 * Büyük/küçük harf duyarsız arama için Türkçe'ye uygun harf küçültme.
 * JS'in düz toLowerCase()'i "İ" (noktalı büyük İ) harfini Türkçe kuralına
 * göre değil, Unicode varsayılanına göre çevirir ("i̇" gibi iki karakterlik
 * garip bir sonuç verebilir) — bu da "İrem" yazınca "irem" ile eşleşmemesi
 * gibi görünüşte rastgele arama başarısızlıklarına yol açabiliyordu.
 * toLocaleLowerCase("tr") bunu Türkçe harf kurallarına göre doğru çevirir.
 * admin.js (üye tablosu araması, içerik atama araması) ve chat.js (admin
 * mesajlaşmasında üye arama) ORTAK olarak bu fonksiyonu kullanıyor —
 * ikisinde de aynı davranış garanti olsun diye tek bir yerde tanımlı.
 */
export function kucukHarfeCevirTr(metin) {
  return (metin || "").toLocaleLowerCase("tr");
}

/**
 * Bir kullanıcının ADI, SOYADI, tam adı ve e-postasından HERHANGİ BİRİ,
 * aranan metni büyük/küçük harften bağımsız olarak İÇERİYOR mu?
 * first_name ve last_name'e AYRI AYRI bakmak önemli: sadece full_name'e
 * (ad+soyad birleşimi) bakılsaydı, full_name boş/senkron dışı kalmış eski
 * bir kayıtta arama çalışmazdı. first_name/last_name'e ayrı ayrı bakmak,
 * sadece adı ya da sadece soyadı yazan aramaların da kesin çalışmasını
 * garanti ediyor.
 */
export function kullaniciAramayaUyuyorMu(kullanici, aramaKucuk) {
  if (!aramaKucuk) return true;
  const alanlar = [kullanici.first_name, kullanici.last_name, kullanici.full_name, kullanici.email];
  return alanlar.some((alan) => kucukHarfeCevirTr(alan).includes(aramaKucuk));
}

/**
 * Bugünün Gizlilik Politikası / KVKK metni sürüm etiketi. Metni
 * (kurumsal/gizlilik-politikasi.md) gerçekten değiştirdiğinde bu değeri de
 * güncelle — o andan itibaren yeni kayıt olanlar bu sürüme onay verir ve
 * eski üyeler panelde "güncellenmiş metni onaylaman gerekiyor" uyarısı
 * görür (bkz. panel.js).
 */
export const KVKK_METIN_SURUMU = "2026-08";

/*
 * ÜYELİK KAYITLARI AÇIK/KAPALI (bkz. migration
 * 0031_uyelik_kayitlarini_ac_kapat.sql) — SADECE owner (Site Sahibi)
 * değiştirebilir (bkz. panel/admin-guvenlik.md, ".sadece-owner" bölümü).
 * Kapalıyken veritabanı katmanı (handle_new_user trigger'ı) yeni hesap
 * oluşumunu zaten KESİN olarak engeller; bu sabit + aşağıdaki yardımcı
 * fonksiyon SADECE kullanıcı deneyimi içindir (bkz. hesap/kayit.md +
 * auth-pages.js -> initKayitPage): formu göstermeden önce durumu kontrol
 * eder, ayrıca trigger'ın fırlattığı hatayı tanımak için de kullanılır.
 */
export const KAYITLAR_KAPALI_ISARETI = "KAYITLAR_KAPALI";

/**
 * site_settings.kayitlar_acik'i okur. Bu satır herkese açık (anonim
 * ziyaretçi dahil) okunabilir bir politikayla korunuyor (bkz. migration
 * 0001 "settings_select_anyone"), o yüzden oturum açılmadan da çağrılabilir.
 * Ağ hatası ya da satır hiç yoksa (olmamalı, tek satır garanti altında)
 * GÜVENLİ TARAFTA kalıp true (açık) döner — bu fonksiyon sadece deneyim
 * katmanı olduğu için, asıl bağlayıcı kural her zaman veritabanı
 * trigger'ındadır; burada yanlışlıkla "false" dönüp kayıt formunu
 * gereksiz yere gizlemekten kaçınıyoruz.
 */
export async function kayitlarAcikMi() {
  const { data, error } = await supabase
    .from("site_settings")
    .select("kayitlar_acik")
    .eq("id", 1)
    .single();
  if (error || !data) {
    console.error("Kayıt durumu okunamadı, güvenli tarafta (açık) kalınıyor:", error);
    return true;
  }
  return data.kayitlar_acik !== false;
}
