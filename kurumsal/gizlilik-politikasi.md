---
layout: default
title: Gizlilik Politikası ve KVKK Aydınlatma Metni
permalink: "/kurumsal/gizlilik-politikasi.html"
---

<h1>Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
<p class="meta">Son güncelleme: Eylül 2026 · Sürüm: 2026-09</p>

<div class="project-body">

<h2>1. Veri Sorumlusu</h2>
<p>
  6698 sayılı Kişisel Verilerin Korunması Kanunu ("<strong>KVKK</strong>")
  uyarınca, bu kişisel web sitesinin sahibi/işleteni olan
  <strong>Abdullah Eymen Asru</strong>, bireysel/kişisel kapasitesiyle veri
  sorumlusu sıfatıyla hareket etmektedir. Site, ticari bir kuruluş
  bünyesinde değil, şahsıma ait bir web sitesi olarak işletilmektedir.
  Kişisel verilerinize ilişkin sorularınız için
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>
<p>
  Bu site, 6698 sayılı Kanun'un 16. maddesi ve ilgili Kişisel Verileri
  Koruma Kurulu kararları uyarınca <strong>Veri Sorumluları Sicili
  (VERBİS)</strong>'ne kayıt yükümlülüğünden muaftır (yıllık işlem hacmi/
  çalışan sayısı eşiklerinin altında kalan, kişisel kapasiteyle işletilen
  bir web sitesi olması nedeniyle). VERBİS muafiyeti, aşağıda anlatılan
  aydınlatma yükümlülüğünü ve açık rıza/onay kayıtlarının (log)
  tutulması yükümlülüğünü ortadan kaldırmaz; bu metin ve üyelik
  sistemindeki onay kayıtları tam olarak bu amaçla tutulur.
</p>

<h2>2. Üyelik Sistemi Kapsamında İşlenen Kişisel Veriler</h2>
<p>
  Bu site, üyelik/giriş sistemi için <strong>Supabase</strong> (veritabanı ve
  kimlik doğrulama) altyapısını kullanır. Bir hesap oluşturduğunuzda
  (e-posta/şifre ile veya Google ile) aşağıdaki veriler işlenir:
</p>
<ul>
  <li><strong>Kimlik/iletişim verisi:</strong> ad soyad, e-posta adresi.</li>
  <li><strong>Kimlik doğrulama verisi:</strong> şifreniz — açık (okunabilir)
    biçimde hiçbir zaman saklanmaz; Supabase Auth altyapısı tarafından
    tuzlanarak (salted) <strong>tek yönlü bcrypt</strong> özet (hash)
    fonksiyonuyla geri döndürülemez şekilde saklanır. Google ile giriş
    yaptıysanız ayrıca Google'ın sağladığı temel profil bilgisi (ad,
    e-posta) işlenir.</li>
  <li><strong>Hesap işlem ve giriş kayıtları (log):</strong> hesabınıza
    giriş/çıkış zaman damgaları, e-posta doğrulama ve şifre sıfırlama
    işlemlerinin zaman damgaları, açık rıza/onay kayıtlarının (bkz. § 3 ve
    § 4) verildiği tarih ve onaylanan metin sürümü.</li>
  <li><strong>IP adresi:</strong> hesap güvenliğinin sağlanması (yetkisiz
    erişim/kötüye kullanım tespiti) amacıyla, kimlik doğrulama
    altyapısı (Supabase Auth) tarafından işlem bazında otomatik olarak
    işlenir.</li>
  <li><strong>Yetkilendirme verisi:</strong> hesabınızın rolü (Üye / Özel
    Üye / Yönetici) ve size atanmış özel içeriklere erişim kayıtları
    (hangi içeriğe ne zaman erişim verildiği, içeriği okuyup okumadığınız
    ve varsa erişiminizin sona ereceği tarih).</li>
  <li><strong>İki faktörlü doğrulama (2FA) verisi:</strong> bu özelliği
    kendi isteğinizle etkinleştirirseniz, Supabase Auth tarafından
    yönetilen bir TOTP (Authenticator uygulaması) gizli anahtarı
    saklanır. Bu anahtar tarafımızca görüntülenemez.</li>
  <li><strong>Teknik kayıt verisi:</strong> hesabın oluşturulma tarihi,
    profil güncelleme tarihi.</li>
