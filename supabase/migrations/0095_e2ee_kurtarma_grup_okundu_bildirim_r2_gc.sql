-- ============================================================================
-- 0095_e2ee_kurtarma_grup_okundu_bildirim_r2_gc.sql
-- Gereksinim: 0057, 0081, 0091, 0092, 0093, 0094 çalıştırılmış olmalı.
-- Supabase SQL Editor'de TEK SEFERDE çalıştır. Tekrar çalıştırmak güvenlidir (idempotent).
--
-- NE DEĞİŞİYOR
--  1) E2EE KURTARMA PAROLASI: özel anahtar, Worker kasa anahtarına EK OLARAK kullanıcının Kurtarma Parolasından
--     (PBKDF2-SHA256 600k + AES-GCM) türetilen anahtarla da sarılır. "Özel anahtar açılamadı" hatasında parolayla
--     açılır ve Worker sarmalı kendiliğinden onarılır. Parola/anahtar sunucuya GİTMEZ; yalnızca sarılı blob saklanır.
--     Parolası olmayan + sarmalı bozulmuş hesap için e2ee_anahtari_sifirla (karşı taraf geçmişi yeniden paylaşır).
--  2) "HERKESTEN SİL": Site Sahibi dahi karşı tarafın mesajını herkesten silemez (yalnızca gönderen).
--  3) İLETİLDİ/OKUNDU: sohbet_karsi_okundu(p_id) — kimlik açıklamadan "karşı taraf en son ne zaman okudu".
--  4) GRUP SOHBETLERİ (Yönetim Ekip Odası + davet edilen üyeler): konusma_uyeleri, baslat_grup_sohbeti, grup_*.
--  5) SOHBET SESSİZE ALMA + WEB PUSH ABONELİKLERİ (isteğe bağlı): konusma_durumlari.sessiz, push_abonelikleri.
--  6) MESAJ YEDEĞİ İÇE AKTARMA (parolalı, evrensel): mesaj_yedek_ice_aktar — yeni anahtarla yeniden zarflanmış arşiv sohbeti.
--  7) R2 ÇÖP TOPLAYICI: sistem_r2_bilinmeyenleri — veritabanında karşılığı olmayan (hayalet) R2 nesnelerini bulmaya yarar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) E2EE KURTARMA PAROLASI
-- ----------------------------------------------------------------------------
alter table public.e2ee_kullanici_anahtarlari add column if not exists kurtarma_sarili_ozel_anahtar text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kurtarma_iv   text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kurtarma_tuz  text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kurtarma_kdf_tur integer;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kurtarma_at timestamptz;
alter table public.e2ee_kullanici_anahtarlari add column if not exists guncellendi_at timestamptz;

-- İstemci kendi satırının durumunu sorar (sarılı blob'lar yalnızca SELECT politikasıyla zaten kendisine açık).
create or replace function public.e2ee_durum()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('var', true, 'kurtarma_var', k.kurtarma_sarili_ozel_anahtar is not null, 'kurtarma_at', k.kurtarma_at)
    from public.e2ee_kullanici_anahtarlari k where k.kullanici_id = auth.uid()
  ), jsonb_build_object('var', false, 'kurtarma_var', false));
$$;
revoke all on function public.e2ee_durum() from public, anon;
grant execute on function public.e2ee_durum() to authenticated;

create or replace function public.e2ee_kurtarma_kaydet(p_sarili text, p_iv text, p_tuz text, p_tur integer)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 or char_length(p_sarili) > 4000 then raise exception 'Kurtarma verisi geçerli değil.'; end if;
  if p_iv  is null or p_iv  !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv)  <> 16 then raise exception 'IV geçerli değil.'; end if;
  if p_tuz is null or p_tuz !~ '^[A-Za-z0-9+/=]+$' or char_length(p_tuz) < 16 or char_length(p_tuz) > 64 then raise exception 'Tuz geçerli değil.'; end if;
  if p_tur is null or p_tur < 200000 or p_tur > 5000000 then raise exception 'KDF turu geçerli değil.'; end if;
  update public.e2ee_kullanici_anahtarlari
     set kurtarma_sarili_ozel_anahtar = p_sarili, kurtarma_iv = p_iv, kurtarma_tuz = p_tuz, kurtarma_kdf_tur = p_tur, kurtarma_at = now()
   where kullanici_id = auth.uid();
  if not found then raise exception 'Önce şifreleme anahtarın oluşturulmalı; sayfayı yenileyip tekrar dene.'; end if;
