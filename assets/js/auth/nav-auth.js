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
 * _layouts/default.html içinde <div id="auth-nav"> boş bir kapsayıcı olarak
 * durur; JS yüklenmeden önce görünen tek bir statik "Giriş" linki (no-JS /
 * yavaş bağlantı için "progressive enhancement") bu script çalışır çalışmaz
 * yerini buradaki dinamik menüye bırakır.
 */
import { supabase } from "../core/supabase-client.js";

export async function initAuthNav() {
  const container = document.getElementById("auth-nav");
  if (!container) return;

  // WEBVIEW UYUMLULUĞU: aşağıdaki Supabase çağrıları ağ hatasıyla (WebView
  // içinde geçici bağlantı sorunu vb.) reject olabilir. try/catch
  // olmadan bu, çağıran yerdeki .catch()'e düşse bile container'ı hiç
  // güncellemeden bırakırdı — statik "Giriş Yap" linki (progressive
  // enhancement) zaten yerinde olduğu için görsel bir kilitlenme
  // OLMUYOR, ama tutarlılık için burada da açıkça ele alınıyor.
  try {
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
  } catch (err) {
    console.error("initAuthNav() başarısız (ağ hatası olabilir):", err);
    return;
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
  // Sohbet/Mesajlar artık ayrı, ortak bir sayfa (bkz. panel/mesajlar.md) —
  // giriş yapmış HERKES görür: admin için o sayfa gelen kutusunu, diğer
  // herkes için kendi yöneticiyle sohbet ekranını açar (karar
  // assets/js/mesajlar.js içinde, role'e göre çalışma zamanında verilir).
  linkler.push({ href: "/panel/mesajlar.html", etiket: "Sohbet / Mesajlar" });
  // Üye Ayarları (eski "Kullanıcılar & Roller") artık ayrı bir sayfa (bkz.
  // panel/uye-ayarlari.md) ve SADECE admin'e açık — manager (İçerik
  // Sorumlusu) bu linki hiç görmez, doğrudan URL'yi yazsa bile o sayfanın
  // kendi requireAuth({role:'admin'}) kontrolü onu geri gönderir.
  // owner (Site Sahibi), admin'in tüm menü linklerini görmeli — bkz.
  // migration 0021 ve auth-guard.js'teki "owner her zaman geçer" kuralı.
  const adminGibi = role === "admin" || role === "owner";
  if (adminGibi) {
    linkler.push({ href: "/panel/uye-ayarlari.html", etiket: "Üye Ayarları" });
  }
  // 'manager' (panelde "İçerik Sorumlusu") de admin paneline girebiliyor —
  // ama SADECE "Özel İçerik Ekle/Düzenle", "Mevcut Özel İçerikler" ve
  // "R2 Dosya Paylaşımı" sekmelerine (bkz. admin.js, panel/admin.md).
  // Linkin kendisi admin ile aynı, hangi sekmelerin görüneceğine admin.js
  // içeri girdikten sonra karar veriyor.
  if (adminGibi || role === "manager") {
    linkler.push({ href: "/panel/admin.html", etiket: "Admin Paneli" });
  }
  // Admin Güvenliği (karşılıklı denetim / askıya alma / owner kararı) —
  // sadece admin/owner girebilir (bkz. admin-guvenlik.js).
  if (adminGibi) {
    linkler.push({ href: "/panel/admin-guvenlik.html", etiket: "🛡️ Admin Güvenliği" });
  }
  // GitHub Pages'in kendi statik içeriğini (blog/proje yazıları, profil
  // fotoğrafı) yönetmek için ayrı, bağımsız bir sayfa — bkz.
  // panel/github-yonetim.md / assets/js/github-yonetim/github-yonetim.js. O sayfa
  // requireAuth({role:['editor','manager']}) kullanır, yani editor, manager
  // VEYA admin girebilir (auth-guard.js'te "admin her zaman geçer" kuralı
  // zaten var).
  //
  // BUG FİX: bu link öncesinde SADECE role==='admin' iken ekleniyordu —
  // editor rolündeki kullanıcılar panele erişebildikleri hâlde (RLS ve
  // requireAuth doğru kurulmuştu) menüde linki HİÇ görmüyorlardı, yani
  // panele ulaşmanın tek yolu URL'yi elle yazmaktı. Şimdi editor, manager
  // veya admin iken gösteriliyor.
  if (adminGibi || role === "editor" || role === "manager") {
    linkler.push({ href: "/panel/github-yonetim.html", etiket: "GitHub İçerik Yönetimi" });
  }
  // İzleme/Okuma Yönetimi — bkz. panel/izleme-okuma-yonetim.md /
  // assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js. Bu, GitHub
  // İçerik Yönetimi'nin AKSİNE editor/manager/admin'e DEĞİL, SADECE
  // 'owner' (Site Sahibi) rolüne açık — o pano site sahibinin kişisel
  // izleme/okuma kaydı olduğu için (bir editöre devredilebilecek bir
  // "site içeriği" değil). "admin her zaman geçer" kuralı BİLİNÇLİ
  // OLARAK burada uygulanmıyor; requireAuth({role:'owner'}) da sayfanın
  // kendisinde aynı şekilde SADECE owner'ı geçiriyor (bkz. o dosya).
  if (role === "owner") {
    linkler.push({ href: "/panel/izleme-okuma-yonetim.html", etiket: "🎬📚 İzleme/Okuma Yönetimi" });
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
