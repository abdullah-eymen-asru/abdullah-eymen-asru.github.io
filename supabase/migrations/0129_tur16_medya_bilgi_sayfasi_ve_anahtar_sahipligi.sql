-- ============================================================================
-- 0129_tur16_medya_bilgi_sayfasi_ve_anahtar_sahipligi.sql
--  1) r2_medya_coz: boyut + yükleme tarihi de döner (Worker'ın dosya bilgi sayfası için).
--  2) GÜVENLİK: yazi_medya_anahtarlari — bir medya adres anahtarını İLK kaydeden sahiplenir. Başka bir (site sahibi olmayan) kullanıcı
--     o anahtara dosya EKLEYEMEZ ve listesini GÖREMEZ (başkasının yazısının adresinde "isim işgali" / sahte dosya yerleştirme engellenir).
--  3) yazi_medya_adlandir: dosyanın kamuya açık adını sonradan değiştirme (yalnızca ekleyen ya da site sahibi).
-- Gereksinim: 0128. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create table if not exists public.yazi_medya_anahtarlari (
  anahtar text primary key check (anahtar ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  sahip uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.yazi_medya_anahtarlari enable row level security;
revoke all on public.yazi_medya_anahtarlari from anon, authenticated;
-- mevcut kayıtlardan sahiplik çıkar (ilk ekleyen)
insert into public.yazi_medya_anahtarlari (anahtar, sahip)
  select distinct on (m.yazi_anahtar) m.yazi_anahtar, m.olusturan from public.yazi_medya m where m.olusturan is not null order by m.yazi_anahtar, m.created_at
  on conflict do nothing;

create or replace function public._yazi_anahtar_erisimi(p_yazi text, p_olustur boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_sahip uuid;
begin
  if auth.uid() is null then return false; end if;
  if public.is_owner() then return true; end if;
  select sahip into v_sahip from public.yazi_medya_anahtarlari where anahtar = p_yazi;
  if v_sahip is null then
    if p_olustur then insert into public.yazi_medya_anahtarlari (anahtar, sahip) values (p_yazi, auth.uid()) on conflict do nothing; return true; end if;
    return true;                                                         -- henüz kimsenin değil: listelemek zararsız (boş)
  end if;
  return v_sahip = auth.uid();
end $$;
revoke all on function public._yazi_anahtar_erisimi(text, boolean) from public, anon, authenticated;

create or replace function public.yazi_medya_kaydet(p_yazi text, p_ad text, p_arsiv_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.r2_arsiv; v_id uuid;
begin
  if not public._yazi_medya_yetkili() then raise exception 'Yazı medyası eklemek için Arşiv yükleme yetkisi gerekir.' using errcode = '42501'; end if;
  if not public._yazi_anahtar_erisimi(p_yazi, true) then raise exception 'Bu adres anahtarı (“%”) başka bir kullanıcıya ait. Farklı bir anahtar seç.', p_yazi using errcode = '42501'; end if;
  select * into a from public.r2_arsiv x where x.id = p_arsiv_id;
  if a.id is null or a.tur <> 'dosya' or a.durum <> 'hazir' then raise exception 'Dosya bulunamadı ya da hazır değil.'; end if;
  if a.sifreli then raise exception 'Uçtan uca şifreli dosyalar yazıda herkese açık gösterilemez.'; end if;
  if a.sahip_id is distinct from auth.uid() and not public.is_owner() then raise exception 'Yalnızca kendi yüklediğin dosyayı ekleyebilirsin.' using errcode = '42501'; end if;
  insert into public.yazi_medya (yazi_anahtar, dosya_ad, arsiv_id, olusturan) values (p_yazi, p_ad, p_arsiv_id, auth.uid()) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'Bu yazıda “%” adlı bir dosya zaten var.', p_ad;
end $$;
revoke all on function public.yazi_medya_kaydet(text, text, uuid) from public, anon;
grant execute on function public.yazi_medya_kaydet(text, text, uuid) to authenticated;

create or replace function public.yazi_medya_listele(p_yazi text)
returns table (id uuid, dosya_ad text, arsiv_id uuid, boyut bigint, mime text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._yazi_medya_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if not public._yazi_anahtar_erisimi(p_yazi, false) then return; end if;     -- başkasının anahtarı: boş liste (varlığı bile sızmaz)
  return query select m.id, m.dosya_ad, m.arsiv_id, a.boyut::bigint, a.mime, m.created_at
    from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id where m.yazi_anahtar = p_yazi order by m.created_at;
end $$;
revoke all on function public.yazi_medya_listele(text) from public, anon;
grant execute on function public.yazi_medya_listele(text) to authenticated;

create or replace function public.yazi_medya_adlandir(p_id uuid, p_yeni_ad text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_yeni_ad, ''));
begin
  if not public._yazi_medya_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if v !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$' then raise exception 'Ad yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir (boşluk/Türkçe harf yok).'; end if;
  update public.yazi_medya set dosya_ad = v where id = p_id and (olusturan = auth.uid() or public.is_owner());
  if not found then raise exception 'Kayıt bulunamadı ya da yetkin yok.'; end if;
  return v;
exception when unique_violation then raise exception 'Bu yazıda “%” adlı bir dosya zaten var.', v;
end $$;
revoke all on function public.yazi_medya_adlandir(uuid, text) from public, anon;
grant execute on function public.yazi_medya_adlandir(uuid, text) to authenticated;

-- Worker: bilgi sayfası için boyut + tarih
drop function if exists public.r2_medya_coz(text, text);
create or replace function public.r2_medya_coz(p_yazi text, p_ad text)
returns table (r2_key text, ad text, mime text, boyut bigint, yuklenme timestamptz)
language sql stable security definer set search_path = public as $$
  select a.r2_key, m.dosya_ad, a.mime, a.boyut::bigint, m.created_at from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id
  where m.yazi_anahtar = lower(coalesce(p_yazi, '')) and m.dosya_ad = p_ad and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli limit 1;
$$;
revoke all on function public.r2_medya_coz(text, text) from public, anon, authenticated;
grant execute on function public.r2_medya_coz(text, text) to service_role;
