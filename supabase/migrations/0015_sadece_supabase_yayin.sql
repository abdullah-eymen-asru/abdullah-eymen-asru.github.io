-- ============================================================================
-- 0015_sadece_supabase_yayin.sql
-- Gerçek "sadece Supabase'te yayınla" desteği ekler: GitHub'a HİÇ commit
-- atmadan, içeriği doğrudan (herkese açık, arama/listede görünen) bir yazı
-- olarak yayınlama.
--
-- ÖNCEKİ DURUM (migration 0013/0014): "Yayında" kapalıyken içerik Supabase'te
-- duruyordu ama bu SADECE gizli bir taslaktı — sadece tahmin edilemez bir
-- /onizleme/?tur=...&kod=... linkini bilenler görebiliyordu, blog/proje
-- listesinde HİÇ görünmüyordu ve arama motorları tarafından indeksLENEMİYORDU.
-- Panelde "Yayında" AÇIKKEN sunulan iki seçenek (🅰️/🅱️) da her zaman GitHub'a
-- commit atıyordu — "GitHub'a commit atmadan yayınlama" seçeneği hiç yoktu.
--
-- BU MIGRATION: yayin_durumu enum'una 'sadece_supabase' değerini ekliyor ve
-- BU DURUMDAKİ satırları GÜVENLİ ŞEKİLDE herkese açık şekilde LİSTELEYEN ve
-- TEK TEK OKUYAN iki yeni public RPC tanımlıyor (taslak_onizleme_getir'in
-- aksine, bunlar id/created_by gibi iç alanları asla döndürmez ve sadece
-- yayin_durumu='sadece_supabase' olan satırlara bakar — 'taslak' durumundaki
-- GERÇEK gizli taslaklar bu RPC'lerden ASLA görünmez).
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0014 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) yayin_durumu enum'unu genişlet
--    'sadece_supabase' -> içerik GERÇEKTEN yayında (herkese açık, listede
--    görünür, arama motorları tarafından indekslenebilir) ama dosya olarak
--    GitHub'a HİÇ commit edilmemiştir; kalıcı olarak sadece bu tabloda durur.
-- ----------------------------------------------------------------------------
alter table public.taslak_icerikler drop constraint if exists taslak_icerikler_yayin_durumu_check;
alter table public.taslak_icerikler
  add constraint taslak_icerikler_yayin_durumu_check
  check (yayin_durumu in ('taslak', 'supabase_ve_github', 'sadece_github', 'sadece_supabase'));

comment on column public.taslak_icerikler.yayin_durumu is
  'taslak: gizli, sadece /onizleme/ linkiyle görülür | supabase_ve_github: GitHuba commitlendi + burada yedek olarak duruyor | sadece_github: bilgi amaçlı (pratikte satır kalmaz) | sadece_supabase: GERÇEKTEN yayında ama GitHuba hiç commit edilmedi, kalıcı olarak sadece burada duruyor';

-- ----------------------------------------------------------------------------
-- 2) PUBLIC LİSTELEME RPC'Sİ — blog.md / akademik-projeler.md kullanır
--    SADECE yayin_durumu='sadece_supabase' satırları döndürür; id, created_by,
--    onizleme_kod gibi iç/gizli alanlar döndürülmez. slug, listeleme
--    sayfasının detay sayfasına link üretebilmesi için döner (gizli bir kod
--    DEĞİLDİR, tıpkı GitHub'a commit edilmiş bir yazının slug'ı gibi herkese
--    açık bir tanımlayıcıdır).
-- ----------------------------------------------------------------------------
create or replace function public.sadece_supabase_yayinlari_listele(p_tur text)
returns table (
  slug        text,
  baslik      text,
  tarih       date,
  venue       text,
  durum       text,
  ozet        text,
  yazar_adi   text,
  govde       text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.slug, t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.yazar_adi, t.govde
  from public.taslak_icerikler t
  where t.tur = p_tur
    and t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  order by t.tarih desc;
$$;

grant execute on function public.sadece_supabase_yayinlari_listele(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) PUBLIC TEK YAZI RPC'Sİ — detay sayfası (icerik/supabase-yazi.md) kullanır
--    slug herkese açık bir tanımlayıcı olduğundan (gizli kod değildir) bu
--    RPC de sadece 'sadece_supabase' durumundaki satırlara bakar; 'taslak'
--    durumundaki GERÇEK gizli taslaklar (onizleme_kod gerektiren) yine
--    SADECE taslak_onizleme_getir() üzerinden erişilebilir kalır.
-- ----------------------------------------------------------------------------
create or replace function public.sadece_supabase_yazi_getir(p_tur text, p_slug text)
returns table (
  baslik      text,
  tarih       date,
  venue       text,
  durum       text,
  ozet        text,
  link        text,
  link_etiket text,
  yazar_adi   text,
  govde       text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.baslik, t.tarih, t.venue, t.durum, t.ozet, t.link, t.link_etiket, t.yazar_adi, t.govde
  from public.taslak_icerikler t
  where t.tur = p_tur
    and t.slug = p_slug
    and t.yayin_durumu = 'sadece_supabase'
    and t.tarih <= current_date
  limit 1;
$$;

grant execute on function public.sadece_supabase_yazi_getir(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) slug'lara göre hızlı arama için indeks (RPC'ler bunu kullanır)
-- ----------------------------------------------------------------------------
create index if not exists idx_taslak_icerikler_tur_slug_durum
  on public.taslak_icerikler (tur, slug, yayin_durumu);

-- ============================================================================
-- NOT (editör GitHub İçerik Yönetimi paneline erişememesi hakkında):
-- Bu, bir veritabanı/RLS sorunu DEĞİLDİR — migration 0014 zaten
-- is_editor_or_admin() ve buna göre RLS politikalarını doğru kurmuştu.
-- Sorun tamamen ön yüzdeydi: assets/js/auth-guard.js -> requireAuth()
-- role='editor' isteğini role='special_user' gibi ayrı bir dal olarak ele
-- almıyordu (sadece tam eşleşme veya admin kabul ediyordu), bu yüzden
-- editor rolündeki kullanıcılar panel/github-yonetim.html'e girer girmez
-- "yetkisiz" sayılıp panel/panel.html'e geri atılıyordu; ayrıca
-- assets/js/nav-auth.js üstteki "Hesabım" menüsünde bu linki sadece
-- role==='admin' iken gösteriyordu, editor'lar linki hiç görmüyordu. İkisi
-- de bu commit'teki auth-guard.js ve nav-auth.js değişiklikleriyle
-- düzeltildi; bu migration'da EK bir değişiklik gerekmiyor.
-- ============================================================================
