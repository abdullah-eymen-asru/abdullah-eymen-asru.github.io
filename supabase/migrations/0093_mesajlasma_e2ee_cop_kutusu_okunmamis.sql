-- ============================================================================
-- 0093_mesajlasma_e2ee_cop_kutusu_okunmamis.sql
-- Gereksinim: 0006, 0019, 0025, 0029, 0045, 0057 (e2ee_kullanici_anahtarlari), 0091 çalıştırılmış olmalı.
-- Supabase SQL Editor'de TEK SEFERDE çalıştır. Tekrar çalıştırmak güvenlidir (idempotent).
--
-- NE DEĞİŞİYOR
--  1) UÇTAN UCA ŞİFRELİ MESAJLAŞMA (E2EE)
--     - Her sohbetin rastgele bir AES-GCM-256 anahtarı vardır (tarayıcıda üretilir).
--     - Bu anahtar, sohbete erişebilen HER kişinin RSA-OAEP açık anahtarıyla (0057'deki e2ee_kullanici_anahtarlari)
--       zarflanır ve konusma_zarflari tablosuna yazılır. Sunucu anahtarı HİÇ görmez.
--     - messages.body artık şifreli metindir (base64: iv | şifreli+etiket). messages.sifreli = true.
--     - conversations.konu_sifreli: konu başlığı da aynı anahtarla şifrelenir (conversations.konu = 'Şifreli sohbet').
--     - Şifreli sohbette düz metin yazmak TRİGGER ile engellenir (veritabanına açık metin girmez).
--     - Eski (düz metin) sohbetler okunmaya devam eder; ilk yeni mesajda sohbet otomatik şifreli sürüme yükseltilir
--       (konusmayi_sifrele). Eski mesajlar düz kalır (sifreli=false) ve tam sistem yedeğine varsayılan olarak GİRMEZ.
--  2) GRANÜLER SİLME
--     - "Sadece benden sil"  : mesaji_kendimden_gizle (0019/0029, DEĞİŞMEDİ).
--     - "Herkesten sil"      : mesaji_herkesten_sil — satır GERÇEKTEN silinir (yalnızca gönderen ya da Site Sahibi).
--  3) ÇÖP KUTUSU (iki aşamalı silme)
--     - X → konusmayi_kendimden_gizle (0019/0029, DEĞİŞMEDİ): sohbet benim için çöp kutusuna taşınır.
--     - cop_kutusu_listele / konusmayi_geri_al / konusmayi_kalici_sil / cop_kutusunu_bosalt.
--     - Kalıcı silme: zarfım (anahtarım) yok edilir; sohbetin TARAFLARI (üye + hedef yönetici + yazan herkes) hepsi kalıcı
--       sildiyse sohbet, mesaj gövdeleri, zarflar, gizleme/okuma/sabitleme izleri veritabanından TAMAMEN silinir.
--  4) OKUNMAMIŞ + SABİTLEME: konusma_durumlari (okundu_at, sabit), okunmamis_mesaj_ozeti().
--  5) GERİYE DÖNÜK TEMİZLİK: mesajlasma_yetim_temizle() (Site Sahibi / SQL Editor / cron) + günlük cron fonksiyonu güncellendi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLONLAR
-- ----------------------------------------------------------------------------
alter table public.conversations add column if not exists e2ee boolean not null default false;
alter table public.conversations add column if not exists konu_sifreli text;

alter table public.messages add column if not exists sifreli boolean not null default false;

-- Şifreli gövde base64 olduğu için 4000 karakter sınırı yetmez (2000 karakterlik Türkçe metin ≈ 5,4 KB base64).
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.messages'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%body%'
      and con.conname <> 'messages_body_uzunluk_chk'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.messages'::regclass and conname = 'messages_body_uzunluk_chk') then
    alter table public.messages
      add constraint messages_body_uzunluk_chk
      check (char_length(btrim(body)) > 0 and char_length(body) <= 12000);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) YENİ TABLOLAR
