/*
 * assets/js/core/site-islemleri.js (önceki adıyla cerez-onay.js) — KVKK (6698 sayılı Kanun) ve GDPR'ın aradığı
 * anlamda "açık rıza" temelli çerez onay şeridi ve tercih paneli.
 *
 * TASARIM İLKELERİ:
 *   1) VARSAYILAN = KAPALI. Sayfa ilk açıldığında hiçbir isteğe bağlı
 *      çerez/benzer teknoloji (Google Analytics, Giscus/GitHub yorum
 *      widget'ı) YÜKLENMEZ. Sadece kullanıcı açıkça "Tümünü Kabul Et"
 *      ya da panelden ilgili kategoriyi işaretleyip kaydederse yüklenir.
 *      Bu, "örtük onay" (banner'ı görmezden gelmek = kabul) yerine
 *      GERÇEK/AKTİF onay ister — hem KVKK Kurulu'nun çerez rehberi hem
 *      GDPR (ve ePrivacy) bunu şart koşar.
 *   2) GRANÜLER KATEGORİ: "Zorunlu" (kapatılamaz — oturum/tema gibi site
 *      işlevi için gerekli teknik depolama), "Analitik" (Google Analytics),
 *      "İşlevsel/Üçüncü Taraf" (Giscus/GitHub yorum widget'ı) ve "Reklam"
 *      (Google AdSense — bkz. _config.yml adsense_client_id) ayrı ayrı
 *      açılıp kapatılabilir.
 *   3) KOLAY GERİ ÇEKME: sayfanın alt bilgisindeki "Çerez Ayarları"
 *      bağlantısı her an aynı paneli yeniden açar; kullanıcı istediği
 *      zaman önceden verdiği izni geri çekebilir (bkz. tercihleriUygula).
 *   4) BİRİNCİ TARAF (bu site alan adına ait) çerezler geri çekildiğinde
 *      GERÇEKTEN silinir (bkz. onekleCerezleriSil). ÜÇÜNCÜ TARAF (örn.
 *      giscus.app / github.com) alan adlarına ait çerezler ise tarayıcı
 *      güvenlik modeli (same-origin policy) gereği bu sayfanın JS'inden
 *      SİLİNEMEZ — bu durumda yalnızca ilgili widget kaldırılıp yeni veri
 *      toplanması engellenir; bu sınır dürüstlük payı olarak burada ve
 *      gizlilik politikasında açıkça belirtilir.
 *   5) HER CİHAZDA ÇALIŞIR: şerit/panel saf HTML+CSS+vanilla JS'tir,
 *      ekran boyutuna göre CSS ile (bkz. cerez-onay.css) yeniden dizilir;
 *      3. parti bir çerez-onay servisine bağımlı değildir.
 */

const CEREZ_ANAHTAR = "cerez_tercihleri";
// Kategori tanımı veya metin ÖNEMLİ ÖLÇÜDE değişirse bu sürümü artır —
// eski sürüme onay vermiş ziyaretçilere şerit yeniden gösterilir.
// v2 (2026-08): "Reklam" (AdSense) kategorisi eklendi — bu YENİ bir izin
// istendiği için sürüm artırıldı, v1'de onay vermiş ziyaretçiler de
// (reklam konusunda hiç soru sorulmamış oldukları için) şeridi tekrar
// görür ve reklam dahil tüm kategoriler için yeniden AÇIK/net bir tercih
// verir.
const CEREZ_SURUM = "2";

function cerezTercihleriniOku() {
  try {
    const ham = localStorage.getItem(CEREZ_ANAHTAR);
    if (!ham) return null;
    const veri = JSON.parse(ham);
    if (!veri || veri.surum !== CEREZ_SURUM) return null;
    return veri;
  } catch (e) {
    return null;
  }
}

function cerezTercihleriniYaz(analitik, islevsel, reklam) {
  const veri = {
    surum: CEREZ_SURUM,
    gerekli: true,
    analitik: !!analitik,
    islevsel: !!islevsel,
    reklam: !!reklam,
    tarih: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CEREZ_ANAHTAR, JSON.stringify(veri));
  } catch (e) {
    // localStorage kullanılamıyor (gizli/özel pencere, doluluk kotası vb.)
    // — tercih bu oturumda uygulanır ama kalıcı kaydedilemez, bir sonraki
    // ziyarette şerit tekrar gösterilir. Kritik değil, sessizce geç.
  }
  return veri;
}

/*
 * Adı verilen öneklerden biriyle BAŞLAYAN tüm BİRİNCİ TARAF çerezleri
 * siler (ör. "_ga" öneki → _ga, _gid, _gat, _ga_XXXXXXX hepsi silinir).
 * Olası path/domain kombinasyonlarının hepsini deniyoruz çünkü bir
 * çerezi silmek için onu KOYARKEN kullanılan domain/path ile BİREBİR
 * aynı domain/path'i tekrar vermek gerekir — hangisiyle kurulduğunu
 * kesin bilemediğimiz için makul kombinasyonların hepsini deniyoruz.
 */
