-- ============================================================================
-- 0063_r2_arsiv_turkce_duyarlilik.sql
--
-- 0057 / 0058 / 0062'nin ÜSTÜNE. Hepsi idempotent: tekrar çalıştırmak zararsız.
--
-- ÜÇ TÜRKÇE SORUNU DÜZELTİR
--  1) SIRALAMA: Veritabanının varsayılan sıralaması (C / en_US) Türkçe alfabeyi bilmez;
--     ç, ğ, ı, ö, ş, ü harfleri "z"den sonraya ya da yanlış yere düşer
--     (örn. "Çelik", "Zeynep"ten sonra gelir). r2_arsiv.ad_sira sütunu, her harfi alfabedeki
--     yerini gösteren sabit genişlikli bir koda çevirir; sıralama, veritabanının collation
--     ayarından BAĞIMSIZ olarak Türkçe alfabe sırasıyla (a b c ç d e f g ğ h ı i j … s ş t u ü v y z) çalışır.
--  2) ARAMA / NFD: macOS, dosya adlarını "ayrışık" (NFD) Unicode ile verir: "ö" = "o" + ¨ (iki parça).
--     Böyle bir ad, klavyeden yazılan "özgür" aramasıyla eşleşmezdi. (a) Arama normalizasyonu artık
--     birleştirici işaretleri atar; (b) yeni/değişen adlar tetikleyiciyle NFC'ye (tek parça) çevrilir;
--     (c) var olan NFD adlar aşağıda NFC'ye düzeltilir.
--  3) Aramada Türkçe I/İ/ı: "ISIK", "ışık", "isik", "Işık" aynı şeydir (önceden de böyleydi; NFD'yi de kapsar).
--
-- Worker'da değişiklik GEREKMEZ (NFC dönüşümü veritabanındaki tetikleyicide yapılır).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Arama normalizasyonu: NFD + birleştirici işaretleri at + İ/I/ı -> i + küçük harf
--    (public.tr_ara_normalize'ı 0058'deki sürümün yerine koyar; imza aynı)
-- ----------------------------------------------------------------------------
create or replace function public.tr_ara_normalize(p_metin text)
returns text
language sql immutable parallel safe
as $$
  select lower(translate(
           regexp_replace(normalize(coalesce(p_metin, ''), NFD), '[\u0300-\u036f]', '', 'g'),
           'İIı', 'iii'));
$$;

-- ----------------------------------------------------------------------------
-- 2) Türkçe alfabe sıralama anahtarı (doğal sayı sıralı: "dosya2" < "dosya10")
--    harf        -> '101'..'132' (alfabedeki sırası)
--    rakam dizisi-> '050' + uzunluk(3 hane) + rakamlar   (baştaki sıfırlar atılır: 03 = 3; kısa sayı önce; harflerden önce gelir)
--    diğerleri   -> '010' (boşluk, noktalama: her şeyden önce)
--    Anahtarlar yalnızca rakamlardan oluşur; düz metin karşılaştırması collation'dan bağımsız doğru sıralar.
-- ----------------------------------------------------------------------------
create or replace function public.tr_sirala(p_metin text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(string_agg(
           case
             when m.g[1] ~ '^[0-9]+$'
               then '050' || lpad(length(ltrim(m.g[1], '0'))::text, 3, '0') || ltrim(m.g[1], '0')
             when position(m.g[1] in 'abcçdefgğhıijklmnoöpqrsştuüvwxyz') > 0
               then (100 + position(m.g[1] in 'abcçdefgğhıijklmnoöpqrsştuüvwxyz'))::text
             else '010'
           end, '' order by m.ord), '')
    from regexp_matches(
           translate(normalize(coalesce(p_metin, ''), NFC),
                     'ABCÇDEFGĞHIİJKLMNOÖPQRSŞTUÜVWXYZ',
                     'abcçdefgğhıijklmnoöpqrsştuüvwxyz'),
           '[0-9]+|.', 'g') with ordinality as m(g, ord);
$$;

alter table public.r2_arsiv
  add column if not exists ad_sira text generated always as (public.tr_sirala(ad)) stored;

create index if not exists r2_arsiv_sira_idx on public.r2_arsiv (klasor_yolu, tur desc, ad_sira);

-- ----------------------------------------------------------------------------
-- 3) Dosya / klasör adları ve yolları daima NFC (tek parça Unicode)
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_nfc()
returns trigger
language plpgsql
as $$
begin
  new.ad          := normalize(new.ad, NFC);
  new.klasor_yolu := normalize(new.klasor_yolu, NFC);
  return new;
end;
$$;

drop trigger if exists trg_r2_arsiv_nfc on public.r2_arsiv;
create trigger trg_r2_arsiv_nfc
  before insert or update of ad, klasor_yolu on public.r2_arsiv
  for each row execute function public.r2_arsiv_nfc();

-- Var olan ayrışık (NFD) adları düzelt. Çakışan bir ad çıkarsa o kayıt atlanır (notice ile bildirilir).
do $$
declare r record; n int := 0; atlanan int := 0;
begin
  for r in select id from public.r2_arsiv
            where ad <> normalize(ad, NFC) or klasor_yolu <> normalize(klasor_yolu, NFC)
  loop
    begin
      update public.r2_arsiv set ad = ad where id = r.id;     -- tetikleyici NFC'ye çevirir
      n := n + 1;
    exception when unique_violation then
      atlanan := atlanan + 1;
    end;
  end loop;
  raise notice 'NFC düzeltmesi: % kayıt düzeltildi, % kayıt çakışma nedeniyle atlandı.', n, atlanan;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Arşiv araması: sonuçlar Türkçe alfabe sırasıyla (0062'deki sürümün yerine; imza aynı)
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_ara(p_q text, p_sinir int default 100)
returns setof public.r2_arsiv
language sql stable security invoker set search_path = public
as $$
  select a.*
    from public.r2_arsiv a
   where a.durum = 'hazir'
     and not a.sifreli
     and char_length(btrim(coalesce(p_q, ''))) >= 1
     and not exists (
           select 1
             from unnest(string_to_array(public.tr_ara_normalize(btrim(p_q)), ' ')) as t(tok)
            where t.tok <> ''
              and public.tr_ara_normalize(a.ad)
                  not like '%' || public.like_kacis(t.tok) || '%')
   order by a.tur desc, a.ad_sira, a.ad
   limit least(greatest(coalesce(p_sinir, 100), 1), 200);
$$;
revoke all on function public.r2_arsiv_ara(text, int) from public, anon;
grant execute on function public.r2_arsiv_ara(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Kullanıcı / alıcı araması: Türkçe alfabe sırası (0058'deki sürümün yerine; imza aynı)
-- ----------------------------------------------------------------------------
create or replace function public.arsiv_kullanici_ara(p_q text)
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
     order by (k.kullanici_id is not null) desc, public.tr_sirala(p.full_name), p.full_name
     limit 20;
end;
$$;
revoke all on function public.arsiv_kullanici_ara(text) from public, anon;
grant execute on function public.arsiv_kullanici_ara(text) to authenticated;
