-- ============================================================================
-- 0054_taslak_akisina_yazi_yetkilerinin_uygulanmasi_bug_fix.sql
--
-- BUG (migration 0053'te fark edildi, burada düzeltiliyor):
--
-- Migration 0053, "yazi_ekleme"/"yazi_duzenleme"/"yazi_silme" (ve sonraki
-- eki "klasor_yonetimi") yetkilerini SADECE cloudflare worker/
-- github_icerik_yonetim_worker/worker.js İÇİNDE, yani GitHub'a giden
-- PUT/DELETE isteklerinde kontrol ediyordu. Ama github-yonetim.js'teki
-- "İçerik Ekle/Düzenle" formunun "Nerede saklansın? → Supabase" (gizli
-- taslak) seçeneği Worker'a HİÇ UĞRAMADAN, doğrudan
-- public.taslak_icerikler tablosuna yazıyor (bkz. icerikKaydet() içindeki
-- `supabase.from("taslak_icerikler")` çağrıları) — ve bu tablonun RLS
-- politikaları (migration 0014/0018/0028) editor/manager/admin'in KENDİ
-- oluşturduğu satırları (created_by = auth.uid()) HER ZAMAN
-- ekleyip/güncelleyip/silebilmesine izin veriyor, migration 0053'ün
-- ozellik_erisimleri tablosuna HİÇ BAKMIYOR.
--
-- SONUÇ: owner bir editörün "yazi_ekleme"sini panelden kapatsa bile, o
-- editör "Taslağı Kaydet (Gizli)" (Supabase hedefli) seçeneğiyle YENİ
-- İÇERİK EKLEMEYE DEVAM EDEBİLİYORDU — kısıtlama sadece GitHub'a giden
-- yolu kapatıyor, Supabase'e giden yolu KAPATMIYORDU. Aynı şekilde
-- "yazi_duzenleme"/"yazi_silme" kapalıyken de editör kendi taslağını
-- Supabase üzerinden güncelleyebiliyor/silebiliyordu.
--
-- DÜZELTME: taslak_icerikler üzerindeki insert/update/delete politikaları,
-- editor/manager/admin'in "kendi satırı" (created_by = auth.uid()) dalına,
-- migration 0048'in ozellik_erisimi_var_mi(p_ozellik) RPC'sine bir kontrol
-- daha ekliyor. owner ve "admin adına"/"site sahibi adına" erişim yolu
-- (_taslak_admin_erisimi_var_mi) BU KISITLARDAN ETKİLENMEZ — onlar zaten
-- migration 0053'ün kapsamı dışında (worker.js'teki 4.0 kontrolü de sadece
-- rol !== 'owner' için çalışıyordu, aynı simetri burada da korunuyor).
--
-- NOT (bilerek yapılmayan bir şey): "klasor_yonetimi" burada YOK — çünkü
-- taslak_icerikler tablosunun .gitkeep/klasör kavramı hiç yok (taslaklar
-- her zaman tek bir satır, bir dosya yoluna değil "tur" alanına bağlı).
-- Klasör oluşturma/silme SADECE GitHub tarafında (worker.js) var olan bir
-- kavram, bu yüzden sadece orada kontrol edilmesi zaten yeterli ve doğru.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) INSERT — "yazi_ekleme" kapalıyken editor/manager/admin YENİ bir taslak
--    satırı OLUŞTURAMAZ (kendi adına bile). owner (public.is_admin() içinde
--    zaten var, aşağıdaki ilk dal) bundan ETKİLENMEZ.
-- ----------------------------------------------------------------------------
drop policy if exists "taslak_insert_own_or_admin" on public.taslak_icerikler;
create policy "taslak_insert_own_or_admin"
  on public.taslak_icerikler for insert
  with check (
    public.is_admin()
    or (
      public.is_editor_or_admin()
      and created_by = auth.uid()
      and public.ozellik_erisimi_var_mi('yazi_ekleme')
    )
  );

comment on policy "taslak_insert_own_or_admin" on public.taslak_icerikler is
  'admin/owner (is_admin()) her zaman ekleyebilir. editor/manager/admin (is_editor_or_admin()) SADECE kendi adına (created_by=kendisi) VE owner panelden "yazi_ekleme" özelliğini kapatmamışsa (migration 0053/0054) ekleyebilir — bkz. worker.js''teki GitHub tarafı karşılığı.';