function onekleCerezleriSil(onekler) {
  const mevcutAdlar = document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter(Boolean);
  const hedefAdlar = mevcutAdlar.filter((ad) => onekler.some((on) => ad.indexOf(on) === 0));
  if (!hedefAdlar.length) return;

  const gecmisTarih = "Thu, 01 Jan 1970 00:00:00 UTC";
  const host = window.location.hostname;
  hedefAdlar.forEach((ad) => {
    document.cookie = `${ad}=; expires=${gecmisTarih}; path=/;`;
    document.cookie = `${ad}=; expires=${gecmisTarih}; path=/; domain=${host};`;
    document.cookie = `${ad}=; expires=${gecmisTarih}; path=/; domain=.${host};`;
  });
}

/*
 * Google Analytics'i AÇAR. Gerçek yükleme fonksiyonu (varsa) _layouts/
 * default.html içinde window.__cerezAnalitikYukle olarak tanımlanır —
 * bu dosya sadece onu (izin varsa) TETİKLER, GA script'inin kendisini
 * bilmez/barındırmaz.
 */
function analitikUygula(acik) {
  if (acik) {
    if (typeof window.__cerezAnalitikYukle === "function") window.__cerezAnalitikYukle();
    return;
  }
  // KAPAT: Google'ın resmi olarak desteklediği "ga-disable-<ölçüm-id>"
  // bayrağı — gtag.js her çağrıda bunu kontrol eder, script zaten
  // yüklenmiş olsa bile YENİ hiçbir veri göndermez (sayfa yenilemeye
  // gerek yok). Ardından zaten kurulmuş birinci taraf GA çerezlerini
  // (_ga, _gid, _gat...) gerçekten sil.
  if (window.__GA_MEASUREMENT_ID__) {
    window["ga-disable-" + window.__GA_MEASUREMENT_ID__] = true;
  }
  onekleCerezleriSil(["_ga", "_gid", "_gat"]);
}

/*
 * İşlevsel/üçüncü taraf (Giscus) kategorisini açar/kapatır. Gerçek
 * yükleme/kaldırma _includes/comments.html içinde bu olayı dinleyerek
 * yapılır — bu dosya Giscus'un iç işleyişini bilmez, sadece kategori
 * durumunu yayınlar.
 */
function islevselUygula(acik) {
  window.__cerezIslevselAcik = !!acik;
  document.dispatchEvent(new CustomEvent("cerez-islevsel-degisti", { detail: { acik: !!acik } }));
}

/*
 * AdSense reklamlarını AÇAR. Gerçek yükleme fonksiyonu (varsa) _layouts/
 * default.html içinde window.__cerezReklamYukle olarak tanımlanır — bu
 * dosya sadece onu (izin varsa) TETİKLER, AdSense script'inin/reklam
 * bloklarının kendisini bilmez/barındırmaz (analitikUygula ile AYNI desen).
 *
 * @param {boolean} acik
 * @param {boolean} otomatikMi - true ise bu çağrı SAYFA AÇILIŞINDA, daha
 *   önce kaydedilmiş bir tercihin otomatik "replay"i yüzünden geliyor
 *   (bkz. init() → tercihleriUygula(mevcut)); false ise ziyaretçi AZ ÖNCE,
 *   bu sayfada bilfiil bir buton tıkladı (şerit/panel → kaydetVeUygula).
 *
 * window.__reklamOtomatikYuklemeKapali (SADECE otomatikMi=true iken
 * etkili): /icerik/supabase-yazi.html (GitHub'a hiç commit edilmemiş,
 * front-matter'ı build-time'da OKUNAMAYAN içerikler) tarafından, sayfa
 * kendi <script>'inde set edilir — o sayfa hangi içeriğin gösterileceğini
 * ancak ÇALIŞMA ZAMANINDA (bir RPC çağrısıyla) öğrenebildiği için, sayfa
 * DAHA YENİ açılmışken (kayıt henüz gelmemişken) "bu içerikte reklam
 * kapalı mı?" sorusu yanıtlanmadan otomatik reklam scripti (ve olası
 * Otomatik Reklamlar taraması) TETİKLENMEZ — bunun yerine
 * assets/js/github-yonetim/supabase-yazi.js kendi çektiği kaydın reklam
 * alanına bakıp uygunsa window.__cerezReklamYukle()'yi KENDİSİ çağırır.
 * AMA ziyaretçi bu sayfayı görüntülerken AKTİF OLARAK "Kabul Et"e
 * tıklarsa (otomatikMi=false) bu bayrak ARTIK uygulanmaz — çünkü tıklama
 * insan tepki süresi aldığı için (saniyeler), kayıt RPC'si (milisaniyeler)
 * o ana kadar zaten gelmiş ve supabase-yazi.js (varsa) reklam <div>'ini
 * DOM'a çoktan eklemiş olur; bu durumda otomatikMi=true'daki gibi
 * ERTELEMEK, tıklamadan sonra reklamın HİÇ görünmemesi gibi ayrı (ve daha
 * kötü) bir hataya yol açardı. Kapatma (aşağıdaki `else` dalı) bu
 * bayraktan hiçbir zaman etkilenmez — izin geri çekilirse her sayfada
 * aynı şekilde geçerli olmalı.
 */
