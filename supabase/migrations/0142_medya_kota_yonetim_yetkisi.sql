-- 0142 — Medya Kotaları sekmesi için YÖNETİCİ yetkisi (Yetki Ayarları › Özellikler › "Medya Kotaları Yönetimi").
-- Varsayılan KAPALI; Site Sahibi her zaman yapar. İdempotent. 0141'den sonra çalıştırılır.
do $$
begin
  alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_anahtar_chk;
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in (
      'hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi',
      'kilitli_kasa_temizleme', 'duyuru_yonetimi', 'arac_transkript', 'arac_medya_donustur', 'arac_medya_indir', 'yonetim_medya_kota'));
end $$;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi',
       'kilitli_kasa_temizleme', 'duyuru_yonetimi', 'arac_transkript', 'arac_medya_donustur', 'arac_medya_indir', 'yonetim_medya_kota') then
    raise exception 'Geçersiz özellik anahtarı.';
  end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('hesap_silme_onayi', 'yetki_ayarlari') and p_rol in ('special_user', 'user') then raise exception 'Bu özellik üye rolleri için tanımlı değil.'; end if;
  if p_ozellik in ('havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi', 'yonetim_medya_kota') and p_rol <> 'admin' then
    raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.';
  end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

create or replace function public.medya_kota_yonetim_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'owner'
                      or (p.role = 'admin' and not coalesce(p.is_suspended, false)
                          and exists (select 1 from public.ozellik_varsayilan_kapali o
                                      where o.ozellik_anahtari = 'yonetim_medya_kota' and o.rol = 'admin' and o.acik))
                     from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.medya_kota_yonetim_yetkili() from public, anon;
grant execute on function public.medya_kota_yonetim_yetkili() to authenticated;

drop function if exists public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean, boolean);
create or replace function public.owner_medya_kota_ayarla(
  p_arac text, p_kullanici bigint, p_genel bigint, p_kendi_izni boolean, p_sistem_acik boolean, p_kota_aktif boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.medya_kota_yonetim_yetkili() then raise exception 'Yetkisiz işlem: Site Sahibi ya da yetkilendirilmiş Yönetici gerekir.' using errcode = '42501'; end if;
  if p_kullanici is not null and p_kullanici < 0 or p_genel is not null and p_genel < 0 then raise exception 'Limit negatif olamaz.'; end if;
  update public.medya_kota_ayar
     set kullanici_gunluk = p_kullanici, genel_gunluk = p_genel,
         kendi_anahtar_izni = coalesce(p_kendi_izni, kendi_anahtar_izni),
         sistem_anahtari_acik = coalesce(p_sistem_acik, sistem_anahtari_acik),
         kota_aktif = coalesce(p_kota_aktif, kota_aktif),
         guncelleme = now(), guncelleyen = auth.uid()
   where arac = p_arac;
  if not found then raise exception 'Geçersiz araç.'; end if;
end $$;
revoke all on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean, boolean) from public, anon;
grant execute on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean, boolean) to authenticated;

create or replace function public.owner_medya_kota_ozeti()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.medya_kota_yonetim_yetkili() then raise exception 'Yetkisiz işlem: Site Sahibi ya da yetkilendirilmiş Yönetici gerekir.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'arac', (x->>'site')::bigint desc), '[]'::jsonb) into v from (
    select jsonb_build_object('arac', k.arac, 'ad', coalesce(nullif(btrim(p.full_name), ''), 'Üye'),
             'site', sum(k.miktar) filter (where k.kaynak = 'site'), 'kendi', coalesce(sum(k.miktar) filter (where k.kaynak = 'kendi'), 0),
             'istek', sum(k.istek)) x
      from public.medya_kota_kullanim k join public.profiles p on p.id = k.user_id
     where k.gun = public._medya_bugun()
     group by k.arac, k.user_id, p.full_name
     order by sum(k.miktar) desc limit 40) t;
  return v;
end $$;
revoke all on function public.owner_medya_kota_ozeti() from public, anon;
grant execute on function public.owner_medya_kota_ozeti() to authenticated;
