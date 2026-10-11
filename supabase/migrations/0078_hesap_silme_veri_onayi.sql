-- ============================================================================
-- 0078_hesap_silme_veri_onayi.sql
-- "Hesabını silen üyenin geride bıraktığı veriler": site sahibi onayıyla TAMAMEN silinir (iz kalmaz).
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0001 (profiles, is_owner), 0021, 0077.
--
-- AKIŞ
--   1) Üye "Hesabımı sil" der → Edge Function (delete-account) hesabı KAPATIR (giriş yasak, oturumlar sonlanır) ve
--      hesap_silme_talepleri'ne bir kayıt düşer. Veriler yerinde durur (indirilebilsin diye).
--   2) Site sahibi (ve yetkisi açıksa admin) "Silinen Hesap Verileri" sekmesinde özeti görür.
--        admin  → inceler, silme ÖNERİSİ gönderir (kalıcı silemez)
--        owner  → verileri indirir, kalıcı silmeyi ONAYLAR (son onay her zaman owner'da)
--   3) Onayda Edge Function: R2 dosyalarını (sistem-yedek-worker /uye-temizle), Storage'ı, kalan satırları ve
--      auth hesabını siler; talep kaydı da silinir → sitede kişiye ait iz kalmaz.
--      (Admin Güvenliği / denetim günlükleri gibi GÜVENLİK kayıtları bu işlemin DIŞINDADIR, bilerek korunur.)
--   Site sahibi başka bir üyeyi doğrudan sildiğinde onay zaten kendisinden geldiği için kuyruk atlanır.
--
-- Yetki anahtarı: 'hesap_silme_onayi' (varsayılan KAPALI) — Yetki Ayarları › Özellikler satırından açılır/kapanır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) VARSAYILAN KAPALI ÖZELLİK ANAHTARLARI (genel tablo; 0077'deki converter ile aynı yaklaşım)
-- ----------------------------------------------------------------------------
create table if not exists public.ozellik_varsayilan_kapali (
  ozellik_anahtari text not null check (ozellik_anahtari in ('hesap_silme_onayi')),
  rol              text not null check (rol in ('admin', 'manager', 'editor')),
  acik             boolean not null default false,
  guncelleyen_id   uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (ozellik_anahtari, rol)
);
alter table public.ozellik_varsayilan_kapali enable row level security;
revoke all on public.ozellik_varsayilan_kapali from public, anon, authenticated;

create or replace function public.kapali_ozellikleri_getir()
returns table (ozellik_anahtari text, rol text, acik boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  return query select o.ozellik_anahtari, o.rol, o.acik from public.ozellik_varsayilan_kapali o;
end $$;
revoke all on function public.kapali_ozellikleri_getir() from public, anon;
grant execute on function public.kapali_ozellikleri_getir() to authenticated;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor') then raise exception 'Geçersiz rol.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

-- Silinen hesap verilerini inceleme yetkisi: owner her zaman; admin yalnızca anahtar açıksa ve askıda değilse.
create or replace function public.hesap_silme_inceleme_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (p.role = 'admin' and not coalesce(p.is_suspended, false)
            and exists (select 1 from public.ozellik_varsayilan_kapali o
                        where o.ozellik_anahtari = 'hesap_silme_onayi' and o.rol = 'admin' and o.acik))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.hesap_silme_inceleme_yetkisi_var_mi() from public, anon;
grant execute on function public.hesap_silme_inceleme_yetkisi_var_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 2) TALEP TABLOSU (kullanıcı kaydı silinse de kalır; FK YOK → talep sonuçlanınca kendisi silinir)
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists silme_bekliyor_at timestamptz;

create table if not exists public.hesap_silme_talepleri (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique,
  ad          text,
  eposta      text,
  rol         text,
  talep_turu  text not null default 'kendisi' check (talep_turu in ('kendisi', 'owner')),
  durum       text not null default 'beklemede' check (durum in ('beklemede', 'onerildi')),
  oneri       jsonb,
  oneren_id   uuid,
  oneri_at    timestamptz,
  ozet        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.hesap_silme_talepleri enable row level security;
revoke all on public.hesap_silme_talepleri from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) İÇ YARDIMCILAR (tablo/kolon yoksa sessizce 0 — eski kurulumlarda da çalışsın)
-- ----------------------------------------------------------------------------
create or replace function public._hs_kolon_var(p_tablo text, p_kolon text)
returns boolean language sql stable as $$
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_tablo and column_name = p_kolon);
$$;

create or replace function public._hs_say(p_tablo text, p_kolon text, p_user uuid, p_ek text default '')
returns bigint language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if not public._hs_kolon_var(p_tablo, p_kolon) then return 0; end if;
  execute format('select count(*) from public.%I where %I = $1 %s', p_tablo, p_kolon, p_ek) into n using p_user;
  return coalesce(n, 0);
