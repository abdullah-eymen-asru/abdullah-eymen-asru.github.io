-- ============================================================================
-- 0005_dosya_paylasim_admin_paneli.sql
-- Abdullah Eymen Asru — R2 Dosya Paylaşım & Admin Paneli mimarisi:
-- indirme_loglari tablosu + RLS politikaları.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001-0004'ü DEĞİŞTİRMİYORUZ, üzerine ek yapıyoruz (public.is_admin()
-- fonksiyonunun zaten var olduğunu varsayar — bkz. 0001).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLO
--    Her presigned link üretimini (Worker tarafından service_role ile)
--    kaydeder: kim, hangi dosyayı, ne zaman indirmek için link istedi.
-- ----------------------------------------------------------------------------
create table if not exists public.indirme_loglari (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  dosya_adi text not null,
  created_at timestamptz not null default now()
);

comment on table public.indirme_loglari is
  'Cloudflare Worker (r2-imza-worker) tarafından, her presigned R2 indirme linki üretiminde otomatik yazılan log kaydı.';
comment on column public.indirme_loglari.dosya_adi is
  'R2 bucket içindeki tam nesne yolu (key), ör. "3f2504e0-.../rapor.pdf".';

create index if not exists indirme_loglari_user_id_idx on public.indirme_loglari(user_id);
create index if not exists indirme_loglari_created_at_idx on public.indirme_loglari(created_at desc);

-- ----------------------------------------------------------------------------
-- 2) RLS
--    - Worker, service_role anahtarıyla yazdığı için RLS'i zaten BYPASS
--      eder (service_role tüm RLS politikalarının üzerindedir) — bu
--      yüzden ayrı bir "insert" politikasına gerek YOK ve bilhassa
--      anon/authenticated rollerine insert izni VERMİYORUZ (dışarıdan
--      sahte log yazılmasını engellemek için).
--    - Kullanıcılar sadece KENDİ loglarını görebilir.
--    - Adminler tüm logları görebilir.
-- ----------------------------------------------------------------------------
alter table public.indirme_loglari enable row level security;

drop policy if exists "kendi_loglarini_gor" on public.indirme_loglari;
create policy "kendi_loglarini_gor"
  on public.indirme_loglari
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Ne anon ne de authenticated için INSERT/UPDATE/DELETE politikası
-- tanımlanmadı -> bu tabloya sadece service_role (Worker) yazabilir.

revoke insert, update, delete on public.indirme_loglari from authenticated, anon;
grant select on public.indirme_loglari to authenticated;
