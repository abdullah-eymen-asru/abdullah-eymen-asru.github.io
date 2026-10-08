-- ============================================================================
-- 0074_sistem_yedekleme_ve_depolama.sql
-- "Sistem Yedekleme & Depolama Yönetimi" modülünün veritabanı katmanı.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0021 (is_owner), 0056 (notlar), 0057 (r2_arsiv), 0072 (akademik_*), 0073.
--
-- NE EKLENİYOR
--   1) public.sistem_export_yetkileri  — can_export_system anahtarı (rol bazlı, VARSAYILAN KAPALI).
--        owner her zaman yetkilidir; admin / manager / editor için owner "Yetki Ayarları >
--        Sistem Yedekleme" sekmesinden açıp kapatır. (0048'deki ozellik_erisimleri tablosu
--        "varsayılan AÇIK, sadece kısabilir" mantığıyla çalıştığı için burada KULLANILMADI;
--        bu özellik varsayılan KAPALI olmak zorunda — kvkk anahtarıyla (0065) aynı yaklaşım.)
--   2) public.sistem_export_loglari    — denetim günlüğü (yalnızca owner okur/siler).
--   3) Dışa aktarma OTURUMU: sistem_export_baslat() önce günlüğe satır yazar (denetim önce),
--      veriyi okuyan tüm RPC'ler bu oturumun kimliğini ister. Günlüğü atlayıp doğrudan veri
--      okumak mümkün değildir. Oturum 6 saat geçerlidir ve yalnızca kendi sahibine aittir.
--   4) VERİ İZOLASYONU (veritabanında, istemciye güvenilmez):
--        kapsam 'kendi' → yalnızca çağıranın kendi satırları (owner dahil).
--        kapsam 'tum'   → yalnızca owner (felaket yedeği). Başka kimse 'tum' oturumu açamaz.
--   5) sistem_depolama_durumu() — DB boyutu + R2 kullanımı (kota kartları).
--
-- BİLEREN ANAHTARLARI: veritabani | r2 | icerik_md | notlar | github
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLOLAR
-- ----------------------------------------------------------------------------
create table if not exists public.sistem_export_yetkileri (
  rol               text primary key check (rol in ('admin', 'manager', 'editor')),
  can_export_system boolean not null default false,
  guncelleyen_id    uuid references public.profiles(id) on delete set null,
  updated_at        timestamptz not null default now()
);
comment on table public.sistem_export_yetkileri is
  'can_export_system anahtarı (rol bazlı). Satır yoksa = KAPALI. owner her zaman yetkilidir (satır gerekmez). İstemci erişimi yok; yalnızca SECURITY DEFINER RPC''ler.';

create table if not exists public.sistem_export_loglari (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references public.profiles(id) on delete set null,
  kullanici_eposta     text,
  indirilen_bilesenler jsonb not null default '[]'::jsonb check (jsonb_typeof(indirilen_bilesenler) = 'array'),
  kapsam               text not null default 'kendi' check (kapsam in ('kendi', 'tum')),
  hassas_dahil         boolean not null default false,
  dosya_boyutu         bigint check (dosya_boyutu is null or dosya_boyutu >= 0),
  ip_adresi            text,
  durum                text not null default 'basladi'
                       check (durum in ('basladi', 'tamamlandi', 'basarisiz', 'gunluk_temizlendi')),
  olusturma_tarihi     timestamptz not null default now()
);
create index if not exists sistem_export_loglari_tarih_idx on public.sistem_export_loglari (olusturma_tarihi desc);
comment on table public.sistem_export_loglari is
  'Her sistem dışa aktarma işleminin denetim kaydı. Yalnızca owner okur/siler (RPC). Kayıt, veri çıkmadan ÖNCE yazılır.';

alter table public.sistem_export_yetkileri enable row level security;
alter table public.sistem_export_loglari   enable row level security;
revoke all on public.sistem_export_yetkileri from public, anon, authenticated;
revoke all on public.sistem_export_loglari   from public, anon, authenticated;
-- (politika yok: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan)

