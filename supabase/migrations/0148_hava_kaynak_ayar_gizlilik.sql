-- ============================================================================
-- 0148 — HavaStil veri kaynakları: ayar okumayı SIKILAŞTIR (demo/anonim ziyaretçiye hiçbir şey sızmasın)
-- Önkoşul: 0147. Tekrar çalıştırılabilir (idempotent).
--
-- Önceki durum (0146/0147): hava_kaynak_ayar_oku() anonim ziyaretçi dâhil HERKES tarafından çağrılabiliyordu. Döndürdüğü alanlar
-- (hangi resmî kaynakların açık olduğu, site anahtarının tanımlı olup olmadığı, yönetici notu) sır değildi ama demo/anonim ziyaretçinin
-- görmesi için de bir neden yoktu. "Yalnızca gerekli özellik görünsün" ilkesiyle:
--   • anon: çalıştırma yetkisi KALKAR (vitrin zaten bu RPC'yi çağırmaz; kendi sahte verisiyle çalışır).
--   • giriş yapmış ama HavaStil yetkisi OLMAYAN üye (ör. 'demo' rolü): null döner → arayüz güvenli varsayılanlara düşer.
--   • HavaStil yetkili üye: ayarları görür; yönetici notu (aciklama) ve son güncelleme bilgisi (guncelleme) YALNIZCA yöneticiye gider.
-- ============================================================================

create or replace function public.hava_kaynak_ayar_oku()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_yonetici boolean;
begin
  if auth.uid() is null then return null; end if;
  v_yonetici := coalesce(public._om_yonetici(), false);
  if not (v_yonetici or coalesce(public.havastil_yetkisi_var_mi(), false)) then return null; end if;
  return (select jsonb_build_object(
    'gozlem_sira', to_jsonb(a.gozlem_sira), 'gozlem_acik', jsonb_build_object('mgm', a.mgm_acik, 'metar', a.metar_acik),
    'kalite_istasyon_acik', a.kalite_istasyon_acik,
    'openaq_site_anahtari_tanimli', (a.openaq_site_anahtari_tanimli or exists (select 1 from public.hava_site_anahtar s where s.saglayici = 'openaq')),
    'kendi_anahtar_izni', a.kendi_anahtar_izni, 'yaricap_km', a.yaricap_km, 'tazelik_dk', a.tazelik_dk,
    'aciklama', case when v_yonetici then a.aciklama else null end,
    'guncelleme', case when v_yonetici then a.guncelleme else null end,
    'dogrulama_acik', a.dogrulama_acik, 'duzeltme_acik', a.duzeltme_acik, 'duzeltme_saat', a.duzeltme_saat)
  from public.hava_kaynak_ayar a where a.id);
end $$;
revoke all on function public.hava_kaynak_ayar_oku() from public, anon;
grant execute on function public.hava_kaynak_ayar_oku() to authenticated;

-- ============================================================================
-- BİTTİ. Etki: yalnızca giriş yapmış + HavaStil yetkili kullanıcılar ayarı okur. Başka bir değişiklik gerekmez.
-- ============================================================================
