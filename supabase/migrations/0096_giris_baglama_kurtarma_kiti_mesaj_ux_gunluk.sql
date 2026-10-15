-- ============================================================================
-- 0096_giris_baglama_kurtarma_kiti_mesaj_ux_gunluk.sql
-- Gereksinim: 0056, 0082, 0088, 0093, 0095 çalıştırılmış olmalı.
-- Supabase SQL Editor'de TEK SEFERDE çalıştır. Tekrar çalıştırmak güvenlidir (idempotent).
--
-- NE DEĞİŞİYOR
--  1) MESAJLAŞMA ANAHTARI GİRİŞ OTURUMUNA BAĞLANIR: RSA özel anahtar, Notlar'ın oturum anahtarıyla (DEK, AES-GCM) da sarılır
--     (dek_sarili_ozel_anahtar). Giriş yapınca Notlar kasası açılır → mesajlar da aynı anahtarla sessizce açılır.
--     Worker kasa sarmalı YEDEK yol olarak kalır (Google/OAuth hesapları ve kasa kilitliyken kilitlenmesinler).
--     Ayrı "Kurtarma Parolası" kutusu arayüzden kaldırıldı; eski parolası olan hesaplar için kolon yalnızca GERİYE DÖNÜK okunur.
--  2) EVRENSEL YEDEK KURTARMA KODU (Recovery Kit): XXXX-XXXX-XXXX-XXXX (80 bit). Kodun türettiği anahtar, Notlar DEK'ini + RSA özel
--     anahtarını TEK blobda sarar (kit_sarili). Blob e2ee_kullanici_anahtarlari satırında durduğu için sistem yedeğiyle birlikte taşınır.
--     Kod sunucuya GİTMEZ; sunucu yalnızca sarılı blobu görür. Farklı hesaba/altyapıya içe aktarmada istemci bu blobu açıp
--     notları + sohbetleri YENİ hesabın anahtarlarına yeniden zarflar (re-wrap).
--  3) MESAJ UX: yanıtlama (messages.yanit_id), sohbet içi mesaj sabitleme (mesaj_sabitleri), yıldızlı mesajlar (mesaj_yildizlari).
--  4) SON DEĞİŞİKLİKLER GÜNLÜĞÜ (worker_anahtar_gunlugu): Site Sahibi'ne özel satır silme + toplu temizleme.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) E2EE: DEK SARMALI + KURTARMA KİTİ KOLONLARI
-- ----------------------------------------------------------------------------
alter table public.e2ee_kullanici_anahtarlari add column if not exists dek_sarili_ozel_anahtar text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists dek_iv        text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists dek_at        timestamptz;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_sarili    text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_iv        text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_tuz       text;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_kdf_tur   integer;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_surum     smallint;
alter table public.e2ee_kullanici_anahtarlari add column if not exists kit_at        timestamptz;

-- Durum: istemci kendi satırının durumunu sorar (blob'lar zaten yalnızca kendi SELECT politikasıyla görünür).
create or replace function public.e2ee_durum()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'var', true,
      'kurtarma_var', k.kurtarma_sarili_ozel_anahtar is not null,   -- ESKİ kurtarma parolası (yalnızca geriye dönük açma)
      'kurtarma_at', k.kurtarma_at,
      'dek_var', k.dek_sarili_ozel_anahtar is not null,
      'kit_var', k.kit_sarili is not null,
      'kit_at', k.kit_at)
    from public.e2ee_kullanici_anahtarlari k where k.kullanici_id = auth.uid()
  ), jsonb_build_object('var', false, 'kurtarma_var', false, 'dek_var', false, 'kit_var', false));
$$;
revoke all on function public.e2ee_durum() from public, anon;
grant execute on function public.e2ee_durum() to authenticated;

create or replace function public.e2ee_dek_sarmali_kaydet(p_sarili text, p_iv text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 or char_length(p_sarili) > 4000 then raise exception 'Sarılı anahtar geçerli değil.'; end if;
  if p_iv is null or p_iv !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv) <> 16 then raise exception 'IV geçerli değil.'; end if;
  update public.e2ee_kullanici_anahtarlari set dek_sarili_ozel_anahtar = p_sarili, dek_iv = p_iv, dek_at = now() where kullanici_id = auth.uid();
  if not found then raise exception 'Önce şifreleme anahtarın oluşturulmalı.'; end if;
