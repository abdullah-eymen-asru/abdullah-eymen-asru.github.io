-- ============================================================================
-- 0060_notlar_uye_izni.sql
-- "Fikir & Araştırma Tezgâhı": owner, NORMALDE modülü kullanamayan tek tek
-- üyelere (role = user / special_user) modülü AÇABİLİR.
--
-- 0056 ve 0059'DAN SONRA çalıştır (0057/0058 R2 arşiv migration'larıdır, bununla ilgisi yok). Tekrar çalıştırmak güvenlidir (idempotent).
--
-- 0048/0059'UN İLKESİNE İSTİSNA — BİLEREK, SADECE BU ÖZELLİK İÇİN:
--   Önceki katmanlar yalnızca KISARDI ("yeni yetki vermez"). Bu migration ilk kez
--   yeni erişim VERİR; ama dar tutulmuştur:
--     * sadece owner verebilir (is_owner() zorunlu),
--     * sadece 'notlar_modulu' için (beyaz liste),
--     * sadece role = user / special_user olan hesaplara (editor/manager/admin zaten
--       kullanabilir; onlar için kapatma 0059'daki yoldan yapılır),
--     * sadece Fikir & Araştırma Tezgâhı: yazı yayınlama, içerik yönetimi, dosya
--       yönetimi ya da başka HİÇBİR panel yetkisi verilmez; kişi yalnızca KENDİ
--       şifreli notlarını görür. Başkasının hiçbir verisine erişimi yoktur.
--   Askıya alınmış (is_suspended) hesap izinli olsa da kullanamaz.
--
-- SATIR VARSA İZİNLİ, YOKSA DEĞİL (0059'daki kısıt tablosunun tersi, ayrı tablo).
-- Tek doğruluk kaynağı yine public.not_modulu_yetkili(): RLS, R2 worker'ı ve panel
-- onu sorar; bu yüzden worker'ı YENİDEN DEPLOY ETMEK GEREKMEZ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) İZİN TABLOSU
-- ----------------------------------------------------------------------------
create table if not exists public.ozellik_kullanici_izinleri (
  id               uuid primary key default gen_random_uuid(),
  ozellik_anahtari text not null check (ozellik_anahtari ~ '^[a-z0-9_]{3,60}$'),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  guncelleyen_id   uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (ozellik_anahtari, user_id)
);

comment on table public.ozellik_kullanici_izinleri is
  'Owner''ın, normalde erişimi olmayan (user/special_user) belirli bir KULLANICIYA belirli bir özelliği AÇTIĞI satırlar. Satır varsa izinli. Sadece owner yazar/okur (SECURITY DEFINER RPC''ler); doğrudan tablo erişimi yok.';

create index if not exists ozellik_kullanici_izinleri_user_idx
  on public.ozellik_kullanici_izinleri (user_id);

-- İzin SADECE user/special_user'a verilebilir (owner'a zaten gerek yok; editor/manager/admin
-- zaten kullanabilir). Rol sonradan yükselirse eski satır zararsız kalır: not_modulu_yetkili()
-- o roller için izin tablosuna hiç bakmaz.
create or replace function public.ozellik_izni_hedef_kontrol()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.role in ('user', 'special_user')
  ) then
    raise exception 'İzin yalnızca normalde erişimi olmayan üyelere (user / special_user) verilebilir.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ozellik_izni_hedef_kontrol on public.ozellik_kullanici_izinleri;
create trigger trg_ozellik_izni_hedef_kontrol
  before insert or update on public.ozellik_kullanici_izinleri
  for each row execute function public.ozellik_izni_hedef_kontrol();

alter table public.ozellik_kullanici_izinleri enable row level security;
revoke all on public.ozellik_kullanici_izinleri from public, anon, authenticated;
-- Bilerek politika YOK: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan (0048 § 5 deseni).

