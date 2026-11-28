-- ============================================================================
-- 0158 — Worker (service_role) R2 uçları: gizli üyenin dosyaları doğrudan URL/token ile de 404 döner
-- ----------------------------------------------------------------------------
-- SORUN: Worker'lar service_role ile RPC çağırır; service_role RLS'i atlar ve auth.uid() boştur. Bu yüzden 0156'daki
--   tablo politikaları Worker yolunda işlemez → gizli üyenin dosyası, bilinen bir indirme/önizleme/paylaşım bağlantısıyla
--   hâlâ indirilebilirdi.
-- ÇÖZÜM: Worker'ın çağırdığı RPC'ler dosya sahibini kontrol eder. Sahibi gizliyse "yok" / boş sonuç döner;
--   Worker bunu 404 olarak yanıtlar (dosyanın var olduğu bile sızmaz).
-- KURAL (gizli_dosya_sahibi_mi): sahip gizli üyeyse VE izleyen sahibin kendisi değilse VE izleyen
--   "körlüğü kapalı Site Sahibi" değilse → gizli. İzleyen yoksa (herkese açık bağlantı) → gizli.
-- Geçici körlük açıksa Site Sahibi de göremez; gizleme kalkınca her şey anında geri gelir (tablo okunur, kalıcı işaret yok).
-- Gereksinim: 0136, 0156. Geçici tablo YOK; her adım tekrar çalıştırılabilir.
-- ============================================================================
create or replace function public.gizli_dosya_sahibi_mi(p_sahip uuid, p_izleyen uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select p_sahip is not null
     and p_sahip is distinct from p_izleyen
     and exists (select 1 from public.gizli_uyeler g where g.user_id = p_sahip)
     and not (
       p_izleyen is not null
       and exists (select 1 from public.profiles p where p.id = p_izleyen and p.role = 'owner')
       and not coalesce((select o.blind_mode from public.owner_ayarlari o where o.id), false)
     );
$$;
revoke all on function public.gizli_dosya_sahibi_mi(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gizli_dosya_sahibi_mi(uuid, uuid) to service_role;

-- 1) Arşiv dosyası indirme/önizleme anahtarı (kimlikli): gizli sahibin dosyası → satır yok → Worker 404
create or replace function public.r2_arsiv_indirme_anahtari(p_uid uuid, p_id uuid)
returns table (r2_key text, ad text, mime text, sifreli boolean)
language sql stable security definer set search_path = public
as $$
  select a.r2_key, a.ad, a.mime, a.sifreli
  from public.r2_arsiv a
  where a.id = p_id and a.tur = 'dosya' and a.durum = 'hazir'
    and not public.gizli_dosya_sahibi_mi(a.sahip_id, p_uid)
    and ( (not a.sifreli and public.r2_arsiv_yetkisi(p_uid, 'oku'))
          or a.sahip_id = p_uid
          or exists (select 1 from public.ozel_icerik_anahtarlar k
                     where k.dosya_id = a.id and k.alici_id = p_uid) );
$$;
revoke all on function public.r2_arsiv_indirme_anahtari(uuid, uuid) from public, anon, authenticated;
grant execute on function public.r2_arsiv_indirme_anahtari(uuid, uuid) to service_role;

-- 2) Özel içerik dosyası
create or replace function public.ozel_icerik_dosya_coz(p_uid uuid, p_content_id uuid, p_arsiv_id uuid)
returns table (r2_key text, ad text, mime text)
language plpgsql stable security definer set search_path = public as $$
declare v_rol text;
begin
  select p.role into v_rol from public.profiles p where p.id = p_uid and coalesce(p.is_suspended, false) = false;
  if v_rol is null then return; end if;
  if not (v_rol in ('owner', 'admin', 'manager')
          or exists (select 1 from public.special_content c join public.content_access ca on ca.content_id = c.id
                      where c.id = p_content_id and c.is_published and ca.user_id = p_uid
                        and (ca.son_gecerlilik_tarihi is null or ca.son_gecerlilik_tarihi > now()))) then
    return;
  end if;
  return query select a.r2_key, a.ad, a.mime from public.ozel_icerik_dosyalari d join public.r2_arsiv a on a.id = d.arsiv_id
    where d.content_id = p_content_id and d.arsiv_id = p_arsiv_id and a.durum = 'hazir' and not a.sifreli and a.tur = 'dosya'
      and not public.gizli_dosya_sahibi_mi(a.sahip_id, p_uid);
