-- ============================================================================
-- 0140_arac_yetkileri_medya_kota_yorum_geri_yukleme.sql
--   1) Araçlar için AYRI yetki anahtarları (Yetki Ayarları › Özellikler):
--        arac_transkript · arac_medya_donustur · arac_medya_indir   (VARSAYILAN KAPALI; mevcut Dönüştürücü yetkisi olan roller korunur)
--      Kontrol: arac_yetkisi_var_mi(p_arac)  (menü + RLS + Worker'ların TEK doğruluk kaynağı)
--   2) Medya araçları KOTA sistemi (kullanıcı başına + genel, günlük; Transkript = ses saniyesi, Medya İndirici = istek adedi)
--        • Kendi API anahtarını kullanan üyenin kullanımı SİSTEM kotasından DÜŞÜLMEZ (openmeteo / HavaStil mantığı)
--        • Site Sahibi limitleri panelden değiştirir; sistem anahtarını tamamen kapatıp "yalnızca kendi anahtarın" moduna alabilir
--   3) Anahtar kasası: 'groq' (Transkript) ve 'cozumleyici' (Medya İndirici — kendi çözümleyici adresi) sağlayıcıları
--   4) Yorumlar: yorum_geri_yukle() — başka bir Supabase veritabanına bile eksiksiz geri yükleme
--        (olmayan kullanıcı → sahipsiz yorum; aynı e-postayla kayıtlı kullanıcı varsa imzayla otomatik eşleşir; yanıt zinciri korunur)
-- Gereksinim: 0077, 0099, 0113, 0115, 0121, 0137, 0139. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- ---------------------------------------------------------------------------- 1) ARAÇ YETKİLERİ
do $$
begin
  alter table public.ozellik_varsayilan_kapali drop constraint if exists ozellik_varsayilan_kapali_anahtar_chk;
  alter table public.ozellik_varsayilan_kapali
    add constraint ozellik_varsayilan_kapali_anahtar_chk check (ozellik_anahtari in (
      'hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi',
      'kilitli_kasa_temizleme', 'duyuru_yonetimi', 'arac_transkript', 'arac_medya_donustur', 'arac_medya_indir'));
end $$;