function reklamUygula(acik, otomatikMi) {
  if (acik) {
    if (otomatikMi && window.__reklamOtomatikYuklemeKapali) return;
    if (typeof window.__cerezReklamYukle === "function") window.__cerezReklamYukle();
    return;
  }
  // KAPAT: script zaten yüklenmişse bile Google'ın Otomatik Reklamlar için
  // resmi olarak desteklediği "sayfa düzeyinde reklamları devre dışı
  // bırak" ayarını gönder (yeni sayfa/görünüm oluşturmaz); manuel blok(lar)
  // varsa da gizle. AdSense'in KENDİ (google.com/googlesyndication.com
  // alan adlarına ait) çerezleri, GA'daki gibi bu siteden silinemez —
  // bunlar zaten script hiç yüklenmediyse/artık tetiklenmediyse yeni veri
  // toplamaya devam etmez; halihazırda kurulmuş olanlar için Gizlilik
  // Politikası'ndaki tarayıcı-ayarları notu geçerlidir (Giscus ile aynı
  // üçüncü-taraf sınırı).
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({
      google_ad_client: window.__ADSENSE_CLIENT_ID__,
      enable_page_level_ads: false,
    });
  } catch (e) {
    // script hiç yüklenmemişse adsbygoogle push'u no-op'tur, hata değil.
  }
  document.querySelectorAll(".reklam-alani").forEach((el) => el.setAttribute("hidden", ""));
}

function tercihleriUygula(veri, otomatikMi) {
  analitikUygula(veri.analitik);
  islevselUygula(veri.islevsel);
  reklamUygula(veri.reklam, !!otomatikMi);
}

/* ---- Şerit (banner) ve ayrıntılı panel görünürlüğü ----
 * BUG FİX: Şerit "position: fixed; bottom: 0" olduğu için normal sayfa
 * akışında yer kaplamıyordu; bu yüzden altındaki içerik (ör. Gizlilik
 * Politikası sayfasındaki tablo/son paragraf, ya da herhangi bir
 * sayfanın alt bilgisi) şeridin ARKASINDA kalıp mobilde "farklı"/eksik
 * görünebiliyordu — özellikle mobilde şerit metni sarmaladığı için
 * masaüstünden çok daha yüksek olduğunda. bannerBoslukAyarla(), şerit
 * her görünür olduğunda GERÇEK (render edilmiş) yüksekliğini ölçüp
 * <body>'e o kadar padding-bottom ekler; şerit kapanınca kaldırır.
 * Pencere yeniden boyutlandığında (mobil klavye, döndürme, metin
 * sarmalamasının değişmesi) da yeniden ölçer.
 */
function bannerBoslukAyarla() {
  const banner = document.getElementById("cerez-banner");
  if (!banner || banner.hasAttribute("hidden")) {
    document.body.style.paddingBottom = "";
    return;
  }
  document.body.style.paddingBottom = banner.offsetHeight + "px";
}
function bannerGoster() {
  document.getElementById("cerez-banner")?.removeAttribute("hidden");
  bannerBoslukAyarla();
  if (!window.__cerezBannerResizeBagli) {
    window.__cerezBannerResizeBagli = true;
    window.addEventListener("resize", bannerBoslukAyarla);
  }
}
function bannerGizle() {
  document.getElementById("cerez-banner")?.setAttribute("hidden", "");
  document.body.style.paddingBottom = "";
}
function panelAc() {
  const veri = cerezTercihleriniOku();
  const analitikKutu = document.getElementById("cerez-analitik-kutu");
  const islevselKutu = document.getElementById("cerez-islevsel-kutu");
  const reklamKutu = document.getElementById("cerez-reklam-kutu");
  if (analitikKutu) analitikKutu.checked = veri ? !!veri.analitik : false;
  if (islevselKutu) islevselKutu.checked = veri ? !!veri.islevsel : false;
  if (reklamKutu) reklamKutu.checked = veri ? !!veri.reklam : false;
  const overlay = document.getElementById("cerez-panel-overlay");
  if (!overlay) return;
  // Önceki bir kapanış animasyonundan kalmış olabilecek sınıfı temizle,
  // sonra bir sonraki frame'de gösterip geçiş (fade+scale in) oynasın.
  overlay.classList.remove("cerez-panel-kapaniyor");
  overlay.removeAttribute("hidden");
  document.body.classList.add("cerez-panel-acik");
}

