-- ============================================================================
-- 0031_uyelik_kayitlarini_ac_kapat.sql
--
-- İSTEK: "Sadece site sahibinin yetkisinde olacak bir yetki: siteye üye
-- alımlarını kapatıp açabilme." Kapalıyken veritabanına HİÇ yeni kayıt
-- düşmeyecek — ne Google ile ne normal (e-posta/şifre) ile. Daha önceden
-- (kayıtlar açıkken) zaten üye olmuş kimseler bundan etkilenmez, giriş
-- yapmaya devam edebilir.
--
-- MİMARİ (iki katman, projedeki "gerçek güvenlik veritabanında, script'ler
-- sadece kullanıcı deneyimi" felsefesiyle birebir aynı — bkz. auth-guard.js
-- başındaki not):
--
--   1) GERÇEK GÜVENLİK — public.handle_new_user() trigger'ının EN BAŞINA
--      bir kontrol ekleniyor: site_settings.kayitlar_acik = false ise
--      exception fırlatılır. Bu trigger auth.users tablosuna AFTER INSERT
--      olarak bağlı (bkz. migration 0001 § 2); içinde fırlatılan bir
--      exception TÜM işlemi (auth.users'a yazılan satır DAHİL) geri alır.
--      Yani kayıtlar kapalıyken:
--        - supabase.auth.signUp(...)        -> hata döner, HİÇBİR satır
--          auth.users'a ya da profiles'a yazılmaz.
--        - supabase.auth.signInWithOAuth("google") ile HİÇ kayıtlı olmayan
--          bir Google hesabıyla gelinmesi -> Supabase bu e-postayı YENİ bir
--          kullanıcı olarak auth.users'a yazmaya çalışır (bkz. kayit.js/
--          giris.js başındaki KVKK notu), bu da aynı trigger'a takılır ve
--          reddedilir.
--      Daha önce (kayıtlar açıkken) zaten auth.users'a yazılmış biri için bu
--      trigger HİÇ ÇALIŞMAZ (sadece INSERT'te tetiklenir, UPDATE/SELECT'te
--      değil) — yani mevcut üyelerin girişi bundan etkilenmez.
--
--   2) KULLANICI DENEYİMİ — hesap/kayit.html + assets/js/auth/auth-pages.js
--      sayfa açılır açılmaz site_settings.kayitlar_acik'i okur (bu satır
--      zaten herkese-açık select politikasıyla anonim ziyaretçiye de
--      okunabilir, bkz. migration 0001 "settings_select_anyone"); kapalıysa
--      formu/Google butonunu hiç göstermez, yerine bir uyarı ekranı
--      gösterir. Bu SADECE deneyim içindir, asıl kilit yukarıdaki trigger.
--
-- YETKİ SINIRLAMASI: bu ayarı SADECE owner (Site Sahibi) değiştirebilsin,
-- admin bile değiştiremesin isteniyor. site_settings tablosunun genel UPDATE
-- politikası ("settings_update_admin_only", migration 0001) is_admin()'e
-- (admin + owner) açık — RLS satır bazlı çalıştığı için "hakkimda_md'yi
-- admin de değiştirebilsin ama kayitlar_acik'i SADECE owner değiştirebilsin"
-- ayrımını RLS tek başına yapamaz. Aynı migration 0001 § 3'teki
-- prevent_role_self_escalation deseniyle: bir BEFORE UPDATE trigger, SADECE
-- kayitlar_acik kolonu değiştiyse VE çağıran owner değilse reddeder;
-- hakkimda_md gibi diğer kolonlar admin için eskisi gibi serbest kalır.
-- Ayrıca panelin çağıracağı, SADECE owner'a açık ayrı bir RPC de ekleniyor
-- (owner_kayitlari_ac_kapat) — projedeki diğer owner-only işlemlerin
-- (owner_denetim_karar, owner_rolu_ver vb.) izlediği AYNI "elle update değil,
-- adı bağlamı açıklayan bir RPC çağır" deseni.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0030 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLON: site_settings.kayitlar_acik
-- ----------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists kayitlar_acik boolean not null default true;

comment on column public.site_settings.kayitlar_acik is
  'false ise yeni üye kaydı (e-posta/şifre VEYA Google ile) tamamen kapalıdır — bkz. handle_new_user() trigger''ındaki kontrol. Daha önce kayıtlı olanların girişini ETKİLEMEZ. Sadece owner (Site Sahibi) değiştirebilir, bkz. trg_kayitlar_acik_sadece_owner ve owner_kayitlari_ac_kapat().';

-- ----------------------------------------------------------------------------
-- 2) SADECE OWNER DEĞİŞTİREBİLSİN — kolon bazlı koruma trigger'ı
--    (migration 0001 § 3, prevent_role_self_escalation ile AYNI desen)
-- ----------------------------------------------------------------------------
create or replace function public.prevent_kayitlar_acik_owner_disi_degisiklik()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kayitlar_acik is distinct from old.kayitlar_acik then
    if not public.is_owner() then
      raise exception 'Üyelik kayıtlarını açma/kapatma yetkisi sadece Site Sahibi''ne (owner) aittir.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kayitlar_acik_sadece_owner on public.site_settings;
