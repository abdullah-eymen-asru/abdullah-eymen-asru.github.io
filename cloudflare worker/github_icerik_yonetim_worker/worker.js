/**
 * github-icerik-worker — Cloudflare Worker (Dashboard "Quick Edit" ile uyumlu)
 * -----------------------------------------------------------------------
 * `/panel/github-yonetim.html` mini CMS'i için GitHub REST Contents API'sine
 * (repos/{owner}/{repo}/contents/{path}) VEKİL (proxy) görevi görür.
 *
 * NEDEN BU WORKER VAR — MİMARİ DEĞİŞİKLİK:
 *   Eskiden `assets/js/github-yonetim.js`, kullanıcının panelde YAPIŞTIRDIĞI
 *   bir GitHub Personal Access Token'ı (PAT) tarayıcı BELLEĞİNDE tutup GitHub
 *   API'sine DOĞRUDAN istek atıyordu. Bu, localStorage'a yazmadığı için
 *   "kötü" değildi ama iki gerçek zayıflığı vardı: (1) PAT bir XSS açığında
 *   ya da kötü niyetli bir tarayıcı uzantısında çalışan JS tarafından
 *   sekme açıkken okunabilirdi; (2) editor/manager rolüne (bkz. aşağıdaki
 *   ROL KISITLARI) yazma izinli bir PAT verirsen, bu kişi panelin DIŞINDA da
 *   GitHub API'sine doğrudan commit atabilirdi — yani panel gerçek bir
 *   yetki sınırı değil, sadece bir kolaylık katmanıydı (bkz.
 *   github-yonetim.js dosya başındaki eski "DÜRÜSTLÜK PAYI" notu).
 *
 *   Artık PAT hiç tarayıcıya GİRMİYOR — SADECE bu Worker'ın secret'ı olarak
 *   duruyor. Panel, GitHub'a değil bu Worker'a istek atıyor; kimlik
 *   doğrulaması için kullanıcının zaten sahip olduğu Supabase oturum
 *   token'ını (`Authorization: Bearer <access_token>`) gönderiyor. Bu
 *   Worker o token'ı doğrulayıp kullanıcının Supabase'teki ROLÜNÜ okuyor ve
 *   İKİ katmanlı bir yetki kontrolü uyguluyor:
 *     1) KİMLİK: Geçerli bir Supabase oturumu var mı?
 *     2) YETKİ: Bu kullanıcının rolü, istenen YOLA (path) erişebilir mi?
 *        - `_posts/` ve `_projects/` altındaki her şey → editor, manager,
 *          admin (requireAuth({role:['editor','manager']}) ile AYNI kural,
 *          admin her zaman geçer).
 *        - `assets/` altı VE `_config.yml` (profil fotoğrafı + site
 *          yapılandırması) → SADECE admin (github-yonetim.js'teki
 *          `GIRIS_YAPAN_PROFIL?.role !== "admin"` ön kontrolüyle AYNI kural,
 *          burada ayrıca SUNUCU tarafında da zorunlu kılınıyor).
 *        - Başka HERHANGİ bir yol → HERKESE reddedilir (repoda bu Worker
 *          üzerinden SADECE bu dört alan değiştirilebilir).
 *   Bu iki kontrol sayesinde panel artık GERÇEK bir güvenlik sınırı — bir
 *   editor/manager, panelin dışından bu Worker'a istek atsa bile aynı yol/
 *   rol kısıtlarına tabidir; PAT'a hiçbir zaman erişemez.
 *
 * NASIL ÇALIŞIR (İSTEK BİÇİMİ):
 *   `assets/js/github-yonetim.js`'teki `ghRequest(path, options)` fonksiyonu
 *   artık `https://api.github.com/repos/{owner}/{repo}${path}` yerine
 *   `${WORKER_URL}${path}` adresine istek atıyor — yani `path` argümanı
 *   AYNI kalıyor (`""` → repo bilgisi/bağlantı testi, `/contents/<yol>` →
 *   dosya/klasör oku-yaz-sil). Bu Worker bu path'i olduğu gibi devralıp
 *   `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`
 *   adresine, kendi PAT'ıyla yönlendiriyor (transparent proxy) — GitHub'ın
 *   döndürdüğü JSON gövde ve HTTP durum kodu DEĞİŞTİRİLMEDEN client'a
 *   dönüyor, böylece `github-yonetim.js`'in geri kalanı (ghGetContents/
 *   ghPutFile/ghDeleteFile ve üstündeki TÜM iş mantığı) HİÇ değişmeden
 *   çalışmaya devam ediyor.
 *
 * Gerekli ortam değişkenleri (Cloudflare Dashboard > Worker > Settings
 * > Variables and Secrets):
 *   GITHUB_OWNER                GitHub kullanıcı adın (ör. abdullah-eymen-asru)
 *   GITHUB_REPO                 Repo adı (ör. abdullah-eymen-asru.github.io)
 *   GITHUB_PAT                  Fine-grained PAT, SADECE bu repo için
 *                                "Contents: Read and write" izniyle   (Encrypt/Secret)
 *   SUPABASE_URL                ör. https://eahvcirspmvntffzphye.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase service_role anahtarı          (Encrypt/Secret)
 *
 * Bu Worker'ın R2 binding'i YOK, sadece GitHub REST API'sine ve Supabase'e
 * düz HTTP istekleri atıyor (npm bağımlılığı yok, r2_storage_worker'daki
 * gibi Dashboard'un "Quick Edit" düzenleyicisine yapıştırıp
 * çalıştırabilirsin).
 */

