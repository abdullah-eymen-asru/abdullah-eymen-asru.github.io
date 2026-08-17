-- ============================================================================
-- 0024_admin_yetki_devri_kisitlama_ve_vaka_silme.sql
--
-- Bu migration üç ayrı istek/bildirimi kapsar. Sırayla:
--
--   § A) "Adminler kendi rolünü (Yönetici) alttaki rollere devredemesin/
--        veremesin": admin_set_user_role() şimdiye kadar HERHANGİ bir
--        admin'in başka bir üyeyi doğrudan 'admin' yapmasına izin
--        veriyordu — bu, migration 0021'in TÜM "karşılıklı denetim" (askıya
--        alma + çoğunluk oylaması/owner kararı) mimarisini by-pass eden bir
--        arka kapıydı: rogue/dikkatsiz bir admin, hiçbir onay süreci
--        olmadan istediği kadar "müttefik" admin yaratabilir ve çoğunluk
--        oylamasını anlamsızlaştırabilirdi. Aynı sebeple, VAR OLAN bir
--        admin'in rolünü BAŞKA bir admin'in bu genel RPC ile DOĞRUDAN
--        düşürmesi de artık engelleniyor — bir admin'i düşürmenin TEK
--        meşru yolu Admin Güvenliği sayfasındaki askıya alma + çoğunluk
--        oylaması/owner kararı akışıdır (bkz. migration 0021). Owner bu iki
--        kısıttan da MUAF: owner hem yeni admin atayabilir hem de
--        gerektiğinde bir admin'in rolünü doğrudan (askıya almadan)
--        değiştirebilir — tıpkı migration 0023 § B'nin düzelttiği "owner
--        aslında admin'in tüm yetkilerine sahip" ilkesiyle tutarlı.
--
--   § B) "Denetim vakaları geçmişini sadece site sahibi silebilsin, her
--        vakayı TEK TEK silebilsin": yeni denetim_vakasi_sil() RPC'si —
--        SADECE owner çağırabilir, tek bir vakayı (ve buna bağlı oy
--        satırlarını) siler. Log (admin_denetim_log) silinmiyor — audit
--        izinin kendisi hâlâ "değişmez" kalması gerektiği için (bkz.
--        migration 0021 § 3 tablo yorumu) satırlar denetim_id=null'a
--        düşürülüyor (zaten var olan "on delete set null" FK'siyle), silme
--        işleminin kendisi de ayrıca loglanıyor. AÇIK ("askıda") bir vaka
--        silinemez — aksi halde is_suspended=true kalmış bir kullanıcının
--        hiçbir denetim kaydı kalmaz ve askısı asla çözülemez hale gelirdi.
--
--   § C) "Denetim vakalarında yetkisi düşen adminin e-postası da isminin
--        yanında görünsün": denetim_vakalarini_listele() artık hedef_email
--        kolonunu da döndürüyor (dönen tablo şekli değiştiği için önce DROP
--        gerekiyor, CREATE OR REPLACE yetmez).
--
-- NOT (madde 3 — "yetkisi düşen kişi hemen üye olsun, girebilsin ama
-- yetkisiz olsun"): bu davranış zaten migration 0021'deki
-- _admin_denetim_sonuclandir() içinde vardı (hem oylama hem owner kararı
-- AYNI bu fonksiyonu çağırıyor; kalıcı düşürmede role := hedef_yeni_rol
-- (varsayılan 'user') yapılıyor, is_suspended := false, force-signout
-- YAPILMIYOR — yani kişi normal üye olarak anında giriş yapabiliyor). § A
-- bunu daha da netleştiriyor: artık bir admin'i düşürmenin TEK yolu bu akış
-- olduğu için, "yetkisi düşen kişi anında üye olur" garantisi HER durumda
-- (oylama/owner/timeout) geçerli — ayrıca bir kod değişikliği gerekmiyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0023 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- § A) admin_set_user_role(): admin -> admin devri/düşürmesi kapatılıyor
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_mevcut_rol text;
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

  select role into hedef_mevcut_rol from public.profiles where id = p_user_id;
  if hedef_mevcut_rol is null then
    raise exception 'Hedef kullanıcı bulunamadı.';
  end if;

  -- YENİ KISIT 1: bir admin (owner DEĞİL), başka bir üyeyi 'admin' yapamaz
  -- — kendi rolünü alttaki rollere "devredemez/veremez". Sadece owner yeni
  -- admin atayabilir.
  if p_new_role = 'admin' and hedef_mevcut_rol <> 'admin' and not public.is_owner() then
    raise exception 'Yetkisiz işlem: sadece Site Sahibi (owner) bir üyeyi Yönetici (admin) yapabilir.';
  end if;

  -- YENİ KISIT 2: bir admin (owner DEĞİL), zaten admin olan başka birinin
  -- rolünü bu genel RPC ile DOĞRUDAN değiştiremez (düşüremez/yükseltemez).
  -- Bir admin'i düşürmenin tek meşru yolu Admin Güvenliği sayfasındaki
  -- askıya alma + çoğunluk oylaması/owner kararı akışıdır (migration 0021).
  if hedef_mevcut_rol = 'admin' and p_new_role <> 'admin' and not public.is_owner() then
    raise exception 'Yetkisiz işlem: bir admin başka bir admin''in rolünü doğrudan değiştiremez. "Admin Güvenliği" sayfasından askıya alma/oylama sürecini başlat.';
  end if;

  update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

