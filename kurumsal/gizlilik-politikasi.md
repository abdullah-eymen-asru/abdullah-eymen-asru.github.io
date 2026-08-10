---
layout: default
title: Gizlilik Politikası ve KVKK Aydınlatma Metni
permalink: "/kurumsal/gizlilik-politikasi.html"
---

<h1>Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
<p class="meta">Son güncelleme: Ağustos 2026 · Sürüm: 2026-08</p>

<div class="project-body">

<h2>1. Veri Sorumlusu</h2>
<p>
  6698 sayılı Kişisel Verilerin Korunması Kanunu ("<strong>KVKK</strong>")
  uyarınca, bu sitenin sahibi/işleteni olan <strong>Abdullah Eymen Asru</strong>
  veri sorumlusu sıfatıyla hareket etmektedir. Kişisel verilerinize ilişkin
  sorularınız için <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>

<h2>2. Üyelik Sistemi Kapsamında İşlenen Kişisel Veriler</h2>
<p>
  Bu site, üyelik/giriş sistemi için <strong>Supabase</strong> (veritabanı ve
  kimlik doğrulama) altyapısını kullanır. Bir hesap oluşturduğunuzda
  (e-posta/şifre ile veya Google ile) aşağıdaki veriler işlenir:
</p>
<ul>
  <li><strong>Kimlik/iletişim verisi:</strong> ad soyad, e-posta adresi.</li>
  <li><strong>Kimlik doğrulama verisi:</strong> şifreniz (Supabase tarafından
    tuzlanıp (salted) tek yönlü şifrelenerek — okunabilir biçimde
    saklanmaz), Google ile giriş yaptıysanız Google'ın sağladığı temel
    profil bilgisi (ad, e-posta).</li>
  <li><strong>Yetkilendirme verisi:</strong> hesabınızın rolü (Üye / Özel
    Üye / Yönetici) ve size atanmış özel içeriklere erişim kayıtları
    (hangi içeriğe ne zaman erişim verildiği, içeriği okuyup okumadığınız
    ve varsa erişiminizin sonaereceği tarih).</li>
  <li><strong>İki faktörlü doğrulama (2FA) verisi:</strong> bu özelliği
    kendi isteğinizle etkinleştirirseniz, Supabase Auth tarafından
    yönetilen bir TOTP (Authenticator uygulaması) gizli anahtarı
    saklanır. Bu anahtar tarafımızca görüntülenemez.</li>
  <li><strong>Teknik kayıt verisi:</strong> hesabın oluşturulma tarihi,
    profil güncelleme tarihi.</li>
</ul>

<h2>3. İşleme Amaçları ve Hukuki Sebep</h2>
<p>
  Kişisel verileriniz; üyelik hesabınızın oluşturulması ve yönetilmesi,
  size özel içeriklere erişim sağlanması, hesap güvenliğinin (şifre
  sıfırlama, 2FA) sunulması ve yasal yükümlülüklerin yerine getirilmesi
  amaçlarıyla, KVKK'nın 5. maddesinde belirtilen <em>"bir sözleşmenin
  kurulması veya ifasıyla doğrudan ilgili olması"</em> ve <em>"açık
  rızanızın bulunması"</em> hukuki sebeplerine dayanılarak işlenir. Kayıt
  formunda verdiğiniz KVKK Aydınlatma Metni ve Açık Rıza onayı, bu işlemenin
  temelini oluşturur; onay tarihiniz ve onayladığınız metin sürümü
  hesabınızla birlikte kayıt altına alınır.
</p>

<h2>4. Verilerin Saklandığı Yer ve Aktarım</h2>
<p>
  Üyelik verileriniz, bulut tabanlı bir veritabanı ve kimlik doğrulama
  hizmeti olan <strong>Supabase</strong> altyapısında saklanır. Supabase,
  kendi güvenlik ve gizlilik politikaları çerçevesinde veri işleyen
  (veri işleyen sıfatıyla) bağımsız bir üçüncü taraf hizmet sağlayıcıdır;
  detaylar için
  <a href="https://supabase.com/privacy" target="_blank">Supabase Gizlilik Politikası</a>'na
  bakabilirsiniz. Özel içerik eklerindeki bazı büyük dosyalar, boyut
  sınırları nedeniyle Cloudflare R2 gibi harici bir depolama hizmetinde de
  barındırılabilir; bu durumda ilgili dosyaya erişim, ayrıca paylaşılan
  bir bağlantı üzerinden sağlanır.
</p>
<p>
  Verileriniz, yasal zorunluluklar dışında üçüncü taraflarla
  paylaşılmaz, satılmaz veya pazarlama amacıyla kullanılmaz.
