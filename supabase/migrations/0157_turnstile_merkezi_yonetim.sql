-- ============================================================================
-- 0157_turnstile_merkezi_yonetim.sql — Merkezi Cloudflare Turnstile yönetimi + "Bot Kalkanı" ayarları
--
-- Kontrol Merkezi'nden (yalnızca Site Sahibi + Admin) yönetilir. TÜM zamanlama UTC'dir (timestamptz / UTC saat dilimi);
-- arayüz yerel saat karşılığını ayrıca gösterir.
--
-- ÖNEMLİ SINIR (dürüst not): Auth (giriş/kayıt/şifre sıfırlama) doğrulamasını Supabase yapar (Dashboard → Authentication →
-- Attack Protection → Captcha). Bu tablo İSTEMCİNİN token isteyip istemeyeceğini belirler. Supabase tarafında captcha AÇIKKEN
-- istemci token göndermezse Supabase isteği reddeder; "tamamen kapat" için Supabase'deki captcha de kapatılmalıdır.
-- Bot Kalkanı (tam ekran ön doğrulama) ise yalnızca tarayıcı tarafı bir kapıdır (statik site); JS çalıştırmayan botları durdurmaz.
--
-- Oturum bağımsızdır: geçici tablo YOK. Her adım yeniden çalıştırılabilir (idempotent).
-- ============================================================================

-- 1) Ayar tablosu (tek satır) ------------------------------------------------------------------------------------------
create table if not exists public.turnstile_ayarlari (
  id boolean primary key default true check (id),
  acik boolean not null default true,                 -- ana şalter (varsayılan AÇIK = mevcut davranış korunur)
  mod_giris boolean not null default true,
  mod_kayit boolean not null default true,
  mod_sifre_sifirlama boolean not null default true,
  mod_dogrulama boolean not null default true,        -- doğrulama maili yeniden gönder / tek kullanımlık kod
  mod_diger boolean not null default true,            -- Notlar parola sınaması vb. ek auth çağrıları
  plan_tur text not null default 'surekli' check (plan_tur in ('surekli', 'aralik', 'gunluk')),
  plan_etki text not null default 'aktif' check (plan_etki in ('aktif', 'pasif')),   -- pencere içinde koruma AKTİF mi PASİF mi
  plan_baslangic timestamptz,                         -- 'aralik': UTC
  plan_bitis timestamptz,
  gunluk_baslangic time,                              -- 'gunluk': UTC saat
  gunluk_bitis time,
  hata_modu text not null default 'acik' check (hata_modu in ('acik', 'kapali')),    -- acik = fail-open, kapali = fail-closed
  dogrulama_dk integer not null default 30 check (dogrulama_dk between 1 and 1440),  -- Bot Kalkanı geçişi X dk hatırlanır
  kalkan_acik boolean not null default false,         -- Bot Kalkanı: VARSAYILAN KAPALI
  son_olay_zamani timestamptz,
  son_olay_turu text,
  guncelleyen uuid,
  guncelleme timestamptz not null default now()
);
insert into public.turnstile_ayarlari (id) values (true) on conflict (id) do nothing;

create table if not exists public.turnstile_istatistik (
  gun date not null,
  tur text not null,
  sonuc text not null,
  adet integer not null default 0,
  primary key (gun, tur, sonuc)
);

alter table public.turnstile_ayarlari enable row level security;
alter table public.turnstile_istatistik enable row level security;

drop policy if exists turnstile_ayarlari_yonetici_okur on public.turnstile_ayarlari;
create policy turnstile_ayarlari_yonetici_okur on public.turnstile_ayarlari for select to authenticated
  using (public.is_owner() or public.is_admin());
drop policy if exists turnstile_istatistik_yonetici_okur on public.turnstile_istatistik;
create policy turnstile_istatistik_yonetici_okur on public.turnstile_istatistik for select to authenticated
  using (public.is_owner() or public.is_admin());

-- Yazma YALNIZCA aşağıdaki SECURITY DEFINER RPC'lerle (doğrudan tablo yazma yok).
revoke all on public.turnstile_ayarlari from anon, authenticated;
revoke all on public.turnstile_istatistik from anon, authenticated;
grant select on public.turnstile_ayarlari to authenticated;
grant select on public.turnstile_istatistik to authenticated;

-- 2) Zaman mantığı (UTC) -------------------------------------------------------------------------------------------------
create or replace function public.turnstile_plan_icinde_mi(a public.turnstile_ayarlari, t timestamptz)
returns boolean language plpgsql immutable as $$
declare s time; b time; z time := (t at time zone 'UTC')::time;
begin
  if a.plan_tur = 'aralik' then
    return (a.plan_baslangic is null or t >= a.plan_baslangic) and (a.plan_bitis is null or t < a.plan_bitis);
  elsif a.plan_tur = 'gunluk' then
    s := a.gunluk_baslangic; b := a.gunluk_bitis;
    if s is null or b is null then return false; end if;
    if s = b then return false; end if;
    if s < b then return z >= s and z < b; end if;
    return z >= s or z < b;                       -- gece yarısını aşan aralık (ör. 22:00–06:00 UTC)
  end if;
  return true;
