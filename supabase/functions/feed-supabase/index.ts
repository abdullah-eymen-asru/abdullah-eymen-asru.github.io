// ============================================================================
// supabase/functions/feed-supabase/index.ts
//
// NE İŞE YARAR?
// "GitHub yerine Supabase'te depola" ile yayınlanan yazı/projeler GitHub'a hiç
// commit edilmediği için Jekyll'ın statik feed.xml / rss.xml dosyalarına
// GİREMEZ (bkz. feed.xml başındaki not). Bu fonksiyon onlar için AYRI, tam
// metinli bir Atom feed'i üretir; _layouts/default.html <head>'inde
// `supabase_feed_url` (_config.yml) doluysa otomatik keşif (auto-discovery)
// etiketiyle ilan edilir — Inoreader/Feedly gibi okuyucular siteyi eklerken
// iki feed'i de (Atom + RSS ve bu) görür.
//
// GÜVENLİK: sadece herkese açık (anon) RPC'yi çağırır:
//   public.sadece_supabase_feed_listele(p_limit)  — migration 0055
// Gizli taslaklar ve iç alanlar (id, created_by, onizleme_kod) dönmez;
// service_role KULLANILMAZ. Crawler/okuyucular Authorization gönderemediği
// için JWT doğrulaması kapalı (bkz. supabase/config.toml).
//
// Gövde HTML'i, sitedeki supabase-yazi.js'in basitMarkdown() işleviyle AYNI
// kuralları izler (önce HTML kaçışı, sonra başlık/kalın/italik/link/dipnot) —
// yani kullanıcı içeriği CDATA içine asla ham HTML olarak girmez.
//
// Deploy:  supabase functions deploy feed-supabase
// İsteğe bağlı secret'lar: SITE_URL, SITE_TITLE
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://abdullah-eymen-asru.github.io").replace(/\/$/, "");
const SITE_TITLE = Deno.env.get("SITE_TITLE") ?? "Abdullah Eymen Asru";
const FEED_ADRESI = `${SUPABASE_URL}/functions/v1/feed-supabase`;

type Yayin = {
  tur: "blog" | "proje";
  slug: string;
  baslik: string;
  tarih: string;
  guncelleme: string | null;
  ozet: string | null;
  yazar_adi: string | null;
  govde: string | null;
};

function xmlKacir(metin: string): string {
  return metin
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function htmlKacir(metin: string): string {
  return metin
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** supabase-yazi.js basitMarkdown() ile aynı kurallar; dipnotlar sondaki numaralı listeye taşınır. */
export function markdownToHtml(md: string): string {
  const kacmis = htmlKacir(md);
  const tanimlar = new Map<string, string>();
  const govde = kacmis.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm, (_m, id: string, metin: string) => {
    tanimlar.set(id, metin);
    return "";
  });
  const sirali: string[] = [];
  const govdeIsaretli = govde.replace(/\[\^([^\]\s]+)\]/g, (_m, id: string) => {
    if (!tanimlar.has(id)) return "";
    if (!sirali.includes(id)) sirali.push(id);
    return `<sup>${sirali.indexOf(id) + 1}</sup>`;
  });

  const ana = govdeIsaretli
    .split(/\n{2,}/)
    .map((blok) => {
      if (blok.trim() === "") return "";
      const baslik = blok.match(/^(#{1,4})[ \t]+(.+)$/);
      if (baslik) return `<h${baslik[1].length}>${baslik[2]}</h${baslik[1].length}>`;
      const satir = blok
        .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replaceAll(/\*(.+?)\*/g, "<em>$1</em>")
        .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
        .replaceAll(/\n/g, "<br>");
      return `<p>${satir}</p>`;
    })
    .filter((p) => p !== "")
    .join("\n");

  const dipnotlar = sirali.length
    ? `\n<hr><ol>${sirali.map((id) => `<li>${tanimlar.get(id)}</li>`).join("")}</ol>`
    : "";
  return ana + dipnotlar;
}

async function yayinlariGetir(): Promise<Yayin[]> {
  const cevap = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sadece_supabase_feed_listele`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_limit: 30 }),
  });
  if (!cevap.ok) {
    throw new Error(`RPC feed: HTTP ${cevap.status}`);
  }
  return (await cevap.json()) as Yayin[];
}

const isoTarih = (t: string | null | undefined) => `${String(t ?? "").slice(0, 10)}T00:00:00Z`;

export function feedUret(yayinlar: Yayin[], simdi = new Date()): string {
  const gecerli = yayinlar.filter((y) => y.slug && (y.tur === "blog" || y.tur === "proje"));
  const sonGuncelleme = gecerli.length
    ? gecerli.map((y) => isoTarih(y.guncelleme ?? y.tarih)).sort().at(-1)!
    : simdi.toISOString();

  const girdiler = gecerli.map((y) => {
    const adres = `${SITE_URL}/icerik/supabase-yazi.html?tur=${y.tur}&slug=${encodeURIComponent(y.slug)}`;
    const kategori = y.tur === "blog" ? "Blog Yazısı" : "Akademik Proje";
    const icerik = markdownToHtml(y.govde ?? "").replaceAll("]]>", "]]&gt;");
    const ozet = y.ozet ? `\n    <summary>${xmlKacir(y.ozet)}</summary>` : "";
    return `  <entry>
    <title>${xmlKacir(y.baslik)}</title>
    <link href="${xmlKacir(adres)}" rel="alternate" type="text/html"/>
    <id>${xmlKacir(adres)}</id>
    <published>${isoTarih(y.tarih)}</published>
    <updated>${isoTarih(y.guncelleme ?? y.tarih)}</updated>
    <author><name>${xmlKacir(y.yazar_adi || SITE_TITLE)}</name></author>
    <category term="${xmlKacir(kategori)}"/>${ozet}
    <content type="html"><![CDATA[${icerik}]]></content>
  </entry>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="tr">
  <title>${xmlKacir(SITE_TITLE)} — Supabase yayınları</title>
  <link href="${xmlKacir(FEED_ADRESI)}" rel="self" type="application/atom+xml"/>
  <link href="${xmlKacir(SITE_URL)}/" rel="alternate" type="text/html"/>
  <id>${xmlKacir(FEED_ADRESI)}</id>
  <updated>${sonGuncelleme}</updated>
${girdiler.join("\n")}
</feed>
`;
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Sadece GET/HEAD.", { status: 405 });
  }
  try {
    const xml = feedUret(await yayinlariGetir());
    return new Response(req.method === "HEAD" ? null : xml, {
      status: 200,
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
        "Cache-Control": "public, max-age=1800",
      },
    });
  } catch (hata) {
    console.error("feed-supabase hatası:", hata);
    return new Response("Feed şu an üretilemiyor.", { status: 502 });
  }
});
