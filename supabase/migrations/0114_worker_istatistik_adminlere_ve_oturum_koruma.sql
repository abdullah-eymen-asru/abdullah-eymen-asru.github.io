-- ============================================================================
-- 0114_worker_istatistik_adminlere_ve_oturum_koruma.sql
--
-- 1) WORKER İSTATİSTİKLERİ ADMİNLERE AÇILIYOR (Sistem & Güvenlik › Yedekleme › Depolama Durumu)
--    Önceden "Worker İstekleri", "Kota Analitiği" ve geçmiş tablosu yalnızca Site Sahibi'ne açıktı. Artık:
--      Site Sahibi  +  askıda OLMAYAN yönetici (admin)  +  sistem yedekleme yetkisi verilmiş roller.
--    Yalnızca OKUMA genişler; Worker anahtarlarını açma/kapama yetkisi (sistem_export_yetkisi_var_mi) ve silme/temizleme
--    işlemleri (is_owner) AYNEN kalır.
--
-- 2) (Oturum koruma mimarisi tamamen istemci tarafıdır; bu dosyada SQL değişikliği gerektirmez.)
-- ============================================================================

create or replace function public.worker_istatistik_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (not coalesce(p.is_suspended, false) and p.role = 'admin')
        or public.sistem_export_yetkisi_var_mi()
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.worker_istatistik_yetkili() from public, anon;
grant execute on function public.worker_istatistik_yetkili() to authenticated;

-- Günlük toplamları yazma: aynı yetki (veri yalnızca Cloudflare Analytics'ten gelen sayılardır; GREATEST ile yalnızca artar).
create or replace function public.worker_kota_gecmisine_yaz(p_satirlar jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v jsonb; v_n integer := 0; v_gun date;
begin
  if not public.worker_istatistik_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  if jsonb_typeof(p_satirlar) is distinct from 'array' or jsonb_array_length(p_satirlar) > 400 then
    raise exception 'Geçersiz veri.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_satirlar) loop
    v_gun := (v ->> 'gun')::date;
    if v_gun is null or v_gun > (now() at time zone 'utc')::date then continue; end if;
    insert into public.worker_kota_gecmis (gun, workers, pages)
    values (v_gun, greatest(coalesce((v ->> 'workers')::bigint, 0), 0), greatest(coalesce((v ->> 'pages')::bigint, 0), 0))
    on conflict (gun) do update
      set workers = greatest(public.worker_kota_gecmis.workers, excluded.workers),
          pages   = greatest(public.worker_kota_gecmis.pages, excluded.pages),
          guncelleme = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.worker_kota_gecmisine_yaz(jsonb) from public, anon;
grant execute on function public.worker_kota_gecmisine_yaz(jsonb) to authenticated;

create or replace function public.worker_kota_gecmisi_getir(p_bas date, p_bit date)
returns table (gun date, workers bigint, pages bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.worker_istatistik_yetkili() then raise exception 'Yetkisiz işlem.' using errcode = '42501'; end if;
  return query
    select g.gun, g.workers, g.pages from public.worker_kota_gecmis g
     where g.gun between coalesce(p_bas, date '2000-01-01') and coalesce(p_bit, date '2100-01-01')
     order by g.gun limit 1200;
end;
$$;
revoke all on function public.worker_kota_gecmisi_getir(date, date) from public, anon;
grant execute on function public.worker_kota_gecmisi_getir(date, date) to authenticated;
