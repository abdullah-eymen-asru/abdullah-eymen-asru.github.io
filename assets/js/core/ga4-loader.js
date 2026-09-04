/*
 * assets/js/core/ga4-loader.js
 *
 * Önceden bu mantık _layouts/default.html içinde, {{ site.google_analytics_id }}
 * Liquid değişkenini gövdesine gömen bir INLINE <script> bloğuydu. Sıfır
 * inline script kısıtına uymak için ölçüm ID'si artık script ETİKETİNİN
 * KENDİSİNDE bir "data-ga-id" niteliği olarak taşınıyor (bkz.
 * _layouts/default.html'deki <script defer src="...ga4-loader.js"
 * data-ga-id="{{ site.google_analytics_id }}">) — Liquid hâlâ build
 * zamanında ID'yi HTML'e yazıyor, ama artık bir <script> GÖVDESİ değil,
 * sıradan bir HTML niteliği (attribute) değeri olarak; bu, CSP'nin
 * script-src kısıtlamasının hiç kapsamadığı, çalıştırılabilir olmayan
 * statik bir metindir.
 *
 * document.currentScript: bu dosya "defer" ile senkron/klasik bir
 * <script> olarak yüklendiği (type="module" DEĞİL) için, dosyanın en üst
 * seviyesinde (bir Promise/callback içine düşmeden ÖNCE) okunduğu sürece
 * document.currentScript hep BU script etiketine işaret eder — spesifikasyon
 * gereği modül olmayan script'lerde bu güvenilir bir yöntemdir.
 *
 * Bu dosya sadece bir FONKSİYON tanımlar (window.__cerezAnalitikYukle);
 * gerçek gtag.js kütüphanesi ve 'config' çağrısı SADECE ziyaretçi
 * "Analitik" çerezlerini onayladığında (bkz. assets/js/core/
 * site-islemleri.js -> analitikUygula) tetiklenir. window.gtag,
 * assets/js/core/consent-mode.js tarafından bu dosyadan ÖNCE
 * (default.html'de daha erken) tanımlanmış olmalıdır.
 */
(function () {
  var scriptTag = document.currentScript;
  var gaId = scriptTag && scriptTag.getAttribute("data-ga-id");
  if (!gaId) return; // site.google_analytics_id boşsa bu dosya hiç render edilmez zaten (bkz. layout {% if %})

  window.__GA_MEASUREMENT_ID__ = gaId;

  window.__cerezAnalitikYukle = function () {
    if (window.__cerezAnalitikYuklendi) return;
    window.__cerezAnalitikYuklendi = true;

    var s = document.createElement("script");
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
    s.async = true;
    document.head.appendChild(s);

    // WEBVIEW/GEÇ YÜKLEME UYUMLULUĞU: consent-mode.js normalde bu
    // dosyadan önce çalışıp window.gtag'i tanımlamış olur, ama savunmacı
    // davranıp fonksiyon yoksa (beklenmedik bir yükleme sırası/hata
    // durumu) sessizce hiçbir şey yapmıyoruz — GA script'i zaten
    // eklenmiş olur, sadece 'js'/'config' komutları kaybolur, bu da
    // "GA hiç çalışmasın" gibi güvenli bir başarısızlık şeklidir.
    if (typeof window.gtag === "function") {
      window.gtag("js", new Date());
      window.gtag("config", gaId);
    }
  };
})();
