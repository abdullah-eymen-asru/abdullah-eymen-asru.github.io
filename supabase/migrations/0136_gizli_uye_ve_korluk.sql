-- ============================================================================
-- 0136_tur20_gizli_uye_ve_korluk.sql — Site Sahibi'nin "gizli üye" ve "geçici körlük" (blind mode) özellikleri
--  • gizli_uyeler: Site Sahibi'nin gizlediği üyeler. (Şartnamedeki profiles.is_hidden_by_owner bayrağı yerine AYRI tablo: gizlenen üye kendi satırındaki bayrağı
--    okuyup gizlendiğini ÖĞRENEMESİN diye.) Tabloya yalnızca Site Sahibi RPC'leri erişir.
--  • owner_ayarlari.blind_mode: açıkken Site Sahibi de gizli üyeleri göremez; kapatınca hepsi anında geri gelir.
--  • profiles üzerinde RESTRICTIVE select politikası: gizli üyenin profil satırı Site Sahibi (körlük kapalıyken) ve kendisi dışında KİMSEYE görünmez
--    → üye listeleri, aramalar, ad gösterimleri (yorumlar dahil) tek noktadan izole olur. Gizlemeyi kaldırınca anında herkese geri görünür.
--  • SECURITY DEFINER üye listeleri (alıcı arama, Open-Meteo kullanım listesi) aynı filtreyle güncellendi.
-- SINIR (dürüst not): mesajlaşma/dosya/özel makale TABLOLARINDAKİ hareketler tablo bazında ayrıca filtrelenmedi; üyenin kimliği her yerden gizlenir ama bu
-- tabloların satır düzeyi izolasyonu sonraki turdadır.
-- Gereksinim: 0126, 0130. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create table if not exists public.gizli_uyeler (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gizleyen uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.owner_ayarlari (
  id boolean primary key default true check (id),
  blind_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.owner_ayarlari (id) values (true) on conflict do nothing;
alter table public.gizli_uyeler enable row level security;
alter table public.owner_ayarlari enable row level security;
revoke all on public.gizli_uyeler, public.owner_ayarlari from anon, authenticated;

create or replace function public.uye_gizli_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gizli_uyeler g where g.user_id = p_id);
$$;
revoke all on function public.uye_gizli_mi(uuid) from public, anon;
grant execute on function public.uye_gizli_mi(uuid) to authenticated, service_role;

-- Site Sahibi gizli üyeleri görebilir mi? (owner ve körlük kapalı)
create or replace function public.gizli_goruntulenebilir_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() and not coalesce((select blind_mode from public.owner_ayarlari where id), false);
$$;
revoke all on function public.gizli_goruntulenebilir_mi() from public, anon;
grant execute on function public.gizli_goruntulenebilir_mi() to authenticated, service_role;

drop policy if exists profiles_gizli_uye_izolasyonu on public.profiles;
create policy profiles_gizli_uye_izolasyonu on public.profiles as restrictive for select to authenticated
  using (id = auth.uid() or not public.uye_gizli_mi(id) or public.gizli_goruntulenebilir_mi());

create or replace function public.owner_uye_gizle(p_user_id uuid, p_gizli boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'Yalnızca Site Sahibi.' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'Kendini gizleyemezsin.'; end if;
  if coalesce(p_gizli, false) then insert into public.gizli_uyeler (user_id, gizleyen) values (p_user_id, auth.uid()) on conflict do nothing;
  else delete from public.gizli_uyeler where user_id = p_user_id; end if;
end $$;
revoke all on function public.owner_uye_gizle(uuid, boolean) from public, anon;
grant execute on function public.owner_uye_gizle(uuid, boolean) to authenticated;

create or replace function public.owner_gizli_uyeler()
returns table (user_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then return; end if;
  return query select g.user_id from public.gizli_uyeler g;
end $$;
revoke all on function public.owner_gizli_uyeler() from public, anon;
grant execute on function public.owner_gizli_uyeler() to authenticated;

create or replace function public.owner_blind_mode(p_ayarla boolean default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'Yalnızca Site Sahibi.' using errcode = '42501'; end if;
  if p_ayarla is not null then update public.owner_ayarlari set blind_mode = p_ayarla, updated_at = now() where id; end if;
  return coalesce((select blind_mode from public.owner_ayarlari where id), false);
end $$;
revoke all on function public.owner_blind_mode(boolean) from public, anon;
grant execute on function public.owner_blind_mode(boolean) to authenticated;

-- SECURITY DEFINER üye listeleri: gizli üyeler filtrelenir -------------------------
create or replace function public.arsiv_kullanici_ara(p_q text, p_limit integer default 20, p_offset integer default 0)
returns table (kullanici_id uuid, ad text, rol text, anahtar_var boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := public.tr_ara_normalize(btrim(coalesce(p_q, '')));
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_off int := greatest(0, coalesce(p_offset, 0));
begin
  if auth.uid() is null or not (public.r2_arsiv_yetkim('yukle') or public.is_owner()) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), 'İsimsiz kullanıcı'), p.role, (k.kullanici_id is not null)
      from public.profiles p left join public.e2ee_kullanici_anahtarlari k on k.kullanici_id = p.id
     where p.id <> auth.uid() and coalesce(p.is_suspended, false) = false
       and (not public.uye_gizli_mi(p.id) or public.gizli_goruntulenebilir_mi())
       and not exists (select 1 from unnest(string_to_array(v_q, ' ')) as t(tok) where t.tok <> '' and public.tr_ara_normalize(p.full_name) not like '%' || public.like_kacis(t.tok) || '%')
     order by (k.kullanici_id is not null) desc, public.tr_sirala(p.full_name), p.full_name, p.id
     limit v_lim offset v_off;
end $$;
