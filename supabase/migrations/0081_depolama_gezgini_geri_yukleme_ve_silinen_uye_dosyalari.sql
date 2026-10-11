-- ============================================================================
-- 0081_depolama_gezgini_geri_yukleme_ve_silinen_uye_dosyalari.sql
-- Gereksinim: 0074, 0075, 0078 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase SQL Editor'de TEK SEFERDE çalıştır.
--
-- NE EKLENİYOR
--   1) sistem_korumali_tablo_mu()         — SİLİNEMEZ tabloların SERT KODLU listesi (RPC seviyesi koruma).
--   2) sistem_depolama_gezgini()          — owner: tablo bazında GERÇEK satır sayısı + boyut + kilit nedeni +
--                                           zincirleme (ON DELETE CASCADE) etkilenen tablolar.
--   3) sistem_tablo_temizle()             — owner: seçili tabloların satırlarını siler. Korumalı tablo ya da
--                                           korumalı tabloyu zincirleme silecek tablo → HATA. Metin onayı "SİL".
--   4) sistem_geri_yukleme_tablolari()    — owner: içe aktarma için tablo/kolon/PK şeması (otomatik tespit).
--      sistem_geri_yukle_tablo()          — owner: JSON satırlarını yazar (eksikleri tamamla | üzerine yaz).
--                                           Korumalı tablolarda ÜZERİNE YAZMA YOK (yalnızca eksikler).
--   5) sistem_islem_baslat / _bitir       — silme ve geri yükleme için denetim günlüğü (işlemden ÖNCE yazılır).
--   6) R2 yetim/temizlik: sistem_r2_kayit_durumu(), sistem_r2_silme_hazirla(), sistem_r2_kuyruk_tamamla(),
--      sistem_r2_kuyruk_listesi() + r2_silme_kuyrugu (outbox). DB indeks satırı ve kuyruk kaydı TEK
--      işlemde (atomik) yazılır; R2 silme başarısız olursa kuyrukta kalır, tekrar denenebilir → tutarsızlık
--      ("DB'de kayıt yok ama dosya duruyor") kalıcı olmaz.
--   7) hesap_silme_dosya_listesi() / hesap_silme_dosya_izinli_mi() — silinen üyenin R2 dosyalarını owner'ın
--      listeleyip önizleyip indirebilmesi için (Worker bu RPC'lerle yetkiyi doğrular).
--
-- GÜVENLİK İLKESİ: tüm fonksiyonlar SECURITY DEFINER + is_owner(); istemciye tablo erişimi YOK (RLS açık, politika yok).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) TABLOLAR
-- ----------------------------------------------------------------------------
create table if not exists public.sistem_islem_loglari (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  eposta      text,
  tur         text not null check (tur in ('tablo_temizle', 'r2_temizle', 'geri_yukleme', 'silinen_uye_dosya_indirme', 'r2_kuyruk_isle')),
  ayrinti     jsonb not null default '{}'::jsonb,
  durum       text not null default 'basladi' check (durum in ('basladi', 'tamamlandi', 'basarisiz')),
  olusturma   timestamptz not null default now(),
  bitis       timestamptz
);
create index if not exists sistem_islem_loglari_tarih_idx on public.sistem_islem_loglari (olusturma desc);
alter table public.sistem_islem_loglari enable row level security;
revoke all on public.sistem_islem_loglari from public, anon, authenticated;

