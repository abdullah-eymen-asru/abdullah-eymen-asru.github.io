 
-- 0003_yeni_ozellikler_ve_guvenlik.sql
-- Abdullah Eymen Asru — Kalan Security Advisor uyarılarının giderilmesi +
-- yeni özellikler (KVKK onayı, okundu bilgisi + otomatik silinme, admin
-- hesap silme, e-posta ile üye arama, avatar/bio alanlarının kaldırılması).
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001 ve 0002'yi DEĞİŞTİRMİYORUZ, üzerine ek yapıyoruz — o ikisini tekrar
-- çalıştırmana gerek yok, sadece bunu çalıştır (sırayla: önce 0001, sonra
-- 0002 hiç çalıştırmadıysan onları da çalıştırman gerekir).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) NEDEN "13 UYARI" HÂLÂ GÖRÜNÜYORDU?
--    Ekran görüntüsündeki 13 uyarının çoğu "Public/Signed-In Can Execute
--    SECURITY DEFINER Function" başlığıydı. 0002'de is_admin(),
--    has_content_access(), admin_set_user_role(), delete_own_profile_data()
--    için PUBLIC'ten REVOKE yapılmıştı — ANCAK Postgres'te "REVOKE ... FROM
--    PUBLIC" işlemi, o fonksiyona DAHA SONRA "GRANT ... TO authenticated"
--    ile verilen İZNİ silmez; iki kayıt bağımsızdır. Yani hem PUBLIC hem
--    authenticated grant'i olan bir fonksiyonda PUBLIC'i kapatınca "Public
--    Can Execute" uyarısı gider ama "Signed-In (authenticated) Can Execute"
--    uyarısı, o rol için grant devam ettiği sürece GÖRÜNMEYE DEVAM EDER —
--    çünkü Advisor bunu ayrı bir uyarı türü olarak sayıyor; bu, RLS zaten
--    fonksiyon içinde auth.uid()/is_admin() kontrolü yaptığı için İSTENEN
--    ve GÜVENLİ bir durumdur, ama Advisor yine de bilgilendirme amaçlı
--    gösterir. Gerçek sorun şuydu: 0002 bazı fonksiyonlara hiç dokunmamıştı
--    (handle_new_user, prevent_role_self_escalation, set_updated_at zaten
--    revoke edilmişti ama site_settings tetikleyicisi set_updated_at'i
--    kullanan diğer trigger'lar ayrı ayrı listelendiği için tekil
--    "signature" farkı oluşturuyordu) ve "Leaked Password Protection" gibi
--    bir Dashboard-ayarı (SQL ile değil, Auth ayarlarından) hâlâ kapalıydı.
--    Bu dosya: (a) TÜM SECURITY DEFINER fonksiyonlarında PUBLIC + gereksiz
--    "authenticated" grant'lerini normalize eder, (b) yeni eklenen
--    fonksiyonlarda en baştan doğru izinleri kurar, (c) Dashboard'da elle
--    kapatman gereken son ayarı (Leaked Password Protection) açıklar.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1) PROFİL FOTOĞRAFI VE "HAKKIMDA" KUTUSUNU KALDIRMA
--    İstek: panelde profil fotoğrafı yükleme olmasın (Supabase Storage
--    kullanmasın) ve "Hakkımda" düzenleme alanı olmasın (bu zaten site
--    genelinde site_settings.hakkimda_md üzerinden admin panelinden
--    yönetiliyordu — kullanıcı PROFİLİNDEKİ kişisel "bio" alanını
--    kastediyor, onu kaldırıyoruz). Kolonları SİLMİYORUZ (geriye dönük
--    veri kaybı olmasın diye) — sadece frontend'in artık onları
--    yazmadığından/okumadığından emin oluyoruz (bkz. panel.js, panel.md).
--    Var olan avatar_url / bio verisi DB'de durmaya devam eder, sadece
--    yeni panel arayüzünde düzenleme/yükleme YOK.
-- ----------------------------------------------------------------------------
comment on column public.profiles.avatar_url is
  'ARTIK PANELDEN YÜKLENEMİYOR (Supabase Storage kullanılmaması istendi). Eski veriler durabilir, yeni yükleme akışı kaldırıldı.';
