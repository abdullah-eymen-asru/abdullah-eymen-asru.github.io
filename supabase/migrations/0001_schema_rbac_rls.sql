-- ============================================================================
-- 0001_schema_rbac_rls.sql
-- Abdullah Eymen Asru — Kullanıcı Yönetimi, RBAC ve Özel İçerik Sistemi
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). Sıralama önemlidir, yukarıdan aşağı bozmadan çalıştır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Gerekli uzantılar
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) PROFİLLER TABLOSU
--    auth.users tablosuna DOKUNMUYORUZ (Supabase'in yönettiği tablo).
--    Onun yerine 1-1 ilişkili bir "profiles" tablosu tutuyoruz.
--    id -> auth.users.id ile ON DELETE CASCADE: kullanıcı Auth'tan silinince
--    profil satırı da otomatik silinir (GDPR/KVKK "Hesabımı Sil" akışının
--    veritabanı tarafındaki temeli budur).
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  avatar_url   text,
  bio          text,                       -- "Hakkımda" metni (admin veya kullanıcı düzenler)
  role         text not null default 'user'
               check (role in ('user', 'special_user', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Her auth.users satırına karşılık gelen genişletilmiş profil + rol bilgisi.';
comment on column public.profiles.role is 'user: normal kayıtlı üye | special_user: özel içeriklere erişimi olan üye | admin: tam yetkili yönetici';

-- updated_at otomatik güncellensin
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) YENİ KULLANICI KAYDINDA OTOMATİK PROFİL OLUŞTURMA
--    auth.users tablosuna INSERT olduğunda (Google OAuth veya e-posta/şifre
--    fark etmez, ikisi de aynı tabloya yazar) otomatik bir profiles satırı
--    açıyoruz. SECURITY DEFINER: auth şemasındaki trigger, normalde
--    kullanıcının erişemeyeceği public.profiles tablosuna bu fonksiyon
--    sayesinde yazabilir.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    'user'   -- YENİ KAYIT OLAN HERKES varsayılan olarak 'user'. special_user/admin
             -- yetkisi SADECE admin panelinden elle verilir. Kullanıcı asla
             -- kendi kaydıyla admin/special_user olamaz.
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3) ROL YÜKSELTME (PRIVILEGE ESCALATION) KORUMASI
--    RLS "update" politikası kullanıcının kendi profilini güncellemesine izin
--    verecek (ad, bio, avatar). Ama RLS satır bazlı çalışır, KOLON bazlı
--    kısıtlama yapamaz — yani "adını değiştirebilsin ama role kolonunu
--    değiştiremesin" kuralını RLS tek başına veremez. Bunu bir trigger ile
--    zorluyoruz: role kolonu değiştiyse VE isteği yapan admin değilse, hata
--    fırlatıp işlemi reddediyoruz.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if new.role is distinct from old.role then
    select role into caller_role from public.profiles where id = auth.uid();
    if caller_role is distinct from 'admin' then
      raise exception 'Rol değişikliği sadece admin tarafından yapılabilir.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_escalation on public.profiles;
create trigger trg_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- ----------------------------------------------------------------------------
-- 4) YARDIMCI FONKSİYON: is_admin()
--    RLS politikalarında tekrar tekrar "profiles tablosunda role='admin' mi"
--    diye alt-sorgu yazmak yerine, tek bir SECURITY DEFINER fonksiyon
--    kullanıyoruz. STABLE + security definer ile RLS'in kendi içinde
--    sonsuz döngüye girmesini (profiles select politikası profiles'a bakıyor
--    sorunu) engelliyoruz.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.has_content_access(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.content_access
    where content_id = p_content_id and user_id = auth.uid()
  ) or public.is_admin();
$$;

