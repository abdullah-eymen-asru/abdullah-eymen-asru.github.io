-- ============================================================================
-- 0011_oturum_yonetimi.sql
--
-- "Açık olan cihazları gösterip oturumu kapat seçeneği" isteği kapsamında.
--
-- Supabase JS SDK'sının auth.getSession()/getUser() gibi metodları sadece
-- İÇİNDE BULUNULAN oturumu döner; kullanıcının TÜM cihazlarındaki oturumları
-- listelemek için doğrudan bir client metodu YOKTUR. Bu bilgi auth.sessions
-- tablosunda tutuluyor (bkz. Supabase docs "User sessions" — her access
-- token'ın içinde bu tablonun primary key'ine karşılık gelen bir
-- "session_id" claim'i var). Bu yüzden iki SECURITY DEFINER RPC ekliyoruz:
--
--   - oturumlarimi_listele()      : sadece ÇAĞIRANIN KENDİ oturumlarını,
--                                    en son aktiviteye göre sıralı döner.
--   - oturum_sonlandir(p_session) : SADECE çağırana ait olduğu doğrulanmış
--                                    tek bir oturumu (ve ona bağlı refresh
--                                    token'ları) siler — Supabase'in "sign
--                                    out" işleminde yaptığının aynısı (bkz.
--                                    docs: "When a user signs out, the
--                                    sessions affected by the logout are
--                                    removed from the database entirely").
--
-- NOT: user_agent/ip sütunları o oturum İLK açıldığındaki tarayıcı/IP
-- bilgisini tutar, GoTrue bunları sonradan güncellemez — yani "Chrome ·
-- Windows, 88.x.x.x" gibi bir satır o cihazın oturum AÇILIŞ anını yansıtır.
-- ============================================================================

create or replace function public.oturumlarimi_listele()
returns table (
  id uuid,
  olusturulma timestamptz,
  guncellenme timestamptz,
  user_agent text,
  ip text
)
language sql
security definer
set search_path = public, auth
as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, s.ip::text
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc nulls last, s.created_at desc;
$$;

comment on function public.oturumlarimi_listele() is
  'Çağıran kullanıcının kendi açık oturumlarını (tüm cihazlar) listeler — panel.js "Açık Oturumlar" bölümü.';

revoke execute on function public.oturumlarimi_listele() from public, anon;
grant execute on function public.oturumlarimi_listele() to authenticated;


create or replace function public.oturum_sonlandir(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Bu işlem için giriş yapmış olman gerekiyor.';
  end if;

  -- Bu oturumun GERÇEKTEN çağırana ait olduğunu doğruluyoruz — aksi hâlde
  -- bir kullanıcı başkasının session id'sini tahmin edip onu sonlandırabilir.
  if not exists (
    select 1 from auth.sessions where id = p_session_id and user_id = auth.uid()
  ) then
    raise exception 'Bu oturum sana ait değil ya da zaten sonlandırılmış.';
  end if;

  delete from auth.refresh_tokens where session_id = p_session_id;
  delete from auth.sessions where id = p_session_id;
end;
$$;

comment on function public.oturum_sonlandir(uuid) is
  'Çağıran kullanıcının KENDİNE ait tek bir oturumunu (ör. tek bir cihazı) sonlandırır — panel.js "Açık Oturumlar" bölümündeki "Çıkış Yap" butonu.';

revoke execute on function public.oturum_sonlandir(uuid) from public, anon;
grant execute on function public.oturum_sonlandir(uuid) to authenticated;
-- ============================================================================