-- ----------------------------------------------------------------------------
-- 2) YETKİ: can_export_system
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_yetkisi_var_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'owner'
        or (
          not coalesce(p.is_suspended, false)
          and exists (
            select 1 from public.sistem_export_yetkileri y
            where y.rol = p.role and y.can_export_system
          )
        )
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.sistem_export_yetkisi_var_mi() from public, anon;
grant execute on function public.sistem_export_yetkisi_var_mi() to authenticated;

create or replace function public.owner_sistem_export_yetkilerini_getir()
returns table (rol text, can_export_system boolean, updated_at timestamptz)
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
  select r.rol, coalesce(y.can_export_system, false), y.updated_at
  from (values ('admin'), ('manager'), ('editor')) as r(rol)
  left join public.sistem_export_yetkileri y on y.rol = r.rol
  order by case r.rol when 'admin' then 1 when 'manager' then 2 else 3 end;
end;
$$;
revoke all on function public.owner_sistem_export_yetkilerini_getir() from public, anon;
grant execute on function public.owner_sistem_export_yetkilerini_getir() to authenticated;

create or replace function public.owner_sistem_export_yetkisi_ayarla(p_rol text, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if p_rol not in ('admin', 'manager', 'editor') then
    raise exception 'Geçersiz rol: % (yalnızca admin, manager, editor).', p_rol;
  end if;
  insert into public.sistem_export_yetkileri as y (rol, can_export_system, guncelleyen_id)
  values (p_rol, coalesce(p_izinli, false), auth.uid())
  on conflict (rol) do update
    set can_export_system = excluded.can_export_system,
        guncelleyen_id    = excluded.guncelleyen_id,
        updated_at        = now();
end;
$$;
revoke all on function public.owner_sistem_export_yetkisi_ayarla(text, boolean) from public, anon;
grant execute on function public.owner_sistem_export_yetkisi_ayarla(text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) DIŞA AKTARMA OTURUMU (denetim kaydı önce)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_baslat(
  p_bilesenler jsonb,
  p_kapsam     text default 'kendi',
  p_hassas     boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_eposta text;
  v_owner boolean := public.is_owner();
  v_ip    text;
  v_bas   json;
  gecerli text[] := array['veritabani', 'r2', 'icerik_md', 'notlar', 'github'];
begin
  if not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: sistem dışa aktarma yetkin yok.';
  end if;
  if p_bilesenler is null or jsonb_typeof(p_bilesenler) <> 'array' or jsonb_array_length(p_bilesenler) = 0 then
    raise exception 'En az bir bileşen seçmelisin.';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_bilesenler) b where b <> all (gecerli)
  ) then
    raise exception 'Geçersiz bileşen.';
  end if;
  if p_kapsam not in ('kendi', 'tum') then
    raise exception 'Geçersiz kapsam.';
  end if;
  if p_kapsam = 'tum' and not v_owner then
    raise exception 'Yetkisiz işlem: tüm sistemi yedekleme yalnızca Site Sahibi içindir.';
  end if;
  if coalesce(p_hassas, false) and not (v_owner and p_kapsam = 'tum') then
    raise exception 'Yetkisiz işlem: hassas veri seçeneği yalnızca Site Sahibi''nin tam yedeğinde kullanılabilir.';
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
    (user_id, kullanici_eposta, indirilen_bilesenler, kapsam, hassas_dahil, ip_adresi)
  values
    (auth.uid(), v_eposta, p_bilesenler, p_kapsam, coalesce(p_hassas, false), left(v_ip, 64))
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.sistem_export_baslat(jsonb, text, boolean) from public, anon;
grant execute on function public.sistem_export_baslat(jsonb, text, boolean) to authenticated;

