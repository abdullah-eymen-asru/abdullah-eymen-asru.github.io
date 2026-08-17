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
import { supabase, showMessage, escapeHtml, kucukHarfeCevirTr, kullaniciAramayaUyuyorMu } from "./core/supabase-client.js";
import { requireAuth } from "./auth/auth-guard.js";

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
  // BUG FİX: 'owner' (Site Sahibi, migration 0021) bu haritada yoktu —
  // üye listesinde owner'ın rolü ham "owner" metniyle görünüyordu.
  owner: "Site Sahibi",
};

let TUM_KULLANICILAR = [];
let ARAMA_METNI = "";
let ROL_FILTRESI = "";
let SAYFA = 1;
let SAYFA_BOYUTU = 20;
// Giriş yapan kişinin kendi profili — "Site Sahibi Yap" ve "Kendi Yetkimi
// Düşür" butonlarının SADECE owner'a ve SADECE ilgili karta (kendi kartı /
// kendisi olmayan kartlar) görünmesi için gerekiyor. requireAuth zaten bunu
// dönüyordu, önceden burada sonuç kullanılmadan atılıyordu.
let GIRIS_YAPAN_PROFIL = null;

async function init() {
  const { profile } = await requireAuth({ role: "admin" });
  GIRIS_YAPAN_PROFIL = profile;
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
  // MİGRATION 0028 § A (genişletilmiş — eskiden migration 0027 § A SADECE
  // Site Sahibi'nin (owner) satırını koruyordu): sıradan bir admin (owner
  // DEĞİL) artık HİÇBİR üyenin (owner, başka bir admin, manager, editor,
  // special_user, user — fark etmez) Ad/Soyad kutularını doğrudan
  // düzenleyemez; SADECE kendi satırındaki Ad/Soyad kendisine açık kalır.
  // Veritabanı tetikleyicisi (prevent_isim_degisikligi_baskasi_tarafindan,
  // migration 0028) zaten bunu reddeder — burada da isim kutularını
  // salt-okunur göstererek kullanıcıyı reddedilecek bir işlemi denemekten
  // önceden caydırıyoruz (gerçek sınır veritabanındadır).
  const benOwnerMi = GIRIS_YAPAN_PROFIL?.role === "owner";
  const kendiSatiriMi = !!GIRIS_YAPAN_PROFIL?.id && GIRIS_YAPAN_PROFIL.id === u.id;
  const isimSalcOkunurMu = !benOwnerMi && !kendiSatiriMi;
  return `
    <div class="uya-kart" data-id="${u.id}">
      <div class="uya-kart-ust">
        <div class="uya-avatar" aria-hidden="true">${escapeHtml(baslarHarfler(u))}</div>
        <div class="uya-kart-kimlik">
          <div class="uya-isim-alani">
            <input class="uya-isim-input" data-alan="first_name" data-id="${u.id}" type="text" value="${escapeHtml(u.first_name || "")}" placeholder="Ad" ${isimSalcOkunurMu ? `readonly title="Bu üyenin adını sadece kendisi ya da Site Sahibi değiştirebilir."` : ""}>
            <input class="uya-isim-input" data-alan="last_name" data-id="${u.id}" type="text" value="${escapeHtml(u.last_name || "")}" placeholder="Soyad" ${isimSalcOkunurMu ? `readonly title="Bu üyenin soyadını sadece kendisi ya da Site Sahibi değiştirebilir."` : ""}>
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
          ${rolSecimHtml(u)}
          ${rolSecimNotuHtml(u)}
        </div>
        <div class="uya-kart-aksiyonlar">
          <span class="rol-durum" data-id="${u.id}"></span>
          ${sahipYapButonuHtml(u)}
          ${kendiYetkimiDusurButonuHtml(u)}
          <button class="btn-secondary tablo-aksiyon-btn eposta-degistir-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}" data-isim="${escapeHtml(u.full_name || u.email)}">E-posta Değiştir</button>
          ${silButonuHtml(u)}
        </div>
      </div>
    </div>`;
}

/**
 * "Sil" butonu — MİGRATION 0027 § B ile başka birini silme yetkisi
 * SADECE owner'a daraltıldı (eskiden herhangi bir admin herhangi bir
 * üyeyi, hatta owner'ı bile silebiliyordu). Bu yüzden bu buton artık
 * SADECE giriş yapan owner ise gösterilir — sıradan bir admin bu butonu
 * hiç görmez (Edge Function tarafı zaten aynı kısıtlamayı zorunlu kılıyor,
 * bkz. supabase/functions/delete-account/index.ts). Herkesin KENDİ
 * hesabını silme hakkı bu butondan BAĞIMSIZ, ayrı bir akıştır (Panelim /
 * "Hesabım" sayfasındaki kendi hesabını silme özelliği) ve DOKUNULMADI.
 */
