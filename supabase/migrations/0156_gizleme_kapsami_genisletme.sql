-- ============================================================================
-- 0156_gizleme_kapsami_genisletme.sql — "Üyeyi siteden gizle" özelliğini TÜM modüllere bağlar (0136'nın devamı)
--
-- YENİ SİSTEM YOK: 0136'daki gizli_uyeler / owner_ayarlari.blind_mode / uye_gizli_mi() / gizli_goruntulenebilir_mi()
-- aynen kullanılır. Bu dosya yalnızca aynı kontrolü satır düzeyine (RLS) ve liste fonksiyonlarına bağlar.
--
-- Kural (her yerde aynı): bir satır, sahibi gizli üye ise ve izleyen kişi
--   • sahibin kendisi DEĞİLSE ve
--   • Site Sahibi (körlük kapalı) DEĞİLSE
-- GÖRÜNMEZ. Gizlemeyi kaldırınca (owner_uye_gizle(id,false)) hiçbir veri silinmediği için her şey aynen geri gelir.
--
-- Kapsam:
--   1) gizli_satir_mi() / konusma_gizli_mi()  — tek karar noktası.
--   2) RESTRICTIVE select politikaları: Akademik Kütüphane, Notlar, Mesajlaşma (mesaj, üyelik, zarf, yıldız, sabit),
--      Dosya Yönetimi / Medya Havuzu, İçerik (yorum, yazı, taslak, inceleme), duyuru okumaları, kayıt (log) tabloları.
--   3) Yönetici/üye listesi ve sayaç fonksiyonları (SECURITY DEFINER — RLS'i aşar): gövdedeki "from/join public.<tablo> <takma_ad>"
--      ifadeleri aynı filtreyle süzülmüş alt sorguya çevrilir (arama, liste, sayaç, "toplam" hep tutarlı kalır).
--
-- BİLİNÇLİ OLARAK DOKUNULMAYANLAR (veri kaybı riski): hesap silme dosya listesi, R2 eşitleme/öksüz tespiti, yedek/dışa aktarma
--   (hesap_silme_dosya_listesi, r2_esitle_adaylari, uye_r2_dosya_esle, sistem_r2_dosya_esle, medya_kayitli_anahtarlar,
--   sistem_export_r2_listesi). Bunlar süzülürse gizli üyenin dosyaları "sahipsiz" görünüp silinebilirdi.
-- SINIR (dürüst not): service_role anahtarıyla çalışan Cloudflare Worker'lar RLS'i aşar; Worker'lar kullanıcı listesi
--   döndürüyorsa ayrıca süzülmelidir (bkz. teslim notları). Bu migration gerçek bir Supabase'te çalıştırılarak denenmelidir.
-- Gereksinim: 0136. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- 1) Karar fonksiyonları ------------------------------------------------------------------------------------------------
create or replace function public.gizli_satir_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_id is not null
     and p_id is distinct from auth.uid()
     and exists (select 1 from public.gizli_uyeler g where g.user_id = p_id)
     and not public.gizli_goruntulenebilir_mi();
$$;
revoke all on function public.gizli_satir_mi(uuid) from public;
grant execute on function public.gizli_satir_mi(uuid) to anon, authenticated, service_role;

