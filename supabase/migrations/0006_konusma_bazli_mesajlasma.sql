-- ============================================================================
-- 0006_konusma_bazli_mesajlasma.sql
-- Abdullah Eymen Asru — Mesajlaşmayı "tek konuşma" modelinden "konu bazlı
-- birden çok konuşma" modeline geçirme.
--
-- Öncesi (0004): her üyenin yöneticiyle TEK bir konuşması vardı
-- (messages.conversation_user_id = üyenin kendisi).
-- Sonrası: her üye yöneticiyle FARKLI KONULARDA birden çok ayrı konuşma
-- açabiliyor (yeni public.conversations tablosu), admin de sistemdeki
-- HERHANGİ bir üyeyi arayıp onunla yeni bir konuşma başlatabiliyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001-0005'i DEĞİŞTİRMİYORUZ, üzerine ek yapıyoruz. Daha önce hiç
-- migration çalıştırmadıysan önce 0001'den 0005'e kadar sırayla çalıştır.
-- Bu dosya İDEMPOTENT'tir: hem sıfırdan kurulumda hem de 0004'teki eski
-- "messages" tablosu üzerine tekrar tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KONUŞMALAR TABLOSU
--    Her satır: bir üyenin (user_id) yöneticiyle belirli bir KONUDA (konu)
--    açtığı tek bir konuşma başlığı. created_by: konuşmayı kimin açtığı
--    (üyenin kendisi ya da onun adına bir admin).
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  konu         text not null default 'Genel' check (char_length(btrim(konu)) > 0 and char_length(konu) <= 120),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  son_mesaj_at timestamptz not null default now()
);

comment on table public.conversations is 'Üye <-> yönetici konuşma başlıkları. Her üyenin yöneticiyle birden çok, farklı konularda konuşması olabilir.';
comment on column public.conversations.user_id is 'Konuşmanın sahibi olan üye (admin olmayan taraf).';
comment on column public.conversations.konu is 'Konuşma başlığı/konusu (ör. "Ödeme sorunu"), üye veya admin tarafından serbest metin olarak girilir.';

create index if not exists idx_conversations_user_son_mesaj on public.conversations (user_id, son_mesaj_at desc);
create index if not exists idx_conversations_son_mesaj       on public.conversations (son_mesaj_at desc);

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own_or_admin" on public.conversations;
create policy "conversations_select_own_or_admin"
  on public.conversations for select
  using (user_id = auth.uid() or public.is_admin());

-- INSERT/UPDATE/DELETE elle yapılmaz: konuşmalar SADECE aşağıdaki
-- baslat_konusma() RPC'siyle (SECURITY DEFINER) açılır, son_mesaj_at
-- SADECE bir trigger'la güncellenir. Bu yüzden authenticated rolüne ayrı
-- bir insert/update/delete politikası açmıyoruz (varsayılan: kapalı).

-- ----------------------------------------------------------------------------
-- 2) MESSAGES TABLOSUNU conversation_id'YE GEÇİRME
--    a) Tablo hiç yoksa (sıfırdan kurulum): doğrudan yeni şemayla oluştur.
--    b) Tablo eski şemayla (conversation_user_id) varsa: her benzersiz
--       conversation_user_id için "Genel" konulu bir conversations satırı
--       aç, mevcut mesajları oraya bağla, eski kolonu kaldır.
--    c) Tablo zaten yeni şemayla varsa (bu migration tekrar çalıştırıldı):
--       hiçbir şey yapma.
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 4000),
  created_at      timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'conversation_user_id'
  ) then
    -- Her eski "konuşma sahibi" için tek bir "Genel" konulu konuşma aç.
    insert into public.conversations (user_id, konu, created_by, created_at, son_mesaj_at)
    select m.conversation_user_id, 'Genel', m.conversation_user_id, min(m.created_at), max(m.created_at)
    from public.messages m
    where m.conversation_user_id is not null
    group by m.conversation_user_id;

    -- Eski mesajları yeni açılan "Genel" konuşmalara bağla.
    update public.messages m
    set conversation_id = c.id
    from public.conversations c
    where c.user_id = m.conversation_user_id
      and c.konu = 'Genel'
      and m.conversation_id is null;

    alter table public.messages drop column conversation_user_id;

    raise notice 'Eski mesajlaşma verisi "Genel" konulu konuşmalara taşındı.';
  end if;
