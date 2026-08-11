# 11.08.2026 Düzeltmeleri — Özet

Bu dosya, bildirdiğin 5 sorun için yapılan değişikliklerin özetidir. Değişen/eklenen dosyalar:

## Değişen dosyalar
- `assets/css/auth.css`
- `assets/js/admin.js`
- `assets/js/auth-guard.js`
- `assets/js/auth-pages.js`
- `assets/js/nav-auth.js`
- `assets/js/panel.js`
- `hesap/kayit.md`
- `panel/panel.md`
- `supabase/functions/admin-change-email/index.ts`

## Eklenen dosya
- `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` ⚠️ **Bunu Supabase Dashboard > SQL Editor'de çalıştırman gerekiyor.**

---

## 1) Panelim ekranındaki "Çıkış Yap" çalışmıyordu
**Neden:** `supabase.auth.signOut()` bazı durumlarda (oturum zaten geçersiz/süresi dolmuş) hata fırlatıyordu; kodda try/catch olmadığı için hata sessizce oluşuyor ve yönlendirme (`window.location.href`) hiç çalışmıyordu.
**Çözüm:** `panel.js` ve `nav-auth.js`'deki çıkış fonksiyonlarına try/catch/finally eklendi — hata olsa bile kullanıcı artık anasayfaya yönlendiriliyor.

## 2) "Yöneticiyle Mesajlaş" butonunun yazısı görünmüyordu
**Neden:** CSS özgüllük çakışması. `assets/style.css`'teki `a:visited { color: var(--accent) }` kuralı, `.btn-primary { color:#fff }` kuralından daha yüksek özgüllüğe sahipti (pseudo-class bir class'a eşdeğerdir). Link "ziyaret edilmiş" sayılınca metin rengi tekrar mavi (`--accent`) oluyor, mavi arka plan üstünde mavi yazı görünmez hale geliyordu.
**Çözüm:** `auth.css`'te `.btn-primary:visited` ve `.btn-secondary:visited` kuralları eklendi.

## 3) Admin ile e-posta değiştirilince eski mail her yerde kalıyordu
**Neden:** `auth.users` tablosu için sadece **yeni kayıt (INSERT)** trigger'ı vardı; e-posta **güncellenince (UPDATE)** `public.profiles.email` kolonunu senkron eden hiçbir mekanizma yoktu. Admin panel, Supabase Table Editor ve kullanıcı paneli hepsi `profiles` tablosundan okuduğu için hepsi eski adresi göstermeye devam ediyordu. Ayrıca `admin-change-email` fonksiyonunun kodu ile yorumu çelişiyordu: yorumda "anında değişir" yazıyordu ama kod `email_confirm` parametresini göndermiyordu.
**Çözüm:**
- Yeni migration'da `on_auth_user_updated` trigger'ı eklendi — `auth.users.email` her değiştiğinde `profiles.email` otomatik senkronize olur.
- `admin-change-email` fonksiyonuna `email_confirm: true` eklendi (gerçekten anında, mail beklemeden değişir) ve ekstra güvence olarak `profiles.email`'i de doğrudan günceller.

## 4) Ad-Soyad her yerde otomatik güncellenmiyordu / tek alan
**Neden:** `full_name` tek parça bir metin alanıydı, ayrı Ad/Soyad yoktu.
**Çözüm:**
- Migration'da `first_name` ve `last_name` ayrı sütunlar olarak eklendi. `full_name` artık bu ikisinden **otomatik türeyen** (generated) bir alan — elle yazılamaz, her zaman güncel.
- Kayıt formu (`hesap/kayit.md`) ve Panelim profil formu (`panel/panel.md`) artık Ad ve Soyad'ı ayrı input olarak alıyor.
- Admin panelindeki kullanıcı tablosuna da Ad/Soyad için ayrı, doğrudan düzenlenebilir iki kutu eklendi (`admin.js`) — admin panelden değiştirsin ya da kullanıcı kendi panelinden değiştirsin, her ikisi de aynı `first_name`/`last_name` kolonlarını günceller, dolayısıyla her yerde anında tutarlıdır.
- `on_auth_user_updated` trigger'ı, Google hesabı ismi değişirse ve kullanıcı panelden hiç kendi ismini girmemişse bunu da senkronize eder (kullanıcı kendi ismini bir kez girdiyse üzerine yazılmaz).

## 5) Google ile girişte KVKK onayı olmadan hesap oluşuyordu
**Neden:** "Google ile Giriş Yap" akışında KVKK kontrolü OAuth **başladıktan sonra** yapılıyordu (Google'ın kendi ekranında KVKK sorulamadığı için). Kontrol `kvkk_onay_verildi = false` bulursa kod sadece `signOut()` yapıyordu — hesabı (auth.users + profiles) hiç **silmiyordu**. Bu yüzden reddedilen/tamamlanmamış girişler veritabanında kalıcı olarak "user" rolüyle kalıyordu (ekran görüntülerindeki iki hesap gibi).
**Çözüm:**
- `auth-pages.js`'e `kvkkOnaysizHesabiSilVeCikis()` fonksiyonu eklendi — artık KVKK onayı olmayan bir girişte hesap, mevcut `delete-account` Edge Function'ı üzerinden **gerçekten siliniyor**, sadece çıkış yapılmıyor.
- Migration'da, **bugüne kadar** bu şekilde birikmiş, KVKK onayı olmayan ve 1 saatten eski hesaplar (admin rolündekiler hariç) tek seferlik temizlendi.

---

## Uygulama adımları (senin yapman gerekenler)
1. **Supabase Dashboard > SQL Editor**'e git, `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` dosyasının tamamını yapıştırıp **Run**'a bas.
2. `supabase/functions/admin-change-email/index.ts` dosyasını yeniden deploy et:
   ```
   supabase functions deploy admin-change-email
   ```
3. Geri kalan tüm dosyalar (CSS/JS/HTML) statik olduğu için, siteyi her zamanki gibi yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli — ekstra bir adım gerekmiyor.

**Not:** Migration çalıştığında konsolda `NOTICE: KVKK onayı verilmemiş N adet yetim hesap silindi.` gibi bir mesaj göreceksin — bu, ekran görüntülerindeki KVKK onayı olmayan hesapların temizlendiğini doğrular.
