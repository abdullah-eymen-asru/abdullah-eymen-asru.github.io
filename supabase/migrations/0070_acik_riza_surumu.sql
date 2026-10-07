-- ============================================================================
-- 0070_acik_riza_surumu.sql
-- AÇIK RIZA (yurt dışına aktarım) için KENDİ SÜRÜM ETİKETİ — KVKK Aydınlatma sürümüyle senkron akış.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). 0064 + 0065 çalıştırılmış olmalı.
--
-- SORUN (0064'te): açık rızanın sürümü, Aydınlatma Metni sürümüyle (guncel_kvkk_surumu) AYNI etiketten
-- yazılıyordu. İki metin ayrı hukuki belgeler olduğu için biri değişince diğerinin onayı da "eski"
-- sayılıyor ya da hiç sayılmıyordu; açık rıza metni tek başına güncellenemiyordu.
--
-- ÇÖZÜM
--   1) site_ayarlari.guncel_riza_surumu — açık rıza metninin kendi sürümü. Başlangıç değeri = yürürlükteki
--      KVKK sürümü (böylece bu migration yüzünden kimseye gereksiz modal çıkmaz).
--   2) guncel_riza_surumu() iç yardımcı + riza_surumunu_degistir(p_surum) — kvkk_surumunu_degistir ile
--      AYNI yetki (owner; admin ise owner anahtarı açıksa).
--   3) profiles tetikleyicisi: açık rıza (yurtdisi_onay_verildi) verilirken kaydedilen sürüm HER ZAMAN
--      DB'deki güncel açık rıza sürümüdür (istemciden / handle_new_user'dan gelen değer yok sayılır).
--   4) kvkk_onay_ozeti() — açık rıza sayaçlarını da döndürür (panel: "kaç üyeye modal çıkacak").
-- ============================================================================

-- 1) KOLON
alter table public.site_ayarlari
  add column if not exists guncel_riza_surumu text;

update public.site_ayarlari
   set guncel_riza_surumu = guncel_kvkk_surumu
 where id = 1 and guncel_riza_surumu is null;

alter table public.site_ayarlari
  alter column guncel_riza_surumu set default 'v1.1';
alter table public.site_ayarlari
  alter column guncel_riza_surumu set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_ayarlari'::regclass and conname = 'site_ayarlari_riza_surumu_bicim'
  ) then
    alter table public.site_ayarlari
      add constraint site_ayarlari_riza_surumu_bicim
      check (guncel_riza_surumu ~ '^v[0-9]{1,3}\.[0-9]{1,3}$');
  end if;
end $$;

comment on column public.site_ayarlari.guncel_riza_surumu is
  'Yurt dışına aktarım AÇIK RIZA metninin yürürlükteki sürüm etiketi. Daha önce açık rıza vermiş üyenin profiles.yurtdisi_onay_versiyonu bununla eşleşmiyorsa giriş sonrası modal rızayı yeniden sorar (auth-guard.js). Aydınlatma sürümünden (guncel_kvkk_surumu) BAĞIMSIZ yükseltilir.';

-- (herkese okunur politika + tablo SELECT yetkisi yeni kolonu zaten kapsar; UPDATE yalnızca RPC ile)

-- 2) İÇ YARDIMCI + DEĞİŞTİRME RPC'Sİ
create or replace function public.guncel_riza_surumu()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select guncel_riza_surumu from public.site_ayarlari where id = 1;
$$;
revoke all on function public.guncel_riza_surumu() from public, anon, authenticated;

create or replace function public.riza_surumunu_degistir(p_surum text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yeni text := btrim(coalesce(p_surum, ''));
begin
  if not public.kvkk_surum_yetkisi_var_mi() then
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

-- 3) AÇIK RIZA SÜRÜMÜNÜ DB DAMGALASIN (kvkk_onayini_ver + handle_new_user'a dokunmadan)
create or replace function public.profiles_riza_surumu_damgala()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.yurtdisi_onay_verildi is true
     and (tg_op = 'INSERT'
          or old.yurtdisi_onay_verildi is distinct from true
          or new.yurtdisi_onay_versiyonu is distinct from old.yurtdisi_onay_versiyonu) then
    new.yurtdisi_onay_versiyonu := coalesce(public.guncel_riza_surumu(), new.yurtdisi_onay_versiyonu);
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_riza_surumu_damgala() from public, anon, authenticated;

drop trigger if exists trg_profiles_riza_surumu on public.profiles;
create trigger trg_profiles_riza_surumu
  before insert or update of yurtdisi_onay_verildi, yurtdisi_onay_versiyonu on public.profiles
  for each row execute function public.profiles_riza_surumu_damgala();

-- 4) ÖZET (dönüş tipi değiştiği için önce düşür)
drop function if exists public.kvkk_onay_ozeti();

create or replace function public.kvkk_onay_ozeti()
returns table (
  guncel_surum text,
  toplam bigint,
  guncel bigint,
  eski bigint,
  admin_degistirebilir boolean,
  sahip_mi boolean,
  riza_surumu text,
  riza_verenler bigint,
  riza_guncel bigint,
  riza_eski bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner boolean := public.is_owner();
begin
  if not public.kvkk_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: KVKK onay özetini görme yetkin yok.';
  end if;

  return query
  select s.guncel_kvkk_surumu,
         count(*)::bigint,
         count(*) filter (where p.kvkk_onay_versiyonu = s.guncel_kvkk_surumu)::bigint,
         count(*) filter (where p.kvkk_onay_versiyonu is distinct from s.guncel_kvkk_surumu)::bigint,
         s.kvkk_surum_admin_degistirebilir,
         v_owner,
         s.guncel_riza_surumu,
         count(*) filter (where p.yurtdisi_onay_verildi)::bigint,
         count(*) filter (where p.yurtdisi_onay_verildi and p.yurtdisi_onay_versiyonu = s.guncel_riza_surumu)::bigint,
         count(*) filter (where p.yurtdisi_onay_verildi and p.yurtdisi_onay_versiyonu is distinct from s.guncel_riza_surumu)::bigint
  from public.site_ayarlari s
  cross join public.profiles p
  where s.id = 1
  group by s.guncel_kvkk_surumu, s.kvkk_surum_admin_degistirebilir, s.guncel_riza_surumu;
end;
$$;
revoke all on function public.kvkk_onay_ozeti() from public, anon;
grant execute on function public.kvkk_onay_ozeti() to authenticated;
