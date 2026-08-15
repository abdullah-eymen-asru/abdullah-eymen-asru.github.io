-- ============================================================================
-- 0016_icerik_sorumlusu_rolu_ve_admin_adina_onay.sql
-- Admin ile Editör arasında yeni bir rol ekler: 'manager'.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0015 sırayla daha önce çalıştırılmış olmalı.
--
-- İSİMLENDİRME NOTU: DB'deki rol değeri İNGİLİZCE 'manager' (diğer rollerle
-- aynı desende: user/special_user/editor/admin/manager). Panelde bu rolü
-- "İçerik Sorumlusu" olarak etiketliyoruz — "Yönetici" DEĞİL, çünkü
-- admin.js'teki rol açılır listesinde 'admin' rolü zaten "Yönetici" olarak
-- gösteriliyor (bkz. assets/js/admin.js) ve aynı Türkçe etiketi ikinci bir
-- role de vermek admin panelinde iki farklı "Yönetici" seçeneği görünmesine,
-- kafa karışıklığına yol açardı.
--
-- YENİ ROLÜN YETKİLERİ (istenen özet):
--   1) İçerik yazma: 'editor' ile TAMAMEN AYNI — sadece kendi oluşturduğu
--      blog/proje taslaklarını (taslak_icerikler) ekleyip/düzenleyip/
--      silebilir. Bunu ayrı politikalar yazmak yerine mevcut
--      is_editor_or_admin() fonksiyonunun tanımına 'manager' rolünü de
--      ekleyerek sağlıyoruz — migration 0014'teki TÜM RLS politikaları
--      (SELECT tümü, INSERT/UPDATE/DELETE sadece kendi satırı) hiçbir
--      değişiklik yapılmadan otomatik olarak manager için de aynı şekilde
--      işlemeye devam eder.
--   2) "Admin adına" yazı isteği: manager, bir taslağı Admin'in adıyla
--      yayınlamak isterse (aşağıdaki § 3), bu içerik ADMIN ONAYLAMADAN
--      GERÇEKTEN YAYINDA bir duruma geçemez (bkz. § 4 tetikleyici).
--      NOT (dürüstlük payı — bkz. dosya sonundaki not): bu onay zorunluluğu
--      panelin KENDİ "Sadece Supabase'te Yayınla" / "Supabase'e Kaydet ve
--      GitHub ile Yayınla" akışları için veritabanı seviyesinde TAM olarak
--      uygulanır. Ama panel, GitHub'a commit'i doğrudan kullanıcının kendi
--      tarayıcısına yapıştırdığı GitHub PAT'ı ile atıyor (bkz.
--      assets/js/github-yonetim.js dosya başı notu) — yani bir manager'a
--      bu repo için yazma izni olan bir PAT verirsen, o kişi teorik olarak
--      GitHub API'sine DOĞRUDAN (bu panelin dışından) da commit atabilir.
--      Bu, zaten var olan 'editor' rolü için de aynı derecede geçerli olan
--      mimari bir sınırdır — bu migration bunu DEĞİŞTİRMEZ, sadece panelin
--      kendi "Yayınla" akışını admin onayına bağlar (bkz. github-yonetim.js
--      güncellemesi).
--   3) Admin panelindeki (panel/admin.md) SADECE "Özel İçerik Ekle/Düzenle",
--      "Mevcut Özel İçerikler" ve "R2 Dosya Paylaşımı" sekmelerine (yani
--      special_content + content_access + 'ozel-dosyalar' storage bucket +
--      R2 imza worker'ı) admin ile AYNI erişim. "Kullanıcılar & Roller",
--      "Mesajlar" ve "Hesabım" sekmelerine (kullanıcı/rol yönetimi,
--      mesajlaşma, e-posta değiştirme) ERİŞEMEZ — bu kısıt hem client-side
--      (admin.js, bkz. ayrı commit) hem veritabanı seviyesinde (profiles
--      UPDATE politikası ve admin_set_user_role/admin_force_signout_user
--      gibi RPC'ler HÂLÂ is_admin() istiyor, burada DOKUNULMADI) sağlanır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ROL GENİŞLETME: 'manager' rolü
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'special_user', 'admin', 'editor', 'manager'));

