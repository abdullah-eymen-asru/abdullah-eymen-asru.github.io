-- ============================================================================
-- 0119_akademik_paylasim_duzeltme_kullanici_bazli.sql
--
-- 1) "BAĞLANTIYI AÇINCA KÜTÜPHANE BOŞ" HATASI: paylaşım, kaynakları tek tek "özel" işaretliyse (yeni kaynaklar varsayılan olarak "özel"dir) hiçbirini
--    göstermiyordu. Paylaşım artık AÇIK bir tercihtir: ozel_dahil = true (varsayılan) ise kapsamdaki TÜM kaynaklar gösterilir; kapatılırsa "özel" işaretliler hariç tutulur.
-- 2) "BENİMLE PAYLAŞILANLAR" kullanıcı bazlı: her üye için tek kart; üyenin paylaştığı kütüphaneler (bağlantılı/herkese açık/üyelere) ve görünür kaynakları.
-- 3) "KÜTÜPHANEME EKLE": giriş yapmış üye, paylaşılan kütüphanenin künyelerini (PDF olmadan → depolama kotası harcanmaz) ve klasör ağacını kendi kütüphanesine kopyalar.
-- ============================================================================

alter table public.akademik_paylasimlari add column if not exists ozel_dahil boolean not null default true;
alter table public.akademik_paylasimlari alter column erisim set default 'link';

create or replace function public.akademik_paylasim_kaynaklari(p_paylasim public.akademik_paylasimlari)
returns table (kaynak_id uuid) language sql stable security definer set search_path = public as $$
  with recursive alt as (
    select id from public.akademik_koleksiyonlar where id = p_paylasim.klasor_id and p_paylasim.kapsam = 'klasor'
    union all select c.id from public.akademik_koleksiyonlar c join alt on c.ust_id = alt.id)
  select k.id from public.akademik_kaynaklar k
   where k.user_id = p_paylasim.user_id
     and (p_paylasim.ozel_dahil or k.gorunurluk <> 'ozel')
     and ((p_paylasim.kapsam = 'kutuphane')
       or (p_paylasim.kapsam = 'klasor' and exists (select 1 from public.akademik_koleksiyon_ogeleri o join alt on alt.id = o.koleksiyon_id where o.kaynak_id = k.id)));
$$;
revoke all on function public.akademik_paylasim_kaynaklari(public.akademik_paylasimlari) from public, anon, authenticated;

