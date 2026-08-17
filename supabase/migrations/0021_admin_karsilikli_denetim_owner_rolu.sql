-- ============================================================================
-- 0021_admin_karsilikli_denetim_owner_rolu.sql
--
-- SORUN: "Adminlerin birbirinin yetkisini düşürmesi veya hesabı askıya
-- alması gerekiyor" isteği. Bkz. proje kökündeki tartışma:
--   1) Tek bir admin diğerini ANINDA kalıcı olarak atayabilirse -> "yetki
--      gasbı / rogue admin" riski (önce davranan kazanır).
--   2) TÜM adminlerin onayı beklenirse -> gerçek bir güvenlik ihlalinde
--      (ör. bir admin hesabı hacklendi) hızlı müdahale imkânsızlaşır.
--   3) Sadece 2 admin olan kurgularda ("A ve B") hakem/çoğunluk kavramı
--      matematiksel olarak anlamsızdır: kalan tek admin'in kendi oyu
--      "çoğunluk" sayılırsa, yetki gasbı riski AYNEN geri döner.
--
-- ÇÖZÜM MİMARİSİ (iki aşamalı: "acil fren" + "kalıcı karar"):
--
--   AŞAMA 1 — ASKIYA ALMA (tek admin, anında, geri alınabilir):
--     Herhangi bir admin/owner, şüpheli gördüğü başka bir admin'i TEK
--     BAŞINA "askıya" alabilir. Bu işlem:
--       a) O admin'in TÜM oturumlarını (refresh token + session) anında
--          iptal eder (mevcut admin_force_signout_user, migration 0009).
--       b) profiles.is_suspended = true yapar — bu bayrak public.is_admin()
--          fonksiyonunun İÇİNE gömülü olduğu için (bkz. § 2), askıya alınan
--          kişi elindeki access token süresi dolmadan (en geç ~1 saat)
--          bile HİÇBİR admin-only RLS politikasından veya RPC'den artık
--          geçemez — tek bir yerde (is_admin()) yapılan bu değişiklik,
--          projedeki TÜM admin yetkili noktaları otomatik kapatır.
--     Askıya almak KALICI DEĞİLDİR — tek başına kimseyi düşürmez, sadece
--     45-72 saatlik bir "soruşturma penceresi" açar (bkz. karar_son_tarihi).
--
--   AŞAMA 2 — KALICI KARAR (çoğunluk OYLAMASI + zaman aşımı + hiyerarşi):
--     Askıdaki bir vaka üç yoldan biriyle KESİN olarak sonuçlanır:
--       a) OYLAMA: hedef admin HARİÇ, askıda OLMAYAN tüm admin/owner'ların
--          BASİT ÇOĞUNLUĞU "düşür" oyu verirse -> kalıcı olarak düşürülür.
--          Aynı çoğunluk "geri aç" oyu verirse -> derhal eski haline döner.
--       b) OWNER KARARI: sistemde bir "owner" (Site Sahibi) varsa, owner
--          TEK BAŞINA (oylama beklemeden) vakayı kapatabilir — bu, 2 admin
--          senaryosundaki hakemsizlik sorununu çözen köşe taşıdır (bkz.
--          § 3'teki not).
--       c) ZAMAN AŞIMI (fail-safe): karar_son_tarihi'ne kadar ne oylama
--          çoğunluğa ulaşır ne de owner karar verirse, vaka OTOMATİK olarak
--          "geri aç" ile kapanır (varsayılan davranış HER ZAMAN güvenli
--          tarafta: kimse kalıcı olarak düşürülmüş OLMAZ). Bu, .github
--          workflow'u + Edge Function ile periyodik çağrılan
--          admin_denetim_zaman_asimini_isle() fonksiyonuyla yapılır
--          (bkz. supabase/functions/admin-denetim-zaman-asimi).
--
--   § 3 — 2 ADMİNLİK ÖZEL SENARYO (hakemsiz durum):
--     Sadece A ve B admin varsa ve sistemde owner YOKSA: A, B'yi askıya
--     aldığında oylamaya katılabilecek "hedef hariç, askıda olmayan
--     admin/owner" sayısı = 1 (yani sadece A'nın kendisi). Bu durumda
--     basit çoğunluk formülü (floor(N/2)+1 = 1) tek başına A'nın kendi
--     oyunu "çoğunluk" yapardı — TAM OLARAK önlemek istediğimiz yetki
--     gasbı senaryosu. Bunu KODDA engelliyoruz: gerekli_oy_sayisi hesabı
--     (§ "yardımcı: gerekli oy sayısını hesapla") sistemde HİÇ owner yoksa
--     ve N<=1 ise NULL döner; NULL ise oylama YOLU İLE ASLA otomatik
--     sonuçlanamaz (bkz. admin_denetim_oy_kullan). Tek çıkış yolu: (i) bir
--     owner atanıp o karar versin, ya da (ii) zaman aşımı otomatik geri
--     açsın. Yani 2 admin'lik kurguda TEK ADMIN diğerini asla kalıcı
--     olarak düşüremez — en fazla geçici olarak (en çok 72 saatliğine)
--     askıya alabilir, gerçek gasp girişimi kendiliğinden geri döner.
--     Kullanıcının notunda istediği "Site Sahibi gibi bir üst rol" tam
--     olarak bu köşe taşını kapatmak için ekleniyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0020 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ROL GENİŞLETME: 'owner' (panelde "Site Sahibi")
--    'owner', admin'in TÜM yetkilerine sahiptir (bkz. § 2, is_admin()
--    'owner'ı da kapsayacak şekilde genişletiliyor) + ekstra olarak:
--      - askıya alınamaz (admin_askiya_al hedefi owner ise reddeder),
--      - bir denetim vakasını TEK BAŞINA (oylama beklemeden) kapatabilir,
--      - başka birini owner yapabilir (owner_rolu_ver — SADECE owner
--        çağırabilir; admin_set_user_role ÜZERİNDEN owner rolü ASLA
--        verilemez, aksi halde bir admin kendini/başkasını owner yaparak
--        bu tüm mimariyi bypass ederdi — bkz. § 4).
--    İLK OWNER, tıpkı ilk admin gibi, elle SQL ile atanır (dosya sonu).
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'special_user', 'admin', 'editor', 'manager', 'owner'));

