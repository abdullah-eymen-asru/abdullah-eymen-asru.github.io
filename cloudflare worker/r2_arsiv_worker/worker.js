/**
 * r2_arsiv_worker/worker.js  — 5. izole worker (mevcut 4'ü DEĞİŞTİRMEZ)
 *
 * Görev: R2 Dosya Yöneticisi için sadece "kontrol düzlemi". Dosya baytları
 * ASLA bu worker'dan geçmez; tarayıcı doğrudan R2'ye presigned URL ile
 * PUT/GET yapar (CPU/süre kotası riski sıfır).
 *
 * Uç noktalar (hepsi Authorization: Bearer <Supabase JWT> ister):
 *   GET  /kasa-anahtari   -> kullanıcıya özel E2EE kasa anahtarı (HKDF)
 *   POST /yukle-baslat    -> yetki + MIME/boyut doğrulama + kota rezervi + presigned PUT
 *   POST /yukle-bitir     -> R2'de HEAD ile boyut doğrula, kaydı 'hazir' yap
 *   POST /indir           -> yetki + presigned GET (kısa ömürlü); {satir_ici:true} görsel/PDF önizleme
 *   GET  /d/<slug>        -> (0123/0124) herkese açık bağlantı: BİLGİ SAYFASI (ad, boyut, tür, süre + İndir düğmesi; sayaç artmaz)
 *   GET  /d/<slug>?indir=1 | ?o=1 -> DB doğrular, sayaç artar, imzalı R2 adresine 302 (oturum gerekmez)
 *   GET  /m/<yazi>/<dosya> -> (0128) yazı medyası: ayar açıksa imzalı R2 adresine 302; GET /medya-durum -> {acik, gorsel_otomatik}
 *   POST /sil             -> yetki + R2 toplu silme (binding) + DB kaydı silme
 *
 * Gerekli Secret/Var (wrangler secret put ...):
 *   ACCOUNT_ID, BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   E2EE_KASA_SECRET   (base64, 32 bayt rastgele — SADECE bu worker'da durur)
 * İsteğe bağlı Var: MAX_DOSYA_BAYT (vars. 209715200), R2_SINIF_A_LIMIT (vars. 800000),
 *   R2_SINIF_B_LIMIT (vars. 8000000)
 * R2 binding adı: MY_R2_BUCKET (mevcut r2_storage_worker ile aynı kova)
 */

const IZINLI_ORIGINLER = new Set([
  "https://abdullah-eymen-asru.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const VARSAYILAN_MAX = 209715200; // 200 MB
const INDIRME_SURESI = 300;       // sn
const YUKLEME_SURESI = 900;       // sn

/* ------------------------- MIME beyaz listesi ------------------------- */
// SVG/HTML bilinçli olarak YOK (script taşıyabilir). application/octet-stream
// sadece şifreli (opak) yüklemelerde kabul edilir.
const MIME_WHITELIST = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "text/plain", "text/csv", "text/markdown", "application/json",
  "application/zip", "application/x-7z-compressed", "application/gzip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/flac",
  "video/mp4", "video/webm", "video/quicktime",
]);

// Dosya adındaki HERHANGİ bir uzantı segmenti bunlardan biriyse reddedilir
// ("fatura.exe.pdf" de dahil — çift uzantı numarası).
const YASAKLI_UZANTILAR = new Set([
  "exe","dll","bat","cmd","com","msi","msp","scr","pif","cpl","lnk","reg","inf",
  "ps1","psm1","vbs","vbe","wsf","wsh","js","mjs","cjs","jse","jar","hta","sh","bash",
  "apk","app","dmg","pkg","deb","rpm","bin","run","appimage","iso","img",
  "html","htm","xhtml","svg","swf","php","phtml","asp","aspx","jsp","py","pl","rb",
  "docm","xlsm","pptm","dotm","xltm","potm","ade","adp","chm","gadget","msc","scf",
]);

/* ------------------------------- yardımcılar ------------------------------ */
const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsBasliklari(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(govde, durum, origin) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsBasliklari(origin) },
  });
}

class HttpHata extends Error {
  constructor(durum, mesaj) { super(mesaj); this.durum = durum; }
}

