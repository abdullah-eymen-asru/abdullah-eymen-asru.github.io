-- ============================================================================
-- 0134_tur20_onay_geri_cek.sql — Onay Kutusu: onaylanmış içeriğin onayını geri çekme.
-- Yönetici (admin) ve Site Sahibi yapabilir; durum tekrar 'bekliyor' olur (inceleme aşaması). Rol kuralı: kendi yazısı hariç, yazarın rol sırası çekenin
-- rol sırasından DÜŞÜK olmalı (Site Sahibi her şeyi geri çekebilir). Geri çekme notu isteğe bağlıdır ve yazara düzeltme notu olarak iletilir.
-- Gereksinim: 0133. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create or replace function public.yazi_onay_geri_cek(p_taslak_id uuid, p_not text default null)
returns text language plpgsql security definer set search_path = public as $$
declare t public.taslak_icerikler; v_yazar_rol text; v_ben_rol text; v_not text := nullif(btrim(coalesce(p_not, '')), '');
begin
  if auth.uid() is null or not (public.is_admin() or public.is_owner()) then raise exception 'Onayı yalnızca yönetici ya da Site Sahibi geri çekebilir.' using errcode = '42501'; end if;
  select * into t from public.taslak_icerikler where id = p_taslak_id;
  if t.id is null then raise exception 'Taslak bulunamadı.'; end if;
  if not exists (select 1 from public.yazi_inceleme where taslak_id = p_taslak_id and durum = 'onaylandi') then raise exception 'Bu yazı onaylı değil.'; end if;
  select role into v_ben_rol from public.profiles where id = auth.uid();
  select role into v_yazar_rol from public.profiles where id = t.created_by;
  if not public.is_owner() and t.created_by is distinct from auth.uid() and public._rol_sirasi(v_yazar_rol) >= public._rol_sirasi(v_ben_rol) then
    raise exception 'Eşit ya da üst yetkideki birinin yazısının onayını geri çekemezsin.' using errcode = '42501';
  end if;
  update public.yazi_inceleme set durum = 'bekliyor', karar_veren_id = auth.uid(), karar_tarihi = now(), updated_at = now() where taslak_id = p_taslak_id;
  if v_not is not null then insert into public.yazi_inceleme_notlari (taslak_id, yazan_id, metin) values (p_taslak_id, auth.uid(), 'Onay geri çekildi: ' || v_not); end if;
  return 'bekliyor';
end $$;
revoke all on function public.yazi_onay_geri_cek(uuid, text) from public, anon;
grant execute on function public.yazi_onay_geri_cek(uuid, text) to authenticated;
