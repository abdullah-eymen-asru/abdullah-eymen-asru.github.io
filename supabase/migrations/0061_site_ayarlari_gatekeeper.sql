-- ============================================================================
-- 0061_site_ayarlari_gatekeeper.sql
-- "Alan Adı & Sayfa Erişim Kalkanı (Gatekeeper)" — veritabanı tarafı.
--
-- 0001-0060 sırayla daha önce çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir
-- (idempotent). Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
--
-- NE EKLENİYOR
--   1) public.site_ayarlari  — tek satırlık (singleton) konfigürasyon:
--        github_io_aktif / pages_dev_aktif  : alan adı komple açık-kapalı
--        kilitli_rotalar (jsonb)            : {"github.io": ["/blog"], "pages.dev": ["/iletisim"]}
--        bakim_mesaji, guncellenme_tarihi
--      SELECT : herkes (anon dahil)  — kilit ekranı ziyaretçiye gösterilecek.
--      UPDATE : SADECE owner (bkz. aşağıdaki "NEDEN admin DEĞİL owner" notu).
--   2) public.site_onizleme_izinleri — "kilitli siteyi görebilir" üye listesi.
--   3) public.gk_bypass_var_mi()     — gatekeeper.js'in tek çağırdığı RPC.
--   4) owner'a özel üç yönetim RPC'si (izin ver / listele / üye ara).
--
-- NEDEN profiles.can_bypass_maintenance KOLONU DEĞİL, AYRI TABLO:
--   0001'deki "profiles_update_own_or_admin" politikası herkesin KENDİ satırını
--   güncellemesine izin veriyor; prevent_role_self_escalation yalnızca `role`
--   kolonunu koruyor. profiles'a bir boolean eklenseydi, her üye
--   supabase.from('profiles').update({can_bypass_maintenance:true}) ile kendi kendine
--   kilidi aşma izni verebilirdi. Ayrı tablo + politikasız + SECURITY DEFINER RPC
--   (0048/0059/0060 deseni) bu açığı baştan kapatır.
--
-- NEDEN UPDATE "admin" DEĞİL "owner":
--   Panelde "Yetki Ayarları" sekmesi zaten owner'a özel (dashboard.js: role:"owner")
--   ve 0027/0031/0052 admin'i site genelini etkileyen ayarlardan bilerek ayırıyor.
--   Admin'e de açmak istersen aşağıdaki iki yerde public.is_owner() yerine
--   public.is_admin() yaz (is_admin() admin + owner'ı kapsar).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) kilitli_rotalar DOĞRULAYICISI
--    Biçim: {"github.io": ["/", "/blog"], "pages.dev": [...]}  — başka anahtar yok,
--    rota = "/" ya da "/kucuk-harf-rakam-_-" (en çok 60 karakter), liste başına en çok
--    50 rota, toplam 8 KB altı. Böylece panel dışı bir yoldan çöp/dev veri yazılamaz ve
--    gatekeeper.js'in her ziyarette indirdiği satır küçük kalır.
-- ----------------------------------------------------------------------------
create or replace function public.gk_rotalar_gecerli_mi(j jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if j is null or jsonb_typeof(j) <> 'object' or pg_column_size(j) > 8192 then
    return false;
  end if;
  for k, v in select key, value from jsonb_each(j) loop
    if k not in ('github.io', 'pages.dev') then
      return false;
    end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 50 then
      return false;
    end if;
    for e in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^/[a-z0-9_-]{0,60}$' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) TABLO: site_ayarlari (singleton)
-- ----------------------------------------------------------------------------
create table if not exists public.site_ayarlari (
  id                 int primary key default 1 check (id = 1),     -- tek satır garantisi
  github_io_aktif    boolean not null default true,
  pages_dev_aktif    boolean not null default true,
  kilitli_rotalar    jsonb   not null default '{"github.io": [], "pages.dev": []}'::jsonb
                     check (public.gk_rotalar_gecerli_mi(kilitli_rotalar)),
  bakim_mesaji       text    not null default 'Bu sayfa şu an bakımda. Kısa süre sonra yeniden açılacak.'
                     check (char_length(bakim_mesaji) <= 500),
  guncellenme_tarihi timestamptz not null default now()
);

comment on table public.site_ayarlari is
  'Gatekeeper (assets/js/core/gatekeeper.js) konfigürasyonu. Tek satır. Herkes okur (kilit ekranı için), sadece owner günceller.';
comment on column public.site_ayarlari.kilitli_rotalar is
  'Alan adı -> mantıksal rota anahtarları. Anahtarlar assets/js/core/gatekeeper.js ROTALAR kataloğundaki anahtarlardır (/, /blog, /projeler, /iletisim, /listelerim, /cv), dosya yolu değil.';

insert into public.site_ayarlari (id) values (1) on conflict (id) do nothing;

create or replace function public.gk_guncellenme_damgasi()
returns trigger
language plpgsql
as $$
begin
  new.guncellenme_tarihi := now();
  return new;
end;
$$;

drop trigger if exists trg_site_ayarlari_damga on public.site_ayarlari;
create trigger trg_site_ayarlari_damga
  before update on public.site_ayarlari
  for each row execute function public.gk_guncellenme_damgasi();

-- ----------------------------------------------------------------------------
-- 3) RLS
--    SELECT herkese; UPDATE sadece owner; INSERT/DELETE yok (politika da, grant da yok).
--    Kolon bazlı GRANT: id ve guncellenme_tarihi doğrudan değiştirilemez.
-- ----------------------------------------------------------------------------
alter table public.site_ayarlari enable row level security;

drop policy if exists "site_ayarlari_select_herkes" on public.site_ayarlari;
create policy "site_ayarlari_select_herkes"
  on public.site_ayarlari for select
  to anon, authenticated
  using (true);

drop policy if exists "site_ayarlari_update_owner" on public.site_ayarlari;
create policy "site_ayarlari_update_owner"
  on public.site_ayarlari for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

revoke all on public.site_ayarlari from public, anon, authenticated;
grant select on public.site_ayarlari to anon, authenticated;
grant update (github_io_aktif, pages_dev_aktif, kilitli_rotalar, bakim_mesaji)
  on public.site_ayarlari to authenticated;

-- ----------------------------------------------------------------------------
-- 4) "KİLİTLİ SİTEYİ GÖREBİLİR" ÜYE LİSTESİ
--    Politikasız tablo: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan.
--    owner ve (askıda olmayan) admin zaten otomatik geçer; bu tablo diğer roller
--    (editor/manager/special_user/user) için tek tek verilen istisnadır.
-- ----------------------------------------------------------------------------
create table if not exists public.site_onizleme_izinleri (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  veren_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.site_onizleme_izinleri is
  'Kilitli/bakımdaki siteyi (gatekeeper) yine de görebilen üyeler. Sadece owner yazar/okur (SECURITY DEFINER RPC''ler).';

alter table public.site_onizleme_izinleri enable row level security;
revoke all on public.site_onizleme_izinleri from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) gatekeeper.js'in çağırdığı RPC — kilidi aşabilir miyim?
--    JWT sunucuda doğrulanır (auth.uid()); getUser() ile ayrı bir Auth çağrısına gerek yok.
--    Askıya alınmış hesap (is_suspended) hiçbir koşulda geçemez (owner hariç).
-- ----------------------------------------------------------------------------
create or replace function public.gk_bypass_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      p.role = 'owner'
      or (
        not coalesce(p.is_suspended, false)
        and (
          p.role = 'admin'
          or exists (select 1 from public.site_onizleme_izinleri i where i.user_id = p.id)
        )
      )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

