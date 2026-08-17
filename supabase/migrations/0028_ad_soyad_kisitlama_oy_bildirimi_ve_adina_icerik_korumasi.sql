-- ============================================================================
-- 0028_ad_soyad_kisitlama_oy_bildirimi_ve_adina_icerik_korumasi.sql
--
-- Bu migration ÜÇ AYRI istek/bug bildirimini kapsar. Sırayla:
--
--   § A) "Admin hiç kimsenin adını soyadını değiştiremesin, sadece owner
--        için geçerli olmasın" — yani migration 0027 § A'daki kısıt SADECE
--        Site Sahibi'nin (owner) satırını korurken, artık HERKESİN
--        (owner-dışı user/special_user/editor/manager/ve DİĞER adminler
--        dahil) first_name/last_name alanı bir admin tarafından
--        değiştirilemez hâle geliyor. profiles_update_own_or_admin (0027)
--        genel UPDATE politikasına DOKUNMUYORUZ (bio, avatar_url gibi diğer
--        kolonlar admin için hâlâ açık kalmalı) — RLS satır bazlı çalışıp
--        kolon bazlı kısıtlama yapamadığı için (bkz. migration 0001 § 3
--        yorumu) bunu AYRI bir BEFORE UPDATE tetikleyicisiyle, tıpkı
--        prevent_role_self_escalation() gibi çözüyoruz: first_name/
--        last_name gerçekten değiştiyse VE isteği yapan ne satırın
--        kendisi ne de owner ise, hata fırlatıp reddediyoruz. Kendi adını
--        herkes (admin dahil) hâlâ değiştirebilir — bu kısıtlanan sadece
--        "BAŞKASININ adını değiştirme" yetkisidir.
--
--   § B) BUG DÜZELTMESİ — "Admin oylamasında Telegram'dan bildirim
--        gelmiyor": KÖK NEDEN bulundu. admin_denetim_oy_kullan() (migration
--        0021 § 7) bir oyu admin_denetim_oylari'na yazıp admin_denetim_log'a
--        'oy_kullanildi' olayını KAYDEDİYORDU ama hiçbir zaman
--        public._denetim_bildirim_gonder(p_denetim_id, 'oy_kullanildi')
--        ÇAĞIRMIYORDU — hâlbuki Worker (admin_guvenlik_bildirim_worker/
--        worker.js) ve OLAY_METINLERI haritası 'oy_kullanildi' olayını
--        BAŞTAN BERİ destekliyordu (bkz. o dosyadaki "🗳️ Admin denetim
--        vakasına oy kullanıldı" satırı) — yani alıcı taraf hazırdı, sadece
--        gönderen taraf (bu fonksiyon) hiç tetiklemiyordu. askiya_alindi
--        (§ 6) ve sonuç olayları (kalici_dusuruldu/iptal_edildi/
--        suresi_doldu_geri_acildi, _admin_denetim_sonuclandir üzerinden)
--        zaten doğru şekilde bildirim gönderiyordu — eksik olan SADECE oy
--        kullanma anıydı. Çözüm: fonksiyon şimdi oyu kaydettikten hemen
--        sonra bildirimi de gönderiyor (2 admin'lik özel senaryoda bile —
--        "sessizce kaydedilir" notu SADECE otomatik kalıcı karara yol
--        açmamasıyla ilgiliydi, bildirimle ilgisi yok, bu yüzden bildirim
--        erken dönüşten (gerekli_oy_sayisi is null → return) ÖNCE gönderilir).
--
--   § C) "Bir admin, owner adına içerik yayınlayınca ya da başka bir admin
--        adına içerik talebinde bulununca, o yazılar özelinde DİĞER hiçbir
--        admin bunları düzenleyemesin/silemesin/yayınlayamasın":
--        KÖK DURUM — taslak_update_own_or_admin / taslak_delete_own_or_admin
--        (migration 0014) tek koşulu public.is_admin() (yani owner DAHİL
--        her admin) OR "kendi satırı" idi. migration 0026, SADECE onay/red
--        VERME yetkisini (admin_onay_durumu'nu değiştirme + fiilen yayına
--        alma) hedef admin/owner'a daraltmıştı — ama içeriği DÜZENLEME/
--        SİLME yetkisi hâlâ genel is_admin() üzerinden HERHANGİ bir admine
--        açık kalıyordu (onay durumunu değiştirmeden başlığı/gövdeyi
--        değiştirmek ya da satırı doğrudan silmek gibi). Bu migration bu
--        boşluğu kapatıyor: "admin adına" (admin_adina_talep) veya "site
--        sahibi adına" (sahip_adina_talep) işaretli bir taslak satırında,
--        genel is_admin() erişimi artık SADECE ŞUNLARA açık: içeriği
--        GERÇEKTEN oluşturan kişi (created_by), "admin adına" akışında
--        içeriğin adına yazıldığı hedef admin (yazar_id), ve her zaman
--        owner. Bu üçü DIŞINDAKİ herhangi bir admin (owner DEĞİL) artık bu
--        SATIRLARI ne düzenleyebilir ne silebilir ne de (zaten migration
--        0026 ile) onaylayıp yayınlayabilir. Sıradan (admin_adina_talep VE
--        sahip_adina_talep = false) taslaklarda HİÇBİR ŞEY DEĞİŞMEDİ — admin
--        hepsini eskisi gibi yönetmeye devam ediyor.
--        NOT: GitHub'a ZATEN commit edilmiş (yayındaki) dosyalar için AYNI
--        korumanın karşılığı veritabanı dışında, Cloudflare Worker'da
--        uygulanıyor (bkz. ayrı commit: cloudflare worker/
--        github_icerik_yonetim_worker/worker.js § 4.1 genişletmesi) — çünkü
--        o noktada içerik artık taslak_icerikler'de değil, doğrudan GitHub
--        reposundadır ve bu tabloya hiç uğramaz.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0027 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- § A) AD/SOYAD: SADECE KENDİSİ YA DA OWNER DEĞİŞTİREBİLİR (owner-dışı HİÇBİR
--      admin, BAŞKA hiç kimsenin adını/soyadını değiştiremez)
-- ----------------------------------------------------------------------------
create or replace function public.prevent_isim_degisikligi_baskasi_tarafindan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.first_name is distinct from old.first_name)
     or (new.last_name is distinct from old.last_name) then
    if auth.uid() is distinct from old.id and not public.is_owner() then
      raise exception 'Ad/soyad sadece üyenin kendisi ya da Site Sahibi (owner) tarafından değiştirilebilir.';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.prevent_isim_degisikligi_baskasi_tarafindan() is
  'Bir kullanıcının first_name/last_name alanını SADECE kendisi ya da owner değiştirebilir — sıradan bir admin (owner DEĞİL) artık owner''ın değil, HİÇBİR üyenin (başka bir admin/manager/editor/special_user/user fark etmez) adını/soyadını doğrudan değiştiremez (bkz. migration 0027 § A''nın owner''a özel hâlinin genelleştirilmiş devamı). profiles tablosundaki diğer kolonlar (bio, avatar_url vb.) bu tetikleyiciden ETKİLENMEZ, onlar hâlâ profiles_update_own_or_admin (migration 0027) RLS politikasına tabidir.';

