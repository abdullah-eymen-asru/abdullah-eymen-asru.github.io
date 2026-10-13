-- ============================================================================
-- 0089_guncel_onay_surumleri_rpc.sql
-- Gereksinim: 0064 (guncel_kvkk_surumu), 0070 (guncel_riza_surumu). Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase SQL Editor'de TEK SEFERDE çalıştır.
--
-- SORUN: İstemci (auth-guard.js → guncelOnaySurumleri) yürürlükteki Aydınlatma/Açık Rıza sürümünü site_ayarlari TABLOSUNDAN
--   okuyordu. Okunamazsa (RLS, 0087'nin uygulanmamış olması, geçici hata) "sürüm bilinmiyor" sayılıp KİMSE kilitlenmiyordu:
--   özellikle 'demo' rollü hesap (0083: tablolara restrictive RLS) yeni sürümü onaylamadan panele girebiliyordu.
-- ÇÖZÜM: sürümleri tabloya bağımlı olmadan veren dar bir SECURITY DEFINER RPC. Yalnızca iki herkese açık sürüm etiketini
--   döndürür (başka hiçbir kolon/satır yok); istemci önce tabloyu dener, olmazsa bu RPC'yi kullanır.
-- ============================================================================

create or replace function public.guncel_onay_surumleri()
returns table (kvkk text, riza text)
language sql
stable
security definer
set search_path = public
as $$
  select s.guncel_kvkk_surumu::text, coalesce(s.guncel_riza_surumu, s.guncel_kvkk_surumu)::text
    from public.site_ayarlari s
   where s.id = 1;
$$;

revoke all on function public.guncel_onay_surumleri() from public;
grant execute on function public.guncel_onay_surumleri() to anon, authenticated;

-- Doğrulama: select * from public.guncel_onay_surumleri();   -- tek satır: (v1.1, v1.1) gibi
