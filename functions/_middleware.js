/**
 * functions/_middleware.js — Cloudflare Pages Functions: Gatekeeper "KASA" katmanı
 * ---------------------------------------------------------------------------------
 * assets/js/core/gatekeeper.js sayfayı TARAYICIDA kilitler ("perde"): HTML yine de indirilir,
 * view-source / curl ile okunur. Bu dosya aynı kararı EDGE'DE verir ("kasa"): yetkisiz isteğe
 * orijinal HTML / statik dosya hiç çıkarılmaz; yalnızca minimal bir 403 kilit sayfası döner.
 *
 * KARAR MANTIĞI TEK KAYNAKTAN: ROTALAR kataloğu, yol normalizasyonu, host türü ve karar()
 * doğrudan assets/js/core/gatekeeper.js'ten import edilir (o dosya Node/Workers'ta
 * module.exports ile saf fonksiyonlarını verir; tarayıcı koduna dokunulmaz). Panelde kilitli
 * rota listesi değiştiğinde ya da yeni bir rota eklendiğinde edge kendiliğinden uyar.
 *
 * ÇALIŞMA ALANI
 *   - YALNIZCA pages.dev ve *.pages.dev (önizleme dağıtımları dahil) denetlenir.
 *   - github.io (GitHub Pages burada çalışmaz; orada tarayıcı tabanlı gatekeeper.js sürer),
 *     özel alan adları ve localhost: bu dosya hiçbir şey yapmaz, doğrudan next() döner.
 *   - Allowlist'teki varlıklar (CSS/JS/yazı tipi) ve /hesap, /panel, gizlilik politikası
 *     HER ZAMAN açıktır (giriş sayfası ve kilit sayfası çalışabilsin).
 *
 * YETKİLİ GEÇİŞ (cookie el sıkışması)
 *   Tarayıcının oturumu localStorage'dadır; sayfa isteğiyle SUNUCUYA GİTMEZ. Bu yüzden kilit
 *   sayfası küçük bir script (/_gk/el-sikisma.js) çalıştırır: sitenin kendi supabase-client.js'i
 *   ile oturumu alır (gerekirse SDK yeniler), JWT'yi POST /_gk/oturum'a gönderir. Edge, JWT'yi
 *   Supabase'in gk_bypass_var_mi() RPC'siyle DOĞRULATIR (yetki kararı veritabanında kalır).
 *   Olumluysa HttpOnly + Secure + SameSite=Lax, HMAC imzalı, KISA ömürlü (vars. 15 dk) bir
 *   cookie verilir; sonraki isteklerde cookie yerelde (Supabase'e gitmeden) doğrulanır.
 *   Süre dolunca kilit sayfası script'i aynı işlemi sessizce tekrarlar: askıya alınan ya da
 *   izni kaldırılan üye en geç bu süre içinde dışarıda kalır.
 *
 * ORTAM DEĞİŞKENLERİ (Cloudflare Pages > Settings > Variables and Secrets)
 *   SUPABASE_URL        (zorunlu)  https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY   (zorunlu)  anon public anahtar (gizli değildir)
 *   GK_COOKIE_SECRET    (zorunlu, SECRET)  en az 32 karakter rastgele; cookie imzası için
 *   GK_COOKIE_DAKIKA    (opsiyonel) cookie ömrü, vars. 15 (1-120 arası)
 *   GK_AYAR_TTL_SN      (opsiyonel) site_ayarlari önbellek süresi, vars. 30 (5-300 arası)
 *   GK_HATA_KILIT       (opsiyonel) "1" ise: ayarlar okunamazsa VE bilinen son ayar yoksa KİLİTLE.
 *                       Varsayılan: AÇIK kal (gatekeeper.js ile aynı ilke: erişilebilirlik).
 *
 * DÜRÜST SINIRLAR: bkz. KURULUM-KASA.md (public GitHub deposu, R2 public alan adları, TTL gecikmesi).
 */
import GK from "../assets/js/core/gatekeeper.js";

