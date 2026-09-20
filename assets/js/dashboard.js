/*
 * assets/js/dashboard.js
 *
 * panel/dashboard.html için tek giriş noktası. Eskiden 6 ayrı sayfada
 * (admin.md, uye-ayarlari.md, admin-guvenlik.md, github-yonetim.md,
 * izleme-okuma-yonetim.md, mesajlar.md) bağımsız bağımsız çalışan 6 ayrı
 * script (admin.js, uye-ayarlari.js, admin-guvenlik.js,
 * github-yonetim/github-yonetim.js, izleme-okuma-yonetim/izleme-okuma-yonetim.js,
 * mesajlar.js) BU DOSYADAN TEK SATIR BİLE DEĞİŞMEDEN çağrılıyor.
 *
 * ÇÖZÜLEN 2 MİMARİ SORUN (bkz. panel/DASHBOARD-ENTEGRASYON.md):
 *
 *  1) YÖNLENDİRME ÇAKIŞMASI: auth-guard.js -> requireAuth() rol uymazsa
 *     window.location.replace(...) ile SAYFAYI TERK EDİYOR. 6 script'i
 *     aynı sayfada <script> ile statik yüklesek, ör. bir "editor" giriş
 *     yaptığında admin.js'in requireAuthOrShowError({role:['admin','manager']})
 *     çağrısı hemen sayfayı başka yere fırlatırdı. ÇÖZÜM: bu dosya ÖNCE
 *     TEK bir requireAuth({role:null}) ile oturumu/rolü öğrenir, sidebar'ı
 *     role göre çizer, her modülün asıl script'ini SADECE kullanıcı o
 *     sekmeye ilk kez tıkladığında dynamic import() ile yükler. Yetkisi
 *     olmayan bir modülün script'i O KULLANICI İÇİN HİÇ ÇALIŞTIRILMAZ.
 *
 *  2) ID ÇAKIŞMASI: panel/admin.md ve panel/github-yonetim.md içinde
 *     BİREBİR AYNI id'ler var: "icerik-ekle", "icerikler", "icerik-form"
 *     (iki ayrı, ilgisiz form/liste — biri özel/gizli içerik, diğeri
 *     GitHub'a yayınlanan yazılar/projeler). İkisi de aynı anda DOM'da
 *     olsaydı document.getElementById() hep İLKİNİ bulur, diğer script
 *     yanlış elemanlara bağlanırdı. ÇÖZÜM: bu iki çift <template> içinde
 *     tutulur (bkz. dashboard.html sonu) ve swapSlot() ile HER ZAMAN
 *     sadece biri gerçek DOM'a taşınır (clone DEĞİL, taşıma — aynı düğüm,
 *     event listener'lar korunur).
 *
 * KESİN KURAL: bu dosya admin.js/panel.js/uye-ayarlari.js/admin-guvenlik.js/
 * github-yonetim.js/izleme-okuma-yonetim.js/mesajlar.js içindeki TEK BİR
 * SATIRA bile dokunmaz. Hepsi olduğu gibi, deÄŸiÅŸtirilmeden import edilir.
 */

import { requireAuthOrShowError } from "./auth/auth-guard.js";

/* ------------------------------------------------------------------ */
/* 1) Modül tanımları                                                  */
/* ------------------------------------------------------------------ */

// role: null (herkes) | "admin" | "owner" | ["editor","manager"] vb.
// auth-guard.js'teki requireAuth() ile BİREBİR AYNI kural burada da
// UI/gezinme amaçlı tekrarlanıyor (gerçek güvenlik yine RLS + her
// modülün kendi requireAuthOrShowError çağrısında).
const MODULES = {
  gy: { src: "./github-yonetim/github-yonetim.js", role: ["editor", "manager"] },
  admin: { src: "./admin.js", role: ["admin", "manager"] },
  uye: { src: "./uye-ayarlari.js", role: "admin" },
  guvenlik: { src: "./admin-guvenlik.js", role: "admin" },
  izleme: { src: "./izleme-okuma-yonetim/izleme-okuma-yonetim.js", role: "owner" },
  mesajlar: { src: "./mesajlar.js", role: null },
};