comment on column public.profiles.role is
  'user: normal üye | special_user: özel içerik erişimi olan üye | editor: sadece kendi taslaklarını yönetebilen içerik yöneticisi | manager (İçerik Sorumlusu): editor yazma yetkisi + özel içerik/R2 paylaşımı | admin: tam yetkili yönetici (başka bir admin tarafından askıya alınabilir) | owner (Site Sahibi): admin''in tüm yetkileri + adminler arası denetim vakalarını tek başına karara bağlama + owner atama; askıya alınamaz.';

-- Askıya alma bayrağı — bkz. dosya başı notu § "AŞAMA 1". Ayrı bir kolon
-- (admin_denetim tablosundaki durum yerine burada da tutuluyor) çünkü
-- is_admin() ve tüm RLS politikaları HER istekte hızlıca (join'siz) kontrol
-- edebilsin diye; admin_denetim ise tarihçe/oylama/log tutan asıl kaynaktır
-- ve bu kolonla senkronize tutulur (bkz. §§ 5-6-7 fonksiyonları).
alter table public.profiles
  add column if not exists is_suspended boolean not null default false;

comment on column public.profiles.is_suspended is
  'Bir admin başka bir admin''i "acil fren" olarak askıya aldığında true olur (bkz. admin_denetim tablosu ve admin_askiya_al()). true iken is_admin() bu kullanıcı için false döner — yani askıdaki admin, elindeki eski access token''ı süresi dolmadan bile HİÇBİR admin yetkisini kullanamaz.';

-- ----------------------------------------------------------------------------
-- 2) is_admin() GENİŞLETMESİ: 'owner'ı kapsasın + askıdaki admin'i ANINDA
--    dışarıda bıraksın.
--    Bu fonksiyon projede onlarca RLS politikası ve RPC tarafından
--    kullanılıyor (bkz. migration 0001, 0016 vb.) — burada TEK bir yerde
--    yapılan değişiklik, "owner her yerde admin gibi çalışsın" ve "askıya
--    alınan admin her yerde anında yetkisiz kalsın" gereksinimlerinin
--    İKİSİNİ de tek seferde, kod tekrarı olmadan sağlar.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'owner')
      and coalesce(is_suspended, false) = false
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

grant execute on function public.is_owner() to authenticated;

-- admin_set_user_role: 'owner' listeye EKLENMİYOR — bilhassa böyle.
-- Bir admin bu RPC ile kendini/başkasını owner yapamasın diye (bkz. § 4,
-- owner_rolu_ver ayrı ve sadece owner'a açık bir fonksiyondur). Ayrıca bir
-- admin, askıdaki (is_suspended=true) bir kullanıcının rolünü bu RPC ile
-- değiştiremesin diye de kontrol ekliyoruz — aksi halde "askıya alma"
-- akışı, doğrudan rol düşürme RPC'siyle by-pass edilebilirdi.
create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin/owner rol değiştirebilir.';
  end if;
  if p_new_role not in ('user', 'special_user', 'admin', 'editor', 'manager') then
    raise exception 'Geçersiz rol: % (owner rolü sadece owner_rolu_ver() ile verilebilir)', p_new_role;
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_suspended) then
    raise exception 'Bu kullanıcı şu anda askıda — önce ilgili denetim vakası sonuçlanmalı (admin_denetim tablosu).';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and role = 'owner') then
    raise exception 'Owner rolü bu fonksiyonla değiştirilemez.';
  end if;
  update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) ADMİN DENETİM TABLOLARI
