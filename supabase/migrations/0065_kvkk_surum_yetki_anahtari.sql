-- ============================================================================
-- 0065_kvkk_surum_yetki_anahtari.sql
-- KVKK sürümünü owner dışında kimlerin değiştirebileceğini owner'ın açıp kapattığı
-- tek bir anahtar:  site_ayarlari.kvkk_surum_admin_degistirebilir  (varsayılan KAPALI)
--
-- 0064 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
--
-- KURAL
--   owner                          : her zaman değiştirebilir.
--   admin (askıda değil)           : SADECE anahtar AÇIKSA.
--   diğer roller (manager/editor…) : hiçbir zaman.
--   Anahtarın kendisini yalnızca owner değiştirir (mevcut owner-UPDATE politikası).
--
-- NEDEN RPC: RLS satır bazlıdır; "owner her kolonu, admin sadece bir kolonu" diye
-- ayıramaz. Bu yüzden guncel_kvkk_surumu kolonunun doğrudan UPDATE izni kaldırılır,
-- yazma tek yoldan (kvkk_surumunu_degistir) ve yetki kontrolüyle yapılır.
-- ============================================================================

-- 1) Anahtar
alter table public.site_ayarlari
  add column if not exists kvkk_surum_admin_degistirebilir boolean not null default false;

comment on column public.site_ayarlari.kvkk_surum_admin_degistirebilir is
  'true ise adminler de KVKK sürümünü değiştirebilir (kvkk_surumunu_degistir RPC). Sadece owner değiştirir. Varsayılan false.';

-- Anahtar kolonunu owner (RLS politikası) güncelleyebilir.
grant update (kvkk_surum_admin_degistirebilir) on public.site_ayarlari to authenticated;

-- Sürüm kolonuna doğrudan yazma kapanır (0064'te verilmişti).
revoke update (guncel_kvkk_surumu) on public.site_ayarlari from authenticated;

-- 2) Yetki yardımcısı — istemci arayüzü (menü görünürlüğü) de bunu sorar
create or replace function public.kvkk_surum_yetkisi_var_mi()
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
          and coalesce(s.kvkk_surum_admin_degistirebilir, false)
        )
    from public.profiles p
    left join public.site_ayarlari s on s.id = 1
    where p.id = auth.uid()
  ), false);
$$;

revoke all on function public.kvkk_surum_yetkisi_var_mi() from public, anon;
grant execute on function public.kvkk_surum_yetkisi_var_mi() to authenticated;

-- 3) Sürümü değiştirme — tek yazma yolu
create or replace function public.kvkk_surumunu_degistir(p_surum text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yeni text := btrim(coalesce(p_surum, ''));
begin
  if not public.kvkk_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: KVKK sürümünü değiştirme yetkin yok.';
  end if;

  if v_yeni !~ '^v[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'Sürüm "v1.2" biçiminde olmalı.';
  end if;

  update public.site_ayarlari
  set guncel_kvkk_surumu = v_yeni
  where id = 1
  returning guncel_kvkk_surumu into v_yeni;

  if not found then
    raise exception 'Ayar satırı bulunamadı.';
  end if;

  return v_yeni;
end;
$$;

revoke all on function public.kvkk_surumunu_degistir(text) from public, anon;
grant execute on function public.kvkk_surumunu_degistir(text) to authenticated;

-- 4) Onay özeti — artık yetkili admin de görür; 0064'teki owner-only sürümün yerine geçer
drop function if exists public.owner_kvkk_onay_ozeti();

create or replace function public.kvkk_onay_ozeti()
returns table (
  guncel_surum text,
  toplam bigint,
  guncel bigint,
  eski bigint,
  admin_degistirebilir boolean,
  sahip_mi boolean
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
         v_owner
  from public.site_ayarlari s
  cross join public.profiles p
  where s.id = 1
  group by s.guncel_kvkk_surumu, s.kvkk_surum_admin_degistirebilir;
end;
$$;

revoke all on function public.kvkk_onay_ozeti() from public, anon;
grant execute on function public.kvkk_onay_ozeti() to authenticated;
