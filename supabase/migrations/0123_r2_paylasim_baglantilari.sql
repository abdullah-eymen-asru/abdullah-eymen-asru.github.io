-- ============================================================================
-- 0123_r2_paylasim_baglantilari.sql — Dosya Yöneticisi › "Bağlantılar": adlı, açıklamalı, süreli/SINIRSIZ herkese açık dosya bağlantıları
-- Bağlantı biçimi: https://<alan-adi>/d/<slug>  (slug = anlamlı ad + rastgele kuyruk). Sunucu (r2-arsiv-worker /d/<slug>) her tıklamada
-- geçerliliği DB'den doğrular, kısa ömürlü imzalı R2 adresine yönlendirir → sınırsız süreli link mümkün (S3 imzalı URL en çok 7 gün olurdu).
-- Şifreli (uçtan uca) dosyalar bağlantıyla paylaşılamaz. Gereksinim: 0057 (r2_arsiv, r2_arsiv_yetkilerim). Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create table if not exists public.r2_baglantilari (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dosya_id       uuid references public.r2_arsiv(id) on delete set null,    -- dosya silinirse bağlantı KAYDI kalır (geçmiş) ama çalışmaz
  dosya_ad       text not null,                                              -- anlık görüntü (dosya silinse de "ne paylaşılmıştı" anlaşılsın)
  slug           text not null unique check (slug ~ '^[a-z0-9-]{6,80}$'),
  ad             text not null check (char_length(btrim(ad)) between 1 and 120),
  aciklama       text check (aciklama is null or char_length(aciklama) <= 1000),
  bitis          timestamptz,                                                -- NULL = sınırsız
  iptal          boolean not null default false,
  indirme_sayisi bigint not null default 0,
  son_indirme    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists r2_baglantilari_user_idx on public.r2_baglantilari (user_id, created_at desc);
create index if not exists r2_baglantilari_dosya_idx on public.r2_baglantilari (dosya_id);
alter table public.r2_baglantilari enable row level security;
drop policy if exists r2_baglantilari_oku on public.r2_baglantilari;
create policy r2_baglantilari_oku on public.r2_baglantilari for select to authenticated using (user_id = auth.uid() or public.is_owner());
drop policy if exists r2_baglantilari_sil on public.r2_baglantilari;
create policy r2_baglantilari_sil on public.r2_baglantilari for delete to authenticated using (user_id = auth.uid() or public.is_owner());
revoke all on public.r2_baglantilari from anon;
revoke insert, update on public.r2_baglantilari from authenticated;          -- yazma yalnızca RPC'lerle
grant select, delete on public.r2_baglantilari to authenticated;

-- Alan adları (bağlantının önüne gelecek adresler) — Site Sahibi/Yönetici düzenler. Yol öneki sabit: /d/
create table if not exists public.r2_baglanti_ayar (
  id          boolean primary key default true check (id),
  alan_adlari jsonb not null default '[{"ad":"github.io (ana site)","url":"https://abdullah-eymen-asru.github.io","aktif":true},{"ad":"pages.dev (yedek)","url":"https://abdullah-eymen-asru.pages.dev","aktif":true}]'::jsonb,
  varsayilan_gecerlilik text not null default '7g' check (varsayilan_gecerlilik in ('1s','1g','7g','30g','1y','sinirsiz')),
  guncelleme  timestamptz not null default now()
);
insert into public.r2_baglanti_ayar (id) values (true) on conflict (id) do nothing;
alter table public.r2_baglanti_ayar enable row level security;
revoke all on public.r2_baglanti_ayar from anon, authenticated;

create or replace function public.r2_baglanti_ayar_oku()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('alan_adlari', alan_adlari, 'varsayilan_gecerlilik', varsayilan_gecerlilik) from public.r2_baglanti_ayar where id;
$$;
revoke all on function public.r2_baglanti_ayar_oku() from public, anon;
grant execute on function public.r2_baglanti_ayar_oku() to authenticated;

create or replace function public.r2_baglanti_ayar_kaydet(p_alan_adlari jsonb, p_varsayilan text)
returns void language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not (public.is_owner() or public.is_admin()) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if jsonb_typeof(p_alan_adlari) <> 'array' or jsonb_array_length(p_alan_adlari) not between 1 and 8 then raise exception 'En az 1, en çok 8 alan adı olmalı.'; end if;
  for o in select * from jsonb_array_elements(p_alan_adlari) loop
    if coalesce(o ->> 'url', '') !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{2,5})?$' then raise exception 'Alan adı https:// ile başlamalı ve yol içermemeli: %', coalesce(o ->> 'url', '(boş)'); end if;
    if char_length(coalesce(o ->> 'ad', '')) not between 1 and 60 then raise exception 'Her alan adının kısa bir adı olmalı (1-60 karakter).'; end if;
  end loop;
  update public.r2_baglanti_ayar set alan_adlari = p_alan_adlari, varsayilan_gecerlilik = coalesce(p_varsayilan, '7g'), guncelleme = now() where id;
