-- ============================================================================
-- 0072_akademik_kutuphane.sql
-- "Akademik Kütüphane" — çok kullanıcılı kaynak/PDF kütüphanesi + PDF açıklama motoru.
--
-- 0001..0071 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
--
-- NE EKLENİYOR
--   1) akademik_kaynaklar        — künye (başlık/yazar/DOI/ISBN…) + R2'deki PDF'in yolu/boyutu
--   2) akademik_notlar           — kaynağa bağlı serbest notlar + PDF açıklamalarının (vurgu,
--                                  not, çizim…) özet kaydı. PDF'in KENDİSİ R2'dedir; burası özettir.
--   3) akademik_okuyucu_ayarlari — PDF okuyucu motorunun (PDF.js) sabitlenmiş sürümü (tek satır)
--   4) Yetki: 'akademik_kutuphane' özelliği, 0048'in MEVCUT ozellik_erisimleri matrisine bağlanır
--      (panel > Yetki Ayarları). Yeni bir kalkan/izin sistemi KURULMAZ.
--
-- YETKİ MODELİ (0048'in ilkesi korunur: satır yoksa varsayılan = açık)
--   * Kütüphaneyi kullanabilmek: akademik_kutuphane_yetkili()
--       = giriş yapmış + askıda değil + (owner  VEYA  owner o rol için özelliği kapatmamış)
--     Owner, Yetki Ayarları matrisinden user / special_user / editor / manager / admin
--     rollerinin HER BİRİ için kütüphaneyi kapatabilir. Kapatılan rolün verisi SİLİNMEZ,
--     yeniden açılınca aynen döner (0059 ile aynı davranış).
--   * Herkes (admin dahil) YALNIZCA KENDİ kaynak/not satırlarını görür ve yönetir.
--   * Görünürlük (gorunurluk):
--       'ozel'         -> sadece sahibi (varsayılan)
--       'ekip'         -> editor / manager / admin / owner rolündekiler OKUYABİLİR
--       'herkese_acik' -> kütüphaneyi kullanabilen her giriş yapmış üye OKUYABİLİR
--     Paylaşılan kaynakta başkaları künyeyi ve PDF'i SADECE OKUR; düzenleme/silme/açıklama
--     yazma hakkı yalnızca sahibindedir. Notlar (akademik_notlar) HİÇ paylaşılmaz.
--   * owner (site sahibi): tüm üyelerin kaynaklarını, notlarını ve PDF'lerini İNCELEYEBİLİR
--     (salt okuma). Başkasının verisini değiştirme/silme yetkisi owner'a da verilmemiştir.
--
-- DOSYA POLİTİKASI: pdf_boyut_bayt üzerinde üst sınır / kota YOKTUR (bilinçli istek).
--   pdf_r2_yolu ise CHECK ile "akademik-kutuphane/users/<sahip uid>/…pdf" biçimine kilitlidir;
--   böylece bir kullanıcı satırını başkasının R2 yoluna işaret ettirip o dosyayı okuyamaz.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Yardımcı fonksiyonlar
-- ----------------------------------------------------------------------------
create or replace function public.akademik_kutuphane_yetkili()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and not coalesce(p.is_suspended, false)
      and (
        p.role = 'owner'
        or public.ozellik_erisimi_var_mi('akademik_kutuphane', p.role)
      )
  );
$$;

revoke all on function public.akademik_kutuphane_yetkili() from public, anon;
grant execute on function public.akademik_kutuphane_yetkili() to authenticated;

-- 'ekip' görünürlüğü: editor / manager / admin / owner (askıda değil).
create or replace function public.akademik_ekip_uyesi_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('editor', 'manager', 'admin', 'owner')
      and not coalesce(p.is_suspended, false)
  );
$$;

revoke all on function public.akademik_ekip_uyesi_mi() from public, anon;
grant execute on function public.akademik_ekip_uyesi_mi() to authenticated;

create or replace function public.akademik_guncelleme_tarihi_ayarla()
returns trigger
language plpgsql
as $$
begin
  new.guncelleme_tarihi := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) KAYNAKLAR
