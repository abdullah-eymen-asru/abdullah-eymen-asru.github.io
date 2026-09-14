-- ============================================================================
-- 0052_denetim_kaydi_ve_kilit_modu.sql
--
-- İKİ BAĞIMSIZ ÖZELLİK, TEK MIGRATION'DA:
--
--   A) DENETİM KAYDI (Audit Log) — panel/github-yonetim.html'in arkasındaki
--      github_icerik_yonetim_worker'ın verdiği HER 403 (yetkisiz erişim
--      denemesi) VE her başarılı PUT/DELETE, public.denetim_kayitlari
--      tablosuna bir satır olarak düşer. Kimse (owner DAHİL) bu tabloya
--      normal yoldan UPDATE atamaz — sadece INSERT (worker'ın service_role
--      ile yazması) ve SELECT/DELETE (owner okuma + silme) var. Depolamayı
--      şişirmesin diye owner tek tek satır ya da TÜMÜNÜ silebilsin istendi;
--      bunun için iki ayrı RPC var (owner_denetim_kaydi_sil / owner_denetim_kayitlarini_temizle).
--
--   B) KİLİT MODU (Panic Button) — site_settings'e tek bir boolean
--      (kilit_modu) ekleniyor. true olduğunda worker, owner DIŞINDAKİ
--      HERKESİN (admin/manager/editor) PUT/DELETE isteklerini GitHub'a hiç
--      göndermeden 503 ile reddediyor — GET (okuma) etkilenmiyor, panel
--      açılıp içerik görüntülenebiliyor, sadece yazma duruyor. Migration
--      0031'deki "kayitlar_acik" ile BİREBİR AYNI desen: kolon bazlı
--      trigger + owner-only RPC, "sadece owner değiştirebilsin" kısıtı
--      RLS'in tek başına yapamayacağı bir satır-içi ayrım olduğu için.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0051 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ============================================================================
-- A) DENETİM KAYDI (AUDIT LOG)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A.1) TABLO
--      Worker'ın SUPABASE_SERVICE_ROLE_KEY'iyle INSERT attığı, panel/owner'ın
--      okuyup silebileceği düz bir olay kaydı. Kim/ne zaman/hangi yol/hangi
--      yöntem/sonuç şeklinde MINIMAL tutuluyor — dosya İÇERİĞİ hiç loglanmaz
--      (KVKK ve depolama boyutu için), sadece "ne olduğu" kaydedilir.
-- ----------------------------------------------------------------------------
create table if not exists public.denetim_kayitlari (
  id           bigint generated always as identity primary key,
  olusturuldu  timestamptz not null default now(),
  aktor_id     uuid references public.profiles(id) on delete set null,
  aktor_email  text,                         -- profiles silinse/CASCADE olsa bile iz kalsın diye ayrıca metin olarak tutulur
  aktor_rol    text,                         -- olay anındaki rol ('editor'/'manager'/'admin'/'owner') — sonradan rol değişse bile o anki rol donuk kalır
  yontem       text not null,                -- 'GET' | 'PUT' | 'DELETE'
  hedef_yol    text not null,                -- GitHub Contents API yolu, ör. "_posts/2026-01-01-baslik.md"
  sonuc        text not null check (sonuc in ('izin_verildi', 'reddedildi')),
  ret_nedeni   text,                         -- sonuc='reddedildi' ise worker'ın döndürdüğü hata mesajı; 'izin_verildi' ise null
  kaynak       text not null default 'github_icerik_yonetim_worker' -- ileride başka worker'lar da yazarsa ayırt edebilmek için
);

comment on table public.denetim_kayitlari is
  'İçerik yönetimi worker''ının verdiği her yazma denemesinin (izin verildi/reddedildi) minimal izi. Sadece owner okuyup silebilir — bkz. RLS ve owner_denetim_kaydi_sil/owner_denetim_kayitlarini_temizle RPC''leri.';
comment on column public.denetim_kayitlari.ret_nedeni is
  'Worker''ın 403/405 vb. döndürdüğü Türkçe hata mesajı — sadece sonuc=reddedildi satırlarında dolu.';

create index if not exists idx_denetim_kayitlari_olusturuldu on public.denetim_kayitlari (olusturuldu desc);
create index if not exists idx_denetim_kayitlari_aktor on public.denetim_kayitlari (aktor_id);
create index if not exists idx_denetim_kayitlari_sonuc on public.denetim_kayitlari (sonuc);

