-- ============================================================================
-- 0131_tur17_ozel_icerik_r2_dosyalari.sql — İçerik Yönetimi › Özel / Gizli Makaleler: siteden R2'ye HER TÜR dosya ekleme
--  • Dosyalar Arşiv'de AYRI ana klasörde durur: "Özel Makaleler/…" (alt klasörler serbest; Dosya Yöneticisi gibi yönetilir).
--  • ozel_icerik_dosyalari: hangi arşiv dosyası hangi özel makaleye bağlı. Doğrudan tablo erişimi YOK; yalnızca RPC.
--  • Okuyucu (erişim verilmiş üye) dosyayı Worker /ozel-indir ile kısa ömürlü imzalı adresten indirir; erişimi veritabanı doğrular.
-- Gereksinim: 0057, 0066. Tekrar çalıştırmak güvenlidir.
-- ============================================================================
create table if not exists public.ozel_icerik_dosyalari (
  content_id uuid not null references public.special_content(id) on delete cascade,
  arsiv_id uuid not null references public.r2_arsiv(id) on delete cascade,
  ekleyen uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (content_id, arsiv_id)
);
create index if not exists ozel_icerik_dosyalari_arsiv_idx on public.ozel_icerik_dosyalari (arsiv_id);
alter table public.ozel_icerik_dosyalari enable row level security;
revoke all on public.ozel_icerik_dosyalari from anon, authenticated;

-- Makaleye bağlı dosya kümesini TAMAMEN verilen liste yapar (yönetici).
create or replace function public.ozel_icerik_dosya_ata(p_content_id uuid, p_arsiv_idler uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if auth.uid() is null or not public.ozel_icerik_yonetebilir_mi() then raise exception 'Özel içerik yönetim yetkin yok.' using errcode = '42501'; end if;
  if not exists (select 1 from public.special_content where id = p_content_id) then raise exception 'İçerik bulunamadı.'; end if;
  p_arsiv_idler := coalesce(p_arsiv_idler, '{}'::uuid[]);
  if exists (select 1 from unnest(p_arsiv_idler) i left join public.r2_arsiv a on a.id = i
             where a.id is null or a.tur <> 'dosya' or a.durum <> 'hazir' or a.sifreli) then
    raise exception 'Yalnızca hazır, şifresiz Arşiv dosyaları eklenebilir.';
  end if;
  delete from public.ozel_icerik_dosyalari where content_id = p_content_id and not (arsiv_id = any (p_arsiv_idler));
  insert into public.ozel_icerik_dosyalari (content_id, arsiv_id, ekleyen) select p_content_id, i, auth.uid() from unnest(p_arsiv_idler) i on conflict do nothing;
  select count(*) into n from public.ozel_icerik_dosyalari where content_id = p_content_id;
  return n;
end $$;
revoke all on function public.ozel_icerik_dosya_ata(uuid, uuid[]) from public, anon;
grant execute on function public.ozel_icerik_dosya_ata(uuid, uuid[]) to authenticated;

-- Liste: yönetici ya da (yayında + erişimi olan) üye
create or replace function public.ozel_icerik_dosyalari_listele(p_content_id uuid)
returns table (arsiv_id uuid, ad text, boyut bigint, mime text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not (public.is_manager_or_admin() or public.ozel_icerik_yonetebilir_mi()
          or exists (select 1 from public.special_content c where c.id = p_content_id and c.is_published and public.has_content_access(c.id))) then
    return;
  end if;
  return query select a.id, a.ad, a.boyut::bigint, a.mime from public.ozel_icerik_dosyalari d join public.r2_arsiv a on a.id = d.arsiv_id
    where d.content_id = p_content_id and a.durum = 'hazir' order by a.ad;
end $$;
revoke all on function public.ozel_icerik_dosyalari_listele(uuid) from public, anon;
grant execute on function public.ozel_icerik_dosyalari_listele(uuid) to authenticated;

-- Worker (service_role): erişim denetimi + R2 anahtarı. Süresi dolmuş erişim reddedilir.
create or replace function public.ozel_icerik_dosya_coz(p_uid uuid, p_content_id uuid, p_arsiv_id uuid)
returns table (r2_key text, ad text, mime text)
language plpgsql stable security definer set search_path = public as $$
declare v_rol text;
begin
  select p.role into v_rol from public.profiles p where p.id = p_uid and coalesce(p.is_suspended, false) = false;
  if v_rol is null then return; end if;
  if not (v_rol in ('owner', 'admin', 'manager')
          or exists (select 1 from public.special_content c join public.content_access ca on ca.content_id = c.id
                      where c.id = p_content_id and c.is_published and ca.user_id = p_uid
                        and (ca.son_gecerlilik_tarihi is null or ca.son_gecerlilik_tarihi > now()))) then
    return;
  end if;
  return query select a.r2_key, a.ad, a.mime from public.ozel_icerik_dosyalari d join public.r2_arsiv a on a.id = d.arsiv_id
    where d.content_id = p_content_id and d.arsiv_id = p_arsiv_id and a.durum = 'hazir' and not a.sifreli and a.tur = 'dosya';
end $$;
revoke all on function public.ozel_icerik_dosya_coz(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ozel_icerik_dosya_coz(uuid, uuid, uuid) to service_role;
