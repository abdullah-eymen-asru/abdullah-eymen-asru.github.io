-- ============================================================================
-- 0055_supabase_yayin_guvenlik_ve_seo_rpc.sql
-- "GitHub yerine Supabase'te depola" (yayin_durumu='sadece_supabase') akışını
-- sağlamlaştırır. 4 bağımsız parça, hepsi idempotent (tekrar çalıştırılabilir):
--
--   1) YAZAR TAKLİDİ TETİKLEYİCİSİ — bir admin/editor/manager, "adına
--      yayınla (onay gerekir)" akışına girmeden başka bir admin ya da Site
--      Sahibi (owner) adına GERÇEKTEN yayında bir satır oluşturamaz.
--      NEDEN: Cloudflare Worker bu kuralı SADECE GitHub'a giden yazmalarda
--      (Seçenek A/B) uyguluyor (bkz. github_icerik_yonetim_worker/worker.js
--      "yazarHedefiOwnerVeyaAdminMi"). Supabase-only yayın Worker'a hiç
--      uğramadan doğrudan bu tabloya yazdığı için o kural burada UYGULANMIYOR
--      ve taslak_admin_onay_koru tetikleyicisi (0016/0023/0026) SADECE
--      admin_adina_talep / sahip_adina_talep işaretli satırları koruyordu.
--   2) SLUG BENZERSİZLİĞİ — aynı (tur, slug) ile birden çok 'sadece_supabase'
--      satırı olursa sadece_supabase_yazi_getir() `limit 1` ile rastgele
--      birini döndürürdü; canonical/sitemap adresi de belirsizleşirdi.
--   3) SITEMAP RPC'Sİ — supabase/functions/sitemap-supabase artık her
--      yazının TAM gövdesini çekmek yerine sadece (tur, slug, lastmod) alır.
--   4) FEED RPC'Sİ — supabase/functions/feed-supabase (tam metin Atom feed)
--      için; GitHub'a commit edilmeyen yazılar statik feed.xml/rss.xml'e
--      giremediği için ayrı bir feed üretilir.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0054 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) YAZAR TAKLİDİ TETİKLEYİCİSİ
--    Kural (Worker'daki ile AYNI mantık): çağıran owner DEĞİLSE ve satır
--    gerçekten yayında bir duruma ('sadece_supabase' / 'supabase_ve_github')
--    geçiyorsa, yazar_id çağıranın KENDİSİ olmak zorundadır — ya da hedef
--    bir owner/admin DEĞİLDİR (başka bir editor/manager adına yazmak bu
--    kuralın konusu değil, Worker da buna izin veriyor).
--
--    MUAF OLANLAR:
--      - Gizli taslaklar (yayin_durumu='taslak'): henüz yayında değil;
--        yayına geçişte tetikleyici yine çalışır.
--      - admin_adina_talep / sahip_adina_talep işaretli satırlar: onay akışı
--        (taslak_admin_onay_koru) zaten yayını onaya bağlıyor.
--      - owner: kendi adına da, başkası adına da yazabilir.
--      - auth.uid() NULL olan çağrılar (service_role / SQL Editor / Edge
--        Function): oturumlu bir kullanıcı yok, taklit söz konusu değil.
--      - Zaten yayında olan bir satırın yazar_id'si ve durumu DEĞİŞMEDEN
--        düzenlenmesi (ör. yazım hatası düzeltme) — bu, taklit DEĞİL; o
--        düzenleme yetkisi RLS'in (0028) konusu.
-- ----------------------------------------------------------------------------
create or replace function public.taslak_yazar_taklit_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_rol text;
begin
  if new.yayin_durumu not in ('sadece_supabase', 'supabase_ve_github') then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if new.admin_adina_talep or new.sahip_adina_talep then
    return new;
  end if;
  if public.is_owner() then
    return new;
  end if;
  if new.yazar_id is null or new.yazar_id = auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.yazar_id is not distinct from new.yazar_id
     and old.yayin_durumu is not distinct from new.yayin_durumu then
    return new;
  end if;

  select p.role into hedef_rol from public.profiles p where p.id = new.yazar_id;
  if hedef_rol in ('owner', 'admin') then
    raise exception 'Bir Yönetici ya da Site Sahibi adına doğrudan yayınlayamazsın — bu, onay gerektiren bir işlemdir. "Admin/Site Sahibi adına yayınla (onay gerekir)" kutusunu işaretleyip o akışı kullan.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.taslak_yazar_taklit_koru() is
  'Owner olmayan biri, adına yayınla (onay) akışına girmeden bir owner/admin adına yayında (sadece_supabase / supabase_ve_github) satır oluşturamaz. Worker''daki yazarHedefiOwnerVeyaAdminMi kuralının Supabase-only yayın yolundaki karşılığı.';

drop trigger if exists trg_taslak_yazar_taklit_koru on public.taslak_icerikler;
create trigger trg_taslak_yazar_taklit_koru
  before insert or update on public.taslak_icerikler
  for each row execute function public.taslak_yazar_taklit_koru();

-- ----------------------------------------------------------------------------
-- 2) SLUG BENZERSİZLİĞİ (sadece yayında olan 'sadece_supabase' satırlar için)
--    Gizli taslaklar ve GitHub'la birlikte tutulan satırlar bilerek KAPSAM
--    DIŞI: aynı slug ile bir taslak hazırlanabilir, çakışma yalnızca
--    "Sadece Supabase'te Yayınla" anında (panel bunu anlaşılır bir hata
--    mesajına çevirir) ortaya çıkar. Mevcut veride zaten çakışma varsa
--    indeks OLUŞTURULMAZ (migration'ın tamamı bozulmasın diye) ve NOTICE ile
--    hangi slug'ların çakıştığı yazılır — onları düzeltip bu bloğu tekrar
--    çalıştır.
-- ----------------------------------------------------------------------------
do $$
declare
  cakisanlar text;
begin
  select string_agg(tur || '/' || slug, ', ')
    into cakisanlar
  from (
    select tur, slug
    from public.taslak_icerikler
    where yayin_durumu = 'sadece_supabase'
    group by tur, slug
    having count(*) > 1
  ) c;

  if cakisanlar is not null then
    raise notice 'uq_taslak_icerikler_sadece_supabase_slug OLUŞTURULMADI — çakışan slug''lar: %. Birini yeniden adlandırıp bu bloğu tekrar çalıştır.', cakisanlar;
  else
    create unique index if not exists uq_taslak_icerikler_sadece_supabase_slug
      on public.taslak_icerikler (tur, slug)
      where yayin_durumu = 'sadece_supabase';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) SITEMAP RPC'Sİ — sadece adres bilgisi (gövde YOK). lastmod: son