-- 1'e 1 sohbet: sohbeti açan/kuran üye gizliyse sohbet başkalarına görünmez. Grup sohbetleri kalır (yalnızca gizli üyenin
-- mesajı/üyeliği süzülür).
create or replace function public.konusma_gizli_mi(p_konusma uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_konusma is null or not exists (select 1 from public.gizli_uyeler) then false
    else exists (
      select 1 from public.conversations c
       where c.id = p_konusma and not coalesce(c.grup, false)
         and (public.gizli_satir_mi(c.user_id) or public.gizli_satir_mi(c.created_by))
    ) end;
$$;
revoke all on function public.konusma_gizli_mi(uuid) from public;
grant execute on function public.konusma_gizli_mi(uuid) to anon, authenticated, service_role;

-- 2) Tablo → "görünür" koşulu haritası (hem politikada hem fonksiyon yeniden yazımında AYNI metin kullanılır).
--    {t} = sütun öneki: politikada boş, fonksiyon yeniden yazımında "_g." (plpgsql OUT değişkenleriyle ad çakışmasını önler). -------------------
drop table if exists _gizleme_harita;
create temp table _gizleme_harita (tablo text primary key, kosul text not null);
insert into _gizleme_harita (tablo, kosul) values
  -- Akademik Kütüphane
  ('akademik_kaynaklar',          'not public.gizli_satir_mi({t}user_id)'),
  ('akademik_notlar',             'not public.gizli_satir_mi({t}user_id)'),
  ('akademik_koleksiyonlar',      'not public.gizli_satir_mi({t}user_id)'),
  ('akademik_koleksiyon_ogeleri', 'not public.gizli_satir_mi({t}user_id)'),
  ('akademik_paylasimlari',       'not public.gizli_satir_mi({t}user_id)'),
  ('akademik_eklenti_ayarlari',   'not public.gizli_satir_mi({t}user_id)'),
  -- Notlar
  ('notlar',                      'not public.gizli_satir_mi({t}user_id)'),
  ('not_ek_kayitlari',            'not public.gizli_satir_mi({t}user_id)'),
  ('not_kasasi',                  'not public.gizli_satir_mi({t}user_id)'),
  -- Sohbet / Mesajlar
  ('conversations',               'coalesce({t}grup, false) or not (public.gizli_satir_mi({t}user_id) or public.gizli_satir_mi({t}created_by))'),
  ('messages',                    'not public.gizli_satir_mi({t}sender_id) and not public.konusma_gizli_mi({t}conversation_id)'),
  ('konusma_uyeleri',             'not public.gizli_satir_mi({t}user_id) and not public.konusma_gizli_mi({t}conversation_id)'),
  ('konusma_zarflari',            'not public.gizli_satir_mi({t}user_id) and not public.konusma_gizli_mi({t}conversation_id)'),
  ('konusma_durumlari',           'not public.gizli_satir_mi({t}user_id) and not public.konusma_gizli_mi({t}conversation_id)'),
  ('mesaj_yildizlari',            'not public.gizli_satir_mi({t}user_id)'),
  ('mesaj_sabitleri',             'not public.gizli_satir_mi({t}sabitleyen_id)'),
  ('e2ee_kullanici_anahtarlari',  'not public.gizli_satir_mi({t}kullanici_id)'),
  -- Dosya Yönetimi / Medya Havuzu
  ('r2_arsiv',                    'not public.gizli_satir_mi({t}sahip_id)'),
  ('r2_baglantilari',             'not public.gizli_satir_mi({t}user_id)'),
  ('r2_baglanti_klasorleri',      'not public.gizli_satir_mi({t}user_id)'),
  ('yazi_medya',                  'not public.gizli_satir_mi({t}olusturan)'),
  ('yazi_medya_anahtarlari',      'not public.gizli_satir_mi({t}sahip)'),
  ('ozel_icerik_dosyalari',       'not public.gizli_satir_mi({t}ekleyen)'),
  ('ozel_icerik_anahtarlar',      'not public.gizli_satir_mi({t}alici_id)'),
  ('medya_kota_kullanim',         'not public.gizli_satir_mi({t}user_id)'),
  -- İçerik
  ('yorumlar',                    'not public.gizli_satir_mi({t}user_id)'),
  ('special_content',             'not public.gizli_satir_mi({t}author_id)'),
  ('taslak_icerikler',            'not public.gizli_satir_mi({t}created_by)'),
  ('yazi_inceleme',               'not public.gizli_satir_mi({t}gonderen_id)'),
  ('yazi_inceleme_notlari',       'not public.gizli_satir_mi({t}yazan_id)'),
  ('content_access',              'not public.gizli_satir_mi({t}user_id)'),
  ('site_duyuru_okumalari',       'not public.gizli_satir_mi({t}user_id)'),
  -- Kayıtlar / yetkiler / kullanım
  ('indirme_loglari',             'not public.gizli_satir_mi({t}user_id)'),
  ('sistem_islem_loglari',        'not public.gizli_satir_mi({t}user_id)'),
  ('sistem_export_loglari',       'not public.gizli_satir_mi({t}user_id)'),
  ('openmeteo_kullanim',          'not public.gizli_satir_mi({t}user_id)'),
  ('openmeteo_kullanici_limitleri','not public.gizli_satir_mi({t}user_id)'),
  ('havastil_konumlari',          'not public.gizli_satir_mi({t}user_id)'),
  ('havastil_tercihleri',         'not public.gizli_satir_mi({t}user_id)'),
  ('onay_gecmisi',                'not public.gizli_satir_mi({t}user_id)'),
  ('ozellik_kullanici_izinleri',  'not public.gizli_satir_mi({t}user_id)'),
  ('ozellik_kullanici_kisitlari', 'not public.gizli_satir_mi({t}user_id)'),
  ('site_onizleme_izinleri',      'not public.gizli_satir_mi({t}user_id)'),
  ('uye_aktarim_yetkileri',       'not public.gizli_satir_mi({t}yetkili_id)'),
  ('uye_aktarim_kayitlari',       'not public.gizli_satir_mi({t}yetkili_id)'),
  ('worker_anahtar_gunlugu',      'not public.gizli_satir_mi({t}kullanici_id)'),
  ('profiles',                    'not public.gizli_satir_mi({t}id)');

