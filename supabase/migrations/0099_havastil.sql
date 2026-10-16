-- ============================================================================
-- 0099_havastil.sql — "HavaStil" (akıllı hava durumu giyim danışmanı) modülü
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0001 (profiles), 0021 (is_owner), 0078/0079 (ozellik_varsayilan_kapali), 0084, 0088, 0097 (sistem_export_tablo_kayitlari).
--
-- NE EKLENİYOR
--   1) Yetki anahtarı 'havastil' — mevcut Yetki Ayarları › Özellikler matrisine bağlanır (YENİ panel YOK).
--        VARSAYILAN KAPALI: satır yoksa kapalı. owner her zaman açık. admin/manager/editor/special_user/user rolleri için
--        owner matristen tek tıkla açar/kapatır. (ozellik_varsayilan_kapali tablosu bu rollerle genişletilir.)
--   2) havastil_yetkisi_var_mi() — menü, RLS ve Worker'ın TEK doğruluk kaynağı.
--   3) havastil_konumlari + havastil_tercihleri — YALNIZCA kullanıcı "hesabımda sakla" seçerse kullanılır (varsayılan: cihaz).
--        Koordinat ~100 m'ye YUVARLANIR (numeric(8,3)); kullanıcı başına en çok 20 konum. RLS: yalnızca sahibi + yetki açıkken.
--   4) worker_anahtarlari'na 'havastil-worker' satırı (Yedekleme & Verilerim › Worker anahtarları'ndan aç/kapa).
--   5) Sistem yedeği / üye yedeği tablo kayıtlarına iki tablo eklenir (KVKK taşınabilirliği; hesap silinince CASCADE ile gider).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 'havastil' anahtarı: ozellik_varsayilan_kapali'yi tüm üye rollerine genişlet
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.ozellik_varsayilan_kapali'::regclass and c.contype = 'c'
             and (pg_get_constraintdef(c.oid) ilike '%ozellik_anahtari%' or pg_get_constraintdef(c.oid) ilike '%rol = any%' or pg_get_constraintdef(c.oid) ilike '%(rol%') loop
    execute format('alter table public.ozellik_varsayilan_kapali drop constraint %I', r.conname);
  end loop;
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil'));
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_rol_chk check (rol in ('admin', 'manager', 'editor', 'special_user', 'user'));
end $$;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then raise exception 'Geçersiz rol.'; end if;
  -- Eski anahtarların rol kapsamı DEĞİŞMEZ: hesap_silme_onayi/yetki_ayarlari yalnızca admin/manager/editor içindir.
  if p_ozellik in ('hesap_silme_onayi', 'yetki_ayarlari') and p_rol in ('special_user', 'user') then raise exception 'Bu özellik üye rolleri için tanımlı değil.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) YETKİ: owner her zaman; diğerleri yalnızca rolü için anahtar AÇIKSA, askıda değilse, demo değilse
-- ----------------------------------------------------------------------------
create or replace function public.havastil_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (p.role <> 'demo'
            and not coalesce(p.is_suspended, false)
            and exists (select 1 from public.ozellik_varsayilan_kapali o
                        where o.ozellik_anahtari = 'havastil' and o.rol = p.role and o.acik))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.havastil_yetkisi_var_mi() from public, anon;
grant execute on function public.havastil_yetkisi_var_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) VERİ (isteğe bağlı bulut senkronu; varsayılan davranış = yalnızca cihazda saklama)
-- ----------------------------------------------------------------------------
create table if not exists public.havastil_konumlari (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  ad         text not null check (char_length(btrim(ad)) between 1 and 40),
  enlem      numeric(8, 3) not null check (enlem between -90 and 90),     -- 3 ondalık ≈ 110 m (kasıtlı yuvarlama)
  boylam     numeric(8, 3) not null check (boylam between -180 and 180),
  created_at timestamptz not null default now(),
  unique (user_id, ad)
);
comment on table public.havastil_konumlari is
  'HavaStil kayıtlı konumlar (yalnızca kullanıcı "hesabımda sakla" derse). Koordinat ~110 m''ye yuvarlanır. RLS: sahibi + havastil_yetkisi_var_mi().';
