/**
 * r2-imza-worker — Cloudflare Worker (Dashboard "Quick Edit" ile uyumlu)
 * -----------------------------------------------------------------------
 * R2 bucket'ındaki HERHANGİ BİR nesne için, sıfır npm bağımlılığıyla
 * (yalnızca Web Crypto API kullanarak) AWS Signature V4 ile imzalanmış,
 * süreli (presigned) bir indirme URL'i üretir.
 *
 * Gerekli ortam değişkenleri (Cloudflare Dashboard > Worker > Settings
 * > Variables and Secrets):
 *   ACCOUNT_ID                 Cloudflare hesap ID'si
 *   BUCKET_NAME                 R2 bucket adı
 *   R2_ACCESS_KEY_ID            R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY        R2 API token Secret Access Key   (Encrypt/Secret)
 *   SUPABASE_URL                ör. https://eahvcirspmvntffzphye.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase service_role anahtarı   (Encrypt/Secret)
 *
 * R2 Binding (Settings > Bindings): MY_R2_BUCKET adıyla bucket'ını bağla
 * — bu Worker sadece dosyanın var olup olmadığını (head()) kontrol etmek
 * için binding'i kullanıyor, presigned URL üretimi düz HTTP imzalama.
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || request.headers.get("Referer") || "";

    // 1. Domain / Referer Kısıtlaması (İzin verilen Origin'ler)
    const allowedOrigins = [
      "https://abdullah-eymen-asru.github.io",
      "https://abdullah-eymen-asru.pages.dev",
      "http://localhost:4000",
      "http://127.0.0.1:5500",
    ];

    const isAllowedOrigin = allowedOrigins.some((o) => origin.startsWith(o)) || origin.includes(".pages.dev");
    const corsOrigin = isAllowedOrigin ? origin : "https://abdullah-eymen-asru.github.io";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Sadece GET destekleniyor." }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // İzinsiz Domain Kontrolü
    if (!isAllowedOrigin && origin !== "") {
      // NOT (hata ayıklama kolaylığı): mesaja HANGİ origin/referer'ın
      // reddedildiğini de ekliyoruz. Tarayıcıdan siteni kullanırken bu
      // hatayı alırsan, mesajdaki değer gerçekten
      // "https://abdullah-eymen-asru.github.io" ile TAM eşleşmiyorsa
      // (ör. yanlışlıkla farklı bir adresten test ediyorsundur, ya da bir
      // tarayıcı uzantısı Origin/Referer'ı değiştiriyordur) hemen görürsün.
      return new Response(
        JSON.stringify({
          error: "Erişim reddedildi: Yetkisiz Origin.",
          alinanOriginVeyaReferer: origin,
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(request.url);
    const objectKey = url.searchParams.get("key");

    if (!objectKey) {
      return new Response(JSON.stringify({ error: "'key' parametresi gerekli." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Path traversal / bucket dışına çıkma girişimlerini engelle.
    if (objectKey.includes("..") || objectKey.startsWith("/")) {
      return new Response(JSON.stringify({ error: "Geçersiz 'key' parametresi." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // expiresIn opsiyonel query parametresi (saniye), varsayılan 3600,
    // üst sınır 7 gün (AWS SigV4 presigned URL üst sınırı).
    let expiresIn = parseInt(url.searchParams.get("expiresIn") || "3600", 10);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) expiresIn = 3600;
    expiresIn = Math.min(expiresIn, 604800);

    // 2. Supabase JWT Doğrulaması (Kullanıcı Girişi Kontrolü)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Bu dosyayı indirmek için giriş yapmalısınız." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.split(" ")[1];
    let userId = null;

    try {
      // Supabase Auth API üzerinden token doğrula
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        },
      });

      if (!userRes.ok) {
        throw new Error("Geçersiz veya süresi dolmuş oturum.");
      }

      const userData = await userRes.json();
      userId = userData.id;
    } catch (err) {
      return new Response(JSON.stringify({ error: "Oturum doğrulanamadı: " + err.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // 3. Dosya R2'de Var mı Kontrolü
      const object = await env.MY_R2_BUCKET.head(objectKey);
      if (!object) {
        return new Response(JSON.stringify({ error: "Dosya R2 depolamasında bulunamadı." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 4. Presigned URL Üretimi
      const presignedUrl = await generatePresignedUrl({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        accountId: env.ACCOUNT_ID,
        bucketName: env.BUCKET_NAME,
        objectKey,
        expiresIn,
      });

      // 5. Supabase Veritabanına İndirme Analitiği (Log) Kaydetme
      const logRes = await fetch(`${env.SUPABASE_URL}/rest/v1/indirme_loglari`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          user_id: userId,
          dosya_adi: objectKey,
        }),
      });
      if (!logRes.ok) {
        console.error("İndirme logu yazılamadı:", logRes.status, await logRes.text().catch(() => ""));
      }

      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // İndirme adresini doğrudan döndür. Hem "downloadUrl" hem "url" alanı
      // veriyoruz ki hangi frontend fonksiyonunu kullanırsan kullan çalışsın.
      return new Response(
        JSON.stringify({ downloadUrl: presignedUrl, url: presignedUrl, expiresAt, key: objectKey, expiresIn }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

// Imzalama İşlemi için Yardımcı Fonksiyonlar (Web Crypto API)
async function generatePresignedUrl({ accessKeyId, secretAccessKey, accountId, bucketName, objectKey, expiresIn }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // objectKey klasör içerebilir (ör. "content-id/dosya.pdf"). Her path
  // parçasını AYRI encode edip "/" ile tekrar birleştiriyoruz, aksi halde
  // "/" karakteri "%2F" olur ve hem canonical URI hem dönen link bozulur.
  const encodedKey = objectKey
    .split("/")
    .map((parca) => encodeURIComponent(parca))
    .join("/");
  const canonicalUri = `/${bucketName}/${encodedKey}`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresIn.toString(),
    "X-Amz-SignedHeaders": "host",
  });

  // AWS SigV4 canonical query string ALFABETİK sıralı olmalı; elle sıralıyoruz.
  const canonicalQueryString = [...queryParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, canonicalRequestHash].join("\n");

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const finalQueryString = `${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return `https://${host}${canonicalUri}?${finalQueryString}`;
}

async function sha256Hex(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(key, message) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = await hmacRaw(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacRaw(kDate, regionName);
  const kService = await hmacRaw(kRegion, serviceName);
  return await hmacRaw(kService, "aws4_request");
}

async function hmacRaw(key, message) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}
