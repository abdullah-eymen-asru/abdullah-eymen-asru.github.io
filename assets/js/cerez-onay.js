/*
 * assets/js/cerez-onay.js — KVKK (6698 sayılı Kanun) ve GDPR'ın aradığı
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
 *      işlevi için gerekli teknik depolama), "Analitik" (Google Analytics)
 *      ve "İşlevsel/Üçüncü Taraf" (Giscus/GitHub yorum widget'ı) ayrı ayrı
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
const CEREZ_SURUM = "1";

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

function cerezTercihleriniYaz(analitik, islevsel) {
  const veri = {
    surum: CEREZ_SURUM,
    gerekli: true,
    analitik: !!analitik,
    islevsel: !!islevsel,
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

function tercihleriUygula(veri) {
  analitikUygula(veri.analitik);
  islevselUygula(veri.islevsel);
}

/* ---- Şerit (banner) ve ayrıntılı panel görünürlüğü ---- */
function bannerGoster() {
  document.getElementById("cerez-banner")?.removeAttribute("hidden");
}
function bannerGizle() {
  document.getElementById("cerez-banner")?.setAttribute("hidden", "");
}
function panelAc() {
  const veri = cerezTercihleriniOku();
  const analitikKutu = document.getElementById("cerez-analitik-kutu");
  const islevselKutu = document.getElementById("cerez-islevsel-kutu");
  if (analitikKutu) analitikKutu.checked = veri ? !!veri.analitik : false;
  if (islevselKutu) islevselKutu.checked = veri ? !!veri.islevsel : false;
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

function kaydetVeUygula(analitik, islevsel) {
  const veri = cerezTercihleriniYaz(analitik, islevsel);
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
    tercihleriUygula(mevcut);
  } else {
    // Onay hiç verilmemiş: şerit gösterilir, isteğe bağlı hiçbir şey
    // yüklenmez (bkz. dosya başındaki "varsayılan = kapalı" ilkesi).
    bannerGoster();
  }

  document.getElementById("cerez-tumunu-kabul")?.addEventListener("click", () => {
    kaydetVeUygula(true, true);
  });
  document.getElementById("cerez-sadece-zorunlu")?.addEventListener("click", () => {
    kaydetVeUygula(false, false);
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
    kaydetVeUygula(false, false);
    panelKapat();
  });
  document.getElementById("cerez-panel-kaydet")?.addEventListener("click", () => {
    const analitik = document.getElementById("cerez-analitik-kutu")?.checked;
    const islevsel = document.getElementById("cerez-islevsel-kutu")?.checked;
    kaydetVeUygula(analitik, islevsel);
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
