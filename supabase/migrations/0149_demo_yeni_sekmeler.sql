-- ============================================================================
-- 0149 — Demo/vitrin: yeni salt-okunur bölümler (araclar · yorumlar · durum). Önkoşul: 0102. Tekrar çalıştırılabilir.
-- Yalnızca görünürlük anahtarlarını (boolean) doğrulayan fonksiyon genişler; hiçbir veri/yetki açılmaz.
-- ============================================================================
create or replace function public.demo_config_gecerli_mi(p jsonb)
returns boolean language plpgsql immutable as $$
declare
  izinli constant jsonb := jsonb_build_object(
    'hub',      jsonb_build_array('aktif', 'kartlar'),
    'pdf',      jsonb_build_array('aktif', 'duzenlemeAraclari'),
    'arsiv',    jsonb_build_array('aktif', 'zipInceleme'),
    'notlar',   jsonb_build_array('aktif', 'filtreCipleri'),
    'mesajlar', jsonb_build_array('aktif'),
    'sistem',   jsonb_build_array('aktif'),
    'araclar',  jsonb_build_array('aktif'),
    'yorumlar', jsonb_build_array('aktif'),
    'durum',    jsonb_build_array('aktif'),
    'havastil', jsonb_build_array('aktif', 'misafir'));
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
-- Mevcut yapılandırma satırına dokunulmaz: yeni bölümler yoksa istemci VARSAYILAN (açık) kullanır; panelden kapatılabilir.
