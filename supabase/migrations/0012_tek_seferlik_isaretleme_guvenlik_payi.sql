-- ============================================================================
-- 0012_tek_seferlik_isaretleme_guvenlik_payi.sql
--
-- 0008_email_isim_senkron_ve_kvkk_temizlik.sql dosyasındaki "KVKK onayı
-- verilmemiş yetim hesapları sil" bloğu artık public._tek_seferlik_islemler
-- işaret tablosuna bakarak SADECE HİÇ ÇALIŞMAMIŞSA çalışıyor (bkz. 0008'in
-- güncel hâli, madde 4).
--
-- BU DOSYANIN AMACI: senin veritabanında bu temizlik ZATEN GERÇEKTEN bir kez
-- çalışmıştı (0008'i ilk kez çalıştırdığında). Bu migration, işaret
-- tablosunu oluşturup o geçmiş çalışmayı "zaten yapıldı" olarak İŞARETLİYOR
-- — böylece ileride 0008 dosyası bir sebeple (kazayla, ya da yeni bir ortam
-- kurulumunda referans alınırken) tekrar SQL Editor'e yapıştırılsa bile,
-- KVKK onayı bekleyen O ANKİ gerçek/aktif hesapların YANLIŞLIKLA bir daha
-- silinmesi imkansız hâle geliyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor'e yapıştırıp Run'a bas.
-- Tamamen GÜVENLİDİR: hiçbir satırı SİLMEZ, sadece küçük bir "işaret"
-- tablosu oluşturup içine bir kayıt ekler.
-- ============================================================================

create table if not exists public._tek_seferlik_islemler (
  anahtar text primary key,
  calisti_at timestamptz not null default now()
);
comment on table public._tek_seferlik_islemler is
  'Migration dosyalarındaki "tek seferlik" bakım/temizlik işlemlerinin (ör. 0008''deki KVKK-onaysız yetim hesap temizliği) yanlışlıkla İKİNCİ KEZ çalışıp gerçek veri silmesini engellemek için kullanılan küçük bir işaret tablosu. Uygulama kodu bu tabloyu hiç kullanmaz, sadece migration''lar kullanır.';

-- Bu tablo yeni oluşturulduğu için "calisti_at" gerçek geçmiş tarihi
-- yansıtmıyor (o bilgi hiçbir yerde tutulmuyordu) — önemli olan SADECE bu
-- anahtarın var OLMASI, tarihi değil.
insert into public._tek_seferlik_islemler (anahtar)
values ('0008_kvkk_yetim_hesap_temizligi')
on conflict (anahtar) do nothing;

-- RLS: bu tablo tamamen dahili/idari bir muhasebe tablosu, hiçbir client
-- (anon/authenticated) rolünün ne okumasına ne yazmasına gerek yok —
-- varsayılan olarak RLS'siz bırakırsak PostgREST üzerinden (yanlışlıkla
-- açık bir izin verilmediği sürece) zaten erişilemez, ama garantiye almak
-- için RLS'i açıp SIFIR politika bırakıyoruz (= hiç kimseye erişim yok).
alter table public._tek_seferlik_islemler enable row level security;
revoke all on public._tek_seferlik_islemler from public, anon, authenticated;

-- ============================================================================
-- BİTTİ. Bundan sonra 0008 dosyası (mevcut güncel hâliyle) kaç kez tekrar
-- SQL Editor'e yapıştırılırsa yapıştırılsın, KVKK temizlik bloğu artık
-- SESSİZCE ATLANIR — hiçbir gerçek hesap ikinci kez silinmez.
-- ============================================================================
