/*
 * assets/js/uye-ayarlari.js — /panel/uye-ayarlari.html
 *
 * "Kullanıcılar & Roller" bölümü admin.md'den BURAYA taşındı (bkz. panel/
 * uye-ayarlari.md başındaki not). Taşınma sebebi: üye sayısı 100+'a
 * çıkınca tek sayfalık dev bir tablo hem admin panelinin diğer bölümlerini
 * (içerik yönetimi, dosya paylaşımı) aşağı itiyor hem de kendi başına
 * yönetilemez hale geliyordu. Bu sayfa SADECE admin'e açık
 * (requireAuth({role:'admin'})) — manager (İçerik Sorumlusu) buraya
 * giremez, tıpkı önceki "Kullanıcılar & Roller" sekmesinde olduğu gibi.
 *
 * Tasarım admin.md'nin sekmeli/tek-tablo görünümünden BİLİNÇLİ olarak
 * farklı: üstte özet istatistik kartları, altında arama + rol filtresi +
 * sayfa başına gösterim seçili bir araç çubuğu, sonra üye başına bir KART
 * (dev bir <table> değil) — büyük listelerde yatay kaydırma yerine dikey
 * akan, sayfalanmış (pagination) bir liste. Aynı veri (profiles), aynı
 * RPC'ler (admin_set_user_role) ve aynı Edge Function'lar
 * (admin-change-email, delete-account) — sadece görünüm/gezinme farklı.
 */
import { supabase, showMessage, escapeHtml, kucukHarfeCevirTr, kullaniciAramayaUyuyorMu } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

const DELETE_ACCOUNT_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/delete-account";
const ADMIN_CHANGE_EMAIL_FUNCTION_URL =
  "https://eahvcirspmvntffzphye.supabase.co/functions/v1/admin-change-email";

const ROL_ETIKETLERI = {
  user: "Üye",
  special_user: "Özel Üye",
  editor: "Editör",
  manager: "İçerik Sorumlusu",
  admin: "Yönetici",
};

let TUM_KULLANICILAR = [];
let ARAMA_METNI = "";
let ROL_FILTRESI = "";
let SAYFA = 1;
let SAYFA_BOYUTU = 20;

async function init() {
  await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  wireArama();
  wireRolFiltre();
  wireSayfaBoyutu();
  wireAdminEmailChange();

  await loadUsers();
  wireRealtime();
}

/* ---------------------------------------------------------------------- */
/* VERİ ÇEKME                                                              */
/* ---------------------------------------------------------------------- */
async function loadUsers() {
  const liste = document.getElementById("uya-liste");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name, full_name, role, created_at, kvkk_onay_verildi, kvkk_onay_tarihi")
    .order("created_at", { ascending: false });

  if (error) {
    liste.innerHTML = `<p class="muted">Üyeler yüklenemedi: ${escapeHtml(error.message)}</p>`;
    return;
  }

  TUM_KULLANICILAR = data || [];
  renderStats(TUM_KULLANICILAR);
  renderListe();
}

// Başka bir sekmede/panelde bir üyenin rolü/adı/e-postası değişirse bu sayfa
// otomatik tazelenir. admin.js'deki aynı desenle (kısa debounce, tekrar
// tekrar abone olunmasın diye bayrak) birebir aynı mantık.
let REALTIME_KURULDU = false;
let REALTIME_TIMER = null;
function wireRealtime() {
  if (REALTIME_KURULDU) return;
  REALTIME_KURULDU = true;
  supabase
    .channel("uye-ayarlari-profiles-degisiklik")
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
      clearTimeout(REALTIME_TIMER);
      REALTIME_TIMER = setTimeout(() => loadUsers(), 600);
    })
    .subscribe();
}

