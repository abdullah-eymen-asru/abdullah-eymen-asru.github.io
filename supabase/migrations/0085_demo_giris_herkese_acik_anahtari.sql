-- ============================================================================
-- 0085_demo_giris_herkese_acik_anahtari.sql
-- Gereksinim: 0083 (demo_config). Tekrar çalıştırmak güvenlidir (idempotent). SQL Editor'de TEK SEFERDE çalıştır.
--
-- "Herkese açık demo girişi" anahtarı:
--   • VARSAYILAN KAPALI (false). Kapalıyken giriş sayfasında "Canlı Demo" düğmesi görünmez ve hesapsız (anonim) ziyaretçi
--     demoya giremez; yalnızca rolü 'demo' olan GERÇEK üyeler girer (Üye Ayarları › Rol › Demo (vitrin)).
--   • Yalnızca Site Sahibi açar/kapatır: owner_demo_herkese_acik_ayarla(boolean). Admin DEĞİŞTİREMEZ (adminlerDegistirebilir
--     anahtarı bunu kapsamaz).
--   • Okuma: demo_config_getir() (anon) artık 'herkeseAcik' (yalnızca true/false) de döner; başka hiçbir gizli veri yoktur.
--   NOT (dürüst sınır): anonim demo istemci tarafıdır (sahte veri, hiçbir gerçek istek yok). Bu anahtar demoya GİRİŞİ kapatır;
--   gerçek veri güvenliğini zaten 0083'teki RLS izolasyonu sağlar.
-- ============================================================================

alter table public.demo_config add column if not exists herkese_acik boolean not null default false;

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

create or replace function public.owner_demo_herkese_acik_ayarla(p_acik boolean)
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
     set herkese_acik = coalesce(p_acik, false), updated_at = now(), updated_by = auth.uid()
   where id = 1;
end $$;
revoke all on function public.owner_demo_herkese_acik_ayarla(boolean) from public, anon;
grant execute on function public.owner_demo_herkese_acik_ayarla(boolean) to authenticated;

-- Doğrulama:  select public.demo_config_getir() -> 'herkeseAcik'   (başlangıçta false)