-- ----------------------------------------------------------------------------
create table if not exists public.akademik_kaynaklar (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  baslik                text not null check (length(btrim(baslik)) between 1 and 1000),
  -- [{"adi":"Ayşe","soyadi":"Yılmaz"}, {"kurum":"OECD"}] — kurumsal yazar için "kurum"
  yazarlar              jsonb not null default '[]'::jsonb check (jsonb_typeof(yazarlar) = 'array'),
  yayin_yili            smallint check (yayin_yili between 0 and 3000),
  dergi_veya_yayinevi   text check (length(dergi_veya_yayinevi) <= 500),
  doi                   text check (doi ~ '^10\.[0-9]{4,9}/\S+$'),
  isbn                  text check (isbn ~ '^[0-9Xx-]{10,17}$'),
  url                   text check (length(url) <= 2000),
  ozet                  text check (length(ozet) <= 20000),
  etiketler             text[] not null default '{}',
  -- Künyeye ait ek alanlar: cilt, sayi, sayfa, baski, sehir, dergi_kisaltma, issn, dil, ...
  ek_alanlar            jsonb not null default '{}'::jsonb check (jsonb_typeof(ek_alanlar) = 'object'),
  tur                   text not null default 'makale'
                        check (tur in ('makale', 'kitap', 'kitap_bolumu', 'bildiri', 'tez', 'rapor', 'web', 'diger')),
  pdf_r2_yolu           text,
  pdf_dosya_adi         text check (length(pdf_dosya_adi) <= 300),
  pdf_boyut_bayt        bigint check (pdf_boyut_bayt >= 0),     -- ÜST SINIR YOK (bilinçli)
  pdf_rev               integer not null default 0,             -- her R2 geri yazımında +1 (iyimser kilit)
  pdf_guncelleme_tarihi timestamptz,
  gorunurluk            text not null default 'ozel' check (gorunurluk in ('ozel', 'ekip', 'herkese_acik')),
  olusturma_tarihi      timestamptz not null default now(),
  guncelleme_tarihi     timestamptz not null default now(),
  constraint akademik_pdf_yolu_sahibine_ait check (
    pdf_r2_yolu is null
    or (
      pdf_r2_yolu like ('akademik-kutuphane/users/' || user_id::text || '/%')
      and pdf_r2_yolu !~ '\.\.'
      and pdf_r2_yolu ~ '\.pdf$'
    )
  )
);

comment on table public.akademik_kaynaklar is
  'Akademik Kütüphane künyeleri. PDF baytları Cloudflare R2''de (akademik-kutuphane/users/<uid>/<ad>.pdf); burada yalnızca yol/boyut/sürüm tutulur. Boyut/kota sınırı yoktur.';

create index if not exists akademik_kaynaklar_user_idx on public.akademik_kaynaklar (user_id, guncelleme_tarihi desc);
create index if not exists akademik_kaynaklar_etiket_idx on public.akademik_kaynaklar using gin (etiketler);
create index if not exists akademik_kaynaklar_gorunurluk_idx on public.akademik_kaynaklar (gorunurluk) where gorunurluk <> 'ozel';
-- Aynı kullanıcı aynı DOI'yi iki kez eklemesin (içe aktarmada çift kayıt engeli).
create unique index if not exists akademik_kaynaklar_doi_tekil_idx
  on public.akademik_kaynaklar (user_id, lower(doi)) where doi is not null;

drop trigger if exists trg_akademik_kaynaklar_guncelleme on public.akademik_kaynaklar;
create trigger trg_akademik_kaynaklar_guncelleme
  before update on public.akademik_kaynaklar
  for each row execute function public.akademik_guncelleme_tarihi_ayarla();

-- user_id bir kez atanır, sonradan değiştirilemez (sahiplik devri / R2 yolu kaçırma yok).
create or replace function public.akademik_sahip_degistirilemez()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Kaynağın sahibi değiştirilemez.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_akademik_kaynaklar_sahip on public.akademik_kaynaklar;
create trigger trg_akademik_kaynaklar_sahip
  before update on public.akademik_kaynaklar
  for each row execute function public.akademik_sahip_degistirilemez();

alter table public.akademik_kaynaklar enable row level security;

