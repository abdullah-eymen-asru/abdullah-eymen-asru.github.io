-- ============================================================================
-- 0118_akademik_klasor_rls_duzeltme_paylasim_temizlik.sql
--
-- 1) HATA DÜZELTME: "infinite recursion detected in policy for relation akademik_koleksiyonlar" (klasör oluştururken).
--    KÖK NEDEN: 0117'deki yazma politikası, kendi tablosunu (ust_id kontrolü için) alt sorguyla okuyordu → okuma politikası tekrar tetiklendi.
--    ÇÖZÜM: sahiplik kontrolü RLS'i atlayan küçük SECURITY DEFINER işlevlere taşındı. Ayrıca klasörün kendi altına taşınmasını (döngü) engelleyen tetikleyici.
-- 2) R2'YE İŞLENEN AÇIKLAMALARIN VERİTABANINDAN TEMİZLENMESİ: PDF'e gömülüp R2'de doğrulandıktan sonra açıklama satırları silinir
--    (veritabanı şişmesin); aramanın çalışması için yalnızca birleştirilmiş küçük bir metin (aciklama_metni ≤ 20 KB) kalır.
-- 3) KÜTÜPHANE PAYLAŞIMI (Zotero grup kütüphanesi benzeri): kütüphanenin tamamı ya da bir klasör (alt klasörleriyle) —
--      'uyeler' : yalnızca giriş yapmış site üyeleri · 'link' : bağlantıya sahip olan herkes · 'herkes' : herkese açık (listelenir)
--    Ziyaretçi künyeleri (DOI, yazar, özet, etiketler), klasör ağacını görür; PDF okuma izni paylaşım başına açılıp kapatılır.
-- ============================================================================

-- ---------- 1) RLS ----------
create or replace function public.akademik_klasor_benim_mi(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.akademik_koleksiyonlar where id = p_id and user_id = auth.uid());
$$;
revoke all on function public.akademik_klasor_benim_mi(uuid) from public, anon;
grant execute on function public.akademik_klasor_benim_mi(uuid) to authenticated;

drop policy if exists akademik_kol_yaz on public.akademik_koleksiyonlar;
create policy akademik_kol_yaz on public.akademik_koleksiyonlar for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili()
              and (ust_id is null or public.akademik_klasor_benim_mi(ust_id)));

drop policy if exists akademik_kog_yaz on public.akademik_koleksiyon_ogeleri;
create policy akademik_kog_yaz on public.akademik_koleksiyon_ogeleri for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili()
              and public.akademik_klasor_benim_mi(koleksiyon_id)
              and exists (select 1 from public.akademik_kaynaklar k where k.id = kaynak_id and k.user_id = (select auth.uid())));

create or replace function public.akademik_koleksiyon_dongu_engelle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid := new.ust_id; n integer := 0;
begin
  if new.ust_id is null then return new; end if;
  if new.ust_id = new.id then raise exception 'Klasör kendi içine taşınamaz.'; end if;
  while v is not null and n < 50 loop
    if v = new.id then raise exception 'Klasör kendi alt klasörünün içine taşınamaz.'; end if;
    select ust_id into v from public.akademik_koleksiyonlar where id = v; n := n + 1;
  end loop;
  return new;
end $$;
drop trigger if exists akademik_koleksiyon_dongu on public.akademik_koleksiyonlar;
create trigger akademik_koleksiyon_dongu before insert or update of ust_id on public.akademik_koleksiyonlar
  for each row execute function public.akademik_koleksiyon_dongu_engelle();

-- ---------- 2) R2'ye işlenen açıklamaların temizlenmesi ----------
alter table public.akademik_kaynaklar add column if not exists aciklama_metni text;

