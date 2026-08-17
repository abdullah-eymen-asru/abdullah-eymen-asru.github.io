-- ============================================================================
-- 0025_mesaj_hedef_admin_secimi.sql
--
-- İstek: "Mesajlaşma alanında mesaj atılacak kişiler olarak hem admin hem de
-- site sahipleri yer alsın (adminler arasından seç ve site sahibi arasından
-- seç diye açılır pencere ve arama kutusu olsun)."
--
-- ÖNEMLİ — GÖRÜNÜRLÜK DEĞİŞMİYOR: Mesajlaşma zaten migration 0006'dan beri
-- "paylaşımlı gelen kutusu" modeliyle çalışıyor — public.is_admin() hem
-- 'admin' hem 'owner' rolünü kapsadığından (bkz. migration 0021), bir üyenin
-- açtığı HERHANGİ bir konuşmayı zaten TÜM adminler ve TÜM site sahipleri
-- görüp yanıtlayabiliyordu. Bu migration o paylaşımlı-gelen-kutusu RLS
-- modelini DEĞİŞTİRMİYOR — sadece üyenin "Yeni Sohbet" açarken listeden
-- BİLGİ AMAÇLI bir hedef (belirli bir admin ya da site sahibi) seçebilmesini
-- ekliyor: konuşma yine paylaşımlı kalır, sadece kiminle konuşmak
-- İSTEDİĞİNİ konuşma başlığının yanında göstermek için saklanır.
--
-- Bu dosya İDEMPOTENT'tir; 0001'den 0024'e kadarki migration'ların üzerine
-- Supabase Dashboard > SQL Editor'da Run'a basılarak eklenir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) conversations.hedef_admin_id — üyenin "Yeni Sohbet" açarken (varsa)
--    seçtiği admin/site sahibi. NULL ise "hangi yönetici bakarsa" anlamına
--    gelir (eski davranış). on delete set null: hedef kişi hesabını silerse
--    konuşma geçmişi bozulmasın, sadece hedef bilgisi boşa düşsün.
-- ----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists hedef_admin_id uuid references public.profiles(id) on delete set null;

comment on column public.conversations.hedef_admin_id is
  'Konuşmayı başlatan üyenin (varsa) seçtiği belirli admin/site sahibi — SADECE '
  'bilgi amaçlıdır, RLS''i etkilemez: is_admin() olan HERKES (tüm admin + owner) '
  'hâlâ tüm konuşmaları görüp yanıtlayabilir (paylaşımlı gelen kutusu).';

-- ----------------------------------------------------------------------------
-- 2) mesaj_hedef_listesi_getir() — mesajlaşma "Kime?" penceresi için, normal
--    üyeler DAHİL herkesin çağırabildiği dar kapsamlı bir liste. ÖNEMLİ:
--    admin_listesi_getir() (migration 0020/0023) burada KULLANILAMAZ, çünkü o
--    fonksiyon sadece içerik yönetebilenlere (is_editor_or_admin()) açık —
--    normal bir üye çağırdığında sessizce boş döner. Bu yüzden ayrı, sadece
--    "askıya alınmamış" admin/owner'ları dönen kendi RPC'mizi tanımlıyoruz.
-- ----------------------------------------------------------------------------
create or replace function public.mesaj_hedef_listesi_getir()
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role
  from public.profiles p
  where p.role in ('admin', 'owner')
    and coalesce(p.is_suspended, false) = false
  order by (p.role = 'owner') desc, p.full_name nulls last;
$$;

comment on function public.mesaj_hedef_listesi_getir() is
  'Mesajlaşma "Kime?" penceresinde üyenin arayıp seçebileceği admin+site '
  'sahibi listesi — herhangi bir authenticated kullanıcı çağırabilir (RLS''i '
  'bypass eder ama SADECE id/full_name/email/role döner).';

revoke execute on function public.mesaj_hedef_listesi_getir() from public, anon;
grant  execute on function public.mesaj_hedef_listesi_getir() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) baslat_konusma(): yeni p_hedef_admin_id parametresi eklendi. Dönen/kabul
--    edilen parametre seti değiştiği için önce eski (text, uuid) imzasını
--    DROP ediyoruz (CREATE OR REPLACE farklı imzada YENİ bir overload
--    yaratırdı, eskisini silmezdi).
-- ----------------------------------------------------------------------------
drop function if exists public.baslat_konusma(text, uuid);

create or replace function public.baslat_konusma(
  p_konu text,
  p_hedef_kullanici_id uuid default null,
  p_hedef_admin_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid;
  v_konu           text := coalesce(nullif(trim(p_konu), ''), 'Genel');
  v_id             uuid;
  v_hedef_admin_id uuid := null;
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

  -- Hedef admin/site sahibi SADECE geçerli bir admin/owner'sa saklanır —
  -- rastgele bir id gönderilirse sessizce yok sayılır (hata fırlatmaz,
  -- konuşma yine "hedefsiz/herhangi biri" olarak açılır).
  if p_hedef_admin_id is not null and exists (
    select 1 from public.profiles
    where id = p_hedef_admin_id
      and role in ('admin', 'owner')
      and coalesce(is_suspended, false) = false
  ) then
    v_hedef_admin_id := p_hedef_admin_id;
  end if;

  insert into public.conversations (user_id, konu, created_by, hedef_admin_id)
  values (v_user_id, v_konu, auth.uid(), v_hedef_admin_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.baslat_konusma(text, uuid, uuid) from public, anon;
grant  execute on function public.baslat_konusma(text, uuid, uuid) to authenticated;

-- ============================================================================
-- BİTTİ. assets/js/chat.js (wireUserChat) ve assets/js/mesajlar.js artık
-- "Yeni Sohbet" formunda bir "Kime?" penceresi (adminler / site sahipleri
-- sekmeleri + arama kutusu) gösterip seçilen kişiyi p_hedef_admin_id olarak
-- gönderiyor.
-- ============================================================================
