-- ============================================================================
-- 0026_admin_adina_onay_sadece_hedef_admin.sql
--
-- İSTEK: "İçerik editörü (manager/editor) bir admin adına yazı yazacaksa
-- SADECE O ADMIN onay verebilsin (Site Sahibi de onay verme hakkı olsun).
-- Aynı şekilde bir admin başka bir admin için yazı yazabilsin ama SADECE O
-- ADMIN kabul/red edebilsin (Site Sahibi de kabul/red edebilsin)."
--
-- KÖK DURUM (migration 0016/0023'ten beri): "admin adına yayınla" (§
-- admin_adina_talep) bir talep bekleyen içeriği HERHANGİ bir admin/owner
-- (public.is_admin() true dönen HERKES) onaylayabiliyor/reddedebiliyordu —
-- yani X admin'i adına yazılan bir taslağı, Y admin'i de onaylayabiliyordu.
-- Bu, "Site Sahibi adına" akışının (migration 0023 § A) TASARIM GEREĞİ
-- adminlerin çoğunluk oyuna/owner'a açık olmasından FARKLI bir davranış
-- bekleniyor burada: "admin adına" akışında istenen, SADECE o içeriğin
-- adına yazıldığı admin'in (yazar_id) YA DA Site Sahibi'nin (owner) karar
-- verebilmesi — başka hiçbir admin'in DEĞİL.
--
-- DEĞİŞEN İKİ YER:
--   1) taslak_admin_onay_koru() tetikleyicisi (migration 0016 §6 / 0023 §
--      A.4): "ADMİN ADINA" bölümünde artık `caller_is_admin` yerine "çağıran
--      owner mı YA DA çağıran tam olarak bu taslağın yazar_id'si mi"
--      kontrol ediliyor. Hedef olmayan bir admin admin_onay_durumu'nu
--      'onaylandi'/'reddedildi' yapmaya çalışırsa (INSERT ya da UPDATE ile),
--      tıpkı manager/editor'da olduğu gibi durum sessizce 'beklemede'ye
--      zorlanır (zaten onaylanmış bir satırı düşürmez — küçük düzenlemeler
--      onayı geri almasın diye). FİİLİ YAYIN ENGELİ de aynı şekilde
--      sıkılaştırıldı: artık "içerik gerçekten yayına alınamaz" kuralı
--      SADECE hedef admin/owner için değil, hedef OLMAYAN bir admin için de
--      geçerli (önceden herhangi bir admin, onay olmadan da doğrudan
--      yayınlayabilirdi — bu açık kapatıldı).
--   2) admin_taslak_onayla() RPC'si (migration 0016 §7): artık sadece
--      is_admin() değil, çağıranın owner OLMASI YA DA taslağın yazar_id'sine
--      BİREBİR eşit olması gerekiyor.
--
-- "Site Sahibi adına" (sahip_adina_talep) akışına DOKUNULMADI — o hâlâ
-- migration 0023'teki gibi ya owner'ın tek başına kararıyla ya da
-- adminlerin mutlak çoğunluğunun oyuyla sonuçlanıyor (bu ayrı bir tasarım
-- kararıydı, bu turun kapsamında değişmiyor).
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0025 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) YARDIMCI: "bu taslağın admin-adına onayını/reddini VERME yetkisi bu
--    kullanıcıda mı?" — owner HER ZAMAN yetkili; sıradan bir admin SADECE
--    kendisi o taslağın yazar_id'si (yani içerik kendi adına yazılıyorsa)
--    ise yetkili. Hem tetikleyicide hem RPC'de aynı mantığın TEK bir yerde
--    (kod tekrarı olmadan) tutulması için ayrı bir fonksiyon.
-- ----------------------------------------------------------------------------
create or replace function public._taslak_admin_onay_yetkilisi_mi(p_yazar_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or (public.is_admin() and auth.uid() = p_yazar_id);
$$;

comment on function public._taslak_admin_onay_yetkilisi_mi(uuid) is
  '"Admin adına yayınla" talebine (admin_adina_talep) onay/red verme yetkisi SADECE Site Sahibi (owner) ile, içeriğin adına yazıldığı admin''in (p_yazar_id = auth.uid() ve o kişi admin) kendisindedir — başka hiçbir admin bu yetkiye sahip değildir.';

grant execute on function public._taslak_admin_onay_yetkilisi_mi(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1) TETİKLEYİCİ FONKSİYONU: "ADMİN ADINA" bölümü hedef admin'e (+ owner'a)
--    daraltılıyor. "SİTE SAHİBİ ADINA" bölümü ve karşılıklı dışlama AYNEN
--    (migration 0023'teki gibi) korunuyor.
-- ----------------------------------------------------------------------------
create or replace function public.taslak_admin_onay_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
  caller_is_owner boolean;
  oy_degerlendirme_bypass boolean;
  caller_hedef_admin_yetkilisi boolean;
begin
  caller_is_admin := public.is_admin();
  caller_is_owner := public.is_owner();
  oy_degerlendirme_bypass := coalesce(current_setting('app.sahip_onay_bypass', true), 'false') = 'true';
  -- YENİ: "admin adına" onay/red YALNIZCA hedef admin''in kendisinde YA DA
  -- owner'da — new.yazar_id henüz doğrulanmamış olabilir (aşağıda kontrol
  -- edilir) ama boolean karşılaştırma NULL/geçersiz değerde güvenle false'a
  -- düşer (plpgsql IF, NULL'ı false sayar), bu yüzden sırayı önemsemeden
  -- burada baştan hesaplayabiliriz.
  caller_hedef_admin_yetkilisi := caller_is_owner or (caller_is_admin and auth.uid() = new.yazar_id);

  -- ---- ADMİN ADINA (DARALTILDI: sadece hedef admin veya owner onaylayabilir/reddedebilir) ----
  if not new.admin_adina_talep then
    new.admin_onay_durumu := 'yok';
    new.onaylayan_id := null;
    new.onay_tarihi := null;
  else
    if caller_hedef_admin_yetkilisi then
      -- Hedef admin'in kendisi ya da owner serbestçe onaylayabilir/reddedebilir.
      if new.admin_onay_durumu in ('onaylandi', 'reddedildi')
         and (tg_op = 'INSERT' or old.admin_onay_durumu is distinct from new.admin_onay_durumu) then
        new.onaylayan_id := auth.uid();
        new.onay_tarihi := now();
      end if;
    else
      -- Hedef admin/owner OLMAYAN biri (manager/editor VEYA BAŞKA BİR ADMİN)
      -- admin_onay_durumu'nu KENDİSİ asla 'onaylandi'/'reddedildi' yapamaz —
      -- ne gönderirse gönderilsin 'beklemede'ye zorlanır. İstisna: daha önce
      -- hedef admin/owner tarafından zaten 'onaylandi' yapılmış bir satırı
      -- düzenlerken (ör. yazım hatası düzeltme) onay durumunu DÜŞÜRMÜYORUZ,
      -- aksi halde her küçük düzenlemede onay tekrar isteniyor olurdu.
      if tg_op = 'UPDATE' and old.admin_onay_durumu = 'onaylandi' then
        new.admin_onay_durumu := old.admin_onay_durumu;
        new.onaylayan_id := old.onaylayan_id;
        new.onay_tarihi := old.onay_tarihi;
      else
        new.admin_onay_durumu := 'beklemede';
        new.onaylayan_id := null;
        new.onay_tarihi := null;
      end if;

      -- yazar_id gerçekten bir admin'e mi ait, kontrol et — manager/editor
      -- (ya da başka bir admin) rastgele bir kullanıcı adına "admin onayı"
      -- talebi süsü veremesin.
      if new.yazar_id is null or not exists (
        select 1 from public.profiles where id = new.yazar_id and role = 'admin'
      ) then
        raise exception 'admin_adina_talep = true iken yazar_id geçerli bir admin profiline ait olmalı.';
      end if;
    end if;
  end if;

  -- ---- SİTE SAHİBİ (owner) ADINA — DOKUNULMADI (migration 0023 ile birebir aynı) ----
  if not new.sahip_adina_talep then
    new.sahip_onay_durumu := 'yok';
    new.sahip_onaylayan_id := null;
    new.sahip_onay_tarihi := null;
  else
    if oy_degerlendirme_bypass then
      new.sahip_onaylayan_id := null;
      new.sahip_onay_tarihi := coalesce(new.sahip_onay_tarihi, now());
    elsif caller_is_owner then
      if new.sahip_onay_durumu in ('onaylandi', 'reddedildi')
         and (tg_op = 'INSERT' or old.sahip_onay_durumu is distinct from new.sahip_onay_durumu) then
        new.sahip_onaylayan_id := auth.uid();
        new.sahip_onay_tarihi := now();
      end if;
    else
      if tg_op = 'UPDATE' and old.sahip_onay_durumu in ('onaylandi', 'reddedildi') then
        new.sahip_onay_durumu := old.sahip_onay_durumu;
        new.sahip_onaylayan_id := old.sahip_onaylayan_id;
        new.sahip_onay_tarihi := old.sahip_onay_tarihi;
      else
        new.sahip_onay_durumu := 'beklemede';
        new.sahip_onaylayan_id := null;
        new.sahip_onay_tarihi := null;
      end if;

      if new.yazar_id is null or not exists (
        select 1 from public.profiles where id = new.yazar_id and role = 'owner'
      ) then
        raise exception 'sahip_adina_talep = true iken yazar_id geçerli bir Site Sahibi (owner) profiline ait olmalı.';
      end if;
    end if;
  end if;

  -- ---- KARŞILIKLI DIŞLAMA ----
  if new.admin_adina_talep and new.sahip_adina_talep then
    raise exception 'Bir içerik aynı anda hem admin hem Site Sahibi adına talep edilemez.';
  end if;

  -- ---- FİİLİ YAYIN ENGELİ: ADMİN ADINA (DARALTILDI) ----
  -- ÖNCEDEN: "not caller_is_admin" — yani HERHANGİ bir admin, onay
  -- olmadan bile bu satırı doğrudan yayında bir duruma çekebiliyordu.
  -- ARTIK: sadece hedef admin'in kendisi ya da owner bu engeli aşabilir.
  if new.admin_adina_talep
     and new.admin_onay_durumu <> 'onaylandi'
     and new.yayin_durumu in ('sadece_supabase', 'supabase_ve_github')
     and not caller_hedef_admin_yetkilisi then
    raise exception 'Bu içerik Admin adına yayınlanmak üzere onay bekliyor; sadece o adına yazılan admin veya Site Sahibi onaylamadan yayınlanamaz.';
  end if;

  -- ---- FİİLİ YAYIN ENGELİ: SİTE SAHİBİ ADINA — DOKUNULMADI ----
  if new.sahip_adina_talep
     and new.sahip_onay_durumu <> 'onaylandi'
     and new.yayin_durumu in ('sadece_supabase', 'supabase_ve_github')
     and not caller_is_owner
     and not oy_degerlendirme_bypass then
    raise exception 'Bu içerik Site Sahibi adına yayınlanmak üzere onay bekliyor; site sahibi onaylamadan (ya da adminlerin mutlak çoğunluğu onaylamadan) yayınlanamaz.';
  end if;

  return new;
end;
$$;

-- trigger zaten migration 0016'da oluşturulmuştu, fonksiyon CREATE OR
-- REPLACE ile güncellendiği için trigger'ı yeniden oluşturmaya gerek yok —
-- yine de açıklık için burada da bırakıyoruz.
drop trigger if exists trg_taslak_admin_onay_koru on public.taslak_icerikler;
create trigger trg_taslak_admin_onay_koru
  before insert or update on public.taslak_icerikler
  for each row execute function public.taslak_admin_onay_koru();

-- ----------------------------------------------------------------------------
-- 2) admin_taslak_onayla() RPC'si: artık is_admin() yetmiyor — çağıran
--    owner OLMALI YA DA taslağın yazar_id'sine BİREBİR eşit olmalı.
-- ----------------------------------------------------------------------------
create or replace function public.admin_taslak_onayla(p_taslak_id uuid, p_onay boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yazar_id uuid;
begin
  select yazar_id into v_yazar_id
  from public.taslak_icerikler
  where id = p_taslak_id and admin_adina_talep = true;

  if v_yazar_id is null then
    raise exception 'Taslak bulunamadı ya da "admin adına" bir talep değil.';
  end if;

  if not public._taslak_admin_onay_yetkilisi_mi(v_yazar_id) then
    raise exception 'Yetkisiz işlem: bu içeriği SADECE adına yazıldığı admin ya da Site Sahibi (owner) onaylayabilir/reddedebilir.';
  end if;

  update public.taslak_icerikler
  set admin_onay_durumu = case when p_onay then 'onaylandi' else 'reddedildi' end
  where id = p_taslak_id and admin_adina_talep = true;
end;
$$;

comment on function public.admin_taslak_onayla(uuid, boolean) is
  '"Admin adına yayınla" talebini onaylar/reddeder — SADECE içeriğin adına yazıldığı admin''in kendisi ya da Site Sahibi (owner) çağırabilir; başka bir admin çağırırsa reddedilir.';

grant execute on function public.admin_taslak_onayla(uuid, boolean) to authenticated;

-- ============================================================================
-- BİTTİ. Ekstra kurulum adımı gerekmiyor — bu migration çalıştığı anda:
--
--   1) Bir manager/editor (ya da başka bir admin) "X admin adına yayınla"
--      talebi oluşturduğunda, artık SADECE X admin'in kendisi ya da Site
--      Sahibi (owner) "Onayla"/"Reddet" butonlarını kullanabilir — panel
--      tarafı da (bkz. assets/js/github-yonetim/github-yonetim.js) bu
--      butonları artık sadece o kişilere gösteriyor.
--   2) Hedef OLMAYAN bir admin, ne panelden ne de doğrudan RPC/UPDATE ile
--      bu içeriği onaylayamaz/reddedemez/yayınlayamaz — veritabanı
--      seviyesinde (tetikleyici + RPC) engellenir.
--   3) "Site Sahibi adına" (sahip_adina_talep) akışı DEĞİŞMEDİ — hâlâ
--      owner'ın tek başına kararı ya da adminlerin mutlak çoğunluk oyu ile
--      sonuçlanıyor.
-- ============================================================================
