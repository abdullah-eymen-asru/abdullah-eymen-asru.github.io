-- ----------------------------------------------------------------------------
-- 0043: SÖZLEŞME VERSİYON TAKİBİ + ESKİ KULLANICILAR İÇİN RIZA YENİLEME
-- ----------------------------------------------------------------------------
-- İSTENEN: profiles.kvkk_versiyon (DEFAULT 'v1.0' NOT NULL) + kvkk_riza_tarihi.
--
-- BİLİNÇLİ TASARIM KARARI: Bu iki alan AÇILMADI. Sistemde migration 0003'ten
-- beri zaten profiles.kvkk_onay_verildi / kvkk_onay_tarihi / kvkk_onay_versiyonu
-- kolonları ve bunları güncelleyen kvkk_onayini_ver() RPC'si var — istenenle
-- BİREBİR AYNI İŞİ görüyorlar (versiyon damgası + rıza tarihi). Ayrı bir
-- "kvkk_versiyon"/"kvkk_riza_tarihi" çifti daha açmak, aynı soruya ("bu
-- kullanıcı güncel aydınlatma metnini onayladı mı, ne zaman?") cevap veren
-- İKİ PARALEL, SENKRONİZE OLMAYAN alan seti yaratır — biri güncellenip
-- diğeri unutulabilir, admin/denetim tarafında hangisine bakılacağı
-- belirsizleşir. Bu yüzden mevcut kolonlar YENİDEN KULLANILIYOR; sadece
-- sürüm etiketinin biçimi tarih temelli ("2026-08") yerine "vX.Y" biçimine
-- geçiriliyor (bkz. assets/js/core/supabase-client.js -> KVKK_METIN_SURUMU
-- = "v1.1") ve NULL/eski değerler burada normalize ediliyor.
--
-- Bu migration'ın yaptıkları:
--   1) kvkk_onay_versiyonu hâlâ NULL olan (hiç onay vermemiş / migration
--      0003 öncesi açılmış) satırları 'v1.0' ile doldurur — "henüz hiçbir
--      sürümü onaylamamış" durumunu, GUNCEL_KVKK_VERSIYON ('v1.1') ile asla
--      eşleşmeyecek sabit bir başlangıç değeriyle temsil eder.
--   2) kvkk_onay_versiyonu kolonunu NOT NULL + DEFAULT 'v1.0' yapar (istenen
--      DDL doğrultusunda, ama mevcut kolon üzerinde).
--   3) Sütuna açıklayıcı bir comment ekler.
-- ----------------------------------------------------------------------------

-- (1) Mevcut NULL değerleri normalize et — NOT NULL kısıtı eklemeden önce
-- şart, aksi halde ALTER TABLE hata verir.
update public.profiles
set kvkk_onay_versiyonu = 'v1.0'
where kvkk_onay_versiyonu is null;

-- (2) Kolonu istenen DDL'e uygun hale getir: DEFAULT 'v1.0' NOT NULL.
alter table public.profiles
  alter column kvkk_onay_versiyonu set default 'v1.0',
  alter column kvkk_onay_versiyonu set not null;

comment on column public.profiles.kvkk_onay_versiyonu is
  'Sözleşme/Aydınlatma Metni versiyon takibi: kullanıcının en son onayladığı KVKK metni sürüm etiketi ("v1.0", "v1.1", ...). Güncel sürüm assets/js/core/supabase-client.js -> KVKK_METIN_SURUMU sabitinde tutulur. Bu değer güncel sabitle eşleşmiyorsa auth-guard.js, ekranı kilitleyen bir "Rıza Yenileme" modalı açar (bkz. kvkkVersiyonKontroluVeModal()). DEFAULT ''v1.0'' NOT NULL: yeni satırlar handle_new_user() trigger''ı üzerinden gerçek değeri alır (bkz. migration 0042), bu default sadece güvenlik payı ve şema garantisi içindir.';

-- ----------------------------------------------------------------------------
-- handle_new_user(): DEĞİŞİKLİK YOK. Migration 0042'deki sürüm zaten
-- new.raw_user_meta_data->>'kvkk_versiyon' değerini kvkk_onay_versiyonu'na
-- yazıyordu; auth-pages.js -> initKayitPage() bu alana artık KVKK_METIN_SURUMU
-- ('v1.1') gönderiyor (bkz. o dosyadaki ilgili güncelleme), yani yeni
-- kayıtlarda otomatik doğru sürüm atanmaya devam ediyor — buraya AYRICA
-- dokunmaya gerek yok. (İstekte "yeni kayıtlarda versiyonun otomatik 'v1.0'
-- atanması" isteniyordu — ama bu, YENİ kayıt olan bir kullanıcının GÜNCEL
-- metni değil ESKİ bir sürümü onaylamış sayılması anlamına gelirdi, ki bu
-- hem mantıksız hem de o kullanıcıyı ilk girişinde gereksiz yere rıza
-- yenileme modalıyla karşılaştırırdı. Bu yüzden yeni kayıtlar bilinçli
-- olarak GÜNCEL sürümü (KVKK_METIN_SURUMU) alır; 'v1.0' varsayılanı sadece
-- şema/DDL güvencesi ve mevcut/eski satırların normalize edilmiş
-- başlangıç değeridir.)
-- ----------------------------------------------------------------------------
