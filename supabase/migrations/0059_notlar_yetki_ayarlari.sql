-- ============================================================================
-- 0059_notlar_yetki_ayarlari.sql
-- "Fikir & Araştırma Tezgâhı" (0056) için Yetki Ayarları entegrasyonu.
--
-- 0056'DAN SONRA çalıştır (ya da 0056 zaten çalıştıysa hemen). Tekrar çalıştırmak
-- güvenlidir (idempotent).
--
-- İKİ KATMAN (ikisi de SADECE owner'ın elinde):
--   1) ROL BAZLI ("tüm editörlere / tüm adminlere kapat"):
--      0048'in MEVCUT ozellik_erisimleri tablosu ve "Yetki Ayarları" matrisi.
--      Yeni anahtar: 'notlar_modulu'. Bu migration o tabloya dokunmaz; panelde
--      satır olarak görünmesi için github-yonetim.js'teki OZELLIK_KATALOGU'na
--      anahtar eklendi.
--   2) KULLANICI BAZLI ("şu kişiye kapat"): AŞAĞIDAKİ yeni tablo.
--
-- 0048'İN İLKESİ KORUNUR: bu katmanlar sadece KISAR, asla yeni yetki VERMEZ.
--   Not modülünü zaten kullanabilen roller: editor, manager, admin, owner.
--   Owner'ın "aç" demesi, kısıtlamayı kaldırmak demektir; sıradan bir üyeye
--   (role = user/special_user) modül AÇILMAZ.
--   Owner hiçbir şeyi kapatmazsa her şey 0056'daki gibi çalışır.
--
-- TEK DOĞRULUK KAYNAĞI: public.not_modulu_yetkili().
--   RLS (notlar, not_kasasi, not_ek_kayitlari), R2 worker'ı ve panel aynı
--   fonksiyonu sorar. Yetkisi alınan kullanıcı: yeni not yazamaz, eskilerini
--   okuyamaz, ekleri indiremez. Veri SİLİNMEZ; yetki geri verilince aynen döner.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KULLANICI BAZLI KISIT TABLOSU (genel; ileride başka özellikler de kullanabilir)
--    Satır VARSA kısıtlıdır, YOKSA kısıtlı değildir (0048 ile aynı mantık).
-- ----------------------------------------------------------------------------
create table if not exists public.ozellik_kullanici_kisitlari (
  id               uuid primary key default gen_random_uuid(),
  ozellik_anahtari text not null check (ozellik_anahtari ~ '^[a-z0-9_]{3,60}$'),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  guncelleyen_id   uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (ozellik_anahtari, user_id)
);

comment on table public.ozellik_kullanici_kisitlari is
  'Owner''ın belirli bir KULLANICIYA belirli bir özelliği kapattığı satırlar (rol bazlı kısıt için bkz. ozellik_erisimleri, 0048). Satır yoksa kısıt yok. Sadece owner yazar/okur (SECURITY DEFINER RPC''ler); doğrudan tablo erişimi yok.';

create index if not exists ozellik_kullanici_kisitlari_user_idx
  on public.ozellik_kullanici_kisitlari (user_id);

-- owner kendini kilitleyemesin (0048'deki owner_kilitlenmesini_engelle ile aynı fikir)
create or replace function public.owner_kullanici_kisiti_engelle()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'owner') then
    raise exception 'owner kullanıcısına kısıtlama konamaz.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_owner_kullanici_kisiti_engelle on public.ozellik_kullanici_kisitlari;
create trigger trg_owner_kullanici_kisiti_engelle
  before insert or update on public.ozellik_kullanici_kisitlari
  for each row execute function public.owner_kullanici_kisiti_engelle();

alter table public.ozellik_kullanici_kisitlari enable row level security;
revoke all on public.ozellik_kullanici_kisitlari from public, anon, authenticated;
-- Bilerek politika YOK: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan (0048 § 5 deseni).

