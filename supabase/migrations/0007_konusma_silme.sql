-- ============================================================================
-- 0007_konusma_silme.sql
-- Abdullah Eymen Asru — Konuşma (sohbet) silme desteği.
--
-- 0006'da public.conversations tablosu için BİLEREK hiçbir insert/update/
-- delete politikası açılmamıştı ("varsayılan: kapalı" yorumuna bkz.) — bu
-- yüzden ne üye ne de admin bir konuşmayı SİLEMİYORDU (RLS sessizce 0 satır
-- etkiliyordu). Artık:
--   - Üye KENDİ konuşmasını silebilir.
--   - Admin HERHANGİ bir konuşmayı silebilir (moderasyon).
-- Bir konuşma silinince, içindeki TÜM mesajlar da otomatik silinir
-- (messages.conversation_id -> conversations.id ON DELETE CASCADE, 0006'da
-- zaten böyle tanımlanmıştı) — ayrıca bir şey yapmaya gerek yok.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- ============================================================================

drop policy if exists "conversations_delete_own_or_admin" on public.conversations;
create policy "conversations_delete_own_or_admin"
  on public.conversations for delete
  using (user_id = auth.uid() or public.is_admin());

-- ============================================================================
-- BİTTİ. assets/js/chat.js her konuşma satırına bir "Sil" butonu ekleyecek
-- şekilde güncellendi (bkz. konusmaSil() fonksiyonu).
-- ============================================================================