create index if not exists havastil_konumlari_user_idx on public.havastil_konumlari (user_id);

create table if not exists public.havastil_tercihleri (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  tolerans       smallint not null default 0 check (tolerans in (-3, 0, 3)),
  senaryo        text not null default 'toplu' check (senaryo in ('toplu', 'yuruyus_ofis', 'disari', 'arac')),
  updated_at     timestamptz not null default now()
);

-- Kullanıcı başına en çok 20 konum (tablo şişmesini ve kötüye kullanımı engeller)
create or replace function public.havastil_konum_siniri()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.havastil_konumlari where user_id = new.user_id) >= 20 then
    raise exception 'En fazla 20 konum kaydedebilirsin.';
  end if;
  return new;
end $$;
drop trigger if exists trg_havastil_konum_siniri on public.havastil_konumlari;
create trigger trg_havastil_konum_siniri before insert on public.havastil_konumlari
  for each row execute function public.havastil_konum_siniri();

alter table public.havastil_konumlari  enable row level security;
alter table public.havastil_tercihleri enable row level security;

drop policy if exists havastil_konumlari_sahip on public.havastil_konumlari;
create policy havastil_konumlari_sahip on public.havastil_konumlari
  for all to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi())
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());

drop policy if exists havastil_tercihleri_sahip on public.havastil_tercihleri;
create policy havastil_tercihleri_sahip on public.havastil_tercihleri
  for all to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi())
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());

revoke all on public.havastil_konumlari, public.havastil_tercihleri from public, anon;
grant select, insert, update, delete on public.havastil_konumlari, public.havastil_tercihleri to authenticated;

-- ----------------------------------------------------------------------------
-- 4) WORKER ANAHTARI (kota koruması; 0088). Korumalı DEĞİL: panelden kapatılabilir.
-- ----------------------------------------------------------------------------
insert into public.worker_anahtarlari (ad, etiket, tur, korumali) values
  ('havastil-worker', 'HavaStil — stilist yorumu (Groq)', 'worker', false)
on conflict (ad) do update set etiket = excluded.etiket, tur = excluded.tur;

