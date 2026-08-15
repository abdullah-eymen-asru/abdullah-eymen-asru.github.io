/*
 * assets/js/panel.js — /panel/panel.html
 * Profil görüntüleme (salt bilgi), şifre değiştirme, 2FA (TOTP) kurulumu,
 * KVKK onay durumu/yeniden onay, "Hesabımı Sil" ve kullanıcıya atanmış
 * özel içeriklerin listesi (okundu durumu + son geçerlilik tarihiyle).
 *
 * NOT: Profil fotoğrafı yükleme ve "Hakkımda" (bio) düzenleme alanları
 * BİLİNÇLİ OLARAK KALDIRILDI (Supabase Storage kullanılmaması ve site
 * genelindeki "Hakkımda" metninin sadece admin panelinden yönetilmesi
 * istendiği için). Ad Soyad hâlâ düzenlenebilir.
 */
import { supabase, showMessage, showSpamNotice, escapeHtml, turkceOtpHatasi, KVKK_METIN_SURUMU } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";
import { wireUserChat } from "./chat.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

async function init() {
  // "Çıkış Yap" HER KOŞULDA çalışmalı — panelin geri kalanında (mesajlaşma,
  // 2FA, özel içerikler...) bir hata çıksa bile. Önceden wireLogout() en
  // SONDA çağrılıyordu; aradaki adımlardan biri (throw eden) tüm init()
  // zincirini kesince wireLogout() HİÇ ÇALIŞMIYOR, buton tıklanabilir
  // görünüyor ama hiçbir dinleyicisi olmadığı için sadece href="#" native
  // davranışı (adres çubuğuna "#" eklenmesi) gerçekleşiyordu. Şimdi ilk iş
  // bu.
  wireLogout();

  const { session, profile } = await requireAuth({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  // Panelin geri kalanındaki HER bölüm birbirinden BAĞIMSIZ olarak
  // kuruluyor: biri hata verirse (ör. bir DOM elemanı beklenmedik şekilde
  // eksikse, ya da bir Supabase çağrısı beklenmeyen bir istisna fırlatırsa)
  // sadece o bölüm "Yüklenemedi" gösterir, DİĞERLERİ etkilenmez. Önceden
  // hepsi TEK BİR sıralı zincirdeydi — herhangi biri patlayınca ondan
  // sonraki HER ŞEY (Özel İçerikler, Mesajlar, Çıkış butonu dahil) sonsuza
  // kadar "Yükleniyor..." durumunda asılı kalıyordu.
  const adimlar = [
    ["profil formu", () => renderProfile(profile)],
    ["profil formu (kaydet)", () => wireProfileForm(profile)],
    ["e-posta değiştirme", () => wireEmailChange(profile)],
    ["bağlı hesaplar", () => wireBagliHesaplar()],
    ["açık oturumlar", () => wireAcikOturumlar()],
    ["şifre değiştirme", () => wirePasswordChange()],
    ["hesap silme", () => wireDeleteAccount(session, profile)],
    ["KVKK", () => wireKvkk(profile)],
    ["2FA", () => wireMfa()],
    ["özel içerikler", () => loadOzelIcerikler()],
    ["mesajlaşma", () => wireUserChat(profile)],
    ["yöneticiyle mesajlaş linki", () => wireEpostaYardimMesajLink()],
  ];

  for (const [ad, fn] of adimlar) {
    try {
      await fn();
    } catch (err) {
      console.error(`panel.js: "${ad}" bölümü başlatılamadı:`, err);
    }
  }
}

function renderProfile(profile) {
  document.getElementById("panel-email").textContent = profile.email;
  document.getElementById("panel-rol").textContent = rolEtiketi(profile.role);
  document.getElementById("first_name").value = profile.first_name ?? "";
  document.getElementById("last_name").value = profile.last_name ?? "";
  guncelleAdSoyadBasligi(profile);
}

/** Üstteki "Ad Soyad · e-posta · Rol: ... · Çıkış Yap" satırındaki ad-soyad
 * kısmını günceller. Ad/soyad hiç girilmemişse (ör. eski Google hesapları,
 * ya da kullanıcı bilerek boş bırakmışsa) e-postayla tekrar tekrar aynı
 * bilgiyi göstermemek için o kısmı tamamen gizliyoruz. */
function guncelleAdSoyadBasligi(profile) {
  const el = document.getElementById("panel-ad-soyad");
  if (!el) return;
  const adSoyad = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  el.textContent = adSoyad;
  el.hidden = !adSoyad;
}

function rolEtiketi(role) {
  // BUG FİX: bu haritada 'editor' hiç yoktu (fallback olarak ham 'editor'
  // metni görünüyordu) — 'manager' (İçerik Sorumlusu) rolü eklenirken o da
  // dahil edildi.
  return (
    { admin: "Yönetici", special_user: "Özel Üye", user: "Üye", editor: "Editör", manager: "İçerik Sorumlusu" }[
      role
    ] ?? role
  );
}

function wireProfileForm(profile) {
  const form = document.getElementById("profil-form");
  const msg = document.getElementById("profil-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const first_name = form.first_name.value.trim();
    const last_name = form.last_name.value.trim();

    const { data: guncellenen, error } = await supabase
      .from("profiles")
      .update({ first_name, last_name }) // "role" ve "full_name" kolonları burada YOK — full_name artık generated, elle yazılamaz; role trigger tarafından zaten engellenir
      .eq("id", profile.id)
      .select("id, first_name, last_name")
      .single();

    if (error) {
      showMessage(msg, "Kaydedilemedi: " + error.message);
      return;
    }
    if (!guncellenen) {
      // RLS "with check" koşulunu geçemezse ya da satır bulunamazsa
      // PostgREST bazen açık bir hata DÖNDÜRMadan 0 satır etkiler —
      // .select().single() eklememizin sebebi tam olarak bu "sessiz
      // başarısızlık" ihtimalini yakalamak: veri gerçekten dönmediyse
      // kullanıcıyı "kaydedildi" diye YANILTMIYORUZ.
      showMessage(msg, "Kaydedilemedi: değişiklik veritabanına yansımadı, lütfen tekrar dene.");
      return;
    }
    // Kaydedilen değerleri hem yerel "profile" nesnesine hem de üstteki
    // başlık satırına YANSITIYORUZ — önceden bu satır sadece sayfa ilk
    // açıldığında dolduruluyordu, kullanıcı adını değiştirip kaydedince
    // sayfayı YENİLEMEDEN üstte hâlâ eski (veya hiç) isim görünüyordu; bu,
    // "kullanıcı güncelleme yapsa da sistemde değişmiyor" izlenimine yol
    // açan görsel bir gecikmeydi (veritabanı aslında doğru güncelleniyordu).
    profile.first_name = first_name || null;
    profile.last_name = last_name || null;
    guncelleAdSoyadBasligi(profile);

    showMessage(msg, "Profil güncellendi.", "success");
  });
}

/* ---------------------------------------------------------------------- */
/* E-POSTA DEĞİŞTİR — ÇİFT ONAYLI                                          */
/* Supabase Dashboard > Authentication > Emails > "Secure email change"    */
/* AÇIK varsayılıyor: supabase.auth.updateUser({ email }) çağrıldığında    */
/* Supabase HEM eski (şu anki) HEM yeni adrese ayrı bir onay maili/kodu    */
/* gönderir; e-posta sadece İKİSİ DE onaylanınca gerçekten değişir. Bu,    */
/* hesabına izinsiz erişen birinin sessizce e-postayı ele geçirmesini      */
/* engeller — ama eski adresine erişimi olmayan kullanıcıyı KİLİTLEME      */
/* riski taşır. Bu riski azaltmak için linkin yanına "kod ile onayla"      */
/* yedek yolu ekliyoruz: her iki maildeki (link + kod aynı token'ı taşır)  */
/* kodu burada tek tek girip supabase.auth.verifyOtp({ type:               */
/* "email_change" }) ile doğrulayabilir — link açılmasa/tıklanamasa bile   */
/* değişiklik tamamlanabilir.                                              */
/* ---------------------------------------------------------------------- */
function wireEmailChange(profile) {
  const form = document.getElementById("eposta-degistir-form");
  const msg = document.getElementById("eposta-message");
  const spamNotice = document.getElementById("eposta-spam-notice");
  const onayAlani = document.getElementById("eposta-onay-alani");
  if (!form) return;

  let bekleyenYeniEposta = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const yeniEposta = form.yeni_eposta.value.trim();

    if (spamNotice) spamNotice.hidden = true;

    if (!yeniEposta) {
      showMessage(msg, "Yeni e-posta adresini gir.");
      return;
    }
    if (yeniEposta.toLowerCase() === profile.email?.toLowerCase()) {
      showMessage(msg, "Bu zaten kayıtlı e-posta adresin.");
      return;
    }

    submitBtn.disabled = true;
    // NOT: emailRedirectTo vermiyoruz — Supabase, "Secure email change"
    // açıkken linki her iki mailde de aynı token ile üretir; giriş
    // sayfasına dönüş zaten hesap/giris.md'de varsayılan olarak
    // ayarlıdır (bkz. Dashboard > URL Configuration > Redirect URLs).
    const { error } = await supabase.auth.updateUser({ email: yeniEposta });
    submitBtn.disabled = false;

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already been registered")) {
        showMessage(msg, "Bu e-posta zaten başka bir hesapta kayıtlı.");
      } else {
        showMessage(msg, "E-posta değiştirilemedi: " + error.message);
      }
      return;
    }

    bekleyenYeniEposta = yeniEposta;

    showMessage(
      msg,
      `Onay maillerini gönderdik. Değişikliğin tamamlanması için HEM eski adresine (${profile.email}) HEM de yeni adresine (${yeniEposta}) gelen linke tıklaman (veya aşağıdan kodu girmen) gerekiyor.`,
      "success"
    );
    showSpamNotice(spamNotice);
    renderEpostaOnayAlani({ eskiEposta: profile.email, yeniEposta });
    form.reset();
  });

  function renderEpostaOnayAlani({ eskiEposta, yeniEposta }) {
    if (!onayAlani) return;
    onayAlani.hidden = false;
    document.getElementById("eposta-onay-eski-adres").textContent = eskiEposta;
    document.getElementById("eposta-onay-yeni-adres").textContent = yeniEposta;
    // Yeni bir istek atıldığında önceki denemeden kalan "onaylandı"
    // rozetlerini/kapalı formları sıfırlıyoruz.
    epostaOnayDurumGuncelle("eski", false);
    epostaOnayDurumGuncelle("yeni", false);
    onayAlani.querySelectorAll(".eposta-onay-kod-form").forEach((f) => (f.hidden = true));
  }

  function epostaOnayDurumGuncelle(hedef, onaylandi) {
    const rozet = document.getElementById(`eposta-onay-${hedef}-durum`);
    if (!rozet) return;
    rozet.textContent = onaylandi ? "✓ Onaylandı" : "Bekleniyor";
    rozet.classList.toggle("eposta-onay-rozet--ok", onaylandi);
  }

  onayAlani?.querySelectorAll(".eposta-onay-kod-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hedef = btn.dataset.hedef;
      const kodForm = onayAlani.querySelector(`.eposta-onay-kod-form[data-hedef="${hedef}"]`);
      if (kodForm) kodForm.hidden = !kodForm.hidden;
    });
  });

  onayAlani?.querySelectorAll(".eposta-onay-kod-form").forEach((kodForm) => {
    kodForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const hedef = kodForm.dataset.hedef;
      const input = kodForm.querySelector("input");
      const kod = input.value.trim();
      const submitBtn = kodForm.querySelector('button[type="submit"]');
      // Kodun hangi adrese gönderildiğini verifyOtp'a söylememiz gerekiyor:
      // eski adres için mevcut (henüz değişmemiş) e-posta, yeni adres için
      // kullanıcının az önce girdiği adres.
      const dogrulanacakEposta = hedef === "eski" ? profile.email : bekleyenYeniEposta;

      if (!dogrulanacakEposta) {
        showMessage(msg, "Önce yukarıdan yeni e-posta isteği göndermelisin.");
        return;
      }
      if (!kod) return;

      submitBtn.disabled = true;
      // type: "email_change" → e-posta değiştirme akışı için üretilen kod.
      // Hem eski hem yeni adrese giden linkler/kodlar bu tiptedir; hangi
      // adrese ait olduğunu "email" parametresiyle belirtiyoruz.
      const { error } = await supabase.auth.verifyOtp({
        email: dogrulanacakEposta,
        token: kod,
        type: "email_change",
      });
      submitBtn.disabled = false;

      if (error) {
        showMessage(msg, "Kod doğrulanamadı: " + turkceOtpHatasi(error.message));
        return;
      }

      epostaOnayDurumGuncelle(hedef, true);
      kodForm.hidden = true;

      // İki onaydan biri tamamlandı — ama e-posta SADECE ikisi de
      // onaylanınca gerçekten değişir ("Secure email change"). Bunu
      // varsayımla değil, auth.users'tan taze getUser() ile KONTROL
      // ediyoruz: dönen e-posta hâlâ eskiyse değişiklik henüz tamamlanmamış
      // demektir (diğer adresin onayı bekleniyor).
      const {
        data: { user: guncelUser },
      } = await supabase.auth.getUser();

      if (guncelUser?.email && guncelUser.email.toLowerCase() !== profile.email.toLowerCase()) {
        const eskiEposta = profile.email;
        profile.email = guncelUser.email;
        document.getElementById("panel-email").textContent = profile.email;
        onayAlani.hidden = true;

        // Güvenlik: e-posta değişikliği TAMAMLANINCA (her iki adres de
        // onaylanınca) bu tarayıcı DIŞINDAKİ tüm diğer cihaz/oturumlardan
        // otomatik çıkış yapılır — hesabına izinsiz erişen biri varsa
        // e-posta değişir değişmez erişimi kesilir. Bu tarayıcıdaki oturum
        // etkilenmez.
        const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
        if (signOutError) console.error("Diğer oturumlardan çıkış yapılamadı:", signOutError);

        showMessage(
          msg,
          `E-posta değişikliği tamamlandı (${eskiEposta} → ${profile.email}). Diğer cihazlardaki oturumların güvenlik amacıyla kapatıldı.`,
          "success"
        );
        return;
      }

      showMessage(
        msg,
        "Kod doğrulandı. Diğer adrese gelen linke/koda da onay verince değişiklik tamamlanacak.",
        "success"
      );
    });
  });
}

