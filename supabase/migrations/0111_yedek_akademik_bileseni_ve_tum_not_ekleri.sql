-- ============================================================================
-- 0111_yedek_akademik_bileseni_ve_tum_not_ekleri.sql
-- Gereksinim: 0074, 0075, 0084, 0094, 0099. Tekrar çalıştırmak güvenlidir (create or replace).
--
--  1) YENİ BİLEŞEN "akademik" (Akademik Kütüphane): akademik_kaynaklar + akademik_notlar tabloları (kaynak künyesi, vurgular, notlar) ve PDF dosyaları.
--       • kişisel (kendi) · seçili üyeler (Site Sahibi) · tüm sistem (Site Sahibi) kapsamlarının hepsinde çalışır.
--       • Paket yolu: akademik/veritabani/json/*.json  +  r2/akademik-kutuphane/users/<kullanıcı>/<dosya> (kullanıcı klasörüyle).
--  2) TÜM SİSTEM yedeğinde (R2 bileşeni) HERKESİN şifreli not ekleri de gelir: notlar/ekler/<kullanıcı-id>/<ek-id>.bin
--     (veritabanı bileşeni zaten herkesin notlar/not_kasasi/not_ek_kayitlari tablolarını içeriyordu; eksik olan R2 ekleriydi).
--  Not içeriği ve klasör ağacı uçtan uca şifreli olduğundan paket içinde şifreli kalır; açmak için Yedek Kurtarma Kodu gerekir.
-- ============================================================================

create or replace function public.sistem_export_baslat(
  p_bilesenler jsonb,
  p_kapsam     text default 'kendi',
  p_hassas     boolean default false,
  p_hedefler   uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_eposta text;
  v_owner  boolean := public.is_owner();
  v_tam    boolean := public.sistem_export_yetkisi_var_mi();
  v_ip     text;
  v_bas    json;
  v_hedef  uuid[] := '{}'::uuid[];
  gecerli  text[] := array['veritabani', 'r2', 'icerik_md', 'notlar', 'github', 'akademik'];
begin
  if not public.sistem_export_uye_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: oturum geçersiz ya da hesabın askıda.';
  end if;
  if p_bilesenler is null or jsonb_typeof(p_bilesenler) <> 'array' or jsonb_array_length(p_bilesenler) = 0 then
    raise exception 'En az bir bileşen seçmelisin.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_bilesenler) b where b <> all (gecerli)) then
    raise exception 'Geçersiz bileşen.';
  end if;
  if p_kapsam not in ('kendi', 'secili', 'tum') then
    raise exception 'Geçersiz kapsam.';
  end if;
  if p_kapsam = 'tum' and not v_owner then
    raise exception 'Yetkisiz işlem: tüm sistemi yedekleme yalnızca Site Sahibi içindir.';
  end if;
  if not v_tam and exists (select 1 from jsonb_array_elements_text(p_bilesenler) b where b in ('icerik_md', 'github')) then
    raise exception 'Yetkisiz işlem: site içeriği ve GitHub bileşenleri için sistem dışa aktarma yetkisi gerekir. Kendi verilerini (veritabanı, dosyalar, notlar) indirebilirsin.';
  end if;
  if coalesce(p_hassas, false) and not (v_owner and p_kapsam = 'tum') then
    raise exception 'Yetkisiz işlem: hassas veri seçeneği yalnızca Site Sahibi''nin tam yedeğinde kullanılabilir.';
  end if;

  if p_kapsam = 'secili' then
    if not v_owner then
      raise exception 'Yetkisiz işlem: başka üyelerin verisini yalnızca Site Sahibi seçebilir.';
    end if;
    select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into v_hedef
    from public.profiles p where p.id = any (coalesce(p_hedefler, '{}'::uuid[]));
    if cardinality(v_hedef) = 0 then raise exception 'En az bir geçerli üye seçmelisin.'; end if;
    if cardinality(v_hedef) > 100 then raise exception 'Tek seferde en fazla 100 üye seçilebilir.'; end if;
    if p_bilesenler ? 'notlar' and not (auth.uid() = any (v_hedef)) then
      raise exception 'Kişisel Notlar bileşeni yalnızca kendi verilerini içerir: listeye kendini de ekle ya da bu bileşeni kaldır.';
    end if;
  end if;

  begin
    v_bas := current_setting('request.headers', true)::json;
    v_ip  := nullif(btrim(split_part(coalesce(v_bas ->> 'cf-connecting-ip', v_bas ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  select p.email into v_eposta from public.profiles p where p.id = auth.uid();

  insert into public.sistem_export_loglari
    (user_id, kullanici_eposta, indirilen_bilesenler, kapsam, hassas_dahil, ip_adresi, hedef_kullanicilar)
  values
    (auth.uid(), v_eposta, p_bilesenler, p_kapsam, coalesce(p_hassas, false), left(v_ip, 64), v_hedef)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) from public, anon;
grant execute on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) to authenticated;

create or replace function public.sistem_export_plan(l public.sistem_export_loglari)
returns table (tablo text, hedef text, kapsam text, kosul text)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select coalesce(array(select jsonb_array_elements_text(l.indirilen_bilesenler)), '{}'::text[]) as dizi
  ),
  h as (
    select '= any (' || quote_literal(l.hedef_kullanicilar::text) || '::uuid[])' as ifade
  )
  select x.tablo, x.hedef, x.kapsam,
         case when x.tablo = 'messages' and l.kapsam = 'tum' and not l.hassas_dahil then '(' || x.kosul || ') and sifreli' else x.kosul end
  from (
  select r.tablo,
         case
           when r.tablo in ('akademik_kaynaklar', 'akademik_notlar') and 'akademik' = any (b.dizi)
                and not ('veritabani' = any (b.dizi)) and not ('notlar' = any (b.dizi)) then 'akademik'
           when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar'
           else 'veritabani'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'tum'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'tum'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri' then 'secili'
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'secili'
           else 'kendi'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'true'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'true'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           else r.kendi_kosul
         end
  from public.sistem_export_tablo_kayitlari() r, b, h
  where to_regclass('public.' || r.tablo) is not null
    and (
      ('veritabani' = any (b.dizi) and (
          (r.grup = 'veri' and not r.sadece_owner)
          or r.grup = 'notlar'
          or (r.sadece_owner and l.kapsam = 'tum' and (not r.hassas or l.hassas_dahil))
      ))
      or ('notlar' = any (b.dizi) and r.grup = 'notlar')
      or ('akademik' = any (b.dizi) and r.tablo in ('akademik_kaynaklar', 'akademik_notlar'))
    )
    and not (r.sadece_owner and l.kapsam <> 'tum')
  ) x(tablo, hedef, kapsam, kosul);
$$;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;

create or replace function public.sistem_export_r2_listesi(p_id uuid)
returns table (kaynak text, anahtar text, ad text, boyut bigint, sifreli boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l        public.sistem_export_loglari;
  tum      boolean;
  hedefler uuid[];
begin
  l := public.sistem_export_oturum_al(p_id);
  tum := (l.kapsam = 'tum');
  hedefler := case when l.kapsam = 'secili' then l.hedef_kullanicilar else array[auth.uid()] end;

  if l.indirilen_bilesenler ? 'r2' or l.indirilen_bilesenler ? 'akademik' then
    return query
    select 'akademik'::text, k.pdf_r2_yolu,
           coalesce(nullif(k.pdf_dosya_adi, ''), k.id::text) || case when coalesce(k.pdf_dosya_adi, '') ~* '\.pdf$' then '' else '.pdf' end,
           coalesce(k.pdf_boyut_bayt, 0)::bigint, false
    from public.akademik_kaynaklar k
    where k.pdf_r2_yolu is not null and (tum or k.user_id = any (hedefler));

  end if;

  if l.indirilen_bilesenler ? 'r2' then
    return query
    select 'arsiv'::text, a.r2_key,
           a.klasor_yolu || a.ad,
           coalesce(a.boyut, 0)::bigint, a.sifreli
    from public.r2_arsiv a
    where a.tur = 'dosya' and a.durum = 'hazir' and a.r2_key is not null
      and (tum or a.sahip_id = any (hedefler));
  end if;

  -- Kişisel Notlar bileşeni: yalnızca çağıranın kendi (uçtan uca ŞİFRELİ) not ekleri.
  if l.indirilen_bilesenler ? 'notlar' then
    return query
    select 'notek'::text, e.r2_key, e.id::text || '.bin', e.boyut_bayt::bigint, true
    from public.not_ek_kayitlari e
    where e.user_id = auth.uid();
  end if;

  -- TÜM SİSTEM (yalnızca Site Sahibi) + R2 bileşeni: HERKESİN şifreli not ekleri de pakete girer; paket yolu kullanıcı klasörüyle ayrılır
  -- (notlar/ekler/<kullanıcı-id>/<ek-id>.bin). İçerik zaten uçtan uca şifrelidir: Site Sahibi bile okuyamaz, yalnızca felaket kurtarma içindir.
  if tum and l.indirilen_bilesenler ? 'r2' and not (l.indirilen_bilesenler ? 'notlar') then
    return query
    select 'notek'::text, e.r2_key, e.user_id::text || '/' || e.id::text || '.bin', e.boyut_bayt::bigint, true
    from public.not_ek_kayitlari e;
  end if;
end;
$$;
revoke all on function public.sistem_export_r2_listesi(uuid) from public, anon;
grant execute on function public.sistem_export_r2_listesi(uuid) to authenticated;
