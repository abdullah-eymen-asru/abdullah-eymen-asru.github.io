-- ============================================================================
-- 0066_yetki_ayarlari_ozel_icerik_ve_dosya_paylasimi_yazar.sql
--
-- İSTEK: "Yetki Ayarları" matrisinde "Özel İçerik Ekle/Düzenle/Sil" ile "R2 Dosya
-- Paylaşımı" satırları Yönetici (admin) ve İçerik Sorumlusu (manager) için
-- açılıp kapanabiliyordu ama Yazar (editor) sütununda "—" vardı (engel). Artık
-- bu iki özellik TÜM rol sütunlarında (admin, manager, editor) owner tarafından
-- açılıp kapatılabilir.
--
-- NE DEĞİŞİYOR
--   * ozellik_erisimleri tablosu / ozellik_erisimi_var_mi() / owner_ozellik_
--     erisimi_ayarla() ZATEN herhangi bir (özellik, rol) çiftiyle çalışıyor
--     (0048) — onlara dokunulmadı.
--   * Yeni yardımcı: ozel_icerik_yonetebilir_mi()  =
--         is_editor_or_admin()  (editor/manager/admin/owner, askıda değil)
--         AND ozellik_erisimi_var_mi('ozel_icerik_yonetimi')
--     Owner kapatmadıkça editor için varsayılan AÇIK (matristeki satır yoksa
--     izinli sayılır) — yani bu migration çalışınca mevcut yazarlar özel
--     içerik yönetimi yetkisi KAZANIR; istenmiyorsa owner matristen Yazar
--     anahtarını kapatır.
--   * special_content, content_access, 'ozel-dosyalar' storage politikaları ve
--     icerik_atama_listesi_getir() RPC'si editor'ü de (özellik açıkken) kapsar.
--     Admin/manager/owner davranışı AYNEN korunur (SELECT'lerde onlar için
--     özellik anahtarı hâlâ aranmaz, bkz. 0051).
--
-- R2 Dosya Paylaşımı (dosya_paylasimi_yonetimi) için SQL gerekmez: sınır
-- Cloudflare worker'dadır (cloudflare worker/r2_imza_worker/worker.js) —
-- o dosya ayrıca elle yeniden deploy edilmeli.
--
-- 0001..0065 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase Dashboard > SQL Editor'e yapıştırıp Run'a bas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Yardımcı fonksiyon
-- ----------------------------------------------------------------------------
create or replace function public.ozel_icerik_yonetebilir_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_editor_or_admin()
     and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi');
$$;

revoke execute on function public.ozel_icerik_yonetebilir_mi() from public, anon;
grant  execute on function public.ozel_icerik_yonetebilir_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 2) special_content
-- ----------------------------------------------------------------------------
drop policy if exists "content_select_admin_or_granted" on public.special_content;
create policy "content_select_admin_or_granted"
  on public.special_content for select
  using (
    public.is_manager_or_admin()
    or public.ozel_icerik_yonetebilir_mi()
    or (is_published and public.has_content_access(id))
  );

drop policy if exists "content_write_admin_only" on public.special_content;
create policy "content_write_admin_only"
  on public.special_content for insert
  with check (public.ozel_icerik_yonetebilir_mi());

drop policy if exists "content_update_admin_only" on public.special_content;
create policy "content_update_admin_only"
  on public.special_content for update
  using (public.ozel_icerik_yonetebilir_mi())
  with check (public.ozel_icerik_yonetebilir_mi());

drop policy if exists "content_delete_admin_only" on public.special_content;
create policy "content_delete_admin_only"
  on public.special_content for delete
  using (public.ozel_icerik_yonetebilir_mi());

-- ----------------------------------------------------------------------------
-- 3) content_access
-- ----------------------------------------------------------------------------
drop policy if exists "access_select_own_or_admin" on public.content_access;
create policy "access_select_own_or_admin"
  on public.content_access for select
  using (
    auth.uid() = user_id
    or public.is_manager_or_admin()
    or public.ozel_icerik_yonetebilir_mi()
  );

drop policy if exists "access_write_admin_only" on public.content_access;
create policy "access_write_admin_only"
  on public.content_access for insert
  with check (public.ozel_icerik_yonetebilir_mi());

drop policy if exists "access_delete_admin_only" on public.content_access;
create policy "access_delete_admin_only"
  on public.content_access for delete
  using (public.ozel_icerik_yonetebilir_mi());

-- ----------------------------------------------------------------------------
-- 4) 'ozel-dosyalar' storage bucket
-- ----------------------------------------------------------------------------
drop policy if exists "ozel_dosya_select" on storage.objects;
create policy "ozel_dosya_select"
  on storage.objects for select
  using (
    bucket_id = 'ozel-dosyalar'
    and (
      public.is_manager_or_admin()
      or public.ozel_icerik_yonetebilir_mi()
      or public.has_content_access( (storage.foldername(name))[1]::uuid )
    )
  );

drop policy if exists "ozel_dosya_write" on storage.objects;
create policy "ozel_dosya_write"
  on storage.objects for insert
  with check (
    bucket_id = 'ozel-dosyalar'
    and public.ozel_icerik_yonetebilir_mi()
  );

drop policy if exists "ozel_dosya_update" on storage.objects;
create policy "ozel_dosya_update"
  on storage.objects for update
  using (
    bucket_id = 'ozel-dosyalar'
    and public.ozel_icerik_yonetebilir_mi()
  );

drop policy if exists "ozel_dosya_delete" on storage.objects;
create policy "ozel_dosya_delete"
  on storage.objects for delete
  using (
    bucket_id = 'ozel-dosyalar'
    and public.ozel_icerik_yonetebilir_mi()
  );

-- ----------------------------------------------------------------------------
-- 5) Atama listesi RPC'si (id / full_name / role; e-posta yok — bkz. 0050).
--    Özelliği kapatılmış bir editor yine SIFIR satır alır.
-- ----------------------------------------------------------------------------
create or replace function public.icerik_atama_listesi_getir()
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where public.is_manager_or_admin() or public.ozel_icerik_yonetebilir_mi()
  order by p.full_name nulls last;
$$;

revoke execute on function public.icerik_atama_listesi_getir() from public, anon;
grant  execute on function public.icerik_atama_listesi_getir() to authenticated;

-- ============================================================================
-- BİTTİ. Owner artık "Yetki Ayarları" matrisinde bu iki özelliği Yazar için de
-- ayrı ayrı kapatabilir. Matris/panel kodu: github-yonetim.js (OZELLIK_KATALOGU),
-- dashboard.js, admin.js; worker: r2_imza_worker/worker.js.
-- ============================================================================
