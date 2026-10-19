-- ============================================================================
-- 0104_havastil_bulut_oncelikli_rls.sql — HavaStil: bulut-öncelikli konum eşitleme için RLS onarımı + sıralama
-- Tekrar çalıştırmak güvenlidir (idempotent). Gereksinim: 0099, 0100, 0101.
--   1) havastil_konumlari / havastil_tercihleri: TÜM eski politikalar silinir, yerine komut başına açık 4'er politika konur
--      (SELECT/INSERT/UPDATE/DELETE). Koşul: user_id = auth.uid() VE havastil_yetkisi_var_mi(). anon: hiçbir yetki yok.
--      (0099 "FOR ALL" + 0101 "guncelle" üst üste binmesi ve olası eski/elle eklenmiş politikalar temizlenir.)
--   2) UPSERT hatası düzeltildi: 0099'daki 20 konum sınırı tetikleyicisi BEFORE INSERT'te çalıştığı için, 20 kayıtlıyken mevcut bir
--      konumu upsert (ON CONFLICT) etmek de "En fazla 20" hatası veriyordu. Artık aynı (user_id, ad) zaten varsa sayılmaz.
--   3) sira (cihazlar arası aynı sıra — "İlk sıraya al") + updated_at.
-- ============================================================================
alter table public.havastil_konumlari
  add column if not exists sira       integer     not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.havastil_konum_siniri()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.havastil_konumlari where user_id = new.user_id and ad = new.ad) then
    return new;                                   -- ON CONFLICT DO UPDATE yolu: yeni satır eklenmiyor, sınır sayılmaz
  end if;
  if (select count(*) from public.havastil_konumlari where user_id = new.user_id) >= 20 then
    raise exception 'En fazla 20 konum kaydedebilirsin.';
  end if;
  return new;
end $$;

create or replace function public.havastil_konum_guncellendi()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_havastil_konum_guncellendi on public.havastil_konumlari;
create trigger trg_havastil_konum_guncellendi before update on public.havastil_konumlari
  for each row execute function public.havastil_konum_guncellendi();

-- ---------------------------------------------------------------------------- RLS
alter table public.havastil_konumlari  enable row level security;
alter table public.havastil_tercihleri enable row level security;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('havastil_konumlari', 'havastil_tercihleri') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- havastil_konumlari
create policy havastil_konumlari_oku    on public.havastil_konumlari for select to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_konumlari_ekle   on public.havastil_konumlari for insert to authenticated
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_konumlari_guncelle on public.havastil_konumlari for update to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi())
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_konumlari_sil    on public.havastil_konumlari for delete to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());

-- havastil_tercihleri
create policy havastil_tercihleri_oku    on public.havastil_tercihleri for select to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_tercihleri_ekle   on public.havastil_tercihleri for insert to authenticated
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_tercihleri_guncelle on public.havastil_tercihleri for update to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi())
  with check (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());
create policy havastil_tercihleri_sil    on public.havastil_tercihleri for delete to authenticated
  using (user_id = (select auth.uid()) and public.havastil_yetkisi_var_mi());

revoke all on public.havastil_konumlari, public.havastil_tercihleri from public, anon;
grant select, insert, update, delete on public.havastil_konumlari, public.havastil_tercihleri to authenticated;

create index if not exists havastil_konumlari_user_sira_idx on public.havastil_konumlari (user_id, sira, created_at);

-- ----------------------------------------------------------------------------
-- HIZLI KONTROL (SQL Editor, owner olarak değil — gerçek oturumla uygulamadan dene):
--   select policyname, cmd from pg_policies where tablename = 'havastil_konumlari' order by cmd;   -- 4 satır: DELETE/INSERT/SELECT/UPDATE
--   select count(*) from public.havastil_konumlari;                                                 -- yalnızca kendi satırların
-- İki cihazda test: A'da ⭐ ile konum kaydet → B'de sayfayı aç / sekmeye dön → konum görünür.
-- ----------------------------------------------------------------------------
