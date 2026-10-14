---
layout: default
title: KVKK Aydınlatma Metni
permalink: "/kurumsal/kvkk-aydinlatma-metni.html"
---

<h1>KVKK Aydınlatma Metni</h1>
<p class="meta">Son güncelleme: Ekim 2026 · Sürüm: <span data-hukuki-surum="kvkk">v1.1</span></p>

<div class="project-body">
<p>
  Bu metin, 6698 sayılı KVKK m.10 kapsamındaki <strong>aydınlatma yükümlülüğü</strong> içindir. Yurt dışına aktarım için
  alınan <a href="{{ '/kurumsal/acik-riza-metni.html' | relative_url }}">Açık Rıza Metni</a> ve çerez / istatistik / altyapı
  bilgileri için <a href="{{ '/kurumsal/gizlilik-politikasi.html' | relative_url }}">Gizlilik Politikası</a> ayrı belgelerdir.
  Hangi sürümü ne zaman onayladığınız hesabınıza bağlı olarak kayıt altına alınır (Panelim &gt; Onay geçmişim).
</p>

<h2>1. Veri Sorumlusu</h2>
<p>
  6698 sayılı Kişisel Verilerin Korunması Kanunu ("<strong>KVKK</strong>")
  uyarınca, bu kişisel web sitesinin sahibi ve işleteni olan
  <strong>Abdullah Eymen Asru</strong>, bireysel kapasitesiyle veri
  sorumlusu sıfatıyla hareket etmektedir. Site, ticari bir kuruluş
  bünyesinde değil, şahsıma ait bir web sitesi olarak işletilmektedir.
  Kişisel verilerinize ilişkin sorularınız için
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>
<p>
  Bu site, 6698 sayılı Kanun'un 16. maddesi ve ilgili Kişisel Verileri
  Koruma Kurulu kararları uyarınca <strong>Veri Sorumluları Sicili
  (VERBİS)</strong>'ne kayıt yükümlülüğünden muaftır (kişisel kapasiteyle
  işletilen, çalışan sayısı ve yıllık mali tablo eşiklerinin altında kalan
  bir web sitesi olması nedeniyle). VERBİS muafiyeti, aşağıda anlatılan
  aydınlatma yükümlülüğünü ve açık rıza/onay kayıtlarının (log)
  tutulması yükümlülüğünü ortadan kaldırmaz; bu metin ve üyelik
  sistemindeki onay kayıtları tam olarak bu amaçla tutulur.
</p>


<h2>2. Üyelik Sistemi Kapsamında İşlenen Kişisel Veriler</h2>
<p>
  Bu site, üyelik ve giriş sistemi için <strong>Supabase</strong> (veritabanı
  ve kimlik doğrulama) altyapısını kullanır. Bir hesap oluşturduğunuzda
  (e-posta/şifre ile veya Google ile) aşağıdaki veriler işlenir:
</p>
<ul>
  <li><strong>Kimlik ve iletişim verisi:</strong> ad soyad, e-posta adresi.</li>
  <li><strong>Kimlik doğrulama verisi:</strong> şifreniz hiçbir zaman açık
    (okunabilir) biçimde saklanmaz; Supabase Auth altyapısı tarafından
    tuzlanarak (salted), <strong>tek yönlü bcrypt</strong> özet (hash)
    fonksiyonuyla geri döndürülemez şekilde saklanır. Google ile giriş
    yaptıysanız ayrıca Google'ın sağladığı temel profil bilgisi (ad,
    e-posta) işlenir.</li>
  <li><strong>Hesap işlem ve giriş kayıtları (log):</strong> hesabınıza
    giriş ve çıkış zaman damgaları, e-posta doğrulama ve şifre sıfırlama
    işlemlerinin zaman damgaları, açık rıza/onay kayıtlarının (bkz. § 3 ve Açık Rıza Metni) verildiği tarih ve onaylanan metin sürümü.</li>
  <li><strong>IP adresi:</strong> hesap güvenliğinin sağlanması (yetkisiz
    erişim ve kötüye kullanım tespiti) amacıyla, kimlik doğrulama
    altyapısı (Supabase Auth) tarafından işlem bazında otomatik olarak
    işlenir.</li>
  <li><strong>Yetkilendirme verisi:</strong> hesabınızın rolü (Üye, Özel
    Üye, Editör, İçerik Sorumlusu, Yönetici veya Site Sahibi) ve size
    atanmış özel içeriklere erişim kayıtları (hangi içeriğe ne zaman erişim
    verildiği, içeriği okuyup okumadığınız ve varsa erişiminizin sona
    ereceği tarih).</li>
  <li><strong>İki faktörlü doğrulama (2FA) verisi:</strong> bu özelliği
    kendi isteğinizle etkinleştirirseniz, Supabase Auth tarafından
    yönetilen bir TOTP (Authenticator uygulaması) gizli anahtarı ve
    yedek kodlar saklanır. Bu anahtar tarafımdan görüntülenemez.</li>
  <li><strong>Mesajlaşma verisi:</strong> panelin Sohbet/Mesajlar
    özelliğini kullanırsanız, sohbetin katılımcıları, zaman damgaları ve
    <strong>uçtan uca şifrelenmiş</strong> mesaj içeriği ile konu başlığı
    saklanır. Mesajlar tarayıcınızda şifrelenir; veritabanına açık metin
    yazılmaz (bkz. § 6 ve § 7).</li>
  <li><strong>Not ve dosya verisi:</strong> yetkili olduğunuz modüllerde
    (not defteri, dosya arşivi) oluşturduğunuz notlar ve yüklediğiniz
    dosyalar, tarayıcınızda şifrelenmiş biçimde saklanır; dosya
    ekleri Cloudflare R2 üzerinde yalnızca şifrelenmiş (okunamaz) halde
    tutulur.</li>
  <li><strong>Teknik kayıt verisi:</strong> hesabın oluşturulma tarihi,
    profil güncelleme tarihi.</li>
