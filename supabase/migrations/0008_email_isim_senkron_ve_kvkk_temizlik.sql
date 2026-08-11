-- ============================================================================
-- 0008_email_isim_senkron_ve_kvkk_temizlik.sql
-- Abdullah Eymen Asru — 5 kullanıcı bildirimi kapsamında veritabanı tarafı
-- düzeltmeleri:
--
--   (3) E-posta değişince (admin panelinden VEYA kullanıcının kendi çift
--       onaylı akışından) public.profiles.email ve auth.users.email
--       birbirinden KOPUYORDU: auth.users güncelleniyordu ama profiles'ta
--       hiçbir zaman yansımıyordu (admin panel, Supabase Table Editor ve
--       kullanıcı panelinin hepsi profiles'tan okuduğu için hepsi eski
--       adresi göstermeye devam ediyordu). Kök neden: auth.users için
--       sadece INSERT trigger'ı (handle_new_user) vardı, UPDATE trigger'ı
--       hiç yoktu.
--
--   (4) full_name TEK bir metin alanıydı; Ad/Soyad ayrı tutulamıyordu.
--       first_name/last_name ekleniyor, full_name ikisinden OTOMATİK
--       türetilen (generated) bir alana çevriliyor ki eski kod/sorgular
--       (full_name'e göre arama, admin tablosu vb.) bozulmasın.
--
--   (5) KVKK onayı verilmeden (özellikle "Google ile Giriş Yap" akışında
--       OAuth başladıktan SONRA kontrol edildiği için) oluşmuş ama hiç
--       tamamlanmamış hesaplar, sadece signOut() edildiği için
--       auth.users + profiles içinde "kvkk_onay_verildi = false" olarak
--       KALICI kalıyordu. Bu dosya (a) BUGÜNE KADAR birikmiş bu tür
--       "yetim" hesapları tek seferlik temizler, (b) ileride oluşacaklar
--       için frontend'i (auth-pages.js) hesabı gerçekten SİLECEK şekilde
--       günceller (bkz. o dosyadaki değişiklik).
--
-- Bu dosyayı Supabase Dashboard > SQL Editor'e yapıştırıp Run'a bas.
-- Önceki migration'ları (0001-0007) DEĞİŞTİRMİYORUZ, üzerine ekliyoruz.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) AD / SOYAD AYRIMI
--    full_name'i "generated always as" ile first_name + last_name'den
--    OTOMATİK türetilen bir alana çeviriyoruz. Böylece:
--      - full_name'e göre arama yapan eski kod (admin.js, panel.js,
--        idx_profiles_full_name indeksi) DEĞİŞMEDEN çalışmaya devam eder,
--      - ama artık tek doğruluk kaynağı first_name/last_name'dir ve ikisi
--        her yerde ayrı ayrı düzenlenebilir/gösterilebilir.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Var olan tek parça full_name değerlerini ilk boşluğa göre first/last
-- olarak bölüyoruz (tek seferlik, geriye dönük veri taşıma). Boşluk yoksa
-- tamamı first_name'e gider, last_name boş kalır — kullanıcı panelden
-- düzeltebilir.
update public.profiles
set
  first_name = coalesce(first_name, nullif(split_part(trim(full_name), ' ', 1), '')),
  last_name  = coalesce(
    last_name,
    nullif(trim(substring(trim(full_name) from length(split_part(trim(full_name), ' ', 1)) + 1)), '')
  )
where full_name is not null and (first_name is null or last_name is null);