-- ----------------------------------------------------------------------------
-- exclude using gist (uuid eşitliği) için gerekli — tablo oluşturulmadan
-- ÖNCE aktive edilmeli.
create extension if not exists btree_gist;

create table if not exists public.admin_denetim (
  id                  uuid primary key default gen_random_uuid(),
  hedef_admin_id      uuid not null references public.profiles(id) on delete cascade,
  baslatan_admin_id   uuid references public.profiles(id) on delete set null,
  sebep               text not null,
  durum               text not null default 'askida'
                      check (durum in ('askida', 'kalici_dusuruldu', 'iptal_edildi', 'suresi_doldu_geri_acildi')),
  hedef_yeni_rol      text not null default 'user',   -- çoğunluk "düşür" derse hedefin ineceği rol
  gerekli_oy_sayisi   int,                             -- NULL = oylamayla OTOMATİK sonuçlanamaz (bkz. § 3 notu, 2 admin senaryosu)
  created_at          timestamptz not null default now(),
  karar_son_tarihi    timestamptz not null,            -- created_at + soruşturma penceresi (bkz. § 5)
  sonuclanma_tarihi   timestamptz,
  sonuclandiran_id    uuid references public.profiles(id) on delete set null,  -- owner kararıysa dolu, oylama/timeout ise null

  -- Aynı hedef için aynı anda birden fazla AÇIK ("askida") vaka olmasın —
  -- bir admin zaten askıdaysa, ikinci bir admin onu tekrar "askıya
  -- alamaz" (admin_askiya_al zaten bunu ayrıca kontrol eder, bu kısıt
  -- veritabanı seviyesinde ikinci bir güvence).
  constraint admin_denetim_hedef_tek_acik_vaka
    exclude using gist (hedef_admin_id with =) where (durum = 'askida')
);

comment on table public.admin_denetim is
  'Bir admin''in başka bir admin''i askıya alma / kalıcı düşürme sürecinin TEK doğruluk kaynağı (state machine). durum: askida -> {kalici_dusuruldu | iptal_edildi | suresi_doldu_geri_acildi}. Tüm satır değişiklikleri sadece bu dosyadaki SECURITY DEFINER fonksiyonlar üzerinden yapılır — RLS doğrudan INSERT/UPDATE''e izin vermez (bkz. § 8).';

create table if not exists public.admin_denetim_oylari (
  denetim_id     uuid not null references public.admin_denetim(id) on delete cascade,
  oy_kullanan_id uuid not null references public.profiles(id) on delete cascade,
  oy             text not null check (oy in ('dusur', 'geri_ac')),
  created_at     timestamptz not null default now(),
  primary key (denetim_id, oy_kullanan_id)
);

comment on table public.admin_denetim_oylari is
  'Her admin/owner, açık bir denetim vakasına en fazla BİR oy verir (sonradan fikrini değiştirirse UPSERT ile günceller — bkz. admin_denetim_oy_kullan). Hedef admin''in kendisi oy kullanamaz.';

