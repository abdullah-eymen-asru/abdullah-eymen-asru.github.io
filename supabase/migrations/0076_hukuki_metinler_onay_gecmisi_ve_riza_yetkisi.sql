-- ============================================================================
-- 0076_hukuki_metinler_onay_gecmisi_ve_riza_yetkisi.sql
-- Gereksinim: 0064, 0065, 0070, 0073 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase SQL Editor'de TEK SEFERDE çalıştır.
--
-- NE DEĞİŞİYOR
--   1) AÇIK RIZA için AYRI admin yetki anahtarı: site_ayarlari.riza_surum_admin_degistirebilir
--      (varsayılan KAPALI; yalnızca owner açar/kapar). Aydınlatma (KVKK) anahtarından bağımsızdır:
--        - riza_surum_yetkisi_var_mi()   owner her zaman; admin yalnızca bu anahtar açıkken
--        - riza_surumunu_degistir()      artık bu yetkiyi arar (eskiden KVKK anahtarına bağlıydı)
--      Geçiş: bu kolon İLK KEZ eklenirken değeri mevcut KVKK anahtarından kopyalanır; böylece daha önce
--      "adminler değiştirebilsin" açıksa admin yetkisini kaybetmez.
--   2) ONAY GEÇMİŞİ: public.onay_gecmisi — her üyenin hangi metni (aydınlatma | açık rıza), hangi
--      sürümle, ne zaman onayladığı / geri çektiği. Kayıt profiles üzerindeki TETİKLEYİCİDEN yazılır
--      (istemci, panel, RPC ya da elle SQL — hangi yoldan değişirse değişsin kaçmaz). Mevcut onaylar
--      "geri_doldurma" olarak bir kez işlenir (yalnızca SON durum bilinir; eski sürümler bilinmez).
--   3) RPC'ler: kendi_onay_gecmisim(), uye_onay_durumlari(), uye_onay_gecmisi(), hukuki_metin_yetkisi_var_mi().
--   4) kvkk_onay_ozeti() yeni sütunlarla (onaysız sayısı, iki yetki durumu).
--   5) hukuki_paket_surumu_yayinla(): açık rızayı da yükseltiyorsa iki yetkiyi de arar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) AÇIK RIZA ADMİN ANAHTARI
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'site_ayarlari' and column_name = 'riza_surum_admin_degistirebilir'
  ) then
    alter table public.site_ayarlari add column riza_surum_admin_degistirebilir boolean not null default false;
    update public.site_ayarlari set riza_surum_admin_degistirebilir = coalesce(kvkk_surum_admin_degistirebilir, false) where id = 1;
  end if;
end $$;

comment on column public.site_ayarlari.riza_surum_admin_degistirebilir is
  'true ise adminler de AÇIK RIZA sürümünü değiştirebilir (riza_surumunu_degistir). Aydınlatma anahtarından (kvkk_surum_admin_degistirebilir) bağımsız. Yalnızca owner değiştirir. Varsayılan false.';

