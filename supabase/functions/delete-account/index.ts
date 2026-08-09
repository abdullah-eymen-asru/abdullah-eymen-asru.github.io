// ============================================================================
// supabase/functions/delete-account/index.ts
//
// NEDEN BİR EDGE FUNCTION GEREKİYOR?
// Supabase'te bir kullanıcının auth.users tablosundaki KENDİ satırını
// silebilmesi için "service_role" yetkisi gerekir; normal (anon/authenticated)
// istemci anahtarı bunu YAPAMAZ (bilinçli bir güvenlik kısıtı, yoksa herkes
// başkasının hesabını silebilirdi). Bu yüzden:
//   1) Kullanıcı kendi tarayıcısından bu fonksiyonu KENDİ oturum token'ıyla
//      çağırır ("Authorization: Bearer <access_token>").
//   2) Fonksiyon önce bu token'ın GERÇEKTEN o kullanıcıya ait olduğunu
//      doğrular (service_role ile başka bir kullanıcıyı silmesin diye).
//   3) Doğrulama geçerse, YALNIZCA o kullanıcının kendi id'sini siler.
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
// Kendi domainlerinle güncelle.
const ALLOWED_ORIGINS = [
  "https://abdullah-eymen-asru.pages.dev",
  "https://abdullah-eymen-asru.github.io",
  "http://localhost:4000", // yerel Jekyll geliştirme
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
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

  try {
    // 2) Önce ilişkili verileri (özel içerik erişim atamaları vb.) temizle.
    //    profiles satırı zaten auth.users -> ON DELETE CASCADE ile silinecek,
    //    ama açıkça da çağırıyoruz (idempotent, zarar vermez).
    await adminClient.rpc("delete_own_profile_data_as", { p_user_id: callerId }).catch(() => {
      // Bu RPC yoksa (aşağıdaki NOTA bak) sorun değil, cascade zaten halledecek.
    });

    // 3) Kendi kullanıcı verilerini (avatar dosyası) storage'dan sil.
    const { data: files } = await adminClient.storage.from("avatarlar").list(callerId);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${callerId}/${f.name}`);
      await adminClient.storage.from("avatarlar").remove(paths);
    }

    // 4) Asıl Auth hesabını sil. profiles, content_access vb. FK'lerdeki
    //    ON DELETE CASCADE sayesinde ilişkili TÜM veriler otomatik gider.
    const { error: delErr } = await adminClient.auth.admin.deleteUser(callerId);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("delete-account error:", err);
    return new Response(JSON.stringify({ error: "Hesap silinirken bir hata oluştu." }), {
      status: 500,
      headers,
    });
  }
});

// NOT: adım 2'deki "delete_own_profile_data_as" RPC'si isteğe bağlıdır ve
// migration dosyasında yer almıyor — çünkü zaten auth.users silindiğinde
// CASCADE ile aynı iş yapılıyor. İstersen migration'a şunu ekleyip
// service_role'e EXECUTE izni verebilirsin, tamamen opsiyonel:
//
//   create or replace function public.delete_own_profile_data_as(p_user_id uuid)
//   returns void language plpgsql security definer set search_path = public as $$
//   begin
//     delete from public.content_access where user_id = p_user_id;
//     delete from public.profiles where id = p_user_id;
//   end; $$;
