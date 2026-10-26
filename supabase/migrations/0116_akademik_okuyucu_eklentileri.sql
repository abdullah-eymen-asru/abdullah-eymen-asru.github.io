-- ============================================================================
-- 0116_akademik_okuyucu_eklentileri.sql — Akademik Kütüphane › Okuyucu eklentileri (kullanıcı başına küçük ayar satırı)
--
-- • Eklenti KODU sunucuda/veritabanında yoktur; yalnızca hangi eklentilerin açık olduğu ve seçenekleri tutulur (≤ 8 KB).
--   → Supabase/R2 kotasını fiilen kullanmaz. PDF ve çeviri içerikleri hiçbir yere yazılmaz.
-- • Yetki: Yetki Ayarları › "Akademik Okuyucu Eklentileri" (anahtar 'akademik_eklentiler'; varsayılan AÇIK, rol bazında kapatılır;
--   0048 matrisi — ek SQL gerektirmez). Ayrıca akademik_kutuphane_yetkili() şarttır. Site Sahibi her zaman.
-- • Hesap silinince satır CASCADE ile gider.
-- ============================================================================
create table if not exists public.akademik_eklenti_ayarlari (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ayar       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint akademik_eklenti_ayar_boyut_chk check (octet_length(ayar::text) <= 8192)
);
comment on table public.akademik_eklenti_ayarlari is 'Akademik okuyucu eklenti tercihleri (kullanıcı başına tek küçük satır; kod/içerik içermez).';

alter table public.akademik_eklenti_ayarlari enable row level security;

create or replace function public.akademik_eklenti_yetkili()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner'
        or (not coalesce(p.is_suspended, false)
            and public.akademik_kutuphane_yetkili()
            and public.ozellik_erisimi_var_mi('akademik_eklentiler', p.role))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.akademik_eklenti_yetkili() from public, anon;
grant execute on function public.akademik_eklenti_yetkili() to authenticated;

drop policy if exists akademik_eklenti_ayar_sahip on public.akademik_eklenti_ayarlari;
create policy akademik_eklenti_ayar_sahip on public.akademik_eklenti_ayarlari
  for all to authenticated
  using (user_id = (select auth.uid()) and public.akademik_eklenti_yetkili())
  with check (user_id = (select auth.uid()) and public.akademik_eklenti_yetkili());

revoke all on public.akademik_eklenti_ayarlari from public, anon;
grant select, insert, update, delete on public.akademik_eklenti_ayarlari to authenticated;
