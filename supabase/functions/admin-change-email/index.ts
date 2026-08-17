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
//   `auth.admin.updateUserById(hedefId, { email: yeniEmail, email_confirm: true })`
//   çağrılır. `email_confirm: true` AÇIKÇA gönderilir -> Supabase bu
//   e-postayı zaten doğrulanmış sayar ve YENİ adrese bile onay maili
//   GÖNDERMEZ; değişiklik anında (hiçbir mail beklemeden) kesinleşir.
//   Eski adrese de HİÇBİR mail gitmez. Admin API, client API'nin tabi
//   olduğu "Secure email change" kuralından muaftır. Ayrıca bu fonksiyon:
//     - auth.users güncellemesinin ardından public.profiles.email'i de
//       service_role ile senkron eder (migration 0008'deki veritabanı
//       trigger'ıyla birlikte çift güvence),
//     - GÜVENLİK: hesabın (eski adresle açılmış) TÜM oturumlarını
//       sonlandırır (migration 0009 -> admin_force_signout_user RPC'si),
//       çünkü e-posta admin tarafından değiştirildiyse eski adrese kimin
//       eriştiği belirsizdir,
//     - yeni adrese, e-postasının değiştiğini bildiren GERÇEK bir mail
//       gönderir (resetPasswordForEmail ile Supabase'in dahili "Reset
//       Password" mail şablonu üzerinden — ayrı bir SMTP kurulumu
//       GEREKTİRMEZ).
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
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
  }
  // İzin verilmeyen bir origin'den geldiyse Access-Control-Allow-Origin
  // header'ını HİÇ döndürmüyoruz (sabit bir "varsayılan" adrese düşmek
  // yerine) — tarayıcı bu durumda yanıtı otomatik olarak engeller. Gerçek
  // yetki kontrolü zaten aşağıda token doğrulamasıyla yapılıyor, bu sadece
  // CORS davranışını daha net/beklenen hâle getiriyor.
  return {
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

  if (profileErr || (callerProfile?.role !== "admin" && callerProfile?.role !== "owner")) {
    return new Response(
      JSON.stringify({ error: "Yetkisiz işlem: sadece admin/owner bir üyenin e-postasını değiştirebilir." }),
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
    // 4) Admin API ile e-postayı güncelle. email_confirm: true AÇIKÇA
    //    gönderiliyor -> Supabase'e "bu e-postayı doğrulanmış say, onay
    //    maili GÖNDERME" diyoruz. Bu, admin panelinden yapılan değişikliğin
    //    gerçekten "hiçbir mail beklemeden anında" tamamlanmasını sağlar
    //    (önceki sürümde bu parametre unutulmuştu — kod ile yorum
    //    çelişiyordu: e-posta bazen sadece YENİ adrese giden bir onay
    //    maili tıklanınca değişiyordu, "anında" değil).
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(hedefKullaniciId, {
      email: yeniEposta,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;

    // 5) auth.users güncellenince public.profiles.email'i senkron eden bir
    //    veritabanı trigger'ı da var (bkz. migration 0008,
    //    handle_user_update()) — bu, admin panelinden yapılan bu değişikliği
    //    de OTOMATİK yakalar. Yine de burada AYRICA (ikinci bir güvence
    //    olarak, trigger deploy edilmemiş olsa bile UI'ın hemen doğru
    //    veriyi göstermesi için) profiles.email'i service_role ile
    //    doğrudan da güncelliyoruz.
    const { error: profileUpdateErr } = await adminClient
      .from("profiles")
      .update({ email: yeniEposta })
      .eq("id", hedefKullaniciId);
    if (profileUpdateErr) {
      // Trigger zaten bunu yapmış olabilir ya da geçici bir hata olabilir
      // — auth.users tarafı zaten başarıyla değişti, bu yüzden isteği
      // BAŞARISIZ saymıyoruz, sadece logluyoruz.
      console.error("profiles.email senkron güncellemesi başarısız (trigger yine de yakalamış olabilir):", profileUpdateErr);
    }

    // 6) GÜVENLİK: e-posta admin tarafından değiştirildiği için, bu
    //    hesabın (eski adresle) açık kalmış TÜM oturumlarını sonlandırıyoruz
    //    — kullanıcı e-postasını kaybettiği için hesabına kimin eriştiği
    //    belirsizdir; e-posta değiştikten sonra herkesin (gerçek sahibi
    //    dahil) yeniden giriş yapması gerekir. Migration 0009'daki
    //    admin_force_signout_user() RPC'sini kullanıyoruz (bkz. o dosya —
    //    Supabase'in admin API'sinde "şu user_id'yi çıkışa zorla" diye
    //    doğrudan bir fonksiyon yoktur, bu yüzden refresh token'ları
    //    veritabanı seviyesinde iptal ediyoruz).
    const { error: signOutErr } = await adminClient.rpc("admin_force_signout_user", {
      p_user_id: hedefKullaniciId,
    });
    if (signOutErr) {
      // Kritik değil — e-posta zaten değişti, bu sadece EK bir güvenlik
      // adımı. Fonksiyon migration 0009 deploy edilmemişse burada hata
      // alınabilir; isteği yine de başarılı sayıyoruz.
      console.error("Kullanıcının eski oturumları sonlandırılamadı (RPC bulunamadı olabilir, migration 0009'u çalıştırdığından emin ol):", signOutErr);
    }

    // 7) BİLGİLENDİRME MAİLİ: yeni adrese, e-postasının site yöneticisi
    //    tarafından değiştirildiğini bildiren bir mail gönderiyoruz. Ekstra
    //    bir e-posta servisi/SMTP anahtarı KURULUMU GEREKMİYOR — Supabase'in
    //    kendi dahili mail sistemini (Dashboard > Authentication > Emails)
    //    kullanıyoruz.
    //    ÖNEMLİ DÜZELTME: `auth.admin.generateLink()` bir e-posta
    //    GÖNDERMEZ — sadece bir link/OTP ÜRETİP DÖNDÜRÜR, gönderme işini
    //    çağırana bırakır (resmi dokümantasyon: "This will not send links
    //    or OTPs to the end user"). İlk yazdığımız sürüm yanlışlıkla bunu
    //    "mail gönderir" sanıyordu — hiçbir mail GİTMİYORDU. Gerçekten mail
    //    GÖNDEREN ve ekstra kurulum istemeyen resmi yöntem
    //    `resetPasswordForEmail()`'dir: Supabase bunun için "Reset
    //    Password" e-posta şablonunu kullanıp GERÇEKTEN postalar. Şablon
    //    metnini Dashboard'dan "E-postanız güncellendi, giriş yapmak için
    //    tıkla / şifreni sıfırlamak istersen..." şeklinde özelleştirebilirsin.
    let bildirimMailiGonderildi = true;
    try {
      const { error: mailErr } = await adminClient.auth.resetPasswordForEmail(yeniEposta);
      if (mailErr) throw mailErr;
    } catch (mailErr) {
      bildirimMailiGonderildi = false;
      console.error("Bildirim maili gönderilemedi (e-posta değişikliği yine de tamamlandı):", mailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        hedef_id: hedefKullaniciId,
        eski_eposta: hedefKullanici.email,
        yeni_eposta: yeniEposta,
        eski_oturumlar_sonlandirildi: !signOutErr,
        bildirim_maili_gonderildi: bildirimMailiGonderildi,
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
