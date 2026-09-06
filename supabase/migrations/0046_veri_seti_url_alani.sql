-- ============================================================================
-- 0046_veri_seti_url_alani.sql
--
-- İSTEK: yazı/proje sayfalarına, "PDF Bağlantısı" (pdf_url, bkz. migration
-- 0040) ile TAMAMEN PARALEL, isteğe bağlı bir "Veri Seti URL" (veri_url)
-- alanı eklenmesi — GitHub reposu, Zenodo/OSF kaydı ya da Kaggle veri
-- kümesi gibi bir dış adrese işaret eder (bkz. panel/github-yonetim.md
-- "Veri Seti URL (veri_url)" alanı, assets/js/github-yonetim/
-- github-yonetim.js dosyaIcerigiOlustur() ve _layouts/post.html /
-- project.html'deki "🗃️ Veri Seti" butonu).
--
-- GitHub'a commit edilen içeriklerde front-matter'da `veri_url: "..."`
-- olarak (sadece doluysa, pdf_url ile AYNI konvansiyon) tutulur. Panel,
-- GitHub'a yayınlamadan ÖNCE (taslak_icerikler) ya da GitHub'a HİÇ commit
-- edilmeden ("Sadece Supabase'te Yayınla", migration 0015) bu değeri de
-- saklayabilmeli — bkz. migration 0040'taki "pdf_url" ile BİREBİR AYNI
-- desen.
--
-- Ayrıca _includes/head.html, veri_url doluysa Google Scholar için
-- `citation_data_url` meta etiketini üretir.
-- ============================================================================

alter table public.taslak_icerikler
  add column if not exists veri_url text;

comment on column public.taslak_icerikler.veri_url is
  'İsteğe bağlı veri seti bağlantısı (GitHub reposu, Zenodo/OSF kaydı, Kaggle veri kümesi vb.) — pdf_url ile AYNI konvansiyon: doluysa yazının/projenin başında "🗃️ Veri Seti" butonu gösterilir (bkz. _layouts/post.html/project.html, assets/js/okuma-araclari/okuma-meta-yardimci.js kaynakButonlariHtml) ve _includes/head.html tarafından citation_data_url meta etiketine çevrilir. Sadece http(s):// ile başlayan adresler kabul edilir; kontrol hem panelde (github-yonetim.js) hem build zamanında (Liquid) tekrarlanır.';

-- ----------------------------------------------------------------------------
-- taslak_onizleme_getir(): döndürülen kolonlara `veri_url` eklendi —
-- gövdenin geri kalanı migration 0044'teki hâliyle AYNI (bkz. o
-- migration'daki Postgres RETURNS TABLE / DROP notu).
-- ----------------------------------------------------------------------------
drop function if exists public.taslak_onizleme_getir(text, text);

create or replace function public.taslak_onizleme_getir(p_tur text, p_kod text)
returns table (
  baslik            text,
  tarih             date,
  guncelleme_tarihi date,
  akademik          boolean,
  last_modified_at  date,
  venue             text,
  durum             text,
  ozet              text,
  link              text,
  link_etiket       text,
  govde             text,
  toc               boolean,
  pdf_url           text,
  veri_url          text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.akademik, t.last_modified_at,
         t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.govde, t.toc, t.pdf_url,
         t.veri_url
  from public.taslak_icerikler t
  where t.tur = p_tur and t.onizleme_kod = p_kod
  limit 1;
$$;

grant execute on function public.taslak_onizleme_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sadece_supabase_yazi_getir(): aynı gerekçeyle DROP + yeniden CREATE,
-- döndürülen kolonlara `veri_url` eklendi — gövdenin geri kalanı
-- migration 0044'teki hâliyle AYNI.
-- ----------------------------------------------------------------------------
drop function if exists public.sadece_supabase_yazi_getir(text, text);

create or replace function public.sadece_supabase_yazi_getir(p_tur text, p_slug text)
returns table (
  baslik            text,
  tarih             date,
  guncelleme_tarihi date,
  akademik          boolean,
  last_modified_at  date,
  venue             text,
  durum             text,
  ozet              text,
  link              text,
  link_etiket       text,
  yazar_adi         text,
  govde             text,
  reklam            boolean,
  toc               boolean,
  pdf_url           text,
  veri_url          text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.akademik, t.last_modified_at,
         t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde,
         t.reklam, t.toc, t.pdf_url, t.veri_url
  from public.taslak_icerikler t
  where t.tur = p_tur
    and t.slug = p_slug
    and t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  limit 1;
$$;

grant execute on function public.sadece_supabase_yazi_getir(text, text) to anon, authenticated;

-- ============================================================================
-- BİTTİ. Test:
-- 1) Panelden bir yazıda "Veri Seti URL" alanını doldur, GitHub'a yayınla —
--    sayfanın başında PDF butonunun YANINDA "🗃️ Veri Seti" butonunun
--    çıktığını, front-matter'da `veri_url: "..."` yazıldığını doğrula.
-- 2) Aynı alanı boş bırakıp sadece PDF doldurursan sadece PDF butonunun,
--    ikisini de boş bırakırsan hiçbir butonun çıkmadığını doğrula.
-- 3) Aynı yazıyı "Sadece Supabase'te Yayınla" ile yayınla,
--    /icerik/supabase-yazi.html?tur=...&slug=... sayfasında Veri Seti
--    butonunun AYNI şekilde (client-side üretilmiş olarak) göründüğünü
--    doğrula.
-- 4) Bir taslağı "Mevcut İçerikler"den tekrar aç, veri_url alanının
--    korunduğunu doğrula.
-- ============================================================================
