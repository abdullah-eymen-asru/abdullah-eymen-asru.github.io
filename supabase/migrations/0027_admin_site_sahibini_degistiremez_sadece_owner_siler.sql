-- ============================================================================
-- 0027_admin_site_sahibini_degistiremez_sadece_owner_siler.sql
--
-- İSTEK: "Yönetici olanlar kendisinin üstü olan site sahibinde değişiklik
-- yapamasın, silemesin veritabanında. Sadece e posta kurtarma seçeneği
-- kalsın. Hatta site sahibi dışında kimse herhangi bir üyeyi silemesin."
--
-- İKİ AYRI KISIT:
--
--   § A) SIRADAN BİR ADMİN, SİTE SAHİBİNİN (owner) PROFİLİNDE DEĞİŞİKLİK
--        YAPAMAZ: profiles tablosunun UPDATE RLS politikası şimdiye kadar
--        `auth.uid() = id or is_admin()` idi — is_admin() hem 'admin' hem
--        'owner' rolünü kapsadığı için (migration 0021), HERHANGİ bir admin
--        owner'ın satırını (ör. Ad/Soyad — bkz. assets/js/uye-ayarlari.js
--        "uya-isim-input" alanları) doğrudan UPDATE edebiliyordu. Rol
--        değişikliği zaten ayrı RPC'lerle (admin_set_user_role,
--        migration 0021/0024) owner hedefine kapalıydı, ama DİĞER kolonlar
--        (isim vb.) bu genel politika üzerinden hâlâ açıktı. Politika artık
--        şöyle: bir admin (owner OLMAYAN), hedef satırın role='owner'
--        OLMADIĞI durumlarda yazabilir; owner'ın kendi satırına SADECE
--        kendisi (auth.uid()=id) ya da başka bir owner (is_owner()) yazabilir.
--        "Sadece e-posta kurtarma seçeneği kalsın" isteği ise BU RLS
--        politikasını ETKİLEMEZ ve BİLİNÇLİ OLARAK dokunulmuyor —
--        admin-change-email Edge Function'ı service_role ile (RLS'i
--        bypass ederek) çalışıyor ve kilitli kalan bir hesabın e-posta
--        kurtarma ihtiyacını karşılıyor; bu tek istisna kasıtlı olarak
--        AÇIK bırakılıyor (bkz. dosya sonundaki not).
--
--   § B) SADECE SİTE SAHİBİ (owner) HERHANGİ BİR ÜYEYİ SİLEBİLİR: Eskiden
--        (bkz. supabase/functions/delete-account/index.ts) hem 'admin' hem
--        'owner' rolündeki HERKES başka bir kullanıcıyı silebiliyordu — bu
--        aynı zamanda bir admin'in owner'ı silebilmesi anlamına da
--        geliyordu (owner'ı askıya almak/rolünü değiştirmek migration
--        0021'de zaten engellenmişti ama SİLMEK hiç engellenmemişti). Artık
--        SADECE owner, KENDİSİ DIŞINDA bir kullanıcıyı silebilir (bkz. ayrı
--        commit: delete-account/index.ts). Herkesin KENDİ hesabını silme
--        hakkı (Hesabımı Sil / Kendi Yetkimi Düşür değil, gerçek hesap
--        silme) DOKUNULMADI — bu kişisel bir haktır ve bu değişikliğin
--        kapsamı dışındadır; sadece BAŞKASINI silme yetkisi owner'a
--        daraltıldı.
--
-- Bu migration'ın kapsamı SADECE § A'daki veritabanı (RLS) tarafı — § B
-- tamamen supabase/functions/delete-account/index.ts (Edge Function) içinde
-- uygulanıyor, çünkü gerçek silme zaten oradaki service_role çağrısıyla
-- yapılıyor (profiles tablosunda zaten hiçbir DELETE RLS politikası yok,
-- bkz. migration 0002 sonundaki not — "INSERT/DELETE elle yapılmaz").
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0026 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (
    auth.uid() = id
    or public.is_owner()
    or (public.is_admin() and role <> 'owner')
  )
  with check (
    auth.uid() = id
    or public.is_owner()
    or (public.is_admin() and role <> 'owner')
  );

comment on policy "profiles_update_own_or_admin" on public.profiles is
  'Herkes kendi satırını güncelleyebilir. Owner her satırı güncelleyebilir. Sıradan bir admin (owner DEĞİL) ise SADECE role <> ''owner'' olan satırları güncelleyebilir — site sahibinin profiline (isim vb.) hiçbir admin doğrudan yazamaz. (Rol alanının kendisi zaten ayrı RPC''lerle — admin_set_user_role/owner_rolu_ver — korunuyor, bkz. migration 0021/0024; bu politika onun ÜZERİNE, isim gibi diğer kolonlar için de aynı korumayı ekliyor.) admin-change-email Edge Function''ı service_role ile çalıştığı için bu politikadan ETKİLENMEZ — "e-posta kurtarma" bilhassa istisna olarak açık bırakılmıştır.';

-- ============================================================================
-- BİTTİ. Ekstra kurulum adımı gerekmiyor — bu migration çalıştığı anda:
--
--   1) Sıradan bir admin, "Kullanıcılar & Roller" sayfasında Site
--      Sahibi'nin kartındaki Ad/Soyad kutularını düzenleyip kaydetmeye
--      çalışırsa artık bir RLS hatası alır (panel tarafı da ayrı bir
--      commit'te bu kutuları owner-dışı adminler için salt-okunur hâle
--      getirdi ve "Sil" butonunu sadece owner'a gösterecek şekilde
--      güncellendi, bkz. assets/js/uye-ayarlari.js).
--   2) Rol değişikliği zaten önceden owner hedefine kapalıydı — bu turda
--      bir şey değişmedi.
--   3) "Başka birini silme" yetkisi artık SADECE owner'da (bkz.
--      supabase/functions/delete-account/index.ts — bu dosyayı yeniden
--      deploy etmen gerekiyor: `supabase functions deploy delete-account`).
--      Herkesin kendi hesabını silme hakkı aynen duruyor.
--   4) admin-change-email (Edge Function) HİÇ değişmedi — admin, kilitli
--      kalmış (eski e-postasına erişimi olmayan) Site Sahibi dahil her
--      kullanıcı için hâlâ "e-posta kurtarma" işlemini yapabilir; bu,
--      kasıtlı olarak bırakılan TEK istisna.
-- ============================================================================