-- Paylaşım sayfası verisine ozel_dahil bilgisi gerekmez; ama kaynak sayısı paylaşım listesinde gösterilebilsin diye önizleme sayacı:
create or replace function public.akademik_paylasim_sayisi(p_paylasim_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare p public.akademik_paylasimlari; n integer;
begin
  select * into p from public.akademik_paylasimlari where id = p_paylasim_id and user_id = auth.uid();
  if not found then return 0; end if;
  select count(*) into n from public.akademik_paylasim_kaynaklari(p);
  return n;
end $$;
revoke all on function public.akademik_paylasim_sayisi(uuid) from public, anon;
grant execute on function public.akademik_paylasim_sayisi(uuid) to authenticated;

-- ---------- kullanıcı bazlı "Benimle paylaşılanlar" ----------
drop function if exists public.akademik_paylasilan_uyeler();
create or replace function public.akademik_paylasilan_uyeler()
returns table (user_id uuid, ad text, kaynak_sayisi bigint, paylasim_sayisi bigint)
language sql stable security definer set search_path = public as $$
  with gorunur as (
    select k.user_id, count(*) as n from public.akademik_kaynaklar k
     where k.user_id <> auth.uid() and public.akademik_kutuphane_yetkili() and public.akademik_kaynak_gorunur_mu(k.gorunurluk, k.user_id) group by k.user_id),
  paylasim as (
    select p.user_id, count(*) as n from public.akademik_paylasimlari p
     where p.user_id <> auth.uid() and p.aktif and p.erisim in ('herkes', 'uyeler') and (p.bitis is null or p.bitis > now()) and auth.uid() is not null group by p.user_id)
  select u.id, coalesce(nullif(btrim(pr.full_name), ''), 'Üye'), coalesce(g.n, 0), coalesce(s.n, 0)
    from (select user_id as id from gorunur union select user_id from paylasim) u
    join public.profiles pr on pr.id = u.id
    left join gorunur g on g.user_id = u.id left join paylasim s on s.user_id = u.id
   order by 2;
$$;
revoke all on function public.akademik_paylasilan_uyeler() from public, anon;
grant execute on function public.akademik_paylasilan_uyeler() to authenticated;

create or replace function public.akademik_uye_paylasimlari(p_uye uuid)
returns table (token text, baslik text, aciklama text, kapsam text, erisim text, kaynak_sayisi bigint)
language sql stable security definer set search_path = public as $$
  select p.token, p.baslik, p.aciklama, p.kapsam, p.erisim, (select count(*) from public.akademik_paylasim_kaynaklari(p))
    from public.akademik_paylasimlari p
   where p.user_id = p_uye and auth.uid() is not null and p.aktif and p.erisim in ('herkes', 'uyeler') and (p.bitis is null or p.bitis > now())
   order by p.created_at desc;
$$;
revoke all on function public.akademik_uye_paylasimlari(uuid) from public, anon;
grant execute on function public.akademik_uye_paylasimlari(uuid) to authenticated;

-- ---------- Kütüphaneme ekle (yalnızca künye + klasör ağacı; PDF kopyalanmaz) ----------
create or replace function public.akademik_paylasimi_kutuphaneme_ekle(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.akademik_paylasimlari; v_kok uuid; v_eklenen integer := 0; v_atlanan integer := 0; r record; v_yeni uuid; v_harita jsonb := '{}'::jsonb; v_k uuid; v_yeni_k uuid;
begin
  if auth.uid() is null or not public.akademik_kutuphane_yetkili() then raise exception 'Bu işlem için giriş yapmış ve akademik kütüphane yetkisi olan bir üye olmalısın.' using errcode = '42501'; end if;
  p := public.akademik_paylasim_gecerli(p_token);
  if p.id is null then raise exception 'Paylaşım bulunamadı.'; end if;
  if p.user_id = auth.uid() then raise exception 'Bu zaten senin kütüphanen.'; end if;
  insert into public.akademik_koleksiyonlar (user_id, ad) values (auth.uid(), left(p.baslik || ' (paylaşılan)', 120)) returning id into v_kok;
  -- klasör ağacını kopyala
  for r in
    with recursive agac as (
      select c.id, c.ust_id, c.ad, 1 as sev from public.akademik_koleksiyonlar c
       where c.user_id = p.user_id and ((p.kapsam = 'kutuphane' and c.ust_id is null) or (p.kapsam = 'klasor' and c.id = p.klasor_id))
      union all select c.id, c.ust_id, c.ad, a.sev + 1 from public.akademik_koleksiyonlar c join agac a on c.ust_id = a.id)
    select * from agac order by sev
  loop
    insert into public.akademik_koleksiyonlar (user_id, ad, ust_id)
    values (auth.uid(), r.ad, case when (p.kapsam = 'klasor' and r.id = p.klasor_id) or r.ust_id is null then v_kok else (v_harita ->> r.ust_id::text)::uuid end)
    returning id into v_yeni_k;
    v_harita := v_harita || jsonb_build_object(r.id::text, v_yeni_k);
  end loop;
  for r in select k.* from public.akademik_kaynaklar k where k.id in (select kaynak_id from public.akademik_paylasim_kaynaklari(p)) loop
    if r.doi is not null and exists (select 1 from public.akademik_kaynaklar x where x.user_id = auth.uid() and lower(x.doi) = lower(r.doi)) then v_atlanan := v_atlanan + 1; continue; end if;
    insert into public.akademik_kaynaklar (user_id, baslik, yazarlar, yayin_yili, dergi_veya_yayinevi, doi, isbn, url, ozet, etiketler, ek_alanlar, tur, gorunurluk)
    values (auth.uid(), r.baslik, r.yazarlar, r.yayin_yili, r.dergi_veya_yayinevi, r.doi, r.isbn, r.url, r.ozet, r.etiketler, r.ek_alanlar, r.tur, 'ozel') returning id into v_yeni;
    v_eklenen := v_eklenen + 1;
    insert into public.akademik_koleksiyon_ogeleri (koleksiyon_id, kaynak_id, user_id)
      select (v_harita ->> o.koleksiyon_id::text)::uuid, v_yeni, auth.uid() from public.akademik_koleksiyon_ogeleri o
       where o.kaynak_id = r.id and v_harita ? o.koleksiyon_id::text on conflict do nothing;
    if not exists (select 1 from public.akademik_koleksiyon_ogeleri where kaynak_id = v_yeni) then
      insert into public.akademik_koleksiyon_ogeleri (koleksiyon_id, kaynak_id, user_id) values (v_kok, v_yeni, auth.uid()) on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('eklenen', v_eklenen, 'atlanan', v_atlanan, 'klasor', v_kok);
end $$;
revoke all on function public.akademik_paylasimi_kutuphaneme_ekle(text) from public, anon;
grant execute on function public.akademik_paylasimi_kutuphaneme_ekle(text) to authenticated;
