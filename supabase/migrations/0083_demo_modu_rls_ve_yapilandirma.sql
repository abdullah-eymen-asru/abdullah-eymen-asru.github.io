-- ============================================================================
-- 0083_demo_modu_rls_ve_yapilandirma.sql
-- "Demo / Vitrin Modu": ziyaretçi gerçek veriye ASLA dokunamaz + canlı görünürlük yapılandırması.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0001 (profiles), 0021 (is_owner / is_admin), 0067.
--
-- NE EKLENİYOR
--   1) profiles.role kısıtına 'demo' rolü.
--   2) public.is_demo() — çağıran 'demo' rolünde mi?
--   3) VERİ İZOLASYONU: RLS'i açık HER public tabloya (profiles, notlar, r2_arsiv, denetim_kayitlari,
--      sistem_export_loglari … hepsi) ve storage.objects'e RESTRICTIVE politika: demo rolü SELECT dahil
--      HİÇBİR komutu çalıştıramaz (restrictive politika, mevcut permissive politikaların hepsiyle AND'lenir;
--      yani yarın eklenen yeni bir permissive politika bile demo'ya satır açamaz). Demo rolüne hiçbir
--      INSERT/UPDATE/DELETE izni zaten verilmez.
--   4) public.demo_config (tek satır, RLS açık, doğrudan erişim YOK) + yalnızca SECURITY DEFINER RPC'ler:
--        demo_config_getir()            anon + authenticated  → yalnızca görünürlük JSON'u (gizli veri yok)
--        demo_config_yonetim_durumu()   authenticated         → {can_edit, is_owner, admin_degistirebilir}
--        demo_config_kaydet(jsonb)      owner HER ZAMAN; admin yalnızca owner "adminler değiştirebilsin" derse
--        owner_demo_admin_izni_ayarla() yalnızca owner
--   5) owner_demo_rolu_ata(uuid, bool) — yalnızca owner; (isteğe bağlı) GERÇEK bir demo hesabı için.
--      İstemci tarafı demo, Supabase'e hiç istek atmayan sahte oturumla çalışır; bu rol yalnızca
--      "gerçek hesapla da demoya girilsin" senaryosu içindir ve yukarıdaki izolasyonla kilitlidir.
--
-- NOT (SECURITY DEFINER RPC'ler): is_admin()/is_owner() 'demo' için zaten false döner; çağıranın kendi
-- verisini (auth.uid()) döndüren RPC'lerde demo hesabının verisi yoktur. Ek olarak demo_guard() yardımcısı
-- tanımlanır; hassas yeni RPC yazarken ilk satıra `perform public.demo_guard();` koy.
-- ============================================================================

-- 1) 'demo' rolü ---------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'special_user', 'admin', 'editor', 'manager', 'owner', 'demo'));

comment on column public.profiles.role is
  'user | special_user | editor | manager | admin | owner (Site Sahibi) | demo: salt-okunur vitrin hesabı — hiçbir tablodan satır okuyamaz/yazamaz (bkz. 0083 restrictive politikalar).';

-- 2) is_demo() / demo_guard() ----------------------------------------------------
create or replace function public.is_demo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role = 'demo' from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.is_demo() from public, anon;
grant execute on function public.is_demo() to authenticated;

create or replace function public.demo_guard()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_demo() then
    raise exception 'Bu işlem vitrin (demo) modunda salt-okunurdur.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.demo_guard() from public, anon;
grant execute on function public.demo_guard() to authenticated;

-- 3) Veri izolasyonu: RLS açık HER public tabloya restrictive "demo yok" politikası ------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', 'demo_izolasyon_' || t.relname, t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select not public.is_demo())) with check ((select not public.is_demo()))',
      'demo_izolasyon_' || t.relname, t.relname);
  end loop;
end $$;

-- RLS'i KAPALI public tablo var mı? (Uyarı: o tablo izolasyon dışında kalır; RLS açmak gerekir.)
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    raise warning '0083: public.% tablosunda RLS kapalı — demo izolasyonu uygulanamadı, RLS''i aç.', t.relname;
  end loop;
end $$;

