-- ============================================================================
-- 0110_uye_aktarim_yonetici_devri_ve_arama.sql
-- Gereksinim: 0069, 0071, 0073, 0108 (yetki_ayarlari_yonetim_yetkisi_var_mi). Tekrar çalıştırmak güvenlidir.
--
--  1) "Üye verisi indirme" izinlerini yetkili YÖNETİCİ (Yetki Ayarları erişimi açık) de yönetebilir — GÜVENLİ DEVİR kuralıyla:
--       • kendi iznini değiştiremez; yalnızca Site Sahibi değiştirir,
--       • kendi indirme yetkisi yoksa başkasına veremez,
--       • verdiği kapsam, KENDİ kapsamının alt kümesi olmalı (tüm üyeler / roller / tek tek üyeler),
--       • kapsamı kendininkini aşan mevcut bir izni değiştiremez/kaldıramaz.
--     İndirme geçmişini görebilir; geçmişi SİLME yalnızca Site Sahibi'nde kalır.
--  2) uye_aktarim_kapsamim(): kapsamındaki üyelerde AD / E-POSTA ARAMASI (sunucu tarafı, sayfalı; denetim kaydı yazmaz).
--  3) Yöneticiler listesine e-posta eklenir (arama için).
--  4) uye_aktarim_yetkileri değişiklikleri denetim günlüğüne (denetim_kayitlari) otomatik yazılır.
-- ============================================================================

