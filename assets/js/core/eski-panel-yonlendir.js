/*
 * assets/js/core/eski-panel-yonlendir.js
 *
 * ESKİ PANEL URL'LERİNİ BİRLEŞİK PANELE YÖNLENDİRİR.
 *
 * Panelin 7 ayrı sayfası (/panel/panel.html, admin.html, uye-ayarlari.html,
 * admin-guvenlik.html, github-yonetim.html, izleme-okuma-yonetim.html,
 * mesajlar.html) tek bir sayfada birleşti: /panel/dashboard.html. Eski
 * URL'ler SİLİNMEDİ — çünkü:
 *   - kullanıcıların yer imlerinde (bookmark) duruyor olabilir,
 *   - eski mesajların/e-postaların içinde link olarak geçmiş olabilir,
 *   - Supabase'in OAuth "redirect URL" listesinde kayıtlı olabilir,
 *   - sitenin kendi içinde gözden kaçmış bir link kalmış olabilir.
 * Silmek yerine her biri, dashboard'daki KARŞILIK GELEN SEKMEYE yönlendiren
 * ince bir sayfaya dönüştü. Böylece hiçbir eski link 404 vermiyor ve
 * kullanıcı her zaman tek panelde buluşuyor.
 *
 * NEDEN AYRI BİR DOSYA (inline <script> değil)? Sitenin CSP'si
 * (bkz. _layouts/default.html) inline script'e izin VERMİYOR —
 * "default-src 'self' https:" içinde 'unsafe-inline' yok. Bu yüzden
 * yönlendirme mantığı burada, hedef sekme ise HTML'deki
 * <div id="eski-panel-yonlendir" data-hedef="..."> elemanının
 * data-hedef özniteliğinde duruyor.
 *
 * QUERY + HASH KORUNUR: eski sayfaya bir soru işaretli parametre
 * (?hata=yetkisiz, ?konu=...) ya da bir hash (#icerikler, veya Supabase'in
 * OAuth dönüşünde eklediği #access_token=...) ile gelinmişse bunlar
 * OLDUĞU GİBİ dashboard'a taşınır. Sayfanın kendi "data-hedef" sekmesi
 * SADECE gelen adreste hiç hash yoksa kullanılır — yani token taşıyan bir
 * dönüş adresi asla ezilmez.
 *
 * location.replace() kullanılıyor (href DEĞİL): eski sayfa tarayıcı
 * geçmişine yazılmaz, böylece kullanıcı dashboard'dayken "geri" tuşuna
 * bastığında yönlendirme sayfasına düşüp sonsuz döngüye girmez.
 */
(function () {
  function yonlendir() {
    var el = document.getElementById("eski-panel-yonlendir");
    if (!el) return;

    var hedefHash = el.getAttribute("data-hedef") || "";
    var mevcutHash = window.location.hash || "";
    var query = window.location.search || "";

    // Gelen adreste hash varsa ONA saygı duy (OAuth token'ı, eski bölüm
    // anchor'ı vb.); yoksa bu sayfanın karşılığı olan sekmeye git.
    var hash = mevcutHash || hedefHash;

    // Bu site baseurl kullanmıyor (bkz. _config.yml) — auth-guard.js ve
    // mesajlar.js'teki yönlendirmelerle AYNI mutlak yol deseni.
    var hedef = "/panel/dashboard.html" + query + hash;

    // Güvenlik ağı: bir şekilde zaten dashboard'daysak tekrar yönlendirme.
    if (window.location.pathname.indexOf("/panel/dashboard.html") === 0) return;

    window.location.replace(hedef);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", yonlendir);
  } else {
    yonlendir();
  }
})();
