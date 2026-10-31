-- ============================================================================
-- 0127_tur14_klasor_silme_secenekleri.sql
-- Bağlantı klasörünü silerken seçenek: içindeki bağlantılar ana klasöre TAŞINSIN (varsayılan) ya da klasörle BİRLİKTE SİLİNSİN.
-- Arşivdeki dosyalar hiçbir durumda silinmez (yalnızca paylaşım bağlantıları). Gereksinim: 0125.
-- ============================================================================
drop function if exists public.r2_baglanti_klasor_sil(text);
create or replace function public.r2_baglanti_klasor_sil(p_yol text, p_baglantilari_sil boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v text := public._r2_klasor_temizle(p_yol); n integer := 0;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v is null then raise exception 'Klasör bulunamadı.'; end if;
  if coalesce(p_baglantilari_sil, false) then
    delete from public.r2_baglantilari where user_id = auth.uid() and (klasor = v or klasor like v || '/%');
    get diagnostics n = row_count;
  else
    update public.r2_baglantilari set klasor = null where user_id = auth.uid() and (klasor = v or klasor like v || '/%');
    get diagnostics n = row_count;
  end if;
  delete from public.r2_baglanti_klasorleri where user_id = auth.uid() and (yol = v or yol like v || '/%');
  return n;
end $$;
revoke all on function public.r2_baglanti_klasor_sil(text, boolean) from public, anon;
grant execute on function public.r2_baglanti_klasor_sil(text, boolean) to authenticated;
