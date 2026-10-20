-- ============================================================================
-- 0105_ozel_gonderim_zarf_onarimi.sql
--
-- SORUN: Dosya Yöneticisi › Özel gönderimlerim › "Uçtan uca şifrele" ile yükleme, dosya R2'ye çıkıp /yukle-bitir
--        tamamlandıktan sonra "Şifre zarfları kaydedilemedi" hatasıyla düşüyordu (istemci Postgres hatasını yutuyordu).
--
-- KÖK NEDEN (0057 politikaları): iki tablonun RLS politikası birbirine döngüyle bağlıydı —
--     ozel_icerik_anahtarlar  INSERT politikası  → (alt sorgu) r2_arsiv
--     r2_arsiv                SELECT politikası  → (alt sorgu) ozel_icerik_anahtarlar
--   INSERT sırasında ozel_icerik_anahtarlar hedef ilişki olarak "etkin" sayılır; alt sorgudaki r2_arsiv SELECT politikası
--   tekrar ozel_icerik_anahtarlar'a baktığında PostgreSQL 42P17 "infinite recursion detected in policy" verir ve INSERT
--   reddedilir. (Yazan kullanıcı ne kadar yetkili olursa olsun.)
--
-- ÇÖZÜM (üç katman, hepsi tekrar çalıştırılabilir — create or replace / drop if exists):
--   1) Politikalar çapraz tablo alt sorgusu yerine SECURITY DEFINER yardımcı fonksiyon kullanır → döngü kırılır.
--   2) Yazma yolu tek bir SECURITY DEFINER RPC'ye taşınır: ozel_gonderim_zarflarini_kaydet(dosya, zarflar).
--      Sahiplik, 'sifreli' bayrağı, 'yukle' yetkisi, alıcı sayısı (≤ 50) ve ALICININ AÇIK ANAHTARININ VARLIĞI sunucuda doğrulanır.
--      Anahtarı olmayan alıcı için anlamlı hata: 'ALICI_ANAHTARI_YOK: <ad>'.
--   3) Gönderimden ÖNCE kontrol için e2ee_anahtari_olmayanlar(p_ids): R2'ye tek bayt yüklenmeden "alıcının anahtarı yok" denir.
-- Doğrudan INSERT hakkı (grant) geri alınır: zarf yazmanın tek kapısı RPC olur.
-- ============================================================================

-- 1) Döngüyü kıran yardımcılar -------------------------------------------------------------------------------------------
create or replace function public.r2_arsiv_kendi_sifreli_dosyam_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.r2_arsiv a where a.id = p_id and a.sahip_id = auth.uid() and a.sifreli);
$$;
revoke all on function public.r2_arsiv_kendi_sifreli_dosyam_mi(uuid) from public, anon;
grant execute on function public.r2_arsiv_kendi_sifreli_dosyam_mi(uuid) to authenticated;

create or replace function public.ozel_zarfim_var_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ozel_icerik_anahtarlar k where k.dosya_id = p_id and k.alici_id = auth.uid());
$$;
revoke all on function public.ozel_zarfim_var_mi(uuid) from public, anon;
grant execute on function public.ozel_zarfim_var_mi(uuid) to authenticated;

-- r2_arsiv SELECT politikası: ozel_icerik_anahtarlar'a artık doğrudan değil, yardımcı üzerinden bakar.
drop policy if exists r2_arsiv_oku on public.r2_arsiv;
create policy r2_arsiv_oku on public.r2_arsiv
  for select to authenticated
  using (
    (durum = 'hazir' and (
        (not sifreli and public.r2_arsiv_yetkim('oku'))
        or sahip_id = auth.uid()
        or public.ozel_zarfim_var_mi(r2_arsiv.id)
    ))
    or (durum = 'bekliyor' and sahip_id = auth.uid())
  );

-- ozel_icerik_anahtarlar politikaları: r2_arsiv'e doğrudan değil, yardımcı üzerinden bakar.
drop policy if exists ozel_anahtar_gonderen_ekle on public.ozel_icerik_anahtarlar;
create policy ozel_anahtar_gonderen_ekle on public.ozel_icerik_anahtarlar
  for insert to authenticated
  with check (public.r2_arsiv_kendi_sifreli_dosyam_mi(dosya_id) and public.r2_arsiv_yetkim('yukle'));

