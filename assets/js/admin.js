/*
 * assets/js/admin.js — /admin.html
 * Sadece role='admin' olan kullanıcılar bu sayfaya girebilir (requireAuth
 * ile zorlanır, RLS ile de veritabanı seviyesinde garanti edilir).
 *
 * Bu sürüm: bölüm (section) bazlı gezinme (sol menü, tıklayınca o bölüme
 * kayar — sayfa artık tek bir uzun kaydırma değil), üye arama (isim/mail),
 * içerik DÜZENLEME (sadece silme değil), içerik atarken üye başına son
 * geçerlilik tarihi, üye silme (kendi hesabı dahil), ve süresi geçmiş
 * erişimlerin otomatik temizliği.
 */
import { supabase, showMessage, escapeHtml } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

let TUM_KULLANICILAR = [];
let DUZENLENEN_ICERIK_ID = null; // null: yeni içerik ekleniyor, doluysa düzenleniyor

async function init() {
  const { session } = await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  wireSectionNav();
  await temizleSuresiGecmisErisimler();
  await loadUsers();
  await loadContents();
  await loadSettings();
  wireUserSearch();
  wireContentForm();
  wireSettingsForm();
  wireCurrentAdminSelfDelete(session);
}

/* ---------------------------------------------------------------------- */
/* BÖLÜM (SECTION) BAZLI GEZİNME                                          */
/* ---------------------------------------------------------------------- */
function wireSectionNav() {
  const nav = document.getElementById("admin-nav");
  if (!nav) return;

  nav.querySelectorAll("a[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = link.dataset.section;
      const hedef = document.getElementById(id);
      if (!hedef) return;
      hedef.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
      link.classList.add("active");
      history.replaceState(null, "", `#${id}`);
    });
  });

  // Sayfa bir hash ile açıldıysa (ör. admin.html#icerikler) doğrudan oraya git
  if (window.location.hash) {
    const link = nav.querySelector(`a[data-section="${window.location.hash.slice(1)}"]`);
    link?.click();
  }
}

/* ---------------------------------------------------------------------- */
/* SÜRESİ GEÇMİŞ ÖZEL İÇERİK ERİŞİMLERİNİN OTOMATİK TEMİZLİĞİ              */
/* ---------------------------------------------------------------------- */
async function temizleSuresiGecmisErisimler() {
  // "Sistem önce kendi oto kontrol etsin, sonra silinsin" isteğinin
  // fiziksel silme kısmı: admin panel her açıldığında bir kere çalışır.
  // Erişimin FİİLEN kesilmesi zaten RLS ile anında olur (has_content_access
  // fonksiyonu süresi geçmiş satırları saymaz) — bu sadece veritabanını
  // temiz tutmak için ek bir adım.
  const { data, error } = await supabase.rpc("temizle_suresi_gecmis_erisimleri");
  if (!error && typeof data === "number" && data > 0) {
    console.info(`${data} adet süresi geçmiş özel içerik erişimi otomatik temizlendi.`);
  }
}

/* ---------------------------------------------------------------------- */
/* KULLANICI / ROL YÖNETİMİ + ARAMA                                       */
/* ---------------------------------------------------------------------- */
async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at, kvkk_onay_verildi")
    .order("created_at", { ascending: false });

  const tbody = document.getElementById("kullanici-tablo-govde");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Kullanıcılar yüklenemedi: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  TUM_KULLANICILAR = data || [];
  renderUserTable(TUM_KULLANICILAR);
  renderContentAssigneeOptions(TUM_KULLANICILAR);
}

function wireUserSearch() {
  const input = document.getElementById("kullanici-arama");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      renderUserTable(TUM_KULLANICILAR);
      return;
    }
    const filtrelenmis = TUM_KULLANICILAR.filter(
      (u) =>
        (u.email || "").toLowerCase().includes(q) ||
        (u.full_name || "").toLowerCase().includes(q)
    );
    renderUserTable(filtrelenmis);
  });
}