create or replace function public.akademik_aciklamalari_r2ye_islendi(p_kaynak_id uuid, p_adet integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_metin text; v_sil integer;
begin
  -- Güvenlik: yalnızca kaynağın sahibi; istemci PDF'i R2'den geri okuyup p_adet açıklamanın dosyada olduğunu doğrulamış olmalı.
  if not exists (select 1 from public.akademik_kaynaklar where id = p_kaynak_id and user_id = auth.uid()) then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if (select count(*) from public.akademik_notlar where kaynak_id = p_kaynak_id and ek_id is not null) <> coalesce(p_adet, -1) then
    return -1;                                  -- sayı tutmuyor (arada yeni açıklama yazılmış): hiçbir şey silme
  end if;
  select left(string_agg(btrim(coalesce(metin, '') || ' ' || coalesce(yorum, '')), ' '), 20000) into v_metin
    from public.akademik_notlar where kaynak_id = p_kaynak_id and ek_id is not null;
  delete from public.akademik_notlar where kaynak_id = p_kaynak_id and ek_id is not null;
  get diagnostics v_sil = row_count;
  update public.akademik_kaynaklar set aciklama_metni = nullif(v_metin, ''), aciklama_db_otorite = false where id = p_kaynak_id;
  return v_sil;
end $$;
revoke all on function public.akademik_aciklamalari_r2ye_islendi(uuid, integer) from public, anon;
grant execute on function public.akademik_aciklamalari_r2ye_islendi(uuid, integer) to authenticated;

-- ---------- 3) Kütüphane paylaşımı ----------
create table if not exists public.akademik_paylasimlari (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kapsam     text not null default 'kutuphane' check (kapsam in ('kutuphane', 'klasor')),
  klasor_id  uuid references public.akademik_koleksiyonlar (id) on delete cascade,
  erisim     text not null default 'link' check (erisim in ('uyeler', 'link', 'herkes')),
  token      text not null unique default substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40),
  baslik     text not null default 'Akademik kütüphanem' check (length(btrim(baslik)) between 1 and 120),
  aciklama   text check (aciklama is null or length(aciklama) <= 600),
  pdf_okuma  boolean not null default true,
  aktif      boolean not null default true,
  bitis      timestamptz,
  created_at timestamptz not null default now(),
  constraint akademik_paylasim_klasor_chk check ((kapsam = 'klasor') = (klasor_id is not null))
);
create index if not exists akademik_paylasim_user_idx on public.akademik_paylasimlari (user_id);
alter table public.akademik_paylasimlari enable row level security;
drop policy if exists akademik_paylasim_sahip on public.akademik_paylasimlari;
create policy akademik_paylasim_sahip on public.akademik_paylasimlari for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_kutuphane_yetkili()
              and (klasor_id is null or public.akademik_klasor_benim_mi(klasor_id)));
revoke all on public.akademik_paylasimlari from public, anon;
grant select, insert, update, delete on public.akademik_paylasimlari to authenticated;

-- Bir paylaşımın kapsamındaki kaynak kimlikleri
create or replace function public.akademik_paylasim_kaynaklari(p_paylasim public.akademik_paylasimlari)
returns table (kaynak_id uuid) language sql stable security definer set search_path = public as $$
  with recursive alt as (
    select id from public.akademik_koleksiyonlar where id = p_paylasim.klasor_id and p_paylasim.kapsam = 'klasor'
    union all select c.id from public.akademik_koleksiyonlar c join alt on c.ust_id = alt.id)
  select k.id from public.akademik_kaynaklar k
   where k.user_id = p_paylasim.user_id
     and ((p_paylasim.kapsam = 'kutuphane' and k.gorunurluk <> 'ozel')
       or (p_paylasim.kapsam = 'klasor' and exists (select 1 from public.akademik_koleksiyon_ogeleri o join alt on alt.id = o.koleksiyon_id where o.kaynak_id = k.id)));
$$;
revoke all on function public.akademik_paylasim_kaynaklari(public.akademik_paylasimlari) from public, anon, authenticated;

