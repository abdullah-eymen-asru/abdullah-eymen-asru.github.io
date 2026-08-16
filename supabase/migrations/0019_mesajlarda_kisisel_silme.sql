-- ============================================================================
-- 0019_mesajlarda_kisisel_silme.sql
-- İstenen davranış: bir sohbeti ya da bir mesajı "Sil" denince, içerik
-- SADECE silen kişinin kendi görünümünden kalksın — karşı taraf (üye ya da
-- yönetici, kim olursa olsun) kendi tarafında hâlâ görmeye devam etsin.
-- Yani artık "Sil" GERÇEK bir DELETE değil, "bu satırı benim için gizle"
-- anlamına geliyor. Her iki taraf da AYNI sohbeti/mesajı kendi tarafından
-- silerse, satır fiziksel olarak veritabanında kalmaya devam eder ama HİÇBİR
-- taraf onu bir daha sorgusunda görmez (disk alanı önemsiz, ayrıca bir
-- temizlik gerekmiyor).
--
-- "Yeniden ortaya çıkma" kuralı: bir kullanıcı bir sohbeti kendi tarafından
-- sildikten SONRA o sohbete (kimden gelirse gelsin) YENİ bir mesaj gelirse,
-- sohbet o kullanıcı için tekrar (TÜM geçmişiyle) görünür olur — aksi hâlde
-- karşı taraf hâlâ o kişiyle konuşmaya devam ederken, silen kişi yeni gelen
-- mesajları SONSUZA DEK hiç göremezdi ki bu gerçek bir mesajlaşma
-- uygulamasında beklenen davranış DEĞİLDİR. Tek tek mesaj gizlemeleri
-- (mesaj_gizlemeleri) bu kuraldan ETKİLENMEZ — bir kullanıcı KENDİ
-- gönderdiği tek bir mesajı gizlerse o mesaj o kullanıcı için kalıcı olarak
-- gizli kalır (yeni mesaj gelmesi eski, ayrı bir mesajı geri getirmez).
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp TEK SEFERDE
-- çalıştır (Run). 0001-0018 sırayla daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KİŞİ BAŞINA GİZLEME TABLOLARI
-- ----------------------------------------------------------------------------
create table if not exists public.konusma_gizlemeleri (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  gizlendi_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
comment on table public.konusma_gizlemeleri is
  'Bir kullanıcı bir sohbeti "sildiğinde" satır burada işaretlenir — conversations satırı GERÇEKTEN silinmez, sadece bu kullanıcının sorgularından (RLS ile) gizlenir. Karşı taraf etkilenmez. O sohbete yeni bir mesaj gelince ilgili satır(lar) otomatik silinir (bkz. konusma_yeni_mesajda_gizlemeyi_kaldir trigger''ı) — sohbet o kullanıcı için tekrar görünür olur.';

create table if not exists public.mesaj_gizlemeleri (
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  gizlendi_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
comment on table public.mesaj_gizlemeleri is
  'Bir kullanıcı TEK bir mesajı "sildiğinde" satır burada işaretlenir — messages satırı GERÇEKTEN silinmez, sadece bu kullanıcının sorgularından gizlenir. Karşı taraf o mesajı görmeye devam eder. Kalıcıdır (konuşma yeniden görünür hâle gelse bile bu kayıt silinmez).';

alter table public.konusma_gizlemeleri enable row level security;
alter table public.mesaj_gizlemeleri enable row level security;

-- Bu iki tabloya normal kullanıcılar SADECE kendi satırlarını (user_id =
-- kendisi) okuyabilir/ekleyebilir — asıl yazma işlemi zaten aşağıdaki
-- SECURITY DEFINER RPC'ler üzerinden yapılıyor (RLS'i atlarlar), buradaki
-- politikalar sadece ekstra bir güvenlik payı.
drop policy if exists "konusma_gizleme_select_own" on public.konusma_gizlemeleri;
create policy "konusma_gizleme_select_own"
  on public.konusma_gizlemeleri for select
  using (user_id = auth.uid());

drop policy if exists "konusma_gizleme_insert_own" on public.konusma_gizlemeleri;
create policy "konusma_gizleme_insert_own"
  on public.konusma_gizlemeleri for insert
  with check (user_id = auth.uid());

drop policy if exists "mesaj_gizleme_select_own" on public.mesaj_gizlemeleri;
create policy "mesaj_gizleme_select_own"
  on public.mesaj_gizlemeleri for select
  using (user_id = auth.uid());

drop policy if exists "mesaj_gizleme_insert_own" on public.mesaj_gizlemeleri;
create policy "mesaj_gizleme_insert_own"
  on public.mesaj_gizlemeleri for insert
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2) SELECT POLİTİKALARI — kendi gizlediklerini artık görmesin
--    (INSERT/DELETE politikaları DEĞİŞMİYOR: messages_delete_own_or_admin ve
--    conversations_delete_own_or_admin hâlâ dursun — gerçek/kalıcı bir
--    silme gerekirse admin doğrudan SQL'den kullanabilir; panel/chat.js
--    ARTIK bunları çağırmıyor, bkz. aşağıdaki RPC'ler.)
-- ----------------------------------------------------------------------------
drop policy if exists "conversations_select_own_or_admin" on public.conversations;
create policy "conversations_select_own_or_admin"
  on public.conversations for select
  using (
    (user_id = auth.uid() or public.is_admin())
    and not exists (
      select 1 from public.konusma_gizlemeleri kg
      where kg.conversation_id = conversations.id and kg.user_id = auth.uid()
    )
  );

drop policy if exists "messages_select_own_or_admin" on public.messages;
create policy "messages_select_own_or_admin"
  on public.messages for select
  using (
    (
      public.is_admin()
      or exists (
        select 1 from public.conversations c
        where c.id = messages.conversation_id and c.user_id = auth.uid()
      )
    )
    and not exists (
      select 1 from public.konusma_gizlemeleri kg
      where kg.conversation_id = messages.conversation_id and kg.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.mesaj_gizlemeleri mg
      where mg.message_id = messages.id and mg.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 3) "SİL" İÇİN KULLANILACAK RPC'LER — assets/js/chat.js artık .delete()
--    yerine bunları çağırıyor. SECURITY DEFINER, çağıranın auth.uid()'ini
--    kullanır; kimin sildiğini KENDİSİ belirler (parametre olarak
--    verilmez), böylece bir kullanıcı başkası adına "sildim" diyemez.
-- ----------------------------------------------------------------------------
create or replace function public.konusmayi_kendimden_gizle(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and (c.user_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'Bu sohbete erişimin yok.';
  end if;

  insert into public.konusma_gizlemeleri (conversation_id, user_id)
  values (p_conversation_id, auth.uid())
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

revoke execute on function public.konusmayi_kendimden_gizle(uuid) from public, anon;
grant  execute on function public.konusmayi_kendimden_gizle(uuid) to authenticated;

create or replace function public.mesaji_kendimden_gizle(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  if not exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_message_id
      and (c.user_id = auth.uid() or m.sender_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'Bu mesaja erişimin yok.';
  end if;

  insert into public.mesaj_gizlemeleri (message_id, user_id)
  values (p_message_id, auth.uid())
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke execute on function public.mesaji_kendimden_gizle(uuid) from public, anon;
grant  execute on function public.mesaji_kendimden_gizle(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) YENİ MESAJ GELİNCE SOHBET GİZLEMESİNİ KALDIR (bkz. dosya başındaki
--    "Yeniden ortaya çıkma" notu). messages tablosunda zaten
--    trg_messages_son_mesaj_guncelle (migration 0006) diye bir AFTER INSERT
--    trigger'ı var; ayrı bir trigger olarak ekliyoruz, mevcut olanı
--    DEĞİŞTİRMİYORUZ.
-- ----------------------------------------------------------------------------
create or replace function public.konusma_yeni_mesajda_gizlemeyi_kaldir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.konusma_gizlemeleri where conversation_id = new.conversation_id;
  return new;
end;
$$;

revoke execute on function public.konusma_yeni_mesajda_gizlemeyi_kaldir() from public, anon, authenticated;

drop trigger if exists trg_messages_gizlemeyi_kaldir on public.messages;
create trigger trg_messages_gizlemeyi_kaldir
  after insert on public.messages
  for each row execute function public.konusma_yeni_mesajda_gizlemeyi_kaldir();

-- ----------------------------------------------------------------------------
-- 5) REALTIME — yeni tablolar için publication'a ekleme denenir (zararsız,
--    zaten ekliyse hata yutulur, bkz. migration 0006'daki aynı desen).
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.konusma_gizlemeleri;
exception when others then
  raise notice 'konusma_gizlemeleri realtime publication''a eklenemedi (muhtemelen zaten ekli) — sorun değil.';
end $$;

do $$
begin
  alter publication supabase_realtime add table public.mesaj_gizlemeleri;
exception when others then
  raise notice 'mesaj_gizlemeleri realtime publication''a eklenemedi (muhtemelen zaten ekli) — sorun değil.';
end $$;

-- ============================================================================
-- BİTTİ. assets/js/chat.js güncellendi: "Sil" butonları artık
-- .from("conversations")/.from("messages") üzerinde .delete() ÇAĞIRMIYOR,
-- yukarıdaki iki RPC'yi çağırıyor. Panelde/sitede bu mekanizma ("aslında
-- silinmiyor, senden gizleniyor, karşı tarafta duruyor") kullanıcıya
-- ayrıntılı anlatılmıyor — sadece basit bir "Sil" onayı gösteriliyor.
-- ============================================================================
