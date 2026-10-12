/*
 * assets/js/auth/nav-auth.js
 *
 * Header'daki hesap ile ilgili linkleri (Giriş / Kayıt / Panelim / Admin /
 * Çıkış) TEK bir sekmede toplar: "Hesabım" adında tek bir menü.
 *
 * Önceden nav'da her zaman görünen ayrı "Giriş" ve "Panelim" linkleri vardı
 * — çıkış yapmışken bile "Panelim" görünüyordu (tıklayınca giriş sayfasına
 * atıyordu, kafa karıştırıcıydı) ve "Kayıt Ol" linki hiç nav'da yoktu.
 * Şimdi tek bir buton var, durumuna göre içeriği değişiyor:
 *
 *   - Çıkış yapmışken:  "Giriş Yap"  -> doğrudan /hesap/giris.html (kayıt ol
 *                        linki o sayfanın içinde zaten var, bkz. hesap/giris.md)
 *   - Giriş yapmışken:  "Hesabım ▾" -> tıklanınca küçük bir menü açılır:
 *                        Panelim, (adminse) Admin Paneli, (adminse) GitHub
 *                        İçerik Yönetimi, Çıkış Yap
 *
 * _layouts/default.html içinde <div id="auth-nav"> statik bir yedek
 * içerik ("Giriş Yap" linki + görünmez bir "Hesabım ▾" iskeleti, bkz.
 * assets/js/auth/nav-auth-hint.js) ile durur; bu script çalışır çalışmaz
 * yerini buradaki dinamik menüye bırakır (progressive enhancement).
 *
 * BUG FİX — "Hesabım ▾" ÜÇ KEZ ÜST ÜSTE GÖRÜNÜYORDU (ekran görüntüsü ile
 * bildirildi): eski kodda İKİ AYRI kod yolu #auth-nav'a içerik ekliyordu —
 * (1) initAuthNav()'ın ilk çağrısındaki dal, container'ı HİÇ TEMİZLEMEDEN
 * doğrudan renderHesapMenusu/renderGirisLinki'yi ÇAĞIRIYORDU (statik yedek
 * HTML'in üzerine EKLEME yapıyordu, onun yerine geçmiyordu), (2) Supabase
 * v2'nin onAuthStateChange'i abone olunur olunmaz MEVCUT durumla bir kez
 * (bazı durumlarda birden fazla: INITIAL_SESSION, sonra SIGNED_IN gibi)
 * KENDİLİĞİNDEN tetiklenir — bu dal container.innerHTML="" ile TEMİZLİYORDU
 * ama bu temizleme, profil sorgusunun (async) SONUCUNU beklemeden, olay
 * tetiklenir tetiklenmez yapılıyordu; iki olay üst üste (henüz biri DOM'a
 * yazmadan) gelirse ikisi de "temizle" yapıp sonra ayrı ayrı EKLEME
 * yapabiliyor, net sonuç DOM'da birden fazla ".auth-nav-dropdown" birikmesi
 * oluyordu. Aşağıdaki menuyuGuncelle(), artan bir "nesil" (generation)
 * sayacıyla bunu KÖKTEN engelliyor: temizleme ve ekleme HER ZAMAN TEK bir
 * atomik adımda, ASYNC iş (profil sorgusu) bittikten SONRA yapılıyor; o
 * bekleme sırasında DAHA YENİ bir istek başlamışsa (nesil ilerlemişse) eski
 * sonuç sessizce atılıyor, DOM'a hiç yazılmıyor.
 *
 * ÇOKLU CONTAINER (mobil menü desteği): Artık sayfada #auth-nav'ın YANI
 * SIRA, mobil açılır panelin içinde bir #auth-nav-mobile de var (bkz.
 * _layouts/default.html #mobile-nav-panel). İkisi de AYNI hesap durumunu
 * göstermesi gerektiği için (masaüstünde biri görünür, mobilde diğeri),
 * document.getElementById yerine querySelectorAll(".auth-nav") ile TÜM
 * container'lar bulunup HER BİRİNE ayrı ayrı (ama aynı veriyle) menü
 * render ediliyor. Böylece nav-auth.js'e yeni bir yer/kopya eklemek
 * istenirse tek yapılması gereken aynı ".auth-nav" sınıfına sahip yeni
 * bir <div id="..."> eklemek.
 */
import { supabase } from "../core/supabase-client.js";