</ul>


<h2>3. İşleme Amaçları ve Hukuki Sebep</h2>
<p>
  Kişisel verileriniz; üyelik hesabınızın açılması, sözleşmenin (üyelik
  ilişkisinin) kurulması ve ifası, size özel içeriklere erişim
  sağlanması ve hesap güvenliğinin (şifre sıfırlama, 2FA, IP tabanlı
  kötüye kullanım tespiti) sağlanması amaçlarıyla, KVKK'nın <strong>5/2-c
  maddesi ("bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya
  ilgili olması kaydıyla, sözleşmenin taraflarına ait kişisel verilerin
  işlenmesinin gerekli olması")</strong> hukuki sebebine dayanılarak
  işlenir. Bu işleme için ayrıca açık rızanıza ihtiyaç yoktur; kayıt
  olarak, işbu Aydınlatma Metni'nin size
  ulaştırıldığı kabul edilir.
</p>
<p>
  <strong>Yurt dışına aktarım işlemi bu genel işleme amacından hukuken
  ayrıdır</strong> ve yalnızca ayrı bir belge olan <a href="{{ '/kurumsal/acik-riza-metni.html' | relative_url }}">Açık Rıza Metni</a>'nde açıklanan, ayrıca ve açıkça verdiğiniz rızaya dayanır.
</p>


<h2>4. Veri Güvenliği</h2>
<p>
  Hesap verileriniz, satır bazlı erişim kontrolü (Row Level Security)
  ile korunur: her kullanıcı yalnızca kendi verisini görebilir ve
  düzenleyebilir; yöneticiler dışında hiç kimse başka bir üyenin profiline
  veya rolüne müdahale edemez. Özel içeriklere erişim, yalnızca yönetici
  tarafından açıkça yetkilendirilmiş kullanıcılarla sınırlıdır ve bu yetki,
  yönetici tarafından belirlenen bir tarihte otomatik olarak sona
  erdirilebilir. Hesabınızı isterseniz iki faktörlü doğrulama (2FA) ile ek
  olarak koruma altına alabilirsiniz (bkz. Panelim &gt; İki Faktörlü
  Doğrulama).
</p>
<p>
  <strong>Veri ihlali bildirimi:</strong> Kişisel verilerinizin hukuka
  aykırı olarak üçüncü kişilerce ele geçirilmesi durumunda, durumu
  öğrendiğim andan itibaren en kısa sürede ve KVKK m.12/5 uyarınca en geç
  72 saat içinde Kişisel Verileri Koruma Kurulu'na, ayrıca etkilenen
  üyelere kayıtlı e-posta adresleri üzerinden bildirim yaparım.
</p>


<h2>5. Haklarınız (KVKK Madde 11)</h2>
<p>KVKK'nın 11. maddesi uyarınca aşağıdaki haklara sahipsiniz:</p>
<ul>
  <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
  <li>İşlenmişse buna ilişkin bilgi talep etme,</li>
  <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
  <li>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
  <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
  <li>KVKK'da öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme,</li>
  <li>Düzeltme, silme ve yok etme işlemlerinin aktarılan üçüncü kişilere bildirilmesini isteme,</li>
  <li>İşlenen verilerin münhasıran otomatik sistemlerle analiz edilmesi
    suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,</li>
  <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın
    giderilmesini talep etme.</li>
</ul>
<p>
  Bu haklarınızı kullanmak için
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden başvurabilir ya da <strong>Panelim</strong> sayfasındaki
  <strong>"Hesabımı Kalıcı Olarak Sil"</strong> seçeneğiyle hesabınızı ve
  tüm ilişkili verilerinizi doğrudan, anında ve kalıcı olarak
  silebilirsiniz. Bu işlem geri alınamaz; profil bilgileriniz ve özel
  içerik erişim kayıtlarınız dahil tüm verileriniz otomatik olarak yok
  edilir.
</p>


<h2>6. Saklama ve Silme</h2>
<ul>
  <li><strong>Hesap ve profil verileri:</strong> hesabınız açık olduğu
    sürece saklanır; "Hesabımı Kalıcı Olarak Sil" ile anında ve geri
    alınamaz şekilde silinir (bkz. § 5).</li>
  <li><strong>Mesajlar:</strong> “Sadece benden sil” yalnızca kendi görünümünüzden
    kaldırır; “Herkesten sil” (yalnızca kendi mesajınız için) mesajı tüm taraflar
    için veritabanından siler. Bir sohbeti kapattığınızda önce çöp kutusuna taşınır;
    çöp kutusundan “kalıcı sil” dediğinizde şifre anahtarınız yok edilir. Sohbetin
    tüm tarafları kalıcı sildiğinde mesajlar, anahtar zarfları ve ilişkili izler
    veritabanından tamamen silinir; tüm tarafların çöpe attığı sohbetler en geç
    yaklaşık 30 gün sonra otomatik olarak silinir.</li>
  <li><strong>Notlar ve dosyalar:</strong> siz sildiğinizde ya da hesabınızı
    sildiğinizde kaldırılır.</li>
  <li><strong>İletişim formu yanıtları:</strong> talebiniz hâlinde silinir.</li>
  <li><strong>Üçüncü taraf kayıtları</strong> (Google, GitHub, Cloudflare,
    Umami, Substack): ilgili sağlayıcının kendi saklama politikasına tabidir.</li>
</ul>


<h2>7. Mesajlaşma Modülünün Amacı, Hukuki Sebebi ve Yedekleme</h2>
<p>
  Sohbet/Mesajlar modülü; <strong>teknik destek, operasyonel iletişim, sorun çözümü
  ve yönetim–üye koordinasyonu</strong> amacıyla sunulur; genel amaçlı bir sosyal
  mesajlaşma hizmeti değildir. Mesajlar uçtan uca şifrelidir: içerik, sohbete erişimi olan
  taraflarca çözülebilecek şekilde tarayıcıda şifrelenir ve sunucuda yalnızca şifreli
  biçimde (okunamaz halde) tutulur.
</p>
<ul>
  <li><strong>Hukuki sebep:</strong> sistem güvenliğinin sağlanması ve olası
    uyuşmazlıkların çözümü bakımından veri sorumlusunun
    <strong>meşru menfaati (KVKK m.5/2-f)</strong> ile bir hakkın tesisi, kullanılması
    veya korunması için veri işlemenin zorunlu olması
    (<strong>KVKK m.5/2-e</strong>); hizmetin sunulması için gerektiği ölçüde sözleşmenin
    ifası (m.5/2-c).</li>
  <li><strong>Yedekleme:</strong> ilgili mesajlaşmalar; sistem güvenliği, uyuşmazlık
    çözümü ve periyodik <strong>sistem felaket yedeklemeleri</strong> sırasında
    <strong>şifreli/güvenli biçimde</strong> yedek kapsamına alınabilir. Yedekte mesaj
    içeriği şifreli kalır; yedeği alan kişi şifreli paketi çözemez.</li>
  <li><strong>Erişim:</strong> bir sohbete yalnızca o sohbetin tarafları ve hedef yönetici
    seçilmediyse yetkili yöneticiler/site sahibi erişebilir. Özel nitelikli kişisel veri
    ve gereksiz bilgi paylaşmamanızı öneririz.</li>
  <li><strong>Haklarınız:</strong> § 5'teki haklarınızı bu veriler bakımından da
    kullanabilirsiniz; silme talepleriniz yasal saklama yükümlülükleri ve haklı
    menfaatler saklı kalmak üzere değerlendirilir.</li>
</ul>


<h2>8. Başvuru Usulü ve Kurul'a Şikâyet</h2>
<p>
  KVKK m.11 kapsamındaki taleplerinizi
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden iletebilirsiniz. Başvurunuz, talebin niteliğine göre en kısa
  sürede ve en geç <strong>30 gün</strong> içinde sonuçlandırılır. Başvurunuza
  verilen yanıtı yetersiz bulursanız ya da süresinde yanıt alamazsanız,
  KVKK m.14 uyarınca
  <a href="https://www.kvkk.gov.tr" target="_blank" rel="noopener noreferrer">Kişisel Verileri Koruma Kurulu</a>'na
  şikâyette bulunma hakkınız saklıdır.
</p>


<h2>Diğer Metinler</h2>
<p>
  <a href="{{ '/kurumsal/acik-riza-metni.html' | relative_url }}">Açık Rıza Metni</a> ·
  <a href="{{ '/kurumsal/gizlilik-politikasi.html' | relative_url }}">Gizlilik Politikası</a> ·
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">İletişim</a>
</p>

</div>

<script type="module" src="{{ '/assets/js/kurumsal/hukuki-surum.js' | relative_url }}"></script>