create trigger trg_kayitlar_acik_sadece_owner
  before update on public.site_settings
  for each row execute function public.prevent_kayitlar_acik_owner_disi_degisiklik();

-- ----------------------------------------------------------------------------
-- 3) OWNER'A ÖZEL RPC — panel bu fonksiyonu çağırır (elle update yerine)
-- ----------------------------------------------------------------------------
create or replace function public.owner_kayitlari_ac_kapat(p_acik boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: üyelik kayıtlarını açma/kapatma sadece Site Sahibi''ne (owner) açıktır.';
  end if;
  update public.site_settings set kayitlar_acik = p_acik where id = 1;
end;
$$;

grant execute on function public.owner_kayitlari_ac_kapat(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) handle_new_user(): EN BAŞA kayıt-kapalı kontrolü eklendi.
--    Fonksiyonun geri kalanı migration 0010'daki (şu ana kadarki en güncel)
--    haliyle BİREBİR aynı — sadece en başa bir kontrol ekliyoruz, given_name/
--    family_name önceliği ve KVKK alanlarının doldurulması DEĞİŞMEDİ.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v_last  text;
  v_tek_parca text;
  v_kayitlar_acik boolean;
begin
  -- YENİ: üyelik kayıtları kapalıysa burada dur — exception, bu trigger'ı
  -- tetikleyen auth.users INSERT'ini de (aynı transaction içinde olduğu
  -- için) geri alır, yani hesap hiç oluşmaz. errcode P0001 (raise
  -- exception'ın varsayılanı) yeterli; mesaj metnini frontend
  -- (auth-pages.js) error.message içinde arayıp kullanıcıya Türkçe,
  -- anlaşılır bir uyarı gösterecek şekilde eşleştiriyor — bkz. o dosyadaki
  -- KAYITLAR_KAPALI_ISARETI sabiti. Ayrıca ayarı frontend zaten sayfa
  -- açılışında ayrıca okuyup formu baştan gizlediği için (bkz. dosya başı
  -- notu § 2) bu satıra normal koşullarda hiç düşülmemesi beklenir — bu,
  -- sadece geç kalmış/atlanmış istemcilere karşı son (ve asıl bağlayıcı)
  -- güvenlik katmanıdır.
  select kayitlar_acik into v_kayitlar_acik from public.site_settings where id = 1;
  if coalesce(v_kayitlar_acik, true) = false then
    raise exception 'KAYITLAR_KAPALI: Üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamaz.';
  end if;

  v_first := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_last  := nullif(trim(new.raw_user_meta_data->>'last_name'), '');

  -- Google OAuth: given_name/family_name varsa (Google'ın kendi ayırdığı
  -- alanlar) ÖNCE bunlar kullanılır — çok kelimeli Türkçe isimlerde tek
  -- parçayı ilk boşluktan bölmekten çok daha güvenilir sonuç verir.
  if v_first is null and v_last is null then
    v_first := nullif(trim(new.raw_user_meta_data->>'given_name'), '');
    v_last  := nullif(trim(new.raw_user_meta_data->>'family_name'), '');
  end if;

  -- Hiçbiri yoksa (bazı hesaplarda/eski istemcilerde olabilir) tek parça
  -- isimden (full_name/name) bölmeye geri dön.
  if v_first is null and v_last is null then
    v_tek_parca := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name');
    if v_tek_parca is not null and trim(v_tek_parca) <> '' then
      v_first := nullif(split_part(trim(v_tek_parca), ' ', 1), '');
      v_last  := nullif(trim(substring(trim(v_tek_parca) from length(split_part(trim(v_tek_parca), ' ', 1)) + 1)), '');
    end if;
  end if;

  insert into public.profiles (
    id, email, first_name, last_name, role,
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu
  )
  values (
    new.id,
    new.email,
    v_first,
    v_last,
    'user',
    coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false)
         then now() else null end,
    new.raw_user_meta_data->>'kvkk_versiyon'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- migration 0004 handle_new_user() çalıştırma iznini public/anon/authenticated'tan
-- almıştı (sadece auth.users trigger'ı SECURITY DEFINER ile çağırır) — burada
-- fonksiyonu yeniden tanımladığımız için Postgres varsayılan EXECUTE iznini
-- PUBLIC'e geri vermiş olabilir; aynı kısıtlamayı yeniden uyguluyoruz.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================================
-- BİTTİ. Test:
--   1) update public.site_settings set kayitlar_acik = false where id = 1;
--      (ya da panelden Admin Güvenliği sayfasındaki "Üyelik Kayıtları"
--      bölümünden — sadece owner girişiyle görünür/çalışır)
--   2) Yeni bir e-posta ile kayıt olmayı VEYA daha önce hiç kayıt olmamış
--      bir Google hesabıyla "Google ile Kayıt Ol"u dene -> reddedilmeli.
--   3) Kayıtlar kapalıyken önceden kayıtlı bir hesapla normal giriş yap ->
--      hiçbir engelle karşılaşmamalı.
--   4) update public.site_settings set kayitlar_acik = true where id = 1;
--      ile tekrar aç.
-- ============================================================================
