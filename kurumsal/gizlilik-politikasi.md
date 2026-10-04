---
layout: default
title: Gizlilik Politikası ve KVKK Aydınlatma Metni
permalink: "/kurumsal/gizlilik-politikasi.html"
---

<h1>Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
<p class="meta">Son güncelleme: Ekim 2026 · Sürüm: v1.2</p>

<div class="project-body">

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
    işlemlerinin zaman damgaları, açık rıza/onay kayıtlarının (bkz. § 3 ve
    § 4) verildiği tarih ve onaylanan metin sürümü.</li>
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
    özelliğini kullanırsanız, gönderdiğiniz ve aldığınız mesajların
    içeriği, katılımcıları ve zaman damgaları saklanır (bkz. § 13).</li>
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
  olarak, aşağıdaki § 5'te açıklanan Aydınlatma Metni'nin size
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
  KVKK m.9 kapsamındaki <strong>yeterlilik kararı</strong> veya
  <strong>uygun güvenceler</strong> yollarından biri bu aktarım için
  tarafımca sağlanmadığından, aktarım <strong>yalnızca açık rızanıza</strong>
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
    (§ 3) bağımsızdır; bu rızayı vermemeniz, üyelik altyapısının teknik
    olarak yalnızca bu sunucular üzerinden çalışması nedeniyle üyeliğin
    kurulmasını engeller. Bu bir "paket rıza" değil, hizmetin teknik
    zorunluluğunun doğal bir sonucudur.</li>
</ul>
<p>
  Supabase, kendi güvenlik ve gizlilik politikaları çerçevesinde veri
  işleyen sıfatıyla hareket eden, bağımsız bir üçüncü taraf hizmet
  sağlayıcıdır; ayrıntılar için
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
    okuduğunuzu beyan edersiniz" bilgilendirmesi yer alır. Bu, bir onay
    kutusu değildir; yalnızca aydınlatma yükümlülüğünün yerine
    getirildiğini gösterir.</li>
  <li>Yurt dışına aktarım için ise, § 4'te açıklanan, önceden
    işaretlenmemiş, bağımsız ve ayrı bir açık rıza onay kutusu
    bulunur.</li>
</ul>

<h2>6. Veri Güvenliği</h2>
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

<h2>7. Haklarınız (KVKK Madde 11)</h2>
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

<h2>8. Diğer Veri Toplama Araçları</h2>
<p>
  <strong>Umami (çerezsiz istatistik):</strong> Bu site, ziyaretçi
  sayılarını ve hangi sayfaların okunduğunu anlamak için
  <strong>Umami</strong> (Umami Cloud, <code>cloud.umami.is</code>)
  istatistik aracını kullanır. Umami; ziyaret edilen sayfa, yönlendiren
  site, tarayıcı, işletim sistemi, cihaz türü, ekran boyutu ve yaklaşık
  ülke bilgisi gibi toplu istatistikleri derler. Umami'nin kendi
  açıklamalarına göre bu araç <strong>çerez kurmaz</strong> ve sizi kişisel
  olarak tanımlayan bir veri toplamaz; bu nedenle aşağıdaki § 10'daki çerez
  onayına bağlı değildir ve sayfa açıldığında doğrudan çalışır. Umami Cloud,
  bağımsız bir üçüncü taraf hizmet sağlayıcıdır; ayrıntılar için
  <a href="https://umami.is/privacy" target="_blank" rel="noopener noreferrer">Umami Gizlilik Politikası</a>'na
  bakabilirsiniz.
</p>
<p>
  <strong>Google Analytics:</strong> Bu site ayrıca, ziyaretçi
  istatistiklerini daha ayrıntılı anlamak için <strong>Google
  Analytics</strong> kullanır. Bu araç; ülke, cihaz türü, tarayıcı ve genel
  kullanım davranışı gibi anonimleştirilmiş verileri toplar. Üyelik
  sisteminden bağımsız olarak, sizi kişisel olarak tanımlayacak bir veri
  bu araç üzerinden toplanmaz. <strong>Bu araç, aşağıdaki § 10'da
  açıklanan çerez onayı olmadan hiçbir şekilde çalışmaz</strong>; açık
  rızanız olmadan Google Analytics çerezi kurulmaz.
</p>
<p>
  <strong>Google AdSense:</strong> Site, gelir elde etmek amacıyla
  <strong>Google AdSense</strong> reklam ağını da kullanabilir (bazı
  sayfalarda hiç reklam bulunmayabilir). Bu ağ etkinleştirildiğinde, Google
  ve reklam ortakları; siteyi ve internetteki diğer siteleri
  ziyaretlerinize göre ilginizi çekebilecek reklamlar göstermek için çerez
  ve benzer teknolojiler kullanabilir. Google'ın reklam çerezlerini nasıl
  kullandığı hakkında bilgi ve kişiselleştirilmiş reklamlardan çıkma
  (opt-out) seçeneği için
  <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google Reklam Ayarları</a>'nı
  ve <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">Google'ın Reklamcılıkta Kullandığı Teknolojiler</a>
  sayfasını ziyaret edebilirsiniz. <strong>Bu ağ da, aşağıdaki § 10'da
  açıklanan çerez onayı olmadan hiçbir şekilde çalışmaz.</strong>