end;
$$;
revoke all on function public.e2ee_kurtarma_kaydet(text, text, text, integer) from public, anon;
grant execute on function public.e2ee_kurtarma_kaydet(text, text, text, integer) to authenticated;

-- Kurtarma parolasıyla açılan özel anahtar, GÜNCEL Worker kasa anahtarıyla yeniden sarılır (kendi kendini onarma).
-- Yalnızca kurtarma kopyası VARSA izin verilir: sarmalı bozarak anahtarı kilitleyen bir yazma kalıcı kayıp yaratamasın.
create or replace function public.e2ee_kasa_sarmalini_yenile(p_sarili text, p_iv text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 or char_length(p_sarili) > 4000 then raise exception 'Sarılı anahtar geçerli değil.'; end if;
  if p_iv is null or p_iv !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv) <> 16 then raise exception 'IV geçerli değil.'; end if;
  update public.e2ee_kullanici_anahtarlari
     set sarili_ozel_anahtar = p_sarili, iv = p_iv, guncellendi_at = now()
   where kullanici_id = auth.uid() and kurtarma_sarili_ozel_anahtar is not null;
  if not found then raise exception 'Kurtarma parolası tanımlı değil; sarmal güncellenemez.'; end if;
end;
$$;
revoke all on function public.e2ee_kasa_sarmalini_yenile(text, text) from public, anon;
grant execute on function public.e2ee_kasa_sarmalini_yenile(text, text) to authenticated;

-- SON ÇARE: kurtarma parolası yoksa ve Worker sarmalı açılamıyorsa YENİ anahtar çifti. Eski sohbet anahtar zarfların silinir;
-- sohbetin diğer tarafı (anahtarı bilen) sohbeti açınca yeni açık anahtarına göre zarfı otomatik tamamlar (mesaj_eksik_zarflar).
-- Şifreli özel dosya anahtarların (ozel_icerik_anahtarlar) eski anahtara bağlı olduğundan silinir: dosya sahibi yeniden paylaşmalı.
create or replace function public.e2ee_anahtari_sifirla(p_acik text, p_sarili text, p_iv text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_z integer := 0; v_d integer := 0;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_acik is null or p_acik !~ '^[A-Za-z0-9+/=]+$' or char_length(p_acik) < 300 then raise exception 'Açık anahtar geçerli değil.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 then raise exception 'Sarılı anahtar geçerli değil.'; end if;
  if p_iv is null or p_iv !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv) <> 16 then raise exception 'IV geçerli değil.'; end if;
  delete from public.konusma_zarflari where user_id = auth.uid();
  get diagnostics v_z = row_count;
  if to_regclass('public.ozel_icerik_anahtarlar') is not null then
    delete from public.ozel_icerik_anahtarlar where alici_id = auth.uid();
    get diagnostics v_d = row_count;
  end if;
  insert into public.e2ee_kullanici_anahtarlari (kullanici_id, acik_anahtar, sarili_ozel_anahtar, iv)
  values (auth.uid(), p_acik, p_sarili, p_iv)
  on conflict (kullanici_id) do update
    set acik_anahtar = excluded.acik_anahtar, sarili_ozel_anahtar = excluded.sarili_ozel_anahtar, iv = excluded.iv,
        kurtarma_sarili_ozel_anahtar = null, kurtarma_iv = null, kurtarma_tuz = null, kurtarma_kdf_tur = null, kurtarma_at = null,
        surum = public.e2ee_kullanici_anahtarlari.surum + 1, guncellendi_at = now();
  return jsonb_build_object('silinen_sohbet_zarfi', v_z, 'silinen_dosya_anahtari', v_d);
