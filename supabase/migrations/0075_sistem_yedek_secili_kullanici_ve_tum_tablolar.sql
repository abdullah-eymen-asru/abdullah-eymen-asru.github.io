-- ============================================================================
-- 0075_sistem_yedek_secili_kullanici_ve_tum_tablolar.sql
-- Gereksinim: 0074 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase SQL Editor'de TEK SEFERDE çalıştır.
--
-- NE DEĞİŞİYOR
--   1) Dışa aktarma kapsamı artık ZORUNLU ikili seçim değil, birleştirilebilir bir tercih:
--        'kendi'  → yalnızca çağıranın kendi verileri (varsayılan; herkes)
--        'secili' → owner'ın arama panelinden seçtiği üyeler (+ istenirse kendisi)   [YENİ]
--        'tum'    → tüm sistem / felaket yedeği (yalnızca owner)
--      Seçili üyelerin id listesi, denetim günlüğüne (sistem_export_loglari.hedef_kullanicilar) veri
--      çıkmadan ÖNCE yazılır; veri okuyan tüm RPC'ler listeyi buradan okur (istemci koşul/kimlik veremez).
--      Kişisel Notlar bileşeni her zaman yalnızca çağıranın kendi notlarıdır (E2EE + mahremiyet).
--   2) sistem_export_kullanici_ara(q)   — owner için üye arama (ad / rol; e-posta yalnız owner'a döner).
--   3) sistem_depolama_tablolari()      — owner için TÜM tabloların boyutu (şema, veri, indeks, TOAST,
--                                         satır tahmini, RLS) + Storage kova toplamları.
--   4) owner_sistem_export_loglari()    — günlükte "kimlerin verisi" adları da görünür.
--   5) Tablo kaydına onay_gecmisi (0076) eklendi (tablo yoksa plan onu atlar).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLON + KAPSAM KISITI
-- ----------------------------------------------------------------------------
alter table public.sistem_export_loglari
  add column if not exists hedef_kullanicilar uuid[] not null default '{}'::uuid[];

comment on column public.sistem_export_loglari.hedef_kullanicilar is
  'kapsam = ''secili'' iken verisi dışa aktarılan üyelerin id listesi. Oturum açılırken yazılır; sonradan değişmez.';