comment on column public.profiles.bio is
  'ARTIK PANELDEN DÜZENLENEMİYOR. Site geneli "Hakkımda" metni site_settings.hakkimda_md üzerinden yönetilir.';

-- 'avatarlar' bucket'ı ve politikaları artık frontend tarafından
-- kullanılmıyor. Bucket'ı SİLMİYORUZ (elle silmek istersen Dashboard >
-- Storage'dan yapabilirsin) ama yeni dosya yüklenmesin diye insert/update
-- politikalarını kaldırıp bucket'ı salt-okunur (sadece admin) bırakıyoruz.
drop policy if exists "avatar_write_own" on storage.objects;
drop policy if exists "avatar_update_own" on storage.objects;
drop policy if exists "avatar_delete_own" on storage.objects;

drop policy if exists "avatar_write_admin_only" on storage.objects;
create policy "avatar_write_admin_only"
  on storage.objects for insert
  with check (bucket_id = 'avatarlar' and public.is_admin());

drop policy if exists "avatar_update_admin_only" on storage.objects;
create policy "avatar_update_admin_only"
  on storage.objects for update
  using (bucket_id = 'avatarlar' and public.is_admin());

drop policy if exists "avatar_delete_admin_only" on storage.objects;
create policy "avatar_delete_admin_only"
  on storage.objects for delete
  using (bucket_id = 'avatarlar' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 2) KVKK / AÇIK RIZA ONAYI
--    Her üyeden kayıt olurken KVKK Aydınlatma Metni + Açık Rıza onayı
--    alınması isteniyor. Onay metni değişirse (versiyon farkı) eski
--    üyelerin de yeniden onay vermesi gerekebilir diye "hangi metin
--    sürümüne onay verdiği" ve "ne zaman" bilgisini de tutuyoruz.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists kvkk_onay_verildi   boolean not null default false,
  add column if not exists kvkk_onay_tarihi    timestamptz,
  add column if not exists kvkk_onay_versiyonu text;

comment on column public.profiles.kvkk_onay_verildi is
  '6698 sayılı KVKK kapsamında Aydınlatma Metni + Açık Rıza onayının verilip verilmediği.';
comment on column public.profiles.kvkk_onay_tarihi is
  'Onayın verildiği tarih/saat.';
comment on column public.profiles.kvkk_onay_versiyonu is
  'Onay verilen gizlilik politikası/KVKK metninin sürüm etiketi (ör. "2026-08"). Metin değişirse yeni onay istenebilmesi için.';

-- handle_new_user() trigger'ını, kayıt formundan gelen KVKK onayını da
-- (auth kullanıcı meta verisinden) profiles'a kopyalayacak şekilde
-- güncelliyoruz. Kayıt formu artık signUp() çağrısına
-- options.data = { full_name, kvkk_onay: true, kvkk_versiyon: "..." }
-- gönderiyor (bkz. auth-pages.js).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, avatar_url, role,
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
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
-- Bu fonksiyon zaten sadece trigger tarafından çağrılıyor; PUBLIC izinleri
-- 0002'de kapatılmıştı, CREATE OR REPLACE bunu bozmaz (izinler ayrı tutulur).

