-- ============================================================================
-- 0058_r2_arsiv_arama_paylasim_duzeltme.sql
--
-- 0057'nin ÜSTÜNE eklenir (0057'yi değiştirmez, tekrar çalıştırmaya gerek yok).
-- Hepsi idempotent: iki kez çalıştırmak zararsız.
--
-- NE DÜZELTİLİYOR / EKLENİYOR
--  1) HATA: 0057'deki arsiv_kullanici_ara() içinde "id" ve "role" sütunları,
--     fonksiyonun RETURNS TABLE (id, full_name, role) çıktı değişkenleriyle
--     çakışıyordu (plpgsql "column reference is ambiguous" hatası). Alıcı/
--     kullanıcı araması bu yüzden bozuk ya da boş dönebiliyordu.
--     Yeni sürüm: çıktı adları çakışmıyor, hazır/değil bilgisi ekli.
--  2) İsim araması Türkçe-duyarsız ve çok kelimeli: "ahmet yil" = "Ahmet YILMAZ",
--     "isik" = "Işık", "ozgur" = "Özgür".
--  3) Dosya araması RPC'si (r2_arsiv_ara): aynı normalizasyon, tüm klasör ağacında.
--  4) Paylaşım yönetimi: bir şifreli dosyanın alıcılarını listele / kaldır; gönderen adı.
--  5) Özet: dosya sayısı + toplam boyut; ay içi R2 işlem sayacı (A/B).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Türkçe-duyarsız arama normalizasyonu (İ/I/ı -> i, ğ/ü/ş/ö/ç -> g/u/s/o/c, küçük harf)
-- ----------------------------------------------------------------------------
create or replace function public.tr_ara_normalize(p_metin text)
returns text
language sql immutable parallel safe
as $$
  select lower(translate(coalesce(p_metin, ''), 'İIıĞğÜüŞşÖöÇç', 'iiigguussoocc'));
$$;

