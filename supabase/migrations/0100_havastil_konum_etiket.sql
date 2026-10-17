-- ============================================================================
-- 0100_havastil_konum_etiket.sql — HavaStil v2: kayıtlı konumlara simge/yer adı alanları + tercihlere tarz/çanta + yeni senaryolar
-- Tekrar çalıştırmak güvenlidir (idempotent). Gereksinim: 0099_havastil.sql.
--   • havastil_konumlari: ikon (ev/is/okul/aile/spor/gezi/diger), ulke (ISO-2), admin1 (il/eyalet), ilce  — yalnızca KULLANICININ KAYDETTİĞİ konumlar için
--   • havastil_tercihleri: stil (auto/K/S/C/M/D), canta (yok/el/sirt); senaryo kontrolü 'gezi' ve 'spor'u da kabul eder
-- Koordinat hâlâ numeric(8,3) = ≈110 m'ye yuvarlı. Anlık GPS ve arama metinleri hiçbir zaman tabloya yazılmaz.
-- ============================================================================
alter table public.havastil_konumlari
  add column if not exists ikon   text not null default 'diger',
  add column if not exists ulke   text,
  add column if not exists admin1 text,
  add column if not exists ilce   text;

do $$
declare r record;
begin
  -- eski/yeni kontrolleri temiz bir kümeye çevir
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.havastil_konumlari'::regclass and c.contype = 'c'
             and (pg_get_constraintdef(c.oid) ilike '%ikon%' or pg_get_constraintdef(c.oid) ilike '%ulke%' or pg_get_constraintdef(c.oid) ilike '%admin1%' or pg_get_constraintdef(c.oid) ilike '%ilce%') loop
    execute format('alter table public.havastil_konumlari drop constraint %I', r.conname);
  end loop;
  alter table public.havastil_konumlari
    add constraint havastil_konumlari_ikon_chk   check (ikon in ('ev', 'is', 'okul', 'aile', 'spor', 'gezi', 'diger')),
    add constraint havastil_konumlari_ulke_chk   check (ulke is null or ulke ~ '^[A-Za-z]{2}$'),
    add constraint havastil_konumlari_admin1_chk check (admin1 is null or char_length(admin1) <= 60),
    add constraint havastil_konumlari_ilce_chk   check (ilce is null or char_length(ilce) <= 60);

  alter table public.havastil_tercihleri
    add column if not exists stil  text not null default 'auto',
    add column if not exists canta text not null default 'el';
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.havastil_tercihleri'::regclass and c.contype = 'c'
             and (pg_get_constraintdef(c.oid) ilike '%senaryo%' or pg_get_constraintdef(c.oid) ilike '%stil%' or pg_get_constraintdef(c.oid) ilike '%canta%') loop
    execute format('alter table public.havastil_tercihleri drop constraint %I', r.conname);
  end loop;
  alter table public.havastil_tercihleri
    add constraint havastil_tercihleri_senaryo_chk check (senaryo in ('toplu', 'yuruyus_ofis', 'disari', 'arac', 'gezi', 'spor')),
    add constraint havastil_tercihleri_stil_chk    check (stil in ('auto', 'K', 'S', 'C', 'M', 'D')),
    add constraint havastil_tercihleri_canta_chk   check (canta in ('yok', 'el', 'sirt'));
end $$;

comment on column public.havastil_konumlari.ikon is 'Kullanıcının seçtiği simge (ev/is/okul/aile/spor/gezi/diger).';
-- HIZLI KONTROL:  select ikon, ulke, admin1, ilce from public.havastil_konumlari limit 1;