-- ----------------------------------------------------------------------------
-- 5) ÖZEL İÇERİK TABLOLARI (gizli makale / dosya)
-- ----------------------------------------------------------------------------
create table if not exists public.special_content (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text not null unique,
  summary      text,
  body_md      text,             -- gizli makale metni (Markdown)
  file_path    text,             -- Storage bucket 'ozel-dosyalar' içindeki yol (opsiyonel dosya eki)
  cover_image  text,
  is_published boolean not null default true,
  author_id    uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_content_updated_at on public.special_content;
create trigger trg_content_updated_at
  before update on public.special_content
  for each row execute function public.set_updated_at();

-- Hangi özel üyenin hangi içeriğe erişimi var (admin panelinden atanır)
create table if not exists public.content_access (
  content_id  uuid not null references public.special_content(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (content_id, user_id)
);

-- Site geneli tek satırlık ayarlar (ör. "Hakkımda" metni admin panelinden
-- düzenlenebilsin diye). Anasayfa bu satırı fetch edip statik metnin
-- üzerine yazar (JS olmadan da statik metin görünmeye devam eder).
create table if not exists public.site_settings (
  id          int primary key default 1 check (id = 1),   -- tek satır garantisi
  hakkimda_md text,
  updated_at  timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_settings_updated_at on public.site_settings;
create trigger trg_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) RLS'İ AKTİF ET
-- ----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.special_content enable row level security;
alter table public.content_access  enable row level security;
alter table public.site_settings   enable row level security;

-- ---- profiles politikaları ----
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- INSERT/DELETE elle yapılmaz: insert trigger (handle_new_user) ile,
-- delete ise auth.users cascade'i ile gerçekleşir. Bu yüzden profiles için
-- ayrı bir insert/delete politikası açmıyoruz (varsayılan: kapalı = güvenli).

-- ---- special_content politikaları ----
drop policy if exists "content_select_admin_or_granted" on public.special_content;
create policy "content_select_admin_or_granted"
  on public.special_content for select
  using (
    public.is_admin()
    or (is_published and public.has_content_access(id))
  );

drop policy if exists "content_write_admin_only" on public.special_content;
create policy "content_write_admin_only"
  on public.special_content for insert
  with check (public.is_admin());

drop policy if exists "content_update_admin_only" on public.special_content;
create policy "content_update_admin_only"
  on public.special_content for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "content_delete_admin_only" on public.special_content;
create policy "content_delete_admin_only"
  on public.special_content for delete
  using (public.is_admin());

-- ---- content_access politikaları ----
drop policy if exists "access_select_own_or_admin" on public.content_access;
create policy "access_select_own_or_admin"
  on public.content_access for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "access_write_admin_only" on public.content_access;
create policy "access_write_admin_only"
  on public.content_access for insert
  with check (public.is_admin());

drop policy if exists "access_delete_admin_only" on public.content_access;
create policy "access_delete_admin_only"
  on public.content_access for delete
  using (public.is_admin());

-- ---- site_settings politikaları ----
drop policy if exists "settings_select_anyone" on public.site_settings;
create policy "settings_select_anyone"
  on public.site_settings for select
  using (true);   -- Hakkımda herkese açık okunur (anonim ziyaretçi dahil)

drop policy if exists "settings_update_admin_only" on public.site_settings;
create policy "settings_update_admin_only"
  on public.site_settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 7) ADMİN İÇİN GÜVENLİ ROL DEĞİŞTİRME RPC'Sİ
--    Frontend doğrudan "update profiles set role=..." çağırmak yerine bu
--    fonksiyonu çağırır. Ekstra kontrol katmanı + tek bir audit noktası.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin rol değiştirebilir.';
  end if;
  if p_new_role not in ('user', 'special_user', 'admin') then
    raise exception 'Geçersiz rol: %', p_new_role;
  end if;
  update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.has_content_access(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 8) HESABI KENDİ VERİLERİYLE BİRLİKTE SİLME (KVKK/GDPR)
--    NOT: Bu fonksiyon sadece public şemadaki VERİLERİ temizler.
--    auth.users satırının kendisi ancak "service_role" yetkisiyle silinebilir
--    (Supabase güvenlik kısıtı) — bu yüzden gerçek Auth hesabı silme işlemi
--    aşağıdaki Edge Function (supabase/functions/delete-account) üzerinden
--    yapılır. Bu RPC, Edge Function tarafından "önce ilişkili veriyi temizle"
--    adımı olarak da kullanılabilir, ama zaten profiles->auth.users FK'si
--    ON DELETE CASCADE olduğu için auth.users silinince profiles ve ona bağlı
--    content_access satırları OTOMATİK silinir. Bu fonksiyon ekstra bir
--    güvenlik/temizlik katmanı olarak duruyor.
-- ----------------------------------------------------------------------------
create or replace function public.delete_own_profile_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.content_access where user_id = auth.uid();
  -- special_content.author_id ON DELETE SET NULL olduğu için admin'in
  -- yazdığı içerikler admin hesabı silinse bile kaybolmaz.
  delete from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_profile_data() to authenticated;

-- ----------------------------------------------------------------------------
-- 9) STORAGE BUCKET'LARI
--    a) 'ozel-dosyalar' -> PRIVATE. Gizli makale ekleri. Sadece admin +
--       content_access ile yetkilendirilmiş special_user erişebilir.
--    b) 'avatarlar'     -> PUBLIC-READ. Profil fotoğrafları. Herkes görebilir,
--       sadece sahibi kendi klasörüne yazabilir.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ozel-dosyalar', 'ozel-dosyalar', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatarlar', 'avatarlar', true)
on conflict (id) do update set public = true;

