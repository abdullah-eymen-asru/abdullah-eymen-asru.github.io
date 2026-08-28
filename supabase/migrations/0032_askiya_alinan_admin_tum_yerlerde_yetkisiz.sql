-- ============================================================================
-- 0032_askiya_alinan_admin_tum_yerlerde_yetkisiz.sql
--
-- GÜVENLİK AÇIĞI DÜZELTMESİ (kritik, sistemik).
--
-- migration 0021, is_admin()'i "askıya alınan (is_suspended=true) bir admin
-- ANINDA, projedeki HER YERDE yetkisiz kalsın" garantisiyle TEK bir yerde
-- tanımlamıştı ve bunun "tek bir yerde yapılan bu değişiklik TÜM admin
-- yetkili noktalarını otomatik kapatır" dediği açıkça yazıyordu (bkz. o
-- migration'ın 2. bölümü). Ama bu iddia YANLIŞTI: is_admin() ilk tanımlandığı
-- 0021'den SONRA bile, projede admin'i başka rollerle birlikte (editor,
-- manager, owner) yetkilendiren BEŞ AYRI fonksiyon daha var ve bunların
-- HİÇBİRİ is_suspended'a bakmıyor — yani askıya alınmış bir admin, panelin
-- KENDİSİNİ değil ama Supabase'in REST/RPC API'sine DOĞRUDAN (panel dışından,
-- ör. tarayıcı konsolundan ya da bir script'ten, hâlâ geçerli olan eski oturum
-- token'ıyla) istek atarak şu yetkilerin TAMAMINI askıya alınmadan ÖNCEKİ gibi
-- kullanmaya devam edebiliyordu:
--
--   1) is_editor_or_admin()        -> içerik (taslak_icerikler) yazma/silme
--   2) is_manager_or_admin()       -> "İçerik Sorumlusu" yetkili işlemler
--   3) has_content_access()        -> özel/kısıtlı içeriklere blanket erişim
--   4) is_admin_or_owner_gorebilir() -> Admin Güvenliği listeleri (denetim
--      vakaları, admin listesi) — bilgi ifşası, ama yine de "askıda hiçbir
--      şey görmemeli" ilkesini bozuyordu
--   5) admin_force_signout_user()  -> BAŞKA bir kullanıcıyı zorla çıkışa
--      zorlayabilme — askıdaki bir admin'in kötüye kullanabileceği, gerçek
--      zarar verme potansiyeli olan bir yetkiydi
--
-- Bu, sadece "Cloudflare Worker'lar is_suspended'a bakmıyor" (bkz. bu
-- migration'la BİRLİKTE düzeltilen github_icerik_yonetim_worker.js ve
-- r2_storage_worker.js) sorununun kendisinden de önce gelen, VERİTABANI
-- KATMANINDAKİ asıl kök sebep — Worker'lar zaten kendi REST sorgularını
-- doğrudan service_role ile attığı için RLS'i hiç görmüyordu, ama has_
-- content_access() gibi asıl RLS politikalarının kullandığı fonksiyonlar
-- bile aynı boşluğa sahipti.
--
-- DÜZELTME: is_admin()'in kullandığı AYNI desen ("role X VE is_suspended
-- değilse") her beş fonksiyona da uygulanıyor. Sadece 'admin' rolü askıya
-- alınabildiği için (owner hiç askıya alınamaz, editor/manager/special_user
-- bu sisteme hiç dahil değil — bkz. migration 0021 admin_askiya_al'ın
-- p_hedef_admin_id parametresi SADECE role='admin' satırlarını kabul eder)
-- is_suspended kontrolünü TÜM rollere uygulamak zararsız (owner/manager/
-- editor/special_user'da bu bayrak zaten hep false).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) is_editor_or_admin() — migration 0022'deki son hâliyle AYNI, sadece
--    is_suspended kontrolü eklendi.
-- ----------------------------------------------------------------------------
create or replace function public.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'editor', 'manager', 'owner')
      and coalesce(is_suspended, false) = false
  );
$$;

-- ----------------------------------------------------------------------------
-- 2) is_manager_or_admin() — migration 0022'deki son hâliyle AYNI, sadece
--    is_suspended kontrolü eklendi.
-- ----------------------------------------------------------------------------
create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'manager', 'owner')
      and coalesce(is_suspended, false) = false
  );
$$;

-- ----------------------------------------------------------------------------
-- 3) has_content_access() — migration 0023'teki son hâliyle AYNI, sadece
--    blanket erişim veren ilk koşula is_suspended kontrolü eklendi. Diğer
--    iki koşul (content_access ataması VEYA is_admin()) zaten ya
--    rol-bağımsız ya da is_admin() üzerinden zaten korunuyordu.
-- ----------------------------------------------------------------------------
create or replace function public.has_content_access(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role <> 'user' and coalesce(is_suspended, false) = false
    )
    or exists (
      select 1 from public.content_access
      where content_id = p_content_id
        and user_id = auth.uid()
        and (son_gecerlilik_tarihi is null or son_gecerlilik_tarihi > now())
    )
    or public.is_admin();
$$;

-- ----------------------------------------------------------------------------
-- 4) is_admin_or_owner_gorebilir() — Admin Güvenliği sayfasındaki listeleri
--    (guvenlik_admin_listesi_getir, denetim_vakalarini_listele) kapı gibi
--    koruyor; ikisi de bu fonksiyonu çağırdığı için tek bir düzeltme
--    ikisine de otomatik yansıyor.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin_or_owner_gorebilir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'owner')
      and coalesce(is_suspended, false) = false
  );
$$;

-- ----------------------------------------------------------------------------
-- 5) admin_force_signout_user() — çağıran yetki kontrolüne is_suspended
--    eklendi; gövdenin geri kalanı (service_role muafiyeti, oturum silme)
--    migration 0022'deki hâliyle AYNI.
-- ----------------------------------------------------------------------------
create or replace function public.admin_force_signout_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role' then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'owner')
        and coalesce(is_suspended, false) = false
    ) then
      raise exception 'Yetkisiz işlem: sadece admin/owner bir kullanıcıyı zorla çıkışa zorlayabilir.';
    end if;
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- ============================================================================
-- BİTTİ. Test:
--   1) Bir test admin hesabını askıya al (Admin Güvenliği sayfasından, ya da
--      doğrudan: update public.profiles set is_suspended = true where id = '<test-admin-id>';)
--   2) O hesabın hâlâ geçerli bir oturum token'ıyla (panel dışından, ör.
--      tarayıcı konsolunda) taslak_icerikler'e insert/update/delete denemesi
--      artık RLS tarafından reddedilmeli (önceden is_editor_or_admin() true
--      dönüyordu, artık false döner).
--   3) guvenlik_admin_listesi_getir() / denetim_vakalarini_listele() RPC'lerini
--      o hesapla çağırmak artık boş sonuç dönmeli (is_admin_or_owner_gorebilir()
--      artık false).
--   4) update ... set is_suspended = false ... ile geri aç, her şeyin eskisi
--      gibi çalıştığını doğrula.
-- ============================================================================
