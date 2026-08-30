---
layout: default
title: İletişim
permalink: "/kurumsal/iletisim.html"
---

<h1>İletişim</h1>
<p>Aşağıdaki formu doldurarak bana mesaj gönderebilirsin.</p>

<p class="format-hint">
  Form Google'ın kendi sayfası olduğu için her zaman açık renkte görünür —
  bu Google'ın kendi tasarımı, sitenin teması bunu değiştiremiyor.
</p>

<!--
  BURAYA Google Forms'tan aldığın <iframe> kodunu yapıştır.
  Google Forms > Gönder (Send) > <> ikonu > kodu kopyala.

  YÜKSEKLİK NOTU: height değeri artık sabit bir sayı olarak BURADA değil,
  assets/style.css'teki ".gform-iframe" kuralında — çünkü doğru yükseklik
  cihaza göre değişiyor: Google Forms mobilde tüm alanları TEK SÜTUNDA alt
  alta dizdiği için form masaüstünden çok daha uzun render ediliyor. Sabit
  tek bir height (ör. 800) formun boyu ondan uzunsa iframe'in KENDİ İÇİNDE
  ikinci bir kaydırma çubuğu (sayfa kaydırması + iframe içi kaydırma —
  "çifte kaydırma") çıkarıyordu. style.css'teki masaüstü/mobil değerleri,
  BU formun soru sayısına göre tahmini/geniş tutulmuş güvenli varsayılanlar
  — formuna soru ekleyip çıkardıkça, ya da hâlâ iframe içi kaydırma
  görürsen, assets/style.css içindeki ".gform-iframe { height: ... }" ve
  "@media (max-width: 640px) { .gform-iframe { height: ... } }"
  satırlarındaki iki sayıyı kendi formunla karşılaştırıp artırman/azaltman
  gerekebilir (bilgisayarında F12 > cihaz araç çubuğuyla mobil önizleme
  yaparak formun gerçekte ne kadar yer kapladığını görebilirsin).
-->
<div class="gform-wrap">
  <iframe
    class="gform-iframe"
    src="https://docs.google.com/forms/d/e/1FAIpQLSfAwtYtnRfCk0k1F4g6VXULi53fsQn4hw62IeBobQajiqJx8g/viewform?embedded=true"
    width="100%"
    frameborder="0">
    Yükleniyor…
  </iframe>
</div>
