---
layout: default
title: "Admin Güvenliği"
yayinda: true
auth_css: true
permalink: "/panel/admin-guvenlik.html"
uye_ayarlari_css: true
---

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>Admin Güvenliği</h1>
  <p class="muted">
    Buradan başka bir admin'i şüpheli bir durumda anında "askıya" alabilir
    (tüm oturumları sonlanır), açık vakalara oy kullanabilir ve (sadece
    Site Sahibi ise) bir vakayı tek başına kesin karara bağlayabilirsin.
    Kimse kalıcı olarak düşürülmeden önce ya çoğunluk oylaması ya Site
    Sahibi kararı ya da (kimse karar vermezse) otomatik süre dolumu
    gerekir — bkz. aşağıdaki yardım metni.
  </p>

  <!-- BUG FİX (eksik geri dönüş linki): bu sayfaya SADECE admin.md'deki
       "🛡️ Admin Güvenliği" sekmesinden geliniyordu ve buradan admin.md'ye
       dönmenin tek yolu tarayıcının GERİ tuşuydu — panel/uye-ayarlari.md'de
       zaten var olan "← Admin Paneline Dön" linkinin AYNISI burada da
       eksikti. Tutarlılık ve daha hızlı/"sekme gibi" gezinme için eklendi
       (bkz. assets/css/uye-ayarlari.css -> .uya-geri-btn, bu sayfa zaten
       uye_ayarlari_css: true ile bu stil dosyasını yüklüyor). -->
  <a href="{{ '/panel/admin.html' | relative_url }}" class="btn-secondary uya-geri-btn">← Admin Paneline Dön</a>

  <div class="panel-grid">

    <section class="panel-section">
      <h2>Adminler / Site Sahibi</h2>
      <div id="ag-admin-listesi"><p class="muted">Yükleniyor...</p></div>
    </section>

    <section class="panel-section">
      <h2>🔴 Bir Admin'i Askıya Al ("Acil Fren")</h2>
      <p class="muted">
        Bu işlem hedefin TÜM oturumlarını anında sonlandırır ve hesabını
        geçici olarak kilitler. Kalıcı bir sonuç DEĞİLDİR — sadece bir
        soruşturma penceresi (varsayılan 72 saat) açar.
      </p>
      <form id="ag-askiya-al-form" novalidate>
        <div class="form-field">
          <label for="ag-hedef-admin">Askıya alınacak admin</label>
          <select id="ag-hedef-admin" required></select>
        </div>
        <div class="form-field">
          <label for="ag-sebep">Sebep (denetim kaydına geçer)</label>
          <textarea id="ag-sebep" rows="3" required minlength="5"></textarea>
        </div>
        <button type="submit" class="btn-danger">Askıya Al</button>
      </form>
      <div id="ag-askiya-al-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section">
      <h2>Denetim Vakaları</h2>
      <p class="muted">
        Vaka geçmişi sayfalanarak gösterilir. Kalıcı silme sadece Site
        Sahibi'ne (owner) açıktır ve her vaka tek tek, geri alınamaz şekilde
        silinir — açık ("askıda") vakalar önce sonuçlanmadan silinemez.
      </p>
      <div id="ag-vaka-listesi"><p class="muted">Yükleniyor...</p></div>
      <div class="uya-sayfalama" id="ag-vaka-sayfalama"></div>
    </section>

    <section class="panel-section">
      <h2>Nasıl Karara Bağlanır?</h2>
      <ul>
        <li><strong>Çoğunluk oylaması:</strong> hedef hariç, askıda olmayan tüm admin/Site Sahibi'nin basit çoğunluğu "Kalıcı Düşür" ya da "Geri Aç" derse vaka anında o yönde kapanır.</li>
        <li><strong>Site Sahibi kararı:</strong> bir Site Sahibi varsa, oylama beklemeden tek başına vakayı kapatabilir.</li>
        <li><strong>Süre dolumu (fail-safe):</strong> karar süresine kadar kimse karar veremezse hesap OTOMATİK olarak geri açılır — varsayılan her zaman güvenli taraftadır, kimse kalıcı olarak düşürülmüş olmaz.</li>
        <li><strong>Sadece 2 admin varsa ve Site Sahibi yoksa:</strong> kalan tek admin'in kendi oyu "çoğunluk" sayılmaz (yetki gasbını önlemek için bilerek engellenmiştir) — vaka ancak bir Site Sahibi atanıp karar verirse ya da süre dolarsa kapanır.</li>
      </ul>
    </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/admin-guvenlik.js' | relative_url }}"></script>