end;
$$;
revoke all on function public.e2ee_anahtari_sifirla(text, text, text) from public, anon;
grant execute on function public.e2ee_anahtari_sifirla(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) "HERKESTEN SİL" — YALNIZCA GÖNDEREN (Site Sahibi / yönetici dahi karşı tarafın mesajını herkesten silemez)
-- ----------------------------------------------------------------------------
create or replace function public.mesaji_herkesten_sil(p_message_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_m public.messages;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.'; end if;
  select * into v_m from public.messages where id = p_message_id;
  if not found then return; end if;
  if v_m.sender_id <> auth.uid() then
    raise exception 'Yalnızca kendi yazdığın mesajı herkesten silebilirsin. Karşı tarafın mesajı için “Sadece benden sil” kullanılır.';
  end if;
  if not public._konusma_erisimim_var_mi(v_m.conversation_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  delete from public.messages where id = p_message_id;
end;
$$;
revoke all on function public.mesaji_herkesten_sil(uuid) from public, anon;
grant execute on function public.mesaji_herkesten_sil(uuid) to authenticated;

-- RLS'te de aynı kural: messages DELETE yalnızca gönderen (eski politika owner/yöneticiye karşı taraf mesajı silmeyi açıyordu).
drop policy if exists "messages_delete_own_or_admin" on public.messages;
drop policy if exists "messages_delete_only_sender" on public.messages;
create policy "messages_delete_only_sender" on public.messages for delete to authenticated using (sender_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3) İLETİLDİ / OKUNDU
--    İletildi = mesaj sunucuya yazıldı (satır var). Okundu = karşı taraf okundu_at >= mesajın created_at.
--    1:1'de "en son okuyan"; grupta "en geç okuyan" (herkes okuduysa mavi tik). Kimlik/ad döndürülmez.
-- ----------------------------------------------------------------------------
create or replace function public.sohbet_karsi_okundu(p_id uuid)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v_c public.conversations; v_t timestamptz;
begin
  if not public._konusma_erisimim_var_mi(p_id) then return null; end if;
  select * into v_c from public.conversations where id = p_id;
  if coalesce(v_c.grup, false) then
    select min(coalesce(d.okundu_at, '-infinity'::timestamptz)) into v_t
    from public.konusma_uyeleri u
    left join public.konusma_durumlari d on d.conversation_id = u.conversation_id and d.user_id = u.user_id
    where u.conversation_id = p_id and u.user_id <> auth.uid();
  else
    select max(d.okundu_at) into v_t from public.konusma_durumlari d where d.conversation_id = p_id and d.user_id <> auth.uid();
  end if;
  if v_t = '-infinity'::timestamptz then return null; end if;
  return v_t;
end;
$$;
revoke all on function public.sohbet_karsi_okundu(uuid) from public, anon;
grant execute on function public.sohbet_karsi_okundu(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) GRUP SOHBETLERİ
-- ----------------------------------------------------------------------------
alter table public.conversations add column if not exists grup boolean not null default false;
alter table public.conversations add column if not exists ice_aktarma_kaynak uuid;
create unique index if not exists uq_conversations_ice_aktarma on public.conversations (user_id, ice_aktarma_kaynak) where ice_aktarma_kaynak is not null;

create table if not exists public.konusma_uyeleri (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  ekleyen_id      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists idx_konusma_uyeleri_user on public.konusma_uyeleri (user_id);
alter table public.konusma_uyeleri enable row level security;
revoke all on public.konusma_uyeleri from public, anon, authenticated;
grant select on public.konusma_uyeleri to authenticated;
drop policy if exists konusma_uye_kendi_oku on public.konusma_uyeleri;
create policy konusma_uye_kendi_oku on public.konusma_uyeleri for select to authenticated using (user_id = auth.uid());

-- Erişim kararı TEK yerde: tüm RLS politikaları (conversations/messages) bu fonksiyonu kullandığı için grup üyeliği otomatik yansır.
--  • Grupta: Site Sahibi (her zaman) ya da ÜYE. Diğer yöneticiler üye değilse GÖRMEZ (hedef_admin_id boşluğu grup için geçerli değildir).
--  • Normal sohbette: 0029 mantığı değişmedi.
create or replace function public._konusma_yonetici_erisimi_var_mi(p_konusma public.conversations)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_konusma.grup, false) then
      public.is_owner() or exists (select 1 from public.konusma_uyeleri u where u.conversation_id = p_konusma.id and u.user_id = auth.uid())
    else
      public.is_owner() or (public.is_admin() and (p_konusma.hedef_admin_id is null or p_konusma.hedef_admin_id = auth.uid()))
  end;
$$;
grant execute on function public._konusma_yonetici_erisimi_var_mi(public.conversations) to authenticated;

-- Taraflar (kalıcı silme mantığı): gruptaki üyeler de taraftır.
create or replace function public._konusma_taraflari(p_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x) filter (where x is not null), '{}'::uuid[])
  from (
    select c.user_id as x from public.conversations c where c.id = p_id
    union all select c.hedef_admin_id from public.conversations c where c.id = p_id
    union all select m.sender_id from public.messages m where m.conversation_id = p_id
    union all select u.user_id from public.konusma_uyeleri u where u.conversation_id = p_id
  ) t;
$$;
revoke all on function public._konusma_taraflari(uuid) from public, anon, authenticated;

-- Bir SOHBETİN zarflanması gereken kişiler (grup: üyeler + aktif site sahipleri; normal: 0093 mantığı).
create or replace function public._konusma_zarf_adaylari_konusma(p_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_c public.conversations;
begin
  select * into v_c from public.conversations where id = p_id;
  if not found then return '{}'::uuid[]; end if;
  if coalesce(v_c.grup, false) then
    return coalesce((select array_agg(distinct p.id) from public.profiles p
      where (p.id in (select u.user_id from public.konusma_uyeleri u where u.conversation_id = p_id)
             or (p.role = 'owner' and coalesce(p.is_suspended, false) = false))), '{}'::uuid[]);
  end if;
  return public._konusma_zarf_adaylari(v_c.user_id, v_c.hedef_admin_id);
end;
$$;
revoke all on function public._konusma_zarf_adaylari_konusma(uuid) from public, anon, authenticated;

create or replace function public.mesaj_eksik_zarflar(p_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_c public.conversations;
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  select * into v_c from public.conversations where id = p_id;
  if not v_c.e2ee then return '{}'::uuid[]; end if;
  return coalesce((
    select array_agg(a) from unnest(public._konusma_zarf_adaylari_konusma(p_id)) a
    where not exists (select 1 from public.konusma_zarflari z where z.conversation_id = p_id and z.user_id = a)
      and not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = p_id and g.user_id = a and g.kalici)
  ), '{}'::uuid[]);
end;
$$;
revoke all on function public.mesaj_eksik_zarflar(uuid) from public, anon;
grant execute on function public.mesaj_eksik_zarflar(uuid) to authenticated;

-- Grup kurulumunda zarflanacak kişiler: üyeler + kurucu + aktif site sahipleri. Yalnızca yönetici/site sahibi çağırabilir.
create or replace function public.grup_zarf_aday_idleri(p_uyeler uuid[])
returns uuid[] language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_owner()) then raise exception 'Grup yalnızca Site Sahibi ve yöneticiler tarafından kurulabilir.'; end if;
  return coalesce((select array_agg(distinct p.id) from public.profiles p
    where p.id = auth.uid() or p.id = any ((coalesce(p_uyeler, '{}'::uuid[]))[1:50])
       or (p.role = 'owner' and coalesce(p.is_suspended, false) = false)), '{}'::uuid[]);
end;
$$;
revoke all on function public.grup_zarf_aday_idleri(uuid[]) from public, anon;
grant execute on function public.grup_zarf_aday_idleri(uuid[]) to authenticated;

create or replace function public.baslat_grup_sohbeti(p_konu_sifreli text, p_uyeler uuid[], p_zarflar jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_u uuid; v_n integer;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not (public.is_admin() or public.is_owner()) then raise exception 'Grup yalnızca Site Sahibi ve yöneticiler tarafından kurulabilir.'; end if;
  if p_konu_sifreli is null or char_length(p_konu_sifreli) < 20 or char_length(p_konu_sifreli) > 1000 or p_konu_sifreli !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'Grup adı şifreli biçimde gönderilmelidir.';
  end if;
  insert into public.conversations (user_id, konu, created_by, hedef_admin_id, grup, e2ee, konu_sifreli)
  values (auth.uid(), 'Şifreli grup', auth.uid(), null, true, true, p_konu_sifreli) returning id into v_id;
  insert into public.konusma_uyeleri (conversation_id, user_id, ekleyen_id) values (v_id, auth.uid(), auth.uid()) on conflict do nothing;
  for v_u in select distinct x from unnest((coalesce(p_uyeler, '{}'::uuid[]))[1:50]) x loop
    if exists (select 1 from public.profiles p where p.id = v_u and coalesce(p.is_suspended, false) = false and p.role <> 'demo') then
      insert into public.konusma_uyeleri (conversation_id, user_id, ekleyen_id) values (v_id, v_u, auth.uid()) on conflict do nothing;
    end if;
  end loop;
  v_n := public._konusma_zarflarini_yaz(v_id, p_zarflar, public._konusma_zarf_adaylari_konusma(v_id));
  if v_n = 0 then raise exception 'Hiçbir geçerli zarf yazılamadı.'; end if;
  insert into public.konusma_durumlari (conversation_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.baslat_grup_sohbeti(text, uuid[], jsonb) from public, anon;
grant execute on function public.baslat_grup_sohbeti(text, uuid[], jsonb) to authenticated;

create or replace function public.grup_uye_ekle(p_id uuid, p_uye uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = p_id and c.grup) then raise exception 'Grup bulunamadı.'; end if;
  if not (public.is_owner() or exists (select 1 from public.konusma_uyeleri u where u.conversation_id = p_id and u.user_id = auth.uid() and (public.is_admin() or public.is_owner()))) then
    raise exception 'Gruba kişi ekleme yetkin yok.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_uye and coalesce(p.is_suspended, false) = false and p.role <> 'demo') then raise exception 'Kullanıcı bulunamadı.'; end if;
  insert into public.konusma_uyeleri (conversation_id, user_id, ekleyen_id) values (p_id, p_uye, auth.uid()) on conflict do nothing;
  -- Zarfı, anahtarı bilen bir üye sohbeti açınca mesaj_eksik_zarflar/mesaj_zarf_ekle ile tamamlanır.
end;
$$;
revoke all on function public.grup_uye_ekle(uuid, uuid) from public, anon;
grant execute on function public.grup_uye_ekle(uuid, uuid) to authenticated;

create or replace function public.grup_uye_cikar(p_id uuid, p_uye uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = p_id and c.grup) then raise exception 'Grup bulunamadı.'; end if;
  if p_uye <> auth.uid() and not (public.is_owner() or exists (select 1 from public.konusma_uyeleri u where u.conversation_id = p_id and u.user_id = auth.uid() and (public.is_admin() or public.is_owner()))) then
    raise exception 'Gruptan kişi çıkarma yetkin yok.';
  end if;
  delete from public.konusma_uyeleri where conversation_id = p_id and user_id = p_uye;
  delete from public.konusma_zarflari where conversation_id = p_id and user_id = p_uye; -- erişim ve anahtar zarfı kalkar
end;
$$;
revoke all on function public.grup_uye_cikar(uuid, uuid) from public, anon;
grant execute on function public.grup_uye_cikar(uuid, uuid) to authenticated;

-- Üye listesi: ad + rol (E-POSTA YOK).
create or replace function public.grup_uyeleri(p_id uuid)
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role from public.konusma_uyeleri u join public.profiles p on p.id = u.user_id
  where u.conversation_id = p_id and public._konusma_erisimim_var_mi(p_id)
  order by (p.role = 'owner') desc, p.full_name nulls last;
$$;
revoke all on function public.grup_uyeleri(uuid) from public, anon;
grant execute on function public.grup_uyeleri(uuid) to authenticated;

-- Grup arkadaşlarının adları herkese görünür olsun (üyeler birbirini gösterebilsin) — e-posta yalnızca yöneticiye.
create or replace function public.mesaj_kisi_bilgileri(p_ids uuid[])
returns table (id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, case when public.is_admin() or public.is_owner() then p.email else null end as email, p.role
  from public.profiles p
  where auth.uid() is not null and p.id = any (p_ids[1:200])
    and (
      public.is_admin() or public.is_owner() or p.id = auth.uid()
      or (p.role in ('admin', 'owner') and coalesce(p.is_suspended, false) = false)
      or exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id where m.sender_id = p.id and c.user_id = auth.uid())
      or exists (select 1 from public.konusma_uyeleri a join public.konusma_uyeleri b on b.conversation_id = a.conversation_id where a.user_id = auth.uid() and b.user_id = p.id)
    );
$$;
revoke execute on function public.mesaj_kisi_bilgileri(uuid[]) from public, anon;
grant execute on function public.mesaj_kisi_bilgileri(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) SESSİZE ALMA + WEB PUSH ABONELİKLERİ
-- ----------------------------------------------------------------------------
alter table public.konusma_durumlari add column if not exists sessiz boolean not null default false;

create or replace function public.konusmayi_sessize_al(p_id uuid, p_sessiz boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  insert into public.konusma_durumlari (conversation_id, user_id, sessiz, okundu_at)
  values (p_id, auth.uid(), coalesce(p_sessiz, false), now() - interval '100 years')
  on conflict (conversation_id, user_id) do update set sessiz = coalesce(p_sessiz, false);
end;
$$;
revoke all on function public.konusmayi_sessize_al(uuid, boolean) from public, anon;
grant execute on function public.konusmayi_sessize_al(uuid, boolean) to authenticated;

-- Web Push abonelikleri (isteğe bağlı; gönderici sunucu ayrıca kurulmalıdır — rehbere bak). Kullanıcı yalnızca kendi satırlarını görür/yazar.
create table if not exists public.push_abonelikleri (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  endpoint   text not null check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_abonelikleri enable row level security;
revoke all on public.push_abonelikleri from public, anon, authenticated;
grant select, insert, delete on public.push_abonelikleri to authenticated;
drop policy if exists push_abonelik_kendi_oku on public.push_abonelikleri;
drop policy if exists push_abonelik_kendi_ekle on public.push_abonelikleri;
drop policy if exists push_abonelik_kendi_sil on public.push_abonelikleri;
create policy push_abonelik_kendi_oku  on public.push_abonelikleri for select to authenticated using (user_id = auth.uid());
create policy push_abonelik_kendi_ekle on public.push_abonelikleri for insert to authenticated with check (user_id = auth.uid());
create policy push_abonelik_kendi_sil  on public.push_abonelikleri for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6) MESAJ YEDEĞİ İÇE AKTARMA (parolalı yedekten; hedef hesabın açık anahtarına YENİDEN ZARFLANMIŞ arşiv sohbeti)
--    İstemci yedeği parolayla çözer, mesajları YENİ bir sohbet anahtarıyla yeniden şifreler ve zarfı hedef hesabın açık
--    anahtarıyla sarar. Arşiv, tek üyeli GRUP olarak açılır: başka yönetici (hedef boş = herkes) göremez; yalnızca sahibi (+ Site Sahibi).
--    Aynı kaynak sohbet ikinci kez içe aktarılırsa yinelenmez (ice_aktarma_kaynak).
-- ----------------------------------------------------------------------------
create or replace function public.mesaj_yedek_ice_aktar(p_kaynak uuid, p_konu_sifreli text, p_zarflar jsonb, p_mesajlar jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_m jsonb; v_s uuid; v_n integer := 0; v_son timestamptz;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_kaynak is null then raise exception 'Kaynak sohbet kimliği gerekli.'; end if;
  if p_konu_sifreli is null or char_length(p_konu_sifreli) < 20 or char_length(p_konu_sifreli) > 1000 or p_konu_sifreli !~ '^[A-Za-z0-9+/=]+$' then raise exception 'Konu şifreli biçimde gönderilmelidir.'; end if;
  if p_mesajlar is null or jsonb_typeof(p_mesajlar) <> 'array' or jsonb_array_length(p_mesajlar) > 3000 then raise exception 'Mesaj listesi geçersiz (en çok 3000).'; end if;
  select c.id into v_id from public.conversations c where c.user_id = auth.uid() and c.ice_aktarma_kaynak = p_kaynak;
  if v_id is not null then return jsonb_build_object('id', v_id, 'yeni', false, 'mesaj', 0); end if;

  insert into public.conversations (user_id, konu, created_by, hedef_admin_id, grup, e2ee, konu_sifreli, ice_aktarma_kaynak)
  values (auth.uid(), 'Şifreli sohbet', auth.uid(), null, true, true, p_konu_sifreli, p_kaynak) returning id into v_id;
  insert into public.konusma_uyeleri (conversation_id, user_id, ekleyen_id) values (v_id, auth.uid(), auth.uid());
  if public._konusma_zarflarini_yaz(v_id, p_zarflar, public._konusma_zarf_adaylari_konusma(v_id)) = 0 then raise exception 'Hiçbir geçerli zarf yazılamadı.'; end if;

  for v_m in select e from jsonb_array_elements(p_mesajlar) e loop
    continue when (v_m ->> 'body') is null or (v_m ->> 'body') !~ '^[A-Za-z0-9+/=]+$';
    v_s := auth.uid();
    if nullif(v_m ->> 'gonderen', '') is not null and exists (select 1 from public.profiles p where p.id = (v_m ->> 'gonderen')::uuid) then v_s := (v_m ->> 'gonderen')::uuid; end if;
    insert into public.messages (conversation_id, sender_id, body, sifreli, created_at)
    values (v_id, v_s, v_m ->> 'body', true, coalesce(nullif(v_m ->> 'created_at', '')::timestamptz, now()));
    v_n := v_n + 1;
  end loop;
  select max(created_at) into v_son from public.messages where conversation_id = v_id;
  update public.conversations set son_mesaj_at = coalesce(v_son, now()) where id = v_id;
  insert into public.konusma_durumlari (conversation_id, user_id, okundu_at) values (v_id, auth.uid(), now()) on conflict (conversation_id, user_id) do update set okundu_at = now();
  return jsonb_build_object('id', v_id, 'yeni', true, 'mesaj', v_n);
end;
$$;
revoke all on function public.mesaj_yedek_ice_aktar(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.mesaj_yedek_ice_aktar(uuid, text, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) R2 ÇÖP TOPLAYICI — veritabanında karşılığı olmayan nesneleri bul (SİLMEZ; silme mevcut /r2/sil akışıyla, owner onayıyla).
-- ----------------------------------------------------------------------------
create or replace function public.sistem_r2_bilinmeyenleri(p_kaynak text, p_anahtarlar text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_owner() then raise exception 'Yalnızca Site Sahibi.'; end if;
  if p_anahtarlar is null or coalesce(array_length(p_anahtarlar, 1), 0) > 1000 then raise exception 'En çok 1000 anahtar.'; end if;
  if p_kaynak = 'arsiv' then
    select coalesce(array_agg(k), '{}') into v from unnest(p_anahtarlar) k
     where not exists (select 1 from public.r2_arsiv a where a.r2_key = k);
  elsif p_kaynak = 'notek' then
    select coalesce(array_agg(k), '{}') into v from unnest(p_anahtarlar) k
     where not exists (select 1 from public.not_ek_kayitlari n where n.r2_key = k);
  elsif p_kaynak = 'akademik' then
    select coalesce(array_agg(k), '{}') into v from unnest(p_anahtarlar) k
     where not exists (select 1 from public.akademik_kaynaklar a where a.pdf_r2_yolu = k);
  else
    raise exception 'Geçersiz kaynak.';
  end if;
  return v;
end;
$$;
revoke all on function public.sistem_r2_bilinmeyenleri(text, text[]) from public, anon;
grant execute on function public.sistem_r2_bilinmeyenleri(text, text[]) to authenticated;


-- ----------------------------------------------------------------------------
-- 8) ALICI ARAMASI: yönetici ÜYEYİ E-POSTA İLE de bulabilir — ama sonuçta e-posta ASLA dönmez (yalnızca ad + rol).
-- ----------------------------------------------------------------------------
create or replace function public.mesaj_alici_listesi(
  p_grup text default null, p_q text default '', p_limit integer default 20, p_ofset integer default 0
)
returns table (id uuid, ad text, rol text, toplam bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_q, '')), '%', ''), '_', ''), '\', '');
begin
  if not (public.is_admin() or public.is_owner()) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_grup is not null and p_grup not in ('yonetim', 'icerik', 'ozel', 'uye', 'demo') then raise exception 'Geçersiz grup.'; end if;
  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz üye') as ad, p.role::text, count(*) over ()
  from public.profiles p
  where p.id <> auth.uid()
    and coalesce(p.is_suspended, false) = false
    and (p_grup is null or public._mesaj_grup(p.role::text) = p_grup)
    and (v_q = '' or p.full_name ilike '%' || v_q || '%' or (char_length(v_q) >= 3 and p.email ilike '%' || v_q || '%'))
  order by p.full_name nulls last, p.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_ofset, 0));
end;
$$;
revoke all on function public.mesaj_alici_listesi(text, text, integer, integer) from public, anon;
grant execute on function public.mesaj_alici_listesi(text, text, integer, integer) to authenticated;


-- ----------------------------------------------------------------------------
-- 9) YEDEK KAYIT LİSTESİ: grup üyelikleri de tam sistem yedeğine girer (0094 listesi + konusma_uyeleri).
--    (Geri yükleme RPC'leri kayıt listesinden beslenir; FK sırası istemcide: conversations → konusma_uyeleri → konusma_zarflari.)
-- ----------------------------------------------------------------------------
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
    ('konusma_durumlari',           'veri',   'user_id = auth.uid()',      false, false),
    ('konusma_uyeleri',             'veri',   'user_id = auth.uid()',      false, false)
  ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas);
