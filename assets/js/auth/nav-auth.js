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
 *   - Giriş yapmışken:  "Hesabım"   -> doğrudan panelin Ana Ekranı'na (açılır menü YOK;
 *                        Çıkış Yap panelin içinde)
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

/**
 * "Hesabım" = açılır pencere YOK; tek bir bağlantı, doğrudan panelin Ana Ekranı'na (#me-hub) götürür.
 * (Önceki sürümdeki "▾" düğmesi + Ana Ekran/Çıkış Yap açılır menüsü kaldırıldı. Çıkış Yap artık panelin üst satırında:
 * panel/dashboard.html #cikis-btn.) Dinleyici/menü durumu olmadığı için sızıntı veya yinelenen menü riski de kalmadı.
 */
function renderHesapMenusu(container, _role) {
  const a = document.createElement("a");
  a.href = relUrl("/panel/dashboard.html#me-hub");
  a.textContent = "Hesabım";
  a.title = "Ana Ekran'a git";
  if (window.location.pathname.includes("/panel/")) a.className = "active";
  container.appendChild(a);
}
