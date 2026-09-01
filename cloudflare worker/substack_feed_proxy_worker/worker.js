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

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://abdullah-eymen-asru.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // Tarayıcının preflight isteği.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    // blog.md'deki istemci tarafı zaten 10sn'lik kendi timeout'unu koyuyor;
    // burada da Substack'in aşırı yavaş kalması ihtimaline karşı Worker
    // tarafında ayrı bir üst sınır koyuyoruz ki istek sonsuza kadar açık
    // kalıp Worker'ın kendi CPU/süre limitine takılmasın.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const upstream = await fetch(FEED_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "portfolyo-site-substack-proxy" },
        // Cloudflare'in edge cache'i: aynı feed'i her ziyaretçi için ayrı ayrı
        // Substack'ten çekmek yerine, 10 dakikada bir tazelenen paylaşılan bir
        // kopya kullanılır — hem Substack'e gereksiz yük binmez hem de yanıt
        // süresi kısalır.
        cf: { cacheTtl: 600, cacheEverything: true },
      });

      if (!upstream.ok) {
        return new Response(
          JSON.stringify({ error: `Substack feed hatası: ${upstream.status}` }),
          { status: 502, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }

      const body = await upstream.text();
      return new Response(body, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": upstream.headers.get("Content-Type") || "application/xml; charset=utf-8",
          // Tarayıcı da 10 dakika boyunca tekrar istek atmasın diye.
          "Cache-Control": "public, max-age=600",
        },
      });
    } catch (err) {
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
