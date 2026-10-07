-- ============================================================================
-- 0069_uye_verisi_disa_aktarim.sql
-- Üye Ayarları > "Üye bilgilerini dışa aktar" (CSV / Excel / TXT / PDF) — SUNUCU TARAFI YETKİ KATMANI.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0021 (is_owner), 0042/0064 (KVKK kolonları).
--
-- NE EKLENİYOR
--   1) public.uye_aktarim_yetkileri — Site Sahibi (owner) kime, hangi üyelerin verisini indirme izni verdi?
--        * tum_uyeler      : (owner hariç) tüm üyeler
--        * hedef_roller    : yalnızca bu rollerdeki üyeler ('user','special_user','editor','manager','admin')
--        * ekstra_uyeler   : rol kuralından bağımsız, tek tek eklenen üyeler
--        * haric_uyeler    : her durumda DIŞARIDA bırakılan üyeler (en yüksek öncelik)
--      Site Sahibi (owner) HER ZAMAN tüm üyeleri indirebilir; başka kimse owner satırını göremez/indiremez.
--      Tabloya istemci erişimi YOK: yalnızca aşağıdaki SECURITY DEFINER fonksiyonlar.
--   2) public.uye_aktarim_yetkisi_var_mi()   — arayüz için: bu oturum indirme yetkili mi?
--   3) public.uye_verisi_disa_aktar(p_bicim)  — yetki kapsamındaki üyelerin TÜM alanlarını döndürür
--      (e-posta, ad/soyad, rol, üyelik tarihi, KVKK + yurt dışı açık rıza durumları/sürümleri, hesap durumu).
--      Her çağrı denetim kaydına (uye_aktarim_kayitlari) yazılır: kim, ne zaman, kaç kişi, hangi biçim.
--   4) owner_uye_aktarim_* — yalnızca owner: izin listele / ver / kaldır / kayıtları gör.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLOLAR
-- ----------------------------------------------------------------------------
create table if not exists public.uye_aktarim_yetkileri (
  yetkili_id     uuid primary key references public.profiles(id) on delete cascade,
  tum_uyeler     boolean not null default false,
  hedef_roller   text[]  not null default '{}',
  ekstra_uyeler  uuid[]  not null default '{}',
  haric_uyeler   uuid[]  not null default '{}',
  veren_id       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uye_aktarim_roller_gecerli
    check (hedef_roller <@ array['user','special_user','editor','manager','admin']::text[])
);

comment on table public.uye_aktarim_yetkileri is
  'Üye verisi dışa aktarma izinleri. Owner her zaman tam yetkilidir (satır gerekmez). İstemci erişimi yok; sadece SECURITY DEFINER RPC''ler.';

create table if not exists public.uye_aktarim_kayitlari (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  yetkili_id  uuid references public.profiles(id) on delete set null,
  yetkili_ad  text,
  adet        integer not null,
  bicim       text
);
create index if not exists uye_aktarim_kayitlari_zaman_idx on public.uye_aktarim_kayitlari (created_at desc);

alter table public.uye_aktarim_yetkileri enable row level security;
alter table public.uye_aktarim_kayitlari enable row level security;
revoke all on public.uye_aktarim_yetkileri from public, anon, authenticated;
revoke all on public.uye_aktarim_kayitlari from public, anon, authenticated;
-- (politika yok: tüm erişim aşağıdaki fonksiyonlardan)

