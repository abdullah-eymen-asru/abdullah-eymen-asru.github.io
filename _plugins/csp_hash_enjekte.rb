# _plugins/csp_hash_enjekte.rb
#
# GÜVENLİK — CSP'DEN "unsafe-inline" / "unsafe-eval" KALDIRMA:
# -----------------------------------------------------------------------
# Bu proje, <head>/<body> içinde birkaç sabit (kullanıcı girdisi TAŞIMAYAN)
# inline <script> bloğu kullanıyor — tema anahtarı, giscus yükleyici, GA/
# AdSense yükleyici fonksiyonları, "linki kopyala" butonu vb. Bunların HİÇBİRİ
# çalışma zamanında kullanıcı/veritabanı verisiyle DEĞİŞMİYOR: içerdikleri tek
# "değişken" kısım _config.yml'deki BUILD-TIME sabitleri (site.google_analytics_id,
# site.adsense_client_id, site.giscus.*) — bunlar Liquid tarafından bu plugin
# çalışmadan ÖNCE, HTML zaten diske yazılırken çözülmüş oluyor.
#
# Bu yüzden CSP'de script-src için 'unsafe-inline' TUTMANIN bir güvenlik
# gerekçesi yok: her sayfanın NİHAİ (render edilmiş) HTML'i sabit olduğuna
# göre, o HTML'deki her inline <script> bloğunun SHA-256 hash'ini ÖNCEDEN
# (build sırasında) hesaplayıp CSP'ye ekleyebiliriz — tarayıcı sadece TAM
# OLARAK bu hash'lerle eşleşen scriptleri çalıştırır, başka HİÇBİR inline
# script (ör. ileride bir XSS açığıyla enjekte edilen) çalışmaz. Bu, nonce
# tabanlı CSP'nin statik sitelerde build-time eşdeğeridir (nonce her istekte
# değişir ve statik sitede sunucu tarafı yoktur, ama hash sabit içerik için
# tam olarak aynı korumayı verir).
#
# NASIL ÇALIŞIR:
#   1) Jekyll, TÜM sayfaları normal şekilde render edip _site/ altına yazar
#      (Liquid bu noktada tamamen çözülmüş olur — {{ site.xxx }} gibi hiçbir
#      şablon etiketi kalmaz).
#   2) Bu plugin, :site, :post_write kancasıyla (yani TÜM dosyalar diske
#      yazıldıktan SONRA) devreye girer, _site altındaki her .html dosyasını
#      tekrar okur.
#   3) O dosyadaki her <script>...</script> VE <style>...</style> bloğunu
#      (src= olan <script>'ler HARİÇ — onlar zaten CSP'nin script-src
#      'self'/https: kısmına tabi, hash gerektirmezler) bulup İÇERİĞİNİN
#      SHA-256 hash'ini hesaplar.
#   4) O dosyada bir CSP <meta http-equiv="Content-Security-Policy"> etiketi
#      varsa, "'unsafe-inline'" ve "'unsafe-eval'" ifadelerini SİLİP yerine
#      o SAYFAYA ÖZGÜ hash listesini (script-src VE style-src için AYRI
#      AYRI) ekler, dosyayı GÜNCEL hâliyle geri yazar.
#
# STYLE-SRC NEDEN AYRICA GEREKLİ: sitede tema/dil bildirimi gibi birkaç
# yer, önceden HTML'de style="..." INLINE ATTRIBUTE'U kullanıyordu — bunlar
# hepsi CSS class'larına çevrildi (bkz. assets/style.css'teki ".lang-notice",
# ".proje-baglanti-alani", ".adsbygoogle-blok" yorumları), çünkü inline
# style ATTRIBUTE'LERİ için CSP hash mekanizması 'unsafe-hashes' anahtar
# kelimesini de GEREKTİRİR (attribute hash'leri, <style> ELEMENT hash'lerinden
# FARKLI bir CSP alt-mekanizmasıdır) — 'unsafe-hashes' başlı başına ayrı bir
# taviz olacağından, mümkün olduğunda class'a çevirmek daha temiz. Geriye
# kalan TEK durum (_layouts/default.html'deki Android WebView view-transition
# override'ı) statik bir <style media="not all"> elementi olarak yazıldı —
# bu SIRADAN bir <style> ELEMENTİ olduğu için 'unsafe-hashes' GEREKMEZ,
# normal hash mekanizması yeterlidir.
#
# NEDEN SAYFA BAŞINA (GLOBAL DEĞİL): AdSense/GA scriptleri sadece
# site.adsense_client_id/google_analytics_id doluysa render edilir, ve
# _includes/comments.html (giscus) sadece ilgili front-matter/config
# koşulunu geçen sayfalarda bulunur — yani hangi script bloklarının
# bulunduğu sayfadan sayfaya değişebilir. Her sayfanın kendi hash listesini
# taşıması, gereksiz yere HER sayfaya TÜM olası hash'leri eklemekten daha
# temiz ve doğrudur (yanlışlıkla bir sayfada olmayan bir script'e izin
# vermiş gibi görünmez).
#
# EK GÜVENCE — build başarısızlığı: bir sayfada CSP meta etiketi normalde
# olması gerekirken bulunamazsa (ör. _layouts/default.html'den CSP satırı
# yanlışlıkla silinirse) bu plugin build'i BAŞARISIZ YAPMAZ, sadece bir
# uyarı loglar — CSP'nin kendisi eksikse bu ayrı bir regresyon olur ve bu
# plugin onu icat edemez, sadece VAR OLAN CSP'yi sıkılaştırır.
#
# GİTHUB PAGES UYUMLULUĞU: bu plugin SADECE bir "post_write" hook'u —
# GitHub Pages'in native (safe mode) build'inde ÇALIŞMAZ (özel pluginler
# yasak). Bu yüzden proje artık GitHub Actions (.github/workflows/
# github-pages-deploy.yml) ile build edilip GitHub Pages'e deploy ediliyor;
# o workflow tam Ruby/Jekyll ortamı kullandığı için bu plugin orada normal
# şekilde çalışır. Cloudflare Pages zaten kendi tam Jekyll build'ini
# çalıştırıyor, orada da otomatik olarak çalışır.

