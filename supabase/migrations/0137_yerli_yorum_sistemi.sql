-- ============================================================================
-- 0137_tur20_yerli_yorum_sistemi.sql — Giscus yerine Supabase YERLİ yorum sistemi
--  • Yorumlar yalnızca RPC'lerle yazılır/okunur (doğrudan tablo erişimi YOK).
--  • Yazar kendi yorumunu düzenler/siler; "(Düzenlendi - YYYY-MM-DD)" damgası SAAT OLMADAN. Admin/yönetici yalnızca GİZLER/SİLER; METNİ DÜZENLEYEMEZ (düzenleme yolu yok).
--  • Anonim yorum: ad yerine "Anonim" gösterilir (yazar kimliği yine kayıtlıdır; yalnızca site sahibi/DB görür).
--  • author_signature_hash = sha256('asru-yorum-v1:' || lower(e-posta)): hesap silinse ya da veritabanı başka projeye taşınsa bile, aynı e-postayla kayıt olan yazar
--    yorum_sahipligi_geri_al() ile yorumlarının mülkiyetini geri alır.
--  • Gizli üyelerin (0136) yorumları, gizleme sürdüğü sürece herkesten saklanır; gizleme kalkınca anında görünür.
-- Gereksinim: 0136, pgcrypto. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.yorumlar (
  id uuid primary key default gen_random_uuid(),
  icerik_anahtari text not null check (char_length(icerik_anahtari) between 1 and 300),
  ust_id uuid references public.yorumlar(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author_signature_hash text not null,
  gorunen_ad text,
  anonim boolean not null default false,
  metin text not null check (char_length(btrim(metin)) >= 1),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  gizli boolean not null default false,
  gizleyen uuid references auth.users(id) on delete set null
);
create index if not exists yorumlar_icerik_idx on public.yorumlar (icerik_anahtari, created_at);
create index if not exists yorumlar_imza_idx on public.yorumlar (author_signature_hash);
alter table public.yorumlar enable row level security;
revoke all on public.yorumlar from anon, authenticated;

create or replace function public._yorum_imza(p_uid uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest('asru-yorum-v1:' || lower(coalesce((select email from auth.users where id = p_uid), p_uid::text)), 'sha256'), 'hex');
$$;
revoke all on function public._yorum_imza(uuid) from public, anon, authenticated;

create or replace function public.yorum_listele(p_anahtar text)
returns table (id uuid, ust_id uuid, ad text, metin text, tarih date, duzenlendi date, benim boolean, gizli boolean, yonetici boolean)
language plpgsql stable security definer set search_path = public as $$
declare yon boolean := coalesce(public.is_manager_or_admin(), false); ben uuid := auth.uid();
begin
  return query
    select y.id, y.ust_id, (case when y.anonim then 'Anonim' else coalesce(nullif(btrim(y.gorunen_ad), ''), 'Üye') end)::text, y.metin,
           (y.created_at at time zone 'Europe/Istanbul')::date, (y.edited_at at time zone 'Europe/Istanbul')::date,
           (ben is not null and y.user_id = ben), y.gizli, yon
      from public.yorumlar y
     where y.icerik_anahtari = p_anahtar
       and (yon or (ben is not null and y.user_id = ben) or (not y.gizli))
       and (y.user_id is null or not public.uye_gizli_mi(y.user_id) or public.gizli_goruntulenebilir_mi() or y.user_id = ben)
     order by y.created_at limit 500;
end $$;
revoke all on function public.yorum_listele(text) from public;
grant execute on function public.yorum_listele(text) to anon, authenticated;

create or replace function public.yorum_ekle(p_anahtar text, p_ust_id uuid, p_metin text, p_anonim boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ad text;
begin
  if auth.uid() is null then raise exception 'Yorum yazmak için giriş yapmalısın.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and (coalesce(is_suspended, false) or role = 'demo')) then raise exception 'Bu hesapla yorum yazılamaz.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_metin, ''))) < 1 then raise exception 'Yorum boş olamaz.'; end if;
  if p_ust_id is not null and not exists (select 1 from public.yorumlar where id = p_ust_id and icerik_anahtari = p_anahtar) then raise exception 'Yanıtlanan yorum bulunamadı.'; end if;
  select nullif(btrim(full_name), '') into v_ad from public.profiles where id = auth.uid();
  insert into public.yorumlar (icerik_anahtari, ust_id, user_id, author_signature_hash, gorunen_ad, anonim, metin)
    values (p_anahtar, p_ust_id, auth.uid(), public._yorum_imza(auth.uid()), v_ad, coalesce(p_anonim, false), btrim(p_metin)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.yorum_ekle(text, uuid, text, boolean) from public, anon;
grant execute on function public.yorum_ekle(text, uuid, text, boolean) to authenticated;

-- YALNIZCA yazar düzenler (yönetici/Site Sahibi için düzenleme yolu YOKTUR)
create or replace function public.yorum_duzenle(p_id uuid, p_metin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_metin, ''))) < 1 then raise exception 'Yorum boş olamaz.'; end if;
  update public.yorumlar set metin = btrim(p_metin), edited_at = now() where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Yalnızca kendi yorumunu düzenleyebilirsin.' using errcode = '42501'; end if;
