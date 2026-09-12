-- ============================================================================
-- 0047_admin_uye_arama_eposta_disari_sizdirmama.sql
--
-- KÖK DURUM: assets/js/chat.js içindeki aramaAdaylariniGetir() (admin'in
-- "Kime mesaj?" arama kutusunu besleyen fonksiyon), sunucudan
--   select("id, first_name, last_name, full_name, email")
-- ile TÜM profiles tablosunu (email dahil, hiçbir WHERE filtresi olmadan)
-- tek seferde çekip client-side filtreliyordu. Admin'in bu veriye RLS
-- üzerinden (is_admin()) zaten erişim hakkı olduğu için bu bir RLS ihlali
-- DEĞİL, ama gereksiz bir "over-fetching": arama kutusu ekrana sadece
-- full_name basıyor olsa da, Network sekmesinde tüm üyelerin e-postaları
-- tek bir JSON gövdesinde topluca görünür hale geliyordu.
--
-- ÇÖZÜM: migration 0030'daki ("email hiçbir zaman dönüşe girmesin, arama
-- ihtiyacı varsa mantığı sunucuya taşı") ile aynı prensip; bu sefer admin'in
-- kendi arama kutusu için. Arama METNİ sunucuya gönderiliyor, eşleştirme
-- (isim VE email üzerinden) veritabanında yapılıyor, ama DÖNÜŞ satırında
-- email hiç yok — sadece id/full_name/role. Böylece admin hâlâ e-postayla
-- arayabiliyor (0030'da bilinçli olarak feda edilen özellik burada admin
-- için geri geliyor, çünkü admin zaten meşru erişim sahibi), ama tüm üye
-- tablosunun e-postaları tek seferde client'a inmiyor; sadece arama
-- sorgusuna uyan birkaç satırın full_name'i dönüyor.
--
-- NOT: panel/uye-ayarlari.md + assets/js/uye-ayarlari.js İÇİN bu migration
-- HİÇBİR ŞEY DEĞİŞTİRMİYOR — orası zaten üye YÖNETİM tablosu, admin orada
-- e-postayı görüp düzenleyebilmeli (bu görünüm bilinçli ve gerekli). Bu
-- migration sadece "Kime mesaj?" arama kutusunun kullandığı chat.js
-- aramaAdaylariniGetir() akışını hedefliyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001'den 0046'ya kadarki migration'lar daha önce çalıştırılmış olmalı.
-- ============================================================================

drop function if exists public.admin_uye_arama(text);

create or replace function public.admin_uye_arama(arama_metni text)
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where public.is_admin()
    and (
      arama_metni is null
      or btrim(arama_metni) = ''
      or p.first_name ilike '%' || arama_metni || '%'
      or p.last_name  ilike '%' || arama_metni || '%'
      or p.full_name  ilike '%' || arama_metni || '%'
      or p.email      ilike '%' || arama_metni || '%'
    )
  order by p.full_name nulls last
  limit 8;
$$;

comment on function public.admin_uye_arama(text) is
  'Admin/owner''in mesajlaşma ekranındaki "Kime mesaj?" arama kutusu için: '
  'isim VE e-posta üzerinden eşleştirme sunucuda yapılır, ama dönüş '
  'satırında email HİÇ yer almaz (sadece id/full_name/role). Çağıran '
  'is_admin() değilse boş sonuç döner (fonksiyon içinde ayrıca kontrol '
  'edilir, RLS''e güvenilmez çünkü SECURITY DEFINER onu bypass eder). Amaç: '
  'tüm üye tablosunun e-postalarının toplu halde client''a (Network '
  'sekmesine) inmesini önlemek — bkz. migration 0030''daki aynı prensip.';

revoke execute on function public.admin_uye_arama(text) from public, anon;
grant  execute on function public.admin_uye_arama(text) to authenticated;

-- ============================================================================
-- BİTTİ. assets/js/chat.js içindeki aramaAdaylariniGetir() / arama input
-- listener'ı bu RPC'yi çağıracak şekilde ayrı bir commit'te güncellendi —
-- artık tüm profiles tablosunu (email dahil) tek seferde çekip client-side
-- filtrelemiyor, her tuş vuruşunda (debounce ile) bu fonksiyonu çağırıyor.
-- ============================================================================
