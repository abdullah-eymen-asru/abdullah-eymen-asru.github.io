-- ============================================================================
-- 0048_ozellik_bazinda_rol_erisimi_owner_paneli.sql
--
-- İSTEK: "Adminin hangi alana erişim hakkı olsun hangisine olmasın, ya da
-- üyenin/editörün şu özelliği kullanabilsin mi göremesin mi — tüm bunları
-- elle kod yazmadan, panelden ayarlayabileyim." Örnek: CV yükleme yetkisini
-- sadece owner'da tutup admin'den kaldırmak.
--
-- ÖNCEKİ DURUM: bu tür kararlar (kim hangi özelliği kullanabilir) projenin
-- her yerinde SABİT KODLANMIŞTI — worker.js'lerde `rol === "admin"`, panel
-- JS'lerinde `GIRIS_YAPAN_PROFIL?.role !== "admin"`, RLS politikalarında
-- `role in (...)` gibi onlarca ayrı yerde. Bunların HİÇBİRİNİ kaldırmıyoruz
-- (hepsi hâlâ ÇALIŞIR ve hâlâ asıl "varsayılan" güvenlik sınırıdır) — bunun
-- yerine ÜZERLERİNE, sadece owner'ın değiştirebildiği İSTEĞE BAĞLI bir "ek
-- kısıtlama" katmanı ekliyoruz: bir rolün varsayılan olarak erişebildiği bir
-- özelliği owner PANELDEN kapatabilir (asla varsayılanın ÜZERİNE yeni bir
-- yetki VEREMEZ — sadece VAR OLANI kısabilir, bkz. § 3 aşağıda). Böylece:
--   - Owner hiçbir şeyi değiştirmezse site AYNEN eskisi gibi davranmaya
--     devam eder (tablo boşsa/satır yoksa = "varsayılan davranış").
--   - Owner "admin, CV'yi düzenleyemesin" derse, worker.js bunu bu tablodan
--     okuyup admin'in isteğini SUNUCU TARAFINDA reddeder — panel JS'i de
--     aynı bilgiyi okuyup ilgili sekmeyi/butonu admin'e hiç göstermez.
--
-- KAPSAM (BİLİNÇLİ SINIRLAMA): bu mekanizma "kim hangi PANEL SAYFASINA
-- girebilir" (requireAuth({role:...}) ile sayfa seviyesinde kontrol edilen,
-- bkz. auth-guard.js) sorusunu YENİDEN YAZMIYOR — o hâlâ sabit kod. Bunun
-- yerine "bir panel sayfasının İÇİNDEKİ tekil bir özellik/buton" seviyesinde
-- çalışır (profil fotoğrafı, CV, Hakkımda metni gibi — bkz. § 5'teki
-- OZELLIK_KATALOGU listesi). Rol hiyerarşisinin KENDİSİNİ (kim kimi hangi
-- role atayabilir, owner'ın nasıl atandığı, admin askıya alma vb., bkz.
-- migration 0021/0024) BU MİGRATION HİÇ DEĞİŞTİRMİYOR — o zaten ayrı ve
-- kasıtlı olarak sağlam/karmaşık bir sistemdir, buna dokunmak yeni riskler
-- açar. Burada eklenen SADECE "bu rol, bu tekil özelliği kullanabilir mi"
-- sorusuna owner'ın panelden EVET/HAYIR diyebildiği ek bir anahtar seti.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLO — bir (özellik, rol) çifti için "izinli mi" bayrağı.
--    Satır YOKSA o (özellik, rol) çifti için VARSAYILAN (mevcut sabit kodun
--    hâlâ uyguladığı) davranış geçerlidir — yani bu tablo TAMAMEN BOŞKEN site
--    bu migration'dan ÖNCEKİYLE AYNI şekilde çalışır, hiçbir davranış
--    değişmez. Sadece owner bilerek bir satır ekleyip bir rolü bir
--    özellikten mahrum bırakırsa (izinli=false) fark eder.
--    NOT: izinli=true satırı KASITLI OLARAK anlamsız/etkisizdir (bkz. § 3) —
--    bu tablo asla YENİ bir yetki VEREMEZ, sadece MEVCUT birini kısabilir.
--    Yine de "owner burada bilerek true yazdı" izini (ör. daha sonra
--    kısıtlamayı geri almak) için satırın durması engellenmiyor.
-- ----------------------------------------------------------------------------
create table if not exists public.ozellik_erisimleri (
  id               uuid primary key default gen_random_uuid(),
  ozellik_anahtari text not null,
  rol              text not null
                   check (rol in ('user', 'special_user', 'editor', 'manager', 'admin', 'owner')),
  izinli           boolean not null default true,
  guncelleyen_id   uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (ozellik_anahtari, rol)
);

