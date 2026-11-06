-- ============================================================================
-- 0135_tur20_r2_depolama_ve_anahtar_esitleme.sql
--  1) R2 depolama göstergesi: r2_depolama_ozeti() — toplam kullanım / sınır (varsayılan 10 GB). Sınır ücretli plana geçince YÖNETİCİ tarafından artırılır
--     (r2_depolama_limit_ayarla; Site Sahibi). Göstergede %85 (uyarı) ve %95 (kritik) eşikleri.
--  2) R2 FİZİKİ KLASÖR EŞİTLEME: nesne anahtarı artık klasör yolunu yansıtabilir ("arsiv/Klasör/dosya.pdf") — Cloudflare panelinde klasör ağacı görünür.
--     Önceki opak anahtar kuralı (arsiv/<uuid>) gevşetilir; mevcut dosyalar Worker'ın /anahtar-esitle uç noktasıyla (kopyala → anahtarı güncelle → eskiyi sil)
--     PARÇA PARÇA taşınır. Şifreli dosyalar ve .ozel (özel gönderimler) EŞİTLENMEZ: adları anahtara sızmasın.
-- Gereksinim: 0057, 0133. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create table if not exists public.r2_depolama_ayar (
  id boolean primary key default true check (id),
  limit_bayt bigint not null default 10737418240 check (limit_bayt >= 1073741824),
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.r2_depolama_ayar (id) values (true) on conflict do nothing;
alter table public.r2_depolama_ayar enable row level security;
revoke all on public.r2_depolama_ayar from anon, authenticated;

create or replace function public.r2_depolama_ozeti()
returns table (kullanilan_bayt bigint, limit_bayt bigint, dosya_sayisi bigint, esitlenecek bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.is_admin() or public.is_owner() or public.r2_arsiv_yetkim('oku')) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query select coalesce(sum(a.boyut) filter (where a.tur = 'dosya' and a.durum = 'hazir'), 0)::bigint,
                      (select d.limit_bayt from public.r2_depolama_ayar d where d.id),
                      count(*) filter (where a.tur = 'dosya' and a.durum = 'hazir')::bigint,
                      count(*) filter (where a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli and left(a.klasor_yolu, 5) <> '.ozel' and a.r2_key is distinct from 'arsiv/' || a.klasor_yolu || a.ad)::bigint
                 from public.r2_arsiv a;
end $$;
revoke all on function public.r2_depolama_ozeti() from public, anon;
grant execute on function public.r2_depolama_ozeti() to authenticated;

create or replace function public.r2_depolama_limit_ayarla(p_bayt bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'Yalnızca Site Sahibi depolama sınırını değiştirebilir.' using errcode = '42501'; end if;
  update public.r2_depolama_ayar set limit_bayt = p_bayt, updated_at = now(), updated_by = auth.uid() where id;
  return p_bayt;
end $$;
revoke all on function public.r2_depolama_limit_ayarla(bigint) from public, anon;
grant execute on function public.r2_depolama_limit_ayarla(bigint) to authenticated;

-- 2) r2_key biçim kuralı gevşetilir ------------------------------------------
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.r2_arsiv'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ 'r2_key ~'
  loop execute format('alter table public.r2_arsiv drop constraint %I', r.conname); end loop;
  begin
    alter table public.r2_arsiv add constraint r2_arsiv_r2_key_gecerli check (r2_key is null or (r2_key ~ '^arsiv/' and octet_length(r2_key) <= 900 and r2_key !~ '(^|/)\.\.(/|$)'));
  exception when duplicate_object then null; end;
end $$;

create or replace function public._esitle_yetkili(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_uid and (role = 'owner' or (role = 'admin' and coalesce(is_suspended, false) = false)));
$$;
revoke all on function public._esitle_yetkili(uuid) from public, anon, authenticated;

create or replace function public.r2_esitle_adaylari(p_uid uuid, p_limit integer default 10)
returns table (id uuid, r2_key text, hedef_key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._esitle_yetkili(p_uid) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query select a.id, a.r2_key, ('arsiv/' || a.klasor_yolu || a.ad)::text
    from public.r2_arsiv a
   where a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli and left(a.klasor_yolu, 5) <> '.ozel'
     and a.r2_key is distinct from 'arsiv/' || a.klasor_yolu || a.ad and octet_length('arsiv/' || a.klasor_yolu || a.ad) <= 900
   order by a.created_at limit greatest(1, least(coalesce(p_limit, 10), 50));
end $$;
revoke all on function public.r2_esitle_adaylari(uuid, integer) from public, anon, authenticated;
grant execute on function public.r2_esitle_adaylari(uuid, integer) to service_role;

-- Karşılaştır-ve-değiştir: eski anahtar değişmediyse güncellenir (aynı anda başka işlem yaptıysa 0 satır → Worker yeni kopyayı siler, eskiyi korur)
create or replace function public.r2_key_guncelle(p_id uuid, p_eski text, p_yeni text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.r2_arsiv set r2_key = p_yeni where id = p_id and r2_key = p_eski and not sifreli;
  get diagnostics n = row_count; return n = 1;
end $$;
revoke all on function public.r2_key_guncelle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.r2_key_guncelle(uuid, text, text) to service_role;
