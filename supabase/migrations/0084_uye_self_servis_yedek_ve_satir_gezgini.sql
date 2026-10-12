-- ============================================================================
-- 0084_uye_self_servis_yedek_ve_satir_gezgini.sql
-- Gereksinim: 0074, 0075, 0081 çalıştırılmış olmalı (0083 demo rolü varsa onunla uyumludur). Tekrar çalıştırmak güvenlidir.
--
--  A) HER ÜYE kendi verisini yedekleyebilir (KVKK veri taşınabilirliği): yeni sistem_export_uye_yetkisi_var_mi() (askıda olmayan
--     her oturum). sistem_export_yetkisi_var_mi() (izinli rol) DEĞİŞMEZ; yalnızca github/icerik_md bileşenleri ve depolama durumu için
--     aranmaya devam eder. İzinsiz üye: kapsam yalnızca 'kendi', bileşen yalnızca veritabani | r2 | notlar.
--     Tüm sistem / seçili üyeler / hassas veri hâlâ yalnızca Site Sahibi.
--  B) HER ÜYE kendi yedeğini geri yükleyebilir — hesabı silinip YENİDEN açılmış olsa bile (kimlik değişir):
--     uye_geri_yukle_tablo(): beyaz listeli tablolar; kullanıcı kolonu DAİMA auth.uid() olarak ZORLANIR (başkası adına
--     satır yazılamaz); R2 anahtarındaki eski üye kimliği yenisiyle değiştirilir; üzerine yazma yalnızca KENDİ satırı için.
--     uye_r2_yukleme_izinli_mi(): Worker, R2'ye yalnızca üyenin KENDİ (az önce geri yüklenen) kaydının işaret ettiği
--     anahtara yazma izni verir.
--  C) Satır gezgini (owner): sistem_tablo_satirlari() içeriği gösterir (gizli kolonlar maskelenir),
--     sistem_satir_sil() seçili satırları siler (korumalı tablo / zincirleme korumalı → HATA).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Üye self-servis dışa aktarma
--    sistem_export_yetkisi_var_mi() (0074) DEĞİŞMEZ: "izinli rol" mantığı olarak kalır (depolama durumu, github/icerik_md bileşenleri).
--    YENİ sistem_export_uye_yetkisi_var_mi(): askıya alınmamış her oturum → yalnızca KENDİ verisi için dışa aktarma/geri yükleme.
-- ----------------------------------------------------------------------------
create or replace function public.sistem_export_uye_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  -- 'demo' rolü (0083) HİÇBİR koşulda: bu fonksiyon SECURITY DEFINER RPC'lerin kapısıdır ve onlar RLS'i aşar.
  select coalesce((select p.role <> 'demo' and (p.role = 'owner' or not coalesce(p.is_suspended, false))
                   from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.sistem_export_uye_yetkisi_var_mi() from public, anon;
grant execute on function public.sistem_export_uye_yetkisi_var_mi() to authenticated;

-- 0075'teki 4 parametreli sürümün aynısı; tek fark: izinli rolü olmayan üye yalnızca kapsam 'kendi' ve bileşen veritabani|r2|notlar seçebilir.
-- (3 parametreli eski sürüm 0075'te zaten düşürülmüştü; burada TEKRAR oluşturulmaz → PGRST203 belirsizliği oluşmaz.)
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
  gecerli  text[] := array['veritabani', 'r2', 'icerik_md', 'notlar', 'github'];
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

-- Oturum doğrulaması (0074'teki ile aynı; tek fark kapı: üye yetkisi). Bileşen kısıtı oturum AÇILIRKEN zorlandığı için burada tekrar gerekmez.
create or replace function public.sistem_export_oturum_al(p_id uuid)
returns public.sistem_export_loglari
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.sistem_export_loglari;
begin
  if not public.sistem_export_uye_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: oturum geçersiz ya da hesabın askıda.';
  end if;
  select * into l
  from public.sistem_export_loglari
  where id = p_id and user_id = auth.uid() and durum = 'basladi' and olusturma_tarihi > now() - interval '6 hours';
  if not found then
    raise exception 'Geçerli bir dışa aktarma oturumu yok (süresi dolmuş olabilir). İşlemi yeniden başlat.';
  end if;
  if l.kapsam in ('tum', 'secili') and not public.is_owner() then
    raise exception 'Yetkisiz işlem.';
  end if;
  return l;
end;
$$;
revoke all on function public.sistem_export_oturum_al(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B) Üye self-servis geri yükleme
-- ----------------------------------------------------------------------------
-- tablo -> (kullanıcı kolonu, R2 anahtar kolonu, anahtar öneki regex)
create or replace function public._uye_geri_yukleme_tablolari()
returns table (tablo text, kullanici_kolonu text, anahtar_kolonu text, anahtar_deseni text)
language sql immutable as $$
  select * from (values
    ('notlar',             'user_id',  null::text,    null::text),
    ('not_kasasi',         'user_id',  null,          null),
    ('not_ek_kayitlari',   'user_id',  'r2_key',      '^notlar/[0-9a-f-]{36}/'),
    ('akademik_kaynaklar', 'user_id',  'pdf_r2_yolu', '^akademik-kutuphane/users/[0-9a-f-]{36}/'),
    ('akademik_notlar',    'user_id',  null,          null),
    ('r2_arsiv',           'sahip_id', null,          null)
  ) t(tablo, kullanici_kolonu, anahtar_kolonu, anahtar_deseni);
$$;
revoke all on function public._uye_geri_yukleme_tablolari() from public, anon, authenticated;

create or replace function public.uye_geri_yukleme_tablolari()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sistem_export_uye_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tablo', t.tablo,
      'kolonlar', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
                   from pg_attribute a where a.attrelid = to_regclass('public.' || t.tablo) and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''),
      'pk', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
             from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
             where i.indrelid = to_regclass('public.' || t.tablo) and i.indisprimary),
      'korumali', false
    ))
    from public._uye_geri_yukleme_tablolari() t where to_regclass('public.' || t.tablo) is not null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.uye_geri_yukleme_tablolari() from public, anon;
