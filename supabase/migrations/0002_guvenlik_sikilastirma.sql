-- ============================================================================
-- 0002_guvenlik_sikilastirma.sql
-- Abdullah Eymen Asru — Security Advisor uyarılarını giderme + büyük dosya
-- (Cloudflare R2 vb.) linki desteği
--
-- Bu dosyayı da Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001_schema_rbac_rls.sql'i DEĞİŞTİRMİYORUZ, üzerine ek yapıyoruz — bu
-- yüzden 0001'i tekrar çalıştırmana gerek yok, sadece bunu çalıştır.
--
-- NE İÇİN: Dashboard > Advisors > Security Advisor'da görünen "Warnings"
-- (uyarılar — hata değil) şu 3 başlığı kapsıyordu:
--   1) Function Search Path Mutable       -> set_updated_at() düzeltiliyor
--   2) Public Bucket Allows Listing       -> 'avatarlar' bucket'ının listeleme
--                                             izni kaldırılıyor
--   3) Public/Signed-In Can Execute
--      SECURITY DEFINER Function          -> tüm fonksiyonlardan PUBLIC'in
--                                             EXECUTE izni kaldırılıp sadece
--                                             gerçekten ihtiyacı olan role'e
--                                             (anon/authenticated) veriliyor
-- ÖNEMLİ: Bunların HİÇBİRİ "RLS kapalı" anlamına gelmiyordu — RLS zaten
-- 0001'de tüm tablolarda aktifti (Advisor'da "Errors" sekmesi 0 gösteriyordu,
-- sadece "Warnings" vardı). Bu dosya sadece savunma derinliğini artırıyor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) FUNCTION SEARCH PATH MUTABLE — set_updated_at()
--    Diğer tüm fonksiyonlarda "set search_path = public" zaten vardı, sadece
--    bu ikisinde unutulmuştu. search_path sabitlenmezse, teorik olarak biri
--    aynı isimde bir fonksiyonu session'ın search_path'ine sokup bu trigger'ı
--    "kandırabilir" (schema injection). Sabitleyince bu ihtimal kapanıyor.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) SECURITY DEFINER FONKSİYONLARDA PUBLIC EXECUTE İZNİNİ KAPATMA
--    PostgreSQL'de yeni bir fonksiyon oluşturulduğunda EXECUTE izni
--    varsayılan olarak "PUBLIC" rolüne (yani anon dahil HERKESE) açık gelir.
--    0001'de bazı fonksiyonlara "authenticated"a ayrıca grant verilmişti ama
--    PUBLIC'ten hiç REVOKE edilmemişti — yani hem PUBLIC hem authenticated
--    çalıştırabiliyordu. Şimdi PUBLIC'i kapatıp SADECE gerçekten çağırması
--    gereken role'lere izin veriyoruz.
--
--    Tetikleyici (trigger) fonksiyonları (handle_new_user,
--    prevent_role_self_escalation, set_updated_at) hiçbir kullanıcı
--    tarafından SQL/RPC ile DOĞRUDAN çağrılmaz — sadece trigger mekanizması
--    çağırır ve bu, çağıranın EXECUTE izninden bağımsız çalışır. Bu yüzden
--    bunlarda PUBLIC'i kapattıktan sonra kimseye tekrar grant vermiyoruz.
-- ----------------------------------------------------------------------------
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.prevent_role_self_escalation() from public;

-- is_admin() ve has_content_access(): RLS politikalarının USING/WITH CHECK
-- ifadeleri içinde çağrılıyor — bu çağrı, sorguyu çalıştıran role'ün
-- (anon veya authenticated) EXECUTE izniyle yapılır. Bu ikisini SADECE
-- PUBLIC'ten alıp anon + authenticated'a AÇIKÇA veriyoruz (fonksiyonellik
-- aynı kalıyor, sadece "herkes" yerine "sadece bu iki role" izinli oluyor).
revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to anon, authenticated;

