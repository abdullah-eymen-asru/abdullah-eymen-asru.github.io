/*
 * assets/js/chat.js
 * Üye <-> Yönetici mesajlaşma. Artık her üyenin yöneticiyle TEK bir
 * konuşması yok — üye yöneticiyle FARKLI KONULARDA birden çok ayrı
 * konuşma açabiliyor (ör. "Ödeme sorunu", "Şifre yardımı"), tıpkı bir
 * destek/DM kutusu gibi. Admin de kendi tarafında TÜM bu konuşmaları
 * (hangi üyeden, hangi konuda) görür, sistemdeki HERHANGİ bir üyeyi
 * isim/e-posta ile arayıp onunla yeni bir konuşma başlatabilir.
 *
 * Veritabanı (bkz. supabase/migrations/0006_konusma_bazli_mesajlasma.sql):
 *   - public.conversations: id, user_id (konuşmanın sahibi üye), konu,
 *     created_by, son_mesaj_at
 *   - public.messages: id, conversation_id, sender_id, body, created_at
 * RLS bunu güvenli hale getiriyor; burada sadece UI var.
 *
 * Bu dosya İKİ farklı sayfa için kullanılıyor:
 *   - wireUserChat()  -> panel/panel.md (normal/özel üye)
 *   - wireAdminChat() -> panel/admin.md (yönetici)
 * İkisi de aynı geniş "iki panelli" (sol: konuşma listesi, sağ: seçili
 * konuşmanın mesajları) düzeni paylaşır — bkz. assets/css/auth.css
 * ".msg-panel" bölümü. Dar ekranlarda (telefon) tek pane görünür, bir
 * konuşma seçilince "← Geri" butonuyla listeye dönülür.
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

/** Konuşma listesindeki tek bir satırın HTML'i — hem üye hem admin tarafında
 * ortak. Satır artık İKİ ayrı butondan oluşuyor: soldaki geniş buton
 * (".msg-konusma-sec") konuşmayı seçer, sağdaki küçük "✕" butonu
 * (".msg-konusma-sil") konuşmayı SİLER — ikisi kardeş elemanlar (bir
 * <button> içine başka bir <button> koymak geçersiz HTML olduğu için satırın
 * dış kabı artık bir <div>). */
function konusmaOgesiHtml({ id, baslikMetni, konu, sonMesaj, aktif }) {
  return `
    <div class="msg-konusma-item ${aktif ? "active" : ""}" data-id="${id}">
      <button type="button" class="msg-konusma-sec" data-id="${id}">
        <span class="msg-konusma-baslik">${escapeHtml(baslikMetni)}</span>
        <span class="msg-konusma-konu">${escapeHtml(konu)}</span>
        ${sonMesaj ? `<span class="msg-konusma-onizleme">${escapeHtml(sonMesaj)}</span>` : ""}
      </button>
      <button type="button" class="msg-konusma-sil" data-id="${id}" title="Bu sohbeti sil" aria-label="Bu sohbeti sil">✕</button>
    </div>`;
}

/** Bir konuşmayı (ve içindeki tüm mesajları — CASCADE ile otomatik) siler.
 * Onay ister, hata olursa msgEl'de gösterir. Başarılıysa true döner. */
async function konusmaSil(id, msgEl) {
  if (!confirm("Bu sohbeti ve içindeki TÜM mesajları kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.")) {
    return false;
  }
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) {
    showMessage(msgEl, "Sohbet silinemedi: " + error.message);
    return false;
  }
  return true;
}

/** conversation_id listesi için, her konuşmanın SON mesajını (önizleme) tek sorguda getirir. */
async function sonMesajOnizlemeleriGetir(konusmaIdleri) {
  const onizlemeler = {};
  if (!konusmaIdleri || konusmaIdleri.length === 0) return onizlemeler;
  const { data } = await supabase
    .from("messages")
    .select("conversation_id, body, created_at")
    .in("conversation_id", konusmaIdleri)
    .order("created_at", { ascending: false });
  (data || []).forEach((m) => {
    if (!(m.conversation_id in onizlemeler)) onizlemeler[m.conversation_id] = m.body;
  });
  return onizlemeler;
}