-- ----------------------------------------------------------------------------
-- 2) UPDATE — "yazi_duzenleme" kapalıyken editor/manager/admin KENDİ
--    taslağını bile GÜNCELLEYEMEZ. "Admin adına"/"Site Sahibi adına" işaretli
--    taslaklardaki owner/hedef-kişi erişimi (_taslak_admin_erisimi_var_mi)
--    BU KISITTAN ETKİLENMEZ — worker.js'teki 4.0 kontrolü de sadece
--    rol !== 'owner' olan "sıradan" PUT/DELETE'lere uygulanıyordu, aynı
--    simetri (owner/hedef muafiyeti) burada da korunuyor.
-- ----------------------------------------------------------------------------
drop policy if exists "taslak_update_own_or_admin" on public.taslak_icerikler;
create policy "taslak_update_own_or_admin"
  on public.taslak_icerikler for update
  using (
    (
      public.is_editor_or_admin()
      and created_by = auth.uid()
      and public.ozellik_erisimi_var_mi('yazi_duzenleme')
    )
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  )
  with check (
    (
      public.is_editor_or_admin()
      and created_by = auth.uid()
      and public.ozellik_erisimi_var_mi('yazi_duzenleme')
    )
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  );

comment on policy "taslak_update_own_or_admin" on public.taslak_icerikler is
  'Kendi taslağını (created_by=kendisi) düzenleme YETKİSİ artık owner panelden "yazi_duzenleme" özelliğini kapatmışsa (migration 0053/0054) ENGELLENİR. "Admin adına"/"site sahibi adına" işaretli taslaklardaki owner/hedef-kişi erişimi (_taslak_admin_erisimi_var_mi, migration 0028) bundan ETKİLENMEZ.';

-- ----------------------------------------------------------------------------
-- 3) DELETE — "yazi_silme" kapalıyken editor/manager/admin KENDİ taslağını
--    bile SİLEMEZ. Aynı owner/hedef-kişi muafiyeti burada da geçerli.
-- ----------------------------------------------------------------------------
drop policy if exists "taslak_delete_own_or_admin" on public.taslak_icerikler;
create policy "taslak_delete_own_or_admin"
  on public.taslak_icerikler for delete
  using (
    (
      public.is_editor_or_admin()
      and created_by = auth.uid()
      and public.ozellik_erisimi_var_mi('yazi_silme')
    )
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  );

comment on policy "taslak_delete_own_or_admin" on public.taslak_icerikler is
  'Kendi taslağını (created_by=kendisi) silme YETKİSİ artık owner panelden "yazi_silme" özelliğini kapatmışsa (migration 0053/0054) ENGELLENİR — düzenleme yetkisinden BAĞIMSIZDIR. "Admin adına"/"site sahibi adına" işaretli taslaklardaki owner/hedef-kişi erişimi bundan ETKİLENMEZ.';

-- ============================================================================
-- ÖNEMLİ UYARI — panel tarafında (github-yonetim.js) DA bu üç kontrolün
-- karşılığı eklenmelidir, aksi halde kullanıcı formu doldurup "Taslağı
-- Kaydet" dedikten SONRA (RLS reddi ile) bir hata mesajı görür — teknik
-- olarak GÜVENLİDİR (asıl sınır burada, veritabanında) ama kullanıcı
-- deneyimi kötüdür. icerikKaydet() içindeki mevcut
-- "!duzenlemeModuMu() && !ozellikErisimVarMiClient('yazi_ekleme')" ön
-- kontrolü YENİ modda (Supabase hedefli taslak dahil) zaten ÇALIŞIYOR
-- çünkü GitHub/Supabase ayrımından ÖNCE, fonksiyonun en başında yapılıyor
-- — bu yüzden EKLEME için panel tarafında EK bir değişikliğe gerek YOK.
-- DÜZENLEME/SİLME için ise mevcut "Düzenle"/"Sil" buton gizleme kontrolleri
-- (icerikKartiCiz) zaten hem GitHub hem Supabase kökenli öğeler için AYNI
-- şekilde çalışıyor (item.kaynak ayrımı yapmadan) — yani onlar için de EK
-- bir değişikliğe gerek YOK. Bu migration SADECE veritabanı tarafındaki
-- (asıl, bağlayıcı) sınırı, zaten var olan istemci tarafı kontrollerle
-- TUTARLI hale getiriyor.
-- ============================================================================