-- 3) RESTRICTIVE select politikaları (mevcut izin politikalarıyla VE'lenir; sahibin kendi satırı hep geçer) ------------------
do $$
declare r record; v_n int := 0;
begin
  for r in select tablo, kosul from _gizleme_harita where tablo <> 'profiles' loop   -- profiles: 0136'da zaten var
    if to_regclass('public.' || r.tablo) is null then
      raise notice 'gizleme: % tablosu yok, atlandı', r.tablo; continue;
    end if;
    begin
      if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || r.tablo)) then
        raise notice 'gizleme: % tablosunda RLS kapalı; politika etkisiz kalırdı, atlandı', r.tablo; continue;
      end if;
      execute format('drop policy if exists %I on public.%I', r.tablo || '_gizli_uye_izolasyonu', r.tablo);
      execute format('create policy %I on public.%I as restrictive for select using (%s)', r.tablo || '_gizli_uye_izolasyonu', r.tablo, replace(r.kosul, '{t}', ''));
      v_n := v_n + 1;
    exception when others then
      raise warning 'gizleme: % için politika kurulamadı: %', r.tablo, sqlerrm;
    end;
  end loop;
  raise notice 'gizleme: % tabloya politika kuruldu', v_n;
end $$;

-- profiles: 0136 politikası yalnızca 'authenticated' içindi; oturumsuz (anon) okumaya da aynı kural.
do $$ begin
  drop policy if exists profiles_gizli_uye_izolasyonu_anon on public.profiles;
  create policy profiles_gizli_uye_izolasyonu_anon on public.profiles as restrictive for select to anon using (not public.gizli_satir_mi(id));
exception when others then raise warning 'gizleme: profiles anon politikası kurulamadı: %', sqlerrm;
end $$;

