-- ============================================================================
-- 0139_yorum_yedek_geri_yukleme_takma_ad.sql
--  1) Yorumlar, mevcut YEDEKLEME sistemine (Yedekleme & Verilerim) bağlanır — ayrı bir yedek ekranı YOK:
--     • Tam sistem yedeği (Site Sahibi, "tum")  → tüm yorumlar
--     • Seçili üyeler / Kişisel yedek ("kendi") → yalnızca ilgili üyenin yorumları
--     • Üye kendi yedeğini geri yüklerken (uye_geri_yukle_tablo): sahiplik, yazar imzası ve gizleme alanları SUNUCUDA zorlanır;
--       aynı kimlikli ya da aynı (yazı+imza+metin+tarih) yorum yeniden eklenmez → çift kayıt oluşmaz.
--  2) Takma adı istediğin zaman değiştir: yorum_takma_ad_degistir (boş değer = profil adına dön).
--  3) DÜZELTME: 0118'deki "akademik klasör/paylaşım yedek kapsamı" bloğu, `..._v0` işlevi hiç oluşturulmadığı için HİÇ çalışmıyordu;
--     burada doğru sırayla (önce yeniden adlandır, sonra sarmala) uygulanır → akademik klasörler, öğeler, eklenti tercihleri,
--     paylaşımlar ve yorumlar yedeğe girer ve üye geri yüklemesine de eklenir.
--  4) DB düzeyi koruma: yorum METNİ yalnızca yazarı (ya da Site Sahibi) tarafından değişebilir; yönetici/admin metni düzenleyemez.
-- Gereksinim: 0137, 0138. Tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- 3) Takma ad -------------------------------------------------------------------
create or replace function public.yorum_takma_ad_degistir(p_ad text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_ad text := nullif(btrim(coalesce(p_ad, '')), ''); v_profil text; n integer;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if v_ad is not null and (char_length(v_ad) < 2 or char_length(v_ad) > 40) then raise exception 'Takma ad 2–40 karakter olmalı.'; end if;
  select nullif(btrim(full_name), '') into v_profil from public.profiles where id = auth.uid();
  update public.yorumlar set gorunen_ad = coalesce(v_ad, v_profil), rumuz = v_ad is not null
   where user_id = auth.uid() and not anonim;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.yorum_takma_ad_degistir(text) from public, anon;
grant execute on function public.yorum_takma_ad_degistir(text) to authenticated;

-- 4) Yedek kapsamı: akademik (0118 düzeltmesi) + yorumlar ---------------------------
do $y$
begin
  if to_regprocedure('public.sistem_export_tablo_kayitlari_v0()') is null then
    alter function public.sistem_export_tablo_kayitlari() rename to sistem_export_tablo_kayitlari_v0;
  end if;
  create or replace function public.sistem_export_tablo_kayitlari()
  returns table (tablo text, grup text, kendi_kosul text, sadece_owner boolean, hassas boolean)
  language sql immutable as $b$
    select * from public.sistem_export_tablo_kayitlari_v0()
    union all select * from (values
      ('akademik_koleksiyonlar',      'notlar', 'user_id = auth.uid()', false, false),
      ('akademik_koleksiyon_ogeleri', 'notlar', 'user_id = auth.uid()', false, false),
      ('akademik_eklenti_ayarlari',   'notlar', 'user_id = auth.uid()', false, false),
      ('akademik_paylasimlari',       'notlar', 'user_id = auth.uid()', false, true),
      ('yorumlar',                    'veri',   'user_id = auth.uid()', false, false)
    ) as t(tablo, grup, kendi_kosul, sadece_owner, hassas)
    where not exists (select 1 from public.sistem_export_tablo_kayitlari_v0() o where o.tablo = t.tablo)
  $b$;
  revoke all on function public.sistem_export_tablo_kayitlari() from public, anon, authenticated;
  revoke all on function public.sistem_export_tablo_kayitlari_v0() from public, anon, authenticated;

  -- Üye self-servis GERİ YÜKLEME beyaz listesi
  if to_regprocedure('public._uye_geri_yukleme_tablolari()') is not null then
    if to_regprocedure('public._uye_geri_yukleme_tablolari_v0()') is null then
      alter function public._uye_geri_yukleme_tablolari() rename to _uye_geri_yukleme_tablolari_v0;
    end if;
    create or replace function public._uye_geri_yukleme_tablolari()
    returns table (tablo text, kullanici_kolonu text, anahtar_kolonu text, anahtar_deseni text)
    language sql immutable as $b$
      select * from public._uye_geri_yukleme_tablolari_v0()
      union all select * from (values
        ('akademik_koleksiyonlar',      'user_id', null::text, null::text),
        ('akademik_koleksiyon_ogeleri', 'user_id', null, null),
        ('akademik_eklenti_ayarlari',   'user_id', null, null),
        ('akademik_paylasimlari',       'user_id', null, null),
        ('yorumlar',                    'user_id', null, null)
      ) t(tablo, kullanici_kolonu, anahtar_kolonu, anahtar_deseni)
      where not exists (select 1 from public._uye_geri_yukleme_tablolari_v0() o where o.tablo = t.tablo)
    $b$;
    revoke all on function public._uye_geri_yukleme_tablolari() from public, anon, authenticated;
    revoke all on function public._uye_geri_yukleme_tablolari_v0() from public, anon, authenticated;
  end if;