end $$;
revoke all on function public.yorum_duzenle(uuid, text) from public, anon;
grant execute on function public.yorum_duzenle(uuid, text) to authenticated;

-- Yazar kendi yorumunu siler; yönetici/Site Sahibi herhangi bir yorumu SİLEBİLİR
create or replace function public.yorum_sil(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  delete from public.yorumlar where id = p_id and (user_id = auth.uid() or public.is_manager_or_admin());
  if not found then raise exception 'Yorum bulunamadı ya da silme yetkin yok.' using errcode = '42501'; end if;
end $$;
revoke all on function public.yorum_sil(uuid) from public, anon;
grant execute on function public.yorum_sil(uuid) to authenticated;

create or replace function public.yorum_gizle(p_id uuid, p_gizli boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_manager_or_admin() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  update public.yorumlar set gizli = coalesce(p_gizli, true), gizleyen = case when coalesce(p_gizli, true) then auth.uid() else null end where id = p_id;
  if not found then raise exception 'Yorum bulunamadı.'; end if;
end $$;
revoke all on function public.yorum_gizle(uuid, boolean) from public, anon;
grant execute on function public.yorum_gizle(uuid, boolean) to authenticated;

-- Kullanıcı paneli: kendi yorumlarım (tüm yazılar)
create or replace function public.yorumlarim_listele()
returns table (id uuid, icerik_anahtari text, metin text, tarih date, duzenlendi date, gizli boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  return query select y.id, y.icerik_anahtari, y.metin, (y.created_at at time zone 'Europe/Istanbul')::date, (y.edited_at at time zone 'Europe/Istanbul')::date, y.gizli
    from public.yorumlar y where y.user_id = auth.uid() order by y.created_at desc limit 500;
end $$;
revoke all on function public.yorumlarim_listele() from public, anon;
grant execute on function public.yorumlarim_listele() to authenticated;

-- Hesap silinse / veritabanı taşınsa bile: aynı e-postayla yeniden kayıt olan yazar, imzası eşleşen sahipsiz yorumların mülkiyetini geri alır
create or replace function public.yorum_sahipligi_geri_al()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  update public.yorumlar set user_id = auth.uid() where user_id is null and author_signature_hash = public._yorum_imza(auth.uid());
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.yorum_sahipligi_geri_al() from public, anon;
grant execute on function public.yorum_sahipligi_geri_al() to authenticated;

-- Yönetim: tüm yazılardaki son yorumlar (yalnızca yönetici/içerik sorumlusu/Site Sahibi). Gösterim + gizle/sil içindir; metin DÜZENLENEMEZ.
create or replace function public.yorum_yonetim_listele(p_ara text default null)
returns table (id uuid, icerik_anahtari text, ad text, metin text, tarih date, gizli boolean, anonim boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_kalip text := nullif(btrim(coalesce(p_ara, '')), '');
begin
  if auth.uid() is null or not public.is_manager_or_admin() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_kalip is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_kalip), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query select y.id, y.icerik_anahtari, coalesce(nullif(btrim(y.gorunen_ad), ''), 'Üye')::text, y.metin, (y.created_at at time zone 'Europe/Istanbul')::date, y.gizli, y.anonim
    from public.yorumlar y
   where (y.user_id is null or not public.uye_gizli_mi(y.user_id) or public.gizli_goruntulenebilir_mi())
     and (v_kalip is null or public._ara_norm(y.metin) like v_kalip escape '\' or public._ara_norm(y.gorunen_ad) like v_kalip escape '\' or public._ara_norm(y.icerik_anahtari) like v_kalip escape '\')
   order by y.created_at desc limit 200;
end $$;
revoke all on function public.yorum_yonetim_listele(text) from public, anon;
grant execute on function public.yorum_yonetim_listele(text) to authenticated;