</p>

<h2>9. Yorumlar</h2>
<p>
  Blog yazılarına ve proje sayfalarına yorum yapabilmek için
  <strong>GitHub hesabınızla</strong> giriş yapmanız gerekir (Giscus
  altyapısı, GitHub Discussions üzerinden çalışır). Yaptığınız yorumlar
  GitHub'ın kendi platformunda, GitHub hesabınızla ilişkilendirilmiş
  şekilde saklanır; bu site ayrıca hiçbir yorum verisi tutmaz. Yorum
  widget'ının kendisi de aşağıdaki § 10'da açıklanan çerez onayı olmadan
  yüklenmez.
</p>

<h2>10. Çerezler ve Benzer Teknolojiler</h2>
<p>
  Siteye ilk girişinizde, sayfanın altında bir <strong>çerez onay
  şeridi</strong> görürsünüz. Bu şerit, 6698 sayılı KVKK'nın çerez
  uygulamalarına ilişkin rehberi ve AB Genel Veri Koruma Tüzüğü (GDPR)
  ile uyumlu şekilde, <strong>zorunlu olmayan hiçbir çerezin açık rızanız
  olmadan kurulmamasını</strong> sağlar: sayfa ilk açıldığında zorunlu
  teknik depolama ve çerezsiz istatistik aracı (Umami, bkz. § 8) dışında
  hiçbir şey yüklenmez. Analitik, İşlevsel/Üçüncü Taraf ve Reklam
  kategorileri yalnızca "Tümünü Kabul Et" derseniz ya da "Ayarları
  Yönet" panelinden ilgili kategoriyi işaretleyip kaydederseniz
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
        GitHub İçerik Yönetimi panelindeki bağlantı ayarları.
        <code>localStorage</code> ile yalnızca kendi cihazınızda saklanır,
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
        Evet — reddederseniz hiç kurulmaz; daha önce kabul edip sonradan
        kapatırsanız, bu site kendi alan adında zaten oluşmuş bu çerezleri
        anında siler.
      </td>
    </tr>
    <tr>
      <td><strong>İşlevsel / Üçüncü Taraf</strong></td>
      <td>
        Blog ve proje sayfalarındaki Giscus (GitHub Discussions tabanlı)
        yorum widget'ının yüklenmesini sağlar; widget, giscus.app ve
        github.com alan adlarından çerez kurabilir.
      </td>
      <td>
        Evet — reddederseniz widget hiç yüklenmez (yerine "kabul et"
        butonu içeren bir yer tutucu görünür); sonradan kapatırsanız
        widget sayfadan kaldırılır. <strong>Önemli sınır:</strong>
        giscus.app ve github.com alan adlarında zaten oluşmuş çerezleri, bu
        site (farklı bir alan adı olduğu için tarayıcı güvenlik modeli
        gereği) SİLEMEZ; bunları kaldırmak isterseniz tarayıcınızın kendi
        "Site Verileri/Çerezler" ayarlarında o alan adlarını aramanız
        gerekir.
      </td>
    </tr>
    <tr>
      <td><strong>Reklam</strong></td>
      <td>
        Google AdSense; reklam gösterimi ve reklamların ilgi alanınıza
        göre kişiselleştirilmesi için google.com ve googlesyndication.com
        alan adlarından çerez kurabilir (bkz. § 8).
      </td>
      <td>
        Evet — reddederseniz reklam script'i hiç yüklenmez, sayfada hiçbir
        reklam (otomatik ya da yazı içi) görünmez; sonradan kapatırsanız
        mevcut reklamlar kaldırılır. <strong>Önemli sınır:</strong> Giscus
        ile aynı sebeple, google.com ve googlesyndication.com alan
        adlarında zaten oluşmuş çerezleri bu site SİLEMEZ; kaldırmak
        isterseniz tarayıcınızın kendi "Site Verileri/Çerezler"
        ayarlarında o alan adlarını aramanız ya da yukarıdaki Google
        Reklam Ayarları sayfasını kullanmanız gerekir.
      </td>
    </tr>
  </tbody>
