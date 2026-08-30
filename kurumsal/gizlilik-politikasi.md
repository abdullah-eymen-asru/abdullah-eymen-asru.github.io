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
  <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase Gizlilik Politikası</a>'na
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
  bu araç üzerinden toplanmaz. <strong>Bu araç, aşağıdaki § 9'da açıklanan
  çerez onayı olmadan hiçbir şekilde çalışmaz</strong> — açık rızanı
  vermeden Google Analytics çerezi kurulmaz.
</p>
<p>
  Site, gelir elde etmek amacıyla <strong>Google AdSense</strong> reklam
  ağını da kullanabilir (bazı sayfalarda hiç reklam bulunmayabilir). Bu
  ağ etkinleştirildiğinde, Google ve reklam ortakları; siteyi ve
  internetteki diğer siteleri ziyaretlerinize göre size ilginizi çekebilecek
  reklamlar göstermek için çerez ve benzer teknolojiler kullanabilir.
  Google'ın reklam çerezlerini nasıl kullandığı hakkında bilgi ve
  kişiselleştirilmiş reklamlardan çıkma (opt-out) seçeneği için
  <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google Reklam Ayarları</a>'nı
  ve <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">Google'ın Reklamcılıkta Kullandığı Teknolojiler</a>
  sayfasını ziyaret edebilirsiniz. <strong>Bu ağ da, aşağıdaki § 9'da
  açıklanan çerez onayı olmadan hiçbir şekilde çalışmaz.</strong>
</p>

<h2>8. Yorumlar</h2>
<p>
  Blog yazılarına ve proje sayfalarına yorum yapabilmek için
  <strong>GitHub hesabınla</strong> giriş yapman gerekir (Giscus altyapısı,
  GitHub Discussions üzerinden çalışır). Yaptığın yorumlar GitHub'ın kendi
  platformunda, GitHub hesabınla ilişkilendirilmiş şekilde saklanır — bu
  site ayrıca hiçbir yorum verisi tutmaz. Yorum widget'ının kendisi de
  aşağıdaki § 9'da açıklanan çerez onayı olmadan yüklenmez.
</p>

<h2>9. Çerezler ve Benzer Teknolojiler</h2>
<p>
  Siteye ilk girişinde, sayfanın altında bir <strong>çerez onay
  şeridi</strong> görürsün. Bu şerit, 6698 sayılı KVKK'nın çerez
  uygulamalarına ilişkin rehberi ve AB Genel Veri Koruma Tüzüğü (GDPR)
  ile uyumlu şekilde, <strong>zorunlu olmayan hiçbir çerezin açık rızan
  olmadan kurulmamasını</strong> sağlar: sayfa ilk açıldığında zorunlu
  teknik depolama dışında hiçbir şey yüklenmez; Analitik ve İşlevsel/
  Üçüncü Taraf kategorileri yalnızca sen "Tümünü Kabul Et" dersen ya da
  "Ayarları Yönet" panelinden ilgili kategoriyi işaretleyip kaydedersen
  etkinleşir.
</p>
<div class="tablo-kaydir">
<table>
  <thead>
    <tr><th>Kategori</th><th>Amaç</th><th>Kapatılabilir mi?</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Zorunlu</strong></td>
      <td>
        Oturum açma durumu (Supabase Auth token), açık/koyu tema tercihi,
        dil uyarı şeridinin kapatılma durumu ve (panel kullanıcıları için)
        GitHub İçerik Yönetimi panelindeki bağlantı ayarları —
        <code>localStorage</code> ile yalnızca kendi cihazında saklanır,
        hiçbir sunucuya gönderilmez, üçüncü taraflarla paylaşılmaz.
      </td>
      <td>Hayır — site bunlarsız çalışmaz.</td>
    </tr>
    <tr>
      <td><strong>Analitik</strong></td>
      <td>
        Google Analytics; ülke, cihaz türü, tarayıcı ve genel kullanım
        davranışı gibi anonimleştirilmiş istatistikleri toplamak için
        <code>_ga</code>, <code>_gid</code>, <code>_gat</code> önekli
        çerezleri kurar.
      </td>
      <td>
        Evet — reddedersen hiç kurulmaz; daha önce kabul ettiysen ve
        sonradan kapatırsan, bu site kendi alan adında zaten oluşmuş bu
        çerezleri anında siler.
      </td>
    </tr>
    <tr>
      <td><strong>İşlevsel / Üçüncü Taraf</strong></td>
      <td>
        Blog/proje sayfalarındaki Giscus (GitHub Discussions tabanlı)
        yorum widget'ının yüklenmesini sağlar; widget, giscus.app ve
        github.com alan adlarından çerez kurabilir.
      </td>
      <td>
        Evet — reddedersen widget hiç yüklenmez (yerine "kabul et"
        butonu içeren bir yer tutucu görünür); sonradan kapatırsan
        widget sayfadan kaldırılır. <strong>Önemli sınır:</strong>
        giscus.app/github.com alan adlarında zaten oluşmuş çerezleri, bu
        site (farklı bir alan adı olduğu için tarayıcı güvenlik modeli
        gereği) SİLEMEZ — bunları kaldırmak istersen tarayıcının kendi
        "Site Verileri/Çerezler" ayarlarından o alan adlarını aramanız
        gerekir.
      </td>
    </tr>
    <tr>
      <td><strong>Reklam</strong></td>
      <td>
        Google AdSense; reklam gösterimi ve reklamların ilgi alanınıza
        göre kişiselleştirilmesi için google.com/googlesyndication.com
        alan adlarından çerez kurabilir (bkz. § 7).
      </td>
      <td>
        Evet — reddedersen reklam script'i hiç yüklenmez, sayfada hiçbir
        reklam (otomatik ya da yazı-içi) görünmez; sonradan kapatırsan
        mevcut reklamlar kaldırılır. <strong>Önemli sınır:</strong> Giscus
        ile aynı sebeple, google.com/googlesyndication.com alan adlarında
        zaten oluşmuş çerezleri bu site SİLEMEZ — kaldırmak istersen
        tarayıcının kendi "Site Verileri/Çerezler" ayarlarından o alan
        adlarını aramanız ya da yukarıdaki Google Reklam Ayarları
        sayfasını kullanmanız gerekir.
      </td>
    </tr>
  </tbody>
</table>
</div>
<p>
  Tercihini istediğin zaman, sayfanın altındaki
  <strong>"🍪 Çerez Ayarları"</strong> bağlantısıyla yeniden açabilir,
  önceden verdiğin bir izni geri çekebilir ya da o ana kadar reddettiğin
  bir kategoriyi sonradan kabul edebilirsin — değişiklik anında uygulanır,
  sayfayı yenilemen gerekmez.
</p>

<h2>10. İletişim Formu</h2>
<p>
  İletişim sayfasındaki form Google Forms üzerinden çalışır, form
  yanıtları Google'ın altyapısında saklanır. Detaylar için
  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google'ın gizlilik politikasına</a>
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
