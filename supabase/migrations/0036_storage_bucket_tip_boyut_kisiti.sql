-- ============================================================================
-- 0036_storage_bucket_tip_boyut_kisiti.sql
--
-- GÜVENLİK AÇIĞI DÜZELTMESİ: migration 0002'de oluşturulan 'avatarlar'
-- (PUBLIC-READ) storage bucket'ında HİÇBİR dosya tipi ya da boyut kısıtı
-- yoktu. RLS politikaları ("avatar_write_own") sadece yükleyenin KENDİ
-- klasörüne yazdığını kontrol ediyordu — dosyanın uzantısını/içerik
-- tipini/boyutunu DEĞİL. Siteye kayıtlı olan (en düşük yetkili 'user'
-- rolü DAHİL) herhangi biri, sitenin arayüzünü hiç kullanmadan, Supabase
-- JS client'ını doğrudan çağırarak (anon key zaten sitenin kendi JS
-- paketinde herkese açık) bu PUBLIC bucket'a rastgele bir dosya
-- (ör. içine <script> gömülü bir .svg, ya da bir .html dosyası)
-- yükleyip herkese açık, kalıcı bir URL elde edebilirdi.
--
-- ETKİ DEĞERLENDİRMESİ: bu şekilde yüklenen bir dosya
-- "<proje-ref>.supabase.co/storage/v1/object/public/avatarlar/..."
-- adresinde servis edilir — sitenin KENDİ origin'i (GitHub/Cloudflare
-- Pages) DEĞİL, Supabase projesinin kendi alt domaini. Bu yüzden böyle
-- bir dosyaya gömülü bir script çalışsa bile sitenin kendi oturum
-- token'ını (localStorage'da SİTENİN origin'inde tutulur) doğrudan
-- ÇALAMAZ — yani klasik bir "hesap ele geçirme" senaryosu değil. Yine de
-- gerçek riskler var: (a) meşru görünen bir alt domainde barındırılan
-- phishing/kötü amaçlı içerik (b) boyut sınırı olmadığı için depolama
-- alanı/kotasının kötüye kullanılması (c) genel olarak "kimliği
-- doğrulanmış herhangi bir kullanıcı rastgele dosya barındırabilir" kötü
-- bir güvenlik pratiği. NOT: bu yazının itibarıyla frontend'de gerçek bir
-- "avatar yükleme" arayüzü YOK (bkz. assets/js/uye-ayarlari.js — oradaki
-- "avatar" sadece isim baş harflerinden oluşan bir rozet, dosya yüklemesi
-- yok) — yani bu bucket şu an SADECE Supabase client'ı doğrudan çağırarak
-- (siteyi hiç kullanmadan) erişilebilir bir yüzey; ileride bir avatar
-- yükleme arayüzü eklenirse bu kısıt zaten hazır olacak.
--
-- ÇÖZÜM: storage.buckets.allowed_mime_types / file_size_limit sütunları
-- (Supabase Storage'ın kendi native desteği — yükleme isteği bu
-- kısıtları karşılamıyorsa Storage API seviyesinde, RLS'e hiç
-- gerek kalmadan 400 ile reddedilir) dolduruluyor:
--   - 'avatarlar': sadece yaygın resim tipleri, 5 MB üst sınır.
--     image/svg+xml BİLEREK DIŞLANDI (script içerebilir).
--   - 'ozel-dosyalar': zaten PRIVATE ve sadece admin/owner yazabiliyor
--     (bkz. migration 0002 "ozel_dosya_write" — yetkisiz biri buraya
--     hiç yazamıyor), o yüzden mime type kısıtlamıyoruz (admin her tür
--     ek dosya -- pdf/zip/docx -- yükleyebilmeli) ama depolama kotasının
--     kazayla tüketilmesini önlemek için yine de makul bir üst boyut
--     sınırı (100 MB) ekliyoruz.
-- ============================================================================

update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'avatarlar';

update storage.buckets
set file_size_limit = 104857600 -- 100 MB
where id = 'ozel-dosyalar';

-- ============================================================================
-- BİTTİ. Test:
--   1) Supabase client'ı doğrudan (tarayıcı konsolundan) çağırıp
--      avatarlar/<kendi-uid>/deneme.svg olarak bir SVG yüklemeyi dene ->
--      Storage API 400 ile reddetmeli ("mime type not supported").
--   2) 6 MB'lık bir PNG yüklemeyi dene -> "exceeded the maximum allowed
--      size" ile reddedilmeli.
--   3) 4 MB'lık bir PNG/JPEG/WEBP/GIF yüklemeyi dene -> kabul edilmeli.
-- ============================================================================