create or replace function public.sistem_export_tamamla(p_id uuid, p_boyut bigint, p_basarili boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sistem_export_loglari
  set dosya_boyutu = greatest(coalesce(p_boyut, 0), 0),
      durum        = case when coalesce(p_basarili, true) then 'tamamlandi' else 'basarisiz' end
  where id = p_id and user_id = auth.uid() and durum = 'basladi';
end;
$$;
revoke all on function public.sistem_export_tamamla(uuid, bigint, boolean) from public, anon;
grant execute on function public.sistem_export_tamamla(uuid, bigint, boolean) to authenticated;

-- İç yardımcı: geçerli oturumu getirir (6 saat, yalnızca sahibi, yetki hâlâ var mı?)
create or replace function public.sistem_export_oturum_al(p_id uuid)
returns public.sistem_export_loglari
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
begin
  if not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: sistem dışa aktarma yetkin yok.';
  end if;
  select * into l
  from public.sistem_export_loglari
  where id = p_id
    and user_id = auth.uid()
    and durum = 'basladi'
    and olusturma_tarihi > now() - interval '6 hours';
  if not found then
    raise exception 'Geçerli bir dışa aktarma oturumu yok (süresi dolmuş olabilir). İşlemi yeniden başlat.';
  end if;
  if l.kapsam = 'tum' and not public.is_owner() then
    raise exception 'Yetkisiz işlem.';
  end if;
  return l;
end;
$$;
revoke all on function public.sistem_export_oturum_al(uuid) from public, anon, authenticated;

-- Worker (GitHub zip) için: bu oturum bu bileşeni içeriyor mu?
create or replace function public.sistem_export_bilesen_izinli_mi(p_id uuid, p_bilesen text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
begin
  l := public.sistem_export_oturum_al(p_id);
  return l.indirilen_bilesenler ? p_bilesen;
end;
$$;
revoke all on function public.sistem_export_bilesen_izinli_mi(uuid, text) from public, anon;
grant execute on function public.sistem_export_bilesen_izinli_mi(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) TABLO KAYIT DEFTERİ + PLAN (hangi tablo, hangi kapsamla)
--    grup: 'veri' (veritabanı bileşeni) | 'notlar' (kişisel notlar & alıntılar)
--    HARİÇ TUTULANLAR (asla dışa aktarılmaz): auth.*, mfa_yedek_kodlar,
--    guvenlik_bildirim_ayarlari (webhook_secret içerir), _tek_seferlik_islemler,
--    admin_denetim*, sahip_onay_oylari, r2_islem_sayaci.
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

-- Oturumun planı: hangi tablo, hangi hedef klasör (veritabani|notlar), hangi kapsam, hangi koşul.
create or replace function public.sistem_export_plan(l public.sistem_export_loglari)
returns table (tablo text, hedef text, kapsam text, kosul text)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select coalesce(array(select jsonb_array_elements_text(l.indirilen_bilesenler)), '{}'::text[]) as dizi
  )
  select r.tablo,
         case when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar' else 'veritabani' end,
         case when l.kapsam = 'tum' and 'veritabani' = any (b.dizi) then 'tum' else 'kendi' end,
         case when l.kapsam = 'tum' and 'veritabani' = any (b.dizi) then 'true' else r.kendi_kosul end
  from public.sistem_export_tablo_kayitlari() r, b
  where to_regclass('public.' || r.tablo) is not null
    and (
      -- veritabanı bileşeni: 'veri' grubu her zaman; notlar grubu da (kendi ya da tum kapsamıyla)
      ('veritabani' = any (b.dizi) and (
          (r.grup = 'veri' and not r.sadece_owner)
          or r.grup = 'notlar'
          or (r.sadece_owner and l.kapsam = 'tum' and (not r.hassas or l.hassas_dahil))
      ))
      -- notlar bileşeni: yalnızca çağıranın kendi notları
      or ('notlar' = any (b.dizi) and r.grup = 'notlar')
    )
    and not (r.sadece_owner and l.kapsam <> 'tum');
$$;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;

create or replace function public.sistem_export_tablo_listesi(p_id uuid)
returns table (tablo text, hedef text, kapsam text, kolonlar jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
begin
  l := public.sistem_export_oturum_al(p_id);
  return query
  select p.tablo, p.hedef, p.kapsam,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'ad', a.attname::text,
                    'tip', format_type(a.atttypid, a.atttypmod),
                    'uretilmis', a.attgenerated <> ''
                  ) order by a.attnum), '[]'::jsonb)
          from pg_attribute a
          where a.attrelid = to_regclass('public.' || p.tablo) and a.attnum > 0 and not a.attisdropped)
  from public.sistem_export_plan(l) p
  order by p.hedef, p.tablo;
