-- ============================================================================
-- 0153 — Davet ayarları (Site Sahibi) + davet listesi (isim/e-posta). 0152'den SONRA çalıştırılır. İdempotent.
--  * public.davet_ayarlari (tek satır): davetler_acik, baslangic/bitis (tarih penceresi), toplam_limit, gunluk_limit.
--    NULL = sınırsız. Tablo istemciye tamamen kapalı; okuma/yazma yalnızca aşağıdaki RPC'ler ve service_role (Edge Function) ile.
--  * davet_ayarlari_getir(): admin + owner okur.   owner_davet_ayarlari_kaydet(): SADECE owner yazar.
--  * admin_davetleri_listele(): ad/soyad ile birlikte (arama için), son 500.
-- ============================================================================
create table if not exists public.davet_ayarlari (
  id int primary key default 1 check (id = 1),
  davetler_acik boolean not null default true,
  baslangic timestamptz,
  bitis timestamptz,
  toplam_limit int check (toplam_limit is null or toplam_limit > 0),
  gunluk_limit int check (gunluk_limit is null or (gunluk_limit > 0 and gunluk_limit <= 500)),
  guncelleyen uuid references auth.users(id) on delete set null,
  guncelleme timestamptz not null default now(),
  check (baslangic is null or bitis is null or bitis > baslangic)
);
insert into public.davet_ayarlari (id) values (1) on conflict (id) do nothing;
alter table public.davet_ayarlari enable row level security;
revoke all on public.davet_ayarlari from anon, authenticated;
do $$ begin
  create policy yalniz_sunucu on public.davet_ayarlari for all to anon, authenticated using (false) with check (false);
exception when duplicate_object then null; end $$;

create or replace function public.davet_ayarlari_getir()
returns table (davetler_acik boolean, baslangic timestamptz, bitis timestamptz, toplam_limit int, gunluk_limit int, toplam_gonderilen bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_owner()) then
    raise exception 'Yetkisiz işlem: davet ayarlarını yalnızca yönetici/Site Sahibi görebilir.';
  end if;
  return query select a.davetler_acik, a.baslangic, a.bitis, a.toplam_limit, a.gunluk_limit,
                      (select count(*) from public.kullanici_davetleri)
               from public.davet_ayarlari a where a.id = 1;
end;
$$;
revoke execute on function public.davet_ayarlari_getir() from public, anon;
grant execute on function public.davet_ayarlari_getir() to authenticated;

create or replace function public.owner_davet_ayarlari_kaydet(
  p_acik boolean, p_baslangic timestamptz, p_bitis timestamptz, p_toplam int, p_gunluk int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Davet ayarlarını yalnızca Site Sahibi (owner) değiştirebilir.';
  end if;
  if p_baslangic is not null and p_bitis is not null and p_bitis <= p_baslangic then
    raise exception 'Bitiş tarihi başlangıçtan sonra olmalı.';
  end if;
  if p_toplam is not null and p_toplam <= 0 then raise exception 'Toplam davet sınırı 1 veya daha büyük olmalı (boş = sınırsız).'; end if;
  if p_gunluk is not null and (p_gunluk <= 0 or p_gunluk > 500) then raise exception 'Günlük sınır 1-500 arasında olmalı (boş = sınırsız, tavan 500).'; end if;
  update public.davet_ayarlari
     set davetler_acik = coalesce(p_acik, true), baslangic = p_baslangic, bitis = p_bitis,
         toplam_limit = p_toplam, gunluk_limit = p_gunluk, guncelleyen = auth.uid(), guncelleme = now()
   where id = 1;
end;
$$;
revoke execute on function public.owner_davet_ayarlari_kaydet(boolean, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.owner_davet_ayarlari_kaydet(boolean, timestamptz, timestamptz, int, int) to authenticated;

drop function if exists public.admin_davetleri_listele();
create or replace function public.admin_davetleri_listele()
returns table (eposta text, ad text, olusturma timestamptz, son_kullanma timestamptz, kullanildi boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_owner()) then
    raise exception 'Yetkisiz işlem: davetleri yalnızca yönetici/Site Sahibi görebilir.';
  end if;
  return query
    select d.eposta,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           d.olusturma, d.son_kullanma, d.kullanildi
      from public.kullanici_davetleri d
      left join public.profiles p on lower(p.email) = d.eposta
     order by d.olusturma desc limit 500;
end;
$$;
revoke execute on function public.admin_davetleri_listele() from public, anon;
grant execute on function public.admin_davetleri_listele() to authenticated;