-- ----------------------------------------------------------------------------
create table if not exists public.konusma_zarflari (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  zarf            text not null check (char_length(zarf) between 200 and 1200), -- base64 RSA-OAEP(AES-256 sohbet anahtarı)
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
comment on table public.konusma_zarflari is
  'Sohbet anahtarının (AES-256) her katılımcının RSA açık anahtarıyla zarflanmış hâli. Kişi kalıcı sildiğinde zarfı da silinir (kriptografik imha).';
create index if not exists idx_konusma_zarflari_user on public.konusma_zarflari (user_id);

create table if not exists public.konusma_durumlari (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  sabit           boolean not null default false,
  sabit_at        timestamptz,
  okundu_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
comment on table public.konusma_durumlari is 'Kişi başına sohbet durumu: sabitleme (pin) ve en son okunma zamanı (okunmamış sayacı için).';
create index if not exists idx_konusma_durumlari_user on public.konusma_durumlari (user_id);

alter table public.konusma_gizlemeleri add column if not exists kalici boolean not null default false;
alter table public.konusma_gizlemeleri add column if not exists kalici_at timestamptz;

-- ----------------------------------------------------------------------------
-- 3) RLS — bu tablolar yalnızca OKUNUR (kendi satırım); yazma SECURITY DEFINER RPC'lerle.
-- ----------------------------------------------------------------------------
alter table public.konusma_zarflari enable row level security;
alter table public.konusma_durumlari enable row level security;
revoke all on public.konusma_zarflari from public, anon, authenticated;
revoke all on public.konusma_durumlari from public, anon, authenticated;
grant select on public.konusma_zarflari to authenticated;
grant select on public.konusma_durumlari to authenticated;

drop policy if exists konusma_zarf_kendi_oku on public.konusma_zarflari;
create policy konusma_zarf_kendi_oku on public.konusma_zarflari for select to authenticated using (user_id = auth.uid());
drop policy if exists konusma_durum_kendi_oku on public.konusma_durumlari;
create policy konusma_durum_kendi_oku on public.konusma_durumlari for select to authenticated using (user_id = auth.uid());

-- Gizleme tablosuna doğrudan INSERT kapatılır: "kalici" bayrağı yalnızca RPC ile konabilir.
drop policy if exists "konusma_gizleme_insert_own" on public.konusma_gizlemeleri;
revoke insert, update, delete on public.konusma_gizlemeleri from authenticated;

-- ----------------------------------------------------------------------------
-- 4) YARDIMCI FONKSİYONLAR
-- ----------------------------------------------------------------------------
-- Bir sohbetin TARAFLARI: üye + hedef yönetici + sohbette en az bir mesaj yazmış herkes.
create or replace function public._konusma_taraflari(p_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x) filter (where x is not null), '{}'::uuid[])
  from (
    select c.user_id as x from public.conversations c where c.id = p_id
    union all select c.hedef_admin_id from public.conversations c where c.id = p_id
    union all select m.sender_id from public.messages m where m.conversation_id = p_id
  ) t;
$$;
revoke all on function public._konusma_taraflari(uuid) from public, anon, authenticated;

-- Sohbete erişimim var mı? (üye ya da yönetici erişimi; gizleme kontrol EDİLMEZ — çöp kutusu da erişimdir)
create or replace function public._konusma_erisimim_var_mi(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_id and auth.uid() is not null
      and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
  );
$$;
revoke all on function public._konusma_erisimim_var_mi(uuid) from public, anon, authenticated;