$$;
-- ============================================================================
-- BİTTİ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10) MESAJ YEDEĞİ İÇE AKTARMA — 2. aşama: mesajlar YENİ sohbet kimliğiyle (AAD = sohbet kimliği) şifrelenip eklenir.
--     Yalnızca kendi arşiv sohbetine (ice_aktarma_kaynak dolu, tek üyeli grup) ve yalnızca boşken (tekrar içe aktarma yinelemez).
-- ----------------------------------------------------------------------------
create or replace function public.mesaj_yedek_mesaj_ekle(p_id uuid, p_mesajlar jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_m jsonb; v_s uuid; v_n integer := 0; v_son timestamptz;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not exists (select 1 from public.conversations c where c.id = p_id and c.user_id = auth.uid() and c.ice_aktarma_kaynak is not null) then raise exception 'Arşiv sohbeti bulunamadı.'; end if;
  if exists (select 1 from public.messages m where m.conversation_id = p_id) then return 0; end if;
  if p_mesajlar is null or jsonb_typeof(p_mesajlar) <> 'array' or jsonb_array_length(p_mesajlar) > 3000 then raise exception 'Mesaj listesi geçersiz (en çok 3000).'; end if;
  for v_m in select e from jsonb_array_elements(p_mesajlar) e loop
    continue when (v_m ->> 'body') is null or (v_m ->> 'body') !~ '^[A-Za-z0-9+/=]+$';
    v_s := auth.uid();
    if nullif(v_m ->> 'gonderen', '') is not null and exists (select 1 from public.profiles p where p.id = (v_m ->> 'gonderen')::uuid) then v_s := (v_m ->> 'gonderen')::uuid; end if;
    insert into public.messages (conversation_id, sender_id, body, sifreli, created_at)
    values (p_id, v_s, v_m ->> 'body', true, coalesce(nullif(v_m ->> 'created_at', '')::timestamptz, now()));
    v_n := v_n + 1;
  end loop;
  select max(created_at) into v_son from public.messages where conversation_id = p_id;
  update public.conversations set son_mesaj_at = coalesce(v_son, now()) where id = p_id;
  return v_n;
end;
$$;
revoke all on function public.mesaj_yedek_mesaj_ekle(uuid, jsonb) from public, anon;
grant execute on function public.mesaj_yedek_mesaj_ekle(uuid, jsonb) to authenticated;