function wirePasswordChange() {
  const form = document.getElementById("sifre-degistir-form");
  const msg = document.getElementById("sifre-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const yeniSifre = form.yeni_sifre.value;
    const yeniSifreTekrar = form.yeni_sifre_tekrar.value;

    if (yeniSifre !== yeniSifreTekrar) {
      showMessage(msg, "Yeni şifreler eşleşmiyor.");
      return;
    }
    if (yeniSifre.length < 8) {
      showMessage(msg, "Şifre en az 8 karakter olmalı.");
      return;
    }

    submitBtn.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: yeniSifre });
    submitBtn.disabled = false;

    if (error) {
      showMessage(msg, "Şifre değiştirilemedi: " + error.message);
      return;
    }

    // Sadece Google ile kayıtlı bir hesapta (hiç "email" kimliği yokken) ilk
    // kez şifre belirleniyor olabilir — Supabase bu durumda auth.identities'e
    // otomatik bir "email" satırı EKLEMEZ (bilinen bir davranış), bu da
    // ileride "Bağlı Hesaplar" bölümünden Google bağlantısını kesmeyi imkansız
    // kılar. Eksik kimliği burada RPC ile tamamlıyoruz (bkz. migration 0010).
    // Zaten bir "email" kimliği varsa (ör. sıradan şifre değişikliği) RPC
    // sessizce hiçbir şey yapmadan döner.
    try {
      await supabase.rpc("kullanici_email_identity_ekle");
    } catch (rpcErr) {
      console.error("email identity RPC hatası (şifre yine de değişti):", rpcErr);
    }

    // Güvenlik: şifre değişince bu tarayıcı DIŞINDAKİ tüm diğer
    // cihaz/oturumlardan otomatik çıkış yapılır (scope: "others"). Böylece
    // biri hesabı ele geçirmişse şifre değiştirilir değiştirilmez erişimi
    // kesilir. Bu tarayıcıdaki oturum etkilenmez.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) console.error("Diğer oturumlardan çıkış yapılamadı:", signOutError);

    showMessage(msg, "Şifre değiştirildi. Diğer cihazlardaki oturumların kapatıldı.", "success");
    form.reset();
    // "Bağlı Hesaplar" bölümündeki "E-posta + Şifre: ayarlı" rozeti ve
    // Google "Bağlantıyı Kes" butonunun görünürlüğü, artık şifre var
    // olduğuna göre güncellensin.
    renderBagliHesaplar();
  });
}