-- ----------------------------------------------------------------------------
-- 2) İÇ YARDIMCI: "çağıran, bu hedef üyenin verisini indirebilir mi?"
-- ----------------------------------------------------------------------------
create or replace function public.uye_aktarim_erisebilir(p_yetkili uuid, p_hedef uuid, p_hedef_rol text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol  text;
  v_ask  boolean;
  y      public.uye_aktarim_yetkileri%rowtype;
begin
  select role, coalesce(is_suspended, false) into v_rol, v_ask from public.profiles where id = p_yetkili;
  if v_rol is null or v_ask then
    return false;
  end if;
  if v_rol = 'owner' then
    return true;
  end if;
  -- owner'ın verisini owner dışında kimse indiremez
  if p_hedef_rol = 'owner' then
    return false;
  end if;
  select * into y from public.uye_aktarim_yetkileri where yetkili_id = p_yetkili;
  if not found then
    return false;
  end if;
  if p_hedef = any (y.haric_uyeler) then
    return false;
  end if;
  return y.tum_uyeler
      or p_hedef = any (y.ekstra_uyeler)
      or p_hedef_rol = any (y.hedef_roller);
end;
$$;
revoke all on function public.uye_aktarim_erisebilir(uuid, uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) ARAYÜZ İÇİN: bu oturum dışa aktarabilir mi?
-- ----------------------------------------------------------------------------
create or replace function public.uye_aktarim_yetkisi_var_mi()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_ask boolean;
begin
  select role, coalesce(is_suspended, false) into v_rol, v_ask from public.profiles where id = auth.uid();
  if v_rol is null or v_ask then
    return false;
  end if;
  if v_rol = 'owner' then
    return true;
  end if;
  return exists (
    select 1 from public.uye_aktarim_yetkileri y
    where y.yetkili_id = auth.uid()
      and (y.tum_uyeler or cardinality(y.hedef_roller) > 0 or cardinality(y.ekstra_uyeler) > 0)
  );
end;
$$;
revoke all on function public.uye_aktarim_yetkisi_var_mi() from public, anon;
grant execute on function public.uye_aktarim_yetkisi_var_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) VERİYİ VER (yalnızca yetki kapsamındaki satırlar) + DENETİM KAYDI
-- ----------------------------------------------------------------------------
create or replace function public.uye_verisi_disa_aktar(p_bicim text default null)
returns table (
  id                      uuid,
  email                   text,
  first_name              text,
  last_name               text,
  full_name               text,
  role                    text,
  created_at              timestamptz,
  is_suspended            boolean,
  email_dogrulama_tarihi  timestamptz,
  son_giris_tarihi        timestamptz,
  kvkk_onay_verildi       boolean,
  kvkk_onay_tarihi        timestamptz,
  kvkk_onay_versiyonu     text,
  yurtdisi_onay_verildi   boolean,
  yurtdisi_onay_tarihi    timestamptz,
  yurtdisi_onay_versiyonu text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_adet integer;
  v_ad   text;
begin
  if not public.uye_aktarim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üye verisini dışa aktarma yetkin yok.';
  end if;

  return query
  select p.id, p.email, p.first_name, p.last_name, p.full_name, p.role, p.created_at,
         coalesce(p.is_suspended, false),
         u.email_confirmed_at, u.last_sign_in_at,
         coalesce(p.kvkk_onay_verildi, false), p.kvkk_onay_tarihi, p.kvkk_onay_versiyonu,
         coalesce(p.yurtdisi_onay_verildi, false), p.yurtdisi_onay_tarihi, p.yurtdisi_onay_versiyonu
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.uye_aktarim_erisebilir(auth.uid(), p.id, p.role)
  order by p.created_at desc;

  get diagnostics v_adet = row_count;
  select coalesce(nullif(btrim(pr.full_name), ''), pr.email) into v_ad from public.profiles pr where pr.id = auth.uid();
  insert into public.uye_aktarim_kayitlari (yetkili_id, yetkili_ad, adet, bicim)
  values (auth.uid(), v_ad, v_adet, left(coalesce(p_bicim, ''), 20));
end;
$$;
revoke all on function public.uye_verisi_disa_aktar(text) from public, anon;
grant execute on function public.uye_verisi_disa_aktar(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) OWNER: izinleri yönet
-- ----------------------------------------------------------------------------
create or replace function public.owner_uye_aktarim_yetkilerini_getir()
returns table (
  yetkili_id uuid, yetkili_ad text, yetkili_rol text,
  tum_uyeler boolean, hedef_roller text[], ekstra_uyeler uuid[], haric_uyeler uuid[], updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select y.yetkili_id, coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye'), p.role,
         y.tum_uyeler, y.hedef_roller, y.ekstra_uyeler, y.haric_uyeler, y.updated_at
  from public.uye_aktarim_yetkileri y
  join public.profiles p on p.id = y.yetkili_id
  order by p.full_name nulls last;
end;
$$;
revoke all on function public.owner_uye_aktarim_yetkilerini_getir() from public, anon;
grant execute on function public.owner_uye_aktarim_yetkilerini_getir() to authenticated;

create or replace function public.owner_uye_aktarim_yetkisi_ver(
  p_yetkili uuid,
  p_tum boolean,
  p_roller text[],
  p_ekstra uuid[] default '{}',
  p_haric uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi izin verebilir.';
  end if;
  select role into v_rol from public.profiles where id = p_yetkili;
  if v_rol is null then
    raise exception 'Üye bulunamadı.';
  end if;
  if v_rol = 'owner' then
    raise exception 'Site Sahibi zaten tam yetkilidir.';
  end if;
  if v_rol <> 'admin' then
    raise exception 'Bu izin yalnızca Yönetici (admin) rolündeki üyelere verilebilir (Üye Ayarları sekmesi yalnızca yöneticilere açıktır).';
  end if;

  insert into public.uye_aktarim_yetkileri as y
    (yetkili_id, tum_uyeler, hedef_roller, ekstra_uyeler, haric_uyeler, veren_id)
  values
    (p_yetkili, coalesce(p_tum, false), coalesce(p_roller, '{}'), coalesce(p_ekstra, '{}'), coalesce(p_haric, '{}'), auth.uid())
  on conflict (yetkili_id) do update
    set tum_uyeler    = excluded.tum_uyeler,
        hedef_roller  = excluded.hedef_roller,
        ekstra_uyeler = excluded.ekstra_uyeler,
        haric_uyeler  = excluded.haric_uyeler,
        veren_id      = excluded.veren_id,
        updated_at    = now();
end;
$$;
revoke all on function public.owner_uye_aktarim_yetkisi_ver(uuid, boolean, text[], uuid[], uuid[]) from public, anon;
grant execute on function public.owner_uye_aktarim_yetkisi_ver(uuid, boolean, text[], uuid[], uuid[]) to authenticated;

create or replace function public.owner_uye_aktarim_yetkisi_kaldir(p_yetkili uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  delete from public.uye_aktarim_yetkileri where yetkili_id = p_yetkili;
end;
$$;
revoke all on function public.owner_uye_aktarim_yetkisi_kaldir(uuid) from public, anon;
grant execute on function public.owner_uye_aktarim_yetkisi_kaldir(uuid) to authenticated;

create or replace function public.owner_uye_aktarim_kayitlari(p_limit integer default 25)
returns table (created_at timestamptz, yetkili_ad text, adet integer, bicim text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select k.created_at, k.yetkili_ad, k.adet, k.bicim
  from public.uye_aktarim_kayitlari k
  order by k.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
end;
$$;
revoke all on function public.owner_uye_aktarim_kayitlari(integer) from public, anon;
grant execute on function public.owner_uye_aktarim_kayitlari(integer) to authenticated;