/* ============================== sabitler ============================== */
const COOKIE_AD = "__Host-gk";
const COOKIE_SURUM = "v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_ZAMAN_ASIMI_MS = 2500;

// Kilitli sitede de açık kalan VARLIKLAR (giriş sayfası + kilit sayfası bunlarla çizilir).
// DİKKAT: _routes.json'daki "exclude" listesiyle AYNI olmalı (orada olanlar Function'a hiç uğramaz).
const ACIK_VARLIK_ONEKLERI = ["/assets/css/", "/assets/js/", "/assets/fonts/", "/_gk/"];
const ACIK_VARLIK_TAMLARI = ["/assets/style.css", "/favicon.ico", "/robots.txt"];

// Rota anahtarına bağlı varlıklar: [yol öneki ya da tam yol, gatekeeper.js rota anahtarı].
// Rota kilitliyse (ya da alan adı komple kilitliyse) bu varlıklar da 403 döner.
const VARLIK_ROTALARI = [
  ["/assets/cv/", "/cv"],
  ["/feed.xml", "/blog"],
  ["/rss.xml", "/blog"],
];

/* ============================= küçük yardımcılar ============================= */
const enc = new TextEncoder();
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uCoz = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const htmlKacis = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sinirla = (v, vars, alt, ust) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(ust, Math.max(alt, Math.round(n))) : vars;
};

