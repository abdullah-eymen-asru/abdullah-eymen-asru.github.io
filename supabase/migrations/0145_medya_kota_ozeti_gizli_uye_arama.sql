-- ============================================================================
-- 0145_medya_kota_ozeti_gizli_uye_arama.sql — "Bugün en çok kullananlar" listesi
--  • Site Sahibi'nin gizlediği üyeler (gizli_uyeler) bu listede YALNIZCA Site Sahibi'ne (körlük kapalıyken) görünür;
--    yetkilendirilmiş Yönetici (admin) göremez. (Eskiden SECURITY DEFINER olduğu için RLS'yi aşıp adı sızdırıyordu.)
--  • Her satıra 'ara' alanı eklendi: küçük harfli e-posta + ad. Arayüz bunu SADECE arama için kullanır, EKRANA YAZMAZ.
--  • Satır sınırı 40 → 200 (arayüz kaydırmalı/açılır-kapanır).
-- Gereksinim: 0136, 0142. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create or replace function public.owner_medya_kota_ozeti()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.medya_kota_yonetim_yetkili() then raise exception 'Yetkisiz işlem: Site Sahibi ya da yetkilendirilmiş Yönetici gerekir.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'arac', (x->>'site')::bigint desc nulls last), '[]'::jsonb) into v from (
    select jsonb_build_object('arac', k.arac, 'ad', coalesce(nullif(btrim(p.full_name), ''), 'Üye'),
             'ara', lower(coalesce(p.email, '') || ' ' || coalesce(p.full_name, '')),
             'site', coalesce(sum(k.miktar) filter (where k.kaynak = 'site'), 0), 'kendi', coalesce(sum(k.miktar) filter (where k.kaynak = 'kendi'), 0),
             'istek', sum(k.istek)) x
      from public.medya_kota_kullanim k join public.profiles p on p.id = k.user_id
     where k.gun = public._medya_bugun()
       and (not public.uye_gizli_mi(k.user_id) or public.gizli_goruntulenebilir_mi())
     group by k.arac, k.user_id, p.full_name, p.email
     order by sum(k.miktar) desc limit 200) t;
  return v;
end $$;
revoke all on function public.owner_medya_kota_ozeti() from public, anon;
grant execute on function public.owner_medya_kota_ozeti() to authenticated;
