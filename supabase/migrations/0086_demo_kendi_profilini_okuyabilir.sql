-- ============================================================================
-- 0086_demo_kendi_profilini_okuyabilir.sql
-- Gereksinim: 0083 (is_demo, demo izolasyonu). Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase SQL Editor'de TEK SEFERDE çalıştır.
--
-- SORUN: 0083, RLS'i açık HER tabloya (profiles dahil) 'demo' rolü için "for all" restrictive politika koyuyordu:
--   demo hesabı KENDİ profil satırını bile okuyamıyordu. Giriş doğru olsa da istemci (auth-guard.js -> requireAuth)
--   profilini okuyamayıp "oturum yok" gibi davranıyor ve kullanıcıyı giriş sayfasına geri atıyordu.
--
-- ÇÖZÜM: profiles için izolasyon komut komut yeniden kurulur:
--   SELECT : demo YALNIZCA kendi satırını okuyabilir (rolünü/adını öğrenmek için; başka hiçbir üyenin satırı görünmez).
--   INSERT / UPDATE / DELETE : demo için YİNE tamamen kapalı.
-- Diğer tüm tablolar ve storage.objects izolasyonu 0083'teki gibi AYNEN kalır (demo orada hiçbir satır okuyamaz/yazamaz).
-- (Kendi satırının içeriği: e-posta, ad, rol, onay bayrakları — zaten kendi bilgileri; yönetim verisi/başkasının verisi yok.)
-- ============================================================================

drop policy if exists "demo_izolasyon_profiles" on public.profiles;
drop policy if exists "demo_izolasyon_profiles_sel" on public.profiles;
drop policy if exists "demo_izolasyon_profiles_ins" on public.profiles;
drop policy if exists "demo_izolasyon_profiles_upd" on public.profiles;
drop policy if exists "demo_izolasyon_profiles_del" on public.profiles;

create policy "demo_izolasyon_profiles_sel"
  on public.profiles as restrictive for select to authenticated
  using ((select not public.is_demo()) or id = (select auth.uid()));

create policy "demo_izolasyon_profiles_ins"
  on public.profiles as restrictive for insert to authenticated
  with check ((select not public.is_demo()));

create policy "demo_izolasyon_profiles_upd"
  on public.profiles as restrictive for update to authenticated
  using ((select not public.is_demo())) with check ((select not public.is_demo()));

create policy "demo_izolasyon_profiles_del"
  on public.profiles as restrictive for delete to authenticated
  using ((select not public.is_demo()));

-- Doğrulama (demo hesabıyla giriş yapmışken): select id, role from public.profiles;  -> TEK satır (kendisi)
-- Aynı hesapla:  update public.profiles set first_name = 'x';                         -> 0 satır / izin hatası
