-- ============================================================================
-- 0045_mesaj_konusma_kalici_silme.sql
-- İstenen davranış: migration 0019 ile gelen "kişisel silme" (konusma_
-- gizlemeleri / mesaj_gizlemeleri) mekanizması, satırı SADECE silen kişinin
-- görünümünden kaldırıyordu — veri Supabase'de SÜRESİZ kalıyordu (karşı
-- taraf hâlâ görüyor olabileceği için bu bilinçli bir tercihti). Artık BUNA
-- EK olarak: bir konuşmayı/mesajı GÖREBİLECEK HERKES (konuşma sahibi ÜYE +
-- o an aktif TÜM adminler/owner'lar) kendi tarafından gizlediyse — yani
-- ARTIK KİMSE görmüyorsa — 30 GÜN sonra satır Supabase'den KALICI olarak
-- (gerçek DELETE ile) silinir.
--
-- SAYAÇ NE ZAMAN BAŞLAR? "Silme eyleminden itibaren" — ama tek bir silme
-- eylemi değil, GEREKLİ SON kişinin gizleme eylemi. Örnek: üye bir sohbeti
-- bugün siler, admin aynı sohbeti 10 gün sonra siler → 30 günlük sayaç
-- adminin sildiği günden başlar (o ana kadar sohbet hâlâ admin tarafından
-- görülüyordu, "kimse görmüyor" durumu ancak o an oluştu). Bu, ekstra bir
-- "tamamlanma zamanı" kolonu TUTMADAN, mevcut gizlendi_at kayıtlarının
-- MAX'ı alınarak hesaplanır (bkz. aşağıdaki iki yardımcı fonksiyon) — yani
-- şema değişikliği gerekmez, saf sorgu mantığıdır.
--
-- "GEREKLİ TARAFLAR" KİMDİR? messages_select_own_or_admin / conversations_
-- select_own_or_admin politikalarıyla AYNI görünürlük kümesi: konuşmanın
-- sahibi olan üye + o an askıya alınmamış TÜM admin/owner profilleri (bkz.
-- public.is_admin()). Yeni bir admin eklenirse ya da askıya alınmış bir
-- admin geri açılırsa, o kişi henüz kendi tarafından gizlemediği için
-- konuşma/mesaj otomatik olarak "tam gizli" sayılmaktan ÇIKAR — kalıcı
-- silme yanlışlıkla ERKEN tetiklenmez.
--
-- NEDEN TEK TEK MESAJ SEVİYESİNDE DE KONTROL EDİYORUZ (sadece konuşma
-- seviyesinde değil)? Bir kullanıcı sohbetin TAMAMINI değil, TEK bir mesajı
-- silmiş olabilir (mesaji_kendimden_gizle) — sohbet hâlâ aktif kullanılıyor
-- olsa bile o TEK mesaj gerekli tüm taraflarca gizlenmiş ve 30 günü geçmiş
-- olabilir; bu durumda sohbetin geri kalanına dokunmadan SADECE o mesaj
-- kalıcı silinir.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0034 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) YARDIMCI: bir KONUŞMA gerekli tüm taraflarca gizlenmiş mi? Gizlenmişse
--    "tamamlanma zamanı"nı (gerekli taraflardan en SON gizleyenin gizlendi_at
--    değerini), gizlenmemişse NULL döner.
-- ----------------------------------------------------------------------------
create or replace function public.konusma_gizleme_tamamlanma_zamani(p_conversation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with gerekli_taraflar as (
    select c.user_id as id from public.conversations c where c.id = p_conversation_id
    union
    select p.id from public.profiles p
    where p.role in ('admin', 'owner') and coalesce(p.is_suspended, false) = false
  )
  select case
    when exists (
      select 1 from gerekli_taraflar gt
      where not exists (
        select 1 from public.konusma_gizlemeleri kg
        where kg.conversation_id = p_conversation_id and kg.user_id = gt.id
      )
    )
    then null
    else (
      select max(kg.gizlendi_at)
      from public.konusma_gizlemeleri kg
      where kg.conversation_id = p_conversation_id
    )
  end;
$$;

comment on function public.konusma_gizleme_tamamlanma_zamani(uuid) is
  'Bir konuşmayı görebilecek HERKES (sahip üye + aktif tüm admin/owner) kendi tarafından gizlediyse, gerekli son kişinin gizlendi_at değerini döner (30 günlük sayacın başlangıcı budur) — henüz herkes gizlememişse NULL döner.';

revoke execute on function public.konusma_gizleme_tamamlanma_zamani(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) YARDIMCI: bir TEK MESAJ gerekli tüm taraflarca gizlenmiş mi? (Konuşmanın
--    kendisi hâlâ açık/aktif olsa bile, tek bir mesaj bağımsız olarak kalıcı
--    silinebilir — yukarıdaki dosya başı notuna bkz.)
-- ----------------------------------------------------------------------------
create or replace function public.mesaj_gizleme_tamamlanma_zamani(p_message_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with gerekli_taraflar as (
    select c.user_id as id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_message_id
    union
    select p.id from public.profiles p
    where p.role in ('admin', 'owner') and coalesce(p.is_suspended, false) = false
  )
  select case
    when exists (
      select 1 from gerekli_taraflar gt
      where not exists (
        select 1 from public.mesaj_gizlemeleri mg
        where mg.message_id = p_message_id and mg.user_id = gt.id
      )
    )
    then null
    else (
      select max(mg.gizlendi_at)
      from public.mesaj_gizlemeleri mg
      where mg.message_id = p_message_id
    )
  end;
$$;

comment on function public.mesaj_gizleme_tamamlanma_zamani(uuid) is
  'Bir mesajı görebilecek HERKES (konuşma sahibi + aktif tüm admin/owner) kendi tarafından gizlediyse, gerekli son kişinin gizlendi_at değerini döner — henüz herkes gizlememişse NULL döner.';

revoke execute on function public.mesaj_gizleme_tamamlanma_zamani(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) ASIL TEMİZLİK İŞLEVİ — SADECE service_role (cron/Edge Function)
--    çağırabilir; admin_denetim_zaman_asimini_isle (migration 0021) ile
--    AYNI desen ve AYNI güvenlik kontrolü (auth.role() <> 'service_role').
--    30 GÜN eşiği burada TEK bir yerde (aşağıdaki interval '30 days')
--    tanımlı — ileride değiştirilmek istenirse sadece bu fonksiyon
--    güncellenir.
-- ----------------------------------------------------------------------------
create or replace function public.mesajlasma_kalici_silmeyi_isle()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_silinen_mesaj   int := 0;
  v_silinen_konusma int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Bu fonksiyon sadece zamanlanmış görev (service_role) tarafından çağrılabilir.';
  end if;

  -- a) Gerekli tüm taraflarca gizlenmiş VE üzerinden 30 gün geçmiş TEK
  --    mesajlar (konuşmanın kendisi hâlâ açık olabilir).
  with silinecek as (
    select m.id
    from public.messages m
    where public.mesaj_gizleme_tamamlanma_zamani(m.id) is not null
      and public.mesaj_gizleme_tamamlanma_zamani(m.id) <= now() - interval '30 days'
  )
  delete from public.messages where id in (select id from silinecek);
  get diagnostics v_silinen_mesaj = row_count;

  -- b) Gerekli tüm taraflarca gizlenmiş VE üzerinden 30 gün geçmiş
  --    KONUŞMALAR — silinince kalan mesajlar da (on delete cascade ile)
  --    otomatik gider, ayrıca tek tek silinmelerine gerek yok.
  with silinecek as (
    select c.id
    from public.conversations c
    where public.konusma_gizleme_tamamlanma_zamani(c.id) is not null
      and public.konusma_gizleme_tamamlanma_zamani(c.id) <= now() - interval '30 days'
  )
  delete from public.conversations where id in (select id from silinecek);
  get diagnostics v_silinen_konusma = row_count;

  return v_silinen_mesaj + v_silinen_konusma;
