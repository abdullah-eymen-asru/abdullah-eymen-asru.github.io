-- ============================================================================
-- 0040_yazi_toc_ve_pdf_url_alanlari.sql
--
-- İSTEK: yazı/proje sayfalarına İçindekiler (toc) ve PDF İndirme butonu
-- (pdf_url) eklenmesi (bkz. panel/github-yonetim.md "İçindekiler" ve
-- "PDF Bağlantısı" alanları, assets/js/github-yonetim/github-yonetim.js
-- dosyaIcerigiOlustur()).
--
-- GitHub'a commit edilen içerikler için bu tercihler doğrudan front-matter'da
-- tutulur (`toc: true`, `pdf_url: "https://..."` — bkz. _layouts/post.html
-- ve _layouts/project.html) — bunun için veritabanında hiçbir şey gerekmez.
-- Ama panel, GitHub'a yayınlamadan ÖNCE (taslak_icerikler) ya da GitHub'a
-- HİÇ commit edilmeden ("Sadece Supabase'te Yayınla", migration 0015) bu
-- tercihleri de saklayabilmeli — front-matter'a yazılacak ya da
-- sadece_supabase_yazi_getir()/taslak_onizleme_getir() ile okunacak DEĞER,
-- taslak düzenlenirken kaybolmamalı. Bu yüzden `taslak_icerikler` tablosuna
-- aynı desende (bkz. migration 0033 "reklam" alanı) iki alan ekleniyor.
-- ============================================================================

alter table public.taslak_icerikler
  add column if not exists toc boolean not null default false;

alter table public.taslak_icerikler
  add column if not exists pdf_url text;

comment on column public.taslak_icerikler.toc is
  'true ise yazının başında katlanabilir bir İçindekiler bloğu gösterilir — GitHub''a yayınlanınca front-matter''daki toc: true alanına (bkz. dosyaIcerigiOlustur), "Sadece Supabase''te Yayınla" ile kalırsa sadece_supabase_yazi_getir()/taslak_onizleme_getir() üzerinden ilgili sayfaya taşınır ve orada tarayıcıda (client-side) üretilir (bkz. assets/js/okuma-araclari/okuma-meta-yardimci.js tocOlustur).';

comment on column public.taslak_icerikler.pdf_url is
  'Doluysa yazının başında "PDF İndir" butonu gösterilir — sadece http(s) ile başlayan adresler kabul edilir (bkz. dosyaIcerigiOlustur ve assets/js/okuma-araclari/okuma-meta-yardimci.js pdfButonuHtml, ikisi de aynı şema kontrolünü ayrıca uygular).';

-- ----------------------------------------------------------------------------
-- taslak_onizleme_getir(): döndürülen kolonlara `toc` ve `pdf_url` eklendi —
-- gövdenin geri kalanı migration 0013'teki hâliyle AYNI.
--
-- NOT (Postgres kısıtı): RETURNS TABLE listesine yeni sütun eklemek dönüş
-- satır tipini değiştirir; CREATE OR REPLACE bunu kabul etmez, önce DROP
-- gerekir — DROP, fonksiyona verilmiş GRANT'ları da SİLER, bu yüzden CREATE
-- sonrası grant satırı burada TEKRARLANIYOR (bkz. migration 0033'teki aynı not).
-- ----------------------------------------------------------------------------
drop function if exists public.taslak_onizleme_getir(text, text);

create or replace function public.taslak_onizleme_getir(p_tur text, p_kod text)
returns table (
  baslik      text,
  tarih       date,
  venue       text,
  durum       text,
  ozet        text,
  link        text,
  link_etiket text,
  govde       text,
  toc         boolean,
  pdf_url     text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.govde, t.toc, t.pdf_url
  from public.taslak_icerikler t
  where t.tur = p_tur and t.onizleme_kod = p_kod
  limit 1;
$$;

grant execute on function public.taslak_onizleme_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sadece_supabase_yazi_getir(): aynı gerekçeyle DROP + yeniden CREATE,
-- döndürülen kolonlara `toc` ve `pdf_url` eklendi — gövdenin geri kalanı
-- migration 0033'teki (reklam eklenmiş) hâliyle AYNI.
-- ----------------------------------------------------------------------------
drop function if exists public.sadece_supabase_yazi_getir(text, text);

create or replace function public.sadece_supabase_yazi_getir(p_tur text, p_slug text)
returns table (
  baslik      text,
  tarih       date,
  venue       text,
  durum       text,
  ozet        text,
  link        text,
  link_etiket text,
  yazar_adi   text,
  govde       text,
  reklam      boolean,
  toc         boolean,
  pdf_url     text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde, t.reklam, t.toc, t.pdf_url
  from public.taslak_icerikler t
  where t.tur = p_tur
    and t.slug = p_slug
    and t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  limit 1;
$$;

grant execute on function public.sadece_supabase_yazi_getir(text, text) to anon, authenticated;

-- ============================================================================
-- BİTTİ. Test: panelden bir yazıda "İçindekiler" anahtarını açıp bir PDF
-- linki girerek taslak olarak kaydet, "Mevcut İçerikler"den tekrar açıp
-- değerlerin korunduğunu doğrula. "Sadece Supabase'te Yayınla" ile
-- yayınlayıp /icerik/supabase-yazi.html?tur=...&slug=... sayfasında PDF
-- butonunun ve İçindekiler bloğunun göründüğünü, gizli önizleme linkinde
-- (/onizleme/?tur=...&kod=...) de aynı şekilde çalıştığını kontrol et.
-- ============================================================================
