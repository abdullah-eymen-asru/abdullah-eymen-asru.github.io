-- ============================================================================
-- 0023_rol_hiyerarsisi_onay_akislari_ve_erisim_duzeltmeleri.sql
--
-- Bu migration üç ayrı istek/bug bildirimini kapsar. Sırayla:
--
--   § A) "İçerik Sorumlusu" (manager) ve "Editör" artık SADECE admin adına
--        değil, Site Sahibi (owner) adına da içerik yazıp onaya
--        gönderebiliyor. Admin adına talepler eskisi gibi (herhangi bir
--        admin/owner onayı yeterli) çalışmaya devam ediyor; Site Sahibi
--        adına talepler ise YA site sahibinin tek başına onayıyla YA DA
--        adminlerin MUTLAK ÇOĞUNLUĞUNUN (toplam admin sayısının
--        floor(n/2)+1'i) onay OYUYLA sonuçlanıyor.
--
--   § B) BUG DÜZELTMESİ — "Site sahibi üye yetki/ayarlarını değiştirirken
--        hata alıyor" + "Site sahibi birini yönetici yapamıyor":
--        KÖK NEDEN bulundu: migration 0001'de eklenen
--        prevent_role_self_escalation() tetikleyicisi, rol değişikliği
--        yapan kişinin profiles.role'ünün TAM OLARAK 'admin' string'ine
--        eşit olup olmadığına bakıyordu (`caller_role is distinct from
--        'admin'`). migration 0021 'owner' rolünü ekleyip is_admin()'i
--        genişletirken bu tetikleyiciyi GÜNCELLEMEYİ UNUTMUŞTU (migration
--        0022'nin "eksik yerler" listesi de bunu atlamış). Sonuç: owner,
--        admin_set_user_role() RPC'si is_admin() kontrolünden geçse bile,
--        asıl UPDATE'i profiles tablosuna uygulamaya çalıştığında BU
--        TETİKLEYİCİ devreye girip "Rol değişikliği sadece admin
--        tarafından yapılabilir." hatasıyla işlemi reddediyordu — yani
--        owner hiçbir üyenin rolünü (dolayısıyla kimseyi admin bile)
--        değiştiremiyordu. Çözüm: tetikleyici artık public.is_admin()'i
--        kullanıyor (admin VEYA owner VEYA askıda değil).
--
--   § C) Owner kendi yetkisini düşürebilsin (uyarı zorunlu — bkz. istemci
--        tarafındaki confirm() penceresi) + başka birini owner
--        yapabilsin (owner_rolu_ver RPC'si zaten migration 0021'de vardı
--        ama HİÇBİR arayüz onu çağırmıyordu — bu migration'da RPC'ye
--        dokunulmadı, arayüz tarafı ayrı bir commit'te eklendi, bkz.
--        assets/js/uye-ayarlari.js).
--
--   § D) Özel içerik (special_content) + R2 dosya paylaşımı: artık SADECE
--        admin/owner/manager değil, 'user' (sıradan Üye) HARİÇ herkes
--        (special_user, editor, manager, admin, owner) yayınlanmış özel
--        içerikleri görüntüleyebiliyor/indirebiliyor — istenen hiyerarşi:
--        Site Sahibi > Yönetici > İçerik Sorumlusu > Editör > Özel Üye > Üye.
--        (R2 Worker tarafındaki karşılığı ayrı bir commit'te güncellendi,
--        bkz. cloudflare worker/r2_storage_worker/worker.js.)
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0022 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- § B) BUG DÜZELTMESİ: prevent_role_self_escalation() owner'ı tanımıyordu
-- ----------------------------------------------------------------------------
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Rol değişikliği sadece admin/owner (Site Sahibi) tarafından yapılabilir.';
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- § C) OWNER KENDİ YETKİSİNİ DÜŞÜREBİLSİN
--    admin_set_user_role() bilhassa role='owner' olan satırları
--    reddediyor (bkz. migration 0021 § 2 yorumu — bir admin'in owner'ı bu
--    genel RPC üzerinden düşürebilmesini engellemek için) — bu, owner'ın
--    KENDİSİNİN de bu yoldan kendini düşürememesi anlamına geliyordu.
--    Burada SADECE "kendi satırını, kendi isteğiyle" düşürmeye izin veren
--    ayrı/dar bir RPC ekleniyor. İstemci tarafında (uye-ayarlari.js) bu
--    çağrıdan ÖNCE mutlaka bir confirm() uyarı penceresi gösteriliyor.
-- ----------------------------------------------------------------------------
create or replace function public.owner_kendi_rolunu_dusur(p_yeni_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: bu fonksiyonu sadece mevcut bir owner (Site Sahibi) kendi hesabı için çağırabilir.';
  end if;
  if p_yeni_rol not in ('user', 'special_user', 'editor', 'manager', 'admin') then
    raise exception 'Geçersiz rol: %', p_yeni_rol;
  end if;

  update public.profiles set role = p_yeni_rol, is_suspended = false where id = auth.uid();

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (null, 'owner_kendi_rolunu_dusurdu', auth.uid(), jsonb_build_object('yeni_rol', p_yeni_rol));
end;
$$;

grant execute on function public.owner_kendi_rolunu_dusur(text) to authenticated;

-- ----------------------------------------------------------------------------
-- § A.1) admin_listesi_getir(): artık owner'ı da döndürüyor + rol bilgisi
--    ekleniyor (manager/editor formundaki "Admin/Site Sahibi adına
--    yayınla" hedef seçimi, hedefin owner mı admin mi olduğunu bilmeli ki
--    doğru talep alanını (admin_adina_talep / sahip_adina_talep) işaretlesin).
--    Dönen kolon seti değiştiği için CREATE OR REPLACE yetmiyor, önce DROP.
-- ----------------------------------------------------------------------------
drop function if exists public.admin_listesi_getir();

