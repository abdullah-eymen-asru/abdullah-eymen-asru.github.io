-- ============================================================================
-- 0108_yetki_anahtarlari_admin_erisimi_denetim.sql
-- Gereksinim: 0048, 0057, 0059, 0060, 0074, 0077, 0079, 0102. Tekrar çalıştırmak güvenlidir.
--
--  1) Yeni yetki anahtarları (Rol Matrisi, varsayılan KAPALI, yalnızca Yönetici sütunu; Site Sahibi her zaman açık):
--       • izleme_okuma_yonetimi   — "İzleme ve Okuma Yönetimi" modülü (eskiden yalnızca owner)
--       • kilitli_kasa_temizleme  — "Kilitli Not Kasalarını Temizleme" (Site Sahibi: AÇIK, Yönetici: KAPALI)
--  2) Yetkili Yönetici (yetki_ayarlari anahtarı açık) Notlarım (kişi bazlı) ve Dosya Yöneticisi izinlerini ADMİN DIŞI roller / kişiler
--     için düzenleyebilir. Admin/owner hedefleri ve kendi yetkisi HER ZAMAN yalnızca Site Sahibi'nindir.
--  3) Kilitli not kasası temizleme RPC'leri (parolası unutulup açılamayan kasalar; R2 silmesini Worker yapar).
--  4) Yetki ayarlarında yapılan HER değişiklik denetim_kayitlari'na (kim, ne, ne zaman) trigger ile otomatik yazılır.
-- ============================================================================

-- ---------------------------------------------------------------------------- 1) anahtarlar
alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_anahtar_chk;
alter table public.ozellik_varsayilan_kapali
  add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in
    ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme'));

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme') and p_rol <> 'admin' then raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

-- Anahtar kapılayıcıları: owner her zaman; admin yalnızca askıda değil + anahtar açık.
create or replace function public.izleme_okuma_yonetimi_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'owner'
                      or (p.role = 'admin' and not coalesce(p.is_suspended, false)
                          and exists (select 1 from public.ozellik_varsayilan_kapali o
                                      where o.ozellik_anahtari = 'izleme_okuma_yonetimi' and o.rol = 'admin' and o.acik))
                     from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.izleme_okuma_yonetimi_yetkili() from public, anon;
grant execute on function public.izleme_okuma_yonetimi_yetkili() to authenticated;

create or replace function public.kilitli_kasa_temizleme_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'owner'
                      or (p.role = 'admin' and not coalesce(p.is_suspended, false)
                          and exists (select 1 from public.ozellik_varsayilan_kapali o
                                      where o.ozellik_anahtari = 'kilitli_kasa_temizleme' and o.rol = 'admin' and o.acik))
                     from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.kilitli_kasa_temizleme_yetkili() from public, anon;
grant execute on function public.kilitli_kasa_temizleme_yetkili() to authenticated;

-- ---------------------------------------------------------------------------- 2) Dosya Yöneticisi izinleri (admin dışı hedefler)
create or replace function public.r2_arsiv_izinlerini_getir()
returns table (hedef_tur text, hedef text, ad text, oku boolean, yukle boolean, sil boolean)
language sql stable security definer set search_path = public as $$
  select i.hedef_tur, i.hedef,
         case when i.hedef_tur = 'kullanici' then coalesce(p.full_name, '(silinmiş kullanıcı)') else i.hedef end,
         i.oku, i.yukle, i.sil
  from public.r2_arsiv_izinleri i
  left join public.profiles p on i.hedef_tur = 'kullanici' and p.id::text = i.hedef
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
    and (public.is_owner()
         or (i.hedef_tur = 'rol' and i.hedef <> 'admin')
         or (i.hedef_tur = 'kullanici' and coalesce(p.role, '') not in ('admin', 'owner')))
  order by i.hedef_tur desc, 3;
$$;
revoke all on function public.r2_arsiv_izinlerini_getir() from public, anon;
grant execute on function public.r2_arsiv_izinlerini_getir() to authenticated;

