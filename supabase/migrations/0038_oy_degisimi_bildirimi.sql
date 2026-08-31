-- 0036_oy_degisimi_bildirimi.sql
-- Değişiklik: admin_denetim_oy_kullan() artık HER oy kullanımında değil,
-- sadece (a) kişinin İLK oyu ya da (b) önceki oyundan FARKLI bir oy
-- verdiğinde bildirim gönderiyor. Aynı oyu tekrar verirse (değişiklik
-- yoksa) bildirim gitmez. Ayrıca bildirime kimin hangi oyu kullandığı
-- (ad-soyad + oy) da ekleniyor.
--
-- Bunun için _denetim_bildirim_gonder() üçüncü, opsiyonel bir "p_ekstra
-- jsonb" parametresi alacak şekilde genişletildi — mevcut 2 parametreli
-- çağrılar (admin_askiya_al, _admin_denetim_sonuclandir) hiçbir değişiklik
-- gerektirmeden çalışmaya devam eder (parametre varsayılan olarak boş).

create or replace function public._denetim_bildirim_gonder(
  p_denetim_id uuid,
  p_olay text,
  p_ekstra jsonb default '{}'::jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  ayar         public.guvenlik_bildirim_ayarlari%rowtype;
  vaka         public.admin_denetim%rowtype;
  hedef_ad     text;
  hedef_eposta text;
  yuk          jsonb;
  basliklar    jsonb;
begin
  select * into ayar from public.guvenlik_bildirim_ayarlari where id = 1;
  if ayar.webhook_url is null or not ayar.aktif then
    return;
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
  ) || coalesce(p_ekstra, '{}'::jsonb);

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

-- ----------------------------------------------------------------------------
-- admin_denetim_oy_kullan(): eski oyu upsert'ten ÖNCE oku, yeni oyla
-- karşılaştır. Sadece (a) ilk oy (eski_oy null) ya da (b) oy gerçekten
-- değiştiyse (eski_oy <> p_oy) bildirim gönder — aynı oy tekrar
-- kullanılırsa (eski_oy = p_oy) bildirim ATLANIR.
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
  eski_oy        text;
  oy_veren_ad    text;
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

  -- Bildirim karşılaştırması için ESKİ oyu, upsert'ten ÖNCE oku.
  select oy into eski_oy
  from public.admin_denetim_oylari
  where denetim_id = p_denetim_id and oy_kullanan_id = auth.uid();

  insert into public.admin_denetim_oylari (denetim_id, oy_kullanan_id, oy)
  values (p_denetim_id, auth.uid(), p_oy)
  on conflict (denetim_id, oy_kullanan_id) do update set oy = excluded.oy, created_at = now();

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (p_denetim_id, 'oy_kullanildi', auth.uid(), jsonb_build_object('oy', p_oy));

  -- BİLDİRİM: sadece ilk oy (eski_oy is null) ya da oy gerçekten
  -- değiştiyse (eski_oy is distinct from p_oy) gönder. Aynı oy tekrar
  -- verilirse (eski_oy = p_oy) hiçbir şey göndermeden devam et.
  if eski_oy is null or eski_oy is distinct from p_oy then
    select full_name into oy_veren_ad from public.profiles where id = auth.uid();
    perform public._denetim_bildirim_gonder(
      p_denetim_id,
      'oy_kullanildi',
      jsonb_build_object(
        'oy_veren_ad_soyad', coalesce(oy_veren_ad, '-'),
        'oy', p_oy,
        'oy_degisti', eski_oy is not null
      )
    );
  end if;

  if vaka.gerekli_oy_sayisi is null then
    return;
  end if;

  select count(*) filter (where oy = 'dusur'), count(*) filter (where oy = 'geri_ac')
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
