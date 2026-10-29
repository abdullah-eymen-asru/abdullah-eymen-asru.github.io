-- ============================================================================
-- 0120_akademik_paylasim_klasorsuz_kapsam.sql
-- Akademik Kutuphane paylasimi: yeni kapsam 'klasorsuz' (hicbir klasorde olmayan kaynaklar).
--  - akademik_paylasimlari.kapsam kisitina 'klasorsuz' eklenir (klasor_id bu kapsamda NULL kalir; mevcut klasor kisiti uyumludur).
--  - akademik_paylasim_kaynaklari(): klasorsuz kapsami = kullanicinin hicbir koleksiyon ogesinde yer almayan kaynaklari.
--  - akademik_paylasim_getir(): klasorsuz kapsamda klasor agaci bos doner; kaynaklar duz liste olarak gorunur (mevcut gosterim zaten bunu destekler).
--  - akademik_paylasimi_kutuphaneme_ekle(): degismez (klasor agaci bos kopyalanir, kaynaklar yeni "paylasilan" klasorune konur).
-- Tekrar calistirilabilir (idempotent).
-- ============================================================================

alter table public.akademik_paylasimlari drop constraint if exists akademik_paylasimlari_kapsam_check;
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.akademik_paylasimlari'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%kapsam%in%' and pg_get_constraintdef(oid) not ilike '%klasor_id%'
  loop
    execute format('alter table public.akademik_paylasimlari drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.akademik_paylasimlari
  add constraint akademik_paylasimlari_kapsam_check check (kapsam in ('kutuphane', 'klasor', 'klasorsuz'));

create or replace function public.akademik_paylasim_kaynaklari(p_paylasim public.akademik_paylasimlari)
returns table (kaynak_id uuid) language sql stable security definer set search_path = public as $$
  with recursive alt as (
    select id from public.akademik_koleksiyonlar where id = p_paylasim.klasor_id and p_paylasim.kapsam = 'klasor'
    union all select c.id from public.akademik_koleksiyonlar c join alt on c.ust_id = alt.id)
  select k.id from public.akademik_kaynaklar k
   where k.user_id = p_paylasim.user_id
     and (p_paylasim.ozel_dahil or k.gorunurluk <> 'ozel')
     and ((p_paylasim.kapsam = 'kutuphane')
       or (p_paylasim.kapsam = 'klasor' and exists (select 1 from public.akademik_koleksiyon_ogeleri o join alt on alt.id = o.koleksiyon_id where o.kaynak_id = k.id))
       or (p_paylasim.kapsam = 'klasorsuz' and not exists (select 1 from public.akademik_koleksiyon_ogeleri o where o.kaynak_id = k.id)));
$$;
revoke all on function public.akademik_paylasim_kaynaklari(public.akademik_paylasimlari) from public, anon, authenticated;

-- akademik_paylasim_getir: agac sorgusundaki kapsam kosullari 'klasorsuz' icin hicbir klasor dondurmez (mevcut tanim zaten bos agac uretir);
-- yalnizca kaynak listesi akademik_paylasim_kaynaklari() uzerinden geldigi icin ek degisiklik gerekmez.