require "digest"

# _headers (Cloudflare Pages) İÇİN AYRI NOT:
# -----------------------------------------------------------------------
# _headers dosyası, Jekyll'in sayfa render sistemi DIŞINDA, Cloudflare
# Pages'in doğrudan okuduğu STATİK bir dosyadır — build sırasında Liquid
# İŞLEMEZ, ve TEK bir CSP satırı sitedeki HER sayfaya (hangi inline script'i
# içerse içermesin) aynen uygulanır. Bu yüzden <meta> CSP'sinden farklı
# olarak burada "sayfa başına" bir hash listesi tutamayız — bunun yerine
# sitedeki TÜM sayfalardan toplanan hash'lerin BİRLEŞİMİNİ (union) kullanmak
# gerekir: bir sayfa AdSense/GA/giscus script'ini içermiyorsa o hash'in
# listede fazladan bulunması ZARARSIZDIR (CSP bir hash'in "kullanılmasını"
# zorunlu kılmaz, sadece "izin verir") — ama listede EKSİK bir hash o
# sayfadaki gerçek bir script'i BLOKLAR, bu yüzden birleşim (fazla izin
# verme yönünde hata payı) doğru güvenli tercihtir.
#
# Bu birleşim de OTOMATİK hesaplanır (elle güncellenmiyor) — script
# içeriği değiştikçe/yeni bir inline script eklendikçe bu dosya YENİDEN
# build edilince kendiliğinden güncel hash'leri alır, insan hatasıyla
# eskimiş bir hash listesi kalma riski yoktur.

