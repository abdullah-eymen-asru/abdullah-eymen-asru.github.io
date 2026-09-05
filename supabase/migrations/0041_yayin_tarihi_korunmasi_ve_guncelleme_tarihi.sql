-- ============================================================================
-- 0041_yayin_tarihi_korunmasi_ve_guncelleme_tarihi.sql
--
-- İSTEK: (1) GitHub'a commit edilen bir yazı/proje panelden tekrar
-- düzenlenip kaydedildiğinde orijinal yayın tarihinin KAYBOLMAMASI, (2)
-- isteğe bağlı bir "Güncellenme tarihi" alanı eklenebilmesi (bkz.
-- panel/github-yonetim.md "Güncellenme tarihi" kutusu,
-- assets/js/github-yonetim/github-yonetim.js dosyaIcerigiOlustur()).
--
-- (1) NUMARALI KISIM aslında SADECE istemci tarafı bir hataydı — front-matter
-- oluşturan dosyaIcerigiOlustur() "date" alanını hiç front-matter'a
-- yazmıyordu, bu yüzden panel bir dosyayı GERÇEK içeriğinden yeniden
-- okuduğunda (frontMatterOku) tarih boş geliyordu. Bu tabloda (taslak_
-- icerikler) "tarih" kolonu zaten ayrı tutulduğu için Supabase tarafında bir
-- veri kaybı YOKTU — burada eklenen tek şey (2) numaralı yeni alan.
--
-- guncelleme_tarihi: TAMAMEN İSTEĞE BAĞLI (nullable). GitHub'a commit
-- edilen içerikler için front-matter'da `guncelleme_tarihi: YYYY-MM-DD`
-- olarak (sadece doluysa) tutulur — bkz. _layouts/post.html ve
-- project.html'deki "Güncellendi: ..." gösterimi. Panel, GitHub'a
-- yayınlamadan ÖNCE (taslak_icerikler) ya da GitHub'a HİÇ commit
-- edilmeden ("Sadece Supabase'te Yayınla", migration 0015) bu tercihi de
-- saklayabilmeli — aynı desen (bkz. migration 0040 "toc"/"pdf_url").
-- ============================================================================

alter table public.taslak_icerikler
  add column if not exists guncelleme_tarihi date;

comment on column public.taslak_icerikler.guncelleme_tarihi is
  'İsteğe bağlı "son güncellenme" tarihi — doluysa GitHub''a yayınlanınca front-matter''daki guncelleme_tarihi alanına (bkz. dosyaIcerigiOlustur) taşınır, "Sadece Supabase''te Yayınla" ile kalırsa sadece_supabase_yazi_getir()/taslak_onizleme_getir() üzerinden ilgili sayfada "Güncellendi: ..." olarak gösterilir. "tarih" (orijinal yayın tarihi) alanından bağımsızdır, onu hiçbir şekilde değiştirmez.';

-- ----------------------------------------------------------------------------
-- taslak_onizleme_getir(): döndürülen kolonlara `guncelleme_tarihi` eklendi —
-- gövdenin geri kalanı migration 0040'taki hâliyle AYNI (bkz. o migration'daki
-- Postgres RETURNS TABLE / DROP notu).
-- ----------------------------------------------------------------------------
drop function if exists public.taslak_onizleme_getir(text, text);

create or replace function public.taslak_onizleme_getir(p_tur text, p_kod text)
returns table (
  baslik            text,
  tarih             date,
  guncelleme_tarihi date,
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
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.govde, t.toc, t.pdf_url
  from public.taslak_icerikler t
  where t.tur = p_tur and t.onizleme_kod = p_kod
  limit 1;
$$;

grant execute on function public.taslak_onizleme_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sadece_supabase_yazi_getir(): aynı gerekçeyle DROP + yeniden CREATE,
-- döndürülen kolonlara `guncelleme_tarihi` eklendi — gövdenin geri kalanı
-- migration 0040'taki hâliyle AYNI.
-- ----------------------------------------------------------------------------
drop function if exists public.sadece_supabase_yazi_getir(text, text);

create or replace function public.sadece_supabase_yazi_getir(p_tur text, p_slug text)
returns table (
  baslik            text,
  tarih             date,
  guncelleme_tarihi date,
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
  select t.baslik, t.tarih, t.guncelleme_tarihi, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde, t.reklam, t.toc, t.pdf_url
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
-- 1) Panelden mevcut bir GitHub yazısını aç, hiçbir şey değiştirmeden
--    kaydet — "Tarih" alanının ORİJİNAL yayın tarihiyle dolu geldiğini ve
--    kayıttan sonra da AYNI kaldığını doğrula (artık boşalıp panelin
--    "bugün"e sıfırlamadığını gör).
-- 2) Aynı yazıda "Güncellenme tarihi" kutusuna bir tarih girip kaydet,
--    sayfada "... · Güncellendi: ..." ibaresinin göründüğünü doğrula.
-- 3) Bir taslağı "Sadece Supabase'te Yayınla" ile yayınla, güncelleme
--    tarihini doldur, /icerik/supabase-yazi.html?tur=...&slug=... ve gizli
--    /onizleme/?tur=...&kod=... sayfalarında da aynı ibarenin göründüğünü
--    kontrol et.
-- ============================================================================
