/*
 * assets/js/auth/sifre-goster.js
 *
 * Sitedeki HER type="password" alanına (giriş/kayıt şifresi, şifre
 * güncelleme, panel > şifre değiştir, panel > GitHub Yönetimi > PAT
 * token'ı vb.) otomatik olarak bir "göz" ikonu ekler. Tıklanınca alanın
 * type'ı password <-> text arasında değişir, böylece kullanıcı yazdığı
 * değerin doğru olduğunu (yanlış tuşa basmadığını, klavye düzeni farklı
 * çıkmadığını vb.) kopyalamadan/başka bir yere yapıştırmadan görebilir.
 *
 * _layouts/default.html içine TEK SEFER eklenir; sayfaya özel her form
 * için ayrı ayrı bağlanmasına gerek yok — hangi sayfada kaç tane şifre
 * alanı olursa olsun otomatik yakalanır, ileride eklenecek yeni bir şifre
 * alanı için de bu dosyada değişiklik gerekmez.
 */
(function () {
  // Basit, tek renkli (currentColor) çizgi ikonlar — tema (açık/koyu)
  // rengine otomatik uyması için CSS'te renk `color` ile veriliyor, ikonlar
  // içeride "currentColor" kullanıyor.
  const GOZ_ACIK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  const GOZ_KAPALI_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3l18 18"/>' +
    '<path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c7 0 10.5 7 10.5 7a13.4 13.4 0 0 1-3.1 3.9M6.5 6.6C3.4 8.6 1.5 12 1.5 12s3.5 7 10.5 7a10.4 10.4 0 0 0 4.2-.9"/>' +
    '<path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9"/></svg>';

  function sifreAlaniniSar(girdi) {
    if (girdi.dataset.sifreGosterHazir) return; // aynı alan iki kez sarılmasın
    girdi.dataset.sifreGosterHazir = "1";

    const sarmalayici = document.createElement("div");
    sarmalayici.className = "sifre-goster-sarmalayici";
    girdi.insertAdjacentElement("beforebegin", sarmalayici);
    sarmalayici.appendChild(girdi);

    const buton = document.createElement("button");
    buton.type = "button";
    buton.className = "sifre-goster-btn";
    buton.setAttribute("aria-label", "Şifreyi göster");
    buton.setAttribute("aria-pressed", "false");
    buton.tabIndex = -1; // Tab sırası şifre alanından bir sonraki alana atlasın; fare/dokunma ile kullanılır.
    buton.innerHTML = GOZ_ACIK_SVG;
    sarmalayici.appendChild(buton);

    buton.addEventListener("click", () => {
      const suAnGosteriliyor = girdi.type === "text";
      girdi.type = suAnGosteriliyor ? "password" : "text";
      const yeniGosterimDurumu = !suAnGosteriliyor;
      buton.setAttribute("aria-pressed", String(yeniGosterimDurumu));
      buton.setAttribute("aria-label", yeniGosterimDurumu ? "Şifreyi gizle" : "Şifreyi göster");
      buton.innerHTML = yeniGosterimDurumu ? GOZ_KAPALI_SVG : GOZ_ACIK_SVG;
      girdi.focus({ preventScroll: true });
    });
  }

  function tumSifreAlanlariniSar() {
    document.querySelectorAll('input[type="password"]').forEach(sifreAlaniniSar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tumSifreAlanlariniSar);
  } else {
    tumSifreAlanlariniSar();
  }
})();