const GITHUB_API = "https://api.github.com";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || request.headers.get("Referer") || "";

    // 1. Domain / Referer Kısıtlaması (İzin verilen Origin'ler) — r2_storage_worker
    //    ile AYNI liste, bu proje her iki adresten de (GitHub Pages + Cloudflare
    //    Pages) yayında olduğu için.
    const allowedOrigins = [
      "https://abdullah-eymen-asru.github.io",
      "https://abdullah-eymen-asru.pages.dev",
      "http://localhost:4000",
      "http://127.0.0.1:5500",
    ];

    const isAllowedOrigin = allowedOrigins.some((o) => origin.startsWith(o)) || origin.includes(".pages.dev");
    const corsOrigin = isAllowedOrigin ? origin : "https://abdullah-eymen-asru.github.io";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const jsonHata = (mesaj, status) =>
      new Response(JSON.stringify({ message: mesaj }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (!["GET", "PUT", "DELETE"].includes(request.method)) {
      return jsonHata("Sadece GET, PUT, DELETE destekleniyor.", 405);
    }

    if (!isAllowedOrigin && origin !== "") {
      // NOT (hata ayıklama kolaylığı): bkz. r2_storage_worker'daki aynı notun
      // GEREKÇESİ — mesaja hangi origin/referer'ın reddedildiğini de ekliyoruz.
      return new Response(
        JSON.stringify({ message: "Erişim reddedildi: Yetkisiz Origin.", alinanOriginVeyaReferer: origin }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Supabase JWT Doğrulaması (Kullanıcı Girişi Kontrolü) — r2_storage_worker
    //    ile AYNI teknik: Supabase Auth API'sine token'ı gönderip kimliği
    //    doğruluyoruz (service_role anahtarını `apikey` olarak kullanmak,
    //    projede zaten "disable signup"/rate-limit gibi anon-key kısıtlarını
    //    atlamak için r2_storage_worker'da da aynı şekilde tercih edilmiş).
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonHata("Bu işlem için giriş yapmalısın.", 401);
    }
    const token = authHeader.split(" ")[1];
    let userId = null;

    try {
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
      });
      if (!userRes.ok) throw new Error("Geçersiz veya süresi dolmuş oturum.");
      const userData = await userRes.json();
      userId = userData.id;
    } catch (err) {
      return jsonHata("Oturum doğrulanamadı: " + err.message, 401);
    }

    // 3. ROL KONTROLÜ — panel/admin.md'deki requireAuth kurallarının AYNISI,
    //    burada sunucu tarafında (bkz. dosya başındaki mimari notu).
    let rol = null;
    try {
      const profilRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      const profilData = profilRes.ok ? await profilRes.json() : [];
      rol = profilData?.[0]?.role || null;
    } catch (_err) {
      return jsonHata("Rol bilgisi okunamadı.", 500);
    }

    const icerikYoneticisiMi = rol === "editor" || rol === "manager" || rol === "admin";
    if (!icerikYoneticisiMi) {
      return jsonHata("Bu işlem için yetkin yok.", 403);
    }

    // 4. YOL (PATH) KISITLARI — bkz. dosya başındaki mimari notu. `path`,
    //    client'ın `ghRequest(path, ...)` çağrısında verdiği DEĞERİN AYNISI
    //    (URL'nin pathname + search kısmı).
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    let hedefUrl;

    if (url.pathname === "/" || url.pathname === "") {
      // Bağlantı testi / repo bilgisi (bkz. wireBaglantiDogrula) — sadece
      // GET, herhangi bir dosya içeriği döndürmediği için tüm içerik
      // yöneticisi rollerine (editor/manager/admin) açık.
      if (request.method !== "GET") return jsonHata("Bu uç nokta sadece GET destekler.", 405);
      hedefUrl = `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
    } else if (url.pathname.startsWith("/contents/")) {
      const hedefYol = decodeURIComponent(url.pathname.slice("/contents/".length));

      if (hedefYol.includes("..")) {
        return jsonHata("Geçersiz yol.", 400);
      }

      const icerikYolu = hedefYol.startsWith("_posts/") || hedefYol.startsWith("_projects/");
      const yalnizAdminYolu = hedefYol.startsWith("assets/") || hedefYol === "_config.yml";

      if (icerikYolu) {
        // editor/manager/admin — zaten icerikYoneticisiMi ile yukarıda kontrol edildi.
      } else if (yalnizAdminYolu) {
        if (rol !== "admin") {
          return jsonHata("Bu dosya sadece admin tarafından değiştirilebilir.", 403);
        }
      } else {
        return jsonHata("Bu yola bu Worker üzerinden erişilemez.", 403);
      }

      hedefUrl = `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`;
    } else {
      return jsonHata("Bilinmeyen uç nokta.", 404);
    }

    // 5. GitHub'a, WORKER'IN KENDİ PAT'IYLA (kullanıcı hiçbir zaman görmez/göndermez) yönlendir.
    try {
      const ghHeaders = {
        Authorization: `token ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "abdullah-eymen-asru-github-icerik-worker",
      };
      const ghOptions = {
        method: request.method,
        headers: ghHeaders,
        // GitHub Contents API her zaman canlı veri bekler/döndürür; ara
        // katmanlarda önbelleklenmesi panel/admin.md'deki aynı sorunu
        // yaratır (bkz. github-yonetim.js ghRequest'teki "no-store" notu).
        cf: { cacheTtl: 0, cacheEverything: false },
      };
      if (request.method === "PUT" || request.method === "DELETE") {
        ghHeaders["Content-Type"] = "application/json";
        ghOptions.body = await request.text();
      }

      const ghRes = await fetch(hedefUrl, ghOptions);
      return new Response(ghRes.body, {
        status: ghRes.status,
        headers: { ...corsHeaders, "Content-Type": ghRes.headers.get("Content-Type") || "application/json" },
      });
    } catch (err) {
      return jsonHata("GitHub'a ulaşılamadı: " + err.message, 502);
    }
  },
};
