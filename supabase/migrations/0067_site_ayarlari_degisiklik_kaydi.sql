-- ============================================================================
-- 0067_site_ayarlari_degisiklik_kaydi.sql
-- "Alan Adı & Sayfa Erişim Kalkanı" için DEĞİŞİKLİK GÜNLÜĞÜ (audit log).
--
-- 0061 çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir (idempotent).
-- Supabase Dashboard > SQL Editor'e yapıştırıp TEK SEFERDE çalıştır.
--
-- NE EKLENİYOR
--   1) public.site_ayarlari_loglari — kim, ne zaman, ne değiştirdi.
--        * Üye bilgisi O ANIN ANLIK GÖRÜNTÜSÜ olarak saklanır (actor_bilgi jsonb):
--          sonradan ad/rol değişse ya da hesap silinse bile kayıt doğru kalır.
--        * Alan adı/rota/bakım mesajı değişiklikleri site_ayarlari üzerindeki
--          AFTER UPDATE trigger'ıyla, "kilitli siteyi görme izni" ver/kaldır işlemleri
--          owner_site_onizleme_izni_ver() RPC'siyle otomatik yazılır; istemci
--          (tarayıcı) log YAZAMAZ, yani sahte kayıt düşürülemez.
--        * Değişmeyen kayıt (aynı değerle tekrar Kaydet) loglanmaz.
--   2) KAYITLAR DEĞİŞTİRİLEMEZ: UPDATE her zaman engellenir.
--   3) SİLME YETKİSİ SADECE SİTE SAHİBİNDE (owner): tabloda hiçbir istemci
--      yetkisi/politikası yok; silme yalnızca owner_site_log_sil() /
--      owner_site_loglarini_temizle() RPC'leriyle (is_owner()) yapılır ve ek olarak
--      DELETE trigger'ı owner olmayan oturumları reddeder. (auth.uid() boş olan
--      güvenilir sunucu bağlantıları — SQL Editor / service_role — trigger'dan
--      geçer; bunlara zaten yalnızca proje sahibi erişir.)
--   4) site_ayarlari_loglarini_getir() — sadece owner okur (sayfalı).
--
-- Not: 0061'deki owner_site_onizleme_izni_ver() bu dosyada log yazacak şekilde
-- YENİDEN tanımlanır; imza ve yetki kuralları aynıdır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLO
-- ----------------------------------------------------------------------------
create table if not exists public.site_ayarlari_loglari (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  islem         text not null
                check (islem in ('ayar_guncelleme', 'onizleme_izni_verildi', 'onizleme_izni_kaldirildi')),
  ozet          text not null check (char_length(ozet) <= 600),
  degisiklikler jsonb not null default '{}'::jsonb,   -- {alan: {eski, yeni}}
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_bilgi   jsonb not null default '{}'::jsonb,   -- işlemi yapan üyenin anlık görüntüsü
  hedef_id      uuid,                                  -- izin işlemlerinde izin verilen/alınan üye
  hedef_bilgi   jsonb not null default '{}'::jsonb,
  ip            text,
  user_agent    text
);

create index if not exists site_ayarlari_loglari_created_idx
  on public.site_ayarlari_loglari (created_at desc);

comment on table public.site_ayarlari_loglari is
  'Gatekeeper (site_ayarlari + site_onizleme_izinleri) değişiklik günlüğü. Sadece trigger/RPC yazar, değiştirilemez, SADECE owner okur ve siler.';

alter table public.site_ayarlari_loglari enable row level security;
revoke all on public.site_ayarlari_loglari from public, anon, authenticated;
-- (politika yok: tüm erişim aşağıdaki SECURITY DEFINER fonksiyonlardan)

-- ----------------------------------------------------------------------------
-- 2) DEĞİŞTİRİLEMEZLİK + SADECE OWNER SİLER
-- ----------------------------------------------------------------------------
create or replace function public.gk_log_koruma()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Değişiklik kayıtları düzenlenemez.';
  end if;
  -- DELETE: oturum varsa owner olmalı (auth.uid() boşsa güvenilir sunucu bağlantısı).
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Değişiklik kayıtlarını sadece Site Sahibi (owner) silebilir.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_gk_log_koruma_upd on public.site_ayarlari_loglari;
create trigger trg_gk_log_koruma_upd
  before update on public.site_ayarlari_loglari
  for each row execute function public.gk_log_koruma();

drop trigger if exists trg_gk_log_koruma_del on public.site_ayarlari_loglari;
create trigger trg_gk_log_koruma_del
  before delete on public.site_ayarlari_loglari
  for each row execute function public.gk_log_koruma();

