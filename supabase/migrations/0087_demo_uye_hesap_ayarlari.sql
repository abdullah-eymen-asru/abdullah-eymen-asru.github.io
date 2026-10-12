-- ============================================================================
-- 0087_demo_uye_hesap_ayarlari.sql
-- Gereksinim: 0083 (is_demo, demo izolasyonu), 0086. Tekrar çalıştırmak güvenlidir (idempotent).
--
-- AMAÇ: 'demo' rollü GERÇEK hesap "saf demo" olmasın — kendi hesap ayarlarını (ad-soyad, e-posta, şifre, 2FA,
-- oturumlar, KVKK, hesabı silme) gerçekten kullanabilsin. E-posta/şifre/2FA/oturum işlemleri Supabase Auth ve
-- SECURITY DEFINER RPC'ler üzerinden zaten RLS dışındadır; eksik olan iki şeydi:
--   1) profiles'ta ad/soyad güncelleme (0086 demo için UPDATE'i tamamen kapattı) -> aşağıdaki dar RPC.
--   2) site_ayarlari okuma (KVKK sürüm kontrolü; zaten herkese açık veri) -> demo için yalnızca SELECT açılır.
-- Diğer tüm tablolarda demo hâlâ hiçbir satır okuyamaz/yazamaz (0083).
-- ============================================================================

-- 1) Yalnızca KENDİ ad/soyadını değiştiren dar RPC (rol, e-posta vb. başka hiçbir kolona dokunmaz).
create or replace function public.demo_profil_ad_guncelle(p_first_name text, p_last_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sonuc jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if not public.is_demo() then
    raise exception 'Bu işlem yalnızca demo hesabı içindir.' using errcode = '42501';
  end if;
  update public.profiles
     -- NULL = o alana dokunma; '' = alanı temizle
     set first_name = case when p_first_name is null then first_name else nullif(left(btrim(p_first_name), 80), '') end,
         last_name  = case when p_last_name  is null then last_name  else nullif(left(btrim(p_last_name),  80), '') end
   where id = auth.uid()
  returning jsonb_build_object('id', id, 'first_name', first_name, 'last_name', last_name) into sonuc;
  return sonuc;
end;
$$;
revoke all on function public.demo_profil_ad_guncelle(text, text) from public, anon;
grant execute on function public.demo_profil_ad_guncelle(text, text) to authenticated;

-- 2) site_ayarlari: demo YALNIZCA okuyabilir (satırlar zaten anon'a açık; gatekeeper.js de okur). Yazma kapalı kalır.
drop policy if exists "demo_izolasyon_site_ayarlari" on public.site_ayarlari;
drop policy if exists "demo_izolasyon_site_ayarlari_ins" on public.site_ayarlari;
drop policy if exists "demo_izolasyon_site_ayarlari_upd" on public.site_ayarlari;
drop policy if exists "demo_izolasyon_site_ayarlari_del" on public.site_ayarlari;

create policy "demo_izolasyon_site_ayarlari_ins"
  on public.site_ayarlari as restrictive for insert to authenticated
  with check ((select not public.is_demo()));
create policy "demo_izolasyon_site_ayarlari_upd"
  on public.site_ayarlari as restrictive for update to authenticated
  using ((select not public.is_demo())) with check ((select not public.is_demo()));
create policy "demo_izolasyon_site_ayarlari_del"
  on public.site_ayarlari as restrictive for delete to authenticated
  using ((select not public.is_demo()));