-- Google OAuth ile kayıt olanlar (signUp formu değil, doğrudan OAuth
-- akışı) için KVKK onayını AYRI bir adımda (ilk girişte panelde göstereceğimiz
-- bir uyarı ile) almamız gerekiyor — bu RPC, o onayı sonradan vermek için var.
create or replace function public.kvkk_onayini_ver(p_versiyon text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set kvkk_onay_verildi = true,
      kvkk_onay_tarihi = now(),
      kvkk_onay_versiyonu = p_versiyon
  where id = auth.uid();
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text) from public;
grant  execute on function public.kvkk_onayini_ver(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) ÖZEL İÇERİK: OKUNDU BİLGİSİ + OTOMATİK SON GEÇERLİLİK TARİHİ
--    content_access satırına üç yeni alan:
--      - okundu_mu / okundu_tarihi: içerik açıldığında OTOMATİK "true"
--        olur (ozel-icerik.js bunu işaretler); üye panelinden isterse
--        manuel olarak da "Okudum" diyebilir (zaten okunmuşsa no-op).
--      - son_gecerlilik_tarihi: admin, içeriği bir üyeye atarken bu
--        üye için bir tarih seçebilir (NULL = sınırsız). Bu tarih
--        geçtiğinde erişim satırı için iki şey olur:
--          1) RLS: has_content_access() artık süresi geçmiş atamaları
--             erişim olarak SAYMAZ (üye içeriği hemen kaybeder).
--          2) Fiziksel silme: pg_cron VARSA otomatik, yoksa admin panel
--             her açılışta "süresi geçmiş atamaları temizle" RPC'sini
--             çağırır (bkz. aşağıdaki temizle_suresi_gecmis_erisimleri()).
--             Bu, "önce sistem kendi oto kontrol etsin, sonra bir
--             tarihten sonra silinsin" isteğini karşılar: RLS sayesinde
--             süre dolar dolmaz erişim ANINDA kesilir (fiziksel satır
--             hâlâ dursa bile göremez), fiziksel satır da en geç bir
--             sonraki admin paneli ziyaretinde / cron çalışmasında silinir.
-- ----------------------------------------------------------------------------
alter table public.content_access
  add column if not exists okundu_mu boolean not null default false,
  add column if not exists okundu_tarihi timestamptz,
  add column if not exists son_gecerlilik_tarihi timestamptz;

comment on column public.content_access.okundu_mu is
  'Üye içeriği açtığında otomatik true olur; üye panelden manuel de işaretleyebilir.';
comment on column public.content_access.son_gecerlilik_tarihi is
  'NULL = sınırsız erişim. Doluysa bu tarihten sonra erişim otomatik kesilir (RLS) ve satır fiziksel olarak silinir (temizlik fonksiyonu / cron).';

-- has_content_access(): artık süresi geçmiş atamaları erişim SAYMIYOR.
create or replace function public.has_content_access(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.content_access
    where content_id = p_content_id
      and user_id = auth.uid()
      and (son_gecerlilik_tarihi is null or son_gecerlilik_tarihi > now())
  ) or public.is_admin();
$$;

-- Üyenin kendi erişim satırını "okundu" işaretlemesi için RPC (sadece
-- kendi satırını, sadece true'ya çevirebilir — content_access üzerindeki
-- RLS zaten insert/update'i admin'e kilitlediği için doğrudan UPDATE
-- kullanıcıya kapalı; bu güvenli/dar bir "delik" açıyoruz).
create or replace function public.icerik_okundu_isaretle(p_content_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.content_access
  set okundu_mu = true,
      okundu_tarihi = coalesce(okundu_tarihi, now())
  where content_id = p_content_id
    and user_id = auth.uid()
    and (son_gecerlilik_tarihi is null or son_gecerlilik_tarihi > now());
end;
$$;

revoke execute on function public.icerik_okundu_isaretle(uuid) from public;
grant  execute on function public.icerik_okundu_isaretle(uuid) to authenticated;

-- Süresi geçmiş atamaları fiziksel olarak temizler. Admin sadece admin
-- olduğu için çalıştırabilir; admin.js sayfa her açıldığında bunu bir kere
-- çağırır ("sistem kendi oto kontrol etsin" isteğinin fiziksel silme kısmı).
create or replace function public.temizle_suresi_gecmis_erisimleri()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  silinen_sayisi integer;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem.';
  end if;
  delete from public.content_access
  where son_gecerlilik_tarihi is not null and son_gecerlilik_tarihi <= now();
  get diagnostics silinen_sayisi = row_count;
  return silinen_sayisi;
end;
$$;

revoke execute on function public.temizle_suresi_gecmis_erisimleri() from public;
grant  execute on function public.temizle_suresi_gecmis_erisimleri() to authenticated;

-- pg_cron uzantısı projende AKTİFSE (Dashboard > Database > Extensions),
-- aşağıdaki satırları açıp çalıştırarak günlük otomatik temizlik
-- kurabilirsin (opsiyonel — admin paneli zaten her açılışta temizliyor).
-- Not: pg_cron her projede varsayılan açık gelmeyebilir, bu yüzden bu
-- blok hataya düşmesin diye "if exists" ile korumalı çalışır.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'ozel-icerik-suresi-gecmis-temizlik',
      '0 3 * * *',  -- her gün 03:00 UTC
      $cron$ delete from public.content_access
             where son_gecerlilik_tarihi is not null and son_gecerlilik_tarihi <= now(); $cron$
    );
  end if;
