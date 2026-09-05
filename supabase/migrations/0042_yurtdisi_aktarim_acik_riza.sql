-- ----------------------------------------------------------------------------
-- 0042: YURT DIŞINA AKTARIM İÇİN AYRI AÇIK RIZA KOLONLARI
-- ----------------------------------------------------------------------------
-- SORUN: `kvkk_onay_verildi` (bkz. migration 0003) tek bir onayda hem
--   (a) "KVKK Aydınlatma Metni'ni okudum" bilgilendirmesini hem de
--   (b) "verilerimin yurt dışına (Supabase/AWS eu-central-1, Almanya)
--       aktarılmasına açık rıza veriyorum" beyanını birlikte taşıyordu.
--   KVKK m.9 uyarınca yurt dışına aktarım için alınan açık rıza, "aydınlatma
--   yükümlülüğünün ifası" ile aynı onaya bağlanamaz (paket/bundled rıza
--   yasağı) — kullanıcının yurt dışı aktarımını ayrı ve özgür bir irade ile
--   onaylayabilmesi/reddedebilmesi gerekir. Bu migration, yurt dışı aktarım
--   rızasını KENDİ kolonlarına ayırır; `kvkk_onay_*` kolonları artık SADECE
--   "Aydınlatma Metni'ni okudum" beyanını temsil eder.
--
-- Not: Bu site VERBİS kaydından muaftır; bu kolonlar VERBİS bildirimi
-- amacıyla değil, Kurul kararları uyarınca aranan "açık rızanın ispatı"
-- (rıza logu: kim, ne zaman, hangi metin sürümüne rıza verdi) yükümlülüğünü
-- karşılamak için tutulur.
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists yurtdisi_onay_verildi   boolean not null default false,
  add column if not exists yurtdisi_onay_tarihi    timestamptz,
  add column if not exists yurtdisi_onay_versiyonu text;

comment on column public.profiles.yurtdisi_onay_verildi is
  'KVKK m.9 uyarınca, kişisel verilerin yurt dışında (Supabase/AWS eu-central-1, Frankfurt) barındırılan sunuculara aktarılmasına verilen AYRI açık rıza. kvkk_onay_verildi (Aydınlatma Metni okundu beyanı) ile birlikte/paket olarak alınamaz, tarayıcıda ayrı ve varsayılan olarak işaretsiz (unchecked) bir onay kutusuyla toplanır.';
comment on column public.profiles.yurtdisi_onay_tarihi is
  'Yurt dışına aktarım açık rızasının verildiği tarih/saat.';
comment on column public.profiles.yurtdisi_onay_versiyonu is
  'Rıza verilen Gizlilik Politikası/KVKK metninin sürüm etiketi (ör. "2026-09"). Metnin yurt dışı aktarım bölümü değişirse yeniden rıza istenebilmesi için ayrı tutulur.';

-- handle_new_user() trigger'ı: kayıt formundan gelen yurt dışı aktarım
-- rızasını da (auth kullanıcı meta verisinden) profiles'a kopyalayacak
-- şekilde güncelleniyor. Kayıt formu artık signUp() çağrısına
-- options.data = {
--   first_name, last_name,
--   kvkk_onay: true, kvkk_versiyon: "...",              -- aydınlatma beyanı
--   yurtdisi_onay: true|false, yurtdisi_versiyon: "..."  -- AYRI açık rıza
-- }
-- gönderir (bkz. auth-pages.js). `yurtdisi_onay` false/eksik olsa bile kayıt
-- REDDEDİLMEZ burada; formdaki checkbox zaten `required` olduğu için normal
-- akışta hep true gelir, ama bu trigger'ı kasıtlı olarak "aydınlatma" ile
-- "yurt dışı rızası"nı birbirine kilitlemeyecek şekilde tasarlıyoruz — ikisi
-- ayrı sinyal, ayrı sütun, ayrı zaman damgası.
--
-- ÖNEMLİ: fonksiyonun geri kalanı migration 0031'deki (bu migration'dan
-- önceki en güncel) haliyle BİREBİR aynı tutuluyor — kayıtlar-kapalı
-- kontrolü (site_settings.kayitlar_acik), given_name/family_name önceliği,
-- tek-parça isimden bölme mantığının HİÇBİRİ değiştirilmedi/kaldırılmadı,
-- SADECE insert listesine yurtdisi_onay_* kolonları eklendi. (İlk yazımda
-- bu fonksiyon yanlışlıkla eski/basitleştirilmiş bir sürümle "create or
-- replace" edilmişti — bu, 0031'in kayıtlar-kapalı kontrolünü VE
-- 0010/0031'in ad/soyad ayrıştırma mantığını sessizce SİLERdi. Bu
-- migration'ın nihai hali bu hatayı içermez.)
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
    new.raw_user_meta_data->>'kvkk_versiyon',
    coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false)
         then now() else null end,
    new.raw_user_meta_data->>'yurtdisi_versiyon'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- migration 0031'de bu fonksiyonun EXECUTE izni public/anon/authenticated'tan