// "HESABIM ▾" TİTREMESİ (FOUC) DÜZELTMESİ — parça 3/3 (bkz. nav-auth-hint.js
// ve nav-auth-init.js). Oturum durumu KESİNLEŞTİĞİNDE (giriş/çıkış) bu
// ipucuyu güncelliyoruz ki BİR SONRAKİ sayfa yüklemesinde (ya da bu
// sekmedeki bir sonraki tam yenilemede) nav-auth-hint.js daha ilk boyada
// doğru yedek görünümü (Hesabım ▾ ya da Giriş Yap) seçebilsin. Bu SADECE
// görsel bir yedek/ipucudur — gerçek yetkilendirme HER ZAMAN aşağıdaki
// gerçek Supabase oturum/rol kontrolünden gelir.
function hintYaz(girisYapilmisMi) {
  try {
    if (girisYapilmisMi) {
      localStorage.setItem("aea_auth_hint", "in");
    } else {
      localStorage.removeItem("aea_auth_hint");
    }
  } catch (_err) {
    // localStorage kapalıysa ipucu kaydedilemez — kritik değil, bir
    // sonraki sayfa yüklemesinde yine varsayılan (Giriş Yap) yedek
    // gösterilir, nav-auth.js gerçek durumu yine de doğru çözer.
  }
}

export async function initAuthNav() {
  // ÇOKLU CONTAINER: masaüstü nav'ındaki #auth-nav VE mobil panel
  // içindeki #auth-nav-mobile — ikisi de ".auth-nav" sınıfını paylaşır.
  // Sayfada hangisi/hangileri varsa (bazı sayfalarda ikisi de olabilir,
  // bazı özel şablonlarda sadece biri olabilir) hepsi bulunur.
  const containers = Array.from(document.querySelectorAll(".auth-nav"));
  if (containers.length === 0) return;

  let renderNesli = 0;

  // Verilen session'a göre menüyü GERÇEKTEN DOM'a yazan tek yer burasıdır
  // — hem ilk yüklemede hem her onAuthStateChange olayında AYNI fonksiyon
  // çağrılır, böylece "iki farklı kod yolu" riski (yukarıdaki BUG FİX
  // notuna bakın) bir daha oluşamaz. Artık TÜM container'lara aynı anda
  // (aynı nesil/aynı veriyle) yazıyor, böylece masaüstü ve mobil menü
  // birbirinden asla farklı bir duruma düşmüyor.
  async function menuyuGuncelle(session) {
    const buNesil = ++renderNesli;

    let yeniIcerik;
    if (!session) {
      yeniIcerik = { tur: "giris" };
    } else {
      // Rolü öğrenmek için tek satır bir profil sorgusu — admin linkini
      // sadece gerçekten adminse göstermek için (RLS zaten korur, bu
      // sadece menüyü gereksiz linklerle kalabalıklaştırmamak için).
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      yeniIcerik = { tur: "hesap", role: profile?.role ?? "user" };
    }

    // YARIŞ DURUMU KORUMASI: yukarıdaki await sırasında DAHA YENİ bir
    // menuyuGuncelle() çağrısı (ör. arka arkaya gelen bir onAuthStateChange
    // olayı) başlamışsa, bizim nesilimiz artık "bayat"tır — bu sonucu DOM'a
    // hiç yazmadan sessizce atıyoruz; en güncel çağrı zaten kendi sonucunu
    // (ya da o da bayatlarsa ONDAN sonraki) uygulayacaktır.
    if (buNesil !== renderNesli) return;

    hintYaz(yeniIcerik.tur === "hesap");
    containers.forEach((container) => {
      container.innerHTML = "";
      if (yeniIcerik.tur === "giris") {
        renderGirisLinki(container);
      } else {
        renderHesapMenusu(container, yeniIcerik.role);
      }
    });
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await menuyuGuncelle(session);
  } catch (err) {
    // WEBVIEW UYUMLULUĞU: yukarıdaki Supabase çağrısı ağ hatasıyla (WebView
    // içinde geçici bağlantı sorunu vb.) reject olabilir. Statik yedek
    // (nav-auth-hint.js'in seçtiği "Giriş Yap" ya da "Hesabım ▾" iskeleti)
    // zaten yerinde olduğu için görsel bir kilitlenme OLMUYOR, sadece
    // dinamik/etkileşimli menüye yükseltilemiyor.
    console.error("initAuthNav() başarısız (ağ hatası olabilir):", err);
  }

  // Başka bir sekmede giriş/çıkış yapılırsa (ya da Supabase abone olunur
  // olunmaz mevcut durumu kendiliğinden bildirirse) bu sekmedeki menü de
  // AYNI menuyuGuncelle() üzerinden, aynı yarış-durumu korumasıyla güncellenir.
  supabase.auth.onAuthStateChange((_event, yeniSession) => {
    menuyuGuncelle(yeniSession).catch((err) => {
      console.error("Hesap menüsü güncellenemedi (ağ hatası olabilir):", err);
    });
  });
}

