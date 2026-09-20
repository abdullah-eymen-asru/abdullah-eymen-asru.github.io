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
    group: "İçerik Yönetimi",
    icon: "📝",
    items: [
      { id: "content-all", icon: "📚", label: "Tüm Yazılar & Projeler", module: "gy" },
      { id: "content-new", icon: "➕", label: "Yeni İçerik Ekle", module: "gy" },
      { id: "content-private", icon: "🔒", label: "Özel / Gizli Makaleler", module: "admin" },
      { id: "content-folders", icon: "📁", label: "Klasör Yönetimi", module: "gy" },
    ],
  },
  {
    group: "Medya & Takip",
    icon: "📁",
    items: [
      { id: "media-r2", icon: "🗂️", label: "R2 Dosya Paylaşımı", module: "admin" },
      { id: "media-izleme", icon: "🎬", label: "İzleme ve Okuma Yönetimi", module: "izleme" },
      { id: "media-cv", icon: "📄", label: "Özgeçmiş (CV) & Profil Görseli", module: "gy" },
    ],
  },
  {
    group: "Kullanıcı & İletişim",
    icon: "👥",
    items: [
      { id: "users-uye", icon: "👤", label: "Üye Ayarları", module: "uye" },
      { id: "users-mesajlar", icon: "💬", label: "Sohbet / Mesajlar", module: "mesajlar" },
    ],
  },
  {
    group: "Sistem & Güvenlik",
    icon: "⚙️",
    items: [
      { id: "sys-guvenlik", icon: "🛡️", label: "Admin Güvenliği", module: "guvenlik" },
      // MADDE 4: "Yetki Ayarları" eskiden "GitHub / Worker Bağlantı Durumu"
      // görünümünün ALTINDA, ikinci bir blok olarak duruyordu — aslında
      // bambaşka bir konu olduğu için artık KENDİ sekmesi. Script'i (gy)
      // aynı, ama görünürlüğü owner'a sabitlenmiş durumda: github-yonetim.js
      // -> wireYetkiAyarlari() zaten owner değilse bölümü DOM'dan siliyor,
      // burada da sidebar linkini hiç çizmiyoruz (item.role override'ı).
      { id: "sys-yetki", icon: "🔐", label: "Yetki Ayarları", module: "gy", role: "owner" },
      { id: "sys-github", icon: "🔑", label: "GitHub / Worker Bağlantısı", module: "gy" },
      { id: "sys-hakkimda", icon: "🙋", label: "Hakkımda & Sosyal Linkler", module: "gy" },
      { id: "sys-hesabim", icon: "⚠️", label: "Hesabım (Tehlikeli Bölge)", module: "admin" },
    ],
  },
];

// Bir sekmenin gerektirdiği rol: varsa sekmenin KENDİ "role" alanı
// (ör. Yetki Ayarları -> owner), yoksa modülün rolü.
function itemRole(item) {
  return item.role !== undefined ? item.role : MODULES[item.module].role;
}

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
      roleAllowed(itemRole(it), profile)
    );
    if (visibleItems.length === 0) continue;

    // ANA SEKME (accordion başlığı). Eskiden burası tıklanamayan düz bir
    // yazıydı ve altındaki TÜM linkler her zaman açıktı — sol menüde aynı
    // anda 13 satır yazı durduğu için kalabalık görünüyor, odağı
    // dağıtıyordu. Artık 4 ana sekme var; sadece içinde bulunduğun grup
    // açık kalıyor (aşağıdaki gruplariAc/accordion mantığı).
    const baslik = document.createElement("button");
    baslik.type = "button";
    baslik.className = "dash-nav-group";
    baslik.setAttribute("aria-expanded", "false");

    const etiket = document.createElement("span");
    etiket.className = "dash-nav-group-label";
    etiket.textContent = `${group.icon} ${group.group}`;

    const ok = document.createElement("span");
    ok.className = "dash-nav-group-ok";
    ok.textContent = "›";
    ok.setAttribute("aria-hidden", "true");

    baslik.append(etiket, ok);

    const kutu = document.createElement("div");
    kutu.className = "dash-nav-group-items";
    kutu.hidden = true;
    const kutuId = `dash-nav-grup-${NAV.indexOf(group)}`;
    kutu.id = kutuId;
    baslik.setAttribute("aria-controls", kutuId);

    baslik.addEventListener("click", () => {
      const acik = baslik.getAttribute("aria-expanded") === "true";
      // Akordeon: bir grup açılınca diğerleri kapanır (menü hiçbir zaman
      // uzun bir liste haline gelmez). Aynı gruba tekrar basmak kapatır.
      kapatTumGruplar();
      if (!acik) acGrup(baslik);
    });

    nav.append(baslik, kutu);

    for (const item of visibleItems) {
      const a = document.createElement("a");
      a.href = `#${item.id}`;
      a.dataset.viewId = item.id;
      a.dataset.module = item.module;

      const ikon = document.createElement("span");
      ikon.className = "dash-nav-ikon";
      ikon.textContent = item.icon || "•";
      ikon.setAttribute("aria-hidden", "true");

      const yazi = document.createElement("span");
      yazi.textContent = item.label;

      a.append(ikon, yazi);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        showView(item.id, item.module);
        closeMobileSidebar();
      });
      kutu.appendChild(a);
    }
  }
}

