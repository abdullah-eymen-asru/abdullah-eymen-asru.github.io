/**
 * r2-not-ek-worker — Cloudflare Worker
 * -----------------------------------------------------------------------
 * "Fikir & Araştırma Tezgâhı" notlarına eklenen görsel/PDF'ler için ŞİFRELİ
 * (ciphertext) nesne deposu. Dosyalar tarayıcıda AES-GCM ile şifrelenip buraya
 * gelir; Worker ve R2 sadece anlamsız bayt yığını görür.
 *
 * NEDEN AYRI BİR WORKER? Mevcut r2_storage_worker sadece GET (imzalı indirme)
 * yapıyor ve "özel içerik" (content_access) mantığına bağlı. Not ekleri farklı
 * bir güven modeli: her kullanıcı SADECE kendi klasörüne (notlar/<uid>/...) yazar,
 * okur, siler. İkisini karıştırmak mevcut worker'ın yetki mantığını kirletirdi.
 *
 * API (hepsi Authorization: Bearer <supabase access_token> ister)
 *   PUT    ?key=notlar/<uid>/<uuid>   gövde = şifreli bayt     → 200 {ok, boyut}
 *   GET    ?key=notlar/<uid>/<uuid>                            → şifreli bayt (octet-stream)
 *   DELETE ?key=notlar/<uid>/<uuid>                            → 200 {ok}
 *
 * Güvenlik:
 *  - Origin TAM eşleşme (r2_storage_worker'daki düzeltmeyle aynı mantık).
 *  - Token Supabase /auth/v1/user ile doğrulanır; key'in <uid> kısmı token'daki
 *    kullanıcıyla BİREBİR eşleşmelidir (başkasının klasörüne yazma/okuma yok).
 *  - Rol: editor/manager/admin/owner (askıdaki admin hariç) — SQL'deki
 *    not_modulu_yetkili() ile aynı küme.
 *  - Boyut: tek dosya en fazla 25 MB; kullanıcı başına toplam kota KOTA_BAYT
 *    (not_ek_kayitlari tablosundan okunur).
 *  - İçerik şifreli olduğundan Content-Type HER ZAMAN application/octet-stream;
 *    MIME ve dosya adı zaten şifreli notun içinde.
 *
 * Ortam değişkenleri (Worker > Settings > Variables and Secrets):
 *   SUPABASE_URL                 ör. https://eahvcirspmvntffzphye.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    (Secret) — sadece rol/kota sorgusu için
 *   KOTA_BAYT                    (opsiyonel) varsayılan 524288000 (500 MB)
 * R2 Binding:  NOT_EK_BUCKET  → mevcut bucket'ı bağlayabilirsin (anahtarlar
 *              "notlar/" önekiyle ayrıştığı için özel dosyalarla çakışmaz) ya da
 *              ayrı bir bucket açabilirsin (daha temiz, önerilen).
 * -----------------------------------------------------------------------
 */

const IZINLI_ORIGINLER = [
  "https://abdullah-eymen-asru.github.io",
  "https://abdullah-eymen-asru.pages.dev",
  "http://localhost:4000",
  "http://127.0.0.1:5500",
];

const TEK_DOSYA_UST_SINIR = 25 * 1024 * 1024;
const VARSAYILAN_KOTA = 500 * 1024 * 1024;
const ANAHTAR_DESENI = /^notlar\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i;
const YAZMA_ROLLERI = new Set(["editor", "manager", "admin", "owner"]);