</table>
</div>
<p>
  <strong>Not:</strong> Umami (bkz. § 8) çerez kullanmadığı için bu tabloda
  bir kategori olarak yer almaz ve onay şeridinden kapatılamaz. İstatistik
  aracını tamamen devre dışı bırakmak isterseniz, tarayıcınızın veya bir
  içerik engelleyici eklentinin <code>cloud.umami.is</code> alan adını
  engelleme özelliğini kullanabilirsiniz; site bu durumda da sorunsuz
  çalışmaya devam eder.
</p>
<p>
  Tercihinizi istediğiniz zaman, sayfanın altındaki
  <strong>"🍪 Çerez Ayarları"</strong> bağlantısıyla yeniden açabilir,
  önceden verdiğiniz bir izni geri çekebilir ya da o ana kadar
  reddettiğiniz bir kategoriyi sonradan kabul edebilirsiniz. Değişiklik
  anında uygulanır, sayfayı yenilemeniz gerekmez.
</p>

<h2>11. İletişim Formu</h2>
<p>
  İletişim sayfasındaki form Google Forms üzerinden çalışır; form
  yanıtları Google'ın altyapısında saklanır. Ayrıntılar için
  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google'ın gizlilik politikasına</a>
  bakabilirsiniz.
</p>

<h2>12. Altyapı ve Hizmet Sağlayıcılar</h2>
<p>
  Bu sitenin çalışması için aşağıdaki bağımsız üçüncü taraf hizmet
  sağlayıcılardan yararlanılır. Her biri kendi gizlilik politikasına tabidir:
</p>
<ul>
  <li><strong>Supabase</strong> — üyelik, kimlik doğrulama ve veritabanı
    (bkz. § 4).</li>
  <li><strong>Cloudflare</strong> — siteyi barındırma (Cloudflare Pages),
    sunucu tarafı işlemler (Cloudflare Workers) ve dosya depolama
    (Cloudflare R2). Cloudflare, sayfayı sunarken teknik gereklilik olarak IP
    adresi gibi bağlantı bilgilerini işleyebilir.</li>
  <li><strong>GitHub</strong> — sitenin kaynak deposu, yedek barındırma
    (GitHub Pages) ve yorum altyapısı (Giscus/GitHub Discussions).</li>
  <li><strong>Google</strong> — Google Analytics, Google AdSense ve Google
    Forms (bkz. § 8 ve § 11).</li>
  <li><strong>Umami Cloud</strong> — çerezsiz istatistik (bkz. § 8).</li>
  <li><strong>Substack</strong> — blog yazılarının bir kısmı Substack
    üzerinde yayımlanır; sitedeki ilgili bölüm bu yazıların herkese açık
    akışını (RSS) Cloudflare Worker üzerinden getirir. Substack sayfalarını
    ziyaret ettiğinizde Substack'in kendi gizlilik politikası geçerlidir.</li>
</ul>
<p>
  Barındırma ve ağ sağlayıcılarının bağlantı kayıtları üzerindeki erişimim
  ve kontrolüm sınırlıdır; bu kayıtlar ilgili sağlayıcının kendi politikasına
  göre tutulur.
</p>

<h2>13. Saklama ve Silme</h2>
<ul>
  <li><strong>Hesap ve profil verileri:</strong> hesabınız açık olduğu
    sürece saklanır; "Hesabımı Kalıcı Olarak Sil" ile anında ve geri
    alınamaz şekilde silinir (bkz. § 7).</li>
  <li><strong>Mesajlar:</strong> bir mesajı veya konuşmayı sildiğinizde, silme
    işlemi kayıtlı bir süre sonunda (yaklaşık 30 gün) kalıcı hale gelir.</li>
  <li><strong>Notlar ve dosyalar:</strong> siz sildiğinizde ya da hesabınızı
    sildiğinizde kaldırılır.</li>
  <li><strong>İletişim formu yanıtları:</strong> talebiniz hâlinde silinir.</li>
  <li><strong>Üçüncü taraf kayıtları</strong> (Google, GitHub, Cloudflare,
    Umami, Substack): ilgili sağlayıcının kendi saklama politikasına tabidir.</li>
</ul>

<h2>14. Başvuru Usulü ve Kurul'a Şikâyet</h2>
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

<h2>15. Politika Değişiklikleri</h2>
<p>
  Bu metin güncellendiğinde sayfanın üstündeki "Sürüm" etiketi değişir.
  Üyelik sistemi, hangi sürüme (hem Aydınlatma Metni hem de yurt dışına
  aktarım açık rızası için ayrı ayrı) onay verdiğinizi kayıt altına
  alır; metnin ilgili bölümü önemli ölçüde değişirse, bir sonraki
  girişinizde panelinizde yeniden onay istenebilir.
</p>

<h2>Sorularınız için</h2>
<p>
  Bu politika hakkında sorularınız varsa
  <a href="{{ '/kurumsal/iletisim.html' | relative_url }}">iletişim sayfası</a>
  üzerinden bana ulaşabilirsiniz.
</p>

</div>
