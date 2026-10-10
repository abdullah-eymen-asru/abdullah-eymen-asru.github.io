-- ============================================================================
-- 0077_donusturucu_yetkisi.sql
-- "Evrensel Dosya Dönüştürücü & Tarayıcı İçi Belge Düzenleyici" modülünün yetki katmanı.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0021 (is_owner, is_suspended), 0001 (set_updated_at tetikleyicisi isteğe bağlı).
--
-- NE EKLENİYOR
--   1) public.donusturucu_yetkileri — can_use_converter anahtarı (rol bazlı, VARSAYILAN KAPALI).
--        owner her zaman yetkilidir (satır gerekmez). admin / manager / editor / special_user / user
--        rolleri için owner (veya owner'ın yetki verdiği admin) tek tıkla açıp kapatır.
--        Gerekçe: 0074'teki can_export_system ile aynı yaklaşım (varsayılan KAPALI, satır yok = kapalı).
--   2) public.donusturucu_ayar — tek satırlık ayar: admin_yonetebilir
--        false (varsayılan): yalnızca owner anahtarları değiştirebilir.
--        true: askıda olmayan adminler de manager / editor / special_user / user için açıp kapatabilir.
--        Admin ASLA admin rolünün anahtarını değiştiremez ve bu ayarın kendisini değiştiremez.
--   3) RPC'ler (hepsi SECURITY DEFINER, tablolara istemci erişimi YOK):
--        donusturucu_yetkisi_var_mi()               → aracı kullanabilir mi? (menü + Guard)
--        donusturucu_yonetim_yetkisi_var_mi()       → anahtarları yönetebilir mi? (owner / yetkili admin)
--        donusturucu_yetkilerini_getir()            → yönetilebilir roller + mevcut durum
--        donusturucu_yetkisi_ayarla(rol, izinli)    → tek rolü aç/kapat
--        owner_donusturucu_admin_yonetimi_ayarla(b) → adminlere yönetim yetkisi ver/geri al
--
-- NOT: Dönüştürücü %100 istemci tarafında çalışır; hiçbir dosya Supabase'e / R2'ye / Worker'a gitmez.
--      Bu migration yalnızca "kim aracı açabilir" sorusunu yönetir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLOLAR
-- ----------------------------------------------------------------------------
create table if not exists public.donusturucu_yetkileri (
  rol                text primary key check (rol in ('admin', 'manager', 'editor', 'special_user', 'user')),
  can_use_converter  boolean not null default false,
  guncelleyen_id     uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now()
);
comment on table public.donusturucu_yetkileri is
  'can_use_converter anahtarı (rol bazlı). Satır yoksa = KAPALI. owner her zaman yetkilidir (satır gerekmez). İstemci erişimi yok; yalnızca SECURITY DEFINER RPC''ler.';

create table if not exists public.donusturucu_ayar (
  id                 smallint primary key default 1 check (id = 1),
  admin_yonetebilir  boolean not null default false,
  guncelleyen_id     uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now()
);
comment on table public.donusturucu_ayar is
  'Tek satırlık ayar. admin_yonetebilir=true ise askıda olmayan adminler, admin DIŞINDAKİ rollerin can_use_converter anahtarını değiştirebilir.';
insert into public.donusturucu_ayar (id) values (1) on conflict (id) do nothing;

alter table public.donusturucu_yetkileri enable row level security;
alter table public.donusturucu_ayar      enable row level security;
revoke all on public.donusturucu_yetkileri from public, anon, authenticated;
revoke all on public.donusturucu_ayar      from public, anon, authenticated;
-- (politika yok: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan)

-- ----------------------------------------------------------------------------
-- 2) YETKİ: can_use_converter  (menü görünürlüğü + Guard bunu sorar)
-- ----------------------------------------------------------------------------
create or replace function public.donusturucu_yetkisi_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'owner'
        or (
          not coalesce(p.is_suspended, false)
          and exists (
            select 1 from public.donusturucu_yetkileri y
            where y.rol = p.role and y.can_use_converter
          )
        )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.donusturucu_yetkisi_var_mi() from public, anon;
grant execute on function public.donusturucu_yetkisi_var_mi() to authenticated;

-- Anahtarları yönetebilir mi? owner her zaman; admin yalnızca owner izin verdiyse ve askıda değilse.
create or replace function public.donusturucu_yonetim_yetkisi_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'owner'
        or (
          p.role = 'admin'
          and not coalesce(p.is_suspended, false)
          and coalesce((select a.admin_yonetebilir from public.donusturucu_ayar a where a.id = 1), false)
        )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.donusturucu_yonetim_yetkisi_var_mi() from public, anon;
