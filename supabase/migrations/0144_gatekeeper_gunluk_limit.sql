-- 0144 — Gatekeeper (Pages Function) için GÜNLÜK (UTC) istek sınırı.
-- worker_limit_ayarla artık tur='pages_function' satırını da kabul eder (korumali satır yine reddedilir).
-- Pages Function workers.dev ile KESİLEMEZ; sınır aşılınca Function kendini ATLAR (istekleri işlemeden geçirir → kilitli rotalar
-- o süre açık kalır; istek Cloudflare kotasına yine sayılır). Kullanım sistem-yedek-worker'ın /gatekeeper-limit/durum ucundan okunur.
-- İdempotent. 0143'ten sonra çalıştırılır.
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
  if kayit.korumali and p_limit is not null then raise exception 'Korumalı servise sınır konamaz (panelin kendisi / güvenlik bildirimleri kapanmamalı).'; end if;
  update public.worker_anahtarlari set gunluk_limit = p_limit, guncelleyen_id = auth.uid(), guncelleme = now() where ad = p_ad;
  return jsonb_build_object('ad', p_ad, 'gunluk_limit', p_limit, 'tur', kayit.tur);
end $$;
revoke all on function public.worker_limit_ayarla(text, bigint) from public, anon;
grant execute on function public.worker_limit_ayarla(text, bigint) to authenticated;