end $$;

create or replace function public._hs_sil(p_tablo text, p_kolon text, p_user uuid)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare n bigint;
begin
  if not public._hs_kolon_var(p_tablo, p_kolon) then return 0; end if;
  execute format('delete from public.%I where %I = $1', p_tablo, p_kolon) using p_user;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public._hs_json(p_tablo text, p_kolon text, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._hs_kolon_var(p_tablo, p_kolon) then return '[]'::jsonb; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.%I = $1', p_tablo, p_kolon) into v using p_user;
  return v;
end $$;

revoke all on function public._hs_kolon_var(text, text) from public, anon, authenticated;
revoke all on function public._hs_say(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public._hs_sil(text, text, uuid) from public, anon, authenticated;
revoke all on function public._hs_json(text, text, uuid) from public, anon, authenticated;

-- Veri özeti (sayılar). r2_toplam: R2'de silinmesi gereken nesne sayısının DB'den bilinen kısmı.
create or replace function public._hs_ozet(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'arsiv_dosya',   public._hs_say('r2_arsiv', 'sahip_id', p_user, 'and tur = ''dosya'''),
    'arsiv_klasor',  public._hs_say('r2_arsiv', 'sahip_id', p_user, 'and tur = ''klasor'''),
    'not_ek',        public._hs_say('not_ek_kayitlari', 'user_id', p_user),
    'notlar',        public._hs_say('notlar', 'user_id', p_user),
    'akademik',      public._hs_say('akademik_kaynaklar', 'user_id', p_user),
    'akademik_pdf',  public._hs_say('akademik_kaynaklar', 'user_id', p_user, 'and pdf_r2_yolu is not null'),
    'mesaj',         public._hs_say('messages', 'sender_id', p_user),
    'taslak',        public._hs_say('taslak_icerikler', 'created_by', p_user),
    'ozel_icerik',   public._hs_say('special_content', 'author_id', p_user),
    'erisim',        public._hs_say('content_access', 'user_id', p_user),
    'indirme_logu',  public._hs_say('indirme_loglari', 'user_id', p_user)
  );
$$;
revoke all on function public._hs_ozet(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) TALEP OLUŞTUR (yalnızca service_role / Edge Function)
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_talebi_olustur(p_user uuid, p_tur text default 'kendisi')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_ad text; v_eposta text; v_rol text;
begin
  select p.full_name, p.email, p.role into v_ad, v_eposta, v_rol from public.profiles p where p.id = p_user;
  if not found then raise exception 'Üye bulunamadı.'; end if;
  insert into public.hesap_silme_talepleri as t (user_id, ad, eposta, rol, talep_turu, ozet)
  values (p_user, v_ad, v_eposta, v_rol, case when p_tur = 'owner' then 'owner' else 'kendisi' end, public._hs_ozet(p_user))
  on conflict (user_id) do update set ozet = excluded.ozet
  returning t.id into v_id;
  update public.profiles set silme_bekliyor_at = coalesce(silme_bekliyor_at, now()) where id = p_user;
  return v_id;
end $$;
revoke all on function public.hesap_silme_talebi_olustur(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) LİSTE (owner / yetkili admin). E-posta yalnızca owner'a görünür.
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_talepleri_getir()
returns table (user_id uuid, ad text, eposta text, rol text, talep_turu text, durum text, oneri jsonb, oneri_at timestamptz, created_at timestamptz, ozet jsonb, owner_mi boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_owner boolean := public.is_owner();
begin
  if not public.hesap_silme_inceleme_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: silinen hesap verilerini inceleme yetkin yok.';
  end if;
  return query
  select t.user_id, t.ad, case when v_owner then t.eposta else null end, t.rol, t.talep_turu, t.durum, t.oneri, t.oneri_at,
         t.created_at, public._hs_ozet(t.user_id), v_owner
  from public.hesap_silme_talepleri t
  order by t.created_at;
end $$;
revoke all on function public.hesap_silme_talepleri_getir() from public, anon;
grant execute on function public.hesap_silme_talepleri_getir() to authenticated;

-- Admin (yetkisi açıksa) ya da owner: hangi veri gruplarının silineceğine dair ÖNERİ. Silme yapmaz.
create or replace function public.hesap_silme_oneri_gonder(p_user uuid, p_secimler jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.hesap_silme_inceleme_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  update public.hesap_silme_talepleri
     set durum = 'onerildi', oneri = coalesce(p_secimler, '{}'::jsonb), oneren_id = auth.uid(), oneri_at = now()
   where user_id = p_user;
  if not found then raise exception 'Silme talebi bulunamadı.'; end if;
end $$;
revoke all on function public.hesap_silme_oneri_gonder(uuid, jsonb) from public, anon;
grant execute on function public.hesap_silme_oneri_gonder(uuid, jsonb) to authenticated;

-- Owner: öneriyi reddet (talep tekrar "beklemede").
create or replace function public.hesap_silme_oneri_sifirla(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  update public.hesap_silme_talepleri set durum = 'beklemede', oneri = null, oneren_id = null, oneri_at = null where user_id = p_user;
end $$;
revoke all on function public.hesap_silme_oneri_sifirla(uuid) from public, anon;
grant execute on function public.hesap_silme_oneri_sifirla(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) OWNER: VERİ DÖKÜMÜ (JSON). Notlar E2EE olduğundan yalnızca SAYI verilir (şifreli metin işe yaramaz).
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_veri_ver(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if not exists (select 1 from public.hesap_silme_talepleri where user_id = p_user) then
    raise exception 'Bu üye için silme talebi yok.';
  end if;
  return jsonb_build_object(
    'olusturma',        now(),
    'ozet',             public._hs_ozet(p_user),
    'profil',           public._hs_json('profiles', 'id', p_user),
    'mesajlar_gonderen', public._hs_json('messages', 'sender_id', p_user),
    'konusmalar',       public._hs_json('conversations', 'user_id', p_user),
    'akademik_kaynaklar', public._hs_json('akademik_kaynaklar', 'user_id', p_user),
    'akademik_notlar',  public._hs_json('akademik_notlar', 'user_id', p_user),
    'dosya_yoneticisi_kayitlari', public._hs_json('r2_arsiv', 'sahip_id', p_user),
    'taslak_icerikler', public._hs_json('taslak_icerikler', 'created_by', p_user),
    'ozel_icerikler',   public._hs_json('special_content', 'author_id', p_user),
    'icerik_erisimleri', public._hs_json('content_access', 'user_id', p_user),
    'onay_gecmisi',     public._hs_json('onay_gecmisi', 'user_id', p_user),
    'indirme_loglari',  public._hs_json('indirme_loglari', 'user_id', p_user)
  );
end $$;
revoke all on function public.hesap_silme_veri_ver(uuid) from public, anon;
grant execute on function public.hesap_silme_veri_ver(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) SİLME HAZIRLIĞI (service_role): R2 anahtarları + Storage yolları
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_depolama_yollari(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_arsiv jsonb := '[]'::jsonb; v_ozel jsonb := '[]'::jsonb;
begin
  if to_regclass('public.r2_arsiv') is not null then
    select coalesce(jsonb_agg(r2_key), '[]'::jsonb) into v_arsiv from public.r2_arsiv where sahip_id = p_user and r2_key is not null;
  end if;
  if to_regclass('public.special_content') is not null and public._hs_kolon_var('special_content', 'file_path') then
    select coalesce(jsonb_agg(file_path), '[]'::jsonb) into v_ozel from public.special_content where author_id = p_user and file_path is not null;
  end if;
  return jsonb_build_object('arsiv_anahtarlari', v_arsiv, 'ozel_dosya_yollari', v_ozel, 'ozet', public._hs_ozet(p_user));
end $$;
revoke all on function public.hesap_silme_depolama_yollari(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8) KALICI TEMİZLİK (service_role): hesapla birlikte GİDEMEYEN (set null) satırlar + talep kaydı
--    p_secimler: {"arsiv": bool, "icerik": bool}  (varsayılan ikisi de true)
--    Cascade'li tablolar (notlar, mesajlar, akademik, erişim…) auth hesabı silinince zaten gider.
-- ----------------------------------------------------------------------------
create or replace function public.hesap_silme_kalici_temizle(p_user uuid, p_secimler jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_arsiv  boolean := coalesce((p_secimler ->> 'arsiv')::boolean, true);
  v_icerik boolean := coalesce((p_secimler ->> 'icerik')::boolean, true);
  s jsonb := '{}'::jsonb;
begin
  if v_arsiv then
    s := s || jsonb_build_object('arsiv', public._hs_sil('r2_arsiv', 'sahip_id', p_user));
  end if;
  if v_icerik then
    s := s || jsonb_build_object(
      'taslak', public._hs_sil('taslak_icerikler', 'created_by', p_user) + public._hs_sil('taslak_icerikler', 'yazar_id', p_user),
      'ozel_icerik', public._hs_sil('special_content', 'author_id', p_user));
  end if;
  s := s || jsonb_build_object('indirme_logu', public._hs_sil('indirme_loglari', 'user_id', p_user));
  delete from public.hesap_silme_talepleri where user_id = p_user;
  return s;
end $$;
revoke all on function public.hesap_silme_kalici_temizle(uuid, jsonb) from public, anon, authenticated;

-- HIZLI KONTROL:  select * from public.hesap_silme_talepleri_getir();  (owner ile)
