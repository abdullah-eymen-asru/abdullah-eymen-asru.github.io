-- ============================================================================
-- 0147 — HavaStil: SİTE API anahtarını arayüzden GÜVENLİ girme + ölçümle doğrulama ayarları
-- Önkoşul: 0146 (hava_kaynak_ayar), 0121 (_om_yonetici), 0099 (havastil_yetkisi_var_mi). Tekrar çalıştırılabilir (idempotent).
--
-- GÜVENLİK TASARIMI (anahtar hiçbir zaman açık metin olarak veritabanına, tarayıcıya ya da günlüğe girmez):
--   1) Yönetici anahtarı arayüze yazar → tarayıcı onu YALNIZCA HTTPS ile Cloudflare Worker'a (POST /hava/anahtar) yollar.
--   2) Worker: oturumu + yönetici yetkisini doğrular, anahtarı sağlayıcıda (OpenAQ) dener, sonra Worker secret'ı HAVA_ANAHTAR_SIFRESI ile
--      AES-256-GCM ile ŞİFRELER ve yalnızca şifreli metni bu tabloya yazar. Çözme anahtarı (secret) yalnızca Worker'dadır.
--   3) Tarayıcı/veritabanı yöneticisi/yedekler yalnızca şifreli metni görür; çözemez. Arayüz anahtarı bir daha GÖSTERMEZ (yalnızca son 4 karakter).
--   4) Worker istek geldiğinde şifreli metni okuyup bellekte çözer ve OpenAQ'ya kendisi gider (anahtar tarayıcıya hiç dönmez).
-- ============================================================================

-- 1) şifreli site anahtarı (sağlayıcı başına tek satır)
create table if not exists public.hava_site_anahtar (
  saglayici text primary key check (saglayici in ('openaq')),
  sifreli text not null check (char_length(sifreli) between 20 and 2000),
  son4 text check (son4 is null or char_length(son4) <= 4),
  guncelleme timestamptz not null default now(),
  guncelleyen uuid references auth.users (id) on delete set null
);
alter table public.hava_site_anahtar enable row level security;
revoke all on public.hava_site_anahtar from public, anon, authenticated;      -- erişim yalnızca aşağıdaki RPC'lerle

-- Yazma / silme: yalnızca Site Sahibi + yetkili Yönetici
create or replace function public.hava_site_anahtar_yaz(p_saglayici text, p_sifreli text, p_son4 text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_saglayici is distinct from 'openaq' then raise exception 'Bilinmeyen sağlayıcı.'; end if;
  if p_sifreli is null or p_sifreli !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'Şifreli anahtar biçimi geçersiz.'; end if;
  insert into public.hava_site_anahtar (saglayici, sifreli, son4, guncelleme, guncelleyen)
  values (p_saglayici, p_sifreli, nullif(right(coalesce(p_son4, ''), 4), ''), now(), auth.uid())
  on conflict (saglayici) do update set sifreli = excluded.sifreli, son4 = excluded.son4, guncelleme = now(), guncelleyen = auth.uid();
end $$;
revoke all on function public.hava_site_anahtar_yaz(text, text, text) from public, anon;
grant execute on function public.hava_site_anahtar_yaz(text, text, text) to authenticated;

create or replace function public.hava_site_anahtar_sil(p_saglayici text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  delete from public.hava_site_anahtar where saglayici = p_saglayici;
end $$;
revoke all on function public.hava_site_anahtar_sil(text) from public, anon;
grant execute on function public.hava_site_anahtar_sil(text) to authenticated;

-- Durum (yalnızca yönetici): var mı, son 4 karakter, ne zaman. Şifreli metin DÖNMEZ.
create or replace function public.hava_site_anahtar_durum()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('saglayici', saglayici, 'son4', son4, 'guncelleme', guncelleme)) from public.hava_site_anahtar), '[]'::jsonb);
end $$;
revoke all on function public.hava_site_anahtar_durum() from public, anon;
grant execute on function public.hava_site_anahtar_durum() to authenticated;