/* ---------------------------------------------------------------------- */
/* İSTATİSTİK ŞERİDİ                                                       */
/* ---------------------------------------------------------------------- */
function renderStats(kullanicilar) {
  const stats = document.getElementById("uya-stats");
  if (!stats) return;

  const sayilar = { user: 0, special_user: 0, editor: 0, manager: 0, admin: 0 };
  kullanicilar.forEach((u) => {
    if (sayilar[u.role] !== undefined) sayilar[u.role]++;
  });

  const kartlar = [
    `<div class="uya-stat-kart uya-stat-kart--toplam">
       <span class="uya-stat-sayi">${kullanicilar.length}</span>
       <span class="uya-stat-etiket">Toplam Üye</span>
     </div>`,
    ...Object.entries(sayilar)
      .filter(([, sayi]) => sayi > 0)
      .map(
        ([rol, sayi]) => `
       <div class="uya-stat-kart">
         <span class="uya-stat-sayi">${sayi}</span>
         <span class="uya-stat-etiket">${ROL_ETIKETLERI[rol] || rol}</span>
       </div>`
      ),
  ];

  stats.innerHTML = kartlar.join("");
}

/* ---------------------------------------------------------------------- */
/* ARAMA + ROL FİLTRESİ + SAYFA BOYUTU                                     */
/* ---------------------------------------------------------------------- */
function wireArama() {
  const input = document.getElementById("uya-arama");
  if (!input) return;
  input.addEventListener("input", () => {
    ARAMA_METNI = kucukHarfeCevirTr(input.value.trim());
    SAYFA = 1;
    renderListe();
  });
}

function wireRolFiltre() {
  const select = document.getElementById("uya-rol-filtre");
  if (!select) return;
  select.addEventListener("change", () => {
    ROL_FILTRESI = select.value;
    SAYFA = 1;
    renderListe();
  });
}

function wireSayfaBoyutu() {
  const select = document.getElementById("uya-sayfa-boyutu");
  if (!select) return;
  select.addEventListener("change", () => {
    SAYFA_BOYUTU = parseInt(select.value, 10) || 20;
    SAYFA = 1;
    renderListe();
  });
}

function filtrelenmisListe() {
  let sonuc = TUM_KULLANICILAR;
  if (ROL_FILTRESI) sonuc = sonuc.filter((u) => u.role === ROL_FILTRESI);
  if (ARAMA_METNI) sonuc = sonuc.filter((u) => kullaniciAramayaUyuyorMu(u, ARAMA_METNI));
  return sonuc;
}

/* ---------------------------------------------------------------------- */
/* LİSTE + SAYFALAMA ÇİZİMİ                                                */
/* ---------------------------------------------------------------------- */
function renderListe() {
  const liste = document.getElementById("uya-liste");
  const sonucSayisiEl = document.getElementById("uya-sonuc-sayisi");
  const filtrelenmis = filtrelenmisListe();

  if (sonucSayisiEl) {
    sonucSayisiEl.textContent =
      filtrelenmis.length === TUM_KULLANICILAR.length
        ? `${filtrelenmis.length} üye`
        : `${filtrelenmis.length} üye (toplam ${TUM_KULLANICILAR.length} içinden)`;
  }

  if (filtrelenmis.length === 0) {
    liste.innerHTML = `<p class="muted uya-bos">Eşleşen üye yok.</p>`;
    renderSayfalama(0, 0);
    return;
  }

  const toplamSayfa = Math.max(1, Math.ceil(filtrelenmis.length / SAYFA_BOYUTU));
  if (SAYFA > toplamSayfa) SAYFA = toplamSayfa;
  const baslangic = (SAYFA - 1) * SAYFA_BOYUTU;
  const sayfaVerisi = filtrelenmis.slice(baslangic, baslangic + SAYFA_BOYUTU);

  liste.innerHTML = sayfaVerisi.map(uyeKartHtml).join("");
  wireKartOlaylari(liste);
  renderSayfalama(toplamSayfa, filtrelenmis.length);
}

