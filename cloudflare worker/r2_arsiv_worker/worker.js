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
 *   POST /indir           -> yetki + presigned GET (kısa ömürlü)
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
  "https://abdullah-eymen-asru.pages.dev",
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
  const parcalar = t.toLowerCase().split(".").slice(1);
  if (parcalar.some((u) => YASAKLI_UZANTILAR.has(u)))
    throw new HttpHata(415, "Bu dosya türü güvenlik nedeniyle yüklenemez.");
  return t;
}

function klasorYoluDogrula(yol) {
  const y = yol ?? "";
  if (typeof y !== "string" || y.length > 2000) throw new HttpHata(400, "Geçersiz klasör yolu.");
  if (y === "") return "";
  if (!/^([^\/\\\u0000-\u001f\u007f]{1,200}\/){1,10}$/.test(y) || /(^|\/)\.\.(\/|$)/.test(y))
    throw new HttpHata(400, "Geçersiz klasör yolu.");
  return y;
}

function mimeDogrula(mime, sifreli) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (!MIME_WHITELIST.has(m)) throw new HttpHata(415, "Bu dosya türüne izin verilmiyor.");
  return m;
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
  const gercekMime = mimeDogrula(g.mime, sifreli);
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
    ek["response-content-disposition"] = `attachment; filename*=UTF-8''${rfc3986(satir.ad)}`;
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

/* --------------------------------- giriş --------------------------------- */
export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
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