create table if not exists public.admin_denetim_log (
  id          bigint generated always as identity primary key,
  denetim_id  uuid references public.admin_denetim(id) on delete set null,
  olay        text not null,   -- 'askiya_alindi' | 'oy_kullanildi' | 'kalici_dusuruldu' | 'iptal_edildi' | 'suresi_doldu_geri_acildi' | 'owner_karari'
  aktor_id    uuid references public.profiles(id) on delete set null,
  detay       jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.admin_denetim_log is
  'Değişmez (append-only) denetim izi — şeffaflık için. Hiçbir satır UPDATE/DELETE edilmez, sadece INSERT. Panelde "İşlem Geçmişi" olarak gösterilir.';

create index if not exists idx_admin_denetim_hedef on public.admin_denetim(hedef_admin_id);
create index if not exists idx_admin_denetim_log_denetim on public.admin_denetim_log(denetim_id);

-- ----------------------------------------------------------------------------
-- 4) OWNER ATAMA — SADECE OWNER ÇAĞIRABİLİR
--    İlk owner elle SQL ile atanır (dosya sonu). Ondan sonraki her yeni
--    owner ATAMASI bu fonksiyon üzerinden, mevcut bir owner tarafından
--    yapılır — böylece "owner" rolü admin_set_user_role'ün (dolayısıyla
--    sıradan bir admin'in) asla erişemeyeceği ayrı bir yetki seviyesinde
--    kalır.
-- ----------------------------------------------------------------------------
create or replace function public.owner_rolu_ver(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: sadece mevcut bir owner (Site Sahibi) yeni owner atayabilir.';
  end if;
  update public.profiles set role = 'owner', is_suspended = false where id = p_user_id;
  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (null, 'owner_atandi', auth.uid(), jsonb_build_object('hedef_id', p_user_id));
end;
$$;

grant execute on function public.owner_rolu_ver(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) YARDIMCI: gerekli oy sayısını hesapla (bkz. dosya başı § 3 notu)
-- ----------------------------------------------------------------------------
create or replace function public._admin_denetim_gerekli_oy_sayisi(p_hedef_admin_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uygun_oyuncu_sayisi int;
  sistemde_owner_var  boolean;
begin
  select count(*) into uygun_oyuncu_sayisi
  from public.profiles
  where role in ('admin', 'owner')
    and id <> p_hedef_admin_id
    and coalesce(is_suspended, false) = false;

  select exists (select 1 from public.profiles where role = 'owner') into sistemde_owner_var;

  -- 2 ADMİNLİK ÖZEL SENARYO: hedef hariç sadece 1 (ya da 0) uygun oyuncu
  -- kaldıysa VE sistemde hiç owner yoksa, oylamayla OTOMATİK sonuçlanma
  -- KAPALI (NULL) — çünkü tek kalan admin'in kendi oyu "çoğunluk"
  -- sayılırdı. Bu durumda vaka SADECE owner ataması + owner kararı ya da
  -- zaman aşımı (otomatik geri açılma) ile kapanabilir.
  if uygun_oyuncu_sayisi <= 1 and not sistemde_owner_var then
    return null;
  end if;

  -- Normal durum: kalan uygun oyuncuların BASİT ÇOĞUNLUĞU.
  return floor(uygun_oyuncu_sayisi / 2.0) + 1;
end;
$$;

-- GÜVENLİK (ÖNEMLİ): PostgreSQL yeni bir fonksiyona VARSAYILAN olarak
-- PUBLIC rolüne (dolayısıyla "authenticated"e de, PUBLIC her rolün
-- üyesidir) EXECUTE izni verir — TABLOLARIN aksine fonksiyonlarda
-- varsayılan AÇIKTIR. Bu, "_" ile başlayan İÇ (internal) yardımcı
-- fonksiyonlarımız için TEHLİKELİDİR: bunlar kendi içlerinde auth.uid()
-- yetki kontrolü YAPMAZ (kontrol, onları çağıran admin_askiya_al /
-- admin_denetim_oy_kullan / owner_denetim_karar gibi dış fonksiyonlarda
-- yapılır). Açıkça revoke ETMEZSEK, herhangi bir "authenticated" kullanıcı
-- bu iç fonksiyonları DOĞRUDAN çağırıp (ör.
-- _admin_denetim_sonuclandir(vaka_id,'kalici_dusuruldu',null)) TÜM
-- oylama/owner-onay mekanizmasını by-pass edebilirdi. İç
-- SECURITY DEFINER fonksiyonlardan birbirini çağırmak bu revoke'lardan
-- ETKİLENMEZ (Postgres, bir SECURITY DEFINER fonksiyon içindeyken yapılan
-- iç çağrılarda "current_user"ı fonksiyonun SAHİBİNE çevirir, sahibin
-- kendi oluşturduğu fonksiyonlar üzerinde zaten örtük EXECUTE hakkı
-- vardır) — yani admin_askiya_al vs. bu fonksiyonu yine sorunsuz çağırır.
revoke execute on function public._admin_denetim_gerekli_oy_sayisi(uuid) from public, authenticated, anon;

-- ----------------------------------------------------------------------------
-- 6) AŞAMA 1 — ASKIYA ALMA ("Acil Fren")
-- ----------------------------------------------------------------------------
create or replace function public.admin_askiya_al(
  p_hedef_admin_id uuid,
  p_sebep text,
  p_soruzturma_penceresi_saat int default 72
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  yeni_vaka_id uuid;
  hedef_rol    text;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin/owner bir admin''i askıya alabilir.';
  end if;
  if p_hedef_admin_id = auth.uid() then
    raise exception 'Kendi kendini askıya alamazsın.';
  end if;
  if p_sebep is null or length(trim(p_sebep)) < 5 then
    raise exception 'Askıya alma sebebi zorunludur (en az 5 karakter) — şeffaflık/audit için.';
  end if;

  select role into hedef_rol from public.profiles where id = p_hedef_admin_id;
  if hedef_rol is null then
    raise exception 'Hedef kullanıcı bulunamadı.';
  end if;
  if hedef_rol = 'owner' then
    raise exception 'Owner (Site Sahibi) askıya alınamaz.';
  end if;
  if hedef_rol <> 'admin' then
    raise exception 'Bu akış sadece admin rolündeki kullanıcılar için geçerlidir. Diğer roller için admin_set_user_role kullanılır.';
  end if;
  if exists (select 1 from public.profiles where id = p_hedef_admin_id and is_suspended) then
    raise exception 'Bu admin zaten askıda.';
  end if;

  insert into public.admin_denetim (
    hedef_admin_id, baslatan_admin_id, sebep, gerekli_oy_sayisi, karar_son_tarihi
  ) values (
    p_hedef_admin_id, auth.uid(), trim(p_sebep),
    public._admin_denetim_gerekli_oy_sayisi(p_hedef_admin_id),
    now() + make_interval(hours => greatest(1, p_soruzturma_penceresi_saat))
  )
  returning id into yeni_vaka_id;

  update public.profiles set is_suspended = true where id = p_hedef_admin_id;

  -- ACİL FREN'in asıl "anında" kısmı: mevcut TÜM oturumları sonlandır.
  -- Migration 0009'daki fonksiyonu aynen yeniden kullanıyoruz — hem kod
  -- tekrarını önlüyor hem de "oturum sonlandırma" mantığının TEK bir
  -- yerde bakımlı kalmasını sağlıyor.
  perform public.admin_force_signout_user(p_hedef_admin_id);

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (yeni_vaka_id, 'askiya_alindi', auth.uid(),
          jsonb_build_object('hedef_id', p_hedef_admin_id, 'sebep', p_sebep));

  perform public._denetim_bildirim_gonder(yeni_vaka_id, 'askiya_alindi');

  return yeni_vaka_id;
end;
$$;

grant execute on function public.admin_askiya_al(uuid, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) AŞAMA 2a — ÇOĞUNLUK OYLAMASI
-- ----------------------------------------------------------------------------
create or replace function public.admin_denetim_oy_kullan(p_denetim_id uuid, p_oy text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  vaka           public.admin_denetim%rowtype;
  dusur_sayisi   int;
  geri_ac_sayisi int;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin/owner oy kullanabilir.';
  end if;
  if p_oy not in ('dusur', 'geri_ac') then
    raise exception 'Geçersiz oy: %', p_oy;
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id for update;
  if vaka.id is null then
    raise exception 'Denetim vakası bulunamadı.';
  end if;
  if vaka.durum <> 'askida' then
    raise exception 'Bu vaka zaten sonuçlanmış (durum: %).', vaka.durum;
  end if;
  if vaka.hedef_admin_id = auth.uid() then
    raise exception 'Kendi vakan için oy kullanamazsın.';
  end if;
  if now() > vaka.karar_son_tarihi then
    raise exception 'Bu vakanın karar süresi dolmuş — zaman aşımı işleyicisinin çalışmasını bekle (admin_denetim_zaman_asimini_isle).';
  end if;

  insert into public.admin_denetim_oylari (denetim_id, oy_kullanan_id, oy)
  values (p_denetim_id, auth.uid(), p_oy)
  on conflict (denetim_id, oy_kullanan_id) do update set oy = excluded.oy, created_at = now();

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (p_denetim_id, 'oy_kullanildi', auth.uid(), jsonb_build_object('oy', p_oy));

  -- 2 ADMİNLİK ÖZEL SENARYO: gerekli_oy_sayisi NULL ise (bkz. § 5),
  -- oylama BURADA SESSİZCE KAYDEDİLİR (audit/şeffaflık için) ama ASLA
  -- otomatik bir kalıcı karara yol açmaz — tek çıkış owner ataması ya da
  -- zaman aşımıdır.
  if vaka.gerekli_oy_sayisi is null then
    return;
  end if;

  select count(*) filter (where oy = 'dusur') , count(*) filter (where oy = 'geri_ac')
    into dusur_sayisi, geri_ac_sayisi
  from public.admin_denetim_oylari
  where denetim_id = p_denetim_id;

  if dusur_sayisi >= vaka.gerekli_oy_sayisi then
    perform public._admin_denetim_sonuclandir(p_denetim_id, 'kalici_dusuruldu', null);
  elsif geri_ac_sayisi >= vaka.gerekli_oy_sayisi then
    perform public._admin_denetim_sonuclandir(p_denetim_id, 'iptal_edildi', null);
  end if;
end;
$$;

grant execute on function public.admin_denetim_oy_kullan(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) AŞAMA 2b — OWNER KARARI (2 admin'lik hakemsiz senaryonun çözümü)
-- ----------------------------------------------------------------------------
create or replace function public.owner_denetim_karar(p_denetim_id uuid, p_karar text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: sadece owner (Site Sahibi) bu kararı verebilir.';
  end if;
  if p_karar not in ('dusur', 'iptal') then
    raise exception 'Geçersiz karar: %', p_karar;
  end if;
  perform public._admin_denetim_sonuclandir(
    p_denetim_id,
    case p_karar when 'dusur' then 'kalici_dusuruldu' else 'iptal_edildi' end,
    auth.uid()
  );
end;
$$;

grant execute on function public.owner_denetim_karar(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9) ORTAK SONUÇLANDIRMA (dahili) — hem oylama hem owner hem zaman aşımı
--    tarafından çağrılır. Tek bir yerde durum geçişini + is_suspended
--    senkronunu + rol düşürmeyi + oturum sonlandırmayı (düşürme
--    durumunda) + log/bildirimi yapar.
-- ----------------------------------------------------------------------------
create or replace function public._admin_denetim_sonuclandir(
  p_denetim_id uuid,
  p_yeni_durum text,
  p_sonuclandiran_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  vaka public.admin_denetim%rowtype;
begin
  select * into vaka from public.admin_denetim where id = p_denetim_id for update;
  if vaka.id is null or vaka.durum <> 'askida' then
    return; -- zaten sonuçlanmış (yarış durumu koruması) — sessizce çık
  end if;

  update public.admin_denetim
  set durum = p_yeni_durum,
      sonuclanma_tarihi = now(),
      sonuclandiran_id = p_sonuclandiran_id
  where id = p_denetim_id;

  if p_yeni_durum = 'kalici_dusuruldu' then
    -- Kalıcı düşürme: rol iner VE askı bayrağı kalkar (artık "askıda"
    -- değil, kalıcı olarak yeni, düşük rolde). Rol düştüğü için ayrıca
    -- force-signout GEREKMEZ (zaten askıya alınırken oturumları
    -- sonlandırılmıştı, yeniden giriş yaparsa da artık admin değildir).
    update public.profiles
    set role = vaka.hedef_yeni_rol, is_suspended = false
    where id = vaka.hedef_admin_id;
  else
    -- iptal_edildi | suresi_doldu_geri_acildi: masumiyet/fail-safe ->
    -- eski admin yetkisi tamamen geri gelir.
    update public.profiles set is_suspended = false where id = vaka.hedef_admin_id;
  end if;

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (
    p_denetim_id,
    case p_yeni_durum
      when 'kalici_dusuruldu' then 'kalici_dusuruldu'
      when 'iptal_edildi' then 'iptal_edildi'
      else 'suresi_doldu_geri_acildi'
    end,
    p_sonuclandiran_id,
    jsonb_build_object('hedef_id', vaka.hedef_admin_id)
  );

  perform public._denetim_bildirim_gonder(p_denetim_id, p_yeni_durum);
end;
$$;

-- GÜVENLİK: bkz. § 5 sonundaki uzun not — bu fonksiyon HİÇBİR yetki
-- kontrolü yapmaz (çağıran admin_askiya_al/admin_denetim_oy_kullan/
-- owner_denetim_karar/zaman aşımı fonksiyonlarında zaten yapılmıştır), bu
-- yüzden PUBLIC/authenticated'den MUTLAKA revoke edilmesi gerekir — aksi
-- halde herhangi bir üye bunu doğrudan çağırıp bir admin'i oylama/owner
-- onayı OLMADAN kalıcı olarak düşürebilirdi.
revoke execute on function public._admin_denetim_sonuclandir(uuid, text, uuid) from public, authenticated, anon;

-- ----------------------------------------------------------------------------
-- 10) AŞAMA 2c — ZAMAN AŞIMI (fail-safe, service_role/cron çağırır)
--     Kimse karar veremezse (2 admin'lik senaryoda owner atanmadıysa,
--     ya da oylama çoğunluğa ulaşmadıysa) 72 saat sonunda vaka OTOMATİK
--     "geri aç" ile kapanır — varsayılan HER ZAMAN güvenli taraf: kimse
--     kalıcı olarak düşürülmüş OLMAZ.
-- ----------------------------------------------------------------------------
create or replace function public.admin_denetim_zaman_asimini_isle()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r public.admin_denetim%rowtype;
  islenen int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Bu fonksiyon sadece zamanlanmış görev (service_role) tarafından çağrılabilir.';
  end if;

  for r in
    select * from public.admin_denetim
    where durum = 'askida' and karar_son_tarihi < now()
  loop
    perform public._admin_denetim_sonuclandir(r.id, 'suresi_doldu_geri_acildi', null);
    islenen := islenen + 1;
  end loop;

  return islenen;
end;
$$;

revoke execute on function public.admin_denetim_zaman_asimini_isle() from public, authenticated, anon;
grant execute on function public.admin_denetim_zaman_asimini_isle() to service_role;

-- ----------------------------------------------------------------------------
-- 11) BİLDİRİM (Webhook/SMS) — pg_net ile async HTTP POST
--     Ayarlar tek satırlık bir tabloda tutulur (site_settings deseniyle
--     aynı) — webhook URL'i deploy/redeploy gerekmeden panelden
--     değiştirilebilsin diye. Gerçek SMS/Telegram/Slack YÖNLENDİRMESİ,
--     bu URL'in gösterdiği bir Cloudflare Worker'da yapılır (bkz.
--     cloudflare worker/admin_guvenlik_bildirim_worker/worker.js) — pg_net
--     doğrudan Twilio/Telegram sırlarını (secrets) TUTMAMALI, o yüzden
--     araya bir worker konuyor (r2_storage_worker / github_icerik_yonetim_worker
--     ile AYNI desen: sır Cloudflare Worker ortam değişkeninde durur).
-- ----------------------------------------------------------------------------
create extension if not exists pg_net;

create table if not exists public.guvenlik_bildirim_ayarlari (
  id          int primary key default 1 check (id = 1),
  webhook_url text,   -- ör. Cloudflare Worker URL'i (SMS/Telegram/Slack'e yönlendirir)
  aktif       boolean not null default false,
  updated_at  timestamptz not null default now()
);
insert into public.guvenlik_bildirim_ayarlari (id) values (1) on conflict (id) do nothing;

create or replace function public._denetim_bildirim_gonder(p_denetim_id uuid, p_olay text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  ayar   public.guvenlik_bildirim_ayarlari%rowtype;
  vaka   public.admin_denetim%rowtype;
  yuk    jsonb;
begin
  select * into ayar from public.guvenlik_bildirim_ayarlari where id = 1;
  if ayar.webhook_url is null or not ayar.aktif then
    return; -- webhook kurulmamış/kapalıysa sessizce çık — bildirim opsiyoneldir
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id;

  yuk := jsonb_build_object(
    'olay', p_olay,
    'denetim_id', p_denetim_id,
    'hedef_admin_id', vaka.hedef_admin_id,
    'sebep', vaka.sebep,
    'durum', vaka.durum,
    'zaman', now()
  );

  -- pg_net İSTEĞİ KUYRUĞA ALIR ve arka planda gönderir (fonksiyon burada
  -- BLOKLANMAZ) — yanıtı beklemeyiz, bu yüzden askıya alma/oylama
  -- işlemleri webhook yavaş/kapalıysa bile asla gecikmez/başarısız olmaz.
  perform net.http_post(
    url := ayar.webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := yuk
  );
exception when others then
  -- Bildirim ASLA ana işlemi (askıya alma/oylama/düşürme) başarısız
  -- kılmasın — pg_net kurulu değilse ya da worker cevap vermezse bile
  -- güvenlik akışı çalışmaya devam eder.
  raise notice 'Denetim bildirimi gönderilemedi: %', SQLERRM;
end;
$$;

-- GÜVENLİK: yetki kontrolü yok (bkz. § 5/§ 9 notları) — doğrudan çağrılırsa
-- bir üye sahte bir webhook olayı tetikleyebilirdi (düşük risk ama gereksiz
-- bir yüzey), yine de tutarlılık için revoke ediyoruz.
revoke execute on function public._denetim_bildirim_gonder(uuid, text) from public, authenticated, anon;

-- ----------------------------------------------------------------------------
-- 12) LİSTELEME RPC'Lİ — panelin "Admin Güvenliği" sayfası için dar
--     görünümler (profiles tablosunun tamamını doğrudan çekmek yerine —
--     migration 0020'deki admin_listesi_getir ile AYNI desen).
-- ----------------------------------------------------------------------------
-- yardımcı: hem is_admin() hem "askıda olsa bile KENDİ görünümünü
-- görebilsin" (askıdaki admin panele girip kendi vakasının durumunu takip
-- edebilmeli, sadece işlem yapamamalı) mantığını tek yerde topluyoruz.
-- ÖNEMLİ: aşağıdaki guvenlik_admin_listesi_getir() ve
-- denetim_vakalarini_listele() (language sql) bunu İÇLERİNDE çağırıyor —
-- "language sql" fonksiyonların gövdesi CREATE anında (check_function_bodies
-- açıkken, varsayılan budur) referans verdiği fonksiyonların ZATEN var
-- olmasını ister; bu yüzden bu fonksiyon dosyada ONLARDAN ÖNCE tanımlanır.
create or replace function public.is_admin_or_owner_gorebilir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'owner')
  );
$$;

grant execute on function public.is_admin_or_owner_gorebilir() to authenticated;

create or replace function public.guvenlik_admin_listesi_getir()
returns table (id uuid, full_name text, email text, role text, is_suspended boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.is_suspended
  from public.profiles p
  where p.role in ('admin', 'owner') and public.is_admin_or_owner_gorebilir()
  order by p.role desc, p.full_name nulls last;
$$;

grant execute on function public.guvenlik_admin_listesi_getir() to authenticated;

create or replace function public.denetim_vakalarini_listele()
returns table (
  id uuid, hedef_admin_id uuid, hedef_ad text, baslatan_admin_id uuid, baslatan_ad text,
  sebep text, durum text, hedef_yeni_rol text, gerekli_oy_sayisi int,
  created_at timestamptz, karar_son_tarihi timestamptz,
  sonuclanma_tarihi timestamptz, dusur_oylari int, geri_ac_oylari int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.hedef_admin_id, hp.full_name, d.baslatan_admin_id, bp.full_name,
    d.sebep, d.durum, d.hedef_yeni_rol, d.gerekli_oy_sayisi,
    d.created_at, d.karar_son_tarihi, d.sonuclanma_tarihi,
    (select count(*)::int from public.admin_denetim_oylari o where o.denetim_id = d.id and o.oy = 'dusur'),
    (select count(*)::int from public.admin_denetim_oylari o where o.denetim_id = d.id and o.oy = 'geri_ac')
  from public.admin_denetim d
  left join public.profiles hp on hp.id = d.hedef_admin_id
  left join public.profiles bp on bp.id = d.baslatan_admin_id
  where public.is_admin_or_owner_gorebilir()
  order by d.created_at desc
  limit 100;
$$;

grant execute on function public.denetim_vakalarini_listele() to authenticated;

-- ----------------------------------------------------------------------------
-- 13) RLS — yeni tablolar. Doğrudan yazma YOK (default deny); tüm
--     değişiklikler yukarıdaki SECURITY DEFINER fonksiyonlar üzerinden.
--     Okuma da doğrudan tablodan değil, dar RPC'ler (§ 12) üzerinden
--     yapılır ama tabloları tamamen kapalı bırakmak yerine yine de bir
--     SELECT politikası tanımlıyoruz (defense-in-depth — ileride biri
--     doğrudan .from("admin_denetim") çağırırsa boş dönmesin diye DEĞİL,
--     tam tersi: en azından SADECE admin/owner görebilsin diye).
-- ----------------------------------------------------------------------------
alter table public.admin_denetim enable row level security;
alter table public.admin_denetim_oylari enable row level security;
alter table public.admin_denetim_log enable row level security;
alter table public.guvenlik_bildirim_ayarlari enable row level security;

drop policy if exists "denetim_select_admin_owner" on public.admin_denetim;
create policy "denetim_select_admin_owner"
  on public.admin_denetim for select
  using (public.is_admin_or_owner_gorebilir());

drop policy if exists "denetim_oylari_select_admin_owner" on public.admin_denetim_oylari;
create policy "denetim_oylari_select_admin_owner"
  on public.admin_denetim_oylari for select
  using (public.is_admin_or_owner_gorebilir());

drop policy if exists "denetim_log_select_admin_owner" on public.admin_denetim_log;
create policy "denetim_log_select_admin_owner"
  on public.admin_denetim_log for select
  using (public.is_admin_or_owner_gorebilir());

drop policy if exists "bildirim_ayar_select_admin_owner" on public.guvenlik_bildirim_ayarlari;
create policy "bildirim_ayar_select_admin_owner"
  on public.guvenlik_bildirim_ayarlari for select
  using (public.is_admin());

drop policy if exists "bildirim_ayar_update_owner_only" on public.guvenlik_bildirim_ayarlari;
create policy "bildirim_ayar_update_owner_only"
  on public.guvenlik_bildirim_ayarlari for update
  using (public.is_owner())
  with check (public.is_owner());
-- NOT: insert/delete politikası YOK (tek satır zaten yukarıda oluşturuldu,
-- default deny ile ekstra satır eklenmesi/silinmesi engellenir).

-- ============================================================================
-- BİTTİ. Kurulum:
--
--   1) İLK OWNER'I elle ata (tıpkı ilk admin gibi):
--
--      update public.profiles set role = 'owner' where email = 'SENIN_EPOSTAN@ornek.com';
--
--      NOT: Owner atamak ZORUNLU DEĞİL — owner hiç atanmazsa sistem 3+
--      admin'li kurgularda normal çoğunluk oylamasıyla çalışmaya devam
--      eder. Owner SADECE 2 admin'lik hakemsiz senaryoyu (bkz. § 3) ve
--      "acil owner kararı" ihtiyacını çözer.
--
--   2) (Opsiyonel) Webhook/SMS bildirimini açmak için:
--
--      update public.guvenlik_bildirim_ayarlari
--      set webhook_url = 'https://<worker-adresin>.workers.dev/', aktif = true
--      where id = 1;
--
--      (bkz. cloudflare worker/admin_guvenlik_bildirim_worker/worker.js)
--
--   3) supabase/functions/admin-denetim-zaman-asimi Edge Function'ını
--      deploy et ve .github/workflows/admin-denetim-zaman-asimi.yml
--      cron'unu (her 15 dakikada bir) devreye al — bkz. o dosyaların
--      başındaki kurulum notları.
-- ============================================================================