-- ----------------------------------------------------------------------------
-- 2) YAZMA — sadece owner. p_izinli=false: kapat, p_izinli=true: kısıtı kaldır.
--    Kullanıcı bazında yönetilebilen özellikler BEYAZ LİSTEDE; listede olmayan bir
--    anahtar için kısıt koymak, uygulanmayan bir "sahte kilit" yaratırdı.
--    Yeni özellik eklersen: o özelliğin kontrol noktası bu tabloya bakmalı + buraya ekle.
-- ----------------------------------------------------------------------------
create or replace function public.owner_ozellik_kullanici_ayarla(p_ozellik text, p_user_id uuid, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_rol text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: kullanıcı bazlı erişimi sadece Site Sahibi (owner) değiştirebilir.';
  end if;
  if not (p_ozellik = any (array['notlar_modulu'])) then
    raise exception 'Bu özellik kullanıcı bazında yönetilemez: %', p_ozellik;
  end if;

  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then
    raise exception 'Kullanıcı bulunamadı.';
  end if;
  if hedef_rol = 'owner' then
    raise exception 'owner kullanıcısına kısıtlama konamaz.';
  end if;

  if p_izinli then
    delete from public.ozellik_kullanici_kisitlari
    where ozellik_anahtari = p_ozellik and user_id = p_user_id;
  else
    insert into public.ozellik_kullanici_kisitlari (ozellik_anahtari, user_id, guncelleyen_id)
    values (p_ozellik, p_user_id, auth.uid())
    on conflict (ozellik_anahtari, user_id)
    do update set guncelleyen_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.owner_ozellik_kullanici_ayarla(text, uuid, boolean) from public, anon;
grant execute on function public.owner_ozellik_kullanici_ayarla(text, uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) LİSTELE — kısıtlı kullanıcılar (sadece owner görür)
-- ----------------------------------------------------------------------------
create or replace function public.ozellik_kullanici_kisitlarini_getir(p_ozellik text)
returns table (user_id uuid, full_name text, email text, rol text, kisitlama_tarihi timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select k.user_id, p.full_name, p.email, p.role, k.created_at
  from public.ozellik_kullanici_kisitlari k
  join public.profiles p on p.id = k.user_id
  where public.is_owner()
    and k.ozellik_anahtari = p_ozellik
  order by k.created_at desc;
$$;

revoke all on function public.ozellik_kullanici_kisitlarini_getir(text) from public, anon;
grant execute on function public.ozellik_kullanici_kisitlarini_getir(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) ARA — owner'ın kullanıcı seçmesi için. Sadece modülü kullanabilen roller
--    (editor/manager/admin) döner; owner ve sıradan üyeler listede yoktur.
--    İsim ya da e-posta; en az 2 karakter; en çok 10 sonuç; % ve _ kaçışlı.
-- ----------------------------------------------------------------------------
create or replace function public.owner_ozellik_uye_ara(p_ozellik text, p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, kisitli boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role,
         exists (
           select 1 from public.ozellik_kullanici_kisitlari k
           where k.user_id = p.id and k.ozellik_anahtari = p_ozellik
         )
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.is_owner()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role in ('editor', 'manager', 'admin')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

revoke all on function public.owner_ozellik_uye_ara(text, text) from public, anon;
grant execute on function public.owner_ozellik_uye_ara(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) not_modulu_yetkili() — 0056'daki tanım, iki yeni kapıyla GENİŞLETİLDİ.
--    Sırayla: (a) rol listesi + askıdaki admin, (b) rol bazlı kısıt (0048),
--    (c) kullanıcı bazlı kısıt. owner her zaman geçer.
-- ----------------------------------------------------------------------------
create or replace function public.not_modulu_yetkili()
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
      and not (p.role = 'admin' and coalesce(p.is_suspended, false))
      and (
        p.role = 'owner'
        or (
          public.ozellik_erisimi_var_mi('notlar_modulu', p.role)
          and not exists (
            select 1 from public.ozellik_kullanici_kisitlari k
            where k.user_id = p.id and k.ozellik_anahtari = 'notlar_modulu'
          )
        )
      )
  );
$$;

revoke all on function public.not_modulu_yetkili() from public, anon;
grant execute on function public.not_modulu_yetkili() to authenticated;
