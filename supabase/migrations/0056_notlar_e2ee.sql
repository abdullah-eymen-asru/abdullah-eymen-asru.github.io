-- ============================================================================
-- 0056_notlar_e2ee.sql
-- "Fikir & Araştırma Tezgâhı" (Not Sistemi) — sıfır bilgi (zero-knowledge) şema
--
-- Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
-- Önceki migration'larla (0001, 0021, 0032) aynı üslup: RLS her tabloda AÇIK,
-- varsayılan olarak her şey yasak, sadece "kendi satırın + yetkili rol" geçer.
--
-- SUNUCU NEYİ GÖRÜR?            ciphertext (anlamsız bayt yığını), iv, boyut,
--                                tarihler, silindi_at. BAŞLIK / ETİKET / GÖVDE /
--                                ALINTI / DURUM / EK ADI hiçbiri açık metin DEĞİL —
--                                hepsi tek bir AES-GCM zarfının içinde.
-- ANAHTARLAR NEREDE?             not_kasasi: veri şifreleme anahtarı (DEK) iki
--                                kopya halinde, ikisi de SARILMIŞ (wrapped):
--                                  1) giriş parolasından türetilen anahtarla
--                                  2) kullanıcıya bir kez gösterilen kurtarma
--                                     anahtarıyla.
--                                Sunucu parolayı da, kurtarma anahtarını da,
--                                açık DEK'i de ASLA görmez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Yetki yardımcısı — modülü kimler kullanabilir?
--    dashboard.js'teki MODULES.notlar.role = ["editor","manager"] (+ admin/owner
--    otomatik) ile BİREBİR AYNI küme. Askıdaki admin dışarıda (migration 0032).
-- ----------------------------------------------------------------------------
create or replace function public.not_modulu_yetkili()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('editor', 'manager', 'admin', 'owner')
      and not (p.role = 'admin' and coalesce(p.is_suspended, false))
  );
$$;

revoke all on function public.not_modulu_yetkili() from public, anon;
grant execute on function public.not_modulu_yetkili() to authenticated;

-- ----------------------------------------------------------------------------
-- 1) NOT KASASI — kullanıcı başına TEK satır (anahtar zarfları)
-- ----------------------------------------------------------------------------
create table if not exists public.not_kasasi (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  sema_ver      smallint    not null default 1,
  kdf_alg       text        not null default 'PBKDF2-SHA256' check (kdf_alg = 'PBKDF2-SHA256'),
  kdf_iter      integer     not null default 600000 check (kdf_iter between 300000 and 5000000),
  kdf_salt      text        not null check (length(kdf_salt) between 16 and 64),
  dek_parola    text        not null check (length(dek_parola) between 40 and 400),
  dek_kurtarma  text        not null check (length(dek_kurtarma) between 40 and 400),
  rev           integer     not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.not_kasasi is
  'Not modülünün anahtar zarfları. Sadece SARILMIŞ (şifreli) DEK tutar; sunucu tarafında çözülemez.';

-- ----------------------------------------------------------------------------
-- 2) NOTLAR — her satır tek bir AES-GCM zarfı
-- ----------------------------------------------------------------------------
create table if not exists public.notlar (
  id          uuid primary key default gen_random_uuid(),   -- istemci kendi üretip gönderir (AAD'ye bağlanır)
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  ciphertext  text        not null check (length(ciphertext) between 24 and 700000),  -- ~512 KB düz metin üst sınırı
  iv          text        not null check (length(iv) = 16),                           -- 12 bayt, base64
  sema_ver    smallint    not null default 1,
  rev         integer     not null default 1,               -- iyimser kilit (çoklu cihaz çakışması)
  silindi_at  timestamptz,                                  -- çöp kutusu (30 gün sonra istemci kalıcı siler)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notlar_kullanici_idx
  on public.notlar (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- 3) EK KAYITLARI — R2'deki şifreli dosyaların muhasebesi (içerik/ad YOK)
--    Dosya ADI bile şifreli zarfın içinde; burada sadece anahtar ve boyut var.
--    Amaç: kota denetimi + yetim (orphan) dosya temizliği.
-- ----------------------------------------------------------------------------
create table if not exists public.not_ek_kayitlari (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  r2_key      text        not null unique,
  boyut_bayt  bigint      not null check (boyut_bayt > 0 and boyut_bayt <= 26214400),  -- 25 MB
  created_at  timestamptz not null default now(),
  -- Anahtar SADECE kendi klasöründe olabilir: notlar/<user_id>/<uuid>
  constraint not_ek_anahtar_kendi_klasoru check (r2_key like ('notlar/' || user_id::text || '/%'))
);

create index if not exists not_ek_kullanici_idx on public.not_ek_kayitlari (user_id, created_at);

-- ----------------------------------------------------------------------------
-- 4) TRIGGER'LAR — rev/updated_at sunucuda, istemci elle oynayamaz
-- ----------------------------------------------------------------------------
create or replace function public.not_guncelleme_kurallari()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Notun sahibi değiştirilemez.';
  end if;
  new.rev        := old.rev + 1;
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_notlar_guncelleme on public.notlar;
create trigger trg_notlar_guncelleme
  before update on public.notlar
  for each row execute function public.not_guncelleme_kurallari();

drop trigger if exists trg_not_kasasi_guncelleme on public.not_kasasi;
create trigger trg_not_kasasi_guncelleme
  before update on public.not_kasasi
  for each row execute function public.not_guncelleme_kurallari();

-- ----------------------------------------------------------------------------
-- 5) RLS — hepsi "sadece kendi satırın" + modül yetkisi
--    (select auth.uid()) kalıbı: satır başına yeniden hesaplanmasın (performans).
--    Admin/owner DAHİ başkasının notunu okuyamaz — okusa da ciphertext görür.
-- ----------------------------------------------------------------------------
alter table public.not_kasasi       enable row level security;
alter table public.notlar           enable row level security;
alter table public.not_ek_kayitlari enable row level security;