-- kapsam alt kümesi yardımcı: p_cagiran, (p_tum, p_roller, p_ekstra) kapsamını kendi yetkisiyle verebilir mi?
create or replace function public._uye_aktarim_kapsam_icinde(p_cagiran uuid, p_tum boolean, p_roller text[], p_ekstra uuid[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_rol text; c public.uye_aktarim_yetkileri%rowtype;
begin
  select role into v_rol from public.profiles where id = p_cagiran;
  if v_rol = 'owner' then return true; end if;
  select * into c from public.uye_aktarim_yetkileri where yetkili_id = p_cagiran;
  if not found then return false; end if;
  if coalesce(p_tum, false) and not c.tum_uyeler then return false; end if;
  if not c.tum_uyeler and exists (select 1 from unnest(coalesce(p_roller, '{}'::text[])) r where r <> all (c.hedef_roller)) then return false; end if;
  if exists (select 1 from unnest(coalesce(p_ekstra, '{}'::uuid[])) e join public.profiles pe on pe.id = e
              where not public.uye_aktarim_erisebilir(p_cagiran, pe.id, pe.role)) then return false; end if;
  return true;
end;
$$;
revoke all on function public._uye_aktarim_kapsam_icinde(uuid, boolean, text[], uuid[]) from public, anon, authenticated;

-- 1a) Yönetici listesi (+e-posta)
drop function if exists public.owner_uye_aktarim_yoneticileri();
create or replace function public.owner_uye_aktarim_yoneticileri()
returns table (yetkili_id uuid, yetkili_ad text, yetkili_email text, izinli boolean,
               tum_uyeler boolean, hedef_roller text[], ekstra_uyeler uuid[], haric_uyeler uuid[], kendisi boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
  select p.id, coalesce(public.profil_tam_ad(p.id), 'İsimsiz yönetici'), p.email, (y.yetkili_id is not null),
         coalesce(y.tum_uyeler, false), coalesce(y.hedef_roller, '{}'), coalesce(y.ekstra_uyeler, '{}'), coalesce(y.haric_uyeler, '{}'),
         (p.id = auth.uid())
  from public.profiles p
  left join public.uye_aktarim_yetkileri y on y.yetkili_id = p.id
  where p.role = 'admin'
  order by public.profil_tam_ad(p.id) nulls last;
end;
$$;
revoke all on function public.owner_uye_aktarim_yoneticileri() from public, anon;
grant execute on function public.owner_uye_aktarim_yoneticileri() to authenticated;

-- 1b) İzin ver (güvenli devir)
create or replace function public.owner_uye_aktarim_yetkisi_ver(p_yetkili uuid, p_tum boolean, p_roller text[], p_ekstra uuid[] default '{}', p_haric uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_rol text; h public.uye_aktarim_yetkileri%rowtype;
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi ya da yetkili Yönetici izin verebilir.'; end if;
  select role into v_rol from public.profiles where id = p_yetkili;
  if v_rol is null then raise exception 'Üye bulunamadı.'; end if;
  if v_rol = 'owner' then raise exception 'Site Sahibi zaten tam yetkilidir.'; end if;
  if v_rol <> 'admin' then raise exception 'Bu izin yalnızca Yönetici (admin) rolündeki üyelere verilebilir.'; end if;
  if not public.is_owner() then
    if p_yetkili = auth.uid() then raise exception 'Kendi indirme iznini yalnızca Site Sahibi değiştirebilir.' using errcode = '42501'; end if;
    if not exists (select 1 from public.uye_aktarim_yetkileri where yetkili_id = auth.uid()) then
      raise exception 'Üye verisi indirme yetkin olmadığı için başkasına izin veremezsin.' using errcode = '42501';
    end if;
    if not public._uye_aktarim_kapsam_icinde(auth.uid(), p_tum, p_roller, p_ekstra) then
      raise exception 'Verdiğin kapsam, kendi kapsamından geniş olamaz (tüm üyeler / roller / tek tek üyeler).' using errcode = '42501';
    end if;
    select * into h from public.uye_aktarim_yetkileri where yetkili_id = p_yetkili;
    if found and not public._uye_aktarim_kapsam_icinde(auth.uid(), h.tum_uyeler, h.hedef_roller, h.ekstra_uyeler) then
      raise exception 'Bu yöneticinin mevcut kapsamı seninkinden geniş; yalnızca Site Sahibi değiştirebilir.' using errcode = '42501';
    end if;
  end if;
  insert into public.uye_aktarim_yetkileri as y (yetkili_id, tum_uyeler, hedef_roller, ekstra_uyeler, haric_uyeler, veren_id)
  values (p_yetkili, coalesce(p_tum, false), coalesce(p_roller, '{}'), coalesce(p_ekstra, '{}'), coalesce(p_haric, '{}'), auth.uid())
  on conflict (yetkili_id) do update
    set tum_uyeler = excluded.tum_uyeler, hedef_roller = excluded.hedef_roller, ekstra_uyeler = excluded.ekstra_uyeler,
        haric_uyeler = excluded.haric_uyeler, veren_id = excluded.veren_id, updated_at = now();
end;
$$;
revoke all on function public.owner_uye_aktarim_yetkisi_ver(uuid, boolean, text[], uuid[], uuid[]) from public, anon;
grant execute on function public.owner_uye_aktarim_yetkisi_ver(uuid, boolean, text[], uuid[], uuid[]) to authenticated;

-- 1c) İzni kaldır (güvenli devir)
create or replace function public.owner_uye_aktarim_yetkisi_kaldir(p_yetkili uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h public.uye_aktarim_yetkileri%rowtype;
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  if not public.is_owner() then
    if p_yetkili = auth.uid() then raise exception 'Kendi indirme iznini yalnızca Site Sahibi değiştirebilir.' using errcode = '42501'; end if;
    select * into h from public.uye_aktarim_yetkileri where yetkili_id = p_yetkili;
    if found and not public._uye_aktarim_kapsam_icinde(auth.uid(), h.tum_uyeler, h.hedef_roller, h.ekstra_uyeler) then
      raise exception 'Bu yöneticinin kapsamı seninkinden geniş; yalnızca Site Sahibi kaldırabilir.' using errcode = '42501';
    end if;
  end if;
  delete from public.uye_aktarim_yetkileri where yetkili_id = p_yetkili;
end;
$$;
revoke all on function public.owner_uye_aktarim_yetkisi_kaldir(uuid) from public, anon;
grant execute on function public.owner_uye_aktarim_yetkisi_kaldir(uuid) to authenticated;

-- 1d) İndirme geçmişi: okuma yetkili yöneticiye de açık; silme (owner_uye_aktarim_kayitlari_sil) Site Sahibi'nde kalır.
create or replace function public.owner_uye_aktarim_kayitlari(p_limit integer default 50)
returns table (id bigint, created_at timestamptz, yetkili_ad text, yetkili_rol text, adet integer, bicim text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.yetki_ayarlari_yonetim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
  select k.id, k.created_at, coalesce(public.profil_tam_ad(k.yetkili_id), nullif(btrim(k.yetkili_ad), ''), 'Silinmiş üye'),
         (select p.role from public.profiles p where p.id = k.yetkili_id), k.adet, k.bicim
  from public.uye_aktarim_kayitlari k
  order by k.created_at desc, k.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;
revoke all on function public.owner_uye_aktarim_kayitlari(integer) from public, anon;
grant execute on function public.owner_uye_aktarim_kayitlari(integer) to authenticated;

-- 2) Kapsamımdaki üyelerde ad/e-posta araması (sayfalı; indirme günlüğüne YAZMAZ)
create or replace function public.uye_aktarim_kapsamim(p_ara text default null, p_limit integer default 30, p_sayfa integer default 0)
returns table (id uuid, ad text, email text, role text, toplam bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_lim integer := least(greatest(coalesce(p_limit, 30), 1), 100); v_kalip text;
begin
  if not public.uye_aktarim_yetkisi_var_mi() then raise exception 'Yetkisiz işlem: üye verisini dışa aktarma yetkin yok.' using errcode = '42501'; end if;
  v_kalip := '%' || replace(replace(replace(btrim(coalesce(p_ara, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, coalesce(public.profil_tam_ad(p.id), 'İsimsiz üye'), p.email, p.role, count(*) over ()
  from public.profiles p
  where public.uye_aktarim_erisebilir(auth.uid(), p.id, p.role)
    and (btrim(coalesce(p_ara, '')) = '' or p.full_name ilike v_kalip or p.email ilike v_kalip
         or coalesce(public.profil_tam_ad(p.id), '') ilike v_kalip)
  order by coalesce(public.profil_tam_ad(p.id), 'İsimsiz üye'), p.email
  limit v_lim offset greatest(coalesce(p_sayfa, 0), 0) * v_lim;
end;
$$;
revoke all on function public.uye_aktarim_kapsamim(text, integer, integer) from public, anon;
grant execute on function public.uye_aktarim_kapsamim(text, integer, integer) to authenticated;

-- 4) Denetim: uye_aktarim_yetkileri değişiklikleri
create or replace function public.uye_aktarim_yetki_denetle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_satir jsonb := to_jsonb(coalesce(new, old)); v_hedef text; v_detay text;
begin
  if v_uid is null then return coalesce(new, old); end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_hedef from public.profiles where id = (v_satir ->> 'yetkili_id')::uuid;
  v_detay := case when TG_OP = 'DELETE' then format('Üye verisi indirme izni · %s · kaldırıldı', coalesce(v_hedef, '?'))
    else format('Üye verisi indirme izni · %s · %s', coalesce(v_hedef, '?'),
      case when (v_satir ->> 'tum_uyeler')::boolean then 'TÜM ÜYELER' else format('roller=%s, ek üye=%s', v_satir ->> 'hedef_roller', jsonb_array_length(coalesce(v_satir -> 'ekstra_uyeler', '[]'::jsonb))) end) end;
  insert into public.denetim_kayitlari (aktor_id, aktor_email, aktor_rol, yontem, hedef_yol, sonuc, kaynak)
  select v_uid, p.email, p.role, 'YETKI', left(v_detay, 500), 'izin_verildi', 'yetki_ayarlari' from public.profiles p where p.id = v_uid;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_uye_aktarim_denetim on public.uye_aktarim_yetkileri;
create trigger trg_uye_aktarim_denetim after insert or update or delete on public.uye_aktarim_yetkileri for each row execute function public.uye_aktarim_yetki_denetle();
