-- ============================================================================
-- 0014_editor_ve_yayin_secenekleri.sql
-- "editor" (içerik yönetebilen ama kullanıcı/rol yönetemeyen) rolünü ekler,
-- taslak_icerikler tablosuna yazar bilgisi + yayın durumu + tam metin arama
-- desteği kazandırır ve RLS'i buna göre günceller.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0013 sırayla daha önce çalıştırılmış olmalı.
--
-- NOT (github_dosya_yolu hakkında): migration 0013'te taslak_icerikler
-- tablosuna zaten `dosya_yolu` kolonu eklenmişti ve panel şu an bunu tam
-- olarak "GitHub'da bu içeriğin bulunduğu/bulunacağı yol" anlamında
-- kullanıyor (bkz. assets/js/github-yonetim.js). Aynı bilgiyi ikinci bir
-- `github_dosya_yolu` kolonuyla tekrarlamak veri tutarsızlığı riski
-- taşıdığı için (iki kolon senkron kalmayabilir) BİLEREK EKLENMEDİ; mevcut
-- `dosya_yolu` kolonu bu ihtiyacı zaten karşılıyor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ROL GENİŞLETME: 'editor' rolü
--    editor: SADECE kendi oluşturduğu içerikleri yönetebilen içerik
--    yöneticisi. admin'in aksine kullanıcı/rol yönetimine (panel/admin.md)
--    ASLA erişemez — bu erişim kısıtı zaten client-side'da (auth-guard.js
--    requireAuth({role:'admin'})) hem de veritabanı seviyesinde (aşağıdaki
--    profiles politikaları DEĞİŞMEDİ — hâlâ sadece admin rol değiştirebilir,
--    bkz. migration 0001 § 3 prevent_role_self_escalation ve § 7
--    admin_set_user_role) zaten sağlanıyor; burada sadece constraint'i
--    genişletiyoruz.
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'special_user', 'admin', 'editor'));

comment on column public.profiles.role is
  'user: normal kayıtlı üye | special_user: özel içeriklere erişimi olan üye | editor: sadece kendi blog/proje taslaklarını yönetebilen içerik yöneticisi (kullanıcı/rol yönetemez) | admin: tam yetkili yönetici';

-- admin_set_user_role RPC'sinin izin verdiği rol listesini de güncelle
-- (aksi halde admin panelden bir kullanıcıyı 'editor' yapmaya çalışınca bu
-- fonksiyon "Geçersiz rol" hatası fırlatırdı).
create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin rol değiştirebilir.';
  end if;
  if p_new_role not in ('user', 'special_user', 'admin', 'editor') then
    raise exception 'Geçersiz rol: %', p_new_role;
  end if;
  update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) YARDIMCI FONKSİYON: is_editor_or_admin()
--    is_admin() (migration 0001) dokunulmadan duruyor; bu yenisi "editor
--    VEYA admin" kontrolü gereken yerlerde (taslak_icerikler RLS'i,
--    panelin okuma erişimi) kullanılacak.
-- ----------------------------------------------------------------------------
create or replace function public.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor')
  );
$$;

grant execute on function public.is_editor_or_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) TASLAK_ICERIKLER: YAZAR BİLGİSİ + YAYIN DURUMU + TAM METİN ARAMA
-- ----------------------------------------------------------------------------
alter table public.taslak_icerikler
  add column if not exists yazar_id uuid references public.profiles(id) on delete set null;

alter table public.taslak_icerikler
  add column if not exists yazar_adi text;

-- yayin_durumu:
--   'taslak'              -> GitHub'a hiç commit edilmedi, sadece burada duruyor (mevcut/eski davranış).
--   'supabase_ve_github'  -> içerik GitHub'a YAYINLANDI ama BİLEREK bu tabloda da bir kopya/arama
--                             kaydı olarak tutulmaya devam ediyor (bkz. panelin "Seçenek B" butonu).
--   'sadece_github'       -> bilgi amaçlı: içerik GitHub'a yayınlandığında bu tablodan silinen
--                             (mevcut/eski "Seçenek A" davranışı) satırlar için; normalde tabloda
--                             satır kalmadığı için pratikte gözlemlenmez, ileride bir denetim/geçmiş
--                             kaydı tutulmak istenirse diye enum'da yer ayrılmıştır.
alter table public.taslak_icerikler
  add column if not exists yayin_durumu text not null default 'taslak'
  check (yayin_durumu in ('taslak', 'supabase_ve_github', 'sadece_github'));

-- Var olan satırları geriye dönük doldur: created_by -> yazar_id, ve
-- profildeki adından yazar_adi türet (elimizden gelen en iyi tahmin).
update public.taslak_icerikler t
set yazar_id = t.created_by
where t.yazar_id is null and t.created_by is not null;

