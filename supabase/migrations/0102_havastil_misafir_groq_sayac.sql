-- ============================================================================
-- 0102_havastil_misafir_groq_sayac.sql — HavaStil v5: misafir (oturumsuz) erişim anahtarı + Groq kota/istek sayacı + yetki anahtarı
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0083/0085/0101 (demo_config), 0099 (havastil_yetkisi_var_mi, ozellik_varsayilan_kapali), 0021 (is_owner).
--
-- NE EKLENİYOR
--   1) demo_config 'havastil' bölümüne 'misafir' anahtarı (varsayılan AÇIK). Yönetim Paneli › Yetki & Demo Ayarları › HavaStil'den aç/kapa
--      (eskiden SQL gerekiyordu). Okuma: havastil_misafir_acik_mi() (anon çağırabilir; yalnızca true/false döner).
--   2) Yetki Ayarları (Rol Matrisi): 'havastil_groq_kota' anahtarı — YALNIZCA Admin sütunu, varsayılan KAPALI. Site Sahibi her zaman görür.
--   3) Groq sayacı: havastil_groq_sayac (gün × model), havastil_groq_ayar (limitler + Groq'un son bildirdiği kota başlıkları).
--        havastil_groq_say()            Worker çağırır (kullanıcının KENDİ jetonu; havastil yetkisi şart). İsteğe bağlı gizli anahtarla sertleştirilir.
--        havastil_groq_kota_durumu()    Yalnızca Site Sahibi + yetkisi açık Admin; diğer herkese {"gorebilir": false} (veri YOK).
--        owner_havastil_groq_limit_ayarla(günlük, aylık)   Site Sahibi.
--        owner_havastil_groq_sayac_sir_ayarla(sır)         Site Sahibi (sayaç sahteciliğine karşı isteğe bağlı sertleştirme).
--   Gün sınırı UTC'dir (Groq günlük kotası da UTC'de sıfırlanır).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) demo_config: 'havastil' → ['aktif', 'misafir']
-- ----------------------------------------------------------------------------
create or replace function public.demo_config_gecerli_mi(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  izinli constant jsonb := jsonb_build_object(
    'hub',      jsonb_build_array('aktif', 'kartlar'),
    'pdf',      jsonb_build_array('aktif', 'duzenlemeAraclari'),
    'arsiv',    jsonb_build_array('aktif', 'zipInceleme'),
    'notlar',   jsonb_build_array('aktif', 'filtreCipleri'),
    'mesajlar', jsonb_build_array('aktif'),
    'sistem',   jsonb_build_array('aktif'),
    'havastil', jsonb_build_array('aktif', 'misafir'));
  kart_izinli constant text[] := array['content-notlar', 'media-arsiv', 'lib-kutuphane', 'users-mesajlar', 'sys-metrik'];
  bolum text; alan text; kart text; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4000 then return false; end if;
  for bolum in select k from jsonb_object_keys(p) k loop
    if bolum = 'v' then
      if jsonb_typeof(p -> 'v') <> 'number' then return false; end if;
    elsif not (izinli ? bolum) then return false;
    else
      if jsonb_typeof(p -> bolum) <> 'object' then return false; end if;
      for alan in select k from jsonb_object_keys(p -> bolum) k loop
        if not (izinli -> bolum) ? alan then return false; end if;
        v := p -> bolum -> alan;
        if bolum = 'hub' and alan = 'kartlar' then
          if jsonb_typeof(v) <> 'object' then return false; end if;
          for kart in select k from jsonb_object_keys(v) k loop
            if not (kart = any (kart_izinli)) or jsonb_typeof(v -> kart) <> 'boolean' then return false; end if;
          end loop;
        elsif jsonb_typeof(v) <> 'boolean' then return false;
        end if;
      end loop;
    end if;
  end loop;
  return true;
end $$;

-- Mevcut satıra varsayılan: misafir erişimi AÇIK (şartname: oturumsuz ziyaretçi giriş sayfasına atılmaz). Zaten varsa dokunulmaz.
update public.demo_config
   set config = jsonb_set(config, '{havastil}', coalesce(config -> 'havastil', '{}'::jsonb) || jsonb_build_object('aktif', coalesce((config -> 'havastil' ->> 'aktif')::boolean, true), 'misafir', true), true),
       updated_at = now()
 where id = 1 and not coalesce(config -> 'havastil' ? 'misafir', false);

create or replace function public.havastil_misafir_acik_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (c.config -> 'havastil' ->> 'misafir')::boolean from public.demo_config c where c.id = 1), true);
$$;
revoke all on function public.havastil_misafir_acik_mi() from public;
grant execute on function public.havastil_misafir_acik_mi() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Yetki anahtarı: 'havastil_groq_kota' (yalnızca admin; varsayılan kapalı). 0099'daki kuralların hepsi korunur.
-- ----------------------------------------------------------------------------
alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_anahtar_chk;
alter table public.ozellik_varsayilan_kapali
  add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota'));

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('hesap_silme_onayi', 'yetki_ayarlari') and p_rol in ('special_user', 'user') then raise exception 'Bu özellik üye rolleri için tanımlı değil.'; end if;
  -- Groq kota görüntüleme YALNIZCA Admin rolü içindir (normal kullanıcılar ve demo hesaplar hiçbir koşulda göremez).
  if p_ozellik = 'havastil_groq_kota' and p_rol <> 'admin' then raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Groq sayacı