grant execute on function public.uye_geri_yukleme_tablolari() to authenticated;

create or replace function public.uye_geri_yukle_tablo(p_tablo text, p_satirlar jsonb, p_mod text default 'eksikleri')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c          record;
  v_uid      uuid := auth.uid();
  v_oid      regclass;
  v_mod      text := coalesce(p_mod, 'eksikleri');
  v_kolon    text;
  v_pk       text;
  v_guncelle text;
  v_sql      text;
  v_satir    jsonb;
  v_yeni     boolean;
  v_ekle     bigint := 0; v_guncel bigint := 0; v_atla bigint := 0; v_hata bigint := 0;
  v_hatalar  jsonb := '[]'::jsonb;
begin
  if v_uid is null or not public.sistem_export_uye_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  if v_mod not in ('eksikleri', 'uzerine') then raise exception 'Geçersiz mod.'; end if;
  if p_satirlar is null or jsonb_typeof(p_satirlar) <> 'array' then raise exception 'Satırlar bir JSON dizisi olmalı.'; end if;
  if jsonb_array_length(p_satirlar) > 500 then raise exception 'Sayfa başına en çok 500 satır.'; end if;

  select * into c from public._uye_geri_yukleme_tablolari() t where t.tablo = p_tablo;
  if not found then raise exception 'Bu tablo üye geri yüklemesinde desteklenmiyor: %.', p_tablo; end if;
  v_oid := to_regclass('public.' || c.tablo);
  if v_oid is null then raise exception 'Tablo yok.'; end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_kolon
    from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;
  select string_agg(format('%1$s = excluded.%1$s', quote_ident(a.attname)), ', ' order by a.attnum) into v_guncelle
    from pg_attribute a
   where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.attname <> c.kullanici_kolonu
     and not exists (select 1 from pg_index i where i.indrelid = v_oid and i.indisprimary and a.attnum = any (i.indkey));

  if v_mod = 'uzerine' and v_pk is not null and v_guncelle is not null then
    -- Üzerine yazma YALNIZCA mevcut satır zaten bu üyeye aitse (başkasının satırı ezilemez)
    v_sql := format('insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) '
                    'on conflict (%3$s) do update set %4$s where t.%5$I = $2 returning (xmax = 0)',
                    c.tablo, v_kolon, v_pk, v_guncelle, c.kullanici_kolonu);
  else
    v_sql := format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing returning (xmax = 0)',
                    c.tablo, v_kolon);
  end if;

  for v_satir in select e from jsonb_array_elements(p_satirlar) e loop
    begin
      -- Kimlik ZORLAMASI: dosyada ne yazarsa yazsın satır bu oturumun sahibine yazılır.
      v_satir := jsonb_set(v_satir, array[c.kullanici_kolonu], to_jsonb(v_uid::text));
      -- Eski üye kimliğini taşıyan R2 anahtarını yeni kimliğe çevir
      if c.anahtar_kolonu is not null and (v_satir ->> c.anahtar_kolonu) is not null then
        v_satir := jsonb_set(v_satir, array[c.anahtar_kolonu],
                     to_jsonb(regexp_replace(v_satir ->> c.anahtar_kolonu, c.anahtar_deseni,
                       case c.tablo when 'not_ek_kayitlari' then 'notlar/' || v_uid::text || '/'
                                    else 'akademik-kutuphane/users/' || v_uid::text || '/' end)));
      end if;
      v_yeni := null;
      if v_mod = 'uzerine' and v_pk is not null and v_guncelle is not null then
        execute v_sql into v_yeni using v_satir, v_uid;
      else
        execute v_sql into v_yeni using v_satir;
      end if;
      if v_yeni is null then v_atla := v_atla + 1;
      elsif v_yeni then v_ekle := v_ekle + 1;
      else v_guncel := v_guncel + 1;
      end if;
    exception when others then
      v_hata := v_hata + 1;
      if jsonb_array_length(v_hatalar) < 5 then v_hatalar := v_hatalar || to_jsonb(left(sqlerrm, 300)); end if;
    end;
  end loop;

  return jsonb_build_object('tablo', c.tablo, 'eklenen', v_ekle, 'guncellenen', v_guncel, 'atlanan', v_atla,
                            'hatali', v_hata, 'hatalar', v_hatalar, 'mod', v_mod);
