-- 0098 — Bayat sohbet zarfını kendi kendine temizleme.
-- SORUN: Kullanıcının RSA anahtarı yenilendiğinde (sıfırlama / yeniden kurulum) bazı yollarda eski sohbet zarfları silinmeden kalıyordu.
-- Zarf satırı "var" göründüğü için mesaj_eksik_zarflar() onu eksik saymıyor, karşı taraf yeniden paylaşmıyor ve sohbet sonsuza dek
-- "anahtar yok" kalıyordu. İstemci, anahtar çiftinin tutarlı olduğunu doğruladıktan sonra YALNIZCA KENDİ bayat zarfını bu RPC ile siler;
-- böylece sohbet eksik zarflı sayılır ve anahtarı bilen taraf açtığında yeniden paylaşılır.
-- GÜVENLİK: yalnızca çağıranın kendi zarfı silinir (auth.uid()); sohbete erişimi olmayan çağıramaz; başkasının zarfına dokunulamaz.
create or replace function public.mesaj_bayat_zarfi_temizle(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  delete from public.konusma_zarflari where conversation_id = p_id and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.mesaj_bayat_zarfi_temizle(uuid) from public, anon;
grant execute on function public.mesaj_bayat_zarfi_temizle(uuid) to authenticated;