/* ---------------------------------------------------------------------- */
/* BAĞLI HESAPLAR — Google hesabını sonradan bağlama / bağlantı kesme      */
/* ---------------------------------------------------------------------- */
/*
 * Supabase Auth, aynı (onaylı) e-postayla gelen Google girişini otomatik
 * olarak mevcut hesaba bağlar (bkz. auth-pages.js) — bu yüzden "Google ile
 * kayıt" ve "e-posta ile kayıt" hiçbir zaman İKİ AYRI hesap oluşturmaz.
 * Burası, kullanıcının GİRİŞ YAPMIŞKEN, bu iki kimliği kendi isteğiyle
 * manuel olarak bağlayıp/koparabildiği yer:
 *
 *   - Google bağlı DEĞİLSE  -> "Google Hesabını Bağla" (linkIdentity)
 *   - Google bağlıYSA       -> "Bağlantıyı Kes" (unlinkIdentity) — ama
 *     Supabase en az 1 kimlik kalmasını zorunlu kıldığı için, kullanıcının
 *     ÖNCE bir e-posta+şifre kimliği olması gerekir (aksi hâlde Google'ı
 *     koparınca hesabına girecek hiçbir yolu kalmaz). "E-posta + Şifre"
 *     satırı bu yüzden burada salt bilgi amaçlı: gerçek şifre belirleme
 *     işlemi aşağıdaki "Şifre Değiştir" formundan yapılır.
 *
 * NOT: linkIdentity()/unlinkIdentity() çalışabilmesi için Supabase
 * Dashboard > Authentication > Settings'te "Allow manual linking"in AÇIK
 * olması gerekir (bkz. migration 0010'daki not).
 */
async function wireBagliHesaplar() {
  await renderBagliHesaplar();
}

async function renderBagliHesaplar() {
  const box = document.getElementById("bagli-hesaplar-durum");
  const msg = document.getElementById("bagli-hesaplar-message");
  if (!box) return;

  box.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) {
    box.innerHTML = `<p class="muted">Bağlı hesaplar yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const identities = data?.identities ?? [];
  const google = identities.find((i) => i.provider === "google");
  const eposta = identities.find((i) => i.provider === "email");

  box.innerHTML = `
    <div class="bagli-hesap-satir">
      <span>
        <strong>Google</strong> ·
        ${google ? '<span class="eposta-onay-rozet eposta-onay-rozet--ok">Bağlı</span>' : '<span class="eposta-onay-rozet">Bağlı değil</span>'}
      </span>
      ${
        google
          ? `<button type="button" id="google-baglanti-kes-btn" class="btn-secondary tablo-aksiyon-btn">Bağlantıyı Kes</button>`
          : `<button type="button" id="google-bagla-btn" class="btn-secondary tablo-aksiyon-btn">Google Hesabını Bağla</button>`
      }
    </div>
    <div class="bagli-hesap-satir">
      <span>
        <strong>E-posta + Şifre</strong> ·
        ${eposta ? '<span class="eposta-onay-rozet eposta-onay-rozet--ok">Ayarlı</span>' : '<span class="eposta-onay-rozet">Henüz ayarlanmadı</span>'}
      </span>
    </div>
    ${
      !eposta
        ? `<p class="muted" style="font-size:0.85rem; margin-top:8px;">Aşağıdaki "Şifre Değiştir" bölümünden bir şifre belirlersen e-posta + şifre ile de giriş yapabilir hâle gelirsin — Google bağlantını ileride kesmek istersen bu gerekli.</p>`
        : ""
    }
  `;

  document.getElementById("google-bagla-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: linkErr } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/panel/panel.html` },
    });
    if (linkErr) {
      btn.disabled = false;
      showMessage(msg, "Google hesabı bağlanamadı: " + linkErr.message);
    }
    // Başarılıysa tarayıcı Google'a yönlendirilir; dönüşte panel yeniden
    // yüklenir ve bu bölüm güncel durumu otomatik gösterir.
  });

  document.getElementById("google-baglanti-kes-btn")?.addEventListener("click", async () => {
    if (!eposta) {
      showMessage(
        msg,
        'Google bağlantısını kesmeden önce aşağıdaki "Şifre Değiştir" bölümünden bir şifre belirlemen gerekiyor — aksi hâlde hesabına giriş yapabileceğin hiçbir yol kalmaz.'
      );
      return;
    }
    const emin = window.confirm(
      "Google hesabı bağlantısını kesmek istediğine emin misin? Bundan sonra sadece kendi belirlediğin e-posta + şifreyle giriş yapabileceksin."
    );
    if (!emin) return;

    const { error: unlinkErr } = await supabase.auth.unlinkIdentity(google);
    if (unlinkErr) {
      if (unlinkErr.message?.includes("single_identity_not_deletable")) {
        showMessage(msg, "Bağlantı kesilemedi: önce bir şifre belirlemen gerekiyor.");
      } else {
        showMessage(msg, "Bağlantı kesilemedi: " + unlinkErr.message);
      }
      return;
    }
    showMessage(msg, "Google bağlantısı kesildi. Bundan sonra e-posta + şifreyle giriş yapabilirsin.", "success");
    await renderBagliHesaplar();
  });
}

