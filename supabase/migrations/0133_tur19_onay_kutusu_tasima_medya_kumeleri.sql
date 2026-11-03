-- ============================================================================
-- 0133_tur19_onay_kutusu_tasima_medya_kumeleri.sql
--  1) ONAY KUTUSU: yazi_inceleme + yazi_inceleme_notlari (+ RPC'ler). Taslak yazılar onaya gönderilir; yetkili inceler: ONAYLA / DÜZELTME İSTE (not) / İPTAL.
--     Düzeltme notları yalnızca yazan kişi tarafından silinebilir; yazı yayına alınınca (taslak → yayın) ya da taslak silinince OTOMATİK temizlenir (depolama dolmaz).
--     Kural: kimse kendi yazısını onaylayamaz (Site Sahibi hariç); onaylayanın rol sırası yazarınkinden YÜKSEK olmalı (owner > admin > manager > editor).
--  2) r2_arsiv_tasi: Arşiv'de dosya/klasörü başka klasöre TAŞI (alt ağaç dahil, ad çakışması reddedilir, kendi alt klasörüne taşıma yasak, .ozel ayrı).
--  3) yazi_medya_anahtarlarim: yazı medya kümelerim (anahtar · dosya sayısı · boyut) — düzenlemede dosyalar otomatik gelsin.
-- Gereksinim: 0013, 0014, 0057, 0128, 0129. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- 1) ONAY KUTUSU -------------------------------------------------------------
create table if not exists public.yazi_inceleme (
  taslak_id uuid primary key references public.taslak_icerikler(id) on delete cascade,
  durum text not null default 'bekliyor' check (durum in ('bekliyor', 'duzeltme_istendi', 'onaylandi', 'iptal')),
  gonderen_id uuid references auth.users(id) on delete set null,
  karar_veren_id uuid references auth.users(id) on delete set null,
  karar_tarihi timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.yazi_inceleme_notlari (
  id uuid primary key default gen_random_uuid(),
  taslak_id uuid not null references public.taslak_icerikler(id) on delete cascade,
  yazan_id uuid references auth.users(id) on delete set null,
  metin text not null check (char_length(btrim(metin)) >= 1),
  created_at timestamptz not null default now()
);
create index if not exists yazi_inceleme_notlari_taslak_idx on public.yazi_inceleme_notlari (taslak_id, created_at);
alter table public.yazi_inceleme enable row level security;
alter table public.yazi_inceleme_notlari enable row level security;
revoke all on public.yazi_inceleme, public.yazi_inceleme_notlari from anon, authenticated;

create or replace function public._rol_sirasi(p_rol text)
returns integer language sql immutable as $$
  select case p_rol when 'owner' then 5 when 'admin' then 4 when 'manager' then 3 when 'editor' then 2 when 'special_user' then 1 else 0 end;
$$;

create or replace function public.yazi_onaya_gonder(p_taslak_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.taslak_icerikler;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into t from public.taslak_icerikler where id = p_taslak_id;
  if t.id is null then raise exception 'Taslak bulunamadı.'; end if;
  if t.created_by is distinct from auth.uid() and not public.is_manager_or_admin() then raise exception 'Yalnızca kendi taslağını onaya gönderebilirsin.' using errcode = '42501'; end if;
  insert into public.yazi_inceleme (taslak_id, durum, gonderen_id) values (p_taslak_id, 'bekliyor', auth.uid())
    on conflict (taslak_id) do update set durum = 'bekliyor', gonderen_id = auth.uid(), karar_veren_id = null, karar_tarihi = null, updated_at = now();
end $$;
revoke all on function public.yazi_onaya_gonder(uuid) from public, anon;
grant execute on function public.yazi_onaya_gonder(uuid) to authenticated;

create or replace function public.yazi_inceleme_listele()
returns table (taslak_id uuid, tur text, baslik text, slug text, yazar_adi text, yazar_rol text, created_by uuid, durum text, guncelleme timestamptz,
               onizleme_kod text, not_sayisi bigint, benim boolean, karar_verebilir boolean)
language plpgsql stable security definer set search_path = public as $$
declare yonetici boolean := public.is_manager_or_admin();
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  return query
    select t.id, t.tur, t.baslik, t.slug, coalesce(nullif(btrim(t.yazar_adi), ''), nullif(btrim(p.full_name), ''), '(adsız)')::text, p.role::text, t.created_by,
           coalesce(i.durum, case when t.admin_onay_durumu = 'beklemede' or t.sahip_onay_durumu = 'beklemede' then 'adina_onay' end)::text,
           coalesce(i.updated_at, t.updated_at), t.onizleme_kod,
           (select count(*) from public.yazi_inceleme_notlari n where n.taslak_id = t.id), t.created_by = auth.uid(),
           (yonetici and t.created_by is distinct from auth.uid() or public.is_owner())
           and (public.is_owner() or public._rol_sirasi(p.role::text) < public._rol_sirasi((select role from public.profiles where id = auth.uid())::text))
      from public.taslak_icerikler t
      left join public.yazi_inceleme i on i.taslak_id = t.id
      left join public.profiles p on p.id = t.created_by
     where (i.taslak_id is not null or t.admin_onay_durumu = 'beklemede' or t.sahip_onay_durumu = 'beklemede')
       and (yonetici or t.created_by = auth.uid())
     order by coalesce(i.updated_at, t.updated_at) desc limit 300;
end $$;
revoke all on function public.yazi_inceleme_listele() from public, anon;
grant execute on function public.yazi_inceleme_listele() to authenticated;

create or replace function public.yazi_inceleme_notlari_getir(p_taslak_id uuid)
returns table (id uuid, yazan_ad text, benim boolean, metin text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not (public.is_manager_or_admin() or exists (select 1 from public.taslak_icerikler t where t.id = p_taslak_id and t.created_by = auth.uid())) then return; end if;
  return query select n.id, coalesce(nullif(btrim(p.full_name), ''), '(adsız)')::text, n.yazan_id = auth.uid(), n.metin, n.created_at
    from public.yazi_inceleme_notlari n left join public.profiles p on p.id = n.yazan_id where n.taslak_id = p_taslak_id order by n.created_at;
end $$;
revoke all on function public.yazi_inceleme_notlari_getir(uuid) from public, anon;
grant execute on function public.yazi_inceleme_notlari_getir(uuid) to authenticated;

create or replace function public.yazi_inceleme_karar(p_taslak_id uuid, p_karar text, p_not text default null)
returns text language plpgsql security definer set search_path = public as $$
declare t public.taslak_icerikler; v_yazar_rol text; v_ben_rol text; v_durum text; v_not text := nullif(btrim(coalesce(p_not, '')), '');
begin
  if auth.uid() is null or not public.is_manager_or_admin() then raise exception 'Onay yetkin yok.' using errcode = '42501'; end if;
  if p_karar not in ('onayla', 'duzeltme_iste', 'iptal') then raise exception 'Geçersiz karar.'; end if;
  select * into t from public.taslak_icerikler where id = p_taslak_id;
  if t.id is null then raise exception 'Taslak bulunamadı.'; end if;
  select role into v_ben_rol from public.profiles where id = auth.uid();
  select role into v_yazar_rol from public.profiles where id = t.created_by;
  if not public.is_owner() then
    if t.created_by = auth.uid() then raise exception 'Kendi yazını onaylayamazsın; başka bir yetkili incelemeli.' using errcode = '42501'; end if;
    if public._rol_sirasi(v_yazar_rol) >= public._rol_sirasi(v_ben_rol) then raise exception 'Eşit ya da üst yetkideki birinin yazısına karar veremezsin.' using errcode = '42501'; end if;
  end if;
  if p_karar = 'duzeltme_iste' and v_not is null then raise exception 'Düzeltme istemek için ne düzeltileceğini yaz.'; end if;
  v_durum := case p_karar when 'onayla' then 'onaylandi' when 'duzeltme_iste' then 'duzeltme_istendi' else 'iptal' end;
  insert into public.yazi_inceleme (taslak_id, durum, gonderen_id, karar_veren_id, karar_tarihi) values (p_taslak_id, v_durum, t.created_by, auth.uid(), now())
    on conflict (taslak_id) do update set durum = v_durum, karar_veren_id = auth.uid(), karar_tarihi = now(), updated_at = now();
  if v_not is not null then insert into public.yazi_inceleme_notlari (taslak_id, yazan_id, metin) values (p_taslak_id, auth.uid(), v_not); end if;
  return v_durum;
end $$;
revoke all on function public.yazi_inceleme_karar(uuid, text, text) from public, anon;
grant execute on function public.yazi_inceleme_karar(uuid, text, text) to authenticated;

create or replace function public.yazi_not_ekle(p_taslak_id uuid, p_metin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not (public.is_manager_or_admin() or exists (select 1 from public.taslak_icerikler t where t.id = p_taslak_id and t.created_by = auth.uid())) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_metin, ''))) < 1 then raise exception 'Not boş olamaz.'; end if;
  insert into public.yazi_inceleme_notlari (taslak_id, yazan_id, metin) values (p_taslak_id, auth.uid(), btrim(p_metin));
end $$;
revoke all on function public.yazi_not_ekle(uuid, text) from public, anon;
grant execute on function public.yazi_not_ekle(uuid, text) to authenticated;

create or replace function public.yazi_not_sil(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  delete from public.yazi_inceleme_notlari where id = p_id and (yazan_id = auth.uid() or public.is_owner());
  if not found then raise exception 'Not bulunamadı ya da yalnızca notu yazan silebilir.'; end if;
end $$;
revoke all on function public.yazi_not_sil(uuid) from public, anon;
grant execute on function public.yazi_not_sil(uuid) to authenticated;

-- Yayına alınınca (taslak → yayında) notlar ve inceleme kaydı otomatik silinir: gereksiz depolama olmaz.
create or replace function public._yazi_inceleme_yayinda_temizle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.yayin_durumu = 'taslak' and new.yayin_durumu is distinct from 'taslak' then
    delete from public.yazi_inceleme_notlari where taslak_id = new.id;
    delete from public.yazi_inceleme where taslak_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_yazi_inceleme_temizle on public.taslak_icerikler;
create trigger trg_yazi_inceleme_temizle after update of yayin_durumu on public.taslak_icerikler for each row execute function public._yazi_inceleme_yayinda_temizle();

-- 2) ARŞİV TAŞI --------------------------------------------------------------
create or replace function public.r2_arsiv_tasi(p_id uuid, p_hedef_yol text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.r2_arsiv; hedef text := coalesce(p_hedef_yol, ''); eski_tam text; yeni_tam text;
begin
  if not public.r2_arsiv_yetkim('yukle') then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  select * into v from public.r2_arsiv where id = p_id for update;
  if v.id is null then raise exception 'Öğe bulunamadı.'; end if;
  if hedef <> '' and right(hedef, 1) <> '/' then hedef := hedef || '/'; end if;
  if v.sifreli or left(v.klasor_yolu, 6) = '.ozel/' or left(hedef, 6) = '.ozel/' or hedef = '.ozel/' then raise exception 'Özel (şifreli) gönderimler taşınamaz.'; end if;
  if hedef = v.klasor_yolu then return; end if;
  if hedef <> '' then
    if not exists (select 1 from public.r2_arsiv k where k.tur = 'klasor' and k.klasor_yolu || k.ad || '/' = hedef) then raise exception 'Hedef klasör bulunamadı.'; end if;
  end if;
  if v.tur = 'klasor' then
    eski_tam := v.klasor_yolu || v.ad || '/';
    if left(hedef, length(eski_tam)) = eski_tam then raise exception 'Klasör kendi içine taşınamaz.'; end if;
    yeni_tam := hedef || v.ad || '/';
    update public.r2_arsiv set klasor_yolu = hedef where id = v.id;
    update public.r2_arsiv set klasor_yolu = yeni_tam || substr(klasor_yolu, length(eski_tam) + 1) where left(klasor_yolu, length(eski_tam)) = eski_tam and id <> v.id;
  else
    update public.r2_arsiv set klasor_yolu = hedef where id = v.id;
  end if;
exception when unique_violation then raise exception 'Hedef klasörde aynı ada sahip bir öğe zaten var.';
end $$;
revoke all on function public.r2_arsiv_tasi(uuid, text) from public, anon;
grant execute on function public.r2_arsiv_tasi(uuid, text) to authenticated;

-- 3) YAZI MEDYA KÜMELERİM -----------------------------------------------------
create or replace function public.yazi_medya_anahtarlarim()
returns table (anahtar text, dosya_sayisi bigint, toplam_boyut bigint, son_tarih timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._yazi_medya_yetkili() then return; end if;
  return query select m.yazi_anahtar, count(*)::bigint, coalesce(sum(a.boyut), 0)::bigint, max(m.created_at)
    from public.yazi_medya m join public.r2_arsiv a on a.id = m.arsiv_id
    where public.is_owner() or exists (select 1 from public.yazi_medya_anahtarlari k where k.anahtar = m.yazi_anahtar and k.sahip = auth.uid())
    group by m.yazi_anahtar order by max(m.created_at) desc limit 200;
end $$;
revoke all on function public.yazi_medya_anahtarlarim() from public, anon;
grant execute on function public.yazi_medya_anahtarlarim() to authenticated;

-- 4) GÜVENLİK: taslak yazılarda ROL HİYERARŞİSİ (RLS). Önceden herhangi bir admin, "adına" işaretli olmayan HER taslağı (başka admin'in ve Site Sahibi'nin dahil)
--    düzenleyip silebiliyordu. Artık: Site Sahibi her şeye; admin yalnızca KENDİ taslağına ve KENDİSİNDEN DÜŞÜK rolün (manager/editor/özel üye/üye) taslağına erişir.
--    "Adına" işaretli taslaklarda eski kural aynen korunur (yalnızca owner ve hedef kişi).
create or replace function public._taslak_admin_erisimi_var_mi(p_taslak public.taslak_icerikler)
returns boolean language sql stable security definer set search_path = public as $$
  select
    ((not p_taslak.admin_adina_talep and not p_taslak.sahip_adina_talep and public.is_admin())
      and (public.is_owner() or p_taslak.created_by = auth.uid()
           or public._rol_sirasi((select role::text from public.profiles where id = p_taslak.created_by))
              < public._rol_sirasi((select role::text from public.profiles where id = auth.uid()))))
    or ((p_taslak.admin_adina_talep or p_taslak.sahip_adina_talep) and (public.is_owner() or auth.uid() = p_taslak.yazar_id));
$$;
grant execute on function public._taslak_admin_erisimi_var_mi(public.taslak_icerikler) to authenticated;