end $$;
revoke all on function public.r2_baglanti_ayar_kaydet(jsonb, text) from public, anon;
grant execute on function public.r2_baglanti_ayar_kaydet(jsonb, text) to authenticated;

-- slug üretimi: Türkçe karakter sadeleştirilmiş ad + 6 rastgele karakter
create or replace function public._r2_slug_uret(p_ad text)
returns text language plpgsql volatile set search_path = public as $$
declare v_taban text; v_slug text; v_i int := 0; v_alfa constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; v_son text;
begin
  v_taban := regexp_replace(translate(lower(coalesce(p_ad, '')), 'çğıöşüâîûéè', 'cgiosuaiuee'), '[^a-z0-9]+', '-', 'g');
  v_taban := btrim(left(btrim(v_taban, '-'), 40), '-');
  if v_taban = '' then v_taban := 'dosya'; end if;
  loop
    v_son := ''; for i in 1..6 loop v_son := v_son || substr(v_alfa, 1 + floor(random() * length(v_alfa))::int, 1); end loop;
    v_slug := v_taban || '-' || v_son; v_i := v_i + 1;
    exit when not exists (select 1 from public.r2_baglantilari where slug = v_slug) or v_i > 8;
  end loop;
  return v_slug;
end $$;
revoke all on function public._r2_slug_uret(text) from public, anon, authenticated;

-- OLUŞTUR: dosya şifresiz + kullanıcı arşivi okuyabiliyor olmalı. p_bitis NULL = sınırsız.
create or replace function public.r2_baglanti_olustur(p_dosya_id uuid, p_ad text, p_aciklama text, p_bitis timestamptz)
returns table (id uuid, slug text) language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); d public.r2_arsiv; y jsonb; v_slug text; v_id uuid; v_ad text := btrim(coalesce(p_ad, ''));
begin
  if v_uid is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into d from public.r2_arsiv a where a.id = p_dosya_id;
  if d.id is null or d.tur <> 'dosya' or d.durum <> 'hazir' then raise exception 'Dosya bulunamadı ya da henüz hazır değil.'; end if;
  if d.sifreli then raise exception 'Uçtan uca şifreli dosyalar herkese açık bağlantıyla paylaşılamaz (anahtar yalnızca seçtiğin kişilerdedir).'; end if;
  y := public.r2_arsiv_yetkilerim();
  if not (public.is_owner() or coalesce((y ->> 'oku')::boolean, false) or coalesce((y ->> 'yukle')::boolean, false)) then raise exception 'Arşiv erişimin yok.' using errcode = '42501'; end if;
  if v_ad = '' then v_ad := d.ad; end if;
  if char_length(v_ad) > 120 then raise exception 'Ad en çok 120 karakter.'; end if;
  if p_bitis is not null and p_bitis <= now() + interval '30 seconds' then raise exception 'Bitiş zamanı gelecekte olmalı (ya da sınırsız seç).'; end if;
  v_slug := public._r2_slug_uret(v_ad);
  insert into public.r2_baglantilari (user_id, dosya_id, dosya_ad, slug, ad, aciklama, bitis)
  values (v_uid, d.id, d.ad, v_slug, v_ad, nullif(btrim(coalesce(p_aciklama, '')), ''), p_bitis) returning r2_baglantilari.id into v_id;
  return query select v_id, v_slug;