const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(anahtar, veri) {
  const k = await crypto.subtle.importKey(
    "raw", anahtar, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, typeof veri === "string" ? enc.encode(veri) : veri);
}
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64coz = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* ------------------------- SigV4 presigned URL (R2) ------------------------ */
async function presign(env, { method, key, saniye, imzaliBasliklar = {}, ekSorgu = {} }) {
  const host = `${env.ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bolge = "auto", servis = "s3";
  const simdi = new Date();
  const amzTarih = simdi.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260101T000000Z
  const gun = amzTarih.slice(0, 8);
  const kapsam = `${gun}/${bolge}/${servis}/aws4_request`;

  const basliklar = { host, ...imzaliBasliklar };
  const basIsimleri = Object.keys(basliklar).map((k) => k.toLowerCase()).sort();
  const kanonikBasliklar = basIsimleri
    .map((k) => `${k}:${String(Object.entries(basliklar).find(([x]) => x.toLowerCase() === k)[1]).trim()}\n`)
    .join("");
  const imzaliBasStr = basIsimleri.join(";");

  const sorgu = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${kapsam}`,
    "X-Amz-Date": amzTarih,
    "X-Amz-Expires": String(saniye),
    "X-Amz-SignedHeaders": imzaliBasStr,
    ...ekSorgu,
  };
  const kanonikSorgu = Object.keys(sorgu).sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(sorgu[k])}`).join("&");

  const yol = `/${env.BUCKET_NAME}/${key.split("/").map(rfc3986).join("/")}`;
  const kanonikIstek = [method, yol, kanonikSorgu, kanonikBasliklar, imzaliBasStr, "UNSIGNED-PAYLOAD"].join("\n");
  const imzalanacak = ["AWS4-HMAC-SHA256", amzTarih, kapsam, await sha256Hex(kanonikIstek)].join("\n");

  let k = await hmac(enc.encode("AWS4" + env.R2_SECRET_ACCESS_KEY), gun);
  k = await hmac(k, bolge); k = await hmac(k, servis); k = await hmac(k, "aws4_request");
  const imza = hex(await hmac(k, imzalanacak));

  return `https://${host}${yol}?${kanonikSorgu}&X-Amz-Signature=${imza}`;
}

/* ------------------------------- Supabase -------------------------------- */
async function jwtDogrula(env, istek) {
  const auth = istek.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpHata(401, "Oturum gerekli.");
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!r.ok) throw new HttpHata(401, "Oturum geçersiz veya süresi dolmuş.");
  const u = await r.json();
  if (!u?.id || !UUID_RE.test(u.id)) throw new HttpHata(401, "Oturum geçersiz.");
  return u.id;
}

async function rpc(env, ad, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${ad}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const metin = await r.text();
  if (!r.ok) {
    let kod = "", mesaj = "";
    try { const e = JSON.parse(metin); kod = e.code || ""; mesaj = e.message || ""; } catch { /* yoksay */ }
    if (kod === "42501") throw new HttpHata(403, "Bu işlem için yetkin yok.");
    if (kod === "P0002") throw new HttpHata(404, "Öğe bulunamadı.");
    // RPC'lerin kendi (kullanıcıya gösterilebilir) Türkçe hata metinleri
    if (kod === "P0001") throw new HttpHata(409, mesaj);
    throw new HttpHata(502, "Veritabanı işlemi başarısız.");
  }
  return metin ? JSON.parse(metin) : null;
}

async function yetkiZorunlu(env, uid, islem) {
  const var_ = await rpc(env, "r2_arsiv_yetkisi", { p_uid: uid, p_islem: islem });
  if (var_ !== true) throw new HttpHata(403, "Bu işlem için yetkin yok.");
}

async function kotaRezerve(env, sinif, adet) {
  const limit = Number(sinif === "A" ? env.R2_SINIF_A_LIMIT || 800000 : env.R2_SINIF_B_LIMIT || 8000000);
  const izin = await rpc(env, "r2_islem_rezerve_et", { p_sinif: sinif, p_adet: adet, p_limit: limit });
  if (izin !== true) throw new HttpHata(429, "Bu ayki R2 işlem kotası güvenlik eşiğine ulaştı; işlem yapılmadı.");
}