drop trigger if exists trg_prevent_isim_degisikligi_baskasi_tarafindan on public.profiles;
create trigger trg_prevent_isim_degisikligi_baskasi_tarafindan
  before update on public.profiles
  for each row execute function public.prevent_isim_degisikligi_baskasi_tarafindan();

-- ----------------------------------------------------------------------------
-- § B) BUG DÜZELTMESİ: admin_denetim_oy_kullan() 'oy_kullanildi' bildirimini
--      hiç göndermiyordu
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

  -- BUG FİX: bu çağrı hiç yoktu — Telegram/SMS'e giden 'oy_kullanildi'
  -- olayı, Worker ve OLAY_METINLERI haritası (admin_guvenlik_bildirim_worker/
  -- worker.js) hazır olmasına rağmen ASLA tetiklenmiyordu. Erken dönüşten
  -- (aşağıdaki "gerekli_oy_sayisi is null" bloğu) ÖNCE gönderiyoruz ki 2
  -- adminlik özel senaryoda ("sessizce kaydedilir, otomatik karara yol
  -- açmaz" — bkz. § 5 notu) dahi bildirim gitsin; bildirim otomatik karar
  -- ÜRETMEZ, sadece bilgilendirir.
  perform public._denetim_bildirim_gonder(p_denetim_id, 'oy_kullanildi');

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
-- § C) "ADMİN ADINA" / "SİTE SAHİBİ ADINA" TASLAKLAR: DİĞER ADMİNLERİN
--      DÜZENLEME/SİLME (dolayısıyla yayınlama) ERİŞİMİ KAPATILIYOR
-- ----------------------------------------------------------------------------

-- Yardımcı: bu SATIRA (row) genel bir "admin" olarak (owner değil) erişim
-- hakkım var mı? — taslak_update_own_or_admin/taslak_delete_own_or_admin
-- politikalarındaki tekrar eden mantığı tek yerde topluyoruz. "language
-- sql" değil "plpgsql" DEĞİL — burada satırın TAMAMINI (record) parametre
-- olarak alan bir SQL fonksiyonu yeterli, RLS politikası içinde satır
-- başına çağrılabilir.
create or replace function public._taslak_admin_erisimi_var_mi(p_taslak public.taslak_icerikler)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Sıradan (kimse adına olmayan) bir taslakta HİÇBİR ŞEY DEĞİŞMEDİ:
    -- herhangi bir admin/owner (is_admin() ikisini de kapsar) erişebilir.
    (not p_taslak.admin_adina_talep and not p_taslak.sahip_adina_talep and public.is_admin())
    -- "Admin adına" ya da "Site Sahibi adına" işaretli bir taslakta ise
    -- genel admin erişimi SADECE içeriğin adına yazıldığı hedef kişiye
    -- (yazar_id) ya da owner'a açık — is_admin() TEK BAŞINA artık yetmez.
    or (
      (p_taslak.admin_adina_talep or p_taslak.sahip_adina_talep)
      and (public.is_owner() or auth.uid() = p_taslak.yazar_id)
    );