</ul>

<h2>3. İşleme Amaçları ve Hukuki Sebep</h2>
<p>
  Kişisel verileriniz; üyelik hesabınızın açılması, sözleşmenin (üyelik
  ilişkisinin) kurulması ve ifası, size özel içeriklere erişim
  sağlanması ve hesap güvenliğinin (şifre sıfırlama, 2FA, IP tabanlı
  kötüye kullanım tespiti) sağlanması amaçlarıyla, KVKK'nın <strong>5/2-c
  maddesi ("bir sözleşmenin kurulması veya ifasıyla doğrudan doğru
  orantılı olması kaydıyla, sözleşmenin taraflarına ait kişisel verilerin
  işlenmesinin gerekli olması")</strong> hukuki sebebine dayanılarak
  işlenir. Bu işleme için ayrıca açık rızanıza ihtiyaç yoktur; kayıt
  olarak aşağıdaki § 5'te açıklanan Aydınlatma Metni'nin size
  ulaştırıldığı kabul edilir.
</p>
<p>
  <strong>Yurt dışına aktarım işlemi bu genel işleme amacından hukuken
  ayrıdır</strong> ve yalnızca aşağıdaki § 4'te açıklanan, ayrıca ve
  açıkça verdiğiniz rızaya dayanır — bkz. § 4 ve § 5.
</p>

<h2>4. Yurt Dışına Veri Aktarımı ve Açık Rıza</h2>
<p>
  Üyelik verilerinizin saklandığı veritabanı ve kimlik doğrulama
  altyapısı, <strong>Supabase Inc.</strong> tarafından işletilen ve
  <strong>Amazon Web Services (AWS) eu-central-1 bölgesinde, Frankfurt/
  Almanya'da</strong> barındırılan sunuculardır. Bu sunucular
  <strong>Türkiye dışında</strong> yer aldığından, kişisel verilerinizin
  bu altyapıya aktarılması ve orada işlenmesi, KVKK'nın <strong>9.
  maddesi</strong> uyarınca "yurt dışına veri aktarımı" kapsamına girer.
</p>
<p>
  Bu aktarım için KVKK m.9 kapsamındaki <strong>yeterlilik kararı</strong>
  veya <strong>uygun güvenceler</strong> istisnalarından biri tarafımca
  sağlanmadığı için, aktarım <strong>yalnızca açık rızanıza</strong>
  dayanılarak yapılmaktadır. Bu açık rıza:
</p>
<ul>
  <li>Kayıt formunda, Aydınlatma Metni'ni okuduğunuza dair bilgilendirme
    cümlesinden <strong>ayrı ve bağımsız</strong> bir onay kutusuyla
    alınır (paket/birleştirilmiş rıza değildir); bu kutu varsayılan
    olarak işaretsizdir ve siz işaretlemedikçe hesap oluşturma işlemi
    tamamlanmaz,</li>
  <li>Verildiği tarih ve onaylanan metin sürümü ile birlikte hesabınıza
    bağlı olarak ayrı kayıt altına alınır,</li>
  <li>Yurt dışı aktarımına konu olmayan diğer işleme faaliyetlerinden
    (§ 3) bağımsızdır; bu rızayı vermemeniz, üyelik altyapımızın teknik
    olarak yalnızca bu sunucular üzerinden çalışması nedeniyle üyeliğin
    kurulmasını engeller, ancak bu bir "paket rıza" değil, hizmetin
    teknik zorunluluğunun doğal bir sonucudur.</li>
</ul>
<p>
  Supabase, kendi güvenlik ve gizlilik politikaları çerçevesinde veri
  işleyen sıfatıyla hareket eden bağımsız bir üçüncü taraf hizmet
  sağlayıcıdır; detaylar için
  <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase Gizlilik Politikası</a>'na
  bakabilirsiniz. Özel içerik eklerindeki bazı büyük dosyalar, boyut
  sınırları nedeniyle Cloudflare R2 gibi harici bir depolama hizmetinde de
  barındırılabilir (bu hizmetin sunucu konumu, kullanılan bölgeye göre
  değişebilir); bu durumda ilgili dosyaya erişim, ayrıca paylaşılan bir
  bağlantı üzerinden sağlanır.
</p>
<p>
  Verileriniz, yasal zorunluluklar dışında üçüncü taraflarla
  paylaşılmaz, satılmaz veya pazarlama amacıyla kullanılmaz.
</p>

<h2>5. Aydınlatma Yükümlülüğü ile Açık Rızanın Ayrımı</h2>
<p>
  KVKK m.10 kapsamındaki <strong>aydınlatma yükümlülüğü</strong> ile KVKK
  m.9 kapsamındaki <strong>yurt dışına aktarım açık rızası</strong>,
  Kişisel Verileri Koruma Kurulu kararları uyarınca birbirinden ayrı
  hukuki araçlardır ve tek bir onay kutusunda birleştirilemez ("paket
  rıza" yasağı). Bu doğrultuda kayıt formunda:
</p>
<ul>
  <li>Bu metne (Aydınlatma Metni) bir bağlantı ve "kayıt olarak bu metni
    okuduğunuzu beyan edersiniz" bilgilendirmesi yer alır — bu, bir onay
    kutusu değildir, yalnızca aydınlatma yükümlülüğünün yerine
    getirildiğinin gösterilmesidir,</li>
  <li>Yurt dışına aktarım için ise, § 4'te açıklanan, önceden
    işaretlenmemiş, bağımsız ve ayrı bir açık rıza onay kutusu
    bulunur.</li>
</ul>

<h2>6. Veri Güvenliği</h2>
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

<h2>7. Haklarınız (KVKK Madde 11)</h2>
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

<h2>8. Diğer Veri Toplama Araçları</h2>
<p>
  Bu site, ziyaretçi istatistiklerini anlamak için <strong>Google
  Analytics</strong> kullanır. Bu araç; ülke, cihaz türü, tarayıcı ve genel
  kullanım davranışı gibi anonimleştirilmiş verileri toplar. Üyelik
  sisteminden bağımsız olarak, kişisel olarak sizi tanımlayacak bir veri
  bu araç üzerinden toplanmaz. <strong>Bu araç, aşağıdaki § 10'da açıklanan
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
  sayfasını ziyaret edebilirsiniz. <strong>Bu ağ da, aşağıdaki § 10'da
  açıklanan çerez onayı olmadan hiçbir şekilde çalışmaz.</strong>
</p>

<h2>9. Yorumlar</h2>
<p>
  Blog yazılarına ve proje sayfalarına yorum yapabilmek için
  <strong>GitHub hesabınla</strong> giriş yapman gerekir (Giscus altyapısı,
  GitHub Discussions üzerinden çalışır). Yaptığın yorumlar GitHub'ın kendi
  platformunda, GitHub hesabınla ilişkilendirilmiş şekilde saklanır — bu
  site ayrıca hiçbir yorum verisi tutmaz. Yorum widget'ının kendisi de
  aşağıdaki § 10'da açıklanan çerez onayı olmadan yüklenmez.
</p>

<h2>10. Çerezler ve Benzer Teknolojiler</h2>
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
        alan adlarından çerez kurabilir (bkz. § 8).
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

<h2>11. İletişim Formu</h2>
<p>
  İletişim sayfasındaki form Google Forms üzerinden çalışır, form
  yanıtları Google'ın altyapısında saklanır. Detaylar için
  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google'ın gizlilik politikasına</a>
  bakabilirsin.
</p>

<h2>12. Politika Değişiklikleri</h2>
<p>
  Bu metin güncellendiğinde sayfanın üstündeki "Sürüm" etiketi değişir.
  Üyelik sistemi, hangi sürüme (hem Aydınlatma Metni hem de yurt dışına
  aktarım açık rızası için ayrı ayrı) onay verdiğinizi kayıt altına
  alır; metnin ilgili bölümü önemli ölçüde değişirse, bir sonraki
  girişinizde panelinizde yeniden onay istenebilir.
</p>

<h2>Sorularınız için</h2>
<p>
  Bu politika hakkında sorularınız varsa <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>

</div>
