/*
 * assets/js/okuma-araclari/okuma-ilerleme-cubugu.js
 *
 * Sayfanın en tepesinde sabitlenen (fixed), sayfa kaydırıldıkça soldan sağa
 * dolan 2px'lik minimalist ilerleme çubuğu. Yazı/proje detay sayfalarında
 * (_layouts/post.html, _layouts/project.html) ve GitHub'a hiç commit
 * edilmemiş ama gerçekten yayında olan Supabase yazılarında (icerik/
 * supabase-yazi.md) ve gizli ön izlemede (onizleme/index.md) kullanılır —
 * hepsi aynı "yazı içeriği" kavramına sahip olduğu için tek bir ortak script.
 *
 * CSP UYUMU: inline onclick/style HTML ATTRIBUTE'U yok; genişlik bilgisi
 * bir CSS custom property (--ilerleme) ile .style.setProperty() üzerinden
 * veriliyor — proje genelinde zaten kabul edilen bir desen (bkz.
 * _layouts/default.html tema anahtarı), inline style="" YAZILMIYOR, sadece
 * elementin var olan stil arayüzü JS'ten güncelleniyor; asıl görsel kural
 * (transform: scaleX(var(--ilerleme))) assets/style.css'te tanımlı.
 */
(function () {
  function kurulumYap() {
    const cubuk = document.createElement("div");
    cubuk.className = "okuma-ilerleme-cubugu";
    cubuk.setAttribute("aria-hidden", "true");
    const dolgu = document.createElement("div");
    dolgu.className = "okuma-ilerleme-cubugu-dolgu";
    cubuk.appendChild(dolgu);
    document.body.appendChild(cubuk);

    // Çubuk, makale gövdesinin kendisine göre değil TÜM sayfaya göre
    // ilerler — yorumlar/paylaş/atıf bloğu gibi altta gelen kısımlar da
    // dahil, çünkü kullanıcı sayfanın tamamını kaydırıyor ve çubuğun
    // "bitmesi" sayfanın gerçekten sonuna gelindiğinde olmalı.
    let ticking = false;

    function guncelle() {
      ticking = false;
      const kaydirilan = window.scrollY || document.documentElement.scrollTop || 0;
      const toplamYukseklik =
        (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight;

      // Sayfa kaydırılamayacak kadar kısaysa (ör. çok kısa bir yazı) çubuk
      // tamamen dolu görünsün — "eksik/bozuk" bir görünüm yerine.
      const oran = toplamYukseklik > 0 ? Math.min(1, Math.max(0, kaydirilan / toplamYukseklik)) : 1;
      dolgu.style.setProperty("--ilerleme", String(oran));
    }

    function istekPlanla() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(guncelle);
    }

    guncelle();
    window.addEventListener("scroll", istekPlanla, { passive: true });
    window.addEventListener("resize", istekPlanla);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kurulumYap);
  } else {
    kurulumYap();
  }
})();