function relUrl(path) {
  // Jekyll'in {{ '/x.html' | relative_url }}'sini JS'te taklit ediyoruz:
  // site bir alt dizinde yayınlanıyorsa (baseurl), <html> etiketine
  // gömdüğümüz data-baseurl özniteliğini kullanır, yoksa kökten gider.
  const base = document.documentElement.dataset.baseurl || "";
  return base + path;
}

function renderGirisLinki(container) {
  const a = document.createElement("a");
  a.href = relUrl("/hesap/giris.html");
  a.textContent = "Giriş Yap";
  if (window.location.pathname.includes("giris") || window.location.pathname.includes("kayit")) {
    a.className = "active";
  }
  container.appendChild(a);
}

function renderHesapMenusu(container, role) {
  const wrap = document.createElement("div");
  wrap.className = "auth-nav-dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "auth-nav-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = "Hesabım ▾";

  const menu = document.createElement("div");
  menu.className = "auth-nav-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  // TÜM panel linkleri artık TEK sayfaya — /panel/dashboard.html'e —
  // ilgili sekmenin hash'iyle gidiyor. Eski bağımsız sayfalar
  // (/panel/panel.html, /panel/admin.html, /panel/uye-ayarlari.html ...)
  // silinmedi, hâlâ çalışıyor; ama menü artık birleşik panele
  // yönlendiriyor, böylece kullanıcı sekmeler arasında sayfa yenilemeden
  // dolaşıyor.
  const DASH = "/panel/dashboard.html";
  // Eski panel kısayolları (Sohbet, Üye Ayarları, Admin Paneli, Admin Güvenliği, GitHub İçerik, İzleme/Okuma) menüden KALDIRILDI:
  // hepsi artık Ana Ekran (Hub) içinde, rol/yetkiye göre kartlar olarak duruyor (assets/js/hub/hub.js). Sayfalar silinmedi.
  const linkler = [{ href: `${DASH}#me-hub`, etiket: "🧭 Ana Ekran" }];

  linkler.forEach(({ href, etiket }) => {
    const a = document.createElement("a");
    a.href = relUrl(href);
    a.textContent = etiket;
    a.setAttribute("role", "menuitem");
    menu.appendChild(a);
  });

  const cikisBtn = document.createElement("button");
  cikisBtn.type = "button";
  cikisBtn.className = "auth-nav-menu-cikis";
  cikisBtn.setAttribute("role", "menuitem");
  cikisBtn.textContent = "Çıkış Yap";
  cikisBtn.addEventListener("click", async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut hatası (yine de yönlendiriliyor):", error);
    } catch (err) {
      console.error("signOut() beklenmedik hata (yine de yönlendiriliyor):", err);
    } finally {
      window.location.href = relUrl("/");
    }
  });
  menu.appendChild(cikisBtn);

  function menuyuKapat() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  function menuyuAcKapa() {
    const acik = !menu.hidden;
    menu.hidden = acik;
    btn.setAttribute("aria-expanded", String(!acik));
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuyuAcKapa();
  });

  // NOT: document'a eklenen "dışarı tıklayınca kapat" / "Escape ile kapat"
  // dinleyicileri ÖNCEDEN her renderHesapMenusu() çağrısında (ör. başka
  // bir sekmede giriş/çıkış yapılınca tetiklenen onAuthStateChange'de)
  // YENİDEN ekleniyor, hiç kaldırılmıyordu — bu bir memory leak'ti ve
  // zamanla document'ta onlarca yinelenen dinleyici birikip menü
  // davranışının (kapatma/Escape) garip şekilde katlanarak tetiklenmesine
  // yol açabiliyordu. Şimdi menü DOM'dan kaldırıldığında (yeni bir
  // renderHesapMenusu/renderGirisLinki çağrısı container'ı temizlediğinde)
  // bu dinleyicileri de KENDİMİZ temizliyoruz.
  const disariTiklamaDinleyici = (e) => {
    if (!wrap.isConnected) {
      document.removeEventListener("click", disariTiklamaDinleyici);
      document.removeEventListener("keydown", escDinleyici);
      return;
    }
    if (!wrap.contains(e.target)) menuyuKapat();
  };
  const escDinleyici = (e) => {
    if (!wrap.isConnected) {
      document.removeEventListener("click", disariTiklamaDinleyici);
      document.removeEventListener("keydown", escDinleyici);
      return;
    }
    if (e.key === "Escape") menuyuKapat();
  };
  document.addEventListener("click", disariTiklamaDinleyici);
  document.addEventListener("keydown", escDinleyici);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  container.appendChild(wrap);
}
