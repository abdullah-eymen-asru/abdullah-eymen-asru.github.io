-- ============================================================================
-- 0121_openmeteo_kota_ve_api.sql
-- Open-Meteo API ayarları + KİŞİ BAŞINA / IP BAŞINA kota sayacı (HavaStil radar + tüm hava istekleri)
-- Gereksinim: 0099 (havastil), 0113 (havastil_ai_kasasi), is_owner(), is_admin(), _eposta_maskele(). Tekrar çalıştırmak güvenlidir.
--
-- MİMARİ (3 kaynak):
--   'varsayilan' → ücretsiz Open-Meteo, TARAYICIDAN doğrudan (kullanıcının KENDİ IP'si; Open-Meteo ücretsiz kotası IP başınadır).
--   'site'       → site sahibinin/yöneticinin tanımladığı TİCARİ anahtar: yalnızca Worker secret'ında (OPEN_METEO_API_KEY); istekler Worker üzerinden geçer.
--   'kendi'      → kullanıcının KENDİ anahtarı (şifreli kasada); site kotasına sayılmaz, yalnızca bilgi için kaydedilir.
-- Sayaç "ağırlık" ile çalışır: Open-Meteo bir çağrıyı (konum × ceil(değişken/10) × ceil(gün/14)) olarak sayar; ızgara radar çok sayıda konum içerir.
-- NOT: sayaç, sitemiz üzerinden yapılan istekleri sayar (Open-Meteo'nun kendi sayacı değildir) — "kullanım göstergesi + koruma" amaçlıdır.
-- ============================================================================

-- 1) Kasa: 'openmeteo' sağlayıcısı (kullanıcının kendi Open-Meteo anahtarı, şifreli)
alter table public.havastil_ai_kasasi drop constraint if exists havastil_ai_kasasi_saglayici_check;
alter table public.havastil_ai_kasasi
  add constraint havastil_ai_kasasi_saglayici_check check (saglayici in ('gemini', 'openai', 'anthropic', 'openrouter', 'openmeteo'));

-- 2) Ayar (tek satır)
create table if not exists public.openmeteo_ayar (
  id                    boolean primary key default true check (id),
  plan                  text not null default 'ucretsiz' check (plan in ('ucretsiz', 'ticari')),
  -- sınır nesneleri: {"dakika":N|null,"saat":N|null,"gun":N|null,"ay":N|null}; null = sınırsız
  ucretsiz_limit        jsonb not null default '{"dakika":600,"saat":5000,"gun":10000,"ay":300000}',
  ticari_limit          jsonb not null default '{"dakika":null,"saat":null,"gun":null,"ay":1000000}',
  kullanici_limit       jsonb not null default '{"dakika":200,"saat":1500,"gun":4000,"ay":60000}',
  kendi_anahtar_izni    boolean not null default true,
  site_anahtari_tanimli boolean not null default false,   -- Worker'a OPEN_METEO_API_KEY secret'ı eklendiğinde yönetici işaretler
  aciklama              text check (aciklama is null or char_length(aciklama) <= 500),
  guncelleme            timestamptz not null default now(),
  guncelleyen           uuid
);
insert into public.openmeteo_ayar (id) values (true) on conflict (id) do nothing;
alter table public.openmeteo_ayar enable row level security;
revoke all on public.openmeteo_ayar from anon, authenticated;     -- yalnızca aşağıdaki SECURITY DEFINER fonksiyonlar

-- 3) Kişiye özel limit (yönetici belirler; ayar varsayılanını EZER)
create table if not exists public.openmeteo_kullanici_limitleri (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  limitler   jsonb not null check (jsonb_typeof(limitler) = 'object'),
  guncelleme timestamptz not null default now()
);
alter table public.openmeteo_kullanici_limitleri enable row level security;
revoke all on public.openmeteo_kullanici_limitleri from anon, authenticated;

-- 4) Kullanım (dakika kovaları): kullanıcı × IP özeti × kaynak
create table if not exists public.openmeteo_kullanim (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ip_hash text not null default 'bilinmiyor',
  kaynak  text not null check (kaynak in ('varsayilan', 'site', 'kendi')),
  dk      timestamptz not null,
  agirlik bigint not null default 0,
  primary key (user_id, ip_hash, kaynak, dk)
);
create index if not exists openmeteo_kullanim_dk_idx on public.openmeteo_kullanim (dk);
create index if not exists openmeteo_kullanim_ip_idx on public.openmeteo_kullanim (ip_hash, kaynak, dk);
alter table public.openmeteo_kullanim enable row level security;
revoke all on public.openmeteo_kullanim from anon, authenticated;

-- ---------------------------------------------------------------------------- yardımcılar
create or replace function public._om_yonetici()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_owner() or public.is_admin());
$$;
revoke all on function public._om_yonetici() from public, anon;
grant execute on function public._om_yonetici() to authenticated;