end $$;

-- Geçiş tamamlandıktan sonra conversation_id artık boş bırakılamaz.
do $$
begin
  if not exists (select 1 from public.messages where conversation_id is null) then
    alter table public.messages alter column conversation_id set not null;
  end if;
end $$;

comment on table public.messages is 'Üye <-> yönetici mesajları. conversation_id: hangi konuşmaya (bkz. public.conversations) ait olduğu. sender_id: mesajı gönderen taraf.';

drop index if exists public.idx_messages_conversation; -- eski (conversation_user_id, created_at) indeksi
create index if not exists idx_messages_conversation_id on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

-- SELECT: konuşmanın sahibi, konuşmaya mesaj gönderen taraf ya da herhangi bir admin görebilir.
drop policy if exists "messages_select_own_or_admin" on public.messages;
create policy "messages_select_own_or_admin"
  on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- INSERT: gönderen her zaman kendisi olmalı (sender_id = auth.uid()) VE
-- ilgili konuşmaya erişimi olmalı (kendi konuşması ya da admin).
drop policy if exists "messages_insert_own_or_admin" on public.messages;
create policy "messages_insert_own_or_admin"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

-- DELETE: herkes SADECE KENDİ GÖNDERDİĞİ mesajı silebilir; admin moderasyon
-- için herhangi bir mesajı silebilir. (Değişmedi.)
drop policy if exists "messages_delete_own_or_admin" on public.messages;
create policy "messages_delete_own_or_admin"
  on public.messages for delete
  using (sender_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- 3) KONUŞMANIN "son_mesaj_at" ALANINI OTOMATİK GÜNCELLEME
--    Konuşma listesini en son mesaja göre sıralayabilmek için her yeni
--    mesajda ilgili konuşmanın son_mesaj_at'ini güncelleyen trigger.
-- ----------------------------------------------------------------------------
create or replace function public.konusma_son_mesaj_guncelle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations set son_mesaj_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

revoke execute on function public.konusma_son_mesaj_guncelle() from public, anon, authenticated;

drop trigger if exists trg_messages_son_mesaj_guncelle on public.messages;
create trigger trg_messages_son_mesaj_guncelle
  after insert on public.messages
  for each row execute function public.konusma_son_mesaj_guncelle();

-- ----------------------------------------------------------------------------
-- 4) YENİ KONUŞMA BAŞLATMA RPC'Sİ
--    Normal/özel üye: sadece KENDİ adına yeni bir konuşma açabilir
--    (p_hedef_kullanici_id parametresi admin değilse yok sayılır).
--    Admin: p_hedef_kullanici_id ile SİSTEMDEKİ HERHANGİ BİR üye adına
--    yeni bir konuşma açabilir (arama sonucundan üye seçip "Yeni Sohbet").
-- ----------------------------------------------------------------------------
create or replace function public.baslat_konusma(p_konu text, p_hedef_kullanici_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_konu    text := coalesce(nullif(trim(p_konu), ''), 'Genel');
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  if public.is_admin() and p_hedef_kullanici_id is not null then
    v_user_id := p_hedef_kullanici_id;
  else
    v_user_id := auth.uid();
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Kullanıcı bulunamadı.';
  end if;

  insert into public.conversations (user_id, konu, created_by)
  values (v_user_id, v_konu, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.baslat_konusma(text, uuid) from public, anon;
grant  execute on function public.baslat_konusma(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) REALTIME
--    conversations tablosunu da realtime publication'a ekliyoruz (mesaj
--    listesi gibi konuşma listesi de anında güncellensin diye). messages
--    zaten 0004'te eklenmişti, idempotent olması için yine deniyoruz.
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when others then
  raise notice 'conversations tablosu realtime publication''a eklenemedi (muhtemelen zaten ekli) — sorun değil, chat.js periyodik yeniliyor.';
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then
  raise notice 'messages tablosu realtime publication''a eklenemedi (muhtemelen zaten ekli) — sorun değil.';
end $$;

-- ============================================================================
-- BİTTİ. assets/js/chat.js, panel/panel.md ve panel/admin.md bu yeni şemayı
-- (conversations + messages.conversation_id) kullanacak şekilde güncellendi.
-- ============================================================================