drop policy if exists ozel_anahtar_gonderen_sil on public.ozel_icerik_anahtarlar;
create policy ozel_anahtar_gonderen_sil on public.ozel_icerik_anahtarlar
  for delete to authenticated
  using (public.r2_arsiv_kendi_sifreli_dosyam_mi(dosya_id));

-- 2) Ön kontrol: hangi alıcıların şifreleme anahtarı yok? ---------------------------------------------------------------
create or replace function public.e2ee_anahtari_olmayanlar(p_ids uuid[])
returns table (kullanici_id uuid, ad text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı')
    from unnest(coalesce(p_ids, '{}'::uuid[])[1:50]) as u(id)
    left join public.profiles p on p.id = u.id
   where auth.uid() is not null
     and not exists (select 1 from public.e2ee_kullanici_anahtarlari k
                      where k.kullanici_id = u.id and nullif(btrim(k.acik_anahtar), '') is not null);
$$;
revoke all on function public.e2ee_anahtari_olmayanlar(uuid[]) from public, anon;
grant execute on function public.e2ee_anahtari_olmayanlar(uuid[]) to authenticated;

-- 3) Zarfları kaydetme RPC'si ---------------------------------------------------------------------------------------------
-- p_zarflar: [{"alici_id": "<uuid>", "sarili_dosya_anahtari": "<base64>"}, ...]
create or replace function public.ozel_gonderim_zarflarini_kaydet(p_dosya_id uuid, p_zarflar jsonb)
returns integer   -- gerçekten EKLENEN zarf sayısı (0 = hepsi zaten erişebiliyordu)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_z jsonb; v_alici uuid; v_sarili text; v_n integer := 0; v_ad text; v_satir integer;
begin
  if v_uid is null then raise exception 'Oturum bulunamadı.' using errcode = '28000'; end if;
  if jsonb_typeof(p_zarflar) is distinct from 'array' or jsonb_array_length(p_zarflar) = 0 then
    raise exception 'ZARF_BOS: Kaydedilecek şifre zarfı yok.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_zarflar) > 50 then
    raise exception 'ZARF_COK: En fazla 50 alıcıya aynı anda gönderilebilir.' using errcode = '22023';
  end if;
  if not public.r2_arsiv_yetkim('yukle') then
    raise exception 'YETKI_YOK: Dosya gönderme yetkin yok.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.r2_arsiv a where a.id = p_dosya_id and a.sahip_id = v_uid and a.sifreli) then
    raise exception 'DOSYA_YOK: Bu şifreli dosya sana ait değil ya da bulunamadı.' using errcode = '42501';
  end if;

  for v_z in select * from jsonb_array_elements(p_zarflar) loop
    begin
      v_alici := (v_z ->> 'alici_id')::uuid;
    exception when others then
      raise exception 'ZARF_GECERSIZ: Alıcı kimliği geçersiz.' using errcode = '22023';
    end;
    v_sarili := nullif(btrim(v_z ->> 'sarili_dosya_anahtari'), '');
    if v_alici is null or v_sarili is null or length(v_sarili) > 4096 then
      raise exception 'ZARF_GECERSIZ: Şifre zarfı biçimi geçersiz.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.e2ee_kullanici_anahtarlari k
                    where k.kullanici_id = v_alici and nullif(btrim(k.acik_anahtar), '') is not null) then
      select coalesce(nullif(btrim(full_name), ''), 'İsimsiz kullanıcı') into v_ad from public.profiles where id = v_alici;
      raise exception 'ALICI_ANAHTARI_YOK: %', coalesce(v_ad, 'Bilinmeyen alıcı') using errcode = '22023';
    end if;
    insert into public.ozel_icerik_anahtarlar (dosya_id, alici_id, sarili_dosya_anahtari)
    values (p_dosya_id, v_alici, v_sarili)
    on conflict (dosya_id, alici_id) do nothing;          -- zaten erişimi olan alıcıya dokunulmaz
    get diagnostics v_satir = row_count;
    v_n := v_n + v_satir;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ozel_gonderim_zarflarini_kaydet(uuid, jsonb) from public, anon;
grant execute on function public.ozel_gonderim_zarflarini_kaydet(uuid, jsonb) to authenticated;

-- Tablo üzerindeki doğrudan INSERT hakkı kapatılır: tek yazma kapısı RPC. (UPDATE zaten yoktu; SELECT/DELETE kalır.)
revoke insert on public.ozel_icerik_anahtarlar from authenticated;
