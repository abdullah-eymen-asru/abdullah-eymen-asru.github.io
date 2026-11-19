-- 0143 — Worker başına GÜNLÜK (UTC) sert istek sınırı.
-- gunluk_limit = o UTC gününde (00:00–24:00) o Worker'ın TOPLAM istek sınırı (null = sınırsız). Sınır "mutlak"tır: gün içinde zaten
-- 20 istek geldiyse ve sınırı 23 yaparsan 3 hakkı kalır (20 + 23 değil). Sınır dolunca sistem-yedek-worker (cron) workers.dev adresini
-- KESER (sert kapatma → kotaya sayılmaz); UTC gece yarısı (ya da sınır yükseltilince) kendiliğinden açar. Elle kapatılmış (acik=false) servise dokunmaz.
-- İdempotent. 0088'den sonra çalıştırılır.
alter table public.worker_anahtarlari add column if not exists gunluk_limit bigint;
alter table public.worker_anahtarlari drop constraint if exists worker_anahtarlari_gunluk_limit_chk;
alter table public.worker_anahtarlari add constraint worker_anahtarlari_gunluk_limit_chk check (gunluk_limit is null or (gunluk_limit >= 1 and gunluk_limit <= 100000000));

-- Okuma herkese açık (ad/durum gibi gizli değil); cron Worker'ı anon anahtarla okur.
grant select (gunluk_limit) on public.worker_anahtarlari to anon, authenticated;

create or replace function public.worker_limit_ayarla(p_ad text, p_limit bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kayit public.worker_anahtarlari%rowtype;
begin
  if auth.uid() is null or not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi veya sistem yedekleme yetkisi olan roller.' using errcode = '42501';
  end if;
  if public.is_demo() then raise exception 'Demo hesabı bu işlemi yapamaz.' using errcode = '42501'; end if;
  if p_limit is not null and (p_limit < 1 or p_limit > 100000000) then raise exception 'Sınır 1 ile 100.000.000 arasında olmalı (boş = sınırsız).'; end if;
  select * into kayit from public.worker_anahtarlari where ad = p_ad for update;
  if not found then raise exception 'Bilinmeyen servis: %', p_ad; end if;
  if kayit.tur <> 'worker' then raise exception 'Günlük sert sınır yalnızca Worker''lar için tanımlıdır (Pages Function workers.dev ile kesilemez).'; end if;
  if kayit.korumali and p_limit is not null then raise exception 'Korumalı servise sınır konamaz (panelin kendisi / güvenlik bildirimleri kapanmamalı).'; end if;
  update public.worker_anahtarlari set gunluk_limit = p_limit, guncelleyen_id = auth.uid(), guncelleme = now() where ad = p_ad;
  return jsonb_build_object('ad', p_ad, 'gunluk_limit', p_limit);
end $$;
revoke all on function public.worker_limit_ayarla(text, bigint) from public, anon;
grant execute on function public.worker_limit_ayarla(text, bigint) to authenticated;