/* ---------------------------------------------------------------------- */
/* ÜYE TARAFI — panel/panel.md                                            */
/* ---------------------------------------------------------------------- */
export async function wireUserChat(profile) {
  const box = document.getElementById("chat-kullanici");
  if (!box) return;

  const panelEl = document.getElementById("chat-panel");
  const listPaneEl = document.getElementById("chat-konusma-liste");
  const threadListEl = document.getElementById("chat-mesaj-liste");
  const form = document.getElementById("chat-form");
  const textarea = document.getElementById("chat-metin");
  const msg = document.getElementById("chat-message");
  const baslikEl = document.getElementById("chat-thread-baslik");
  const geriBtn = document.getElementById("chat-geri-btn");
  const yeniBtn = document.getElementById("chat-yeni-sohbet-btn");
  const yeniWrap = document.getElementById("chat-yeni-sohbet-form-wrap");
  const yeniForm = document.getElementById("chat-yeni-sohbet-form");
  const yeniKonuInput = document.getElementById("chat-yeni-sohbet-konu");
  const yeniIptalBtn = document.getElementById("chat-yeni-sohbet-iptal");

  let SECILI_KONUSMA = null;
  let KONUSMALAR = [];

  function bosListeMesaji() {
    return `<p class="chat-bos">Henüz sohbetin yok. Yukarıdan <strong>+ Yeni Sohbet</strong> ile başlat.</p>`;
  }

  async function konusmalariYukle() {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, konu, son_mesaj_at")
      .eq("user_id", profile.id)
      .order("son_mesaj_at", { ascending: false });

    if (error) {
      listPaneEl.innerHTML = `<p class="chat-bos">Sohbetler yüklenemedi.</p>`;
      return;
    }
    KONUSMALAR = data || [];
    const onizlemeler = await sonMesajOnizlemeleriGetir(KONUSMALAR.map((k) => k.id));

    listPaneEl.innerHTML =
      KONUSMALAR.length === 0
        ? bosListeMesaji()
        : KONUSMALAR.map((k) =>
            konusmaOgesiHtml({
              id: k.id,
              baslikMetni: k.konu,
              konu: `Son güncelleme: ${formatSaat(k.son_mesaj_at)}`,
              sonMesaj: onizlemeler[k.id],
              aktif: k.id === SECILI_KONUSMA,
            })
          ).join("");

    listPaneEl.querySelectorAll(".msg-konusma-sec").forEach((btn) => {
      btn.addEventListener("click", () => konusmaSec(btn.dataset.id));
    });
    listPaneEl.querySelectorAll(".msg-konusma-sil").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const basarili = await konusmaSil(id, msg);
        if (!basarili) return;
        if (SECILI_KONUSMA === id) {
          SECILI_KONUSMA = null;
          threadListEl.innerHTML = `<p class="chat-bos">Bir sohbet seç.</p>`;
          form.hidden = true;
          baslikEl.textContent = "Bir sohbet seç veya yeni sohbet başlat.";
          panelEl.classList.remove("msg-panel--thread-aktif");
        }
        await konusmalariYukle();
      });
    });

    // Seçili konuşma bir sebeple listeden kalktıysa (ör. az önce SİLİNDİYSE,
    // ya da admin/başka bir sekmede silindiyse) seçimi temizle.
    if (SECILI_KONUSMA && !KONUSMALAR.some((k) => k.id === SECILI_KONUSMA)) {
      SECILI_KONUSMA = null;
      threadListEl.innerHTML = `<p class="chat-bos">Bir sohbet seç.</p>`;
      form.hidden = true;
      baslikEl.textContent = "Bir sohbet seç veya yeni sohbet başlat.";
    }
  }

  async function mesajlariYukle() {
    if (!SECILI_KONUSMA) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", SECILI_KONUSMA)
      .order("created_at", { ascending: true });
    if (error) {
      threadListEl.innerHTML = `<p class="chat-bos">Mesajlar yüklenemedi.</p>`;
      return;
    }
    mesajListesiniCiz(threadListEl, data, profile.id);
  }

  function konusmaSec(id) {
    SECILI_KONUSMA = id;
    const k = KONUSMALAR.find((x) => x.id === id);
    baslikEl.textContent = k ? k.konu : "Sohbet";
    form.hidden = false;
    yeniWrap.hidden = true;
    listPaneEl.querySelectorAll(".msg-konusma-item").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    panelEl.classList.add("msg-panel--thread-aktif"); // dar ekranda thread görünümüne geç
    mesajlariYukle();
  }

  geriBtn?.addEventListener("click", () => panelEl.classList.remove("msg-panel--thread-aktif"));

  yeniBtn?.addEventListener("click", () => {
    yeniWrap.hidden = !yeniWrap.hidden;
    if (!yeniWrap.hidden) yeniKonuInput.focus();
  });
  yeniIptalBtn?.addEventListener("click", () => {
    yeniWrap.hidden = true;
    yeniForm.reset();
  });

  yeniForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const konu = yeniKonuInput.value.trim();
    if (!konu) return;
    const btn = yeniForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { data, error } = await supabase.rpc("baslat_konusma", { p_konu: konu });
    btn.disabled = false;
    if (error) {
      showMessage(msg, "Sohbet başlatılamadı: " + error.message);
      return;
    }
    yeniForm.reset();
    yeniWrap.hidden = true;
    await konusmalariYukle();
    konusmaSec(data);
  });

  await konusmalariYukle();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!SECILI_KONUSMA) return;
    const body = textarea.value.trim();
    if (!body) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await supabase.from("messages").insert({
      conversation_id: SECILI_KONUSMA,
      sender_id: profile.id,
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

  // Canlı güncelleme: RLS zaten sadece bu üyenin kendi konuşmalarını
  // görmesine izin verir, o yüzden filtresiz dinlemek güvenlidir (admin
  // tarafındaki desenle aynı mantık).
  supabase
    .channel(`chat-user-${profile.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
      konusmalariYukle();
      mesajlariYukle();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => konusmalariYukle())
    .subscribe();

  // Realtime bir sebeple bağlanamazsa diye basit bir yedek: her 10 saniyede
  // bir sessizce tazele.
  setInterval(() => {
    konusmalariYukle();
    mesajlariYukle();
  }, 10000);
}

/* ---------------------------------------------------------------------- */
/* ADMİN TARAFI — panel/admin.md                                          */
/* ---------------------------------------------------------------------- */
export async function wireAdminChat(adminId) {
  const wrap = document.getElementById("chat-admin");
  if (!wrap) return;

  const panelEl = document.getElementById("chat-panel-admin");
  const listPaneEl = document.getElementById("chat-konusma-liste");
  const threadListEl = document.getElementById("chat-mesaj-liste-admin");
  const form = document.getElementById("chat-form-admin");
  const textarea = document.getElementById("chat-metin-admin");
  const baslikEl = document.getElementById("chat-thread-baslik-admin");
  const geriBtn = document.getElementById("chat-geri-btn-admin");
  const msg = document.getElementById("chat-message-admin");
  const aramaInput = document.getElementById("chat-uye-arama");
  const aramaSonucEl = document.getElementById("chat-uye-arama-sonuc");

  let SECILI_KONUSMA = null;
  let KONUSMALAR = []; // { id, user_id, konu, son_mesaj_at }
  let ONIZLEMELER = {};
  let PROFIL_ADLARI = {}; // user_id -> "Ad Soyad (ya da e-posta)"
  let SECILI_UYE = null; // admin arama sonucundan bir üye seçtiyse: { id, isim }

  async function konusmalariYukle() {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, user_id, konu, son_mesaj_at")
      .order("son_mesaj_at", { ascending: false });

    if (error) {
      listPaneEl.innerHTML = `<p class="chat-bos">Konuşmalar yüklenemedi.</p>`;
      return;
    }
    KONUSMALAR = data || [];

    const idler = [...new Set(KONUSMALAR.map((k) => k.user_id))];
    if (idler.length > 0) {
      const { data: profiller } = await supabase.from("profiles").select("id, full_name, email").in("id", idler);
      PROFIL_ADLARI = {};
      (profiller || []).forEach((p) => (PROFIL_ADLARI[p.id] = p.full_name || p.email));
    }

    ONIZLEMELER = await sonMesajOnizlemeleriGetir(KONUSMALAR.map((k) => k.id));
    konusmaListesiniCiz();
  }

  function konusmaListesiniCiz() {
    const gosterilecekler = SECILI_UYE ? KONUSMALAR.filter((k) => k.user_id === SECILI_UYE.id) : KONUSMALAR;

    let ustBar = "";
    if (SECILI_UYE) {
      ustBar = `
        <div class="msg-filtre-bar">
          <span>${escapeHtml(SECILI_UYE.isim)} ile sohbetler</span>
          <button type="button" id="chat-filtre-temizle" class="msg-filtre-temizle-btn">Tüm Konuşmalar</button>
        </div>
        <button type="button" id="chat-yeni-sohbet-btn-admin" class="msg-yeni-btn">+ Yeni Sohbet Başlat</button>
        <div id="chat-yeni-sohbet-form-wrap-admin" class="msg-yeni-form-wrap" hidden>
          <form id="chat-yeni-sohbet-form-admin" novalidate>
            <input id="chat-yeni-sohbet-konu-admin" type="text" maxlength="120" placeholder="Konu (ör. Ödeme sorunu)" required>
            <div class="msg-yeni-form-btnler">
              <button type="submit" class="btn-primary" style="width:auto;">Başlat</button>
              <button type="button" id="chat-yeni-sohbet-iptal-admin" class="btn-secondary" style="width:auto;">Vazgeç</button>
            </div>
          </form>
        </div>`;
    }

    const listeHtml =
      gosterilecekler.length === 0
        ? `<p class="chat-bos">${SECILI_UYE ? "Bu üyeyle henüz sohbet yok. Yukarıdan yeni bir tane başlatabilirsin." : "Henüz hiç mesaj yok."}</p>`
        : gosterilecekler
            .map((k) =>
              konusmaOgesiHtml({
                id: k.id,
                baslikMetni: PROFIL_ADLARI[k.user_id] || "Bilinmeyen üye",
                konu: k.konu,
                sonMesaj: ONIZLEMELER[k.id],
                aktif: k.id === SECILI_KONUSMA,
              })
            )
            .join("");

    listPaneEl.innerHTML = ustBar + `<div class="msg-konusma-liste-ic">${listeHtml}</div>`;

    listPaneEl.querySelectorAll(".msg-konusma-sec").forEach((btn) => {
      btn.addEventListener("click", () => konusmaSec(btn.dataset.id));
    });
    listPaneEl.querySelectorAll(".msg-konusma-sil").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const basarili = await konusmaSil(id, msg);
        if (!basarili) return;
        if (SECILI_KONUSMA === id) {
          SECILI_KONUSMA = null;
          threadListEl.innerHTML = "";
          form.hidden = true;
          baslikEl.textContent = "Bir konuşma seç.";
          panelEl.classList.remove("msg-panel--thread-aktif");
        }
        await konusmalariYukle();
      });
    });
    document.getElementById("chat-filtre-temizle")?.addEventListener("click", () => {
      SECILI_UYE = null;
      konusmaListesiniCiz();
    });
    wireYeniSohbetAdmin();
  }

  function wireYeniSohbetAdmin() {
    const btn = document.getElementById("chat-yeni-sohbet-btn-admin");
    const formWrap = document.getElementById("chat-yeni-sohbet-form-wrap-admin");
    const yForm = document.getElementById("chat-yeni-sohbet-form-admin");
    const konuInput = document.getElementById("chat-yeni-sohbet-konu-admin");
    const iptalBtn = document.getElementById("chat-yeni-sohbet-iptal-admin");
    if (!btn) return;

    btn.addEventListener("click", () => {
      formWrap.hidden = !formWrap.hidden;
      if (!formWrap.hidden) konuInput.focus();
    });
    iptalBtn.addEventListener("click", () => {
      formWrap.hidden = true;
      yForm.reset();
    });
    yForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const konu = konuInput.value.trim();
      if (!konu || !SECILI_UYE) return;
      const sBtn = yForm.querySelector('button[type="submit"]');
      sBtn.disabled = true;
      const { data, error } = await supabase.rpc("baslat_konusma", {
        p_konu: konu,
        p_hedef_kullanici_id: SECILI_UYE.id,
      });
      sBtn.disabled = false;
      if (error) {
        showMessage(msg, "Sohbet başlatılamadı: " + error.message);
        return;
      }
      await konusmalariYukle();
      konusmaSec(data);
    });
  }

  async function mesajlariYukle() {
    if (!SECILI_KONUSMA) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", SECILI_KONUSMA)
      .order("created_at", { ascending: true });
    if (error) {
      threadListEl.innerHTML = `<p class="chat-bos">Mesajlar yüklenemedi.</p>`;
      return;
    }
    mesajListesiniCiz(threadListEl, data, adminId);
  }

  function konusmaSec(id) {
    SECILI_KONUSMA = id;
    const k = KONUSMALAR.find((x) => x.id === id);
    baslikEl.textContent = k ? `${PROFIL_ADLARI[k.user_id] || "Bilinmeyen üye"} — ${k.konu}` : "Konuşma";
    form.hidden = false;
    listPaneEl.querySelectorAll(".msg-konusma-item").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    panelEl.classList.add("msg-panel--thread-aktif"); // dar ekranda thread görünümüne geç
    mesajlariYukle();
  }

  geriBtn?.addEventListener("click", () => panelEl.classList.remove("msg-panel--thread-aktif"));

  /* ---- Üye arama (isim veya e-posta) ---- */
  let aramaZamanlayici = null;
  aramaInput?.addEventListener("input", () => {
    clearTimeout(aramaZamanlayici);
    const q = aramaInput.value.trim();
    if (!q) {
      aramaSonucEl.hidden = true;
      aramaSonucEl.innerHTML = "";
      return;
    }
    aramaZamanlayici = setTimeout(async () => {
      const guvenliQ = q.replace(/[%,]/g, "");
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .or(`email.ilike.%${guvenliQ}%,full_name.ilike.%${guvenliQ}%`)
        .limit(8);

      if (!data || data.length === 0) {
        aramaSonucEl.innerHTML = `<p class="chat-bos" style="padding:8px 10px;">Eşleşen üye yok.</p>`;
        aramaSonucEl.hidden = false;
        return;
      }
      aramaSonucEl.innerHTML = data
        .map(
          (u) => `
        <button type="button" class="msg-uye-sonuc-item" data-id="${u.id}" data-isim="${escapeHtml(u.full_name || u.email)}">
          <span class="msg-uye-sonuc-isim">${escapeHtml(u.full_name || "—")}</span>
          <span class="muted">${escapeHtml(u.email)}</span>
        </button>`
        )
        .join("");
      aramaSonucEl.hidden = false;
      aramaSonucEl.querySelectorAll(".msg-uye-sonuc-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          SECILI_UYE = { id: btn.dataset.id, isim: btn.dataset.isim };
          aramaSonucEl.hidden = true;
          aramaSonucEl.innerHTML = "";
          aramaInput.value = "";
          konusmaListesiniCiz();
        });
      });
    }, 250);
  });
  document.addEventListener("click", (e) => {
    if (aramaSonucEl && !aramaSonucEl.hidden && !aramaSonucEl.contains(e.target) && e.target !== aramaInput) {
      aramaSonucEl.hidden = true;
    }
  });

  await konusmalariYukle();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!SECILI_KONUSMA) return;
    const body = textarea.value.trim();
    if (!body) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await supabase.from("messages").insert({
      conversation_id: SECILI_KONUSMA,
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
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => konusmalariYukle())
    .subscribe();

  setInterval(() => {
    konusmalariYukle();
    mesajlariYukle();
  }, 10000);
}