-- Storage nesneleri (R2 değil, Supabase Storage: cv-dosyalari vb.): demo yalnızca HERKESE AÇIK okumayı görür.
drop policy if exists "demo_izolasyon_storage_objects" on storage.objects;
create policy "demo_izolasyon_storage_objects"
  on storage.objects as restrictive for insert to authenticated
  with check ((select not public.is_demo()));
drop policy if exists "demo_izolasyon_storage_objects_upd" on storage.objects;
create policy "demo_izolasyon_storage_objects_upd"
  on storage.objects as restrictive for update to authenticated
  using ((select not public.is_demo())) with check ((select not public.is_demo()));
drop policy if exists "demo_izolasyon_storage_objects_del" on storage.objects;
create policy "demo_izolasyon_storage_objects_del"
  on storage.objects as restrictive for delete to authenticated
  using ((select not public.is_demo()));

-- 4) demo_config (tek satır) --------------------------------------------------------------------
create table if not exists public.demo_config (
  id                   int primary key default 1 check (id = 1),     -- tek satır garantisi
  config               jsonb not null,
  admin_degistirebilir boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null
);

comment on table public.demo_config is
  'Demo/vitrin modu görünürlük matrisi (tek satır). Doğrudan erişim YOK; yalnızca demo_config_* RPC''leri.';

-- Varsayılan matris: her şey AÇIK (vitrin). Anahtar sözleşmesi istemcide assets/js/demo/demo-durum.js -> VARSAYILAN_CONFIG.
insert into public.demo_config (id, config) values (1, jsonb_build_object(
  'v', 1,
  'hub',    jsonb_build_object('aktif', true, 'kartlar', jsonb_build_object(
              'content-notlar', true, 'media-arsiv', true, 'lib-kutuphane', true, 'sys-metrik', true)),
  'pdf',    jsonb_build_object('aktif', true, 'duzenlemeAraclari', true),
  'arsiv',  jsonb_build_object('aktif', true, 'zipInceleme', true),
  'notlar', jsonb_build_object('aktif', true, 'filtreCipleri', true),
  'sistem', jsonb_build_object('aktif', true)
)) on conflict (id) do nothing;

alter table public.demo_config enable row level security;
revoke all on public.demo_config from public, anon, authenticated;
-- Politika YOK → tablo yalnızca aşağıdaki SECURITY DEFINER fonksiyonlardan erişilir.

-- Yapı doğrulayıcı: yalnızca beklenen anahtarlar, yaprakların hepsi boolean.
create or replace function public.demo_config_gecerli_mi(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  izinli constant jsonb := jsonb_build_object(
    'hub',    jsonb_build_array('aktif', 'kartlar'),
    'pdf',    jsonb_build_array('aktif', 'duzenlemeAraclari'),
    'arsiv',  jsonb_build_array('aktif', 'zipInceleme'),
    'notlar', jsonb_build_array('aktif', 'filtreCipleri'),
    'sistem', jsonb_build_array('aktif'));
  kart_izinli constant text[] := array['content-notlar', 'media-arsiv', 'lib-kutuphane', 'sys-metrik'];
  bolum text; alan text; kart text; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4000 then return false; end if;
  for bolum in select k from jsonb_object_keys(p) k loop
    if bolum = 'v' then
      if jsonb_typeof(p -> 'v') <> 'number' then return false; end if;
    elsif not (izinli ? bolum) then return false;
    else
      if jsonb_typeof(p -> bolum) <> 'object' then return false; end if;
      for alan in select k from jsonb_object_keys(p -> bolum) k loop
        if not (izinli -> bolum) ? alan then return false; end if;
        v := p -> bolum -> alan;
        if bolum = 'hub' and alan = 'kartlar' then
          if jsonb_typeof(v) <> 'object' then return false; end if;
          for kart in select k from jsonb_object_keys(v) k loop
            if not (kart = any (kart_izinli)) or jsonb_typeof(v -> kart) <> 'boolean' then return false; end if;
          end loop;
        elsif jsonb_typeof(v) <> 'boolean' then return false;
        end if;
      end loop;
    end if;
  end loop;
  return true;
end $$;

-- Okuma: demo ziyaretçisi oturumsuzdur (anon) → anon'a da açık. Yalnızca görünürlük JSON'u döner.
create or replace function public.demo_config_getir()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select c.config || jsonb_build_object('adminlerDegistirebilir', c.admin_degistirebilir)
  from public.demo_config c where c.id = 1;
$$;
revoke all on function public.demo_config_getir() from public;
grant execute on function public.demo_config_getir() to anon, authenticated;

-- Panel için: bu kullanıcı yapılandırmayı değiştirebilir mi?
create or replace function public.demo_config_yonetim_durumu()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_owner',             coalesce(p.role = 'owner', false),
    'is_admin',             coalesce(p.role in ('admin', 'owner') and not coalesce(p.is_suspended, false), false),
    'admin_degistirebilir', c.admin_degistirebilir,
    'can_edit',             coalesce(p.role = 'owner'
                              or (p.role = 'admin' and not coalesce(p.is_suspended, false) and c.admin_degistirebilir), false))
  from public.demo_config c
  left join public.profiles p on p.id = auth.uid()
  where c.id = 1;