end;
$$;

comment on function public.mesajlasma_kalici_silmeyi_isle() is
  'Gerekli tüm taraflarca (sahip üye + aktif tüm admin/owner) gizlenmiş ve son gizlemenin üzerinden 30 gün geçmiş konuşma/mesajları Supabase''den KALICI olarak siler. SADECE service_role çağırabilir — bkz. supabase/functions/mesajlasma-kalici-silme.';

revoke execute on function public.mesajlasma_kalici_silmeyi_isle() from public, authenticated, anon;
grant  execute on function public.mesajlasma_kalici_silmeyi_isle() to service_role;

-- ============================================================================
-- BİTTİ. Bu RPC'yi periyodik tetiklemek için (pg_cron yerine, admin-denetim-
-- zaman-asimi ile AYNI "Edge Function + GitHub Actions" deseni):
--   1) supabase functions deploy mesajlasma-kalici-silme
--      (bkz. supabase/functions/mesajlasma-kalici-silme/index.ts VE
--      supabase/config.toml — bu deploy'un "verify_jwt = false" ile
--      yapılması ŞART, aksi halde fonksiyon X-Cron-Secret doğru olsa bile
--      Supabase'in kendi JWT zorunluluğu yüzünden HER ZAMAN
--      "401 Unauthorized" döner; kod hiç çalıştırılmadan reddedilir)
--   2) supabase secrets set CRON_SHARED_SECRET=<mevcut değerle AYNI>
--   3) GitHub repo -> Settings -> Secrets and variables -> Actions:
--        MESAJ_KALICI_SILME_FUNCTION_URL = https://<proje-ref>.supabase.co/functions/v1/mesajlasma-kalici-silme
--        MESAJ_KALICI_SILME_CRON_SECRET  = (2. adımdaki AYNI değer)
--      (bkz. .github/workflows/mesajlasma-kalici-silme.yml — günde bir kez
--      çalışır, 30 günlük eşik için 15 dakikalık admin-denetim sıklığı
--      GEREKMEZ.)
-- ============================================================================
