-- ============================================================================
-- 0018_editor_sadece_kendi_icerigi.sql
-- İstenen kısıt: role='editor' (panelde "İçerik Editörü"), kendisinden üst
-- yetkili rollerin (manager = "İçerik Sorumlusu", admin) yazılarını NE
-- GÖREBİLMELİ (gizli olanlar) NE DÜZENLEYEBİLMELİ NE DE SİLEBİLMELİ —
-- sadece KENDİ yazdığı içerikleri yönetebilmeli. role='manager' bu
-- migration'dan ETKİLENMİYOR: manager, migration 0016'da tanımlandığı gibi
-- (editor ile "TAMAMEN AYNI" yazma yetkisi) hâlâ sadece kendi taslaklarını
-- yönetir — bu zaten migration 0014/0016'dan beri böyleydi, burada
-- DEĞİŞMEDİ. Bu migration SADECE editor'ün "hepsini GÖREBİLME" (SELECT)
-- yetkisini geri alıyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0017 sırayla daha önce çalıştırılmış olmalı.
--
-- NEDEN GEREKLİ (öncesi/sonrası):
--   Migration 0014, taslak_icerikler için SELECT politikasını
--   is_editor_or_admin() ile açmıştı — yani editor, kendi taslağı olsun
--   olmasın TÜM satırları (admin'in ve manager'ın gizli taslakları dahil)
--   okuyabiliyordu; sadece UPDATE/DELETE zaten "created_by = kendisi" ile
--   sınırlıydı. Bu, "editör üst rollerin gizli yazılarını hiç görmemeli"
--   isteğiyle çelişiyordu. Aşağıda SELECT politikası, admin/manager için
--   AYNI kalacak ("hepsini görebilir") ama editor için "sadece kendi
--   satırı" olacak şekilde değiştiriliyor.
--
-- NOT ("GitHub'a gizli commit et (eski yöntem)" ile ilgili sınır):
--   Yeni sistemde (bkz. migration 0013 dosya başı notu) "yayında değil"
--   içerik ARTIK GitHub'a hiç commit edilmiyor, sadece bu tabloda duruyor —
--   yani BUNDAN SONRA üretilecek tüm gizli içerikler zaten bu politikayla
--   korunuyor olacak. Depoda önceden (bu kısıt eklenmeden ÖNCE) "yayinda:
--   false" olarak commit edilmiş birkaç ESKİ dosya kalmış olabilir; onlar
--   git geçmişinde durduğu için veritabanı RLS'i onları kapsayamaz — bkz.
--   assets/js/github-yonetim.js içindeki ayrı commit (icerikKendisineMiAit /
--   icerikEditoreKapaliMi), o dosyalarda front-matter'a artık eklenen
--   `yazar_id` alanına göre panel TARAFINDA ayrıca filtreleniyor VE
--   Worker'da (cloudflare worker/github_icerik_yonetim_worker/worker.js)
--   editor için o dosyaları DÜZENLEME/SİLME de sunucu tarafında engelleniyor.
-- ============================================================================

drop policy if exists "taslak_select_editor_or_admin" on public.taslak_icerikler;

drop policy if exists "taslak_select_own_or_privileged" on public.taslak_icerikler;
create policy "taslak_select_own_or_privileged"
  on public.taslak_icerikler for select
  using (
    -- admin ve manager (İçerik Sorumlusu) hepsini görür — DEĞİŞMEDİ.
    public.is_manager_or_admin()
    -- editor SADECE kendi oluşturduğu satırı görür (created_by = kendisi).
    -- yazar_id'ye DEĞİL created_by'a bakıyoruz: created_by satırı GERÇEKTEN
    -- Supabase'e kim yazdıysa odur (bkz. migration 0013 § "created_by
    -- kolonu... panel bu kolona satır eklerken auth.uid() değerini yazar"),
    -- yazar_id ise "admin adına yayınla" akışında BAŞKA birinin (bir
    -- admin'in) adını taşıyabilir (bkz. migration 0016 § 5) — o durumda
    -- bile satırı GERÇEKTEN oluşturan (created_by) hâlâ editor'ün kendisi
    -- olduğu için, kendi oluşturduğu "admin adına" taslağını da görmeye
    -- devam etmesi gerekir (aksi hâlde kendi gönderdiği onay talebini
    -- takip edemez).
    or created_by = auth.uid()
  );

-- ============================================================================
-- BİTTİ. UPDATE/DELETE politikaları (migration 0014, is_editor_or_admin()
-- manager'ı da kapsayacak şekilde 0016'da genişletildi) zaten
-- "created_by = auth.uid()" şartını taşıyordu — bu migration onlara
-- DOKUNMADI, sadece yukarıdaki SELECT'i sıkılaştırdı. Sonuç: editor artık
-- "Mevcut İçerikler" listesinde SADECE kendi taslaklarını görür/düzenler/
-- siler; manager ve admin'in Supabase'teki gizli taslakları listeye hiç
-- girmez (RLS seviyesinde, sorgu hiç dönmez — istemci tarafında ayrıca
-- filtrelemeye gerek yok).
-- ============================================================================
