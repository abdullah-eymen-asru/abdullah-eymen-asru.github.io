-- ============================================================================
-- 0090_demo_mesajlar_bolumu.sql
-- Demo / Vitrin Modu: "Sohbet / Mesajlar" sekmesi artık demo yapılandırmasının (demo_config) bir bölümü.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır.
-- Gereksinim: 0083 (demo_config, demo_config_gecerli_mi).
--
-- NE DEĞİŞİYOR
--   1) demo_config_gecerli_mi(): izinli bölümlere 'mesajlar' {aktif}, izinli Hub kartlarına 'users-mesajlar' eklendi.
--      (Bu olmadan Demo Yetki & Görünürlük panelinden "Kaydet" → "Geçersiz demo yapılandırması" hatası verirdi.)
--   2) Mevcut demo_config satırına 'mesajlar' bölümü (varsayılan AÇIK) ve 'users-mesajlar' kartı eklenir; mevcut diğer
--      ayarlara dokunulmaz.
--
-- GÜVENLİK NOTU (değişmeyen izolasyon): demo hesabı conversations/messages tablolarından HİÇBİR satır okuyamaz/yazamaz
-- (0083 restrictive RLS). Demodaki Sohbet/Mesajlar ekranı istemcideki SAHTE örnek sohbetlerle çalışır
-- (assets/js/demo/demo-mock-veri.js); gönderme/silme eylemleri "salt-okunur" toast'una takılır, sunucuya hiçbir şey gitmez.
-- ============================================================================

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
    'sistem',   jsonb_build_array('aktif'));
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

-- Mevcut satıra eksik anahtarları ekle (varolan değerler korunur).
update public.demo_config
   set config = jsonb_set(
                  case when config ? 'mesajlar' then config
                       else jsonb_set(config, '{mesajlar}', jsonb_build_object('aktif', true), true) end,
                  '{hub,kartlar,users-mesajlar}',
                  coalesce(config #> '{hub,kartlar,users-mesajlar}', 'true'::jsonb),
                  true),
       updated_at = now()
 where id = 1
   and (not (config ? 'mesajlar') or (config #> '{hub,kartlar,users-mesajlar}') is null);