end $$;
revoke all on function public.ozel_icerik_dosya_coz(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ozel_icerik_dosya_coz(uuid, uuid, uuid) to service_role;

-- 3) Paylaşım bağlantısı çözme (anonim): bağlantıyı açan VEYA dosya sahibi gizliyse 'yok' (sayaç da artmaz)
create or replace function public.r2_baglanti_coz(p_slug text)
returns table (durum text, r2_key text, ad text, mime text) language plpgsql security definer set search_path = public as $$
declare b public.r2_baglantilari; d public.r2_arsiv;
begin
  select * into b from public.r2_baglantilari where slug = lower(coalesce(p_slug, ''));
  if b.id is null or public.gizli_dosya_sahibi_mi(b.user_id, null) then
    return query select 'yok'::text, null::text, null::text, null::text; return;
  end if;
  if b.iptal then return query select 'iptal'::text, null::text, b.ad, null::text; return; end if;
  if b.bitis is not null and b.bitis <= now() then return query select 'doldu'::text, null::text, b.ad, null::text; return; end if;
  select * into d from public.r2_arsiv a where a.id = b.dosya_id and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli;
  if d.id is null then return query select 'dosya_yok'::text, null::text, b.ad, null::text; return; end if;
  if public.gizli_dosya_sahibi_mi(d.sahip_id, null) then
    return query select 'yok'::text, null::text, null::text, null::text; return;
  end if;
  update public.r2_baglantilari set indirme_sayisi = indirme_sayisi + 1, son_indirme = now() where id = b.id;
  return query select 'gecerli'::text, d.r2_key, d.ad, d.mime;
end $$;
revoke all on function public.r2_baglanti_coz(text) from public, anon, authenticated;
grant execute on function public.r2_baglanti_coz(text) to service_role;

-- 4) Bağlantı bilgi sayfası (anonim): gizli sahip → 'yok'
create or replace function public.r2_baglanti_bilgi(p_slug text)
returns table (durum text, ad text, aciklama text, dosya_ad text, boyut bigint, mime text, bitis timestamptz, olusturma timestamptz,
               indirme_sayisi bigint, sahip_ad text)
language plpgsql stable security definer set search_path = public as $$
declare b public.r2_baglantilari; d public.r2_arsiv; v_durum text; v_sahip text;
begin
  select * into b from public.r2_baglantilari x where x.slug = lower(coalesce(p_slug, ''));
  if b.id is null or public.gizli_dosya_sahibi_mi(b.user_id, null) then
    return query select 'yok'::text, null::text, null::text, null::text, null::bigint, null::text, null::timestamptz, null::timestamptz, null::bigint, null::text; return;
  end if;
  select * into d from public.r2_arsiv a where a.id = b.dosya_id and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli;
  if d.id is not null and public.gizli_dosya_sahibi_mi(d.sahip_id, null) then
    return query select 'yok'::text, null::text, null::text, null::text, null::bigint, null::text, null::timestamptz, null::timestamptz, null::bigint, null::text; return;
  end if;
  v_durum := case when b.iptal then 'iptal' when b.bitis is not null and b.bitis <= now() then 'doldu' when d.id is null then 'dosya_yok' else 'gecerli' end;
  select nullif(btrim(p.full_name), '') into v_sahip from public.profiles p where p.id = b.user_id;
  if v_durum = 'gecerli' then
    return query select v_durum, b.ad, b.aciklama, b.dosya_ad, d.boyut, d.mime, b.bitis, b.created_at, b.indirme_sayisi, v_sahip;
  else
    return query select v_durum, b.ad, null::text, null::text, null::bigint, null::text, b.bitis, b.created_at, null::bigint, null::text;
  end if;
end $$;
revoke all on function public.r2_baglanti_bilgi(text) from public, anon, authenticated;
grant execute on function public.r2_baglanti_bilgi(text) to service_role;

-- 5) Yazı medyası (herkese açık /m/<yazı>/<ad>): gizli sahibin dosyası → satır yok
create or replace function public.r2_medya_coz(p_yazi text, p_ad text)
returns table (r2_key text, ad text, mime text, boyut bigint, yuklenme timestamptz)
language sql stable security definer set search_path = public as $$
  select a.r2_key, m.dosya_ad, a.mime, a.boyut::bigint, m.created_at from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id
  where m.yazi_anahtar = lower(coalesce(p_yazi, '')) and m.dosya_ad = p_ad and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli
    and not public.gizli_dosya_sahibi_mi(a.sahip_id, null)
    and not public.gizli_dosya_sahibi_mi(m.olusturan, null)
  limit 1;
$$;
revoke all on function public.r2_medya_coz(text, text) from public, anon, authenticated;
grant execute on function public.r2_medya_coz(text, text) to service_role;

-- 6) Akademik paylaşım PDF yolu (anon/authenticated çağırır; auth.uid() dolu): gizli üyenin kaynağı → satır yok
create or replace function public.akademik_paylasim_pdf_yolu(p_token text, p_kaynak_id uuid)
returns table (pdf_r2_yolu text, pdf_dosya_adi text, user_id uuid, pdf_rev integer)
language plpgsql stable security definer set search_path = public as $$
declare p public.akademik_paylasimlari;
begin
  p := public.akademik_paylasim_gecerli(p_token);
  if p.id is null or not p.pdf_okuma then return; end if;
  return query select k.pdf_r2_yolu, k.pdf_dosya_adi, k.user_id, k.pdf_rev from public.akademik_kaynaklar k
   where k.id = p_kaynak_id and k.pdf_r2_yolu is not null and k.id in (select kaynak_id from public.akademik_paylasim_kaynaklari(p))
     and not public.gizli_dosya_sahibi_mi(k.user_id, auth.uid())
     and not public.gizli_satir_mi(k.user_id);
end $$;
revoke all on function public.akademik_paylasim_pdf_yolu(text, uuid) from public;
grant execute on function public.akademik_paylasim_pdf_yolu(text, uuid) to anon, authenticated;
