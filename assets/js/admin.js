/*
 * assets/js/admin.js — /admin.html
 * Sadece role='admin' olan kullanıcılar bu sayfaya girebilir (requireAuth
 * ile zorlanır, RLS ile de veritabanı seviyesinde garanti edilir).
 */
import { supabase, showMessage, escapeHtml } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

async function init() {
  await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  await loadUsers();
  await loadContents();
  await loadSettings();
  wireContentForm();
  wireSettingsForm();
}

/* ---------------------------------------------------------------------- */
/* KULLANICI / ROL YÖNETİMİ                                                */
/* ---------------------------------------------------------------------- */
async function loadUsers() {
  const tbody = document.getElementById("kullanici-tablo-govde");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Kullanıcılar yüklenemedi: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  tbody.innerHTML = data
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
        <td><span class="rol-durum" data-id="${u.id}"></span></td>
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
      setTimeout(() => (durum.textContent = ""), 2500);
    });
  });

  // Özel içerik atama formundaki kullanıcı seçim listesini de dolduruyoruz
  const atamaSelect = document.getElementById("icerik-atama-kullanici");
  if (atamaSelect) {
    atamaSelect.innerHTML = data
      .filter((u) => u.role === "special_user" || u.role === "admin")
      .map((u) => `<option value="${u.id}">${escapeHtml(u.full_name || u.email)}</option>`)
      .join("");
  }
}

/* ---------------------------------------------------------------------- */
/* ÖZEL İÇERİK / DOSYA YÖNETİMİ                                            */
/* ---------------------------------------------------------------------- */
function wireContentForm() {
  const form = document.getElementById("icerik-form");
  const msg = document.getElementById("icerik-message");

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
    // Bkz. README > "Çok Büyük Dosyalar (Cloudflare R2)".
    const harici_dosya_url = form.harici_dosya_url.value.trim() || null;
    const secilenKullanicilar = Array.from(
      form.querySelector("#icerik-atama-kullanici").selectedOptions
    ).map((o) => o.value);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1) İçerik satırını oluştur
    const { data: content, error: insertErr } = await supabase
      .from("special_content")
      .insert({ title, slug, summary, body_md, harici_dosya_url, author_id: user.id })
      .select()
      .single();

    if (insertErr) {
      showMessage(msg, "İçerik kaydedilemedi: " + insertErr.message);
      submitBtn.disabled = false;
      return;
    }

    // 2) Dosya varsa, "ozel-dosyalar" bucket'ına content.id klasörü altına yükle
    if (file) {
      const path = `${content.id}/${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("ozel-dosyalar")
        .upload(path, file, { upsert: true });

      if (uploadErr) {
        showMessage(msg, "İçerik oluştu ama dosya yüklenemedi: " + uploadErr.message);
      } else {
        await supabase.from("special_content").update({ file_path: path }).eq("id", content.id);
      }
    }

    // 3) Seçilen özel üyelere erişim ver
    if (secilenKullanicilar.length > 0) {
      const rows = secilenKullanicilar.map((userId) => ({
        content_id: content.id,
        user_id: userId,
        granted_by: user.id,
      }));
      const { error: accessErr } = await supabase.from("content_access").insert(rows);
      if (accessErr) showMessage(msg, "Erişim atamasında hata: " + accessErr.message);
    }

    showMessage(msg, "İçerik yayınlandı ve seçilen üyelere atandı.", "success");
    form.reset();
    submitBtn.disabled = false;
    await loadContents();
  });
}

async function loadContents() {
  const list = document.getElementById("icerik-liste");
  const { data, error } = await supabase
    .from("special_content")
    .select("id, title, slug, is_published, created_at, content_access(count)")
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
        <button class="load-more-btn icerik-sil-btn" data-id="${c.id}">Sil</button>
      </div>`
    )
    .join("");

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