-- Sohbet anahtarının zarflanması GEREKEN kişiler: üye + (hedef yönetici | tüm aktif yöneticiler) + tüm aktif site sahipleri.
-- (RLS'teki _konusma_yonetici_erisimi_var_mi ile AYNI görünürlük kümesi.)
create or replace function public._konusma_zarf_adaylari(p_uye uuid, p_hedef uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  from public.profiles p
  where p.id = p_uye
     or (coalesce(p.is_suspended, false) = false and (
           p.role = 'owner'
           or (p.role = 'admin' and (p_hedef is null or p.id = p_hedef))
        ));
$$;
revoke all on function public._konusma_zarf_adaylari(uuid, uuid) from public, anon, authenticated;

-- jsonb [{user_id, zarf}] → izinli kişilere zarf yazar; yazılan satır sayısını döner.
create or replace function public._konusma_zarflarini_yaz(p_id uuid, p_zarflar jsonb, p_adaylar uuid[])
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare z jsonb; v_uid uuid; v_zarf text; v_n integer := 0;
begin
  if p_zarflar is null or jsonb_typeof(p_zarflar) <> 'array' then raise exception 'Zarflar bir JSON dizisi olmalı.'; end if;
  if jsonb_array_length(p_zarflar) > 100 then raise exception 'En çok 100 zarf.'; end if;
  for z in select e from jsonb_array_elements(p_zarflar) e loop
    v_uid := nullif(z ->> 'user_id', '')::uuid;
    v_zarf := z ->> 'zarf';
    if v_uid is null or v_zarf is null then continue; end if;
    if not (v_uid = any (p_adaylar)) then continue; end if; -- listede olmayan kişiye zarf yazılamaz
    insert into public.konusma_zarflari (conversation_id, user_id, zarf) values (p_id, v_uid, v_zarf)
    on conflict (conversation_id, user_id) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._konusma_zarflarini_yaz(uuid, jsonb, uuid[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) E2EE RPC'LERİ
-- ----------------------------------------------------------------------------
-- İstemci yeni şifreli sohbet açmadan önce kimlere zarf yazacağını sorar. Yönetici başkası adına açıyorsa p_uye verir.
create or replace function public.mesaj_zarf_aday_idleri(p_uye uuid default null, p_hedef_admin uuid default null)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v_uye uuid; v_hedef uuid := null;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  v_uye := case when public.is_admin() and p_uye is not null then p_uye else auth.uid() end;
  if p_hedef_admin is not null and exists (
    select 1 from public.profiles where id = p_hedef_admin and role in ('admin', 'owner') and coalesce(is_suspended, false) = false
  ) then v_hedef := p_hedef_admin; end if;
  return public._konusma_zarf_adaylari(v_uye, v_hedef);
end;
$$;
revoke all on function public.mesaj_zarf_aday_idleri(uuid, uuid) from public, anon;
grant execute on function public.mesaj_zarf_aday_idleri(uuid, uuid) to authenticated;

-- Yeni ŞİFRELİ sohbet. baslat_konusma (0025) yeniden kullanılır: yetki/hedef doğrulaması orada.
create or replace function public.baslat_konusma_sifreli(
  p_konu_sifreli text,
  p_zarflar jsonb,
  p_hedef_kullanici_id uuid default null,
  p_hedef_admin_id uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_c public.conversations; v_adaylar uuid[]; v_n integer;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.'; end if;
  if p_konu_sifreli is null or char_length(p_konu_sifreli) < 20 or char_length(p_konu_sifreli) > 1000 or p_konu_sifreli !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'Konu şifreli biçimde gönderilmelidir.';
  end if;
  v_id := public.baslat_konusma('Şifreli sohbet', p_hedef_kullanici_id, p_hedef_admin_id);
  select * into v_c from public.conversations where id = v_id;
  v_adaylar := public._konusma_zarf_adaylari(v_c.user_id, v_c.hedef_admin_id);
  v_n := public._konusma_zarflarini_yaz(v_id, p_zarflar, v_adaylar);
  if v_n = 0 then raise exception 'Hiçbir geçerli zarf yazılamadı.'; end if;
  update public.conversations set e2ee = true, konu_sifreli = p_konu_sifreli where id = v_id;
  insert into public.konusma_durumlari (conversation_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.baslat_konusma_sifreli(text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.baslat_konusma_sifreli(text, jsonb, uuid, uuid) to authenticated;

-- Eski (düz metin) sohbeti şifreli sürüme yükseltir. İki kişi aynı anda denerse kazanan tek kişidir; diğeri "zaten şifreli" alır.
create or replace function public.konusmayi_sifrele(p_id uuid, p_konu_sifreli text, p_zarflar jsonb)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_c public.conversations; v_n integer;
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  if p_konu_sifreli is null or char_length(p_konu_sifreli) < 20 or char_length(p_konu_sifreli) > 1000 or p_konu_sifreli !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'Konu şifreli biçimde gönderilmelidir.';
  end if;
  select * into v_c from public.conversations where id = p_id for update;
  if v_c.e2ee then return false; end if;
  v_n := public._konusma_zarflarini_yaz(p_id, p_zarflar, public._konusma_zarf_adaylari(v_c.user_id, v_c.hedef_admin_id));
  if v_n = 0 then raise exception 'Hiçbir geçerli zarf yazılamadı.'; end if;
  update public.conversations set e2ee = true, konu_sifreli = p_konu_sifreli where id = p_id;
  return true;
end;
$$;
revoke all on function public.konusmayi_sifrele(uuid, text, jsonb) from public, anon;
grant execute on function public.konusmayi_sifrele(uuid, text, jsonb) to authenticated;

-- Zarfı eksik olan (sonradan atanan / anahtarı geç oluşan) yetkili kişiler.
create or replace function public.mesaj_eksik_zarflar(p_id uuid)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v_c public.conversations;
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  select * into v_c from public.conversations where id = p_id;
  if not v_c.e2ee then return '{}'::uuid[]; end if;
  return coalesce((
    select array_agg(a) from unnest(public._konusma_zarf_adaylari(v_c.user_id, v_c.hedef_admin_id)) a
    where not exists (select 1 from public.konusma_zarflari z where z.conversation_id = p_id and z.user_id = a)
      and not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = p_id and g.user_id = a and g.kalici)
  ), '{}'::uuid[]);
end;
$$;
revoke all on function public.mesaj_eksik_zarflar(uuid) from public, anon;
grant execute on function public.mesaj_eksik_zarflar(uuid) to authenticated;

-- Anahtarı BİLEN (zarfı olan) kişi, eksik zarfları tamamlar.
create or replace function public.mesaj_zarf_ekle(p_id uuid, p_zarflar jsonb)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare v_c public.conversations;
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  if not exists (select 1 from public.konusma_zarflari z where z.conversation_id = p_id and z.user_id = auth.uid()) then
    raise exception 'Bu sohbetin anahtarına sahip değilsin.';
  end if;
  select * into v_c from public.conversations where id = p_id;
  return public._konusma_zarflarini_yaz(p_id, p_zarflar, coalesce(public.mesaj_eksik_zarflar(p_id), '{}'::uuid[]));
end;
$$;
revoke all on function public.mesaj_zarf_ekle(uuid, jsonb) from public, anon;
grant execute on function public.mesaj_zarf_ekle(uuid, jsonb) to authenticated;

-- Şifreli sohbette düz metin / düz sohbette şifreli metin yazılamaz.
create or replace function public.mesaj_sifreleme_zorla()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_e2ee boolean;
begin
  select c.e2ee into v_e2ee from public.conversations c where c.id = new.conversation_id;
  -- Sistem geri yüklemesi (0094) yükseltilmiş sohbetteki ESKİ düz metin mesajları da geri yazar: yalnızca YENİ (son 5 dk)
  -- düz metin girişi engellenir; eski tarihli satırlar (yedekten dönen) geçer.
  if coalesce(v_e2ee, false) and not new.sifreli and new.created_at > now() - interval '5 minutes' then
    raise exception 'Bu sohbet uçtan uca şifrelidir: düz metin mesaj yazılamaz.';
  end if;
  if new.sifreli and not coalesce(v_e2ee, false) then
    raise exception 'Şifreli mesaj yalnızca şifreli sohbete yazılabilir.';
  end if;
  if new.sifreli and (new.body !~ '^[A-Za-z0-9+/=]+$' or char_length(new.body) < 40) then
    raise exception 'Şifreli mesaj gövdesi geçerli değil.';
  end if;
  return new;
end;
$$;
revoke execute on function public.mesaj_sifreleme_zorla() from public, anon, authenticated;
drop trigger if exists trg_messages_sifreleme_zorla on public.messages;
create trigger trg_messages_sifreleme_zorla
  before insert on public.messages
  for each row execute function public.mesaj_sifreleme_zorla();

-- ----------------------------------------------------------------------------
-- 6) "HERKESTEN SİL"
-- ----------------------------------------------------------------------------
create or replace function public.mesaji_herkesten_sil(p_message_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_m public.messages;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.'; end if;
  select * into v_m from public.messages where id = p_message_id;
  if not found then return; end if;
  if not (v_m.sender_id = auth.uid() or public.is_owner()) then
    raise exception 'Yalnızca kendi mesajını herkesten silebilirsin.';
  end if;
  if not public._konusma_erisimim_var_mi(v_m.conversation_id) and not public.is_owner() then
    raise exception 'Bu sohbete erişimin yok.';
  end if;
  delete from public.messages where id = p_message_id; -- mesaj_gizlemeleri CASCADE ile gider
end;
$$;
revoke all on function public.mesaji_herkesten_sil(uuid) from public, anon;
grant execute on function public.mesaji_herkesten_sil(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) YENİ MESAJ GELİNCE ÇÖPTEKİ SOHBET GERİ GELİR — ama KALICI silenin gizlemesi KORUNUR.
-- ----------------------------------------------------------------------------
create or replace function public.konusma_yeni_mesajda_gizlemeyi_kaldir()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.konusma_gizlemeleri where conversation_id = new.conversation_id and kalici = false;
  return new;
end;
$$;
revoke execute on function public.konusma_yeni_mesajda_gizlemeyi_kaldir() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8) ÇÖP KUTUSU
-- ----------------------------------------------------------------------------
create or replace function public.cop_kutusu_listele()
returns table (
  id uuid, user_id uuid, hedef_admin_id uuid, konu text, konu_sifreli text, e2ee boolean,
  son_mesaj_at timestamptz, gizlendi_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, c.hedef_admin_id, c.konu, c.konu_sifreli, c.e2ee, c.son_mesaj_at, g.gizlendi_at
  from public.konusma_gizlemeleri g
  join public.conversations c on c.id = g.conversation_id
  where g.user_id = auth.uid() and g.kalici = false
    and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
  order by g.gizlendi_at desc
  limit 500;
$$;
revoke all on function public.cop_kutusu_listele() from public, anon;
grant execute on function public.cop_kutusu_listele() to authenticated;

create or replace function public.konusmayi_geri_al(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  delete from public.konusma_gizlemeleri where conversation_id = p_id and user_id = auth.uid() and kalici = false;
end;
$$;
revoke all on function public.konusmayi_geri_al(uuid) from public, anon;
grant execute on function public.konusmayi_geri_al(uuid) to authenticated;

-- Tüm taraflar kalıcı sildiyse sohbeti (mesajlar, zarflar, gizleme/okuma izleri CASCADE ile) tamamen siler.
create or replace function public._konusma_tamamen_silinmeli_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = p_id)
     and not exists (
       select 1 from unnest(public._konusma_taraflari(p_id)) u
       where not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = p_id and g.user_id = u and g.kalici)
     );
$$;
revoke all on function public._konusma_tamamen_silinmeli_mi(uuid) from public, anon, authenticated;

create or replace function public.konusmayi_kalici_sil(p_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_silindi boolean := false;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = p_id and g.user_id = auth.uid()) then
    raise exception 'Önce sohbeti çöp kutusuna taşımalısın.';
  end if;
  update public.konusma_gizlemeleri set kalici = true, kalici_at = now()
   where conversation_id = p_id and user_id = auth.uid();
  delete from public.konusma_zarflari   where conversation_id = p_id and user_id = auth.uid(); -- kriptografik imha
  delete from public.konusma_durumlari  where conversation_id = p_id and user_id = auth.uid();
  delete from public.mesaj_gizlemeleri mg using public.messages m
   where mg.message_id = m.id and m.conversation_id = p_id and mg.user_id = auth.uid();
  if public._konusma_tamamen_silinmeli_mi(p_id) then
    delete from public.conversations where id = p_id; -- messages, zarflar, gizlemeler, durumlar CASCADE
    v_silindi := true;
  end if;
  return jsonb_build_object('id', p_id, 'tamamen_silindi', v_silindi);
end;
$$;
revoke all on function public.konusmayi_kalici_sil(uuid) from public, anon;
grant execute on function public.konusmayi_kalici_sil(uuid) to authenticated;

create or replace function public.cop_kutusunu_bosalt()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r record; v_n integer := 0; v_tam integer := 0; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  for r in select g.conversation_id from public.konusma_gizlemeleri g where g.user_id = auth.uid() and g.kalici = false loop
    v_res := public.konusmayi_kalici_sil(r.conversation_id);
    v_n := v_n + 1;
    if (v_res ->> 'tamamen_silindi')::boolean then v_tam := v_tam + 1; end if;
  end loop;
  return jsonb_build_object('islenen', v_n, 'tamamen_silinen', v_tam);
end;
$$;
revoke all on function public.cop_kutusunu_bosalt() from public, anon;
grant execute on function public.cop_kutusunu_bosalt() to authenticated;

-- ----------------------------------------------------------------------------
-- 9) OKUNDU + SABİTLEME + OKUNMAMIŞ ÖZETİ
-- ----------------------------------------------------------------------------
create or replace function public.konusmayi_okundu_isaretle(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public._konusma_erisimim_var_mi(p_id) then return; end if;
  insert into public.konusma_durumlari (conversation_id, user_id, okundu_at) values (p_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set okundu_at = now();
end;
$$;
revoke all on function public.konusmayi_okundu_isaretle(uuid) from public, anon;
grant execute on function public.konusmayi_okundu_isaretle(uuid) to authenticated;

create or replace function public.konusmayi_sabitle(p_id uuid, p_sabit boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public._konusma_erisimim_var_mi(p_id) then raise exception 'Bu sohbete erişimin yok.'; end if;
  if p_sabit and (select count(*) from public.konusma_durumlari d where d.user_id = auth.uid() and d.sabit) >= 20 then
    raise exception 'En çok 20 sohbet sabitlenebilir.';
  end if;
  insert into public.konusma_durumlari (conversation_id, user_id, sabit, sabit_at, okundu_at)
  values (p_id, auth.uid(), p_sabit, case when p_sabit then now() end, now() - interval '100 years')
  on conflict (conversation_id, user_id) do update set sabit = excluded.sabit, sabit_at = excluded.sabit_at;
end;
$$;
revoke all on function public.konusmayi_sabitle(uuid, boolean) from public, anon;
grant execute on function public.konusmayi_sabitle(uuid, boolean) to authenticated;

-- Konuşma başına okunmamış (karşı taraftan gelen) mesaj sayısı. Çöpteki / gizlenen sohbetler ve gizlenen mesajlar sayılmaz.
-- NOT: sabitleme satırı okuma satırı olmadan oluşabilir; bu yüzden ilk satırın okundu_at'i "çok eski" tutulur (aşağıda
-- konusma_durumlari'ndaki sabit-öncesi satırlar için okunmamış sayılır, bu DOĞRU davranıştır: hiç açılmamış sohbet).
create or replace function public.okunmamis_mesaj_ozeti()
returns table (conversation_id uuid, adet integer)
language sql stable security definer set search_path = public as $$
  select m.conversation_id, count(*)::integer
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.konusma_durumlari d on d.conversation_id = m.conversation_id and d.user_id = auth.uid()
  where auth.uid() is not null
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(d.okundu_at, '-infinity'::timestamptz)
    and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
    and not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = c.id and g.user_id = auth.uid())
    and not exists (select 1 from public.mesaj_gizlemeleri mg where mg.message_id = m.id and mg.user_id = auth.uid())
  group by m.conversation_id;
$$;
revoke all on function public.okunmamis_mesaj_ozeti() from public, anon;
grant execute on function public.okunmamis_mesaj_ozeti() to authenticated;

-- Geçiş: bu migration'dan ÖNCE var olan sohbetlerde herkesin eski mesajları "okunmuş" sayılsın (aksi hâlde hepsi okunmamış görünürdü).
insert into public.konusma_durumlari (conversation_id, user_id, okundu_at)
select c.id, p.id, now()
from public.conversations c
join public.profiles p on p.id = c.user_id or p.id = c.hedef_admin_id or p.role in ('admin', 'owner')
on conflict (conversation_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 10) GERİYE DÖNÜK TEMİZLİK (yetim kayıtlar)
--   a) Tüm TARAFLARI sohbeti kalıcı silmiş sohbetler → hemen silinir.
--   b) Tüm TARAFLARI çöpe atmış (gizlemiş) ve son gizlemenin üzerinden p_gun gün geçmiş sohbetler → silinir.
--   c) Tüm TARAFLARI "sadece benden sil" demiş ve p_gun gün geçmiş TEK mesajlar → silinir.
--   d) Hiç mesajı olmayan ve 1 günden eski boş sohbetler (açılıp mesaj yazılmamış) → silinir.
-- Çağırabilenler: Site Sahibi, SQL Editor (postgres), service_role (günlük cron).
-- ----------------------------------------------------------------------------
create or replace function public._mesajlasma_temizle(p_gun integer)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_kalici integer := 0; v_cop integer := 0; v_mesaj integer := 0; v_bos integer := 0;
begin
  with s as (
    select c.id from public.conversations c where public._konusma_tamamen_silinmeli_mi(c.id)
  ) delete from public.conversations where id in (select id from s);
  get diagnostics v_kalici = row_count;

  with s as (
    select c.id from public.conversations c
    where exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = c.id)
      and not exists (
        select 1 from unnest(public._konusma_taraflari(c.id)) u
        where not exists (select 1 from public.konusma_gizlemeleri g where g.conversation_id = c.id and g.user_id = u)
      )
      and (select max(g.gizlendi_at) from public.konusma_gizlemeleri g where g.conversation_id = c.id) <= now() - make_interval(days => greatest(p_gun, 0))
  ) delete from public.conversations where id in (select id from s);
  get diagnostics v_cop = row_count;

  with s as (
    select m.id from public.messages m
    where exists (select 1 from public.mesaj_gizlemeleri mg where mg.message_id = m.id)
      and not exists (
        select 1 from unnest(public._konusma_taraflari(m.conversation_id)) u
        where not exists (select 1 from public.mesaj_gizlemeleri mg where mg.message_id = m.id and mg.user_id = u)
      )
      and (select max(mg.gizlendi_at) from public.mesaj_gizlemeleri mg where mg.message_id = m.id) <= now() - make_interval(days => greatest(p_gun, 0))
  ) delete from public.messages where id in (select id from s);
  get diagnostics v_mesaj = row_count;

  with s as (
    select c.id from public.conversations c
    where c.created_at < now() - interval '1 day'
      and not exists (select 1 from public.messages m where m.conversation_id = c.id)
  ) delete from public.conversations where id in (select id from s);
  get diagnostics v_bos = row_count;

  return jsonb_build_object('kalici_silinen_sohbet', v_kalici, 'cop_suresi_dolan_sohbet', v_cop, 'gizlenmis_mesaj', v_mesaj, 'bos_sohbet', v_bos);