function renderSayfalama(toplamSayfa, toplamSonuc) {
  const alan = document.getElementById("uya-sayfalama-ust");
  if (!alan) return;

  if (toplamSonuc === 0 || toplamSayfa <= 1) {
    alan.innerHTML = "";
    return;
  }

  alan.innerHTML = `
    <button type="button" class="uya-sayfa-btn" id="uya-sayfa-onceki" ${SAYFA <= 1 ? "disabled" : ""}>‹ Önceki</button>
    <span class="uya-sayfa-gosterge">Sayfa ${SAYFA} / ${toplamSayfa}</span>
    <button type="button" class="uya-sayfa-btn" id="uya-sayfa-sonraki" ${SAYFA >= toplamSayfa ? "disabled" : ""}>Sonraki ›</button>
  `;

  document.getElementById("uya-sayfa-onceki")?.addEventListener("click", () => {
    if (SAYFA <= 1) return;
    SAYFA--;
    renderListe();
    document.getElementById("uya-liste")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("uya-sayfa-sonraki")?.addEventListener("click", () => {
    SAYFA++;
    renderListe();
    document.getElementById("uya-liste")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Bir üyenin ad soyad'ından (yoksa e-postasından) baş harfleri çıkarır —
 * kart üzerindeki küçük "avatar" rozeti için. */
function baslarHarfler(u) {
  const isim = (u.full_name || u.email || "?").trim();
  const parcalar = isim.split(/\s+/).filter(Boolean);
  if (parcalar.length === 0) return "?";
  if (parcalar.length === 1) return parcalar[0][0].toUpperCase();
  return (parcalar[0][0] + parcalar[parcalar.length - 1][0]).toUpperCase();
}

function uyeKartHtml(u) {
  return `
    <div class="uya-kart" data-id="${u.id}">
      <div class="uya-kart-ust">
        <div class="uya-avatar" aria-hidden="true">${escapeHtml(baslarHarfler(u))}</div>
        <div class="uya-kart-kimlik">
          <div class="uya-isim-alani">
            <input class="uya-isim-input" data-alan="first_name" data-id="${u.id}" type="text" value="${escapeHtml(u.first_name || "")}" placeholder="Ad">
            <input class="uya-isim-input" data-alan="last_name" data-id="${u.id}" type="text" value="${escapeHtml(u.last_name || "")}" placeholder="Soyad">
          </div>
          <span class="uya-email muted" title="${escapeHtml(u.email)}">${escapeHtml(u.email)}</span>
        </div>
        <span class="uya-rol-etiket uya-rol-etiket--${u.role}">${ROL_ETIKETLERI[u.role] || u.role}</span>
      </div>

      <div class="uya-kart-meta">
        <span>Kayıt: ${new Date(u.created_at).toLocaleDateString("tr-TR")}</span>
        <span>${
          u.kvkk_onay_verildi
            ? `KVKK: ✓ ${new Date(u.kvkk_onay_tarihi).toLocaleDateString("tr-TR")}`
            : `KVKK: <span class="muted">Yok</span>`
        }</span>
      </div>

      <div class="uya-kart-alt">
        <div class="form-field uya-rol-secim">
          <label>Rol</label>
          <select class="rol-select" data-id="${u.id}">
            <option value="user" ${u.role === "user" ? "selected" : ""}>Üye</option>
            <option value="special_user" ${u.role === "special_user" ? "selected" : ""}>Özel Üye</option>
            <option value="editor" ${u.role === "editor" ? "selected" : ""}>Editör</option>
            <option value="manager" ${u.role === "manager" ? "selected" : ""}>İçerik Sorumlusu</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Yönetici</option>
          </select>
        </div>
        <div class="uya-kart-aksiyonlar">
          <span class="rol-durum" data-id="${u.id}"></span>
          <button class="btn-secondary tablo-aksiyon-btn eposta-degistir-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}" data-isim="${escapeHtml(u.full_name || u.email)}">E-posta Değiştir</button>
          <button class="btn-danger tablo-aksiyon-btn uye-sil-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}">Sil</button>
        </div>
      </div>
    </div>`;
}

function wireKartOlaylari(liste) {
  liste.querySelectorAll(".rol-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const userId = select.dataset.id;
      const yeniRol = select.value;
      const durum = liste.querySelector(`.rol-durum[data-id="${userId}"]`);

      const { error } = await supabase.rpc("admin_set_user_role", {
        p_user_id: userId,
        p_new_role: yeniRol,
      });

      if (durum) {
        durum.textContent = error ? "Hata!" : "Kaydedildi ✓";
        durum.className = error ? "rol-durum rol-durum--hata" : "rol-durum rol-durum--ok";
        setTimeout(() => (durum.textContent = ""), 2500);
      }
      if (error) {
        console.error(error);
        return;
      }
      const kullanici = TUM_KULLANICILAR.find((u) => u.id === userId);
      if (kullanici) kullanici.role = yeniRol;
      renderStats(TUM_KULLANICILAR);
      const kart = liste.querySelector(`.uya-kart[data-id="${userId}"] .uya-rol-etiket`);
      if (kart) {
        kart.className = `uya-rol-etiket uya-rol-etiket--${yeniRol}`;
        kart.textContent = ROL_ETIKETLERI[yeniRol] || yeniRol;
      }
    });
  });

  // Admin, bir üyenin Ad/Soyadını doğrudan karttan (ayrı ayrı) düzenleyip
  // kaydedebilir. change/blur'da kaydediyoruz (her tuş vuruşunda değil).
  // full_name kolonu first_name+last_name'den otomatik (generated) türetilir.
  liste.querySelectorAll(".uya-isim-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const userId = input.dataset.id;
      const alan = input.dataset.alan; // "first_name" | "last_name"
      const deger = input.value.trim();
      const durum = liste.querySelector(`.rol-durum[data-id="${userId}"]`);

      const { error } = await supabase
        .from("profiles")
        .update({ [alan]: deger || null })
        .eq("id", userId);

      if (durum) {
        durum.textContent = error ? "Hata!" : "Kaydedildi ✓";
        durum.className = error ? "rol-durum rol-durum--hata" : "rol-durum rol-durum--ok";
        setTimeout(() => (durum.textContent = ""), 2500);
      }
      if (error) {
        console.error("İsim güncellenemedi:", error);
        return;
      }
      const kullanici = TUM_KULLANICILAR.find((u) => u.id === userId);
      if (kullanici) {
        kullanici[alan] = deger || null;
        kullanici.full_name = [kullanici.first_name, kullanici.last_name].filter(Boolean).join(" ");
      }
    });
  });

  liste.querySelectorAll(".uye-sil-btn").forEach((btn) => {
    btn.addEventListener("click", () => uyeyiSil(btn.dataset.id, btn.dataset.email));
  });

  liste.querySelectorAll(".eposta-degistir-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      adminEpostaKutusunuAc({ id: btn.dataset.id, email: btn.dataset.email, isim: btn.dataset.isim })
    );
  });
}