create or replace function public.admin_listesi_getir()
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role
  from public.profiles p
  where p.role in ('admin', 'owner')
    and public.is_editor_or_admin()
  order by (p.role = 'owner') desc, p.full_name nulls last;
$$;

comment on function public.admin_listesi_getir() is
  'İçerik yönetebilen herkese (editor/manager/admin/owner) admin VE owner '
  'profillerinin dar bir görünümünü (id, full_name, email, role) döner — '
  '"Admin/Site Sahibi adına yayınla" hedef dropdown''ı için. role alanı, '
  'istemcinin admin_adina_talep mi yoksa sahip_adina_talep mi işaretleyeceğine '
  'karar vermesini sağlar.';

grant execute on function public.admin_listesi_getir() to authenticated;

-- ----------------------------------------------------------------------------
-- § A.2) taslak_icerikler: "Site Sahibi adına yayınla" alanları
-- ----------------------------------------------------------------------------
alter table public.taslak_icerikler
  add column if not exists sahip_adina_talep boolean not null default false;

alter table public.taslak_icerikler
  add column if not exists sahip_onay_durumu text not null default 'yok'
  check (sahip_onay_durumu in ('yok', 'beklemede', 'onaylandi', 'reddedildi'));

alter table public.taslak_icerikler
  add column if not exists sahip_onaylayan_id uuid references public.profiles(id) on delete set null;

alter table public.taslak_icerikler
  add column if not exists sahip_onay_tarihi timestamptz;

comment on column public.taslak_icerikler.sahip_adina_talep is
  'true ise bu içerik Site Sahibi''nin (owner) adıyla (yazar_id bir owner profiline ait) yayınlanmak üzere hazırlanmıştır. admin_adina_talep ile AYNI ANDA true OLAMAZ (bkz. § trigger).';
