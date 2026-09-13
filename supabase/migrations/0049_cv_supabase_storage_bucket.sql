-- ============================================================================
-- 0049_cv_supabase_storage_bucket.sql
--
-- İSTEK: "CV'yi Supabase'e PDF olarak yükleyebilme özelliği de olsun.
-- GitHub'a commit ya da Supabase — aynı blog yazısı gibi." Blog yazılarında
-- olduğu gibi (bkz. migration 0013/0015 "Sadece Supabase'te Yayınla"),
-- CV için de GitHub'a commit ETMEDEN, doğrudan Supabase Storage'a
-- yükleyebilme seçeneği ekleniyor.
--
-- NEDEN "ozel-dosyalar" BUCKET'I DEĞİL: o bucket PRIVATE'tir (migration
-- 0002) ve dosya yolu konvansiyonu "<special_content.id>/<dosya-adi>"
-- olarak content_access sistemine sıkı sıkıya bağlıdır — CV ise HERKESE
-- AÇIK olmalı (site sahibinin /cv/ sayfasına gelen HERKES görebilmeli,
-- content_access/giriş kontrolü YOK). Bu yüzden "avatarlar" bucket'ına
-- benzer, YENİ bir PUBLIC-READ bucket açıyoruz: "cv-dosyalari".
--
-- YETKİ: sadece admin/owner yazabilir (is_admin() zaten owner'ı kapsıyor,
-- bkz. migration 0021). AYRICA migration 0048'in "Yetki Ayarları" sistemini
-- burada da uyguluyoruz — owner panelden "CV Yönetimi" özelliğini admin
-- için kapatmışsa, bu RLS politikası admin'in bu bucket'a YAZMASINI da
-- (worker.js'teki GitHub yoluna PARALEL olarak, Storage'a doğrudan yazan bu
-- yolu da) reddeder. Böylece owner'ın "admin CV'yi değiştiremesin" kararı,
-- CV'nin GitHub'a mı yoksa Supabase'e mi yüklendiğinden BAĞIMSIZ olarak her
-- iki yolda da geçerli olur.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('cv-dosyalari', 'cv-dosyalari', true)
on conflict (id) do update set public = true;

-- Sadece PDF, makul bir üst boyut sınırı (20 MB — bir CV için fazlasıyla
-- yeterli, migration 0036'daki "avatarlar" kısıtıyla AYNI gerekçe).
update storage.buckets
set file_size_limit = 20971520, -- 20 MB
    allowed_mime_types = array['application/pdf']
where id = 'cv-dosyalari';

-- ---- 'cv-dosyalari' politikaları ----
-- Dosya yolu KONVANSİYONU: sabit bir tek dosya adı kullanılır
-- ("ozgecmis.pdf", bkz. panel JS'i cvSupabaseYukle) — CV her zaman TEK bir
-- kişiye (site sahibi) ait olduğu için, avatarlar/ozel-dosyalar'daki gibi
-- kullanıcı/içerik bazlı bir alt klasöre gerek yok.
drop policy if exists "cv_select_public" on storage.objects;
create policy "cv_select_public"
  on storage.objects for select
  using (bucket_id = 'cv-dosyalari');   -- bucket zaten public=true, ekstra açık okuma

-- yardımcı: bu politikaların İÇİNDE tekrar tekrar yazmamak için — "admin/
-- owner mi VE (owner YA DA 'cv_yonetimi' özelliği admin için kapatılmamış
-- mı)" sorusu. is_admin() zaten owner'ı kapsadığından, burada AYRICA
-- is_owner() ile "owner ise migration 0048 kontrolüne hiç girme" kısayolu
-- uygulanıyor (owner asla kısıtlanamaz, bkz. o migration'daki trigger).
create or replace function public.cv_storage_yazabilir_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    and (public.is_owner() or public.ozellik_erisimi_var_mi('cv_yonetimi', 'admin'));
$$;

grant execute on function public.cv_storage_yazabilir_mi() to authenticated;

drop policy if exists "cv_write_admin" on storage.objects;
create policy "cv_write_admin"
  on storage.objects for insert
  with check (bucket_id = 'cv-dosyalari' and public.cv_storage_yazabilir_mi());

drop policy if exists "cv_update_admin" on storage.objects;
create policy "cv_update_admin"
  on storage.objects for update
  using (bucket_id = 'cv-dosyalari' and public.cv_storage_yazabilir_mi());

drop policy if exists "cv_delete_admin" on storage.objects;
create policy "cv_delete_admin"
  on storage.objects for delete
  using (bucket_id = 'cv-dosyalari' and public.cv_storage_yazabilir_mi());

-- ============================================================================
-- BİTTİ. Test:
--   1) Panelde "📄 CV" sekmesi -> "Yöntem 3 — Supabase'e Yükle" ile bir PDF
--      yükle -> _config.yml'deki cv_url'ün
--      "https://<proje-ref>.supabase.co/storage/v1/object/public/cv-dosyalari/ozgecmis.pdf"
--      gibi bir adrese güncellendiğini doğrula, /cv/ adresinin oraya
--      yönlendirdiğini kontrol et.
--   2) migration 0048'den owner panelinden "CV Yönetimi" özelliğini admin
--      için kapat -> bir admin hesabıyla aynı yüklemeyi denediğinde HEM
--      panelin sekmeyi göstermediğini HEM DE (doğrudan Supabase client'ı
--      çağırılsa bile) bu RLS politikasının reddettiğini doğrula.
--   3) PDF dışında bir dosya (ör. .png) yüklemeyi dene -> Storage API mime
--      type kısıtı yüzünden reddetmeli.
-- ============================================================================