function silButonuHtml(u) {
  if (GIRIS_YAPAN_PROFIL?.role !== "owner") return "";
  return `<button class="btn-danger tablo-aksiyon-btn uye-sil-btn" data-id="${u.id}" data-email="${escapeHtml(u.email)}">Sil</button>`;
}

/**
 * Rol <select>'ini çizer. İki sunucu tarafı kısıtı (bkz. migration 0024
 * admin_set_user_role) burada ayrıca istemci tarafında da uygulanıyor —
 * sadece hata mesajı almak yerine, izin verilmeyen seçenekler baştan
 * tıklanamaz/görünmez olsun diye:
 *   1) Giriş yapan owner DEĞİLSE "Yönetici" seçeneği listede YOK — sıradan
 *      bir admin kimseyi admin yapamaz.
 *   2) Giriş yapan owner DEĞİLSE VE hedef zaten 'admin' ise, seçim kutusu
 *      TAMAMEN devre dışı — bir admin başka bir admin'in rolünü buradan
 *      değiştiremez, Admin Güvenliği sayfasındaki askıya alma/oylama
 *      sürecini kullanması gerekir (bkz. rolSecimNotuHtml).
 */
function rolSecimHtml(u) {
  const benOwnerMi = GIRIS_YAPAN_PROFIL?.role === "owner";
  const hedefZatenAdminMi = u.role === "admin";
  const devreDisi = hedefZatenAdminMi && !benOwnerMi;

  const secenekler = [
    { rol: "user", etiket: "Üye" },
    { rol: "special_user", etiket: "Özel Üye" },
    { rol: "editor", etiket: "Editör" },
    { rol: "manager", etiket: "İçerik Sorumlusu" },
    // "Yönetici" seçeneği sadece owner'a (ya da hedef zaten admin ise —
    // değeri korumak için) gösterilir.
    ...(benOwnerMi || hedefZatenAdminMi ? [{ rol: "admin", etiket: "Yönetici" }] : []),
  ];

  return `
    <select class="rol-select" data-id="${u.id}" ${devreDisi ? "disabled" : ""}>
      ${secenekler
        .map(({ rol, etiket }) => `<option value="${rol}" ${u.role === rol ? "selected" : ""}>${etiket}</option>`)
        .join("")}
      ${
        u.role === "owner"
          ? `<option value="owner" selected disabled>Site Sahibi (buradan değiştirilemez)</option>`
          : ""
      }
    </select>`;
}

/** rolSecimHtml() ile devre dışı bırakılan seçim kutusunun altına, NEDEN
 * devre dışı olduğunu açıklayan küçük bir not ekler. */
function rolSecimNotuHtml(u) {
  const benOwnerMi = GIRIS_YAPAN_PROFIL?.role === "owner";
  if (u.role !== "admin" || benOwnerMi) return "";
  return `<p class="muted uya-rol-notu">Bir admin'in rolü buradan değiştirilemez — <a href="/panel/admin-guvenlik.html">Admin Güvenliği</a> sayfasından askıya alma/oylama süreci başlatılmalı.</p>`;
}

/**
 * "Site Sahibi Yap" butonu — SADECE giriş yapan kişi owner ise VE hedef
 * kart owner OLMAYAN bir üyeye aitse görünür (bkz. migration 0021
 * owner_rolu_ver() RPC'si — daha önce bu RPC'yi çağıran hiçbir arayüz
 * yoktu, "Başka birisini de site sahibi yapabilme yetkisi olsun" isteği
 * bu butonla karşılanıyor).
 */
function sahipYapButonuHtml(u) {
  if (GIRIS_YAPAN_PROFIL?.role !== "owner" || u.role === "owner") return "";
  return `<button class="btn-secondary tablo-aksiyon-btn sahip-yap-btn" data-id="${u.id}" data-isim="${escapeHtml(u.full_name || u.email)}">👑 Site Sahibi Yap</button>`;
}

/**
 * "Kendi Yetkimi Düşür" butonu — SADECE owner'ın KENDİ kartında görünür.
 * admin_set_user_role() bilhassa role='owner' olan satırları reddettiği
 * için (bkz. migration 0021) owner'ın kendi rolünü düşürebilmesi ayrı bir
 * RPC (owner_kendi_rolunu_dusur) + ayrı bir arayüz gerektiriyor. "Site
 * sahibi kendi yetkisini düşürürken uyarı mesajı alsın" isteği,
 * kendiYetkimiDusur() içindeki confirm() penceresiyle karşılanıyor.
 */
