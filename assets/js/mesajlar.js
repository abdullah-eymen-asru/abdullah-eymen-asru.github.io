/*
 * assets/js/mesajlar.js — /panel/mesajlar.html
 *
 * "Mesajlar" bölümü hem panel.md (üye) hem admin.md (yönetici gelen
 * kutusu) içinden BURAYA, ortak/bağımsız bir sayfaya taşındı (istek:
 * "sayfanın ortasına gelsin düzgün dursun"). Aynı assets/js/chat.js
 * (wireUserChat / wireAdminChat) fonksiyonları HİÇ DEĞİŞTİRİLMEDEN
 * kullanılıyor — sadece hangi görünümün (üye/admin) DOM'a basılacağına
 * burada, giriş yapan kişinin rolüne göre karar veriliyor.
 *
 * ÖNEMLİ: üye görünümü ile admin görünümü AYNI ID'leri kullanıyor
 * (ör. ikisi de "chat-konusma-liste"), çünkü eskiden iki AYRI sayfadaydılar
 * (panel.md / admin.md) ve chat.js bu id'leri sabit kodlanmış (hardcoded)
 * şekilde arıyor. Bu yüzden ikisi ASLA aynı anda DOM'da olmuyor: sadece
 * rolü belirlendikten SONRA, tek bir görünümün HTML'i innerHTML ile basılıp
 * chat.js'in ilgili fonksiyonu çağrılıyor.
 */
import { requireAuthOrShowError } from "./auth/auth-guard.js";
import { wireUserChat, wireAdminChat } from "./chat.js";

function uyeMarkup() {
  return `
    <div id="chat-kullanici">
      <div id="chat-panel" class="msg-panel">
        <aside class="msg-list-pane">
          <div class="msg-list-header">
            <button type="button" id="chat-yeni-sohbet-btn" class="msg-yeni-btn">+ Yeni Sohbet</button>
          </div>
          <div id="chat-yeni-sohbet-form-wrap" class="msg-yeni-form-wrap" hidden>
            <form id="chat-yeni-sohbet-form" novalidate>
              <div class="msg-hedef-satir">
                <span class="msg-hedef-satir-etiket">Kime:</span>
                <span id="chat-hedef-etiket" class="msg-hedef-deger">Yönetici (fark etmez)</span>
                <button type="button" id="chat-hedef-degistir-btn" class="msg-hedef-degistir-btn">Değiştir</button>
              </div>
              <input id="chat-yeni-sohbet-konu" type="text" maxlength="120" placeholder="Konu (ör. Ödeme sorunu)" required>
              <div class="msg-yeni-form-btnler">
                <button type="submit" class="btn-primary" style="width:auto;">Başlat</button>
                <button type="button" id="chat-yeni-sohbet-iptal" class="btn-secondary" style="width:auto;">Vazgeç</button>
              </div>
            </form>
          </div>
          <div id="chat-konusma-liste" class="msg-konusma-liste"><p class="chat-bos">Yükleniyor...</p></div>
        </aside>

        <div class="msg-thread-pane">
          <div class="msg-thread-header">
            <button type="button" id="chat-geri-btn" class="msg-geri-btn" aria-label="Sohbet listesine dön">←</button>
            <span id="chat-thread-baslik" class="msg-thread-baslik">Bir sohbet seç veya yeni sohbet başlat.</span>
          </div>
          <div id="chat-mesaj-liste" class="chat-mesaj-liste"><p class="chat-bos">Bir sohbet seç.</p></div>
          <form id="chat-form" class="chat-form" novalidate hidden>
            <textarea id="chat-metin" placeholder="Mesajını yaz..." required></textarea>
            <button type="submit">Gönder</button>
          </form>
        </div>
      </div>
      <div id="chat-message" class="auth-message" hidden></div>
    </div>

    <div id="chat-hedef-modal" class="msg-hedef-modal-overlay" hidden>
      <div class="msg-hedef-modal" role="dialog" aria-modal="true" aria-label="Kime mesaj atmak istiyorsun?">
        <div class="msg-hedef-modal-baslik">
          <span>Kime mesaj atmak istiyorsun?</span>
          <button type="button" id="chat-hedef-modal-kapat" class="msg-hedef-modal-kapat" aria-label="Kapat">✕</button>
        </div>
        <div class="msg-hedef-sekme-bar">
          <button type="button" class="msg-hedef-sekme active" data-rol="">Tümü</button>
          <button type="button" class="msg-hedef-sekme" data-rol="admin">Yöneticiler</button>
          <button type="button" class="msg-hedef-sekme" data-rol="owner">Site Sahipleri</button>
        </div>
        <input id="chat-hedef-arama" type="search" class="msg-uye-arama" placeholder="İsim ile ara...">
        <button type="button" id="chat-hedef-temizle-btn" class="msg-hedef-herhangi-btn">Fark etmez — herhangi bir yönetici/site sahibi görsün</button>
        <div id="chat-hedef-liste" class="msg-hedef-liste"><p class="chat-bos">Yükleniyor...</p></div>
      </div>
    </div>`;
}