-- ----------------------------------------------------------------------------
-- 3) ÜYE ANLIK GÖRÜNTÜSÜ — yalnızca beyaz listedeki alanlar (2FA yedek kodu sayaçları
--    gibi güvenlik alanları ASLA alınmaz) + Auth'taki son giriş zamanı.
-- ----------------------------------------------------------------------------
create or replace function public.gk_uye_goruntusu(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sonuc jsonb;
  son_giris timestamptz;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    into sonuc
  from public.profiles p,
       lateral jsonb_each(to_jsonb(p)) as e(k, v)
  where p.id = p_user_id
    and k in (
      'id', 'full_name', 'first_name', 'last_name', 'email', 'role', 'bio',
      'is_suspended', 'created_at', 'updated_at',
      'kvkk_onay_verildi', 'kvkk_onay_tarihi', 'kvkk_onay_versiyonu',
      'yurtdisi_onay_verildi', 'yurtdisi_onay_tarihi', 'yurtdisi_onay_versiyonu'
    );

  begin
    select u.last_sign_in_at into son_giris from auth.users u where u.id = p_user_id;
    if son_giris is not null then
      sonuc := sonuc || jsonb_build_object('son_giris', son_giris);
    end if;
  exception when others then
    null; -- auth şemasına erişilemezse görüntü yine de yazılır
  end;

  return sonuc;
end;
$$;

revoke all on function public.gk_uye_goruntusu(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) LOG YAZICI — yalnızca trigger/RPC'ler çağırır (istemciye execute verilmez)
-- ----------------------------------------------------------------------------
create or replace function public.gk_log_yaz(
  p_islem text,
  p_ozet text,
  p_degisiklikler jsonb default '{}'::jsonb,
  p_hedef_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  basliklar jsonb;
  ip_adresi text;
  tarayici text;
begin
  begin
    basliklar := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    basliklar := null;
  end;
  ip_adresi := nullif(btrim(split_part(coalesce(basliklar ->> 'x-forwarded-for', basliklar ->> 'cf-connecting-ip', ''), ',', 1)), '');
  tarayici  := left(nullif(basliklar ->> 'user-agent', ''), 300);

  insert into public.site_ayarlari_loglari
    (islem, ozet, degisiklikler, actor_id, actor_bilgi, hedef_id, hedef_bilgi, ip, user_agent)
  values (
    p_islem,
    left(p_ozet, 600),
    coalesce(p_degisiklikler, '{}'::jsonb),
    auth.uid(),
    public.gk_uye_goruntusu(auth.uid()),
    p_hedef_id,
    coalesce(
      (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role)
         from public.profiles p where p.id = p_hedef_id),
      '{}'::jsonb
    ),
    ip_adresi,
    tarayici
  );
end;
$$;

revoke all on function public.gk_log_yaz(text, text, jsonb, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) site_ayarlari -> otomatik log (sadece GERÇEKTEN değişen alanlar)
-- ----------------------------------------------------------------------------
create or replace function public.gk_ayar_log_tetikle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch jsonb := '{}'::jsonb;
  parcalar text[] := '{}';
  h text;
  r text;
  eski jsonb;
  yeni jsonb;
begin
  if new.github_io_aktif is distinct from old.github_io_aktif then
    ch := ch || jsonb_build_object('github_io_aktif', jsonb_build_object('eski', old.github_io_aktif, 'yeni', new.github_io_aktif));
    parcalar := parcalar || ('github.io erişime ' || case when new.github_io_aktif then 'açıldı' else 'kapatıldı' end);
  end if;

  if new.pages_dev_aktif is distinct from old.pages_dev_aktif then
    ch := ch || jsonb_build_object('pages_dev_aktif', jsonb_build_object('eski', old.pages_dev_aktif, 'yeni', new.pages_dev_aktif));
    parcalar := parcalar || ('pages.dev erişime ' || case when new.pages_dev_aktif then 'açıldı' else 'kapatıldı' end);
  end if;

  if new.kilitli_rotalar is distinct from old.kilitli_rotalar then
    ch := ch || jsonb_build_object('kilitli_rotalar', jsonb_build_object('eski', old.kilitli_rotalar, 'yeni', new.kilitli_rotalar));
    foreach h in array array['github.io', 'pages.dev'] loop
      eski := coalesce(old.kilitli_rotalar -> h, '[]'::jsonb);
      yeni := coalesce(new.kilitli_rotalar -> h, '[]'::jsonb);
      for r in
        select jsonb_array_elements_text(yeni) except select jsonb_array_elements_text(eski)
      loop
        parcalar := parcalar || (h || ': ' || r || ' kilitlendi');
      end loop;
      for r in
        select jsonb_array_elements_text(eski) except select jsonb_array_elements_text(yeni)
      loop
        parcalar := parcalar || (h || ': ' || r || ' açıldı');
      end loop;
    end loop;
  end if;

  if new.bakim_mesaji is distinct from old.bakim_mesaji then
    ch := ch || jsonb_build_object('bakim_mesaji', jsonb_build_object('eski', old.bakim_mesaji, 'yeni', new.bakim_mesaji));
    parcalar := parcalar || 'bakım mesajı değiştirildi'::text;
  end if;

  if cardinality(parcalar) > 0 then
    perform public.gk_log_yaz('ayar_guncelleme', array_to_string(parcalar, '; '), ch, null);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_site_ayarlari_log on public.site_ayarlari;
create trigger trg_site_ayarlari_log
  after update on public.site_ayarlari
  for each row execute function public.gk_ayar_log_tetikle();

-- ----------------------------------------------------------------------------
-- 6) "Kilitli siteyi görme izni" RPC'si — 0061'deki hâliyle AYNI, sadece log yazar
-- ----------------------------------------------------------------------------
create or replace function public.owner_site_onizleme_izni_ver(p_user_id uuid, p_izinli boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hedef_rol text;
  hedef_ad text;
  silinen uuid;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: kilitli siteyi görme izni vermeyi sadece Site Sahibi (owner) yapabilir.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into hedef_ad from public.profiles where id = p_user_id;

  if not p_izinli then
    delete from public.site_onizleme_izinleri where user_id = p_user_id returning user_id into silinen;
    if silinen is not null then
      perform public.gk_log_yaz(
        'onizleme_izni_kaldirildi',
        coalesce(hedef_ad, 'Bir üye') || ' için kilitli siteyi görme izni kaldırıldı',
        jsonb_build_object('onizleme_izni', jsonb_build_object('eski', true, 'yeni', false)),
        p_user_id
      );
    end if;
    return;
  end if;

  select role into hedef_rol from public.profiles where id = p_user_id;
  if hedef_rol is null then
    raise exception 'Kullanıcı bulunamadı.';
  end if;
  if hedef_rol in ('owner', 'admin') then
    raise exception 'Bu kullanıcı (%) kilitli siteyi zaten otomatik görür; ayrıca izin gerekmez.', hedef_rol;
  end if;

  if not exists (select 1 from public.site_onizleme_izinleri where user_id = p_user_id) then
    perform public.gk_log_yaz(
      'onizleme_izni_verildi',
      coalesce(hedef_ad, 'Bir üye') || ' için kilitli siteyi görme izni verildi',
      jsonb_build_object('onizleme_izni', jsonb_build_object('eski', false, 'yeni', true)),
      p_user_id
    );
  end if;

  insert into public.site_onizleme_izinleri (user_id, veren_id)
  values (p_user_id, auth.uid())
  on conflict (user_id) do update set veren_id = auth.uid();
end;
$$;

revoke all on function public.owner_site_onizleme_izni_ver(uuid, boolean) from public, anon;
grant execute on function public.owner_site_onizleme_izni_ver(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) OKUMA / SİLME — sadece owner
-- ----------------------------------------------------------------------------
create or replace function public.site_ayarlari_loglarini_getir(p_limit int default 20, p_oncesi_id bigint default null)
returns table (
  id bigint,
  created_at timestamptz,
  islem text,
  ozet text,
  degisiklikler jsonb,
  actor_id uuid,
  actor_bilgi jsonb,
  hedef_bilgi jsonb,
  ip text,
  user_agent text
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.created_at, l.islem, l.ozet, l.degisiklikler, l.actor_id, l.actor_bilgi, l.hedef_bilgi, l.ip, l.user_agent
  from public.site_ayarlari_loglari l
  where public.is_owner()
    and (p_oncesi_id is null or l.id < p_oncesi_id)
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.site_ayarlari_loglarini_getir(int, bigint) from public, anon;
grant execute on function public.site_ayarlari_loglarini_getir(int, bigint) to authenticated;

create or replace function public.owner_site_log_sil(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: değişiklik kayıtlarını sadece Site Sahibi (owner) silebilir.';
  end if;
  delete from public.site_ayarlari_loglari where id = p_id;
end;
$$;

revoke all on function public.owner_site_log_sil(bigint) from public, anon;
grant execute on function public.owner_site_log_sil(bigint) to authenticated;

create or replace function public.owner_site_loglarini_temizle()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  adet int;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz işlem: değişiklik kayıtlarını sadece Site Sahibi (owner) silebilir.';
  end if;
  delete from public.site_ayarlari_loglari where true;
  get diagnostics adet = row_count;
  return adet;
end;
$$;

revoke all on function public.owner_site_loglarini_temizle() from public, anon;
grant execute on function public.owner_site_loglarini_temizle() to authenticated;
