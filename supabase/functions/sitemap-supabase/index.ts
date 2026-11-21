// ============================================================================
// supabase/functions/sitemap-supabase/index.ts
//
// NE İŞE YARAR?
// "GitHub yerine Supabase'te depola" (bkz. panel/github-yonetim.md, migration
// 0015) ile yayınlanmış blog yazıları / akademik projeler GitHub'a hiç commit
// edilmediği için Jekyll build'i (jekyll-sitemap) onları BİLMEZ — yani
// /sitemap.xml'de görünmezler. Bu fonksiyon aynı içerikler için, HER İSTEKTE
// güncel bir sitemap XML'i üretir; robots.txt'teki ikinci "Sitemap:" satırı
// bu adresi arama motorlarına bildirir:
//   https://<proje>.supabase.co/functions/v1/sitemap-supabase
// (Farklı bir host'ta duran sitemap, ilgili sitenin robots.txt'inde
// belirtildiği sürece Google/Bing tarafından kabul edilir — "cross-submit".)
//
// GÜVENLİK
//   - Fonksiyon SADECE herkese açık (anon) RPC'yi çağırır:
//     public.sadece_supabase_sitemap_listele() (migration 0055) — bu RPC
//     yalnızca yayin_durumu='sadece_supabase' ve tarihi gelmiş satırların
//     (tur, slug, lastmod) bilgisini döndürür, gövde İÇERMEZ; gizli taslaklar
//     (yayin_durumu='taslak') burada ASLA görünmez.
//   - service_role anahtarı KULLANILMAZ, hiçbir yazma işlemi yapılmaz.
//   - Bu yüzden JWT doğrulaması KAPALI olmalı (crawler'lar Authorization
//     header'ı gönderemez) — bkz. supabase/config.toml [functions.sitemap-supabase].
//
// ÖN KOŞUL: supabase/migrations/0055_... çalıştırılmış olmalı (RPC orada).
// Deploy:  supabase functions deploy sitemap-supabase
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY (otomatik enjekte edilir)
//          İsteğe bağlı: supabase secrets set SITE_URL=https://alan-adin.com
//          (verilmezse aşağıdaki VARSAYILAN_SITE_URL kullanılır — _config.yml
//          içindeki `url` ile AYNI olmalı, canonical adresle tutarlılık için).
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VARSAYILAN_SITE_URL = "https://abdullah-eymen-asru.github.io";
const SITE_URL = (Deno.env.get("SITE_URL") ?? VARSAYILAN_SITE_URL).replace(/\/$/, "");

type Yayin = { tur: "blog" | "proje"; slug: string; lastmod: string | null };

function xmlKacir(metin: string): string {
  return metin
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function yayinlariGetir(): Promise<Yayin[]> {
  const cevap = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sadece_supabase_sitemap_listele`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!cevap.ok) {
    throw new Error(`RPC sitemap: HTTP ${cevap.status}`);
  }
  return (await cevap.json()) as Yayin[];
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Sadece GET/HEAD.", { status: 405 });
  }

  try {
    const yayinlar = await yayinlariGetir();

    const satirlar = yayinlar
      .filter((y) => y.slug && (y.tur === "blog" || y.tur === "proje"))
      .map((y) => {
        // icerik/supabase-yazi.md sayfasının gerçek adresi (bkz. blog.md /
        // akademik-projeler.md'deki kart linkleri ve supabase-yazi.js'teki
        // canonical) — sıra ve biçim BİREBİR aynı olmalı.
        const adres = `${SITE_URL}/icerik/supabase-yazi.html?tur=${y.tur}&slug=${encodeURIComponent(y.slug)}`;
        const lastmod = y.lastmod ? `<lastmod>${xmlKacir(String(y.lastmod).slice(0, 10))}</lastmod>` : "";
        return `  <url><loc>${xmlKacir(adres)}</loc>${lastmod}</url>`;
      });

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${satirlar.join("\n")}\n</urlset>\n`;

    return new Response(req.method === "HEAD" ? null : xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Arama motoru tarayıcıları sık sık çekebilir; RPC'ye her seferinde
        // gitmemek için 1 saat önbelleğe izin veriliyor.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (hata) {
    console.error("sitemap-supabase hatası:", hata);
    return new Response("Sitemap şu an üretilemiyor.", { status: 502 });
  }
});