/* ---------------------------------------------------------------------- */
/* ÜYE SİLME                                                               */
/* ---------------------------------------------------------------------- */
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
    renderStats(TUM_KULLANICILAR);
    renderListe();
  } catch (err) {
    alert("Üye silinemedi: " + err.message);
  }
}

/* ---------------------------------------------------------------------- */
/* ADMİN'İN BİR ÜYENİN E-POSTASINI DEĞİŞTİRMESİ (ANINDA — MAİL BEKLEMEDEN) */
/* Kullanıcının kendi panelindeki "E-posta Değiştir" ÇİFT onay ister (bkz. */
/* panel.js); eski mailine erişimi kalmamış kullanıcılar için bu, admin    */
/* panelinden açılan yedek yoldur — Edge Function admin-change-email,      */
/* service_role ile email_confirm:true göndererek e-postayı HİÇBİR mail    */
/* göndermeden anında değiştirir.                                          */
/* ---------------------------------------------------------------------- */
function adminEpostaKutusunuAc({ id, email, isim }) {
  const kutu = document.getElementById("admin-eposta-degistir-kutu");
  const msg = document.getElementById("admin-eposta-message");
  if (!kutu) return;

  document.getElementById("admin-eposta-hedef-isim").textContent = `${isim} (${email})`;
  document.getElementById("admin-eposta-hedef-id").value = id;
  document.getElementById("admin-eposta-yeni").value = "";
  if (msg) msg.hidden = true;
  kutu.hidden = false;
  kutu.scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("admin-eposta-yeni")?.focus();
}

