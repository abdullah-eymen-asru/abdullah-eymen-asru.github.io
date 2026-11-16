-- ============================================================================
-- 0139_yorum_yedek_geri_yukleme_takma_ad.sql
--  1) Üye, KENDİ yorumlarını yedekleyebilir (yorum_yedek_al → JSON) ve geri yükleyebilir (yorum_geri_yukle):
--     • Her kayıtta author_signature_hash, oturumdaki hesabın imzasıyla BİREBİR eşleşmeli → başkasının yorumu yüklenemez.
--     • Aynı id ya da aynı (yazı, imza, metin, tarih) zaten varsa ATLANIR → çift kayıt oluşmaz.
--     • Gizleme durumu (gizli) yedekten GERİ GELMEZ: yönetici kararı yedekle aşılamaz.
--  2) Takma adı istediğin zaman değiştir: yorum_takma_ad_degistir (anonim olmayan tüm yorumlarına uygular; boş değer = profil adına dön).
--  3) Tam sistem yedeği (Site Sahibi, "tum" kapsam) ve üyenin kendi kapsamı artık `yorumlar` tablosunu da içerir.
--  4) DB düzeyi koruma: yorum METNİ yalnızca yazarı (ya da Site Sahibi'nin geri yüklemesi/servis rolü) tarafından değişebilir; yönetici/admin metni düzenleyemez.
-- Gereksinim: 0137, 0138. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- 1) Yedek al ------------------------------------------------------------------
create or replace function public.yorum_yedek_al()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', y.id, 'icerik_anahtari', y.icerik_anahtari, 'ust_id', y.ust_id, 'metin', y.metin,
           'created_at', y.created_at, 'edited_at', y.edited_at, 'anonim', y.anonim, 'rumuz', y.rumuz,
           'gorunen_ad', y.gorunen_ad, 'author_signature_hash', y.author_signature_hash) order by y.created_at), '[]'::jsonb)
    into v from public.yorumlar y where y.user_id = auth.uid();
  return v;
end $$;
revoke all on function public.yorum_yedek_al() from public, anon;
grant execute on function public.yorum_yedek_al() to authenticated;

