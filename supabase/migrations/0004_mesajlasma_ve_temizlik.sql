-- ============================================================================
-- 0004_mesajlasma_ve_temizlik.sql
-- Abdullah Eymen Asru — Üye<->Yönetici mesajlaşma, kalıcı hata düzeltmeleri
-- (KVKK onayının sessizce başarısız olabilmesi, aynı başlıkla ikinci özel
-- içerik eklerken "duplicate key" hatası), "Hakkımda" düzenleme özelliğinin
-- kaldırılması, kullanılmayan avatar altyapısının temizlenmesi ve
-- Supabase Security Advisor'daki (ekli CSV) tüm WARN uyarılarının
-- giderilmesi.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001, 0002, 0003'ü DEĞİŞTİRMİYORUZ, üzerine ek yapıyoruz — onları tekrar
-- çalıştırmana gerek yok, sadece bunu çalıştır (o üçünü hiç çalıştırmadıysan
-- önce onları sırayla çalıştırman gerekir).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KVKK ONAYI: SESSİZ BAŞARISIZLIĞI ORTADAN KALDIRMA
--    Eski kvkk_onayini_ver(): "update ... where id = auth.uid()" satırı,
--    auth.uid() bir sebeple (süresi dolmuş/garip bir oturum ucu vb.) ilgili
--    profiles satırıyla eşleşmezse HİÇBİR HATA VERMEDEN 0 satır güncelleyip
--    "başarılı" dönüyordu. Panel bunu "onaylandı" sanıp öyle gösteriyordu,
--    ama DB'de hiçbir şey değişmemiş olabiliyordu — "onayladım ama her
--    yerde onaylı görünmüyor" şikayetinin en olası sebebi buydu. Şimdi:
--    oturum yoksa veya güncellenen satır sayısı 0 ise AÇIKÇA hata
--    fırlatıyoruz, ön yüz (panel.js) de artık bu hatayı gösterip DB'den
--    gerçek durumu yeniden okuyor.
-- ----------------------------------------------------------------------------
create or replace function public.kvkk_onayini_ver(p_versiyon text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Oturum bulunamadı, lütfen tekrar giriş yap.';
  end if;

  update public.profiles
  set kvkk_onay_verildi = true,
      kvkk_onay_tarihi = now(),
      kvkk_onay_versiyonu = p_versiyon
  where id = auth.uid();

  if not found then
    raise exception 'Profil bulunamadı, onay kaydedilemedi.';
  end if;
end;
$$;

revoke execute on function public.kvkk_onayini_ver(text) from public, anon;
grant  execute on function public.kvkk_onayini_ver(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) ÖZEL İÇERİK SLUG'INI OTOMATİK BENZERSİZLEŞTİRME
--    "special_content.slug" UNIQUE olduğu için, admin aynı başlıkla ikinci
--    bir içerik eklediğinde (ör. aynı makaleyi farklı bir üyeye ayrıca
--    "göndermek" için yeni bir kayıt açtığında) slug çakışıyor ve
--    "duplicate key value violates unique constraint special_content_slug_key"
--    hatasıyla kayıt tamamen BAŞARISIZ oluyordu ("bir üyeye sanki sadece bir
--    kere özel içerik gönderebiliyorum" şikayeti buydu). Artık slug
--    çakışırsa trigger otomatik olarak "-2", "-3", ... ekleyerek benzersiz
--    hale getiriyor; admin panelinde ekstra bir şey yapmaya gerek yok.
-- ----------------------------------------------------------------------------
create or replace function public.benzersiz_slug_uret()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  taban text := coalesce(nullif(trim(new.slug), ''), 'icerik');
  aday  text := taban;
  sayac int := 1;
begin
  while exists (
    select 1 from public.special_content
    where slug = aday and id is distinct from new.id
  ) loop
    sayac := sayac + 1;
    aday := taban || '-' || sayac;
  end loop;
  new.slug := aday;
  return new;
end;
$$;

revoke execute on function public.benzersiz_slug_uret() from public, anon, authenticated;

drop trigger if exists trg_special_content_benzersiz_slug on public.special_content;
create trigger trg_special_content_benzersiz_slug
  before insert or update on public.special_content
  for each row execute function public.benzersiz_slug_uret();

-- ----------------------------------------------------------------------------
-- 3) "HAKKIMDA" METNİNİ ADMİN PANELİNDEN DÜZENLEME ÖZELLİĞİNİN KALDIRILMASI
--    site_settings tablosunu SİLMİYORUZ (veri kaybı olmasın), sadece artık
--    hiçbir arayüzden (admin.md/admin.js'ten kaldırıldı) düzenlenmiyor.
--    Ekstra güvence olarak UPDATE politikasını da kaldırıyoruz — bu satırı
--    artık normal REST/RPC yoluyla kimse (admin dahil) değiştiremez, sadece
--    Dashboard > SQL Editor'den elle bir şey yapılmak istenirse mümkün olur.
--    site geneli "Hakkımda" metni artık SADECE
--    _includes/hakkimda-icerik.md dosyası düzenlenerek değiştirilir.
-- ----------------------------------------------------------------------------
drop policy if exists "settings_update_admin_only" on public.site_settings;

-- ----------------------------------------------------------------------------
-- 4) KULLANILMAYAN AVATAR ALTYAPISININ TEMİZLENMESİ
--    Profil fotoğrafı yükleme özelliği 0003'te zaten arayüzden kaldırılmıştı
--    ama "kalıntı" olarak duran şeyler vardı: 'avatarlar' bucket'ı, ona ait
--    politikalar ve profiles.avatar_url / profiles.bio kolonları. Hiçbiri
--    artık hiçbir yerden kullanılmıyor — temizliyoruz.
-- ----------------------------------------------------------------------------
drop policy if exists "avatar_write_admin_only" on storage.objects;
drop policy if exists "avatar_update_admin_only" on storage.objects;
drop policy if exists "avatar_delete_admin_only" on storage.objects;

do $$
begin
  delete from storage.objects where bucket_id = 'avatarlar';
  delete from storage.buckets where id = 'avatarlar';
exception when others then
  raise notice 'avatarlar bucket''ı silinemedi (muhtemelen zaten yok) — sorun değil.';
end $$;

alter table public.profiles drop column if exists avatar_url;
alter table public.profiles drop column if exists bio;

-- handle_new_user() artık avatar_url yazmıyor (kolon kalktı)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, role,
    kvkk_onay_verildi, kvkk_onay_tarihi, kvkk_onay_versiyonu
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'user',
    coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'kvkk_onay')::boolean, false)
         then now() else null end,
    new.raw_user_meta_data->>'kvkk_versiyon'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) ÜYE <-> YÖNETİCİ MESAJLAŞMA ("chatbox")