alter table public.sistem_export_loglari drop constraint if exists sistem_export_loglari_kapsam_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sistem_export_loglari'::regclass and conname = 'sistem_export_loglari_kapsam_chk'
  ) then
    alter table public.sistem_export_loglari
      add constraint sistem_export_loglari_kapsam_chk check (kapsam in ('kendi', 'secili', 'tum'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) OTURUM AÇMA (imza değişti: eski 3 parametreli sürüm düşürülür, aksi halde PostgREST iki
--    aday arasında seçim yapamaz — PGRST203)
-- ----------------------------------------------------------------------------
drop function if exists public.sistem_export_baslat(jsonb, text, boolean);

create or replace function public.sistem_export_baslat(
  p_bilesenler jsonb,
  p_kapsam     text default 'kendi',
  p_hassas     boolean default false,
  p_hedefler   uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_eposta text;
  v_owner  boolean := public.is_owner();
  v_ip     text;
  v_bas    json;
  v_hedef  uuid[] := '{}'::uuid[];
  gecerli  text[] := array['veritabani', 'r2', 'icerik_md', 'notlar', 'github'];
begin
  if not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: sistem dışa aktarma yetkin yok.';
  end if;
  if p_bilesenler is null or jsonb_typeof(p_bilesenler) <> 'array' or jsonb_array_length(p_bilesenler) = 0 then
    raise exception 'En az bir bileşen seçmelisin.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_bilesenler) b where b <> all (gecerli)) then
    raise exception 'Geçersiz bileşen.';
  end if;
  if p_kapsam not in ('kendi', 'secili', 'tum') then
    raise exception 'Geçersiz kapsam.';
  end if;
  if p_kapsam = 'tum' and not v_owner then
    raise exception 'Yetkisiz işlem: tüm sistemi yedekleme yalnızca Site Sahibi içindir.';
  end if;
  if coalesce(p_hassas, false) and not (v_owner and p_kapsam = 'tum') then
    raise exception 'Yetkisiz işlem: hassas veri seçeneği yalnızca Site Sahibi''nin tam yedeğinde kullanılabilir.';
  end if;

  if p_kapsam = 'secili' then
    if not v_owner then
      raise exception 'Yetkisiz işlem: başka üyelerin verisini yalnızca Site Sahibi seçebilir.';
    end if;
    -- Yalnızca gerçekten var olan üyeler; tekrarlar elenir.
    select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into v_hedef
    from public.profiles p
    where p.id = any (coalesce(p_hedefler, '{}'::uuid[]));
    if cardinality(v_hedef) = 0 then
      raise exception 'En az bir geçerli üye seçmelisin.';
    end if;
    if cardinality(v_hedef) > 100 then
      raise exception 'Tek seferde en fazla 100 üye seçilebilir.';
    end if;
    if p_bilesenler ? 'notlar' and not (auth.uid() = any (v_hedef)) then
      raise exception 'Kişisel Notlar bileşeni yalnızca kendi verilerini içerir: listeye kendini de ekle ya da bu bileşeni kaldır.';
    end if;
  end if;

  -- İstemci IP'si: Supabase Cloudflare arkasındadır; cf-connecting-ip istemci tarafından sahtelenemez.
  begin
    v_bas := current_setting('request.headers', true)::json;
    v_ip  := nullif(btrim(split_part(coalesce(v_bas ->> 'cf-connecting-ip', v_bas ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  select p.email into v_eposta from public.profiles p where p.id = auth.uid();

  insert into public.sistem_export_loglari
    (user_id, kullanici_eposta, indirilen_bilesenler, kapsam, hassas_dahil, ip_adresi, hedef_kullanicilar)
  values
    (auth.uid(), v_eposta, p_bilesenler, p_kapsam, coalesce(p_hassas, false), left(v_ip, 64), v_hedef)
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) from public, anon;
grant execute on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) TABLO KAYIT DEFTERİ (0074'tekiyle aynı + onay_gecmisi)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_tablo_kayitlari()
returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
language sql
immutable
as $$
  select * from (values
    ('profiles',                    'veri',   'id = auth.uid()',           false, false),
    ('taslak_icerikler',            'veri',   'created_by = auth.uid()',   false, false),
    ('special_content',             'veri',   'author_id = auth.uid()',    false, false),
    ('r2_arsiv',                    'veri',   'sahip_id = auth.uid()',     false, false),
    ('e2ee_kullanici_anahtarlari',  'veri',   'kullanici_id = auth.uid()', false, false),
    ('indirme_loglari',             'veri',   'user_id = auth.uid()',      false, false),
    ('onay_gecmisi',                'veri',   'user_id = auth.uid()',      false, false),
    ('notlar',                      'notlar', 'user_id = auth.uid()',      false, false),
    ('not_kasasi',                  'notlar', 'user_id = auth.uid()',      false, false),
    ('not_ek_kayitlari',            'notlar', 'user_id = auth.uid()',      false, false),
    ('akademik_kaynaklar',          'notlar', 'user_id = auth.uid()',      false, false),
    ('akademik_notlar',             'notlar', 'user_id = auth.uid()',      false, false),
    ('content_access',              'veri',   'false',                     true,  false),
    ('site_settings',               'veri',   'false',                     true,  false),
    ('site_ayarlari',               'veri',   'false',                     true,  false),
    ('site_ayarlari_loglari',       'veri',   'false',                     true,  false),
    ('site_onizleme_izinleri',      'veri',   'false',                     true,  false),
    ('ozellik_erisimleri',          'veri',   'false',                     true,  false),
    ('ozellik_kullanici_kisitlari', 'veri',   'false',                     true,  false),
    ('ozellik_kullanici_izinleri',  'veri',   'false',                     true,  false),
    ('r2_arsiv_izinleri',           'veri',   'false',                     true,  false),
    ('ozel_icerik_anahtarlar',      'veri',   'false',                     true,  false),
    ('denetim_kayitlari',           'veri',   'false',                     true,  false),
    ('uye_aktarim_yetkileri',       'veri',   'false',                     true,  false),
    ('sistem_export_yetkileri',     'veri',   'false',                     true,  false),
    ('akademik_okuyucu_ayarlari',   'veri',   'false',                     true,  false),
    ('conversations',               'veri',   'false',                     true,  true),
    ('messages',                    'veri',   'false',                     true,  true)
  ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas);
$$;
revoke all on function public.sistem_export_tablo_kayitlari() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) PLAN: hangi tablo, hangi kapsam, hangi koşul
--    'kendi'  : "<kolon> = auth.uid()"
--    'secili' : "<kolon> = any ('{id,id}'::uuid[])"  (yalnızca 'veri' grubu; 'notlar' grubu her zaman kendi)
--    'tum'    : "true"
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_plan(l public.sistem_export_loglari)
returns table (tablo text, hedef text, kapsam text, kosul text)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select coalesce(array(select jsonb_array_elements_text(l.indirilen_bilesenler)), '{}'::text[]) as dizi
  ),
  h as (
    select '= any (' || quote_literal(l.hedef_kullanicilar::text) || '::uuid[])' as ifade
  )
  select r.tablo,
         case when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar' else 'veritabani' end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'tum'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri' then 'secili'
           else 'kendi'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'true'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           else r.kendi_kosul
         end
  from public.sistem_export_tablo_kayitlari() r, b, h
  where to_regclass('public.' || r.tablo) is not null
    and (
      ('veritabani' = any (b.dizi) and (
          (r.grup = 'veri' and not r.sadece_owner)
          or r.grup = 'notlar'
          or (r.sadece_owner and l.kapsam = 'tum' and (not r.hassas or l.hassas_dahil))
      ))
      or ('notlar' = any (b.dizi) and r.grup = 'notlar')
    )
    and not (r.sadece_owner and l.kapsam <> 'tum');
$$;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) R2 DOSYA LİSTESİ (seçili üyelerin dosyaları da kapsama girer)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_r2_listesi(p_id uuid)
returns table (kaynak text, anahtar text, ad text, boyut bigint, sifreli boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l        public.sistem_export_loglari;
  tum      boolean;
  hedefler uuid[];
begin
  l := public.sistem_export_oturum_al(p_id);
  tum := (l.kapsam = 'tum');
  hedefler := case when l.kapsam = 'secili' then l.hedef_kullanicilar else array[auth.uid()] end;

  if l.indirilen_bilesenler ? 'r2' then
    return query
    select 'akademik'::text, k.pdf_r2_yolu,
           coalesce(nullif(k.pdf_dosya_adi, ''), k.id::text) || case when coalesce(k.pdf_dosya_adi, '') ~* '\.pdf$' then '' else '.pdf' end,
           coalesce(k.pdf_boyut_bayt, 0)::bigint, false
    from public.akademik_kaynaklar k
    where k.pdf_r2_yolu is not null and (tum or k.user_id = any (hedefler));

    return query
    select 'arsiv'::text, a.r2_key,
           a.klasor_yolu || a.ad,
           coalesce(a.boyut, 0)::bigint, a.sifreli
    from public.r2_arsiv a
    where a.tur = 'dosya' and a.durum = 'hazir' and a.r2_key is not null
      and (tum or a.sahip_id = any (hedefler));
  end if;

  if l.indirilen_bilesenler ? 'notlar' then
    return query
    select 'notek'::text, e.r2_key, e.id::text || '.bin', e.boyut_bayt::bigint, true
    from public.not_ek_kayitlari e
    where e.user_id = auth.uid();
  end if;
end;
$$;
revoke all on function public.sistem_export_r2_listesi(uuid) from public, anon;
grant execute on function public.sistem_export_r2_listesi(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) ÜYE ARAMA (yalnızca owner) — dışa aktarma panelindeki seçici için
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_kullanici_ara(p_q text default '', p_limit integer default 20)
returns table (id uuid, ad text, rol text, eposta text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye'),
         p.role::text,
         p.email::text
  from public.profiles p
  where v_q = ''
     or p.full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
     or p.email     ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
  order by p.full_name nulls last, p.email
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;
revoke all on function public.sistem_export_kullanici_ara(text, integer) from public, anon;
grant execute on function public.sistem_export_kullanici_ara(text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) TÜM TABLOLARIN BOYUTU (yalnızca owner)
--    pg_total_relation_size = tablo + indeksler + TOAST. Şema başına tek satır; sistem şemaları hariç.
-- ----------------------------------------------------------------------------
create or replace function public.sistem_depolama_tablolari()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_db       bigint := pg_database_size(current_database());
  v_tablolar jsonb;
  v_kovalar  jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sema',   x.sema,
           'tablo',  x.tablo,
           'toplam', x.toplam,
           'veri',   x.veri,
           'indeks', x.indeks,
           'satir',  x.satir,
           'rls',    x.rls
         ) order by x.toplam desc, x.tablo), '[]'::jsonb)
  into v_tablolar
  from (
    select n.nspname::text as sema,
           c.relname::text as tablo,
           pg_total_relation_size(c.oid)::bigint as toplam,
           pg_relation_size(c.oid)::bigint as veri,
           pg_indexes_size(c.oid)::bigint as indeks,
           greatest(c.reltuples, 0)::bigint as satir,
           c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'm')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\_toast%'
      and n.nspname not like 'pg\_temp%'
    order by pg_total_relation_size(c.oid) desc
    limit 600
  ) x;

  begin
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('kova', k.bucket_id, 'adet', k.adet, 'bayt', k.bayt) order by k.bayt desc), '[]'::jsonb)
      from (
        select o.bucket_id::text as bucket_id, count(*)::bigint as adet,
               coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0)::bigint as bayt
        from storage.objects o group by o.bucket_id
      ) k
    $q$ into v_kovalar;
  exception when others then
    v_kovalar := '[]'::jsonb;
  end;

  return jsonb_build_object('db_bayt', v_db, 'tablolar', v_tablolar, 'storage_kovalari', v_kovalar);