end;
$$;
revoke all on function public._mesajlasma_temizle(integer) from public, anon, authenticated;

create or replace function public.mesajlasma_yetim_temizle(p_gun integer default 0)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_owner() or auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.';
  end if;
  return public._mesajlasma_temizle(coalesce(p_gun, 0));
end;
$$;
revoke all on function public.mesajlasma_yetim_temizle(integer) from public, anon;
grant execute on function public.mesajlasma_yetim_temizle(integer) to authenticated, service_role;

-- Günlük cron (Edge Function + GitHub Actions; 0045) AYNI ADLA devam eder; artık taraf-bazlı ve 30 günlük eşikle çalışır.
create or replace function public.mesajlasma_kalici_silmeyi_isle()
returns int
language plpgsql volatile security definer set search_path = public, auth as $$
declare v jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Bu fonksiyon sadece zamanlanmış görev (service_role) tarafından çağrılabilir.';
  end if;
  v := public._mesajlasma_temizle(30);
  return (v ->> 'kalici_silinen_sohbet')::int + (v ->> 'cop_suresi_dolan_sohbet')::int + (v ->> 'gizlenmis_mesaj')::int + (v ->> 'bos_sohbet')::int;
end;
$$;
revoke execute on function public.mesajlasma_kalici_silmeyi_isle() from public, authenticated, anon;
grant  execute on function public.mesajlasma_kalici_silmeyi_isle() to service_role;

-- İlk çalıştırma: bu dosya SQL Editor'den çalıştırıldığında eski yetim kayıtlar HEMEN (0 gün) temizlenir.
-- (Çöpte kalmış ama tüm tarafları gizlemiş sohbetler ve boş sohbetler. Başka biri hâlâ görebiliyorsa DOKUNULMAZ.)
select public.mesajlasma_yetim_temizle(0);

-- ----------------------------------------------------------------------------
-- 11) REALTIME (zararsız; zaten ekliyse hata yutulur)
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.konusma_zarflari;
exception when others then raise notice 'konusma_zarflari realtime''a eklenemedi — sorun değil.';
end $$;
