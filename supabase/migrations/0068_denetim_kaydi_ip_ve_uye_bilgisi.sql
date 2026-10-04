-- ============================================================================
-- 0068_denetim_kaydi_ip_ve_uye_bilgisi.sql
-- "Admin Güvenliği > Denetim Kaydı (Audit Log)" zenginleştirmesi.
--
-- 0052 ve 0067 çalıştırılmış olmalı (0067'deki gk_uye_goruntusu() kullanılır).
-- Tekrar çalıştırmak güvenlidir (idempotent). SQL Editor'e yapıştırıp çalıştır.
--
-- NE EKLENİYOR
--   1) denetim_kayitlari.ip / user_agent : worker'ın (github_icerik_yonetim_worker)
--      artık gönderdiği istemci IP'si ve tarayıcı bilgisi. Eski kayıtlarda boş kalır.
--   2) denetim_kayitlari.aktor_bilgi : işlemi yapan üyenin O ANKİ anlık görüntüsü
--      (ad, e-posta, rol, hesap durumu, üyelik/son giriş, KVKK onayları...). Worker
--      service_role ile yazdığı için görüntü BEFORE INSERT trigger'ıyla veritabanında
--      alınır; worker'ın ayrıca bir şey göndermesi gerekmez. Güvenlik alanları
--      (2FA yedek kodu sayaçları vb.) gk_uye_goruntusu()'nun beyaz listesi sayesinde
--      asla alınmaz.
--   3) owner_uye_goruntusu(uuid) : eski kayıtlar (aktor_bilgi boş) için panelin
--      "güncel bilgi" göstermesini sağlayan, SADECE owner'ın çağırabildiği RPC.
--
-- Silme yetkisi zaten sadece owner'da (0052: owner_denetim_kaydi_sil /
-- owner_denetim_kayitlarini_temizle + RLS). Burada o kurallara dokunulmuyor.
-- ============================================================================

alter table public.denetim_kayitlari
  add column if not exists ip          text,
  add column if not exists user_agent  text,
  add column if not exists aktor_bilgi jsonb not null default '{}'::jsonb;

comment on column public.denetim_kayitlari.aktor_bilgi is
  'İşlemi yapan üyenin kayıt anındaki anlık görüntüsü (beyaz listeli alanlar, bkz. gk_uye_goruntusu). Sonradan ad/rol değişse ya da hesap silinse de kayıt donuk kalır.';

create or replace function public.denetim_kaydi_goruntu_doldur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.aktor_id is not null and (new.aktor_bilgi is null or new.aktor_bilgi = '{}'::jsonb) then
    new.aktor_bilgi := public.gk_uye_goruntusu(new.aktor_id);
  end if;
  new.user_agent := left(new.user_agent, 300);
  return new;
end;
$$;

drop trigger if exists trg_denetim_kaydi_goruntu on public.denetim_kayitlari;
create trigger trg_denetim_kaydi_goruntu
  before insert on public.denetim_kayitlari
  for each row execute function public.denetim_kaydi_goruntu_doldur();

create or replace function public.owner_uye_goruntusu(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_owner() then public.gk_uye_goruntusu(p_user_id) else '{}'::jsonb end;
$$;

revoke all on function public.owner_uye_goruntusu(uuid) from public, anon;
grant execute on function public.owner_uye_goruntusu(uuid) to authenticated;
