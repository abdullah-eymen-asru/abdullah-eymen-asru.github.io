-- ============================================================================
-- 0112_yedek_notlar_kod_blobu.sql — "Notlarım" yedeği ORTAK Yedek Kurtarma Koduyla başka hesapta/altyapıda açılabilsin
-- Gereksinim: 0099, 0111. Tekrar çalıştırmak güvenlidir.
--
-- SORUN: Kişisel/Notlar bileşeni yalnızca notlar, not_kasasi, not_ek_kayitlari, akademik_* tablolarını içeriyordu. Notları (ve mesajları) açan
--        kod bilgisi — e2ee_kullanici_anahtarlari (açık anahtar + kit_sarili: Notlar DEK'i ve mesaj anahtarını kodla saran blob) — başka
--        tablo grubundaydı, pakete GİRMİYORDU. Paket başka hesapta içe aktarılırken Yedek Kurtarma Kodu ile yeniden zarflama için gereken kit eksik kalıyordu.
-- ÇÖZÜM: "notlar" bileşeni artık ÇAĞIRANIN KENDİ e2ee_kullanici_anahtarlari satırını da pakete koyar (yalnızca kendi; sarılı/şifreli veri — kodsuz anlamsız).
--        "veritabani"+tum zaten herkesinkini içeriyordu.
-- ============================================================================

create or replace function public.sistem_export_plan(l public.sistem_export_loglari)
returns table (tablo text, hedef text, kapsam text, kosul text)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select coalesce(array(select jsonb_array_elements_text(l.indirilen_bilesenler)), '{}'::text[]) as dizi
  ),
  h as (
    select '= any (' || quote_literal(l.hedef_kullanicilar::text) || '::uuid[])' as ifade
  )
  select x.tablo, x.hedef, x.kapsam,
         case when x.tablo = 'messages' and l.kapsam = 'tum' and not l.hassas_dahil then '(' || x.kosul || ') and sifreli' else x.kosul end
  from (
  select r.tablo,
         case
           when r.tablo in ('akademik_kaynaklar', 'akademik_notlar') and 'akademik' = any (b.dizi)
                and not ('veritabani' = any (b.dizi)) and not ('notlar' = any (b.dizi)) then 'akademik'
           when (r.grup = 'notlar' or r.tablo = 'e2ee_kullanici_anahtarlari') and 'notlar' = any (b.dizi)
                and not ('veritabani' = any (b.dizi)) then 'notlar'
           when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar'
           else 'veritabani'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'tum'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'tum'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri' then 'secili'
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'secili'
           else 'kendi'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'true'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'true'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           else r.kendi_kosul
         end
  from public.sistem_export_tablo_kayitlari() r, b, h
  where to_regclass('public.' || r.tablo) is not null
    and (
      ('veritabani' = any (b.dizi) and (
          (r.grup = 'veri' and not r.sadece_owner)
          or r.grup = 'notlar'
          or (r.sadece_owner and l.kapsam = 'tum' and (not r.hassas or l.hassas_dahil))
      ))
      or ('notlar' = any (b.dizi) and (r.grup = 'notlar' or r.tablo = 'e2ee_kullanici_anahtarlari'))
      or ('akademik' = any (b.dizi) and r.tablo in ('akademik_kaynaklar', 'akademik_notlar'))
    )
    and not (r.sadece_owner and l.kapsam <> 'tum')
  ) x(tablo, hedef, kapsam, kosul);
$$;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;