-- 4) SECURITY DEFINER liste/sayaç fonksiyonları: tablo okumaları süzülmüş alt sorguya çevrilir ---------------------------------
do $$
declare
  v_adlar text[] := array[
    'admin_uye_arama','mesaj_alici_listesi','mesaj_alici_ozeti','mesaj_hedef_listesi_getir','mesaj_kisi_bilgileri','grup_uyeleri',
    'admin_listesi_getir','guvenlik_admin_listesi_getir','icerik_atama_listesi_getir','gk_uye_goruntusu',
    'owner_akademik_uyeleri_getir','owner_akademik_kaynaklari_getir','owner_kvkk_onay_ozeti','kvkk_onay_ozeti','uye_onay_durumlari','uye_onay_gecmisi',
    'owner_ozellik_uye_ara','owner_ozellik_uye_ara_izin','owner_site_onizleme_uye_ara','owner_uye_aktarim_kayitlari',
    'owner_uye_aktarim_yetkilerini_getir','owner_uye_aktarim_yoneticileri','owner_sistem_export_loglari','sistem_export_kullanici_ara',
    'ozel_icerik_alicilari_getir','ozel_icerik_dosyalari_listele','ozellik_kullanici_izinlerini_getir','ozellik_kullanici_kisitlarini_getir',
    'r2_arsiv_izinlerini_getir','site_onizleme_izinlilerini_getir','openmeteo_kullanim_tumu','akademik_paylasilan_uyeler',
    'akademik_acik_kutuphaneler','akademik_paylasim_getir','akademik_paylasim_kaynaklari','akademik_uye_paylasimlari',
    'arsiv_benimle_paylasilanlar','arsiv_gonderen_getir','arsiv_paylastiklarim','arsiv_kullanici_ara','duyuru_okuyanlar',
    'yazi_inceleme_listele','yazi_inceleme_notlari_getir','yazi_medya_listele','worker_anahtar_gunlugu_getir',
    'e2ee_anahtari_olmayanlar','denetim_vakalarini_listele','okunmamis_mesaj_ozeti','cop_kutusu_listele','sadece_supabase_yayinlari_listele'
  ];
  f record; h record; v_yeni text; v_say int; v_toplam int := 0; v_degisen int := 0;
  v_ayrac constant text := '(?!(?:where|join|on|left|right|inner|cross|full|set|order|group|limit|offset|for|using|natural|union|returning|having|window|except|intersect|as|select|values|_g)\M)';  -- _g: daha önce süzülmüş okuma tekrar sarılmaz (yeniden çalıştırma güvenli)
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as tanim
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (v_adlar)
  loop
    v_yeni := f.tanim; v_say := 0;
    begin
      if v_yeni ~* '\m(?:update|delete\s+from|insert\s+into)\s+public\.(?:profiles|conversations|messages|notlar|r2_arsiv)\M'
         or v_yeni ~* '\mfor\s+(?:update|share)\M' then
        raise notice 'gizleme: % yazma/kilit içerdiği için elle incelenmeli, atlandı', f.proname; continue;
      end if;
      for h in select tablo, kosul from _gizleme_harita loop
        v_yeni := regexp_replace(
          v_yeni,
          '(\m(?:from|join)\s+)public\.' || h.tablo || '\s+(?:as\s+)?' || v_ayrac || '([a-z_][a-z0-9_]*)',
          E'\\1(select * from public.' || h.tablo || ' _g where ' || replace(replace(h.kosul, '{t}', '_g.'), '\', '\\') || E') \\2',
          'gi');
      end loop;
      if v_yeni = f.tanim then
        raise notice 'gizleme: % gövdesinde süzülecek tablo okuması bulunamadı', f.proname; continue;
      end if;
      execute v_yeni;
      v_degisen := v_degisen + 1;
    exception when others then
      raise warning 'gizleme: % yeniden yazılamadı (özgün hali korunuyor): %', f.proname, sqlerrm;
    end;
    v_toplam := v_toplam + 1;
  end loop;
  raise notice 'gizleme: % fonksiyondan % tanesi süzüldü', v_toplam, v_degisen;
end $$;

drop table if exists _gizleme_harita;

-- 5) Sahip için kolay denetim: kaç üye gizli, körlük açık mı (yalnızca Site Sahibi) ----------------------------------------
create or replace function public.owner_gizleme_ozeti()
returns table (gizli_uye_sayisi bigint, korluk_acik boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then return; end if;
  return query select (select count(*) from public.gizli_uyeler),
                      coalesce((select o.blind_mode from public.owner_ayarlari o where o.id), false);
end $$;
revoke all on function public.owner_gizleme_ozeti() from public, anon;
grant execute on function public.owner_gizleme_ozeti() to authenticated;
