-- ============================================================================
-- 0106_worker_kota_gecmisi.sql — "📊 Worker Kota Analitiği & Harcama Dökümü" (sistem-yedek › Depolama Durumu)
--
-- VERİ MODELİ (sıfır ek maliyet):
--   • SAATLİK/GÜNLÜK ham veri Cloudflare ücretsiz GraphQL Analytics API'sinden gelir (sistem-yedek-worker  GET /kota/analitik,
--     en çok son ~31 gün; 5 dk edge cache). Ek sunucu / ek veritabanı YOK.
--   • Cloudflare'in saklama süresi dolunca (AYLIK/YILLIK görünüm için) her analitik okumasında GÜNLÜK toplamlar bu küçük tabloya
--     upsert edilir (günde 1 satır ≈ yılda 365 satır ≈ <100 KB). Böylece geçmiş, Cloudflare unutsa bile kalır.
--   • Yazma/okuma yalnızca Site Sahibi (is_owner()); tabloya doğrudan erişim YOK (RLS açık, politika yok).
-- Dürüst sınır: geçmiş, analitik ekranı ilk açıldığı günden (ve Cloudflare'in elinde kalan ~31 günden geriye) itibaren birikir.
-- ============================================================================
create table if not exists public.worker_kota_gecmis (
  gun         date primary key,                 -- UTC günü (Cloudflare kotası UTC gününe göre sayılır)
  workers     bigint not null default 0 check (workers >= 0),
  pages       bigint not null default 0 check (pages >= 0),
  guncelleme  timestamptz not null default now()
);
alter table public.worker_kota_gecmis enable row level security;
revoke all on public.worker_kota_gecmis from public, anon, authenticated;

-- Günlük toplamları yazar. p_satirlar: [{"gun":"2026-10-20","workers":1200,"pages":340}, ...]  (en çok 400 satır)
create or replace function public.worker_kota_gecmisine_yaz(p_satirlar jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v jsonb; v_n integer := 0; v_gun date;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if jsonb_typeof(p_satirlar) is distinct from 'array' or jsonb_array_length(p_satirlar) > 400 then
    raise exception 'Geçersiz veri.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_satirlar) loop
    v_gun := (v ->> 'gun')::date;
    if v_gun is null or v_gun > (now() at time zone 'utc')::date then continue; end if;
    insert into public.worker_kota_gecmis (gun, workers, pages)
    values (v_gun, greatest(coalesce((v ->> 'workers')::bigint, 0), 0), greatest(coalesce((v ->> 'pages')::bigint, 0), 0))
    on conflict (gun) do update
      set workers = greatest(public.worker_kota_gecmis.workers, excluded.workers),   -- gün içinde sayaç yalnızca artar
          pages   = greatest(public.worker_kota_gecmis.pages, excluded.pages),
          guncelleme = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.worker_kota_gecmisine_yaz(jsonb) from public, anon;
grant execute on function public.worker_kota_gecmisine_yaz(jsonb) to authenticated;

create or replace function public.worker_kota_gecmisi_getir(p_bas date, p_bit date)
returns table (gun date, workers bigint, pages bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
    select g.gun, g.workers, g.pages from public.worker_kota_gecmis g
     where g.gun between coalesce(p_bas, date '2000-01-01') and coalesce(p_bit, date '2100-01-01')
     order by g.gun limit 1200;
end;
$$;
revoke all on function public.worker_kota_gecmisi_getir(date, date) from public, anon;
grant execute on function public.worker_kota_gecmisi_getir(date, date) to authenticated;