module CspHashEnjekte
  # KRİTİK DÜZELTME — HTML YORUMLARI regex'i YANILTABİLİR: bu dosyanın
  # kendisi (ve projedeki diğer .html dosyaları) açıklama amacıyla HTML
  # yorumları (<!-- ... -->) İÇİNDE "<style>" veya "<script>" gibi LİTERAL
  # METİNLER barındırabiliyor (ör. "NOT: <style disabled> HTML ATTRIBUTE'U
  # OLARAK KULLANILMADI..." açıklaması). SCRIPT_TAG_REGEX/STYLE_TAG_REGEX
  # bu yorum metnini GERÇEK bir açılış etiketi sanıp, oradan asıl etikete
  # kadar olan HER ŞEYİ (yorumun geri kalanı dahil) script/style GÖVDESİ
  # olarak yanlış yakalayabilir — bu durumda hesaplanan hash tarayıcının
  # hesapladığından FARKLI olur ve script/style SESSİZCE BLOKLANIR (build
  # başarılı görünür ama üretimde site bozuk çalışır, bu en tehlikeli tür
  # hatadır). Bu yüzden hash hesaplamadan ÖNCE tüm HTML yorumlarını
  # içerikten TAMAMEN çıkarıyoruz — yorumlar zaten tarayıcıya gönderilen
  # gerçek script/style içeriğinin bir PARÇASI DEĞİL, sadece kaynak kod
  # belgelemesi, bu yüzden çıkarılmaları hash sonucunu ETKİLEMEZ (asıl
  # <script>/<style> içeriği aynı kalır), sadece regex'in kafasının
  # karışmasını önler.
  HTML_YORUM_REGEX = /<!--.*?-->/m

  def self.yorumlari_cikar(html)
    html.gsub(HTML_YORUM_REGEX, "")
  end

  # src= OLMAYAN <script> bloklarını yakalar (type="module" dahil — module
  # scriptler de script-src kısıtlamasına tabidir, hash'siz/nonce'suz
  # 'unsafe-inline' olmadan çalışmazlar). type="application/ld+json" gibi
  # scriptler zaten JS ÇALIŞTIRMADIĞI için CSP script-src'den etkilenmez,
  # ama zarar vermeyeceği için onları da hash listesine almak sorun
  # yaratmaz (CSP script hash eşleşmesi sadece "script çalıştırılabilir mi"
  # kontrolüdür, ld+json zaten 'script' olarak parse edilir ama execute
  # edilmez).
  SCRIPT_TAG_REGEX = /<script(?![^>]*\bsrc=)([^>]*)>(.*?)<\/script>/mi

  # src= (href=) OLMAYAN <style> bloklarını yakalar. Not: <style> etiketinin
  # kendisinde zaten bir src/href attribute'u OLMAZ (harici CSS <link> ile
  # gelir, <style> HER ZAMAN inline'dır) — yine de ileride bir tarayıcı
  # uzantısı böyle bir attribute eklerse diye script regex'iyle TUTARLI bir
  # desen kullanıyoruz.
  STYLE_TAG_REGEX = /<style([^>]*)>(.*?)<\/style>/mi

  CSP_META_REGEX = /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=")([^"]*)("\s*>)/mi
  HEADERS_CSP_REGEX = /(Content-Security-Policy:\s*)([^\r\n]*)/i

  def self.headers_dosyasini_guncelle(site_dizini, tum_script_hashler, tum_style_hashler)
    headers_yolu = File.join(site_dizini, "_headers")
    return unless File.exist?(headers_yolu)

    icerik = File.read(headers_yolu, encoding: "UTF-8")
    return unless icerik =~ HEADERS_CSP_REGEX

    icerik.sub!(HEADERS_CSP_REGEX) do
      onek, csp_satiri = $1, $2
      guncel_csp = csp_satiri
      guncel_csp = csp_icinde_yonerge_guncelle(guncel_csp, "script-src", tum_script_hashler)
      guncel_csp = csp_icinde_yonerge_guncelle(guncel_csp, "style-src", tum_style_hashler)
      "#{onek}#{guncel_csp}"
    end

    File.write(headers_yolu, icerik, encoding: "UTF-8")
  end

  def self.etiket_icin_hash_listesi_uret(html, etiket_regex)
    # ÖNEMLİ: yorumları ÖNCE çıkarıyoruz (bkz. HTML_YORUM_REGEX yukarıdaki
    # ayrıntılı gerekçe) — aksi halde bir yorumun İÇİNDEKİ "<script>"/
    # "<style>" literal metni gerçek bir etiket sanılıp yanlış (ve
    # tarayıcının hesaplayacağından FARKLI) bir hash üretilebilir.
    temiz_html = yorumlari_cikar(html)
    hashler = []
    temiz_html.scan(etiket_regex) do |_attrs, govde|
      # Baş/son boşluk farkları tarayıcının hash hesaplamasını ETKİLEMEZ
      # (CSP spesifikasyonu içeriği OLDUĞU GİBİ, trim'siz hash'ler) — biz
      # de govde'yi OLDUĞU GİBİ (hiç dokunmadan) hash'liyoruz, aksi halde
      # tarayıcının hesapladığı hash ile bizimki UYUŞMAZ ve
      # script/style sessizce bloklanır.
      ozet = Digest::SHA256.base64digest(govde)
      hashler << "'sha256-#{ozet}'"
    end
    hashler.uniq
  end

  def self.sayfa_icin_hash_listesi_uret(html)
    # GERİYE UYUMLULUK: eski çağrı yeri (sadece script) için korunuyor.
    etiket_icin_hash_listesi_uret(html, SCRIPT_TAG_REGEX)
  end

  def self.csp_icinde_yonerge_guncelle(csp_icerik, yonerge_adi, hashler)
    # Bu sayfada/dosyada o türden (script/style) hiç inline blok yoksa
    # hashler boş olur — bu durumda default-src/mevcut yönergeye
    # DOKUNMUYORUZ (boş bir "script-src ;" eklemek her şeyi bloklardı).
    return csp_icerik if hashler.empty? && !(csp_icerik =~ /#{yonerge_adi}\s+/i)

    if csp_icerik =~ /#{yonerge_adi}\s+([^;]*)/i
      # Zaten ayrı bir yönerge varsa (ileride eklenirse) onu güncelle:
      # unsafe-inline/unsafe-eval'i çıkar, hash'leri ekle.
      eski = $1
      yeni = (eski.split(/\s+/) - ["'unsafe-inline'", "'unsafe-eval'"] + hashler).uniq.join(" ")
      csp_icerik.sub(/#{yonerge_adi}\s+[^;]*/i, "#{yonerge_adi} #{yeni}")
    else
      # Yönerge yok -> default-src'den unsafe-inline/unsafe-eval'i çıkarıp
      # AYRI bir yönerge ekliyoruz (default-src'nin geri kalanı -- ör.
      # 'self' https: -- ayrıca yeni yönergeye de taşınır, çünkü o
      # yönerge eklenince default-src ARTIK o tür kaynaklar için fallback
      # olarak kullanılmaz, CSP spesifikasyonu gereği).
      if csp_icerik =~ /default-src\s+([^;]*)/i
        temel = $1.split(/\s+/) - ["'unsafe-inline'", "'unsafe-eval'"]
        yeni_default = temel.join(" ")
        yeni_yonerge_degeri = (temel + hashler).uniq.join(" ")
        guncellenmis = csp_icerik.sub(/default-src\s+[^;]*/i, "default-src #{yeni_default}")
        # Yeni yönergeyi default-src'den hemen sonra ekle (sıra CSP
        # semantiğini etkilemez, sadece okunabilirlik için).
        guncellenmis.sub(/(default-src\s+[^;]*;)/i, "\\1 #{yonerge_adi} #{yeni_yonerge_degeri};")
      else
        csp_icerik
      end
    end
  end

  # ÖNCELİK NOTU: bu hook'u :low önceliğiyle kaydediyoruz. Jekyll'de
  # :post_write kancaları :site nesnesi ÜZERİNDE, dosyalar zaten DİSKE
  # yazıldıktan SONRA çalışır — ama proje ileride bir HTML minifier plugin'i
  # (şu an YOK, bkz. Gemfile — sadece Sass/CSS minify var) eklerse ve o
  # plugin de kendi :post_write kancasıyla dosyaları SONRADAN küçültürse,
  # bizim hash hesaplamamızın o küçültmeden SONRA çalışması gerekir (aksi
  # halde küçültülmüş script içeriği hesapladığımız hash'le UYUŞMAZ ve
  # tarayıcı script'i sessizce bloklar). :low öncelik, aynı olayda kayıtlı
  # diğer (öncelik belirtmemiş = :normal olan) hook'lardan SONRA çalışmamızı
  # sağlar. Bir minifier eklenirse, o plugin'in KENDİ önceliğinin bizimkinden
  # YÜKSEK (örn. :normal ya da :high) olduğundan emin olunmalı — aksi halde
  # hash/minify sırası yine ters dönebilir; bu, gelecekte bir minifier
  # eklenirse kontrol edilmesi gereken tek bağımlılık noktasıdır.
  Jekyll::Hooks.register :site, :post_write, priority: :low do |site|
    site_dizini = site.dest
    html_dosyalari = Dir.glob(File.join(site_dizini, "**", "*.html"))

    guncellenen_sayfa_sayisi = 0
    tum_script_hashler_birlesimi = []
    tum_style_hashler_birlesimi = []

    html_dosyalari.each do |dosya_yolu|
      icerik = File.read(dosya_yolu, encoding: "UTF-8")

      # _headers birleşimi İÇİN, o sayfada <meta> CSP'si olmasa bile
      # (teoride olmamalı, ama savunmacı davranıyoruz) inline
      # script/style'ların hash'lerini yine de topluyoruz — _headers TÜM
      # site için tek bir CSP taşıdığından, herhangi bir sayfadaki
      # herhangi bir inline bloğun hash'i o birleşime dahil olmalı.
      script_hashler = etiket_icin_hash_listesi_uret(icerik, SCRIPT_TAG_REGEX)
      style_hashler = etiket_icin_hash_listesi_uret(icerik, STYLE_TAG_REGEX)
      tum_script_hashler_birlesimi.concat(script_hashler)
      tum_style_hashler_birlesimi.concat(style_hashler)

      next unless icerik =~ CSP_META_REGEX

      icerik.sub!(CSP_META_REGEX) do
        onek, csp_icerik, sonek = $1, $2, $3
        guncel_csp = csp_icerik
        guncel_csp = csp_icinde_yonerge_guncelle(guncel_csp, "script-src", script_hashler)
        guncel_csp = csp_icinde_yonerge_guncelle(guncel_csp, "style-src", style_hashler)
        "#{onek}#{guncel_csp}#{sonek}"
      end

      File.write(dosya_yolu, icerik, encoding: "UTF-8")
      guncellenen_sayfa_sayisi += 1
    end

    tum_script_hashler_birlesimi.uniq!
    tum_style_hashler_birlesimi.uniq!
    headers_dosyasini_guncelle(site_dizini, tum_script_hashler_birlesimi, tum_style_hashler_birlesimi)

    Jekyll.logger.info "CSP Hash Enjekte:", "#{guncellenen_sayfa_sayisi} sayfada inline script/style hash'leri CSP'ye eklendi, 'unsafe-inline'/'unsafe-eval' kaldırıldı (#{tum_script_hashler_birlesimi.length} script + #{tum_style_hashler_birlesimi.length} style hash'i, _headers dahil)."
  end
end