/* --------------------------- doğrulama kuralları --------------------------- */
function adDogrula(ad) {
  if (typeof ad !== "string") throw new HttpHata(400, "Dosya adı gerekli.");
  const t = ad.trim();
  if (t.length < 1 || t.length > 200 || /[\/\\\u0000-\u001f\u007f]/.test(t) || t === "." || t === "..")
    throw new HttpHata(400, "Geçersiz dosya adı.");
  return t;                                      // tur 14: HER format yüklenebilir; riskli türler aşağıda güvenli moda alınır (uzantiRiskli)
}
/** Çalıştırılabilir/komut dosyası/HTML-SVG benzeri uzantı (çift uzantı dahil). Bu dosyalar octet-stream saklanır, YALNIZCA indirilir. */
function uzantiRiskli(ad) { return String(ad).toLowerCase().split(".").slice(1).some((u) => YASAKLI_UZANTILAR.has(u)); }

function klasorYoluDogrula(yol) {
  const y = yol ?? "";
  if (typeof y !== "string" || y.length > 2000) throw new HttpHata(400, "Geçersiz klasör yolu.");
  if (y === "") return "";
  if (!/^([^\/\\\u0000-\u001f\u007f]{1,200}\/){1,10}$/.test(y) || /(^|\/)\.\.(\/|$)/.test(y))
    throw new HttpHata(400, "Geçersiz klasör yolu.");
  return y;
}

function mimeDogrula(mime, sifreli) {
  // tur 14: bilinmeyen/boş tür reddedilmez; "application/octet-stream" olarak saklanır (tarayıcı asla çalıştırmaz/göstermez, yalnızca indirilir).
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return MIME_WHITELIST.has(m) ? m : "application/octet-stream";
}

/* -------------------------------- uç noktalar ------------------------------- */
async function kasaAnahtari(env, uid) {
  // Kullanıcıya özel 256 bit anahtar: HKDF(E2EE_KASA_SECRET, salt, info="kasa:<uid>").
  // Deterministik -> şifre sıfırlansa bile aynı anahtar, eski dosyalar açılır.
  const ham = await crypto.subtle.importKey("raw", b64coz(env.E2EE_KASA_SECRET), "HKDF", false, ["deriveBits"]);
  const bitler = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("r2arsiv-e2ee-v1"), info: enc.encode(`kasa:${uid}`) },
    ham, 256);
  return { anahtar: b64(bitler), surum: 1 };
}

async function yukleBaslat(env, uid, g) {
  await yetkiZorunlu(env, uid, "yukle");
  const max = Number(env.MAX_DOSYA_BAYT || VARSAYILAN_MAX);
  const sifreli = g.sifreli === true;
  const ad = adDogrula(g.ad);
  const klasor = klasorYoluDogrula(g.klasor_yolu);
  const boyut = Number(g.boyut);
  if (!Number.isInteger(boyut) || boyut < 1 || boyut > max)
    throw new HttpHata(413, `Dosya boyutu 1 bayt ile ${Math.floor(max / 1048576)} MB arasında olmalı.`);

  // Şifreli dosyada sunucu içeriği göremez: R2'ye giden tür daima octet-stream,
  // asıl tür sadece (istemci beyanlı) üst veri olarak saklanır ve yine beyaz listeden geçer.
  const riskli = uzantiRiskli(ad);
  const gercekMime = riskli ? "application/octet-stream" : mimeDogrula(g.mime, sifreli);
  const r2Mime = sifreli ? "application/octet-stream" : gercekMime;

  await kotaRezerve(env, "A", 1);                       // PUT = Class A
  const r2Key = `arsiv/${crypto.randomUUID()}`;
  const id = await rpc(env, "r2_arsiv_yukleme_baslat", {
    p_sahip: uid, p_ad: ad, p_klasor_yolu: klasor, p_boyut: boyut,
    p_mime: r2Mime, p_gercek_mime: gercekMime, p_sifreli: sifreli, p_r2_key: r2Key,
  });
  const url = await presign(env, {
    method: "PUT", key: r2Key, saniye: YUKLEME_SURESI,
    imzaliBasliklar: { "content-type": r2Mime },
  });
  return { id, url, basliklar: { "Content-Type": r2Mime }, sure_sn: YUKLEME_SURESI };
}

