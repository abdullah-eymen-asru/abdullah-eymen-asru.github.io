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
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, role,
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu,
    yurtdisi_onay_verildi, yurtdisi_onay_tarihi, yurtdisi_onay_versiyonu
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
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

-- Google OAuth ile kayıt olanlar için: OAuth kendi ekranında ne aydınlatma
-- beyanını ne de yurt dışı aktarım rızasını ayrı ayrı alabildiğimiz bir
-- arayüz sunmuyor. kvkk_onayini_ver() zaten aydınlatma beyanını kaydediyordu
-- (bkz. migration 0003); burada AYNI RPC'yi, kayıt sayfasındaki iki
-- checkbox'ın (aydınlatma linki + yurt dışı rıza kutusu) o anki durumunu da
-- iletecek şekilde genişletiyoruz. p_yurtdisi_onay parametresi
-- varsayılan NULL bırakılıp geçilmezse yurt dışı rızası DOKUNULMADAN kalır
-- (var olan çağıranlarla geriye dönük uyumluluk için).
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
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text, boolean, text) from public;
grant  execute on function public.kvkk_onayini_ver(text, boolean, text) to authenticated;

-- Eski imza (tek parametreli) hâlâ referans veren istemci kodu olabilir diye
-- overload olarak bırakılıyor; sadece aydınlatma beyanını günceller, yurt
-- dışı rızasına dokunmaz.
create or replace function public.kvkk_onayini_ver(p_versiyon text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.kvkk_onayini_ver(p_versiyon, null, null);
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text) from public;
grant  execute on function public.kvkk_onayini_ver(text) to authenticated;
