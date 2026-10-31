-- ============================================================================
-- 0125_tur12_baglanti_klasorleri_ve_sifirlama.sql
-- Dosya Yöneticisi › Bağlantılar:
--  1) Klasör / alt klasör (r2_baglanti_klasorleri + r2_baglantilari.klasor)
--  2) r2_baglanti_tasi / klasor_ekle / klasor_sil / klasor_listele RPC'leri
--  3) r2_baglanti_sifirla: yeni rastgele adres üretir; ESKİ ADRES ARTIK ÇALIŞMAZ (sızan link için güvenlik önlemi)
--  4) r2_baglanti_listele: klasor kolonu eklendi
-- Gereksinim: 0123, 0124. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.r2_baglantilari add column if not exists klasor text;
do $$ begin
  alter table public.r2_baglantilari add constraint r2_baglantilari_klasor_gecerli
    check (klasor is null or (char_length(btrim(klasor)) >= 1 and klasor !~ '[\\[:cntrl:]]' and klasor !~ '(^|/)\s*(/|$)' and klasor !~ '^/|/$'
           and array_length(string_to_array(klasor, '/'), 1) <= 8));
exception when duplicate_object then null; end $$;

create table if not exists public.r2_baglanti_klasorleri (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  yol text not null check (char_length(btrim(yol)) >= 1 and yol !~ '[\\[:cntrl:]]' and yol !~ '^/|/$' and yol !~ '//' and array_length(string_to_array(yol, '/'), 1) <= 8),
  created_at timestamptz not null default now(),
  unique (user_id, yol)
);
alter table public.r2_baglanti_klasorleri enable row level security;
drop policy if exists r2_baglanti_klasorleri_oku on public.r2_baglanti_klasorleri;
create policy r2_baglanti_klasorleri_oku on public.r2_baglanti_klasorleri for select to authenticated using (user_id = auth.uid() or public.is_owner());
revoke all on public.r2_baglanti_klasorleri from anon;
revoke insert, update, delete on public.r2_baglanti_klasorleri from authenticated;   -- yazma yalnızca RPC
grant select on public.r2_baglanti_klasorleri to authenticated;