-- ----------------------------------------------------------------------------
create table if not exists public.havastil_groq_sayac (
  gun         date   not null,
  model       text   not null check (char_length(model) between 1 and 60),
  istek       integer not null default 0,
  basarili    integer not null default 0,
  hatali      integer not null default 0,
  token_giris bigint  not null default 0,
  token_cikis bigint  not null default 0,
  primary key (gun, model)
);
comment on table public.havastil_groq_sayac is 'HavaStil Mod B: Groq istek/token sayacı (UTC gün × model). Doğrudan erişim YOK; yalnızca havastil_groq_* RPC''leri.';

create table if not exists public.havastil_groq_ayar (
  id           smallint primary key default 1 check (id = 1),
  gunluk_limit integer not null default 1000  check (gunluk_limit between 1 and 100000000),
  aylik_limit  integer not null default 30000 check (aylik_limit between 1 and 1000000000),
  son_limit    jsonb,          -- Groq'un son yanıt başlıkları: {zaman, limit_istek, kalan_istek, limit_token, kalan_token}
  sir_ozeti    text            -- isteğe bağlı: Worker gizli anahtarının SHA-256'sı (null = sır istenmez)
);
insert into public.havastil_groq_ayar (id) values (1) on conflict (id) do nothing;

alter table public.havastil_groq_sayac enable row level security;
alter table public.havastil_groq_ayar  enable row level security;
revoke all on public.havastil_groq_sayac, public.havastil_groq_ayar from public, anon, authenticated;