function acGrup(baslik) {
  baslik.setAttribute("aria-expanded", "true");
  const kutu = document.getElementById(baslik.getAttribute("aria-controls"));
  if (kutu) kutu.hidden = false;
}

function kapatTumGruplar() {
  document.querySelectorAll(".dash-nav-group").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
    const kutu = document.getElementById(b.getAttribute("aria-controls"));
    if (kutu) kutu.hidden = true;
  });
}

// Aktif sekmeyi içeren grubu aç, diğerlerini kapat; ayrıca kapalı grubun
// başlığında da aktiflik belli olsun diye işaretle.
function aktifGrubuAc(viewId) {
  const link = document.querySelector(`#dash-nav a[data-view-id="${viewId}"]`);
  const kutu = link?.closest(".dash-nav-group-items");
  document.querySelectorAll(".dash-nav-group").forEach((b) => {
    const icerir = b.getAttribute("aria-controls") === kutu?.id;
    b.dataset.aktifIcerir = icerir ? "true" : "false";
  });
  if (!kutu) return;
  kapatTumGruplar();
  const baslik = kutu.previousElementSibling;
  if (baslik) acGrup(baslik);
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

  aktifGrubuAc(viewId);

  // Mobil üst şeritte "şu an hangi sekmedeyim" yazsın — dar ekranda
  // sidebar kapalı olduğu için tek ipucu bu.
  const basligiAl =
    NAV.flatMap((g) => g.items).find((it) => it.id === viewId)?.label || "";
  const topbarBaslik = document.getElementById("dash-topbar-baslik");
  if (topbarBaslik) topbarBaslik.textContent = basligiAl;

  activeViewId = viewId;
  history.replaceState(null, "", `#${viewId}`);

  await ensureModuleLoaded(moduleKey);
}

function firstAvailableView(profile) {
  for (const group of NAV) {
    for (const item of group.items) {
      if (roleAllowed(itemRole(item), profile)) return item;
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

/*
 * MADDE 1 — İKİ HAMBURGER ÜST ÜSTE GELİYORDU:
 * Panelin düğmesi eskiden "position: fixed; top:12px; left:12px" idi ve
 * tam olarak sitenin kendi header hamburger'ının (#nav-toggle) üstüne
 * oturuyordu; iki menü tek düğme gibi görünüyor, site menüsüne (sekmeler
 * arası geçiş) dokunmak mümkün olmuyordu. Düğme artık akışın içinde,
 * header'ın ALTINDAKİ kendi şeridinde (.dash-topbar). Bu şeridin sticky
 * konumunun header'ın gerçek yüksekliğini bilmesi gerekiyor (header mobilde
 * satır kaydırabiliyor), o yüzden yüksekliği burada ölçüp CSS değişkeni
 * olarak yazıyoruz.
 */
function olcuHeaderYuksekligi() {
  const header = document.querySelector(".site-header");
  const shell = document.querySelector(".dash-shell");
  if (!header || !shell) return;
  shell.style.setProperty("--dash-header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
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

  // Escape ile de kapansın (site menüsündeki desenle aynı).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileSidebar();
  });

  olcuHeaderYuksekligi();
  window.addEventListener("resize", olcuHeaderYuksekligi);
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
    requested && roleAllowed(itemRole(requested), profile)
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