revoke execute on function public.has_content_access(uuid) from public;
grant  execute on function public.has_content_access(uuid) to anon, authenticated;

-- admin_set_user_role() ve delete_own_profile_data(): sadece giriş yapmış
-- kullanıcı tarafından .rpc() ile elle çağrılır (admin paneli / hesap silme).
-- Anonim bir ziyaretçinin bunu çağırmasına gerek yok, PUBLIC'i kapatıp
-- sadece authenticated'da bırakıyoruz (0001'deki grant zaten authenticated'a
-- vardı, burada sadece PUBLIC'i kapatıyoruz).
revoke execute on function public.admin_set_user_role(uuid, text) from public;
revoke execute on function public.delete_own_profile_data() from public;

-- ----------------------------------------------------------------------------
-- 3) PUBLIC BUCKET ALLOWS LISTING — 'avatarlar' bucket'ı
--    Bucket zaten "public = true" olduğu için tek tek avatar dosyaları
--    zaten herkese açık indirilebiliyor (bu İSTENEN davranış — profil
--    fotoğrafları herkese görünmeli). Sorun şuydu: storage.objects
--    üzerindeki "avatar_select_public" politikası herkese ayrıca LİSTELEME
--    (bucket içindeki TÜM dosya adlarını görme) izni de veriyordu. Dosya
--    yolu "<user_id>/avatar.uzanti" olduğu için bu, bucket'ı listeleyen
--    herkesin sitedeki TÜM kullanıcı ID'lerini tek seferde görebilmesi
--    anlamına geliyordu — bunu istemiyoruz.
--
--    Bu politikayı silmek listelemeyi kapatır ama TEK TEK dosyaları public
--    URL üzerinden indirmeyi ETKİLEMEZ — public bucket'larda dosya indirme
--    RLS'e değil, doğrudan bucket'ın "public" bayrağına bakar. Yani
--    panel.js'teki avatar yükleme/gösterme akışı bu değişiklikten hiç
--    etkilenmiyor.
-- ----------------------------------------------------------------------------
drop policy if exists "avatar_select_public" on storage.objects;

-- ----------------------------------------------------------------------------
-- 4) BÜYÜK DOSYA (Cloudflare R2 vb.) İÇİN HARİCİ LİNK KOLONU
--    Supabase Storage ücretsiz/düşük katmanlarda tek dosya boyutu sınırlıdır
--    (bkz. README > "Çok Büyük Dosyalar (Cloudflare R2)" bölümü). 50GB gibi
--    devasa dosyalar için admin paneli artık, dosyayı doğrudan Supabase'e
--    YÜKLEMEK yerine, dosyanın Cloudflare R2'de zaten durduğu bir linki
--    içeriğe EKLEYEBİLİYOR. Bu kolon o linki tutuyor; NULL ise özellik
--    kullanılmıyor demektir, mevcut davranışta hiçbir şey değişmez.
-- ----------------------------------------------------------------------------
alter table public.special_content
  add column if not exists harici_dosya_url text;

comment on column public.special_content.harici_dosya_url is
  'Cloudflare R2 (veya benzeri) üzerinde barındırılan, Supabase Storage sınırlarını aşan büyük dosyalar için opsiyonel harici indirme linki. NULL ise kullanılmıyor. GÜVENLİK NOTU: bu link RLS ile korunmaz — R2 tarafında link herkese açıksa, linki bilen HERKES indirebilir (bkz. README).';

-- ============================================================================
-- BİTTİ. Ekstra bir "kendini admin yap" adımına gerek yok, bu dosya sadece
-- 0001'de zaten var olan yapıyı sıkılaştırıyor ve bir kolon ekliyor.
-- Çalıştırdıktan sonra Dashboard > Advisors > Security Advisor'a gidip
-- "Rerun linter" ile uyarıların gittiğini doğrulayabilirsin.
-- ============================================================================