create or replace function public.r2_arsiv_izin_ayarla(p_tur text, p_hedef text, p_oku boolean, p_yukle boolean, p_sil boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: izinleri yalnızca Site Sahibi ya da yetkili Yönetici değiştirebilir.' using errcode = '42501';
  end if;
  if not public.is_owner() then
    if p_tur = 'rol' and p_hedef = 'admin' then
      raise exception 'Yönetici rolünün izinlerini yalnızca Site Sahibi değiştirebilir.' using errcode = '42501';
    end if;
    if p_tur = 'kullanici' and exists (select 1 from public.profiles where id::text = p_hedef and role in ('admin', 'owner')) then
      raise exception 'Yönetici/Site Sahibi için yalnızca Site Sahibi izin verebilir.' using errcode = '42501';
    end if;
  end if;
  if p_tur = 'kullanici' and exists (select 1 from public.profiles where id::text = p_hedef and role = 'owner') then
    raise exception 'Site Sahibi için izin kaydı tutulmaz (zaten kısıtlanamaz).';
  end if;
  insert into public.r2_arsiv_izinleri (hedef_tur, hedef, oku, yukle, sil, guncelleyen_id)
  values (p_tur, p_hedef, p_oku, p_yukle, p_sil, auth.uid())
  on conflict (hedef_tur, hedef)
  do update set oku = excluded.oku, yukle = excluded.yukle, sil = excluded.sil, guncelleyen_id = auth.uid(), updated_at = now();
end;
$$;
revoke all on function public.r2_arsiv_izin_ayarla(text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.r2_arsiv_izin_ayarla(text, text, boolean, boolean, boolean) to authenticated;

create or replace function public.r2_arsiv_izin_kaldir(p_tur text, p_hedef text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if not public.is_owner() then
    if p_tur = 'rol' and p_hedef = 'admin' then raise exception 'Yönetici rolünün izinlerini yalnızca Site Sahibi değiştirebilir.' using errcode = '42501'; end if;
    if p_tur = 'kullanici' and exists (select 1 from public.profiles where id::text = p_hedef and role in ('admin', 'owner')) then
      raise exception 'Yönetici/Site Sahibi için yalnızca Site Sahibi izin kaldırabilir.' using errcode = '42501';
    end if;
  end if;
  delete from public.r2_arsiv_izinleri where hedef_tur = p_tur and hedef = p_hedef;
end;
$$;
revoke all on function public.r2_arsiv_izin_kaldir(text, text) from public, anon;
grant execute on function public.r2_arsiv_izin_kaldir(text, text) to authenticated;

-- ---------------------------------------------------------------------------- 2b) Notlarım kişi bazlı erişim (admin dışı hedefler)
create or replace function public.owner_ozellik_kullanici_ayarla(p_ozellik text, p_user_id uuid, p_izinli boolean)
returns void language plpgsql security definer set search_path = public as $$
declare hedef_rol text;
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: kullanıcı bazlı erişimi yalnızca Site Sahibi ya da yetkili Yönetici değiştirebilir.';
  end if;
  if not (p_ozellik = any (array['notlar_modulu'])) then raise exception 'Bu özellik kullanıcı bazında yönetilemez: %', p_ozellik; end if;
  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  if hedef_rol = 'owner' then raise exception 'owner kullanıcısına kısıtlama konamaz.'; end if;
  if hedef_rol = 'admin' and not public.is_owner() then raise exception 'Yönetici için yalnızca Site Sahibi ayar yapabilir.'; end if;
  if p_izinli then
    delete from public.ozellik_kullanici_kisitlari where ozellik_anahtari = p_ozellik and user_id = p_user_id;
  else
    insert into public.ozellik_kullanici_kisitlari (ozellik_anahtari, user_id, guncelleyen_id)
    values (p_ozellik, p_user_id, auth.uid())
    on conflict (ozellik_anahtari, user_id) do update set guncelleyen_id = auth.uid();
  end if;
end;
$$;

create or replace function public.ozellik_kullanici_kisitlarini_getir(p_ozellik text)
returns table (user_id uuid, full_name text, email text, rol text, kisitlama_tarihi timestamptz)
language sql stable security definer set search_path = public as $$
  select k.user_id, p.full_name, p.email, p.role, k.created_at
  from public.ozellik_kullanici_kisitlari k
  join public.profiles p on p.id = k.user_id
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
    and (public.is_owner() or p.role <> 'admin')
    and k.ozellik_anahtari = p_ozellik
  order by k.created_at desc;
$$;

create or replace function public.owner_ozellik_uye_ara(p_ozellik text, p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, kisitli boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role,
         exists (select 1 from public.ozellik_kullanici_kisitlari k where k.user_id = p.id and k.ozellik_anahtari = p_ozellik)
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role in ('editor', 'manager', 'admin')
    and (public.is_owner() or p.role <> 'admin')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

create or replace function public.owner_ozellik_izin_ver(p_ozellik text, p_user_id uuid, p_izinli boolean)
returns void language plpgsql security definer set search_path = public as $$
declare hedef_rol text;
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üyelere özellik açmayı yalnızca Site Sahibi ya da yetkili Yönetici yapabilir.';
  end if;
  if not (p_ozellik = any (array['notlar_modulu'])) then raise exception 'Bu özellik kullanıcı bazında açılamaz: %', p_ozellik; end if;
  if not p_izinli then
    delete from public.ozellik_kullanici_izinleri where ozellik_anahtari = p_ozellik and user_id = p_user_id;
    return;
  end if;
  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  if hedef_rol not in ('user', 'special_user') then
    raise exception 'Bu kullanıcının rolü (%) zaten modülü kullanabiliyor ya da kullanamaz; izin yalnızca user / special_user için.', hedef_rol;
  end if;
  insert into public.ozellik_kullanici_izinleri (ozellik_anahtari, user_id, guncelleyen_id)
  values (p_ozellik, p_user_id, auth.uid())
  on conflict (ozellik_anahtari, user_id) do update set guncelleyen_id = auth.uid();
end;
$$;

create or replace function public.ozellik_kullanici_izinlerini_getir(p_ozellik text)
returns table (user_id uuid, full_name text, email text, rol text, izin_tarihi timestamptz)
language sql stable security definer set search_path = public as $$
  select i.user_id, p.full_name, p.email, p.role, i.created_at
  from public.ozellik_kullanici_izinleri i
  join public.profiles p on p.id = i.user_id
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi() and i.ozellik_anahtari = p_ozellik
  order by i.created_at desc;
$$;

create or replace function public.owner_ozellik_uye_ara_izin(p_ozellik text, p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, izinli boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role,
         exists (select 1 from public.ozellik_kullanici_izinleri i where i.user_id = p.id and i.ozellik_anahtari = p_ozellik)
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.yetki_ayarlari_yonetim_yetkisi_var_mi()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role in ('user', 'special_user')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

-- ---------------------------------------------------------------------------- 3) Kilitli not kasalarını temizleme
-- Hedef kural: Site Sahibi herkesi; yetkili Yönetici yalnızca admin/owner OLMAYAN hesapların kasasını temizleyebilir. Kendi kasası hariç.
create or replace function public._kilitli_kasa_hedef_uygun_mu(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.kilitli_kasa_temizleme_yetkili()
     and p_user is distinct from auth.uid()
     and (public.is_owner() or coalesce((select p.role from public.profiles p where p.id = p_user), 'owner') not in ('admin', 'owner'));
$$;
revoke all on function public._kilitli_kasa_hedef_uygun_mu(uuid) from public, anon;
grant execute on function public._kilitli_kasa_hedef_uygun_mu(uuid) to authenticated;

create or replace function public.kilitli_kasa_listesi()
returns table (user_id uuid, ad text, rol text, kasa_tarihi timestamptz, not_sayisi bigint, ek_sayisi bigint, ek_bayt bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.kilitli_kasa_temizleme_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
    select k.user_id,
           coalesce(nullif(btrim(p.full_name), ''), p.email, 'Silinmiş hesap'),
           coalesce(p.role, '—'),
           k.created_at,
           (select count(*) from public.notlar n where n.user_id = k.user_id),
           (select count(*) from public.not_ek_kayitlari e where e.user_id = k.user_id),
           coalesce((select sum(e.boyut_bayt) from public.not_ek_kayitlari e where e.user_id = k.user_id), 0)::bigint
      from public.not_kasasi k
      left join public.profiles p on p.id = k.user_id
     where k.user_id is distinct from auth.uid()
       and (public.is_owner() or coalesce(p.role, '') not in ('admin', 'owner'))
     order by k.created_at;
end;
$$;
revoke all on function public.kilitli_kasa_listesi() from public, anon;
grant execute on function public.kilitli_kasa_listesi() to authenticated;

-- Worker adım 1: yetkiyi doğrular, silinecek R2 anahtarlarını döner (henüz hiçbir şey silmez).
create or replace function public.kilitli_kasa_temizleme_hazirla(p_user uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public._kilitli_kasa_hedef_uygun_mu(p_user) then raise exception 'Bu kasayı temizleme yetkin yok.' using errcode = '42501'; end if;
  return coalesce((select array_agg(e.r2_key) from public.not_ek_kayitlari e where e.user_id = p_user), '{}');
end;
$$;
revoke all on function public.kilitli_kasa_temizleme_hazirla(uuid) from public, anon;
grant execute on function public.kilitli_kasa_temizleme_hazirla(uuid) to authenticated;

-- Worker adım 2 (R2 nesneleri silindikten SONRA): veritabanı satırlarını kalıcı siler + denetim kaydı. Soft-delete izi kalmaz.
create or replace function public.kilitli_kasa_temizle(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_not bigint; v_ek bigint; v_hedef text;
begin
  if not public._kilitli_kasa_hedef_uygun_mu(p_user) then raise exception 'Bu kasayı temizleme yetkin yok.' using errcode = '42501'; end if;
  select coalesce(nullif(btrim(full_name), ''), email, p_user::text) into v_hedef from public.profiles where id = p_user;
  delete from public.notlar where user_id = p_user;               get diagnostics v_not = row_count;
  delete from public.not_ek_kayitlari where user_id = p_user;     get diagnostics v_ek = row_count;
  delete from public.not_kasasi where user_id = p_user;
  insert into public.denetim_kayitlari (aktor_id, aktor_email, aktor_rol, yontem, hedef_yol, sonuc, kaynak)
  select auth.uid(), p.email, p.role, 'SIL', left(format('Kilitli not kasası temizlendi · hedef: %s · %s not, %s ek', coalesce(v_hedef, p_user::text), v_not, v_ek), 500), 'izin_verildi', 'kilitli_kasa_temizleme'
    from public.profiles p where p.id = auth.uid();
  return jsonb_build_object('not', v_not, 'ek', v_ek);
end;
$$;
revoke all on function public.kilitli_kasa_temizle(uuid) from public, anon;
grant execute on function public.kilitli_kasa_temizle(uuid) to authenticated;

-- ---------------------------------------------------------------------------- 4) Yetki değişikliği denetim günlüğü (otomatik)
create or replace function public.yetki_degisikligi_denetle()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_satir jsonb := to_jsonb(coalesce(new, old));
  v_detay text; v_durum text; v_hedef text;
begin
  if v_uid is null then return coalesce(new, old); end if;          -- SQL Editor/servis değişikliklerinde aktör yok: iz yazılmaz
  if v_satir ? 'user_id' then
    select coalesce(nullif(btrim(full_name), ''), email, v_satir ->> 'user_id') into v_hedef from public.profiles where id = (v_satir ->> 'user_id')::uuid;
  end if;
  v_detay := case TG_TABLE_NAME
    when 'ozellik_erisimleri' then format('Özellik erişimi · %s · %s → %s', v_satir ->> 'ozellik_anahtari', v_satir ->> 'rol',
        case when TG_OP = 'DELETE' then 'varsayılana döndü' when (v_satir ->> 'izinli')::boolean then 'AÇIK' else 'KAPALI' end)
    when 'ozellik_varsayilan_kapali' then format('Özellik anahtarı · %s · %s → %s', v_satir ->> 'ozellik_anahtari', v_satir ->> 'rol',
        case when TG_OP = 'DELETE' then 'varsayılana (KAPALI) döndü' when (v_satir ->> 'acik')::boolean then 'AÇIK' else 'KAPALI' end)
    when 'donusturucu_yetkileri' then format('Gelişmiş Belge ve Gizlilik Araçları · %s → %s', v_satir ->> 'rol',
        case when TG_OP = 'DELETE' then 'varsayılana döndü' when (v_satir ->> 'can_use_converter')::boolean then 'AÇIK' else 'KAPALI' end)
    when 'sistem_export_yetkileri' then format('Sistem yedekleme · %s → %s', v_satir ->> 'rol',
        case when TG_OP = 'DELETE' then 'varsayılana döndü' when (v_satir ->> 'can_export_system')::boolean then 'AÇIK' else 'KAPALI' end)
    when 'r2_arsiv_izinleri' then format('Dosya Yöneticisi izni · %s %s · %s',
        v_satir ->> 'hedef_tur', case when v_satir ->> 'hedef_tur' = 'kullanici' then coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id::text = v_satir ->> 'hedef'), v_satir ->> 'hedef') else v_satir ->> 'hedef' end,
        case when TG_OP = 'DELETE' then 'kayıt kaldırıldı' else format('oku=%s yükle=%s sil=%s', v_satir ->> 'oku', v_satir ->> 'yukle', v_satir ->> 'sil') end)
    when 'ozellik_kullanici_kisitlari' then format('Kişi bazlı kısıt · %s · %s → %s', v_satir ->> 'ozellik_anahtari', coalesce(v_hedef, '?'), case when TG_OP = 'DELETE' then 'kısıt kaldırıldı (açık)' else 'KAPATILDI' end)
    when 'ozellik_kullanici_izinleri' then format('Kişi bazlı izin · %s · %s → %s', v_satir ->> 'ozellik_anahtari', coalesce(v_hedef, '?'), case when TG_OP = 'DELETE' then 'izin kaldırıldı' else 'İZİN VERİLDİ' end)
    else TG_TABLE_NAME || ' ' || TG_OP
  end;
  insert into public.denetim_kayitlari (aktor_id, aktor_email, aktor_rol, yontem, hedef_yol, sonuc, kaynak)
  select v_uid, p.email, p.role, 'YETKI', left(v_detay, 500), 'izin_verildi', 'yetki_ayarlari'
    from public.profiles p where p.id = v_uid;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ozellik_erisimleri', 'ozellik_varsayilan_kapali', 'donusturucu_yetkileri', 'sistem_export_yetkileri',
                           'r2_arsiv_izinleri', 'ozellik_kullanici_kisitlari', 'ozellik_kullanici_izinleri'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_yetki_denetim on public.%I', t);
      execute format('create trigger trg_yetki_denetim after insert or update or delete on public.%I for each row execute function public.yetki_degisikligi_denetle()', t);
    end if;
  end loop;
end $$;
