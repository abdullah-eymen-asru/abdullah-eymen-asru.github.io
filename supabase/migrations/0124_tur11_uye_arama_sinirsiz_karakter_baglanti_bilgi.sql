-- ============================================================================
-- 0124_tur11_uye_arama_sinirsiz_karakter_baglanti_bilgi.sql
-- 1) openmeteo_kullanim_tumu: "structure of query does not match function result type" hatası giderildi.
--    SEBEP: sum(bigint) PostgreSQL'de NUMERIC döndürür; fonksiyon bigint bildiriyordu. Ayrıca p.role/p.email tipleri text'e sabitlendi.
--    Arama artık AD ve E-POSTA (tam adres) üzerinde, Türkçe karakter/büyük-küçük harf duyarsız çalışır.
-- 2) 120/200 karakter sınırları kaldırıldı (bağlantı adı, arşiv dosya adı, klasör adları, duyuru başlığı, konuşma konusu...).
--    Mesaj GÖVDESİ (şifreli metin) sınırı bilerek korunur: şifreli yük boyutu depolama/Realtime için gereklidir.
-- 3) Paylaşım bağlantısı için bilgi sayfası RPC'si: r2_baglanti_bilgi (sayaç ARTIRMAZ; yalnızca Worker/service_role).
-- 4) r2_baglanti_listele: arama sahibin adını da kapsar (Site Sahibi için), Türkçe duyarsız.
-- Gereksinim: 0113, 0121, 0123. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- ---------------------------------------------------------------------------- 0) Türkçe/duyarsız arama yardımcısı
create or replace function public._ara_norm(p text)
returns text language sql immutable set search_path = public as $$
  select lower(translate(coalesce(p, ''), 'İIıÇçĞğÖöŞşÜüÂâÎîÛû', 'iiiccggoossuuaaiiuu'));