$$;
revoke all on function public.demo_config_yonetim_durumu() from public, anon;
grant execute on function public.demo_config_yonetim_durumu() to authenticated;

-- Yazma: owner her zaman; admin yalnızca global anahtar açıksa (askıdaki admin asla).
create or replace function public.demo_config_kaydet(p_config jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rol text; askida boolean; izin boolean;
begin
  perform public.demo_guard();
  select p.role, coalesce(p.is_suspended, false) into rol, askida from public.profiles p where p.id = auth.uid();
  select c.admin_degistirebilir into izin from public.demo_config c where c.id = 1;
  if rol is distinct from 'owner' and not (rol = 'admin' and not askida and coalesce(izin, false)) then
    raise exception 'Yetkisiz işlem: demo yapılandırmasını değiştirme yetkin yok.' using errcode = '42501';
  end if;
  if not public.demo_config_gecerli_mi(p_config) then
    raise exception 'Geçersiz demo yapılandırması.';
  end if;
  update public.demo_config
     set config = p_config - 'adminlerDegistirebilir', updated_at = now(), updated_by = auth.uid()
   where id = 1;
end $$;
revoke all on function public.demo_config_kaydet(jsonb) from public, anon;
grant execute on function public.demo_config_kaydet(jsonb) to authenticated;

-- Global anahtar: "Adminler bu demo yetkilerini değiştirebilsin mi?" — YALNIZCA owner.
create or replace function public.owner_demo_admin_izni_ayarla(p_acik boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501';
  end if;
  update public.demo_config
     set admin_degistirebilir = coalesce(p_acik, false), updated_at = now(), updated_by = auth.uid()
   where id = 1;
end $$;
revoke all on function public.owner_demo_admin_izni_ayarla(boolean) from public, anon;
grant execute on function public.owner_demo_admin_izni_ayarla(boolean) to authenticated;

-- 5) (İsteğe bağlı) gerçek bir hesabı demo rolüne al / geri al — yalnızca owner ------------------
create or replace function public.owner_demo_rolu_ata(p_user_id uuid, p_demo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare hedef text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501';
  end if;
  select role into hedef from public.profiles where id = p_user_id;
  if hedef is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  if hedef = 'owner' then raise exception 'Site Sahibi demo rolüne alınamaz.'; end if;
  if p_demo and hedef <> 'demo' then
    update public.profiles set role = 'demo' where id = p_user_id;
  elsif not p_demo and hedef = 'demo' then
    update public.profiles set role = 'user' where id = p_user_id;
  end if;
end $$;
revoke all on function public.owner_demo_rolu_ata(uuid, boolean) from public, anon;
grant execute on function public.owner_demo_rolu_ata(uuid, boolean) to authenticated;

-- admin_set_user_role 'demo' vermez (0001/0021 listesinde yok) → admin kendini/başkasını demo yapamaz,
-- demo'dan da çıkaramaz (askıdaki/demo hesabın rolü yalnızca owner_demo_rolu_ata ile değişir).