-- ----------------------------------------------------------------------------
-- 5) YEDEK / GERİ YÜKLEME KAYITLARI
--    sistem_export_tablo_kayitlari (0097'deki GÜNCEL liste + 2 satır; sonradan bu fonksiyonu yeniden tanımlayan bir migration eklersen oraya da 2 HavaStil satırını ekle) ve _uye_geri_yukleme_tablolari (0084 + 2 satır).
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_tablo_kayitlari()
returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
language sql
immutable
as $$
  select * from (values
    ('profiles',                    'veri',   'id = auth.uid()',           false, false),
    ('taslak_icerikler',            'veri',   'created_by = auth.uid()',   false, false),
    ('special_content',             'veri',   'author_id = auth.uid()',    false, false),
    ('r2_arsiv',                    'veri',   'sahip_id = auth.uid()',     false, false),
    ('e2ee_kullanici_anahtarlari',  'veri',   'kullanici_id = auth.uid()', false, false),
    ('indirme_loglari',             'veri',   'user_id = auth.uid()',      false, false),
    ('onay_gecmisi',                'veri',   'user_id = auth.uid()',      false, false),
    ('havastil_konumlari',          'veri',   'user_id = auth.uid()',      false, false),
    ('havastil_tercihleri',         'veri',   'user_id = auth.uid()',      false, false),
    ('notlar',                      'notlar', 'user_id = auth.uid()',      false, false),
    ('not_kasasi',                  'notlar', 'user_id = auth.uid()',      false, false),
    ('not_ek_kayitlari',            'notlar', 'user_id = auth.uid()',      false, false),
    ('akademik_kaynaklar',          'notlar', 'user_id = auth.uid()',      false, false),
    ('akademik_notlar',             'notlar', 'user_id = auth.uid()',      false, false),
    ('content_access',              'veri',   'false',                     true,  false),
    ('site_settings',               'veri',   'false',                     true,  false),
    ('site_ayarlari',               'veri',   'false',                     true,  false),
    ('site_ayarlari_loglari',       'veri',   'false',                     true,  false),
    ('site_onizleme_izinleri',      'veri',   'false',                     true,  false),
    ('ozellik_erisimleri',          'veri',   'false',                     true,  false),
    ('ozellik_kullanici_kisitlari', 'veri',   'false',                     true,  false),
    ('ozellik_kullanici_izinleri',  'veri',   'false',                     true,  false),
    ('r2_arsiv_izinleri',           'veri',   'false',                     true,  false),
    ('ozel_icerik_anahtarlar',      'veri',   'false',                     true,  false),
    ('denetim_kayitlari',           'veri',   'false',                     true,  false),
    ('uye_aktarim_yetkileri',       'veri',   'false',                     true,  false),
    ('sistem_export_yetkileri',     'veri',   'false',                     true,  false),
    ('akademik_okuyucu_ayarlari',   'veri',   'false',                     true,  false),
    -- Mesajlaşma: içerik UÇTAN UCA ŞİFRELİ (hassas değil); her üyenin kendi yedeğine girer.
    ('conversations',               'veri',   'user_id = auth.uid() or hedef_admin_id = auth.uid()', false, false),
    ('konusma_zarflari',            'veri',   'user_id = auth.uid()',      false, false),
    ('messages',                    'veri',   'conversation_id in (select c.id from public.conversations c where c.user_id = auth.uid() or c.hedef_admin_id = auth.uid())', false, false),
    ('konusma_gizlemeleri',         'veri',   'user_id = auth.uid()',      false, false),
    ('mesaj_gizlemeleri',           'veri',   'user_id = auth.uid()',      false, false),
    ('konusma_durumlari',           'veri',   'user_id = auth.uid()',      false, false),
    ('konusma_uyeleri',             'veri',   'user_id = auth.uid()',      false, false),
    -- 0097: mesaj sabitleri (sohbet bazlı, her iki taraf için) + kişisel yıldız tercihleri. Mesaj kimliği yalnızca uuid taşır (içerik yok).
    ('mesaj_sabitleri',             'veri',   'conversation_id in (select c.id from public.conversations c where c.user_id = auth.uid() or c.hedef_admin_id = auth.uid())', false, false),
    ('mesaj_yildizlari',            'veri',   'user_id = auth.uid()',      false, false)
  ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas);
$$;
revoke all on function public.sistem_export_tablo_kayitlari() from public, anon, authenticated;

create or replace function public._uye_geri_yukleme_tablolari()
returns table (tablo text, kullanici_kolonu text, anahtar_kolonu text, anahtar_deseni text)
language sql immutable as $$
  select * from (values
    ('notlar',               'user_id',  null::text,    null::text),
    ('not_kasasi',           'user_id',  null,          null),
    ('not_ek_kayitlari',     'user_id',  'r2_key',      '^notlar/[0-9a-f-]{36}/'),
    ('akademik_kaynaklar',   'user_id',  'pdf_r2_yolu', '^akademik-kutuphane/users/[0-9a-f-]{36}/'),
    ('akademik_notlar',      'user_id',  null,          null),
    ('r2_arsiv',             'sahip_id', null,          null),
    ('havastil_konumlari',   'user_id',  null,          null),
    ('havastil_tercihleri',  'user_id',  null,          null)
  ) t(tablo, kullanici_kolonu, anahtar_kolonu, anahtar_deseni);
$$;
revoke all on function public._uye_geri_yukleme_tablolari() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- HIZLI KONTROL (owner ile):
--   select public.havastil_yetkisi_var_mi();   -- true
--   -- Yetki Ayarları › Özellikler › "HavaStil" satırından bir rolü açınca o rol için true döner.
-- ----------------------------------------------------------------------------
