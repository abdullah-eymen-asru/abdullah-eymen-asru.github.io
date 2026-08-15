-- ============================================================================
-- 0013_taslak_icerikler_supabase_taslak_sistemi.sql
-- "Yayında değil" blog yazıları / akademik projeler artık GitHub deposuna
-- HİÇ commit edilmiyor — sadece bu tabloda (Supabase) duruyor, tarayıcıdan
-- sadece "/onizleme/?tur=...&kod=..." adresindeki gizli kodu bilen erişebiliyor.
-- "Yayınla" denince içerik buradan okunup GitHub'a commit edilir ve bu
-- tablodaki satır silinir; tekrar "Yayından Kaldır" denince GitHub'daki
-- dosya okunup buraya geri yazılır ve GitHub'daki dosya silinir.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0012 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TASLAK İÇERİKLER TABLOSU
--    /panel/github-yonetim.html panelinin ürettiği tek bir dosyanın (blog
--    yazısı veya akademik proje) GitHub'a hiç commit edilmemiş, sadece
--    Supabase'te duran hâli. Kolonlar bilerek panelin GitHub'a commit
--    ederken ürettiği front-matter alanlarıyla birebir eşleşiyor, böylece
--    "Yayınla" anında dosya içeriği aradaki hiçbir bilgi kaybı olmadan
--    yeniden üretilebiliyor.
-- ----------------------------------------------------------------------------
create table if not exists public.taslak_icerikler (
  id            uuid primary key default gen_random_uuid(),
  tur           text not null check (tur in ('blog', 'proje')),
  baslik        text not null,
  tarih         date not null,
  slug          text not null,
  dosya_yolu    text not null,               -- yayınlanınca GitHub'da oluşacak/oluşmuş olan yol (_posts/... veya _projects/...)
  venue         text,                        -- sadece tur='proje'
  durum         text,                        -- sadece tur='proje' ("Yayınlandı" / "Devam Ediyor" / "İnceleme Aşamasında")
  ozet          text,                        -- sadece tur='proje'
  link          text,                        -- sadece tur='proje'
  link_etiket   text,                        -- sadece tur='proje'
  govde         text not null default '',    -- Markdown gövde metni
  onizleme_kod  text not null,               -- gizli link kodu (bkz. /onizleme/?tur=...&kod=...)
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tur, onizleme_kod)
);

comment on table public.taslak_icerikler is
  '"Yayında değil" blog yazıları/akademik projeler — GitHub''a commit edilmeden önce (veya yayından kaldırıldıktan sonra) burada durur. Sadece admin panelden (github-yonetim) ve gizli önizleme linkinden (RPC üzerinden) erişilir.';

drop trigger if exists trg_taslak_icerikler_updated_at on public.taslak_icerikler;
create trigger trg_taslak_icerikler_updated_at
  before update on public.taslak_icerikler
  for each row execute function public.set_updated_at();

create index if not exists idx_taslak_icerikler_tur on public.taslak_icerikler (tur);

-- ----------------------------------------------------------------------------
-- 2) RLS — SADECE ADMİN OKUYUP/YAZABİLİR
--    "Mevcut İçerikler" listesinde taslakların görünmesi, düzenlenebilmesi,
--    silinebilmesi ve GitHub'a yayınlanabilmesi (ki bu Supabase satırını
--    silmeyi de içerir) hep admin panelinden, admin'in kendi Supabase Auth
--    oturumuyla yapılır. Anonim/normal kullanıcıların bu tabloyu DOĞRUDAN
--    okuyup listeleyebilmesi KESİNLİKLE istenmiyor — gizli önizleme linkine
--    sahip birinin bile tüm taslakları görebilmesi bir gizlilik ihlali olur.
--    Bu yüzden anonim erişim aşağıdaki (3) numaralı RPC üzerinden, SADECE
--    tur+kod tam eşleşmesiyle TEK bir satır döndürülerek sağlanıyor.
-- ----------------------------------------------------------------------------
alter table public.taslak_icerikler enable row level security;

drop policy if exists "taslak_admin_tum_islemler" on public.taslak_icerikler;
create policy "taslak_admin_tum_islemler"
  on public.taslak_icerikler for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3) GİZLİ ÖN İZLEME RPC'Sİ — /onizleme/?tur=...&kod=... SAYFASI KULLANIR
--    SECURITY DEFINER olduğu için RLS'i (yukarıdaki admin-only politikayı)
--    by-pass eder, ama SADECE tur+kod tam eşleşen TEK satırı ve SADECE
--    görüntüleme için gereken alanları döndürür — id, created_by gibi iç
--    alanları döndürmez, tabloyu listelemeye izin vermez (parametresiz veya
--    joker aramaya izin yoktur, yalnızca birebir eşleşme). anon (giriş
--    yapmamış ziyaretçi) ve authenticated (giriş yapmış herhangi bir üye)
--    rollerine EXECUTE izni veriliyor ki link, siteye giriş yapmamış biri
--    tarafından da açılabilsin.
-- ----------------------------------------------------------------------------
create or replace function public.taslak_onizleme_getir(p_tur text, p_kod text)
returns table (
  baslik      text,
  tarih       date,
  venue       text,
  durum       text,
  ozet        text,
  link        text,
  link_etiket text,
  govde       text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.govde
  from public.taslak_icerikler t
  where t.tur = p_tur and t.onizleme_kod = p_kod
  limit 1;
$$;

grant execute on function public.taslak_onizleme_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Not: created_by kolonu bilgi amaçlıdır, hiçbir politika/RPC buna bakmaz
-- (tüm adminler tüm taslakları görüp yönetebilir — tıpkı diğer admin-only
-- tablolar gibi). Panel bu kolona satır eklerken auth.uid() değerini yazar.
-- ============================================================================
