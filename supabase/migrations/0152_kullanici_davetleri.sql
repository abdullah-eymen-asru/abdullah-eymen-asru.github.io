-- ============================================================================
-- 0152 — Yönetici daveti (Supabase inviteUserByEmail) + kayıtlar kapalıyken davetli hesap açabilme.
-- Tekrar çalıştırılabilir (idempotent). Edge Function: supabase/functions/admin-invite-user.
--  * public.kullanici_davetleri: yalnızca service_role yazar (RLS açık, politika yok → istemciye tamamen kapalı).
--  * admin_davetleri_listele(): yalnızca admin/owner, son 50 davet (e-posta, durum, tarih).
--  * handle_new_user(): 0064'teki haliyle AYNI; tek fark, geçerli (kullanılmamış, süresi dolmamış) davetli e-posta için
--    "KAYITLAR_KAPALI" engeli uygulanmaması ve davetin kullanıldı işaretlenmesi.
-- ============================================================================
create table if not exists public.kullanici_davetleri (
  id uuid primary key default gen_random_uuid(),
  eposta text not null,
  davet_eden uuid references auth.users(id) on delete set null,
  olusturma timestamptz not null default now(),
  son_kullanma timestamptz not null default now() + interval '7 days',
  kullanildi boolean not null default false
);
create index if not exists kullanici_davetleri_eposta_idx on public.kullanici_davetleri (eposta);
create index if not exists kullanici_davetleri_davet_eden_idx on public.kullanici_davetleri (davet_eden, olusturma desc);
alter table public.kullanici_davetleri enable row level security;
revoke all on public.kullanici_davetleri from anon, authenticated;

create or replace function public.admin_davetleri_listele()
returns table (eposta text, olusturma timestamptz, son_kullanma timestamptz, kullanildi boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_owner()) then
    raise exception 'Yetkisiz işlem: davetleri yalnızca yönetici/Site Sahibi görebilir.';
  end if;
  return query select d.eposta, d.olusturma, d.son_kullanma, d.kullanildi
    from public.kullanici_davetleri d order by d.olusturma desc limit 50;
end;
$$;
revoke execute on function public.admin_davetleri_listele() from public, anon;
grant execute on function public.admin_davetleri_listele() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v_last  text;
  v_tek_parca text;
  v_kayitlar_acik boolean;
  v_davetli boolean;
begin
  -- bkz. migration 0031: üyelik kayıtları kapalıysa burada dur — exception,
  -- bu trigger'ı tetikleyen auth.users INSERT'ini de (aynı transaction
  -- içinde olduğu için) geri alır, yani hesap hiç oluşmaz.
  select kayitlar_acik into v_kayitlar_acik from public.site_settings where id = 1;
  -- 0152: yönetici davetiyle (Edge Function admin-invite-user, service_role) gelen e-posta, kayıtlar KAPALI olsa da hesap açabilir.
  -- Davet tablosuna yalnızca sunucu yazabilir; istemci metadata'sına güvenilmez.
  select exists (
    select 1 from public.kullanici_davetleri d
    where d.eposta = lower(new.email) and not d.kullanildi and d.son_kullanma > now()
  ) into v_davetli;
  if coalesce(v_kayitlar_acik, true) = false and not v_davetli then
    raise exception 'KAYITLAR_KAPALI: Üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamaz.';
  end if;

  v_first := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_last  := nullif(trim(new.raw_user_meta_data->>'last_name'), '');

  -- Google OAuth: given_name/family_name varsa (Google'ın kendi ayırdığı
  -- alanlar) ÖNCE bunlar kullanılır — çok kelimeli Türkçe isimlerde tek
  -- parçayı ilk boşluktan bölmekten çok daha güvenilir sonuç verir.
  if v_first is null and v_last is null then
    v_first := nullif(trim(new.raw_user_meta_data->>'given_name'), '');
    v_last  := nullif(trim(new.raw_user_meta_data->>'family_name'), '');
  end if;

  -- Hiçbiri yoksa (bazı hesaplarda/eski istemcilerde olabilir) tek parça
  -- isimden (full_name/name) bölmeye geri dön.
  if v_first is null and v_last is null then
    v_tek_parca := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name');
    if v_tek_parca is not null and trim(v_tek_parca) <> '' then
      v_first := nullif(split_part(trim(v_tek_parca), ' ', 1), '');
      v_last  := nullif(trim(substring(trim(v_tek_parca) from length(split_part(trim(v_tek_parca), ' ', 1)) + 1)), '');
    end if;
  end if;

  insert into public.profiles (
    id, email, first_name, last_name, role,
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu,
    yurtdisi_onay_verildi, yurtdisi_onay_tarihi, yurtdisi_onay_versiyonu
  )
  values (
    new.id,
    new.email,
    v_first,
    v_last,
    'user',
    coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false)
         then now() else null end,
    coalesce(public.guncel_kvkk_surumu(), new.raw_user_meta_data->>'kvkk_versiyon'),
    coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false)
         then now() else null end,
    case when coalesce((new.raw_user_meta_data->>'yurtdisi_onay')::boolean, false)
         then coalesce(public.guncel_kvkk_surumu(), new.raw_user_meta_data->>'yurtdisi_versiyon')
         else null end
  )
  on conflict (id) do nothing;
  if v_davetli then
    update public.kullanici_davetleri set kullanildi = true where eposta = lower(new.email) and not kullanildi;
  end if;
  return new;
end;
$$;


revoke execute on function public.handle_new_user() from public, anon, authenticated;
