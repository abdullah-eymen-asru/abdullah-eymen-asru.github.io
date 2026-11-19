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
 * Uç nokta:  POST /indir   (Authorization: Bearer <Supabase JWT>; "Medya İndirici" aracı yetkisi şart — arac_yetkisi_var_mi('medya_indir'))
 *   gövde: {url, mod:"video"|"ses", kalite:"2160"|"1080"|"720", ses_bicimi:"mp3"|"m4a", ses_kbps:"320"|"128"}
 *   isteğe bağlı başlıklar (üyenin KENDİ çözümleyicisi; sistem kotasından düşmez, hiçbir yere kaydedilmez):
 *        X-Cozumleyici-Adresi: https://…   X-Cozumleyici-Anahtari: …   X-Cozumleyici-Turu: ytdlp | cobalt
 *   yanıt: {durum:"hazir", url, dosya_adi, yontem} | {durum:"secim", secenekler:[{tur,url,onizleme,etiket}], yontem} | {hata};  + kota
 *
 * SIRA (Docker/yerel kurulum GEREKMEZ):
 *   1) üyenin kendi çözümleyicisi → 2) LinkedIn/NSosyal → YTDLP_API_URL → 3) Cobalt (desteklenen siteler) → 4) YTDLP_API_URL (ücretsiz Hugging Face Space ile barındırılabilir; bkz. ytdlp-hf-space/)
 *   5) YEDEK — kurulumsuz "genel sayfa çözümleyici": bağlantı doğrudan medya dosyasıysa onu verir; HTML sayfaysa og:video / <video> / <source> / JSON-LD / .mp4 .webm .mp3 .m3u8 bağlantılarını bulur.
 *      (DRM'li/şifreli akışlar ve oturum gerektiren içerikler çözülemez; bu yöntem gizlilik/anonimlik korumalarını aşmaz.)
 * KOTA: önce medya_kota_durumu, başarıdan sonra medya_kota_harca('medya_indir', 1, kendiMi).
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
const cors = (o) => ({ "Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Cozumleyici-Adresi, X-Cozumleyici-Anahtari, X-Cozumleyici-Turu", "Access-Control-Max-Age": "86400" });
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

async function rpc(env, auth, ad, govde) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${ad}`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(govde || {}) });
  if (r.status === 401) throw new HttpHata(401, "Oturum geçersiz veya süresi dolmuş.");
  return r;
}
async function yetkiKontrol(env, istek) {
  const auth = istek.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpHata(401, "Oturum gerekli.");
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new HttpHata(500, "Sunucu yapılandırması eksik.");
  const r = await rpc(env, auth, "arac_yetkisi_var_mi", { p_arac: "medya_indir" });
  if (!r.ok) throw new HttpHata(502, "Yetki doğrulanamadı.");
  if ((await r.json().catch(() => false)) !== true) throw new HttpHata(403, "Medya İndirici aracına erişim yetkin yok.");
  return auth;
}
async function kotaDurumu(env, auth) {
  const r = await rpc(env, auth, "medya_kota_durumu", { p_arac: "medya_indir" });
  if (!r.ok) throw new HttpHata(502, "Kota durumu okunamadı.");
  return r.json();
}
async function kotaHarca(env, auth, kendi) {
  try { const r = await rpc(env, auth, "medya_kota_harca", { p_arac: "medya_indir", p_miktar: 1, p_kendi: !!kendi }); return r.ok ? await r.json() : null; } catch { return null; }
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
  let r; try { r = await fetch(`${String(env.COBALT_API_URL).replace(/\/+$/, "")}/`, { method: "POST", headers: basliklar, body: JSON.stringify(govde), signal: AbortSignal.timeout(60000) }); } catch { throw new HttpHata(502, "Cobalt çözümleyicisine ulaşılamadı (ücretsiz sunucu uyku modundan uyanıyor olabilir; 1 dk sonra yeniden dene)."); }
  const j = await r.json().catch(() => null);
  if (!j) throw new HttpHata(502, "İndirme hizmeti beklenmedik yanıt verdi.");
  if (j.status === "tunnel" || j.status === "redirect") return { durum: "hazir", url: j.url, dosya_adi: j.filename || null, yontem: "cobalt" };
  if (j.status === "picker") return { durum: "secim", secenekler: (j.picker || []).slice(0, 20).map((p) => ({ tur: p.type || "video", url: p.url, onizleme: p.thumb || null })), ses_url: j.audio || null, yontem: "cobalt" };
  const kod = j?.error?.code || "";
  throw new HttpHata(422, cobaltHata(kod));
}
function cobaltHata(kod) {
  kod = String(kod || "");
  if (/^(error\.)?api\.auth\./.test(kod)) return "Cobalt çözümleyicisi kimlik doğrulaması istiyor (API_AUTH_REQUIRED=1) ama geçerli anahtar gönderilemedi. Yönetici: Cobalt'ta API_AUTH_REQUIRED=0 yap ya da keys.json + API_KEY_URL tanımlayıp aynı UUID'yi Worker'a COBALT_API_KEY olarak gir (rehber 4.13).";
  if (/content\.video\.age|age/.test(kod)) return "Bu içerik yaş kısıtlı; oturum açılmadan indirilemez.";
  if (/youtube\.(login|token|no_matching|decipher|api_error)|youtube\.login/.test(kod)) return "YouTube bu çözümleyicinin IP adresini robot şüphesiyle engelledi (ücretsiz bulut sunucularında sık olur). Birkaç dakika sonra yeniden dene; sürerse kendi çözümleyicini ekle ya da yt-dlp servisini güncelle.";
  if (/video\.private|content\.post\.private|private/.test(kod)) return "İçerik özel; herkese açık değil.";
  if (/region/.test(kod)) return "İçerik bu bölgede kullanılamıyor.";
  if (/live|stream/.test(kod)) return "Canlı yayınlar indirilemez.";
  if (/not_found|empty|unavailable|content\.post\.unavailable/.test(kod)) return "İçerik bulunamadı ya da herkese açık değil.";
  if (/unsupported|invalid|link\.unsupported/.test(kod)) return "Bu bağlantı türü desteklenmiyor.";
  if (/rate_?limit/.test(kod)) return "Çok fazla istek; biraz bekleyip yeniden dene.";
  if (/length|too_long/.test(kod)) return "İçerik izin verilen süreden uzun.";
  return `İçerik çözülemedi${kod ? ` (${kod.replace(/^error\./, "")})` : ""}. Bağlantıyı ve kaynağın herkese açık olduğunu kontrol et.`;
}

async function ytdlpIste(adres, anahtar, url, o) {
  const basliklar = { "Content-Type": "application/json", Accept: "application/json" };
  if (anahtar) basliklar.Authorization = `Bearer ${anahtar}`;
  let r; try { r = await fetch(String(adres), { method: "POST", headers: basliklar, body: JSON.stringify({ url, ...o }), signal: AbortSignal.timeout(90000) }); } catch { throw new HttpHata(502, "Çözümleyiciye ulaşılamadı (uyku modunda olabilir; birkaç saniye sonra yeniden dene)."); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.url) throw new HttpHata(422, j?.hata || "İçerik çözülemedi.");
  return { durum: "hazir", url: j.url, dosya_adi: j.dosya_adi || null, yontem: "ytdlp" };
}

/* ------------------------- Kurulumsuz GENEL SAYFA ÇÖZÜMLEYİCİ ------------------------- */
const UA = "Mozilla/5.0 (compatible; MedyaIndirici/1.0; +gizlilik-dostu)";
const MEDYA_UZANTI = /\.(mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|oga|opus|wav|flac|m3u8)(?:$|[?#])/i;
const turBul = (u, tip = "") => (/mpegurl|\.m3u8/i.test(tip + u) ? "akis" : /^audio\/|\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i.test(tip + " " + u) ? "ses" : "video");
const etiketTur = { video: "🎬 Video", ses: "🎵 Ses", akis: "📡 Akış (HLS)" };
const htmlKacis = (t) => String(t).replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
const dosyaAdiTemizle = (t) => String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || null;

async function sayfaGetir(ilk) {
  let u = ilk;
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await fetch(u.href, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,video/*,audio/*;q=0.9,*/*;q=0.5", "Accept-Language": "tr,en;q=0.8" }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new HttpHata(502, "Sayfaya ulaşılamadı."); }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { try { u = urlDogrula(new URL(r.headers.get("location"), u).href); } catch { throw new HttpHata(422, "Yönlendirme güvenli değil."); } continue; }
    return { r, u };
  }
  throw new HttpHata(422, "Çok fazla yönlendirme.");
}
async function metinOku(r, sinir) {
  const rd = r.body?.getReader(); if (!rd) return "";
  const dec = new TextDecoder("utf-8", { fatal: false }); let t = "", n = 0;
  while (n < sinir) { const { done, value } = await rd.read(); if (done) break; n += value.length; t += dec.decode(value, { stream: true }); }
  try { await rd.cancel(); } catch { /* yok say */ }
  return t;
}

async function genelCozumle(url) {
  const { r, u } = await sayfaGetir(url);
  if (!r.ok) throw new HttpHata(422, `Kaynak yanıt vermedi (${r.status}); içerik herkese açık olmayabilir.`);
  const tip = (r.headers.get("content-type") || "").toLowerCase();
  if (/^(video|audio)\//.test(tip) || /mpegurl/.test(tip) || (/octet-stream/.test(tip) && MEDYA_UZANTI.test(u.pathname))) {
    try { await r.body?.cancel(); } catch { /* yok say */ }
    const ad = decodeURIComponent(u.pathname.split("/").pop() || "") || null;
    return { durum: "hazir", url: u.href, dosya_adi: dosyaAdiTemizle(ad), yontem: "dogrudan", tur: turBul(u.href, tip) };
  }
  if (!/html|xml|json|text/.test(tip)) throw new HttpHata(422, "Bu bağlantı bir medya dosyası ya da web sayfası değil.");
  const html = await metinOku(r, 1.5 * 1024 * 1024);
  const bulunan = new Map();
  const ekle = (ham, ipucu = "", onizleme = null) => {
    if (!ham) return; let h = htmlKacis(ham).trim(); if (!h || /^(data|blob|javascript):/i.test(h)) return;
    try { const v = urlDogrula(new URL(h, u).href); if (!bulunan.has(v.href)) bulunan.set(v.href, { tur: turBul(v.href, ipucu), url: v.href, onizleme }); } catch { /* geçersiz adresi atla */ }
  };
  const baslikM = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html) || /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html);
  const resimM = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
  const onizleme = resimM ? htmlKacis(resimM[1]) : null;
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|og:audio(?::secure_url|:url)?|twitter:player:stream)["'][^>]*content=["']([^"']+)["']/gi)) ekle(m[1], "", onizleme);
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:video(?::secure_url|:url)?|og:audio(?::secure_url|:url)?|twitter:player:stream)["']/gi)) ekle(m[1], "", onizleme);
  for (const m of html.matchAll(/<(?:video|audio|source)\b[^>]*?\bsrc=["']([^"']+)["']/gi)) ekle(m[1], "", onizleme);
  for (const m of html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/gi)) ekle(m[1], "", onizleme);
  for (const m of html.matchAll(/https?:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+?\.(?:mp4|m4v|webm|mov|mp3|m4a|ogg|opus|wav|m3u8)(?:\?[^\s"'<>\\]*)?/gi)) ekle(m[0], "", onizleme);
  const liste = [...bulunan.values()].slice(0, 14).map((x) => ({ ...x, etiket: etiketTur[x.tur] }));
  if (!liste.length) throw new HttpHata(422, "Bu sayfada indirilebilir açık bir medya bağlantısı bulunamadı. (DRM'li, oturum gerektiren ya da oynatıcı betiğiyle yüklenen içerikler çözülemez; kendi yt-dlp çözümleyicini bağlamayı dene.)");
  const ad = dosyaAdiTemizle(baslikM ? htmlKacis(baslikM[1]) : null);
  if (liste.length === 1 && liste[0].tur !== "akis") return { durum: "hazir", url: liste[0].url, dosya_adi: ad ? `${ad}.${(/\.(\w{2,4})(?:$|[?#])/.exec(liste[0].url) || [, "mp4"])[1].toLowerCase()}` : null, yontem: "sayfa", tur: liste[0].tur };
  return { durum: "secim", secenekler: liste, baslik: ad, yontem: "sayfa" };
}

function kendiCozumleyici(istek) {
  const adres = (istek.headers.get("X-Cozumleyici-Adresi") || "").trim();
  if (!adres) return null;
  let u; try { u = urlDogrula(adres); } catch { throw new HttpHata(400, "Kendi çözümleyici adresin geçersiz."); }
  if (u.protocol !== "https:") throw new HttpHata(400, "Kendi çözümleyici adresi https olmalı.");
  const tur = (istek.headers.get("X-Cozumleyici-Turu") || "ytdlp").toLowerCase() === "cobalt" ? "cobalt" : "ytdlp";
  return { adres: u.href, anahtar: (istek.headers.get("X-Cozumleyici-Anahtari") || "").trim().slice(0, 300), tur };
}

async function indir(env, istek) {
  const auth = await yetkiKontrol(env, istek);
  const g = await istek.json().catch(() => null);
  const u = urlDogrula(g?.url), o = gelenGovde(g), h = u.hostname.toLowerCase();
  const kendi = kendiCozumleyici(istek);
  const kota = await kotaDurumu(env, auth);
  if (kendi && kota.kendi_anahtar_izni === false) throw new HttpHata(403, "Kendi çözümleyicinle kullanım şu an kapalı.");
  const sistemKullanilacak = !kendi;
  if (sistemKullanilacak) {
    if (kota.sistem_anahtari_acik === false) throw new HttpHata(403, "Sistem çözümleyicisi kapalı: yalnızca kendi çözümleyicinle kullanabilirsin.");
    if (kota.kullanici?.kalan != null && kota.kullanici.kalan < 1) throw new HttpHata(429, "Günlük indirme kotan doldu. Yarın yenilenir ya da kendi çözümleyicini ekleyebilirsin.");
    if (kota.genel?.kalan != null && kota.genel.kalan < 1) throw new HttpHata(429, "Sitenin günlük ortak indirme kotası doldu. Yarın yenilenir ya da kendi çözümleyicini ekleyebilirsin.");
  }
  const ytdlpVar = !!env.YTDLP_API_URL, cobaltVar = !!env.COBALT_API_URL;
  let sonuc = null, sonHata = null;
  const dene = async (fn) => { try { sonuc = await fn(); return true; } catch (e) { if (!(e instanceof HttpHata) || e.kod === 400 || e.kod === 429) throw e; if (!sonHata || !/Cobalt/.test(e.message)) sonHata = e; return false; } };

  if (kendi) {
    await dene(() => (kendi.tur === "cobalt" ? cobaltIste({ COBALT_API_URL: kendi.adres, COBALT_API_KEY: kendi.anahtar }, u.href, o) : ytdlpIste(kendi.adres, kendi.anahtar, u.href, o)));
  } else if (YTDLP_ONCELIKLI.test(h)) {
    if (!ytdlpVar) throw new HttpHata(501, "Bu site (LinkedIn/NSosyal) için yt-dlp çözümleyicisi gerekir; yönetici YTDLP_API_URL ekleyebilir ya da sen kendi çözümleyicini bağlayabilirsin.");
    await dene(() => ytdlpIste(env.YTDLP_API_URL, env.YTDLP_API_KEY, u.href, o));
  } else {
    if (cobaltVar && COBALT_DESTEKLI.test(h)) await dene(() => cobaltIste(env, u.href, o));
    if (!sonuc && ytdlpVar) await dene(() => ytdlpIste(env.YTDLP_API_URL, env.YTDLP_API_KEY, u.href, o));
  }
  // Yedek: kurulumsuz genel çözümleyici (video/ses bağlantısı ya da sayfa içindeki açık medya adresleri)
  if (!sonuc) {
    try { sonuc = await genelCozumle(u); }
    catch (e) {
      if (e instanceof HttpHata && sonHata && !kendi) throw sonHata;       // özel çözümleyici hatası daha açıklayıcıdır
      throw e;
    }
  }
  sonuc.kota = await kotaHarca(env, auth, !!kendi);
  sonuc.kaynak = kendi ? "kendi" : "site";
  return sonuc;
}

/** Yönetici sağlık denetimi (Sistem Durumu sayfası için). Gizli değer döndürmez; geçerli oturum ister. */
async function saglik(env, istek) {
  const auth = istek.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpHata(401, "Oturum gerekli.");
  await rpc(env, auth, "is_owner");
  const olc = async (fn) => { const t0 = Date.now(); try { const v = await fn(); return { ulasilabilir: true, ms: Date.now() - t0, ...v }; } catch (e) { return { ulasilabilir: false, ms: Date.now() - t0, neden: e?.name === "TimeoutError" ? "zaman aşımı (sunucu uyku modundan uyanıyor olabilir)" : "bağlantı kurulamadı" }; } };
  const cobalt = !env.COBALT_API_URL ? { yapilandirildi: false } : { yapilandirildi: true, ...(await olc(async () => {
    const kok = String(env.COBALT_API_URL).replace(/\/+$/, "");
    const r = await fetch(`${kok}/`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(40000) });
    const j = await r.json().catch(() => null);
    const bas = { "Content-Type": "application/json", Accept: "application/json" }; if (env.COBALT_API_KEY) bas.Authorization = `Api-Key ${env.COBALT_API_KEY}`;
    const d = await fetch(`${kok}/`, { method: "POST", headers: bas, body: JSON.stringify({ url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" }), signal: AbortSignal.timeout(25000) }).then((x) => x.json()).catch(() => null);
    const kod = String(d?.error?.code || "");
    return { surum: j?.cobalt?.version || null, auth_sorunu: /api\.auth\./.test(kod), anahtar_var: !!env.COBALT_API_KEY, test_kodu: kod || (d?.status || null) };
  })) };
  const ytdlp = !env.YTDLP_API_URL ? { yapilandirildi: false } : { yapilandirildi: true, ...(await olc(async () => {
    const r = await fetch(`${new URL(env.YTDLP_API_URL).origin}/saglik`, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) throw new Error("saglik");
    const j = await r.json(); return { surum: j.yt_dlp || null, deno: !!j.deno, ffmpeg: !!j.ffmpeg, soffice: !!j.soffice };
  })) };
  return { cobalt, ytdlp, zaman: new Date().toISOString() };
}

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    if (!izinliOrigin(env, origin)) return new Response("Yasak", { status: 403 });
    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      const yol = new URL(istek.url).pathname.replace(/\/+$/, "");
      if (istek.method === "GET" && yol === "/saglik") return json(await saglik(env, istek), 200, origin);
      if (istek.method === "POST" && yol === "/indir") return json(await indir(env, istek), 200, origin);
      return json({ hata: "Bulunamadı." }, 404, origin);
    } catch (e) {
      if (e instanceof HttpHata) return json({ hata: e.message }, e.kod, origin);
      return json({ hata: "Beklenmeyen bir hata oluştu." }, 500, origin);
    }
  },
};