comment on column public.taslak_icerikler.sahip_onay_durumu is
  'yok: talep yok | beklemede: onay bekliyor (gerçekten yayına alınamaz) | onaylandi: owner tek başına ONAYLADI ya da adminlerin mutlak çoğunluğu onay oyu verdi | reddedildi: owner reddetti ya da adminlerin mutlak çoğunluğu red oyu verdi.';

-- Aynı satır aynı anda hem "admin adına" hem "site sahibi adına" olamaz —
-- iki farklı onay süreci çakışmasın diye.
alter table public.taslak_icerikler drop constraint if exists taslak_tek_talep_turu;
alter table public.taslak_icerikler
  add constraint taslak_tek_talep_turu
  check (not (admin_adina_talep and sahip_adina_talep));

-- ----------------------------------------------------------------------------
-- § A.3) OY TABLOSU — adminlerin "Site Sahibi adına" taleplere verdiği oylar
--    (admin_denetim_oylari, migration 0021 ile AYNI desen).
-- ----------------------------------------------------------------------------
create table if not exists public.sahip_onay_oylari (
  taslak_id      uuid not null references public.taslak_icerikler(id) on delete cascade,
  oy_kullanan_id uuid not null references public.profiles(id) on delete cascade,
  oy             text not null check (oy in ('onay', 'red')),
  created_at     timestamptz not null default now(),
  primary key (taslak_id, oy_kullanan_id)
);

comment on table public.sahip_onay_oylari is
  '"Site Sahibi adına yayınla" onay taleplerine adminlerin verdiği oylar. Her admin bir talebe en fazla BİR oy verir (fikir değiştirirse UPSERT ile günceller). Owner''ın kendisi bu tabloya oy YAZMAZ — owner zaten sahip_taslak_onayla() ile TEK BAŞINA sonuçlandırabilir.';

alter table public.sahip_onay_oylari enable row level security;

drop policy if exists "sahip_onay_oylari_select_admin_owner" on public.sahip_onay_oylari;
create policy "sahip_onay_oylari_select_admin_owner"
  on public.sahip_onay_oylari for select
  using (public.is_admin());
-- Doğrudan insert/update/delete politikası YOK — tüm yazmalar aşağıdaki
-- admin_sahip_talebi_oy_kullan() RPC'si (SECURITY DEFINER) üzerinden.