function renderUserTable(kullanicilar) {
  const tbody = document.getElementById("kullanici-tablo-govde");

  if (kullanicilar.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Eşleşen kullanıcı yok.</td></tr>`;
    return;
  }

  tbody.innerHTML = kullanicilar
    .map(
      (u) => `
      <tr data-id="${u.id}">
        <td>${escapeHtml(u.full_name || "—")}<br><span class="muted">${escapeHtml(u.email)}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString("tr-TR")}</td>
        <td>
          <select class="rol-select" data-id="${u.id}">
            <option value="user" ${u.role === "user" ? "selected" : ""}>Üye</option>
            <option value="special_user" ${u.role === "special_user" ? "selected" : ""}>Özel Üye</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Yönetici</option>
          </select>
        </td>
        <td>${u.kvkk_onay_verildi ? "✓" : '<span class="muted">Yok</span>'}</td>
        <td>
          <span class="rol-durum" data-id="${u.id}"></span>
          <button class="btn-danger uye-sil-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}" style="padding:6px 10px;font-size:0.8rem;">Sil</button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll(".rol-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const userId = select.dataset.id;
      const yeniRol = select.value;
      const durum = tbody.querySelector(`.rol-durum[data-id="${userId}"]`);

      const { error } = await supabase.rpc("admin_set_user_role", {
        p_user_id: userId,
        p_new_role: yeniRol,
      });

      durum.textContent = error ? "Hata!" : "Kaydedildi ✓";
      durum.className = error ? "rol-durum rol-durum--hata" : "rol-durum rol-durum--ok";
      if (error) console.error(error);
      else {
        const kullanici = TUM_KULLANICILAR.find((u) => u.id === userId);
        if (kullanici) kullanici.role = yeniRol;
        renderContentAssigneeOptions(TUM_KULLANICILAR);
      }
      setTimeout(() => (durum.textContent = ""), 2500);
    });
  });

  tbody.querySelectorAll(".uye-sil-btn").forEach((btn) => {
    btn.addEventListener("click", () => uyeyiSil(btn.dataset.id, btn.dataset.email));
  });
}

async function uyeyiSil(userId, email) {
  if (!confirm(`${email} adlı üyeyi ve TÜM verilerini kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`)) {
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  try {
    const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hedef_kullanici_id: userId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Bilinmeyen hata");

    TUM_KULLANICILAR = TUM_KULLANICILAR.filter((u) => u.id !== userId);
    renderUserTable(TUM_KULLANICILAR);
    renderContentAssigneeOptions(TUM_KULLANICILAR);
  } catch (err) {
    alert("Üye silinemedi: " + err.message);
  }
}

/** Admin, kendi hesabını da (panelim sayfasındaki yolla aynı Edge Function
 * üzerinden) silebilsin diye admin.md içindeki "Hesabım" bölümüne bağlanan
 * ayrı bir buton. */
function wireCurrentAdminSelfDelete(session) {
  const btn = document.getElementById("admin-kendi-hesap-sil-btn");
  const confirmInput = document.getElementById("admin-kendi-hesap-sil-onay");
  const msg = document.getElementById("admin-kendi-hesap-sil-message");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (confirmInput.value.trim().toUpperCase() !== "SİL") {
      showMessage(msg, 'Onaylamak için kutuya büyük harflerle "SİL" yaz.');
      return;
    }
    if (
      !confirm(
        "Bu işlem GERİ ALINAMAZ. Yönetici hesabın ve tüm verilerin silinecek. Başka bir admin yoksa siteyi yönetecek kimse kalmayacak. Emin misin?"
      )
    ) {
      return;
    }

    btn.disabled = true;
    try {
      const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}), // hedef yok -> kendini sil
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bilinmeyen hata");

      await supabase.auth.signOut();
      alert("Hesabın silindi. Anasayfaya yönlendiriliyorsun.");
      window.location.href = "/";
    } catch (err) {
      showMessage(msg, "Hesap silinemedi: " + err.message);
      btn.disabled = false;
    }
  });
}

function renderContentAssigneeOptions(kullanicilar) {
  const atamaWrap = document.getElementById("icerik-atama-liste");
  if (!atamaWrap) return;

  const hedefKullanicilar = kullanicilar.filter((u) => u.role === "special_user" || u.role === "admin");

  if (hedefKullanicilar.length === 0) {
    atamaWrap.innerHTML = `<p class="muted">Önce yukarıdan en az bir üyeyi "Özel Üye" veya "Yönetici" yapmalısın.</p>`;
    return;
  }

  atamaWrap.innerHTML = hedefKullanicilar
    .map(
      (u) => `
      <label class="atama-satiri">
        <input type="checkbox" class="atama-checkbox" value="${u.id}">
        <span>${escapeHtml(u.full_name || u.email)} <span class="muted">(${escapeHtml(u.email)})</span></span>
        <span class="atama-tarih-alani">
          <input type="date" class="atama-tarih" data-user-id="${u.id}" title="Bu üye için erişim son tarihi (boş = sınırsız)">
        </span>
      </label>`
    )
    .join("");
}

