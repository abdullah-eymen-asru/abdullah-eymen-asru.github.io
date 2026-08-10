/*
 * assets/js/chat.js
 * Üye <-> Yönetici mesajlaşma (Instagram DM mantığına yakın, ama basit):
 * her üyenin YÖNETİCİ ile TEK bir konuşması vardır. Üye sadece yöneticiye
 * yazabilir (üyeler birbirine yazamaz). Admin, panelinden tüm konuşmaları
 * görür ve herhangi birine yanıt verebilir.
 *
 * Veritabanı: public.messages (bkz. supabase/migrations/0004_...sql)
 *   - conversation_user_id: konuşmanın "sahibi" olan üye (admin olmayan taraf)
 *   - sender_id: mesajı kim gönderdi
 * RLS bunu zaten güvenli hale getiriyor; burada sadece UI var.
 *
 * Bu dosya İKİ farklı sayfa için kullanılıyor:
 *   - wireUserChat()  -> panel/panel.md (normal/özel üye, tek konuşma kutusu)
 *   - wireAdminChat() -> panel/admin.md (konuşma listesi + seçilen konuşma)
 */
import { supabase, escapeHtml, showMessage } from "./supabase-client.js";

function formatSaat(iso) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mesajBalonuHtml(m, benimId) {
  const ben = m.sender_id === benimId;
  const silBtn = ben ? `<button type="button" class="chat-mesaj-sil" data-id="${m.id}">Sil</button>` : "";
  return `
    <div class="chat-mesaj ${ben ? "chat-mesaj--ben" : "chat-mesaj--karsi"}" data-id="${m.id}">
      ${escapeHtml(m.body)}
      <span class="chat-mesaj-meta">${formatSaat(m.created_at)}${silBtn}</span>
    </div>`;
}

function mesajListesiniCiz(listEl, mesajlar, benimId) {
  if (!mesajlar || mesajlar.length === 0) {
    listEl.innerHTML = `<p class="chat-bos">Henüz mesaj yok. İlk mesajı sen gönder.</p>`;
    return;
  }
  listEl.innerHTML = mesajlar.map((m) => mesajBalonuHtml(m, benimId)).join("");
  listEl.querySelectorAll(".chat-mesaj-sil").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm("Bu mesajı silmek istediğine emin misin?")) return;
      await supabase.from("messages").delete().eq("id", id);
      // Realtime aboneliği zaten listeyi güncelleyecek; yine de anında
      // tepki için elle de kaldıralım.
      listEl.querySelector(`[data-id="${id}"]`)?.remove();
    });
  });
  listEl.scrollTop = listEl.scrollHeight;
}