-- Okuma (Worker, kullanıcının KENDİ jetonuyla çağırır): şifreli metni yalnızca HavaStil yetkisi açık kullanıcıya verir.
-- Şifreli metin tek başına işe yaramaz (çözme anahtarı yalnızca Worker secret'ındadır).
create or replace function public.hava_site_anahtar_oku(p_saglayici text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.havastil_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return (select sifreli from public.hava_site_anahtar where saglayici = p_saglayici);
end $$;
revoke all on function public.hava_site_anahtar_oku(text) from public, anon;
grant execute on function public.hava_site_anahtar_oku(text) to authenticated;

-- 2) ölçümle doğrulama ayarları (hava_kaynak_ayar'a ek sütunlar)
alter table public.hava_kaynak_ayar add column if not exists dogrulama_acik boolean not null default true;   -- resmî ölçümü modelle karşılaştır, sapmayı göster
alter table public.hava_kaynak_ayar add column if not exists duzeltme_acik boolean not null default true;    -- ölçüm taze ve yakınsa, yakın saatlerin sıcaklığını ölçüme doğru kaydır
alter table public.hava_kaynak_ayar add column if not exists duzeltme_saat integer not null default 3 check (duzeltme_saat between 1 and 6);

-- 3) okuma RPC'si: "site anahtarı tanımlı" artık şifreli kayıttan da türetilir (Worker secret'ı için elle işaret de geçerli)
create or replace function public.hava_kaynak_ayar_oku()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gozlem_sira', to_jsonb(a.gozlem_sira), 'gozlem_acik', jsonb_build_object('mgm', a.mgm_acik, 'metar', a.metar_acik),
    'kalite_istasyon_acik', a.kalite_istasyon_acik,
    'openaq_site_anahtari_tanimli', (a.openaq_site_anahtari_tanimli or exists (select 1 from public.hava_site_anahtar s where s.saglayici = 'openaq')),
    'kendi_anahtar_izni', a.kendi_anahtar_izni, 'yaricap_km', a.yaricap_km, 'tazelik_dk', a.tazelik_dk, 'aciklama', a.aciklama, 'guncelleme', a.guncelleme,
    'dogrulama_acik', a.dogrulama_acik, 'duzeltme_acik', a.duzeltme_acik, 'duzeltme_saat', a.duzeltme_saat)
  from public.hava_kaynak_ayar a where a.id;
$$;
revoke all on function public.hava_kaynak_ayar_oku() from public;
grant execute on function public.hava_kaynak_ayar_oku() to anon, authenticated;

create or replace function public.hava_kaynak_ayar_kaydet(p_ayar jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_sira text[]; v_yar integer; v_taze integer; v_ds integer;
begin
  if not public._om_yonetici() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_ayar is null or jsonb_typeof(p_ayar) <> 'object' then raise exception 'Ayar nesnesi geçersiz.'; end if;
  select array_agg(x) into v_sira from jsonb_array_elements_text(coalesce(p_ayar -> 'gozlem_sira', '["mgm","metar"]'::jsonb)) x;
  if v_sira is null or not (v_sira <@ array['mgm', 'metar']) or cardinality(v_sira) not between 1 and 2 then raise exception 'Gözlem sırası yalnızca mgm ve metar içerebilir.'; end if;
  v_yar := coalesce((p_ayar ->> 'yaricap_km')::integer, 25); v_taze := coalesce((p_ayar ->> 'tazelik_dk')::integer, 180); v_ds := coalesce((p_ayar ->> 'duzeltme_saat')::integer, 3);
  if v_yar not between 1 and 25 then raise exception 'Yarıçap 1–25 km olmalı.'; end if;
  if v_taze not between 30 and 1440 then raise exception 'Tazelik 30–1440 dakika olmalı.'; end if;
  if v_ds not between 1 and 6 then raise exception 'Düzeltme süresi 1–6 saat olmalı.'; end if;
  update public.hava_kaynak_ayar set
    gozlem_sira = v_sira,
    mgm_acik = coalesce((p_ayar -> 'gozlem_acik' ->> 'mgm')::boolean, false),
    metar_acik = coalesce((p_ayar -> 'gozlem_acik' ->> 'metar')::boolean, true),
    kalite_istasyon_acik = coalesce((p_ayar ->> 'kalite_istasyon_acik')::boolean, true),
    openaq_site_anahtari_tanimli = coalesce((p_ayar ->> 'openaq_site_anahtari_tanimli')::boolean, false),
    kendi_anahtar_izni = coalesce((p_ayar ->> 'kendi_anahtar_izni')::boolean, true),
    dogrulama_acik = coalesce((p_ayar ->> 'dogrulama_acik')::boolean, true),
    duzeltme_acik = coalesce((p_ayar ->> 'duzeltme_acik')::boolean, true),
    duzeltme_saat = v_ds,
    yaricap_km = v_yar, tazelik_dk = v_taze,
    aciklama = nullif(btrim(coalesce(p_ayar ->> 'aciklama', '')), ''), guncelleme = now(), guncelleyen = auth.uid()
  where id;
end $$;
revoke all on function public.hava_kaynak_ayar_kaydet(jsonb) from public, anon;
grant execute on function public.hava_kaynak_ayar_kaydet(jsonb) to authenticated;

-- ============================================================================
-- BİTTİ. Sırada: (1) Worker'a SECRET ekle: HAVA_ANAHTAR_SIFRESI (en az 32 rastgele karakter; bir kez belirle, DEĞİŞTİRME — değişirse kayıtlı
--   anahtar çözülemez ve yeniden girilir), (2) Worker'ı yeniden yayınla, (3) HavaStil › Ayarlar › Hava veri kaynakları › Site anahtarı.
-- ============================================================================
