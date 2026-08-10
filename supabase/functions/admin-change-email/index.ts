// ============================================================================
// supabase/functions/admin-change-email/index.ts
//
// NE İŞE YARAR?
// Panelden ("Panelim") kullanıcının kendi başına yaptığı e-posta değişikliği
// HEM eski HEM yeni adrese onay ister (Secure email change) — bu kasıtlı bir
// güvenlik önlemi (bkz. panel.js -> wireEmailChange()). Ama eski adresine
// artık erişimi OLMAYAN bir kullanıcı bu yüzden kilitlenebilir. Bu durumda
// tek çözüm site yöneticisinin müdahalesidir: admin panelinden kullanıcının
// yeni e-postasını girer, SADECE o yeni adrese bir onay maili/kodu gider —
// eski adrese HİÇBİR ŞEY gitmez, eski adrese erişim GEREKMEZ.
//
// NEDEN BİR EDGE FUNCTION GEREKİYOR?
// Bunu yapabilmek için Supabase'in "service_role" (admin) API'si olan
// `auth.admin.updateUserById()` gerekir — bu, normal kullanıcı istemcisinin
// tabi olduğu "Secure email change" (çift onay) kuralına TABİ DEĞİLDİR ve
// sadece service_role ile çağrılabilir; service_role anahtarı ASLA
// tarayıcıya/frontend koduna konulamaz, bu yüzden bu işi bir Edge Function
// üstlenir (delete-account fonksiyonuyla birebir aynı desen).
//
// GÜVENLİK
//   1) Çağıran kendi oturum token'ını gönderir.
//   2) Fonksiyon bu token'ın GERÇEKTEN kime ait olduğunu doğrular.
//   3) Çağıranın "profiles.role = 'admin'" olduğu veritabanından
//      (service_role ile, çağıranın kendi beyanına GÜVENMEDEN) doğrulanır.
//   4) Sadece o zaman hedef kullanıcının e-postası değiştirilir.
//
// DAVRANIŞ
//   `auth.admin.updateUserById(hedefId, { email: yeniEmail })` çağrılırken
//   `email_confirm` parametresi BİLİNÇLİ OLARAK gönderilMİYOR (varsayılanı
//   kullanıyoruz) — proje ayarlarında "Confirm email" açık olduğu sürece bu,
//   Supabase'in YENİ adrese bir onay maili/kodu göndermesini VE e-postanın
//   sadece o mail/kod onaylanınca (kullanıcı linke tıklayınca veya
//   hesap-onayla.html benzeri bir ekrandan/panelden kodu girince) fiilen
//   değişmesini sağlar. Eski adrese HİÇBİR mail gitmez — admin API, client
//   API'nin tabi olduğu "Secure email change" kuralından muaftır.
//
// Deploy:  supabase functions deploy admin-change-email
// Secrets: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY, Edge Function
//          ortamına otomatik enjekte edilir, elle eklemene gerek yok.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// CORS: sadece kendi sitenin domainlerinden çağrılabilsin.
// delete-account/index.ts ile AYNI listeyi kullan — domain değiştirirsen
// ikisini birlikte güncellemeyi unutma.
//
// ÖNEMLİ: Buradaki listede OLMAYAN bir adresten (ör. kendi özel domainin,
// "www." önekli/eksiz farklı bir varyant, ya da Cloudflare Pages'in
// otomatik ürettiği bir preview URL'i) siteyi açıp bu fonksiyonu
// çağırırsan, tarayıcıda "Load failed" / "Failed to fetch" hatası alırsın
// — fonksiyon çalışır ama tarayıcı yanıtı CORS nedeniyle bloklar. Siteni
// hangi adres(ler)den yayınlıyorsan HEPSİNİ buraya ekle.
const ALLOWED_ORIGINS = [
  "https://abdullah-eymen-asru.pages.dev",
  "https://abdullah-eymen-asru.github.io",
  "http://localhost:4000", // yerel Jekyll geliştirme
  // "https://kendi-domainim.com",   // özel domain kullanıyorsan yorumdan çıkar
  // "https://www.kendi-domainim.com",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Çok basit bir e-posta biçim kontrolü — asıl doğrulama zaten Supabase
// Auth'ta (ve az sonra gönderilecek onay mailinde) yapılır, burası sadece
// bariz yazım hatalarını erken yakalamak için.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Sadece POST." }), { status: 405, headers });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Oturum token'ı eksik." }), { status: 401, headers });
  }

  let hedefKullaniciId = "";
  let yeniEposta = "";
  try {
    const body = await req.json();
    hedefKullaniciId = typeof body?.hedef_kullanici_id === "string" ? body.hedef_kullanici_id.trim() : "";
    yeniEposta = typeof body?.yeni_eposta === "string" ? body.yeni_eposta.trim().toLowerCase() : "";
  } catch {
    return new Response(JSON.stringify({ error: "Geçersiz istek gövdesi." }), { status: 400, headers });
  }

  if (!hedefKullaniciId || !yeniEposta) {
    return new Response(
      JSON.stringify({ error: "hedef_kullanici_id ve yeni_eposta zorunludur." }),
      { status: 400, headers }
    );
  }
  if (!EMAIL_REGEX.test(yeniEposta)) {
    return new Response(JSON.stringify({ error: "Geçersiz e-posta biçimi." }), { status: 400, headers });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Token gerçekten kime ait?
  const { data: userData, error: userErr } = await adminClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Geçersiz veya süresi dolmuş oturum." }), {
      status: 401,
      headers,
    });
  }
  const callerId = userData.user.id;

  // 2) Çağıran GERÇEKTEN admin mi? (kendi beyanına asla güvenme, DB'den doğrula)
  const { data: callerProfile, error: profileErr } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .single();

  if (profileErr || callerProfile?.role !== "admin") {
    return new Response(
      JSON.stringify({ error: "Yetkisiz işlem: sadece admin bir üyenin e-postasını değiştirebilir." }),
      { status: 403, headers }
    );
  }

  // 3) Hedef kullanıcı gerçekten var mı? (yanlış id ile boşa mail
  //    göndermeyi/olası hataları önceden yakalamak için)
  const { data: hedefKullanici, error: hedefErr } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("id", hedefKullaniciId)
    .single();

  if (hedefErr || !hedefKullanici) {
    return new Response(JSON.stringify({ error: "Hedef kullanıcı bulunamadı." }), {
      status: 404,
      headers,
    });
  }
  if (hedefKullanici.email?.toLowerCase() === yeniEposta) {
    return new Response(
      JSON.stringify({ error: "Bu zaten kullanıcının kayıtlı e-posta adresi." }),
      { status: 400, headers }
    );
  }

  try {
    // 4) Admin API ile e-postayı güncelle. email_confirm KASITLI OLARAK
    //    gönderilMİYOR -> "Confirm email" projede açık olduğu sürece
    //    Supabase YENİ adrese bir onay maili/kodu gönderir ve e-posta
    //    sadece o onaylanınca fiilen değişir. Bu çağrı client-side
    //    "Secure email change" (çift onay) kuralına TABİ DEĞİLDİR —
    //    dolayısıyla ESKİ adrese hiçbir mail gitmez.
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(hedefKullaniciId, {
      email: yeniEposta,
    });
    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({
        success: true,
        hedef_id: hedefKullaniciId,
        eski_eposta: hedefKullanici.email,
        yeni_eposta: yeniEposta,
      }),
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("admin-change-email error:", err);
    return new Response(
      JSON.stringify({ error: "E-posta değiştirilirken bir hata oluştu: " + (err?.message ?? String(err)) }),
      { status: 500, headers }
    );
  }
});
