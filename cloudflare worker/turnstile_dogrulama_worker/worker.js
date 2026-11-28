/**
 * turnstile-dogrulama — Cloudflare Worker (Bot Kalkanı ön doğrulaması)
 * -----------------------------------------------------------------------
 * NE YAPAR: Tarayıcıdaki Turnstile widget'ının verdiği token'ı Cloudflare'in siteverify uç noktasında doğrular.
 *   POST { "token": "..." }  →  { "ok": true } | { "ok": false, "hata": "..." }
 * Secret YALNIZCA Worker'ın gizli değişkenindedir (TURNSTILE_SECRET); tarayıcıya/repoya girmez.
 * Bu Worker yalnızca Bot Kalkanı AÇIKKEN çağrılır (varsayılan KAPALI) → normal ziyaretlerde hiç istek almaz.
 *
 * KURULUM (bir kez):
 *   1. Cloudflare → Workers & Pages → Create Worker → bu dosyayı yapıştır → Deploy.
 *   2. Settings → Variables and Secrets → Secret: TURNSTILE_SECRET = (Turnstile widget'ının Secret Key'i).
 *   3. Worker adresini _config.yml → turnstile_worker_url alanına yaz (ör. https://turnstile-dogrulama.<hesap>.workers.dev).
 *   4. Turnstile widget → Hostname listesinde şunlar olmalı: abdullah-eymen-asru.github.io ve abdullah-eymen-asru.pages.dev.
 * Yetki: bu uç nokta herkese açıktır (ziyaretçi doğrulanacağı için); ayar değiştirme YOKTUR. Ayarlar yalnızca
 * Supabase'te, Site Sahibi/Admin yetkisiyle (RLS + SECURITY DEFINER RPC) değişir.
 */
const IZINLI_ORIGINLER = new Set([
  "https://abdullah-eymen-asru.github.io",
  "https://abdullah-eymen-asru.pages.dev",
  "http://localhost:4000",
]);
const IZINLI_HOSTLAR = new Set(["abdullah-eymen-asru.github.io", "abdullah-eymen-asru.pages.dev", "localhost"]);
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const PENCERE_MS = 60000, PENCERE_LIMIT = 30;
const sayac = new Map();   // isolate içi, en iyi çaba (kalıcı sınır için Cloudflare Rate Limiting Rules kullan)

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": IZINLI_ORIGINLER.has(origin) ? origin : "https://abdullah-eymen-asru.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
}
function yanit(govde, durum, origin) {
  return new Response(JSON.stringify(govde), { status: durum, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function hizAsildi(ip) {
  const simdi = Date.now();
  if (sayac.size > 2000) sayac.clear();
  const k = sayac.get(ip);
  if (!k || simdi - k.b > PENCERE_MS) { sayac.set(ip, { b: simdi, n: 1 }); return false; }
  k.n += 1;
  return k.n > PENCERE_LIMIT;
}

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (istek.method !== "POST") return yanit({ ok: false, hata: "yontem" }, 405, origin);
    if (origin && !IZINLI_ORIGINLER.has(origin)) return yanit({ ok: false, hata: "origin" }, 403, origin);
    const ip = istek.headers.get("CF-Connecting-IP") || "";
    if (hizAsildi(ip || "?")) return yanit({ ok: false, hata: "cok_istek" }, 429, origin);
    if (!env.TURNSTILE_SECRET) return yanit({ ok: false, hata: "yapilandirma" }, 500, origin);

    let token = "";
    try { token = String((await istek.json())?.token || ""); } catch { return yanit({ ok: false, hata: "gecersiz" }, 400, origin); }
    if (!token || token.length > 2048) return yanit({ ok: false, hata: "gecersiz" }, 400, origin);

    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const kd = new AbortController();
    const z = setTimeout(() => kd.abort(), 8000);
    try {
      const r = await fetch(SITEVERIFY, { method: "POST", body: form, signal: kd.signal });
      if (!r.ok) return yanit({ ok: false, hata: "ulasilamadi" }, 502, origin);
      const s = await r.json();
      if (!s.success) return yanit({ ok: false, hata: "dogrulanamadi" }, 200, origin);
      if (s.hostname && !IZINLI_HOSTLAR.has(String(s.hostname))) return yanit({ ok: false, hata: "host" }, 200, origin);
      return yanit({ ok: true }, 200, origin);
    } catch {
      return yanit({ ok: false, hata: "ulasilamadi" }, 502, origin);
    } finally { clearTimeout(z); }
  },
};