-- ---- 'ozel-dosyalar' politikaları ----
-- Dosya yolu KONVANSİYONU: "<special_content.id>/<dosya-adi>"
-- Böylece storage.foldername(name) ile ilk klasör segmenti = content_id olur
-- ve content_access tablosuyla eşleştirebiliriz.
drop policy if exists "ozel_dosya_select" on storage.objects;
create policy "ozel_dosya_select"
  on storage.objects for select
  using (
    bucket_id = 'ozel-dosyalar'
    and (
      public.is_admin()
      or public.has_content_access( (storage.foldername(name))[1]::uuid )
    )
  );

drop policy if exists "ozel_dosya_write" on storage.objects;
create policy "ozel_dosya_write"
  on storage.objects for insert
  with check (bucket_id = 'ozel-dosyalar' and public.is_admin());

drop policy if exists "ozel_dosya_update" on storage.objects;
create policy "ozel_dosya_update"
  on storage.objects for update
  using (bucket_id = 'ozel-dosyalar' and public.is_admin());

drop policy if exists "ozel_dosya_delete" on storage.objects;
create policy "ozel_dosya_delete"
  on storage.objects for delete
  using (bucket_id = 'ozel-dosyalar' and public.is_admin());

-- ---- 'avatarlar' politikaları ----
-- Dosya yolu KONVANSİYONU: "<user_id>/avatar.<uzanti>"
drop policy if exists "avatar_select_public" on storage.objects;
create policy "avatar_select_public"
  on storage.objects for select
  using (bucket_id = 'avatarlar');   -- bucket zaten public=true, ekstra açık okuma

drop policy if exists "avatar_write_own" on storage.objects;
create policy "avatar_write_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatarlar'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own"
  on storage.objects for update
  using (
    bucket_id = 'avatarlar'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatar_delete_own" on storage.objects;
create policy "avatar_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'avatarlar'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- BİTTİ. Şimdi kendini admin yapman gerekiyor (ilk admin elle atanır):
--
--   1) Siteden normal şekilde kayıt ol (Google veya e-posta).
--   2) Supabase Dashboard > SQL Editor içinde ÇALIŞTIR:
--
--      update public.profiles set role = 'admin' where email = 'SENIN_EPOSTAN@ornek.com';
--
--   Bundan sonraki tüm rol değişiklikleri /admin panelinden yapılabilir.
-- ============================================================================
