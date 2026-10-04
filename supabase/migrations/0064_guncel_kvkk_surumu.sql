-- ============================================================================
-- 0064_guncel_kvkk_surumu.sql
-- KVKK/Aydınlatma Metni sürüm etiketi artık KODDA DEĞİL, VERİTABANINDA:
--   public.site_ayarlari.guncel_kvkk_surumu  (panel: Yetki Ayarları > KVKK Sürümü)
--
-- 0001-0063 sırayla daha önce çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir
-- (idempotent). Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
--
-- NE DEĞİŞİYOR
--   1) site_ayarlari.guncel_kvkk_surumu  — varsayılan 'v1.1' (eski sabitle AYNI, yani
--      bu migration tek başına kimseye rıza yenileme modalı göstermez).
--      SELECT : herkes (kayıt sayfası anon çalışır) — tablo zaten herkese açık okunur.
--      UPDATE : SADECE owner (mevcut politika + kolon bazlı GRANT).
--   2) public.guncel_kvkk_surumu()   — iç yardımcı (istemciye açık DEĞİL).
--   3) kvkk_onayini_ver() (iki imza da) — kaydedilen sürümü artık İSTEMCİDEN
--      ALMAZ, DB'den okur. p_versiyon parametresinin DEĞERİ yok sayılır; yalnızca
--      "aydınlatma beyanını damgala (dolu) / dokunma (NULL)" sinyali olarak kalır. Böylece kimse tarayıcıdan sahte/eski bir sürüm
--      damgası yazamaz; önbellekte eski JS'i olan sekme de yanlış sürüm yazamaz.
--   4) handle_new_user() — kayıtta sürüm, istemcinin gönderdiği user_metadata
--      yerine DB'den alınır (metadata kullanıcı kontrollüdür). Fonksiyonun geri
--      kalanı 0042'deki haliyle BİREBİR aynıdır (kayıtlar-kapalı kontrolü, ad/soyad
--      ayrıştırma korunur).
--   5) owner_kvkk_onay_ozeti() — sürümü değiştirmeden önce "kaç üyeye modal
--      çıkacak?" önizlemesi (sadece owner).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLON
-- ----------------------------------------------------------------------------
alter table public.site_ayarlari
  add column if not exists guncel_kvkk_surumu text not null default 'v1.1';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_ayarlari'::regclass
      and conname = 'site_ayarlari_kvkk_surumu_bicim'
  ) then
    alter table public.site_ayarlari
      add constraint site_ayarlari_kvkk_surumu_bicim
      check (guncel_kvkk_surumu ~ '^v[0-9]{1,3}\.[0-9]{1,3}$');
  end if;
end $$;

comment on column public.site_ayarlari.guncel_kvkk_surumu is
  'Yürürlükteki Aydınlatma Metni/Gizlilik Politikası sürüm etiketi ("v1.1"). profiles.kvkk_onay_versiyonu bununla eşleşmeyen üyeye giriş sonrası Rıza Yenileme modalı çıkar (auth-guard.js). Sadece owner değiştirir: panel > Yetki Ayarları > KVKK Sürümü. Metni (kurumsal/gizlilik-politikasi.md) yayınladıktan SONRA değiştir.';

-- Kolon bazlı GRANT (0061): yeni kolon için UPDATE izni ayrıca verilir; RLS politikası
-- (site_ayarlari_update_owner) zaten sadece owner'a izin verir.
grant update (guncel_kvkk_surumu) on public.site_ayarlari to authenticated;

-- ----------------------------------------------------------------------------
-- 2) İÇ YARDIMCI — yalnızca SECURITY DEFINER fonksiyonlar çağırır
-- ----------------------------------------------------------------------------
create or replace function public.guncel_kvkk_surumu()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select guncel_kvkk_surumu from public.site_ayarlari where id = 1;
$$;