-- not_kasasi
drop policy if exists not_kasasi_sec on public.not_kasasi;
create policy not_kasasi_sec on public.not_kasasi for select to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists not_kasasi_ekle on public.not_kasasi;
create policy not_kasasi_ekle on public.not_kasasi for insert to authenticated
  with check (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists not_kasasi_guncelle on public.not_kasasi;
create policy not_kasasi_guncelle on public.not_kasasi for update to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili())
  with check (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists not_kasasi_sil on public.not_kasasi;
create policy not_kasasi_sil on public.not_kasasi for delete to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

-- notlar
drop policy if exists notlar_sec on public.notlar;
create policy notlar_sec on public.notlar for select to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists notlar_ekle on public.notlar;
create policy notlar_ekle on public.notlar for insert to authenticated
  with check (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists notlar_guncelle on public.notlar;
create policy notlar_guncelle on public.notlar for update to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili())
  with check (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists notlar_sil on public.notlar;
create policy notlar_sil on public.notlar for delete to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

-- not_ek_kayitlari (güncelleme yok: kayıt ya vardır ya silinir)
drop policy if exists not_ek_sec on public.not_ek_kayitlari;
create policy not_ek_sec on public.not_ek_kayitlari for select to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists not_ek_ekle on public.not_ek_kayitlari;
create policy not_ek_ekle on public.not_ek_kayitlari for insert to authenticated
  with check (user_id = (select auth.uid()) and public.not_modulu_yetkili());

drop policy if exists not_ek_sil on public.not_ek_kayitlari;
create policy not_ek_sil on public.not_ek_kayitlari for delete to authenticated
  using (user_id = (select auth.uid()) and public.not_modulu_yetkili());

-- ----------------------------------------------------------------------------
-- 6) İZİNLER — anon hiçbir şeye dokunamaz
-- ----------------------------------------------------------------------------
revoke all on public.not_kasasi, public.notlar, public.not_ek_kayitlari from anon, public;
grant select, insert, update, delete on public.not_kasasi, public.notlar, public.not_ek_kayitlari to authenticated;

-- ----------------------------------------------------------------------------
-- 7) (İSTEĞE BAĞLI) Owner'ın "Yetki Ayarları"ndan (migration 0048) bu özelliği
--    rol bazında kapatabilmesi için katalog satırı eklemek istersen, 0048'in
--    kendi katalog yapısına bakıp "notlar_modulu" anahtarını orada tanımla.
--    Bu migration katalog şemasını bilmeden ona dokunmaz.
-- ----------------------------------------------------------------------------