comment on column public.profiles.role is
  'user: normal kayıtlı üye | special_user: özel içeriklere erişimi olan üye | editor: sadece kendi blog/proje taslaklarını yönetebilen içerik yöneticisi (kullanıcı/rol yönetemez) | manager (panelde "İçerik Sorumlusu"): editor ile AYNI blog/proje yazma yetkisi + admin panelindeki özel içerik paylaşma ve R2 dosya paylaşma bölümlerine admin ile aynı erişim, ama kullanıcı/rol yönetimi ve mesajlaşmaya erişemez | admin: tam yetkili yönetici';

create or replace function public.admin_set_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin rol değiştirebilir.';
  end if;
  if p_new_role not in ('user', 'special_user', 'admin', 'editor', 'manager') then
    raise exception 'Geçersiz rol: %', p_new_role;
  end if;
  update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) YARDIMCI FONKSİYONLAR
--    is_editor_or_admin() (migration 0014) 'manager'ı da kapsayacak şekilde
--    GENİŞLETİLİYOR — böylece taslak_icerikler üzerindeki TÜM mevcut RLS
--    politikaları (SELECT: hepsi görebilir | INSERT/UPDATE/DELETE: sadece
--    kendi satırı, admin hepsini) hiçbir politika yeniden yazılmadan manager
--    için de editor ile BİREBİR aynı şekilde çalışır (istenen "editör gibi
--    yazabilme hakkına aynen sahip olsun" maddesi budur).
--
--    is_manager_or_admin(): admin panelindeki özel içerik / R2 dosya
--    paylaşımı bölümleri için — admin VEYA manager true döner, editor/
--    special_user/user için false.
-- ----------------------------------------------------------------------------
create or replace function public.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor', 'manager')
  );
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

grant execute on function public.is_manager_or_admin() to authenticated;

-- temizle_suresi_gecmis_erisimleri(): admin panelinin "içerik-ekle"/
-- "icerikler" sekmelerine artık manager de girebildiği için, o sekmeler
-- açıldığında çağrılan bu temizlik fonksiyonunu da manager'a açıyoruz
-- (zararsız bir bakım işlemi — sadece süresi geçmiş content_access
-- satırlarını siler, kullanıcı/rol yönetimiyle ilgisi yok).
create or replace function public.temizle_suresi_gecmis_erisimleri()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  silinen_sayisi integer;
begin
  if not public.is_manager_or_admin() then
    raise exception 'Yetkisiz işlem.';
  end if;
  delete from public.content_access
  where son_gecerlilik_tarihi is not null and son_gecerlilik_tarihi <= now();
  get diagnostics silinen_sayisi = row_count;
  return silinen_sayisi;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) PROFİLLER: manager'ın "Erişim Verilecek Özel Üyeler" arama kutusunu
--    doldurabilmesi için (special_content atama listesi TUM_KULLANICILAR'a
--    ihtiyaç duyuyor, bkz. admin.js) profiles SELECT politikası manager'ı
--    da kapsayacak şekilde genişletiliyor. ÖNEMLİ: bu SADECE OKUMA
--    (select) içindir — profiles UPDATE politikası ve rol değiştiren
--    admin_set_user_role() RPC'si aşağıda DEĞİŞTİRİLMEDİ, hâlâ sadece
--    admin (veya kendi satırını düzenleyen kullanıcının kendisi)
--    yazabilir. Yani manager tüm profilleri görebilir ama hiçbirini
--    (kendisi hariç) düzenleyemez veya rol değiştiremez.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_manager_or_admin());

-- ----------------------------------------------------------------------------
-- 4) ÖZEL İÇERİK (special_content) + ERİŞİM (content_access) + STORAGE:
--    "admin ile aynı erişim" — is_admin() yerine is_manager_or_admin()
-- ----------------------------------------------------------------------------
drop policy if exists "content_select_admin_or_granted" on public.special_content;
create policy "content_select_admin_or_granted"
  on public.special_content for select
  using (
    public.is_manager_or_admin()
    or (is_published and public.has_content_access(id))
  );

drop policy if exists "content_write_admin_only" on public.special_content;
create policy "content_write_admin_only"
  on public.special_content for insert
  with check (public.is_manager_or_admin());

drop policy if exists "content_update_admin_only" on public.special_content;
create policy "content_update_admin_only"
  on public.special_content for update
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

drop policy if exists "content_delete_admin_only" on public.special_content;
create policy "content_delete_admin_only"
  on public.special_content for delete
  using (public.is_manager_or_admin());

drop policy if exists "access_select_own_or_admin" on public.content_access;
create policy "access_select_own_or_admin"
  on public.content_access for select
  using (auth.uid() = user_id or public.is_manager_or_admin());

