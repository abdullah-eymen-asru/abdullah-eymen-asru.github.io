-- ============================================================================
-- 0051_yetki_ayarlari_ozel_icerik_ve_dosya_paylasimi_genisletme.sql
--
-- İSTEK: "Yetki Ayarları" matrisi (migration 0048) sadece 3 özelliği
-- (profil fotoğrafı, hakkımda, CV) kapsıyordu — admin panelindeki geri
-- kalan özellikler (Özel İçerik Ekle/Düzenle/Sil/Atama, R2 Dosya
-- Paylaşımı) hiç bu sisteme dahil değildi, owner bunları admin/manager'dan
-- panelden kısamıyordu. Bu migration mevcut mekanizmayı (migration 0048'in
-- KENDİSİNİ değiştirmeden, sadece ÜZERİNE) iki yeni özellikle genişletiyor:
--
--   - "ozel_icerik_yonetimi": admin panelindeki "Özel İçerik Ekle/Düzenle",
--     "Mevcut Özel İçerikler" (silme dahil) ve üyelere erişim atama/kaldırma.
--   - "dosya_paylasimi_yonetimi": admin panelindeki "R2 Dosya Paylaşımı"
--     bölümü (r2-imza-worker'dan HERHANGİ bir dosya için blanket — yani
--     content_access ataması aranmadan — imzalı link üretebilme).
--
-- ÖNCEKİ 3 ÖZELLİKTEN FARK: o üçü SADECE 'admin' için anlamlıydı (manager
-- zaten o özelliklere hiç erişemiyordu). Bu ikisi ise admin.js'te 'manager'
-- (İçerik Sorumlusu) için de TAM AÇIK (TAM_YETKILI kontrolü bu iki bölümü
-- hiç kapsamıyor) — bu yüzden owner'ın BUNLARI hem admin'den hem manager'dan
-- ayrı ayrı kısabilmesi gerekiyor. migration 0048'in ozellik_erisimleri
-- tablosundaki "rol" sütunu zaten TÜM rolleri (check kısıtı: user,
-- special_user, editor, manager, admin, owner) kapsadığından ve
-- ozellik_erisimi_var_mi()/owner_ozellik_erisimi_ayarla() fonksiyonları
-- zaten HERHANGİ bir (özellik, rol) çiftiyle çalıştığından, bunun için YENİ
-- bir tablo/fonksiyon GEREKMİYOR — sadece:
--   (a) mevcut RLS politikalarına "AND ozellik_erisimi_var_mi(...)" ekliyoruz
--       (bu dosyanın gövdesi),
--   (b) r2-imza-worker'a aynı kontrolü ekliyoruz (cloudflare worker/
--       r2_storage_worker/worker.js — AYRI dosya, bu migration'ın parçası
--       değil, elle deploy edilmeli),
--   (c) panel JS'lerine (admin.js: yeni bölüm gizleme +
--       github-yonetim.js: OZELLIK_KATALOGU'na 2 yeni satır, matris artık
--       özellik başına FARKLI rol sütunları gösterebiliyor) — AYRI, kod
--       tarafındaki değişiklikler.
--
-- KAPSAM: SADECE YAZMA (insert/update/delete) işlemleri kısıtlanıyor.
-- Okuma/görüntüleme (select) politikalarına dokunulmadı — kısıtlanmış bir
-- admin/manager için ilgili sekme zaten panelden TAMAMEN gizlenecek (bkz.
-- admin.js), doğrudan API'den okumaya çalışsa bile eline geçen veri zaten
-- var olan is_manager_or_admin() sınırının dışına çıkmıyor; SADECE
-- değiştirme/silme/atama gücünü kısmak bu isteğin özüydü.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001'den 0050'ye kadarki migration'lar daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) special_content — insert/update/delete
-- ----------------------------------------------------------------------------
drop policy if exists "content_write_admin_only" on public.special_content;
create policy "content_write_admin_only"
  on public.special_content for insert
  with check (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'));

drop policy if exists "content_update_admin_only" on public.special_content;
create policy "content_update_admin_only"
  on public.special_content for update
  using (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'))
  with check (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'));

drop policy if exists "content_delete_admin_only" on public.special_content;
create policy "content_delete_admin_only"
  on public.special_content for delete
  using (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'));

-- ----------------------------------------------------------------------------
-- 2) content_access — insert/delete (kime erişim verildiği/kaldırıldığı).
--    select politikasına (access_select_own_or_admin) dokunulmadı.
-- ----------------------------------------------------------------------------
drop policy if exists "access_write_admin_only" on public.content_access;
create policy "access_write_admin_only"
  on public.content_access for insert
  with check (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'));

drop policy if exists "access_delete_admin_only" on public.content_access;
create policy "access_delete_admin_only"
  on public.content_access for delete
  using (public.is_manager_or_admin() and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi'));

-- ----------------------------------------------------------------------------
-- 3) 'ozel-dosyalar' storage bucket — insert/update/delete (içerik dosyası
--    yükleme/değiştirme/silme). select politikasına (ozel_dosya_select)
--    dokunulmadı.
-- ----------------------------------------------------------------------------
drop policy if exists "ozel_dosya_write" on storage.objects;
create policy "ozel_dosya_write"
  on storage.objects for insert
  with check (
    bucket_id = 'ozel-dosyalar'
    and public.is_manager_or_admin()
    and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi')
  );

drop policy if exists "ozel_dosya_update" on storage.objects;
create policy "ozel_dosya_update"
  on storage.objects for update
  using (
    bucket_id = 'ozel-dosyalar'
    and public.is_manager_or_admin()
    and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi')
  );

drop policy if exists "ozel_dosya_delete" on storage.objects;
create policy "ozel_dosya_delete"
  on storage.objects for delete
  using (
    bucket_id = 'ozel-dosyalar'
    and public.is_manager_or_admin()
    and public.ozellik_erisimi_var_mi('ozel_icerik_yonetimi')
  );

-- ============================================================================
-- BİTTİ. Bundan sonra owner, "Yetki Ayarları" panelinden (github-yonetim.js
-- OZELLIK_KATALOGU'na eklenen 2 yeni satır sayesinde) admin VE manager için
-- ayrı ayrı "ozel_icerik_yonetimi" ile "dosya_paylasimi_yonetimi"nı
-- kapatabilir:
--   - "ozel_icerik_yonetimi" kapatılırsa: o rol artık Özel İçerik
--     ekleyemez/düzenleyemez/silemez, kimseye erişim atayamaz/kaldıramaz,
--     içerik dosyası yükleyemez — panelde ilgili sekmeler (admin.js) de
--     otomatik gizlenir.
--   - "dosya_paylasimi_yonetimi" kapatılırsa: o rol artık r2-imza-worker'dan
--     BLANKET (content_access aranmadan) link alamaz; sadece kendisine
--     content_access ile AÇIKÇA atanmış dosyaları indirebilir (bkz.
--     cloudflare worker/r2_storage_worker/worker.js — bu dosyanın AYRICA
--     elle yeniden deploy edilmesi gerekiyor, migration bunu OTOMATİK
--     güncellemez).
-- Owner hiçbir şey değiştirmezse (tablo bu iki özellik için boşsa) site
-- AYNEN eskisi gibi davranmaya devam eder.
-- ============================================================================
