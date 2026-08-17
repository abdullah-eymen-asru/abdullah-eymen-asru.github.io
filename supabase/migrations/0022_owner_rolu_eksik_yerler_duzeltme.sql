-- ============================================================================
-- 0022_owner_rolu_eksik_yerler_duzeltme.sql
--
-- BUG DÜZELTMESİ: migration 0021 'owner' (Site Sahibi) rolünü ekleyip
-- is_admin()'i genişletti, ama is_admin() SADECE birkaç yerde kullanılıyordu.
-- Kod tabanındaki asıl "admin ile aynı erişim" kontrolü çoğu RLS
-- politikasında is_manager_or_admin() ve is_editor_or_admin() üzerinden
-- yapılıyor (migration 0014/0016) — bu iki fonksiyon 'owner'ı hiç tanımıyordu.
-- Sonuç: owner, panelde görünüşte tam yetkili olsa bile veritabanı
-- seviyesinde (RLS) şu alanlarda ENGELLENİYORDU:
--   - profiles SELECT (Üye Ayarları sayfasındaki üye listesi boş dönüyordu)
--   - special_content (Admin panelindeki "Özel İçerik Ekle/Düzenle/Sil")
--   - content_access (üyelere özel içerik erişimi atama/kaldırma)
--   - storage.objects / 'ozel-dosyalar' bucket'ı (R2 Dosya Paylaşımı)
--   - taslak_icerikler'in editor/admin görünürlüğü (is_editor_or_admin)
--
-- AYRICA: admin_force_signout_user() (migration 0009), admin_askiya_al()
-- (migration 0021) içinden çağrılıyor ama SADECE role='admin' kabul
-- ediyordu — bir owner "Acil Fren" (admin askıya alma) butonunu kullanmaya
-- çalıştığında bu iç çağrı 'Yetkisiz işlem: sadece admin bir kullanıcıyı
-- zorla çıkışa zorlayabilir' hatasıyla TÜM işlemi başarısız kılıyordu.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor'de TEK SEFERDE çalıştır.
-- ============================================================================

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager', 'owner')
  );
$$;

create or replace function public.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor', 'manager', 'owner')
  );
$$;

create or replace function public.admin_force_signout_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() <> 'service_role' then
    if not exists (
      select 1 from public.profiles where id = auth.uid() and role in ('admin', 'owner')
    ) then
      raise exception 'Yetkisiz işlem: sadece admin/owner bir kullanıcıyı zorla çıkışa zorlayabilir.';
    end if;
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- Kontrol: fonksiyonların güncellendiğini doğrulamak için (opsiyonel).
-- select proname, prosrc from pg_proc where proname in
--   ('is_manager_or_admin','is_editor_or_admin','admin_force_signout_user');
