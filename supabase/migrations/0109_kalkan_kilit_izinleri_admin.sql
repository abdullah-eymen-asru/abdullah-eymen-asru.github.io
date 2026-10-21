-- ============================================================================
-- 0109_kalkan_kilit_izinleri_admin.sql — Erişim Kalkanı › "Kilitli siteyi görme izni" (üye bazlı) listesini yetkili Yönetici de yönetebilir.
-- Kural (0108 ile aynı): Site Sahibi her zaman; Yönetici yalnızca Yetki Ayarları erişimi açıksa (yetki_ayarlari_yonetim_yetkisi_var_mi).
-- Hedefler zaten owner/admin OLMAYAN üyelerle sınırlıdır (fonksiyon bunu zorlar). Site GENELİ kilit ayarları (alan adı kalkanı, kilit modu)
-- site_ayarlari üzerindeki RLS ile YALNIZCA Site Sahibi'nde kalır — bu migration onlara dokunmaz. İşlemler gk_log_yaz ile günlüğe düşer.
-- ============================================================================
create or replace function public.owner_site_onizleme_izni_ver(p_user_id uuid, p_izinli boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  hedef_rol text; hedef_ad text; silinen uuid;
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: kilitli siteyi görme izni vermeyi yalnızca Site Sahibi ya da yetkili Yönetici yapabilir.';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into hedef_ad from public.profiles where id = p_user_id;

  if not p_izinli then
    delete from public.site_onizleme_izinleri where user_id = p_user_id returning user_id into silinen;
    if silinen is not null then
      perform public.gk_log_yaz('onizleme_izni_kaldirildi', coalesce(hedef_ad, 'Bir üye') || ' için kilitli siteyi görme izni kaldırıldı',
        jsonb_build_object('onizleme_izni', jsonb_build_object('eski', true, 'yeni', false)), p_user_id);
    end if;
    return;
  end if;

  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  if hedef_rol in ('owner', 'admin') then
    raise exception 'Bu kullanıcı (%) kilitli siteyi zaten otomatik görür; ayrıca izin gerekmez.', hedef_rol;
  end if;
  if not exists (select 1 from public.site_onizleme_izinleri where user_id = p_user_id) then
    perform public.gk_log_yaz('onizleme_izni_verildi', coalesce(hedef_ad, 'Bir üye') || ' için kilitli siteyi görme izni verildi',
      jsonb_build_object('onizleme_izni', jsonb_build_object('eski', false, 'yeni', true)), p_user_id);
  end if;
  insert into public.site_onizleme_izinleri (user_id, veren_id) values (p_user_id, auth.uid())
  on conflict (user_id) do update set veren_id = auth.uid();
end;
$$;

create or replace function public.site_onizleme_izinlilerini_getir()
returns table (user_id uuid, full_name text, email text, rol text, izin_tarihi timestamptz)
language sql stable security definer set search_path = public as $$
  select i.user_id, p.full_name, p.email, p.role, i.created_at
  from public.site_onizleme_izinleri i
  join public.profiles p on p.id = i.user_id
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
  order by i.created_at desc;
$$;

create or replace function public.owner_site_onizleme_uye_ara(p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, izinli boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role,
         exists (select 1 from public.site_onizleme_izinleri i where i.user_id = p.id)
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role not in ('owner', 'admin')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

revoke all on function public.owner_site_onizleme_izni_ver(uuid, boolean) from public, anon;
revoke all on function public.site_onizleme_izinlilerini_getir() from public, anon;
revoke all on function public.owner_site_onizleme_uye_ara(text) from public, anon;
grant execute on function public.owner_site_onizleme_izni_ver(uuid, boolean) to authenticated;
grant execute on function public.site_onizleme_izinlilerini_getir() to authenticated;
grant execute on function public.owner_site_onizleme_uye_ara(text) to authenticated;