const GUVENLIK_BASLIKLARI = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Accept",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
// Function yanıtlarına _headers UYGULANMAZ; kilit sayfasının CSP'sini burada kendimiz veriyoruz.
// Satır içi script/style YOK: her şey 'self'.
// connect-src: kilit sayfasındaki SDK, süresi dolmuş oturumu yenilerken Supabase Auth'a bağlanabilmeli.
const kilitCsp = (env) => {
  let sb = "";
  try { sb = new URL(env.SUPABASE_URL).origin; } catch { /* env eksik: yalnızca 'self' */ }
  return (
    "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'" + (sb ? ` ${sb}` : "") +
    "; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
};

/* ============================ yol / varlık kararı ============================ */
function varlikAcikMi(yolKucuk) {
  return (
    ACIK_VARLIK_TAMLARI.indexOf(yolKucuk) !== -1 ||
    ACIK_VARLIK_ONEKLERI.some((o) => yolKucuk.indexOf(o) === 0)
  );
}
function varlikRotasi(yolKucuk) {
  for (const [onek, anahtar] of VARLIK_ROTALARI) {
    if (onek.endsWith("/") ? yolKucuk.indexOf(onek) === 0 : yolKucuk === onek) return anahtar;
  }
  return null;
}

/**
 * Saf karar: { kilitli, neden } (ağ yok). `ayar` = site_ayarlari satırı ya da null.
 * Eksik/bozuk veri HER ZAMAN açık demektir.
 */
function edgeKarar(ayar, hostname, pathname) {
  const acik = { kilitli: false, neden: null };
  if (GK.hostTuru(hostname) !== "pages.dev") return acik;

  const ham = String(pathname).toLowerCase();
  let cozuk = ham;
  try { cozuk = decodeURIComponent(ham); } catch { /* bozuk % dizisi: ham haliyle devam */ }

  // YOL HİLESİ KALKANI: kodlanmış eğik çizgi / ters eğik çizgi / null bayt / ".." parçası içeren yol hiçbir zaman
  // meşru değildir. "Açık varlık" ya da "daima açık" sayılmasın; herhangi bir kilit aktifse doğrudan kilitli say.
  if (/%2f|%5c|%00/.test(ham) || cozuk.split("/").indexOf("..") !== -1) {
    const liste = ayar && ayar.kilitli_rotalar && ayar.kilitli_rotalar["pages.dev"];
    const kilitVar = !!ayar && (ayar.pages_dev_aktif === false || (Array.isArray(liste) && liste.length > 0));
    return kilitVar ? { kilitli: true, neden: "rota" } : acik;
  }

  // Normalizasyon gatekeeper.js ile birebir aynı; ek olarak "/x/index" -> "/x" (Pages bunu zaten yönlendirir).
  let norm = GK.yolNormalle(pathname);
  if (norm !== "/" && /\/index$/.test(norm)) norm = norm.replace(/\/index$/, "") || "/";

  if (varlikAcikMi(norm)) return acik;

  const anahtar = varlikRotasi(norm);
  if (anahtar) {
    if (ayar && ayar.pages_dev_aktif === false) return { kilitli: true, neden: "alan_adi" };
    const liste = ayar && ayar.kilitli_rotalar && ayar.kilitli_rotalar["pages.dev"];
    return Array.isArray(liste) && liste.indexOf(anahtar) !== -1 ? { kilitli: true, neden: "rota" } : acik;
  }
  return GK.karar(ayar, "pages.dev", norm);
}

/* ============================ site_ayarlari (edge önbellekli) ============================ */
let ayarOnbellek = { v: undefined, t: 0, hata: false }; // v: undefined = hiç alınmadı
let ayarUcusta = null;

async function supabaseFetch(env, yol, init, zamanAsimi = SUPABASE_ZAMAN_ASIMI_MS) {
  const kontrol = new AbortController();
  const z = setTimeout(() => kontrol.abort(), zamanAsimi);
  try {
    return await fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}${yol}`, { ...init, signal: kontrol.signal });
  } finally {
    clearTimeout(z);
  }
}

async function ayarlariGetir(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY tanımlı değil");
  const r = await supabaseFetch(
    env,
    "/rest/v1/site_ayarlari?id=eq.1&select=github_io_aktif,pages_dev_aktif,kilitli_rotalar,bakim_mesaji,guncellenme_tarihi",
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: "application/vnd.pgrst.object+json",
      },
    },
  );
  if (r.status === 404 || r.status === 406) return null; // tablo/satır yok (migration çalışmamış): açık
  if (!r.ok) throw new Error(`site_ayarlari ${r.status}`);
  return r.json();
}

/** -> site_ayarlari satırı | null (kayıt yok) | "HATA" (okunamadı ve bilinen son ayar da yok) */
async function ayarlar(env) {
  const ttl = sinirla(env.GK_AYAR_TTL_SN, 30, 5, 300) * 1000;
  const simdi = Date.now();
  if (ayarOnbellek.v !== undefined && simdi - ayarOnbellek.t < ttl) return ayarOnbellek.v;
  if (!ayarUcusta) {
    ayarUcusta = ayarlariGetir(env)
      .then((v) => { ayarOnbellek = { v, t: Date.now(), hata: false }; return v; })
      .catch((e) => {
        console.error("gatekeeper edge: ayarlar okunamadı:", e && e.message);
        if (ayarOnbellek.v !== undefined) {
          ayarOnbellek = { ...ayarOnbellek, t: Date.now() - ttl + 5000 }; // bilinen son ayarla 5 sn daha dayan
          return ayarOnbellek.v;                                          // (bayat ama bilinen)
        }
        return "HATA";
      })
      .finally(() => { ayarUcusta = null; });
  }
  return ayarUcusta;
}

/* ================================ cookie (HMAC) ================================ */
const anahtarOnbellek = new Map();
async function hmacAnahtari(secret) {
  if (!anahtarOnbellek.has(secret)) {
    anahtarOnbellek.set(
      secret,
      crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    );
  }
  return anahtarOnbellek.get(secret);
}
const secretGecerli = (env) => typeof env.GK_COOKIE_SECRET === "string" && env.GK_COOKIE_SECRET.length >= 32;

async function cookieUret(env, uid, simdiSn) {
  const omurSn = sinirla(env.GK_COOKIE_DAKIKA, 15, 1, 120) * 60;
  const exp = simdiSn + omurSn;
  const yuk = `${COOKIE_SURUM}.${uid}.${exp}`;
  const imza = b64u(await crypto.subtle.sign("HMAC", await hmacAnahtari(env.GK_COOKIE_SECRET), enc.encode(yuk)));
  return { deger: `${yuk}.${imza}`, omurSn };
}

function cookieOku(request) {
  const h = request.headers.get("Cookie") || "";
  for (const parca of h.split(";")) {
    const i = parca.indexOf("=");
    if (i > 0 && parca.slice(0, i).trim() === COOKIE_AD) return parca.slice(i + 1).trim();
  }
  return null;
}

async function cookieGecerli(request, env) {
  if (!secretGecerli(env)) return false;
  const c = cookieOku(request);
  if (!c) return false;
  const p = c.split(".");
  if (p.length !== 4 || p[0] !== COOKIE_SURUM || !UUID_RE.test(p[1]) || !/^\d{1,12}$/.test(p[2])) return false;
  if (Number(p[2]) <= Math.floor(Date.now() / 1000)) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacAnahtari(env.GK_COOKIE_SECRET),
      b64uCoz(p[3]),
      enc.encode(`${p[0]}.${p[1]}.${p[2]}`),
    ); // sabit-zamanlı karşılaştırma
  } catch {
    return false;
  }
}

const cookieBasligi = (deger, omurSn) =>
  `${COOKIE_AD}=${deger}; Path=/; Max-Age=${omurSn}; Secure; HttpOnly; SameSite=Lax`;
const cookieSil = () => `${COOKIE_AD}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

/* ================================== yanıtlar ================================== */
function json(govde, durum, ek = {}) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { "Content-Type": "application/json; charset=utf-8", ...GUVENLIK_BASLIKLARI, ...ek },
  });
}

