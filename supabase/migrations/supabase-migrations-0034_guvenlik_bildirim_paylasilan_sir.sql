-- ============================================================================
-- 0034_guvenlik_bildirim_paylasilan_sir.sql
--
-- GÜVENLİK AÇIĞI DÜZELTMESİ: cloudflare worker/admin_guvenlik_bildirim_worker
-- ÖNCEDEN sadece tahmin edilmesi zor bir URL path'i (GIZLI_YOL) ile
-- korunuyordu — kriptografik bir doğrulama YOKTU. Bu URL bir şekilde
-- sızarsa (tarayıcı geçmişi, Cloudflare Analytics/Logs ekranı, yanlışlıkla
-- paylaşılan bir ekran görüntüsü, ...) o adresi bilen HERKES worker'a
-- rastgele bir JSON gövdesiyle POST atıp sahte "bir admin askıya alındı"
-- gibi Telegram/SMS bildirimleri tetikleyebilirdi (spam/sosyal mühendislik
-- yüzeyi — worker'ın kendisi Supabase'e yazmadığı için bir yetki
-- yükseltmesine yol AÇMIYORDU, ama gereksiz ve önlenebilir bir açıktı).
--
-- ÇÖZÜM: admin-denetim-zaman-asimi Edge Function'ındaki "paylaşılan sır"
-- deseninin AYNISI — public._denetim_bildirim_gonder() artık
-- guvenlik_bildirim_ayarlari.webhook_secret sütununu "X-Webhook-Secret"
-- header'ı olarak GÖNDERİYOR, worker da (bkz. worker.js'teki güncelleme)
-- bu header'ı SABİT ZAMANLI (timing-safe) şekilde doğruluyor. GIZLI_YOL
-- kontrolü de KALDIRILMADI — savunma derinliği için iki katman birlikte
-- duruyor.
-- ============================================================================

alter table public.guvenlik_bildirim_ayarlari
  add column if not exists webhook_secret text;

comment on column public.guvenlik_bildirim_ayarlari.webhook_secret is
  'Worker''a (admin_guvenlik_bildirim_worker) gönderilen her istekte "X-Webhook-Secret" header''ı olarak eklenir; worker''daki WEBHOOK_SHARED_SECRET ortam değişkeniyle AYNI değer olmalı. NULL/boş bırakılırsa header hiç gönderilmez ve worker (yapılandırıldıysa) isteği reddeder — bkz. worker.js başındaki kurulum notu.';

create or replace function public._denetim_bildirim_gonder(p_denetim_id uuid, p_olay text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  ayar     public.guvenlik_bildirim_ayarlari%rowtype;
  vaka     public.admin_denetim%rowtype;
  yuk      jsonb;
  basliklar jsonb;
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

  -- GÜVENLİK (bkz. dosya başı notu): sır ayarlıysa header'a ekleniyor.
  -- Ayarlanmamışsa (henüz kurulum tamamlanmadıysa) header hiç
  -- gönderilmez — worker tarafı bu durumda (kendi WEBHOOK_SHARED_SECRET'ı
  -- ayarlıysa) isteği zaten reddeder; ayarlanmamışsa eskisi gibi (sadece
  -- GIZLI_YOL ile) çalışmaya devam eder, böylece kademeli geçiş mümkün olur.
  basliklar := jsonb_build_object('Content-Type', 'application/json');
  if ayar.webhook_secret is not null and ayar.webhook_secret <> '' then
    basliklar := basliklar || jsonb_build_object('X-Webhook-Secret', ayar.webhook_secret);
  end if;

  -- pg_net İSTEĞİ KUYRUĞA ALIR ve arka planda gönderir (fonksiyon burada
  -- BLOKLANMAZ) — yanıtı beklemeyiz, bu yüzden askıya alma/oylama
  -- işlemleri webhook yavaş/kapalıysa bile asla gecikmez/başarısız olmaz.
  perform net.http_post(
    url := ayar.webhook_url,
    headers := basliklar,
    body := yuk
  );
exception when others then
  -- Bildirim ASLA ana işlemi (askıya alma/oylama/düşürme) başarısız
  -- kılmasın — pg_net kurulu değilse ya da worker cevap vermezse bile
  -- güvenlik akışı çalışmaya devam eder.
  raise notice 'Denetim bildirimi gönderilemedi: %', SQLERRM;
end;
$$;

-- GÜVENLİK: yetki kontrolü yok (bkz. migration 0021 § 11 notu) — doğrudan
-- çağrılırsa bir üye sahte bir webhook olayı tetikleyebilirdi (düşük risk
-- ama gereksiz bir yüzey), yine de tutarlılık için revoke ediyoruz (bu,
-- 0021'deki revoke'un create-or-replace sonrası tekrarıdır — Postgres
-- create-or-replace'te mevcut GRANT/REVOKE'ları KORUR ama açıkça tekrar
-- etmek gelecekte biri fonksiyonu DROP edip yeniden yaratırsa unutulmasını
-- önler).
revoke execute on function public._denetim_bildirim_gonder(uuid, text) from public, authenticated, anon;

-- ============================================================================
-- KURULUM (mevcut bir kuruluma bu migration'ı uyguladıktan sonra):
--
--   1) Rastgele, uzun bir sır üret (ör. `openssl rand -hex 32`).
--   2) Supabase'de:
--        update public.guvenlik_bildirim_ayarlari
--        set webhook_secret = '<ürettiğin-sır>'
--        where id = 1;
--   3) Cloudflare Worker'da (admin_guvenlik_bildirim_worker) AYNI değeri
--      WEBHOOK_SHARED_SECRET ortam değişkeni olarak ekle (Settings >
--      Variables and Secrets > Encrypt/Secret).
--   4) worker.js'in güncel sürümünü (X-Webhook-Secret kontrolü eklenmiş
--      hâli) deploy et.
-- ============================================================================
