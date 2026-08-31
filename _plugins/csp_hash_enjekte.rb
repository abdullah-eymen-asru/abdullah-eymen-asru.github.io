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
#   3) O dosyadaki her <script>...</script> bloğunu (src= olanlar HARİÇ —
#      onlar zaten CSP'nin script-src 'self'/https: kısmına tabi, hash
#      gerektirmezler) bulup İÇERİĞİNİN SHA-256 hash'ini hesaplar.
#   4) O dosyada bir CSP <meta http-equiv="Content-Security-Policy"> etiketi
#      varsa, "'unsafe-inline'" ve "'unsafe-eval'" ifadelerini SİLİP yerine
#      o SAYFAYA ÖZGÜ hash listesini ekler, dosyayı GÜNCEL hâliyle geri yazar.
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
  # src= OLMAYAN <script> bloklarını yakalar (type="module" dahil — module
  # scriptler de script-src kısıtlamasına tabidir, hash'siz/nonce'suz
  # 'unsafe-inline' olmadan çalışmazlar). type="application/ld+json" gibi
  # scriptler zaten JS ÇALIŞTIRMADIĞI için CSP script-src'den etkilenmez,
  # ama zarar vermeyeceği için onları da hash listesine almak sorun
  # yaratmaz (CSP script hash eşleşmesi sadece "script çalıştırılabilir mi"
  # kontrolüdür, ld+json zaten 'script' olarak parse edilir ama execute
  # edilmez).
  SCRIPT_TAG_REGEX = /<script(?![^>]*\bsrc=)([^>]*)>(.*?)<\/script>/mi
  CSP_META_REGEX = /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=")([^"]*)("\s*>)/mi
  HEADERS_CSP_REGEX = /(Content-Security-Policy:\s*)([^\r\n]*)/i

  def self.headers_dosyasini_guncelle(site_dizini, tum_hashler)
    headers_yolu = File.join(site_dizini, "_headers")
    return unless File.exist?(headers_yolu)

    icerik = File.read(headers_yolu, encoding: "UTF-8")
    return unless icerik =~ HEADERS_CSP_REGEX

    icerik.sub!(HEADERS_CSP_REGEX) do
      onek, csp_satiri = $1, $2
      guncel_csp = csp_icinde_script_src_guncelle(csp_satiri, tum_hashler)
      "#{onek}#{guncel_csp}"
    end

    File.write(headers_yolu, icerik, encoding: "UTF-8")
  end

  def self.sayfa_icin_hash_listesi_uret(html)
    hashler = []
    html.scan(SCRIPT_TAG_REGEX) do |_attrs, govde|
      # Baş/son boşluk farkları tarayıcının hash hesaplamasını ETKİLEMEZ
      # (CSP spesifikasyonu script içeriğini OLDUĞU GİBİ, trim'siz hash'ler)
      # — biz de govde'yi OLDUĞU GİBİ (hiç dokunmadan) hash'liyoruz, aksi
      # halde tarayıcının hesapladığı hash ile bizimki UYUŞMAZ ve script
      # sessizce bloklanır.
      ozet = Digest::SHA256.base64digest(govde)
      hashler << "'sha256-#{ozet}'"
    end
    hashler.uniq
  end

  def self.csp_icinde_script_src_guncelle(csp_icerik, hashler)
    # script-src YOKSA default-src'nin script-src'yi de kapsadığı
    # varsayılır (CSP fallback kuralı) — bu durumda default-src'ye
    # dokunmak yerine AYRI bir script-src ekleriz (script-src varsa o,
    # yoksa default-src script çalıştırmayı kontrol eder). Proje şu an
    # default-src üzerinden 'unsafe-inline'/'unsafe-eval' taşıyor, bu
    # yüzden birincil senaryo budur.
    if csp_icerik =~ /script-src\s+([^;]*)/i
      # Zaten ayrı bir script-src yönergesi varsa (ileride eklenirse) onu
      # güncelle: unsafe-inline/unsafe-eval'i çıkar, hash'leri ekle.
      eski = $1
      yeni = (eski.split(/\s+/) - ["'unsafe-inline'", "'unsafe-eval'"] + hashler).uniq.join(" ")
      csp_icerik.sub(/script-src\s+[^;]*/i, "script-src #{yeni}")
    else
      # script-src yok -> default-src'den unsafe-inline/unsafe-eval'i
      # çıkarıp AYRI bir script-src yönergesi ekliyoruz (default-src'nin
      # geri kalanı -- ör. 'self' https: -- ayrıca script-src'ye de
      # taşınır, çünkü script-src eklenince default-src ARTIK script'ler
      # için fallback olarak kullanılmaz, CSP spesifikasyonu gereği).
      if csp_icerik =~ /default-src\s+([^;]*)/i
        temel = $1.split(/\s+/) - ["'unsafe-inline'", "'unsafe-eval'"]
        yeni_default = temel.join(" ")
        yeni_script_src = (temel + hashler).uniq.join(" ")
        guncellenmis = csp_icerik.sub(/default-src\s+[^;]*/i, "default-src #{yeni_default}")
        # script-src'yi default-src'den hemen sonra ekle (yönerge sırası
        # CSP semantiğini etkilemez, sadece okunabilirlik için).
        guncellenmis.sub(/(default-src\s+[^;]*;)/i, "\\1 script-src #{yeni_script_src};")
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
    tum_hashler_birlesimi = []

    html_dosyalari.each do |dosya_yolu|
      icerik = File.read(dosya_yolu, encoding: "UTF-8")

      # _headers birleşimi İÇİN, o sayfada <meta> CSP'si olmasa bile
      # (teoride olmamalı, ama savunmacı davranıyoruz) inline scriptlerin
      # hash'lerini yine de topluyoruz — _headers TÜM site için tek bir
      # CSP taşıdığından, herhangi bir sayfadaki herhangi bir inline
      # script'in hash'i o birleşime dahil olmalı.
      tum_hashler_birlesimi.concat(sayfa_icin_hash_listesi_uret(icerik))

      next unless icerik =~ CSP_META_REGEX

      hashler = sayfa_icin_hash_listesi_uret(icerik)

      icerik.sub!(CSP_META_REGEX) do
        onek, csp_icerik, sonek = $1, $2, $3
        guncel_csp = csp_icinde_script_src_guncelle(csp_icerik, hashler)
        "#{onek}#{guncel_csp}#{sonek}"
      end

      File.write(dosya_yolu, icerik, encoding: "UTF-8")
      guncellenen_sayfa_sayisi += 1
    end

    tum_hashler_birlesimi.uniq!
    headers_dosyasini_guncelle(site_dizini, tum_hashler_birlesimi)

    Jekyll.logger.info "CSP Hash Enjekte:", "#{guncellenen_sayfa_sayisi} sayfada inline script hash'leri CSP'ye eklendi, 'unsafe-inline'/'unsafe-eval' kaldırıldı (#{tum_hashler_birlesimi.length} benzersiz hash, _headers dahil)."
  end
end
