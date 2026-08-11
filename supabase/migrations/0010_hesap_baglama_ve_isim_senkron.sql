-- ============================================================================
-- 0010_hesap_baglama_ve_isim_senkron.sql
--
-- Kullanıcı bildirimi kapsamında:
--
--   (A) "Google ile kayıt olan kişinin ad soyadı doğru ve düzgün bir şekilde
--       sisteme gelsin."
--       Şimdiye kadar handle_new_user()/handle_user_update() Google'dan gelen
--       TEK PARÇA "name"/"full_name" alanını ilk boşluktan bölüyordu (ör.
--       "Mehmet Ali Yılmaz" -> Ad: "Mehmet", Soyad: "Ali Yılmaz" gibi hatalı
--       sonuçlar verebiliyordu). Google, OAuth ile birlikte ayrıca
--       "given_name" ve "family_name" alanlarını da gönderir — bunlar
--       Google'ın KENDİSİNİN ayırdığı, çok daha güvenilir alanlardır. Artık
--       ÖNCE bunlara bakılıyor, yoksa (nadiren) eskisi gibi tek parçadan
--       bölünüyor.
--
--   (B) "Google ile kayıt/giriş yapan ile e-posta ile kayıt olan aynı mail
--       ise tek hesap sayılsın; Google hesabını sonradan bağlayıp/
--       koparabilsin; e-posta/şifre ile kayıt olanlar da Google'ı sonradan
--       bağlayabilsin."
--       Bu zaten Supabase Auth'un VARSAYILAN davranışıdır: aynı (onaylı)
--       e-postayla gelen farklı bir sağlayıcı (Google gibi) OTOMATİK olarak
--       AYNI kullanıcıya bağlanır, ikinci bir hesap AÇILMAZ (bkz.
--       assets/js/auth-pages.js -> googleKayitDonusunuIsle() /
--       googleGirisDonusunuIsle() içindeki yeni "hesabın zaten var"
--       kontrolü). Kullanıcının panelden MANUEL olarak Google bağlama/
--       bağlantı kesme yapabilmesi (linkIdentity/unlinkIdentity, bkz.
--       assets/js/panel.js -> wireBagliHesaplar()) için ise Supabase
--       Dashboard'da "Enable Manual Linking" seçeneğinin AÇIK olması
--       gerekir:
--         Dashboard > Authentication > Settings (Sign In / Providers) >
--         "Allow manual linking" -> AÇ.
--       Bu bir dashboard ayarıdır, SQL ile açılamaz.
--
--   (C) Bilinen bir Supabase davranışı: bir kullanıcı SADECE Google ile
--       kayıtlıyken panelden updateUser({ password }) ile bir şifre
--       belirlediğinde, auth.users.encrypted_password dolar ve kullanıcı
--       e-posta+şifreyle giriş yapabilir HALE GELİR, AMA auth.identities
--       tablosuna bir "email" kimliği eklenmez ("ghost password" olarak
--       bilinir). Bunun sonucunda unlinkIdentity() ileride "tek kimlik
--       kaldı, silinemez" (single_identity_not_deletable) hatası verir —
--       yani kullanıcı görünüşte şifresi olsa bile Google bağlantısını asla
--       kesemez. Aşağıdaki RPC, şifre başarıyla ayarlandığında eksik
--       "email" kimlik satırını BİZ ekleyerek bu sorunu ortadan kaldırıyor
--       (bkz. panel.js -> wirePasswordChange()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) handle_new_user() / handle_user_update(): given_name/family_name önceliği
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
begin
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

create or replace function public.handle_user_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_first text;
  v_last  text;
  v_tek_parca text;
  v_profil_var_mi boolean;
  v_profil_isim_bos_mu boolean;