revoke all on function public.guncel_kvkk_surumu() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) kvkk_onayini_ver — sürümü DB belirler (0042/0004 davranışı korunur:
--    oturum yoksa / profil bulunamazsa AÇIKÇA hata)
-- ----------------------------------------------------------------------------
create or replace function public.kvkk_onayini_ver(
  p_versiyon text,
  p_yurtdisi_onay boolean default null,
  p_yurtdisi_versiyon text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surum text;
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  -- İstemcinin p_versiyon / p_yurtdisi_versiyon değerlerine GÜVENİLMEZ.
  v_surum := coalesce(public.guncel_kvkk_surumu(), p_versiyon);

  -- p_versiyon NULL  -> aydınlatma beyanına (kvkk_onay_*) DOKUNMA (panelde sadece yurt
  --                     dışı rızası verilirken kullanılır; aydınlatma "Okudum" butonuyla ayrı).
  -- p_versiyon DOLU  -> aydınlatma beyanını DB'deki güncel sürümle damgala (değerin kendisi yok sayılır).
  update public.profiles
  set kvkk_onay_verildi = case when p_versiyon is null then kvkk_onay_verildi else true end,
      kvkk_onay_tarihi = case when p_versiyon is null then kvkk_onay_tarihi else now() end,
      kvkk_onay_versiyonu = case when p_versiyon is null then kvkk_onay_versiyonu else v_surum end,
      yurtdisi_onay_verildi = case
        when p_yurtdisi_onay is null then yurtdisi_onay_verildi
        else p_yurtdisi_onay
      end,
      yurtdisi_onay_tarihi = case
        when p_yurtdisi_onay is true then now()
        when p_yurtdisi_onay is false then null
        else yurtdisi_onay_tarihi
      end,
      yurtdisi_onay_versiyonu = case
        when p_yurtdisi_onay is null then yurtdisi_onay_versiyonu
        when p_yurtdisi_onay then v_surum
        else null
      end
  where id = auth.uid();

  if not found then
    raise exception 'Profil bulunamadı, onay kaydedilemedi.';
  end if;
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text, boolean, text) from public, anon;
grant  execute on function public.kvkk_onayini_ver(text, boolean, text) to authenticated;

create or replace function public.kvkk_onayini_ver(p_versiyon text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  update public.profiles
  set kvkk_onay_verildi = true,
      kvkk_onay_tarihi = now(),
      kvkk_onay_versiyonu = coalesce(public.guncel_kvkk_surumu(), p_versiyon)
  where id = auth.uid();

  if not found then
    raise exception 'Profil bulunamadı, onay kaydedilemedi.';
  end if;
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text) from public, anon;
grant  execute on function public.kvkk_onayini_ver(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) handle_new_user — 0042'deki haliyle AYNI; yalnızca iki sürüm alanı DB'den
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
  -- bkz. migration 0031: üyelik kayıtları kapalıysa burada dur — exception,
  -- bu trigger'ı tetikleyen auth.users INSERT'ini de (aynı transaction
  -- içinde olduğu için) geri alır, yani hesap hiç oluşmaz.
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
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu,
    yurtdisi_onay_verildi, yurtdisi_onay_tarihi, yurtdisi_onay_versiyonu
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
    coalesce(public.guncel_kvkk_surumu(), new.raw_user_meta_data->>'kvkk_versiyon'),
    coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false)
         then now() else null end,
    case when coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false)
         then coalesce(public.guncel_kvkk_surumu(), new.raw_user_meta_data->>'yurtdisi_versiyon')
         else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 0031/0042'deki gibi: yalnızca auth.users trigger'ı çağırır.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) OWNER ÖNİZLEMESİ — sürümü değiştirmeden önce etkiyi göster
--    toplam   : onay vermiş tüm üyeler (kvkk_onay_verildi)
--    guncel   : zaten yürürlükteki sürümü onaylamış olanlar
--    modal    : sürüm değişirse giriş sonrası Rıza Yenileme modalı görecekler
-- ----------------------------------------------------------------------------
create or replace function public.owner_kvkk_onay_ozeti()
returns table (guncel_surum text, toplam bigint, guncel bigint, eski bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: KVKK onay özetini sadece Site Sahibi (owner) görebilir.';
  end if;

  return query
  select s.guncel_kvkk_surumu,
         count(*)::bigint,
         count(*) filter (where p.kvkk_onay_versiyonu = s.guncel_kvkk_surumu)::bigint,
         count(*) filter (where p.kvkk_onay_versiyonu is distinct from s.guncel_kvkk_surumu)::bigint
  from public.site_ayarlari s
  cross join public.profiles p
  where s.id = 1
  group by s.guncel_kvkk_surumu;
end;
$$;

revoke all on function public.owner_kvkk_onay_ozeti() from public, anon;
grant execute on function public.owner_kvkk_onay_ozeti() to authenticated;

-- 0043'teki kolon açıklaması eski sabite işaret ediyordu; güncelle.
comment on column public.profiles.kvkk_onay_versiyonu is
  'Kullanıcının en son onayladığı Aydınlatma Metni sürüm etiketi ("v1.0", "v1.1", ...). Yürürlükteki sürüm site_ayarlari.guncel_kvkk_surumu''dur (panel: Yetki Ayarları > KVKK Sürümü); eşleşmezse auth-guard.js Rıza Yenileme modalı açar. Değeri istemci değil kvkk_onayini_ver() / handle_new_user() yazar. DEFAULT ''v1.0'' NOT NULL (0043).';
