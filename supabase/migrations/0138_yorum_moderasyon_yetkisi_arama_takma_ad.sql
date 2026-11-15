-- ============================================================================
-- 0138_yorum_moderasyon_yetkisi_arama_takma_ad.sql
--  1) "yorum_yonetimi" yetki anahtarı: Yetki Ayarları'ndan YÖNETİCİ/içerik sorumlusu için KAPATILABİLİR. Kapalıyken o rol, başkasının yorumunu gizleyemez/silemez,
--     yönetim listesini göremez; yalnızca kendi yorumları için normal üye gibi davranır. Site Sahibi her zaman yapabilir.
--  2) Site Sahibi'nin gizlediği yorumu başka yönetici AÇAMAZ (yalnızca Site Sahibi açar).
--  3) Takma ad desteği (yorum_ekle p_takma_ad) ve listeye `rumuz` bayrağı.
--  4) Arama: yorumlarım / yönetim listeleri yazı BAŞLIĞINA göre de aranabilsin diye p_anahtarlar (başlığı eşleşen adresler) parametresi.
-- Gereksinim: 0137, 0048. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
alter table public.yorumlar add column if not exists rumuz boolean not null default false;

create or replace function public._yorum_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or (public.is_manager_or_admin()
    and public.ozellik_erisimi_var_mi('yorum_yonetimi', (select role from public.profiles where id = auth.uid())));
$$;
revoke all on function public._yorum_moderator() from public, anon;
grant execute on function public._yorum_moderator() to authenticated;

drop function if exists public.yorum_listele(text);
create or replace function public.yorum_listele(p_anahtar text)
returns table (id uuid, ust_id uuid, ad text, rumuz boolean, metin text, tarih date, duzenlendi date, benim boolean, gizli boolean, yonetici boolean)
language plpgsql stable security definer set search_path = public as $$
declare yon boolean := coalesce(public._yorum_moderator(), false); ben uuid := auth.uid();
begin
  return query
    select y.id, y.ust_id, (case when y.anonim then 'Anonim' else coalesce(nullif(btrim(y.gorunen_ad), ''), 'Üye') end)::text, y.rumuz, y.metin,
           (y.created_at at time zone 'Europe/Istanbul')::date, (y.edited_at at time zone 'Europe/Istanbul')::date,
           (ben is not null and y.user_id = ben), y.gizli, yon
      from public.yorumlar y
     where y.icerik_anahtari = p_anahtar
       and (yon or (ben is not null and y.user_id = ben) or (not y.gizli))
       and (y.user_id is null or not public.uye_gizli_mi(y.user_id) or public.gizli_goruntulenebilir_mi() or y.user_id = ben)
     order by y.created_at limit 1000;
end $$;
revoke all on function public.yorum_listele(text) from public;
grant execute on function public.yorum_listele(text) to anon, authenticated;