async function yukleBitir(env, uid, g) {
  if (!UUID_RE.test(g.id || "")) throw new HttpHata(400, "Geçersiz kayıt.");
  await yetkiZorunlu(env, uid, "yukle");
  const bekleyen = (await rpc(env, "r2_arsiv_bekleyen_getir", { p_id: g.id, p_sahip: uid }))?.[0];
  if (!bekleyen) throw new HttpHata(404, "Bekleyen yükleme bulunamadı.");

  await kotaRezerve(env, "B", 1);                       // HEAD = Class B
  const nesne = await env.MY_R2_BUCKET.head(bekleyen.r2_key);
  if (!nesne) throw new HttpHata(409, "Dosya R2'ye ulaşmamış; yükleme tamamlanmadı.");

  const max = Number(env.MAX_DOSYA_BAYT || VARSAYILAN_MAX);
  if (nesne.size !== Number(bekleyen.boyut) || nesne.size > max) {
    // Beyan edilenle gerçek boyut tutmuyor -> nesneyi ve kaydı temizle.
    await env.MY_R2_BUCKET.delete(bekleyen.r2_key);
    await rpc(env, "r2_arsiv_kayitlari_sil", { p_id: g.id });
    throw new HttpHata(422, "Yüklenen dosyanın boyutu beyan edilenle uyuşmuyor; yükleme iptal edildi.");
  }
  await rpc(env, "r2_arsiv_yukleme_bitir", { p_id: g.id, p_sahip: uid, p_boyut: nesne.size });
  return { tamam: true };
}

async function indir(env, uid, g) {
  if (!UUID_RE.test(g.id || "")) throw new HttpHata(400, "Geçersiz kayıt.");
  const satir = (await rpc(env, "r2_arsiv_indirme_anahtari", { p_uid: uid, p_id: g.id }))?.[0];
  if (!satir) throw new HttpHata(403, "Bu dosyaya erişimin yok.");
  await kotaRezerve(env, "B", 1);                       // GET = Class B
  const ek = {};
  if (!satir.sifreli) {
    // Önizleme (satir_ici) YALNIZCA görsel ve PDF için; diğer her şey "attachment" (indirme).
    // Güvenlik: tür, yükleme anında beyaz listeden geçmiş saklı türdür (HTML/SVG zaten yok).
    const satirIciUygun = g.satir_ici === true &&
      (/^image\/(png|jpeg|gif|webp|avif)$/.test(satir.mime || "") || satir.mime === "application/pdf");
    ek["response-content-disposition"] =
      `${satirIciUygun ? "inline" : "attachment"}; filename*=UTF-8''${rfc3986(satir.ad)}`;
    ek["response-content-type"] = satir.mime || "application/octet-stream";
  }
  const url = await presign(env, { method: "GET", key: satir.r2_key, saniye: INDIRME_SURESI, ekSorgu: ek });
  return { url, sifreli: satir.sifreli, sure_sn: INDIRME_SURESI };
}

async function sil(env, uid, g) {
  if (!UUID_RE.test(g.id || "")) throw new HttpHata(400, "Geçersiz kayıt.");
  // Yetki + silinecek anahtarlar tek RPC'de (klasörse alt ağaç dahil).
  const satirlar = await rpc(env, "r2_arsiv_silinecekleri_getir", { p_uid: uid, p_id: g.id });
  const anahtarlar = satirlar.map((s) => s.r2_key).filter(Boolean);
  // Binding.delete(dizi) en çok 1000 anahtar alır; silme işlemleri ücretsizdir.
  for (let i = 0; i < anahtarlar.length; i += 1000) {
    await env.MY_R2_BUCKET.delete(anahtarlar.slice(i, i + 1000));
  }
  // R2 BAŞARILI olduktan sonra DB: arada hata olursa kayıtlar kalır, tekrar deneme güvenlidir.
  await rpc(env, "r2_arsiv_kayitlari_sil", { p_id: g.id });
  return { tamam: true, silinen_nesne: anahtarlar.length };
}


