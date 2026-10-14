-- ============================================================================
-- 0094_yedek_mesajlasma_kapsami_kvkk_eposta_uye_geri_yukleme.sql
-- Gereksinim: 0075, 0076, 0084, 0093 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir.
--
--  A) Mesajlaşma tabloları (conversations, messages, konusma_zarflari, konusma_gizlemeleri, mesaj_gizlemeleri,
--     konusma_durumlari) artık dışa aktarma kaydında: içerik E2EE olduğu için 'hassas' sayılmaz; TAM SİSTEM yedeğinde
--     yalnızca ŞİFRELİ mesajlar (sifreli = true) varsayılan olarak pakete girer — eski düz metin mesajlar yalnızca
--     "hassas dahil" işaretlenirse. Üyenin KENDİ yedeğinde kendi sohbetleri (şifreli paket + zarf) bulunur.
--  B) KVKK / Aydınlatma "Üye onay kayıtları" (uye_onay_durumlari): e-posta maskesiz, yetkiyi geçen herkese (Site Sahibi,
--     Admin, hukuki metin yetkisi olanlar) TAM açık metin döner ve e-postayla aranabilir (yasal ispat).
--  C) uye_geri_yukle_tablo: hesabı silinmiş üyenin SAHİPSİZ (NULL sahipli) kayıtları, aynı kimlikli satır geri yüklenirken
--     yeni hesaba SAHİPLENİLİR (eskiden "zaten vardı" diye atlanıyor, sonra dosya yükleme izni reddediliyordu).
-- ============================================================================

-- A) kayıt listesi
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
    -- Mesajlaşma (0093): içerik UÇTAN UCA ŞİFRELİ olduğu için artık 'hassas' DEĞİL ve her üyenin kendi yedeğine girer.
    -- Şifreli paketler bütünlüğü korunarak (gövde + zarf + iki taraflı gizleme/okuma izleri) taşınır; çözmek için
    -- e2ee_kullanici_anahtarlari (sarılı özel anahtar) + konusma_zarflari aynı pakette gelir.
    ('conversations',               'veri',   'user_id = auth.uid() or hedef_admin_id = auth.uid()', false, false),
    ('konusma_zarflari',            'veri',   'user_id = auth.uid()',      false, false),
    ('messages',                    'veri',   'conversation_id in (select c.id from public.conversations c where c.user_id = auth.uid() or c.hedef_admin_id = auth.uid())', false, false),
    ('konusma_gizlemeleri',         'veri',   'user_id = auth.uid()',      false, false),
    ('mesaj_gizlemeleri',           'veri',   'user_id = auth.uid()',      false, false),
    ('konusma_durumlari',           'veri',   'user_id = auth.uid()',      false, false)
  ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas);
$$;

-- A) plan
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
         case when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar' else 'veritabani' end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'tum'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri' then 'secili'
           else 'kendi'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'true'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri'
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
    )
    and not (r.sadece_owner and l.kapsam <> 'tum')
  ) x(tablo, hedef, kapsam, kosul);
$$;

revoke all on function public.sistem_export_tablo_kayitlari() from public, anon, authenticated;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;

