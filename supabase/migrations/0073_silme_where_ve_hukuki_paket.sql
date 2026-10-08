-- ============================================================================
-- 0073_silme_where_ve_hukuki_paket.sql
-- Gereksinim: 0052, 0064, 0065, 0069, 0070, 0071 çalıştırılmış olmalı.
-- Tekrar çalıştırmak güvenlidir (create or replace).
--
-- 1) "DELETE requires a WHERE clause" HATASI (kök neden)
--    Supabase, PostgREST oturumlarına pg-safeupdate eklentisini yükler: WHERE'siz DELETE/UPDATE,
--    SECURITY DEFINER bir fonksiyonun İÇİNDE bile reddedilir. 0071 (uye_aktarim_kayitlari) ve
--    0052 (denetim_kayitlari) tüm tabloyu `delete from t;` ile siliyordu.
--    Çözüm: istemciden `.neq('id', sıfır-uuid)` hilesi YERİNE sunucuda, yetkiyi (is_owner) zaten
--    denetleyen RPC'lerde açık bir kapsam koşulu:  where id in (select id from <tablo>)
--    (sabit `where true` / `is not null` planlayıcıda sadeleşip eklentiyi yine tetikleyebildiği için
--    sadeleştirilemeyen alt sorgu kullanılır). RLS/yetki mantığı değişmez: yalnızca owner.
--
-- 2) HUKUKİ PAKET (Aydınlatma + Açık Rıza + Gizlilik Politikası) TEK MERKEZDEN, AYNI ETİKETLE
--    hukuki_paket_surumu_yayinla(p_surum, p_riza_da) — iki sürüm kolonunu TEK İŞLEMDE (atomik)
--    günceller; p_riza_da = true (varsayılan) ise açık rıza etiketi de aynı değere çekilir.
--    Yetki: kvkk_surum_yetkisi_var_mi() (owner her zaman; admin yalnız owner anahtarı açıkken).
--    Kolonlar bilinçli olarak AYRI kalır: onay damgası, üyenin gördüğü metnin sürümünü kanıtlar
--    (KVKK m.9: açık rıza aydınlatmadan ayrı ve belirli bir metne bağlı olmalı). Eşgüdüm, kolonları
--    birleştirmekle değil, bu RPC + panel uyarısıyla sağlanır.
-- ============================================================================

-- 1a) Üye verisi indirme geçmişi
create or replace function public.owner_uye_aktarim_kayitlari_sil(p_ids bigint[] default null, p_hepsi boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adet integer;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi geçmişi silebilir.';
  end if;
  if coalesce(p_hepsi, false) then
    delete from public.uye_aktarim_kayitlari
     where id in (select k.id from public.uye_aktarim_kayitlari k);
  elsif p_ids is not null and cardinality(p_ids) > 0 then
    delete from public.uye_aktarim_kayitlari where id = any (p_ids);
  else
    return 0;
  end if;
  get diagnostics v_adet = row_count;
  return v_adet;
end;
$$;
revoke all on function public.owner_uye_aktarim_kayitlari_sil(bigint[], boolean) from public, anon;
grant execute on function public.owner_uye_aktarim_kayitlari_sil(bigint[], boolean) to authenticated;

-- 1b) Denetim kayıtları (aynı hata; 0052'deki "Tümünü temizle")
create or replace function public.owner_denetim_kayitlarini_temizle(p_su_tarihten_once timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_silinen bigint;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: denetim kayıtlarını topluca silme yetkisi sadece Site Sahibi''ne (owner) aittir.';
  end if;

  if p_su_tarihten_once is null then
    delete from public.denetim_kayitlari
     where id in (select d.id from public.denetim_kayitlari d);
  else
    delete from public.denetim_kayitlari where olusturuldu < p_su_tarihten_once;
  end if;

  get diagnostics v_silinen = row_count;
  return v_silinen;
end;
$$;

-- 2) Hukuki paket: iki sürüm tek işlemde
create or replace function public.hukuki_paket_surumu_yayinla(p_surum text, p_riza_da boolean default true)
returns table (kvkk_surumu text, riza_surumu text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yeni text := btrim(coalesce(p_surum, ''));
begin
  if not public.kvkk_surum_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: hukuki metin sürümünü değiştirme yetkin yok.';
  end if;
  if v_yeni !~ '^v[0-9]{1,3}\.[0-9]{1,3}$' then
    raise exception 'Sürüm "v1.2" biçiminde olmalı.';
  end if;

  return query
  update public.site_ayarlari s
     set guncel_kvkk_surumu = v_yeni,
         guncel_riza_surumu = case when coalesce(p_riza_da, true) then v_yeni else s.guncel_riza_surumu end
   where s.id = 1
  returning s.guncel_kvkk_surumu, s.guncel_riza_surumu;

  if not found then
    raise exception 'Ayar satırı bulunamadı.';
  end if;
end;
$$;
revoke all on function public.hukuki_paket_surumu_yayinla(text, boolean) from public, anon;
grant execute on function public.hukuki_paket_surumu_yayinla(text, boolean) to authenticated;
