/**
 * substack-feed-proxy — Cloudflare Worker (Dashboard "Quick Edit" ile uyumlu)
 * -----------------------------------------------------------------------
 * NEDEN VAR: icerik/blog.md tarayıcıdan doğrudan Substack RSS feed'ini
 * (abdullaheymenasru.substack.com/feed) çekmeye çalışıyordu ama Substack
 * bu isteğe CORS izni vermiyor (Access-Control-Allow-Origin başlığı yok),
 * bu yüzden site bunun yerine ücretsiz, herkese açık bir üçüncü parti CORS
 * proxy'si (api.allorigins.win) kullanıyordu. O servisin kendi bir uptime
 * garantisi yok ve zaman zaman tamamen 500 hatası döndürüyor (kesintiye
 * giriyor) — Substack yazılarının hiç yüklenmemesinin sebebi buydu.
 *
 * Bu Worker aynı işi (feed'i çekip CORS başlığı ekleyerek geri döndürmek)
 * artık KENDİ altyapında yapıyor — böylece dışarıdaki güvenilmez, ücretsiz
 * bir servise bağımlılık ortadan kalkıyor.
 *
 * GÜVENLİK: Bu Worker GENEL BİR CORS PROXY'Sİ (open proxy) DEĞİLDİR —
 * ziyaretçinin verdiği rastgele bir URL'i çekmez, yalnızca aşağıda sabit
 * (hardcoded) olan KENDİ Substack feed adresini çeker. Bir ?url= parametresi
 * kabul edip onu proxy'lemek, bu Worker'ı kötüye kullanılabilir genel bir
 * proxy'ye çevirirdi (ör. başka birinin bu adresi kendi sitesinden farklı
 * bir hedefe istek atmak için kullanması) — bilerek bu şekilde tasarlanmadı.
 *
 * Ortam değişkeni gerekmez, hiçbir secret gerekmez — feed herkese açık
 * (public) bir RSS adresi olduğu için kimlik doğrulama da gerekmiyor.
 *
 * KURULUM (bir kereye mahsus):
 *   1. Cloudflare Dashboard → Workers & Pages → Create → bu dosyayı yapıştır
 *      (ya da "Create Worker" ile boş bir worker açıp Quick Edit'ten yapıştır).
 *   2. Worker'a bir isim ver (ör. "substack-feed-proxy") → Deploy.
 *   3. Sana verilen *.workers.dev adresini (örn.
 *      https://substack-feed-proxy.aeymena.workers.dev) icerik/blog.md
 *      içindeki SUBSTACK_FEED_PROXY_WORKER_URL sabitine yapıştır — bu site
 *      diğer worker'larda olduğu gibi URL'i env değişkeni yerine doğrudan
 *      istemci JS'inde sabit olarak tutuyor (bkz. GITHUB_PROXY_WORKER_URL,
 *      IZLEME_OKUMA_WORKER_URL örnekleri), tutarlılık için burada da öyle.
 *
 * Farklı bir Substack yayınına geçersen aşağıdaki FEED_URL sabitini
 * güncellemen yeterli — site tarafında ekstra bir değişiklik gerekmez.
 */

const FEED_URL = "https://abdullaheymenasru.substack.com/feed";

// GitHub Pages / Cloudflare Pages / yerel geliştirme — diğer worker'larla
// aynı allowedOrigins deseni. Bu Worker herkese açık, salt-okunur bir RSS
// feed'i döndürdüğü ve kimlik doğrulama/cookie kullanmadığı için "*" ile
// herkese izin vermenin bir sakıncası yok (bkz. izleme_okuma_worker'daki
// aynı gerekçe), ama tutarlılık ve olası kötüye kullanım oranını azaltmak
// için yine de siteyle sınırlı tutuyoruz.
const ALLOWED_ORIGINS = new Set([
  "https://abdullah-eymen-asru.github.io",
  "https://abdullah-eymen-asru.pages.dev",
  "http://localhost:4000",
]);

// Cache API'nin anahtarları gerçek bir Request/URL bekliyor; bu Worker'ın
// tek bir sabit kaynağı (FEED_URL) olduğu için uydurma, sabit iki dahili
// URL kullanıyoruz. Sadece cache anahtarı olarak kullanılıyorlar, dışarıya
// hiç açılmıyorlar.
const FRESH_CACHE_KEY = "https://substack-feed-proxy.internal/cache/fresh";
const FALLBACK_CACHE_KEY = "https://substack-feed-proxy.internal/cache/fallback";
const FRESH_TTL_SECONDS = 600; // 10 dk — normal, hızlı yol
const FALLBACK_TTL_SECONDS = 60 * 60 * 24 * 3; // 3 gün — Substack uzun süre bozuksa bile diye

// NOT: caches.default her Cloudflare POP'unda (veri merkezinde) AYRI bir
// önbellektir, global/tek bir önbellek değildir — bu yüzden farklı
// bölgelerden gelen ilk ziyaretçiler yine de Substack'e gidebilir. Bu bir
// sorun değil: küçük bir kişisel blog için amaç "tekrarlanan istekleri ve
// geçici Substack arızalarını azaltmak", mükemmel/global bir CDN cache'i
// kurmak değil.

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://abdullah-eymen-asru.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
}

