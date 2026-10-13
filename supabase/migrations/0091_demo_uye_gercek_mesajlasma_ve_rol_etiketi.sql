-- ============================================================================
-- 0091_demo_uye_gercek_mesajlasma_ve_rol_etiketi.sql
-- 1) 'demo' rollü hesaplar GERÇEKTEN mesaj gönderip alabilsin (yöneticilerle iletişime geçebilsin).
-- 2) Sohbet ekranlarında isimlerin yanında üye türü (Üye / Özel Üye / Yönetici / Site Sahibi …) görünebilsin.
--
-- Tekrar çalıştırmak güvenlidir (idempotent). Supabase SQL Editor'de TEK SEFERDE çalıştır. Gereksinim: 0083, 0029, 0030.
--
-- 1) NE DEĞİŞİYOR
--    0083, RLS'i açık HER tabloya "demo yok" (restrictive) politikası koymuştu. Mesajlaşmaya ait 4 tablodan bu
--    politika kaldırılır: conversations, messages, konusma_gizlemeleri, mesaj_gizlemeleri.
--    Demo hesabı yine SADECE kendi satırlarına erişir (mevcut politikalar: user_id = auth.uid() / sender_id = auth.uid();
--    yönetici yetkisi demo'da olmadığı için başka kimsenin konuşmasını göremez). Diğer tüm tablolarda demo izolasyonu AYNEN sürer.
--    UYARI: 0083 bir daha çalıştırılırsa bu 4 politikayı yeniden oluşturur → bu dosyayı ardından tekrar çalıştır.
--
-- 2) mesaj_kisi_bilgileri(p_ids uuid[]) → (id, full_name, email, role)
--    Normal üye bir başkasının profilini RLS yüzünden okuyamadığı için gönderen adları (ve rolleri) görünmüyordu.
--    Bu RPC SADECE şunları döner: kendisi, yönetici/site sahibi (zaten "Kime?" listesinde herkese açık) ve
--    KENDİ konuşmalarında mesaj yazmış kişiler. Yönetici/owner için istenen herkes. E-posta yalnızca yöneticilere döner.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['conversations', 'messages', 'konusma_gizlemeleri', 'mesaj_gizlemeleri'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'demo_izolasyon_' || t, t);
    end if;
  end loop;
end $$;

create or replace function public.mesaj_kisi_bilgileri(p_ids uuid[])
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name,
         case when public.is_admin() then p.email else null end as email,
         p.role
  from public.profiles p
  where auth.uid() is not null
    and p.id = any (p_ids[1:200])
    and (
      public.is_admin()
      or p.id = auth.uid()
      or (p.role in ('admin', 'owner') and coalesce(p.is_suspended, false) = false)
      or exists (
        select 1
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where m.sender_id = p.id and c.user_id = auth.uid()
      )
    );
$$;

revoke execute on function public.mesaj_kisi_bilgileri(uuid[]) from public, anon;
grant  execute on function public.mesaj_kisi_bilgileri(uuid[]) to authenticated;
