# _plugins/turkce_ay_filtresi.rb
#
# NEDEN GEREKLİ:
# Jekyll'in kendi `date` filtresi (ör. `{{ page.date | date: "%B" }}`), build
# ortamının sistem locale'ine göre ay adını üretir; bu proje build'i
# locale'den BAĞIMSIZ çalıştığı için (bkz. _config.yml'deki not) ay adları
# HER ZAMAN İngilizce çıkar ("September" gibi) — site Türkçe olduğu için bu
# yanlış görünüyordu (ör. proje/yazı detay sayfalarındaki "Güncellendi: 03
# September 2026" ibaresi).
#
# _includes/atif-kutusu.html içinde bu sorun zaten bir Türkçe ay dizisiyle
# (aylar_tr) build-time Liquid içinde çözülmüştü; bu plugin AYNI diziyi tek
# bir yerde tanımlayıp `ay_adi_tr` filtresi olarak TÜM şablonlara açar, böylece
# her şablonda ayrı ayrı dizi tanımlamaya gerek kalmaz.
#
# KULLANIM: {{ page.date | ay_adi_tr }}  ->  "Eylül"
#           {{ page.date | date: "%-d" }} {{ page.date | ay_adi_tr }} {{ page.date | date: "%Y" }}  ->  "5 Eylül 2026"
#
# Girdi front-matter'dan gelen bir tarih olduğu için Time, Date/DateTime
# (YAML çıplak "2026-09-05" gibi tarihleri otomatik Date'e çevirir) ya da
# String olabilir — üçünü de destekliyoruz.

require "date"

module TurkceAyFiltresi
  AYLAR_TR = %w[
    Ocak Şubat Mart Nisan Mayıs Haziran
    Temmuz Ağustos Eylül Ekim Kasım Aralık
  ].freeze

  def ay_adi_tr(tarih)
    return "" if tarih.nil? || tarih == ""

    ay_no = tarih.respond_to?(:month) ? tarih.month : Date.parse(tarih.to_s).month
    AYLAR_TR[ay_no - 1]
  end
end

Liquid::Template.register_filter(TurkceAyFiltresi)
