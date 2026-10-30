-- ============================================================================
-- 0122_akademik_cop_kutusu.sql — Akademik Kütüphane ÇÖP KUTUSU (yumuşak silme)
-- Silinen kaynak/klasör önce çöp kutusuna gider (PDF R2'de DURUR); çöpten "kalıcı sil" yapılırsa tamamen silinir; "geri yükle" aynen geri getirir
-- (klasör üyelikleri, notlar, açıklamalar ve PDF korunur). Gereksinim: 0072, 0117. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
alter table public.akademik_kaynaklar   add column if not exists silindi_tarihi timestamptz;
alter table public.akademik_koleksiyonlar add column if not exists silindi_tarihi timestamptz;
create index if not exists akademik_kaynaklar_cop_idx   on public.akademik_kaynaklar (user_id, silindi_tarihi) where silindi_tarihi is not null;
create index if not exists akademik_koleksiyonlar_cop_idx on public.akademik_koleksiyonlar (user_id, silindi_tarihi) where silindi_tarihi is not null;

-- Sahibin (owner) üye listesi çöpteki kaynakları GÖSTERMEZ (imza aynı: create or replace).
create or replace function public.owner_akademik_kaynaklari_getir(p_user_id uuid default null)
returns table (
  id uuid, user_id uuid, sahip_ad text, sahip_eposta text, sahip_rol text,
  baslik text, yazarlar jsonb, yayin_yili smallint, dergi_veya_yayinevi text,
  doi text, isbn text, url text, ozet text, etiketler text[], ek_alanlar jsonb, tur text,
  pdf_r2_yolu text, pdf_dosya_adi text, pdf_boyut_bayt bigint, pdf_rev integer,
  gorunurluk text, olusturma_tarihi timestamptz, guncelleme_tarihi timestamptz,
  not_sayisi bigint
)
language sql stable security definer set search_path = public
as $$
  select k.id, k.user_id, p.full_name, p.email, p.role,
         k.baslik, k.yazarlar, k.yayin_yili, k.dergi_veya_yayinevi,
         k.doi, k.isbn, k.url, k.ozet, k.etiketler, k.ek_alanlar, k.tur,
         k.pdf_r2_yolu, k.pdf_dosya_adi, k.pdf_boyut_bayt, k.pdf_rev,
         k.gorunurluk, k.olusturma_tarihi, k.guncelleme_tarihi,
         (select count(*) from public.akademik_notlar n where n.kaynak_id = k.id)
  from public.akademik_kaynaklar k
  join public.profiles p on p.id = k.user_id
  where public.is_owner()
    and k.silindi_tarihi is null
    and (p_user_id is null or k.user_id = p_user_id)
  order by k.guncelleme_tarihi desc;
$$;
revoke all on function public.owner_akademik_kaynaklari_getir(uuid) from public, anon;
grant execute on function public.owner_akademik_kaynaklari_getir(uuid) to authenticated;
-- Not: kaynak/klasör satırlarını sahibi zaten kendi RLS politikalarıyla günceller/siler; yeni politika gerekmez.
