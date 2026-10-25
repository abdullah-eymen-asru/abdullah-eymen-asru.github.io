-- ============================================================================
-- 0113_site_duyurulari_ve_havastil_ai_kasasi.sql
-- Gereksinim: 0048, 0079, 0099, 0108 (ozellik_varsayilan_kapali, is_owner(), havastil_yetkisi_var_mi()). Tekrar çalıştırmak güvenlidir.
--
--  A) SİTE DUYURULARI (bakım / yedekleme / felaket uyarı ekranı)
--     • Site sahibi (ve yetkili yönetici) başlık + metin yazar; ziyaretçilere (açılış penceresi) ve üyelere (panelde kalıcı, rahatsız etmeyen şerit) gösterilir.
--     • Üye bir duyuruyu kapatınca "kim, ne zaman okudu" kaydı tutulur (site_duyuru_okumalari). Kayıtları YALNIZCA Site Sahibi siler.
--     • Yönetici: Yetki Ayarları › "Site Duyuruları" (duyuru_yonetimi, VARSAYILAN KAPALI) açıksa oluşturur/düzenler/açıp kapatır/okuyanları görür ve arar;
--       duyuruyu ve okuma kayıtlarını SİLEMEZ.
--     • Tablolara doğrudan erişim YOK (RLS açık, politika yok); her şey SECURITY DEFINER RPC'lerden geçer. Okuyan listesinde e-posta MASKELİ döner,
--       arama sunucuda yapılır (bkz. 0047 ile aynı "veri sızdırma" ilkesi).
--  B) HAVASTİL YAPAY ZEKÂ ANAHTAR KASASI (kendi API anahtarını getir)
--     • Anahtarlar TARAYICIDA kullanıcının kasa parolasından türetilen AES-GCM anahtarıyla şifrelenir; sunucuya yalnızca şifreli metin gelir.
--       Site sahibi dahil kimse anahtarı okuyamaz. Parola sunucuda YOKTUR (unutulursa kasa sıfırlanır, anahtarlar yeniden girilir).
--     • Tablo, sistem yedeği tablo listesinde (beyaz liste) OLMADIĞI için yedeklere girmez.
-- ============================================================================

-- ---------------------------------------------------------------------------- 1) yetki anahtarı: duyuru_yonetimi (yalnızca Yönetici sütunu)
alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_anahtar_chk;
alter table public.ozellik_varsayilan_kapali
  add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in
    ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi'));

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi') then raise exception 'Geçersiz özellik.'; end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi') and p_rol <> 'admin' then raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.'; end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

create or replace function public.duyuru_yonetim_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'owner'
                      or (p.role = 'admin' and not coalesce(p.is_suspended, false)
                          and exists (select 1 from public.ozellik_varsayilan_kapali o
                                      where o.ozellik_anahtari = 'duyuru_yonetimi' and o.rol = 'admin' and o.acik))
                     from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.duyuru_yonetim_yetkili() from public, anon;
grant execute on function public.duyuru_yonetim_yetkili() to authenticated;

-- ---------------------------------------------------------------------------- 2) tablolar
create table if not exists public.site_duyurulari (
  id             uuid primary key default gen_random_uuid(),
  baslik         text not null check (char_length(btrim(baslik)) between 1 and 120),
  metin          text not null check (char_length(btrim(metin)) between 1 and 2000),
  tur            text not null default 'bilgi' check (tur in ('bilgi', 'uyari', 'kritik')),
  hedef          text not null default 'hepsi' check (hedef in ('ziyaretci', 'uye', 'hepsi')),
  baglanti_url   text check (baglanti_url is null or (baglanti_url ~* '^https://' and char_length(baglanti_url) <= 500)),
  baglanti_metin text check (baglanti_metin is null or char_length(baglanti_metin) <= 40),
  aktif          boolean not null default false,
  baslangic      timestamptz,
  bitis          timestamptz,
  surum          integer not null default 1,                 -- içerik değişince artar → önceki okuyanlara yeniden gösterilir
  olusturan      uuid references public.profiles(id) on delete set null,
  guncelleyen    uuid references public.profiles(id) on delete set null,
  olusturma      timestamptz not null default now(),
  guncelleme     timestamptz not null default now(),
  check (bitis is null or baslangic is null or bitis > baslangic)
);
create index if not exists idx_site_duyurulari_aktif on public.site_duyurulari (aktif, hedef);

