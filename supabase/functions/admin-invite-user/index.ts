// ============================================================================
// supabase/functions/admin-invite-user/index.ts
//
// Yönetici/Site Sahibi, panelden (Üye Ayarları › "Kullanıcı Davet Et") bir e-postaya davet gönderir.
// Davetli maildeki linke tıklar → /hesap/sifre-guncelle.html'de şifresini belirler → giriş yapınca KVKK/açık rıza
// onayını verir (auth-guard.js modalı). Kayıtlar KAPALI olsa bile davetli hesap açabilir (migration 0152).
//
// NEDEN EDGE FUNCTION? `auth.admin.inviteUserByEmail` service_role ister; anahtar tarayıcıya konamaz.
// Bot koruması (Turnstile/captcha) admin API'sini etkilemez; yetki denetimi aşağıdaki rol kontrolüdür.
//
// GÜVENLİK: (1) çağıranın token'ı doğrulanır, (2) rol veritabanından okunur (admin/owner), (3) davet yalnızca
// normal "user" rolüyle açılır — rol yükseltme mevcut RPC'lerle yapılır, (4) kötüye kullanım sınırı: kişi başı 20 davet/24 saat,
// (5) redirect adresi istemciden alınmaz; yalnızca izinli Origin + sabit yol kullanılır.
//
// Deploy:  supabase functions deploy admin-invite-user
// Önkoşul: migration 0152 çalışmış olmalı; Supabase Redirect URLs listesinde /hesap/sifre-guncelle.html olmalı
//          (şifre sıfırlama zaten kullanıyor).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// admin-change-email ile AYNI liste: domain değişirse hepsini birlikte güncelle.
const ALLOWED_ORIGINS = [
  "https://abdullah-eymen-asru.pages.dev",
  "https://abdullah-eymen-asru.github.io",
  "http://localhost:4000",
];
const GUNLUK_LIMIT = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function corsHeaders(origin: string | null) {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const temizAd = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  const yanit = (govde: unknown, status = 200) => new Response(JSON.stringify(govde), { status, headers });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return yanit({ error: "Sadece POST." }, 405);
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return yanit({ error: "İzin verilmeyen kaynak." }, 403);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return yanit({ error: "Oturum token'ı eksik." }, 401);

  let eposta = "", ad = "", soyad = "";
  try {
    const b = await req.json();
    eposta = typeof b?.eposta === "string" ? b.eposta.trim().toLowerCase() : "";
    ad = temizAd(b?.ad);
    soyad = temizAd(b?.soyad);
  } catch {
    return yanit({ error: "Geçersiz istek gövdesi." }, 400);
  }
  if (!eposta || eposta.length > 254 || !EMAIL_REGEX.test(eposta)) return yanit({ error: "Geçerli bir e-posta gir." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return yanit({ error: "Geçersiz veya süresi dolmuş oturum." }, 401);
  const callerId = u.user.id;

  const { data: profil, error: pErr } = await admin.from("profiles").select("role").eq("id", callerId).single();
  if (pErr || (profil?.role !== "admin" && profil?.role !== "owner")) {
    return yanit({ error: "Yetkisiz işlem: yalnızca yönetici/Site Sahibi davet gönderebilir." }, 403);
  }

  // Kötüye kullanım sınırı
  const dun = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from("kullanici_davetleri")
    .select("id", { count: "exact", head: true })
    .eq("davet_eden", callerId)
    .gte("olusturma", dun);
  if ((count ?? 0) >= GUNLUK_LIMIT) return yanit({ error: `24 saatte en fazla ${GUNLUK_LIMIT} davet gönderilebilir.` }, 429);

  // Zaten kayıtlı mı?
  const { data: mevcut } = await admin.from("profiles").select("id").ilike("email", eposta).maybeSingle();
  if (mevcut) return yanit({ error: "Bu e-posta ile zaten bir hesap var. Kullanıcı 'Şifremi unuttum' ile girebilir." }, 409);

  // Davet kaydı (kayıtlar kapalıyken handle_new_user bunu görüp hesap açılmasına izin verir)
  const { error: dErr } = await admin.from("kullanici_davetleri").insert({ eposta, davet_eden: callerId });
  if (dErr) {
    console.error("davet kaydı yazılamadı (migration 0152 çalıştı mı?):", dErr);
    return yanit({ error: "Davet kaydı oluşturulamadı. Migration 0152'nin çalıştırıldığından emin ol." }, 500);
  }

  const veri: Record<string, string> = {};
  if (ad) veri.first_name = ad;
  if (soyad) veri.last_name = soyad;

  const { error: iErr } = await admin.auth.admin.inviteUserByEmail(eposta, {
    redirectTo: `${origin}/hesap/sifre-guncelle.html`,
    data: veri,
  });
  if (iErr) {
    console.error("inviteUserByEmail hatası:", iErr);
    await admin.from("kullanici_davetleri").delete().eq("eposta", eposta).eq("kullanildi", false).eq("davet_eden", callerId);
    const m = String(iErr.message || "");
    const hata = /already|registered|exists/i.test(m)
      ? "Bu e-posta için zaten bir hesap/davet var."
      : /rate limit|too many/i.test(m)
      ? "Supabase e-posta gönderim sınırına takıldı; biraz sonra tekrar dene (özel SMTP önerilir)."
      : "Davet gönderilemedi: " + m;
    return yanit({ error: hata }, 502);
  }
  return yanit({ success: true, eposta });
});