-- Pencere toplamları: dakika (bu dakika), saat (son 60 dk), gün (UTC gün), ay (UTC ay)
create or replace function public._om_toplam(p_user uuid, p_ip text, p_kaynaklar text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'dakika', coalesce(sum(agirlik) filter (where dk >= date_trunc('minute', now())), 0),
    'saat',   coalesce(sum(agirlik) filter (where dk >  now() - interval '60 minutes'), 0),
    'gun',    coalesce(sum(agirlik) filter (where dk >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')), 0),
    'ay',     coalesce(sum(agirlik) filter (where dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0))
  from public.openmeteo_kullanim
  where kaynak = any (p_kaynaklar)
    and (p_user is null or user_id = p_user)
    and (p_ip is null or ip_hash = p_ip);
$$;
revoke all on function public._om_toplam(uuid, text, text[]) from public, anon, authenticated;

create or replace function public._om_etkin_kullanici_limiti(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select a.kullanici_limit || coalesce(k.limitler, '{}'::jsonb)
  from public.openmeteo_ayar a left join public.openmeteo_kullanici_limitleri k on k.user_id = p_user
  where a.id;
$$;
revoke all on function public._om_etkin_kullanici_limiti(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------- herkese açık okuma (limitler gizli değil)
create or replace function public.openmeteo_ayar_oku()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.openmeteo_ayar; v_uid uuid := auth.uid();
begin
  select * into a from public.openmeteo_ayar where id;
  return jsonb_build_object(
    'plan', a.plan, 'ucretsiz_limit', a.ucretsiz_limit, 'ticari_limit', a.ticari_limit,
    'kullanici_limit', case when v_uid is null then a.kullanici_limit else public._om_etkin_kullanici_limiti(v_uid) end,
    'kendi_anahtar_izni', a.kendi_anahtar_izni, 'site_anahtari_tanimli', a.site_anahtari_tanimli,
    'aktif_kaynak', case when a.plan = 'ticari' and a.site_anahtari_tanimli then 'site' else 'varsayilan' end,
    'aciklama', a.aciklama, 'guncelleme', a.guncelleme);
end $$;
revoke all on function public.openmeteo_ayar_oku() from public;
grant execute on function public.openmeteo_ayar_oku() to anon, authenticated;

-- ---------------------------------------------------------------------------- KOTA AL (ayır + say): izin yoksa yazmaz
create or replace function public.openmeteo_kota_al(p_agirlik integer, p_kaynak text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a public.openmeteo_ayar;
  v_ag bigint := least(greatest(coalesce(p_agirlik, 1), 1), 200000);
  v_ip text := coalesce(nullif(left(p_ip_hash, 64), ''), 'bilinmiyor');
  v_ul jsonb; v_pl jsonb; v_ku jsonb; v_pu jsonb; v_pencere text; v_neden text;
  v_kalan jsonb := '{}'::jsonb; v_lim bigint; v_kul bigint; v_k bigint;
  v_ad constant jsonb := '{"dakika":"dakikalık","saat":"saatlik","gun":"günlük","ay":"aylık"}';
begin
  if v_uid is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if p_kaynak not in ('varsayilan', 'site', 'kendi') then raise exception 'Geçersiz kaynak.'; end if;
  select * into a from public.openmeteo_ayar where id;

  if p_kaynak = 'kendi' and not a.kendi_anahtar_izni then
    return jsonb_build_object('izin', false, 'neden', 'Kendi API anahtarı kullanımı yönetici tarafından kapatıldı.');
  end if;
  if p_kaynak = 'site' and not a.site_anahtari_tanimli then
    return jsonb_build_object('izin', false, 'neden', 'Site Open-Meteo anahtarı tanımlı değil (Worker secret + Ayarlar).');
  end if;

  if p_kaynak <> 'kendi' then
    -- 1) kişi başına sınır (Site Sahibi muaf)
    v_ul := public._om_etkin_kullanici_limiti(v_uid);
    v_ku := public._om_toplam(v_uid, null, array['varsayilan', 'site']);
    -- 2) plan sınırı: ücretsizde IP başına (aynı IP'yi paylaşan herkesin toplamı), ticaride site toplamı
    if p_kaynak = 'varsayilan' then v_pl := a.ucretsiz_limit; v_pu := public._om_toplam(null, v_ip, array['varsayilan']);
    else v_pl := a.ticari_limit; v_pu := public._om_toplam(null, null, array['site']); end if;

    foreach v_pencere in array array['dakika', 'saat', 'gun', 'ay'] loop
      v_lim := nullif(v_ul ->> v_pencere, '')::bigint; v_kul := (v_ku ->> v_pencere)::bigint;
      if not public.is_owner() and v_lim is not null and v_kul + v_ag > v_lim then
        v_neden := format('Senin %s Open-Meteo kotan doldu (%s / %s çağrı). Daha az ayrıntı seç, sonra tekrar dene ya da Ayarlar''dan kendi API anahtarını gir.', v_ad ->> v_pencere, v_kul, v_lim);
        return jsonb_build_object('izin', false, 'neden', v_neden, 'pencere', v_pencere, 'sinir', 'kisi');
      end if;
      v_k := case when v_lim is null or public.is_owner() then null else v_lim - v_kul end;
      v_lim := nullif(v_pl ->> v_pencere, '')::bigint; v_kul := (v_pu ->> v_pencere)::bigint;
      if v_lim is not null and v_kul + v_ag > v_lim then
        v_neden := format('%s %s Open-Meteo kotası doldu (%s / %s çağrı). Bir süre sonra tekrar dene.', case when p_kaynak = 'varsayilan' then 'Bu IP adresinin' else 'Sitenin' end, v_ad ->> v_pencere, v_kul, v_lim);
        return jsonb_build_object('izin', false, 'neden', v_neden, 'pencere', v_pencere, 'sinir', case when p_kaynak = 'varsayilan' then 'ip' else 'site' end);
      end if;
      if v_lim is not null and (v_k is null or v_lim - v_kul < v_k) then v_k := v_lim - v_kul; end if;
      v_kalan := v_kalan || jsonb_build_object(v_pencere, case when v_k is null then null else greatest(v_k - v_ag, 0) end);
    end loop;
  end if;

  insert into public.openmeteo_kullanim as u (user_id, ip_hash, kaynak, dk, agirlik)
  values (v_uid, v_ip, p_kaynak, date_trunc('minute', now()), v_ag)
  on conflict (user_id, ip_hash, kaynak, dk) do update set agirlik = u.agirlik + excluded.agirlik;
  if random() < 0.02 then delete from public.openmeteo_kullanim where dk < now() - interval '40 days'; end if;
  return jsonb_build_object('izin', true, 'kalan', v_kalan, 'agirlik', v_ag);
end $$;
revoke all on function public.openmeteo_kota_al(integer, text, text) from public, anon;
grant execute on function public.openmeteo_kota_al(integer, text, text) to authenticated;

-- İstek ağ hatasıyla başarısız olursa ayrılan kotayı geri ver (en çok son 5 dakikadaki kayıttan)
create or replace function public.openmeteo_kota_iade(p_agirlik integer, p_kaynak text, p_ip_hash text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ip text := coalesce(nullif(left(p_ip_hash, 64), ''), 'bilinmiyor'); v_ag bigint := least(greatest(coalesce(p_agirlik, 1), 1), 200000);
begin
  if auth.uid() is null or p_kaynak not in ('varsayilan', 'site', 'kendi') then return; end if;
  update public.openmeteo_kullanim set agirlik = greatest(agirlik - v_ag, 0)
  where user_id = auth.uid() and ip_hash = v_ip and kaynak = p_kaynak and dk = date_trunc('minute', now());
end $$;
revoke all on function public.openmeteo_kota_iade(integer, text, text) from public, anon;
grant execute on function public.openmeteo_kota_iade(integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------- kendi kullanımım
create or replace function public.openmeteo_kullanim_ozeti(p_ip_hash text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ip text := coalesce(nullif(left(p_ip_hash, 64), ''), 'bilinmiyor'); a public.openmeteo_ayar;
begin
  if v_uid is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into a from public.openmeteo_ayar where id;
  return jsonb_build_object(
    'kullanici_limit', public._om_etkin_kullanici_limiti(v_uid),
    'ben', public._om_toplam(v_uid, null, array['varsayilan', 'site']),
    'ben_kendi_anahtar', public._om_toplam(v_uid, null, array['kendi']),
    'ip', public._om_toplam(null, v_ip, array['varsayilan']),
    'ip_limit', a.ucretsiz_limit,
    'site', public._om_toplam(null, null, array['site']),
    'site_limit', a.ticari_limit,
    'plan', a.plan);
end $$;
revoke all on function public.openmeteo_kullanim_ozeti(text) from public, anon;
grant execute on function public.openmeteo_kullanim_ozeti(text) to authenticated;

-- ---------------------------------------------------------------------------- yönetim (Site Sahibi + Yönetici)
create or replace function public.openmeteo_ayar_kaydet(
  p_plan text, p_ucretsiz jsonb, p_ticari jsonb, p_kullanici jsonb, p_kendi_izin boolean, p_site_anahtari boolean, p_aciklama text)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; k text;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_plan not in ('ucretsiz', 'ticari') then raise exception 'Plan ucretsiz ya da ticari olmalı.'; end if;
  foreach v in array array[p_ucretsiz, p_ticari, p_kullanici] loop
    if v is null or jsonb_typeof(v) <> 'object' then raise exception 'Sınır nesnesi geçersiz.'; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('dakika', 'saat', 'gun', 'ay') then raise exception 'Bilinmeyen sınır alanı: %', k; end if;
      if jsonb_typeof(v -> k) not in ('number', 'null') or (jsonb_typeof(v -> k) = 'number' and (v ->> k)::numeric < 0) then raise exception '% için sayı ≥ 0 ya da boş (sınırsız) gir.', k; end if;
    end loop;
  end loop;
  update public.openmeteo_ayar set plan = p_plan, ucretsiz_limit = p_ucretsiz, ticari_limit = p_ticari, kullanici_limit = p_kullanici,
    kendi_anahtar_izni = coalesce(p_kendi_izin, true), site_anahtari_tanimli = coalesce(p_site_anahtari, false),
    aciklama = nullif(btrim(coalesce(p_aciklama, '')), ''), guncelleme = now(), guncelleyen = auth.uid()
  where id;
end $$;
revoke all on function public.openmeteo_ayar_kaydet(text, jsonb, jsonb, jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.openmeteo_ayar_kaydet(text, jsonb, jsonb, jsonb, boolean, boolean, text) to authenticated;

create or replace function public.openmeteo_kullanici_limit_kaydet(p_user uuid, p_limitler jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_limitler is null or p_limitler = '{}'::jsonb or p_limitler = 'null'::jsonb then
    delete from public.openmeteo_kullanici_limitleri where user_id = p_user; return;     -- varsayılana dön
  end if;
  if jsonb_typeof(p_limitler) <> 'object' then raise exception 'Sınır nesnesi geçersiz.'; end if;
  for k in select jsonb_object_keys(p_limitler) loop
    if k not in ('dakika', 'saat', 'gun', 'ay') then raise exception 'Bilinmeyen sınır alanı: %', k; end if;
    if jsonb_typeof(p_limitler -> k) not in ('number', 'null') or (jsonb_typeof(p_limitler -> k) = 'number' and (p_limitler ->> k)::numeric < 0) then raise exception '% için sayı ≥ 0 ya da boş gir.', k; end if;
  end loop;
  insert into public.openmeteo_kullanici_limitleri (user_id, limitler) values (p_user, p_limitler)
  on conflict (user_id) do update set limitler = excluded.limitler, guncelleme = now();
end $$;
revoke all on function public.openmeteo_kullanici_limit_kaydet(uuid, jsonb) from public, anon;
grant execute on function public.openmeteo_kullanici_limit_kaydet(uuid, jsonb) to authenticated;

-- Herkesin bireysel kullanımı (yalnızca yönetici). E-posta maskeli; IP'ler yalnızca özet (hash) olarak sayılır, ham IP SAKLANMAZ.
create or replace function public.openmeteo_kullanim_tumu(p_ara text default null)
returns table (user_id uuid, ad text, eposta_maskeli text, rol text, dakika bigint, saat bigint, gun bigint, ay bigint, kendi_ay bigint, ip_sayisi bigint, kisiye_ozel_limit jsonb, etkin_limit jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(v_ara, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)'), public._eposta_maskele(p.email), p.role,
           coalesce(x.dakika, 0), coalesce(x.saat, 0), coalesce(x.gun, 0), coalesce(x.ay, 0), coalesce(x.kendi_ay, 0), coalesce(x.ipler, 0),
           kl.limitler, public._om_etkin_kullanici_limiti(p.id)
    from public.profiles p
    left join public.openmeteo_kullanici_limitleri kl on kl.user_id = p.id
    left join lateral (
      select sum(agirlik) filter (where kaynak <> 'kendi' and dk >= date_trunc('minute', now())) as dakika,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk > now() - interval '60 minutes') as saat,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as gun,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')) as ay,
             sum(agirlik) filter (where kaynak = 'kendi' and dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')) as kendi_ay,
             count(distinct ip_hash) filter (where dk >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as ipler
      from public.openmeteo_kullanim u where u.user_id = p.id and u.dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
    ) x on true
    where v_ara is null or p.full_name ilike v_kalip or p.email ilike v_kalip
    order by coalesce(x.gun, 0) desc, coalesce(x.ay, 0) desc, p.created_at
    limit 200;
end $$;
revoke all on function public.openmeteo_kullanim_tumu(text) from public, anon;
grant execute on function public.openmeteo_kullanim_tumu(text) to authenticated;

-- ============================================================================
-- BİTTİ. Sırada: (1) Worker'ı yeniden yayınla (havastil_worker: /istemci + /openmeteo uçları),
-- (2) ticari anahtar alırsan: Worker secret OPEN_METEO_API_KEY → HavaStil › Ayarlar › Open-Meteo API & Kota → "Site anahtarı tanımlı" + plan "ticari".
-- ============================================================================