end;
$$;
revoke all on function public.sistem_depolama_tablolari() from public, anon;
grant execute on function public.sistem_depolama_tablolari() to authenticated;

-- ----------------------------------------------------------------------------
-- 8) OWNER GÜNLÜĞÜ: seçili üyelerin adları (dönüş tipi değiştiği için önce düşür)
-- ----------------------------------------------------------------------------
drop function if exists public.owner_sistem_export_loglari(integer, integer);

create or replace function public.owner_sistem_export_loglari(p_limit integer default 50, p_ofset integer default 0)
returns table (
  id uuid, user_id uuid, kullanici_eposta text, indirilen_bilesenler jsonb, kapsam text,
  dosya_boyutu bigint, ip_adresi text, durum text, olusturma_tarihi timestamptz, toplam bigint,
  hedef_adlari text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select k.id, k.user_id, k.kullanici_eposta, k.indirilen_bilesenler, k.kapsam,
         k.dosya_boyutu, k.ip_adresi, k.durum, k.olusturma_tarihi,
         count(*) over (),
         case when cardinality(k.hedef_kullanicilar) = 0 then null else (
           select string_agg(coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye'), ', ' order by p.full_name)
           from public.profiles p where p.id = any (k.hedef_kullanicilar)
         ) end
  from public.sistem_export_loglari k
  order by k.olusturma_tarihi desc
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;
revoke all on function public.owner_sistem_export_loglari(integer, integer) from public, anon;
grant execute on function public.owner_sistem_export_loglari(integer, integer) to authenticated;