-- Worker çağırır. Yetki: havastil açık hesap (Worker zaten aynı kontrolü yapar). Değerler sınırlandırılır.
create or replace function public.havastil_groq_say(
  p_model text, p_basari boolean, p_token_giris integer default 0, p_token_cikis integer default 0,
  p_limit_istek integer default null, p_kalan_istek integer default null, p_limit_token integer default null, p_kalan_token integer default null,
  p_sir text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ozet text; gun_ date := (now() at time zone 'utc')::date;
begin
  if not public.havastil_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  select a.sir_ozeti into ozet from public.havastil_groq_ayar a where a.id = 1;
  if ozet is not null and (p_sir is null or encode(sha256(convert_to(p_sir, 'utf8')), 'hex') <> ozet) then
    raise exception 'Sayaç anahtarı geçersiz.' using errcode = '42501';
  end if;
  if p_model is null or char_length(btrim(p_model)) = 0 then return; end if;
  insert into public.havastil_groq_sayac as s (gun, model, istek, basarili, hatali, token_giris, token_cikis)
  values (gun_, left(btrim(p_model), 60), 1, case when p_basari then 1 else 0 end, case when p_basari then 0 else 1 end,
          greatest(0, least(coalesce(p_token_giris, 0), 1000000)), greatest(0, least(coalesce(p_token_cikis, 0), 1000000)))
  on conflict (gun, model) do update set
    istek = s.istek + 1, basarili = s.basarili + excluded.basarili, hatali = s.hatali + excluded.hatali,
    token_giris = s.token_giris + excluded.token_giris, token_cikis = s.token_cikis + excluded.token_cikis;
  if p_limit_istek is not null or p_kalan_istek is not null or p_limit_token is not null or p_kalan_token is not null then
    update public.havastil_groq_ayar set son_limit = jsonb_build_object('zaman', now(), 'limit_istek', p_limit_istek, 'kalan_istek', p_kalan_istek, 'limit_token', p_limit_token, 'kalan_token', p_kalan_token) where id = 1;
  end if;
  delete from public.havastil_groq_sayac where gun < gun_ - 400;   -- tablo şişmesin
end $$;
revoke all on function public.havastil_groq_say(text, boolean, integer, integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.havastil_groq_say(text, boolean, integer, integer, integer, integer, integer, integer, text) to authenticated;

-- Görme yetkisi: Site Sahibi her zaman; Admin yalnızca askıda değilse ve Rol Matrisi'nde 'havastil_groq_kota' açıksa. Diğer herkes (user, demo, misafir) HAYIR.
create or replace function public.havastil_groq_kota_gorebilir()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (p.role = 'admin' and not coalesce(p.is_suspended, false)
            and exists (select 1 from public.ozellik_varsayilan_kapali o where o.ozellik_anahtari = 'havastil_groq_kota' and o.rol = 'admin' and o.acik))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.havastil_groq_kota_gorebilir() from public, anon;
grant execute on function public.havastil_groq_kota_gorebilir() to authenticated;

create or replace function public.havastil_groq_kota_durumu()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare gun_ date := (now() at time zone 'utc')::date; ay_ date := date_trunc('month', now() at time zone 'utc')::date; a record; sonuc jsonb;
begin
  if not public.havastil_groq_kota_gorebilir() then return jsonb_build_object('gorebilir', false); end if;
  select * into a from public.havastil_groq_ayar where id = 1;
  sonuc := jsonb_build_object(
    'gorebilir', true, 'sahip', public.is_owner(), 'gunluk_limit', a.gunluk_limit, 'aylik_limit', a.aylik_limit, 'son_limit', a.son_limit,
    'bugun', (select jsonb_build_object('istek', coalesce(sum(s.istek), 0), 'basarili', coalesce(sum(s.basarili), 0), 'hatali', coalesce(sum(s.hatali), 0),
                'token_giris', coalesce(sum(s.token_giris), 0), 'token_cikis', coalesce(sum(s.token_cikis), 0)) from public.havastil_groq_sayac s where s.gun = gun_),
    'ay', (select jsonb_build_object('istek', coalesce(sum(s.istek), 0), 'basarili', coalesce(sum(s.basarili), 0), 'hatali', coalesce(sum(s.hatali), 0),
                'token_giris', coalesce(sum(s.token_giris), 0), 'token_cikis', coalesce(sum(s.token_cikis), 0)) from public.havastil_groq_sayac s where s.gun >= ay_),
    'modeller', coalesce((select jsonb_agg(jsonb_build_object('model', s.model, 'istek', s.istek, 'hatali', s.hatali) order by s.istek desc) from public.havastil_groq_sayac s where s.gun = gun_), '[]'::jsonb));
  return sonuc;
end $$;
revoke all on function public.havastil_groq_kota_durumu() from public, anon;
grant execute on function public.havastil_groq_kota_durumu() to authenticated;

create or replace function public.owner_havastil_groq_limit_ayarla(p_gunluk integer, p_aylik integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501'; end if;
  update public.havastil_groq_ayar set gunluk_limit = coalesce(p_gunluk, gunluk_limit), aylik_limit = coalesce(p_aylik, aylik_limit) where id = 1;
end $$;
revoke all on function public.owner_havastil_groq_limit_ayarla(integer, integer) from public, anon;
grant execute on function public.owner_havastil_groq_limit_ayarla(integer, integer) to authenticated;

-- İsteğe bağlı sertleştirme: Worker'a HAVASTIL_SAYAC_SIRRI secret'ı ekle, aynı değeri burada kaydet (null = sır istenmez). Sır düz metin saklanmaz (SHA-256).
create or replace function public.owner_havastil_groq_sayac_sir_ayarla(p_sir text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501'; end if;
  update public.havastil_groq_ayar set sir_ozeti = case when p_sir is null or btrim(p_sir) = '' then null else encode(sha256(convert_to(btrim(p_sir), 'utf8')), 'hex') end where id = 1;
end $$;
revoke all on function public.owner_havastil_groq_sayac_sir_ayarla(text) from public, anon;
grant execute on function public.owner_havastil_groq_sayac_sir_ayarla(text) to authenticated;

-- HIZLI KONTROL
--   select public.havastil_misafir_acik_mi();                 -- true (anon da çağırabilir)
--   select public.havastil_groq_kota_durumu();                -- owner: {gorebilir:true,...}; diğerleri: {gorebilir:false}
--   select public.owner_havastil_groq_limit_ayarla(1000, 30000);