end;
$$;
revoke all on function public.uye_geri_yukle_tablo(text, jsonb, text) from public, anon;
grant execute on function public.uye_geri_yukle_tablo(text, jsonb, text) to authenticated;

-- Worker (PUT /uye/yukle) için: üye bu R2 anahtarına yazabilir mi? Yalnızca KENDİ kaydı bu anahtarı işaret ediyorsa.
create or replace function public.uye_r2_yukleme_izinli_mi(p_kaynak text, p_anahtar text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.sistem_export_uye_yetkisi_var_mi() then return false; end if;
  if p_kaynak = 'arsiv' then
    return exists (select 1 from public.r2_arsiv r where r.sahip_id = auth.uid() and r.tur = 'dosya' and r.r2_key = p_anahtar);
  elsif p_kaynak = 'notek' then
    return exists (select 1 from public.not_ek_kayitlari n where n.user_id = auth.uid() and n.r2_key = p_anahtar);
  elsif p_kaynak = 'akademik' then
    return exists (select 1 from public.akademik_kaynaklar a where a.user_id = auth.uid() and a.pdf_r2_yolu = p_anahtar);
  end if;
  return false;
end;
$$;
revoke all on function public.uye_r2_yukleme_izinli_mi(text, text) from public, anon;
grant execute on function public.uye_r2_yukleme_izinli_mi(text, text) to authenticated;

-- Tekil dosya → KENDİ kayıtlarıyla (ad + boyut) eşleştirme
create or replace function public.uye_r2_dosya_esle(p_dosyalar jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; d jsonb; e jsonb;
begin
  if auth.uid() is null or not public.sistem_export_uye_yetkisi_var_mi() then raise exception 'Yetkisiz işlem.'; end if;
  if jsonb_typeof(p_dosyalar) <> 'array' or jsonb_array_length(p_dosyalar) > 200 then raise exception 'En çok 200 dosya.'; end if;
  for d in select x from jsonb_array_elements(p_dosyalar) x loop
    select coalesce(jsonb_agg(u.m), '[]'::jsonb) into e from (
      select jsonb_build_object('kaynak', 'akademik', 'anahtar', a.pdf_r2_yolu, 'sahip', a.user_id, 'etiket', a.baslik) as m
        from public.akademik_kaynaklar a
       where a.user_id = auth.uid() and a.pdf_r2_yolu is not null and a.pdf_dosya_adi = (d ->> 'ad') and a.pdf_boyut_bayt = (d ->> 'boyut')::bigint
      union all
      select jsonb_build_object('kaynak', 'arsiv', 'anahtar', r.r2_key, 'sahip', r.sahip_id, 'etiket', r.klasor_yolu || r.ad)
        from public.r2_arsiv r
       where r.sahip_id = auth.uid() and r.tur = 'dosya' and r.r2_key is not null
         and (r.ad = (d ->> 'ad') and r.boyut = (d ->> 'boyut')::bigint or r.r2_key = 'arsiv/' || regexp_replace(d ->> 'ad', '\.sifreli$', ''))
    ) u;
    v := v || jsonb_build_object('ad', d ->> 'ad', 'adaylar', e);
  end loop;
  return v;
end;
$$;
revoke all on function public.uye_r2_dosya_esle(jsonb) from public, anon;
grant execute on function public.uye_r2_dosya_esle(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- C) Satır gezgini (owner)
-- ----------------------------------------------------------------------------
create or replace function public.sistem_tablo_satirlari(p_tablo text, p_ofset integer default 0, p_adet integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_oid  regclass;
  v_pk   text[];
  v_kol  text[];
  v_sel  text;
  v_sat  jsonb;
  v_top  bigint;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_tablo is null or p_tablo !~ '^[a-z_][a-z0-9_]*$' then raise exception 'Geçersiz tablo adı.'; end if;
  v_oid := to_regclass(format('public.%I', p_tablo));
  if v_oid is null then raise exception 'Tablo bulunamadı.'; end if;

  select coalesce(array_agg(a.attname::text order by a.attnum), '{}') into v_kol
    from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped;
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}') into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;

  -- Her kolon: gizli kolonlar maskelenir, uzun metin 160 karaktere kısaltılır (şifreli/ikili veri sızmaz)
  select string_agg(format(
           case when k ~* '(sifre|password|secret|token|hash|anahtar|wrapped|encrypted|salt|nonce|ciphertext|cipher|webhook|private_key|(^|_)iv($|_))'
                then '%2$L, case when t.%1$I is null then null else ''•••• gizli'' end'
                else '%2$L, left(t.%1$I::text, 160)' end, k, k), ', ')
    into v_sel from unnest(v_kol) k;

  execute format('select count(*) from public.%I', p_tablo) into v_top;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''pk'', %s, ''veri'', jsonb_build_object(%s))), ''[]''::jsonb) '
                 'from (select * from public.%I order by %s limit %s offset %s) t',
                 case when cardinality(v_pk) = 0 then '''{}''::jsonb'
                      else 'jsonb_build_object(' || (select string_agg(format('%L, t.%I', k, k), ', ') from unnest(v_pk) k) || ')' end,
                 v_sel, p_tablo,
                 case when cardinality(v_pk) = 0 then '1' else (select string_agg(quote_ident(k), ', ') from unnest(v_pk) k) end,
                 greatest(1, least(coalesce(p_adet, 25), 100)), greatest(0, coalesce(p_ofset, 0)))
    into v_sat;

  return jsonb_build_object('tablo', p_tablo, 'kolonlar', to_jsonb(v_kol), 'pk', to_jsonb(v_pk), 'toplam', v_top, 'satirlar', v_sat,
                            'korumali', public.sistem_korumali_tablo_mu('public', p_tablo));
end;
$$;
revoke all on function public.sistem_tablo_satirlari(text, integer, integer) from public, anon;
grant execute on function public.sistem_tablo_satirlari(text, integer, integer) to authenticated;

create or replace function public.sistem_satir_sil(p_tablo text, p_pkler jsonb, p_onay text, p_islem uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_oid  regclass;
  v_pk   text[];
  v_sil  bigint;
  v_cas  text[];
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_onay is distinct from 'SİL' and p_onay is distinct from 'SIL' then raise exception 'Onay metni yanlış: silmek için SİL yazılmalı.'; end if;
  if p_tablo is null or p_tablo !~ '^[a-z_][a-z0-9_]*$' then raise exception 'Geçersiz tablo adı.'; end if;
  if p_pkler is null or jsonb_typeof(p_pkler) <> 'array' or jsonb_array_length(p_pkler) = 0 then raise exception 'Silinecek satır seçilmedi.'; end if;
  if jsonb_array_length(p_pkler) > 500 then raise exception 'Tek seferde en çok 500 satır.'; end if;
  v_oid := to_regclass(format('public.%I', p_tablo));
  if v_oid is null or not exists (select 1 from pg_class c where c.oid = v_oid and c.relkind = 'r' and not c.relispartition) then raise exception 'Tablo bulunamadı.'; end if;
  if public.sistem_korumali_tablo_mu('public', p_tablo) then
    raise exception 'KORUMALI TABLO: % sitenin çalışması için zorunludur; satırları silinemez.', p_tablo;
  end if;
  v_cas := public._sy_cascade_tablolari(p_tablo);
  if exists (select 1 from unnest(v_cas) x where public.sistem_korumali_tablo_mu(split_part(x, '.', 1), split_part(x, '.', 2))) then
    raise exception '% satırları silinirse zincirleme (CASCADE) olarak korumalı bir tablonun satırları da silinirdi; işlem engellendi.', p_tablo;
  end if;
  select array_agg(a.attname::text order by a.attnum) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;
  if v_pk is null then raise exception 'Bu tablonun birincil anahtarı yok; satır bazlı silme yapılamaz (tüm tabloyu temizle seçeneğini kullan).'; end if;
  if exists (select 1 from jsonb_array_elements(p_pkler) e where (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from (select array_agg(k order by k) from unnest(v_pk) k)) then
    raise exception 'Birincil anahtar alanları uyuşmuyor.';
  end if;

  execute format('delete from public.%1$I t using jsonb_populate_recordset(null::public.%1$I, $1) p where (%2$s) = (%3$s)',
                 p_tablo,
                 (select string_agg('t.' || quote_ident(k), ', ') from unnest(v_pk) k),
                 (select string_agg('p.' || quote_ident(k), ', ') from unnest(v_pk) k))
    using p_pkler;
  get diagnostics v_sil = row_count;
  if p_islem is not null then
    perform public.sistem_islem_bitir(p_islem, true, jsonb_build_object('tablo', p_tablo, 'satir', v_sil));
  end if;
  return jsonb_build_object('tablo', p_tablo, 'silinen', v_sil);
end;
$$;
revoke all on function public.sistem_satir_sil(text, jsonb, text, uuid) from public, anon;
grant execute on function public.sistem_satir_sil(text, jsonb, text, uuid) to authenticated;

-- islem günlüğü türleri: satır silme + üye geri yükleme
alter table public.sistem_islem_loglari drop constraint if exists sistem_islem_loglari_tur_check;
alter table public.sistem_islem_loglari add constraint sistem_islem_loglari_tur_check
  check (tur in ('tablo_temizle', 'satir_sil', 'r2_temizle', 'geri_yukleme', 'silinen_uye_dosya_indirme', 'r2_kuyruk_isle'));