// Substack her zaman 200 dönse bile içerik gerçekten bir RSS feed'i mi,
// yoksa boş/bozuk bir gövde mi — bunu kontrol ediyoruz. Bu kontrol
// olmadan, Substack'in bir anlığına attığı boş/bozuk ama yine de "200 OK"
// bir cevap CACHE'E GEÇERLİYMİŞ GİBİ yazılır ve o kötü kopya TTL boyunca
// (önceki sürümde 10 dk, cf.cacheEverything ile) HERKESE servis edilirdi —
// "önce çalıştı, sonra çalışmadı" şikayetinin sebebi büyük olasılıkla buydu.
function gecerliFeedMi(xmlText) {
  if (!xmlText || xmlText.length < 50) return false;
  return /<rss[\s>]|<feed[\s>]/i.test(xmlText) && /<item[\s>]|<entry[\s>]/i.test(xmlText);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // Tarayıcının preflight isteği.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    const cache = caches.default;

    // 1. Hızlı yol: son 10 dk içinde doğrulanmış bir kopya varsa Substack'e
    // hiç gitmeden onu döndür.
    const fresh = await cache.match(FRESH_CACHE_KEY);
    if (fresh) {
      const body = await fresh.text();
      return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
    }

    // blog.md'deki istemci tarafı zaten 10sn'lik kendi timeout'unu koyuyor;
    // burada da Substack'in aşırı yavaş kalması ihtimaline karşı Worker
    // tarafında ayrı bir üst sınır koyuyoruz ki istek sonsuza kadar açık
    // kalıp Worker'ın kendi CPU/süre limitine takılmasın.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      // ÖNEMLİ: cf.cacheEverything artık YOK — Cloudflare'in otomatik edge
      // cache'ine körü körüne güvenmek yerine, içeriği KENDİMİZ doğrulayıp
      // (gecerliFeedMi) sadece gerçekten geçerliyse cache'e yazıyoruz.
      const upstream = await fetch(FEED_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "portfolyo-site-substack-proxy" },
      });

      const xmlText = upstream.ok ? await upstream.text() : "";

      if (upstream.ok && gecerliFeedMi(xmlText)) {
        // Cache API her yazılan kopya için TTL'yi kendi Cache-Control
        // header'ından okuyor — bu yüzden "hızlı yol" (10 dk) ve "son
        // bilinen iyi kopya" (3 gün) için AYRI max-age'li iki response
        // nesnesi oluşturup öyle yazıyoruz; ikisi de aynı gövdeyi taşıyor,
        // sadece TTL'leri farklı.
        const freshRes = new Response(xmlText, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${FRESH_TTL_SECONDS}` },
        });
        const fallbackRes = new Response(xmlText, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${FALLBACK_TTL_SECONDS}` },
        });
        // Hem "hızlı yol" (10 dk) hem de Substack uzun süre bozulsa/çökse
        // bile elde tutulacak "son bilinen iyi kopya" (3 gün) olarak
        // ayrı ayrı yazılıyor — ikincisi olmasa, geçici bir Substack
        // arızası sırasında gelen ziyaretçilere HİÇBİR yazı gösterilemezdi.
        ctx.waitUntil(Promise.all([
          cache.put(FRESH_CACHE_KEY, freshRes),
          cache.put(FALLBACK_CACHE_KEY, fallbackRes),
        ]));

        return new Response(xmlText, {
          status: 200,
          headers: { ...headers, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
        });
      }

      // Substack şu an ya hata döndürdü ya da içerik geçersiz — elimizde
      // önceden doğrulanmış bir "son bilinen iyi kopya" varsa, hatayla
      // uğraşmak yerine ONU döndürüyoruz (ziyaretçi bunun birkaç saat/gün
      // eski olabileceğini fark etmez bile, ama site boş kalmaz).
      const fallback = await cache.match(FALLBACK_CACHE_KEY);
      if (fallback) {
        const body = await fallback.text();
        return new Response(body, {
          status: 200,
          headers: { ...headers, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Substack-Proxy-Fallback": "1" },
        });
      }

      return new Response(
        JSON.stringify({ error: `Substack feed geçersiz/boş döndü (status ${upstream.status})` }),
        { status: 502, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      // Ağ hatası/timeout — burada da önce fallback'i dene, yoksa hata dön.
      const fallback = await cache.match(FALLBACK_CACHE_KEY);
      if (fallback) {
        const body = await fallback.text();
        return new Response(body, {
          status: 200,
          headers: { ...headers, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Substack-Proxy-Fallback": "1" },
        });
      }
      const mesaj = err.name === "AbortError" ? "Substack feed zaman aşımına uğradı" : "Substack feed çekilemedi";
      return new Response(JSON.stringify({ error: mesaj }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
