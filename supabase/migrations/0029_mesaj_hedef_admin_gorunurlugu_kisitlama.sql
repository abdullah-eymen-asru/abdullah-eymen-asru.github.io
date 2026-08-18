-- ============================================================================
-- 0029_mesaj_hedef_admin_gorunurlugu_kisitlama.sql
--
-- İstek: "Üyeler arası mesajı sadece hangi admine gittiyse o görebilsin,
-- bir de site sahibi görebilsin, diğer adminler göremesin."
--
-- KÖK DURUM: migration 0025 bir konuşmaya "hedef_admin_id" (üyenin 'Kime?'
-- penceresinden seçtiği belirli admin/site sahibi) eklemişti ama KENDİ
-- YORUMUNDA AÇIKÇA belirttiği gibi bu SADECE bilgi amaçlıydı — "public.
-- is_admin() hem 'admin' hem 'owner' rolünü kapsadığından, bir üyenin açtığı
-- HERHANGİ bir konuşmayı zaten TÜM adminler ve TÜM site sahipleri
-- görüp yanıtlayabiliyordu" ve bu migration "o paylaşımlı-gelen-kutusu RLS
-- modelini DEĞİŞTİRMİYORUZ" diyordu. Yani hedef seçilse bile GERÇEKTE
-- HERKES görüyordu — bu migration tam olarak BUNU değiştiriyor.
--
-- YENİ KURAL (conversations.hedef_admin_id set edilmişse):
--   - Konuşmanın sahibi olan üye (user_id)                    → her zaman görür.
--   - Site Sahibi (owner)                                     → her zaman görür (hedeften bağımsız).
--   - Hedef olarak SEÇİLEN admin (hedef_admin_id = kendisi)   → görür.
--   - BAŞKA HERHANGİ BİR admin                                → GÖREMEZ.
-- hedef_admin_id NULL ise ("Fark etmez — herhangi bir yönetici/site sahibi
-- görsün" seçildiyse) davranış DEĞİŞMEDİ: is_admin() olan HERKES (tüm admin +
-- owner) hâlâ görüp yanıtlayabilir — kısıtlama SADECE üye BİLEREK belirli
-- bir kişiyi seçtiğinde devreye giriyor.
--
-- KAPSAM: aşağıdaki HER YERDE aynı kural tekrarlanıyor (hepsi ayrı ayrı
-- kontrol edilen yerler, birini atlamak boşluk bırakırdı):
--   1) conversations SELECT   (konuşmayı görme)
--   2) messages      SELECT   (mesajları görme)                — asıl istek bu.
--   3) messages      INSERT   (yanıt yazma — göremeyen yazamaz da)
--   4) messages      DELETE   (moderasyon amaçlı GERÇEK silme — bkz. 0006)
--   5) conversations DELETE   (moderasyon amaçlı GERÇEK silme — bkz. 0007;
--      panel şu an bunu HİÇ çağırmıyor, sadece "kendimden gizle" RPC'lerini
--      kullanıyor, ama RLS satırı olduğu için API'den doğrudan da
--      çağrılabilir — tutarlılık için burayı da kapatıyoruz).
--   6) konusmayi_kendimden_gizle / mesaji_kendimden_gizle RPC'leri (0019) —
--      içindeki "erişimin var mı?" kontrolleri kendi public.is_admin()
--      kısayolunu kullanıyordu, aynı şekilde daraltıldı.
-- Bu politikaların HİÇBİRİ migration 0019'daki "konusma_gizlemeleri" / 
-- "mesaj_gizlemeleri" (kişisel gizleme) mantığını BOZMUYOR — o kısımlar
-- AYNEN korunuyor, sadece is_admin() şartının yerine hedef-farkında bir
-- ifade geçiyor.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001'den 0028'e kadarki migration'lar daha önce çalıştırılmış olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Yardımcı: bu konuşmaya (satırın TAMAMI parametre olarak) genel bir
-- "yönetici" (admin/owner) olarak erişimim var mı? Aşağıdaki HER politikada
-- tekrar eden "owner her zaman / admin sadece hedefse ya da hedef yoksa"
-- mantığını tek yerde topluyoruz.
-- ----------------------------------------------------------------------------
create or replace function public._konusma_yonetici_erisimi_var_mi(p_konusma public.conversations)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_owner()
    or (public.is_admin() and (p_konusma.hedef_admin_id is null or p_konusma.hedef_admin_id = auth.uid()));
$$;

comment on function public._konusma_yonetici_erisimi_var_mi(public.conversations) is
  'Bir konuşmaya (üye tarafı DEĞİL, yönetici tarafı için) genel erişim var mı? Owner HER ZAMAN erişir. Admin ise SADECE konuşmanın hedef_admin_id''si boşsa (herkese açık, "fark etmez" seçildiyse) YA DA hedef bizzat kendisiyse erişir — hedef BAŞKA bir admin/owner ise erişemez (bkz. migration 0029, "üyeler arası mesajı sadece hangi admine gittiyse o görsün" isteği).';

grant execute on function public._konusma_yonetici_erisimi_var_mi(public.conversations) to authenticated;