function json(govde, durum, cors) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    const izinli = IZINLI_ORIGINLER.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": izinli ? origin : IZINLI_ORIGINLER[0],
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (istek.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!["GET", "PUT", "DELETE"].includes(istek.method)) return json({ error: "Desteklenmeyen yöntem." }, 405, cors);
    if (!izinli) return json({ error: "Erişim reddedildi: yetkisiz Origin." }, 403, cors);

    // --- 1) Anahtar biçimi ---
    const url = new URL(istek.url);
    const anahtar = url.searchParams.get("key") || "";
    const eslesme = ANAHTAR_DESENI.exec(anahtar);
    if (!eslesme) return json({ error: "Geçersiz 'key'." }, 400, cors);
    const anahtarSahibi = eslesme[1].toLowerCase();

    // --- 2) Kimlik doğrulama ---
    const baslik = istek.headers.get("Authorization") || "";
    if (!baslik.startsWith("Bearer ")) return json({ error: "Giriş gerekli." }, 401, cors);
    let kullaniciId;
    try {
      const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: baslik, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
      });
      if (!r.ok) throw new Error("oturum");
      kullaniciId = String((await r.json()).id || "").toLowerCase();
    } catch {
      return json({ error: "Oturum doğrulanamadı." }, 401, cors);
    }

    // --- 3) Sahiplik: key'deki uid == token'daki uid ---
    if (!kullaniciId || kullaniciId !== anahtarSahibi) {
      return json({ error: "Bu klasöre erişim izniniz yok." }, 403, cors);
    }

    // --- 4) Rol ---
    const servis = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    try {
      const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${kullaniciId}&select=role,is_suspended`, {
        headers: servis,
      });
      const profil = pr.ok ? (await pr.json())?.[0] : null;
      const rolOk = profil && YAZMA_ROLLERI.has(profil.role) && !(profil.role === "admin" && profil.is_suspended);
      if (!rolOk) return json({ error: "Bu modül için yetkin yok." }, 403, cors);
    } catch {
      return json({ error: "Yetki doğrulanamadı." }, 502, cors);
    }

    // --- 5) İşlem ---
    try {
      if (istek.method === "GET") {
        const nesne = await env.NOT_EK_BUCKET.get(anahtar);
        if (!nesne) return json({ error: "Bulunamadı." }, 404, cors);
        return new Response(nesne.body, {
          headers: {
            ...cors,
            "Content-Type": "application/octet-stream",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      if (istek.method === "DELETE") {
        await env.NOT_EK_BUCKET.delete(anahtar);
        return json({ ok: true }, 200, cors);
      }

      // PUT
      const bildirilen = parseInt(istek.headers.get("Content-Length") || "0", 10);
      if (!bildirilen || bildirilen > TEK_DOSYA_UST_SINIR + 64) {
        return json({ error: "Dosya boyutu geçersiz ya da 25 MB'ı aşıyor." }, 413, cors);
      }

      // Kota: kayıtlı toplam + bu dosya
      const kota = parseInt(env.KOTA_BAYT || "", 10) || VARSAYILAN_KOTA;
      const kr = await fetch(`${env.SUPABASE_URL}/rest/v1/not_ek_kayitlari?user_id=eq.${kullaniciId}&select=boyut_bayt`, {
        headers: servis,
      });
      const kayitlar = kr.ok ? await kr.json() : [];
      const toplam = kayitlar.reduce((t, k) => t + Number(k.boyut_bayt || 0), 0);
      if (toplam + bildirilen > kota) {
        return json({ error: `Ek depolama kotan doldu (${Math.round(kota / 1048576)} MB). Eski ekleri sil.` }, 413, cors);
      }

      // Üzerine yazmayı engelle: anahtar tek kullanımlık (uuid) olmalı
      if (await env.NOT_EK_BUCKET.head(anahtar)) return json({ error: "Bu anahtar zaten kullanılmış." }, 409, cors);

      const govde = await istek.arrayBuffer();
      if (govde.byteLength > TEK_DOSYA_UST_SINIR + 64 || govde.byteLength < 29) {
        return json({ error: "Dosya boyutu geçersiz." }, 413, cors);
      }
      await env.NOT_EK_BUCKET.put(anahtar, govde, { httpMetadata: { contentType: "application/octet-stream" } });
      return json({ ok: true, boyut: govde.byteLength }, 200, cors);
    } catch (hata) {
      return json({ error: "Depolama hatası: " + (hata?.message || "bilinmiyor") }, 500, cors);
    }
  },
};
