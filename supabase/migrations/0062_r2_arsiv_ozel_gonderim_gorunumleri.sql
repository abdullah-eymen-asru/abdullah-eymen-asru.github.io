-- ============================================================================
-- 0062_r2_arsiv_ozel_gonderim_gorunumleri.sql
--
-- 0057 + 0058 ÜSTÜNE eklenir. Hepsi "create or replace": tekrar çalıştırmak zararsız.
--
-- AMAÇ: "Arşiv" (herkese açık ekip arşivi) ile "özel gönderim" (şifreli, kişiye özel)
-- birbirinden KESİN olarak ayrılır; böylece "şifrele işaretlenirse biri görür, işaretlenmezse
-- görmez" karışıklığı biter.
--   * Arşiv      : yalnızca ŞİFRESİZ dosyalar + klasörler. Arşiv erişimi olan herkes görür.
--   * Özel       : yalnızca ŞİFRELİ dosyalar. Klasörsüz; sunucuda daima '.ozel/<gönderen-id>/'
--                  altında tutulur (istemcinin gönderdiği klasör yolu YOK SAYILIR).
-- Ayrıca "Benimle paylaşılanlar" ve "Paylaştıklarım" için tek çağrıda gönderen / alıcı /
-- paylaşım zamanı bilgisini veren iki RPC eklenir.
--
-- NOT: 0057'den önce yüklenmiş şifreli dosyalar (normal klasörlerde duranlar) silinmez;
-- Arşiv listesinden çıkar, "Paylaştıklarım" / "Benimle paylaşılanlar" altında görünür.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Yükleme başlatma: şifreli = '.ozel/<uid>/'; şifresiz '.ozel/' kullanamaz
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_yukleme_baslat(
  p_sahip uuid, p_ad text, p_klasor_yolu text, p_boyut bigint,
  p_mime text, p_gercek_mime text, p_sifreli boolean, p_r2_key text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_ust_ad text; v_ust_yol text;
begin
  if p_sifreli then
    -- Özel gönderim: klasör YOK; kişiye özel alan. Klasör varlığı denetlenmez (satırı yok).
    p_klasor_yolu := '.ozel/' || p_sahip::text || '/';
  else
    p_klasor_yolu := coalesce(p_klasor_yolu, '');
    if left(p_klasor_yolu, 6) = '.ozel/' then
      raise exception 'Bu klasör adı ayrılmıştır.';
    end if;
    if p_klasor_yolu <> '' then
      v_ust_ad  := (regexp_match(p_klasor_yolu, '([^/]+)/$'))[1];
      v_ust_yol := left(p_klasor_yolu, length(p_klasor_yolu) - length(v_ust_ad) - 1);
      if not exists (select 1 from public.r2_arsiv
                     where tur = 'klasor' and klasor_yolu = v_ust_yol and ad = v_ust_ad) then
        raise exception 'Hedef klasör bulunamadı.';
      end if;
    end if;
  end if;

  -- Yarım kalmış (1 saatten eski) aynı adlı yükleme kaydı adı sonsuza dek kilitlemesin.
  delete from public.r2_arsiv
   where durum = 'bekliyor' and created_at < now() - interval '1 hour'
     and klasor_yolu = p_klasor_yolu and lower(ad) = lower(btrim(p_ad));
  insert into public.r2_arsiv (tur, ad, klasor_yolu, r2_key, boyut, mime, gercek_mime, sifreli, durum, sahip_id)
  values ('dosya', btrim(p_ad), p_klasor_yolu, p_r2_key, p_boyut, p_mime, p_gercek_mime, p_sifreli, 'bekliyor', p_sahip)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_yukleme_baslat(uuid,text,text,bigint,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.r2_arsiv_yukleme_baslat(uuid,text,text,bigint,text,text,boolean,text) to service_role;

-- ----------------------------------------------------------------------------
-- 2) '.ozel' adı klasör olarak kullanılamaz (oluşturma + yeniden adlandırma)
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_klasor_olustur(p_klasor_yolu text, p_ad text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_ust_ad text; v_ust_yol text;
begin
  if not public.r2_arsiv_yetkim('yukle') then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if lower(btrim(p_ad)) = '.ozel' then
    raise exception 'Bu klasör adı ayrılmıştır.';
  end if;
  p_klasor_yolu := coalesce(p_klasor_yolu, '');
  if p_klasor_yolu <> '' then
    v_ust_ad  := (regexp_match(p_klasor_yolu, '([^/]+)/$'))[1];
    v_ust_yol := left(p_klasor_yolu, length(p_klasor_yolu) - length(v_ust_ad) - 1);
    if not exists (select 1 from public.r2_arsiv
                   where tur = 'klasor' and klasor_yolu = v_ust_yol and ad = v_ust_ad) then
      raise exception 'Üst klasör bulunamadı.';
    end if;
  end if;
  insert into public.r2_arsiv (tur, ad, klasor_yolu, sahip_id)
  values ('klasor', btrim(p_ad), p_klasor_yolu, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_klasor_olustur(text, text) from public, anon;
grant execute on function public.r2_arsiv_klasor_olustur(text, text) to authenticated;

create or replace function public.r2_arsiv_yeniden_adlandir(p_id uuid, p_yeni_ad text)
returns void language plpgsql security definer set search_path = public
as $$
declare v record; v_eski text; v_yeni text;
begin
  if not public.r2_arsiv_yetkim('yukle') then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  select * into v from public.r2_arsiv where id = p_id for update;
  if not found then raise exception 'Öğe bulunamadı.'; end if;
  if v.sifreli and v.sahip_id is distinct from auth.uid() and not exists
     (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Şifreli dosyayı yalnızca gönderen yeniden adlandırabilir.' using errcode = '42501';
  end if;
  if v.tur = 'klasor' and lower(btrim(p_yeni_ad)) = '.ozel' then
    raise exception 'Bu klasör adı ayrılmıştır.';
  end if;

  p_yeni_ad := btrim(p_yeni_ad);
  update public.r2_arsiv set ad = p_yeni_ad where id = p_id;

  if v.tur = 'klasor' then
    v_eski := v.tam_yol;
    v_yeni := v.klasor_yolu || p_yeni_ad || '/';
    update public.r2_arsiv
       set klasor_yolu = v_yeni || substr(klasor_yolu, length(v_eski) + 1)
     where starts_with(klasor_yolu, v_eski);
  end if;
exception when unique_violation then
  raise exception 'Bu klasörde aynı ada sahip bir öğe zaten var.';
end;
$$;
revoke all on function public.r2_arsiv_yeniden_adlandir(uuid, text) from public, anon;
grant execute on function public.r2_arsiv_yeniden_adlandir(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Arşiv araması ve özeti yalnızca ŞİFRESİZ içeriği kapsar
-- ----------------------------------------------------------------------------
create or replace function public.r2_arsiv_ara(p_q text, p_sinir int default 100)
returns setof public.r2_arsiv
language sql stable security invoker set search_path = public
as $$
  select a.*
    from public.r2_arsiv a
   where a.durum = 'hazir'
     and not a.sifreli
     and char_length(btrim(coalesce(p_q, ''))) >= 1
     and not exists (
           select 1
             from unnest(string_to_array(public.tr_ara_normalize(btrim(p_q)), ' ')) as t(tok)
            where t.tok <> ''
              and public.tr_ara_normalize(a.ad)
                  not like '%' || public.like_kacis(t.tok) || '%')
   order by a.tur desc, a.ad
   limit least(greatest(coalesce(p_sinir, 100), 1), 200);
$$;
revoke all on function public.r2_arsiv_ara(text, int) from public, anon;
grant execute on function public.r2_arsiv_ara(text, int) to authenticated;

create or replace function public.r2_arsiv_ozet()
returns table (dosya_sayisi bigint, klasor_sayisi bigint, toplam_boyut bigint)
language sql stable security invoker set search_path = public
as $$
  select count(*) filter (where a.tur = 'dosya'),
         count(*) filter (where a.tur = 'klasor'),
         coalesce(sum(a.boyut) filter (where a.tur = 'dosya'), 0)::bigint
    from public.r2_arsiv a
   where a.durum = 'hazir' and not a.sifreli;
$$;
revoke all on function public.r2_arsiv_ozet() from public, anon;
grant execute on function public.r2_arsiv_ozet() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) "Benimle paylaşılanlar": kim, hangi dosyayı, NE ZAMAN gönderdi (tek çağrı)
-- ----------------------------------------------------------------------------
create or replace function public.arsiv_benimle_paylasilanlar()
returns table (id uuid, ad text, boyut bigint, gercek_mime text,
               dosya_tarihi timestamptz, paylasildi_at timestamptz,
               gonderen_id uuid, gonderen_ad text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select a.id, a.ad, a.boyut, a.gercek_mime, a.created_at, k.created_at, a.sahip_id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı')
      from public.ozel_icerik_anahtarlar k
      join public.r2_arsiv a on a.id = k.dosya_id
      left join public.profiles p on p.id = a.sahip_id
     where k.alici_id = auth.uid()
       and a.sifreli and a.durum = 'hazir'
       and a.sahip_id is distinct from auth.uid()
     order by k.created_at desc
     limit 500;
end;
$$;
revoke all on function public.arsiv_benimle_paylasilanlar() from public, anon;
grant execute on function public.arsiv_benimle_paylasilanlar() to authenticated;

-- ----------------------------------------------------------------------------
-- 5) "Paylaştıklarım": her dosya için alıcılar + kişi başına paylaşım zamanı (tek çağrı)
-- ----------------------------------------------------------------------------
create or replace function public.arsiv_paylastiklarim()
returns table (id uuid, ad text, boyut bigint, gercek_mime text,
               dosya_tarihi timestamptz, alicilar jsonb)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
    select a.id, a.ad, a.boyut, a.gercek_mime, a.created_at,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'id', k.alici_id,
                        'ad', coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı'),
                        'paylasildi_at', k.created_at)
                      order by k.created_at)
               from public.ozel_icerik_anahtarlar k
               join public.profiles p on p.id = k.alici_id
              where k.dosya_id = a.id and k.alici_id <> auth.uid()
           ), '[]'::jsonb)
      from public.r2_arsiv a
     where a.sahip_id = auth.uid() and a.sifreli and a.durum = 'hazir'
     order by a.created_at desc
     limit 500;
end;
$$;
revoke all on function public.arsiv_paylastiklarim() from public, anon;
grant execute on function public.arsiv_paylastiklarim() to authenticated;