end $$;
revoke all on function public.r2_baglanti_olustur(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.r2_baglanti_olustur(uuid, text, text, timestamptz) to authenticated;

-- GÜNCELLE (ad/açıklama/bitiş/iptal). p_bitis_degistir=false ise bitişe dokunulmaz; true ve p_bitis NULL → sınırsız.
create or replace function public.r2_baglanti_guncelle(p_id uuid, p_ad text, p_aciklama text, p_bitis_degistir boolean, p_bitis timestamptz, p_iptal boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if p_bitis_degistir and p_bitis is not null and p_bitis <= now() then raise exception 'Bitiş zamanı gelecekte olmalı.'; end if;
  if char_length(btrim(coalesce(p_ad, ''))) not between 1 and 120 then raise exception 'Ad 1-120 karakter olmalı.'; end if;
  update public.r2_baglantilari b set ad = btrim(p_ad), aciklama = nullif(btrim(coalesce(p_aciklama, '')), ''),
    bitis = case when p_bitis_degistir then p_bitis else b.bitis end, iptal = coalesce(p_iptal, b.iptal), updated_at = now()
  where b.id = p_id and (b.user_id = auth.uid() or public.is_owner());
  if not found then raise exception 'Bağlantı bulunamadı.'; end if;
end $$;
revoke all on function public.r2_baglanti_guncelle(uuid, text, text, boolean, timestamptz, boolean) from public, anon;
grant execute on function public.r2_baglanti_guncelle(uuid, text, text, boolean, timestamptz, boolean) to authenticated;

-- LİSTELE + ARA (ad, açıklama, dosya adı, slug). Site Sahibi hepsini görür.
create or replace function public.r2_baglanti_listele(p_ara text default null)
returns table (id uuid, slug text, ad text, aciklama text, dosya_id uuid, dosya_ad text, bitis timestamptz, iptal boolean, durum text,
               indirme_sayisi bigint, son_indirme timestamptz, created_at timestamptz, sahip_ad text, benim boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(v_ara, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select b.id, b.slug, b.ad, b.aciklama, b.dosya_id, b.dosya_ad, b.bitis, b.iptal,
           case when b.iptal then 'iptal' when b.dosya_id is null then 'dosya_yok' when b.bitis is not null and b.bitis <= now() then 'doldu' else 'aktif' end,
           b.indirme_sayisi, b.son_indirme, b.created_at,
           case when b.user_id = auth.uid() then null else coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)') end, b.user_id = auth.uid()
    from public.r2_baglantilari b left join public.profiles p on p.id = b.user_id
    where (b.user_id = auth.uid() or public.is_owner())
      and (v_ara is null or b.ad ilike v_kalip or b.aciklama ilike v_kalip or b.dosya_ad ilike v_kalip or b.slug ilike v_kalip)
    order by b.created_at desc limit 500;
end $$;
revoke all on function public.r2_baglanti_listele(text) from public, anon;
grant execute on function public.r2_baglanti_listele(text) to authenticated;

-- ÇÖZ (yalnızca Worker/service_role): geçerliyse sayaç artar ve R2 anahtarı döner. Süresi dolmuş/iptal: durum döner, anahtar DÖNMEZ.
create or replace function public.r2_baglanti_coz(p_slug text)
returns table (durum text, r2_key text, ad text, mime text) language plpgsql security definer set search_path = public as $$
declare b public.r2_baglantilari; d public.r2_arsiv;
begin
  select * into b from public.r2_baglantilari where slug = lower(coalesce(p_slug, ''));
  if b.id is null then return query select 'yok'::text, null::text, null::text, null::text; return; end if;
  if b.iptal then return query select 'iptal'::text, null::text, b.ad, null::text; return; end if;
  if b.bitis is not null and b.bitis <= now() then return query select 'doldu'::text, null::text, b.ad, null::text; return; end if;
  select * into d from public.r2_arsiv a where a.id = b.dosya_id and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli;
  if d.id is null then return query select 'dosya_yok'::text, null::text, b.ad, null::text; return; end if;
  update public.r2_baglantilari set indirme_sayisi = indirme_sayisi + 1, son_indirme = now() where id = b.id;
  return query select 'gecerli'::text, d.r2_key, d.ad, d.mime;
end $$;
revoke all on function public.r2_baglanti_coz(text) from public, anon, authenticated;
grant execute on function public.r2_baglanti_coz(text) to service_role;
-- ============================================================================
-- BİTTİ. Sırada: r2-arsiv-worker'ı yeniden yayınla (/d/<slug> yolu), site dağıtımı (functions/d + 404 yönlendirmesi).
-- ============================================================================
