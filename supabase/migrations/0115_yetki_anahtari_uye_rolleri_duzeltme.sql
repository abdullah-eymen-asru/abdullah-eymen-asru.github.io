-- ============================================================================
-- 0115_yetki_anahtari_uye_rolleri_duzeltme.sql
-- HATA: Yetki Ayarları › Özellikler'de HavaStil'i "Özel Üye" / "Üye" sütunlarında açmak "Geçersiz rol." veriyordu.
-- KÖK NEDEN: 0099 üye rollerini (special_user, user) 'havastil' için tanımlamıştı; 0108 ve 0113, owner_kapali_ozellik_ayarla()
--            fonksiyonunu yeniden yazarken rol listesini yalnızca ('admin','manager','editor') bıraktı → gerileme (regression).
-- ÇÖZÜM: Güncel anahtar listesi (0113) + 0099'daki rol kapsamı birlikte geri getirildi.
--   • 'havastil'                         : admin, manager, editor, special_user, user
--   • 'hesap_silme_onayi','yetki_ayarlari': admin, manager, editor            (üye rolleri için tanımsız — eski kural)
--   • yalnızca-admin anahtarlar (havastil_groq_kota, izleme_okuma_yonetimi, kilitli_kasa_temizleme, duyuru_yonetimi): admin
-- ============================================================================
do $$
begin
  alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_rol_chk;
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_rol_chk check (rol in ('admin', 'manager', 'editor', 'special_user', 'user'));
end $$;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('hesap_silme_onayi', 'yetki_ayarlari') and p_rol in ('special_user', 'user') then raise exception 'Bu özellik üye rolleri için tanımlı değil.'; end if;
  if p_ozellik in ('havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi') and p_rol <> 'admin' then raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;