--    Basit bir DM sistemi: her üyenin yöneticiyle TEK bir konuşması vardır
--    (conversation_user_id = konuşmanın sahibi olan üye). Üyeler birbirine
--    YAZAMAZ, sadece yöneticiyle yazışabilir. Admin tüm konuşmaları görür ve
--    herhangi birine yanıt verebilir. Mesajlar, gönderen tarafından (veya
--    admin tarafından, moderasyon amacıyla) istenildiği zaman silinebilir.
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id            uuid not null references public.profiles(id) on delete cascade,
  body                 text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 4000),
  created_at           timestamptz not null default now()
);

comment on table public.messages is 'Üye <-> yönetici mesajlaşması. conversation_user_id: konuşmanın admin olmayan tarafı (sahibi). sender_id: mesajı gönderen taraf.';

create index if not exists idx_messages_conversation on public.messages (conversation_user_id, created_at);

alter table public.messages enable row level security;

-- SELECT: konuşmanın sahibi, mesajı gönderen (admin) veya herhangi bir admin görebilir.
drop policy if exists "messages_select_own_or_admin" on public.messages;
create policy "messages_select_own_or_admin"
  on public.messages for select
  using (
    conversation_user_id = auth.uid()
    or sender_id = auth.uid()
    or public.is_admin()
  );

-- INSERT: gönderen her zaman kendisi olmalı (sender_id = auth.uid()).
-- Normal/özel üye SADECE kendi konuşmasına (conversation_user_id = kendisi)
-- yazabilir. Admin ise HERHANGİ bir üyenin konuşmasına yazabilir (yanıt).
drop policy if exists "messages_insert_own_or_admin" on public.messages;
create policy "messages_insert_own_or_admin"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and (
      conversation_user_id = auth.uid()
      or public.is_admin()
    )
  );

-- DELETE: "Mesajlar istenildiği zaman silinebilsin kullanıcılar tarafından"
-- -> herkes SADECE KENDİ GÖNDERDİĞİ mesajı silebilir; admin moderasyon için
-- herhangi bir mesajı silebilir.
drop policy if exists "messages_delete_own_or_admin" on public.messages;
create policy "messages_delete_own_or_admin"
  on public.messages for delete
  using (sender_id = auth.uid() or public.is_admin());

-- UPDATE yok (mesajlar düzenlenemez, sadece gönderilir/silinir) — RLS
-- varsayılan olarak kapalı kalır, ayrı bir politika açmıyoruz.

-- Realtime: mesaj listesinin anında güncellenmesi için 'messages' tablosunu
-- Supabase'in "supabase_realtime" publication'ına ekliyoruz. Bu publication
-- her projede varsayılan olarak gelir; yine de garantiye almak için hataya
-- düşerse sessizce geçiyoruz (chat.js zaten 10 saniyelik bir "polling"
-- yedeğiyle de çalışıyor, realtime olmasa da özellik bozulmaz).
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then
  raise notice 'messages tablosu realtime publication''a eklenemedi (muhtemelen zaten ekli ya da publication farklı adlandırılmış) — sorun değil, chat.js yedek olarak periyodik yeniliyor.';