/* ------------------- HERKESE AÇIK BAĞLANTI: GET /d/<slug> (0123) -------------------
 * Oturum/Origin GEREKMEZ (bağlantıyı alan herkes açar). Geçerlilik (süre/iptal/dosya) her tıklamada DB'den doğrulanır; geçerliyse kısa ömürlü imzalı
 * R2 adresine 302 verilir (dosya baytı Worker'dan geçmez). Her açılış R2 Class B kotasına sayılır; kota dolarsa dosya verilmez. */
const sayfa = (durum, baslik, mesaj) => new Response(
  `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${baslik}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.2rem;line-height:1.6"><h1>${baslik}</h1><p>${mesaj}</p></body></html>`,
  { status: durum, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
const htmlKac = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const boyutYaz = (n) => { n = Number(n); if (!(n >= 0)) return "—"; const b = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < b.length - 1) { n /= 1024; i++; } return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${b[i]}`; };
const tarihYaz = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(t)); } catch { return String(t || ""); } };
const turEtiketi = (m) => (/^image\//.test(m || "") ? "Görsel" : m === "application/pdf" ? "PDF belgesi" : /zip|compressed/.test(m || "") ? "Arşiv (ZIP)" : /word|officedocument\.wordprocessing/.test(m || "") ? "Word belgesi" : /sheet|excel/.test(m || "") ? "Excel tablosu" : /^text\//.test(m || "") ? "Metin dosyası" : (m || "Dosya"));
const BILGI_BASLIK = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const BILGI_CSS = ":root{color-scheme:light dark;--bg:#f4f6fb;--kart:#fff;--yazi:#16202e;--soluk:#5b6678;--cizgi:#dde3ee;--vurgu:#2563eb}@media(prefers-color-scheme:dark){:root{--bg:#12151c;--kart:#1b1f2a;--yazi:#e8ecf4;--soluk:#9aa6ba;--cizgi:#2c3342;--vurgu:#6ea8ff}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.2rem;background:var(--bg);color:var(--yazi);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55}.kart{width:min(34rem,100%);background:var(--kart);border:1px solid var(--cizgi);border-radius:18px;padding:1.6rem 1.5rem;box-shadow:0 10px 30px rgba(0,0,0,.08)}.ikon{font-size:2.4rem;line-height:1}h1{font-size:1.35rem;margin:.6rem 0 .3rem;overflow-wrap:anywhere}p.acik{margin:.2rem 0 1rem;color:var(--soluk);overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:auto 1fr;gap:.45rem 1rem;margin:1rem 0 1.3rem;font-size:.92rem}dt{color:var(--soluk)}dd{margin:0;overflow-wrap:anywhere}.dugmeler{display:flex;flex-wrap:wrap;gap:.6rem}.dugme{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.9rem;padding:.55rem 1.2rem;border-radius:12px;border:1px solid var(--vurgu);background:var(--vurgu);color:#fff;font-weight:600;text-decoration:none;font-size:1rem}.dugme.ikincil{background:transparent;color:var(--vurgu)}.alt{margin-top:1.2rem;font-size:.78rem;color:var(--soluk)}";
function bilgiSayfasi(durum, govde) {
  return new Response(`<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${htmlKac(govde.baslik)}</title><style>${BILGI_CSS}</style><body><main class="kart">${govde.html}<p class="alt">Bu bağlantıya sahip olan herkes dosyayı indirebilir.</p></main></body></html>`, { status: durum, headers: BILGI_BASLIK });
}
async function herkeseAcikBaglanti(env, istek) {
  const u = new URL(istek.url);
  const slug = decodeURIComponent(u.pathname.slice(3)).toLowerCase().replace(/\/+$/, "");
  if (!/^[a-z0-9-]{6,80}$/.test(slug)) return sayfa(404, "Bağlantı bulunamadı", "Bu adres geçerli bir paylaşım bağlantısı değil.");
  const dogrudan = u.searchParams.get("indir") === "1" || u.searchParams.get("o") === "1";

  /* 1) VARSAYILAN: bilgi sayfası (sayaç artmaz, R2 kotası harcanmaz). Dosya ayrıntıları + İndir düğmesi. */
  if (!dogrudan) {
    let b;
    try { b = (await rpc(env, "r2_baglanti_bilgi", { p_slug: slug }))?.[0]; } catch { return sayfa(502, "Geçici sorun", "Bağlantı şu an doğrulanamadı. Biraz sonra tekrar dene."); }
    if (!b || b.durum === "yok") return sayfa(404, "Bağlantı bulunamadı", "Bu paylaşım bağlantısı yok ya da silinmiş.");
    if (b.durum === "doldu") return sayfa(410, "Bağlantının süresi doldu", `“${htmlKac(b.ad)}” paylaşımının geçerlilik süresi bitti. Dosyayı sana gönderen kişiden yeni bir bağlantı iste.`);
    if (b.durum === "iptal") return sayfa(410, "Bağlantı iptal edildi", `“${htmlKac(b.ad)}” paylaşımı sahibi tarafından kapatıldı.`);
    if (b.durum !== "gecerli") return sayfa(410, "Dosya artık yok", "Bu bağlantıya ait dosya kaldırılmış.");
    const onizlenebilir = /^image\/(png|jpeg|gif|webp|avif)$/.test(b.mime || "") || b.mime === "application/pdf";
    const satirlar = [["Dosya adı", b.dosya_ad], ["Tür", turEtiketi(b.mime)], ["Boyut", boyutYaz(b.boyut)], ["Paylaşım tarihi", tarihYaz(b.olusturma)], ["Geçerlilik", b.bitis ? `${tarihYaz(b.bitis)} tarihine kadar` : "Süresiz"]];
    const riskliDosya = uzantiRiskli(b.dosya_ad);
    const html = `<div class="ikon" aria-hidden="true">${/^image\//.test(b.mime || "") ? "🖼️" : b.mime === "application/pdf" ? "📕" : "📄"}</div><h1>${htmlKac(b.ad)}</h1>` +
      (b.aciklama ? `<p class="acik">${htmlKac(b.aciklama)}</p>` : "") +
      `<dl>${satirlar.map(([k, v]) => `<dt>${htmlKac(k)}</dt><dd>${htmlKac(v)}</dd>`).join("")}</dl>` +
      (riskliDosya ? `<p class="acik">⚠️ Bu dosya türü çalıştırılabilir olabilir. Yalnızca göndereni tanıyorsan ve güveniyorsan aç.</p>` : "") +
      `<div class="dugmeler"><a class="dugme" href="?indir=1" rel="nofollow">⬇ İndir</a>${onizlenebilir ? '<a class="dugme ikincil" href="?o=1" rel="nofollow">👁 Önizle</a>' : ""}</div>`;
    return bilgiSayfasi(200, { baslik: `${b.ad} · İndir`, html });
  }

  /* 2) İNDİRME / ÖNİZLEME: geçerliliği DB doğrular, sayaç artar, kısa ömürlü imzalı R2 adresine 302. */
  let satir;
  try { satir = (await rpc(env, "r2_baglanti_coz", { p_slug: slug }))?.[0]; } catch { return sayfa(502, "Geçici sorun", "Bağlantı şu an doğrulanamadı. Biraz sonra tekrar dene."); }
  if (!satir || satir.durum === "yok") return sayfa(404, "Bağlantı bulunamadı", "Bu paylaşım bağlantısı yok ya da silinmiş.");
  if (satir.durum === "doldu") return sayfa(410, "Bağlantının süresi doldu", "Bu paylaşım bağlantısının geçerlilik süresi bitti. Dosyayı sana gönderen kişiden yeni bir bağlantı iste.");
  if (satir.durum === "iptal") return sayfa(410, "Bağlantı iptal edildi", "Bu paylaşım bağlantısı sahibi tarafından kapatıldı.");
  if (satir.durum !== "gecerli" || !satir.r2_key) return sayfa(410, "Dosya artık yok", "Bu bağlantıya ait dosya kaldırılmış.");
  try { await kotaRezerve(env, "B", 1); } catch (e) { return sayfa(429, "Şimdilik açılamıyor", "Sitenin aylık dosya erişim kotası doldu. Daha sonra tekrar dene."); }
  const inline = u.searchParams.get("o") === "1" && (/^image\/(png|jpeg|gif|webp|avif)$/.test(satir.mime || "") || satir.mime === "application/pdf");
  const url = await presign(env, { method: "GET", key: satir.r2_key, saniye: INDIRME_SURESI, ekSorgu: {
    "response-content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${rfc3986(satir.ad)}`,
    "response-content-type": satir.mime || "application/octet-stream" } });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

/* ------------------- Yazı medyası: /m/<yazi>/<dosya> ve /medya-durum (0128) ------------------- */
let MEDYA_AYAR = { t: 0, v: { acik: true, gorsel_otomatik: true } };
async function medyaAyar(env) {                                   // 60 sn bellek önbelleği: her görsel için DB sorgusu yok
  if (Date.now() - MEDYA_AYAR.t < 60000) return MEDYA_AYAR.v;
  try { let v = await rpc(env, "r2_medya_ayar_oku", {}); if (Array.isArray(v)) v = v[0]; if (v && typeof v === "object") MEDYA_AYAR = { t: Date.now(), v: { acik: v.acik !== false, gorsel_otomatik: v.gorsel_otomatik !== false } }; } catch { MEDYA_AYAR.t = Date.now() - 50000; }
  return MEDYA_AYAR.v;
}
function medyaDurumYaniti(ayar) {
  return new Response(JSON.stringify(ayar), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } });
}
async function medyaIstegi(env, istek) {
  const u = new URL(istek.url);
  const parca = u.pathname.slice(3).split("/").map((x) => { try { return decodeURIComponent(x); } catch { return ""; } });
  const [yazi, ad] = parca;
  if (parca.length !== 2 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(yazi || "") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(ad || "")) return sayfa(404, "Dosya bulunamadı", "Bu medya adresi geçerli değil.");
  const ayar = await medyaAyar(env);
  if (!ayar.acik) return new Response("Medya geçici olarak kapalı.", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3600", "Content-Type": "text/plain; charset=utf-8" } });
  let satir;
  try { satir = (await rpc(env, "r2_medya_coz", { p_yazi: yazi, p_ad: ad }))?.[0]; } catch { return new Response("Geçici sorun.", { status: 502, headers: { "Cache-Control": "no-store" } }); }
  if (!satir?.r2_key) return sayfa(404, "Dosya bulunamadı", "Bu dosya yok ya da kaldırılmış.");
  try { await kotaRezerve(env, "B", 1); } catch { return new Response("Kota dolu.", { status: 429, headers: { "Cache-Control": "no-store" } }); }
  const satirIci = /^image\/(png|jpeg|gif|webp|avif)$/.test(satir.mime || "") || satir.mime === "application/pdf";
  const adres = await presign(env, { method: "GET", key: satir.r2_key, saniye: INDIRME_SURESI, ekSorgu: {
    "response-content-disposition": `${satirIci ? "inline" : "attachment"}; filename*=UTF-8''${rfc3986(satir.ad)}`,
    "response-content-type": satir.mime || "application/octet-stream" } });
  // Tarayıcı yönlendirmeyi 4 dk saklar: aynı görsel sayfada tekrar tekrar R2'ye gitmez (adres 5 dk geçerli)
  return new Response(null, { status: 302, headers: { Location: adres, "Cache-Control": "private, max-age=240", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

/* --------------------------------- giriş --------------------------------- */
const ASIL_ISLEYICI = {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    const _yol0 = new URL(istek.url).pathname;
    if (istek.method === "GET" && _yol0.startsWith("/d/")) return herkeseAcikBaglanti(env, istek);
    if (istek.method === "GET" && _yol0.startsWith("/m/")) return medyaIstegi(env, istek);
    if (istek.method === "GET" && _yol0 === "/medya-durum") return medyaDurumYaniti(await medyaAyar(env));
    if (istek.method === "OPTIONS") {
      return IZINLI_ORIGINLER.has(origin)
        ? new Response(null, { status: 204, headers: corsBasliklari(origin) })
        : new Response(null, { status: 403 });
    }
    if (!IZINLI_ORIGINLER.has(origin)) return json({ hata: "İzin verilmeyen kaynak." }, 403, "null");

    try {
      const yol = new URL(istek.url).pathname;
      const uid = await jwtDogrula(env, istek);

      if (istek.method === "GET" && yol === "/kasa-anahtari") return json(await kasaAnahtari(env, uid), 200, origin);
      if (istek.method !== "POST") throw new HttpHata(405, "Yöntem desteklenmiyor.");

      const ct = istek.headers.get("Content-Type") || "";
      if (!ct.includes("application/json")) throw new HttpHata(415, "JSON bekleniyor.");
      const govde = await istek.json().catch(() => { throw new HttpHata(400, "Geçersiz JSON."); });

      switch (yol) {
        case "/yukle-baslat": return json(await yukleBaslat(env, uid, govde), 200, origin);
        case "/yukle-bitir":  return json(await yukleBitir(env, uid, govde), 200, origin);
        case "/indir":        return json(await indir(env, uid, govde), 200, origin);
        case "/sil":          return json(await sil(env, uid, govde), 200, origin);
        default: throw new HttpHata(404, "Bulunamadı.");
      }
    } catch (e) {
      if (e instanceof HttpHata) return json({ hata: e.message }, e.durum, origin);
      console.error("r2_arsiv_worker:", e);
      return json({ hata: "Beklenmeyen sunucu hatası." }, 500, origin);
    }
  },
};

/* ============================================================================
 * KOTA KORUMASI (migration 0088 · public.worker_anahtarlari) — Site Sahibi/yetkili yönetici bu servisi panelden
 * (Yedekleme & Verilerim › Worker anahtarları) KAPATTIYSA istek, asıl kod çalışmadan 503 ile reddedilir.
 * Durum Worker örneğinde 30 sn bellekte tutulur (en çok 30 sn'de bir 1 Supabase isteği). Okunamazsa servis AÇIK kabul
 * edilir (fail-open): bu koruma kendi başına bir kesinti sebebi olmamalı. Değerler herkese açıktır (anon anahtar gizli değildir).
 * DÜRÜST NOT: reddedilen istek de Cloudflare'de 1 istek sayılır; kazanç CPU/alt-istektir. İstekleri kaynağında kesen
 * katman istemci kapısıdır (assets/js/core/worker-kapi.js); workers.dev'i tamamen kapatmak isteğe bağlı "sert kapatma"dır.
 * ========================================================================== */
const WK_AD = "r2-arsiv-worker";
const WK_SB_URL = "https://eahvcirspmvntffzphye.supabase.co";
const WK_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhaHZjaXJzcG12bnRmZnpwaHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTgxODMsImV4cCI6MjEwMTc3NDE4M30._f-GKSsffxFo66w3g0NJfmOWEhlsjU4Y6mlcTlcPJ2E";
const WK_TTL_MS = 30000;
let wkDurum = { t: 0, kapali: false };
async function wkKapaliMi() {
  if (Date.now() - wkDurum.t < WK_TTL_MS) return wkDurum.kapali;
  try {
    const kontrol = new AbortController();
    const zamanAsimi = setTimeout(() => kontrol.abort(), 1500);
    const r = await fetch(`${WK_SB_URL}/rest/v1/worker_anahtarlari?ad=eq.${WK_AD}&select=acik`, {
      headers: { apikey: WK_SB_ANON, Authorization: `Bearer ${WK_SB_ANON}` },
      signal: kontrol.signal,
    });
    clearTimeout(zamanAsimi);
    if (r.ok) {
      const satirlar = await r.json();
      wkDurum = { t: Date.now(), kapali: Array.isArray(satirlar) && satirlar.length === 1 && satirlar[0].acik === false };
    } else {
      wkDurum = { t: Date.now() - WK_TTL_MS + 5000, kapali: wkDurum.kapali }; // hata: bilinen son durumla 5 sn daha dayan
    }
  } catch {
    wkDurum = { t: Date.now() - WK_TTL_MS + 5000, kapali: wkDurum.kapali };
  }
  return wkDurum.kapali;
}
const WK_IZINLI_ORIGIN = /^(https:\/\/(abdullah-eymen-asru\.(github\.io|pages\.dev))|http:\/\/localhost(:\d+)?)$/;
export default {
  async fetch(istek, env, ctx) {
    if (istek.method !== "OPTIONS" && (await wkKapaliMi())) {
      const origin = istek.headers.get("Origin") || "";
      return new Response(JSON.stringify({ error: "Bu servis geçici olarak kapatıldı.", kapali: true }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "300",
          "Cache-Control": "no-store",
          ...(WK_IZINLI_ORIGIN.test(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
        },
      });
    }
    return ASIL_ISLEYICI.fetch(istek, env, ctx);
  },
};
