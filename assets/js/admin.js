/*
 * assets/js/admin.js — /admin.html
 * Sadece role='admin' olan kullanıcılar bu sayfaya girebilir (requireAuth
 * ile zorlanır, RLS ile de veritabanı seviyesinde garanti edilir).
 *
 * Bölüm (section) bazlı gezinme (sol menü), üye arama (isim/mail), içerik
 * DÜZENLEME, içerik atarken üye başına son geçerlilik TARİH+SAAT'i (Türkiye
 * saatine göre) veya "Süresiz" seçeneği, atama listesinde de isim/e-posta
 * arama, her içerik için üye bazlı OKUNDU/erişim detayları, üye silme
 * (kendi hesabı dahil), süresi geçmiş erişimlerin otomatik temizliği ve
 * üye <-> yönetici mesajlaşma gelen kutusu.
 *
 * NOT: "Hakkımda" metni düzenleme özelliği KALDIRILDI (istek üzerine) —
 * site geneli "Hakkımda" artık sadece repo içindeki
 * _includes/hakkimda-icerik.md dosyasından, doğrudan koda dokunarak
 * güncellenir.
 */
import { supabase, showMessage, escapeHtml } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";
import { wireAdminChat } from "./chat.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";

let TUM_KULLANICILAR = [];
let DUZENLENEN_ICERIK_ID = null; // null: yeni içerik ekleniyor, doluysa düzenleniyor

// Atama listesindeki her üye için { checked, tarih } durumunu, arama
// kutusuyla filtrelense/DOM'dan kaybolsa bile KORUMAK için burada tutuyoruz.
let ATAMA_DURUMU = new Map();

async function init() {
  const { session } = await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  wireSectionNav();
  await temizleSuresiGecmisErisimler();
  await loadUsers();
  await loadContents();
  wireUserSearch();
  wireIcerikAtamaArama();
  wireContentForm();
  wireCurrentAdminSelfDelete(session);
  await wireAdminChat(session.user.id);
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
    .select("id, email, full_name, role, created_at, kvkk_onay_verildi, kvkk_onay_tarihi")
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
        <td>${
          u.kvkk_onay_verildi
            ? `✓<br><span class="muted" style="font-size:0.78rem;">${new Date(u.kvkk_onay_tarihi).toLocaleDateString("tr-TR")}</span>`
            : '<span class="muted">Yok</span>'
        }</td>
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

/* ---------------------------------------------------------------------- */
/* ÖZEL İÇERİK ATAMA LİSTESİ: arama + tarih&saat/"Süresiz"                 */
/* ---------------------------------------------------------------------- */
function renderContentAssigneeOptions(kullanicilar) {
  const atamaWrap = document.getElementById("icerik-atama-liste");
  if (!atamaWrap) return;

  const hedefKullanicilar = kullanicilar.filter((u) => u.role === "special_user" || u.role === "admin");

  // ATAMA_DURUMU'nda artık listede olmayan (rolü değişmiş/silinmiş) üyeleri temizle
  const gecerliIdler = new Set(hedefKullanicilar.map((u) => u.id));
  for (const id of ATAMA_DURUMU.keys()) {
    if (!gecerliIdler.has(id)) ATAMA_DURUMU.delete(id);
  }

  atamaListesiCiz(hedefKullanicilar);
}

function atamaListesiCiz(hedefKullanicilar) {
  const atamaWrap = document.getElementById("icerik-atama-liste");
  if (!atamaWrap) return;

  if (hedefKullanicilar.length === 0) {
    atamaWrap.innerHTML = `<p class="muted">Önce yukarıdan en az bir üyeyi "Özel Üye" veya "Yönetici" yapmalısın.</p>`;
    return;
  }

  atamaWrap.innerHTML = hedefKullanicilar
    .map((u) => {
      const durum = ATAMA_DURUMU.get(u.id) || { checked: false, tarih: "" };
      const suresiz = !durum.tarih;
      return `
      <label class="atama-satiri">
        <input type="checkbox" class="atama-checkbox" value="${u.id}" ${durum.checked ? "checked" : ""}>
        <span>${escapeHtml(u.full_name || u.email)} <span class="muted">(${escapeHtml(u.email)})</span></span>
        <span class="atama-tarih-alani">
          <input
            type="datetime-local"
            class="atama-tarih"
            data-user-id="${u.id}"
            value="${durum.tarih}"
            title="Bu üye için erişim son tarihi/saati (Türkiye saati) — boş = sınırsız">
          <button type="button" class="atama-tarih-suresiz-btn ${suresiz ? "active" : ""}" data-user-id="${u.id}">
            ${suresiz ? "✓ Süresiz" : "Süresiz Yap"}
          </button>
        </span>
      </label>`;
    })
    .join("");

  atamaWrap.querySelectorAll(".atama-checkbox").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      const durum = ATAMA_DURUMU.get(cb.value) || { checked: false, tarih: "" };
      durum.checked = cb.checked;
      ATAMA_DURUMU.set(cb.value, durum);
    });
  });

  atamaWrap.querySelectorAll(".atama-tarih").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      const id = input.dataset.userId;
      const durum = ATAMA_DURUMU.get(id) || { checked: false, tarih: "" };
      durum.tarih = input.value;
      ATAMA_DURUMU.set(id, durum);
      // Bir tarih girildiyse "Süresiz" etiketini otomatik güncelle
      const btn = atamaWrap.querySelector(`.atama-tarih-suresiz-btn[data-user-id="${id}"]`);
      if (btn) {
        const suresiz = !input.value;
        btn.classList.toggle("active", suresiz);
        btn.textContent = suresiz ? "✓ Süresiz" : "Süresiz Yap";
      }
    });
  });

  atamaWrap.querySelectorAll(".atama-tarih-suresiz-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.userId;
      const input = atamaWrap.querySelector(`.atama-tarih[data-user-id="${id}"]`);
      input.value = "";
      const durum = ATAMA_DURUMU.get(id) || { checked: false, tarih: "" };
      durum.tarih = "";
      ATAMA_DURUMU.set(id, durum);
      btn.classList.add("active");
      btn.textContent = "✓ Süresiz";
    });
  });
}