end;
$$;
revoke all on function public.e2ee_dek_sarmali_kaydet(text, text) from public, anon;
grant execute on function public.e2ee_dek_sarmali_kaydet(text, text) to authenticated;

-- Kurtarma Kiti: tek blob (Notlar DEK + RSA özel anahtar), kod-türevli anahtarla sarılı. Sunucu içeriği göremez.
create or replace function public.e2ee_kit_kaydet(p_sarili text, p_iv text, p_tuz text, p_tur integer)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if public.is_demo() then raise exception 'Demo hesabı bu işlemi yapamaz.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 100 or char_length(p_sarili) > 8000 then raise exception 'Kit verisi geçerli değil.'; end if;
  if p_iv  is null or p_iv  !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv)  <> 16 then raise exception 'IV geçerli değil.'; end if;
  if p_tuz is null or p_tuz !~ '^[A-Za-z0-9+/=]+$' or char_length(p_tuz) < 16 or char_length(p_tuz) > 64 then raise exception 'Tuz geçerli değil.'; end if;
  if p_tur is null or p_tur < 200000 or p_tur > 5000000 then raise exception 'KDF turu geçerli değil.'; end if;
  update public.e2ee_kullanici_anahtarlari
     set kit_sarili = p_sarili, kit_iv = p_iv, kit_tuz = p_tuz, kit_kdf_tur = p_tur, kit_surum = 1, kit_at = now()
   where kullanici_id = auth.uid();
  if not found then raise exception 'Önce şifreleme anahtarın oluşturulmalı; sayfayı yenileyip tekrar dene.'; end if;
end;
$$;
revoke all on function public.e2ee_kit_kaydet(text, text, text, integer) from public, anon;
grant execute on function public.e2ee_kit_kaydet(text, text, text, integer) to authenticated;

-- Kasa sarmalını yenileme: artık ESKİ kurtarma parolası YA DA Kurtarma Kiti ya da DEK sarmalı varken izin verilir
-- (sarmalı bozarak anahtarı kilitleyen bir yazma kalıcı kayıp yaratamasın).
create or replace function public.e2ee_kasa_sarmalini_yenile(p_sarili text, p_iv text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 or char_length(p_sarili) > 4000 then raise exception 'Sarılı anahtar geçerli değil.'; end if;
  if p_iv is null or p_iv !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv) <> 16 then raise exception 'IV geçerli değil.'; end if;
  update public.e2ee_kullanici_anahtarlari
     set sarili_ozel_anahtar = p_sarili, iv = p_iv, guncellendi_at = now()
   where kullanici_id = auth.uid()
     and (kurtarma_sarili_ozel_anahtar is not null or kit_sarili is not null or dek_sarili_ozel_anahtar is not null);
  if not found then raise exception 'Kurtarma yolu tanımlı değil; sarmal güncellenemez.'; end if;
end;
$$;
revoke all on function public.e2ee_kasa_sarmalini_yenile(text, text) from public, anon;
grant execute on function public.e2ee_kasa_sarmalini_yenile(text, text) to authenticated;