comment on table public.ozellik_erisimleri is
  'Owner''in panelden (kod yazmadan) belirli rollerin belirli özelliklere erişimini KISITLAYABİLDİĞİ ek bir izin katmanı. Satır yoksa o (özellik,rol) için sitedeki VARSAYILAN (sabit kod) davranış geçerlidir. Sadece owner yazabilir (bkz. owner_ozellik_erisimi_ayarla). "owner" rolü için asla izinli=false satırı YAZILAMAZ (bkz. trigger) — owner kendi erişimini kısıtlayıp sistemi kilitleyemez.';
comment on column public.ozellik_erisimleri.ozellik_anahtari is
  'Sabit bir metin anahtarı, örn. "cv_yonetimi", "hakkimda_duzenleme", "profil_fotografi" — bkz. bu dosyanın sonundaki OZELLIK_KATALOGU listesi ve worker.js/panel JS''teki kullanım noktaları.';

drop trigger if exists trg_ozellik_erisimleri_updated_at on public.ozellik_erisimleri;
create trigger trg_ozellik_erisimleri_updated_at
  before update on public.ozellik_erisimleri
  for each row execute function public.set_updated_at();

-- owner'ın KENDİSİNİ kilitleyip site sahibinin hiçbir şeye erişemez hâle
-- gelmesini (geri dönüşü panelden imkânsız bir duruma düşmeyi) engelleyen
-- son bir güvenlik payı — RPC katmanında da aynı kontrol var (§ 3), bu
-- trigger veritabanı seviyesinde İKİNCİ, bağımsız bir savunma hattıdır.
create or replace function public.owner_kilitlenmesini_engelle()
returns trigger
language plpgsql
as $$
begin
  if new.rol = 'owner' and new.izinli = false then
    raise exception 'owner rolü için erişim kapatılamaz — bu, site sahibinin kendi panelinden kilitlenmesine yol açar.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_owner_kilitlenmesini_engelle on public.ozellik_erisimleri;
create trigger trg_owner_kilitlenmesini_engelle
  before insert or update on public.ozellik_erisimleri
  for each row execute function public.owner_kilitlenmesini_engelle();

