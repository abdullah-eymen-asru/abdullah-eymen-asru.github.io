-- ============================================================================
-- 0017_2fa_yedek_kodlar.sql
--
-- İSTEK: "2FA etkinleştirildikten sonra, authenticator uygulamasına erişim
-- kaybedilirse diye TEK SEFERLİK yedek/kurtarma kodları verilsin."
--
-- MİMARİ:
--   - public.mfa_yedek_kodlar tablosu SADECE kodların SHA-256 hash'ini
--     tutar — düz metin kod hiçbir zaman veritabanına yazılmaz (panel.js
--     tarafında da saklanmaz, sadece üretildiği an ekranda gösterilip
--     indirilir).
--   - Tabloya HİÇBİR RLS policy'si tanımlanmadı: ne anon ne de
--     authenticated rolü satırlara doğrudan erişemez. Tüm işlemler
--     aşağıdaki SECURITY DEFINER fonksiyonlar üzerinden yürür — bu
--     fonksiyonların sahibi (postgres) RLS'i bypass eder, tıpkı
--     0011_oturum_yonetimi.sql'de auth.sessions/auth.refresh_tokens
--     için kullanılan aynı desende olduğu gibi.
--   - yedek_kod_ile_2fa_kaldir(): Supabase Auth'un built-in MFA API'si
--     (challenge/verify) SADECE gerçek bir TOTP kodunu doğrulayabilir;
--     "yedek kod" diye ayrı bir doğrulama yolu YOKTUR. Bu yüzden yedek
--     kod, girişte AAL2'ye yükseltmek yerine, doğrulanınca kullanıcının
--     TOTP faktörünü (auth.mfa_factors satırını) DOĞRUDAN siler — yani
--     "yedek kodla gir" aslında "yedek kodla 2FA'yı kaldır ve normal
--     (AAL1) oturumla devam et" anlamına gelir. Kullanıcıya panelde 2FA'yı
--     tekrar kurması önerilir (bkz. auth-pages.js "Yedek kod kullan").
--     auth.mfa_factors, 0011'de auth.sessions için yapılanla AYNI şekilde
--     doğrudan değiştirilebiliyor (aynı şema, aynı yönetimsel izinler).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLO
-- ----------------------------------------------------------------------------
create table if not exists public.mfa_yedek_kodlar (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  kod_hash           text not null,
  kullanildi_mi      boolean not null default false,
  kullanilma_tarihi  timestamptz,
  created_at         timestamptz not null default now()
);

comment on table public.mfa_yedek_kodlar is
  '2FA (TOTP) yedek/kurtarma kodları — sadece SHA-256 hash''i saklanır, düz metin kod hiçbir yerde tutulmaz. Erişim SADECE yedek_kodlar_olustur() / yedek_kod_ile_2fa_kaldir() / yedek_kod_durumu() fonksiyonları üzerinden; tabloya doğrudan RLS policy'si YOK.';
comment on column public.mfa_yedek_kodlar.kod_hash is
  'upper(kod) üzerinden sha256 hex digest''i (bkz. digest(..., ''sha256'')). Düz metin kod asla saklanmaz.';

create index if not exists mfa_yedek_kodlar_user_id_idx on public.mfa_yedek_kodlar(user_id);
create unique index if not exists mfa_yedek_kodlar_hash_idx on public.mfa_yedek_kodlar(user_id, kod_hash);

alter table public.mfa_yedek_kodlar enable row level security;
-- Kasıtlı olarak HİÇBİR policy tanımlanmadı ve authenticated/anon'a tablo
-- üzerinde hiçbir doğrudan yetki verilmedi -> tüm erişim aşağıdaki
-- SECURITY DEFINER fonksiyonlarla sınırlı.
revoke all on public.mfa_yedek_kodlar from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2) YENİ YEDEK KOD SETİ OLUŞTUR
--    Sadece doğrulanmış bir TOTP faktörü olan kullanıcılar çağırabilir.
--    Çağrıldığında ESKİ set (kullanılmış/kullanılmamış hepsi) silinir ve
--    yerine 8 yeni kod üretilir — düz metin kodlar SADECE bu fonksiyonun
--    dönüş değeri olarak, bir kereliğine döner.
-- ----------------------------------------------------------------------------
create or replace function public.yedek_kodlar_olustur()
returns text[]
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_kodlar text[] := '{}';
  v_kod    text;
  v_ham    text;
  i        int;
begin
  if auth.uid() is null then
    raise exception 'Bu işlem için giriş yapmış olman gerekiyor.';
  end if;

  if not exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and factor_type = 'totp' and status = 'verified'
  ) then
    raise exception 'Yedek kod oluşturmak için önce 2FA''yı etkinleştirmelisin.';
  end if;

  -- Yeni set eskisinin YERİNE geçer: unutulmuş/ekran görüntüsü alınmış
  -- eski kodların süresiz geçerli kalmaması için hepsi silinir.
  delete from public.mfa_yedek_kodlar where user_id = auth.uid();

  for i in 1..8 loop
    -- 5 byte (40 bit) rastgelelik, okunabilirlik için "XXXXX-XXXXX" biçimi.
    v_ham := upper(encode(gen_random_bytes(5), 'hex'));
    v_kod := substr(v_ham, 1, 5) || '-' || substr(v_ham, 6, 5);
    v_kodlar := array_append(v_kodlar, v_kod);

    insert into public.mfa_yedek_kodlar (user_id, kod_hash)
    values (auth.uid(), encode(digest(v_ham, 'sha256'), 'hex'));
  end loop;

  return v_kodlar;
