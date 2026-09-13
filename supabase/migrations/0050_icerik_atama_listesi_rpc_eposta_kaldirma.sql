-- ============================================================================
-- 0050_icerik_atama_listesi_rpc_eposta_kaldirma.sql
--
-- İSTEK: "Özel İçerik Ekle/Düzenle" formundaki "Erişim Verilecek Özel
-- Üyeler / Yöneticiler" atama listesi (assets/js/admin.js -> loadUsers() /
-- renderContentAssigneeOptions()) mesajlardaki "Kime?" listesiyle (bkz.
-- migration 0030) AYNI güven seviyesinde olsun: sadece Ad Soyad + rol
-- etiketi (Yönetici / Site Sahibi / Özel Üye / Üye) göstersin, e-posta HİÇ
-- görünmesin/dönmesin — bir saldırgan ağ isteğini (DevTools > Network)
-- incelese bile e-postalara ulaşamasın.
--
-- KÖK DURUM (iki ayrı sorun):
--
--  1) E-POSTA SIZINTISI: loadUsers() doğrudan
--       .from("profiles").select("id, email, first_name, last_name,
--       full_name, role, created_at, kvkk_onay_verildi, kvkk_onay_tarihi")
--     çekiyordu. Bu sayfada üye/rol YÖNETİMİ artık yok (bkz. dosya başı
--     notu — panel/uye-ayarlari.md'ye taşındı), o yüzden email/first_name/
--     last_name/created_at/kvkk_* alanlarının hiçbirine burada gerçekte
--     ihtiyaç yoktu; sadece atama listesini doldurmak için kullanılıyordu.
--     Buna rağmen e-posta hem AĞ YANITINDA (RLS is_manager_or_admin()
--     zaten admin/manager'a tüm profilleri açtığı için sorgu başarıyla
--     dönüyordu) hem de EKRANDA satır satır parantez içinde
--     (atamaListesiCiz(): `${u.full_name || u.email} (${u.email})`)
--     gösteriliyordu.
--
--  2) SİTE SAHİBİ HİÇ GÖRÜNMÜYORDU: renderContentAssigneeOptions() listeyi
--       kullanicilar.filter(u => u.role === 'special_user' || u.role === 'admin')
--     ile filtreliyordu — 'owner' (Site Sahibi) rolü bu listede yer
--     ALMIYORDU. Bir site sahibi hesabına içerik/dosya erişimi atamak
--     isteyen bir admin, o hesabı arasa bile listede hiç bulamıyordu.
--
-- ÇÖZÜM: migration 0030'daki (mesaj_hedef_listesi_getir) İLE AYNI DESEN —
-- RLS'i bypass eden ama SADECE id/full_name/role döndüren dar kapsamlı bir
-- SECURITY DEFINER RPC. Yön mesaj hedef listesinin TERSİ (orada üye kime
-- mesaj atacağını seçiyordu, sadece admin/owner listeleniyordu; burada
-- admin/manager kime içerik atayacağını seçiyor) — bu yüzden fonksiyonun
-- kendisi role kısıtı KOYMUYOR, sistemdeki tüm hesapları (user/
-- special_user/editor/manager/admin/owner) döner; "kime GERÇEKTEN erişim
-- verilebilir" filtresi istemci tarafında (admin.js) veriliyor — bkz. o
-- dosyadaki commit notu: filtre artık 'special_user' + 'admin' + 'owner'
-- (site sahibi eklendi), sade 'user' rolü hâlâ dışarıda çünkü "özel
-- içerik" kavramının amacı zaten sıradan her üyeye değil, işaretli
-- (özel üye/yönetici/site sahibi) hesaplara erişim vermek.
--
-- YETKİ: sadece içerik atayabilen taraf (admin/manager/owner, bkz.
-- is_manager_or_admin() — migration 0032'deki son hâli owner'ı da
-- kapsıyor VE askıya alınmış hesapları hariç tutuyor) çağırabilir.
-- GRANT EXECUTE authenticated'e açık olsa bile, normal bir üye bu RPC'yi
-- doğrudan çağırırsa is_manager_or_admin() false döneceğinden WHERE
-- koşulu tüm satırları eler ve SIFIR satır alır — tıpkı migration
-- 0020/0030'daki desende olduğu gibi.
--
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp Run'a bas.
-- 0001'den 0049'a kadarki migration'lar daha önce çalıştırılmış olmalı.
-- ============================================================================

create or replace function public.icerik_atama_listesi_getir()
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where public.is_manager_or_admin()
  order by p.full_name nulls last;
$$;

comment on function public.icerik_atama_listesi_getir() is
  'Admin panelindeki "Özel İçerik Ekle/Düzenle" atama listesi için — SADECE '
  'içerik atayabilen tarafa (admin/manager/owner, is_manager_or_admin()) '
  'TÜM profillerin id/full_name/role''ünü döner, e-posta hiç dönmez (bkz. '
  'migration 0050, önceki akış e-postayı hem ağ yanıtında hem ekranda '
  'gösteriyordu). Yetkisiz (normal üye) bir çağrı sıfır satır alır.';

revoke execute on function public.icerik_atama_listesi_getir() from public, anon;
grant  execute on function public.icerik_atama_listesi_getir() to authenticated;

-- ============================================================================
-- BİTTİ. assets/js/admin.js içindeki loadUsers() artık doğrudan
-- `.from("profiles")...` yerine `supabase.rpc("icerik_atama_listesi_getir")`
-- çağırıyor; renderContentAssigneeOptions()/atamaListesiCiz() artık e-posta
-- göstermiyor, full_name + rol etiketi (Yönetici/Site Sahibi/Özel Üye/Üye)
-- gösteriyor ve filtreye 'owner' eklendi; arama kutusu ve placeholder'ı
-- artık SADECE isimle eşleşiyor (aynı migration 0030'daki e-posta kaldırma
-- sonrasında mesajlar tarafında yapılan güncellemeyle aynı desen).
-- ============================================================================
