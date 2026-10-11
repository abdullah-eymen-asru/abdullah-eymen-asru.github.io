-- ============================================================================
-- 0079_yetki_ayarlari_admin_erisimi.sql
-- Tek bir ana anahtar: "Adminler Yetki Ayarları'na (Özellikler sekmesi) erişebilsin" (varsayılan KAPALI).
-- Önceki "Dönüştürücü: adminler de yönetebilsin" tekil ayarının yerini alır (donusturucu_ayar artık okunmaz).
-- Tekrar çalıştırmak güvenlidir. Gereksinim: 0048, 0074, 0077, 0078.
--
-- Açıkken yetkili admin YALNIZCA Özellikler tablosundaki "admin DIŞI roller" (manager/editor/special_user/user) satırlarını
-- görür ve değiştirir. Admin rolünün kendi anahtarları, Erişim Kalkanı, Kilit İzinleri, Dosya Yöneticisi ve Tezgâh izinleri
-- her zaman yalnızca Site Sahibi'nindir (admin kendi yetkisini genişletemez). Askıdaki admin hiçbir şey yapamaz.
-- ============================================================================

-- 1) Anahtar 'yetki_ayarlari' (ozellik_varsayilan_kapali tablosu, rol = admin)
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.ozellik_varsayilan_kapali'::regclass and c.contype = 'c'
             and pg_get_constraintdef(c.oid) ilike '%ozellik_anahtari%' loop
    execute format('alter table public.ozellik_varsayilan_kapali drop constraint %I', r.conname);
  end loop;
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in ('hesap_silme_onayi', 'yetki_ayarlari'));
end $$;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor') then raise exception 'Geçersiz rol.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;

-- 2) Yetki Ayarları'nı (admin dışı roller için) yönetebilir mi? owner her zaman; admin yalnızca anahtar açık + askıda değil.
create or replace function public.yetki_ayarlari_yonetim_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (p.role = 'admin' and not coalesce(p.is_suspended, false)
            and exists (select 1 from public.ozellik_varsayilan_kapali o
                        where o.ozellik_anahtari = 'yetki_ayarlari' and o.rol = 'admin' and o.acik))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.yetki_ayarlari_yonetim_yetkisi_var_mi() from public, anon;
grant execute on function public.yetki_ayarlari_yonetim_yetkisi_var_mi() to authenticated;

-- 3) Dönüştürücü yönetimi artık bu ana anahtara bağlı (eski tekil bayrak devre dışı).
create or replace function public.donusturucu_yonetim_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select public.yetki_ayarlari_yonetim_yetkisi_var_mi();
$$;

-- 4) Özellik matrisi: okuma (admin dışı rol satırları) ve yazma (admin/owner rolü hariç)
create or replace function public.ozellik_erisimlerini_getir()
returns table (ozellik_anahtari text, rol text, izinli boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.ozellik_anahtari, e.rol, e.izinli, e.updated_at
  from public.ozellik_erisimleri e
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi() and (public.is_owner() or e.rol not in ('admin', 'owner'))
  order by e.ozellik_anahtari, e.rol;
$$;

create or replace function public.owner_ozellik_erisimi_ayarla(p_ozellik text, p_rol text, p_izinli boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: özellik erişimlerini değiştirme yetkin yok.';
  end if;
  if p_rol not in ('user', 'special_user', 'editor', 'manager', 'admin', 'owner') then
    raise exception 'Geçersiz rol: %', p_rol;
  end if;
  if p_rol in ('admin', 'owner') and not public.is_owner() then
    raise exception 'Yetkisiz işlem: admin/owner rollerinin erişimini yalnızca Site Sahibi değiştirebilir.';
  end if;
  if p_rol = 'owner' and p_izinli = false then
    raise exception 'owner rolü için erişim kapatılamaz.';
  end if;
  if p_izinli then
    delete from public.ozellik_erisimleri where ozellik_anahtari = p_ozellik and rol = p_rol;
  else
    insert into public.ozellik_erisimleri (ozellik_anahtari, rol, izinli, guncelleyen_id)
    values (p_ozellik, p_rol, false, auth.uid())
    on conflict (ozellik_anahtari, rol)
    do update set izinli = false, guncelleyen_id = auth.uid(), updated_at = now();
  end if;
end $$;

-- 5) Sistem Yedekleme anahtarı (can_export_system): admin yalnızca manager/editor için
create or replace function public.owner_sistem_export_yetkilerini_getir()
returns table (rol text, can_export_system boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_owner boolean := public.is_owner();
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  return query
  select r.rol, coalesce(y.can_export_system, false), y.updated_at
  from (values ('admin'), ('manager'), ('editor')) as r(rol)
  left join public.sistem_export_yetkileri y on y.rol = r.rol
  where v_owner or r.rol <> 'admin'
  order by case r.rol when 'admin' then 1 when 'manager' then 2 else 3 end;
end $$;

create or replace function public.owner_sistem_export_yetkisi_ayarla(p_rol text, p_izinli boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  if p_rol not in ('admin', 'manager', 'editor') then
    raise exception 'Geçersiz rol: % (yalnızca admin, manager, editor).', p_rol;
  end if;
  if p_rol = 'admin' and not public.is_owner() then
    raise exception 'Yetkisiz işlem: admin rolünün anahtarını yalnızca Site Sahibi değiştirebilir.';
  end if;
  insert into public.sistem_export_yetkileri as y (rol, can_export_system, guncelleyen_id)
  values (p_rol, coalesce(p_izinli, false), auth.uid())
  on conflict (rol) do update
    set can_export_system = excluded.can_export_system, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;

-- 6) Varsayılan-kapalı satırların okunması: owner tam; yetkili admin yalnızca kendi rolü dışını (hesap_silme_onayi'nın
--    tek rolü admin olduğundan admin için boş döner) — böylece admin kendi yetkisini göremez/değiştiremez.
create or replace function public.kapali_ozellikleri_getir()
returns table (ozellik_anahtari text, rol text, acik boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  return query select o.ozellik_anahtari, o.rol, o.acik from public.ozellik_varsayilan_kapali o;
end $$;