exception when others then
  -- pg_cron kurulu değilse veya izin yoksa sessizce geç: admin panelindeki
  -- manuel/otomatik temizlik zaten yeterli, migration burada durmasın.
  raise notice 'pg_cron zamanlanmış görevi kurulamadı (uzantı aktif olmayabilir) — sorun değil, admin paneli temizliği zaten yapıyor.';
end $$;

-- ----------------------------------------------------------------------------
-- 4) ÖZEL İÇERİK: GERİ DÜZELTME (İÇERİĞİ SONRADAN DÜZENLEME)
--    "Özel içerik gönderdikten sonra geri düzeltme seçeneği olsun" —
--    special_content zaten UPDATE için admin-only RLS politikasına sahipti
--    (0001, satır 238-242), yani veritabanı tarafı hazırdı. Eksik olan
--    admin panelindeki DÜZENLEME FORMU'ydu (sadece "Sil" butonu vardı,
--    "Düzenle" yoktu) — bunu admin.js'te ekliyoruz. Burada sadece,
--    düzenleme sırasında hangi üyelerin erişiminin güncellendiğini takip
--    edebilmek için content_access.granted_at zaten var, ekstra bir şey
--    gerekmiyor.
-- ----------------------------------------------------------------------------
-- (Bu bölüm bilgilendirme amaçlı — şema değişikliği gerektirmiyor.)

-- ----------------------------------------------------------------------------
-- 5) ADMİN: HERHANGİ BİR ÜYEYİ SİLEBİLME (KENDİSİ DAHİL)
--    Eski delete-account Edge Function'ı SADECE "kendi token'ınla kendi
--    hesabını sil" akışını destekliyordu. Admin panelinden "şu üyeyi sil"
--    butonu bu yüzden hata veriyordu (fonksiyon böyle bir işlemi hiç
--    tanımıyordu). Edge Function'ı güncelledik (bkz.
--    supabase/functions/delete-account/index.ts) — artık isteğe bağlı bir
--    "hedef_kullanici_id" parametresi alıyor: boşsa "kendini sil", doluysa
--    "adminsen hedefi sil". Admin'in KENDİ hesabını silebilmesi de aynı
--    "kendini sil" yoluyla zaten çalışıyor; sorun admin'in BAŞKASINI
--    silememesindeydi, bunu Edge Function'daki yetki kontrolü ekliyor.
--
--    Bu RPC, Edge Function'ın "hedefin verilerini temizle" adımında admin
--    adına service_role ile çağrılır (kullanıcı doğrudan çağırmaz).
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.content_access where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
end;
$$;

-- Bu fonksiyon SADECE service_role (Edge Function) tarafından çağrılır,
-- normal kullanıcıların RPC ile doğrudan erişimine KAPALI tutuyoruz.
revoke execute on function public.admin_delete_user_data(uuid) from public, authenticated;