drop policy if exists "akademik_kaynak_select" on public.akademik_kaynaklar;
create policy "akademik_kaynak_select"
  on public.akademik_kaynaklar for select
  to authenticated
  using (
    public.is_owner()                                                   -- site sahibi: tümünü inceler
    or (
      public.akademik_kutuphane_yetkili()
      and (
        user_id = auth.uid()
        or gorunurluk = 'herkese_acik'
        or (gorunurluk = 'ekip' and public.akademik_ekip_uyesi_mi())
      )
    )
  );

drop policy if exists "akademik_kaynak_insert" on public.akademik_kaynaklar;
create policy "akademik_kaynak_insert"
  on public.akademik_kaynaklar for insert
  to authenticated
  with check (user_id = auth.uid() and public.akademik_kutuphane_yetkili());

drop policy if exists "akademik_kaynak_update" on public.akademik_kaynaklar;
create policy "akademik_kaynak_update"
  on public.akademik_kaynaklar for update
  to authenticated
  using (user_id = auth.uid() and public.akademik_kutuphane_yetkili())
  with check (user_id = auth.uid() and public.akademik_kutuphane_yetkili());

drop policy if exists "akademik_kaynak_delete" on public.akademik_kaynaklar;
create policy "akademik_kaynak_delete"
  on public.akademik_kaynaklar for delete
  to authenticated
  using (user_id = auth.uid() and public.akademik_kutuphane_yetkili());

revoke all on public.akademik_kaynaklar from public, anon;
grant select, insert, update, delete on public.akademik_kaynaklar to authenticated;

-- ----------------------------------------------------------------------------
-- 2) NOTLAR — kaynağa bağlı serbest notlar + PDF açıklama özetleri
-- ----------------------------------------------------------------------------
create table if not exists public.akademik_notlar (
  id          uuid primary key default gen_random_uuid(),
  kaynak_id   uuid not null references public.akademik_kaynaklar(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  -- 'not' / 'alinti' = serbest araştırma notu / elle girilmiş alıntı; geri kalanlar PDF açıklamasıdır.
  tur         text not null default 'not'
              check (tur in ('not', 'alinti', 'vurgu', 'altcizgi', 'ustcizgi', 'cizim', 'sekil', 'yapiskan', 'metin')),
  sayfa       integer check (sayfa >= 1),
  metin       text check (length(metin) <= 200000),   -- alıntılanan PDF metni ya da not gövdesi
  yorum       text check (length(yorum) <= 200000),   -- kullanıcının açıklama/yorumu
  renk        text check (renk ~ '^#[0-9a-fA-F]{6}$'),
  etiketler   text[] not null default '{}',
  konum       jsonb check (jsonb_typeof(konum) = 'object'),  -- {kutular:[[x1,y1,x2,y2]…]} PDF koordinatı
  ek_id       text check (length(ek_id) <= 100),      -- PDF içindeki açıklamanın /NM kimliği
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint akademik_not_ek_tekil unique (kaynak_id, ek_id)
);

comment on table public.akademik_notlar is
  'Kaynağa bağlı serbest notlar (tur=not/alinti) ve PDF açıklamalarının özet kaydı (ek_id dolu satırlar). Sadece sahibi görür; owner inceleyebilir.';

create index if not exists akademik_notlar_kaynak_idx on public.akademik_notlar (kaynak_id, sayfa, created_at);
create index if not exists akademik_notlar_user_idx on public.akademik_notlar (user_id);

create or replace function public.akademik_not_guncelleme_ayarla()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_akademik_notlar_guncelleme on public.akademik_notlar;
create trigger trg_akademik_notlar_guncelleme
  before update on public.akademik_notlar
  for each row execute function public.akademik_not_guncelleme_ayarla();

alter table public.akademik_notlar enable row level security;

drop policy if exists "akademik_not_select" on public.akademik_notlar;
create policy "akademik_not_select"
  on public.akademik_notlar for select
  to authenticated
  using (
    public.is_owner()
    or (user_id = auth.uid() and public.akademik_kutuphane_yetkili())
  );

-- Yazma: not sahibi = kaynağın sahibi olmalı (başkasının kaynağına not iliştirilemez).
drop policy if exists "akademik_not_insert" on public.akademik_notlar;
create policy "akademik_not_insert"
  on public.akademik_notlar for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.akademik_kutuphane_yetkili()
    and exists (select 1 from public.akademik_kaynaklar k where k.id = kaynak_id and k.user_id = auth.uid())
  );