end;
$$;
revoke all on function public.sistem_export_tablo_listesi(uuid) from public, anon;
grant execute on function public.sistem_export_tablo_listesi(uuid) to authenticated;

-- Sayfalı okuma: tablo adı yalnızca planda varsa; koşul planı belirler (istemci koşul veremez).
create or replace function public.sistem_export_tablo_oku(p_id uuid, p_tablo text, p_ofset integer default 0, p_adet integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l  public.sistem_export_loglari;
  pl record;
  s  jsonb;
begin
  l := public.sistem_export_oturum_al(p_id);
  select * into pl from public.sistem_export_plan(l) p where p.tablo = p_tablo limit 1;
  if not found then
    raise exception 'Bu tablo bu dışa aktarma oturumunda yok.';
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where %s order by 1 limit %s offset %s) t',
    pl.tablo, pl.kosul,
    greatest(1, least(coalesce(p_adet, 200), 1000)),
    greatest(0, coalesce(p_ofset, 0))
  ) into s;
  return s;
end;
$$;
revoke all on function public.sistem_export_tablo_oku(uuid, text, integer, integer) from public, anon;
grant execute on function public.sistem_export_tablo_oku(uuid, text, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) R2 DOSYA LİSTESİ + TEKİL İZİN (Worker bu iki RPC'yi kullanıcının JWT'siyle çağırır)
--    kaynak: akademik | arsiv | notek
--    r2 bileşeni   → akademik + arsiv (kendi ya da tum)
--    notlar bileş. → notek (her zaman yalnızca kendi)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_r2_listesi(p_id uuid)
returns table (kaynak text, anahtar text, ad text, boyut bigint, sifreli boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
  tum boolean;
begin
  l := public.sistem_export_oturum_al(p_id);
  tum := (l.kapsam = 'tum');

  if l.indirilen_bilesenler ? 'r2' then
    return query
    select 'akademik'::text, k.pdf_r2_yolu,
           coalesce(nullif(k.pdf_dosya_adi, ''), k.id::text) || case when coalesce(k.pdf_dosya_adi, '') ~* '\.pdf$' then '' else '.pdf' end,
           coalesce(k.pdf_boyut_bayt, 0)::bigint, false
    from public.akademik_kaynaklar k
    where k.pdf_r2_yolu is not null and (tum or k.user_id = auth.uid());

    return query
    select 'arsiv'::text, a.r2_key,
           a.klasor_yolu || a.ad,
           coalesce(a.boyut, 0)::bigint, a.sifreli
    from public.r2_arsiv a
    where a.tur = 'dosya' and a.durum = 'hazir' and a.r2_key is not null
      and (tum or a.sahip_id = auth.uid());
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

create or replace function public.sistem_export_r2_izinli_mi(p_id uuid, p_kaynak text, p_anahtar text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
begin
  l := public.sistem_export_oturum_al(p_id);
  return exists (
    select 1 from public.sistem_export_r2_listesi(p_id) r
    where r.kaynak = p_kaynak and r.anahtar = p_anahtar
  );
end;
$$;
revoke all on function public.sistem_export_r2_izinli_mi(uuid, text, text) from public, anon;
grant execute on function public.sistem_export_r2_izinli_mi(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) DEPOLAMA DURUMU (kota kartları) — yalnızca toplamlar; kişi bazlı veri yok
-- ----------------------------------------------------------------------------
create or replace function public.sistem_depolama_durumu()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_db   bigint;
  v_arsiv  record;
  v_akad   record;
  v_notek  record;
  v_tablolar jsonb := '[]'::jsonb;
begin
  if not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: depolama durumunu görme yetkin yok.';
  end if;

  v_db := pg_database_size(current_database());

  select count(*)::bigint as adet, coalesce(sum(boyut), 0)::bigint as bayt into v_arsiv
  from public.r2_arsiv where tur = 'dosya' and durum = 'hazir';

  select count(*)::bigint as adet, coalesce(sum(pdf_boyut_bayt), 0)::bigint as bayt into v_akad
  from public.akademik_kaynaklar where pdf_r2_yolu is not null;

  select count(*)::bigint as adet, coalesce(sum(boyut_bayt), 0)::bigint as bayt into v_notek
  from public.not_ek_kayitlari;

  if public.is_owner() then
    select coalesce(jsonb_agg(jsonb_build_object('tablo', x.ad, 'bayt', x.bayt) order by x.bayt desc), '[]'::jsonb)
    into v_tablolar
    from (
      select c.relname::text as ad, pg_total_relation_size(c.oid)::bigint as bayt
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
      limit 8
    ) x;
  end if;

  return jsonb_build_object(
    'db_bayt',       v_db,
    'db_kota_bayt',  524288000,          -- Supabase ücretsiz plan: 500 MB
    'r2_kota_bayt',  10737418240,        -- Cloudflare R2 ücretsiz katman: 10 GB
    'r2', jsonb_build_object(
      'arsiv',    jsonb_build_object('adet', v_arsiv.adet, 'bayt', v_arsiv.bayt),
      'akademik', jsonb_build_object('adet', v_akad.adet,  'bayt', v_akad.bayt),
      'notek',    jsonb_build_object('adet', v_notek.adet, 'bayt', v_notek.bayt)
    ),
    'en_buyuk_tablolar', v_tablolar,
    'owner', public.is_owner()
  );
end;
$$;
revoke all on function public.sistem_depolama_durumu() from public, anon;
grant execute on function public.sistem_depolama_durumu() to authenticated;

-- ----------------------------------------------------------------------------
-- 7) OWNER: DENETİM GÜNLÜĞÜ
-- ----------------------------------------------------------------------------
create or replace function public.owner_sistem_export_loglari(p_limit integer default 50, p_ofset integer default 0)
returns table (
  id uuid, user_id uuid, kullanici_eposta text, indirilen_bilesenler jsonb, kapsam text,
  dosya_boyutu bigint, ip_adresi text, durum text, olusturma_tarihi timestamptz, toplam bigint
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
         count(*) over ()
  from public.sistem_export_loglari k
  order by k.olusturma_tarihi desc
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;
revoke all on function public.owner_sistem_export_loglari(integer, integer) from public, anon;
grant execute on function public.owner_sistem_export_loglari(integer, integer) to authenticated;

create or replace function public.owner_sistem_export_logu_sil(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  delete from public.sistem_export_loglari where id = p_id;
end;
$$;
revoke all on function public.owner_sistem_export_logu_sil(uuid) from public, anon;
grant execute on function public.owner_sistem_export_logu_sil(uuid) to authenticated;

-- Toplu temizlik: geriye TEK bir "günlük temizlendi" satırı bırakır (kim, ne zaman, kaç kayıt) — iz kaybolmasın.
create or replace function public.owner_sistem_export_logunu_temizle()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adet integer;
  v_eposta text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  select p.email into v_eposta from public.profiles p where p.id = auth.uid();
  -- WHERE'siz DELETE, Supabase'in pg-safeupdate eklentisince SECURITY DEFINER içinde bile reddedilir (bkz. 0073).
  delete from public.sistem_export_loglari where id in (select k.id from public.sistem_export_loglari k);
  get diagnostics v_adet = row_count;
  insert into public.sistem_export_loglari (user_id, kullanici_eposta, indirilen_bilesenler, durum)
  values (auth.uid(), v_eposta, jsonb_build_array('gunluk_temizlendi', v_adet::text || ' kayıt silindi'), 'gunluk_temizlendi');
  return v_adet;
end;
$$;
revoke all on function public.owner_sistem_export_logunu_temizle() from public, anon;
grant execute on function public.owner_sistem_export_logunu_temizle() to authenticated;
