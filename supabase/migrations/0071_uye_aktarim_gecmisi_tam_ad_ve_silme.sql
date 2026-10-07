-- ============================================================================
-- 0071_uye_aktarim_gecmisi_tam_ad_ve_silme.sql
-- Üye verisi indirme GEÇMİŞİ: indirenin TAM ADI + Site Sahibi'nin kayıt silmesi; yönetici listesi RPC'si.
-- Tekrar çalıştırmak güvenlidir. Gereksinim: 0069.
--
--   1) owner_uye_aktarim_kayitlari  — artık id, indirenin GÜNCEL tam adı (ad soyad), rolü döndürür
--      (ad, indirme anında değil görüntülenirken profilden okunur; profil silinmişse kayıttaki ad kullanılır).
--   2) owner_uye_aktarim_kayitlari_sil — yalnızca Site Sahibi; seçili kayıtları ya da tümünü siler.
--   3) owner_uye_aktarim_yoneticileri  — TÜM yöneticiler + mevcut indirme kapsamı (sade yetki ekranı için).
-- ============================================================================

-- Tam ad: ad soyad > ad + soyad > e-posta
create or replace function public.profil_tam_ad(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    p.email
  )
  from public.profiles p where p.id = p_id;
$$;
revoke all on function public.profil_tam_ad(uuid) from public, anon, authenticated;

-- 1) Geçmiş (dönüş tipi değiştiği için önce düşür)
drop function if exists public.owner_uye_aktarim_kayitlari(integer);

create or replace function public.owner_uye_aktarim_kayitlari(p_limit integer default 50)
returns table (id bigint, created_at timestamptz, yetkili_ad text, yetkili_rol text, adet integer, bicim text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select k.id, k.created_at,
         coalesce(public.profil_tam_ad(k.yetkili_id), nullif(btrim(k.yetkili_ad), ''), 'Silinmiş üye'),
         (select p.role from public.profiles p where p.id = k.yetkili_id),
         k.adet, k.bicim
  from public.uye_aktarim_kayitlari k
  order by k.created_at desc, k.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;
revoke all on function public.owner_uye_aktarim_kayitlari(integer) from public, anon;
grant execute on function public.owner_uye_aktarim_kayitlari(integer) to authenticated;

-- Denetim kaydına yazılan ad da artık tam ad (eski kayıtlar görüntülemede güncel profilden çözülür)
create or replace function public.uye_verisi_disa_aktar(p_bicim text default null)
returns table (
  id                      uuid,
  email                   text,
  first_name              text,
  last_name               text,
  full_name               text,
  role                    text,
  created_at              timestamptz,
  is_suspended            boolean,
  email_dogrulama_tarihi  timestamptz,
  son_giris_tarihi        timestamptz,
  kvkk_onay_verildi       boolean,
  kvkk_onay_tarihi        timestamptz,
  kvkk_onay_versiyonu     text,
  yurtdisi_onay_verildi   boolean,
  yurtdisi_onay_tarihi    timestamptz,
  yurtdisi_onay_versiyonu text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_adet integer;
begin
  if not public.uye_aktarim_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üye verisini dışa aktarma yetkin yok.';
  end if;

  return query
  select p.id, p.email, p.first_name, p.last_name, p.full_name, p.role, p.created_at,
         coalesce(p.is_suspended, false),
         u.email_confirmed_at, u.last_sign_in_at,
         coalesce(p.kvkk_onay_verildi, false), p.kvkk_onay_tarihi, p.kvkk_onay_versiyonu,
         coalesce(p.yurtdisi_onay_verildi, false), p.yurtdisi_onay_tarihi, p.yurtdisi_onay_versiyonu
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.uye_aktarim_erisebilir(auth.uid(), p.id, p.role)
  order by p.created_at desc;

  get diagnostics v_adet = row_count;
  insert into public.uye_aktarim_kayitlari (yetkili_id, yetkili_ad, adet, bicim)
  values (auth.uid(), public.profil_tam_ad(auth.uid()), v_adet, left(coalesce(p_bicim, ''), 20));
end;
$$;
revoke all on function public.uye_verisi_disa_aktar(text) from public, anon;
grant execute on function public.uye_verisi_disa_aktar(text) to authenticated;

-- 2) Silme (yalnızca Site Sahibi). p_hepsi = true -> tüm geçmiş; aksi halde yalnızca p_ids.
create or replace function public.owner_uye_aktarim_kayitlari_sil(p_ids bigint[] default null, p_hepsi boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adet integer;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi geçmişi silebilir.';
  end if;
  if coalesce(p_hepsi, false) then
    delete from public.uye_aktarim_kayitlari;
  elsif p_ids is not null and cardinality(p_ids) > 0 then
    delete from public.uye_aktarim_kayitlari where id = any (p_ids);
  else
    return 0;
  end if;
  get diagnostics v_adet = row_count;
  return v_adet;
end;
$$;
revoke all on function public.owner_uye_aktarim_kayitlari_sil(bigint[], boolean) from public, anon;
grant execute on function public.owner_uye_aktarim_kayitlari_sil(bigint[], boolean) to authenticated;

-- 3) Tüm yöneticiler + mevcut kapsamları (izin satırı olmayan yönetici = erişim yok)
create or replace function public.owner_uye_aktarim_yoneticileri()
returns table (
  yetkili_id uuid, yetkili_ad text, izinli boolean,
  tum_uyeler boolean, hedef_roller text[], ekstra_uyeler uuid[], haric_uyeler uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return query
  select p.id, coalesce(public.profil_tam_ad(p.id), 'İsimsiz yönetici'), (y.yetkili_id is not null),
         coalesce(y.tum_uyeler, false), coalesce(y.hedef_roller, '{}'), coalesce(y.ekstra_uyeler, '{}'), coalesce(y.haric_uyeler, '{}')
  from public.profiles p
  left join public.uye_aktarim_yetkileri y on y.yetkili_id = p.id
  where p.role = 'admin'
  order by public.profil_tam_ad(p.id) nulls last;
end;
$$;
revoke all on function public.owner_uye_aktarim_yoneticileri() from public, anon;
grant execute on function public.owner_uye_aktarim_yoneticileri() to authenticated;