end $$;

create or replace function public.turnstile_etkin_mi(a public.turnstile_ayarlari, t timestamptz)
returns boolean language plpgsql immutable as $$
begin
  if not a.acik then return false; end if;
  if a.plan_tur = 'surekli' then return true; end if;
  if a.plan_etki = 'aktif' then return public.turnstile_plan_icinde_mi(a, t); end if;
  return not public.turnstile_plan_icinde_mi(a, t);
end $$;

-- Bir sonraki durum değişimine kalan saniye (istemci önbellek süresini buna göre kırpar; en çok 300 sn).
create or replace function public.turnstile_sonraki_degisim_sn(a public.turnstile_ayarlari, t timestamptz)
returns integer language plpgsql immutable as $$
declare en numeric := 300; c timestamptz; gun date := (t at time zone 'UTC')::date; k int;
begin
  if a.plan_tur = 'aralik' then
    foreach c in array array[a.plan_baslangic, a.plan_bitis] loop
      if c is not null and c > t then en := least(en, extract(epoch from (c - t))); end if;
    end loop;
  elsif a.plan_tur = 'gunluk' and a.gunluk_baslangic is not null and a.gunluk_bitis is not null then
    for k in 0..1 loop
      foreach c in array array[((gun + k)::timestamp + a.gunluk_baslangic) at time zone 'UTC', ((gun + k)::timestamp + a.gunluk_bitis) at time zone 'UTC'] loop
        if c > t then en := least(en, extract(epoch from (c - t))); end if;
      end loop;
    end loop;
  end if;
  return greatest(1, ceil(en))::int;
end $$;

-- 3) Herkese açık, hafif durum okuma (istemci 5 dk önbelleğe alır) -----------------------------------------------------------
create or replace function public.turnstile_durum_getir()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.turnstile_ayarlari; t timestamptz := now(); e boolean;
begin
  select * into a from public.turnstile_ayarlari where id;
  if not found then
    return jsonb_build_object('etkin', true, 'moduller', jsonb_build_object('giris', true, 'kayit', true, 'sifre_sifirlama', true, 'dogrulama', true, 'diger', true),
      'kalkan', false, 'hata_modu', 'acik', 'dogrulama_dk', 30, 'gecerlilik_sn', 60, 'sunucu_utc', t);
  end if;
  e := public.turnstile_etkin_mi(a, t);
  return jsonb_build_object(
    'etkin', e,
    'moduller', jsonb_build_object('giris', e and a.mod_giris, 'kayit', e and a.mod_kayit, 'sifre_sifirlama', e and a.mod_sifre_sifirlama,
                                   'dogrulama', e and a.mod_dogrulama, 'diger', e and a.mod_diger),
    'kalkan', a.kalkan_acik,
    'hata_modu', a.hata_modu,
    'dogrulama_dk', a.dogrulama_dk,
    'gecerlilik_sn', public.turnstile_sonraki_degisim_sn(a, t),
    'sunucu_utc', t);
end $$;
revoke all on function public.turnstile_durum_getir() from public;
grant execute on function public.turnstile_durum_getir() to anon, authenticated, service_role;

-- 4) Yönetici: ayarları oku / kaydet --------------------------------------------------------------------------------------------
create or replace function public.turnstile_ayar_getir()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.turnstile_ayarlari;
begin
  if auth.uid() is null or not (public.is_owner() or public.is_admin()) then
    raise exception 'Bu işlem için yetkin yok.' using errcode = '42501';
  end if;
  select * into a from public.turnstile_ayarlari where id;
  return to_jsonb(a) || jsonb_build_object('etkin_simdi', public.turnstile_etkin_mi(a, now()), 'sunucu_utc', now());
end $$;
revoke all on function public.turnstile_ayar_getir() from public, anon;
grant execute on function public.turnstile_ayar_getir() to authenticated;

