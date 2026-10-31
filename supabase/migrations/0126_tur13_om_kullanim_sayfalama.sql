-- ============================================================================
-- 0126_tur13_om_kullanim_sayfalama.sql
-- HavaStil › Open-Meteo "Herkesin bireysel kullanımı": çok üyeli sitede taşmasın diye SAYFALAMA + sunucu tarafı arama.
--  • E-posta artık HİÇ dönmez (maskeli de değil); arama yine ad ve e-posta üzerinde çalışır (eşleşme sunucuda, adres istemciye çıkmaz).
--  • p_limit (1–100, varsayılan 20) / p_offset; her satırda toplam (eşleşen üye sayısı).
--  • Aylık toplamlar tek GROUP BY ile hesaplanır (üye sayısı arttıkça üye başına alt sorgu yok).
-- Gereksinim: 0121, 0124. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
drop function if exists public.openmeteo_kullanim_tumu(text);
drop function if exists public.openmeteo_kullanim_tumu(text, integer, integer);
create or replace function public.openmeteo_kullanim_tumu(p_ara text default null, p_limit integer default 20, p_offset integer default 0)
returns table (user_id uuid, ad text, rol text, dakika bigint, saat bigint, gun bigint, ay bigint, kendi_ay bigint,
               ip_sayisi bigint, kisiye_ozel_limit jsonb, etkin_limit jsonb, toplam bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 100)); v_off int := greatest(0, coalesce(p_offset, 0));
  v_ay_basi timestamptz := (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
  v_gun_basi timestamptz := (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_ara), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    with ay as (
      select u.user_id as uid,
             sum(u.agirlik) filter (where u.kaynak <> 'kendi' and u.dk >= date_trunc('minute', now()))::bigint as dakika,
             sum(u.agirlik) filter (where u.kaynak <> 'kendi' and u.dk > now() - interval '60 minutes')::bigint as saat,
             sum(u.agirlik) filter (where u.kaynak <> 'kendi' and u.dk >= v_gun_basi)::bigint as gun,
             sum(u.agirlik) filter (where u.kaynak <> 'kendi')::bigint as ay,
             sum(u.agirlik) filter (where u.kaynak = 'kendi')::bigint as kendi_ay,
             count(distinct u.ip_hash) filter (where u.dk >= v_gun_basi)::bigint as ipler
      from public.openmeteo_kullanim u where u.dk >= v_ay_basi and u.user_id is not null group by u.user_id)
    select p.id, coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)')::text, p.role::text,
           coalesce(a.dakika, 0)::bigint, coalesce(a.saat, 0)::bigint, coalesce(a.gun, 0)::bigint, coalesce(a.ay, 0)::bigint,
           coalesce(a.kendi_ay, 0)::bigint, coalesce(a.ipler, 0)::bigint,
           kl.limitler, public._om_etkin_kullanici_limiti(p.id), count(*) over ()::bigint
    from public.profiles p
    left join ay a on a.uid = p.id
    left join public.openmeteo_kullanici_limitleri kl on kl.user_id = p.id
    where v_ara is null or public._ara_norm(p.full_name::text) like v_kalip escape '\' or public._ara_norm(p.email::text) like v_kalip escape '\'
    order by coalesce(a.gun, 0) desc, coalesce(a.ay, 0) desc, p.created_at
    limit v_lim offset v_off;
end $$;
revoke all on function public.openmeteo_kullanim_tumu(text, integer, integer) from public, anon;
grant execute on function public.openmeteo_kullanim_tumu(text, integer, integer) to authenticated;