// Sidebar hiyerarşisi. Her leaf: { id, label, view (gösterilecek
// #view-* elemanının sonu), module (MODULES anahtarı) }
const NAV = [
  {
    group: "📝 İçerik Yönetimi",
    items: [
      { id: "content-all", label: "Tüm Yazılar & Projeler", module: "gy" },
      { id: "content-new", label: "Yeni İçerik Ekle", module: "gy" },
      { id: "content-private", label: "Özel / Gizli Makaleler", module: "admin" },
      { id: "content-folders", label: "Klasör Yönetimi", module: "gy" },
    ],
  },
  {
    group: "📁 Medya & Takip",
    items: [
      { id: "media-r2", label: "R2 Dosya Paylaşımı", module: "admin" },
      { id: "media-izleme", label: "İzleme ve Okuma Yönetimi", module: "izleme" },
      { id: "media-cv", label: "Özgeçmiş (CV) & Profil Görseli", module: "gy" },
    ],
  },
  {
    group: "👥 Kullanıcı & İletişim",
    items: [
      { id: "users-uye", label: "Üye Ayarları", module: "uye" },
      { id: "users-mesajlar", label: "Sohbet / Mesajlar", module: "mesajlar" },
    ],
  },
  {
    group: "⚙️ Sistem & Güvenlik",
    items: [
      { id: "sys-guvenlik", label: "Admin Güvenliği", module: "guvenlik" },
      { id: "sys-github", label: "GitHub / Worker Bağlantı Durumu", module: "gy" },
      { id: "sys-hakkimda", label: "Hakkımda & Sosyal Linkler", module: "gy" },
      { id: "sys-hesabim", label: "Hesabım (Tehlikeli Bölge)", module: "admin" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 2) Rol kontrolü — auth-guard.js -> requireAuth() ile AYNI mantık    */
/* ------------------------------------------------------------------ */

function roleAllowed(required, profile) {
  if (required === null || required === undefined) return true;
  const list = Array.isArray(required) ? required : [required];
  const ownerOnly = list.length === 1 && list[0] === "owner";
  const roleOk =
    list.includes(profile.role) ||
    (!ownerOnly && profile.role === "admin") ||
    profile.role === "owner";
  const suspendedBlock = profile.role === "admin" && profile.is_suspended === true;
  return roleOk && !suspendedBlock;
}

/* ------------------------------------------------------------------ */
/* 3) Swap-slot mekanizması (id çakışan 2 çift için)                   */
/* ------------------------------------------------------------------ */

// Her "kaynak" (template) sadece BİR KEZ, ilk ihtiyaç duyulduğunda asıl
// DOM'a taşınır (template.content.firstElementChild -> appendChild,
// clone DEĞİL). Sonraki her taşımada AYNI düğüm hareket eder, böylece
// github-yonetim.js / admin.js'in daha önce bu düğümlere taktığı
// event listener'lar kaybolmaz.
const swapCache = new Map(); // templateId -> canlı DOM düğümü

function nodeFor(templateId) {
  if (!swapCache.has(templateId)) {
    const tpl = document.getElementById(templateId);
    const node = tpl.content.firstElementChild;
    swapCache.set(templateId, node);
  }
  return swapCache.get(templateId);
}

function swapSlot(slotId, templateId) {
  const slot = document.getElementById(slotId);
  const node = nodeFor(templateId);
  if (node.parentElement !== slot) {
    slot.replaceChildren(node);
  }
}

// content-all / content-new: gy varyantı slot-icerikler / slot-icerik-ekle'de
// content-private: admin varyantı slot-icerikler-private / slot-icerik-ekle-private'ta
// NOT: gy ve admin varyantları FARKLI slot'larda oturduğu için (view
// değiştiğinde iki view aynı anda görünmez) aynı anda çakışma olmaz —
// ama aynı ("icerikler") id'li iki düğüm asla aynı anda gerçek DOM'a
// EKLİ olmamalı; bu yüzden ilgili view ilk açıldığında ilgili tek
// varyant o view'ın kendi slot'una taşınır, diğer view'ın slot'u boş
// kalır ta ki KENDİSİ açılana kadar (bkz. ensureView).
function ensureContentSlots(viewId) {
  if (viewId === "content-all") swapSlot("slot-icerikler", "tpl-gy-icerikler");
  else if (viewId === "content-new") swapSlot("slot-icerik-ekle", "tpl-gy-icerik-ekle");
  else if (viewId === "content-private") {
    swapSlot("slot-icerik-ekle-private", "tpl-admin-icerik-ekle");
    swapSlot("slot-icerikler-private", "tpl-admin-icerikler");
  }
}

/* ------------------------------------------------------------------ */
/* 4) Modül script'lerini tembel (lazy) yükleme                        */
/* ------------------------------------------------------------------ */

const loadedModules = new Set();

async function ensureModuleLoaded(key) {
  if (loadedModules.has(key)) return;
  loadedModules.add(key);
  try {
    await import(MODULES[key].src);
  } catch (err) {
    loadedModules.delete(key);
    console.error(`dashboard.js: "${key}" modülü yüklenemedi:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* 5) Sidebar çizimi + görünüm değiştirme                              */
/* ------------------------------------------------------------------ */

let activeViewId = null;

function buildSidebar(profile) {
  const nav = document.getElementById("dash-nav");
  nav.replaceChildren();

  for (const group of NAV) {
    const visibleItems = group.items.filter((it) =>
      roleAllowed(MODULES[it.module].role, profile)
    );
    if (visibleItems.length === 0) continue;

    const h = document.createElement("div");
    h.className = "dash-nav-group-title";
    h.textContent = group.group;
    nav.appendChild(h);

    for (const item of visibleItems) {
      const a = document.createElement("a");
      a.href = `#${item.id}`;
      a.textContent = item.label;
      a.dataset.viewId = item.id;
      a.dataset.module = item.module;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        showView(item.id, item.module);
        closeMobileSidebar();
      });
      nav.appendChild(a);
    }
  }
}

async function showView(viewId, moduleKey) {
  const target = document.getElementById(`view-${viewId}`);
  if (!target) return;

  ensureContentSlots(viewId);

  document.querySelectorAll(".dash-view").forEach((v) => (v.hidden = true));
  document.querySelectorAll("#dash-nav a").forEach((a) => a.classList.remove("active"));

  target.hidden = false;
  document
    .querySelector(`#dash-nav a[data-view-id="${viewId}"]`)
    ?.classList.add("active");

  activeViewId = viewId;
  history.replaceState(null, "", `#${viewId}`);

  await ensureModuleLoaded(moduleKey);
}

function firstAvailableView(profile) {
  for (const group of NAV) {
    for (const item of group.items) {
      if (roleAllowed(MODULES[item.module].role, profile)) return item;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 6) Mobil hamburger                                                  */
/* ------------------------------------------------------------------ */

function closeMobileSidebar() {
  document.getElementById("dash-sidebar")?.classList.remove("open");
  document.getElementById("dash-overlay")?.setAttribute("hidden", "");
  document.getElementById("dash-nav-toggle")?.setAttribute("aria-expanded", "false");
}

function wireMobileNav() {
  const toggle = document.getElementById("dash-nav-toggle");
  const sidebar = document.getElementById("dash-sidebar");
  const overlay = document.getElementById("dash-overlay");
  if (!toggle || !sidebar || !overlay) return;

  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    overlay.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  overlay.addEventListener("click", closeMobileSidebar);
}

/* ------------------------------------------------------------------ */
/* 7) Başlangıç                                                        */
/* ------------------------------------------------------------------ */

async function init() {
  // Tek, paylaşılan temel oturum/rol kontrolü — role:null, yani sadece
  // giriş yapmış olmak yeterli. Modül-özel rol kısıtları SADECE sidebar
  // görünürlüğünü ve hangi script'in yükleneceğini belirler; her
  // modülün kendi requireAuthOrShowError({role:...}) çağrısı YİNE de
  // (savunma derinliği olarak) çalışmaya devam eder.
  const { profile } = await requireAuthOrShowError({ role: null });

  document.getElementById("dash-ad-soyad").textContent =
    profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "";
  document.getElementById("dash-rol").textContent = `Rol: ${profile.role}`;

  buildSidebar(profile);
  wireMobileNav();

  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  const requestedId = window.location.hash.replace("#", "");
  const requested = requestedId
    ? NAV.flatMap((g) => g.items).find((it) => it.id === requestedId)
    : null;
  const target =
    requested && roleAllowed(MODULES[requested.module].role, profile)
      ? requested
      : firstAvailableView(profile);

  if (target) {
    await showView(target.id, target.module);
  } else {
    document.getElementById("dash-main").innerHTML =
      '<p class="muted">Bu panelde görüntüleyebileceğin bir bölüm bulunamadı.</p>';
  }
}

init();
