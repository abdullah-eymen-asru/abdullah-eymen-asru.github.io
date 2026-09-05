# _plugins/feed_url_absolutize.rb
#
# NEDEN GEREKLİ:
# Jekyll'in kendi `absolute_url` filtresi TEK bir string üzerinde çalışır
# (ör. {{ post.url | absolute_url }}). Ama {{ post.content }} zaten
# render edilmiş, içinde onlarca <img src="/assets/..."> ve
# <a href="/blog/..."> geçebilen bir HTML bloğu — bunun İÇİNDEKİ URL'leri
# tek tek çeviremez. Inoreader/Feedly gibi RSS okuyucular siteyi kendi
# sunucularında (farklı bir origin'de) render ettiği için kök-göreli
# ("/" ile başlayan) yollar orada kırık görsel/link olarak çıkar.
#
# NASIL ÇALIŞIR:
# Nokogiri gibi ağır bir HTML parser'a gerek duymadan (proje ilkesi:
# gereksiz/hantal kütüphane eklenmiyor — bkz. rehber notları), sadece
# href="/..." ve src="/..." kalıplarını regex ile yakalayıp başına
# site.url (+ varsa site.baseurl) ekliyoruz.
#
# DOKUNULMAYANLAR (bilerek):
#   - "http://" / "https://" ile başlayan (zaten mutlak) adresler
#   - "//" ile başlayan (protokolden bağımsız mutlak) adresler
#   - "#" ile başlayan sayfa-içi çapa linkleri
#   - mailto:, tel: gibi şema adresleri
# Bunların hiçbiri "/" ile başlamadığı için regex zaten onlara dokunmuyor.
#
# KULLANIM: {{ post.content | absolutize_urls }}
module FeedUrlAbsolutize
  def absolutize_urls(html)
    return html if html.nil? || html.empty?

    base = feed_url_absolutize_base
    return html if base.nil? || base.empty?

    html.gsub(/(href|src)=("|')\/(?!\/)/) do
      "#{Regexp.last_match(1)}=#{Regexp.last_match(2)}#{base}/"
    end
  end

  private

  def feed_url_absolutize_base
    site = @context.registers[:site]
    return nil unless site

    url = site.config["url"].to_s
    baseurl = site.config["baseurl"].to_s
    "#{url}#{baseurl}".sub(%r{/$}, "")
  end
end

Liquid::Template.register_filter(FeedUrlAbsolutize)
