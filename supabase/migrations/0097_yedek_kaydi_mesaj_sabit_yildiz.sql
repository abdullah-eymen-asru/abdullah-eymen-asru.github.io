-- ============================================================================
-- 0097_yedek_kaydi_mesaj_sabit_yildiz.sql
-- Gereksinim: 0095 ve 0096 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (create or replace).
--
-- Sistem yedeğinin (dışa aktarma) tablo kayıt listesine 0096'da eklenen iki tablo girer:
--   • mesaj_sabitleri  — sohbetlerde "yukarı sabitlenen" mesaj (sohbet başına tek satır). Kapsam: kullanıcının dahil olduğu
--                        sohbetler (messages ile aynı koşul) → sabit, sohbetin her iki tarafı için de taşınır.
--   • mesaj_yildizlari — KİŞİYE ÖZEL yıldız tercihleri (user_id = auth.uid()).
-- Geri yükleme tarafı için SQL değişikliği gerekmez: sistem_geri_yukle_tablo() public şemadaki her tabloyu şemadan (kolon/PK) okuyarak
-- yazar. Bu iki tablo korumalı DEĞİLDİR (listede yok); 'uzerine' modunda PK çakışmasında güncellenir.
-- Yazım sırası (FK): conversations → messages → mesaj_sabitleri / mesaj_yildizlari — istemci SIRA listesi (ice-aktar.js) güncellendi.
-- ============================================================================
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
-- ============================================================================
-- BİTTİ.
-- ============================================================================
