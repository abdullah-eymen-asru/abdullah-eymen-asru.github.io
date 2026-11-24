-- ============================================================================
-- 0151 — Supabase Advisor önerilerinin uygulanması (güvenlik + performans). Tekrar çalıştırılabilir (idempotent).
-- Her adım kendi başına güvenlidir; bir adım hata verirse NOTICE yazar ve diğerlerine devam eder (sistem bozulmaz).
--
--  1) RLS açık ama politikası olmayan tablolar → açık "yalnızca sunucu" (herkese kapalı) politika. DAVRANIŞ DEĞİŞMEZ
--     (politikasız RLS zaten her şeyi reddeder; service_role ve SECURITY DEFINER fonksiyonlar etkilenmez). Sadece niyeti belgeler.
--  2) multiple_permissive_policies → FOR ALL politikaları INSERT/UPDATE/DELETE olarak bölünür (SELECT çakışması kalkar);
--     messages DELETE'teki iki politika OR ile tek politikada birleşir (mantık aynı).
--  3) auth_rls_initplan → politikalardaki auth.uid()/auth.role()/auth.jwt()/auth.email() → (select auth.uid()) (sonuç aynı, satır başına yeniden hesaplanmaz).
--  4) Kapsayıcı indeksi olmayan yabancı anahtarlar → indeks.
--  5) Kullanılmayan indeksler → silinir (başka bir yabancı anahtarı kapsıyorsa, benzersizse ya da kısıt destekliyorsa ASLA silinmez).
--  6) SECURITY DEFINER: tetikleyici fonksiyonlar kimseye açık değil; yönetim/sahip RPC'leri anon'a kapatılır (giriş yapmış kullanıcıya açık kalır,
--     içlerindeki yetki denetimi zaten var). Herkese açık sayfaların kullandığı RPC'lere ve RLS yardımcılarına (is_admin vb.) DOKUNULMAZ.
--  7) function_search_path_mutable → 26 fonksiyona sabit search_path.
--  8) Public bucket'lar (avatarlar, cv-dosyalari): herkese açık "listele" politikası daraltılır. Dosyalar public URL ile açılmaya devam eder.
--  9) btree_gist eklentisi public şemasından extensions şemasına taşınır (pg_net taşınamaz; Supabase yönetir).
-- Elle yapılacaklar (SQL ile değil, panelden): Authentication › Providers › Email › OTP expiry ≤ 3600 sn;
--     Authentication › Passwords › "Leaked password protection" (Pro plan gerektirir).
-- ============================================================================

create schema if not exists extensions;

-- 1) RLS açık + politikasız tablolar → açık reddet politikası ------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  loop
    begin
      execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false)', 'yalniz_sunucu', t.relname);
      execute format('comment on policy %I on public.%I is %L', 'yalniz_sunucu', t.relname, 'Bu tabloya istemciden erişim yok; yalnızca service_role / SECURITY DEFINER fonksiyonlar.');
    exception when others then raise notice '0151/1 % atlandı: %', t.relname, sqlerrm;
    end;
  end loop;
end $$;

-- 2a) FOR ALL politikalarını böl (SELECT çakışmasını kaldırır) ------------------------------------------------
do $$
declare
  hedef text[][] := array[['akademik_koleksiyon_ogeleri','akademik_kog_yaz'],['akademik_koleksiyonlar','akademik_kol_yaz'],['havastil_ai_kasasi','havastil_ai_kasasi_sahip_yaz']];
  i int; r record; roller text;
begin
  for i in 1..array_length(hedef,1) loop
    select * into r from pg_policies where schemaname = 'public' and tablename = hedef[i][1] and policyname = hedef[i][2] and cmd = 'ALL';
    if not found then continue; end if;
    begin
      roller := array_to_string(array(select case when x = 'public' then 'public' else quote_ident(x) end from unnest(r.roles) x), ', ');
      execute format('create policy %I on public.%I for insert to %s with check (%s)', hedef[i][2] || '_ekle', hedef[i][1], roller, coalesce(r.with_check, r.qual, 'true'));
      execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', hedef[i][2] || '_guncelle', hedef[i][1], roller, coalesce(r.qual, r.with_check, 'true'), coalesce(r.with_check, r.qual, 'true'));
      execute format('create policy %I on public.%I for delete to %s using (%s)', hedef[i][2] || '_sil', hedef[i][1], roller, coalesce(r.qual, r.with_check, 'true'));
      execute format('drop policy %I on public.%I', hedef[i][2], hedef[i][1]);
    exception when duplicate_object then
      raise notice '0151/2a % zaten bölünmüş', hedef[i][2];
    when others then
      raise notice '0151/2a % atlandı: %', hedef[i][2], sqlerrm;
    end;
  end loop;
end $$;