grant execute on function public.donusturucu_yonetim_yetkisi_var_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) OKUMA: yönetilebilir roller + mevcut durum
--    owner  → 5 rol (admin dahil) + admin_yonetebilir bayrağı (yonetilebilir=true her satırda)
--    admin  → yalnızca admin DIŞINDAKİ 4 rol (admin satırı görünmez); bayrak okunur ama değiştirilemez
-- ----------------------------------------------------------------------------
create or replace function public.donusturucu_yetkilerini_getir()
returns table (rol text, can_use_converter boolean, updated_at timestamptz, admin_yonetebilir boolean, owner_mi boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner boolean := public.is_owner();
  v_flag  boolean := coalesce((select a.admin_yonetebilir from public.donusturucu_ayar a where a.id = 1), false);
begin
  if not public.donusturucu_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: dönüştürücü yetkilerini yönetme yetkin yok.';
  end if;
  return query
  select r.rol,
         coalesce(y.can_use_converter, false),
         y.updated_at,
         v_flag,
         v_owner
  from (values ('admin'), ('manager'), ('editor'), ('special_user'), ('user')) as r(rol)
  left join public.donusturucu_yetkileri y on y.rol = r.rol
  where v_owner or r.rol <> 'admin'
  order by case r.rol when 'admin' then 1 when 'manager' then 2 when 'editor' then 3 when 'special_user' then 4 else 5 end;
end;
$$;
revoke all on function public.donusturucu_yetkilerini_getir() from public, anon;
grant execute on function public.donusturucu_yetkilerini_getir() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) YAZMA: tek rolü aç/kapat
-- ----------------------------------------------------------------------------
create or replace function public.donusturucu_yetkisi_ayarla(p_rol text, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner boolean := public.is_owner();
begin
  if not public.donusturucu_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: dönüştürücü yetkilerini yönetme yetkin yok.';
  end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then
    raise exception 'Geçersiz rol: % (admin, manager, editor, special_user, user).', p_rol;
  end if;
  -- admin rolünün anahtarını yalnızca owner değiştirir (admin kendi yetkisini genişletemez).
  if p_rol = 'admin' and not v_owner then
    raise exception 'Yetkisiz işlem: yönetici (admin) rolünün anahtarını yalnızca Site Sahibi değiştirebilir.';
  end if;

  insert into public.donusturucu_yetkileri as y (rol, can_use_converter, guncelleyen_id)
  values (p_rol, coalesce(p_izinli, false), auth.uid())
  on conflict (rol) do update
    set can_use_converter = excluded.can_use_converter,
        guncelleyen_id    = excluded.guncelleyen_id,
        updated_at        = now();
end;
$$;
revoke all on function public.donusturucu_yetkisi_ayarla(text, boolean) from public, anon;
grant execute on function public.donusturucu_yetkisi_ayarla(text, boolean) to authenticated;

-- Adminlere "diğer rollerin anahtarını değiştirme" yetkisi ver / geri al (yalnızca owner).
create or replace function public.owner_donusturucu_admin_yonetimi_ayarla(p_acik boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  insert into public.donusturucu_ayar as a (id, admin_yonetebilir, guncelleyen_id)
  values (1, coalesce(p_acik, false), auth.uid())
  on conflict (id) do update
    set admin_yonetebilir = excluded.admin_yonetebilir,
        guncelleyen_id    = excluded.guncelleyen_id,
        updated_at        = now();
end;
$$;
revoke all on function public.owner_donusturucu_admin_yonetimi_ayarla(boolean) from public, anon;
grant execute on function public.owner_donusturucu_admin_yonetimi_ayarla(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) updated_at otomasyonu (0001'deki set_updated_at varsa; yoksa sessizce atlanır)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'set_updated_at') then
    execute 'drop trigger if exists trg_donusturucu_yetkileri_updated_at on public.donusturucu_yetkileri';
    execute 'create trigger trg_donusturucu_yetkileri_updated_at before update on public.donusturucu_yetkileri
             for each row execute function public.set_updated_at()';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- HIZLI KONTROL (isteğe bağlı):
--   select public.donusturucu_yetkisi_var_mi();            -- owner ile giriş yapmışsan true
--   select * from public.donusturucu_yetkilerini_getir();  -- owner: 5 satır
-- ----------------------------------------------------------------------------
