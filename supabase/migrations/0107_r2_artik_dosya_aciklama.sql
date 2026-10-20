-- ============================================================================
-- 0107_r2_artik_dosya_aciklama.sql — R2 Akıllı Artık Dosya Gezgini: "Neden artık dosya?" gerekçesi için kanıt toplayıcı
--
-- sistem_r2_bilinmeyenleri() (0095) bir R2 anahtarının veritabanında KARŞILIĞI OLMADIĞINI söyler. Bu fonksiyon, neden olabileceğini
-- anlatmak için anahtardan sahibi çıkarır ve şunu sorar: sahibinin hesabı hâlâ var mı? Not kasası hâlâ var mı?
-- Yalnızca Site Sahibi. Hiçbir veri değiştirmez (stable).
-- ============================================================================
create or replace function public.sistem_r2_artik_aciklama(p_kaynak text, p_anahtarlar text[])
returns table (anahtar text, sahip_id uuid, sahip_var boolean, kasa_var boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yalnızca Site Sahibi.' using errcode = '42501'; end if;
  if p_kaynak not in ('arsiv', 'notek', 'akademik') then raise exception 'Geçersiz kaynak.'; end if;
  if p_anahtarlar is null or coalesce(array_length(p_anahtarlar, 1), 0) > 1000 then raise exception 'En çok 1000 anahtar.'; end if;
  return query
    select k.a,
           o.uid,
           (o.uid is not null and exists (select 1 from public.profiles p where p.id = o.uid)),
           (o.uid is not null and exists (select 1 from public.not_kasasi n where n.user_id = o.uid))
      from unnest(p_anahtarlar) as k(a)
     cross join lateral (
       select case
         when p_kaynak = 'notek' then
           (substring(k.a from '^notlar/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/'))::uuid
         when p_kaynak = 'akademik' then
           (substring(k.a from '^akademik-kutuphane/users/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/'))::uuid
         else null end as uid
     ) o;
end;
$$;
revoke all on function public.sistem_r2_artik_aciklama(text, text[]) from public, anon;
grant execute on function public.sistem_r2_artik_aciklama(text, text[]) to authenticated;
