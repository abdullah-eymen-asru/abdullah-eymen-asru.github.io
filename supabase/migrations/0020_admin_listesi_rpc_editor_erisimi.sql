-- ============================================================================
-- 0020_admin_listesi_rpc_editor_erisimi.sql
-- BUG DÜZELTMESİ: "Admin adına yayınla (onay gerekir)" kutusu role='editor'
-- için TAMAMEN ÇALIŞMIYORDU — panel "Yazar bilgisi belirlenemedi (profil
-- adı boş)" hatası veriyor, işaretlense bile admin onayına hiç gitmiyordu.
--
-- KÖK NEDEN:
--   assets/js/github-yonetim.js içindeki wireAdminAdinaTalep(), hedef admin
--   listesini doğrudan `supabase.from("profiles").select(...).eq("role",
--   "admin")` ile çekiyor. Ama migration 0016 § 3, profiles tablosunun
--   SELECT RLS politikasını `auth.uid() = id or public.is_manager_or_admin()`
--   olarak güncellemişti — is_manager_or_admin() SADECE role in
--   ('admin','manager') için true döner, 'editor' İÇİN DEĞİL. Sonuç: bir
--   editor bu sorguyu attığında RLS, kendi satırı dışındaki HER satırı
--   (adminler dahil) sessizce filtreliyor — hata fırlatmıyor, sadece BOŞ bir
--   liste dönüyor. Panelin JS'i bunu "admin yok" sanıp hedef seçimini boş
--   bırakıyor, kullanıcı "Admin adına yayınla" kutusunu işaretleyince
--   ADMIN_ADINA_HEDEF = { id: null, ad: "" } oluyor ve kayıt anında "Yazar
--   bilgisi belirlenemedi" hatasına düşüyordu — dosya başındaki yorumda
--   ("editor için de manager ile BİREBİR aynı şekilde çalışır") vaat edilen
--   davranış hiç gerçekleşmiyordu.
--
-- ÇÖZÜM:
--   RLS politikasını gevşetmek yerine (editor'ün TÜM profilleri
--   görebilmesi gereksiz bir bilgi sızıntısı olurdu — email adresleri gibi),
--   sadece bu ihtiyaç için dar kapsamlı bir SECURITY DEFINER RPC ekliyoruz:
--   admin_listesi_getir(). RLS'i by-pass eder ama SADECE role='admin'
--   satırlarının id/full_name/email alanlarını döner ve SADECE zaten içerik
--   yönetebilen (editor/manager/admin) kullanıcılara açıktır — tıpkı
--   taslak_onizleme_getir'in (migration 0013) sadece dar bir görünüm
--   sunması gibi aynı desen.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0019 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

create or replace function public.admin_listesi_getir()
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.role = 'admin'
    and public.is_editor_or_admin()
  order by p.full_name nulls last;
$$;

comment on function public.admin_listesi_getir() is
  'İçerik yönetebilen herkese (editor/manager/admin) admin profillerinin '
  'dar bir görünümünü (id, full_name, email) döner — "Admin adına yayınla" '
  'seçeneğindeki hedef admin dropdown''ı için. profiles tablosunun RLS''i '
  'editor''ü (sadece admin/manager''ı) kapsadığından bu RPC olmadan editor '
  'için liste her zaman boş dönüyordu (bkz. dosya başı notu). RLS''i '
  'by-pass eder ama SADECE role=''admin'' satırlarını ve SADECE bu üç alanı '
  'döner — editor bu RPC üzerinden başka hiçbir profili göremez.';

grant execute on function public.admin_listesi_getir() to authenticated;

-- ============================================================================
-- BİTTİ. assets/js/github-yonetim.js içindeki wireAdminAdinaTalep() artık
-- doğrudan `.from("profiles")...` yerine `supabase.rpc("admin_listesi_getir")`
-- çağırıyor (bkz. ilgili commit) — editor VE manager için birebir aynı
-- şekilde admin listesini görebiliyor.
-- ============================================================================