drop policy if exists "access_write_admin_only" on public.content_access;
create policy "access_write_admin_only"
  on public.content_access for insert
  with check (public.is_manager_or_admin());

drop policy if exists "access_delete_admin_only" on public.content_access;
create policy "access_delete_admin_only"
  on public.content_access for delete
  using (public.is_manager_or_admin());

-- ---- 'ozel-dosyalar' storage bucket politikaları ----
drop policy if exists "ozel_dosya_select" on storage.objects;
create policy "ozel_dosya_select"
  on storage.objects for select
  using (
    bucket_id = 'ozel-dosyalar'
    and (
      public.is_manager_or_admin()
      or public.has_content_access( (storage.foldername(name))[1]::uuid )
    )
  );

drop policy if exists "ozel_dosya_write" on storage.objects;
create policy "ozel_dosya_write"
  on storage.objects for insert
  with check (bucket_id = 'ozel-dosyalar' and public.is_manager_or_admin());

drop policy if exists "ozel_dosya_update" on storage.objects;
create policy "ozel_dosya_update"
  on storage.objects for update
  using (bucket_id = 'ozel-dosyalar' and public.is_manager_or_admin());

drop policy if exists "ozel_dosya_delete" on storage.objects;
create policy "ozel_dosya_delete"
  on storage.objects for delete
  using (bucket_id = 'ozel-dosyalar' and public.is_manager_or_admin());

-- ----------------------------------------------------------------------------
-- 5) "ADMİN ADINA" YAYIN İSTEĞİ + ONAY SÜRECİ
--    taslak_icerikler'e üç yeni alan: bir manager (veya editor — alan
--    teknik olarak ikisine de açık, ama panel arayüzü bu seçeneği SADECE
--    manager'a gösterecek) "Admin adına yayınla" seçeneğini işaretlerse
--    admin_adina_talep=true olur ve admin_onay_durumu aşağıdaki
--    tetikleyiciyle otomatik 'beklemede'ye çekilir.
-- ----------------------------------------------------------------------------
alter table public.taslak_icerikler
  add column if not exists admin_adina_talep boolean not null default false;

alter table public.taslak_icerikler
  add column if not exists admin_onay_durumu text not null default 'yok'
  check (admin_onay_durumu in ('yok', 'beklemede', 'onaylandi', 'reddedildi'));

alter table public.taslak_icerikler
  add column if not exists onaylayan_id uuid references public.profiles(id) on delete set null;

alter table public.taslak_icerikler
  add column if not exists onay_tarihi timestamptz;

comment on column public.taslak_icerikler.admin_adina_talep is
  'true ise bu içerik Admin''in adıyla (yazar_id/yazar_adi = bir admin profili) yayınlanmak üzere hazırlanmıştır ve admin onayı gerektirir.';
comment on column public.taslak_icerikler.admin_onay_durumu is
  'yok: admin adına talep yok | beklemede: admin onayı bekliyor (gerçekten yayına alınamaz) | onaylandi: admin onayladı, yayınlanabilir | reddedildi: admin reddetti.';