-- 2b) messages DELETE: iki izinli politika → tek politika (a OR b) ----------------------------------------------
do $$
declare a record; b record; roller text;
begin
  select * into a from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_delete_only_sender' and cmd='DELETE';
  select * into b from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_delete_own_or_admin' and cmd='DELETE';
  if a.policyname is null or b.policyname is null then return; end if;
  roller := array_to_string(array(select case when x = 'public' then 'public' else quote_ident(x) end from unnest(a.roles) x), ', ');
  execute 'drop policy messages_delete_only_sender on public.messages';
  execute 'drop policy messages_delete_own_or_admin on public.messages';
  execute format('create policy messages_delete_birlesik on public.messages for delete to %s using ((%s) or (%s))', roller, coalesce(a.qual,'false'), coalesce(b.qual,'false'));
exception when others then raise notice '0151/2b atlandı: %', sqlerrm;
end $$;

-- 3) auth_rls_initplan: auth.<fn>() → (select auth.<fn>()) -----------------------------------------------------
do $$
declare p record; q text; w text; sql text;
begin
  for p in select * from pg_policies where schemaname = 'public'
            and (coalesce(qual,'') ~* '(?<!select )auth\.(uid|role|jwt|email)\(\)' or coalesce(with_check,'') ~* '(?<!select )auth\.(uid|role|jwt|email)\(\)')
  loop
    begin
      q := regexp_replace(p.qual,       '(?<!select )auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'gi');
      w := regexp_replace(p.with_check, '(?<!select )auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'gi');
      sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if q is not null then sql := sql || ' using (' || q || ')'; end if;
      if w is not null then sql := sql || ' with check (' || w || ')'; end if;
      execute sql;
    exception when others then raise notice '0151/3 %.% atlandı: %', p.tablename, p.policyname, sqlerrm;
    end;
  end loop;
end $$;

-- 4) Kapsayıcı indeksi olmayan yabancı anahtarlar → indeks -----------------------------------------------------
do $$
declare c record; cols text; ad text;
begin
  for c in
    select con.oid, con.conrelid, con.conkey, rel.relname, con.conname
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and rel.relkind in ('r','p')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = con.conrelid and i.indpred is null
          and (select coalesce(array_agg(x order by x), '{}') from unnest((i.indkey::int2[])[0:cardinality(con.conkey)-1]) x)
            = (select coalesce(array_agg(x order by x), '{}') from unnest(con.conkey) x))
  loop
    begin
      select string_agg(quote_ident(a.attname), ', ' order by k.ord), string_agg(a.attname, '_' order by k.ord)
        into cols, ad
        from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum;
      execute format('create index if not exists %I on public.%I (%s)', left('idx_' || c.relname || '_' || ad, 63), c.relname, cols);
    exception when others then raise notice '0151/4 % atlandı: %', c.conname, sqlerrm;
    end;
  end loop;
end $$;

-- 5) Kullanılmayan indeksler (yalnızca güvenli olanlar silinir) -------------------------------------------------
do $$
declare ad text; i record;
begin
  foreach ad in array array[
    'idx_profiles_first_name','idx_profiles_last_name','idx_taslak_icerikler_arama_metni','idx_taslak_icerikler_baslik','mfa_yedek_kodlar_user_id_idx',
    'akademik_koleksiyonlar_cop_idx','indirme_loglari_created_at_idx','r2_arsiv_tam_yol_idx','r2_arsiv_ad_trgm_idx','sistem_islem_loglari_tarih_idx','idx_messages_yanit',
    'havastil_konumlari_user_sira_idx','akademik_kaynaklar_etiket_idx','akademik_kaynaklar_gorunurluk_idx','ozellik_kullanici_kisitlari_user_idx',
    'ozellik_kullanici_izinleri_user_idx','idx_denetim_kayitlari_aktor','idx_denetim_kayitlari_sonuc','site_ayarlari_loglari_created_idx','idx_konusma_uyeleri_user',
    'idx_profiles_email','idx_profiles_full_name']
  loop
    select ix.indexrelid, ix.indrelid, ix.indkey::int2[] as kolonlar, ix.indisunique, ix.indisprimary into i
      from pg_index ix join pg_class c on c.oid = ix.indexrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ad;
    if not found then continue; end if;
    if i.indisunique or i.indisprimary then raise notice '0151/5 % benzersiz: korundu', ad; continue; end if;
    if exists (select 1 from pg_constraint k where k.conindid = i.indexrelid) then continue; end if;
    -- Bu indeks bir yabancı anahtarın tek kapsayıcısıysa SİLME (yoksa "unindexed FK" uyarısı geri gelir)
    if exists (
      select 1 from pg_constraint con
      where con.contype = 'f' and con.conrelid = i.indrelid
        and (select coalesce(array_agg(x order by x), '{}') from unnest(i.kolonlar[0:cardinality(con.conkey)-1]) x)
          = (select coalesce(array_agg(x order by x), '{}') from unnest(con.conkey) x)
        and (select count(*) from pg_index o where o.indrelid = i.indrelid and o.indexrelid <> i.indexrelid and o.indpred is null
              and (select coalesce(array_agg(x order by x), '{}') from unnest((o.indkey::int2[])[0:cardinality(con.conkey)-1]) x)
                = (select coalesce(array_agg(x order by x), '{}') from unnest(con.conkey) x)) = 0)
    then raise notice '0151/5 % yabancı anahtarı kapsıyor: korundu', ad; continue; end if;
    begin execute format('drop index if exists public.%I', ad);
    exception when others then raise notice '0151/5 % silinemedi: %', ad, sqlerrm; end;
  end loop;
