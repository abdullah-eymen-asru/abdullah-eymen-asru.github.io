-- ============================================================================
-- 0057_r2_arsiv_dosya_yoneticisi_ve_e2ee.sql
--
-- İKİ ÖZELLİK, TEK MİGRATION:
--   (A) R2 Dosya Yöneticisi — klasör ağacı/dosya listesi/arama TAMAMEN bu
--       PostgreSQL tablosundan (r2_arsiv) çalışır; R2'ye ListObjectsV2
--       ATILMAZ. R2 anahtarları (r2_key) rastgele/opak olduğu için klasör
--       ve dosya yeniden adlandırma/taşıma R2'de HİÇBİR işlem gerektirmez.
--   (B) Özel dosya paylaşımı için şifreli zarf tabloları (E2EE).
--
-- DOKUNULMAYANLAR: ozellik_erisimleri (0048/0051), indirme_loglari (0005),
-- r2_storage_worker'ın kullandığı content_access akışı. Yeni sistem AYRI bir
-- R2 öneki ("arsiv/") ve AYRI tablolar kullanır; mevcut sistem aynen çalışır.
--
-- YETKİ MODELİ (r2_arsiv_izinleri):
--   owner  -> her zaman tam yetki (kısıtlanamaz).
--   admin  -> varsayılan tam yetki; owner panelden kısabilir.
--   diğer  -> varsayılan YOK; owner rol bazında ya da tek tek kullanıcıya
--             (oku / yukle / sil) açabilir. Kullanıcıya özel kayıt, rol
--             kaydının önüne geçer. Askıdaki hesap her zaman reddedilir.
--
-- Bu dosyayı Supabase SQL Editor'da çalıştır (0001-0055 uygulanmış olmalı).
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- 1) İZİNLER
-- ----------------------------------------------------------------------------
create table if not exists public.r2_arsiv_izinleri (
  id         uuid primary key default gen_random_uuid(),
  hedef_tur  text not null check (hedef_tur in ('rol', 'kullanici')),
  hedef      text not null,                       -- rol adı ya da kullanıcı uuid'i
  oku        boolean not null default false,
  yukle      boolean not null default false,
  sil        boolean not null default false,
  guncelleyen_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (hedef_tur, hedef),
  check (hedef_tur <> 'rol' or hedef in ('user','special_user','editor','manager','admin')),
  check (hedef_tur <> 'kullanici' or hedef ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

alter table public.r2_arsiv_izinleri enable row level security;
revoke all on public.r2_arsiv_izinleri from public, anon, authenticated;   -- yalnızca RPC

-- Çekirdek karar fonksiyonu — SADECE service_role (Worker) ve aşağıdaki
-- sarmalayıcılar çağırır; rastgele bir kullanıcı başkasının yetkisini sorgulayamaz.
create or replace function public.r2_arsiv_yetkisi(p_uid uuid, p_islem text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rol text; v_askida boolean; v_k record; v_r record;
begin
  if p_islem not in ('oku','yukle','sil') then return false; end if;

  select role, coalesce(is_suspended, false) into v_rol, v_askida
  from public.profiles where id = p_uid;
  if v_rol is null or v_askida then return false; end if;
  if v_rol = 'owner' then return true; end if;

  select oku, yukle, sil into v_k
  from public.r2_arsiv_izinleri where hedef_tur = 'kullanici' and hedef = p_uid::text;
  if found then
    return case p_islem when 'oku' then v_k.oku when 'yukle' then v_k.yukle else v_k.sil end;
  end if;

  select oku, yukle, sil into v_r
  from public.r2_arsiv_izinleri where hedef_tur = 'rol' and hedef = v_rol;
  if found then
    return case p_islem when 'oku' then v_r.oku when 'yukle' then v_r.yukle else v_r.sil end;
  end if;

  return v_rol = 'admin';          -- tek varsayılan: admin açık
end;
$$;
revoke all on function public.r2_arsiv_yetkisi(uuid, text) from public, anon, authenticated;
grant execute on function public.r2_arsiv_yetkisi(uuid, text) to service_role;

-- RLS politikalarının ve arayüzün kullandığı, SADECE çağıranın kendisi için sorgulayan sarmalayıcılar.
create or replace function public.r2_arsiv_yetkim(p_islem text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.r2_arsiv_yetkisi(auth.uid(), p_islem); $$;
revoke all on function public.r2_arsiv_yetkim(text) from public, anon;
grant execute on function public.r2_arsiv_yetkim(text) to authenticated;

-- Arayüz: tek çağrıda {oku, yukle, sil, paylasilan_var}
create or replace function public.r2_arsiv_yetkilerim()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  -- plpgsql: gövde çalışma anında çözülür (aşağıda oluşturulan tablolara referans var)
  return jsonb_build_object(
    'oku',   public.r2_arsiv_yetkisi(auth.uid(), 'oku'),
    'yukle', public.r2_arsiv_yetkisi(auth.uid(), 'yukle'),
    'sil',   public.r2_arsiv_yetkisi(auth.uid(), 'sil'),
    'paylasilan_var', exists (
       select 1 from public.ozel_icerik_anahtarlar k
       join public.r2_arsiv a on a.id = k.dosya_id
       where k.alici_id = auth.uid() and a.sahip_id <> auth.uid())
  );
end;
$$;
revoke all on function public.r2_arsiv_yetkilerim() from public, anon;
grant execute on function public.r2_arsiv_yetkilerim() to authenticated;

-- ----------------------------------------------------------------------------
-- 2) ARŞİV İNDEKSİ (R2 meta verisi)
-- ----------------------------------------------------------------------------
create table if not exists public.r2_arsiv (
  id          uuid primary key default gen_random_uuid(),
  tur         text not null check (tur in ('dosya','klasor')),
  ad          text not null check (char_length(ad) between 1 and 200
                                   and ad !~ '[/\\[:cntrl:]]' and ad not in ('.','..')),
  -- ÜST klasörün yolu: '' = kök, 'belgeler/2026/' = belgeler > 2026 içinde.
  klasor_yolu text not null default ''
              check (klasor_yolu ~ '^([^/\\[:cntrl:]]{1,200}/){0,10}$'
                     and klasor_yolu !~ '(^|/)\.\.(/|$)'),
  -- Klasör satırının kendi tam yolu (türetilmiş) — alt öğeleri bulmak için.
  tam_yol     text generated always as (case when tur = 'klasor' then klasor_yolu || ad || '/' end) stored,
  r2_key      text unique check (r2_key is null or r2_key ~ '^arsiv/[0-9a-f-]{36}$'),
  boyut       bigint check (boyut is null or boyut >= 0),
  mime        text,                              -- R2'ye giden Content-Type (şifreliyse octet-stream)
  gercek_mime text,                              -- şifreli dosyanın istemci beyanlı asıl türü
  sifreli     boolean not null default false,
  durum       text not null default 'hazir' check (durum in ('bekliyor','hazir')),
  sahip_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((tur = 'dosya' and r2_key is not null) or (tur = 'klasor' and r2_key is null and not sifreli))
);

create unique index if not exists r2_arsiv_ad_benzersiz on public.r2_arsiv (klasor_yolu, lower(ad));
create index if not exists r2_arsiv_klasor_idx   on public.r2_arsiv (klasor_yolu, tur desc, ad);
create index if not exists r2_arsiv_tam_yol_idx  on public.r2_arsiv (tam_yol) where tam_yol is not null;
create index if not exists r2_arsiv_ad_trgm_idx  on public.r2_arsiv using gin (ad extensions.gin_trgm_ops);
create index if not exists r2_arsiv_sahip_idx    on public.r2_arsiv (sahip_id);

drop trigger if exists trg_r2_arsiv_updated_at on public.r2_arsiv;
create trigger trg_r2_arsiv_updated_at before update on public.r2_arsiv
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) E2EE TABLOLARI
-- ----------------------------------------------------------------------------
-- Kullanıcının RSA-OAEP anahtar çifti. özel anahtar tarayıcıda, Worker'ın
-- türettiği kullanıcıya özel kasa anahtarıyla (AES-GCM) sarılıp BURAYA düz
-- değil SARILI yazılır -> veritabanı sızsa bile tek başına işe yaramaz.
create table if not exists public.e2ee_kullanici_anahtarlari (
  kullanici_id      uuid primary key references auth.users(id) on delete cascade,
  acik_anahtar      text not null,       -- base64 SPKI
  sarili_ozel_anahtar text not null,     -- base64 (AES-GCM ile sarılı PKCS8)
  iv                text not null,       -- base64 12 bayt
  surum             smallint not null default 1,
  created_at        timestamptz not null default now()
);
alter table public.e2ee_kullanici_anahtarlari enable row level security;
revoke all on public.e2ee_kullanici_anahtarlari from public, anon, authenticated;
grant select, insert on public.e2ee_kullanici_anahtarlari to authenticated;

drop policy if exists e2ee_anahtar_kendi_oku on public.e2ee_kullanici_anahtarlari;
create policy e2ee_anahtar_kendi_oku on public.e2ee_kullanici_anahtarlari
  for select to authenticated using (kullanici_id = auth.uid());
drop policy if exists e2ee_anahtar_kendi_ekle on public.e2ee_kullanici_anahtarlari;
create policy e2ee_anahtar_kendi_ekle on public.e2ee_kullanici_anahtarlari
  for insert to authenticated with check (kullanici_id = auth.uid());
-- UPDATE/DELETE politikası YOK: anahtar bir kez yazılır, başkası ezemez.

-- Dosya başına, alıcı başına zarflanmış dosya anahtarı.
create table if not exists public.ozel_icerik_anahtarlar (
  dosya_id            uuid not null references public.r2_arsiv(id) on delete cascade,
  alici_id            uuid not null references auth.users(id) on delete cascade,
  sarili_dosya_anahtari text not null,   -- base64 RSA-OAEP(alici_acik_anahtar, AES-256 dosya anahtarı)
  created_at          timestamptz not null default now(),
  primary key (dosya_id, alici_id)
);
alter table public.ozel_icerik_anahtarlar enable row level security;
revoke all on public.ozel_icerik_anahtarlar from public, anon, authenticated;
grant select, insert, delete on public.ozel_icerik_anahtarlar to authenticated;

drop policy if exists ozel_anahtar_alici_oku on public.ozel_icerik_anahtarlar;
create policy ozel_anahtar_alici_oku on public.ozel_icerik_anahtarlar
  for select to authenticated using (alici_id = auth.uid());

drop policy if exists ozel_anahtar_gonderen_ekle on public.ozel_icerik_anahtarlar;
create policy ozel_anahtar_gonderen_ekle on public.ozel_icerik_anahtarlar
  for insert to authenticated
  with check (exists (select 1 from public.r2_arsiv a
                      where a.id = dosya_id and a.sahip_id = auth.uid() and a.sifreli
                        and public.r2_arsiv_yetkim('yukle')));

drop policy if exists ozel_anahtar_gonderen_sil on public.ozel_icerik_anahtarlar;
create policy ozel_anahtar_gonderen_sil on public.ozel_icerik_anahtarlar
  for delete to authenticated
  using (exists (select 1 from public.r2_arsiv a where a.id = dosya_id and a.sahip_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 4) r2_arsiv RLS — doğrudan yazma YOK (Worker service_role + aşağıdaki RPC'ler)
-- ----------------------------------------------------------------------------
alter table public.r2_arsiv enable row level security;
revoke all on public.r2_arsiv from public, anon, authenticated;
grant select on public.r2_arsiv to authenticated;

drop policy if exists r2_arsiv_oku on public.r2_arsiv;
create policy r2_arsiv_oku on public.r2_arsiv
  for select to authenticated
  using (
    (durum = 'hazir' and (
        (not sifreli and public.r2_arsiv_yetkim('oku'))
        or sahip_id = auth.uid()
        or exists (select 1 from public.ozel_icerik_anahtarlar k
                   where k.dosya_id = r2_arsiv.id and k.alici_id = auth.uid())
    ))
    or (durum = 'bekliyor' and sahip_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 5) KULLANICI RPC'LERİ (klasör oluştur / yeniden adlandır — R2 işlemi SIFIR)
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_klasor_olustur(p_klasor_yolu text, p_ad text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_ust_ad text; v_ust_yol text;
begin
  if not public.r2_arsiv_yetkim('yukle') then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  p_klasor_yolu := coalesce(p_klasor_yolu, '');
  if p_klasor_yolu <> '' then
    v_ust_ad  := (regexp_match(p_klasor_yolu, '([^/]+)/$'))[1];
    v_ust_yol := left(p_klasor_yolu, length(p_klasor_yolu) - length(v_ust_ad) - 1);
    if not exists (select 1 from public.r2_arsiv
                   where tur = 'klasor' and klasor_yolu = v_ust_yol and ad = v_ust_ad) then
      raise exception 'Üst klasör bulunamadı.';
    end if;
  end if;
  insert into public.r2_arsiv (tur, ad, klasor_yolu, sahip_id)
  values ('klasor', btrim(p_ad), p_klasor_yolu, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_klasor_olustur(text, text) from public, anon;
grant execute on function public.r2_arsiv_klasor_olustur(text, text) to authenticated;

create or replace function public.r2_arsiv_yeniden_adlandir(p_id uuid, p_yeni_ad text)
returns void language plpgsql security definer set search_path = public
as $$
declare v record; v_eski text; v_yeni text;
begin
  if not public.r2_arsiv_yetkim('yukle') then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  select * into v from public.r2_arsiv where id = p_id for update;
  if not found then raise exception 'Öğe bulunamadı.'; end if;
  if v.sifreli and v.sahip_id is distinct from auth.uid() and not exists
     (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Şifreli dosyayı yalnızca gönderen yeniden adlandırabilir.' using errcode = '42501';
  end if;

  p_yeni_ad := btrim(p_yeni_ad);
  update public.r2_arsiv set ad = p_yeni_ad where id = p_id;

  if v.tur = 'klasor' then
    v_eski := v.tam_yol;
    v_yeni := v.klasor_yolu || p_yeni_ad || '/';
    update public.r2_arsiv
       set klasor_yolu = v_yeni || substr(klasor_yolu, length(v_eski) + 1)
     where starts_with(klasor_yolu, v_eski);
  end if;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_yeniden_adlandir(uuid, text) from public, anon;
grant execute on function public.r2_arsiv_yeniden_adlandir(uuid, text) to authenticated;

-- Alıcı seçimi / izin paneli için isim arama (e-posta ASLA dönmez; en az 2 karakter, en çok 15 sonuç).
create or replace function public.arsiv_kullanici_ara(p_q text)
returns table (id uuid, full_name text, role text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.r2_arsiv_yetkim('yukle')
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if p_q is null or char_length(btrim(p_q)) < 2 then return; end if;
  return query
    select p.id, p.full_name, p.role from public.profiles p
    where coalesce(p.is_suspended, false) = false
      and p.full_name ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by p.full_name limit 15;
end;
$$;
revoke all on function public.arsiv_kullanici_ara(text) from public, anon;
grant execute on function public.arsiv_kullanici_ara(text) to authenticated;

-- Alıcıların AÇIK anahtarları (açık anahtar gizli değildir). En çok 50 kişi.
create or replace function public.e2ee_acik_anahtarlar_getir(p_ids uuid[])
returns table (kullanici_id uuid, acik_anahtar text)
language sql stable security definer set search_path = public
as $$
  select k.kullanici_id, k.acik_anahtar
  from public.e2ee_kullanici_anahtarlari k
  where k.kullanici_id = any (p_ids[1:50]) and auth.uid() is not null;
$$;
revoke all on function public.e2ee_acik_anahtarlar_getir(uuid[]) from public, anon;
grant execute on function public.e2ee_acik_anahtarlar_getir(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) OWNER: izin yönetimi RPC'leri
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_izinlerini_getir()
returns table (hedef_tur text, hedef text, ad text, oku boolean, yukle boolean, sil boolean)
language sql stable security definer set search_path = public
as $$
  select i.hedef_tur, i.hedef,
         case when i.hedef_tur = 'kullanici' then coalesce(p.full_name, '(silinmiş kullanıcı)') else i.hedef end,
         i.oku, i.yukle, i.sil
  from public.r2_arsiv_izinleri i
  left join public.profiles p on i.hedef_tur = 'kullanici' and p.id::text = i.hedef
  where public.is_owner()
  order by i.hedef_tur desc, 3;
$$;
revoke all on function public.r2_arsiv_izinlerini_getir() from public, anon;
grant execute on function public.r2_arsiv_izinlerini_getir() to authenticated;

create or replace function public.r2_arsiv_izin_ayarla(p_tur text, p_hedef text, p_oku boolean, p_yukle boolean, p_sil boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi izinleri değiştirebilir.' using errcode = '42501';
  end if;
  if p_tur = 'kullanici' and exists (select 1 from public.profiles where id::text = p_hedef and role = 'owner') then
    raise exception 'Site Sahibi için izin kaydı tutulmaz (zaten kısıtlanamaz).';
  end if;
  insert into public.r2_arsiv_izinleri (hedef_tur, hedef, oku, yukle, sil, guncelleyen_id)
  values (p_tur, p_hedef, p_oku, p_yukle, p_sil, auth.uid())
  on conflict (hedef_tur, hedef)
  do update set oku = excluded.oku, yukle = excluded.yukle, sil = excluded.sil,
                guncelleyen_id = auth.uid(), updated_at = now();
end;
$$;
revoke all on function public.r2_arsiv_izin_ayarla(text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.r2_arsiv_izin_ayarla(text, text, boolean, boolean, boolean) to authenticated;

create or replace function public.r2_arsiv_izin_kaldir(p_tur text, p_hedef text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  delete from public.r2_arsiv_izinleri where hedef_tur = p_tur and hedef = p_hedef;
end;
$$;
revoke all on function public.r2_arsiv_izin_kaldir(text, text) from public, anon;
grant execute on function public.r2_arsiv_izin_kaldir(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) KOTA SAYACI — Worker her Class A/B işlemden ÖNCE yer ayırtır; limit
--    aşılacaksa işlem hiç yapılmaz. (Atomik: tek UPDATE ... WHERE sayi+adet <= limit)
-- ----------------------------------------------------------------------------
create table if not exists public.r2_islem_sayaci (
  ay    text   not null,            -- 'YYYY-MM' (UTC)
  sinif text   not null check (sinif in ('A','B')),
  sayi  bigint not null default 0,
  primary key (ay, sinif)
);
alter table public.r2_islem_sayaci enable row level security;
revoke all on public.r2_islem_sayaci from public, anon, authenticated;

create or replace function public.r2_islem_rezerve_et(p_sinif text, p_adet int, p_limit bigint)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_ay text := to_char(now() at time zone 'utc', 'YYYY-MM'); v_say bigint;
begin
  insert into public.r2_islem_sayaci (ay, sinif) values (v_ay, p_sinif) on conflict do nothing;
  update public.r2_islem_sayaci set sayi = sayi + p_adet
   where ay = v_ay and sinif = p_sinif and sayi + p_adet <= p_limit
  returning sayi into v_say;
  return v_say is not null;
end;
$$;
revoke all on function public.r2_islem_rezerve_et(text, int, bigint) from public, anon, authenticated;
grant execute on function public.r2_islem_rezerve_et(text, int, bigint) to service_role;

-- ----------------------------------------------------------------------------
-- 8) WORKER RPC'LERİ (yalnızca service_role)
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_yukleme_baslat(
  p_sahip uuid, p_ad text, p_klasor_yolu text, p_boyut bigint,
  p_mime text, p_gercek_mime text, p_sifreli boolean, p_r2_key text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_ust_ad text; v_ust_yol text;
begin
  p_klasor_yolu := coalesce(p_klasor_yolu, '');
  if p_klasor_yolu <> '' then
    v_ust_ad  := (regexp_match(p_klasor_yolu, '([^/]+)/$'))[1];
    v_ust_yol := left(p_klasor_yolu, length(p_klasor_yolu) - length(v_ust_ad) - 1);
    if not exists (select 1 from public.r2_arsiv
                   where tur = 'klasor' and klasor_yolu = v_ust_yol and ad = v_ust_ad) then
      raise exception 'Hedef klasör bulunamadı.';
    end if;
  end if;
  -- Yarım kalmış (1 saatten eski) aynı adlı yükleme kaydı adı sonsuza dek kilitlemesin.
  delete from public.r2_arsiv
   where durum = 'bekliyor' and created_at < now() - interval '1 hour'
     and klasor_yolu = p_klasor_yolu and lower(ad) = lower(btrim(p_ad));
  insert into public.r2_arsiv (tur, ad, klasor_yolu, r2_key, boyut, mime, gercek_mime, sifreli, durum, sahip_id)
  values ('dosya', btrim(p_ad), p_klasor_yolu, p_r2_key, p_boyut, p_mime, p_gercek_mime, p_sifreli, 'bekliyor', p_sahip)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_yukleme_baslat(uuid,text,text,bigint,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.r2_arsiv_yukleme_baslat(uuid,text,text,bigint,text,text,boolean,text) to service_role;

create or replace function public.r2_arsiv_yukleme_bitir(p_id uuid, p_sahip uuid, p_boyut bigint)
returns text language plpgsql security definer set search_path = public
as $$
declare v_key text;
begin
  update public.r2_arsiv set durum = 'hazir', boyut = p_boyut
   where id = p_id and sahip_id = p_sahip and durum = 'bekliyor'
  returning r2_key into v_key;
  return v_key;
end;
$$;
revoke all on function public.r2_arsiv_yukleme_bitir(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.r2_arsiv_yukleme_bitir(uuid, uuid, bigint) to service_role;

-- Bekleyen kaydın bilgisi (bitir adımında boyut/anahtar doğrulaması için)
create or replace function public.r2_arsiv_bekleyen_getir(p_id uuid, p_sahip uuid)
returns table (r2_key text, boyut bigint)
language sql stable security definer set search_path = public
as $$ select a.r2_key, a.boyut from public.r2_arsiv a
    where a.id = p_id and a.sahip_id = p_sahip and a.durum = 'bekliyor'; $$;
revoke all on function public.r2_arsiv_bekleyen_getir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.r2_arsiv_bekleyen_getir(uuid, uuid) to service_role;

-- İndirme: hazır dosyanın r2_key'i (yetkisizse NULL)
create or replace function public.r2_arsiv_indirme_anahtari(p_uid uuid, p_id uuid)
returns table (r2_key text, ad text, mime text, sifreli boolean)
language sql stable security definer set search_path = public
as $$
  select a.r2_key, a.ad, a.mime, a.sifreli
  from public.r2_arsiv a
  where a.id = p_id and a.tur = 'dosya' and a.durum = 'hazir'
    and ( (not a.sifreli and public.r2_arsiv_yetkisi(p_uid, 'oku'))
          or a.sahip_id = p_uid
          or exists (select 1 from public.ozel_icerik_anahtarlar k
                     where k.dosya_id = a.id and k.alici_id = p_uid) );
$$;
revoke all on function public.r2_arsiv_indirme_anahtari(uuid, uuid) from public, anon, authenticated;
grant execute on function public.r2_arsiv_indirme_anahtari(uuid, uuid) to service_role;

-- Silme: yetki + silinecek tüm r2_key'ler (klasörse alt ağaç dahil)
create or replace function public.r2_arsiv_silinecekleri_getir(p_uid uuid, p_id uuid)
returns table (r2_key text)
language plpgsql stable security definer set search_path = public
as $$
declare v record; v_owner boolean;
begin
  if not public.r2_arsiv_yetkisi(p_uid, 'sil') then
    raise exception 'yetkisiz' using errcode = '42501';
  end if;
  select * into v from public.r2_arsiv where id = p_id;
  if not found then raise exception 'bulunamadi' using errcode = 'P0002'; end if;
  select (role = 'owner') into v_owner from public.profiles where id = p_uid;

  if v.tur = 'dosya' then
    if v.sifreli and v.sahip_id is distinct from p_uid and not coalesce(v_owner, false) then
      raise exception 'yetkisiz' using errcode = '42501';
    end if;
    return query select v.r2_key where v.r2_key is not null;
  else
    -- başkasının şifreli dosyasını içeren klasörü yalnızca owner silebilir
    if not coalesce(v_owner, false) and exists (
         select 1 from public.r2_arsiv c
         where starts_with(c.klasor_yolu, v.tam_yol) and c.sifreli and c.sahip_id is distinct from p_uid) then
      raise exception 'yetkisiz' using errcode = '42501';
    end if;
    return query select c.r2_key from public.r2_arsiv c
                 where starts_with(c.klasor_yolu, v.tam_yol) and c.r2_key is not null;
  end if;
end;
$$;
revoke all on function public.r2_arsiv_silinecekleri_getir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.r2_arsiv_silinecekleri_getir(uuid, uuid) to service_role;

create or replace function public.r2_arsiv_kayitlari_sil(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v record;
begin
  select * into v from public.r2_arsiv where id = p_id;
  if not found then return; end if;
  if v.tur = 'klasor' then
    delete from public.r2_arsiv where starts_with(klasor_yolu, v.tam_yol);
  end if;
  delete from public.r2_arsiv where id = p_id;     -- ozel_icerik_anahtarlar satırları cascade ile gider
end;
$$;
revoke all on function public.r2_arsiv_kayitlari_sil(uuid) from public, anon, authenticated;
grant execute on function public.r2_arsiv_kayitlari_sil(uuid) to service_role;
