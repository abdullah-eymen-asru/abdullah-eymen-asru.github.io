-- ============================================================================
-- 0103_demo_ust_anahtarlar_onarim.sql
-- "Yetki Ayarları › Demo Görünürlük › Yetki Kontrolü" üst seviye anahtarlarının onarımı.
-- Gereksinim: 0021 (is_owner), 0083 (demo_config), 0085 (herkese_acik). Tekrar çalıştırmak güvenlidir (idempotent).
-- SQL Editor'de TEK SEFERDE çalıştır.
--
-- NEDEN (kök neden — "tıklayınca hiçbir şey olmuyor")
--   1) 0085 uygulanmamış / yarım uygulanmışsa `herkese_acik` kolonu ve owner_demo_herkese_acik_ayarla() yoktur; istemci
--      PostgREST'ten 404/42883 alır. Eski arayüz hatayı sayfanın EN ALTINDAKİ bir kutuya yazıp hemen ardından tüm paneli
--      yeniden çizdiği için kullanıcı hata görmez, anahtar kendi kendine eski konumuna dönerdi ("tepki vermiyor").
--   2) Eski RPC'ler `update ... where id = 1` yapıyordu: demo_config satırı yoksa 0 satır güncellenir, HATA VERMEZ, istemci
--      "kaydedildi" sanırdı. Artık satır yoksa oluşturulur (upsert) ve yazılan değer geri döndürülür.
--   3) RPC'ler `void` döndüğü için istemci sunucunun gerçekte ne yazdığını doğrulayamıyordu. Artık jsonb döner:
--      { admin_degistirebilir, herkese_acik } — arayüz bu değerle çizer (iyimser değil, doğrulanmış durum).
--   4) PostgREST şema önbelleği: yeni/yeniden tanımlı fonksiyonlar için en sonda `notify pgrst, 'reload schema'`.
--
-- GÜVENLİK (değişmedi): yalnızca Site Sahibi (is_owner) iki anahtarı da değiştirir; demo rolü demo_guard() ile dışarıda.
-- Admin DEĞİŞTİREMEZ (adminlerDegistirebilir yalnızca matrisi kapsar, bu iki global anahtarı değil).
-- ============================================================================

-- 0) Şema güvencesi -------------------------------------------------------------------------------
alter table public.demo_config add column if not exists admin_degistirebilir boolean not null default false;
alter table public.demo_config add column if not exists herkese_acik          boolean not null default false;

-- Tek satır her zaman var olsun (0083 ekler; silinmişse/eksikse burada geri gelir). Varsayılan: herkese açık KAPALI.
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
revoke all on public.demo_config from public, anon, authenticated;   -- doğrudan erişim YOK; yalnızca SECURITY DEFINER RPC'ler

-- 1) Okuma RPC'leri (anon + authenticated: yalnızca görünürlük/durum bayrakları, gizli veri yok) -------
create or replace function public.demo_config_getir()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select c.config || jsonb_build_object('adminlerDegistirebilir', c.admin_degistirebilir, 'herkeseAcik', c.herkese_acik)
  from public.demo_config c where c.id = 1;
$$;
revoke all on function public.demo_config_getir() from public;
grant execute on function public.demo_config_getir() to anon, authenticated;

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
    'herkese_acik',         c.herkese_acik,
    'can_edit',             coalesce(p.role = 'owner'
                              or (p.role = 'admin' and not coalesce(p.is_suspended, false) and c.admin_degistirebilir), false))
  from public.demo_config c
  left join public.profiles p on p.id = auth.uid()
  where c.id = 1;
$$;
revoke all on function public.demo_config_yonetim_durumu() from public, anon;
grant execute on function public.demo_config_yonetim_durumu() to authenticated;

-- 2) Yazma RPC'leri — jsonb döner (dönüş tipi değiştiği için önce drop) ---------------------------------
drop function if exists public.owner_demo_admin_izni_ayarla(boolean);
drop function if exists public.owner_demo_herkese_acik_ayarla(boolean);

create or replace function public.owner_demo_admin_izni_ayarla(p_acik boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.demo_config;
begin
  if p_acik is null then raise exception 'Geçersiz değer (null).' using errcode = '22004'; end if;
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501';
  end if;
  update public.demo_config
     set admin_degistirebilir = p_acik, updated_at = now(), updated_by = auth.uid()
   where id = 1
  returning * into r;
  if not found then raise exception 'demo_config satırı bulunamadı (0083/0103 çalıştırıldı mı?).' using errcode = 'P0002'; end if;
  return jsonb_build_object('admin_degistirebilir', r.admin_degistirebilir, 'herkese_acik', r.herkese_acik);
end $$;
revoke all on function public.owner_demo_admin_izni_ayarla(boolean) from public, anon;
grant execute on function public.owner_demo_admin_izni_ayarla(boolean) to authenticated;

create or replace function public.owner_demo_herkese_acik_ayarla(p_acik boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.demo_config;
begin
  if p_acik is null then raise exception 'Geçersiz değer (null).' using errcode = '22004'; end if;
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501';
  end if;
  update public.demo_config
     set herkese_acik = p_acik, updated_at = now(), updated_by = auth.uid()
   where id = 1
  returning * into r;
  if not found then raise exception 'demo_config satırı bulunamadı (0083/0103 çalıştırıldı mı?).' using errcode = 'P0002'; end if;
  return jsonb_build_object('admin_degistirebilir', r.admin_degistirebilir, 'herkese_acik', r.herkese_acik);
end $$;
revoke all on function public.owner_demo_herkese_acik_ayarla(boolean) from public, anon;
grant execute on function public.owner_demo_herkese_acik_ayarla(boolean) to authenticated;

-- 3) PostgREST şema önbelleğini yenile ---------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- DOĞRULAMA (SQL Editor'de, Site Sahibi hesabıyla değil — editörde auth.uid() null olur; bu yüzden yalnızca okuma testleri):
--   select public.demo_config_getir();                     -- 'herkeseAcik' ve 'adminlerDegistirebilir' alanları görünmeli
--   select column_name from information_schema.columns where table_name = 'demo_config';   -- herkese_acik, admin_degistirebilir
--   select proname, prorettype::regtype from pg_proc where proname in
--     ('owner_demo_admin_izni_ayarla','owner_demo_herkese_acik_ayarla');                   -- ikisi de jsonb
-- Yazma testi panelden yapılır (Site Sahibi oturumu gerekir): anahtarı aç → "Kaydedildi" bandı + sayfa yenilenince aynı durum.
-- ============================================================================