-- full_name artık elle yazılamaz — first_name/last_name'den TÜRETİLİR.
-- (Postgres generated column önce eski kolonu silmeyi gerektirir çünkü
-- "generated" bir kolonu normal bir kolona/dan dönüştüremeyiz.)
alter table public.profiles drop column if exists full_name;
alter table public.profiles
  add column full_name text generated always as (
    trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored;

comment on column public.profiles.first_name is 'Ad. Kayıt formunda ve panelde ayrı bir alan olarak düzenlenir.';
comment on column public.profiles.last_name  is 'Soyad. Kayıt formunda ve panelde ayrı bir alan olarak düzenlenir.';
comment on column public.profiles.full_name  is 'first_name + last_name''den OTOMATİK türetilir (generated column) — artık doğrudan yazılamaz, geriye dönük uyumluluk (arama/gösterim) için tutulur.';

-- full_name kolonunu DROP+CREATE ile yeniden oluşturduğumuz için, buna
-- bağlı eski GIN trigram indeksi (0003'te oluşturulmuştu) otomatik
-- düştü — yeniden kuruyoruz (arama performansı için, zorunlu değil).
drop index if exists public.idx_profiles_full_name;
create index if not exists idx_profiles_full_name on public.profiles using gin (full_name gin_trgm_ops);
create index if not exists idx_profiles_first_name on public.profiles using gin (first_name gin_trgm_ops);
create index if not exists idx_profiles_last_name  on public.profiles using gin (last_name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 2) handle_new_user(): first_name/last_name'i de doldursun
--    Kayıt formu artık options.data içinde first_name/last_name gönderir
--    (bkz. auth-pages.js). Google OAuth'tan gelen "name"/"full_name"
--    meta verisi TEK parça olduğu için, ayrıştırıp ikisine bölüyoruz —
--    kullanıcı istersen panelden ayrı ayrı düzeltebilir.
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

  -- first_name/last_name meta verisi yoksa (ör. Google OAuth, ya da eski
  -- bir istemci hâlâ full_name/name gönderiyorsa) tek parça isimden böl.
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

-- ----------------------------------------------------------------------------
-- 3) auth.users GÜNCELLENİNCE profiles'ı OTOMATİK senkron eden trigger
--    Şimdiye kadar SADECE ekleme (INSERT) trigger'ı vardı. E-posta admin
--    panelinden (admin.admin.updateUserById), kullanıcının kendi çift
--    onaylı akışından (updateUser({email})) veya Google hesabı ismi
--    değiştiğinde auth.users güncellenir ama profiles hiç haberdar
--    olmuyordu. Bu trigger ikisini bağlar:
--      - e-posta değiştiyse  -> profiles.email güncellenir
--      - isim meta verisi değiştiyse (nadiren, Google tarafında) ve
--        kullanıcı panelden kendi ismini HİÇ değiştirmemişse (first_name
--        ve last_name ikisi de boşsa) -> profiles.first_name/last_name
--        güncellenir. Kullanıcı panelden bir kere kendi ismini
--        düzenlediyse, Google'ın gönderdiği meta veri onun ÜZERİNE
--        YAZILMAZ (kullanıcının kendi tercihine saygı).
-- ----------------------------------------------------------------------------
create or replace function public.handle_user_update()
returns trigger
language plpgsql
security definer
set search_path = public
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
    -- Profil satırı hiç yoksa (teorik olarak olmamalı, ama savunmacı
    -- kod) burada bir şey yapmıyoruz — handle_new_user zaten ilgilenir.
    return new;
  end if;

  -- E-POSTA: auth.users.email değiştiyse profiles.email'i de eşitle.
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;

  -- İSİM: sadece kullanıcı panelden kendi ismini HİÇ girmemişse (ikisi de
  -- boş/null) ve Google'dan yeni bir isim meta verisi geldiyse doldur.
  if v_profil_isim_bos_mu then
    v_first := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
    v_last  := nullif(trim(new.raw_user_meta_data->>'last_name'), '');
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

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_user_update();

revoke execute on function public.handle_user_update() from public;

-- ----------------------------------------------------------------------------
-- 4) KVKK ONAYI VERİLMEDEN OLUŞMUŞ "YETİM" HESAPLARIN TEK SEFERLİK TEMİZLİĞİ
--    kvkk_onay_verildi = false olan VE en az 1 saat önce oluşturulmuş
--    (yeni tıklayan birini yanlışlıkla silmemek için küçük bir güvenlik
--    payı) hesapları siliyoruz. auth.users silinince profiles zaten
--    ON DELETE CASCADE ile gider; burada sadece auth.users'ı temizlemek
--    yeterlidir. NOT: admin panelinden "Yönetici" rolü verilmiş hiçbir
--    hesap bu koşula girmez (KVKK onayı olmayan biri zaten role
--    değiştirilemeyecek kadar erken aşamada kalır), yine de dokunulmaz
--    bir güvenlik önlemi olarak role='admin' olanları hariç tutuyoruz.
-- ----------------------------------------------------------------------------
do $$
declare
  v_silinen_id uuid;
  v_sayac int := 0;
begin
  for v_silinen_id in
    select p.id
    from public.profiles p
    where p.kvkk_onay_verildi = false
      and p.role <> 'admin'
      and p.created_at < now() - interval '1 hour'
  loop
    delete from auth.users where id = v_silinen_id;
    v_sayac := v_sayac + 1;
  end loop;
  raise notice 'KVKK onayı verilmemiş % adet yetim hesap silindi.', v_sayac;
end $$;

-- ----------------------------------------------------------------------------
-- BİTTİ. Sırada:
--   1) supabase/functions/admin-change-email/index.ts YENİDEN DEPLOY et
--      (email_confirm:true eklendi — bkz. o dosyadaki değişiklik):
--        supabase functions deploy admin-change-email
--   2) hesap/kayit.md + panel/panel.md formları first_name/last_name
--      kullanacak şekilde güncellendi (bkz. o dosyalardaki değişiklik) —
--      ekstra bir deploy adımı gerekmez, statik dosyalar otomatik yayınlanır.
-- ============================================================================
