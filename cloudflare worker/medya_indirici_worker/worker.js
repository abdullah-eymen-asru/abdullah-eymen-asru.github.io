/**
 * medya_indirici_worker/worker.js — "Evrensel Medya İndirici" için ince, KAYIT TUTMAYAN aracı.
 *
 * Görev: tarayıcıdan gelen bağlantıyı (YouTube, YouTube Music, X, Instagram, TikTok, Reddit, SoundCloud, Vimeo…) yapılandırılmış
 *        açık kaynak çözümleyiciye iletir ve indirme adresini döner. Medya baytları BU WORKER'DAN GEÇMEZ; tarayıcı doğrudan
 *        çözümleyicinin (tunnel) adresinden indirir → Worker CPU/süre kotası harcanmaz.
 *
 * Arka uçlar (ikisi de açık kaynak, kendi sunucunda çalışır):
 *   1) COBALT_API_URL  — Cobalt v10 API (https://github.com/imputnet/cobalt). YouTube/Music, X, Instagram, TikTok, Reddit, SoundCloud, Vimeo, Twitch…
 *   2) YTDLP_API_URL   — (isteğe bağlı) kendi yt-dlp sarmalayıcın. Cobalt'ın desteklemediği siteler (LinkedIn, NSosyal vb.) için.
 *        Sözleşme: POST {url, mod:"video"|"ses", kalite:"2160"|"1080"|"720"|"best", ses_bicimi:"mp3"|"m4a", ses_kbps:"320"|"128"}
 *                  → 200 {url, dosya_adi}  |  4xx/5xx {hata}
 *
 * Uç nokta:  POST /indir   (Authorization: Bearer <Supabase JWT>; Dönüştürücü yetkisi şart)
 *   gövde: {url, mod:"video"|"ses", kalite:"2160"|"1080"|"720", ses_bicimi:"mp3"|"m4a", ses_kbps:"320"|"128"}
 *   yanıt: {durum:"hazir", url, dosya_adi} | {durum:"secim", secenekler:[{tur,url,onizleme}]} | {hata}
 *
 * GİZLİLİK: Bağlantı/IP/kullanıcı KAYDEDİLMEZ (console.log yok, depolama yok). Çözümleyiciye yalnızca bağlantı + biçim gider.
 *
 * Secret/Var (wrangler secret put ...):
 *   SUPABASE_URL, SUPABASE_ANON_KEY   (herkese açık anon anahtar; yetki, kullanıcının KENDİ JWT'siyle sorgulanır)
 *   COBALT_API_URL                    (örn. https://cobalt.ornek.com — sonunda / olmadan)
 *   COBALT_API_KEY                    (isteğe bağlı; varsa "Api-Key ..." başlığıyla gider)
 *   YTDLP_API_URL, YTDLP_API_KEY      (isteğe bağlı)
 *   MEDYA_ORIGINLERI                  (isteğe bağlı, virgüllü ek origin listesi)
 */

const VARSAYILAN_ORIGINLER = ["https://abdullah-eymen-asru.github.io", "http://127.0.0.1:5500", "http://localhost:5500"];
const COBALT_DESTEKLI = /(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com|x\.com|twitter\.com|instagram\.com|tiktok\.com|reddit\.com|soundcloud\.com|vimeo\.com|twitch\.tv|facebook\.com|fb\.watch|pinterest\.com|bsky\.app|dailymotion\.com|streamable\.com|tumblr\.com|bilibili\.com|loom\.com)$/i;
const YTDLP_ONCELIKLI = /(^|\.)(linkedin\.com|nsosyal\.com\.tr|nsosyal\.com)$/i;
const MAX_URL = 2048;

class HttpHata extends Error { constructor(kod, mesaj) { super(mesaj); this.kod = kod; } }

const izinliOrigin = (env, o) => !!o && (VARSAYILAN_ORIGINLER.includes(o) || String(env.MEDYA_ORIGINLERI || "").split(",").map((s) => s.trim()).includes(o));
const cors = (o) => ({ "Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400" });
const json = (veri, durum, o) => new Response(JSON.stringify(veri), { status: durum, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors(o) } });

/* SSRF/kötüye kullanım: yalnızca genel http(s) adresleri; yerel/özel ağ ve IP-literal reddedilir. */
function urlDogrula(ham) {
  if (typeof ham !== "string" || !ham || ham.length > MAX_URL) throw new HttpHata(400, "Geçerli bir bağlantı gir.");
  let u; try { u = new URL(ham.trim()); } catch { throw new HttpHata(400, "Bağlantı biçimi geçersiz."); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new HttpHata(400, "Yalnızca http(s) bağlantıları desteklenir.");
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) throw new HttpHata(400, "Bu adres desteklenmiyor.");
  return u;
}