-- ----------------------------------------------------------------------------
-- 1) conversations SELECT — 0019'daki kişisel-gizleme koşulu AYNEN korunuyor,
--    sadece "user_id = auth.uid() or public.is_admin()" kısmı hedef-farkında
--    hâle getirildi.
-- ----------------------------------------------------------------------------
drop policy if exists "conversations_select_own_or_admin" on public.conversations;
create policy "conversations_select_own_or_admin"
  on public.conversations for select
  using (
    (user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(conversations))
    and not exists (
      select 1 from public.konusma_gizlemeleri kg
      where kg.conversation_id = conversations.id and kg.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2) messages SELECT — ASIL İSTEK BURASI. 0019'daki kişisel-gizleme
--    koşulları (konusma_gizlemeleri + mesaj_gizlemeleri) AYNEN korunuyor.
-- ----------------------------------------------------------------------------
drop policy if exists "messages_select_own_or_admin" on public.messages;
create policy "messages_select_own_or_admin"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
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
-- 3) messages INSERT — göremeyen bir konuşmaya yanıt da yazamaz. sender_id
--    her zaman kendisi olmalı kuralı DEĞİŞMEDİ.
-- ----------------------------------------------------------------------------
drop policy if exists "messages_insert_own_or_admin" on public.messages;
create policy "messages_insert_own_or_admin"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
    )
  );

-- ----------------------------------------------------------------------------
-- 4) messages DELETE (GERÇEK/kalıcı silme, moderasyon amaçlı — panel bunu
--    artık çağırmıyor ama RLS satırı API'den doğrudan erişilebilir olduğu
--    için tutarlılık adına daraltılıyor). Kendi mesajını silme hakkı
--    DEĞİŞMEDİ.
-- ----------------------------------------------------------------------------
drop policy if exists "messages_delete_own_or_admin" on public.messages;
create policy "messages_delete_own_or_admin"
  on public.messages for delete
  using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and public._konusma_yonetici_erisimi_var_mi(c)
    )
  );

-- ----------------------------------------------------------------------------
-- 5) conversations DELETE (GERÇEK/kalıcı silme, migration 0007) — aynı
--    daraltma. Üyenin kendi konuşmasını silme hakkı DEĞİŞMEDİ.
-- ----------------------------------------------------------------------------
drop policy if exists "conversations_delete_own_or_admin" on public.conversations;
create policy "conversations_delete_own_or_admin"
  on public.conversations for delete
  using (user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(conversations));

-- ----------------------------------------------------------------------------
-- 6) "Kendimden gizle" RPC'lerindeki (migration 0019) erişim kontrolleri —
--    bu fonksiyonlar SECURITY DEFINER olduğu için RLS'i bypass ederler,
--    kendi içlerindeki public.is_admin() kısayolunu da aynı şekilde
--    değiştirmemiz gerekiyor (aksi hâlde hedefi olmayan bir admin, RLS'in
--    artık göstermediği bir konuşmayı/mesajı yine de "benden gizle" diye
--    işaretleyebilirdi — zararsız ama tutarsız, düzeltiyoruz).
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
    where c.id = p_conversation_id
      and (c.user_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
  ) then
    raise exception 'Bu sohbete erişimin yok.';
  end if;

  insert into public.konusma_gizlemeleri (conversation_id, user_id)
  values (p_conversation_id, auth.uid())
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

grant execute on function public.konusmayi_kendimden_gizle(uuid) to authenticated;

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
      and (c.user_id = auth.uid() or m.sender_id = auth.uid() or public._konusma_yonetici_erisimi_var_mi(c))
  ) then
    raise exception 'Bu mesaja erişimin yok.';
  end if;

  insert into public.mesaj_gizlemeleri (message_id, user_id)
  values (p_message_id, auth.uid())
  on conflict (message_id, user_id) do nothing;
end;
$$;

grant execute on function public.mesaji_kendimden_gizle(uuid) to authenticated;

-- ============================================================================
-- BİTTİ. Ekstra kurulum adımı gerekmiyor. Bundan sonra:
--   - Bir üye "Yeni Sohbet" açarken belirli bir admin/site sahibi SEÇERSE
--     (bkz. migration 0025 "Kime?" penceresi), o konuşmayı ve içindeki TÜM
--     mesajları SADECE seçilen kişi ve Site Sahibi (owner) görüp yanıtlayabilir
--     — diğer adminler artık konuşma listesinde bunu HİÇ GÖRMEZ.
--   - "Fark etmez — herhangi bir yönetici/site sahibi görsün" seçilirse (ya
--     da admin bir üye adına/üyeyi arayıp kendisi konuşma başlatırsa, bkz.
--     wireYeniSohbetAdmin — orada hedef seçimi yok, hedef_admin_id NULL
--     kalır) davranış ESKİSİ GİBİ: tüm adminler + owner görür.
--   - assets/js/chat.js ayrı bir commit'te güncellendi: artık her mesaj
--     balonunun üstünde GÖNDERENİN ADI gösteriliyor (bkz.
--     gonderenAdlariniGetir + mesajBalonuHtml).
-- ============================================================================