-- ----------------------------------------------------------------------------
-- 6) ADMİN PANELİNDE ÜYE ARAMA (İSİM VEYA E-POSTA)
--    profiles tablosu zaten admin için tüm satırları SELECT edilebilir
--    kılıyordu (RLS: "auth.uid() = id or public.is_admin()"), yani
--    e-postalar teknik olarak zaten admin'e görünüyordu — eksik olan
--    admin.js'teki arama/filtreleme KUTUSU'ydu, onu ekliyoruz. Ekstra
--    olarak, çok sayıda üye olduğunda hızlı arama için email ve full_name
--    üzerinde bir indeks ekliyoruz (performans, RLS'i etkilemez).
-- ----------------------------------------------------------------------------
-- gin_trgm_ops kullanan indeksleri oluşturmadan ÖNCE pg_trgm uzantısını
-- kurmamız gerekiyor (sıralama önemli — extension yoksa index oluşturma
-- hata verir).
create extension if not exists "pg_trgm";

create index if not exists idx_profiles_email     on public.profiles using gin (email gin_trgm_ops);
create index if not exists idx_profiles_full_name on public.profiles using gin (full_name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 7) 2FA (TOTP) — SUPABASE'İN YERLEŞİK MFA DESTEĞİ
--    Supabase Auth'un MFA/TOTP özelliği auth.mfa_factors tablosunu ve
--    supabase.auth.mfa.* client fonksiyonlarını kullanır; bu, Supabase'in
--    kendi yönettiği auth şemasının bir parçasıdır ve BURADA (public
--    şemada) ekstra bir tablo GEREKTİRMEZ. Panel tarafı (panel.js) artık
--    supabase.auth.mfa.enroll() / .challenge() / .verify() çağrılarını
--    kullanıyor. Bu migration'da yapman gereken TEK şey, Dashboard'dan
--    MFA'nın açık olduğunu doğrulamak:
--      Dashboard > Authentication > Providers > (sayfanın altı) "Multi-Factor
--      Authentication" bölümünde "Authenticator App (TOTP)" seçeneğinin
--      açık olduğundan emin ol (Supabase projelerinde bu varsayılan olarak
--      zaten açıktır, kapatılmadıysa ekstra bir işlem gerekmez).
--    SQL tarafında yapılacak tek şey yok, bu blok bilgi amaçlıdır.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 8) "LEAKED PASSWORD PROTECTION" UYARISI (SQL İLE KAPATILAMAZ)
--    Security Advisor listendeki "Leaked Password Protection Disabled"
--    uyarısı bir Auth AYARIDIR, migration/SQL ile değiştirilemez. Kapatmak
--    için: Dashboard > Authentication > Policies (veya Auth > Settings) >
--    "Password Security" > "Leaked password protection" seçeneğini AÇ.
--    Bu, HaveIBeenPwned veritabanına karşı şifreleri kontrol ederek daha
--    önce sızdırılmış şifrelerin kullanılmasını engeller. Bunu açtıktan
--    sonra Security Advisor'da "Rerun linter" dediğinde bu uyarı da gider.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 9) FONKSİYON İZİNLERİNİ TOPLU NORMALİZE ETME
--    Yeni eklenen tüm fonksiyonlarda PUBLIC'i baştan kapatıp sadece
--    gerçekten ihtiyacı olan role'e veriyoruz (yukarıda tek tek yapıldı).
--    Burada ek olarak, is_admin() ve has_content_access() CREATE OR REPLACE
--    ile yeniden tanımlandığı için PUBLIC grant'i TEKRAR açılmış olabilir
--    (Postgres'te REPLACE, izinleri KORUR aslında — ama garanti olsun diye
--    tekrar kapatıp açıyoruz, zararı yok, idempotent).
-- ----------------------------------------------------------------------------
revoke execute on function public.has_content_access(uuid) from public;
grant  execute on function public.has_content_access(uuid) to anon, authenticated;

-- ============================================================================
-- BİTTİ. Sırada:
--   1) supabase/functions/delete-account/index.ts dosyasını YENİDEN DEPLOY et:
--      supabase functions deploy delete-account
--   2) Dashboard > Authentication > Auth Settings > "Leaked password
--      protection" seçeneğini aç (SQL ile yapılamıyor, madde 8'e bak).
--   3) Dashboard > Advisors > Security Advisor > "Rerun linter" ile
--      kalan uyarı sayısını doğrula.
-- ============================================================================

-- Security Advisor (Linter) yetki kısıtlamaları
REVOKE EXECUTE ON FUNCTION public.kvkk_onayini_ver(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_role_self_escalation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.temizle_suresi_gecmis_erisimleri() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_own_profile_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_content_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.icerik_okundu_isaretle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.kvkk_onayini_ver(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_profile_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_content_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.icerik_okundu_isaretle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
