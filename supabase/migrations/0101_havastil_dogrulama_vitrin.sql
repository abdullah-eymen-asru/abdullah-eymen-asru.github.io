-- ============================================================================
-- 0101_havastil_dogrulama_vitrin.sql — HavaStil v4: tam hassasiyetli koordinat, ayrı yer adı/mahalle/sokak alanları, demo vitrin yapılandırması
-- Tekrar çalıştırmak güvenlidir (idempotent). Gereksinim: 0099, 0100, 0083/0090 (demo_config).
--   1) havastil_konumlari.enlem/boylam: numeric(8,3) (≈110 m) → numeric(9,6) (≈0,1 m). Kullanıcı kendi isteğiyle kaydettiği noktada yuvarlama YOK.
--      Mevcut satırlar olduğu gibi korunur (3 ondalıklı değerler 6 ondalığa genişler).
--   2) Yeni alanlar: yer_adi (coğrafi yer adı; `ad` kullanıcının verdiği isim/etiket olarak kalır), mahalle, sokak.
--   3) UPDATE politikası: "Düzenle" (kalem) özelliği satırı UPDATE eder. 0099'daki havastil_konumlari_sahip politikası FOR ALL ise yeterlidir;
--      değilse aşağıda yalnızca-sahip UPDATE politikası eklenir.
--   4) demo_config: 'havastil' bölümü ({aktif}) — HavaStil vitrini (İstanbul, kayıt/Mod B kapalı) demo menüsünde görünür.
-- ============================================================================
alter table public.havastil_konumlari
  alter column enlem  type numeric(9, 6),
  alter column boylam type numeric(9, 6),
  add column if not exists yer_adi text,
  add column if not exists mahalle text,
  add column if not exists sokak   text;

do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.havastil_konumlari'::regclass and c.contype = 'c'
             and (pg_get_constraintdef(c.oid) ilike '%yer_adi%' or pg_get_constraintdef(c.oid) ilike '%mahalle%' or pg_get_constraintdef(c.oid) ilike '%sokak%') loop
    execute format('alter table public.havastil_konumlari drop constraint %I', r.conname);
  end loop;
  alter table public.havastil_konumlari
    add constraint havastil_konumlari_yer_adi_chk  check (yer_adi is null or char_length(yer_adi) <= 60),
    add constraint havastil_konumlari_mahalle_chk  check (mahalle is null or char_length(mahalle) <= 60),
    add constraint havastil_konumlari_sokak_chk    check (sokak is null or char_length(sokak) <= 60);
end $$;

-- UPDATE: yalnızca sahibi ve yetki açıkken (FOR ALL politika zaten varsa bu ek politika zararsızdır)
drop policy if exists havastil_konumlari_guncelle on public.havastil_konumlari;
create policy havastil_konumlari_guncelle on public.havastil_konumlari
  for update to authenticated
  using (user_id = auth.uid() and public.havastil_yetkisi_var_mi())
  with check (user_id = auth.uid() and public.havastil_yetkisi_var_mi());

comment on column public.havastil_konumlari.enlem is 'Enlem, YUVARLANMAMIŞ (numeric(9,6) ≈ 0,1 m). Yalnızca kullanıcının kaydettiği konumlar.';
comment on column public.havastil_konumlari.ad is 'Kullanıcıya görünen konum ismi/etiketi (ör. "Evim - Kadıköy"); kullanıcı başına benzersiz.';

-- ----------------------------------------------------------------------------
-- demo_config: 'havastil' bölümü (0090'daki doğrulayıcı + yeni bölüm)
-- ----------------------------------------------------------------------------
create or replace function public.demo_config_gecerli_mi(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  izinli constant jsonb := jsonb_build_object(
    'hub',      jsonb_build_array('aktif', 'kartlar'),
    'pdf',      jsonb_build_array('aktif', 'duzenlemeAraclari'),
    'arsiv',    jsonb_build_array('aktif', 'zipInceleme'),
    'notlar',   jsonb_build_array('aktif', 'filtreCipleri'),
    'mesajlar', jsonb_build_array('aktif'),
    'sistem',   jsonb_build_array('aktif'),
    'havastil', jsonb_build_array('aktif'));
  kart_izinli constant text[] := array['content-notlar', 'media-arsiv', 'lib-kutuphane', 'users-mesajlar', 'sys-metrik'];
  bolum text; alan text; kart text; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4000 then return false; end if;
  for bolum in select k from jsonb_object_keys(p) k loop
    if bolum = 'v' then
      if jsonb_typeof(p -> 'v') <> 'number' then return false; end if;
    elsif not (izinli ? bolum) then return false;
    else
      if jsonb_typeof(p -> bolum) <> 'object' then return false; end if;
      for alan in select k from jsonb_object_keys(p -> bolum) k loop
        if not (izinli -> bolum) ? alan then return false; end if;
        v := p -> bolum -> alan;
        if bolum = 'hub' and alan = 'kartlar' then
          if jsonb_typeof(v) <> 'object' then return false; end if;
          for kart in select k from jsonb_object_keys(v) k loop
            if not (kart = any (kart_izinli)) or jsonb_typeof(v -> kart) <> 'boolean' then return false; end if;
          end loop;
        elsif jsonb_typeof(v) <> 'boolean' then return false;
        end if;
      end loop;
    end if;
  end loop;
  return true;
end $$;

update public.demo_config
   set config = jsonb_set(config, '{havastil}', jsonb_build_object('aktif', true), true), updated_at = now()
 where id = 1 and not (config ? 'havastil');

-- HIZLI KONTROL:  select enlem, boylam, ad, yer_adi from public.havastil_konumlari limit 3;
--                 select config -> 'havastil' from public.demo_config where id = 1;