create or replace function public.owner_kapali_ozellik_ayarla(p_ozellik text, p_rol text, p_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_ozellik is null or p_ozellik not in ('hesap_silme_onayi', 'yetki_ayarlari', 'havastil', 'havastil_groq_kota', 'izleme_okuma_yonetimi',
       'kilitli_kasa_temizleme', 'duyuru_yonetimi', 'arac_transkript', 'arac_medya_donustur', 'arac_medya_indir') then
    raise exception 'Geçersiz özellik anahtarı.';
  end if;
  if p_rol is null or p_rol not in ('admin', 'manager', 'editor', 'special_user', 'user') then raise exception 'Geçersiz rol.'; end if;
  if p_ozellik in ('hesap_silme_onayi', 'yetki_ayarlari') and p_rol in ('special_user', 'user') then raise exception 'Bu özellik üye rolleri için tanımlı değil.'; end if;
  if p_ozellik in ('havastil_groq_kota', 'izleme_okuma_yonetimi', 'kilitli_kasa_temizleme', 'duyuru_yonetimi') and p_rol <> 'admin' then
    raise exception 'Bu özellik yalnızca Yönetici (admin) rolü için tanımlıdır.';
  end if;
  insert into public.ozellik_varsayilan_kapali as o (ozellik_anahtari, rol, acik, guncelleyen_id)
  values (p_ozellik, p_rol, coalesce(p_acik, false), auth.uid())
  on conflict (ozellik_anahtari, rol) do update
    set acik = excluded.acik, guncelleyen_id = excluded.guncelleyen_id, updated_at = now();
end $$;
revoke all on function public.owner_kapali_ozellik_ayarla(text, text, boolean) from public, anon;
grant execute on function public.owner_kapali_ozellik_ayarla(text, text, boolean) to authenticated;

-- Mevcut davranışı koru: Dönüştürücü yetkisi AÇIK olan roller, üç yeni araç anahtarında da açık başlar.
insert into public.ozellik_varsayilan_kapali (ozellik_anahtari, rol, acik)
select k.anahtar, d.rol, true
  from public.donusturucu_yetkileri d
 cross join (values ('arac_transkript'), ('arac_medya_donustur'), ('arac_medya_indir')) as k(anahtar)
 where d.can_use_converter
on conflict (ozellik_anahtari, rol) do nothing;

create or replace function public.arac_yetkisi_var_mi(p_arac text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (p_arac in ('transkript', 'medya_donustur', 'medya_indir')
            and p.role <> 'demo'
            and not coalesce(p.is_suspended, false)
            and exists (select 1 from public.ozellik_varsayilan_kapali o
                         where o.ozellik_anahtari = 'arac_' || p_arac and o.rol = p.role and o.acik))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.arac_yetkisi_var_mi(text) from public, anon;
grant execute on function public.arac_yetkisi_var_mi(text) to authenticated;

-- ---------------------------------------------------------------------------- 2) MEDYA KOTASI
create table if not exists public.medya_kota_ayar (
  arac                text primary key check (arac in ('transkript', 'medya_indir')),
  birim               text not null check (birim in ('saniye', 'adet')),
  kullanici_gunluk    bigint check (kullanici_gunluk is null or kullanici_gunluk >= 0),   -- null = sınırsız
  genel_gunluk        bigint check (genel_gunluk is null or genel_gunluk >= 0),
  kendi_anahtar_izni  boolean not null default true,    -- üyeler kendi API anahtarını/çözümleyicisini kullanabilir mi
  sistem_anahtari_acik boolean not null default true,   -- false: yalnızca kendi anahtarıyla kullanılabilir
  guncelleme          timestamptz not null default now(),
  guncelleyen         uuid
);
insert into public.medya_kota_ayar (arac, birim, kullanici_gunluk, genel_gunluk) values
  ('transkript', 'saniye', 3600, 20000),
  ('medya_indir', 'adet', 15, 200)
on conflict (arac) do nothing;
alter table public.medya_kota_ayar enable row level security;
revoke all on public.medya_kota_ayar from anon, authenticated;

create table if not exists public.medya_kota_kullanim (
  gun     date not null,
  arac    text not null check (arac in ('transkript', 'medya_indir')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kaynak  text not null check (kaynak in ('site', 'kendi')),
  miktar  bigint not null default 0,
  istek   integer not null default 0,
  primary key (gun, arac, user_id, kaynak)
);
create index if not exists medya_kota_kullanim_gun_idx on public.medya_kota_kullanim (gun, arac);
alter table public.medya_kota_kullanim enable row level security;
revoke all on public.medya_kota_kullanim from anon, authenticated;

create or replace function public._medya_bugun() returns date language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- Durum: kullanıcı + genel (herkes kendi ve toplam kullanımı görür; başkasının kimliği görünmez)
create or replace function public.medya_kota_durumu(p_arac text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.medya_kota_ayar; v_kul bigint; v_gen bigint; v_kendi bigint; v_bugun date := public._medya_bugun();
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  select * into a from public.medya_kota_ayar where arac = p_arac;
  if not found then raise exception 'Geçersiz araç.'; end if;
  select coalesce(sum(miktar) filter (where user_id = auth.uid() and kaynak = 'site'), 0),
         coalesce(sum(miktar) filter (where kaynak = 'site'), 0),
         coalesce(sum(miktar) filter (where user_id = auth.uid() and kaynak = 'kendi'), 0)
    into v_kul, v_gen, v_kendi
    from public.medya_kota_kullanim where gun = v_bugun and arac = p_arac;
  return jsonb_build_object(
    'arac', p_arac, 'birim', a.birim, 'gun', v_bugun,
    'kullanici', jsonb_build_object('kullanilan', v_kul, 'limit', a.kullanici_gunluk,
                  'kalan', case when a.kullanici_gunluk is null then null else greatest(a.kullanici_gunluk - v_kul, 0) end),
    'genel', jsonb_build_object('kullanilan', v_gen, 'limit', a.genel_gunluk,
                  'kalan', case when a.genel_gunluk is null then null else greatest(a.genel_gunluk - v_gen, 0) end),
    'kendi_anahtarla_kullanilan', v_kendi,
    'kendi_anahtar_izni', a.kendi_anahtar_izni,
    'sistem_anahtari_acik', a.sistem_anahtari_acik);
end $$;
revoke all on function public.medya_kota_durumu(text) from public, anon;
grant execute on function public.medya_kota_durumu(text) to authenticated;

-- Harcama kaydı: Worker, İŞ BAŞARIYLA BİTTİKTEN SONRA kullanıcının kendi JWT'siyle çağırır (iade yolu yoktur → kota kaçırılamaz).
-- p_kendi = true  → yalnızca bilgi amaçlı 'kendi' satırına yazılır (sistem kotasından düşmez)
create or replace function public.medya_kota_harca(p_arac text, p_miktar bigint, p_kendi boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.medya_kota_ayar;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if p_arac not in ('transkript', 'medya_indir') then raise exception 'Geçersiz araç.'; end if;
  if not public.arac_yetkisi_var_mi(case p_arac when 'transkript' then 'transkript' else 'medya_indir' end) then
    raise exception 'Bu araca erişim yetkin yok.' using errcode = '42501';
  end if;
  if p_miktar is null or p_miktar < 1 or p_miktar > 100000 then raise exception 'Geçersiz miktar.'; end if;
  select * into a from public.medya_kota_ayar where arac = p_arac;
  perform pg_advisory_xact_lock(hashtext('medya_kota:' || p_arac));
  insert into public.medya_kota_kullanim as k (gun, arac, user_id, kaynak, miktar, istek)
  values (public._medya_bugun(), p_arac, auth.uid(), case when coalesce(p_kendi, false) then 'kendi' else 'site' end, p_miktar, 1)
  on conflict (gun, arac, user_id, kaynak) do update set miktar = k.miktar + excluded.miktar, istek = k.istek + 1;
  delete from public.medya_kota_kullanim where gun < public._medya_bugun() - 45 and random() < 0.02;   -- hafif bakım
  return public.medya_kota_durumu(p_arac);
end $$;
revoke all on function public.medya_kota_harca(text, bigint, boolean) from public, anon;
grant execute on function public.medya_kota_harca(text, bigint, boolean) to authenticated;

-- Site Sahibi: limitleri oku / değiştir; bugünkü genel özet + en çok kullananlar (e-posta maskeli)
create or replace function public.owner_medya_kota_ayarla(p_arac text, p_kullanici bigint, p_genel bigint, p_kendi_izni boolean, p_sistem_acik boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_kullanici is not null and p_kullanici < 0 or p_genel is not null and p_genel < 0 then raise exception 'Limit negatif olamaz.'; end if;
  update public.medya_kota_ayar
     set kullanici_gunluk = p_kullanici, genel_gunluk = p_genel,
         kendi_anahtar_izni = coalesce(p_kendi_izni, kendi_anahtar_izni),
         sistem_anahtari_acik = coalesce(p_sistem_acik, sistem_anahtari_acik),
         guncelleme = now(), guncelleyen = auth.uid()
   where arac = p_arac;
  if not found then raise exception 'Geçersiz araç.'; end if;
end $$;
revoke all on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean) from public, anon;
grant execute on function public.owner_medya_kota_ayarla(text, bigint, bigint, boolean, boolean) to authenticated;

create or replace function public.owner_medya_kota_ozeti()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  select coalesce(jsonb_agg(x order by x->>'arac', (x->>'site')::bigint desc), '[]'::jsonb) into v from (
    select jsonb_build_object('arac', k.arac, 'ad', coalesce(nullif(btrim(p.full_name), ''), 'Üye'),
             'site', sum(k.miktar) filter (where k.kaynak = 'site'), 'kendi', coalesce(sum(k.miktar) filter (where k.kaynak = 'kendi'), 0),
             'istek', sum(k.istek)) x
      from public.medya_kota_kullanim k join public.profiles p on p.id = k.user_id
     where k.gun = public._medya_bugun()
     group by k.arac, k.user_id, p.full_name
     order by sum(k.miktar) desc limit 40) t;
  return v;
end $$;
revoke all on function public.owner_medya_kota_ozeti() from public, anon;
grant execute on function public.owner_medya_kota_ozeti() to authenticated;

-- Ayarların tamamı (herkese okunur; yalnızca sayısal limitler)
create or replace function public.medya_kota_ayarlari()
returns setof public.medya_kota_ayar language sql stable security definer set search_path = public as $$
  select * from public.medya_kota_ayar where auth.uid() is not null;
$$;
revoke all on function public.medya_kota_ayarlari() from public, anon;
grant execute on function public.medya_kota_ayarlari() to authenticated;

-- ---------------------------------------------------------------------------- 3) ANAHTAR KASASI: yeni sağlayıcılar
alter table public.havastil_ai_kasasi drop constraint if exists havastil_ai_kasasi_saglayici_check;
alter table public.havastil_ai_kasasi
  add constraint havastil_ai_kasasi_saglayici_check check (saglayici in ('gemini', 'openai', 'anthropic', 'openrouter', 'openmeteo', 'groq', 'cozumleyici'));

create or replace function public._kasa_yetkisi_var_mi()
returns boolean language sql stable security definer set search_path = public as $$
  select public.havastil_yetkisi_var_mi() or public.arac_yetkisi_var_mi('transkript') or public.arac_yetkisi_var_mi('medya_indir');
$$;
revoke all on function public._kasa_yetkisi_var_mi() from public, anon;
grant execute on function public._kasa_yetkisi_var_mi() to authenticated;

drop policy if exists havastil_ai_kasasi_sahip_oku on public.havastil_ai_kasasi;
drop policy if exists havastil_ai_kasasi_sahip_yaz on public.havastil_ai_kasasi;
create policy havastil_ai_kasasi_sahip_oku on public.havastil_ai_kasasi for select to authenticated
  using (user_id = auth.uid() and public._kasa_yetkisi_var_mi());
create policy havastil_ai_kasasi_sahip_yaz on public.havastil_ai_kasasi for all to authenticated
  using (user_id = auth.uid() and public._kasa_yetkisi_var_mi())
  with check (user_id = auth.uid() and public._kasa_yetkisi_var_mi());

-- ---------------------------------------------------------------------------- 4) YORUM GERİ YÜKLEME (başka veritabanına dâhil)
-- Yalnızca Site Sahibi. Kullanıcı yoksa user_id NULL (sahipsiz) kalır; imza (e-posta özeti) eşleşen kullanıcı varsa otomatik bağlanır.
-- Yanıtlar (ust_id) ikinci geçişte bağlanır: üst yorum henüz yoksa yanıt, ana yorum olarak değil, hata sayılmadan "yetim yanıt" olarak raporlanır.
create or replace function public.yorum_geri_yukle(p_satirlar jsonb, p_mod text default 'eksikleri')
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  e jsonb; r public.yorumlar; v_harita jsonb; v_uid uuid; v_gz uuid;
  v_ekle bigint := 0; v_guncel bigint := 0; v_atla bigint := 0; v_hata bigint := 0; v_bagli bigint := 0; v_yetim bigint := 0;
  v_hatalar jsonb := '[]'::jsonb; v_yeni boolean; v_ust uuid;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_mod not in ('eksikleri', 'uzerine') then raise exception 'Geçersiz mod.'; end if;
  if p_satirlar is null or jsonb_typeof(p_satirlar) <> 'array' then raise exception 'Satırlar bir JSON dizisi olmalı.'; end if;
  if jsonb_array_length(p_satirlar) > 500 then raise exception 'Sayfa başına en çok 500 satır.'; end if;
  select coalesce(jsonb_object_agg(public._yorum_imza(u.id), u.id::text), '{}'::jsonb) into v_harita from auth.users u;

  for e in select x from jsonb_array_elements(p_satirlar) x loop
    begin
      r := jsonb_populate_record(null::public.yorumlar, e);
      if r.icerik_anahtari is null or r.metin is null or char_length(btrim(r.metin)) < 1 then raise exception 'Eksik alan (icerik_anahtari/metin).'; end if;
      r.id := coalesce(r.id, gen_random_uuid());
      v_uid := r.user_id;
      if v_uid is not null and not exists (select 1 from auth.users where id = v_uid) then v_uid := null; end if;
      if v_uid is null and r.author_signature_hash is not null and v_harita ? r.author_signature_hash then v_uid := (v_harita ->> r.author_signature_hash)::uuid; end if;
      v_gz := r.gizleyen;
      if v_gz is not null and not exists (select 1 from auth.users where id = v_gz) then v_gz := null; end if;
      if r.author_signature_hash is null then
        if v_uid is null then raise exception 'İmza yok ve kullanıcı bulunamadı.'; end if;
        r.author_signature_hash := public._yorum_imza(v_uid);
      end if;
      v_yeni := null;
      if p_mod = 'uzerine' then
        insert into public.yorumlar as y (id, icerik_anahtari, ust_id, user_id, author_signature_hash, gorunen_ad, anonim, metin, created_at, edited_at, gizli, gizleyen)
        values (r.id, r.icerik_anahtari, null, v_uid, r.author_signature_hash, r.gorunen_ad, coalesce(r.anonim, false), btrim(r.metin), coalesce(r.created_at, now()), r.edited_at, coalesce(r.gizli, false), v_gz)
        on conflict (id) do update set metin = excluded.metin, gorunen_ad = excluded.gorunen_ad, anonim = excluded.anonim, edited_at = excluded.edited_at, gizli = excluded.gizli, gizleyen = excluded.gizleyen
        returning (xmax = 0) into v_yeni;
      else
        insert into public.yorumlar (id, icerik_anahtari, ust_id, user_id, author_signature_hash, gorunen_ad, anonim, metin, created_at, edited_at, gizli, gizleyen)
        values (r.id, r.icerik_anahtari, null, v_uid, r.author_signature_hash, r.gorunen_ad, coalesce(r.anonim, false), btrim(r.metin), coalesce(r.created_at, now()), r.edited_at, coalesce(r.gizli, false), v_gz)
        on conflict (id) do nothing returning true into v_yeni;
      end if;
      if v_yeni is null then v_atla := v_atla + 1; elsif v_yeni then v_ekle := v_ekle + 1; else v_guncel := v_guncel + 1; end if;
      -- Yanıt zinciri: üst yorum veritabanında varsa bağla
      v_ust := nullif(e ->> 'ust_id', '')::uuid;
      if v_ust is not null and v_ust <> r.id then
        update public.yorumlar set ust_id = v_ust where id = r.id and ust_id is null and exists (select 1 from public.yorumlar where id = v_ust);
        if found then v_bagli := v_bagli + 1; else
          if not exists (select 1 from public.yorumlar where id = r.id and ust_id = v_ust) then v_yetim := v_yetim + 1; end if;
        end if;
      end if;
    exception when others then
      v_hata := v_hata + 1;
      if jsonb_array_length(v_hatalar) < 5 then v_hatalar := v_hatalar || to_jsonb(left(sqlerrm, 300)); end if;
    end;
  end loop;
  return jsonb_build_object('tablo', 'yorumlar', 'eklenen', v_ekle, 'guncellenen', v_guncel, 'atlanan', v_atla, 'hatali', v_hata,
                            'yanit_baglanan', v_bagli, 'yetim_yanit', v_yetim, 'hatalar', v_hatalar, 'mod', p_mod);
end $$;
revoke all on function public.yorum_geri_yukle(jsonb, text) from public, anon;
grant execute on function public.yorum_geri_yukle(jsonb, text) to authenticated;

-- Yetim yanıtları (üst yorumu henüz bulunmayan) tüm içe aktarma bittikten sonra bağlamak için: İstemci, aynı dosyadan ust_id eşlemesini tekrar yollar.
create or replace function public.yorum_yanit_bagla(p_eslemeler jsonb)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare n bigint := 0; c bigint; e jsonb;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.'; end if;
  if p_eslemeler is null or jsonb_typeof(p_eslemeler) <> 'array' or jsonb_array_length(p_eslemeler) > 1000 then raise exception 'Geçersiz eşleme listesi.'; end if;
  for e in select x from jsonb_array_elements(p_eslemeler) x loop
    update public.yorumlar y set ust_id = (e ->> 'ust_id')::uuid
     where y.id = (e ->> 'id')::uuid and y.ust_id is null and (e ->> 'ust_id')::uuid <> y.id
       and exists (select 1 from public.yorumlar p where p.id = (e ->> 'ust_id')::uuid and p.icerik_anahtari = y.icerik_anahtari);
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function public.yorum_yanit_bagla(jsonb) from public, anon;
grant execute on function public.yorum_yanit_bagla(jsonb) to authenticated;

-- ---------------------------------------------------------------------------- 5) Worker anahtarları (0139 eklemiş olabilir; garanti)
insert into public.worker_anahtarlari (ad, etiket, tur, korumali) values
  ('transkript-worker', 'Transkript (Groq Whisper)', 'worker', false),
  ('medya-indirici-worker', 'Medya İndirici', 'worker', false)
on conflict (ad) do nothing;
