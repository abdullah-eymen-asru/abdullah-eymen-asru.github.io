-- ============================================================================
-- 0009_admin_zorla_cikis_ve_bildirim.sql
--
-- (5) "Eski mailine ulaşamayan birinin maili yönetici tarafından
--      değiştirilince kullanıcının eski tüm oturumundan çıkış yapılsın."
--
--     Supabase'in admin API'sinde "şu user_id'nin TÜM oturumlarını sonlandır"
--     diye doğrudan bir fonksiyon YOKTUR — auth.admin.signOut(jwt, scope)
--     bir kullanıcı ID'si değil, o kullanıcının KENDİ JWT'sini ister (admin
--     bunu elinde bulunduramaz). Bunun yerine, Supabase'in resmi olarak
--     önerdiği yöntem: service_role ile doğrudan auth.refresh_tokens
--     tablosundaki o kullanıcıya ait kayıtları iptal etmek/silmek. Bu,
--     kullanıcının o an elindeki access token'ı süresi dolana kadar (~1
--     saat, JWT stateless olduğu için anlık iptal edilemez) çalışmaya
--     devam edebilir, ama refresh token'lar iptal edildiği için YENİ bir
--     access token ALAMAZ — pratikte "tüm cihazlardan çıkış" sonucunu
--     verir ve access token da en geç 1 saat içinde geçersiz olur.
--
--     Bu SQL fonksiyonu SECURITY DEFINER olarak auth şemasına erişip bu
--     işlemi yapar; admin-change-email Edge Function'ı e-postayı
--     değiştirdikten hemen sonra bunu RPC ile çağırır (bkz. o dosyadaki
--     değişiklik).
-- ============================================================================

create or replace function public.admin_force_signout_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Çağıranın gerçekten admin olduğunu BURADA DA doğruluyoruz (savunmacı
  -- kod) — Edge Function zaten service_role ile çağırdığı ve kendi
  -- tarafında admin kontrolü yaptığı için pratikte service_role burayı
  -- her zaman geçer, ama fonksiyon ileride başka bir yerden (ör. bir RPC
  -- olarak doğrudan) çağrılırsa diye ekstra bir güvenlik katmanı.
  if auth.role() <> 'service_role' then
    if not exists (
      select 1 from public.profiles where id = auth.uid() and role = 'admin'
    ) then
      raise exception 'Yetkisiz işlem: sadece admin bir kullanıcıyı zorla çıkışa zorlayabilir.';
    end if;
  end if;

  -- Refresh token'ları iptal et -> kullanıcı yeni bir access token
  -- alamaz, dolayısıyla mevcut access token'ı süresi dolduğunda (varsayılan
  -- ayarlarda en geç 1 saat) tüm cihazlarda fiilen çıkış yapılmış olur.
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  -- Supabase'in oturum takibi için kullandığı auth.sessions tablosundaki
  -- kayıtları da temizliyoruz (bazı sürümlerde "Sign out" admin
  -- panelinden yapılan işlem tam olarak budur).
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- Sadece service_role (Edge Function) ve admin rolündeki kullanıcılar
-- çağırabilsin — sıradan bir üye kendi/başkasının oturumunu bu fonksiyonla
-- sonlandıramaz.
revoke execute on function public.admin_force_signout_user(uuid) from public, authenticated, anon;
grant execute on function public.admin_force_signout_user(uuid) to service_role;

comment on function public.admin_force_signout_user(uuid) is
  'Admin tarafından e-posta değişikliği sonrası (ya da güvenlik amacıyla) bir kullanıcının TÜM oturumlarını (tüm cihazlar) sonlandırır. Sadece admin-change-email Edge Function''ı tarafından service_role ile çağrılır.';