-- ----------------------------------------------------------------------------
-- A.2) RLS — SADECE OWNER OKUYABİLİR/SİLEBİLİR; normal INSERT yolu YOK
--      (worker service_role ile yazdığı için RLS'i zaten atlıyor — burada
--      "authenticated" rolüne YAZMA politikası bilerek TANIMLANMIYOR, yani
--      panelden/istemciden normal anon key ile bu tabloya asla satır
--      eklenemez, sadece owner_denetim_kaydi_sil/owner_denetim_kayitlarini_temizle
--      RPC'leri üzerinden silinebilir).
-- ----------------------------------------------------------------------------
alter table public.denetim_kayitlari enable row level security;

drop policy if exists "denetim_kayitlari_select_owner" on public.denetim_kayitlari;
create policy "denetim_kayitlari_select_owner"
  on public.denetim_kayitlari
  for select
  to authenticated
  using (public.is_owner());

-- Bilerek insert/update/delete POLİTİKASI YOK — insert sadece service_role
-- (RLS'i atlar) ile, delete sadece aşağıdaki SECURITY DEFINER RPC'lerle olur.
-- Bu, "hiçbir authenticated kullanıcı (owner dahil) tabloyu doğrudan
-- düzenleyip iz karartamaz, sadece belirlenmiş RPC yoluyla silebilir" garantisini verir.

-- ----------------------------------------------------------------------------
-- A.3) OWNER: TEK BİR KAYDI SİL
-- ----------------------------------------------------------------------------
create or replace function public.owner_denetim_kaydi_sil(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: denetim kayıtlarını silme yetkisi sadece Site Sahibi''ne (owner) aittir.';
  end if;
  delete from public.denetim_kayitlari where id = p_id;
end;
$$;

grant execute on function public.owner_denetim_kaydi_sil(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- A.4) OWNER: TÜM KAYITLARI TEMİZLE (depolamayı doldurmasın diye)
--      p_su_tarihten_once verilirse SADECE o tarihten ESKİ kayıtlar silinir
--      (ör. "3 aydan eski her şeyi temizle"); verilmezse TÜM tablo boşalır.
-- ----------------------------------------------------------------------------
create or replace function public.owner_denetim_kayitlarini_temizle(p_su_tarihten_once timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_silinen bigint;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: denetim kayıtlarını topluca silme yetkisi sadece Site Sahibi''ne (owner) aittir.';
  end if;

  if p_su_tarihten_once is null then
    delete from public.denetim_kayitlari;
  else
    delete from public.denetim_kayitlari where olusturuldu < p_su_tarihten_once;
  end if;

  get diagnostics v_silinen = row_count;
  return v_silinen;
end;
$$;

grant execute on function public.owner_denetim_kayitlarini_temizle(timestamptz) to authenticated;

comment on function public.owner_denetim_kayitlarini_temizle(timestamptz) is
  'p_su_tarihten_once NULL ise TÜM denetim kayıtlarını, verilirse sadece o tarihten eski olanları siler. Dönüş değeri silinen satır sayısıdır. Sadece owner çağırabilir.';

-- ============================================================================
-- B) KİLİT MODU (PANIC BUTTON)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B.1) KOLON: site_settings.kilit_modu
--      Migration 0031'deki kayitlar_acik ile AYNI tablo, AYNI id=1 satırı.
-- ----------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists kilit_modu boolean not null default false;

comment on column public.site_settings.kilit_modu is
  'true iken owner DIŞINDAKİ hiçbir rol (admin/manager/editor) içerik/dosya yazamaz ya da silemez — bkz. github_icerik_yonetim_worker''daki kilit modu kontrolü. Okuma (GET) etkilenmez. Sadece owner değiştirebilir, bkz. trg_kilit_modu_sadece_owner ve owner_kilit_modu_ayarla().';

-- ----------------------------------------------------------------------------
-- B.2) SADECE OWNER DEĞİŞTİREBİLSİN — migration 0031 ile AYNI desen
-- ----------------------------------------------------------------------------
create or replace function public.prevent_kilit_modu_owner_disi_degisiklik()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kilit_modu is distinct from old.kilit_modu then
    if not public.is_owner() then
      raise exception 'Kilit modunu açma/kapatma yetkisi sadece Site Sahibi''ne (owner) aittir.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kilit_modu_sadece_owner on public.site_settings;
create trigger trg_kilit_modu_sadece_owner
  before update on public.site_settings
  for each row execute function public.prevent_kilit_modu_owner_disi_degisiklik();

-- ----------------------------------------------------------------------------
-- B.3) OWNER'A ÖZEL RPC — worker VE panel bu fonksiyonu çağırır
-- ----------------------------------------------------------------------------
create or replace function public.owner_kilit_modu_ayarla(p_aktif boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: kilit modunu açma/kapatma sadece Site Sahibi''ne (owner) açıktır.';
  end if;
  update public.site_settings set kilit_modu = p_aktif where id = 1;
end;
$$;

grant execute on function public.owner_kilit_modu_ayarla(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- B.4) WORKER'IN OKUYABİLMESİ İÇİN — site_settings zaten migration 0001'de
--      "settings_select_anyone" politikasıyla herkese (anon dahil) açık
--      SELECT izni veriyor (bkz. migration 0031 § 2 notu), bu yüzden
--      github_icerik_yonetim_worker service_role ile sorguladığında
--      (RLS'i zaten atlar) ya da anon/authenticated ile sorguladığında
--      (mevcut politika sayesinde) kilit_modu değerini okuyabilir — EK bir
--      politika GEREKMEZ.
-- ----------------------------------------------------------------------------