update public.taslak_icerikler t
set yazar_adi = coalesce(p.full_name, p.email)
from public.profiles p
where t.yazar_adi is null and t.yazar_id = p.id;

-- Başlık + gövde üzerinde hızlı tam metin arama için üretilmiş (generated)
-- bir tsvector kolonu + GIN indeksi. Panelin kendi arama kutusu şu an
-- İSTEMCİ TARAFINDA (zaten yüklenmiş başlık/gövde metni üzerinde) çalışıyor
-- (bkz. assets/js/github-yonetim.js -> icerikFiltreyeUyuyorMu); bu kolon
-- ekstra olarak veritabanı seviyesinde de (ör. ileride sunucu taraflı bir
-- arama/RPC eklenmek istenirse, ya da doğrudan SQL Editor'den
-- `select * from taslak_icerikler where arama_metni @@ websearch_to_tsquery('turkish', '...')`
-- ile) hızlı arama imkânı sağlar.
alter table public.taslak_icerikler
  add column if not exists arama_metni tsvector
  generated always as (
    setweight(to_tsvector('turkish', coalesce(baslik, '')), 'A') ||
    setweight(to_tsvector('turkish', coalesce(govde, '')), 'B')
  ) stored;

create index if not exists idx_taslak_icerikler_arama_metni
  on public.taslak_icerikler using gin (arama_metni);

-- Ayrıca sade ILIKE aramaları için de ucuz bir yardım: başlık üzerinde
-- trigram olmadan da hızlı "başlıyor/eşit" sorguları için btree yeterli,
-- ekstra bir uzantı (pg_trgm) gerektirmeden bırakıyoruz.
create index if not exists idx_taslak_icerikler_baslik on public.taslak_icerikler (baslik);

-- ----------------------------------------------------------------------------
-- 4) RLS KURALLARI — ADMİN TÜMÜNÜ, EDİTÖR SADECE KENDİSİNİNKİNİ YÖNETİR
--    Eskiden tek bir "admin-only for all" politikası vardı (migration
--    0013). Şimdi:
--      - SELECT: admin VEYA editor -> TÜM satırları görebilir (editörün
--        panelde arama/listeleme yapabilmesi, çakışan önizleme kodlarını
--        tespit edebilmesi için TÜM taslakları okuyabilmesi gerekiyor —
--        ama sadece KENDİ yazdıklarını değiştirebilir/silebilir, aşağıya
--        bkz.).
--      - INSERT: admin herhangi bir yazar adına ekleyebilir; editor SADECE
--        created_by = kendi auth.uid()'i olacak şekilde ekleyebilir.
--      - UPDATE/DELETE: admin hepsini, editor SADECE created_by = kendisi
--        olan satırları değiştirebilir/silebilir.
--    Editörlerin başka kullanıcı hesaplarını silme veya rol değiştirme
--    yetkisi burada da (ve hiçbir yerde) TANIMLI DEĞİL — bu tablo zaten
--    sadece içerik taslaklarını tutuyor, kullanıcı/rol yönetimi tamamen
--    ayrı bir tablo (profiles) ve ayrı politikalardır (migration 0001),
--    onlara BU migration'da hiçbir ek yetki verilmiyor.
-- ----------------------------------------------------------------------------
drop policy if exists "taslak_admin_tum_islemler" on public.taslak_icerikler;

drop policy if exists "taslak_select_editor_or_admin" on public.taslak_icerikler;
create policy "taslak_select_editor_or_admin"
  on public.taslak_icerikler for select
  using (public.is_editor_or_admin());

drop policy if exists "taslak_insert_own_or_admin" on public.taslak_icerikler;
create policy "taslak_insert_own_or_admin"
  on public.taslak_icerikler for insert
  with check (
    public.is_admin()
    or (public.is_editor_or_admin() and created_by = auth.uid())
  );

drop policy if exists "taslak_update_own_or_admin" on public.taslak_icerikler;
create policy "taslak_update_own_or_admin"
  on public.taslak_icerikler for update
  using (public.is_admin() or (public.is_editor_or_admin() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_editor_or_admin() and created_by = auth.uid()));

drop policy if exists "taslak_delete_own_or_admin" on public.taslak_icerikler;
create policy "taslak_delete_own_or_admin"
  on public.taslak_icerikler for delete
  using (public.is_admin() or (public.is_editor_or_admin() and created_by = auth.uid()));

-- ============================================================================
-- BİTTİ. Bir kullanıcıyı editör yapmak için (admin panelinden de yapılabilir,
-- "Kullanıcılar & Roller" sekmesindeki rol açılır listesinden "Editör"ü
-- seçerek — bu migration admin.js'in kullandığı admin_set_user_role RPC'sini
-- de günceller):
--
--   select public.admin_set_user_role('KULLANICI_UUID', 'editor');
-- ============================================================================
