-- ============================================================================
-- 0117_akademik_klasorler_otokayit_paylasim.sql — Akademik Kütüphane v2 (Zotero tarzı klasörler + otomatik kayıt)
--
-- 1) KLASÖRLER (koleksiyonlar): iç içe (ust_id) klasör ağacı + bir kaynak birden çok klasörde olabilir (Zotero gibi).
--    Satırlar küçüktür (ad + ilişki); R2/PDF kotasını kullanmaz.
-- 2) OTOMATİK KAYIT: açıklamalar (vurgu/yorum/çizim…) her değişiklikte yalnızca VERİTABANINA yazılır (küçük satırlar);
--    PDF dosyasına gömme + R2 yazımı yalnızca okuyucu kapanırken / elle "PDF'e işle" ile yapılır → R2 işlem kotası harcanmaz.
--    akademik_kaynaklar.aciklama_db_otorite = true olunca açıklamaların doğru kaynağı veritabanıdır (PDF'teki eski kopya değil).
-- 3) PAYLAŞIM: "Benimle paylaşılanlar" için üye listesi + klasör ağacı (yalnızca görünür kaynakların bulunduğu klasörler).
-- ============================================================================

alter table public.akademik_kaynaklar add column if not exists aciklama_db_otorite boolean not null default false;

