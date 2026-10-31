-- ============================================================================
-- 0128_tur14_yazi_medyasi.sql — Yazı / proje / veri seti medyası (R2)
--  • yazi_medya: bir yazıya (slug) bağlı R2 dosyaları (görsel, PDF, veri seti, her tür). Adres: /m/<yazi-slug>/<dosya-adi>
--  • r2_medya_ayar: SİTE GENELİ aç/kapa (kota koruması). acik=false → /m/ adresleri hiç R2'ye gitmez; gorsel_otomatik=false → görseller
--    "Görseli göster" düğmesiyle (tıklayınca) yüklenir.
--  • r2_medya_coz: yalnızca Worker (service_role) çözer; yalnızca ŞİFRESİZ ve 'hazir' arşiv dosyaları.
-- Dosyalar Arşiv'de "Yazılar/<başlık>/" klasöründe durur (aynı depolama/kota). Gereksinim: 0057, 0124.
-- ============================================================================
create table if not exists public.r2_medya_ayar (
  id boolean primary key default true check (id),
  acik boolean not null default true,
  gorsel_otomatik boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.r2_medya_ayar (id) values (true) on conflict do nothing;
alter table public.r2_medya_ayar enable row level security;
revoke all on public.r2_medya_ayar from anon, authenticated;

create or replace function public.r2_medya_ayar_oku()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('acik', a.acik, 'gorsel_otomatik', a.gorsel_otomatik) from public.r2_medya_ayar a where a.id;
$$;
revoke all on function public.r2_medya_ayar_oku() from public;
grant execute on function public.r2_medya_ayar_oku() to anon, authenticated, service_role;

create or replace function public.r2_medya_ayar_yaz(p_acik boolean, p_gorsel_otomatik boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'Yalnızca site sahibi bu ayarı değiştirebilir.' using errcode = '42501'; end if;
  update public.r2_medya_ayar set acik = coalesce(p_acik, acik), gorsel_otomatik = coalesce(p_gorsel_otomatik, gorsel_otomatik), updated_at = now(), updated_by = auth.uid() where id;
  return public.r2_medya_ayar_oku();
end $$;
revoke all on function public.r2_medya_ayar_yaz(boolean, boolean) from public, anon;
grant execute on function public.r2_medya_ayar_yaz(boolean, boolean) to authenticated;

create table if not exists public.yazi_medya (
  id uuid primary key default gen_random_uuid(),
  yazi_anahtar text not null check (yazi_anahtar ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  dosya_ad text not null check (dosya_ad ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$'),
  arsiv_id uuid not null references public.r2_arsiv(id) on delete cascade,
  olusturan uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (yazi_anahtar, dosya_ad)
);
create index if not exists yazi_medya_arsiv_idx on public.yazi_medya (arsiv_id);
alter table public.yazi_medya enable row level security;
revoke all on public.yazi_medya from anon, authenticated;

create or replace function public._yazi_medya_yetkili()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare y jsonb;
begin
  if auth.uid() is null then return false; end if;
  if public.is_owner() then return true; end if;
  y := public.r2_arsiv_yetkilerim();
  return coalesce((y ->> 'yukle')::boolean, false);
end $$;
revoke all on function public._yazi_medya_yetkili() from public, anon;
grant execute on function public._yazi_medya_yetkili() to authenticated;

create or replace function public.yazi_medya_kaydet(p_yazi text, p_ad text, p_arsiv_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.r2_arsiv; v_id uuid;
begin
  if not public._yazi_medya_yetkili() then raise exception 'Yazı medyası eklemek için Arşiv yükleme yetkisi gerekir.' using errcode = '42501'; end if;
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
  return query select m.id, m.dosya_ad, m.arsiv_id, a.boyut::bigint, a.mime, m.created_at
    from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id
    where m.yazi_anahtar = p_yazi order by m.created_at;
end $$;
revoke all on function public.yazi_medya_listele(text) from public, anon;
grant execute on function public.yazi_medya_listele(text) to authenticated;

-- Kayıt silme: dosya Arşiv'de kalır (isteğe bağlı olarak istemci Worker /sil ile ayrıca kaldırır). Yalnızca ekleyen ya da site sahibi.
create or replace function public.yazi_medya_sil(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_arsiv uuid;
begin
  if not public._yazi_medya_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  delete from public.yazi_medya where id = p_id and (olusturan = auth.uid() or public.is_owner()) returning arsiv_id into v_arsiv;
  if v_arsiv is null then raise exception 'Kayıt bulunamadı ya da silme yetkin yok.'; end if;
  return v_arsiv;
end $$;
revoke all on function public.yazi_medya_sil(uuid) from public, anon;
grant execute on function public.yazi_medya_sil(uuid) to authenticated;

-- Worker (service_role): /m/<yazi>/<dosya> → R2 anahtarı
create or replace function public.r2_medya_coz(p_yazi text, p_ad text)
returns table (r2_key text, ad text, mime text)
language sql stable security definer set search_path = public as $$
  select a.r2_key, m.dosya_ad, a.mime from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id
  where m.yazi_anahtar = lower(coalesce(p_yazi, '')) and m.dosya_ad = p_ad and a.tur = 'dosya' and a.durum = 'hazir' and not a.sifreli limit 1;
$$;
revoke all on function public.r2_medya_coz(text, text) from public, anon, authenticated;
grant execute on function public.r2_medya_coz(text, text) to service_role;