$$;
revoke all on function public._ara_norm(text) from public, anon;
grant execute on function public._ara_norm(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------- 1) Open-Meteo herkesin kullanımı
drop function if exists public.openmeteo_kullanim_tumu(text);
create or replace function public.openmeteo_kullanim_tumu(p_ara text default null)
returns table (user_id uuid, ad text, eposta_maskeli text, rol text, dakika bigint, saat bigint, gun bigint, ay bigint, kendi_ay bigint,
               ip_sayisi bigint, kisiye_ozel_limit jsonb, etkin_limit jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_ara is not null then
    v_kalip := '%' || replace(replace(replace(public._ara_norm(v_ara), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select p.id,
           coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)')::text,
           public._eposta_maskele(p.email::text)::text,
           p.role::text,
           coalesce(x.dakika, 0)::bigint, coalesce(x.saat, 0)::bigint, coalesce(x.gun, 0)::bigint, coalesce(x.ay, 0)::bigint,
           coalesce(x.kendi_ay, 0)::bigint, coalesce(x.ipler, 0)::bigint,
           kl.limitler, public._om_etkin_kullanici_limiti(p.id)
    from public.profiles p
    left join public.openmeteo_kullanici_limitleri kl on kl.user_id = p.id
    left join lateral (
      select sum(agirlik) filter (where kaynak <> 'kendi' and dk >= date_trunc('minute', now())) as dakika,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk > now() - interval '60 minutes') as saat,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as gun,
             sum(agirlik) filter (where kaynak <> 'kendi' and dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')) as ay,
             sum(agirlik) filter (where kaynak = 'kendi' and dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')) as kendi_ay,
             count(distinct ip_hash) filter (where dk >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) as ipler
      from public.openmeteo_kullanim u where u.user_id = p.id and u.dk >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
    ) x on true
    where v_ara is null
       or public._ara_norm(p.full_name::text) like v_kalip escape '\'
       or public._ara_norm(p.email::text) like v_kalip escape '\'
    order by coalesce(x.gun, 0) desc, coalesce(x.ay, 0) desc, p.created_at
    limit 200;
end $$;
revoke all on function public.openmeteo_kullanim_tumu(text) from public, anon;
grant execute on function public.openmeteo_kullanim_tumu(text) to authenticated;

-- ---------------------------------------------------------------------------- 2) Karakter sınırlarının kaldırılması
do $$
declare r record; t record;
begin
  for t in select * from (values
    ('r2_baglantilari', 'ad'), ('akademik_koleksiyonlar', 'ad'), ('akademik_paylasimlari', 'baslik'),
    ('akademik_paylasimlari', 'aciklama'), ('r2_baglantilari', 'aciklama'),
    ('site_duyurulari', 'baslik'), ('site_duyurulari', 'metin'), ('conversations', 'konu')
  ) v(tablo, kolon) loop
    if to_regclass('public.' || t.tablo) is null then continue; end if;
    for r in select c.conname, pg_get_constraintdef(c.oid) as d from pg_constraint c
             where c.conrelid = ('public.' || t.tablo)::regclass and c.contype = 'c'
               and pg_get_constraintdef(c.oid) ~ ('(char_length|length)\(.*\m' || t.kolon || '\M.*\)\s*(<=|BETWEEN 1 AND)\s*[0-9]+')
    loop
      execute format('alter table public.%I drop constraint %I', t.tablo, r.conname);
    end loop;
  end loop;
end $$;
-- boş ad yine yasak (sınır değil, doğruluk kuralı)
do $$ begin
  if to_regclass('public.r2_baglantilari') is not null then
    begin alter table public.r2_baglantilari add constraint r2_baglantilari_ad_bos_degil check (char_length(btrim(ad)) >= 1); exception when duplicate_object then null; end;
  end if;
  if to_regclass('public.akademik_koleksiyonlar') is not null then
    begin alter table public.akademik_koleksiyonlar add constraint akademik_koleksiyonlar_ad_bos_degil check (char_length(btrim(ad)) >= 1); exception when duplicate_object then null; end;
  end if;
  if to_regclass('public.akademik_paylasimlari') is not null then
    begin alter table public.akademik_paylasimlari add constraint akademik_paylasimlari_baslik_bos_degil check (char_length(btrim(baslik)) >= 1); exception when duplicate_object then null; end;
  end if;
  if to_regclass('public.site_duyurulari') is not null then
    begin alter table public.site_duyurulari add constraint site_duyurulari_baslik_metin_bos_degil check (char_length(btrim(baslik)) >= 1 and char_length(btrim(metin)) >= 1); exception when duplicate_object then null; end;
  end if;
  if to_regclass('public.conversations') is not null then
    begin alter table public.conversations add constraint conversations_konu_bos_degil check (char_length(btrim(konu)) >= 1); exception when duplicate_object then null; end;
  end if;
end $$;

-- Arşiv dosya/klasör adı: 200 sınırı kalkar; yol ayracı ve denetim karakteri yasağı AYNEN korunur (güvenlik: yol enjeksiyonu).
do $$
declare r record;
begin
  if to_regclass('public.r2_arsiv') is null then return; end if;
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.r2_arsiv'::regclass and c.contype = 'c'
           and pg_get_constraintdef(c.oid) ~ 'char_length\(ad\)' and pg_get_constraintdef(c.oid) ~ '200'
  loop execute format('alter table public.r2_arsiv drop constraint %I', r.conname); end loop;
  begin
    alter table public.r2_arsiv add constraint r2_arsiv_ad_gecerli check (char_length(ad) >= 1 and ad !~ '[/\\[:cntrl:]]' and ad not in ('.', '..'));
  exception when duplicate_object then null; end;
end $$;

-- Bağlantı RPC'leri: 120 sınırı olmadan yeniden tanımlanır (imzalar aynı).
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
  if p_bitis is not null and p_bitis <= now() + interval '30 seconds' then raise exception 'Bitiş zamanı gelecekte olmalı (ya da sınırsız seç).'; end if;
  v_slug := public._r2_slug_uret(v_ad);
  insert into public.r2_baglantilari (user_id, dosya_id, dosya_ad, slug, ad, aciklama, bitis)
  values (v_uid, d.id, d.ad, v_slug, v_ad, nullif(btrim(coalesce(p_aciklama, '')), ''), p_bitis) returning r2_baglantilari.id into v_id;
  return query select v_id, v_slug;
end $$;
revoke all on function public.r2_baglanti_olustur(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.r2_baglanti_olustur(uuid, text, text, timestamptz) to authenticated;

create or replace function public.r2_baglanti_guncelle(p_id uuid, p_ad text, p_aciklama text, p_bitis_degistir boolean, p_bitis timestamptz, p_iptal boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if p_bitis_degistir and p_bitis is not null and p_bitis <= now() then raise exception 'Bitiş zamanı gelecekte olmalı.'; end if;
  if char_length(btrim(coalesce(p_ad, ''))) < 1 then raise exception 'Ad boş olamaz.'; end if;
  update public.r2_baglantilari b set ad = btrim(p_ad), aciklama = nullif(btrim(coalesce(p_aciklama, '')), ''),
    bitis = case when p_bitis_degistir then p_bitis else b.bitis end, iptal = coalesce(p_iptal, b.iptal), updated_at = now()
  where b.id = p_id and (b.user_id = auth.uid() or public.is_owner());
  if not found then raise exception 'Bağlantı bulunamadı.'; end if;
end $$;
revoke all on function public.r2_baglanti_guncelle(uuid, text, text, boolean, timestamptz, boolean) from public, anon;
grant execute on function public.r2_baglanti_guncelle(uuid, text, text, boolean, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------- 4) Bağlantı listesi: sahip adı + Türkçe duyarsız arama
create or replace function public.r2_baglanti_listele(p_ara text default null)
returns table (id uuid, slug text, ad text, aciklama text, dosya_id uuid, dosya_ad text, bitis timestamptz, iptal boolean, durum text,
               indirme_sayisi bigint, son_indirme timestamptz, created_at timestamptz, sahip_ad text, benim boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_ara), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select b.id, b.slug, b.ad, b.aciklama, b.dosya_id, b.dosya_ad, b.bitis, b.iptal,
           (case when b.iptal then 'iptal' when b.dosya_id is null then 'dosya_yok' when b.bitis is not null and b.bitis <= now() then 'doldu' else 'aktif' end)::text,
           b.indirme_sayisi, b.son_indirme, b.created_at,
           (case when b.user_id = auth.uid() then null else coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)') end)::text, b.user_id = auth.uid()
    from public.r2_baglantilari b left join public.profiles p on p.id = b.user_id
    where (b.user_id = auth.uid() or public.is_owner())
      and (v_ara is null
           or public._ara_norm(b.ad) like v_kalip escape '\' or public._ara_norm(b.aciklama) like v_kalip escape '\'
           or public._ara_norm(b.dosya_ad) like v_kalip escape '\' or b.slug like v_kalip escape '\'
           or (public.is_owner() and public._ara_norm(p.full_name::text) like v_kalip escape '\'))
    order by b.created_at desc limit 500;
end $$;
revoke all on function public.r2_baglanti_listele(text) from public, anon;
grant execute on function public.r2_baglanti_listele(text) to authenticated;

-- ---------------------------------------------------------------------------- 3) Paylaşım bilgi sayfası (Worker /d/<slug>)
-- Sayaç ARTIRMAZ. Anahtar (r2_key) DÖNMEZ: bilgi sayfası yalnızca meta gösterir; indirme ayrı adımda r2_baglanti_coz ile yapılır.
create or replace function public.r2_baglanti_bilgi(p_slug text)
returns table (durum text, ad text, aciklama text, dosya_ad text, boyut bigint, mime text, bitis timestamptz, olusturma timestamptz,
               indirme_sayisi bigint, sahip_ad text)
language plpgsql stable security definer set search_path = public as $$
declare b public.r2_baglantilari; d public.r2_arsiv; v_durum text; v_sahip text;
begin
  select * into b from public.r2_baglantilari x where x.slug = lower(coalesce(p_slug, ''));
  if b.id is null then return query select 'yok'::text, null::text, null::text, null::text, null::bigint, null::text, null::timestamptz, null::timestamptz, null::bigint, null::text; return; end if;
  select * into d from public.r2_arsiv a where a.id = b.dosya_id and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli;
  v_durum := case when b.iptal then 'iptal' when b.bitis is not null and b.bitis <= now() then 'doldu' when d.id is null then 'dosya_yok' else 'gecerli' end;
  select nullif(btrim(p.full_name), '') into v_sahip from public.profiles p where p.id = b.user_id;
  -- süresi dolmuş/iptal bağlantıda dosya ayrıntısı verilmez (yalnızca ad); geçerliyse tam meta
  if v_durum = 'gecerli' then
    return query select v_durum, b.ad, b.aciklama, b.dosya_ad, d.boyut, d.mime, b.bitis, b.created_at, b.indirme_sayisi, v_sahip;
  else
    return query select v_durum, b.ad, null::text, null::text, null::bigint, null::text, b.bitis, b.created_at, null::bigint, null::text;
  end if;
end $$;
revoke all on function public.r2_baglanti_bilgi(text) from public, anon, authenticated;
grant execute on function public.r2_baglanti_bilgi(text) to service_role;

-- ============================================================================
-- BİTTİ. Sırada: r2-arsiv-worker'ı yeniden yayınla (bilgi sayfası), site dağıtımı.
-- ============================================================================