create table if not exists public.r2_silme_kuyrugu (
  id        uuid primary key default gen_random_uuid(),
  kaynak    text not null check (kaynak in ('arsiv', 'notek', 'akademik')),
  anahtar   text not null check (length(anahtar) between 1 and 600 and anahtar !~ '\.\.'),
  deneme    integer not null default 0,
  son_hata  text,
  olusturma timestamptz not null default now(),
  unique (kaynak, anahtar)
);
alter table public.r2_silme_kuyrugu enable row level security;
revoke all on public.r2_silme_kuyrugu from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1) SERT KODLU KORUMA LİSTESİ
--    public dışındaki HER şema (auth, storage, realtime, vault, extensions, supabase_migrations, cron, net …) korumalıdır.
--    public içinde, sitenin çalışması / güvenlik / yasal kanıt için zorunlu tablolar aşağıdadır.
--    Listeyi genişletmek için bu fonksiyonu yeniden oluştur; istemciden değiştirilemez.
-- ----------------------------------------------------------------------------
create or replace function public.sistem_korumali_tablo_mu(p_sema text, p_tablo text)
returns boolean
language sql
immutable
as $$
  select p_sema is distinct from 'public'
      or p_tablo = any (array[
        -- kimlik, roller ve yetkiler
        'profiles', 'roller', 'izinler',
        'ozellik_erisimleri', 'ozellik_kullanici_kisitlari', 'ozellik_kullanici_izinleri', 'ozellik_varsayilan_kapali',
        'sistem_export_yetkileri', 'uye_aktarim_yetkileri', 'site_onizleme_izinleri',
        -- site ayarları ve erişim kalkanı
        'site_ayarlari', 'site_settings',
        -- uçtan uca şifreleme anahtarları (silinirse tüm şifreli veri KALICI olarak açılamaz)
        'e2ee_kullanici_anahtarlari', 'not_kasasi', 'ozel_icerik_anahtarlar',
        -- güvenlik, denetim ve yasal kanıt
        'mfa_yedek_kodlar', 'guvenlik_bildirim_ayarlari', 'admin_denetim', 'admin_denetim_log', 'admin_denetim_oylari',
        'sahip_onay_oylari', '_tek_seferlik_islemler', 'denetim_kayitlari', 'onay_gecmisi',
        'sistem_islem_loglari', 'hesap_silme_talepleri', 'r2_silme_kuyrugu',
        -- migration kayıtları
        'schema_migrations'
      ]);
$$;
grant execute on function public.sistem_korumali_tablo_mu(text, text) to authenticated;