function wireAdminEmailChange() {
  const form = document.getElementById("admin-eposta-degistir-form");
  const iptalBtn = document.getElementById("admin-eposta-degistir-iptal-btn");
  const kutu = document.getElementById("admin-eposta-degistir-kutu");
  const msg = document.getElementById("admin-eposta-message");
  if (!form) return;

  iptalBtn?.addEventListener("click", () => {
    kutu.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const hedefId = document.getElementById("admin-eposta-hedef-id").value;
    const yeniEposta = document.getElementById("admin-eposta-yeni").value.trim();

    if (!yeniEposta) {
      showMessage(msg, "Yeni e-posta adresini gir.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(ADMIN_CHANGE_EMAIL_FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hedef_kullanici_id: hedefId, yeni_eposta: yeniEposta }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bilinmeyen hata");

      const oturumNotu = body.eski_oturumlar_sonlandirildi
        ? "Kullanıcının eski oturumları sonlandırıldı, yeniden giriş yapması gerekecek."
        : "Not: eski oturumlar sonlandırılamadı (bkz. konsol) — migration 0009'un çalıştırıldığından emin ol.";
      const mailNotu = body.bildirim_maili_gonderildi
        ? "Yeni adresine bilgilendirme e-postası gönderildi."
        : "Not: bilgilendirme e-postası gönderilemedi (kullanıcıyı ayrıca haberdar etmek isteyebilirsin).";

      showMessage(
        msg,
        `E-postası güncellendi: ${yeniEposta}. Hiçbir mail beklenmedi — değişiklik anında uygulandı. ${oturumNotu} ${mailNotu}`,
        "success"
      );

      const kullanici = TUM_KULLANICILAR.find((u) => u.id === hedefId);
      if (kullanici) kullanici.email = yeniEposta; // arayüzde de yansıt — değişiklik zaten kesinleşti (mail beklemiyor)
      renderListe();
    } catch (err) {
      // fetch() Safari'de ağ/CORS hatalarında "Load failed", Chrome'da
      // "Failed to fetch" mesajıyla TypeError fırlatır — bu durumda istek
      // Edge Function'a HİÇ ULAŞMAMIŞ demektir. En sık nedenler: (1)
      // fonksiyon henüz deploy edilmemiş, (2) ADMIN_CHANGE_EMAIL_FUNCTION_URL
      // yanlış/eski proje referansını gösteriyor, (3) sitenin şu anki adresi
      // Edge Function'daki ALLOWED_ORIGINS listesinde yok.
      const agHatasiMi = err instanceof TypeError;
      showMessage(
        msg,
        agHatasiMi
          ? `E-posta değiştirilemedi: sunucuya ulaşılamadı (${err.message}). Olası nedenler: Edge Function henüz deploy edilmemiş olabilir, ya da bu sitenin adresi fonksiyonun izin verilen listesinde olmayabilir (CORS). Bkz. README → "admin-change-email 'Load failed' Hatası Alıyorum".`
          : "E-posta değiştirilemedi: " + err.message
      );
    } finally {
      submitBtn.disabled = false;
    }
  });
}

init();