-- ----------------------------------------------------------------------------
-- 2) YAZMA — sadece owner. p_izinli=true: izin ver, false: izni kaldır.
-- ----------------------------------------------------------------------------
create or replace function public.owner_ozellik_izin_ver(p_ozellik text, p_user_id uuid, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_rol text;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: üyelere özellik açmayı sadece Site Sahibi (owner) yapabilir.';
  end if;
  if not (p_ozellik = any (array['notlar_modulu'])) then
    raise exception 'Bu özellik kullanıcı bazında açılamaz: %', p_ozellik;
  end if;

  if not p_izinli then
    -- Kaldırma: rol sonradan değişmiş olsa bile eski satır temizlenebilsin.
    delete from public.ozellik_kullanici_izinleri
    where ozellik_anahtari = p_ozellik and user_id = p_user_id;
    return;
  end if;

  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then
    raise exception 'Kullanıcı bulunamadı.';
  end if;
  if hedef_rol not in ('user', 'special_user') then
    raise exception 'Bu kullanıcının rolü (%) zaten modülü kullanabiliyor ya da kullanamaz; izin yalnızca user / special_user için.', hedef_rol;
  end if;

  insert into public.ozellik_kullanici_izinleri (ozellik_anahtari, user_id, guncelleyen_id)
  values (p_ozellik, p_user_id, auth.uid())
  on conflict (ozellik_anahtari, user_id)
  do update set guncelleyen_id = auth.uid();
end;
$$;

revoke all on function public.owner_ozellik_izin_ver(text, uuid, boolean) from public, anon;
grant execute on function public.owner_ozellik_izin_ver(text, uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) LİSTELE — izin verilmiş üyeler (sadece owner görür)
-- ----------------------------------------------------------------------------
create or replace function public.ozellik_kullanici_izinlerini_getir(p_ozellik text)
returns table (user_id uuid, full_name text, email text, rol text, izin_tarihi timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.user_id, p.full_name, p.email, p.role, i.created_at
  from public.ozellik_kullanici_izinleri i
  join public.profiles p on p.id = i.user_id
  where public.is_owner()
    and i.ozellik_anahtari = p_ozellik
  order by i.created_at desc;
$$;

revoke all on function public.ozellik_kullanici_izinlerini_getir(text) from public, anon;
grant execute on function public.ozellik_kullanici_izinlerini_getir(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) ARA — owner'ın üye seçmesi için. Sadece user / special_user döner.
--    İsim ya da e-posta; en az 2 karakter; en çok 10 sonuç; % ve _ kaçışlı.
-- ----------------------------------------------------------------------------
create or replace function public.owner_ozellik_uye_ara_izin(p_ozellik text, p_arama text)
returns table (user_id uuid, full_name text, email text, rol text, izinli boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role,
         exists (
           select 1 from public.ozellik_kullanici_izinleri i
           where i.user_id = p.id and i.ozellik_anahtari = p_ozellik
         )
  from public.profiles p
  cross join lateral (
    select '%' || replace(replace(replace(btrim(coalesce(p_arama, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as kalip
  ) q
  where public.is_owner()
    and length(btrim(coalesce(p_arama, ''))) >= 2
    and p.role in ('user', 'special_user')
    and (p.full_name ilike q.kalip or p.email ilike q.kalip)
  order by p.full_name nulls last
  limit 10;
$$;

revoke all on function public.owner_ozellik_uye_ara_izin(text, text) from public, anon;
grant execute on function public.owner_ozellik_uye_ara_izin(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) not_modulu_yetkili() — 0059'daki tanım, "üyeye açma" yolu eklendi.
--    A) editor/manager/admin/owner: 0059'daki mantık AYNEN (rol kısıtı + kişi kısıtı).
--    B) user/special_user: yalnızca owner izin verdiyse VE hesap askıda değilse.
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
      and (
        (
          p.role in ('editor', 'manager', 'admin', 'owner')
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
        )
        or (
          p.role in ('user', 'special_user')
          and not coalesce(p.is_suspended, false)
          and exists (
            select 1 from public.ozellik_kullanici_izinleri i
            where i.user_id = p.id and i.ozellik_anahtari = 'notlar_modulu'
          )
        )
      )
  );
$$;

revoke all on function public.not_modulu_yetkili() from public, anon;
grant execute on function public.not_modulu_yetkili() to authenticated;