$$;

comment on function public._taslak_admin_erisimi_var_mi(public.taslak_icerikler) is
  '"Admin adına" (admin_adina_talep) ya da "Site Sahibi adına" (sahip_adina_talep) işaretli bir taslak satırında, genel (created_by=kendisi olmayan) admin erişimini SADECE owner''a ve içeriğin adına yazıldığı hedef kişiye (yazar_id) daraltır — başka HİÇBİR admin bu satırları düzenleyemez/silemez. Sıradan taslaklarda (her iki bayrak da false) davranış DEĞİŞMEZ, is_admin() olan herkes erişebilir. created_by = kendisi olan satırlar zaten ayrı bir OR koşuluyla (taslak_update_own_or_admin/taslak_delete_own_or_admin politikaları) her zaman erişilebilir — bu fonksiyon SADECE "kendi satırı değilse" dalını daraltır.';

grant execute on function public._taslak_admin_erisimi_var_mi(public.taslak_icerikler) to authenticated;

drop policy if exists "taslak_update_own_or_admin" on public.taslak_icerikler;
create policy "taslak_update_own_or_admin"
  on public.taslak_icerikler for update
  using (
    (public.is_editor_or_admin() and created_by = auth.uid())
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  )
  with check (
    (public.is_editor_or_admin() and created_by = auth.uid())
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  );

drop policy if exists "taslak_delete_own_or_admin" on public.taslak_icerikler;
create policy "taslak_delete_own_or_admin"
  on public.taslak_icerikler for delete
  using (
    (public.is_editor_or_admin() and created_by = auth.uid())
    or public._taslak_admin_erisimi_var_mi(taslak_icerikler)
  );

comment on policy "taslak_update_own_or_admin" on public.taslak_icerikler is
  'Herkes (editor/manager/admin) kendi oluşturduğu (created_by) satırı düzenleyebilir. Bunun ÜZERİNE: sıradan taslaklarda is_admin() olan herkes düzenleyebilir; ama "admin adına"/"site sahibi adına" işaretli taslaklarda SADECE owner ya da hedef kişi (yazar_id) düzenleyebilir — bkz. _taslak_admin_erisimi_var_mi (migration 0028 § C).';
comment on policy "taslak_delete_own_or_admin" on public.taslak_icerikler is
  'Herkes (editor/manager/admin) kendi oluşturduğu (created_by) satırı silebilir. Bunun ÜZERİNE: sıradan taslaklarda is_admin() olan herkes silebilir; ama "admin adına"/"site sahibi adına" işaretli taslaklarda SADECE owner ya da hedef kişi (yazar_id) silebilir — bkz. _taslak_admin_erisimi_var_mi (migration 0028 § C).';

-- ============================================================================
-- BİTTİ. Ekstra kurulum adımı gerekmiyor — bu migration çalıştığı anda:
--
--   1) Sıradan bir admin (owner DEĞİL), "Kullanıcılar & Roller" sayfasında
--      artık HİÇBİR üyenin (owner dahil, ama artık SADECE owner'la sınırlı
--      değil — herkes) Ad/Soyad kutularını düzenleyip kaydedemez; sadece
--      kendi satırındaki Ad/Soyad'ı değiştirebilir. Panel tarafı da ayrı
--      bir commit'te bu kutuları buna göre salt-okunur hâle getirdi (bkz.
--      assets/js/uye-ayarlari.js).
--   2) Bir admin denetim vakasında oy kullanıldığında artık diğer
--      admin/owner'lara Telegram/SMS bildirimi GİDER (webhook_url +
--      guvenlik_bildirim_ayarlari.aktif=true kuruluysa) — önceden bu olay
--      sessizce kaydediliyordu ama hiçbir yere iletilmiyordu.
--   3) Bir manager/editor/admin "X admin adına" ya da "Site Sahibi adına"
--      bir içerik talebi/yayını oluşturduğunda, o SATIRI artık SADECE
--      içeriği gerçekten oluşturan kişi, hedef kişi (X admin ya da owner)
--      düzenleyebilir/silebilir — X/owner DIŞINDAKİ hiçbir admin ne
--      "Düzenle" ne "Sil" ne de (zaten migration 0026 ile) "Onayla/
--      Yayınla" butonlarını kullanabilir; panel tarafı da ayrı bir
--      commit'te bu butonları buna göre gizledi (bkz.
--      assets/js/github-yonetim/github-yonetim.js). GitHub'a ZATEN commit
--      edilmiş dosyalar için aynı korumanın karşılığı ayrı bir commit'te
--      Cloudflare Worker'a eklendi (bkz. cloudflare worker/
--      github_icerik_yonetim_worker/worker.js).
-- ============================================================================