-- ----------------------------------------------------------------------------
-- 2) OKUMA — herhangi bir SUNUCU (worker) ya da panel, bir rolün bir
--    özelliğe erişip erişemeyeceğini bu fonksiyonla sorar. p_rol
--    verilmezse çağıranın KENDİ rolüne bakar. Satır yoksa (varsayılan) HER
--    ZAMAN true döner — yani bu fonksiyon asla "bilmediğim bir özellik adı
--    için hayır" demez, sadece owner'ın AÇIKÇA "hayır" dediği durumları
--    yakalar. "security definer" — public.profiles'a normalde RLS ile
--    kısıtlı erişimi olan bir kullanıcı bile kendi rolünü sorgulayabilsin
--    diye (is_admin() ile AYNI gerekçe, bkz. migration 0021).
-- ----------------------------------------------------------------------------
create or replace function public.ozellik_erisimi_var_mi(p_ozellik text, p_rol text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hedef_rol text;
  kayit boolean;
begin
  if p_rol is not null then
    hedef_rol := p_rol;
  else
    select role into hedef_rol from public.profiles where id = auth.uid();
  end if;

  if hedef_rol is null then
    return false; -- oturum/rol okunamadıysa güvenli tarafta kal
  end if;

  -- owner her zaman her özelliğe erişir — bkz. dosya başı ve trigger notu,
  -- bu kısayol trigger'la AYNI garantiyi burada da (okuma tarafında) verir.
  if hedef_rol = 'owner' then
    return true;
  end if;

  select izinli into kayit
  from public.ozellik_erisimleri
  where ozellik_anahtari = p_ozellik and rol = hedef_rol;

  -- satır yoksa varsayılan: erişim VAR (mevcut sabit kod davranışı korunur).
  return coalesce(kayit, true);
end;
$$;

grant execute on function public.ozellik_erisimi_var_mi(text, text) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3) YAZMA — SADECE owner çağırabilir. Bir (özellik, rol) çiftini
--    izinli=true/false yapar; izinli=true iken satırı tamamen SİLER (tabloyu
--    şişirmemek için — "true" zaten varsayılanla aynı anlama geldiğinden
--    saklamaya gerek yok, bkz. § 1 notu "asla yeni yetki veremez").
-- ----------------------------------------------------------------------------
create or replace function public.owner_ozellik_erisimi_ayarla(p_ozellik text, p_rol text, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: özellik erişimlerini sadece Site Sahibi (owner) değiştirebilir.';
  end if;
  if p_rol not in ('user', 'special_user', 'editor', 'manager', 'admin', 'owner') then
    raise exception 'Geçersiz rol: %', p_rol;
  end if;
  if p_rol = 'owner' and p_izinli = false then
    raise exception 'owner rolü için erişim kapatılamaz.';
  end if;

  if p_izinli then
    -- true = varsayılana dön: satırı tut değil, SİL (bkz. dosya başı notu).
    delete from public.ozellik_erisimleri
    where ozellik_anahtari = p_ozellik and rol = p_rol;
  else
    insert into public.ozellik_erisimleri (ozellik_anahtari, rol, izinli, guncelleyen_id)
    values (p_ozellik, p_rol, false, auth.uid())
    on conflict (ozellik_anahtari, rol)
    do update set izinli = false, guncelleyen_id = auth.uid(), updated_at = now();
  end if;
end;
$$;

grant execute on function public.owner_ozellik_erisimi_ayarla(text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) LİSTELEME — owner panelinin "🔐 Yetki Ayarları" sekmesi, TÜM olası
--    (özellik, rol) çiftlerini (sadece kısıtlanmış olanlar değil, tabloda
--    hiç satırı olmayanlar dahil TÜMÜ) tek seferde görebilsin diye. Panel
--    tarafı OZELLIK_KATALOGU (bkz. github-yonetim.js) ile bu fonksiyonun
--    döndürdüğü kısıtlamaları birleştirip matrisi çizer — burada sadece
--    GERÇEKTEN kısıtlanmış (izinli=false) satırlar dönüyor, "her şey
--    izinli" olan (yani hiç satırı olmayan) kombinasyonlar panel
--    tarafında OZELLIK_KATALOGU'ndan tamamlanıyor.
-- ----------------------------------------------------------------------------
create or replace function public.ozellik_erisimlerini_getir()
returns table (ozellik_anahtari text, rol text, izinli boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.ozellik_anahtari, e.rol, e.izinli, e.updated_at
  from public.ozellik_erisimleri e
  where public.is_owner()
  order by e.ozellik_anahtari, e.rol;
$$;

grant execute on function public.ozellik_erisimlerini_getir() to authenticated;

-- ----------------------------------------------------------------------------
-- 5) RLS — doğrudan tablo erişimi YOK (default deny), tüm okuma/yazma
--    yukarıdaki SECURITY DEFINER fonksiyonlar üzerinden (migration
--    0021 § 13'teki AYNI desen).
-- ----------------------------------------------------------------------------
alter table public.ozellik_erisimleri enable row level security;
revoke all on public.ozellik_erisimleri from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- OZELLIK_KATALOGU (bilgi amaçlı — veritabanında bir karşılığı YOK, panel
-- tarafında assets/js/github-yonetim/github-yonetim.js içinde AYNI
-- anahtarlarla tutulur, bkz. orada "OZELLIK_KATALOGU" sabiti):
--
--   "profil_fotografi"   — Profil Fotoğrafı Yönetimi sekmesi (yükle/sil).
--                          Varsayılan: sadece admin/owner (editor/manager
--                          zaten sabit kodda hiç göremiyor, bu anahtar
--                          SADECE admin/owner ARASINDAKİ ayrımı etkiler).
--   "hakkimda_duzenleme" — "🙋 Hakkımda" sekmesi (EN/TR metin + üst başlık).
--                          Varsayılan: admin/owner.
--   "baglanti_yonetimi"  — "🔗 Bağlantılar (Sosyal/Akademik)" sekmesi (site
--                          genelindeki sosyal/akademik bağlantı düğmelerini
--                          ekleme/düzenleme/silme — bkz. migration sonrası
--                          not: bu anahtar 0048'den SONRA, ayrı bir migration
--                          olmadan eklendi, tam olarak bu dosyanın öngördüğü
--                          "yeni migration GEREKMEZ" mekanizmasıyla).
--                          Varsayılan: admin/owner.
--   "cv_yonetimi"        — "📄 CV" sekmesi (PDF yükle / dış link / kaldır).
--                          Varsayılan: admin/owner. (Kullanıcının verdiği
--                          örnek: "CV yükleme sadece owner'da olsun, admin
--                          olmasın" — owner bu anahtar için admin'e
--                          izinli=false yazarak bunu panelden yapabilir.)
--
-- Yeni bir "kısılabilir" özellik eklemek istersen: (1) worker.js'te ilgili
-- yol kontrolüne `ozellikErisimVarMi(...)` çağrısı ekle, (2) panel JS'inde
-- ilgili wireX() fonksiyonuna aynı anahtarla bir kontrol ekle, (3) bu listeye
-- ve github-yonetim.js'teki OZELLIK_KATALOGU'na yeni anahtarı ekle — hepsi bu
-- kadar, veritabanında YENİ bir migration GEREKMEZ (tablo zaten herhangi bir
-- ozellik_anahtari string'ini kabul eder).
-- ============================================================================