-- 2) Geri yükle ----------------------------------------------------------------
create or replace function public.yorum_geri_yukle(p_veri jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_imza text; r jsonb; v_id uuid; v_ust uuid; v_anahtar text; v_metin text; v_ad text;
  v_olu timestamptz; v_duz timestamptz; v_eklendi int := 0; v_atlandi int := 0; v_gecersiz int := 0;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and (coalesce(is_suspended, false) or role = 'demo')) then raise exception 'Bu hesapla yorum geri yüklenemez.' using errcode = '42501'; end if;
  if p_veri is null or jsonb_typeof(p_veri) <> 'array' then raise exception 'Geçersiz yedek dosyası.'; end if;
  if jsonb_array_length(p_veri) > 5000 then raise exception 'Tek seferde en fazla 5000 yorum geri yüklenebilir.'; end if;
  v_imza := public._yorum_imza(auth.uid());

  for r in select e from jsonb_array_elements(p_veri) e order by (case when (e->>'created_at') ~ '^\d{4}-\d{2}-\d{2}' then e->>'created_at' else '9999' end) loop
    begin
      if jsonb_typeof(r) <> 'object' or coalesce(r->>'author_signature_hash', '') <> v_imza then v_gecersiz := v_gecersiz + 1; continue; end if;
      v_anahtar := btrim(coalesce(r->>'icerik_anahtari', '')); v_metin := btrim(coalesce(r->>'metin', ''));
      if char_length(v_anahtar) not between 1 and 300 or char_length(v_metin) not between 1 and 10000 then v_gecersiz := v_gecersiz + 1; continue; end if;
      v_id := case when (r->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (r->>'id')::uuid else gen_random_uuid() end;
      v_ust := case when (r->>'ust_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (r->>'ust_id')::uuid else null end;
      v_olu := coalesce(nullif(r->>'created_at', '')::timestamptz, now());
      v_duz := nullif(r->>'edited_at', '')::timestamptz;
      v_ad := nullif(left(btrim(coalesce(r->>'gorunen_ad', '')), 40), '');
      if exists (select 1 from public.yorumlar where id = v_id)
         or exists (select 1 from public.yorumlar where icerik_anahtari = v_anahtar and author_signature_hash = v_imza and metin = v_metin and created_at = v_olu) then
        v_atlandi := v_atlandi + 1; continue;
      end if;
      if v_ust is not null and not exists (select 1 from public.yorumlar where id = v_ust and icerik_anahtari = v_anahtar) then v_ust := null; end if;
      insert into public.yorumlar (id, icerik_anahtari, ust_id, user_id, author_signature_hash, gorunen_ad, anonim, rumuz, metin, created_at, edited_at)
        values (v_id, v_anahtar, v_ust, auth.uid(), v_imza, v_ad, coalesce((r->>'anonim')::boolean, false), coalesce((r->>'rumuz')::boolean, false), v_metin, v_olu, v_duz);
      v_eklendi := v_eklendi + 1;
    exception when others then v_gecersiz := v_gecersiz + 1;
    end;
  end loop;
  return jsonb_build_object('eklendi', v_eklendi, 'atlandi', v_atlandi, 'gecersiz', v_gecersiz);
end $$;
revoke all on function public.yorum_geri_yukle(jsonb) from public, anon;
grant execute on function public.yorum_geri_yukle(jsonb) to authenticated;

-- 3) Takma ad -------------------------------------------------------------------
create or replace function public.yorum_takma_ad_degistir(p_ad text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_ad text := nullif(btrim(coalesce(p_ad, '')), ''); v_profil text; n integer;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_ad is not null and (char_length(v_ad) < 2 or char_length(v_ad) > 40) then raise exception 'Takma ad 2–40 karakter olmalı.'; end if;
  select nullif(btrim(full_name), '') into v_profil from public.profiles where id = auth.uid();
  update public.yorumlar set gorunen_ad = coalesce(v_ad, v_profil), rumuz = v_ad is not null
   where user_id = auth.uid() and not anonim;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.yorum_takma_ad_degistir(text) from public, anon;
grant execute on function public.yorum_takma_ad_degistir(text) to authenticated;

-- 4) Yedek kapsamı: yorumlar --------------------------------------------------
do $y$
begin
  if to_regprocedure('public.sistem_export_tablo_kayitlari_v0()') is not null then
    create or replace function public.sistem_export_tablo_kayitlari()
    returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
    language sql immutable as $b$
      select * from public.sistem_export_tablo_kayitlari_v0()
      union all select * from (values
        ('akademik_koleksiyonlar',      'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_koleksiyon_ogeleri', 'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_eklenti_ayarlari',   'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_paylasimlari',       'notlar', 'user_id = auth.uid()', false, true),
        ('yorumlar',                    'veri',   'user_id = auth.uid()', false, false)
      ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas)
      where not exists (select 1 from public.sistem_export_tablo_kayitlari_v0() o where o.tablo = t.tablo)
    $b$;
  end if;
end $y$;

-- 5) DB düzeyi: metni yönetici/admin değiştiremez --------------------------------
create or replace function public._yorum_metin_koruma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.metin is distinct from old.metin
     and auth.uid() is not null
     and auth.uid() is distinct from old.user_id
     and not coalesce(public.is_owner(), false) then
    raise exception 'Yorum metnini yalnızca yazarı değiştirebilir.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public._yorum_metin_koruma() from public, anon, authenticated;
drop trigger if exists yorum_metin_koruma on public.yorumlar;
create trigger yorum_metin_koruma before update on public.yorumlar for each row execute function public._yorum_metin_koruma();