/* ---------------------------------------------------------------------- */
/* ÖZEL İÇERİK / DOSYA YÖNETİMİ (EKLEME + DÜZENLEME)                       */
/* ---------------------------------------------------------------------- */
function wireContentForm() {
  const form = document.getElementById("icerik-form");
  const msg = document.getElementById("icerik-message");
  const iptalBtn = document.getElementById("icerik-duzenle-iptal-btn");

  iptalBtn?.addEventListener("click", () => sifirlaIcerikFormu());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const title = form.title.value.trim();
    const slug = form.slug.value.trim() || slugify(title);
    const summary = form.summary.value.trim();
    const body_md = form.body_md.value;
    const file = form.dosya.files?.[0];
    // 50GB gibi çok büyük dosyalar Supabase Storage'a doğrudan yüklenmek
    // yerine Cloudflare R2'ye (veya benzeri bir servise) elle yüklenip
    // buraya sadece LİNKİ yapıştırılır. Boş bırakılırsa özellik kullanılmaz.
    const harici_dosya_url = form.harici_dosya_url.value.trim() || null;

    const secilenler = Array.from(form.querySelectorAll(".atama-checkbox:checked")).map((cb) => {
      const tarihInput = form.querySelector(`.atama-tarih[data-user-id="${cb.value}"]`);
      const tarih = tarihInput?.value ? new Date(tarihInput.value + "T23:59:59").toISOString() : null;
      return { userId: cb.value, sonGecerlilik: tarih };
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let content;
    if (DUZENLENEN_ICERIK_ID) {
      // ---- DÜZENLEME MODU: "Geri düzeltme" isteği ----
      const { data: guncellenen, error: updateErr } = await supabase
        .from("special_content")
        .update({ title, slug, summary, body_md, harici_dosya_url })
        .eq("id", DUZENLENEN_ICERIK_ID)
        .select()
        .single();

      if (updateErr) {
        showMessage(msg, "İçerik güncellenemedi: " + updateErr.message);
        submitBtn.disabled = false;
        return;
      }
      content = guncellenen;
    } else {
      // ---- YENİ İÇERİK ----
      const { data: yeni, error: insertErr } = await supabase
        .from("special_content")
        .insert({ title, slug, summary, body_md, harici_dosya_url, author_id: user.id })
        .select()
        .single();

      if (insertErr) {
        showMessage(msg, "İçerik kaydedilemedi: " + insertErr.message);
        submitBtn.disabled = false;
        return;
      }
      content = yeni;
    }

    // Dosya varsa, "ozel-dosyalar" bucket'ına content.id klasörü altına yükle
    if (file) {
      const path = `${content.id}/${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("ozel-dosyalar")
        .upload(path, file, { upsert: true });

      if (uploadErr) {
        showMessage(msg, "İçerik kaydedildi ama dosya yüklenemedi: " + uploadErr.message);
      } else {
        await supabase.from("special_content").update({ file_path: path }).eq("id", content.id);
      }
    }

    // Seçilen özel üyelere erişim ver (düzenleme modunda önceki atamalara
    // DOKUNMUYORUZ, sadece yeni seçilenleri EKLİYORUZ — mevcut erişimleri
    // kaldırmak istersen "Mevcut Özel İçerikler" listesindeki "Erişimleri
    // Yönet" bağlantısını kullan).
    if (secilenler.length > 0) {
      const rows = secilenler.map(({ userId, sonGecerlilik }) => ({
        content_id: content.id,
        user_id: userId,
        granted_by: user.id,
        son_gecerlilik_tarihi: sonGecerlilik,
      }));
      const { error: accessErr } = await supabase
        .from("content_access")
        .upsert(rows, { onConflict: "content_id,user_id" });
      if (accessErr) showMessage(msg, "Erişim atamasında hata: " + accessErr.message);
    }

    showMessage(
      msg,
      DUZENLENEN_ICERIK_ID ? "İçerik güncellendi." : "İçerik yayınlandı ve seçilen üyelere atandı.",
      "success"
    );
    sifirlaIcerikFormu();
    submitBtn.disabled = false;
    await loadContents();
  });
}

function sifirlaIcerikFormu() {
  const form = document.getElementById("icerik-form");
  form.reset();
  form.querySelectorAll(".atama-checkbox").forEach((cb) => (cb.checked = false));
  form.querySelectorAll(".atama-tarih").forEach((input) => (input.value = ""));
  DUZENLENEN_ICERIK_ID = null;
  document.getElementById("icerik-form-baslik").textContent = "Yeni Özel İçerik / Makale Ekle";
  document.getElementById("icerik-form-submit-btn").textContent = "Yayınla ve Ata";
  document.getElementById("icerik-duzenle-iptal-btn").hidden = true;
}

async function loadContents() {
  const list = document.getElementById("icerik-liste");
  const { data, error } = await supabase
    .from("special_content")
    .select("id, title, slug, summary, body_md, harici_dosya_url, is_published, created_at, content_access(count)")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<p class="muted">Yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }

  list.innerHTML = data
    .map(
      (c) => `
      <div class="post-card">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="meta">
          ${new Date(c.created_at).toLocaleDateString("tr-TR")} ·
          ${c.content_access?.[0]?.count ?? 0} kullanıcıya atanmış ·
          ${c.is_published ? "Yayında" : "Taslak"}
        </p>
        <div style="display:flex; gap:8px;">
          <button class="btn-primary icerik-duzenle-btn" data-id="${c.id}" style="width:auto;padding:8px 14px;">Düzenle</button>
          <button class="btn-danger icerik-sil-btn" data-id="${c.id}" style="width:auto;padding:8px 14px;">Sil</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".icerik-duzenle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = data.find((x) => x.id === btn.dataset.id);
      if (!c) return;
      DUZENLENEN_ICERIK_ID = c.id;
      const form = document.getElementById("icerik-form");
      form.title.value = c.title;
      form.slug.value = c.slug;
      form.summary.value = c.summary ?? "";
      form.body_md.value = c.body_md ?? "";
      form.harici_dosya_url.value = c.harici_dosya_url ?? "";
      document.getElementById("icerik-form-baslik").textContent = `Düzenle: ${c.title}`;
      document.getElementById("icerik-form-submit-btn").textContent = "Değişiklikleri Kaydet";
      document.getElementById("icerik-duzenle-iptal-btn").hidden = false;
      document.getElementById("icerik-ekle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  list.querySelectorAll(".icerik-sil-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Bu içeriği ve dosyasını kalıcı olarak silmek istediğine emin misin?")) return;
      const id = btn.dataset.id;
      // Storage'daki dosyaları da temizle
      const { data: files } = await supabase.storage.from("ozel-dosyalar").list(id);
      if (files && files.length > 0) {
        await supabase.storage.from("ozel-dosyalar").remove(files.map((f) => `${id}/${f.name}`));
      }
      await supabase.from("special_content").delete().eq("id", id);
      if (DUZENLENEN_ICERIK_ID === id) sifirlaIcerikFormu();
      await loadContents();
    });
  });
}

function slugify(str) {
  return str
    .toLowerCase()
    .replaceAll(/[ığüşöç]/g, (c) => ({ ı: "i", ğ: "g", ü: "u", ş: "s", ö: "o", ç: "c" }[c]))
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

/* ---------------------------------------------------------------------- */
/* SİTE AYARLARI ("Hakkımda" metni)                                        */
/* ---------------------------------------------------------------------- */
async function loadSettings() {
  const { data } = await supabase.from("site_settings").select("hakkimda_md").eq("id", 1).single();
  const textarea = document.getElementById("hakkimda-textarea");
  if (textarea && data) textarea.value = data.hakkimda_md ?? "";
}

function wireSettingsForm() {
  const form = document.getElementById("ayarlar-form");
  const msg = document.getElementById("ayarlar-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hakkimda_md = document.getElementById("hakkimda-textarea").value;
    const { error } = await supabase.from("site_settings").update({ hakkimda_md }).eq("id", 1);
    if (error) {
      showMessage(msg, "Kaydedilemedi: " + error.message);
      return;
    }
    showMessage(msg, "Hakkımda metni güncellendi. Anasayfada birkaç saniye içinde görünür.", "success");
  });
}

init();
