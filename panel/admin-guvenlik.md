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

    <!-- SADECE owner (Site Sahibi) görür/kullanır — bkz. admin-guvenlik.js
         init() içindeki ".sadece-owner" gizleme mantığı (admin/manager bu
         bölümü hiç görmez). Gerçek/bağlayıcı kısıt her zaman veritabanında
         (migration 0031_uyelik_kayitlarini_ac_kapat.sql, owner_kayitlari_ac_kapat
         RPC'si + trg_kayitlar_acik_sadece_owner trigger'ı) — bu bölüm sadece
         arayüz katmanıdır. -->
    <section class="panel-section sadece-owner">
      <h2>👥 Üyelik Kayıtları</h2>
      <p class="muted">
        Kapatırsan veri tabanına yeni bir üye kaydı düşmez — Google ile de,
        normal (e-posta/şifre) ile de kimse kayıt olamaz, kayıt sayfası
        yerine bir uyarı ekranı görür. Daha önce hesap oluşturmuş kimseler
        bundan ETKİLENMEZ, girişe devam edebilirler. Bu yetki sadece Site
        Sahibi'ne (owner) aittir, admin bile değiştiremez.
      </p>
      <p>
        Şu an durum:
        <strong id="ag-kayitlar-durum">Yükleniyor...</strong>
      </p>
      <div class="csp-flex-gap10">
        <button id="ag-kayitlari-kapat-btn" type="button" class="btn-danger csp-w-auto">Kayıtları Kapat</button>
        <button id="ag-kayitlari-ac-btn" type="button" class="btn-primary csp-w-auto">Kayıtları Aç</button>
      </div>
      <div id="ag-kayitlar-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section sadece-owner">
      <h2>🚨 Kilit Modu (Acil Durdurma)</h2>
      <p class="muted">
        Açtığında Site Sahibi (sen) dışında hiçbir rol (admin/manager/editor)
        içerik ekleyemez, düzenleyemez ya da silemez — panel açılıp mevcut
        içerik görüntülenebilir, sadece yazma işlemleri Worker tarafında
        reddedilir. Bir hesabın ele geçirildiğinden şüphelendiğinde, tek tek
        rolleri değiştirmek yerine tüm yazma yetkisini anında durdurmak
        içindir. Bu yetki sadece Site Sahibi'ne aittir.
      </p>
      <p>
        Şu an durum:
        <strong id="ag-kilit-durum">Yükleniyor...</strong>
      </p>
      <div class="csp-flex-gap10">
        <button id="ag-kilit-ac-btn" type="button" class="btn-danger csp-w-auto">🔒 Kilit Modunu Aç — Yazmayı Durdur</button>
        <button id="ag-kilit-kapat-btn" type="button" class="btn-primary csp-w-auto">🔓 Kilit Modunu Kapat — Yazmaya İzin Ver</button>
      </div>
      <div id="ag-kilit-message" class="auth-message" hidden></div>
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

    <section class="panel-section sadece-owner">
      <h2>📜 Denetim Kaydı (Audit Log)</h2>
      <p class="muted">
        github-yonetim panelinin arkasındaki Worker'ın verdiği her yazma
        (ekleme/düzenleme/silme) denemesinin izi — kim, ne zaman, hangi
        dosyayı, ne sonuçla (izin verildi/reddedildi). Depolamayı
        doldurmasın diye tek tek kayıt ya da belirli bir tarihten eskisinin
        tamamı silinebilir; bu SADECE Site Sahibi'ne açıktır, admin bile
        göremez/silemez.
      </p>
      <div class="csp-flex-gap10">
        <label for="ag-denetim-filtre" class="muted">Göster:</label>
        <select id="ag-denetim-filtre">
          <option value="hepsi">Hepsi</option>
          <option value="reddedildi">Sadece reddedilenler</option>
          <option value="izin_verildi">Sadece izin verilenler</option>
        </select>
        <button id="ag-denetim-yenile-btn" type="button" class="btn-secondary csp-w-auto">🔄 Yenile</button>
      </div>
      <div id="ag-denetim-listesi"><p class="muted">Yükleniyor...</p></div>
      <div class="uya-sayfalama" id="ag-denetim-sayfalama"></div>
      <div class="csp-flex-gap10 csp-mt-14">
        <button id="ag-denetim-30gun-temizle-btn" type="button" class="btn-secondary csp-w-auto">🧹 30 Günden Eskisini Sil</button>
        <button id="ag-denetim-hepsi-temizle-btn" type="button" class="btn-danger csp-w-auto">🗑️ Tüm Kayıtları Sil</button>
      </div>
      <div id="ag-denetim-message" class="auth-message" hidden></div>
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
