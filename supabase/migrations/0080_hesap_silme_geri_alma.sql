-- ============================================================================
-- 0080_hesap_silme_geri_alma.sql
-- Bekleyen hesap silme talebini İPTAL etme (yalnızca service_role / delete-account Edge Function; çağıran owner doğrulanır).
-- Talep kaydı kalkar, profildeki silme işareti temizlenir. Giriş yasağını Edge Function kaldırır (auth.admin).
-- Tekrar çalıştırmak güvenlidir. Gereksinim: 0078.
-- ============================================================================
create or replace function public.hesap_silme_talebi_iptal(p_user uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_var boolean;
begin
  delete from public.hesap_silme_talepleri where user_id = p_user returning true into v_var;
  update public.profiles set silme_bekliyor_at = null where id = p_user;
  return coalesce(v_var, false);
end $$;
revoke all on function public.hesap_silme_talebi_iptal(uuid) from public, anon, authenticated;