function adminMarkup() {
  return `
    <div id="chat-admin">
      <div id="chat-panel-admin" class="msg-panel msg-panel--admin">
        <aside class="msg-list-pane">
          <div class="msg-list-header">
            <input id="chat-uye-arama" type="search" class="msg-uye-arama" placeholder="Üye ara (isim veya e-posta)...">
            <div id="chat-uye-arama-sonuc" class="msg-uye-arama-sonuc" hidden></div>
          </div>
          <div id="chat-konusma-liste" class="msg-konusma-liste"><p class="chat-bos">Yükleniyor...</p></div>
        </aside>

        <div class="msg-thread-pane">
          <div class="msg-thread-header">
            <button type="button" id="chat-geri-btn-admin" class="msg-geri-btn" aria-label="Sohbet listesine dön">←</button>
            <span id="chat-thread-baslik-admin" class="msg-thread-baslik">Bir konuşma seç.</span>
          </div>
          <div id="chat-mesaj-liste-admin" class="chat-mesaj-liste"></div>
          <form id="chat-form-admin" class="chat-form" novalidate hidden>
            <textarea id="chat-metin-admin" placeholder="Yanıtını yaz..." required></textarea>
            <button type="submit">Gönder</button>
          </form>
        </div>
      </div>
    </div>
    <div id="chat-message-admin" class="auth-message" hidden></div>`;
}

/** panel.md'deki "Eski Mailime Erişemiyorum" kutusundaki "Yöneticiyle
 * Mesajlaş" linki artık buraya ?konu=... ile geliyor (bkz. panel.md). Sayfa
 * açılır açılmaz varsa EN SON konuşmayı otomatik seçip mesaj alanına
 * odaklanıyoruz; hiç sohbeti yoksa "Yeni Sohbet" formunu bu konuyla
 * ÖNCEDEN doldurup açıyoruz — panel.js'teki eski
 * wireEpostaYardimMesajLink() davranışıyla birebir aynı mantık. */
function konuOnDoldurmayiUygula() {
  const params = new URLSearchParams(window.location.search);
  const konu = params.get("konu");
  if (!konu) return;

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
      if (!konuInput.value) konuInput.value = konu;
      konuInput.focus();
    }
  }, 400);
}

async function init() {
  const { session, profile } = await requireAuthOrShowError({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  const icerik = document.getElementById("mesajlar-icerik");
  const aciklama = document.getElementById("mesajlar-aciklama");
  const adminMi = profile.role === "admin" || profile.role === "owner";

  if (adminMi) {
    aciklama.textContent =
      "Üyelerin sana gönderdiği tüm konuşmalar burada. Soldan bir konuşma seç, ya da yukarıdan isim/e-posta ile üye arayıp onunla yeni bir konuşma başlat.";
    icerik.innerHTML = adminMarkup();
    // BUG FİX (eksik geri dönüş linki): bu sayfaya (mesajlar.html)
    // ADMİN olarak gelindiğinde admin.md'ye dönmenin tek yolu tarayıcının
    // GERİ tuşuydu — panel/uye-ayarlari.md ve panel/admin-guvenlik.md'deki
    // "← Admin Paneline Dön" linkiyle tutarlı olması için burada da
    // ekleniyor. SADECE admin/owner görünümünde eklenir (adminMi === true)
    // çünkü bu sayfa aynı zamanda SIRADAN üyeler tarafından da kullanılıyor
    // (bkz. dosya başındaki not) — normal bir üyeye "Admin Paneline Dön"
    // linki göstermek hem anlamsız hem de kafa karıştırıcı olurdu (o
    // sayfaya zaten girişi yok, requireAuth onu geri atardı).
    const baslikWrap = document.querySelector(".mesajlar-baslik");
    if (baslikWrap && !document.getElementById("mesajlar-admin-geri-btn")) {
      const geriBtn = document.createElement("a");
      geriBtn.id = "mesajlar-admin-geri-btn";
      geriBtn.className = "btn-secondary uya-geri-btn";
      // NOT: auth-guard.js'teki redirect'lerle AYNI şekilde absolute path
      // hardcode edildi (bu site baseurl kullanmıyor, bkz. _config.yml).
      geriBtn.href = "/panel/admin.html";
      geriBtn.textContent = "← Admin Paneline Dön";
      baslikWrap.appendChild(geriBtn);
    }
    await wireAdminChatGuvenli(session.user.id);
  } else {
    aciklama.textContent =
      'Site yöneticisiyle yazışabilirsin — farklı konularda istediğin kadar ayrı sohbet açabilirsin (ör. "Ödeme sorunu", "Şifre yardımı").';
    icerik.innerHTML = uyeMarkup();
    await wireUserChatGuvenli(profile);
    konuOnDoldurmayiUygula();
  }
}

// KARARLILIK: wireAdminChat()/wireUserChat() beklenmedik bir hata
// fırlatırsa (ör. bir DOM elemanı beklenmeyen şekilde eksikse), önceden
// bu hata init()'i tamamen keserdi — ama #loading zaten gizlenmiş ve
// #app zaten gösterilmiş OLDUĞU için kullanıcı içerideki "Yükleniyor…"
// yer tutucularının (chat-konusma-liste, chat-mesaj-liste) sonsuza dek
// öyle kaldığını görürdü. panel.js'teki "her bölüm bağımsız" prensibiyle
// tutarlı olması için burada da yakalayıp görünür bir hata gösteriyoruz.
async function wireAdminChatGuvenli(adminId) {
  try {
    await wireAdminChat(adminId);
  } catch (err) {
    console.error("mesajlar.js: wireAdminChat başarısız:", err);
    const el = document.getElementById("chat-konusma-liste");
    if (el) el.innerHTML = `<p class="chat-bos">Sohbetler yüklenemedi. Sayfayı yenilemeyi dene.</p>`;
  }
}
async function wireUserChatGuvenli(profile) {
  try {
    await wireUserChat(profile);
  } catch (err) {
    console.error("mesajlar.js: wireUserChat başarısız:", err);
    const el = document.getElementById("chat-konusma-liste");
    if (el) el.innerHTML = `<p class="chat-bos">Sohbetler yüklenemedi. Sayfayı yenilemeyi dene.</p>`;
  }
}

init();