/** İçerik atama listesinde isim/e-posta ile arama — seçim durumu (checkbox +
 * tarih), ATAMA_DURUMU Map'inde tutulduğu için filtrelense/listeden
 * kaybolsa bile KAYBOLMAZ. */
function wireIcerikAtamaArama() {
  const input = document.getElementById("icerik-atama-arama");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const hedefKullanicilar = TUM_KULLANICILAR.filter((u) => u.role === "special_user" || u.role === "admin");
    const filtrelenmis = q
      ? hedefKullanicilar.filter(
          (u) => (u.email || "").toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q)
        )
      : hedefKullanicilar;
    atamaListesiCiz(filtrelenmis);
  });
}

/**
 * "2026-08-09T23:59" gibi bir datetime-local değerini, kullanıcının
 * TARAYICI saat dilimi NE OLURSA OLSUN, Türkiye saati (UTC+3, 2016'dan beri
 * yaz saati uygulanmıyor) olarak yorumlayıp doğru UTC ISO string'e çevirir.
 * ("ben de sınırlı süre gönderim yaparken saat de seçebileyim, Türkiye
 * saatine göre" isteği.)
 */
function turkiyeSaatindenIsoyeCevir(datetimeLocalDegeri) {
  if (!datetimeLocalDegeri) return null;
  // "YYYY-MM-DDTHH:mm" -> ISO 8601 + açık +03:00 ofseti
  const saniyeli = datetimeLocalDegeri.length === 16 ? datetimeLocalDegeri + ":00" : datetimeLocalDegeri;
  return new Date(saniyeli + "+03:00").toISOString();
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

    // Seçimler artık DOM'dan değil ATAMA_DURUMU'ndan okunuyor — arama
    // kutusuyla listeyi filtrelemiş olsan bile seçtiklerin/tarihlerin
    // kaybolmaması için (bkz. wireIcerikAtamaArama).
    const secilenler = [...ATAMA_DURUMU.entries()]
      .filter(([, durum]) => durum.checked)
      .map(([userId, durum]) => ({
        userId,
        sonGecerlilik: turkiyeSaatindenIsoyeCevir(durum.tarih),
      }));

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let content;
    if (DUZENLENEN_ICERIK_ID) {
      // ---- DÜZENLEME MODU ----
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
      // NOT: slug çakışması artık veritabanı tarafında (special_content
      // tablosundaki "benzersiz_slug_uret" trigger'ı, bkz. migration 0004)
      // OTOMATİK çözülüyor — aynı başlıkla ikinci bir içerik eklesen bile
      // slug kendiliğinden "...-2", "...-3" olur, "duplicate key" hatası
      // artık alınmaz.
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
    // DOKUNMUYORUZ, sadece yeni seçilenleri EKLİYORUZ/GÜNCELLİYORUZ —
    // mevcut bir erişimi tamamen kaldırmak için "Erişimleri Yönet" panelini
    // kullan).
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
  ATAMA_DURUMU = new Map();
  document.getElementById("icerik-atama-arama") && (document.getElementById("icerik-atama-arama").value = "");
  renderContentAssigneeOptions(TUM_KULLANICILAR);
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
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn-primary icerik-duzenle-btn" data-id="${c.id}" style="width:auto;padding:8px 14px;">Düzenle</button>
          <button class="erisim-detay-ac-btn icerik-detay-btn" data-id="${c.id}">Erişim &amp; Okundu Detayları</button>
          <button class="btn-danger icerik-sil-btn" data-id="${c.id}" style="width:auto;padding:8px 14px;">Sil</button>
        </div>
        <div class="icerik-detay-alani" data-id="${c.id}" hidden></div>
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

  list.querySelectorAll(".icerik-detay-btn").forEach((btn) => {
    btn.addEventListener("click", () => icerikDetaylariniGosterGizle(btn.dataset.id, btn));
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

/**
 * "Admin bunu göremiyor. Admin saat kaçta açıldı vs kadar görebilsin —
 * her kullanıcı için ayrı bilgiler görünsün" isteği: bir içeriğin kimlere
 * atandığını, her biri için okundu mu/ne zaman okundu ve erişim son
 * tarihini gösteren açılır-kapanır bir tablo. Buradan tek tek erişim de
 * kaldırılabilir.
 */
async function icerikDetaylariniGosterGizle(contentId, btn) {
  const alan = document.querySelector(`.icerik-detay-alani[data-id="${contentId}"]`);
  if (!alan) return;

  if (!alan.hidden) {
    alan.hidden = true;
    return;
  }

  alan.hidden = false;
  await icerikDetaylariniYukle(contentId, alan, btn);
}

async function icerikDetaylariniYukle(contentId, alan, btn) {
  alan.innerHTML = `<p class="muted">Yükleniyor...</p>`;

  const { data, error } = await supabase
    .from("content_access")
    .select("user_id, okundu_mu, okundu_tarihi, son_gecerlilik_tarihi, profiles(full_name, email)")
    .eq("content_id", contentId)
    .order("okundu_mu", { ascending: true });

  if (error) {
    alan.innerHTML = `<p class="muted">Detaylar yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    alan.innerHTML = `<p class="muted">Bu içerik henüz kimseye atanmamış.</p>`;
    return;
  }

  alan.innerHTML = `
    <table class="erisim-detay-tablo">
      <thead>
        <tr><th>Üye</th><th>Okundu mu?</th><th>Ne zaman açıldı</th><th>Erişim sonu</th><th></th></tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
          <tr data-user-id="${row.user_id}">
            <td>${escapeHtml(row.profiles?.full_name || row.profiles?.email || "—")}</td>
            <td>${row.okundu_mu ? "✓ Okudu" : '<span class="muted">Henüz açmadı</span>'}</td>
            <td>${row.okundu_tarihi ? new Date(row.okundu_tarihi).toLocaleString("tr-TR") : '<span class="muted">—</span>'}</td>
            <td>${row.son_gecerlilik_tarihi ? new Date(row.son_gecerlilik_tarihi).toLocaleString("tr-TR") : "Süresiz"}</td>
            <td><button class="btn-danger erisim-kaldir-btn" data-content-id="${contentId}" data-user-id="${row.user_id}" style="padding:4px 8px;font-size:0.76rem;">Erişimi Kaldır</button></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;

  alan.querySelectorAll(".erisim-kaldir-btn").forEach((kbtn) => {
    kbtn.addEventListener("click", async () => {
      if (!confirm("Bu üyenin erişimini kaldırmak istediğine emin misin?")) return;
      await supabase
        .from("content_access")
        .delete()
        .eq("content_id", kbtn.dataset.contentId)
        .eq("user_id", kbtn.dataset.userId);
      await icerikDetaylariniYukle(contentId, alan, btn);
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

init();