create or replace function public._r2_klasor_temizle(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(array_to_string(array(select btrim(x) from unnest(string_to_array(coalesce(p, ''), '/')) x where btrim(x) <> ''), '/'), '');
$$;

create or replace function public.r2_baglanti_klasor_ekle(p_yol text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := public._r2_klasor_temizle(p_yol);
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v is null then raise exception 'Klasör adı boş olamaz.'; end if;
  if v ~ '[\\[:cntrl:]]' then raise exception 'Klasör adında geçersiz karakter var.'; end if;
  if array_length(string_to_array(v, '/'), 1) > 8 then raise exception 'Klasör derinliği en fazla 8 olabilir.'; end if;
  insert into public.r2_baglanti_klasorleri (user_id, yol) values (auth.uid(), v) on conflict (user_id, yol) do nothing;
  return v;
end $$;
revoke all on function public.r2_baglanti_klasor_ekle(text) from public, anon;
grant execute on function public.r2_baglanti_klasor_ekle(text) to authenticated;

-- Klasörü (ve alt klasörlerini) kaldırır; içindeki bağlantılar SİLİNMEZ, ana klasöre taşınır.
create or replace function public.r2_baglanti_klasor_sil(p_yol text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public._r2_klasor_temizle(p_yol);
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v is null then raise exception 'Klasör bulunamadı.'; end if;
  update public.r2_baglantilari set klasor = null where user_id = auth.uid() and (klasor = v or klasor like v || '/%');
  delete from public.r2_baglanti_klasorleri where user_id = auth.uid() and (yol = v or yol like v || '/%');
end $$;
revoke all on function public.r2_baglanti_klasor_sil(text) from public, anon;
grant execute on function public.r2_baglanti_klasor_sil(text) to authenticated;

create or replace function public.r2_baglanti_klasor_listele()
returns table (yol text) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  return query
    select distinct x.yol from (
      select k.yol from public.r2_baglanti_klasorleri k where k.user_id = auth.uid()
      union select b.klasor from public.r2_baglantilari b where b.user_id = auth.uid() and b.klasor is not null
    ) x order by 1;
end $$;
revoke all on function public.r2_baglanti_klasor_listele() from public, anon;
grant execute on function public.r2_baglanti_klasor_listele() to authenticated;

create or replace function public.r2_baglanti_tasi(p_id uuid, p_klasor text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := public._r2_klasor_temizle(p_klasor);
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v is not null then
    if v ~ '[\\[:cntrl:]]' then raise exception 'Klasör adında geçersiz karakter var.'; end if;
    if array_length(string_to_array(v, '/'), 1) > 8 then raise exception 'Klasör derinliği en fazla 8 olabilir.'; end if;
    insert into public.r2_baglanti_klasorleri (user_id, yol) select auth.uid(), v where exists (select 1 from public.r2_baglantilari b where b.id = p_id and b.user_id = auth.uid()) on conflict (user_id, yol) do nothing;
  end if;
  update public.r2_baglantilari set klasor = v, updated_at = now() where id = p_id and (user_id = auth.uid() or public.is_owner());
  if not found then raise exception 'Bağlantı bulunamadı.'; end if;
end $$;
revoke all on function public.r2_baglanti_tasi(uuid, text) from public, anon;
grant execute on function public.r2_baglanti_tasi(uuid, text) to authenticated;

-- Adresi sıfırla: yeni slug; eski slug veritabanında artık yok → eski link "bulunamadı" döner.
create or replace function public.r2_baglanti_sifirla(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare b public.r2_baglantilari; v_yeni text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into b from public.r2_baglantilari x where x.id = p_id and (x.user_id = auth.uid() or public.is_owner()) for update;
  if b.id is null then raise exception 'Bağlantı bulunamadı.'; end if;
  v_yeni := public._r2_slug_uret(b.ad);
  update public.r2_baglantilari set slug = v_yeni, updated_at = now() where id = b.id;
  return v_yeni;
end $$;
revoke all on function public.r2_baglanti_sifirla(uuid) from public, anon;
grant execute on function public.r2_baglanti_sifirla(uuid) to authenticated;

-- Liste: klasor kolonu eklendi (dönüş tipi değiştiği için önce düşürülür)
drop function if exists public.r2_baglanti_listele(text);
create or replace function public.r2_baglanti_listele(p_ara text default null)
returns table (id uuid, slug text, ad text, aciklama text, dosya_id uuid, dosya_ad text, bitis timestamptz, iptal boolean, durum text,
               indirme_sayisi bigint, son_indirme timestamptz, created_at timestamptz, sahip_ad text, benim boolean, klasor text)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_ara), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select b.id, b.slug, b.ad, b.aciklama, b.dosya_id, b.dosya_ad, b.bitis, b.iptal,
           (case when b.iptal then 'iptal' when b.dosya_id is null then 'dosya_yok' when b.bitis is not null and b.bitis <= now() then 'doldu' else 'aktif' end)::text,
           b.indirme_sayisi, b.son_indirme, b.created_at,
           (case when b.user_id = auth.uid() then null else coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)') end)::text, b.user_id = auth.uid(), b.klasor
    from public.r2_baglantilari b left join public.profiles p on p.id = b.user_id
    where (b.user_id = auth.uid() or public.is_owner())
      and (v_ara is null
           or public._ara_norm(b.ad) like v_kalip escape '\' or public._ara_norm(b.aciklama) like v_kalip escape '\'
           or public._ara_norm(b.dosya_ad) like v_kalip escape '\' or public._ara_norm(b.klasor) like v_kalip escape '\' or b.slug like v_kalip escape '\'
           or (public.is_owner() and public._ara_norm(p.full_name::text) like v_kalip escape '\'))
    order by b.created_at desc limit 1000;
end $$;
revoke all on function public.r2_baglanti_listele(text) from public, anon;
grant execute on function public.r2_baglanti_listele(text) to authenticated;