-- Anahtar sıfırlama (son çare): yeni RSA çifti → eski DEK sarmalı ve eski Kit ARTIK GEÇERSİZ olduğundan temizlenir.
create or replace function public.e2ee_anahtari_sifirla(p_acik text, p_sarili text, p_iv text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_z integer := 0; v_d integer := 0;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if p_acik is null or p_acik !~ '^[A-Za-z0-9+/=]+$' or char_length(p_acik) < 300 then raise exception 'Açık anahtar geçerli değil.'; end if;
  if p_sarili is null or p_sarili !~ '^[A-Za-z0-9+/=]+$' or char_length(p_sarili) < 200 then raise exception 'Sarılı anahtar geçerli değil.'; end if;
  if p_iv is null or p_iv !~ '^[A-Za-z0-9+/=]+$' or char_length(p_iv) <> 16 then raise exception 'IV geçerli değil.'; end if;
  delete from public.konusma_zarflari where user_id = auth.uid();
  get diagnostics v_z = row_count;
  if to_regclass('public.ozel_icerik_anahtarlar') is not null then
    delete from public.ozel_icerik_anahtarlar where alici_id = auth.uid();
    get diagnostics v_d = row_count;
  end if;
  insert into public.e2ee_kullanici_anahtarlari (kullanici_id, acik_anahtar, sarili_ozel_anahtar, iv)
  values (auth.uid(), p_acik, p_sarili, p_iv)
  on conflict (kullanici_id) do update
    set acik_anahtar = excluded.acik_anahtar, sarili_ozel_anahtar = excluded.sarili_ozel_anahtar, iv = excluded.iv,
        kurtarma_sarili_ozel_anahtar = null, kurtarma_iv = null, kurtarma_tuz = null, kurtarma_kdf_tur = null, kurtarma_at = null,
        dek_sarili_ozel_anahtar = null, dek_iv = null, dek_at = null,
        kit_sarili = null, kit_iv = null, kit_tuz = null, kit_kdf_tur = null, kit_surum = null, kit_at = null,
        surum = public.e2ee_kullanici_anahtarlari.surum + 1, guncellendi_at = now();
  return jsonb_build_object('silinen_sohbet_zarfi', v_z, 'silinen_dosya_anahtari', v_d);
end;
$$;
revoke all on function public.e2ee_anahtari_sifirla(text, text, text) from public, anon;
grant execute on function public.e2ee_anahtari_sifirla(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) MESAJ UX — YANIT / SABİT / YILDIZ
--    İÇERİK şifreli kalır: yanıt yalnızca hedef mesajın KİMLİĞİNİ (uuid) taşır; alıntı metni istemcide çözülmüş mesajdan çizilir.
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists yanit_id uuid references public.messages(id) on delete set null;
create index if not exists idx_messages_yanit on public.messages (yanit_id) where yanit_id is not null;

-- Yanıtlanan mesaj AYNI sohbetten olmalı (başka sohbetin mesajına işaret edilemez).
create or replace function public.mesaj_yanit_kontrol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.yanit_id is not null and not exists (
    select 1 from public.messages m where m.id = new.yanit_id and m.conversation_id = new.conversation_id
  ) then
    new.yanit_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_messages_yanit_kontrol on public.messages;
create trigger trg_messages_yanit_kontrol before insert on public.messages for each row execute function public.mesaj_yanit_kontrol();

-- Sohbet başına TEK sabit mesaj (üst çubukta görünür); sohbetin tüm tarafları görür.
create table if not exists public.mesaj_sabitleri (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  message_id      uuid not null references public.messages(id) on delete cascade,
  sabitleyen_id   uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now()
);
alter table public.mesaj_sabitleri enable row level security;
revoke all on public.mesaj_sabitleri from public, anon, authenticated;   -- okuma/yazma yalnızca RPC

create or replace function public.mesaji_sabitle(p_message_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_c uuid;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  select m.conversation_id into v_c from public.messages m where m.id = p_message_id;
  if v_c is null or not public._konusma_erisimim_var_mi(v_c) then raise exception 'Mesaj bulunamadı.'; end if;
  insert into public.mesaj_sabitleri (conversation_id, message_id, sabitleyen_id) values (v_c, p_message_id, auth.uid())
  on conflict (conversation_id) do update set message_id = excluded.message_id, sabitleyen_id = excluded.sabitleyen_id, created_at = now();
end;
$$;
revoke all on function public.mesaji_sabitle(uuid) from public, anon;
grant execute on function public.mesaji_sabitle(uuid) to authenticated;

create or replace function public.mesaj_sabitini_kaldir(p_conversation_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not public._konusma_erisimim_var_mi(p_conversation_id) then raise exception 'Sohbet bulunamadı.'; end if;
  delete from public.mesaj_sabitleri where conversation_id = p_conversation_id;
end;
$$;
revoke all on function public.mesaj_sabitini_kaldir(uuid) from public, anon;
grant execute on function public.mesaj_sabitini_kaldir(uuid) to authenticated;

create or replace function public.sohbet_sabit_mesaj(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.message_id from public.mesaj_sabitleri s
   where s.conversation_id = p_id and auth.uid() is not null and public._konusma_erisimim_var_mi(p_id);
$$;
revoke all on function public.sohbet_sabit_mesaj(uuid) from public, anon;
grant execute on function public.sohbet_sabit_mesaj(uuid) to authenticated;

-- Yıldız: KİŞİYE ÖZEL (karşı taraf görmez).
create table if not exists public.mesaj_yildizlari (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists idx_mesaj_yildizlari_konusma on public.mesaj_yildizlari (user_id, conversation_id);
alter table public.mesaj_yildizlari enable row level security;
revoke all on public.mesaj_yildizlari from public, anon, authenticated;
grant select on public.mesaj_yildizlari to authenticated;
drop policy if exists mesaj_yildiz_kendi_oku on public.mesaj_yildizlari;
create policy mesaj_yildiz_kendi_oku on public.mesaj_yildizlari for select to authenticated using (user_id = auth.uid());

create or replace function public.mesaji_yildizla(p_message_id uuid, p_yildiz boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_c uuid;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if coalesce(p_yildiz, false) then
    select m.conversation_id into v_c from public.messages m where m.id = p_message_id;
    if v_c is null or not public._konusma_erisimim_var_mi(v_c) then raise exception 'Mesaj bulunamadı.'; end if;
    insert into public.mesaj_yildizlari (user_id, message_id, conversation_id) values (auth.uid(), p_message_id, v_c) on conflict do nothing;
  else
    delete from public.mesaj_yildizlari where user_id = auth.uid() and message_id = p_message_id;
  end if;
end;
$$;
revoke all on function public.mesaji_yildizla(uuid, boolean) from public, anon;
grant execute on function public.mesaji_yildizla(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) SON DEĞİŞİKLİKLER GÜNLÜĞÜ (worker_anahtar_gunlugu) — SADECE Site Sahibi siler
-- ----------------------------------------------------------------------------
-- Dönüş türü değiştiği için (id + ozet eklendi) önce eski imza kaldırılır.
drop function if exists public.worker_anahtar_gunlugu_getir(int);
create function public.worker_anahtar_gunlugu_getir(p_adet int default 20)
returns table (id bigint, ad text, acik boolean, kullanici text, zaman timestamptz, ozet boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.sistem_export_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  return query
  select g.id, g.ad, g.acik, coalesce(nullif(btrim(p.first_name || ' ' || coalesce(p.last_name, '')), ''), p.email, '—'), g.zaman, (g.ad = 'gunluk-temizlendi')
    from public.worker_anahtar_gunlugu g
    left join public.profiles p on p.id = g.kullanici_id
   order by g.zaman desc, g.id desc
   limit greatest(1, least(coalesce(p_adet, 20), 100));
end;
$$;
revoke all on function public.worker_anahtar_gunlugu_getir(int) from public, anon;
grant execute on function public.worker_anahtar_gunlugu_getir(int) to authenticated;

-- Toplu temizlik: geriye TEK "günlük temizlendi" satırı bırakır (kim, ne zaman) — iz kaybolmasın. (Servis durumları etkilenmez.)
create or replace function public.owner_worker_gunlugunu_temizle()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_adet integer;
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501'; end if;
  if public.is_demo() then raise exception 'Demo hesabı bu işlemi yapamaz.' using errcode = '42501'; end if;
  -- WHERE'siz DELETE pg-safeupdate tarafından reddedilir (bkz. 0073): koşullu yazıldı.
  delete from public.worker_anahtar_gunlugu where id in (select k.id from public.worker_anahtar_gunlugu k);
  get diagnostics v_adet = row_count;
  insert into public.worker_anahtar_gunlugu (ad, acik, kullanici_id) values ('gunluk-temizlendi', false, auth.uid());
  return v_adet;
end;
$$;
revoke all on function public.owner_worker_gunlugunu_temizle() from public, anon;
grant execute on function public.owner_worker_gunlugunu_temizle() to authenticated;

create or replace function public.owner_worker_gunluk_satiri_sil(p_id bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz işlem: yalnızca Site Sahibi.' using errcode = '42501'; end if;
  if public.is_demo() then raise exception 'Demo hesabı bu işlemi yapamaz.' using errcode = '42501'; end if;
  delete from public.worker_anahtar_gunlugu where id = p_id;
end;
$$;
revoke all on function public.owner_worker_gunluk_satiri_sil(bigint) from public, anon;
grant execute on function public.owner_worker_gunluk_satiri_sil(bigint) to authenticated;

-- ============================================================================
-- BİTTİ.
-- ============================================================================