-- Bir tablo silinirse ON DELETE CASCADE ile (dolaylı) satırı gidecek TÜM tablolar (en çok 8 düzey).
create or replace function public._sy_cascade_tablolari(p_tablo text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive kok as (select to_regclass(format('public.%I', p_tablo)) as oid),
  z as (
    select c.conrelid as rel, 1 as d
    from pg_constraint c, kok
    where c.contype = 'f' and c.confdeltype = 'c' and c.confrelid = kok.oid and c.conrelid <> kok.oid
    union
    select c.conrelid, z.d + 1
    from pg_constraint c join z on c.confrelid = z.rel, kok
    where c.contype = 'f' and c.confdeltype = 'c' and z.d < 8 and c.conrelid <> kok.oid
  )
  select coalesce(array_agg(distinct n.nspname || '.' || r.relname order by n.nspname || '.' || r.relname), '{}'::text[])
  from z join pg_class r on r.oid = z.rel join pg_namespace n on n.oid = r.relnamespace;
$$;
revoke all on function public._sy_cascade_tablolari(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) DEPOLAMA GEZGİNİ (owner)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_depolama_gezgini()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sonuc  jsonb := '[]'::jsonb;
  r        record;
  v_say    bigint;
  v_tam    boolean;
  v_cas    text[];
  v_kilit  text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;

  for r in
    select n.nspname::text as sema, c.relname::text as tablo,
           pg_total_relation_size(c.oid)::bigint as toplam,
           pg_relation_size(c.oid)::bigint as veri,
           pg_indexes_size(c.oid)::bigint as indeks,
           greatest(c.reltuples, 0)::bigint as tahmin,
           c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and not c.relispartition
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg\_toast%'
      and n.nspname not like 'pg\_temp%'
    order by pg_total_relation_size(c.oid) desc, c.relname
    limit 600
  loop
    v_kilit := null;
    v_cas := '{}'::text[];
    v_say := r.tahmin;
    v_tam := false;

    if r.sema = 'public' then
      execute format('select count(*) from public.%I', r.tablo) into v_say;
      v_tam := true;
      v_cas := public._sy_cascade_tablolari(r.tablo);
      if public.sistem_korumali_tablo_mu('public', r.tablo) then
        v_kilit := 'korumali_tablo';
      elsif exists (
        select 1 from unnest(v_cas) x
        where public.sistem_korumali_tablo_mu(split_part(x, '.', 1), split_part(x, '.', 2))
      ) then
        v_kilit := 'zincir';
      end if;
    else
      v_kilit := 'sistem_semasi';
    end if;

    v_sonuc := v_sonuc || jsonb_build_object(
      'sema', r.sema, 'tablo', r.tablo, 'toplam', r.toplam, 'veri', r.veri, 'indeks', r.indeks,
      'satir', v_say, 'satir_kesin', v_tam, 'rls', r.rls,
      'kilit', v_kilit, 'silinebilir', v_kilit is null, 'cascade', to_jsonb(v_cas)
    );
  end loop;

  return v_sonuc;
end;
$$;
revoke all on function public.sistem_depolama_gezgini() from public, anon;
grant execute on function public.sistem_depolama_gezgini() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) DENETİM GÜNLÜĞÜ (işlem ÖNCE yazılır)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_islem_baslat(p_tur text, p_ayrinti jsonb default '{}'::jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  insert into public.sistem_islem_loglari (user_id, eposta, tur, ayrinti)
  values (auth.uid(), (select p.email from public.profiles p where p.id = auth.uid()), p_tur,
          coalesce(p_ayrinti, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sistem_islem_baslat(text, jsonb) from public, anon;
grant execute on function public.sistem_islem_baslat(text, jsonb) to authenticated;

create or replace function public.sistem_islem_bitir(p_id uuid, p_basarili boolean, p_ozet jsonb default '{}'::jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  update public.sistem_islem_loglari
     set durum = case when p_basarili then 'tamamlandi' else 'basarisiz' end,
         bitis = now(),
         ayrinti = ayrinti || jsonb_build_object('sonuc', coalesce(p_ozet, '{}'::jsonb))
   where id = p_id and user_id = auth.uid();
end;
$$;
revoke all on function public.sistem_islem_bitir(uuid, boolean, jsonb) from public, anon;
grant execute on function public.sistem_islem_bitir(uuid, boolean, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) SEÇİLİ TABLOLARI TEMİZLE (owner, korumalı tablo → HATA, metin onayı)
--    Önce HEPSİ doğrulanır, sonra silinir; tek işlem → biri hata verirse HİÇBİRİ silinmez.
-- ----------------------------------------------------------------------------
create or replace function public.sistem_tablo_temizle(p_tablolar text[], p_onay text, p_islem uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t        text;
  v_t      text;
  v_ad     text[] := '{}'::text[];
  v_cas    text[];
  v_sil    bigint;
  v_toplam bigint := 0;
  v_sonuc  jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if p_onay is distinct from 'SİL' and p_onay is distinct from 'SIL' then
    raise exception 'Onay metni yanlış: silmek için SİL yazılmalı.';
  end if;
  if p_tablolar is null or cardinality(p_tablolar) = 0 then
    raise exception 'Silinecek tablo seçilmedi.';
  end if;
  if cardinality(p_tablolar) > 50 then
    raise exception 'Tek seferde en çok 50 tablo.';
  end if;

  -- 1. tur: doğrulama
  foreach t in array p_tablolar loop
    v_t := regexp_replace(coalesce(t, ''), '^public\.', '');
    if v_t = '' or v_t ~ '\.' then
      raise exception 'Geçersiz tablo adı: %. Yalnızca public şemasındaki tablolar silinebilir.', v_t;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_t and c.relkind = 'r' and not c.relispartition
    ) then
      raise exception 'Tablo bulunamadı: %.', v_t;
    end if;
    if public.sistem_korumali_tablo_mu('public', v_t) then
      raise exception 'KORUMALI TABLO: % sitenin çalışması için zorunludur ve silinemez.', v_t;
    end if;
    v_cas := public._sy_cascade_tablolari(v_t);
    if exists (
      select 1 from unnest(v_cas) x
      where public.sistem_korumali_tablo_mu(split_part(x, '.', 1), split_part(x, '.', 2))
    ) then
      raise exception '% silinirse zincirleme (CASCADE) olarak korumalı bir tablonun satırları da silinirdi; işlem engellendi.', v_t;
    end if;
    v_ad := v_ad || v_t;
  end loop;

  -- 2. tur: silme (tek işlem)
  foreach t in array v_ad loop
    execute format('delete from public.%I', t);
    get diagnostics v_sil = row_count;
    v_toplam := v_toplam + v_sil;
    v_sonuc := v_sonuc || jsonb_build_object('tablo', t, 'silinen', v_sil);
  end loop;

  if p_islem is not null then
    perform public.sistem_islem_bitir(p_islem, true, jsonb_build_object('toplam', v_toplam, 'tablolar', v_sonuc));
  end if;
  return jsonb_build_object('toplam', v_toplam, 'tablolar', v_sonuc);
end;
$$;
revoke all on function public.sistem_tablo_temizle(text[], text, uuid) from public, anon;
grant execute on function public.sistem_tablo_temizle(text[], text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) İÇE AKTARMA (GERİ YÜKLEME)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_geri_yukleme_tablolari()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tablo', c.relname,
      'korumali', public.sistem_korumali_tablo_mu('public', c.relname),
      'kolonlar', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
                   from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''),
      'pk', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
             from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
             where i.indrelid = c.oid and i.indisprimary)
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relispartition
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.sistem_geri_yukleme_tablolari() from public, anon;
grant execute on function public.sistem_geri_yukleme_tablolari() to authenticated;

-- p_mod: 'eksikleri' (çakışanı atla: ON CONFLICT DO NOTHING) | 'uzerine' (birincil anahtar çakışırsa güncelle).
-- Korumalı tablolarda 'uzerine' İSTENSE BİLE 'eksikleri' uygulanır (rol/yetki/anahtar ezilemez).
-- Her satır kendi alt işleminde (SAVEPOINT) yazılır: bozuk bir satır (ör. auth.users'ta karşılığı olmayan profil)
-- tüm sayfayı düşürmez; hata sayılır ve ilk birkaç mesaj döner. Sayfa başına en çok 500 satır.
create or replace function public.sistem_geri_yukle_tablo(p_tablo text, p_satirlar jsonb, p_mod text default 'eksikleri')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_oid      regclass;
  v_mod      text := coalesce(p_mod, 'eksikleri');
  v_kolon    text;
  v_pk       text;
  v_guncelle text;
  v_sql      text;
  v_satir    jsonb;
  v_yeni     boolean;
  v_ekle     bigint := 0;
  v_guncel   bigint := 0;
  v_atla     bigint := 0;
  v_hata     bigint := 0;
  v_hatalar  jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if v_mod not in ('eksikleri', 'uzerine') then
    raise exception 'Geçersiz mod: %.', v_mod;
  end if;
  if p_satirlar is null or jsonb_typeof(p_satirlar) <> 'array' then
    raise exception 'Satırlar bir JSON dizisi olmalı.';
  end if;
  if jsonb_array_length(p_satirlar) > 500 then
    raise exception 'Sayfa başına en çok 500 satır.';
  end if;
  if p_tablo is null or p_tablo !~ '^[a-z_][a-z0-9_]*$' then
    raise exception 'Geçersiz tablo adı.';
  end if;
  v_oid := to_regclass(format('public.%I', p_tablo));
  if v_oid is null or not exists (select 1 from pg_class c where c.oid = v_oid and c.relkind = 'r' and not c.relispartition) then
    raise exception 'Tablo bulunamadı: %.', p_tablo;
  end if;
  if public.sistem_korumali_tablo_mu('public', p_tablo) then
    v_mod := 'eksikleri';
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_kolon
  from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_pk
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = v_oid and i.indisprimary;

  select string_agg(format('%1$s = excluded.%1$s', quote_ident(a.attname)), ', ' order by a.attnum) into v_guncelle
  from pg_attribute a
  where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    and not exists (select 1 from pg_index i where i.indrelid = v_oid and i.indisprimary and a.attnum = any (i.indkey));

  if v_mod = 'uzerine' and v_pk is not null and v_guncelle is not null then
    v_sql := format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict (%3$s) do update set %4$s returning (xmax = 0)',
                    p_tablo, v_kolon, v_pk, v_guncelle);
  else
    v_sql := format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing returning (xmax = 0)',
                    p_tablo, v_kolon);
  end if;

  for v_satir in select e from jsonb_array_elements(p_satirlar) e loop
    begin
      v_yeni := null;
      execute v_sql into v_yeni using v_satir;
      if v_yeni is null then v_atla := v_atla + 1;
      elsif v_yeni then v_ekle := v_ekle + 1;
      else v_guncel := v_guncel + 1;
      end if;
    exception when others then
      v_hata := v_hata + 1;
      if jsonb_array_length(v_hatalar) < 5 then
        v_hatalar := v_hatalar || to_jsonb(left(sqlerrm, 300));
      end if;
    end;
  end loop;

  return jsonb_build_object('tablo', p_tablo, 'eklenen', v_ekle, 'guncellenen', v_guncel, 'atlanan', v_atla,
                            'hatali', v_hata, 'hatalar', v_hatalar, 'mod', v_mod);
end;
$$;
revoke all on function public.sistem_geri_yukle_tablo(text, jsonb, text) from public, anon;
grant execute on function public.sistem_geri_yukle_tablo(text, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) R2 NESNE ↔ VERİTABANI İNDEKSİ
-- ----------------------------------------------------------------------------
-- Anahtarların veritabanında kaydı var mı? {anahtar: {kayitli, sahip, ad}}
create or replace function public.sistem_r2_kayit_durumu(p_kaynak text, p_anahtarlar text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb := '{}'::jsonb;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if p_anahtarlar is null or cardinality(p_anahtarlar) = 0 then return v; end if;
  if cardinality(p_anahtarlar) > 1000 then raise exception 'En çok 1000 anahtar.'; end if;

  if p_kaynak = 'arsiv' then
    select coalesce(jsonb_object_agg(a.r2_key, jsonb_build_object('kayitli', true, 'sahip', a.sahip_id, 'ad', a.ad, 'sifreli', a.sifreli)), '{}'::jsonb)
      into v from public.r2_arsiv a where a.r2_key = any (p_anahtarlar);
  elsif p_kaynak = 'notek' then
    select coalesce(jsonb_object_agg(a.r2_key, jsonb_build_object('kayitli', true, 'sahip', a.user_id, 'ad', null, 'sifreli', true)), '{}'::jsonb)
      into v from public.not_ek_kayitlari a where a.r2_key = any (p_anahtarlar);
  elsif p_kaynak = 'akademik' then
    select coalesce(jsonb_object_agg(a.pdf_r2_yolu, jsonb_build_object('kayitli', true, 'sahip', a.user_id, 'ad', coalesce(a.pdf_dosya_adi, a.baslik), 'sifreli', false)), '{}'::jsonb)
      into v from public.akademik_kaynaklar a where a.pdf_r2_yolu = any (p_anahtarlar);
  else
    raise exception 'Geçersiz kaynak.';
  end if;
  return v;
end;
$$;
revoke all on function public.sistem_r2_kayit_durumu(text, text[]) from public, anon;
grant execute on function public.sistem_r2_kayit_durumu(text, text[]) to authenticated;

-- Silme hazırlığı (ATOMİK): indeks satırlarını kaldırır + anahtarları kuyruğa yazar. R2 silme bundan SONRA yapılır.
create or replace function public.sistem_r2_silme_hazirla(p_kaynak text, p_anahtarlar text[], p_islem uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_kayit bigint := 0; v_kuyruk bigint := 0;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if p_kaynak not in ('arsiv', 'notek', 'akademik') then raise exception 'Geçersiz kaynak.'; end if;
  if p_anahtarlar is null or cardinality(p_anahtarlar) = 0 then raise exception 'Anahtar listesi boş.'; end if;
  if cardinality(p_anahtarlar) > 1000 then raise exception 'En çok 1000 anahtar.'; end if;

  if p_kaynak = 'arsiv' then
    delete from public.r2_arsiv where tur = 'dosya' and r2_key = any (p_anahtarlar);
  elsif p_kaynak = 'notek' then
    delete from public.not_ek_kayitlari where r2_key = any (p_anahtarlar);
  else
    update public.akademik_kaynaklar
       set pdf_r2_yolu = null, pdf_dosya_adi = null, pdf_boyut_bayt = null, pdf_guncelleme_tarihi = null
     where pdf_r2_yolu = any (p_anahtarlar);
  end if;
  get diagnostics v_kayit = row_count;

  insert into public.r2_silme_kuyrugu (kaynak, anahtar)
  select p_kaynak, k from unnest(p_anahtarlar) k
  on conflict (kaynak, anahtar) do nothing;
  get diagnostics v_kuyruk = row_count;

  return jsonb_build_object('indeks_silinen', v_kayit, 'kuyruga_alinan', v_kuyruk);
end;
$$;
revoke all on function public.sistem_r2_silme_hazirla(text, text[], uuid) from public, anon;
grant execute on function public.sistem_r2_silme_hazirla(text, text[], uuid) to authenticated;

-- R2'den gerçekten silinenler kuyruktan düşer; hata alanlar sayaçla kalır.
create or replace function public.sistem_r2_kuyruk_tamamla(p_kaynak text, p_silinen text[], p_hatali text[] default '{}'::text[], p_hata text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  delete from public.r2_silme_kuyrugu where kaynak = p_kaynak and anahtar = any (coalesce(p_silinen, '{}'::text[]));
  if p_hatali is not null and cardinality(p_hatali) > 0 then
    update public.r2_silme_kuyrugu
       set deneme = deneme + 1, son_hata = left(coalesce(p_hata, 'bilinmeyen hata'), 300)
     where kaynak = p_kaynak and anahtar = any (p_hatali);
  end if;
end;
$$;
revoke all on function public.sistem_r2_kuyruk_tamamla(text, text[], text[], text) from public, anon;
grant execute on function public.sistem_r2_kuyruk_tamamla(text, text[], text[], text) to authenticated;

create or replace function public.sistem_r2_kuyruk_listesi(p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return jsonb_build_object(
    'adet', (select count(*) from public.r2_silme_kuyrugu),
    'ogeler', coalesce((select jsonb_agg(jsonb_build_object('kaynak', q.kaynak, 'anahtar', q.anahtar, 'deneme', q.deneme, 'son_hata', q.son_hata) order by q.olusturma)
                        from (select * from public.r2_silme_kuyrugu order by olusturma limit least(greatest(coalesce(p_limit, 500), 1), 1000)) q), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.sistem_r2_kuyruk_listesi(integer) from public, anon;
grant execute on function public.sistem_r2_kuyruk_listesi(integer) to authenticated;

-- Dosya adı + boyut ile eşleştirme (yüklenen TEKİL dosyaların nereye ait olduğunu bulmak için).
-- Yalnızca R2 nesnesi bulunması gereken kayıtlar döner: {ad, boyut} → [{kaynak, anahtar, sahip, etiket}]
create or replace function public.sistem_r2_dosya_esle(p_dosyalar jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb := '[]'::jsonb; d jsonb; e jsonb;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if jsonb_typeof(p_dosyalar) <> 'array' or jsonb_array_length(p_dosyalar) > 200 then
    raise exception 'En çok 200 dosya.';
  end if;
  for d in select x from jsonb_array_elements(p_dosyalar) x loop
    select coalesce(jsonb_agg(u.m), '[]'::jsonb) into e from (
      select jsonb_build_object('kaynak', 'akademik', 'anahtar', a.pdf_r2_yolu, 'sahip', a.user_id, 'etiket', a.baslik) as m
        from public.akademik_kaynaklar a
       where a.pdf_r2_yolu is not null and a.pdf_dosya_adi = (d ->> 'ad') and a.pdf_boyut_bayt = (d ->> 'boyut')::bigint
      union all
      select jsonb_build_object('kaynak', 'arsiv', 'anahtar', r.r2_key, 'sahip', r.sahip_id, 'etiket', r.klasor_yolu || r.ad)
        from public.r2_arsiv r
       where r.tur = 'dosya' and r.r2_key is not null and r.ad = (d ->> 'ad') and r.boyut = (d ->> 'boyut')::bigint
      union all
      select jsonb_build_object('kaynak', 'arsiv', 'anahtar', r.r2_key, 'sahip', r.sahip_id, 'etiket', r.klasor_yolu || r.ad)
        from public.r2_arsiv r
       where r.tur = 'dosya' and r.r2_key = ('arsiv/' || (regexp_replace(d ->> 'ad', '\.sifreli$', '')))
    ) u;
    v := v || jsonb_build_object('ad', d ->> 'ad', 'adaylar', e);
  end loop;
  return v;
end;
$$;
revoke all on function public.sistem_r2_dosya_esle(jsonb) from public, anon;
grant execute on function public.sistem_r2_dosya_esle(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) SİLİNEN ÜYENİN FİZİKSEL DOSYALARI (owner; yalnızca silme kuyruğundaki hesaplar)
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_dosya_listesi(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  if not exists (select 1 from public.hesap_silme_talepleri where user_id = p_user) then
    raise exception 'Bu üye için bekleyen silme talebi yok.';
  end if;
  return (
    select coalesce(jsonb_agg(x order by x ->> 'kaynak', x ->> 'ad'), '[]'::jsonb) from (
      select jsonb_build_object('kaynak', 'arsiv', 'anahtar', r.r2_key, 'ad', r.ad, 'klasor', r.klasor_yolu,
                                'boyut', r.boyut, 'mime', coalesce(r.gercek_mime, r.mime), 'sifreli', r.sifreli) as x
        from public.r2_arsiv r where r.sahip_id = p_user and r.tur = 'dosya' and r.r2_key is not null
      union all
      select jsonb_build_object('kaynak', 'notek', 'anahtar', n.r2_key, 'ad', 'not-eki-' || right(n.r2_key, 8),
                                'klasor', 'Not ekleri/', 'boyut', n.boyut_bayt, 'mime', 'application/octet-stream', 'sifreli', true)
        from public.not_ek_kayitlari n where n.user_id = p_user
      union all
      select jsonb_build_object('kaynak', 'akademik', 'anahtar', a.pdf_r2_yolu, 'ad', coalesce(a.pdf_dosya_adi, a.baslik || '.pdf'),
                                'klasor', 'Akademik Kütüphane/', 'boyut', a.pdf_boyut_bayt, 'mime', 'application/pdf', 'sifreli', false)
        from public.akademik_kaynaklar a where a.user_id = p_user and a.pdf_r2_yolu is not null
    ) q
  );
end;
$$;
revoke all on function public.hesap_silme_dosya_listesi(uuid) from public, anon;
grant execute on function public.hesap_silme_dosya_listesi(uuid) to authenticated;

create or replace function public.hesap_silme_dosya_izinli_mi(p_user uuid, p_kaynak text, p_anahtar text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then return false; end if;
  if not exists (select 1 from public.hesap_silme_talepleri where user_id = p_user) then return false; end if;
  if p_kaynak = 'arsiv' then
    return exists (select 1 from public.r2_arsiv r where r.sahip_id = p_user and r.r2_key = p_anahtar);
  elsif p_kaynak = 'notek' then
    return exists (select 1 from public.not_ek_kayitlari n where n.user_id = p_user and n.r2_key = p_anahtar);
  elsif p_kaynak = 'akademik' then
    return exists (select 1 from public.akademik_kaynaklar a where a.user_id = p_user and a.pdf_r2_yolu = p_anahtar);
  end if;
  return false;
end;
$$;
revoke all on function public.hesap_silme_dosya_izinli_mi(uuid, text, text) from public, anon;
grant execute on function public.hesap_silme_dosya_izinli_mi(uuid, text, text) to authenticated;

-- HIZLI KONTROL (owner ile):
--   select jsonb_array_length(public.sistem_depolama_gezgini());
--   select public.sistem_korumali_tablo_mu('public', 'profiles');   -- true
