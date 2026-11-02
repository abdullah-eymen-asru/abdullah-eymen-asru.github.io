-- ============================================================================
-- 0132_tur18_sahip_askisi_demo_cikar_klasor_tasi_worker_yetkisi.sql
--  1) SİTE SAHİBİ ASLA "askıda" sayılmaz: is_admin() / is_manager_or_admin() owner'ı askı bayrağından bağımsız kabul eder; olası yanlış bayrak temizlenir.
--     (Belirti: Site Sahibi Üye Ayarları'nda yalnızca kendini görür; çünkü profiles RLS "yönetici" kontrolünü geçemez.)
--  2) admin_demo_cikar: bir YÖNETİCİ, demo üyeyi normal bir role (user/special_user/editor/manager) çıkarabilir. Demo ATAMA hâlâ yalnızca Site Sahibi'dir.
--  3) r2_arsiv_klasor_sil_tasi: klasörü siler, İÇİNDEKİLERİ (alt klasörler dahil) bir üst klasöre taşır; ad çakışmasında " (2)" eklenir. R2'den hiçbir şey silinmez.
--  4) "sistem_durumu_worker" yetki anahtarı: admin/owner hep kullanır; diğer roller VARSAYILAN KAPALI (Yetki Ayarları'ndan açılır).
-- Gereksinim: 0021, 0032, 0048, 0057. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- 1) -------------------------------------------------------------------------
update public.profiles set is_suspended = false where role = 'owner' and coalesce(is_suspended, false);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid()
    and (role = 'owner' or (role = 'admin' and coalesce(is_suspended, false) = false)));
$$;
create or replace function public.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid()
    and (role = 'owner' or (role in ('admin', 'manager') and coalesce(is_suspended, false) = false)));
$$;

-- 2) -------------------------------------------------------------------------
create or replace function public.admin_demo_cikar(p_user_id uuid, p_yeni_rol text default 'user')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if p_yeni_rol not in ('user', 'special_user', 'editor', 'manager') then raise exception 'Geçersiz rol: % (demo üye yalnızca Üye/Özel Üye/Editör/İçerik Sorumlusu yapılabilir)', p_yeni_rol; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'demo') then raise exception 'Bu kullanıcı demo değil.'; end if;
  update public.profiles set role = p_yeni_rol where id = p_user_id and role = 'demo';
end $$;
revoke all on function public.admin_demo_cikar(uuid, text) from public, anon;
grant execute on function public.admin_demo_cikar(uuid, text) to authenticated;

-- 3) -------------------------------------------------------------------------
create or replace function public.r2_arsiv_klasor_sil_tasi(p_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare f public.r2_arsiv; ust text; onek text; ch record; yeni_ad text; n integer; uz text; govde text; eski_tam text; yeni_tam text; tasinan integer := 0;
begin
  if not public.r2_arsiv_yetkim('sil') then raise exception 'Silme yetkin yok.' using errcode = '42501'; end if;
  select * into f from public.r2_arsiv where id = p_id and tur = 'klasor' for update;
  if f.id is null then raise exception 'Klasör bulunamadı.'; end if;
  ust := f.klasor_yolu; onek := f.klasor_yolu || f.ad || '/';
  for ch in select * from public.r2_arsiv where klasor_yolu = onek order by tur desc, ad loop
    yeni_ad := ch.ad; n := 2;
    while exists (select 1 from public.r2_arsiv where klasor_yolu = ust and lower(ad) = lower(yeni_ad)) loop
      if ch.tur = 'dosya' and position('.' in reverse(ch.ad)) > 0 and position('.' in ch.ad) > 1 then
        uz := substring(ch.ad from '(\.[^.]*)$'); govde := left(ch.ad, length(ch.ad) - length(uz)); yeni_ad := govde || ' (' || n || ')' || uz;
      else yeni_ad := ch.ad || ' (' || n || ')'; end if;
      n := n + 1;
    end loop;
    if ch.tur = 'klasor' then
      eski_tam := onek || ch.ad || '/'; yeni_tam := ust || yeni_ad || '/';
      update public.r2_arsiv set klasor_yolu = yeni_tam || substr(klasor_yolu, length(eski_tam) + 1) where left(klasor_yolu, length(eski_tam)) = eski_tam;
    end if;
    update public.r2_arsiv set klasor_yolu = ust, ad = yeni_ad where id = ch.id;
    tasinan := tasinan + 1;
  end loop;
  delete from public.r2_arsiv where id = f.id;
  return tasinan;
end $$;
revoke all on function public.r2_arsiv_klasor_sil_tasi(uuid) from public, anon;
grant execute on function public.r2_arsiv_klasor_sil_tasi(uuid) to authenticated;

-- 4) -------------------------------------------------------------------------
insert into public.ozellik_erisimleri (ozellik_anahtari, rol, izinli)
  select 'sistem_durumu_worker', r, false from unnest(array['user', 'special_user', 'editor', 'manager']) r
  on conflict (ozellik_anahtari, rol) do nothing;

-- 5) Bağlantı klasörü silme (0127'yi günceller): varsayılan = içindekiler BİR ÜST klasöre çıkar (ana klasöre değil). p_baglantilari_sil = true → bağlantılar da silinir.
create or replace function public.r2_baglanti_klasor_sil(p_yol text, p_baglantilari_sil boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v text := public._r2_klasor_temizle(p_yol); ust text; n integer := 0; k record; yeni text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v is null then raise exception 'Klasör bulunamadı.'; end if;
  ust := nullif(regexp_replace(v, '/?[^/]+$', ''), '');                       -- 'a/b' → 'a' ; 'a' → null
  if coalesce(p_baglantilari_sil, false) then
    delete from public.r2_baglantilari where user_id = auth.uid() and (klasor = v or klasor like v || '/%');
    get diagnostics n = row_count;
    delete from public.r2_baglanti_klasorleri where user_id = auth.uid() and (yol = v or yol like v || '/%');
    return n;
  end if;
  -- doğrudan bağlantılar üst klasöre; alt klasörlerdekiler bir seviye yukarı kayar
  update public.r2_baglantilari set klasor = case when klasor = v then ust else nullif(coalesce(ust || '/', '') || substr(klasor, length(v) + 2), '') end
    where user_id = auth.uid() and (klasor = v or klasor like v || '/%');
  get diagnostics n = row_count;
  for k in select yol from public.r2_baglanti_klasorleri where user_id = auth.uid() and yol like v || '/%' order by yol loop
    yeni := coalesce(ust || '/', '') || substr(k.yol, length(v) + 2);
    insert into public.r2_baglanti_klasorleri (user_id, yol) values (auth.uid(), yeni) on conflict do nothing;
  end loop;
  delete from public.r2_baglanti_klasorleri where user_id = auth.uid() and (yol = v or yol like v || '/%');
  return n;
end $$;
revoke all on function public.r2_baglanti_klasor_sil(text, boolean) from public, anon;
grant execute on function public.r2_baglanti_klasor_sil(text, boolean) to authenticated;