function kendiYetkimiDusurButonuHtml(u) {
  if (GIRIS_YAPAN_PROFIL?.role !== "owner" || u.id !== GIRIS_YAPAN_PROFIL?.id) return "";
  return `<button class="btn-danger tablo-aksiyon-btn kendi-yetkimi-dusur-btn" data-id="${u.id}">⚠️ Kendi Yetkimi Düşür</button>`;
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
        // YENİ: migration 0024 kısıtları (admin'i sadece owner yapabilir/
        // düşürebilir) burada bir RPC hatası olarak dönebilir — kullanıcıya
        // sadece "Hata!" değil, asıl sebebi de göster ve seçim kutusunu
        // eski değerine geri al (aksi halde arayüz, RPC'nin reddettiği
        // değeri seçili gösterip yanıltıcı olurdu).
        alert("Rol değiştirilemedi: " + error.message);
        const kullaniciEski = TUM_KULLANICILAR.find((u) => u.id === userId);
        if (kullaniciEski) select.value = kullaniciEski.role;
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
  // MİGRATION 0027 § A: input zaten Site Sahibi'nin kartında owner-dışı
  // biri için "readonly" render ediliyor (bkz. uyeKartHtml) — burada da
  // aynı durumu ikinci bir güvence olarak kontrol ediyoruz (readonly
  // özniteliği DOM'dan elle kaldırılsa bile veritabanı RLS'i zaten
  // reddeder, ama gereksiz bir istek atmayalım).
  liste.querySelectorAll(".uya-isim-input").forEach((input) => {
    input.addEventListener("change", async () => {
      if (input.readOnly) return;
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

  liste.querySelectorAll(".sahip-yap-btn").forEach((btn) => {
    btn.addEventListener("click", () => sahipYap(btn.dataset.id, btn.dataset.isim, btn));
  });

  liste.querySelectorAll(".kendi-yetkimi-dusur-btn").forEach((btn) => {
    btn.addEventListener("click", () => kendiYetkimiDusur(btn));
  });
}

/* ---------------------------------------------------------------------- */
/* SİTE SAHİBİ ATAMA / KENDİ YETKİSİNİ DÜŞÜRME                            */
/* ---------------------------------------------------------------------- */
async function sahipYap(userId, isim, btn) {
  if (
    !confirm(
      `${isim} adlı üyeyi Site Sahibi (owner) yapmak üzeresin. Owner, admin'in TÜM yetkilerine ek olarak askıya alınamaz ve başka owner atayabilir — bu geri alınabilir bir işlem değildir (bir owner ancak kendi isteğiyle ya da başka bir owner tarafından değil, sadece kendi "Kendi Yetkimi Düşür" butonuyla düşürülebilir). Devam edilsin mi?`
    )
  ) {
    return;
  }

  btn.disabled = true;
  const { error } = await supabase.rpc("owner_rolu_ver", { p_user_id: userId });
  btn.disabled = false;

  if (error) {
    alert("Site Sahibi yapılamadı: " + error.message);
    return;
  }
  const kullanici = TUM_KULLANICILAR.find((u) => u.id === userId);
  if (kullanici) kullanici.role = "owner";
  renderStats(TUM_KULLANICILAR);
  renderListe();
}

async function kendiYetkimiDusur(btn) {
  const yeniRol = prompt(
    "Kendi yetkini düşürmek üzeresin — bu işlemden sonra owner (Site Sahibi) yetkilerinin HİÇBİRİNE (adminleri askıya alma, denetim vakalarını tek başına karara bağlama, başka owner atama vb.) erişemeyeceksin. Hangi role düşmek istiyorsun? (admin / manager / editor / special_user / user)",
    "admin"
  );
  if (!yeniRol) return;
  const gecerliRoller = ["admin", "manager", "editor", "special_user", "user"];
  if (!gecerliRoller.includes(yeniRol.trim())) {
    alert("Geçersiz rol. Şunlardan biri olmalı: " + gecerliRoller.join(", "));
    return;
  }
  if (
    !confirm(
      `SON UYARI: kendi Site Sahibi yetkini "${yeniRol}" rolüne düşürmek üzeresin. Bu işlem GERİ ALINAMAZ — yeniden owner olman için sistemde başka bir owner'ın seni tekrar atamsı gerekir. Emin misin?`
    )
  ) {
    return;
  }

  btn.disabled = true;
  const { error } = await supabase.rpc("owner_kendi_rolunu_dusur", { p_yeni_rol: yeniRol.trim() });
  btn.disabled = false;

  if (error) {
    alert("Yetki düşürülemedi: " + error.message);
    return;
  }
  // Kendi rolü artık owner değil — panel bu sayfayı kullanmaya devam
  // edemez (requireAuth({role:'admin'}) yeni rol admin/owner değilse
  // reddeder), o yüzden panelim sayfasına yönlendiriyoruz.
  alert("Yetkin düşürüldü. Panelim sayfasına yönlendiriliyorsun.");
  window.location.href = "/panel/panel.html";
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
