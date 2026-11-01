-- ============================================================================
-- 0130_tur17_alici_arama_sayfalama.sql — "Kime gönder" kullanıcı araması SAYFALI (çok üyede liste taşmaz).
-- arsiv_kullanici_ara(p_q, p_limit = 20, p_offset = 0). E-posta yine ASLA dönmez. Eski tek parametreli sürüm kaldırılır (belirsiz çağrıyı önlemek için).
-- Gereksinim: 0063. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
drop function if exists public.arsiv_kullanici_ara(text);
drop function if exists public.arsiv_kullanici_ara(text, integer, integer);
create or replace function public.arsiv_kullanici_ara(p_q text, p_limit integer default 20, p_offset integer default 0)
returns table (kullanici_id uuid, ad text, rol text, anahtar_var boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := public.tr_ara_normalize(btrim(coalesce(p_q, '')));
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_off int := greatest(0, coalesce(p_offset, 0));
begin
  if auth.uid() is null or not (public.r2_arsiv_yetkim('yukle') or public.is_owner()) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı'), p.role, (k.kullanici_id is not null)
      from public.profiles p
      left join public.e2ee_kullanici_anahtarlari k on k.kullanici_id = p.id
     where p.id <> auth.uid() and coalesce(p.is_suspended, false) = false
       and not exists (select 1 from unnest(string_to_array(v_q, ' ')) as t(tok)
                        where t.tok <> '' and public.tr_ara_normalize(p.full_name) not like '%' || public.like_kacis(t.tok) || '%')
     order by (k.kullanici_id is not null) desc, public.tr_sirala(p.full_name), p.full_name, p.id
     limit v_lim offset v_off;
end $$;
revoke all on function public.arsiv_kullanici_ara(text, integer, integer) from public, anon;
grant execute on function public.arsiv_kullanici_ara(text, integer, integer) to authenticated;

