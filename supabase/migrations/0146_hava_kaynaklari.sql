-- ============================================================================
-- 0146 — HavaStil: resmî/yerel hava kaynakları ayarı + OpenAQ kullanıcı anahtarı
-- Önkoşul: 0113 (havastil_ai_kasasi), 0121 (_om_yonetici), 0140 (kasa sağlayıcı kısıtı). Tekrar çalıştırılabilir (idempotent).
--
-- 1) Anahtar kasasına 'openaq' sağlayıcısı (kullanıcının KENDİ OpenAQ anahtarı; şifreli, yalnızca sahibi görür — mevcut kasa modeli).
-- 2) public.hava_kaynak_ayar: SİSTEM GENELİ tek satır — kaynak sırası/açık-kapalı, yarıçap, tazelik, "site anahtarı tanımlı" işareti.
--    Herkes OKUR (hava_kaynak_ayar_oku: yalnızca bu alanlar), yalnızca Site Sahibi/Yönetici YAZAR. Anahtarın kendisi burada TUTULMAZ:
--    site OpenAQ anahtarı Worker secret'ıdır (OPENAQ_API_KEY) — tarayıcıya, veritabanına ve günlüğe hiç girmez.
-- ============================================================================

-- 1) kasa sağlayıcı kısıtı
alter table public.havastil_ai_kasasi drop constraint if exists havastil_ai_kasasi_saglayici_check;
alter table public.havastil_ai_kasasi
  add constraint havastil_ai_kasasi_saglayici_check check (saglayici in ('gemini', 'openai', 'anthropic', 'openrouter', 'openmeteo', 'groq', 'cozumleyici', 'openaq'));

-- 2) sistem ayarı (tek satır)
create table if not exists public.hava_kaynak_ayar (
  id boolean primary key default true check (id),
  gozlem_sira text[] not null default array['mgm', 'metar'],
  mgm_acik boolean not null default false,            -- MGM belgelenmemiş bir uç nokta kullanır: yönetici testten sonra bilerek açar
  metar_acik boolean not null default true,
  kalite_istasyon_acik boolean not null default true,
  openaq_site_anahtari_tanimli boolean not null default false,
  kendi_anahtar_izni boolean not null default true,
  yaricap_km integer not null default 25 check (yaricap_km between 1 and 25),   -- OpenAQ v3 en çok 25 km yarıçap verir
  tazelik_dk integer not null default 180 check (tazelik_dk between 30 and 1440),
  aciklama text check (aciklama is null or char_length(aciklama) <= 500),
  guncelleme timestamptz not null default now(),
  guncelleyen uuid references auth.users (id) on delete set null,
  constraint hava_kaynak_gozlem_sira_gecerli check (gozlem_sira <@ array['mgm', 'metar'] and cardinality(gozlem_sira) between 1 and 2)
);
insert into public.hava_kaynak_ayar (id) values (true) on conflict (id) do nothing;
alter table public.hava_kaynak_ayar enable row level security;
revoke all on public.hava_kaynak_ayar from public, anon, authenticated;     -- erişim yalnızca aşağıdaki RPC'lerle

create or replace function public.hava_kaynak_ayar_oku()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gozlem_sira', to_jsonb(a.gozlem_sira), 'gozlem_acik', jsonb_build_object('mgm', a.mgm_acik, 'metar', a.metar_acik),
    'kalite_istasyon_acik', a.kalite_istasyon_acik, 'openaq_site_anahtari_tanimli', a.openaq_site_anahtari_tanimli,
    'kendi_anahtar_izni', a.kendi_anahtar_izni, 'yaricap_km', a.yaricap_km, 'tazelik_dk', a.tazelik_dk, 'aciklama', a.aciklama, 'guncelleme', a.guncelleme)
  from public.hava_kaynak_ayar a where a.id;
$$;
revoke all on function public.hava_kaynak_ayar_oku() from public;
grant execute on function public.hava_kaynak_ayar_oku() to anon, authenticated;

create or replace function public.hava_kaynak_ayar_kaydet(p_ayar jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_sira text[]; v_yar integer; v_taze integer;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_ayar is null or jsonb_typeof(p_ayar) <> 'object' then raise exception 'Ayar nesnesi geçersiz.'; end if;
  select array_agg(x) into v_sira from jsonb_array_elements_text(coalesce(p_ayar -> 'gozlem_sira', '["mgm","metar"]'::jsonb)) x;
  if v_sira is null or not (v_sira <@ array['mgm', 'metar']) or cardinality(v_sira) not between 1 and 2 then raise exception 'Gözlem sırası yalnızca mgm ve metar içerebilir.'; end if;
  v_yar := coalesce((p_ayar ->> 'yaricap_km')::integer, 25); v_taze := coalesce((p_ayar ->> 'tazelik_dk')::integer, 180);
  if v_yar not between 1 and 25 then raise exception 'Yarıçap 1–25 km olmalı.'; end if;
  if v_taze not between 30 and 1440 then raise exception 'Tazelik 30–1440 dakika olmalı.'; end if;
  update public.hava_kaynak_ayar set
    gozlem_sira = v_sira,
    mgm_acik = coalesce((p_ayar -> 'gozlem_acik' ->> 'mgm')::boolean, false),
    metar_acik = coalesce((p_ayar -> 'gozlem_acik' ->> 'metar')::boolean, true),
    kalite_istasyon_acik = coalesce((p_ayar ->> 'kalite_istasyon_acik')::boolean, true),
    openaq_site_anahtari_tanimli = coalesce((p_ayar ->> 'openaq_site_anahtari_tanimli')::boolean, false),
    kendi_anahtar_izni = coalesce((p_ayar ->> 'kendi_anahtar_izni')::boolean, true),
    yaricap_km = v_yar, tazelik_dk = v_taze,
    aciklama = nullif(btrim(coalesce(p_ayar ->> 'aciklama', '')), ''), guncelleme = now(), guncelleyen = auth.uid()
  where id;
end $$;
revoke all on function public.hava_kaynak_ayar_kaydet(jsonb) from public, anon;
grant execute on function public.hava_kaynak_ayar_kaydet(jsonb) to authenticated;

-- ============================================================================
-- BİTTİ. Sırada: (1) Worker'ı yeniden yayınla (/hava/openaq, /hava/metar, /hava/mgm uçları),
-- (2) site anahtarı için: openaq.org'da ücretsiz hesap → API anahtarı → Worker secret OPENAQ_API_KEY → HavaStil › Ayarlar › Hava veri kaynakları → "Site anahtarı tanımlı".
-- ============================================================================
