-- 0037_bildirim_admin_adi_ve_zaman.sql
-- _denetim_bildirim_gonder() fonksiyonuna hedef adminin ad-soyad ve e-posta
-- bilgisini ekliyoruz, böylece Telegram/SMS bildiriminde "hangi admin"
-- olduğu görünür hale geliyor. (worker.js tarafındaki mesaj formatlama da
-- ayrıca güncellendi — bkz. cloudflare worker/admin_guvenlik_bildirim_worker)

create or replace function public._denetim_bildirim_gonder(p_denetim_id uuid, p_olay text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  ayar      public.guvenlik_bildirim_ayarlari%rowtype;
  vaka      public.admin_denetim%rowtype;
  hedef_ad  text;
  hedef_eposta text;
  yuk       jsonb;
  basliklar jsonb;
begin
  select * into ayar from public.guvenlik_bildirim_ayarlari where id = 1;
  if ayar.webhook_url is null or not ayar.aktif then
    return; -- webhook kurulmamış/kapalıysa sessizce çık — bildirim opsiyoneldir
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id;

  select p.full_name, p.email into hedef_ad, hedef_eposta
  from public.profiles p where p.id = vaka.hedef_admin_id;

  yuk := jsonb_build_object(
    'olay', p_olay,
    'denetim_id', p_denetim_id,
    'hedef_admin_id', vaka.hedef_admin_id,
    'hedef_admin_ad_soyad', coalesce(hedef_ad, '-'),
    'hedef_admin_email', coalesce(hedef_eposta, '-'),
    'sebep', vaka.sebep,
    'durum', vaka.durum,
    'zaman', now()
  );

  basliklar := jsonb_build_object('Content-Type', 'application/json');
  if ayar.webhook_secret is not null and ayar.webhook_secret <> '' then
    basliklar := basliklar || jsonb_build_object('X-Webhook-Secret', ayar.webhook_secret);
  end if;

  perform net.http_post(
    url := ayar.webhook_url,
    headers := basliklar,
    body := yuk
  );
exception when others then
  raise notice 'Denetim bildirimi gönderilemedi: %', SQLERRM;
end;
$function$;