comment on function public.admin_set_user_role(uuid, text) is
  'Admin/owner bir üyenin rolünü değiştirir. owner rolü buradan ASLA verilemez (owner_rolu_ver kullanılır). Sıradan bir admin: (a) kimseyi ''admin'' yapamaz — sadece owner yeni admin atayabilir; (b) zaten admin olan birinin rolünü DOĞRUDAN değiştiremez — bir admin''i düşürmek için Admin Güvenliği sayfasındaki askıya alma + oylama/owner kararı akışı (migration 0021) kullanılmalıdır. owner her iki kısıttan da muaftır.';

-- ----------------------------------------------------------------------------
-- § B) Denetim vakası SİLME — SADECE owner, tek tek
-- ----------------------------------------------------------------------------
create or replace function public.denetim_vakasi_sil(p_denetim_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  vaka public.admin_denetim%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: denetim vakası geçmişini sadece Site Sahibi (owner) silebilir.';
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id;
  if vaka.id is null then
    raise exception 'Denetim vakası bulunamadı (zaten silinmiş olabilir).';
  end if;
  if vaka.durum = 'askida' then
    raise exception 'Açık (askıda) bir vaka silinemez — önce sonuçlanması (kalıcı düşürme/iptal/süre dolumu) gerekir.';
  end if;

  -- Silme işleminin kendisini logla (denetim_id=null: vaka az sonra
  -- silinecek, admin_denetim_log.denetim_id zaten "on delete set null" —
  -- bu satırı BAĞIMSIZ/kalıcı bir kayıt olarak en baştan öyle ekliyoruz).
  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (
    null, 'denetim_vakasi_silindi', auth.uid(),
    jsonb_build_object(
      'silinen_vaka_id', vaka.id,
      'hedef_admin_id', vaka.hedef_admin_id,
      'onceki_durum', vaka.durum,
      'sebep', vaka.sebep
    )
  );

  -- admin_denetim_oylari bu satıra "on delete cascade" ile bağlı, otomatik
  -- silinir. admin_denetim_log satırları "on delete set null" ile bağlı,
  -- audit izi (şeffaflık için) korunur — sadece vaka_id referansı kalkar.
  delete from public.admin_denetim where id = p_denetim_id;
end;
$$;

comment on function public.denetim_vakasi_sil(uuid) is
  'Tek bir denetim vakasını (ve bağlı oy satırlarını) kalıcı olarak siler — SADECE owner çağırabilir. Açık (durum=askida) vakalar silinemez. admin_denetim_log''daki ilgili satırlar silinmez (denetim_id null''a düşer), audit izi korunur; silme işleminin kendisi de ayrıca loglanır.';

grant execute on function public.denetim_vakasi_sil(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- § C) denetim_vakalarini_listele(): hedef adminin e-postası da dönsün
-- ----------------------------------------------------------------------------
drop function if exists public.denetim_vakalarini_listele();

create or replace function public.denetim_vakalarini_listele()
returns table (
  id uuid, hedef_admin_id uuid, hedef_ad text, hedef_email text,
  baslatan_admin_id uuid, baslatan_ad text,
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
    d.id, d.hedef_admin_id, hp.full_name, hp.email, d.baslatan_admin_id, bp.full_name,
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

comment on function public.denetim_vakalarini_listele() is
  'Panelin "Admin Güvenliği" sayfası için denetim vakaları listesi — hedef ve başlatan adminin adı + hedef adminin e-postası (yetkisi düşen/düşecek kişinin kim olduğu isim yanında e-posta ile de netleşsin diye) dahil.';

grant execute on function public.denetim_vakalarini_listele() to authenticated;

-- ============================================================================
-- BİTTİ. Ekstra kurulum adımı gerekmiyor — bu migration çalıştığı anda:
--   1) Sıradan adminler artık kimseyi "admin" yapamaz (sadece owner yapar).
--   2) Sıradan adminler artık bir admin'in rolünü "Üye Ayarları" sayfasından
--      doğrudan değiştiremez — Admin Güvenliği sayfasındaki askıya alma/
--      oylama akışını kullanmaları gerekir. Owner her ikisini de yapabilir.
--   3) Owner, Admin Güvenliği sayfasındaki her bir denetim vakasını
--      (askıda olmayanları) tek tek silebilir.
--   4) Denetim vakaları listesinde hedef adminin e-postası da görünür.
-- ============================================================================