-- ----------------------------------------------------------------------------
-- § A.4) BİRLEŞİK TETİKLEYİCİ: hem "admin adına" (migration 0016, DOKUNULMADI)
--    hem "site sahibi adına" (YENİ) onay korumasını tek fonksiyonda topluyor.
--    app.sahip_onay_bypass ayarı, SADECE aşağıdaki
--    _sahip_onay_oylarini_degerlendir() dahili fonksiyonunun, çoğunluk oyuyla
--    sonuçlanan bir vakayı (owner'ın kendisi UPDATE'i yapmadığı halde)
--    'onaylandi'/'reddedildi' olarak işaretleyebilmesi için transaction-yerel
--    (is_local=true) bir bayraktır — istemci tarafından asla set edilemez,
--    sadece SECURITY DEFINER dahili fonksiyon içinde kullanılır.
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
begin
  caller_is_admin := public.is_admin();
  caller_is_owner := public.is_owner();
  oy_degerlendirme_bypass := coalesce(current_setting('app.sahip_onay_bypass', true), 'false') = 'true';

  -- ---- ADMİN ADINA (mevcut davranış, migration 0016 ile birebir aynı) ----
  if not new.admin_adina_talep then
    new.admin_onay_durumu := 'yok';
    new.onaylayan_id := null;
    new.onay_tarihi := null;
  else
    if caller_is_admin then
      if new.admin_onay_durumu in ('onaylandi', 'reddedildi')
         and (tg_op = 'INSERT' or old.admin_onay_durumu is distinct from new.admin_onay_durumu) then
        new.onaylayan_id := auth.uid();
        new.onay_tarihi := now();
      end if;
    else
      if tg_op = 'UPDATE' and old.admin_onay_durumu = 'onaylandi' then
        new.admin_onay_durumu := old.admin_onay_durumu;
        new.onaylayan_id := old.onaylayan_id;
        new.onay_tarihi := old.onay_tarihi;
      else
        new.admin_onay_durumu := 'beklemede';
        new.onaylayan_id := null;
        new.onay_tarihi := null;
      end if;

      if new.yazar_id is null or not exists (
        select 1 from public.profiles where id = new.yazar_id and role = 'admin'
      ) then
        raise exception 'admin_adina_talep = true iken yazar_id geçerli bir admin profiline ait olmalı.';
      end if;
    end if;
  end if;

  -- ---- SİTE SAHİBİ (owner) ADINA — YENİ ----
  if not new.sahip_adina_talep then
    new.sahip_onay_durumu := 'yok';
    new.sahip_onaylayan_id := null;
    new.sahip_onay_tarihi := null;
  else
    if oy_degerlendirme_bypass then
      -- _sahip_onay_oylarini_degerlendir() çoğunluğa ulaştığını tespit edip
      -- durumu zaten kendisi belirledi (new.sahip_onay_durumu) — burada
      -- dokunmuyoruz, sadece onaylayan/tarih alanlarını nötr bırakıyoruz
      -- (kolektif bir karar, TEK bir kişiye atfedilmiyor).
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
        -- Zaten sonuçlanmış (owner kararı ya da çoğunluk oyu) bir vakanın
        -- durumu, küçük bir düzenlemede (yazım hatası vb.) GERİ ALINMAZ.
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

  -- ---- FİİLİ YAYIN ENGELİ: ADMİN ADINA ----
  if new.admin_adina_talep
     and new.admin_onay_durumu <> 'onaylandi'
     and new.yayin_durumu in ('sadece_supabase', 'supabase_ve_github')
     and not caller_is_admin then
    raise exception 'Bu içerik Admin adına yayınlanmak üzere onay bekliyor; admin/owner onaylamadan yayınlanamaz.';
  end if;

  -- ---- FİİLİ YAYIN ENGELİ: SİTE SAHİBİ ADINA ----
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
-- REPLACE ile güncellendiği için trigger'ı yeniden oluşturmaya gerek yok
-- (Postgres, tetikleyicinin bağlı olduğu fonksiyonun gövdesini otomatik
-- günceller) — yine de açıklık için burada da bırakıyoruz.
drop trigger if exists trg_taslak_admin_onay_koru on public.taslak_icerikler;
create trigger trg_taslak_admin_onay_koru
  before insert or update on public.taslak_icerikler
  for each row execute function public.taslak_admin_onay_koru();