create or replace function public.turnstile_ayar_kaydet(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.turnstile_ayarlari;
begin
  if auth.uid() is null or not (public.is_owner() or public.is_admin()) then
    raise exception 'Bu işlem için yetkin yok.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Geçersiz istek.'; end if;
  select * into a from public.turnstile_ayarlari where id for update;

  if p ? 'acik' then a.acik := (p->>'acik')::boolean; end if;
  if p ? 'mod_giris' then a.mod_giris := (p->>'mod_giris')::boolean; end if;
  if p ? 'mod_kayit' then a.mod_kayit := (p->>'mod_kayit')::boolean; end if;
  if p ? 'mod_sifre_sifirlama' then a.mod_sifre_sifirlama := (p->>'mod_sifre_sifirlama')::boolean; end if;
  if p ? 'mod_dogrulama' then a.mod_dogrulama := (p->>'mod_dogrulama')::boolean; end if;
  if p ? 'mod_diger' then a.mod_diger := (p->>'mod_diger')::boolean; end if;
  if p ? 'plan_tur' then a.plan_tur := p->>'plan_tur'; end if;
  if p ? 'plan_etki' then a.plan_etki := p->>'plan_etki'; end if;
  if p ? 'plan_baslangic' then a.plan_baslangic := nullif(p->>'plan_baslangic', '')::timestamptz; end if;
  if p ? 'plan_bitis' then a.plan_bitis := nullif(p->>'plan_bitis', '')::timestamptz; end if;
  if p ? 'gunluk_baslangic' then a.gunluk_baslangic := nullif(p->>'gunluk_baslangic', '')::time; end if;
  if p ? 'gunluk_bitis' then a.gunluk_bitis := nullif(p->>'gunluk_bitis', '')::time; end if;
  if p ? 'hata_modu' then a.hata_modu := p->>'hata_modu'; end if;
  if p ? 'dogrulama_dk' then a.dogrulama_dk := (p->>'dogrulama_dk')::integer; end if;
  if p ? 'kalkan_acik' then a.kalkan_acik := (p->>'kalkan_acik')::boolean; end if;

  if a.plan_tur not in ('surekli', 'aralik', 'gunluk') then raise exception 'Geçersiz zamanlama türü.'; end if;
  if a.plan_etki not in ('aktif', 'pasif') then raise exception 'Geçersiz zamanlama etkisi.'; end if;
  if a.hata_modu not in ('acik', 'kapali') then raise exception 'Geçersiz hata modu.'; end if;
  if a.dogrulama_dk < 1 or a.dogrulama_dk > 1440 then raise exception 'Doğrulama süresi 1–1440 dakika olmalı.'; end if;
  if a.plan_tur = 'aralik' and a.plan_baslangic is not null and a.plan_bitis is not null and a.plan_bitis <= a.plan_baslangic then
    raise exception 'Bitiş, başlangıçtan sonra olmalı.';
  end if;
  if a.plan_tur = 'gunluk' and (a.gunluk_baslangic is null or a.gunluk_bitis is null or a.gunluk_baslangic = a.gunluk_bitis) then
    raise exception 'Günlük plan için farklı bir başlangıç ve bitiş saati (UTC) gir.';
  end if;

  update public.turnstile_ayarlari set
    acik = a.acik, mod_giris = a.mod_giris, mod_kayit = a.mod_kayit, mod_sifre_sifirlama = a.mod_sifre_sifirlama,
    mod_dogrulama = a.mod_dogrulama, mod_diger = a.mod_diger, plan_tur = a.plan_tur, plan_etki = a.plan_etki,
    plan_baslangic = a.plan_baslangic, plan_bitis = a.plan_bitis, gunluk_baslangic = a.gunluk_baslangic, gunluk_bitis = a.gunluk_bitis,
    hata_modu = a.hata_modu, dogrulama_dk = a.dogrulama_dk, kalkan_acik = a.kalkan_acik,
    guncelleyen = auth.uid(), guncelleme = now()
  where id;
  return public.turnstile_ayar_getir();
end $$;
revoke all on function public.turnstile_ayar_kaydet(jsonb) from public, anon;
grant execute on function public.turnstile_ayar_kaydet(jsonb) to authenticated;

-- 5) Olay sayacı (anonim çağrılabilir; yalnızca günlük sayaç artırır, kişisel veri tutmaz) -----------------------------------
create or replace function public.turnstile_olay_kaydet(p_tur text, p_sonuc text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tur not in ('kalkan', 'giris', 'kayit', 'sifre_sifirlama', 'dogrulama', 'diger') then return; end if;
  if p_sonuc not in ('gecti', 'engellendi', 'hata') then return; end if;
  insert into public.turnstile_istatistik (gun, tur, sonuc, adet)
  values ((now() at time zone 'UTC')::date, p_tur, p_sonuc, 1)
  on conflict (gun, tur, sonuc) do update set adet = public.turnstile_istatistik.adet + 1;
  update public.turnstile_ayarlari set son_olay_zamani = now(), son_olay_turu = p_tur || ':' || p_sonuc where id;
end $$;
revoke all on function public.turnstile_olay_kaydet(text, text) from public;
grant execute on function public.turnstile_olay_kaydet(text, text) to anon, authenticated;

create or replace function public.turnstile_ozet()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.turnstile_ayarlari;
begin
  if auth.uid() is null or not (public.is_owner() or public.is_admin()) then
    raise exception 'Bu işlem için yetkin yok.' using errcode = '42501';
  end if;
  select * into a from public.turnstile_ayarlari where id;
  return jsonb_build_object(
    'son_olay_zamani', a.son_olay_zamani, 'son_olay_turu', a.son_olay_turu,
    'son7gun', coalesce((select jsonb_agg(jsonb_build_object('tur', tur, 'sonuc', sonuc, 'adet', adet) order by tur, sonuc)
                          from (select tur, sonuc, sum(adet)::int as adet from public.turnstile_istatistik
                                 where gun >= (now() at time zone 'UTC')::date - 6 group by tur, sonuc) x), '[]'::jsonb));
end $$;
revoke all on function public.turnstile_ozet() from public, anon;
grant execute on function public.turnstile_ozet() to authenticated;