-- ----------------------------------------------------------------------------
-- 6) TETİKLEYİCİ: admin_onay_durumu'nu sadece admin değiştirebilir + admin
--    onaylamadan "admin adına" bir talep GERÇEKTEN yayında bir duruma
--    (sadece_supabase / supabase_ve_github) geçemez.
--
--    NOT: is_admin()/is_manager_or_admin() gibi diğer yardımcı fonksiyonlar
--    SECURITY DEFINER olduğu için RLS'in kendi içinde sonsuz döngüye
--    girmiyor (bkz. migration 0001 § 4 yorumu) — bu trigger fonksiyonu da
--    aynı sebeple SECURITY DEFINER tanımlanıyor.
-- ----------------------------------------------------------------------------
create or replace function public.taslak_admin_onay_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
begin
  caller_is_admin := public.is_admin();

  if not new.admin_adina_talep then
    -- "Admin adına" talep edilmiyorsa onay alanları her zaman nötr kalır.
    new.admin_onay_durumu := 'yok';
    new.onaylayan_id := null;
    new.onay_tarihi := null;
  else
    if caller_is_admin then
      -- Admin serbestçe onaylayabilir/reddedebilir; durum değiştiyse
      -- onaylayan + tarih bilgisini otomatik dolduruyoruz (elle
      -- gönderilen değerler yok sayılır, güvenilir tek kaynak burasıdır).
      if new.admin_onay_durumu in ('onaylandi', 'reddedildi')
         and (tg_op = 'INSERT' or old.admin_onay_durumu is distinct from new.admin_onay_durumu) then
        new.onaylayan_id := auth.uid();
        new.onay_tarihi := now();
      end if;
    else
      -- Admin OLMAYAN bir kullanıcı (manager/editor) admin_onay_durumu'nu
      -- KENDİSİ asla 'onaylandi'/'reddedildi' yapamaz — ne gönderirse
      -- göndersin 'beklemede'ye zorlanır. İstisna: daha önce admin
      -- tarafından zaten 'onaylandi' yapılmış bir satırı düzenlerken
      -- (ör. yazım hatası düzeltme) onay durumunu DÜŞÜRMÜYORUZ, aksi
      -- halde her küçük düzenlemede onay tekrar isteniyor olurdu.
      if tg_op = 'UPDATE' and old.admin_onay_durumu = 'onaylandi' then
        new.admin_onay_durumu := old.admin_onay_durumu;
        new.onaylayan_id := old.onaylayan_id;
        new.onay_tarihi := old.onay_tarihi;
      else
        new.admin_onay_durumu := 'beklemede';
        new.onaylayan_id := null;
        new.onay_tarihi := null;
      end if;

      -- yazar_id gerçekten bir admin'e mi ait, kontrol et — manager
      -- rastgele bir kullanıcı adına "admin onayı" talebi süsü veremesin.
      if new.yazar_id is null or not exists (
        select 1 from public.profiles where id = new.yazar_id and role = 'admin'
      ) then
        raise exception 'admin_adina_talep = true iken yazar_id geçerli bir admin profiline ait olmalı.';
      end if;
    end if;
  end if;

  -- FİİLİ YAYIN ENGELİ: onaylanmamış bir "admin adına" talep, admin
  -- olmayan biri tarafından GERÇEKTEN yayında bir duruma taşınamaz.
  -- 'taslak' (gizli, sadece önizleme linkiyle görülür) durumunda
  -- bırakmakta serbesttir — engellenen sadece GERÇEK yayın.
  if new.admin_adina_talep
     and new.admin_onay_durumu <> 'onaylandi'
     and new.yayin_durumu in ('sadece_supabase', 'supabase_ve_github')
     and not caller_is_admin then
    raise exception 'Bu içerik Admin adına yayınlanmak üzere onay bekliyor; admin onaylamadan yayınlanamaz.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_taslak_admin_onay_koru on public.taslak_icerikler;
create trigger trg_taslak_admin_onay_koru
  before insert or update on public.taslak_icerikler
  for each row execute function public.taslak_admin_onay_koru();

-- ----------------------------------------------------------------------------
-- 7) ADMİN İÇİN ONAY/RED RPC'Sİ (kolaylık amaçlı — admin zaten doğrudan
--    UPDATE de yapabilir, RLS ve yukarıdaki trigger buna izin verir; bu RPC
--    sadece tek bir çağrıda "onayla/reddet + zaman damgası" işini yapar ve
--    panel kodunda tek bir çağrı noktası sağlar).
-- ----------------------------------------------------------------------------
create or replace function public.admin_taslak_onayla(p_taslak_id uuid, p_onay boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin onaylayabilir/reddedebilir.';
  end if;
  update public.taslak_icerikler
  set admin_onay_durumu = case when p_onay then 'onaylandi' else 'reddedildi' end
  where id = p_taslak_id and admin_adina_talep = true;
end;
$$;

grant execute on function public.admin_taslak_onayla(uuid, boolean) to authenticated;

-- ============================================================================
-- BİTTİ.
--
-- Bir kullanıcıyı "İçerik Sorumlusu" (manager) yapmak için (admin panelinden
-- de yapılabilir, "Kullanıcılar & Roller" sekmesindeki rol açılır listesinden
-- artık görünen "İçerik Sorumlusu" seçeneğiyle):
--
--   select public.admin_set_user_role('KULLANICI_UUID', 'manager');
--
-- Manager, GitHub İçerik Yönetimi panelinde (panel/github-yonetim.html) bir
-- taslağı hazırlarken "Admin adına yayınla (onay gerekir)" seçeneğini
-- işaretlediğinde içerik 'beklemede' durumuna düşer; admin aynı panelde
-- (tüm taslakları görebildiği için, bkz. is_editor_or_admin()) "Onayla" /
-- "Reddet" butonlarıyla karar verir — onaylanmadan içerik gerçekten
-- yayına alınamaz (bkz. § 6 yukarıdaki trigger).
-- ============================================================================
