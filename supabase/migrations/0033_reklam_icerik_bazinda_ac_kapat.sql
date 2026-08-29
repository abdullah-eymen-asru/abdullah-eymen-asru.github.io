-- ============================================================================
-- 0033_reklam_icerik_bazinda_ac_kapat.sql
--
-- İSTEK: siteyi AdSense reklamına hazırlama — yazı/proje bazında reklamı
-- açıp kapatabilme (bkz. panel/github-yonetim.md "Reklam" anahtarı ve
-- assets/js/github-yonetim/github-yonetim.js).
--
-- GitHub'a commit edilen içerikler (yazı/proje) için bu tercih doğrudan
-- front-matter'daki `reklam: false` alanında tutulur (Jekyll build-time'da
-- okunur, bkz. _layouts/default.html) — bunun için veritabanında hiçbir
-- şey gerekmez. Ama panel, GitHub'a yayınlamadan ÖNCE (taslak_icerikler)
-- ya da GitHub'a HİÇ commit edilmeden ("Sadece Supabase'te Yayınla",
-- migration 0015) bu tercihi de saklayabilmeli — front-matter'a yazılacak
-- ya da sadece_supabase_yazi_getir() ile okunacak DEĞER, taslak
-- düzenlenirken kaybolmamalı. Bu yüzden `taslak_icerikler` tablosuna aynı
-- alan ekleniyor.
-- ============================================================================

alter table public.taslak_icerikler
  add column if not exists reklam boolean not null default true;

comment on column public.taslak_icerikler.reklam is
  'false ise bu içerikte reklam gösterilmez — GitHub''a yayınlanınca front-matter''daki reklam: false alanına (bkz. dosyaIcerigiOlustur), "Sadece Supabase''te Yayınla" ile kalırsa sadece_supabase_yazi_getir() üzerinden icerik/supabase-yazi.js''e taşınır.';

-- sadece_supabase_yazi_getir(): tek değişiklik, döndürülen kolonlara
-- `reklam` eklendi — gövdenin geri kalanı migration 0015'teki hâliyle AYNI.
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
  reklam      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde, t.reklam
  from public.taslak_icerikler t
  where t.tur = p_tur
    and t.slug = p_slug
    and t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  limit 1;
$$;

-- ============================================================================
-- BİTTİ. Test: panelden bir yazıda "Reklam" anahtarını kapatıp taslak olarak
-- kaydet, "Mevcut İçerikler"den tekrar aç, anahtarın hâlâ kapalı göründüğünü
-- doğrula. "Sadece Supabase'te Yayınla" ile yayınlayıp
-- /icerik/supabase-yazi.html?tur=...&slug=... sayfasında reklam bloğunun
-- gerçekten görünmediğini kontrol et.
-- ============================================================================