/* ---------------------------------------------------------------------- */
/* ÜYE TARAFI — panel/panel.md içindeki tek konuşma kutusu                 */
/* ---------------------------------------------------------------------- */
export async function wireUserChat(profile) {
  const box = document.getElementById("chat-kullanici");
  if (!box) return;

  const listEl = document.getElementById("chat-mesaj-liste");
  const form = document.getElementById("chat-form");
  const textarea = document.getElementById("chat-metin");
  const msg = document.getElementById("chat-message");

  async function yukle() {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_user_id", profile.id)
      .order("created_at", { ascending: true });
    if (error) {
      listEl.innerHTML = `<p class="chat-bos">Mesajlar yüklenemedi.</p>`;
      return;
    }
    mesajListesiniCiz(listEl, data, profile.id);
  }

  await yukle();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = textarea.value.trim();
    if (!body) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await supabase.from("messages").insert({
      conversation_user_id: profile.id,
      sender_id: profile.id,
      body,
    });
    btn.disabled = false;
    if (error) {
      showMessage(msg, "Mesaj gönderilemedi: " + error.message);
      return;
    }
    textarea.value = "";
    await yukle();
  });

  // Canlı güncelleme: bu konuşmaya (kendi conversation_user_id'sine) yeni
  // mesaj eklenince veya silinince listeyi tazele.
  supabase
    .channel(`chat-${profile.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `conversation_user_id=eq.${profile.id}` },
      () => yukle()
    )
    .subscribe();

  // Realtime bir sebeple bağlanamazsa diye basit bir yedek: her 10 saniyede
  // bir sessizce tazele.
  setInterval(yukle, 10000);
}

/* ---------------------------------------------------------------------- */
/* ADMİN TARAFI — panel/admin.md içindeki konuşma listesi + seçili konuşma */
/* ---------------------------------------------------------------------- */
export async function wireAdminChat(adminId) {
  const wrap = document.getElementById("chat-admin");
  if (!wrap) return;

  const konusmaListeEl = document.getElementById("chat-konusma-liste");
  const listEl = document.getElementById("chat-mesaj-liste-admin");
  const form = document.getElementById("chat-form-admin");
  const textarea = document.getElementById("chat-metin-admin");
  const baslikEl = document.getElementById("chat-secili-kullanici");
  const msg = document.getElementById("chat-message-admin");

  let SECILI_KULLANICI = null;
  let KULLANICI_ADLARI = {}; // id -> "Ad Soyad (email)"

  async function konusmalariYukle() {
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_user_id, sender_id, body, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      konusmaListeEl.innerHTML = `<p class="chat-bos">Konuşmalar yüklenemedi.</p>`;
      return;
    }

    // profil bilgisi (isim/e-posta) için tek seferlik sorgu
    const idler = [...new Set((data || []).map((m) => m.conversation_user_id))];
    if (idler.length > 0) {
      const { data: profiller } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", idler);
      KULLANICI_ADLARI = {};
      (profiller || []).forEach((p) => {
        KULLANICI_ADLARI[p.id] = p.full_name || p.email;
      });
    }

    const gruplar = new Map(); // conversation_user_id -> son mesaj
    for (const m of data || []) {
      if (!gruplar.has(m.conversation_user_id)) gruplar.set(m.conversation_user_id, m);
    }

    if (gruplar.size === 0) {
      konusmaListeEl.innerHTML = `<p class="chat-bos">Henüz hiç mesaj yok.</p>`;
      return;
    }

    konusmaListeEl.innerHTML = [...gruplar.entries()]
      .map(
        ([userId, sonMesaj]) => `
        <button type="button" class="chat-konusma-item ${userId === SECILI_KULLANICI ? "active" : ""}" data-id="${userId}">
          <span class="isim">${escapeHtml(KULLANICI_ADLARI[userId] || "Bilinmeyen üye")}</span>
          <span class="onizleme">${escapeHtml(sonMesaj.body)}</span>
        </button>`
      )
      .join("");

    konusmaListeEl.querySelectorAll(".chat-konusma-item").forEach((btn) => {
      btn.addEventListener("click", () => konusmaSec(btn.dataset.id));
    });
  }

  async function mesajlariYukle() {
    if (!SECILI_KULLANICI) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_user_id", SECILI_KULLANICI)
      .order("created_at", { ascending: true });
    if (error) {
      listEl.innerHTML = `<p class="chat-bos">Mesajlar yüklenemedi.</p>`;
      return;
    }
    mesajListesiniCiz(listEl, data, adminId);
  }

  function konusmaSec(userId) {
    SECILI_KULLANICI = userId;
    baslikEl.textContent = KULLANICI_ADLARI[userId] || "Konuşma";
    form.hidden = false;
    konusmaListeEl.querySelectorAll(".chat-konusma-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.id === userId);
    });
    mesajlariYukle();
  }

  await konusmalariYukle();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!SECILI_KULLANICI) return;
    const body = textarea.value.trim();
    if (!body) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await supabase.from("messages").insert({
      conversation_user_id: SECILI_KULLANICI,
      sender_id: adminId,
      body,
    });
    btn.disabled = false;
    if (error) {
      showMessage(msg, "Mesaj gönderilemedi: " + error.message);
      return;
    }
    textarea.value = "";
    await mesajlariYukle();
    await konusmalariYukle();
  });

  // Admin TÜM konuşmaları görebildiği için filtre olmadan tüm tabloyu
  // dinliyoruz (RLS zaten sadece admin'e bunu döndürür).
  supabase
    .channel("chat-admin-tumu")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
      konusmalariYukle();
      mesajlariYukle();
    })
    .subscribe();

  setInterval(() => {
    konusmalariYukle();
    mesajlariYukle();
  }, 10000);
}