end $y$;

-- 4b) Yorum eklemede kimlik ZORLAMASI (üye geri yüklemesi dahil her yol): sahiplik + imza + gizleme alanları sunucuda belirlenir.
create or replace function public._yorum_ekleme_koruma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(public.is_owner(), false) then return new; end if;   -- servis rolü / Site Sahibi tam geri yüklemesi: olduğu gibi
  new.user_id := auth.uid();
  new.author_signature_hash := public._yorum_imza(auth.uid());
  new.gizli := false; new.gizleyen := null;                                               -- yönetici kararı yedekle aşılamaz
  new.metin := btrim(new.metin);
  if exists (select 1 from public.yorumlar y where y.icerik_anahtari = new.icerik_anahtari and y.author_signature_hash = new.author_signature_hash
                and y.metin = new.metin and y.created_at = new.created_at) then
    return null;                                                                          -- aynı yorum zaten var → atla (çift kayıt yok)
  end if;
  return new;
end $$;
revoke all on function public._yorum_ekleme_koruma() from public, anon, authenticated;
drop trigger if exists yorum_ekleme_koruma on public.yorumlar;
create trigger yorum_ekleme_koruma before insert on public.yorumlar for each row execute function public._yorum_ekleme_koruma();

-- 4c) Yeni yedek bileşeni "yorumlar" (Kişisel Verilerim ▸ 💬 Yorumlarım). Dosya: veritabani/json/yorumlar.json (tam yedekle aynı yol → aynı geri yükleme).
--     Kapsam her zaman 'kendi' (üye yalnızca kendi yorumlarını alır); "veritabani" bileşeni (Site Sahibi tam / seçili üye yedeği) yorumları zaten içerir.
create or replace function public.sistem_export_baslat(
  p_bilesenler jsonb,
  p_kapsam     text default 'kendi',
  p_hassas     boolean default false,
  p_hedefler   uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_eposta text;
  v_owner  boolean := public.is_owner();
  v_tam    boolean := public.sistem_export_yetkisi_var_mi();
  v_ip     text;
  v_bas    json;
  v_hedef  uuid[] := '{}'::uuid[];
  gecerli  text[] := array['veritabani', 'r2', 'icerik_md', 'notlar', 'github', 'akademik', 'yorumlar'];
begin
  if not public.sistem_export_uye_yetkisi_var_mi() then
    raise exception 'Yetkisiz işlem: oturum geçersiz ya da hesabın askıda.';
  end if;
  if p_bilesenler is null or jsonb_typeof(p_bilesenler) <> 'array' or jsonb_array_length(p_bilesenler) = 0 then
    raise exception 'En az bir bileşen seçmelisin.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_bilesenler) b where b <> all (gecerli)) then
    raise exception 'Geçersiz bileşen.';
  end if;
  if p_kapsam not in ('kendi', 'secili', 'tum') then
    raise exception 'Geçersiz kapsam.';
  end if;
  if p_kapsam = 'tum' and not v_owner then
    raise exception 'Yetkisiz işlem: tüm sistemi yedekleme yalnızca Site Sahibi içindir.';
  end if;
  if not v_tam and exists (select 1 from jsonb_array_elements_text(p_bilesenler) b where b in ('icerik_md', 'github')) then
    raise exception 'Yetkisiz işlem: site içeriği ve GitHub bileşenleri için sistem dışa aktarma yetkisi gerekir. Kendi verilerini (veritabanı, dosyalar, notlar) indirebilirsin.';
  end if;
  if coalesce(p_hassas, false) and not (v_owner and p_kapsam = 'tum') then
    raise exception 'Yetkisiz işlem: hassas veri seçeneği yalnızca Site Sahibi''nin tam yedeğinde kullanılabilir.';
  end if;

  if p_kapsam = 'secili' then
    if not v_owner then
      raise exception 'Yetkisiz işlem: başka üyelerin verisini yalnızca Site Sahibi seçebilir.';
    end if;
    select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into v_hedef
    from public.profiles p where p.id = any (coalesce(p_hedefler, '{}'::uuid[]));
    if cardinality(v_hedef) = 0 then raise exception 'En az bir geçerli üye seçmelisin.'; end if;
    if cardinality(v_hedef) > 100 then raise exception 'Tek seferde en fazla 100 üye seçilebilir.'; end if;
    if p_bilesenler ? 'notlar' and not (auth.uid() = any (v_hedef)) then
      raise exception 'Kişisel Notlar bileşeni yalnızca kendi verilerini içerir: listeye kendini de ekle ya da bu bileşeni kaldır.';
    end if;
  end if;

  begin
    v_bas := current_setting('request.headers', true)::json;
    v_ip  := nullif(btrim(split_part(coalesce(v_bas ->> 'cf-connecting-ip', v_bas ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  select p.email into v_eposta from public.profiles p where p.id = auth.uid();

  insert into public.sistem_export_loglari
    (user_id, kullanici_eposta, indirilen_bilesenler, kapsam, hassas_dahil, ip_adresi, hedef_kullanicilar)
  values
    (auth.uid(), v_eposta, p_bilesenler, p_kapsam, coalesce(p_hassas, false), left(v_ip, 64), v_hedef)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) from public, anon;
grant execute on function public.sistem_export_baslat(jsonb, text, boolean, uuid[]) to authenticated;

create or replace function public.sistem_export_plan(l public.sistem_export_loglari)
returns table (tablo text, hedef text, kapsam text, kosul text)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select coalesce(array(select jsonb_array_elements_text(l.indirilen_bilesenler)), '{}'::text[]) as dizi
  ),
  h as (
    select '= any (' || quote_literal(l.hedef_kullanicilar::text) || '::uuid[])' as ifade
  )
  select x.tablo, x.hedef, x.kapsam,
         case when x.tablo = 'messages' and l.kapsam = 'tum' and not l.hassas_dahil then '(' || x.kosul || ') and sifreli' else x.kosul end
  from (
  select r.tablo,
         case
           when r.tablo in ('akademik_kaynaklar', 'akademik_notlar') and 'akademik' = any (b.dizi)
                and not ('veritabani' = any (b.dizi)) and not ('notlar' = any (b.dizi)) then 'akademik'
           when (r.grup = 'notlar' or r.tablo = 'e2ee_kullanici_anahtarlari') and 'notlar' = any (b.dizi)
                and not ('veritabani' = any (b.dizi)) then 'notlar'
           when r.grup = 'notlar' and not ('veritabani' = any (b.dizi)) then 'notlar'
           else 'veritabani'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'tum'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'tum'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri' then 'secili'
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'secili'
           else 'kendi'
         end,
         case
           when l.kapsam = 'tum'    and 'veritabani' = any (b.dizi) then 'true'
           when l.kapsam = 'tum'    and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%' then 'true'
           when l.kapsam = 'secili' and 'veritabani' = any (b.dizi) and r.grup = 'veri'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           when l.kapsam = 'secili' and 'akademik' = any (b.dizi) and r.tablo like 'akademik\_%'
             then replace(r.kendi_kosul, '= auth.uid()', h.ifade)
           else r.kendi_kosul
         end
  from public.sistem_export_tablo_kayitlari() r, b, h
  where to_regclass('public.' || r.tablo) is not null
    and (
      ('veritabani' = any (b.dizi) and (
          (r.grup = 'veri' and not r.sadece_owner)
          or r.grup = 'notlar'
          or (r.sadece_owner and l.kapsam = 'tum' and (not r.hassas or l.hassas_dahil))
      ))
      or ('notlar' = any (b.dizi) and (r.grup = 'notlar' or r.tablo = 'e2ee_kullanici_anahtarlari'))
      or ('akademik' = any (b.dizi) and r.tablo in ('akademik_kaynaklar', 'akademik_notlar'))
      or ('yorumlar' = any (b.dizi) and r.tablo = 'yorumlar')
    )
    and not (r.sadece_owner and l.kapsam <> 'tum')
  ) x(tablo, hedef, kapsam, kosul);
$$;
revoke all on function public.sistem_export_plan(public.sistem_export_loglari) from public, anon, authenticated;


-- 4d) Worker anahtarları (kota koruması; 0088): yeni Medya Worker'ları panelden (Yedekleme & Verilerim › Worker anahtarları) aç/kapa yapılabilir.
insert into public.worker_anahtarlari (ad, etiket, tur, korumali) values
  ('transkript-worker',      'Medya — transkript (Groq Whisper)',        'worker', false),
  ('medya-indirici-worker',  'Medya — evrensel medya indirici (Cobalt)', 'worker', false)
on conflict (ad) do update set etiket = excluded.etiket, tur = excluded.tur;

-- 5) DB düzeyi: metni yönetici/admin değiştiremez --------------------------------
create or replace function public._yorum_metin_koruma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.metin is distinct from old.metin
     and auth.uid() is not null
     and auth.uid() is distinct from old.user_id
     and not coalesce(public.is_owner(), false) then
    raise exception 'Yorum metnini yalnızca yazarı değiştirebilir.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public._yorum_metin_koruma() from public, anon, authenticated;
drop trigger if exists yorum_metin_koruma on public.yorumlar;
create trigger yorum_metin_koruma before update on public.yorumlar for each row execute function public._yorum_metin_koruma();