-- alınmıştı (sadece auth.users trigger'ı SECURITY DEFINER ile çağırır) —
-- burada fonksiyonu yeniden tanımladığımız için Postgres varsayılan EXECUTE
-- iznini PUBLIC'e geri vermiş olabilir; aynı kısıtlamayı yeniden uyguluyoruz.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Google OAuth ile kayıt olanlar için: OAuth kendi ekranında ne aydınlatma
-- beyanını ne de yurt dışı aktarım rızasını ayrı ayrı alabildiğimiz bir
-- arayüz sunmuyor. kvkk_onayini_ver() zaten aydınlatma beyanını kaydediyordu
-- (bkz. migration 0003/0004); burada AYNI RPC'yi, kayıt sayfasındaki iki
-- checkbox'ın (aydınlatma linki + yurt dışı rıza kutusu) o anki durumunu da
-- iletecek şekilde genişletiyoruz. p_yurtdisi_onay parametresi
-- varsayılan NULL bırakılıp geçilmezse yurt dışı rızası DOKUNULMADAN kalır
-- (var olan çağıranlarla geriye dönük uyumluluk için).
--
-- ÖNEMLİ: migration 0004'te bu fonksiyona eklenen "sessiz başarısızlığı
-- ortadan kaldırma" düzeltmesi (oturum yoksa veya güncellenen satır sayısı
-- 0 ise AÇIKÇA hata fırlatma) burada KORUNUYOR — aksi halde bu migration
-- 0004'ün düzelttiği hatayı yeniden geri getirmiş olurdu.
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
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  update public.profiles
  set kvkk_onay_verildi = true,
      kvkk_onay_tarihi = now(),
      kvkk_onay_versiyonu = p_versiyon,
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
        else p_yurtdisi_versiyon
      end
  where id = auth.uid();

  if not found then
    raise exception 'Profil bulunamadı, onay kaydedilemedi.';
  end if;
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text, boolean, text) from public, anon;
grant  execute on function public.kvkk_onayini_ver(text, boolean, text) to authenticated;

-- Eski imza (tek parametreli) hâlâ referans veren istemci kodu olabilir diye
-- overload olarak bırakılıyor; sadece aydınlatma beyanını günceller, yurt
-- dışı rızasına dokunmaz. Aynı şekilde oturum/satır kontrolünü (0004) korur
-- — burada ayrıca tekrarlanıyor (3 parametreli sürüme devrederek değil,
-- doğrudan) ki "not found" hatası BU çağrının kendi p_versiyon'una göre
-- doğru şekilde raporlansın.
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
      kvkk_onay_versiyonu = p_versiyon
  where id = auth.uid();

  if not found then
    raise exception 'Profil bulunamadı, onay kaydedilemedi.';
  end if;
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text) from public, anon;
grant  execute on function public.kvkk_onayini_ver(text) to authenticated;
