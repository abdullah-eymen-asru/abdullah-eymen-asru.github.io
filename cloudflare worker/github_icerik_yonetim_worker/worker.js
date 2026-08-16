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

/**
 * Verilen yoldaki dosyanın GERÇEK (UTF-8) içeriğini GitHub'dan okuyup düz
 * metin olarak döner — dosya yoksa (404) veya herhangi bir sebeple
 * okunamazsa null döner (bu durumda çağıran, "dosya henüz yok, yeni
 * oluşturuluyor" varsayar ve sahiplik kontrolünü atlar). SADECE § 4.1'deki
 * editor sahiplik kontrolü için kullanılır — Worker'ın PUT/DELETE'i asıl
 * GitHub'a yönlendirme mantığını (aşağıdaki "5." adım) ETKİLEMEZ, o adım
 * kendi isteğini ayrıca atar.
 */
async function githubDosyaOku(env, yol) {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${yol
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        headers: {
          Authorization: `token ${env.GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "abdullah-eymen-asru-github-icerik-worker",
        },
        cf: { cacheTtl: 0, cacheEverything: false },
      }
    );
    if (!res.ok) return null;
    const veri = await res.json();
    if (typeof veri.content !== "string") return null;
    // GitHub base64 içeriği 60 karakterde bir satır sonu ekler.
    const temizB64 = veri.content.replace(/\n/g, "");
    // atob + UTF-8 çözümleme — assets/js/github-yonetim.js'teki b64Decode
    // ile AYNI teknik (Worker ortamında da atob global olarak mevcut).
    const binary = atob(temizB64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_err) {
    return null;
  }
}

/**
 * Basit front-matter alan okuyucu — assets/js/github-yonetim.js'teki
 * frontMatterOku'nun SADE bir alt kümesi, burada sadece sahiplik kontrolü
 * için gereken birkaç alana (yazar_id, author) ihtiyaç var.
 */
function frontMatterAlanlariniOku(ham) {
  const eslesme = ham.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const alanlar = {};
  if (!eslesme) return alanlar;
  eslesme[1].split(/\r?\n/).forEach((satir) => {
    const m = satir.match(/^([a-zA-Z_]+):\s?(.*)$/);
    if (!m) return;
    let deger = m[2].trim();
    if (deger.startsWith('"') && deger.endsWith('"') && deger.length >= 2) {
      deger = deger.slice(1, -1).replace(/\\"/g, '"');
    }
    alanlar[m[1]] = deger;
  });
  return alanlar;
}

/**
 * Mevcut bir dosyanın front-matter'ı, kendisini düzenlemeye/silmeye
 * çalışan editor'e mi ait? Önce (varsa) GÜVENİLİR yazar_id alanı karşılaştırılır.
 * yazar_id hiç yoksa (bu alan eklenmeden ÖNCE yazılmış, çok eski bir dosya)
 * isim/e-posta eşleşmesine düşülür — bu SADECE editor'ün KENDİ eski
 * içeriğini erişilemez hâle getirmemek içindir, güvenlik AÇISINDAN daha
 * zayıf bir kontroldür ama front-matter'daki "author" alanı zaten panel
 * tarafından dolduruluyor olduğundan (editor kendi adı dışında bir şey
 * yazamaz, bkz. wireYazarAlani) pratikte güvenilirdir.
 */
function editorSahibiMi(frontMatterAlanlari, userId, kullaniciAdi, kullaniciEmail) {
  if (frontMatterAlanlari.yazar_id) return frontMatterAlanlari.yazar_id === userId;
  const yazar = (frontMatterAlanlari.author || "").trim().toLocaleLowerCase("tr");
  if (!yazar) return false;
  const adaylar = [kullaniciAdi, kullaniciEmail]
    .filter(Boolean)
    .map((s) => s.trim().toLocaleLowerCase("tr"));
  return adaylar.includes(yazar);
}

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
    //    full_name/email de burada okunuyor — SADECE § 4.1'deki "editor
    //    sahiplik kontrolü" için (front-matter'da yazar_id bulunmayan ÇOK
    //    ESKİ dosyalarda isimle eşleştirme yapabilmek adına, bkz. orada).
    let rol = null;
    let kullaniciAdi = null;
    let kullaniciEmail = null;
    try {
      const profilRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role,full_name,email`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const profilData = profilRes.ok ? await profilRes.json() : [];
      rol = profilData?.[0]?.role || null;
      kullaniciAdi = profilData?.[0]?.full_name || null;
      kullaniciEmail = profilData?.[0]?.email || null;
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

      // NOT: "_posts"/"_projects" KÖK klasörünün KENDİSİ de listelenebiliyor
      // olmalı (ör. klasorListesiYukle() -> ghGetContents("_posts")) — bu
      // durumda hedefYol'un SONUNDA "/" yok, sadece "_posts/2026" gibi ALT
      // yollarda var. Sadece startsWith("_posts/") kontrolü kök klasörün
      // TAM ADINI (trailing slash'sız) reddediyordu, bu da "Klasörler" ve
      // "Mevcut İçerikler" listelerinin sessizce boş görünmesine yol
      // açıyordu (client'taki .catch(() => []) hatayı yutuyor) — düzeltildi.
      const icerikYolu =
        hedefYol === "_posts" ||
        hedefYol.startsWith("_posts/") ||
        hedefYol === "_projects" ||
        hedefYol.startsWith("_projects/");
      const yalnizAdminYolu = hedefYol === "assets" || hedefYol.startsWith("assets/") || hedefYol === "_config.yml";

      if (icerikYolu) {
        // editor/manager/admin — zaten icerikYoneticisiMi ile yukarıda kontrol edildi.
        //
        // 4.1) SAHİPLİK KONTROLÜ — SADECE role='editor' İÇİN (manager ve
        //      admin'e bu kısıt HİÇ uygulanmaz, migration 0016'daki gibi
        //      "editor ile aynı yazma yetkisi" onlarda hâlâ TÜM içeriği
        //      kapsıyor). Bir editor, _posts//_projects altında MEVCUT bir
        //      dosyayı (PUT ile üzerine yazarak düzenleme/yeniden adlandırma
        //      YA DA DELETE ile silme) değiştirmeye çalışıyorsa, o dosyanın
        //      front-matter'ındaki yazar_id kendisine ait DEĞİLSE istek
        //      burada, GitHub'a hiç gitmeden reddedilir. Bu, panelin kendi
        //      buton gizleme kontrolünün (bkz. github-yonetim.js
        //      icerikKendisineMiAit/icerikEditoreKapaliMi) GERÇEK sunucu
        //      taraflı karşılığıdır — o istemci kontrolü sadece bir
        //      kolaylık, ASIL yetki sınırı burasıdır (Worker'ın PAT'a tek
        //      erişimi olan taraf olması gibi, bkz. dosya başı notu).
        //      YENİ bir dosya oluşturuluyorsa (henüz GitHub'da yoksa) bu
        //      kontrol uygulanmaz — yeni içerik zaten editor'ün kendisine
        //      ait olacaktır.
        // .gitkeep dosyaları (bkz. klasordekiGitkeepiTemizle/klasorBosaldiysaGitkeepEkle
        // içinde github-yonetim.js) bir "yazar"a ait İÇERİK değil, boş klasörleri
        // Git'te var etmek için konan teknik birer yer tutucudur — front-matter'ları
        // (dolayısıyla yazar_id'leri) da yoktur, bu yüzden sahiplik kontrolünün
        // DIŞINDA tutuluyorlar (aksi hâlde bir editor, kendi yeni içeriğini
        // eklerken klasördeki .gitkeep'i temizleyemezdi).
        const gitkeepDosyasiMi = hedefYol === ".gitkeep" || hedefYol.endsWith("/.gitkeep");
        if (!gitkeepDosyasiMi && rol === "editor" && (request.method === "PUT" || request.method === "DELETE")) {
          const mevcutDosya = await githubDosyaOku(env, hedefYol);
          if (mevcutDosya) {
            const mevcutFrontMatter = frontMatterAlanlariniOku(mevcutDosya);
            const sahipUyusuyorMu = editorSahibiMi(mevcutFrontMatter, userId, kullaniciAdi, kullaniciEmail);
            if (!sahipUyusuyorMu) {
              return jsonHata("Bu içeriği düzenleme/silme yetkin yok — başka bir yazara ait.", 403);
            }
          }
        }
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
