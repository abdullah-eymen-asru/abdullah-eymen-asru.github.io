-- 0039_baslatan_ve_oy_geri_alma.sql
-- (A) _denetim_bildirim_gonder(): artık vakayı BAŞLATAN adminin ad-soyadını
--     da payload'a ekliyor (Telegram/SMS mesajında "Başlatan: X" satırı
--     için — panel zaten bunu gösteriyordu, sadece bildirimde eksikti).
-- (B) admin_denetim_oy_geri_al(): bir admin kendi oyunu TAMAMEN geri
--     alabilir (silebilir) — "dusur"<->"geri_ac" arası değiştirmek değil,
--     oyu tamamen kaldırmak. Vaka hâlâ "askida" olmalı.
-- (C) denetim_vakalarini_listele(): artık çağıran kişinin bu vakadaki
--     kendi oyunu da (ben_oyum) döndürüyor — panel bu bilgiyle "Oyunu Geri
--     Al" butonunu sadece gerçekten oy kullanmışsa gösterebilsin diye.

-- ----------------------------------------------------------------------------
-- (A) _denetim_bildirim_gonder() — başlatan admin bilgisini ekle
-- ----------------------------------------------------------------------------
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
  ayar            public.guvenlik_bildirim_ayarlari%rowtype;
  vaka            public.admin_denetim%rowtype;
  hedef_ad        text;
  hedef_eposta    text;
  baslatan_ad     text;
  yuk             jsonb;
  basliklar       jsonb;
begin
  select * into ayar from public.guvenlik_bildirim_ayarlari where id = 1;
  if ayar.webhook_url is null or not ayar.aktif then
    return;
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id;

  select p.full_name, p.email into hedef_ad, hedef_eposta
  from public.profiles p where p.id = vaka.hedef_admin_id;

  select p.full_name into baslatan_ad
  from public.profiles p where p.id = vaka.baslatan_admin_id;

  yuk := jsonb_build_object(
    'olay', p_olay,
    'denetim_id', p_denetim_id,
    'hedef_admin_id', vaka.hedef_admin_id,
    'hedef_admin_ad_soyad', coalesce(hedef_ad, '-'),
    'hedef_admin_email', coalesce(hedef_eposta, '-'),
    'baslatan_admin_ad_soyad', coalesce(baslatan_ad, '-'),
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
-- (B) admin_denetim_oy_geri_al() — kendi oyunu tamamen geri al (sil)
-- ----------------------------------------------------------------------------
create or replace function public.admin_denetim_oy_geri_al(p_denetim_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  vaka        public.admin_denetim%rowtype;
  eski_oy     text;
  oy_veren_ad text;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz işlem: sadece admin/owner oy verebilir/geri alabilir.';
  end if;

  select * into vaka from public.admin_denetim where id = p_denetim_id for update;
  if vaka.id is null then
    raise exception 'Denetim vakası bulunamadı.';
  end if;
  if vaka.durum <> 'askida' then
    raise exception 'Bu vaka zaten sonuçlanmış (durum: %) — oy geri alınamaz.', vaka.durum;
  end if;

  delete from public.admin_denetim_oylari
  where denetim_id = p_denetim_id and oy_kullanan_id = auth.uid()
  returning oy into eski_oy;

  if eski_oy is null then
    raise exception 'Bu vaka için zaten bir oyun yok — geri alınacak bir şey bulunamadı.';
  end if;

  insert into public.admin_denetim_log (denetim_id, olay, aktor_id, detay)
  values (p_denetim_id, 'oy_geri_alindi', auth.uid(), jsonb_build_object('eski_oy', eski_oy));

  select full_name into oy_veren_ad from public.profiles where id = auth.uid();
  perform public._denetim_bildirim_gonder(
    p_denetim_id,
    'oy_geri_alindi',
    jsonb_build_object('oy_veren_ad_soyad', coalesce(oy_veren_ad, '-'), 'eski_oy', eski_oy)
  );
end;
$$;

grant execute on function public.admin_denetim_oy_geri_al(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- (C) denetim_vakalarini_listele() — "ben_oyum" sütunu eklendi
--     (return type değiştiği için CREATE OR REPLACE yetmez, önce DROP
--     gerekiyor — tıpkı _denetim_bildirim_gonder'da yaşadığımız "is not
--     unique" hatasının benzeri bir Postgres kısıtı).
-- ----------------------------------------------------------------------------
drop function if exists public.denetim_vakalarini_listele();

create function public.denetim_vakalarini_listele()
returns table (
  id uuid, hedef_admin_id uuid, hedef_ad text, baslatan_admin_id uuid, baslatan_ad text,
  sebep text, durum text, hedef_yeni_rol text, gerekli_oy_sayisi int,
  created_at timestamptz, karar_son_tarihi timestamptz,
  sonuclanma_tarihi timestamptz, dusur_oylari int, geri_ac_oylari int,
  ben_oyum text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.hedef_admin_id, hp.full_name, d.baslatan_admin_id, bp.full_name,
    d.sebep, d.durum, d.hedef_yeni_rol, d.gerekli_oy_sayisi,
    d.created_at, d.karar_son_tarihi, d.sonuclanma_tarihi,
    (select count(*)::int from public.admin_denetim_oylari o where o.denetim_id = d.id and o.oy = 'dusur'),
    (select count(*)::int from public.admin_denetim_oylari o where o.denetim_id = d.id and o.oy = 'geri_ac'),
    (select o.oy from public.admin_denetim_oylari o where o.denetim_id = d.id and o.oy_kullanan_id = auth.uid())
  from public.admin_denetim d
  left join public.profiles hp on hp.id = d.hedef_admin_id
  left join public.profiles bp on bp.id = d.baslatan_admin_id
  where public.is_admin_or_owner_gorebilir()
  order by d.created_at desc
  limit 100;
$$;

grant execute on function public.denetim_vakalarini_listele() to authenticated;