/* ---------------------------------------------------------------------- */
/* AÇIK OTURUMLAR — hangi cihazlarda oturum açık, tek tek kapatabilme      */
/* ---------------------------------------------------------------------- */
/*
 * Supabase JS SDK'sı sadece İÇİNDE BULUNULAN oturumu döner; tüm cihazları
 * görmek için sunucu tarafındaki auth.sessions tablosuna bakan iki RPC
 * kullanıyoruz (bkz. migration 0011): oturumlarimi_listele() ve
 * oturum_sonlandir(id). "Bu cihaz" etiketini bulmak için mevcut access
 * token'ın (JWT) içindeki "session_id" claim'i çözümleniyor — bu, GoTrue'nun
 * auth.sessions.id ile eşleştirdiği resmî yöntem.
 */

// JWT'nin ortadaki (payload) bölümünü çözüp içinden "session_id" claim'ini
// çıkarır. JWT formatı bozuksa/beklenmedikse sessizce null döner — bu satır
// olmadan da "Bu cihaz" rozeti görünmez, kritik bir işlev değil.
function mevcutOturumIdCikar(accessToken) {
  try {
    const payloadB64 = accessToken.split(".")[1];
    const payloadJson = decodeURIComponent(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(payloadJson)?.session_id ?? null;
  } catch {
    return null;
  }
}

// user_agent metninden kabaca "Chrome · Windows" gibi okunabilir bir etiket
// çıkarır. Kesin bir cihaz tespiti değil, sadece listede ayırt edici bir
// ipucu — GoTrue bu alanı oturum İLK açıldığında bir kez kaydeder.
function cihazEtiketiCikar(userAgent) {
  if (!userAgent) return "Bilinmeyen cihaz";
  const ua = userAgent;
  let tarayici = "Bilinmeyen tarayıcı";
  if (/Edg\//.test(ua)) tarayici = "Edge";
  else if (/OPR\/|Opera/.test(ua)) tarayici = "Opera";
  else if (/Chrome\//.test(ua)) tarayici = "Chrome";
  else if (/Firefox\//.test(ua)) tarayici = "Firefox";
  else if (/Safari\//.test(ua)) tarayici = "Safari";

  let cihaz = "Bilgisayar";
  if (/iPhone/.test(ua)) cihaz = "iPhone";
  else if (/iPad/.test(ua)) cihaz = "iPad";
  else if (/Android/.test(ua)) cihaz = "Android";
  else if (/Macintosh/.test(ua)) cihaz = "Mac";
  else if (/Windows/.test(ua)) cihaz = "Windows";
  else if (/Linux/.test(ua)) cihaz = "Linux";

  return `${tarayici} · ${cihaz}`;
}

function tarihFormatla(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

async function wireAcikOturumlar() {
  await renderAcikOturumlar();
}

async function renderAcikOturumlar() {
  const box = document.getElementById("acik-oturumlar-durum");
  const msg = document.getElementById("acik-oturumlar-message");
  if (!box) return;

  box.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const [{ data: sessionData }, { data: oturumlar, error }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.rpc("oturumlarimi_listele"),
  ]);

  if (error) {
    box.innerHTML = `<p class="muted">Açık oturumlar yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const mevcutId = sessionData?.session?.access_token
    ? mevcutOturumIdCikar(sessionData.session.access_token)
    : null;

  if (!oturumlar || oturumlar.length === 0) {
    box.innerHTML = `<p class="muted">Açık oturum bulunamadı.</p>`;
    return;
  }

  box.innerHTML = oturumlar
    .map((o) => {
      const buCihaz = o.id === mevcutId;
      return `
        <div class="bagli-hesap-satir">
          <span>
            <strong>${escapeHtml(cihazEtiketiCikar(o.user_agent))}</strong>
            ${buCihaz ? '<span class="eposta-onay-rozet eposta-onay-rozet--ok">Bu cihaz</span>' : ""}
            <br>
            <span class="muted" style="font-size:0.85rem;">
              Son aktivite: ${tarihFormatla(o.guncellenme || o.olusturulma)}
              ${o.ip ? " · " + escapeHtml(o.ip) : ""}
            </span>
          </span>
          <button type="button" class="btn-secondary tablo-aksiyon-btn oturum-sonlandir-btn" data-id="${escapeHtml(o.id)}" data-bu-cihaz="${buCihaz ? "1" : "0"}">
            Çıkış Yap
          </button>
        </div>`;
    })
    .join("");

  box.querySelectorAll(".oturum-sonlandir-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const buCihaz = btn.dataset.buCihaz === "1";
      const oturumId = btn.dataset.id;

      const emin = window.confirm(
        buCihaz
          ? "Bu, ŞU AN kullandığın cihaz. Çıkış yaparsan buradan da atılırsın, devam edeyim mi?"
          : "Bu cihazdaki oturumu kapatmak istediğine emin misin?"
      );
      if (!emin) return;

      btn.disabled = true;
      const { error: sonlandirErr } = await supabase.rpc("oturum_sonlandir", { p_session_id: oturumId });

      if (sonlandirErr) {
        btn.disabled = false;
        showMessage(msg, "Oturum sonlandırılamadı: " + sonlandirErr.message);
        return;
      }

      if (buCihaz) {
        // Sunucudaki oturum zaten silindi; bu tarayıcıdaki yerel oturumu
        // (localStorage'daki token) da temizleyip giriş sayfasına dönüyoruz.
        await supabase.auth.signOut({ scope: "local" });
        window.location.href = "/hesap/giris.html";
        return;
      }

      showMessage(msg, "Oturum kapatıldı.", "success");
      await renderAcikOturumlar();
    });
  });
}

/* ---------------------------------------------------------------------- */
/* KVKK ONAYI                                                             */
/* ---------------------------------------------------------------------- */
function wireKvkk(profile) {
  const box = document.getElementById("kvkk-durum");
  if (!box) return;

  const guncelMi = profile.kvkk_onay_verildi && profile.kvkk_onay_versiyonu === KVKK_METIN_SURUMU;

  if (guncelMi) {
    box.innerHTML = `
      <p class="auth-message auth-message--success" style="position:static;">
        ✓ KVKK Aydınlatma Metni ve Açık Rıza onayını verdin
        (${new Date(profile.kvkk_onay_tarihi).toLocaleDateString("tr-TR")}).
      </p>`;
    return;
  }

  box.innerHTML = `
    <p class="auth-message auth-message--error" style="position:static;">
      ${profile.kvkk_onay_verildi ? "Gizlilik politikası/KVKK metni güncellendi, lütfen yeniden onayla." : "Henüz KVKK onayı vermemişsin."}
    </p>
    <label style="display:flex; gap:8px; align-items:flex-start; margin:10px 0;">
      <input type="checkbox" id="kvkk-checkbox" style="margin-top:3px;">
      <span>
        <a href="/kurumsal/gizlilik-politikasi.html" target="_blank">KVKK Aydınlatma Metni ve Gizlilik Politikası</a>'nı
        okudum, kişisel verilerimin belirtilen şekilde işlenmesine açık rıza gösteriyorum.
      </span>
    </label>
    <button id="kvkk-onayla-btn" type="button" class="btn-primary" style="width:auto;">Onayla</button>`;

  document.getElementById("kvkk-onayla-btn").addEventListener("click", async () => {
    const checked = document.getElementById("kvkk-checkbox").checked;
    if (!checked) {
      showMessage(box.querySelector(".auth-message") || box, "Devam etmek için kutuyu işaretlemelisin.");
      return;
    }
    const { error } = await supabase.rpc("kvkk_onayini_ver", { p_versiyon: KVKK_METIN_SURUMU });
    if (error) {
      alert("Onay kaydedilemedi: " + error.message);
      return;
    }
    // İYİLEŞTİRME: optimistik (yerel) güncelleme yerine profili VERİTABANINDAN
    // yeniden çekiyoruz — "onayladım ama her yerde onaylı görünmüyor"
    // şikayetinin bir sebebi, yazma işlemi sessizce başarısız olsa bile
    // (ör. oturum/RLS kenar durumu) arayüzün hep "başarılı" göstermesiydi.
    // Artık gerçek DB durumunu okuyup ona göre çiziyoruz.
    const { data: guncelProfil, error: fetchErr } = await supabase
      .from("profiles")
      .select("kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi")
      .eq("id", profile.id)
      .single();
    if (!fetchErr && guncelProfil) {
      Object.assign(profile, guncelProfil);
    } else {
      profile.kvkk_onay_verildi = true;
      profile.kvkk_onay_versiyonu = KVKK_METIN_SURUMU;
      profile.kvkk_onay_tarihi = new Date().toISOString();
    }
    wireKvkk(profile);
  });
}

/* ---------------------------------------------------------------------- */
/* 2FA (TOTP) — Supabase Auth yerleşik MFA API'si                         */
/* ---------------------------------------------------------------------- */
async function wireMfa() {
  const box = document.getElementById("mfa-alani");
  if (!box) return;

  await renderMfaDurumu(box);
}

async function renderMfaDurumu(box) {
  box.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    box.innerHTML = `<p class="muted">2FA durumu okunamadı: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const dogrulanmisFactors = (data.totp || []).filter((f) => f.status === "verified");

  if (dogrulanmisFactors.length > 0) {
    box.innerHTML = `
      <p class="auth-message auth-message--success" style="position:static;">
        ✓ İki faktörlü doğrulama (2FA) aktif.
      </p>
      <button id="mfa-kaldir-btn" type="button" class="btn-danger" style="width:auto;">2FA'yı Kaldır</button>
      <div id="mfa-message" class="auth-message" hidden></div>
      <div id="yedek-kod-alani" style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
        <p class="muted">Yükleniyor...</p>
      </div>`;

    document.getElementById("mfa-kaldir-btn").addEventListener("click", async () => {
      if (!confirm("2FA'yı kaldırmak istediğine emin misin? Hesabın tekrar sadece şifreyle korunacak.")) return;
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: dogrulanmisFactors[0].id,
      });
      const msg = document.getElementById("mfa-message");
      if (unenrollErr) {
        showMessage(msg, "Kaldırılamadı: " + unenrollErr.message);
        return;
      }
      // 2FA kapandığına göre eski yedek kodların artık bir anlamı yok —
      // best-effort temizlik (başarısız olsa da 2FA kaldırma işlemini
      // engellemesin diye hatası yutuluyor).
      try {
        await supabase.rpc("yedek_kodlar_temizle");
      } catch (_e) {
        /* önemsiz — kodlar zaten faktörsüz işe yaramaz */
      }
      await renderMfaDurumu(box);
    });

    await renderYedekKodDurumu(document.getElementById("yedek-kod-alani"));
    return;
  }

  box.innerHTML = `
    <p class="muted">
      2FA aktif değil. Google Authenticator, Authy veya benzeri bir uygulamayla
      QR kodu okutarak hesabını ekstra korumaya alabilirsin.
    </p>
    <button id="mfa-baslat-btn" type="button" class="btn-primary" style="width:auto;">2FA'yı Etkinleştir</button>
    <div id="mfa-kurulum-alani" hidden style="margin-top:16px;">
      <div id="mfa-qr-wrap" style="margin-bottom:12px;"></div>
      <p class="muted" style="font-size:0.85rem;">
        QR kodu okutamıyorsan bu kodu uygulamana elle girebilirsin:
        <code id="mfa-secret" style="user-select:all;"></code>
      </p>
      <div class="form-field">
        <label for="mfa-kod-input">Uygulamada görünen 6 haneli kodu gir</label>
        <input id="mfa-kod-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
      </div>
      <button id="mfa-dogrula-btn" type="button" class="btn-primary" style="width:auto;">Doğrula ve Etkinleştir</button>
    </div>
    <div id="mfa-message" class="auth-message" hidden></div>`;

  document.getElementById("mfa-baslat-btn").addEventListener("click", async () => {
    const msg = document.getElementById("mfa-message");
    const baslatBtn = document.getElementById("mfa-baslat-btn");
    baslatBtn.disabled = true;

    try {
      const enrollData = await mfaBaslatTemizVeTekrarDene();
      if (!enrollData) {
        showMessage(msg, "2FA başlatılamadı, lütfen sayfayı yenileyip tekrar dene.");
        baslatBtn.disabled = false;
        return;
      }

      document.getElementById("mfa-kurulum-alani").hidden = false;
      document.getElementById("mfa-baslat-btn").hidden = true;

      // BUG FİX: enrollData.totp.qr_code bir data-URI SVG string'idir ve
      // İÇİNDE ÇOK SAYIDA çift tırnak (") karakteri barındırır (SVG
      // özniteliklerinin kendi tırnakları). Bunu `<img src="${...}">`
      // şeklinde bir HTML string'ine gömmek, o iç tırnaklardan biri src
      // özniteliğini ERKEN kapatıp geri kalanının (alt=... style=...) düz
      // METİN olarak sayfada görünmesine yol açıyordu (ekran görüntüsündeki
      // "bozuk yazı" tam olarak buydu). Çözüm: img elemanını innerHTML
      // string birleştirmesiyle DEĞİL, DOM API'siyle oluşturup src'yi bir
      // JS ÖZELLİĞİ (property) olarak atamak — bu şekilde tırnak/HTML
      // özel karakterleri hiç parse edilmez, olduğu gibi kullanılır.
      const qrWrap = document.getElementById("mfa-qr-wrap");
      qrWrap.innerHTML = "";
      const img = document.createElement("img");
      img.src = enrollData.totp.qr_code;
      img.alt = "2FA QR kodu";
      img.style.background = "#fff";
      img.style.padding = "8px";
      img.style.borderRadius = "8px";
      img.style.maxWidth = "220px";
      qrWrap.appendChild(img);

      document.getElementById("mfa-secret").textContent = enrollData.totp.secret;
      mfaDogrulamayiBagla(enrollData, msg, box);
    } catch (err) {
      showMessage(msg, "Başlatılamadı: " + err.message);
      baslatBtn.disabled = false;
    }
  });
}

/**
 * BUG FİX: "A factor with the friendly name "" for this user already
 * exists" hatası — kullanıcı 2FA kurulumunu yarıda bırakıp (QR'ı okutmadan
 * sayfadan ayrılıp) tekrar denediğinde, önceki denemeden kalan
 * DOĞRULANMAMIŞ ("unverified") kayıt, aynı (boş) friendly name ile
 * çakışıyordu. Eski kod bu temizliği deniyordu ama (a) unenroll'un kendi
 * hatasını YOK SAYIYORDU (silme başarısız olsa bile fark edilmiyordu) ve
 * (b) her seferinde AYNI (boş) friendly name ile enroll ediyordu, yani
 * temizlik bir sebeple başarısız olursa çakışma KESİN tekrarlıyordu.
 * Burada: 1) tüm eski "unverified" kayıtları silmeyi DENE (hata olsa bile
 * devam et), 2) HER ZAMAN benzersiz bir friendly name kullan (aynı isimle
 * çakışma ihtimalini baştan ortadan kaldırır), 3) yine de "already exists"
 * hatası gelirse bir kez daha agresif temizlik yapıp TEKRAR dene.
 */
async function mfaBaslatTemizVeTekrarDene() {
  async function eskiKayitlariTemizle() {
    const { data: factorList } = await supabase.auth.mfa.listFactors();
    const factors = factorList?.totp || factorList?.all || [];
    for (const factor of factors) {
      if (factor.status === "unverified") {
        try {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        } catch (_e) {
          // Sessizce geç — aşağıdaki benzersiz friendly name zaten
          // çakışmayı büyük ölçüde engelliyor, bu sadece ek bir temizlik.
        }
      }
    }
  }

  function benzersizIsim() {
    return `totp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  await eskiKayitlariTemizle();

  let { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: benzersizIsim(),
  });

  if (enrollErr && /already exists/i.test(enrollErr.message)) {
    // Bir kez daha, daha agresif temizlik + yeni bir isimle tekrar dene.
    await eskiKayitlariTemizle();
    const tekrar = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: benzersizIsim(),
    });
    enrollData = tekrar.data;
    enrollErr = tekrar.error;
  }

  if (enrollErr) throw enrollErr;
  return enrollData;
}

function mfaDogrulamayiBagla(enrollData, msg, box) {

    document.getElementById("mfa-dogrula-btn").addEventListener("click", async () => {
      const kod = document.getElementById("mfa-kod-input").value.trim();
      if (!/^\d{6}$/.test(kod)) {
        showMessage(msg, "6 haneli kodu eksiksiz gir.");
        return;
      }

      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId: enrollData.id,
      });
      if (challengeErr) {
        showMessage(msg, "Doğrulama başlatılamadı: " + challengeErr.message);
        return;
      }

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrollData.id,
        challengeId: challengeData.id,
        code: kod,
      });
      if (verifyErr) {
        showMessage(msg, "Kod hatalı veya süresi doldu: " + verifyErr.message);
        return;
      }

      showMessage(msg, "2FA başarıyla etkinleştirildi.", "success");

      // 2FA yeni etkinleştirildi -> hemen yedek/kurtarma kodları üret ve
      // göster. Bu kodlar SADECE ŞİMDİ, bir kereliğine dönüyor (düz metin
      // hiçbir yerde saklanmıyor) — kullanıcı authenticator uygulamasına
      // erişimini kaybederse (telefon değişimi, uygulama silinmesi vb.)
      // hesabına bu kodlarla geri dönebilsin diye.
      const { data: kodlar, error: kodErr } = await supabase.rpc("yedek_kodlar_olustur");
      if (kodErr || !Array.isArray(kodlar) || kodlar.length === 0) {
        // Kritik değil — 2FA zaten aktifleşti, kullanıcı panelden
        // "Yeni Yedek Kodlar Oluştur" ile daha sonra da üretebilir.
        console.error("Yedek kodlar oluşturulamadı:", kodErr);
        await renderMfaDurumu(box);
        return;
      }
      box.innerHTML = `
        <p class="auth-message auth-message--success" style="position:static;">
          ✓ İki faktörlü doğrulama (2FA) aktif.
        </p>
        <div id="yedek-kod-goster-alani"></div>`;
      yedekKodlariGosterVeIndir(
        document.getElementById("yedek-kod-goster-alani"),
        kodlar,
        () => renderMfaDurumu(box)
      );
    });
}

/* ---------------------------------------------------------------------- */
/* 2FA YEDEK/KURTARMA KODLARI                                              */
/* Authenticator uygulamasına erişim kaybedilirse (telefon değişimi,       */
/* uygulama silinmesi vb.) diye TEK SEFERLİK kullanılabilen yedek kodlar.  */
/* Düz metin kodlar SADECE üretildikleri an (yedek_kodlar_olustur RPC'si   */
/* dönüşünde) görünür; veritabanında yalnızca SHA-256 hash'leri tutulur    */
/* (bkz. supabase/migrations/0017_2fa_yedek_kodlar.sql).                   */
/* ---------------------------------------------------------------------- */

/** Aktif-2FA görünümündeki "Yedek Kodlar" alt bölümü: kalan/toplam kod
 * sayısını gösterir ve (yeniden) oluşturma butonunu bağlar. */
async function renderYedekKodDurumu(alan) {
  if (!alan) return;
  alan.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const { data, error } = await supabase.rpc("yedek_kod_durumu");
  const durum = Array.isArray(data) ? data[0] : data;
  const kalan = !error && durum ? durum.kalan : 0;
  const toplam = !error && durum ? durum.toplam : 0;

  const durumMetni =
    toplam === 0
      ? "Henüz yedek kod oluşturmadın."
      : `${kalan} / ${toplam} yedek kod kullanılabilir.`;

  alan.innerHTML = `
    <h3 style="margin:0 0 6px; font-size:1rem;">Yedek Kodlar</h3>
    <p class="muted" style="margin-top:0;">
      Authenticator uygulamana erişimini kaybedersen (telefon değişimi,
      uygulama silinmesi vb.) hesabına girmeni sağlar. ${escapeHtml(durumMetni)}
    </p>
    <button id="yedek-kod-olustur-btn" type="button" class="btn-secondary" style="width:auto;">
      ${toplam === 0 ? "Yedek Kodları Oluştur" : "Yeni Yedek Kodlar Oluştur"}
    </button>
    <div id="yedek-kod-durum-message" class="auth-message" hidden></div>
    <div id="yedek-kod-goster-alani" style="margin-top:12px;"></div>`;

  document.getElementById("yedek-kod-olustur-btn").addEventListener("click", async () => {
    if (
      toplam > 0 &&
      !confirm("Yeni kodlar oluşturmak MEVCUT tüm yedek kodlarını geçersiz kılar. Devam edilsin mi?")
    ) {
      return;
    }
    const btn = document.getElementById("yedek-kod-olustur-btn");
    const msg = document.getElementById("yedek-kod-durum-message");
    btn.disabled = true;

    const { data: kodlar, error: kodErr } = await supabase.rpc("yedek_kodlar_olustur");
    btn.disabled = false;

    if (kodErr || !Array.isArray(kodlar) || kodlar.length === 0) {
      showMessage(msg, "Kodlar oluşturulamadı: " + (kodErr?.message || "bilinmeyen hata"));
      return;
    }

    yedekKodlariGosterVeIndir(document.getElementById("yedek-kod-goster-alani"), kodlar, () =>
      renderYedekKodDurumu(alan)
    );
  });
}

/** Üretilen düz metin kodları ekrana basar + kısa süreli indirilebilir bir
 * .txt dosyası sunar. Blob URL'i tarayıcı belleğinde oluşturulur (sunucuya
 * hiç gitmez) ve kullanıcının hemen kaydetmesi için sınırlı bir süre sonra
 * (2 dk) otomatik olarak geçersiz kılınır. */
function yedekKodlariGosterVeIndir(alan, kodlar, devamCallback) {
  if (!alan) return;

  const dosyaIcerik =
    `Abdullah Eymen Asru — 2FA Yedek Kodları\n` +
    `Oluşturulma: ${new Date().toLocaleString("tr-TR")}\n\n` +
    `Her kod SADECE BİR KERE kullanılabilir. Bu dosyayı güvenli bir yerde\n` +
    `sakla (şifre yöneticisi, kasa vb.) — authenticator uygulamana\n` +
    `erişemediğinde hesabına girmek için gerekecek.\n\n` +
    kodlar.join("\n") +
    `\n`;

  const blob = new Blob([dosyaIcerik], { type: "text/plain;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const dosyaAdi = `2fa-yedek-kodlar-${new Date().toISOString().slice(0, 10)}.txt`;

  alan.innerHTML = `
    <p class="auth-message auth-message--success" style="position:static;">
      Yeni yedek kodların hazır. Bu kodlar SADECE ŞİMDİ gösteriliyor —
      bir daha görüntülenemez, mutlaka kaydet.
    </p>
    <div class="yedek-kod-liste">
      ${kodlar.map((k) => `<code>${escapeHtml(k)}</code>`).join("")}
    </div>
    <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
      <a id="yedek-kod-indir-link" class="btn-secondary" style="width:auto;" href="${blobUrl}" download="${dosyaAdi}">
        İndir (.txt)
      </a>
      <button id="yedek-kod-kopyala-btn" type="button" class="btn-secondary" style="width:auto;">Panoya Kopyala</button>
      <button id="yedek-kod-devam-btn" type="button" class="btn-primary" style="width:auto;">Kaydettim, Devam Et</button>
    </div>
    <p id="yedek-kod-indir-durum" class="muted" style="font-size:0.85rem; margin-top:8px;">
      İndirme bağlantısı yaklaşık 2 dakika içinde geçersiz olur.
    </p>`;

  document.getElementById("yedek-kod-kopyala-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(kodlar.join("\n"));
      showMessage(document.getElementById("yedek-kod-indir-durum"), "Panoya kopyalandı.", "success");
    } catch (_e) {
      showMessage(document.getElementById("yedek-kod-indir-durum"), "Kopyalanamadı, kodları elle seçip kopyala.");
    }
  });

  // Kısa süreli indirilebilir dosya: blob URL'i ve indirme bağlantısı
  // belirli bir süre sonra devre dışı bırakılır — dosya sunucuda hiç
  // saklanmadığı için bu, kullanıcıyı kodları HEMEN indirmeye/kaydetmeye
  // yönlendiren bir güvenlik önlemidir.
  const sureMs = 120000;
  const zamanlayici = setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    const link = document.getElementById("yedek-kod-indir-link");
    const durumEl = document.getElementById("yedek-kod-indir-durum");
    if (link) {
      link.removeAttribute("href");
      link.style.opacity = "0.5";
      link.style.pointerEvents = "none";
      link.textContent = "İndirme süresi doldu";
    }
    if (durumEl) {
      durumEl.textContent = "İndirme bağlantısının süresi doldu — kodlar hâlâ yukarıda, elle kopyalayabilirsin.";
    }
  }, sureMs);

  document.getElementById("yedek-kod-devam-btn").addEventListener("click", () => {
    clearTimeout(zamanlayici);
    URL.revokeObjectURL(blobUrl);
    if (typeof devamCallback === "function") devamCallback();
  });
}

/* ---------------------------------------------------------------------- */
/* HESABI SİL (herkes kendi hesabını, admin dahil, aynı yoldan siler)      */
/* ---------------------------------------------------------------------- */
function wireDeleteAccount(session, profile) {
  const btn = document.getElementById("hesap-sil-btn");
  const confirmInput = document.getElementById("hesap-sil-onay");
  const msg = document.getElementById("hesap-sil-message");

  btn.addEventListener("click", async () => {
    // Yanlışlıkla tıklamayı önlemek için kullanıcı "SİL" yazmalı.
    if (confirmInput.value.trim().toUpperCase() !== "SİL") {
      showMessage(msg, 'Onaylamak için kutuya büyük harflerle "SİL" yaz.');
      return;
    }
    const ekstraUyari =
      profile.role === "admin"
        ? "\n\nDİKKAT: Bu hesap bir YÖNETİCİ hesabıdır. Silersen ve başka bir admin yoksa siteyi yönetecek kimse kalmaz."
        : "";
    const sure = window.confirm(
      "Bu işlem GERİ ALINAMAZ. Hesabın ve tüm verilerin kalıcı olarak silinecek. Emin misin?" + ekstraUyari
    );
    if (!sure) return;

    btn.disabled = true;
    btn.textContent = "Siliniyor...";

    try {
      const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        // hedef_kullanici_id GÖNDERMİYORUZ -> Edge Function bunu "kendini
        // sil" olarak yorumlar. Admin dahil HERKES bu yoldan kendini silebilir.
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bilinmeyen hata");

      // Hesap Edge Function tarafından zaten SİLİNDİ — buradan sonrası
      // sadece yerel oturum temizliği. signOut() bu noktada hata verirse
      // (silinen bir kullanıcının oturumunu kapatmaya çalışmak bazı
      // durumlarda hataya yol açabilir) bunu AYRI bir try/catch'e alıyoruz;
      // önceden tek bir try bloğunun içindeydi ve signOut() patlarsa kod
      // catch bloğuna düşüp YANLIŞLIKLA "Hesap silinemedi" mesajı
      // gösteriyordu — oysa hesap gerçekten silinmiş oluyordu.
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.error("Hesap silindi ama signOut() hata verdi (önemli değil):", signOutErr);
      }
      alert("Hesabın silindi. Anasayfaya yönlendiriliyorsun.");
      window.location.href = "/";
    } catch (err) {
      showMessage(msg, "Hesap silinemedi: " + err.message);
      btn.disabled = false;
      btn.textContent = "Hesabımı Kalıcı Olarak Sil";
    }
  });
}

/* ---------------------------------------------------------------------- */
/* ÖZEL İÇERİKLERİM (okundu durumu + son geçerlilik tarihiyle)             */
/* ---------------------------------------------------------------------- */
async function loadOzelIcerikler() {
  const list = document.getElementById("ozel-icerik-list");
  const { data, error } = await supabase
    .from("special_content")
    .select(
      "id, title, slug, summary, created_at, content_access(okundu_mu, okundu_tarihi, son_gecerlilik_tarihi)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p class="muted">Özel içerikler yüklenemedi.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<p class="muted">Henüz sana atanmış özel bir içerik yok.</p>`;
    return;
  }

  // NOT: Bu sorgu RLS sayesinde zaten sadece admin'in veya bize
  // content_access ile açıkça atadığı (ve süresi geçmemiş) satırları
  // döndürür — ekstra bir "erişimim var mı" filtresi frontend'de
  // YAZMIYORUZ, çünkü güvenlik veritabanı seviyesinde zaten sağlanıyor.
  list.innerHTML = data
    .map((item) => {
      const erisim = item.content_access?.[0];
      const okunduEtiketi = erisim?.okundu_mu
        ? `<span class="rol-durum--ok">✓ Okundu · ${new Date(erisim.okundu_tarihi).toLocaleDateString("tr-TR")}</span>`
        : `<span class="muted">Henüz okunmadı</span>`;
      const sonGecerlilik = erisim?.son_gecerlilik_tarihi
        ? `<span class="muted"> · Erişim sonu: ${new Date(erisim.son_gecerlilik_tarihi).toLocaleDateString("tr-TR")}</span>`
        : "";
      return `
      <a class="post-card" href="/panel/ozel-icerik.html?id=${encodeURIComponent(item.id)}">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${new Date(item.created_at).toLocaleDateString("tr-TR")} · ${okunduEtiketi}${sonGecerlilik}</p>
        <p>${escapeHtml(item.summary ?? "")}</p>
      </a>`;
    })
    .join("");
}

/** "Eski Mailime Erişemiyorum" kutusundaki "Yöneticiyle Mesajlaş" linkine
 * tıklanınca, native anchor scroll'un (href="#chat-kullanici") ardından bir
 * sohbete odaklan — kullanıcı direkt yazmaya başlayabilsin. Artık mesajlar
 * çok-sohbetli olduğu için tek bir sabit metin kutusu yok: varsa EN SON
 * konuşmayı otomatik seçip mesaj alanına odaklanıyoruz; hiç sohbeti yoksa
 * "Yeni Sohbet" formunu açıp konuyu otomatik dolduruyoruz. */
function wireEpostaYardimMesajLink() {
  document.getElementById("eposta-yardim-mesaj-link")?.addEventListener("click", () => {
    setTimeout(() => {
      const ilkKonusma = document.querySelector("#chat-konusma-liste .msg-konusma-item");
      if (ilkKonusma) {
        ilkKonusma.click();
        setTimeout(() => document.getElementById("chat-metin")?.focus(), 250);
        return;
      }
      const yeniBtn = document.getElementById("chat-yeni-sohbet-btn");
      const konuInput = document.getElementById("chat-yeni-sohbet-konu");
      if (yeniBtn && konuInput) {
        yeniBtn.click();
        if (!konuInput.value) konuInput.value = "Eski e-postama erişemiyorum";
        konuInput.focus();
      }
    }, 400);
  });
}

function wireLogout() {
  document.getElementById("cikis-btn")?.addEventListener("click", async (e) => {
    // href="#" olduğu için preventDefault ŞART — yoksa tarayıcı sayfanın en
    // üstüne atlar ve (bazı durumlarda) aşağıdaki async işlemi de yarım
    // bırakabilir izlenimi verir.
    e.preventDefault();
    const btn = e.currentTarget;
    btn.style.pointerEvents = "none";
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut hatası (yine de yönlendiriliyor):", error);
    } catch (err) {
      // signOut() bazen (ör. zaten süresi dolmuş/geçersiz oturum) hata
      // fırlatabilir — önceden bu durumda catch/finally olmadığı için
      // yönlendirme hiç ÇALIŞMIYORDU ve buton "tepkisiz" görünüyordu.
      // Oturum zaten geçersizse kullanıcı fiilen çıkmış demektir, yine de
      // anasayfaya yönlendiriyoruz.
      console.error("signOut() beklenmedik hata (yine de yönlendiriliyor):", err);
    } finally {
      window.location.href = "/";
    }
  });
}

init(); // sayfa modülü yüklenince otomatik çalışır; #app'i requireAuth() gösterir