async function yetkiKontrol(env, istek) {
  const auth = istek.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpHata(401, "Oturum gerekli.");
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new HttpHata(500, "Sunucu yapılandırması eksik.");
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/donusturucu_yetkisi_var_mi`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  if (r.status === 401) throw new HttpHata(401, "Oturum geçersiz veya süresi dolmuş.");
  if (!r.ok) throw new HttpHata(502, "Yetki doğrulanamadı.");
  if ((await r.json().catch(() => false)) !== true) throw new HttpHata(403, "Bu araca erişim yetkin yok.");
}

const KALITELER = new Set(["2160", "1080", "720"]);
function gelenGovde(g) {
  const mod = g?.mod === "ses" ? "ses" : "video";
  const kalite = KALITELER.has(String(g?.kalite)) ? String(g.kalite) : "1080";
  const ses_bicimi = g?.ses_bicimi === "m4a" ? "m4a" : "mp3";
  const ses_kbps = String(g?.ses_kbps) === "128" ? "128" : "320";
  return { mod, kalite, ses_bicimi, ses_kbps };
}

async function cobaltIste(env, url, o) {
  const govde = { url, downloadMode: o.mod === "ses" ? "audio" : "auto", filenameStyle: "pretty", youtubeVideoCodec: "h264" };
  if (o.mod === "ses") { govde.audioFormat = o.ses_bicimi === "m4a" ? "best" : "mp3"; govde.audioBitrate = o.ses_kbps; }
  else govde.videoQuality = o.kalite;
  const basliklar = { Accept: "application/json", "Content-Type": "application/json" };
  if (env.COBALT_API_KEY) basliklar.Authorization = `Api-Key ${env.COBALT_API_KEY}`;
  const r = await fetch(`${String(env.COBALT_API_URL).replace(/\/+$/, "")}/`, { method: "POST", headers: basliklar, body: JSON.stringify(govde) });
  const j = await r.json().catch(() => null);
  if (!j) throw new HttpHata(502, "İndirme hizmeti beklenmedik yanıt verdi.");
  if (j.status === "tunnel" || j.status === "redirect") return { durum: "hazir", url: j.url, dosya_adi: j.filename || null };
  if (j.status === "picker") return { durum: "secim", secenekler: (j.picker || []).slice(0, 20).map((p) => ({ tur: p.type || "video", url: p.url, onizleme: p.thumb || null })), ses_url: j.audio || null };
  const kod = j?.error?.code || "";
  throw new HttpHata(422, cobaltHata(kod));
}
function cobaltHata(kod) {
  if (/login|auth/.test(kod)) return "Bu içerik oturum gerektiriyor (özel/yaş kısıtlı); indirilemez.";
  if (/not_found|empty/.test(kod)) return "İçerik bulunamadı ya da herkese açık değil.";
  if (/unsupported|invalid|link\.unsupported/.test(kod)) return "Bu bağlantı türü desteklenmiyor.";
  if (/rate_limit/.test(kod)) return "Çok fazla istek; biraz bekleyip yeniden dene.";
  if (/length|too_long/.test(kod)) return "İçerik izin verilen süreden uzun.";
  return "İçerik çözülemedi. Bağlantıyı ve kaynağın herkese açık olduğunu kontrol et.";
}

async function ytdlpIste(env, url, o) {
  const basliklar = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.YTDLP_API_KEY) basliklar.Authorization = `Bearer ${env.YTDLP_API_KEY}`;
  const r = await fetch(String(env.YTDLP_API_URL), { method: "POST", headers: basliklar, body: JSON.stringify({ url, ...o }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.url) throw new HttpHata(422, j?.hata || "İçerik çözülemedi.");
  return { durum: "hazir", url: j.url, dosya_adi: j.dosya_adi || null };
}

async function indir(env, istek) {
  await yetkiKontrol(env, istek);
  const g = await istek.json().catch(() => null);
  const u = urlDogrula(g?.url), o = gelenGovde(g), h = u.hostname.toLowerCase();
  const ytdlpVar = !!env.YTDLP_API_URL, cobaltVar = !!env.COBALT_API_URL;
  if (YTDLP_ONCELIKLI.test(h)) {
    if (!ytdlpVar) throw new HttpHata(501, "Bu site (LinkedIn/NSosyal) için kendi yt-dlp uç noktanı yapılandırman gerekir; Cobalt bu siteleri desteklemez.");
    return ytdlpIste(env, u.href, o);
  }
  if (cobaltVar && COBALT_DESTEKLI.test(h)) {
    try { return await cobaltIste(env, u.href, o); } catch (e) { if (!ytdlpVar || !(e instanceof HttpHata) || e.kod === 400) throw e; }
  }
  if (ytdlpVar) return ytdlpIste(env, u.href, o);
  if (!cobaltVar) throw new HttpHata(501, "İndirme hizmeti yapılandırılmamış (COBALT_API_URL).");
  throw new HttpHata(422, "Bu site Cobalt tarafından desteklenmiyor.");
}

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    if (!izinliOrigin(env, origin)) return new Response("Yasak", { status: 403 });
    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      const yol = new URL(istek.url).pathname.replace(/\/+$/, "");
      if (istek.method === "POST" && yol === "/indir") return json(await indir(env, istek), 200, origin);
      return json({ hata: "Bulunamadı." }, 404, origin);
    } catch (e) {
      if (e instanceof HttpHata) return json({ hata: e.message }, e.kod, origin);
      return json({ hata: "Beklenmeyen bir hata oluştu." }, 500, origin);
    }
  },
};