drop policy if exists "akademik_not_update" on public.akademik_notlar;
create policy "akademik_not_update"
  on public.akademik_notlar for update
  to authenticated
  using (user_id = auth.uid() and public.akademik_kutuphane_yetkili())
  with check (
    user_id = auth.uid()
    and public.akademik_kutuphane_yetkili()
    and exists (select 1 from public.akademik_kaynaklar k where k.id = kaynak_id and k.user_id = auth.uid())
  );

drop policy if exists "akademik_not_delete" on public.akademik_notlar;
create policy "akademik_not_delete"
  on public.akademik_notlar for delete
  to authenticated
  using (user_id = auth.uid() and public.akademik_kutuphane_yetkili());

revoke all on public.akademik_notlar from public, anon;
grant select, insert, update, delete on public.akademik_notlar to authenticated;

-- PDF açıklama özetini tek işlemde eşitler (SECURITY INVOKER: RLS aynen geçerli).
-- p_aciklamalar: [{ek_id, tur, sayfa, metin, yorum, renk, konum}, …]  — PDF'in o anki TAM listesi.
-- Listede olmayan (silinmiş) açıklamaların özeti silinir; serbest notlar (ek_id boş) ASLA dokunulmaz.
create or replace function public.akademik_aciklamalari_esitle(p_kaynak_id uuid, p_aciklamalar jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  adet integer := 0;
begin
  if jsonb_typeof(coalesce(p_aciklamalar, '[]'::jsonb)) <> 'array' then
    raise exception 'p_aciklamalar bir dizi olmalı.';
  end if;

  delete from public.akademik_notlar n
  where n.kaynak_id = p_kaynak_id
    and n.ek_id is not null
    and n.ek_id not in (
      select a->>'ek_id' from jsonb_array_elements(coalesce(p_aciklamalar, '[]'::jsonb)) a
      where a->>'ek_id' is not null
    );

  insert into public.akademik_notlar (kaynak_id, user_id, tur, sayfa, metin, yorum, renk, konum, ek_id)
  select p_kaynak_id, auth.uid(),
         a->>'tur',
         nullif(a->>'sayfa', '')::integer,
         a->>'metin',
         a->>'yorum',
         nullif(a->>'renk', ''),
         case when jsonb_typeof(a->'konum') = 'object' then a->'konum' else null end,
         a->>'ek_id'
  from jsonb_array_elements(coalesce(p_aciklamalar, '[]'::jsonb)) a
  where a->>'ek_id' is not null
  on conflict (kaynak_id, ek_id) do update
    set tur = excluded.tur, sayfa = excluded.sayfa, metin = excluded.metin,
        yorum = excluded.yorum, renk = excluded.renk, konum = excluded.konum;

  get diagnostics adet = row_count;
  return adet;
end;
$$;

revoke all on function public.akademik_aciklamalari_esitle(uuid, jsonb) from public, anon;
grant execute on function public.akademik_aciklamalari_esitle(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) OKUYUCU MOTORU SÜRÜMÜ (tek satır) — "Okuyucu Motorunu Güncelle"
--    Sürümü SADECE owner değiştirir; herkes okur. Böylece tüm kullanıcılar aynı, sınanmış
--    PDF.js sürümünü kullanır; yeni sürüm owner'ın onayıyla herkese birden geçer.
-- ----------------------------------------------------------------------------
create table if not exists public.akademik_okuyucu_ayarlari (
  id              smallint primary key default 1 check (id = 1),
  pdfjs_surum     text not null default '5.6.205' check (pdfjs_surum ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  pdflib_surum    text not null default '1.17.1' check (pdflib_surum ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  guncelleyen_id  uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

insert into public.akademik_okuyucu_ayarlari (id) values (1) on conflict (id) do nothing;

alter table public.akademik_okuyucu_ayarlari enable row level security;

drop policy if exists "akademik_okuyucu_select" on public.akademik_okuyucu_ayarlari;
create policy "akademik_okuyucu_select"
  on public.akademik_okuyucu_ayarlari for select
  to authenticated
  using (public.akademik_kutuphane_yetkili());

revoke all on public.akademik_okuyucu_ayarlari from public, anon;
grant select on public.akademik_okuyucu_ayarlari to authenticated;
-- Yazma politikası bilerek YOK: tek yol aşağıdaki owner RPC'si.

create or replace function public.owner_akademik_okuyucu_surumu_ayarla(p_pdfjs text, p_pdflib text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: okuyucu motoru sürümünü sadece Site Sahibi (owner) değiştirebilir.';
  end if;
  if p_pdfjs !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'Geçersiz PDF.js sürümü (örnek: 5.6.205).';
  end if;
  if p_pdflib is not null and p_pdflib !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'Geçersiz pdf-lib sürümü (örnek: 1.17.1).';
  end if;

  update public.akademik_okuyucu_ayarlari
     set pdfjs_surum  = p_pdfjs,
         pdflib_surum = coalesce(p_pdflib, pdflib_surum),
         guncelleyen_id = auth.uid(),
         updated_at = now()
   where id = 1;
end;
$$;

revoke all on function public.owner_akademik_okuyucu_surumu_ayarla(text, text) from public, anon;
grant execute on function public.owner_akademik_okuyucu_surumu_ayarla(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) OWNER MERKEZİ DENETİM — "Tüm Kullanıcıların Kaynakları"
--    Sahip adı/e-postası profiles'tan gelir (RLS'i atlamak için SECURITY DEFINER);
--    is_owner() olmayan çağıran SIFIR satır alır. Not sayısı da buradan.
-- ----------------------------------------------------------------------------
create or replace function public.owner_akademik_kaynaklari_getir(p_user_id uuid default null)
returns table (
  id uuid, user_id uuid, sahip_ad text, sahip_eposta text, sahip_rol text,
  baslik text, yazarlar jsonb, yayin_yili smallint, dergi_veya_yayinevi text,
  doi text, isbn text, url text, ozet text, etiketler text[], ek_alanlar jsonb, tur text,
  pdf_r2_yolu text, pdf_dosya_adi text, pdf_boyut_bayt bigint, pdf_rev integer,
  gorunurluk text, olusturma_tarihi timestamptz, guncelleme_tarihi timestamptz,
  not_sayisi bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select k.id, k.user_id, p.full_name, p.email, p.role,
         k.baslik, k.yazarlar, k.yayin_yili, k.dergi_veya_yayinevi,
         k.doi, k.isbn, k.url, k.ozet, k.etiketler, k.ek_alanlar, k.tur,
         k.pdf_r2_yolu, k.pdf_dosya_adi, k.pdf_boyut_bayt, k.pdf_rev,
         k.gorunurluk, k.olusturma_tarihi, k.guncelleme_tarihi,
         (select count(*) from public.akademik_notlar n where n.kaynak_id = k.id)
  from public.akademik_kaynaklar k
  join public.profiles p on p.id = k.user_id
  where public.is_owner()
    and (p_user_id is null or k.user_id = p_user_id)
  order by k.guncelleme_tarihi desc;
$$;

revoke all on function public.owner_akademik_kaynaklari_getir(uuid) from public, anon;
grant execute on function public.owner_akademik_kaynaklari_getir(uuid) to authenticated;

-- Kütüphanede en az bir kaynağı olan üyeler (owner'ın üye filtresi için).
create or replace function public.owner_akademik_uyeleri_getir()
returns table (user_id uuid, ad text, eposta text, rol text, kaynak_sayisi bigint, toplam_bayt numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, count(k.id), coalesce(sum(k.pdf_boyut_bayt), 0)
  from public.akademik_kaynaklar k
  join public.profiles p on p.id = k.user_id
  where public.is_owner()
  group by p.id, p.full_name, p.email, p.role
  order by p.full_name nulls last;
$$;

revoke all on function public.owner_akademik_uyeleri_getir() from public, anon;
grant execute on function public.owner_akademik_uyeleri_getir() to authenticated;

-- ============================================================================
-- BİTTİ.
-- Kalan adımlar (SQL dışı): rehber/04-cloudflare-secretlar.md § 4.9 — yeni Worker
-- (akademik-kutuphane-worker), R2 kovası/binding ve (isteğe bağlı) büyük dosya imzası.
-- Matris satırı: assets/js/github-yonetim/github-yonetim.js > OZELLIK_KATALOGU.
-- ============================================================================