begin
  select true, (coalesce(p.first_name, '') = '' and coalesce(p.last_name, '') = '')
    into v_profil_var_mi, v_profil_isim_bos_mu
  from public.profiles p
  where p.id = new.id;

  if not coalesce(v_profil_var_mi, false) then
    return new;
  end if;

  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;

  if v_profil_isim_bos_mu then
    v_first := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
    v_last  := nullif(trim(new.raw_user_meta_data->>'last_name'), '');
    if v_first is null and v_last is null then
      v_first := nullif(trim(new.raw_user_meta_data->>'given_name'), '');
      v_last  := nullif(trim(new.raw_user_meta_data->>'family_name'), '');
    end if;
    if v_first is null and v_last is null then
      v_tek_parca := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name');
      if v_tek_parca is not null and trim(v_tek_parca) <> '' then
        v_first := nullif(split_part(trim(v_tek_parca), ' ', 1), '');
        v_last  := nullif(trim(substring(trim(v_tek_parca) from length(split_part(trim(v_tek_parca), ' ', 1)) + 1)), '');
      end if;
    end if;
    if v_first is not null or v_last is not null then
      update public.profiles set first_name = v_first, last_name = v_last where id = new.id;
    end if;
  end if;

  return new;
end;
$$;
-- (trigger'lar 0008'de zaten kuruldu, create or replace fonksiyonlar yeterli)

-- ----------------------------------------------------------------------------
-- C) kullanici_email_identity_ekle(): "ghost password" sorununu düzeltir
--    Kullanıcı SADECE Google ile kayıtlıyken panelden bir şifre belirlediğinde
--    çağrılır (bkz. panel.js). Şifre gerçekten ayarlanmışsa ve ortada henüz
--    bir "email" kimliği yoksa, normal bir e-posta kaydında oluşacak olan
--    auth.identities satırının AYNISINI elle ekler. Böylece kullanıcı daha
--    sonra Google bağlantısını (unlinkIdentity) sorunsuz kesebilir.
-- ----------------------------------------------------------------------------
create or replace function public.kullanici_email_identity_ekle()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_sifre_var boolean;
  v_email_identity_var boolean;
begin
  if v_uid is null then
    raise exception 'Bu işlem için giriş yapmış olman gerekiyor.';
  end if;

  select email, (encrypted_password is not null and encrypted_password <> '')
    into v_email, v_sifre_var
  from auth.users
  where id = v_uid;

  if v_email is null then
    raise exception 'Kullanıcı bulunamadı.';
  end if;

  -- Şifre gerçekten ayarlanmamışsa yapacak bir şey yok (savunmacı kod —
  -- normalde panel.js bu RPC'yi zaten sadece updateUser({password}) BAŞARILI
  -- olduktan SONRA çağırıyor).
  if not coalesce(v_sifre_var, false) then
    return;
  end if;

  select exists(
    select 1 from auth.identities where user_id = v_uid and provider = 'email'
  ) into v_email_identity_var;

  if v_email_identity_var then
    return; -- zaten var, tekrar eklemeye gerek yok
  end if;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );
end;
$$;

comment on function public.kullanici_email_identity_ekle() is
  'Google ile kayıtlı bir kullanıcı panelden şifre belirlediğinde çağrılır: Supabase''in updateUser({password}) çağrısında EKLEMEDİĞİ "email" kimliğini (auth.identities) elle tamamlar, böylece kullanıcı ileride Google bağlantısını (unlinkIdentity) kesebilir.';

revoke execute on function public.kullanici_email_identity_ekle() from public, anon;
grant execute on function public.kullanici_email_identity_ekle() to authenticated;

-- ----------------------------------------------------------------------------
-- BİTTİ. Sırada:
--   1) Bu dosyayı Supabase Dashboard > SQL Editor'de çalıştır.
--   2) Dashboard > Authentication > Settings > "Allow manual linking"
--      seçeneğini AÇ (panelden Google bağlama/bağlantı kesme özelliğinin
--      çalışması için ZORUNLU — bkz. yukarıdaki (B) notu).
--   3) Statik dosyalar (panel.js, auth-pages.js, panel.md) otomatik
--      yayınlanır, ekstra bir deploy adımı gerekmez.
-- ============================================================================