const SVG_KILIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function kilitSayfasi(url, ayar, neden, metod, env) {
  const mesaj =
    (ayar && typeof ayar === "object" && typeof ayar.bakim_mesaji === "string" && ayar.bakim_mesaji.trim()) ||
    "Bu sayfa şu an bakımda. Kısa süre sonra yeniden açılacak.";
  const baslik = neden === "alan_adi" ? "Bu site şu an erişime kapalı" : "Bu sayfa şu an erişime kapalı";
  const donus = encodeURIComponent(url.pathname + url.search);
  const html =
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow">' +
    `<title>${neden === "alan_adi" ? "Site erişime kapalı" : "Sayfa erişime kapalı"}</title>` +
    '<link rel="stylesheet" href="/assets/style.css">' +
    '<script defer src="/assets/js/vendor/supabase.js"></script>' +
    '<script type="module" src="/_gk/el-sikisma.js"></script></head>' +
    '<body class="gk-govde"><main class="gk-kart" id="gk-kart">' +
    `<div class="gk-ikon">${SVG_KILIT}</div>` +
    `<h1 class="gk-baslik">${htmlKacis(baslik)}</h1>` +
    `<p class="gk-mesaj" id="gk-mesaj">${htmlKacis(mesaj.slice(0, 500))}</p>` +
    `<p class="gk-alt"><a class="gk-giris" rel="nofollow" href="/hesap/giris.html?donus=${htmlKacis(donus)}">Yetkili Girişi</a></p>` +
    "</main></body></html>";
  return new Response(metod === "HEAD" ? null : html, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": kilitCsp(env),
      ...GUVENLIK_BASLIKLARI,
    },
  });
}

// HTML olmayan (görsel, pdf, feed...) yetkisiz istek: sayfa değil, gövdesiz-benzeri düz 403.
function duzYasak(metod) {
  return new Response(metod === "HEAD" ? null : "403", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...GUVENLIK_BASLIKLARI },
  });
}

function htmlIstegiMi(request, url) {
  const yol = url.pathname.toLowerCase();
  const sonSegment = yol.slice(yol.lastIndexOf("/") + 1);
  if (yol.endsWith("/") || sonSegment === "" || /\.html?$/.test(sonSegment) || sonSegment.indexOf(".") === -1) return true;
  const kabul = request.headers.get("Accept") || "";
  return /text\/html/.test(kabul) && !/\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|xml|json|txt|css|js|mjs|woff2?|ttf|mp4|webm|mp3|zip)$/.test(sonSegment);
}