-- Otomatik kayıt: eşitleme çağrısı veritabanını otorite yapar.
create or replace function public.akademik_aciklamalari_esitle(p_kaynak_id uuid, p_aciklamalar jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare adet integer := 0;
begin
  if jsonb_typeof(coalesce(p_aciklamalar, '[]'::jsonb)) <> 'array' then raise exception 'p_aciklamalar bir dizi olmalı.'; end if;
  delete from public.akademik_notlar n
   where n.kaynak_id = p_kaynak_id and n.ek_id is not null
     and n.ek_id not in (select a->>'ek_id' from jsonb_array_elements(coalesce(p_aciklamalar, '[]'::jsonb)) a where a->>'ek_id' is not null);
  insert into public.akademik_notlar (kaynak_id, user_id, tur, sayfa, metin, yorum, renk, konum, ek_id)
  select p_kaynak_id, auth.uid(), a->>'tur', nullif(a->>'sayfa', '')::integer, a->>'metin', a->>'yorum', nullif(a->>'renk', ''),
         case when jsonb_typeof(a->'konum') = 'object' then a->'konum' else null end, a->>'ek_id'
    from jsonb_array_elements(coalesce(p_aciklamalar, '[]'::jsonb)) a where a->>'ek_id' is not null
  on conflict (kaynak_id, ek_id) do update
    set tur = excluded.tur, sayfa = excluded.sayfa, metin = excluded.metin, yorum = excluded.yorum, renk = excluded.renk, konum = excluded.konum;
  get diagnostics adet = row_count;
  update public.akademik_kaynaklar set aciklama_db_otorite = true where id = p_kaynak_id and not aciklama_db_otorite;
  return adet;
end;
$$;
revoke all on function public.akademik_aciklamalari_esitle(uuid, jsonb) from public, anon;
grant execute on function public.akademik_aciklamalari_esitle(uuid, jsonb) to authenticated;

-- ------------------------------ klasörler ------------------------------
create table if not exists public.akademik_koleksiyonlar (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  ust_id     uuid references public.akademik_koleksiyonlar (id) on delete cascade,
  ad         text not null check (length(btrim(ad)) between 1 and 120),
  sira       integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists akademik_koleksiyon_user_idx on public.akademik_koleksiyonlar (user_id, ust_id);

create table if not exists public.akademik_koleksiyon_ogeleri (
  koleksiyon_id uuid not null references public.akademik_koleksiyonlar (id) on delete cascade,
  kaynak_id     uuid not null references public.akademik_kaynaklar (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  primary key (koleksiyon_id, kaynak_id)
);
create index if not exists akademik_koleksiyon_oge_kaynak_idx on public.akademik_koleksiyon_ogeleri (kaynak_id);

-- Paylaşım görünürlüğü: bu klasörde (ya da alt klasörlerinde) BENİM görebildiğim bir kaynak var mı?
create or replace function public.akademik_kaynak_gorunur_mu(p_gorunurluk text, p_sahip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or (public.akademik_kutuphane_yetkili() and (
    p_sahip = auth.uid() or p_gorunurluk = 'herkese_acik' or (p_gorunurluk = 'ekip' and public.akademik_ekip_uyesi_mi())));
$$;
revoke all on function public.akademik_kaynak_gorunur_mu(text, uuid) from public, anon;
grant execute on function public.akademik_kaynak_gorunur_mu(text, uuid) to authenticated;

create or replace function public.akademik_klasor_gorunur_mu(p_klasor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive alt as (
    select id from public.akademik_koleksiyonlar where id = p_klasor
    union all select c.id from public.akademik_koleksiyonlar c join alt on c.ust_id = alt.id)
  select exists (
    select 1 from alt join public.akademik_koleksiyon_ogeleri o on o.koleksiyon_id = alt.id
      join public.akademik_kaynaklar k on k.id = o.kaynak_id
     where public.akademik_kaynak_gorunur_mu(k.gorunurluk, k.user_id));
$$;
revoke all on function public.akademik_klasor_gorunur_mu(uuid) from public, anon;
grant execute on function public.akademik_klasor_gorunur_mu(uuid) to authenticated;

alter table public.akademik_koleksiyonlar enable row level security;
alter table public.akademik_koleksiyon_ogeleri enable row level security;

drop policy if exists akademik_kol_select on public.akademik_koleksiyonlar;
create policy akademik_kol_select on public.akademik_koleksiyonlar for select to authenticated
  using (public.is_owner() or (public.akademik_kutuphane_yetkili() and (user_id = (select auth.uid()) or public.akademik_klasor_gorunur_mu(id))));
drop policy if exists akademik_kol_yaz on public.akademik_koleksiyonlar;
create policy akademik_kol_yaz on public.akademik_koleksiyonlar for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili()
              and (ust_id is null or exists (select 1 from public.akademik_koleksiyonlar u where u.id = ust_id and u.user_id = (select auth.uid()))));

drop policy if exists akademik_kog_select on public.akademik_koleksiyon_ogeleri;
create policy akademik_kog_select on public.akademik_koleksiyon_ogeleri for select to authenticated
  using (public.is_owner() or (public.akademik_kutuphane_yetkili() and (user_id = (select auth.uid())
         or exists (select 1 from public.akademik_kaynaklar k where k.id = kaynak_id))));
drop policy if exists akademik_kog_yaz on public.akademik_koleksiyon_ogeleri;
create policy akademik_kog_yaz on public.akademik_koleksiyon_ogeleri for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili()
              and exists (select 1 from public.akademik_kaynaklar k where k.id = kaynak_id and k.user_id = (select auth.uid()))
              and exists (select 1 from public.akademik_koleksiyonlar c where c.id = koleksiyon_id and c.user_id = (select auth.uid())));

revoke all on public.akademik_koleksiyonlar, public.akademik_koleksiyon_ogeleri from public, anon;
grant select, insert, update, delete on public.akademik_koleksiyonlar, public.akademik_koleksiyon_ogeleri to authenticated;

-- "Benimle paylaşılanlar": bana görünen kaynağı olan diğer üyeler (yalnızca ad; e-posta gösterilmez — Site Sahibi ayrı RPC ile görür).
create or replace function public.akademik_paylasilan_uyeler()
returns table (user_id uuid, ad text, kaynak_sayisi bigint)
language sql stable security definer set search_path = public as $$
  select k.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Üye'), count(*)
    from public.akademik_kaynaklar k join public.profiles p on p.id = k.user_id
   where k.user_id <> auth.uid() and public.akademik_kutuphane_yetkili()
     and public.akademik_kaynak_gorunur_mu(k.gorunurluk, k.user_id)
   group by k.user_id, p.full_name order by 2;
$$;
revoke all on function public.akademik_paylasilan_uyeler() from public, anon;
grant execute on function public.akademik_paylasilan_uyeler() to authenticated;

-- ------------------------------ YEDEK KAPSAMI ------------------------------
-- Sistem/kişisel yedek: klasörler, klasör-kaynak ilişkileri ve eklenti tercihleri de yedeğe girer (önceki işlevleri bozmadan sarmalayarak).
do $yedek$
begin
  if to_regprocedure('public.sistem_export_tablo_kayitlari()') is not null
     and to_regprocedure('public.sistem_export_tablo_kayitlari_v0()') is null then
    alter function public.sistem_export_tablo_kayitlari() rename to sistem_export_tablo_kayitlari_v0;
    execute $f$
      create or replace function public.sistem_export_tablo_kayitlari()
      returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
      language sql immutable as $b$
        select * from public.sistem_export_tablo_kayitlari_v0()
        union all select * from (values
          ('akademik_koleksiyonlar',      'notlar', 'user_id = auth.uid()', false, false),
          ('akademik_koleksiyon_ogeleri', 'notlar', 'user_id = auth.uid()', false, false),
          ('akademik_eklenti_ayarlari',   'notlar', 'user_id = auth.uid()', false, false)
        ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas)
        where not exists (select 1 from public.sistem_export_tablo_kayitlari_v0() o where o.tablo = t.tablo)
      $b$
    $f$;
  end if;
end
$yedek$;

do $plan$
declare v_def text;
begin
  if to_regprocedure('public.sistem_export_plan(public.sistem_export_loglari)') is not null then
    v_def := pg_get_functiondef('public.sistem_export_plan(public.sistem_export_loglari)'::regprocedure);
    if position($q$r.tablo in ('akademik_kaynaklar', 'akademik_notlar')$q$ in v_def) > 0 then
      v_def := replace(v_def, $q$r.tablo in ('akademik_kaynaklar', 'akademik_notlar')$q$,
        $q$r.tablo in ('akademik_kaynaklar', 'akademik_notlar', 'akademik_koleksiyonlar', 'akademik_koleksiyon_ogeleri', 'akademik_eklenti_ayarlari')$q$);
      execute v_def;
    else
      raise notice 'sistem_export_plan: akademik tablo listesi bulunamadı (zaten güncel olabilir).';
    end if;
  end if;
end
$plan$;