end $$;

-- 6) SECURITY DEFINER çağrı yetkileri ---------------------------------------------------------------------------
-- 6a) Tetikleyici fonksiyonlar: tetikleyici çalışması için EXECUTE gerekmez → kimseye açık olmasın.
do $$
declare f record;
begin
  for f in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop
    begin
      execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
    exception when others then raise notice '0151/6a % atlandı: %', f.proname, sqlerrm; end;
  end loop;
end $$;
-- 6b) Yönetim / sahip RPC'leri: anon çağıramasın (giriş yapmış kullanıcı yetki denetimiyle çağırmaya devam eder).
do $$
declare f record;
begin
  for f in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and p.proname = any(array[
             '_denetim_bildirim_gonder','admin_askiya_al','admin_denetim_oy_geri_al','admin_denetim_oy_kullan','admin_listesi_getir','admin_sahip_talebi_oy_kullan',
             'admin_taslak_onayla','denetim_vakalarini_listele','denetim_vakasi_sil','guvenlik_admin_listesi_getir','owner_denetim_karar','owner_denetim_kaydi_sil',
             'owner_denetim_kayitlarini_temizle','owner_kayitlari_ac_kapat','owner_kendi_rolunu_dusur','owner_kilit_modu_ayarla','owner_ozellik_erisimi_ayarla',
             'owner_rolu_ver','sahip_onay_durumu_getir','sahip_taslak_onayla'])
  loop
    begin
      execute format('revoke execute on function public.%I(%s) from public, anon', f.proname, f.args);
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', f.proname, f.args);
    exception when others then raise notice '0151/6b % atlandı: %', f.proname, sqlerrm; end;
  end loop;
end $$;

-- 7) function_search_path_mutable ----------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname = any(array[
             '_rol_sirasi','gk_guncellenme_damgasi','like_kacis','tr_ara_normalize','set_updated_at','owner_kullanici_kisiti_engelle','ozellik_izni_hedef_kontrol','tr_sirala',
             'r2_arsiv_nfc','_uye_geri_yukleme_tablolari_v0','not_guncelleme_kurallari','owner_kilitlenmesini_engelle','akademik_guncelleme_tarihi_ayarla',
             'akademik_sahip_degistirilemez','akademik_not_guncelleme_ayarla','_hs_kolon_var','sistem_korumali_tablo_mu','_mesaj_grup','demo_config_gecerli_mi',
             '_uye_geri_yukleme_tablolari','havastil_konum_siniri','sistem_export_tablo_kayitlari_v0','havastil_konum_guncellendi','_eposta_maskele',
             'sistem_export_tablo_kayitlari','_medya_bugun'])
  loop
    begin
      execute format('alter function public.%I(%s) set search_path = public, extensions, pg_temp', f.proname, f.args);
    exception when others then raise notice '0151/7 % atlandı: %', f.proname, sqlerrm; end;
  end loop;
end $$;

-- 8) Public bucket'larda herkese açık "listele" politikasını daralt (public URL erişimi politikasız çalışır) ----
do $$
begin
  begin
    if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatar_select_public') then
      drop policy avatar_select_public on storage.objects;
      create policy avatar_select_sahibi on storage.objects for select to authenticated
        using (bucket_id = 'avatarlar' and owner_id = (select auth.uid())::text);
    end if;
  exception when others then raise notice '0151/8 avatarlar atlandı: %', sqlerrm; end;
  begin
    if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cv_select_public') then
      drop policy cv_select_public on storage.objects;
      create policy cv_select_yazar on storage.objects for select to authenticated
        using (bucket_id = 'cv-dosyalari' and public.cv_storage_yazabilir_mi());
    end if;
  exception when others then raise notice '0151/8 cv-dosyalari atlandı: %', sqlerrm; end;
end $$;

-- 9) btree_gist → extensions şeması (pg_net taşınamaz) ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist' and n.nspname = 'public') then
    alter extension btree_gist set schema extensions;
  end if;
exception when others then raise notice '0151/9 btree_gist taşınamadı: %', sqlerrm;
end $$;
