-- 0141 — Medya kotası: araç başına AÇ/KAPA anahtarı (Site Sahibi) + üyenin kayıtlı anahtar özeti.
-- İdempotent. 0140'tan sonra çalıştırılır.
--  • medya_kota_ayar.kota_aktif : false iken günlük kota UYGULANMAZ (limitler "sınırsız" görünür; kullanım yine sayılır).
--    Worker'lar medya_kota_durumu'nun 'kalan' değerine bakar; null = sınırsız → Worker değişikliği gerekmez.
--  • owner_medya_kota_ayarla : p_kota_aktif eklendi (varsayılan null = değişme).
--  • medya_kayitli_anahtarlar : üyenin kasasında hangi medya anahtarı kayıtlı (yalnızca sağlayıcı + tarih; içerik ASLA dönmez).

alter table public.medya_kota_ayar add column if not exists kota_aktif boolean not null default true;

create or replace function public.medya_kota_durumu(p_arac text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.medya_kota_ayar; v_kul bigint; v_gen bigint; v_kendi bigint; v_bugun date := public._medya_bugun();
        v_lk bigint; v_lg bigint;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into a from public.medya_kota_ayar where arac = p_arac;
  if not found then raise exception 'Geçersiz araç.'; end if;
  select coalesce(sum(miktar) filter (where user_id = auth.uid() and kaynak = 'site'), 0),
         coalesce(sum(miktar) filter (where kaynak = 'site'), 0),
         coalesce(sum(miktar) filter (where user_id = auth.uid() and kaynak = 'kendi'), 0)
    into v_kul, v_gen, v_kendi
    from public.medya_kota_kullanim where gun = v_bugun and arac = p_arac;
  v_lk := case when a.kota_aktif then a.kullanici_gunluk else null end;
  v_lg := case when a.kota_aktif then a.genel_gunluk else null end;
  return jsonb_build_object(
    'arac', p_arac, 'birim', a.birim, 'gun', v_bugun, 'kota_aktif', a.kota_aktif,
    'kullanici', jsonb_build_object('kullanilan', v_kul, 'limit', v_lk,
                  'kalan', case when v_lk is null then null else greatest(v_lk - v_kul, 0) end),
    'genel', jsonb_build_object('kullanilan', v_gen, 'limit', v_lg,
                  'kalan', case when v_lg is null then null else greatest(v_lg - v_gen, 0) end),
    'kendi_anahtarla_kullanilan', v_kendi,
    'kendi_anahtar_izni', a.kendi_anahtar_izni,
    'sistem_anahtari_acik', a.sistem_anahtari_acik);
end $$;
revoke all on function public.medya_kota_durumu(text) from public, anon;
grant execute on function public.medya_kota_durumu(text) to authenticated;

drop function if exists public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean);
create or replace function public.owner_medya_kota_ayarla(
  p_arac text, p_kullanici bigint, p_genel bigint, p_kendi_izni boolean, p_sistem_acik boolean, p_kota_aktif boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_kullanici is not null and p_kullanici < 0 or p_genel is not null and p_genel < 0 then raise exception 'Limit negatif olamaz.'; end if;
  update public.medya_kota_ayar
     set kullanici_gunluk = p_kullanici, genel_gunluk = p_genel,
         kendi_anahtar_izni = coalesce(p_kendi_izni, kendi_anahtar_izni),
         sistem_anahtari_acik = coalesce(p_sistem_acik, sistem_anahtari_acik),
         kota_aktif = coalesce(p_kota_aktif, kota_aktif),
         guncelleme = now(), guncelleyen = auth.uid()
   where arac = p_arac;
  if not found then raise exception 'Geçersiz araç.'; end if;
end $$;
revoke all on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean, boolean) from public, anon;
grant execute on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean, boolean) to authenticated;

-- Üyenin kendi kasasındaki medya anahtarları (yalnızca "var mı / ne zaman"; şifreli içerik dönmez)
create or replace function public.medya_kayitli_anahtarlar()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('saglayici', saglayici, 'guncelleme', guncelleme) order by saglayici), '[]'::jsonb)
    from public.havastil_ai_kasasi
   where user_id = auth.uid() and saglayici in ('groq', 'cozumleyici');
$$;
revoke all on function public.medya_kayitli_anahtarlar() from public, anon;
grant execute on function public.medya_kayitli_anahtarlar() to authenticated;

-- ---------------------------------------------------------------------------- Belge Dönüştürücü (sunucu) kotası + Worker anahtarı
-- Eski .ppt → .pptx/.pdf birebir dönüşüm LibreOffice (ücretsiz Hugging Face Space) ile yapılır; kötüye kullanımı sınırlamak için günlük adet kotası.
alter table public.medya_kota_ayar drop constraint if exists medya_kota_ayar_arac_check;
alter table public.medya_kota_ayar add constraint medya_kota_ayar_arac_check check (arac in ('transkript', 'medya_indir', 'belge_donustur'));
alter table public.medya_kota_kullanim drop constraint if exists medya_kota_kullanim_arac_check;
alter table public.medya_kota_kullanim add constraint medya_kota_kullanim_arac_check check (arac in ('transkript', 'medya_indir', 'belge_donustur'));
insert into public.medya_kota_ayar (arac, birim, kullanici_gunluk, genel_gunluk) values ('belge_donustur', 'adet', 20, 300) on conflict (arac) do nothing;

create or replace function public.medya_kota_harca(p_arac text, p_miktar bigint, p_kendi boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if p_arac not in ('transkript', 'medya_indir', 'belge_donustur') then raise exception 'Geçersiz araç.'; end if;
  if not (case p_arac when 'belge_donustur' then public.donusturucu_yetkisi_var_mi() else public.arac_yetkisi_var_mi(p_arac) end) then
    raise exception 'Bu araca erişim yetkin yok.' using errcode = '42501';
  end if;
  if p_miktar is null or p_miktar < 1 or p_miktar > 100000 then raise exception 'Geçersiz miktar.'; end if;
  perform pg_advisory_xact_lock(hashtext('medya_kota:' || p_arac));
  insert into public.medya_kota_kullanim as k (gun, arac, user_id, kaynak, miktar, istek)
  values (public._medya_bugun(), p_arac, auth.uid(), case when coalesce(p_kendi, false) then 'kendi' else 'site' end, p_miktar, 1)
  on conflict (gun, arac, user_id, kaynak) do update set miktar = k.miktar + excluded.miktar, istek = k.istek + 1;
  delete from public.medya_kota_kullanim where gun < public._medya_bugun() - 45 and random() < 0.02;
  return public.medya_kota_durumu(p_arac);
end $$;
revoke all on function public.medya_kota_harca(text, bigint, boolean) from public, anon;
grant execute on function public.medya_kota_harca(text, bigint, boolean) to authenticated;

insert into public.worker_anahtarlari (ad, etiket, tur, korumali) values
  ('belge-donusturucu-worker', 'Belge Dönüştürücü (LibreOffice)', 'worker', false)
on conflict (ad) do nothing;
