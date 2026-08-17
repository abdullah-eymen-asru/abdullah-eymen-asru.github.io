// ============================================================================
// supabase/functions/delete-account/index.ts
//
// NEDEN BİR EDGE FUNCTION GEREKİYOR?
// Supabase'te bir kullanıcının auth.users tablosundaki KENDİ (veya başka
// birinin) satırını silebilmesi için "service_role" yetkisi gerekir; normal
// (anon/authenticated) istemci anahtarı bunu YAPAMAZ (bilinçli bir güvenlik
// kısıtı, yoksa herkes başkasının hesabını silebilirdi). Bu yüzden:
//   1) Kullanıcı (veya owner) kendi tarayıcısından bu fonksiyonu KENDİ
//      oturum token'ıyla çağırır ("Authorization: Bearer <access_token>").
//   2) Fonksiyon önce bu token'ın GERÇEKTEN kime ait olduğunu doğrular.
//   3) İstek gövdesinde "hedef_kullanici_id" YOKSA -> çağıran kendi hesabını
//      siler (eski davranış, HERKES kendi hesabını silebilir — bu kişisel
//      bir haktır, rol farketmez).
//      "hedef_kullanici_id" VARSA VE kendi id'sinden FARKLIYSA -> yani
//      BAŞKA birini silmeye çalışıyorsa, SADECE çağıran Site Sahibi
//      (owner) ise izin verilir (bkz. migration 0027 § B — eskiden herhangi
//      bir admin başka birini, hatta owner'ı bile silebiliyordu; bu artık
//      KAPATILDI). Admin panelindeki "Üyeyi Sil" butonu bunu kullanır.
//
// Deploy:  supabase functions deploy delete-account
// Secrets: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY, Supabase projelerinde
//          Edge Function ortamına otomatik enjekte edilir, elle eklemene
//          gerek yok. SERVICE_ROLE_KEY'i ASLA frontend koduna KOYMA.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// CORS: sadece kendi sitenin domainlerinden çağrılabilsin.
// admin-change-email/index.ts ile AYNI listeyi kullan — domain
// değiştirirsen ikisini birlikte güncellemeyi unutma.
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

  // İsteğe bağlı gövde: { "hedef_kullanici_id": "uuid" }. Boş/geçersiz JSON
  // gövde de kabul edilir (eski istemciler hiç gövde göndermiyordu).
  let hedefKullaniciId: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.hedef_kullanici_id === "string" && body.hedef_kullanici_id.trim()) {
      hedefKullaniciId = body.hedef_kullanici_id.trim();
    }
  } catch {
    // Gövde yok veya JSON değil -> sorun değil, "kendini sil" varsayılan davranış.
  }

  // service_role client: yönetimsel işlemler için (auth.admin.*)
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Token gerçekten kime ait? (service_role client ile token doğrulama)
  const { data: userData, error: userErr } = await adminClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Geçersiz veya süresi dolmuş oturum." }), {
      status: 401,
      headers,
    });
  }
  const callerId = userData.user.id;

  // 2) Silinecek hedef kimliği belirle + yetki kontrolü.
  let targetId = callerId;
  if (hedefKullaniciId && hedefKullaniciId !== callerId) {
    // Başkasını silmeye çalışıyor -> çağıran GERÇEKTEN Site Sahibi (owner)
    // mi diye veritabanından (service_role ile, RLS'i atlayarak ama biz
    // burada sadece OKUYORUZ) doğrula. Çağıranın kendi beyanına asla
    // güvenmiyoruz.
    //
    // MİGRATION 0027 § B İLE DEĞİŞTİ: eskiden 'admin' rolü de yeterliydi —
    // bu, bir admin'in başka bir üyeyi (hatta owner'ı bile) silebilmesi
    // anlamına geliyordu. Artık BAŞKASINI SİLME yetkisi SADECE owner'da;
    // sıradan bir admin artık hiç kimseyi (kendisi hariç) silemez.
    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (profileErr || callerProfile?.role !== "owner") {
      return new Response(
        JSON.stringify({ error: "Yetkisiz işlem: başka bir kullanıcıyı sadece Site Sahibi (owner) silebilir." }),
        { status: 403, headers }
      );
    }
    targetId = hedefKullaniciId;
  }

  try {
    // 3) Önce ilişkili verileri (özel içerik erişim atamaları, profil vb.)
    //    temizle. auth.users satırı zaten ON DELETE CASCADE ile bunları
    //    otomatik temizleyecek olsa da, admin_delete_user_data() ile
    //    açıkça de çağırıyoruz (idempotent, zarar vermez, ve auth.users
    //    silme adımı herhangi bir sebeple başarısız olursa bile veri
    //    tutarlılığını erken sağlar).
    try {
      const { error: rpcErr } = await adminClient.rpc("admin_delete_user_data", { p_user_id: targetId });
      if (rpcErr) {
        console.warn("admin_delete_user_data RPC uyarısı (cascade zaten halledecek):", rpcErr);
      }
    } catch (e) {
      console.warn("admin_delete_user_data RPC uyarısı (cascade zaten halledecek):", e);
    }

    // 4) Asıl Auth hesabını sil. profiles, content_access, messages vb.
    //    FK'lerdeki ON DELETE CASCADE sayesinde ilişkili TÜM veriler
    //    otomatik gider. (Eski "avatarlar" bucket'ı ve temizlik adımı
    //    kaldırıldı — profil fotoğrafı özelliği ve bucket'ın kendisi artık
    //    hiç kullanılmıyor, bkz. migration 0004.)
    const { error: delErr } = await adminClient.auth.admin.deleteUser(targetId);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ success: true, silinen_id: targetId }), {
      status: 200,
      headers,
    });
  } catch (err: any) {
    console.error("delete-account error:", err);
    return new Response(
      JSON.stringify({ error: "Hesap silinirken bir hata oluştu: " + (err?.message ?? String(err)) }),
      { status: 500, headers }
    );
  }
});