</p>

<h2>5. Veri Güvenliği</h2>
<p>
  Hesap verileriniz, satır bazlı erişim kontrolü (Row Level Security)
  ile korunur: her kullanıcı yalnızca kendi verisini görebilir/düzenleyebilir,
  yöneticiler dışında hiç kimse başka bir üyenin profiline veya rolüne
  müdahale edemez. Özel içeriklere erişim, yalnızca yönetici tarafından
  açıkça yetkilendirilmiş kullanıcılarla sınırlıdır ve bu yetki, yönetici
  tarafından belirlenen bir tarihte otomatik olarak sona erdirilebilir.
  Hesabınızı isterseniz iki faktörlü doğrulama (2FA) ile ek olarak
  koruma altına alabilirsiniz (bkz. Panelim &gt; İki Faktörlü Doğrulama).
</p>

<h2>6. Haklarınız (KVKK Madde 11)</h2>
<p>KVKK'nın 11. maddesi uyarınca aşağıdaki haklara sahipsiniz:</p>
<ul>
  <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
  <li>İşlenmişse buna ilişkin bilgi talep etme,</li>
  <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
  <li>Yurt içinde/yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
  <li>Eksik/yanlış işlenmişse düzeltilmesini isteme,</li>
  <li>KVKK'da öngörülen şartlar çerçevesinde silinmesini/yok edilmesini isteme,</li>
  <li>Düzeltme/silme işlemlerinin aktarılan üçüncü kişilere bildirilmesini isteme,</li>
  <li>Otomatik sistemlerle analiz sonucu aleyhinize bir sonucun ortaya
    çıkmasına itiraz etme,</li>
  <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın
    giderilmesini talep etme.</li>
</ul>
<p>
  Bu haklarınızı kullanmak için <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden başvurabilir, veya <strong>Panelim</strong> sayfasındaki
  <strong>"Hesabımı Kalıcı Olarak Sil"</strong> seçeneğiyle hesabınızı ve
  tüm ilişkili verilerinizi doğrudan, anında ve kalıcı olarak
  silebilirsiniz — bu işlem geri alınamaz ve profil bilgileriniz, özel
  içerik erişim kayıtlarınız dahil tüm verileriniz otomatik olarak yok edilir.
</p>

<h2>7. Diğer Veri Toplama Araçları</h2>
<p>
  Bu site, ziyaretçi istatistiklerini anlamak için <strong>Google
  Analytics</strong> kullanır. Bu araç; ülke, cihaz türü, tarayıcı ve genel
  kullanım davranışı gibi anonimleştirilmiş verileri toplar. Üyelik
  sisteminden bağımsız olarak, kişisel olarak sizi tanımlayacak bir veri
  bu araç üzerinden toplanmaz.
</p>

<h2>8. Yorumlar</h2>
<p>
  Blog yazılarına ve proje sayfalarına yorum yapabilmek için
  <strong>GitHub hesabınla</strong> giriş yapman gerekir (Giscus altyapısı,
  GitHub Discussions üzerinden çalışır). Yaptığın yorumlar GitHub'ın kendi
  platformunda, GitHub hesabınla ilişkilendirilmiş şekilde saklanır — bu
  site ayrıca hiçbir yorum verisi tutmaz.
</p>

<h2>9. Tema Tercihi ve Çerezler</h2>
<p>
  Açık/koyu tema seçimin ve dil uyarı şeridinin kapatılma durumu,
  tarayıcının <code>localStorage</code> özelliği ile yalnızca senin
  cihazında saklanır; hiçbir sunucuya gönderilmez ve üçüncü taraflarla
  paylaşılmaz. Üyelik oturumun (giriş durumun), Supabase Auth tarafından
  yönetilen bir oturum belirteci (token) ile tarayıcında tutulur.
</p>

<h2>10. İletişim Formu</h2>
<p>
  İletişim sayfasındaki form Google Forms üzerinden çalışır, form
  yanıtları Google'ın altyapısında saklanır. Detaylar için
  <a href="https://policies.google.com/privacy" target="_blank">Google'ın gizlilik politikasına</a>
  bakabilirsin.
</p>

<h2>11. Politika Değişiklikleri</h2>
<p>
  Bu metin güncellendiğinde sayfanın üstündeki "Sürüm" etiketi değişir.
  Üyelik sistemi, hangi sürüme onay verdiğinizi kayıt altına alır; metin
  önemli ölçüde değişirse, bir sonraki girişinizde panelinizde yeniden
  onay istenebilir.
</p>

<h2>Sorularınız için</h2>
<p>
  Bu politika hakkında sorularınız varsa <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>

</div>
