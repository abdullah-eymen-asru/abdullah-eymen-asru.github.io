-- ============================================================================
-- 0082_not_kasasi_bagimsiz_kasa_parolasi.sql
-- Not Kasası: Google (OAuth) kullanıcıları için BAĞIMSIZ "Kasa Parolası" + isteğe
-- bağlı kurtarma anahtarı.
--
-- Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır. Tekrar
-- çalıştırmak zararsızdır (idempotent).
--
-- NEDEN?
--   Google ile giriş yapan kullanıcının veritabanında bir giriş parolası yok; eski
--   tasarım "giriş parolanı yaz" dediği için bu kullanıcılar kilitli kalıyordu.
--   Artık kasanın zarfı (dek_parola) iki türden birinde olabilir:
--     'giris' → giriş parolasından türetilen anahtarla sarılı (klasik e-posta/şifre
--               kullanıcıları; MEVCUT TÜM SATIRLAR bu türdedir, davranış değişmez)
--     'kasa'  → kullanıcının kasa için ayrıca belirlediği Kasa Parolası ile sarılı
--               (Google kullanıcıları). Giriş parolası değişse de zarf etkilenmez.
--
-- SUNUCU NEYİ GÖRÜR?  Hiçbir şey değişmedi: parola/anahtar sunucuya GİTMEZ; sadece
--   sarılmış DEK, tuz ve bu satırın hangi türde olduğu (düz bir etiket) saklanır.
--
-- KURTARMA ANAHTARI İSTEĞE BAĞLI: 'kasa' türünde kullanıcı kurtarma anahtarı
--   üretmeyi reddedebilir → dek_kurtarma NULL olabilir. 'giris' türünde ZORUNLU
--   kalır (eski davranış: giriş parolası dışarıdan sıfırlanabildiği için).
-- ============================================================================

alter table public.not_kasasi
  add column if not exists parola_tur text not null default 'giris';

-- Değer kümesi (mevcut kısıt varsa yeniden kurulur).
alter table public.not_kasasi drop constraint if exists not_kasasi_parola_tur_gecerli;
alter table public.not_kasasi
  add constraint not_kasasi_parola_tur_gecerli check (parola_tur in ('giris', 'kasa'));

-- Kurtarma zarfı artık boş olabilir; ama 'giris' türünde boş olamaz.
alter table public.not_kasasi alter column dek_kurtarma drop not null;

alter table public.not_kasasi drop constraint if exists not_kasasi_kurtarma_zorunlulugu;
alter table public.not_kasasi
  add constraint not_kasasi_kurtarma_zorunlulugu
  check (parola_tur = 'kasa' or dek_kurtarma is not null);

comment on column public.not_kasasi.parola_tur is
  '''giris'': zarf giriş parolasından türetilen anahtarla sarılı. ''kasa'': kullanıcının belirlediği bağımsız Kasa Parolası ile sarılı (Google/OAuth). Parola ve anahtar sunucuya asla gönderilmez.';

-- RLS/GRANT değişikliği GEREKMEZ: not_kasasi politikaları satır bazlıdır (user_id =
-- auth.uid()), yeni sütun aynı politikaların kapsamına otomatik girer. Trigger
-- not_guncelleme_kurallari() sahip değişimini ve rev artışını zaten yönetiyor.