-- LIKE joker karakterlerini kaçışla (kullanıcı '%' ya da '_' yazarsa her şeyle eşleşmesin)
create or replace function public.like_kacis(p_metin text)
returns text
language sql immutable parallel safe
as $$
  select replace(replace(replace(coalesce(p_metin, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- ----------------------------------------------------------------------------
-- 1) Kullanıcı / alıcı arama (çakışmasız çıktı adları)
-- ----------------------------------------------------------------------------
drop function if exists public.arsiv_kullanici_ara(text);

create function public.arsiv_kullanici_ara(p_q text)
returns table (kullanici_id uuid, ad text, rol text, anahtar_var boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_q text := public.tr_ara_normalize(btrim(coalesce(p_q, '')));
begin
  if auth.uid() is null
     or not (public.r2_arsiv_yetkim('yukle') or public.is_owner()) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;

  -- Boş arama = öneri listesi (önce anahtarı hazır olanlar); e-posta ASLA dönmez.
  return query
    select p.id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı'),
           p.role,
           (k.kullanici_id is not null)
      from public.profiles p
      left join public.e2ee_kullanici_anahtarlari k on k.kullanici_id = p.id
     where p.id <> auth.uid()
       and coalesce(p.is_suspended, false) = false
       and not exists (
             select 1
               from unnest(string_to_array(v_q, ' ')) as t(tok)
              where t.tok <> ''
                and public.tr_ara_normalize(p.full_name)
                    not like '%' || public.like_kacis(t.tok) || '%')
     order by (k.kullanici_id is not null) desc, p.full_name nulls last
     limit 20;
end;
$$;
revoke all on function public.arsiv_kullanici_ara(text) from public, anon;
grant execute on function public.arsiv_kullanici_ara(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Dosya/klasör arama — SECURITY INVOKER: r2_arsiv RLS'i aynen geçerli
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_ara(p_q text, p_sinir int default 100)
returns setof public.r2_arsiv
language sql stable security invoker set search_path = public
as $$
  select a.*
    from public.r2_arsiv a
   where a.durum = 'hazir'
     and (not a.sifreli or a.sahip_id = auth.uid())   -- başkasının şifreli dosyası "Benimle paylaşılanlar"da
     and char_length(btrim(coalesce(p_q, ''))) >= 1
     and not exists (
           select 1
             from unnest(string_to_array(public.tr_ara_normalize(btrim(p_q)), ' ')) as t(tok)
            where t.tok <> ''
              and public.tr_ara_normalize(a.ad)
                  not like '%' || public.like_kacis(t.tok) || '%')
   order by a.tur desc, a.ad
   limit least(greatest(coalesce(p_sinir, 100), 1), 200);
$$;
revoke all on function public.r2_arsiv_ara(text, int) from public, anon;
grant execute on function public.r2_arsiv_ara(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Paylaşım yönetimi (yalnızca dosyanın göndereni)
-- ----------------------------------------------------------------------------
create or replace function public.ozel_icerik_alicilari_getir(p_dosya_id uuid)
returns table (kullanici_id uuid, ad text, rol text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.r2_arsiv a
                  where a.id = p_dosya_id and a.sahip_id = auth.uid() and a.sifreli) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select k.alici_id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı'),
           p.role
      from public.ozel_icerik_anahtarlar k
      join public.profiles p on p.id = k.alici_id
     where k.dosya_id = p_dosya_id and k.alici_id <> auth.uid()
     order by p.full_name nulls last;
end;
$$;
revoke all on function public.ozel_icerik_alicilari_getir(uuid) from public, anon;
grant execute on function public.ozel_icerik_alicilari_getir(uuid) to authenticated;

create or replace function public.ozel_icerik_alici_kaldir(p_dosya_id uuid, p_alici_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_alici_id = auth.uid() then
    raise exception 'Kendi erişimini kaldıramazsın.';
  end if;
  if not exists (select 1 from public.r2_arsiv a
                  where a.id = p_dosya_id and a.sahip_id = auth.uid() and a.sifreli) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  delete from public.ozel_icerik_anahtarlar
   where dosya_id = p_dosya_id and alici_id = p_alici_id;
end;
$$;
revoke all on function public.ozel_icerik_alici_kaldir(uuid, uuid) from public, anon;
grant execute on function public.ozel_icerik_alici_kaldir(uuid, uuid) to authenticated;

-- "Benimle paylaşılanlar" listesinde gönderen adı (yalnızca alıcı olduğun dosyalar için)
create or replace function public.arsiv_gonderen_getir(p_dosya_idleri uuid[])
returns table (dosya_id uuid, ad text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select a.id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı')
      from public.r2_arsiv a
      join public.ozel_icerik_anahtarlar k on k.dosya_id = a.id and k.alici_id = auth.uid()
      left join public.profiles p on p.id = a.sahip_id
     where a.id = any (p_dosya_idleri[1:200]);
end;
$$;
revoke all on function public.arsiv_gonderen_getir(uuid[]) from public, anon;
grant execute on function public.arsiv_gonderen_getir(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Özet bilgiler
-- ----------------------------------------------------------------------------
-- Çağıranın görebildiği arşiv içeriği (RLS geçerli: security invoker)
create or replace function public.r2_arsiv_ozet()
returns table (dosya_sayisi bigint, klasor_sayisi bigint, toplam_boyut bigint)
language sql stable security invoker set search_path = public
as $$
  select count(*) filter (where a.tur = 'dosya'),
         count(*) filter (where a.tur = 'klasor'),
         coalesce(sum(a.boyut) filter (where a.tur = 'dosya'), 0)::bigint
    from public.r2_arsiv a
   where a.durum = 'hazir';
$$;
revoke all on function public.r2_arsiv_ozet() from public, anon;
grant execute on function public.r2_arsiv_ozet() to authenticated;

-- Bu ayki R2 işlem sayacı (yalnızca yükleme yetkisi olanlar görür)
create or replace function public.r2_kota_durumu()
returns table (sinif text, sayi bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.r2_arsiv_yetkim('yukle') or public.is_owner()) then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select s.sinif, s.sayi from public.r2_islem_sayaci s
     where s.ay = to_char(now() at time zone 'utc', 'YYYY-MM')
     order by s.sinif;
end;
$$;
revoke all on function public.r2_kota_durumu() from public, anon;
grant execute on function public.r2_kota_durumu() to authenticated;
