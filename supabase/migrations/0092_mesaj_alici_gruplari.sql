-- ============================================================================
-- 0092_mesaj_alici_gruplari.sql
-- Site Sahibi / Yönetici mesajlaşmasında "Kime?" seçimi: üye sayısı arttıkça listenin taşmaması için GRUPLU ve SAYFALI alıcı seçici.
--   Gruplar: yonetim (owner+admin) · icerik (manager+editor) · ozel (special_user) · uye (user) · demo (demo)
-- GİZLİLİK: dönüşte E-POSTA YOK; aramada yalnızca İSİM eşleşir (e-posta ile arayıp adresi sezme yolu kapatıldı; % ve _ joker karakterleri temizlenir).
-- Yalnızca is_admin() (owner/admin) çağırabilir; çağıranın kendisi ve askıdaki hesaplar listelenmez.
-- Tekrar çalıştırmak güvenlidir. Gereksinim: 0006, 0025, 0083.
-- ============================================================================

create or replace function public._mesaj_grup(p_rol text)
returns text language sql immutable as $$
  select case
    when p_rol in ('owner', 'admin') then 'yonetim'
    when p_rol in ('manager', 'editor') then 'icerik'
    when p_rol = 'special_user' then 'ozel'
    when p_rol = 'demo' then 'demo'
    else 'uye'
  end;
$$;

create or replace function public.mesaj_alici_ozeti()
returns table (grup text, adet bigint)
language sql stable security definer set search_path = public as $$
  select public._mesaj_grup(p.role::text) as grup, count(*)::bigint
  from public.profiles p
  where public.is_admin()
    and p.id <> auth.uid()
    and coalesce(p.is_suspended, false) = false
  group by 1;
$$;

create or replace function public.mesaj_alici_listesi(
  p_grup text default null, p_q text default '', p_limit integer default 20, p_ofset integer default 0
)
returns table (id uuid, ad text, rol text, toplam bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', ''), '\', '');
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if p_grup is not null and p_grup not in ('yonetim', 'icerik', 'ozel', 'uye', 'demo') then
    raise exception 'Geçersiz grup.';
  end if;
  return query
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye') as ad,
         p.role::text,
         count(*) over ()
  from public.profiles p
  where p.id <> auth.uid()
    and coalesce(p.is_suspended, false) = false
    and (p_grup is null or public._mesaj_grup(p.role::text) = p_grup)
    and (v_q = '' or p.full_name ilike '%' || v_q || '%')
  order by p.full_name nulls last, p.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;

revoke all on function public.mesaj_alici_ozeti() from public, anon;
revoke all on function public.mesaj_alici_listesi(text, text, integer, integer) from public, anon;
grant execute on function public.mesaj_alici_ozeti() to authenticated;
grant execute on function public.mesaj_alici_listesi(text, text, integer, integer) to authenticated;

-- Eski admin_uye_arama: e-posta ile eşleştirme ve joker karakter sızıntısı kapatılır (yalnızca isim; % _ temizlenir).
create or replace function public.admin_uye_arama(arama_metni text)
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where public.is_admin()
    and (
      btrim(coalesce(arama_metni, '')) = ''
      or p.full_name ilike '%' || replace(replace(replace(btrim(arama_metni), '%', ''), '_', ''), '\', '') || '%'
    )
  order by p.full_name nulls last
  limit 8;
$$;
revoke execute on function public.admin_uye_arama(text) from public, anon;
grant  execute on function public.admin_uye_arama(text) to authenticated;
