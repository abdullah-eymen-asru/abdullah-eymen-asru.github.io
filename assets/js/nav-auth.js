/*
 * assets/js/nav-auth.js
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
 * _layouts/default.html içinde <div id="auth-nav"> boş bir kapsayıcı olarak
 * durur; JS yüklenmeden önce görünen tek bir statik "Giriş" linki (no-JS /
 * yavaş bağlantı için "progressive enhancement") bu script çalışır çalışmaz
 * yerini buradaki dinamik menüye bırakır.
 */
import { supabase } from "./supabase-client.js";

export async function initAuthNav() {
  const container = document.getElementById("auth-nav");
  if (!container) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    renderGirisLinki(container);
  } else {
    // Rolü öğrenmek için tek satır bir profil sorgusu — admin linkini
    // sadece gerçekten adminse göstermek için (RLS zaten korur, bu sadece
    // menüyü gereksiz linklerle kalabalıklaştırmamak için).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    renderHesapMenusu(container, profile?.role ?? "user");
  }

  // Başka bir sekmede giriş/çıkış yapılırsa bu sekmedeki menü de güncellensin.
  supabase.auth.onAuthStateChange((_event, yeniSession) => {
    container.innerHTML = "";
    if (!yeniSession) {
      renderGirisLinki(container);
    } else {
      supabase
        .from("profiles")
        .select("role")
        .eq("id", yeniSession.user.id)
        .single()
        .then(({ data }) => renderHesapMenusu(container, data?.role ?? "user"));
    }
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

  const linkler = [{ href: "/panel/panel.html", etiket: "Panelim" }];
  if (role === "admin") {
    linkler.push({ href: "/panel/admin.html", etiket: "Admin Paneli" });
    // GitHub Pages'in kendi statik içeriğini (blog/proje yazıları, profil
    // fotoğrafı) yönetmek için ayrı, bağımsız bir sayfa — bkz.
    // panel/github-yonetim.md / assets/js/github-yonetim.js. Supabase admin
    // panelinin hemen altında görünsün diye buraya, "Admin Paneli"
    // linkinden sonra eklendi.
    linkler.push({ href: "/panel/github-yonetim.html", etiket: "GitHub İçerik Yönetimi" });
  }

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