/* ===================== el sıkışma script'i (kilit sayfasında çalışır) ===================== */
function elSikismaScripti(env) {
  const ref = (() => { try { return new URL(env.SUPABASE_URL).hostname.split(".")[0]; } catch { return ""; } })();
  return `/* gatekeeper edge el sıkışması — functions/_middleware.js üretir. Satır içi değil; CSP: script-src 'self'. */
(function () {
  "use strict";
  var DENEME = "aea_gk_el_deneme";
  var kart = document.getElementById("gk-kart");
  var mesaj = document.getElementById("gk-mesaj");
  var REF = ${JSON.stringify(ref)};
  function notDus(m) { if (mesaj) mesaj.textContent = m; }

  // Sonsuz yenileme döngüsü kalkanı: 30 sn içinde en çok 2 deneme.
  var simdi = Date.now(), kayit = [];
  try { kayit = JSON.parse(sessionStorage.getItem(DENEME) || "[]").filter(function (t) { return simdi - t < 30000; }); } catch (e) {}
  if (kayit.length >= 2) return;
  function denemeKaydet() { kayit.push(Date.now()); try { sessionStorage.setItem(DENEME, JSON.stringify(kayit)); } catch (e) {} }

  // Kayıtlı oturum izi yoksa (hiç giriş yapılmamış) hiçbir şey yapma: kart olduğu gibi kalır.
  function oturumIziVar() {
    var anahtar = "sb-" + REF + "-auth-token";
    try { if (localStorage.getItem(anahtar)) return true; } catch (e) {}
    try { if (sessionStorage.getItem(anahtar)) return true; } catch (e) {}
    return false;
  }
  if (!REF || !oturumIziVar()) return;

  function bekle(ms) { return new Promise(function (c) { setTimeout(c, ms); }); }
  function oturumHazirla() {
    // supabase.js (defer) ve bu modül belge sırasında çalışır; yine de kısa süre bekle.
    var bekleme = window.supabase ? Promise.resolve() : bekle(300);
    return bekleme.then(function () { return import("/assets/js/core/supabase-client.js"); })
      .then(function (m) { return m.supabase.auth.getSession(); }) // süresi dolmuşsa SDK yeniler (biz yenilemeyiz)
      .then(function (r) { return r && r.data && r.data.session ? r.data.session.access_token : null; });
  }

  oturumHazirla().then(function (token) {
    if (!token) return;
    denemeKaydet();
    return fetch("/_gk/oturum", { method: "POST", credentials: "same-origin", headers: { Authorization: "Bearer " + token } })
      .then(function (r) {
        if (r.ok) { location.reload(); return; }
        if (r.status === 403) notDus("Bu hesabın bu içeriği görme izni yok. Gerekirse site yöneticisiyle iletişime geç.");
        else if (r.status !== 401) notDus("Yetki doğrulanamadı. Biraz sonra tekrar dene.");
      });
  }).catch(function () { /* sessizce: kart kilitli kalır */ });
})();
`;
}

/* ============================== /_gk/* uç noktaları ============================== */
function jwtYukuOku(token) {
  const p = String(token).split(".");
  if (p.length !== 3 || p.some((x) => !x || x.length > 4096)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64uCoz(p[1])));
  } catch {
    return null;
  }
}