-- ----------------------------------------------------------------------------
-- § A.5) OWNER İÇİN DOĞRUDAN ONAY/RED RPC'Sİ (admin_taslak_onayla ile AYNI desen)
-- ----------------------------------------------------------------------------
create or replace function public.sahip_taslak_onayla(p_taslak_id uuid, p_onay boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: sadece Site Sahibi (owner) onaylayabilir/reddedebilir.';
  end if;
  update public.taslak_icerikler
  set sahip_onay_durumu = case when p_onay then 'onaylandi' else 'reddedildi' end
  where id = p_taslak_id and sahip_adina_talep = true;
end;
$$;

grant execute on function public.sahip_taslak_onayla(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- § A.6) ADMİNLERİN ÇOĞUNLUK OYLAMASI
--    _sahip_onay_oylarini_degerlendir(): oy sayıları "adminlerin MUTLAK
--    ÇOĞUNLUĞU"na (floor(toplam_admin/2)+1 — TOPLAM admin sayısı üzerinden,
--    sadece oy kullananlar üzerinden DEĞİL) ulaştıysa vakayı sonuçlandırır.
--    İç fonksiyon — doğrudan çağrılamaz (bkz. dosya sonundaki revoke).
-- ----------------------------------------------------------------------------
create or replace function public._sahip_onay_oylarini_degerlendir(p_taslak_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  toplam_admin int;
  gerekli      int;
  onay_sayisi  int;
  red_sayisi   int;
  mevcut_durum text;
begin
  select sahip_onay_durumu into mevcut_durum
  from public.taslak_icerikler
  where id = p_taslak_id and sahip_adina_talep = true;

  if mevcut_durum is null or mevcut_durum not in ('beklemede') then
    return; -- talep yok ya da zaten sonuçlanmış (owner kararı dahil)
  end if;

  select count(*) into toplam_admin
  from public.profiles
  where role = 'admin' and coalesce(is_suspended, false) = false;

  if toplam_admin = 0 then
    return; -- oylamayla sonuçlanacak hiç admin yok — sadece owner kararı kalır
  end if;
  gerekli := floor(toplam_admin / 2.0) + 1;

  select count(*) filter (where oy = 'onay'), count(*) filter (where oy = 'red')
    into onay_sayisi, red_sayisi
  from public.sahip_onay_oylari
  where taslak_id = p_taslak_id;

  if onay_sayisi >= gerekli then
    perform set_config('app.sahip_onay_bypass', 'true', true);
    update public.taslak_icerikler set sahip_onay_durumu = 'onaylandi' where id = p_taslak_id;
    perform set_config('app.sahip_onay_bypass', 'false', true);
  elsif red_sayisi >= gerekli then
    perform set_config('app.sahip_onay_bypass', 'true', true);
    update public.taslak_icerikler set sahip_onay_durumu = 'reddedildi' where id = p_taslak_id;
    perform set_config('app.sahip_onay_bypass', 'false', true);
  end if;
end;
$$;

-- GÜVENLİK: bu iç fonksiyon KENDİ İÇİNDE yetki kontrolü YAPMAZ (çağıran
-- admin_sahip_talebi_oy_kullan() zaten yapıyor) — bkz. migration 0021 § 5
-- sonundaki aynı gerekçe. PUBLIC/authenticated'den revoke edilmesi ZORUNLU,
-- aksi halde herhangi bir üye bunu doğrudan çağırıp oy sayımını manipüle
-- edebilirdi (ör. hiç oy yokken bile "sonuçlandır" çağrısı boşuna dönerdi
-- ama yine de gereksiz bir yüzey olurdu).
revoke execute on function public._sahip_onay_oylarini_degerlendir(uuid) from public, authenticated, anon;

create or replace function public.admin_sahip_talebi_oy_kullan(p_taslak_id uuid, p_oy text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and coalesce(is_suspended, false) = false
  ) then
    raise exception 'Yetkisiz işlem: bu oylamaya sadece admin rolündeki (askıda olmayan) kullanıcılar katılabilir — Site Sahibi zaten tek başına sahip_taslak_onayla() ile karar verebilir.';
  end if;
  if p_oy not in ('onay', 'red') then
    raise exception 'Geçersiz oy: %', p_oy;
  end if;
  if not exists (
    select 1 from public.taslak_icerikler
    where id = p_taslak_id and sahip_adina_talep = true and sahip_onay_durumu = 'beklemede'
  ) then
    raise exception 'Bu taslak için aktif (beklemede) bir Site Sahibi onay talebi yok.';
  end if;

  insert into public.sahip_onay_oylari (taslak_id, oy_kullanan_id, oy)
  values (p_taslak_id, auth.uid(), p_oy)
  on conflict (taslak_id, oy_kullanan_id) do update set oy = excluded.oy, created_at = now();

  perform public._sahip_onay_oylarini_degerlendir(p_taslak_id);
end;
$$;

grant execute on function public.admin_sahip_talebi_oy_kullan(uuid, text) to authenticated;

-- Panelin "X / Y admin onayladı" şeklinde ilerleme gösterebilmesi için dar
-- bir görünüm — sahip_onay_oylari tablosunu doğrudan sorgulamak yerine
-- (RLS zaten admin/owner'a açık ama gerekli-oy-sayısı hesabı ayrı bir
-- sorgu gerektirir) tek çağrıda toplu bilgi döner.
create or replace function public.sahip_onay_durumu_getir(p_taslak_id uuid)
returns table (onay_sayisi int, red_sayisi int, gerekli_oy_sayisi int, toplam_admin int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_toplam_admin int;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem.';
  end if;

  select count(*) into v_toplam_admin
  from public.profiles where role = 'admin' and coalesce(is_suspended, false) = false;

  return query
  select
    count(*) filter (where oy = 'onay')::int,
    count(*) filter (where oy = 'red')::int,
    (floor(v_toplam_admin / 2.0) + 1)::int,
    v_toplam_admin
  from public.sahip_onay_oylari
  where taslak_id = p_taslak_id;
end;
$$;

grant execute on function public.sahip_onay_durumu_getir(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- § D) ÖZEL İÇERİK + R2: 'user' HARİÇ HERKES GÖRÜNTÜLEYEBİLSİN
--    has_content_access() artık role <> 'user' olan HERKESE (special_user,
--    editor, manager, admin, owner) yayınlanmış özel içerikler için blanket
--    (ek bir content_access ataması aranmadan) erişim veriyor. Bu fonksiyon
--    hem special_content RLS'inde hem 'ozel-dosyalar' storage bucket
--    politikasında (bkz. migration 0001/0016) zaten kullanıldığı için TEK
--    bir değişiklik hem içerik sayfasını hem R2/Supabase Storage dosya
--    indirmeyi otomatik olarak kapsar. content_access'e ELLE atanmış
--    satırlar (ör. bir 'user' rolüne özel olarak verilmiş erişim) hâlâ
--    olduğu gibi çalışmaya devam eder — bu SADECE erişimi GENİŞLETİYOR,
--    hiçbir mevcut atamayı DARALTMIYOR.
-- ----------------------------------------------------------------------------
create or replace function public.has_content_access(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role <> 'user'
    )
    or exists (
      select 1 from public.content_access
      where content_id = p_content_id
        and user_id = auth.uid()
        and (son_gecerlilik_tarihi is null or son_gecerlilik_tarihi > now())
    )
    or public.is_admin();
$$;

-- ============================================================================
-- BİTTİ.
--
-- Bu migrationdan sonra kontrol/kurulum notları:
--
--   1) Owner artık bir üyenin rolünü admin dahil değiştirebilir (§ B) —
--      ekstra bir adım gerekmez, bug otomatik düzeldi.
--   2) Owner kendi yetkisini düşürmek isterse (§ C) panel arayüzündeki
--      yeni "Kendi Yetkimi Düşür" butonunu kullanır (uye-ayarlari.js);
--      başka birini owner yapmak için "Site Sahibi Yap" butonunu kullanır
--      (RPC zaten migration 0021'de vardı, arayüz bu turda eklendi).
--   3) Manager/editor artık GitHub İçerik Yönetimi panelinde "Admin/Site
--      Sahibi adına yayınla" kutusunu işaretleyip dropdown'dan bir OWNER
--      seçebilir (§ A) — bkz. assets/js/github-yonetim/github-yonetim.js.
--      Owner adına talepler panelde adminlere "👍 Onay Ver / 👎 Red Ver"
--      butonlarıyla, owner'a "✅ Onayla / ❌ Reddet" butonlarıyla görünür.
--   4) Özel içerik/R2 dosyaları artık special_user + editor + manager +
--      admin + owner için otomatik görünür (§ D) — content_access'te ayrı
--      bir atama YAPMAN GEREKMEZ. R2 Worker'ın (Cloudflare) kendi rol
--      kontrolü AYRI bir kod tabanında olduğu için o dosyayı da ayrıca
--      güncelleyip yeniden deploy etmen gerekiyor, bkz.
--      cloudflare worker/r2_storage_worker/worker.js.
-- ============================================================================
