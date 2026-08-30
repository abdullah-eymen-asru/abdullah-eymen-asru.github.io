-- ============================================================================
-- 0035_yedek_kod_deneme_kilitlemesi.sql
--
-- SERTLEŞTİRME (düşük öncelik, savunma derinliği): migration
-- 0017_2fa_yedek_kodlar.sql'deki yedek_kod_ile_2fa_kaldir() RPC'sinde
-- yanlış kod denemesi için HERHANGİ bir sınır YOKTU. Pratik risk düşüktü
-- — her kod 40 bit (5 bayt) rastgelelik taşıyor ve bir kullanıcının 8
-- kodu birden aktif olsa bile TEK bir isabet olasılığı ~8/2^40 (yaklaşık
-- 7 milyarda 1) — yani network üzerinden kaba kuvvetle denemek pratikte
-- imkansıza yakın. Yine de "kimlik doğrulamayla ilgili bir akışta sınırsız
-- deneme hakkı" iyi bir güvenlik pratiği değil (ör. bir kod ileride daha
-- kısa/zayıf üretilirse ya da başka bir yerden sızarsa bu katman hâlâ
-- işe yarar), bu yüzden basit bir "art arda N başarısız denemede geçici
-- kilit" mekanizması ekleniyor.
--
-- MİMARİ: profiles tablosuna iki sütun eklendi (ayrı bir tablo yerine —
-- bu, kullanıcı başına tek bir durumu tutan basit bir sayaç/zaman damgası
-- çifti, ilişkisel bir geçmiş gerektirmiyor):
--   - yedek_kod_basarisiz_sayisi: art arda başarısız deneme sayacı,
--     doğru bir kod girildiğinde (ya da yeni kod seti üretildiğinde) sıfırlanır.
--   - yedek_kod_kilit_bitis: sayaç eşiğe (10) ulaştığında now() + 15 dakika
--     olarak ayarlanır; bu zaman geçene kadar HİÇBİR kod (doğru olsa
--     bile) kabul edilmez.
--
-- Bu, sadece yedek_kod_ile_2fa_kaldir() RPC'sini etkiler — authenticator
-- uygulamasındaki normal 6 haneli TOTP kodu Supabase Auth'un kendi
-- mfa.challenge/verify akışından geçtiği için bu kilitlemeden ETKİLENMEZ
-- (ve zaten Supabase Auth tarafında kendi hız sınırlaması var).
-- ============================================================================

alter table public.profiles
  add column if not exists yedek_kod_basarisiz_sayisi int not null default 0;
alter table public.profiles
  add column if not exists yedek_kod_kilit_bitis timestamptz;

comment on column public.profiles.yedek_kod_basarisiz_sayisi is
  '2FA yedek kod akışında (yedek_kod_ile_2fa_kaldir) art arda başarısız deneme sayacı — doğru kod girilince veya yeni kod seti üretilince sıfırlanır.';
comment on column public.profiles.yedek_kod_kilit_bitis is
  '2FA yedek kod akışında art arda 10 başarısız denemeden sonra ayarlanan geçici kilit bitiş zamanı (15 dakika) — bu zamana kadar hiçbir kod kabul edilmez.';

create or replace function public.yedek_kod_ile_2fa_kaldir(p_kod text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_normalized text;
  v_hash       text;
  v_id         uuid;
  v_kilit_bitis timestamptz;
  v_basarisiz  int;
begin
  if auth.uid() is null then
    raise exception 'Bu işlem için giriş yapmış olman gerekiyor.';
  end if;

  -- YENİ: art arda çok fazla başarısız denemeden sonra geçici kilit.
  select yedek_kod_kilit_bitis into v_kilit_bitis
  from public.profiles where id = auth.uid();

  if v_kilit_bitis is not null and v_kilit_bitis > now() then
    raise exception 'Çok fazla hatalı deneme. Lütfen % dakika sonra tekrar dene.',
      ceil(extract(epoch from (v_kilit_bitis - now())) / 60);
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
    -- YENİ: başarısız deneme sayacını artır, eşiğe ulaştıysa kilitle.
    update public.profiles
    set yedek_kod_basarisiz_sayisi = yedek_kod_basarisiz_sayisi + 1,
        yedek_kod_kilit_bitis = case
          when yedek_kod_basarisiz_sayisi + 1 >= 10 then now() + interval '15 minutes'
          else yedek_kod_kilit_bitis
        end
    where id = auth.uid()
    returning yedek_kod_basarisiz_sayisi into v_basarisiz;

    if v_basarisiz >= 10 then
      raise exception 'Çok fazla hatalı deneme. Lütfen 15 dakika sonra tekrar dene.';
    end if;
    raise exception 'Kod geçersiz ya da daha önce kullanılmış.';
  end if;

  -- Doğru kod: sayaç/kilit sıfırlanır.
  update public.profiles
  set yedek_kod_basarisiz_sayisi = 0, yedek_kod_kilit_bitis = null
  where id = auth.uid();

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
  'Girişte (authenticator''a erişim yoksa) doğru bir yedek kod karşılığında TOTP faktörünü kaldırır ve true döner — auth-pages.js mfaKoduIste() "Yedek kod kullan" akışı. Art arda 10 başarısız denemeden sonra 15 dakika kilitlenir (bkz. migration 0035).';

revoke execute on function public.yedek_kod_ile_2fa_kaldir(text) from public, anon;
grant execute on function public.yedek_kod_ile_2fa_kaldir(text) to authenticated;

-- Yeni bir kod seti üretildiğinde de sayaç/kilit sıfırlansın (kullanıcı
-- zaten authenticator'a erişimini geri kazanıp yeni set üretmiş demektir).
create or replace function public.yedek_kodlar_olustur()
returns text[]
language plpgsql
security definer
set search_path = public, extensions, auth
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

  -- YENİ (bkz. migration 0035): yeni set üretilince deneme sayacı/kilit de sıfırlanır.
  update public.profiles
  set yedek_kod_basarisiz_sayisi = 0, yedek_kod_kilit_bitis = null
  where id = auth.uid();

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
  'Çağıran için 8 adet yeni 2FA yedek/kurtarma kodu üretir (eski seti geçersiz kılar, deneme sayacını/kilidini sıfırlar) ve düz metin kodları BİR KERELİĞİNE döner — panel.js "Yedek Kodlar" bölümü.';

revoke execute on function public.yedek_kodlar_olustur() from public, anon;
grant execute on function public.yedek_kodlar_olustur() to authenticated;

-- ============================================================================
-- BİTTİ. Test:
--   1) 2FA açık bir hesapla girişte "Authenticator'a erişemiyorum, yedek
--      kod kullanacağım" seçeneğiyle bilerek 10 kere yanlış kod dene ->
--      10. denemede "Çok fazla hatalı deneme" hatası almalısın.
--   2) Aynı hesapla doğru bir yedek kod girmeyi dene -> kilit süresi
--      dolmadan reddedilmeli.
--   3) 15 dakika bekle (ya da test için
--      update public.profiles set yedek_kod_kilit_bitis = now() where id = '<uuid>';
--      ile kilidi elle kaldır) -> doğru kod artık kabul edilmeli.
-- ============================================================================
