-- ============================================================================
-- 0044_akademik_atif_kutusu_ve_last_modified_at.sql
--
-- İSTEK: yazı/proje sayfalarına isteğe bağlı "Akademik Yazı / Atıf Kutusu
-- Göster" anahtarı ve buna bağlı isteğe bağlı bir "last_modified_at"
-- (atıf kutusuna özel güncelleme tarihi) alanı eklenmesi (bkz.
-- panel/github-yonetim.md "Akademik Yazı / Atıf Kutusu Göster" ve "Atıf
-- Kutusu — Güncelleme Tarihi" alanları, assets/js/github-yonetim/
-- github-yonetim.js dosyaIcerigiOlustur()).
--
-- GitHub'a commit edilen içerikler için front-matter'da `akademik: true`
-- ve `last_modified_at: YYYY-MM-DD` olarak (sadece doluysa) tutulur — bkz.
-- _includes/atif-kutusu.html (`page.akademik == true` kontrolü ve
-- `atif_revizyon_tarihi = page.last_modified_at | default:
-- page.guncelleme_tarihi`). Panel, GitHub'a yayınlamadan ÖNCE
-- (taslak_icerikler) ya da GitHub'a HİÇ commit edilmeden ("Sadece
-- Supabase'te Yayınla", migration 0015) bu tercihleri de saklayabilmeli —
-- aynı desen (bkz. migration 0040 "toc"/"pdf_url", migration 0041
-- "guncelleme_tarihi").
--
-- last_modified_at, guncelleme_tarihi'nden BAĞIMSIZ ayrı bir kolondur:
-- atıf kutusundaki (APA/Chicago/MLA/BibTeX) "güncellendi/son güncelleme/
-- versiyon" bilgisi ÖNCELİKLE bu alandan okunur, boşsa guncelleme_tarihi'ne
-- düşer (bkz. assets/js/github-yonetim/supabase-yazi.js
-- atifKutusuOlustur()).
-- ============================================================================

alter table public.taslak_icerikler
  add column if not exists akademik boolean not null default false;

alter table public.taslak_icerikler
  add column if not exists last_modified_at date;

comment on column public.taslak_icerikler.akademik is
  'true ise yazının/projenin sonunda çok dilli (TR/EN) APA 7, Chicago 17, MLA 9 ve BibTeX atıf kutusu gösterilir — GitHub''a yayınlanınca front-matter''daki akademik: true alanına (bkz. dosyaIcerigiOlustur), "Sadece Supabase''te Yayınla" ile kalırsa sadece_supabase_yazi_getir()/taslak_onizleme_getir() üzerinden ilgili sayfaya taşınır ve orada tarayıcıda (client-side) üretilir (bkz. assets/js/github-yonetim/supabase-yazi.js atifKutusuOlustur).';

comment on column public.taslak_icerikler.last_modified_at is
  'Atıf kutusuna ÖZEL, isteğe bağlı "versiyon/son güncelleme" tarihi — guncelleme_tarihi''nden BAĞIMSIZDIR ve doluysa ona ÖNCELİKLİDİR (bkz. atif-kutusu.html atif_revizyon_tarihi). Sadece `akademik` açıkken bir anlamı vardır; kapalıyken UI''da (wireAkademikToggle) zaten gizlenir.';

-- ----------------------------------------------------------------------------
-- taslak_onizleme_getir(): döndürülen kolonlara `akademik` ve
-- `last_modified_at` eklendi — gövdenin geri kalanı migration 0041'deki
-- hâliyle AYNI (bkz. o migration'daki Postgres RETURNS TABLE / DROP notu).
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
  pdf_url           text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.akademik, t.last_modified_at,
         t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.govde, t.toc, t.pdf_url
  from public.taslak_icerikler t
  where t.tur = p_tur and t.onizleme_kod = p_kod
  limit 1;
$$;

grant execute on function public.taslak_onizleme_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sadece_supabase_yazi_getir(): aynı gerekçeyle DROP + yeniden CREATE,
-- döndürülen kolonlara `akademik` ve `last_modified_at` eklendi — gövdenin
-- geri kalanı migration 0041'deki hâliyle AYNI.
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
  pdf_url           text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.akademik, t.last_modified_at,
         t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde,
         t.reklam, t.toc, t.pdf_url
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
-- 1) Panelden bir yazıda "Akademik Yazı / Atıf Kutusu Göster" kutusunu aç,
--    (isteğe bağlı) "Atıf Kutusu — Güncelleme Tarihi"ni doldur, GitHub'a
--    yayınla — sayfanın sonunda atıf kutusunun göründüğünü, kapalıyken HİÇ
--    görünmediğini doğrula.
-- 2) Aynı yazıyı "Sadece Supabase'te Yayınla" ile yayınla,
--    /icerik/supabase-yazi.html?tur=...&slug=... sayfasında atıf kutusunun
--    AYNI şekilde (client-side üretilmiş olarak) göründüğünü doğrula.
-- 3) Bir taslağı "Mevcut İçerikler"den tekrar aç, her iki alanın da
--    (akademik + last_modified_at) korunduğunu doğrula.
-- ============================================================================