async function gkUcNoktasi(request, env, url) {
  const yol = url.pathname;

  if (yol === "/_gk/el-sikisma.js" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : elSikismaScripti(env), {
      headers: { "Content-Type": "application/javascript; charset=utf-8", ...GUVENLIK_BASLIKLARI, "Cache-Control": "no-cache" },
    });
  }

  if (yol === "/_gk/oturum") {
    if (request.method === "DELETE") return json({ ok: true }, 200, { "Set-Cookie": cookieSil() });
    if (request.method !== "POST") return json({ hata: "yöntem desteklenmiyor" }, 405, { Allow: "POST, DELETE" });
    if (!secretGecerli(env) || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      console.error("gatekeeper edge: GK_COOKIE_SECRET (>=32 karakter), SUPABASE_URL veya SUPABASE_ANON_KEY eksik");
      return json({ hata: "yapılandırma eksik" }, 503);
    }
    const yetki = request.headers.get("Authorization") || "";
    const token = yetki.startsWith("Bearer ") ? yetki.slice(7).trim() : "";
    // Supabase'e gitmeden önce ucuz ön eleme: biçim, süre, rol, kimlik (sahte JWT bir ağ çağrısı bile harcatmaz).
    const yuk = token ? jwtYukuOku(token) : null;
    const simdiSn = Math.floor(Date.now() / 1000);
    if (!yuk || yuk.role !== "authenticated" || !UUID_RE.test(String(yuk.sub)) || !(Number(yuk.exp) > simdiSn)) {
      return json({ hata: "oturum geçersiz" }, 401);
    }
    let sonuc;
    try {
      // Kararı VERİTABANI verir: aynı RPC, aynı kural (owner / askıda olmayan admin / izin tablosu).
      const r = await supabaseFetch(env, "/rest/v1/rpc/gk_bypass_var_mi", {
        method: "POST",
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      }, 4000);
      if (r.status === 401) return json({ hata: "oturum geçersiz" }, 401);
      if (!r.ok) return json({ hata: "doğrulama servisi yanıt vermedi" }, 502);
      sonuc = (await r.json()) === true;
    } catch {
      return json({ hata: "doğrulama servisi yanıt vermedi" }, 502);
    }
    if (!sonuc) return json({ hata: "izin yok" }, 403);
    // RPC aynı token'la başarılı olduğu için "sub" talebi güvenilirdir (Supabase imzayı doğruladı).
    const { deger, omurSn } = await cookieUret(env, String(yuk.sub).toLowerCase(), simdiSn);
    return json({ ok: true }, 200, { "Set-Cookie": cookieBasligi(deger, omurSn) });
  }

  return json({ hata: "bulunamadı" }, 404);
}

/* ================================== ana giriş ================================== */
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // pages.dev dışı (github.io zaten buraya gelmez; özel alan adı, localhost, wrangler dev): dokunma.
  if (GK.hostTuru(url.hostname) !== "pages.dev") return next();

  if (url.pathname.startsWith("/_gk/")) return gkUcNoktasi(request, env, url);
  if (request.method === "OPTIONS") return next();

  const ayar = await ayarlar(env);
  let karar;
  if (ayar === "HATA") {
    // Ayarlar okunamadı VE bilinen son ayar yok. Vars.: açık kal; GK_HATA_KILIT=1 ise kilitle (yalnızca sayfa/varlıklar).
    karar = env.GK_HATA_KILIT === "1" && !varlikAcikMi(url.pathname.toLowerCase()) && !GK.daimaAcikMi(GK.yolNormalle(url.pathname))
      ? { kilitli: true, neden: "alan_adi" }
      : { kilitli: false, neden: null };
  } else {
    karar = edgeKarar(ayar, url.hostname, url.pathname);
  }
  if (!karar.kilitli) return next();

  if (await cookieGecerli(request, env)) {
    // Yetkili: içeriği ver, ama paylaşılan önbelleklere (proxy/CDN) girmesin.
    const yanit = await next();
    const baslik = new Headers(yanit.headers);
    baslik.set("Cache-Control", "private, no-store, max-age=0");
    baslik.append("Vary", "Cookie");
    return new Response(yanit.body, { status: yanit.status, statusText: yanit.statusText, headers: baslik });
  }

  // Yetkisiz: orijinal içeriğe HİÇ dokunulmaz — next() çağrılmaz.
  const metod = request.method === "HEAD" ? "HEAD" : "GET";
  return htmlIstegiMi(request, url)
    ? kilitSayfasi(url, ayar === "HATA" ? null : ayar, karar.neden, metod, env)
    : duzYasak(metod);
}