-- B) KVKK üye listesi (e-posta maskesiz)
create or replace function public.uye_onay_durumlari(
  p_q       text    default '',
  p_filtre  text    default 'hepsi',
  p_limit   integer default 25,
  p_ofset   integer default 0
)
returns table (
  id uuid, ad text, rol text, eposta text,
  kvkk_verildi boolean, kvkk_surum text, kvkk_tarih timestamptz, kvkk_guncel boolean,
  riza_verildi boolean, riza_surum text, riza_tarih timestamptz, riza_guncel boolean,
  toplam bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q     text := replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', '');
begin
  if not public.hukuki_metin_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: üye onay kayıtlarını görme yetkin yok.';
  end if;
  if p_filtre not in ('hepsi', 'eski', 'rizasiz', 'onaysiz') then
    raise exception 'Geçersiz filtre.';
  end if;

  return query
  with s as (select sa.guncel_kvkk_surumu as kv, sa.guncel_riza_surumu as rz from public.site_ayarlari sa where sa.id = 1),
  d as (
    select p.id,
           coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye') as ad,
           p.role::text as rol,
           p.email::text as eposta,
           (p.kvkk_onay_verildi is true) as kvkk_verildi,
           p.kvkk_onay_versiyonu as kvkk_surum,
           p.kvkk_onay_tarihi as kvkk_tarih,
           (p.kvkk_onay_verildi is true and p.kvkk_onay_versiyonu = s.kv) as kvkk_guncel,
           (p.yurtdisi_onay_verildi is true) as riza_verildi,
           p.yurtdisi_onay_versiyonu as riza_surum,
           p.yurtdisi_onay_tarihi as riza_tarih,
           (p.yurtdisi_onay_verildi is true and p.yurtdisi_onay_versiyonu = s.rz) as riza_guncel
    from public.profiles p cross join s
    where v_q = ''
       or p.full_name ilike '%' || v_q || '%'
       or p.email ilike '%' || v_q || '%'
  ),
  f as (
    select d.* from d
    where case p_filtre
            when 'eski'    then (d.kvkk_verildi and not d.kvkk_guncel) or (d.riza_verildi and not d.riza_guncel)
            when 'rizasiz' then not d.riza_verildi
            when 'onaysiz' then not d.kvkk_verildi
            else true
          end
  )
  select f.id, f.ad, f.rol,
         f.eposta, -- yasal ispat: yetkili (Site Sahibi / Admin / hukuki metin yetkisi olan) için TAM açık metin
         f.kvkk_verildi, f.kvkk_surum, f.kvkk_tarih, f.kvkk_guncel,
         f.riza_verildi, f.riza_surum, f.riza_tarih, f.riza_guncel,
         count(*) over ()
  from f
  order by f.ad, f.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;
revoke all on function public.uye_onay_durumlari(text, text, integer, integer) from public, anon;
grant execute on function public.uye_onay_durumlari(text, text, integer, integer) to authenticated;

-- C) üye geri yükleme
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
  v_sahiplen text;
  v_pk_t     text;
  v_pk_p     text;
  v_say      integer;
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
                    'on conflict (%3$s) do update set %4$s where t.%5$I = $2 or t.%5$I is null returning (xmax = 0)',
                    c.tablo, v_kolon, v_pk, v_guncelle, c.kullanici_kolonu);
  else
    v_sql := format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing returning (xmax = 0)',
                    c.tablo, v_kolon);
  end if;

  -- SAHİPSİZ SATIRI SAHİPLEN: hesap silinince bazı tablolarda (ör. r2_arsiv.sahip_id) kayıt silinmez, sahibi NULL olur.
  -- Aynı kimlikli satır yeniden yüklenirken eskiden "zaten vardı" sayılıp atlanıyor, dosya yükleme izni de (kayıt kimde?) reddediliyordu.
  select string_agg('t.' || quote_ident(a.attname), ', ' order by a.attnum), string_agg('p.' || quote_ident(a.attname), ', ' order by a.attnum)
    into v_pk_t, v_pk_p
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;
  if v_pk_t is not null and not exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = c.kullanici_kolonu and a.attnotnull) then
    v_sahiplen := format('update public.%1$I t set %2$I = $2 where t.%2$I is null and (%3$s) = (select %4$s from jsonb_populate_record(null::public.%1$I, $1) p)',
                         c.tablo, c.kullanici_kolonu, v_pk_t, v_pk_p);
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
      if v_sahiplen is not null then
        execute v_sahiplen using v_satir, v_uid;
        get diagnostics v_say = row_count;
        if v_say > 0 and v_mod <> 'uzerine' then v_guncel := v_guncel + 1; continue; end if; -- 'üzerine yaz'da sahiplenen satır aşağıda yedektekiyle de güncellenir
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