--    güncelleme/revizyon tarihi, yoksa yayın tarihi.
-- ----------------------------------------------------------------------------
create or replace function public.sadece_supabase_sitemap_listele()
returns table (
  tur     text,
  slug    text,
  lastmod date
)
language sql
stable
security definer
set search_path = public
as $$
  select t.tur, t.slug, coalesce(t.last_modified_at, t.guncelleme_tarihi, t.tarih) as lastmod
  from public.taslak_icerikler t
  where t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  order by t.tarih desc;
$$;

grant execute on function public.sadece_supabase_sitemap_listele() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) FEED RPC'Sİ — en yeni p_limit (1-100) yayın, TAM gövdeyle. id/created_by/
--    onizleme_kod gibi iç alanlar dönmez; yalnızca yayında ve tarihi gelmiş
--    'sadece_supabase' satırlar görünür.
-- ----------------------------------------------------------------------------
create or replace function public.sadece_supabase_feed_listele(p_limit int default 30)
returns table (
  tur        text,
  slug       text,
  baslik     text,
  tarih      date,
  guncelleme date,
  ozet       text,
  yazar_adi  text,
  govde      text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.tur, t.slug, t.baslik, t.tarih,
         coalesce(t.last_modified_at, t.guncelleme_tarihi, t.tarih) as guncelleme,
         t.ozet, t.yazar_adi, t.govde
  from public.taslak_icerikler t
  where t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  order by t.tarih desc, t.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

grant execute on function public.sadece_supabase_feed_listele(int) to anon, authenticated;

-- ============================================================================
-- BİTTİ. Test (SQL Editor'de, oturumlu bir kullanıcı gerektirenler panelden):
-- 1) select * from public.sadece_supabase_sitemap_listele();
--    select tur, slug, baslik from public.sadece_supabase_feed_listele(5);
-- 2) Panelde admin (owner DEĞİL) olarak "Yazar" alanından Site Sahibi'ni
--    seç, "GitHub yerine Supabase'te depola" AÇIK iken yayınla → "Bir
--    Yönetici ya da Site Sahibi adına doğrudan yayınlayamazsın..." hatası
--    gelmeli. Aynı işlem kendi adınla başarılı olmalı.
-- 3) Aynı slug ile ikinci bir "Sadece Supabase'te Yayınla" → slug çakışması
--    hatası (panel anlaşılır mesaja çevirir).
-- ============================================================================
