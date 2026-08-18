-- ============================================================================
-- 0030_mesaj_hedef_listesi_eposta_kaldirma.sql
--
-- İstek: "Mesajlar ekranında (Kime mesaj atmak istiyorsun? penceresi) hiçbir
-- kullanıcıya mail adresleri ifşa olmasın/yazmasın. E-posta tarayıcıda da
-- görünmesin, sadece erişimi olanlar görebilsin, olmayanlar kaynaklardan
-- (ağ isteği/DevTools dahil) da bulamasın."
--
-- KÖK DURUM: assets/js/chat.js'teki hedefListesiniCiz() ekrandan e-posta
-- gösterimini zaten kaldırmıştı (önceki commit), AMA bu YETERSİZDİ:
-- migration 0025'teki public.mesaj_hedef_listesi_getir() fonksiyonu
-- SECURITY DEFINER olduğundan RLS'i (profiles_select_own_or_admin, bkz.
-- 0001 — normal bir üye başka bir profili SEÇEMEZ) BİLEREK bypass edip
-- admin/owner satırlarını normal bir üyeye döndürüyordu. Yani e-posta
-- HÂLÂ ağ yanıtında (tarayıcı DevTools > Network, ya da RPC'yi doğrudan
-- çağıran biri için) mevcuttu — sadece ekrana YAZDIRILMIYORDU. Bu
-- migration fonksiyonun DÖNÜŞ SATIRINDAN email sütununu tamamen kaldırıp
-- sorunu kaynağında (veritabanı/API seviyesinde) çözüyor.
--
-- NOT (arama kutusu): "İsim veya e-posta ile ara..." kutusu artık SADECE
-- isimle eşleşir — e-posta hiç istemciye gelmediği için e-posta metniyle
-- arama yapılamaz hâle geldi (assets/js/mesajlar.js'teki placeholder metni
-- de "İsim ile ara..." olarak güncellendi). Bu, "e-posta hiçbir yerde
-- ifşa olmasın" isteğinin doğal bir sonucu — sunucu tarafında e-postayı
-- GERİ DÖNDÜRMEDEN e-postayla eşleştirme yapmak (arama metnini sunucuya
-- gönderip orada filtrelemek) ayrı ve çok daha büyük bir değişiklik
-- gerektirir; şu an için "hiç ifşa olmasın" tercihi "e-postayla arama"
-- özelliğinden daha öncelikli sayıldı.
--
-- Admin/owner'ların KENDİ panellerinde (ör. panel/uye-ayarlari.md,
-- mesajlar.html içinde admin'in üye arama kutusu) üyelerin e-postasını
-- görmesi BİLEREK DEĞİŞTİRİLMEDİ — onlar zaten RLS üzerinden (is_admin())
-- tüm profillere meşru erişimi olan taraf ("erişimi olanlar").
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001'den 0029'a kadarki migration'lar daha önce çalıştırılmış olmalı.
-- ============================================================================

drop function if exists public.mesaj_hedef_listesi_getir();

create or replace function public.mesaj_hedef_listesi_getir()
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where p.role in ('admin', 'owner')
    and coalesce(p.is_suspended, false) = false
  order by (p.role = 'owner') desc, p.full_name nulls last;
$$;

comment on function public.mesaj_hedef_listesi_getir() is
  'Mesajlaşma "Kime?" penceresinde üyenin arayıp seçebileceği admin+site '
  'sahibi listesi — herhangi bir authenticated kullanıcı çağırabilir (RLS''i '
  'bypass eder) ama SADECE id/full_name/role döner — e-posta artık HİÇ '
  'dönmez (bkz. migration 0030, önceki sürümde email de dönüyordu).';

revoke execute on function public.mesaj_hedef_listesi_getir() from public, anon;
grant  execute on function public.mesaj_hedef_listesi_getir() to authenticated;

-- ============================================================================
-- BİTTİ. assets/js/chat.js (hedefAdaylariniYukle / hedefListesiniCiz) ve
-- assets/js/mesajlar.js (arama kutusu placeholder'ı) bu yeni dönüş şekline
-- göre ayrı bir commit'te güncellendi.
-- ============================================================================
