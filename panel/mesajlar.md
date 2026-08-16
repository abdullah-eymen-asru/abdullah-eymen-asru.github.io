---
layout: default
title: "Sohbet / Mesajlar"
yayinda: true
auth_css: true
mesajlar_css: true
permalink: "/panel/mesajlar.html"
---

<!--
  panel/mesajlar.md — /panel/mesajlar.html
  "Mesajlar" bölümü hem panel/panel.md (üye tarafı) hem panel/admin.md
  (admin gelen kutusu) içinden BURAYA, ortak/bağımsız bir sayfaya taşındı
  (istek: "sayfanın ortasına gelsin düzgün dursun"). Erişim SADECE giriş
  yapmış olmayı gerektirir (requireAuth({role: null}) — bkz.
  assets/js/mesajlar.js); hangi görünümün (üye sohbeti mi, admin gelen
  kutusu mu) basılacağına, giriş yapan kişinin rolüne göre ÇALIŞMA
  ZAMANINDA karar verilir. Asıl sohbet mantığı (mesaj gönderme, realtime,
  okundu işaretleme) hiç değişmedi — aynen assets/js/chat.js'teki
  wireUserChat()/wireAdminChat() kullanılıyor, sadece artık kendi
  sayfasında.
-->

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <section class="mesajlar-sayfa" id="mesajlar-sayfa">
    <div class="mesajlar-baslik">
      <h1>Sohbet / Mesajlar</h1>
      <p class="muted" id="mesajlar-aciklama">Yükleniyor...</p>
    </div>

    <div id="mesajlar-icerik"><p class="muted">Yükleniyor...</p></div>
  </section>
</div>

<script type="module" src="{{ '/assets/js/mesajlar.js' | relative_url }}"></script>