revoke all on function public.gk_bypass_var_mi() from public, anon;
grant execute on function public.gk_bypass_var_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 6) OWNER RPC'LERİ — izin ver/kaldır, listele, üye ara (0060 deseniyle aynı)
-- ----------------------------------------------------------------------------
create or replace function public.owner_site_onizleme_izni_ver(p_user_id uuid, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_rol text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: kilitli siteyi görme izni vermeyi sadece Site Sahibi (owner) yapabilir.';
  end if;

  if not p_izinli then
    delete from public.site_onizleme_izinleri where user_id = p_user_id;
    return;
  end if;

  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then
    raise exception 'Kullanıcı bulunamadı.';
  end if;
  if hedef_rol in ('owner', 'admin') then
    raise exception 'Bu kullanıcı (%) kilitli siteyi zaten otomatik görür; ayrıca izin gerekmez.', hedef_rol;
  end if;

  insert into public.site_onizleme_izinleri (user_id, veren_id)
  values (p_user_id, auth.uid())
  on conflict (user_id) do update set veren_id = auth.uid();
end;
$$;

revoke all on function public.owner_site_onizleme_izni_ver(uuid, boolean) from public, anon;
grant execute on function public.owner_site_onizleme_izni_ver(uuid, boolean) to authenticated;

create or replace function public.site_onizleme_izinlilerini_getir()
returns table (user_id uuid, full_name text, email text, rol text, izin_tarihi timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.user_id, p.full_name, p.email, p.role, i.created_at
  from public.site_onizleme_izinleri i
  join public.profiles p on p.id = i.user_id
  where public.is_owner()
  order by i.created_at desc;
$$;

revoke all on function public.site_onizleme_izinlilerini_getir() from public, anon;
grant execute on function public.site_onizleme_izinlilerini_getir() to authenticated;

create or replace function public.owner_site_onizleme_uye_ara(p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, izinli boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role,
         exists (select 1 from public.site_onizleme_izinleri i where i.user_id = p.id)
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.is_owner()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role not in ('owner', 'admin')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

revoke all on function public.owner_site_onizleme_uye_ara(text) from public, anon;
grant execute on function public.owner_site_onizleme_uye_ara(text) to authenticated;