create table if not exists public.site_duyuru_okumalari (
  duyuru_id uuid not null references public.site_duyurulari(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  surum     integer not null,
  okundu    timestamptz not null default now(),
  primary key (duyuru_id, user_id)
);
create index if not exists idx_site_duyuru_okumalari_okundu on public.site_duyuru_okumalari (duyuru_id, okundu desc);

alter table public.site_duyurulari enable row level security;
alter table public.site_duyuru_okumalari enable row level security;
revoke all on public.site_duyurulari from anon, authenticated;
revoke all on public.site_duyuru_okumalari from anon, authenticated;

-- ---------------------------------------------------------------------------- 3) yardımcılar
create or replace function public._eposta_maskele(e text)
returns text language sql immutable as $$
  select case when e is null or position('@' in e) = 0 then null
    else left(split_part(e, '@', 1), 2) || '***@' || left(split_part(e, '@', 2), 1) || '***'
         || coalesce(substring(split_part(e, '@', 2) from '\.[^.]*$'), '') end;
$$;
revoke all on function public._eposta_maskele(text) from public, anon, authenticated;

create or replace function public._duyuru_denetim(p_metin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.denetim_kayitlari (aktor_id, aktor_email, aktor_rol, yontem, hedef_yol, sonuc, kaynak)
  select auth.uid(), p.email, p.role, 'PUT', left(p_metin, 500), 'izin_verildi', 'site_duyuru'
    from public.profiles p where p.id = auth.uid();
exception when others then null;          -- denetim yazılamasa da duyuru işlemi bozulmasın
end $$;
revoke all on function public._duyuru_denetim(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------- 4) herkese açık okuma (ziyaretçi + üye)
-- p_hedef: 'ziyaretci' (açılış penceresi) | 'uye' (panel şeridi; bu üyenin zaten okuduğu sürümler dışarıda bırakılır). En fazla 3 duyuru, kritik önce.
create or replace function public.aktif_duyurular(p_hedef text default 'ziyaretci')
returns table (id uuid, baslik text, metin text, tur text, baglanti_url text, baglanti_metin text, surum integer, bitis timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.baslik, d.metin, d.tur, d.baglanti_url, d.baglanti_metin, d.surum, d.bitis
  from public.site_duyurulari d
  where d.aktif
    and (d.baslangic is null or d.baslangic <= now())
    and (d.bitis is null or d.bitis > now())
    and d.hedef in ('hepsi', case when p_hedef = 'uye' then 'uye' else 'ziyaretci' end)
    and (p_hedef <> 'uye' or auth.uid() is null or not exists (
          select 1 from public.site_duyuru_okumalari o where o.duyuru_id = d.id and o.user_id = auth.uid() and o.surum >= d.surum))
  order by (d.tur = 'kritik') desc, (d.tur = 'uyari') desc, d.guncelleme desc
  limit 3;
$$;
revoke all on function public.aktif_duyurular(text) from public;
grant execute on function public.aktif_duyurular(text) to anon, authenticated;

-- Üye duyuruyu kapatınca: okuma kaydı (demo hesaplar kaydedilmez).
create or replace function public.duyuru_okundu_isaretle(p_id uuid, p_surum integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_surum integer;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'demo') then return; end if;
  select surum into v_surum from public.site_duyurulari where id = p_id;
  if v_surum is null then return; end if;
  insert into public.site_duyuru_okumalari as o (duyuru_id, user_id, surum, okundu)
  values (p_id, auth.uid(), least(coalesce(p_surum, v_surum), v_surum), now())
  on conflict (duyuru_id, user_id) do update set surum = greatest(o.surum, excluded.surum), okundu = now();
end $$;
revoke all on function public.duyuru_okundu_isaretle(uuid, integer) from public, anon;
grant execute on function public.duyuru_okundu_isaretle(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------- 5) yönetim (Site Sahibi + yetkili Yönetici)
create or replace function public.duyuru_listele()
returns table (id uuid, baslik text, metin text, tur text, hedef text, baglanti_url text, baglanti_metin text, aktif boolean,
               baslangic timestamptz, bitis timestamptz, surum integer, olusturma timestamptz, guncelleme timestamptz,
               okuyan_sayisi bigint, uye_sayisi bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_uye bigint;
begin
  if not public.duyuru_yonetim_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  select count(*) into v_uye from public.profiles where coalesce(role, '') <> 'demo';
  return query
    select d.id, d.baslik, d.metin, d.tur, d.hedef, d.baglanti_url, d.baglanti_metin, d.aktif, d.baslangic, d.bitis, d.surum, d.olusturma, d.guncelleme,
           (select count(*) from public.site_duyuru_okumalari o where o.duyuru_id = d.id), v_uye
    from public.site_duyurulari d order by d.guncelleme desc limit 100;
end $$;
revoke all on function public.duyuru_listele() from public, anon;
grant execute on function public.duyuru_listele() to authenticated;

create or replace function public.duyuru_kaydet(
  p_id uuid, p_baslik text, p_metin text, p_tur text, p_hedef text, p_baglanti_url text, p_baglanti_metin text,
  p_aktif boolean, p_baslangic timestamptz, p_bitis timestamptz, p_yeniden_goster boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_eski public.site_duyurulari;
begin
  if not public.duyuru_yonetim_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_tur not in ('bilgi', 'uyari', 'kritik') then raise exception 'Geçersiz tür.'; end if;
  if p_hedef not in ('ziyaretci', 'uye', 'hepsi') then raise exception 'Geçersiz hedef.'; end if;
  if p_id is null then
    insert into public.site_duyurulari (baslik, metin, tur, hedef, baglanti_url, baglanti_metin, aktif, baslangic, bitis, olusturan, guncelleyen)
    values (btrim(p_baslik), btrim(p_metin), p_tur, p_hedef, nullif(btrim(coalesce(p_baglanti_url, '')), ''), nullif(btrim(coalesce(p_baglanti_metin, '')), ''),
            coalesce(p_aktif, false), p_baslangic, p_bitis, auth.uid(), auth.uid())
    returning id into v_id;
    perform public._duyuru_denetim(format('Site duyurusu oluşturuldu · %s · %s', left(btrim(p_baslik), 80), case when p_aktif then 'yayında' else 'taslak' end));
  else
    select * into v_eski from public.site_duyurulari where id = p_id;
    if v_eski.id is null then raise exception 'Duyuru bulunamadı.'; end if;
    update public.site_duyurulari set
      baslik = btrim(p_baslik), metin = btrim(p_metin), tur = p_tur, hedef = p_hedef,
      baglanti_url = nullif(btrim(coalesce(p_baglanti_url, '')), ''), baglanti_metin = nullif(btrim(coalesce(p_baglanti_metin, '')), ''),
      aktif = coalesce(p_aktif, false), baslangic = p_baslangic, bitis = p_bitis, guncelleyen = auth.uid(), guncelleme = now(),
      surum = surum + (case when coalesce(p_yeniden_goster, false) or v_eski.baslik <> btrim(p_baslik) or v_eski.metin <> btrim(p_metin) then 1 else 0 end)
    where id = p_id;
    v_id := p_id;
    perform public._duyuru_denetim(format('Site duyurusu güncellendi · %s · %s', left(btrim(p_baslik), 80), case when p_aktif then 'yayında' else 'kapalı' end));
  end if;
  return v_id;
end $$;
revoke all on function public.duyuru_kaydet(uuid, text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.duyuru_kaydet(uuid, text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean) to authenticated;

create or replace function public.duyuru_durum_ayarla(p_id uuid, p_aktif boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.duyuru_yonetim_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  update public.site_duyurulari set aktif = coalesce(p_aktif, false), guncelleyen = auth.uid(), guncelleme = now() where id = p_id;
  perform public._duyuru_denetim(format('Site duyurusu %s · %s', case when p_aktif then 'yayına alındı' else 'kapatıldı' end, p_id));
end $$;
revoke all on function public.duyuru_durum_ayarla(uuid, boolean) from public, anon;
grant execute on function public.duyuru_durum_ayarla(uuid, boolean) to authenticated;

-- Okuyanlar: yalnızca duyuruyu KAPATAN üyeler. Arama (ad, soyad, e-posta) SUNUCUDA yapılır; e-posta maskeli döner.
create or replace function public.duyuru_okuyanlar(p_id uuid, p_ara text default null, p_limit integer default 30, p_offset integer default 0)
returns table (user_id uuid, ad text, eposta_maskeli text, rol text, okundu timestamptz, surum integer, toplam bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_ara text := nullif(btrim(coalesce(p_ara, '')), ''); v_kalip text;
begin
  if not public.duyuru_yonetim_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_ara is not null and char_length(v_ara) < 2 then raise exception 'Arama için en az 2 karakter yaz.'; end if;
  if v_ara is not null then v_kalip := '%' || replace(replace(replace(v_ara, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select o.user_id, coalesce(nullif(btrim(p.full_name), ''), '(adsız üye)'), public._eposta_maskele(p.email), p.role, o.okundu, o.surum, count(*) over ()
    from public.site_duyuru_okumalari o join public.profiles p on p.id = o.user_id
    where o.duyuru_id = p_id
      and (v_ara is null or p.first_name ilike v_kalip or p.last_name ilike v_kalip or p.full_name ilike v_kalip or p.email ilike v_kalip)
    order by o.okundu desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.duyuru_okuyanlar(uuid, text, integer, integer) from public, anon;
grant execute on function public.duyuru_okuyanlar(uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------- 6) SİLME: yalnızca Site Sahibi
create or replace function public.duyuru_sil(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Duyuruyu yalnızca Site Sahibi silebilir.' using errcode = '42501'; end if;
  delete from public.site_duyurulari where id = p_id;           -- okuma kayıtları CASCADE ile gider
  perform public._duyuru_denetim(format('Site duyurusu ve okuma kayıtları SİLİNDİ · %s', p_id));
end $$;
revoke all on function public.duyuru_sil(uuid) from public, anon;
grant execute on function public.duyuru_sil(uuid) to authenticated;

-- p_user null → duyurunun TÜM okuma kayıtları; dolu → yalnızca o üyenin kaydı. Dönüş: silinen satır sayısı.
create or replace function public.duyuru_okuma_kayitlarini_sil(p_id uuid, p_user uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_owner() then raise exception 'Okuma kayıtlarını yalnızca Site Sahibi silebilir.' using errcode = '42501'; end if;
  delete from public.site_duyuru_okumalari where duyuru_id = p_id and (p_user is null or user_id = p_user);
  get diagnostics v_n = row_count;
  perform public._duyuru_denetim(format('Duyuru okuma kayıtları silindi · duyuru %s · %s kayıt%s', p_id, v_n, case when p_user is null then '' else ' (tek üye)' end));
  return v_n;
end $$;
revoke all on function public.duyuru_okuma_kayitlarini_sil(uuid, uuid) from public, anon;
grant execute on function public.duyuru_okuma_kayitlarini_sil(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------- 7) HAVASTİL AI ANAHTAR KASASI (yalnızca ŞİFRELİ metin)
create table if not exists public.havastil_ai_kasasi (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  saglayici  text not null check (saglayici in ('gemini', 'openai', 'anthropic', 'openrouter')),
  sifreli    jsonb not null check (octet_length(sifreli::text) < 4096),   -- {v, kdf, it, tuz, iv, ct} (hepsi base64); düz anahtar ASLA
  model      text check (model is null or char_length(model) <= 120),
  guncelleme timestamptz not null default now(),
  primary key (user_id, saglayici)
);
alter table public.havastil_ai_kasasi enable row level security;
drop policy if exists havastil_ai_kasasi_sahip_oku on public.havastil_ai_kasasi;
drop policy if exists havastil_ai_kasasi_sahip_yaz on public.havastil_ai_kasasi;
create policy havastil_ai_kasasi_sahip_oku on public.havastil_ai_kasasi for select to authenticated
  using (user_id = auth.uid() and public.havastil_yetkisi_var_mi());
create policy havastil_ai_kasasi_sahip_yaz on public.havastil_ai_kasasi for all to authenticated
  using (user_id = auth.uid() and public.havastil_yetkisi_var_mi())
  with check (user_id = auth.uid() and public.havastil_yetkisi_var_mi());
revoke all on public.havastil_ai_kasasi from anon;
grant select, insert, update, delete on public.havastil_ai_kasasi to authenticated;

-- ============================================================================
-- BİTTİ. Sırada: Yetki Ayarları › Özellikler › "Site Duyuruları" (yalnızca Yönetici sütunu, varsayılan KAPALI).
-- ============================================================================