create or replace function public.akademik_paylasim_gecerli(p_token text)
returns public.akademik_paylasimlari language plpgsql stable security definer set search_path = public as $$
declare p public.akademik_paylasimlari;
begin
  select * into p from public.akademik_paylasimlari where token = p_token and aktif and (bitis is null or bitis > now());
  if not found then return null; end if;
  if p.erisim = 'uyeler' and auth.uid() is null then return null; end if;
  return p;
end $$;
revoke all on function public.akademik_paylasim_gecerli(text) from public, anon, authenticated;

-- Ziyaretçi görünümü: künye + klasör ağacı (yalnızca paylaşım kapsamı). anon da çağırabilir; kapsam dışı hiçbir şey dönmez.
create or replace function public.akademik_paylasim_getir(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.akademik_paylasimlari; v_kaynaklar jsonb; v_klasorler jsonb; v_ogeler jsonb; v_sahip text;
begin
  p := public.akademik_paylasim_gecerli(p_token);
  if p.id is null then return null; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Üye') into v_sahip from public.profiles where id = p.user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'tur', k.tur, 'baslik', k.baslik, 'yazarlar', k.yazarlar, 'yayin_yili', k.yayin_yili,
      'dergi_veya_yayinevi', k.dergi_veya_yayinevi, 'doi', k.doi, 'isbn', k.isbn, 'url', k.url, 'ozet', k.ozet, 'etiketler', k.etiketler,
      'ek_alanlar', k.ek_alanlar, 'pdf_var', (k.pdf_r2_yolu is not null and p.pdf_okuma), 'pdf_boyut_bayt', k.pdf_boyut_bayt,
      'aciklama_metni', k.aciklama_metni) order by k.baslik), '[]'::jsonb)
    into v_kaynaklar from public.akademik_kaynaklar k where k.id in (select kaynak_id from public.akademik_paylasim_kaynaklari(p));
  with recursive agac as (
      select c.id, c.ust_id, c.ad from public.akademik_koleksiyonlar c
       where c.user_id = p.user_id and ((p.kapsam = 'kutuphane' and c.ust_id is null) or (p.kapsam = 'klasor' and c.id = p.klasor_id))
      union all select c.id, c.ust_id, c.ad from public.akademik_koleksiyonlar c join agac a on c.ust_id = a.id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ust_id', case when id = p.klasor_id then null else ust_id end, 'ad', ad) order by ad), '[]'::jsonb) into v_klasorler from agac;
  select coalesce(jsonb_agg(jsonb_build_object('k', o.koleksiyon_id, 's', o.kaynak_id)), '[]'::jsonb) into v_ogeler
    from public.akademik_koleksiyon_ogeleri o
   where o.user_id = p.user_id and o.kaynak_id in (select kaynak_id from public.akademik_paylasim_kaynaklari(p))
     and o.koleksiyon_id in (select (x->>'id')::uuid from jsonb_array_elements(v_klasorler) x);
  return jsonb_build_object('baslik', p.baslik, 'aciklama', p.aciklama, 'sahip', v_sahip, 'erisim', p.erisim, 'pdf_okuma', p.pdf_okuma,
                            'kapsam', p.kapsam, 'kaynaklar', v_kaynaklar, 'klasorler', v_klasorler, 'ogeler', v_ogeler);
end $$;
revoke all on function public.akademik_paylasim_getir(text) from public;
grant execute on function public.akademik_paylasim_getir(text) to anon, authenticated;

-- Worker için: paylaşımda PDF okuma izni var mı? (yalnızca R2 yolu ve sahip kimliği döner)
create or replace function public.akademik_paylasim_pdf_yolu(p_token text, p_kaynak_id uuid)
returns table (pdf_r2_yolu text, pdf_dosya_adi text, user_id uuid, pdf_rev integer)
language plpgsql stable security definer set search_path = public as $$
declare p public.akademik_paylasimlari;
begin
  p := public.akademik_paylasim_gecerli(p_token);
  if p.id is null or not p.pdf_okuma then return; end if;
  return query select k.pdf_r2_yolu, k.pdf_dosya_adi, k.user_id, k.pdf_rev from public.akademik_kaynaklar k
   where k.id = p_kaynak_id and k.pdf_r2_yolu is not null and k.id in (select kaynak_id from public.akademik_paylasim_kaynaklari(p));
end $$;
revoke all on function public.akademik_paylasim_pdf_yolu(text, uuid) from public;
grant execute on function public.akademik_paylasim_pdf_yolu(text, uuid) to anon, authenticated;

-- Herkese açık (listelenen) kütüphaneler: üyelerin "Benimle paylaşılanlar" ekranında gösterilir.
create or replace function public.akademik_acik_kutuphaneler()
returns table (token text, baslik text, aciklama text, sahip text, kaynak_sayisi bigint)
language sql stable security definer set search_path = public as $$
  select p.token, p.baslik, p.aciklama, coalesce(nullif(btrim(pr.full_name), ''), 'Üye'),
         (select count(*) from public.akademik_paylasim_kaynaklari(p))
    from public.akademik_paylasimlari p join public.profiles pr on pr.id = p.user_id
   where p.aktif and p.erisim = 'herkes' and (p.bitis is null or p.bitis > now()) and auth.uid() is not null
   order by p.created_at desc limit 100;
$$;
revoke all on function public.akademik_acik_kutuphaneler() from public, anon;
grant execute on function public.akademik_acik_kutuphaneler() to authenticated;

-- Yedek kapsamı: paylaşım ayarları da yedeğe girer
do $y$
begin
  if to_regprocedure('public.sistem_export_tablo_kayitlari_v0()') is not null then
    create or replace function public.sistem_export_tablo_kayitlari()
    returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
    language sql immutable as $b$
      select * from public.sistem_export_tablo_kayitlari_v0()
      union all select * from (values
        ('akademik_koleksiyonlar',      'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_koleksiyon_ogeleri', 'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_eklenti_ayarlari',   'notlar', 'user_id = auth.uid()', false, false),
        ('akademik_paylasimlari',       'notlar', 'user_id = auth.uid()', false, true)
      ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas)
      where not exists (select 1 from public.sistem_export_tablo_kayitlari_v0() o where o.tablo = t.tablo)
    $b$;
  end if;
end $y$;

-- Üye self-servis GERİ YÜKLEME kapsamı: klasörler, klasör-kaynak ilişkileri, eklenti tercihleri ve paylaşım ayarları da yedekten otomatik geri gelir.
-- (Site Sahibi geri yüklemesi tüm public tabloları zaten kapsar.)
do $g$
begin
  if to_regprocedure('public._uye_geri_yukleme_tablolari()') is not null
     and to_regprocedure('public._uye_geri_yukleme_tablolari_v0()') is null then
    alter function public._uye_geri_yukleme_tablolari() rename to _uye_geri_yukleme_tablolari_v0;
    execute $f$
      create or replace function public._uye_geri_yukleme_tablolari()
      returns table (tablo text, kullanici_kolonu text, anahtar_kolonu text, anahtar_deseni text)
      language sql immutable as $b$
        select * from public._uye_geri_yukleme_tablolari_v0()
        union all select * from (values
          ('akademik_koleksiyonlar',      'user_id', null::text, null::text),
          ('akademik_koleksiyon_ogeleri', 'user_id', null, null),
          ('akademik_eklenti_ayarlari',   'user_id', null, null),
          ('akademik_paylasimlari',       'user_id', null, null)
        ) t(tablo, kullanici_kolonu, anahtar_kolonu, anahtar_deseni)
        where not exists (select 1 from public._uye_geri_yukleme_tablolari_v0() o where o.tablo = t.tablo)
      $b$;
    $f$;
    revoke all on function public._uye_geri_yukleme_tablolari() from public, anon, authenticated;
  end if;
end $g$;
