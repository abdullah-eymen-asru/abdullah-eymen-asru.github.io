-- ============================================================================
-- 0154 — Davette rol seçimi. Tekrar çalıştırılabilir (idempotent).
--  * kullanici_davetleri.rol: davetli hesabın açılacağı rol (varsayılan 'user').
--    İzinli: user, special_user, editor, manager, admin. 'owner'/'demo' davetle ASLA verilmez.
--  * Admin (owner DEĞİL) yalnızca user/special_user/editor/manager verebilir; 'admin' ve üstünü SADECE Site Sahibi verebilir
--    (Edge Function admin-invite-user denetler; handle_new_user ikinci kez denetler).
--  * admin_davetleri_listele(): rol alanını da döndürür.
-- ============================================================================
alter table public.kullanici_davetleri add column if not exists rol text not null default 'user';
alter table public.kullanici_davetleri drop constraint if exists kullanici_davetleri_rol_check;
alter table public.kullanici_davetleri add constraint kullanici_davetleri_rol_check
  check (rol in ('user', 'special_user', 'editor', 'manager', 'admin'));

drop function if exists public.admin_davetleri_listele();
create or replace function public.admin_davetleri_listele()
returns table (eposta text, ad text, olusturma timestamptz, son_kullanma timestamptz, kullanildi boolean, rol text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_owner()) then
    raise exception 'Yetkisiz işlem: davetleri yalnızca yönetici/Site Sahibi görebilir.';
  end if;
  return query
    select d.eposta,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           d.olusturma, d.son_kullanma, d.kullanildi, d.rol
      from public.kullanici_davetleri d
      left join public.profiles p on lower(p.email) = d.eposta
     order by d.olusturma desc limit 500;
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
  v_rol text := 'user';
  v_drol text;
  v_deden uuid;
begin
  -- bkz. migration 0031: üyelik kayıtları kapalıysa burada dur — exception,
  -- bu trigger'ı tetikleyen auth.users INSERT'ini de (aynı transaction
  -- içinde olduğu için) geri alır, yani hesap hiç oluşmaz.
  select kayitlar_acik into v_kayitlar_acik from public.site_settings where id = 1;
  -- 0152: yönetici davetiyle (Edge Function admin-invite-user, service_role) gelen e-posta, kayıtlar KAPALI olsa da hesap açabilir.
  -- Davet tablosuna yalnızca sunucu yazabilir; istemci metadata'sına güvenilmez.
  select d.rol, d.davet_eden into v_drol, v_deden
    from public.kullanici_davetleri d
    where d.eposta = lower(new.email) and not d.kullanildi and d.son_kullanma > now()
    order by d.olusturma desc limit 1;
  v_davetli := found;
  if v_davetli then
    -- Rol yükseltme koruması (savunma derinliği): 'admin' yalnızca davet edenin HÂLÂ Site Sahibi olması hâlinde verilir;
    -- 'owner'/'demo' davetle asla verilmez. Şüpheli her durumda normal 'user'.
    if v_drol in ('user', 'special_user', 'editor', 'manager') then
      v_rol := v_drol;
    elsif v_drol = 'admin' and exists (select 1 from public.profiles where id = v_deden and role = 'owner') then
      v_rol := 'admin';
    end if;
  end if;
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
    v_rol,
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