grant update (riza_surum_admin_degistirebilir) on public.site_ayarlari to authenticated;
-- (UPDATE'i yalnızca owner yapabilir: mevcut site_ayarlari_update_owner RLS politikası)

create or replace function public.riza_surum_yetkisi_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'owner'
        or (
          p.role = 'admin'
          and not coalesce(p.is_suspended, false)
          and coalesce(s.riza_surum_admin_degistirebilir, false)
        )
    from public.profiles p
    left join public.site_ayarlari s on s.id = 1
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.riza_surum_yetkisi_var_mi() from public, anon;
grant execute on function public.riza_surum_yetkisi_var_mi() to authenticated;

-- Panel menüsü: iki yetkiden biri yeterli (sekme görünür; içerde her kart kendi yetkisine göre çalışır)
create or replace function public.hukuki_metin_yetkisi_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.kvkk_surum_yetkisi_var_mi() or public.riza_surum_yetkisi_var_mi();
$$;
revoke all on function public.hukuki_metin_yetkisi_var_mi() from public, anon;
grant execute on function public.hukuki_metin_yetkisi_var_mi() to authenticated;

create or replace function public.riza_surumunu_degistir(p_surum text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yeni text := btrim(coalesce(p_surum, ''));
begin
  if not public.riza_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: açık rıza sürümünü değiştirme yetkin yok.';
  end if;
  if v_yeni !~ '^v[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'Sürüm "v1.2" biçiminde olmalı.';
  end if;

  update public.site_ayarlari set guncel_riza_surumu = v_yeni where id = 1 returning guncel_riza_surumu into v_yeni;
  if not found then
    raise exception 'Ayar satırı bulunamadı.';
  end if;
  return v_yeni;
end;
$$;
revoke all on function public.riza_surumunu_degistir(text) from public, anon;
grant execute on function public.riza_surumunu_degistir(text) to authenticated;

create or replace function public.hukuki_paket_surumu_yayinla(p_surum text, p_riza_da boolean default true)
returns table (kvkk_surumu text, riza_surumu text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yeni text := btrim(coalesce(p_surum, ''));
begin
  if not public.kvkk_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: aydınlatma sürümünü değiştirme yetkin yok.';
  end if;
  if coalesce(p_riza_da, true) and not public.riza_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: açık rıza sürümünü değiştirme yetkin yok.';
  end if;
  if v_yeni !~ '^v[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'Sürüm "v1.2" biçiminde olmalı.';
  end if;

  return query
  update public.site_ayarlari s
     set guncel_kvkk_surumu = v_yeni,
         guncel_riza_surumu = case when coalesce(p_riza_da, true) then v_yeni else s.guncel_riza_surumu end
   where s.id = 1
  returning s.guncel_kvkk_surumu, s.guncel_riza_surumu;

  if not found then
    raise exception 'Ayar satırı bulunamadı.';
  end if;
end;
$$;
revoke all on function public.hukuki_paket_surumu_yayinla(text, boolean) from public, anon;
grant execute on function public.hukuki_paket_surumu_yayinla(text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) ONAY GEÇMİŞİ TABLOSU
-- ----------------------------------------------------------------------------
create table if not exists public.onay_gecmisi (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  tur              text not null check (tur in ('aydinlatma', 'acik_riza')),
  islem            text not null check (islem in ('onay', 'geri_cekme')),
  surum            text,
  kaynak           text not null default 'sistem' check (kaynak in ('sistem', 'geri_doldurma')),
  olusturma_tarihi timestamptz not null default now()
);
create index if not exists onay_gecmisi_uye_idx on public.onay_gecmisi (user_id, olusturma_tarihi desc);

comment on table public.onay_gecmisi is
  'Üyenin aydınlatma / açık rıza onay ve geri çekme olayları (sürüm + zaman damgası). profiles tetikleyicisinden yazılır; istemci erişimi yok, yalnızca SECURITY DEFINER RPC''ler. Hesap silinince birlikte silinir.';

alter table public.onay_gecmisi enable row level security;
revoke all on public.onay_gecmisi from public, anon, authenticated;
-- (politika yok: tüm erişim aşağıdaki RPC'lerden)

create or replace function public.profiles_onay_gecmisi_yaz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Aydınlatma metni
  if new.kvkk_onay_verildi is true
     and (tg_op = 'INSERT'
          or old.kvkk_onay_verildi is distinct from true
          or old.kvkk_onay_versiyonu is distinct from new.kvkk_onay_versiyonu
          or old.kvkk_onay_tarihi is distinct from new.kvkk_onay_tarihi) then
    insert into public.onay_gecmisi (user_id, tur, islem, surum, olusturma_tarihi)
    values (new.id, 'aydinlatma', 'onay', new.kvkk_onay_versiyonu, coalesce(new.kvkk_onay_tarihi, now()));
  elsif tg_op = 'UPDATE' and old.kvkk_onay_verildi is true and new.kvkk_onay_verildi is not true then
    insert into public.onay_gecmisi (user_id, tur, islem, surum)
    values (new.id, 'aydinlatma', 'geri_cekme', old.kvkk_onay_versiyonu);
  end if;

  -- Yurt dışı aktarım açık rızası (trg_profiles_riza_surumu BEFORE tetikleyicisi sürümü zaten damgaladı)
  if new.yurtdisi_onay_verildi is true
     and (tg_op = 'INSERT'
          or old.yurtdisi_onay_verildi is distinct from true
          or old.yurtdisi_onay_versiyonu is distinct from new.yurtdisi_onay_versiyonu
          or old.yurtdisi_onay_tarihi is distinct from new.yurtdisi_onay_tarihi) then
    insert into public.onay_gecmisi (user_id, tur, islem, surum, olusturma_tarihi)
    values (new.id, 'acik_riza', 'onay', new.yurtdisi_onay_versiyonu, coalesce(new.yurtdisi_onay_tarihi, now()));
  elsif tg_op = 'UPDATE' and old.yurtdisi_onay_verildi is true and new.yurtdisi_onay_verildi is not true then
    insert into public.onay_gecmisi (user_id, tur, islem, surum)
    values (new.id, 'acik_riza', 'geri_cekme', old.yurtdisi_onay_versiyonu);
  end if;

  return null;
end;
$$;
revoke all on function public.profiles_onay_gecmisi_yaz() from public, anon, authenticated;

drop trigger if exists trg_profiles_onay_gecmisi on public.profiles;
create trigger trg_profiles_onay_gecmisi
  after insert or update of kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu,
                            yurtdisi_onay_verildi, yurtdisi_onay_tarihi, yurtdisi_onay_versiyonu
  on public.profiles
  for each row execute function public.profiles_onay_gecmisi_yaz();

-- Geri doldurma: mevcut onayı olup hiç kaydı bulunmayan üyeler için TEK satır (yalnızca son durum bilinir).
insert into public.onay_gecmisi (user_id, tur, islem, surum, kaynak, olusturma_tarihi)
select p.id, 'aydinlatma', 'onay', p.kvkk_onay_versiyonu, 'geri_doldurma', coalesce(p.kvkk_onay_tarihi, p.created_at, now())
from public.profiles p
where p.kvkk_onay_verildi is true
  and not exists (select 1 from public.onay_gecmisi g where g.user_id = p.id and g.tur = 'aydinlatma');

insert into public.onay_gecmisi (user_id, tur, islem, surum, kaynak, olusturma_tarihi)
select p.id, 'acik_riza', 'onay', p.yurtdisi_onay_versiyonu, 'geri_doldurma', coalesce(p.yurtdisi_onay_tarihi, p.created_at, now())
from public.profiles p
where p.yurtdisi_onay_verildi is true
  and not exists (select 1 from public.onay_gecmisi g where g.user_id = p.id and g.tur = 'acik_riza');

-- ----------------------------------------------------------------------------
-- 3) RPC'LER
-- ----------------------------------------------------------------------------
-- 3a) Üyenin KENDİ geçmişi (Panelim'de gösterilir)
create or replace function public.kendi_onay_gecmisim()
returns table (tur text, islem text, surum text, kaynak text, olusturma_tarihi timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select g.tur, g.islem, g.surum, g.kaynak, g.olusturma_tarihi
  from public.onay_gecmisi g
  where g.user_id = auth.uid()
  order by g.olusturma_tarihi desc, g.id desc
  limit 200;
$$;
revoke all on function public.kendi_onay_gecmisim() from public, anon;
grant execute on function public.kendi_onay_gecmisim() to authenticated;

-- 3b) Yetkili için üye listesi + mevcut onay durumu (arama + filtre + sayfalama)
--     p_filtre: hepsi | eski (güncel olmayan onay) | rizasiz (açık rıza yok) | onaysiz (aydınlatma onayı yok)
create or replace function public.uye_onay_durumlari(
  p_q       text    default '',
  p_filtre  text    default 'hepsi',
  p_limit   integer default 25,
  p_ofset   integer default 0
)
returns table (
  id uuid, ad text, rol text, eposta text,
  kvkk_verildi boolean, kvkk_surum text, kvkk_tarih timestamptz, kvkk_guncel boolean,
  riza_verildi boolean, riza_surum text, riza_tarih timestamptz, riza_guncel boolean,
  toplam bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q     text := replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '');
  v_owner boolean := public.is_owner();
begin
  if not public.hukuki_metin_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üye onay kayıtlarını görme yetkin yok.';
  end if;
  if p_filtre not in ('hepsi', 'eski', 'rizasiz', 'onaysiz') then
    raise exception 'Geçersiz filtre.';
  end if;

  return query
  with s as (select sa.guncel_kvkk_surumu as kv, sa.guncel_riza_surumu as rz from public.site_ayarlari sa where sa.id = 1),
  d as (
    select p.id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye') as ad,
           p.role::text as rol,
           p.email::text as eposta,
           (p.kvkk_onay_verildi is true) as kvkk_verildi,
           p.kvkk_onay_versiyonu as kvkk_surum,
           p.kvkk_onay_tarihi as kvkk_tarih,
           (p.kvkk_onay_verildi is true and p.kvkk_onay_versiyonu = s.kv) as kvkk_guncel,
           (p.yurtdisi_onay_verildi is true) as riza_verildi,
           p.yurtdisi_onay_versiyonu as riza_surum,
           p.yurtdisi_onay_tarihi as riza_tarih,
           (p.yurtdisi_onay_verildi is true and p.yurtdisi_onay_versiyonu = s.rz) as riza_guncel
    from public.profiles p cross join s
    where v_q = ''
       or p.full_name ilike '%' || v_q || '%'
       or (v_owner and p.email ilike '%' || v_q || '%')
  ),
  f as (
    select d.* from d
    where case p_filtre
            when 'eski'    then (d.kvkk_verildi and not d.kvkk_guncel) or (d.riza_verildi and not d.riza_guncel)
            when 'rizasiz' then not d.riza_verildi
            when 'onaysiz' then not d.kvkk_verildi
            else true
          end
  )
  select f.id, f.ad, f.rol,
         case when v_owner then f.eposta else null end,
         f.kvkk_verildi, f.kvkk_surum, f.kvkk_tarih, f.kvkk_guncel,
         f.riza_verildi, f.riza_surum, f.riza_tarih, f.riza_guncel,
         count(*) over ()
  from f
  order by f.ad, f.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;
revoke all on function public.uye_onay_durumlari(text, text, integer, integer) from public, anon;
grant execute on function public.uye_onay_durumlari(text, text, integer, integer) to authenticated;

-- 3c) Tek üyenin tam onay geçmişi
create or replace function public.uye_onay_gecmisi(p_uye uuid)
returns table (tur text, islem text, surum text, kaynak text, olusturma_tarihi timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.hukuki_metin_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üye onay kayıtlarını görme yetkin yok.';
  end if;
  return query
  select g.tur, g.islem, g.surum, g.kaynak, g.olusturma_tarihi
  from public.onay_gecmisi g
  where g.user_id = p_uye
  order by g.olusturma_tarihi desc, g.id desc
  limit 200;
end;
$$;
revoke all on function public.uye_onay_gecmisi(uuid) from public, anon;
grant execute on function public.uye_onay_gecmisi(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) ÖZET (dönüş tipi değişti → önce düşür)
--    guncel  : onay vermiş VE yürürlükteki sürümde
--    eski    : giriş yapınca modal görecek (sürüm etiketi eşleşmiyor)
--    onaysiz : aydınlatma beyanı hiç verilmemiş
-- ----------------------------------------------------------------------------
drop function if exists public.kvkk_onay_ozeti();

create or replace function public.kvkk_onay_ozeti()
returns table (
  guncel_surum text,
  toplam bigint,
  guncel bigint,
  eski bigint,
  onaysiz bigint,
  admin_degistirebilir boolean,
  sahip_mi boolean,
  riza_surumu text,
  riza_verenler bigint,
  riza_guncel bigint,
  riza_eski bigint,
  riza_admin_degistirebilir boolean,
  kvkk_yetkim boolean,
  riza_yetkim boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner boolean := public.is_owner();
  v_kvkk  boolean := public.kvkk_surum_yetkisi_var_mi();
  v_riza  boolean := public.riza_surum_yetkisi_var_mi();
begin
  if not (v_kvkk or v_riza) then
    raise exception 'Yetkisiz işlem: hukuki metin özetini görme yetkin yok.';
  end if;

  return query
  select s.guncel_kvkk_surumu,
         count(*)::bigint,
         count(*) filter (where p.kvkk_onay_verildi is true and p.kvkk_onay_versiyonu = s.guncel_kvkk_surumu)::bigint,
         count(*) filter (where p.kvkk_onay_versiyonu is distinct from s.guncel_kvkk_surumu)::bigint,
         count(*) filter (where p.kvkk_onay_verildi is not true)::bigint,
         s.kvkk_surum_admin_degistirebilir,
         v_owner,
         s.guncel_riza_surumu,
         count(*) filter (where p.yurtdisi_onay_verildi is true)::bigint,
         count(*) filter (where p.yurtdisi_onay_verildi is true and p.yurtdisi_onay_versiyonu = s.guncel_riza_surumu)::bigint,
         count(*) filter (where p.yurtdisi_onay_verildi is true and p.yurtdisi_onay_versiyonu is distinct from s.guncel_riza_surumu)::bigint,
         s.riza_surum_admin_degistirebilir,
         v_kvkk,
         v_riza
  from public.site_ayarlari s
  cross join public.profiles p
  where s.id = 1
  group by s.guncel_kvkk_surumu, s.kvkk_surum_admin_degistirebilir, s.guncel_riza_surumu, s.riza_surum_admin_degistirebilir;
end;
$$;
revoke all on function public.kvkk_onay_ozeti() from public, anon;
grant execute on function public.kvkk_onay_ozeti() to authenticated;
