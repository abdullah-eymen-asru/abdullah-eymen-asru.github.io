/**
 * assets/js/okuma-araclari/rapor-yazdir.js
 * -----------------------------------------------------------------------
 * "🖨️ Rapor Olarak Yazdır / PDF Kaydet" butonunu (bkz. _layouts/post.html,
 * _layouts/project.html) window.print()'e bağlar. Neden inline onclick
 * DEĞİL de harici bir script: bu site CSP'yi hash tabanlı (unsafe-inline
 * KAPALI) çalıştırıyor — bkz. _plugins/csp_hash_enjekte.rb dosya başı
 * notu — ve inline onclick="..." özniteliği o hash mekanizmasının
 * kapsamı DIŞINDA kalıp CSP tarafından engellenir. addEventListener
 * kullanan sıradan bir dış script bu kısıtlamaya hiç takılmaz.
 *
 * Bu script sadece window.print()'i çağırır; hiçbir kullanıcı/veritabanı
 * verisi taşımaz, hiçbir ağ isteği atmaz.
 */
(function () {
  var buton = document.getElementById("rapor-yazdir-btn");
  if (!buton) return;
  buton.addEventListener("click", function () {
    window.print();
  });
})();