end;
$$;

comment on function public.yedek_kodlar_olustur() is
  'Çağıran için 8 adet yeni 2FA yedek/kurtarma kodu üretir (eski seti geçersiz kılar) ve düz metin kodları BİR KERELİĞİNE döner — panel.js "Yedek Kodlar" bölümü.';

revoke execute on function public.yedek_kodlar_olustur() from public, anon;
grant execute on function public.yedek_kodlar_olustur() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) KALAN/TOPLAM KOD SAYISI
--    Panelde "6/8 yedek kod kullanılabilir" gibi bir durum göstermek için.
-- ----------------------------------------------------------------------------
create or replace function public.yedek_kod_durumu()
returns table (toplam int, kalan int)
language sql
security definer
set search_path = public, auth
as $$
  select count(*)::int as toplam,
         count(*) filter (where not kullanildi_mi)::int as kalan
  from public.mfa_yedek_kodlar
  where user_id = auth.uid();
$$;

comment on function public.yedek_kod_durumu() is
  'Çağıranın kaç yedek kodu kaldığını/toplam kaç tane olduğunu döner — hiç oluşturmadıysa (0,0) döner.';

revoke execute on function public.yedek_kod_durumu() from public, anon;
grant execute on function public.yedek_kod_durumu() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) YEDEK KOD İLE KURTARMA (girişte, authenticator'a erişim yoksa)
--    NOT: Bu fonksiyon AAL1 (sadece şifreyle açılmış, henüz TOTP ile
--    yükseltilmemiş) bir oturumdan da çağrılabilir -- auth.uid() sadece
--    JWT'nin kime ait olduğuna bakar, AAL seviyesine bakmaz. Asıl "ikinci
--    faktör" kontrolü burada YAPILAN İŞİN KENDİSİDİR: doğru yedek kodu
--    bilmek de authenticator'daki kodu bilmek kadar "elde bulunan bir
--    sırrı kanıtlamak" anlamına gelir.
-- ----------------------------------------------------------------------------
create or replace function public.yedek_kod_ile_2fa_kaldir(p_kod text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_normalized text;
  v_hash       text;
  v_id         uuid;
begin
  if auth.uid() is null then
    raise exception 'Bu işlem için giriş yapmış olman gerekiyor.';
  end if;

  -- "XXXXX-XXXXX" biçiminde gösterilir ama kullanıcı boşluklu/tiresiz de
  -- yapıştırabilir -> harf/rakam dışındaki her şeyi at, büyük harfe çevir.
  v_normalized := upper(regexp_replace(coalesce(p_kod, ''), '[^a-zA-Z0-9]', '', 'g'));
  if v_normalized = '' then
    raise exception 'Geçersiz kod.';
  end if;

  v_hash := encode(digest(v_normalized, 'sha256'), 'hex');

  select id into v_id
  from public.mfa_yedek_kodlar
  where user_id = auth.uid() and kod_hash = v_hash and kullanildi_mi = false
  limit 1;

  if v_id is null then
    raise exception 'Kod geçersiz ya da daha önce kullanılmış.';
  end if;

  update public.mfa_yedek_kodlar
  set kullanildi_mi = true, kullanilma_tarihi = now()
  where id = v_id;

  -- Kurtarma senaryosu: authenticator'a erişim yok -> TOTP faktörünü
  -- kaldır ki oturum AAL2 beklemeden devam edebilsin (bkz. dosya başındaki
  -- açıklama). mfa_challenges FK cascade ile zaten temizlenir ama
  -- savunma amaçlı burada da açıkça siliniyor.
  delete from auth.mfa_challenges where factor_id in (
    select id from auth.mfa_factors where user_id = auth.uid() and factor_type = 'totp'
  );
  delete from auth.mfa_factors where user_id = auth.uid() and factor_type = 'totp';

  -- 2FA zaten kapandığı için kalan kodların artık bir anlamı yok.
  delete from public.mfa_yedek_kodlar where user_id = auth.uid();

  return true;
end;
$$;

comment on function public.yedek_kod_ile_2fa_kaldir(text) is
  'Girişte (authenticator''a erişim yoksa) doğru bir yedek kod karşılığında TOTP faktörünü kaldırır ve true döner — auth-pages.js mfaKoduIste() "Yedek kod kullan" akışı.';

revoke execute on function public.yedek_kod_ile_2fa_kaldir(text) from public, anon;
grant execute on function public.yedek_kod_ile_2fa_kaldir(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) TEMİZLİK (kullanıcı panelden manuel "2FA'yı Kaldır" derse)
-- ----------------------------------------------------------------------------
create or replace function public.yedek_kodlar_temizle()
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from public.mfa_yedek_kodlar where user_id = auth.uid();
$$;

comment on function public.yedek_kodlar_temizle() is
  'Çağıranın tüm yedek kodlarını siler — panel.js''te manuel "2FA''yı Kaldır" sonrası çağrılır (2FA kapandıysa eski kodların anlamı kalmaz).';

revoke execute on function public.yedek_kodlar_temizle() from public, anon;
grant execute on function public.yedek_kodlar_temizle() to authenticated;
-- ============================================================================