drop function if exists public.yorum_ekle(text, uuid, text, boolean);
create or replace function public.yorum_ekle(p_anahtar text, p_ust_id uuid, p_metin text, p_anonim boolean default false, p_takma_ad text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ad text; v_takma text := nullif(btrim(coalesce(p_takma_ad, '')), '');
begin
  if auth.uid() is null then raise exception 'Yorum yazmak için giriş yapmalısın.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and (coalesce(is_suspended, false) or role = 'demo')) then raise exception 'Bu hesapla yorum yazılamaz.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_metin, ''))) < 1 then raise exception 'Yorum boş olamaz.'; end if;
  if v_takma is not null and (char_length(v_takma) < 2 or char_length(v_takma) > 40) then raise exception 'Takma ad 2–40 karakter olmalı.'; end if;
  if p_ust_id is not null and not exists (select 1 from public.yorumlar where id = p_ust_id and icerik_anahtari = p_anahtar) then raise exception 'Yanıtlanan yorum bulunamadı.'; end if;
  select nullif(btrim(full_name), '') into v_ad from public.profiles where id = auth.uid();
  insert into public.yorumlar (icerik_anahtari, ust_id, user_id, author_signature_hash, gorunen_ad, anonim, rumuz, metin)
    values (p_anahtar, p_ust_id, auth.uid(), public._yorum_imza(auth.uid()), coalesce(v_takma, v_ad), coalesce(p_anonim, false) and v_takma is null, v_takma is not null, btrim(p_metin)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.yorum_ekle(text, uuid, text, boolean, text) from public, anon;
grant execute on function public.yorum_ekle(text, uuid, text, boolean, text) to authenticated;

create or replace function public.yorum_sil(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  delete from public.yorumlar where id = p_id and (user_id = auth.uid() or public._yorum_moderator());
  if not found then raise exception 'Yorum bulunamadı ya da silme yetkin yok.' using errcode = '42501'; end if;
end $$;

create or replace function public.yorum_gizle(p_id uuid, p_gizli boolean)
returns void language plpgsql security definer set search_path = public as $$
declare y public.yorumlar;
begin
  if auth.uid() is null or not public._yorum_moderator() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  select * into y from public.yorumlar where id = p_id;
  if y.id is null then raise exception 'Yorum bulunamadı.'; end if;
  if not coalesce(p_gizli, true) and y.gizli and y.gizleyen is not null and y.gizleyen <> auth.uid() and not public.is_owner() and exists (select 1 from public.profiles where id = y.gizleyen and role = 'owner') then
    raise exception 'Bu yorumu Site Sahibi gizledi; yalnızca Site Sahibi açabilir.' using errcode = '42501';
  end if;
  update public.yorumlar set gizli = coalesce(p_gizli, true), gizleyen = case when coalesce(p_gizli, true) then auth.uid() else null end where id = p_id;
end $$;

drop function if exists public.yorumlarim_listele();
create or replace function public.yorumlarim_listele(p_ara text default null, p_anahtarlar text[] default null)
returns table (id uuid, icerik_anahtari text, metin text, tarih date, duzenlendi date, gizli boolean, ust_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_kalip text := nullif(btrim(coalesce(p_ara, '')), '');
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_kalip is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_kalip), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query select y.id, y.icerik_anahtari, y.metin, (y.created_at at time zone 'Europe/Istanbul')::date, (y.edited_at at time zone 'Europe/Istanbul')::date, y.gizli, y.ust_id
    from public.yorumlar y where y.user_id = auth.uid()
     and (v_kalip is null or public._ara_norm(y.metin) like v_kalip escape '\' or public._ara_norm(y.icerik_anahtari) like v_kalip escape '\' or y.icerik_anahtari = any (coalesce(p_anahtarlar, '{}'::text[])))
    order by y.created_at desc limit 1000;
end $$;
revoke all on function public.yorumlarim_listele(text, text[]) from public, anon;
grant execute on function public.yorumlarim_listele(text, text[]) to authenticated;

drop function if exists public.yorum_yonetim_listele(text);
create or replace function public.yorum_yonetim_listele(p_ara text default null, p_anahtarlar text[] default null)
returns table (id uuid, icerik_anahtari text, ad text, metin text, tarih date, gizli boolean, anonim boolean, rumuz boolean, ust_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_kalip text := nullif(btrim(coalesce(p_ara, '')), '');
begin
  if auth.uid() is null or not public._yorum_moderator() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v_kalip is not null then v_kalip := '%' || replace(replace(replace(public._ara_norm(v_kalip), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query select y.id, y.icerik_anahtari, coalesce(nullif(btrim(y.gorunen_ad), ''), 'Üye')::text, y.metin, (y.created_at at time zone 'Europe/Istanbul')::date, y.gizli, y.anonim, y.rumuz, y.ust_id
    from public.yorumlar y
   where (y.user_id is null or not public.uye_gizli_mi(y.user_id) or public.gizli_goruntulenebilir_mi())
     and (v_kalip is null or public._ara_norm(y.metin) like v_kalip escape '\' or public._ara_norm(y.gorunen_ad) like v_kalip escape '\' or public._ara_norm(y.icerik_anahtari) like v_kalip escape '\'
          or y.icerik_anahtari = any (coalesce(p_anahtarlar, '{}'::text[])))
   order by y.created_at desc limit 1000;
end $$;
revoke all on function public.yorum_yonetim_listele(text, text[]) from public, anon;
grant execute on function public.yorum_yonetim_listele(text, text[]) to authenticated;