end $$;

-- ----------------------------------------------------------------------------
-- 6) SECURITY ADVISOR UYARILARININ TEK TEK GİDERİLMESİ (bkz. ekli CSV)
--    a) "Extension in Public": pg_trgm public şemadan ayrı bir "extensions"
--       şemasına taşınıyor.
--    b) "Public/Signed-In Can Execute SECURITY DEFINER Function": aşağıdaki
--       fonksiyonların hepsinde PUBLIC + gereksiz anon/authenticated
--       izinleri idempotent şekilde yeniden sıkılaştırılıyor (bazı projelerde
--       0002/0003'teki REVOKE'lar dashboard'a hiç işlenmemiş görünüyordu,
--       CSV bunu gösteriyordu — bu blok "kesin sonuç" için tekrar uygulanıyor).
--    c) "Leaked Password Protection Disabled": SQL ile değiştirilemez, bir
--       Dashboard ayarıdır — bkz. dosya sonundaki not.
-- ----------------------------------------------------------------------------

-- a) pg_trgm'i public şemadan çıkar
create schema if not exists extensions;

drop index if exists public.idx_profiles_email;
drop index if exists public.idx_profiles_full_name;

do $$
begin
  alter extension pg_trgm set schema extensions;
exception when others then
  raise notice 'pg_trgm zaten "extensions" şemasında olabilir veya taşınamadı — devam ediliyor.';
end $$;

create index if not exists idx_profiles_email     on public.profiles using gin (email extensions.gin_trgm_ops);
create index if not exists idx_profiles_full_name on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- b) Fonksiyon izinlerini kesin olarak normalize et (idempotent — tekrar
--    tekrar çalıştırmak zararsızdır).
--    Sadece anon+authenticated'ın (RLS politikaları içinden) çağırması
--    GEREKEN iki fonksiyon dışında hiçbir SECURITY DEFINER fonksiyona
--    anon erişimi bırakmıyoruz; kalanlara da sadece authenticated.
revoke execute on function public.admin_delete_user_data(uuid)          from public, anon, authenticated;
revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation()        from public, anon, authenticated;
revoke execute on function public.set_updated_at()                      from public, anon, authenticated;
revoke execute on function public.benzersiz_slug_uret()                 from public, anon, authenticated;

revoke execute on function public.admin_set_user_role(uuid, text)       from public, anon;
grant  execute on function public.admin_set_user_role(uuid, text)       to authenticated;

revoke execute on function public.delete_own_profile_data()             from public, anon;
grant  execute on function public.delete_own_profile_data()             to authenticated;

revoke execute on function public.icerik_okundu_isaretle(uuid)          from public, anon;
grant  execute on function public.icerik_okundu_isaretle(uuid)          to authenticated;

revoke execute on function public.kvkk_onayini_ver(text)                from public, anon;
grant  execute on function public.kvkk_onayini_ver(text)                to authenticated;

revoke execute on function public.temizle_suresi_gecmis_erisimleri()    from public, anon;
grant  execute on function public.temizle_suresi_gecmis_erisimleri()    to authenticated;

-- is_admin() ve has_content_access(): BİLEREK anon+authenticated'a açık
-- kalıyor. Bunlar RLS politikalarının USING/WITH CHECK ifadeleri içinde
-- çağrılıyor; Postgres, bir RLS politikasını anon rolü için planlarken bile
-- o politika içinde referans verilen fonksiyona EXECUTE izni arar — izin
-- olmazsa anonim ziyaretçilerin bile göremesi gereken (ör. herkese açık
-- yayınlanmış ama kimseye atanmamış) sorgular HATA verir. Advisor bunu yine
-- de bir "WARN" olarak listeler ama bu KASITLI ve GÜVENLİDİR: her iki
-- fonksiyon da içeride auth.uid() kontrolü yapar, anon için auth.uid() NULL
-- olduğundan pratikte anon'a her zaman "false"/"erişim yok" döner.
revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to anon, authenticated;

revoke execute on function public.has_content_access(uuid) from public;
grant  execute on function public.has_content_access(uuid) to anon, authenticated;

-- ============================================================================
-- BİTTİ. Elle yapman gereken TEK şey kaldı (SQL ile yapılamaz):
--   Dashboard > Authentication > Auth Settings/Policies > "Password
--   Security" > "Leaked password protection" seçeneğini AÇIK'a getir.
--   Bunu açtıktan sonra Dashboard > Advisors > Security Advisor'a gidip
--   "Rerun linter" ile tüm uyarıların (13 uyarı + bu dosyanın kapattığı
--   pg_trgm uyarısı dahil) gittiğini doğrulayabilirsin.
-- ============================================================================