/*
 * Paneli kapatır. X butonu / Escape / overlay'e tıklama / "Sadece
 * Zorunlu" / "Tercihleri Kaydet" hepsi buradan geçer. Kapanış GÖRSEL
 * olarak yukarıdan aşağı küçülerek (bkz. cerez-onay.css .cerez-panel-
 * kapaniyor) biter; CSS geçişi bittiğinde (transitionend) ya da en fazla
 * 250ms sonra (geçiş herhangi bir sebeple tetiklenmezse, ör. tarayıcı
 * animasyonu atlarsa) gerçekten "hidden" ekleyip DOM'dan etkileşimi
 * kaldırıyoruz — böylece animasyon sırasında panel görünmeye devam
 * ederken arkadaki sayfa scroll kilidi ve odak (focus) tutarlı kalıyor.
 */
function panelKapat() {
  const overlay = document.getElementById("cerez-panel-overlay");
  if (!overlay || overlay.hasAttribute("hidden")) return;

  document.body.classList.remove("cerez-panel-acik");
  overlay.classList.add("cerez-panel-kapaniyor");

  let tamamlandi = false;
  const bitir = () => {
    if (tamamlandi) return;
    tamamlandi = true;
    overlay.setAttribute("hidden", "");
    overlay.classList.remove("cerez-panel-kapaniyor");
  };

  overlay.addEventListener("transitionend", bitir, { once: true });
  setTimeout(bitir, 250); // reduced-motion veya geçişin atlandığı durumlar için güvenlik ağı
}

function kaydetVeUygula(analitik, islevsel, reklam) {
  const veri = cerezTercihleriniYaz(analitik, islevsel, reklam);
  tercihleriUygula(veri);
  bannerGizle();
  return veri;
}

function init() {
  // Bu dosya birden fazla kez çalıştırılırsa (ör. bir sayfa script'i
  // yanlışlıkla iki kez eklerse) event listener'lar iki kez bağlanıp her
  // tıklamanın iki kez tetiklenmesine (veya çakışan davranışa) yol
  // açabilir. Tek seferlik çalışmayı garanti ediyoruz.
  if (window.__cerezOnayBaslatildi) return;
  window.__cerezOnayBaslatildi = true;

  const mevcut = cerezTercihleriniOku();
  if (mevcut) {
    tercihleriUygula(mevcut, true);
  } else {
    // Onay hiç verilmemiş: şerit gösterilir, isteğe bağlı hiçbir şey
    // yüklenmez (bkz. dosya başındaki "varsayılan = kapalı" ilkesi).
    bannerGoster();
  }

  document.getElementById("cerez-tumunu-kabul")?.addEventListener("click", () => {
    kaydetVeUygula(true, true, true);
  });
  document.getElementById("cerez-sadece-zorunlu")?.addEventListener("click", () => {
    kaydetVeUygula(false, false, false);
  });
  document.getElementById("cerez-ayarlari-yonet")?.addEventListener("click", panelAc);
  document.getElementById("cerez-ayarlar-ac-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    panelAc();
  });
  document.getElementById("cerez-panel-kapat-btn")?.addEventListener("click", panelKapat);
  document.getElementById("cerez-panel-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "cerez-panel-overlay") panelKapat();
  });
  document.getElementById("cerez-panel-reddet")?.addEventListener("click", () => {
    kaydetVeUygula(false, false, false);
    panelKapat();
  });
  document.getElementById("cerez-panel-kaydet")?.addEventListener("click", () => {
    const analitik = document.getElementById("cerez-analitik-kutu")?.checked;
    const islevsel = document.getElementById("cerez-islevsel-kutu")?.checked;
    const reklam = document.getElementById("cerez-reklam-kutu")?.checked;
    kaydetVeUygula(analitik, islevsel, reklam);
    panelKapat();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") panelKapat();
  });
}

/*
 * window.CerezTercihleri: diğer script'lerin (ör. _includes/comments.html
 * içindeki Giscus yükleyici) mevcut tercihi okuyabilmesi, paneli
 * açabilmesi ve bir kategoriyi programatik olarak değiştirebilmesi için
 * küçük bir genel API.
 */
window.CerezTercihleri = {
  al: cerezTercihleriniOku,
  panelAc,
  kaydet: kaydetVeUygula,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
