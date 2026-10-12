-- ============================================================================
-- 0088_worker_anahtarlari.sql  — KOTA KORUMASI: Worker'lar ve Gatekeeper Function için aç/kapa anahtarları
-- Gereksinim: 0074 (sistem_export_yetkisi_var_mi). Tekrar çalıştırmak güvenlidir (idempotent).
--
-- Cloudflare ücretsiz kotası (100.000 istek/gün) Workers + Pages Functions için ORTAKTIR; dolunca hepsi hata verir.
-- Bu tablo "hangi servis şu an açık?" bilgisini tutar. Kimler okur: HERKES (anon dahil) — yalnızca ad + açık/kapalı;
--   istemci (assets/js/core/worker-kapi.js), Worker'lar ve Gatekeeper Function bunu okur. Gizli bilgi içermez.
-- Kimler değiştirir: yalnızca Site Sahibi ve sistem yedekleme yetkisi olan roller (sistem_export_yetkisi_var_mi),
--   SADECE worker_anahtari_ayarla() RPC'si üzerinden (doğrudan INSERT/UPDATE/DELETE politikası YOK).
-- 'korumali' satırlar (sistem-yedek-worker: bu paneli ve bu anahtarları yöneten servis; admin-guvenlik-bildirim-worker:
--   güvenlik uyarıları) KAPATILAMAZ — kapatılsa panel kendini kilitlerdi.
-- ============================================================================

create table if not exists public.worker_anahtarlari (
  ad            text primary key check (ad ~ '^[a-z0-9-]{3,64}$'),
  etiket        text not null,
  tur           text not null default 'worker' check (tur in ('worker', 'pages_function')),
  acik          boolean not null default true,
  korumali      boolean not null default false,
  guncelleyen_id uuid references public.profiles(id) on delete set null,
  guncelleme    timestamptz not null default now()
);
comment on table public.worker_anahtarlari is
  'Kota koruması: Worker/Pages Function aç-kapa anahtarları. Okuma herkese açık (yalnızca ad/durum), yazma yalnızca worker_anahtari_ayarla() RPC''si.';

insert into public.worker_anahtarlari (ad, etiket, tur, korumali) values
  ('gatekeeper-function',         'Gatekeeper (Pages Function) — sunucu tarafı kilit', 'pages_function', false),
  ('akademik-kutuphane-worker',   'Akademik Kütüphane',                    'worker', false),
  ('github-icerik-yonetim',       'GitHub İçerik Yönetimi',                'worker', false),
  ('izleme-okuma-api',            'İzleme/Okuma — herkese açık liste API', 'worker', false),
  ('izleme-okuma-yonetim-worker', 'İzleme/Okuma — yönetim',                'worker', false),
  ('r2-arsiv-worker',             'Dosya Yöneticisi (R2 arşiv)',           'worker', false),
  ('r2-imza-worker',              'Dosya paylaşımı (R2 imza)',             'worker', false),
  ('r2-not-ek-worker',            'Not ekleri (R2)',                       'worker', false),
  ('substack-feed-proxy-worker',  'Substack besleme vekili',               'worker', false),
  ('sistem-yedek-worker',         'Sistem yedekleme (bu panelin kendisi)', 'worker', true),
  ('admin-guvenlik-bildirim-worker', 'Admin güvenlik bildirimleri',        'worker', true)
on conflict (ad) do update set etiket = excluded.etiket, tur = excluded.tur, korumali = excluded.korumali;

alter table public.worker_anahtarlari enable row level security;

drop policy if exists "worker_anahtarlari_select_herkes" on public.worker_anahtarlari;
create policy "worker_anahtarlari_select_herkes"
  on public.worker_anahtarlari for select to anon, authenticated using (true);

revoke all on public.worker_anahtarlari from public, anon, authenticated;
grant select (ad, etiket, tur, acik, korumali, guncelleme) on public.worker_anahtarlari to anon, authenticated;

-- Değişiklik günlüğü (kim, ne zaman, hangi servisi açtı/kapattı) — yalnızca yetkililer okur.
create table if not exists public.worker_anahtar_gunlugu (
  id          bigint generated always as identity primary key,
  ad          text not null,
  acik        boolean not null,
  kullanici_id uuid references public.profiles(id) on delete set null,
  zaman       timestamptz not null default now()
);
alter table public.worker_anahtar_gunlugu enable row level security;
revoke all on public.worker_anahtar_gunlugu from public, anon, authenticated;
create index if not exists worker_anahtar_gunlugu_zaman_idx on public.worker_anahtar_gunlugu (zaman desc);

create or replace function public.worker_anahtari_ayarla(p_ad text, p_acik boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  kayit public.worker_anahtarlari%rowtype;
begin
  if auth.uid() is null or not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi veya sistem yedekleme yetkisi olan roller.' using errcode = '42501';
  end if;
  if public.is_demo() then
    raise exception 'Demo hesabı bu işlemi yapamaz.' using errcode = '42501';
  end if;
  if p_acik is null then
    raise exception 'Durum belirtilmedi.';
  end if;
  select * into kayit from public.worker_anahtarlari where ad = p_ad for update;
  if not found then
    raise exception 'Bilinmeyen servis: %', p_ad;
  end if;
  if kayit.korumali and not p_acik then
    raise exception 'Bu servis korumalıdır ve kapatılamaz (panelin kendisi / güvenlik bildirimleri).';
  end if;
  if kayit.acik is distinct from p_acik then
    update public.worker_anahtarlari set acik = p_acik, guncelleyen_id = auth.uid(), guncelleme = now() where ad = p_ad;
    insert into public.worker_anahtar_gunlugu (ad, acik, kullanici_id) values (p_ad, p_acik, auth.uid());
  end if;
  return jsonb_build_object('ad', p_ad, 'acik', p_acik);
end;
$$;
revoke all on function public.worker_anahtari_ayarla(text, boolean) from public, anon;
grant execute on function public.worker_anahtari_ayarla(text, boolean) to authenticated;

create or replace function public.worker_anahtar_gunlugu_getir(p_adet int default 20)
returns table (ad text, acik boolean, kullanici text, zaman timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
  select g.ad, g.acik, coalesce(nullif(btrim(p.first_name || ' ' || coalesce(p.last_name, '')), ''), p.email, '—'), g.zaman
    from public.worker_anahtar_gunlugu g
    left join public.profiles p on p.id = g.kullanici_id
   order by g.zaman desc
   limit greatest(1, least(coalesce(p_adet, 20), 100));
end;
$$;
revoke all on function public.worker_anahtar_gunlugu_getir(int) from public, anon;
grant execute on function public.worker_anahtar_gunlugu_getir(int) to authenticated;
