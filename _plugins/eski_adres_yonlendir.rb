# frozen_string_literal: true
# _plugins/eski_adres_yonlendir.rb
#
# Yazı adresleri /:year/:month/:day/:title.html biçiminden temiz /blog/:title/ biçimine geçti (bkz. _config.yml `permalink`).
# Daha önce paylaşılmış/indekslenmiş eski adresler kırılmasın diye her yazı için ESKİ adreste küçük bir yönlendirme sayfası üretilir:
# <meta http-equiv="refresh"> + <link rel="canonical"> (yeni adres) + noindex. GitHub Pages sunucu yönlendirmesi veremediği için en iyi statik çözüm budur;
# arama motorları canonical'ı izleyip sinyalleri yeni adrese taşır. Gizli/zamanlanmış yazılar için üretilmez.
module AsruEskiAdres
  class Uretici < Jekyll::Generator
    safe true
    priority :lowest

    def generate(site)
      site.posts.docs.each do |yazi|
        next if yazi.data["yayinda"] == false || yazi.data["permalink"]
        tarih = yazi.date
        eski = format("/%<y>04d/%<m>02d/%<d>02d/%<s>s.html", y: tarih.year, m: tarih.month, d: tarih.day, s: yazi.data["slug"] || File.basename(yazi.path, ".*").sub(/^\d{4}-\d{2}-\d{2}-/, ""))
        yeni = "#{site.config["url"]}#{site.config["baseurl"]}#{yazi.url}"
        next if eski == yazi.url
        sayfa = Jekyll::PageWithoutAFile.new(site, site.source, File.dirname(eski), File.basename(eski))
        sayfa.data["layout"] = nil
        sayfa.data["sitemap"] = false
        sayfa.content = %(<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Taşındı</title>) +
                       %(<link rel="canonical" href="#{yeni}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=#{yeni}">) +
                       %(</head><body><p>Bu yazı taşındı: <a href="#{yeni}">#{yeni}</a></p></body></html>)
        site.pages << sayfa
      end
    end
  end
end
