-- ============================================================================
-- 0150 — 'demo' rollündeki GERÇEK hesap: (1) sitede yorum yazabilsin, (2) KENDİ verisini dışa/içe aktarabilsin.
-- Önkoşul: 0083, 0084, 0094, 0137–0140. Tekrar çalıştırılabilir (idempotent). İSTEMEZSEN ÇALIŞTIRMA: demo hesapları yalnızca eskisi gibi kalır.
--
-- Güvenlik tasarımı (neden bu kadar?):
--   • Bu RPC'ler SECURITY DEFINER'dır ve RLS'i aşar; bu yüzden 'demo' rolü 0084'te bilerek dışarıda bırakılmıştı. Şimdi YALNIZCA şunlar açılır:
--       - yorum_ekle: 'demo' engeli kalkar (askıdaki hesap yine yazamaz). Düzenle/sil zaten yalnızca yazarın kendi yorumuna işler.
--       - sistem_export_uye_yetkisi_var_mi: 'demo' dahil (kapsam yine yalnızca 'kendi'; tam sistem/hassas veri yalnızca Site Sahibi).
--   • Demo hesabı için GERİ YÜKLEME daraltılır: yalnızca veritabanı tabloları notlar/not_kasasi/akademik_notlar ve en çok 200 satır.
--     R2 anahtarlı tablolar (arşiv, ek, akademik PDF) ve Worker üzerinden R2'ye yazma demo hesabında KAPALI (depolama/egress kotası harcanmaz).
-- ============================================================================

-- 1) yorum_ekle: 'demo' engelini kaldır (fonksiyon gövdesi olduğu gibi korunur; yalnızca ilgili koşul değişir)
do $$
declare f record; d text; yeni text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'yorum_ekle' loop
    d := pg_get_functiondef(f.oid);
    yeni := replace(d, '(coalesce(is_suspended, false) or role = ''demo'')', 'coalesce(is_suspended, false)');
    if yeni <> d then execute yeni; end if;
  end loop;
end $$;

-- 2) Kendi verini dışa/içe aktarma kapısı: 'demo' dahil (askıda değilse)
create or replace function public.sistem_export_uye_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (p.role = 'owner' or not coalesce(p.is_suspended, false)) from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.sistem_export_uye_yetkisi_var_mi() from public, anon;
grant execute on function public.sistem_export_uye_yetkisi_var_mi() to authenticated;

-- 3) Demo için geri yükleme daraltması (sarmalayıcı): asıl işlev adı değişir, aynı imzayla yeni işlev önüne geçer
do $$
begin
  if to_regprocedure('public._uye_geri_yukle_tablo_ic(text,jsonb,text)') is null then
    alter function public.uye_geri_yukle_tablo(text, jsonb, text) rename to _uye_geri_yukle_tablo_ic;
    revoke all on function public._uye_geri_yukle_tablo_ic(text, jsonb, text) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.uye_geri_yukle_tablo(p_tablo text, p_satirlar jsonb, p_mod text default 'eksikleri')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(public.is_demo(), false) then
    if p_tablo is null or p_tablo not in ('notlar', 'not_kasasi', 'akademik_notlar') then
      raise exception 'Demo hesabında bu tablo geri yüklenemez (yalnızca notlar).' using errcode = '42501';
    end if;
    if p_satirlar is null or jsonb_typeof(p_satirlar) <> 'array' or jsonb_array_length(p_satirlar) > 200 then
      raise exception 'Demo hesabında en çok 200 satır geri yüklenir.' using errcode = '42501';
    end if;
  end if;
  return public._uye_geri_yukle_tablo_ic(p_tablo, p_satirlar, p_mod);
end $$;
revoke all on function public.uye_geri_yukle_tablo(text, jsonb, text) from public, anon;
grant execute on function public.uye_geri_yukle_tablo(text, jsonb, text) to authenticated;

-- 4) Demo hesabı Worker üzerinden R2'ye yazamaz
do $$
begin
  if to_regprocedure('public._uye_r2_yukleme_izinli_mi_ic(text,text)') is null then
    alter function public.uye_r2_yukleme_izinli_mi(text, text) rename to _uye_r2_yukleme_izinli_mi_ic;
    revoke all on function public._uye_r2_yukleme_izinli_mi_ic(text, text) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.uye_r2_yukleme_izinli_mi(p_kaynak text, p_anahtar text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.is_demo(), false) then return false; end if;
  return public._uye_r2_yukleme_izinli_mi_ic(p_kaynak, p_anahtar);
end $$;
revoke all on function public.uye_r2_yukleme_izinli_mi(text, text) from public, anon;
grant execute on function public.uye_r2_yukleme_izinli_mi(text, text) to authenticated;
