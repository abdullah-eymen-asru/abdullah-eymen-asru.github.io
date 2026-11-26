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
// GÜVENLİK: (1) çağıranın token'ı doğrulanır, (2) rol veritabanından okunur (admin/owner), (3) davet rolü seçilebilir
// (user/special_user/editor/manager; "admin" yalnızca Site Sahibi; "owner" asla; "demo" admin+owner; migration 0154/0155), (4) Site Sahibi ayarları (açık/kapalı, tarih penceresi, toplam/günlük sınır) + mutlak günlük tavan 500,
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
const MUTLAK_GUNLUK_TAVAN = 500; // "sınırsız" ayarında bile geçerli güvenlik tavanı (kişi başı / 24 saat)
// Davetle verilebilecek roller (admin + Site Sahibi): user, special_user, editor, manager, demo. 'admin' yalnızca Site Sahibi; 'owner' davetle ASLA verilmez.
const ROL_HERKES = ["user", "special_user", "editor", "manager", "demo"];
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

  let eposta = "", ad = "", soyad = "", rol = "user";
  try {
    const b = await req.json();
    eposta = typeof b?.eposta === "string" ? b.eposta.trim().toLowerCase() : "";
    ad = temizAd(b?.ad);
    soyad = temizAd(b?.soyad);
    if (b?.rol !== undefined) rol = typeof b.rol === "string" ? b.rol : "";
  } catch {
    return yanit({ error: "Geçersiz istek gövdesi." }, 400);
  }
  if (!eposta || eposta.length > 254 || !EMAIL_REGEX.test(eposta)) return yanit({ error: "Geçerli bir e-posta gir." }, 400);

  if (!ROL_HERKES.includes(rol) && rol !== "admin") return yanit({ error: "Geçersiz rol." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return yanit({ error: "Geçersiz veya süresi dolmuş oturum." }, 401);
  const callerId = u.user.id;

  const { data: profil, error: pErr } = await admin.from("profiles").select("role").eq("id", callerId).single();
  if (pErr || (profil?.role !== "admin" && profil?.role !== "owner")) {
    return yanit({ error: "Yetkisiz işlem: yalnızca yönetici/Site Sahibi davet gönderebilir." }, 403);
  }

  // Rol yükseltme koruması: admin (owner DEĞİL) 'admin' veya üstünü veremez.
  if (rol === "admin" && profil.role !== "owner") {
    return yanit({ error: "Yönetici rolünü yalnızca Site Sahibi verebilir." }, 403);
  }

  // Site Sahibi ayarları (migration 0153): açık/kapalı, tarih penceresi, toplam ve günlük sınır. NULL = sınırsız.
  const { data: ay } = await admin.from("davet_ayarlari").select("*").eq("id", 1).maybeSingle();
  if (ay) {
    if (ay.davetler_acik === false) return yanit({ error: "Davet gönderme Site Sahibi tarafından kapatılmış." }, 403);
    const simdi = Date.now();
    if (ay.baslangic && simdi < new Date(ay.baslangic).getTime())
      return yanit({ error: "Davet dönemi henüz başlamadı (" + new Date(ay.baslangic).toLocaleString("tr-TR") + ")." }, 403);
    if (ay.bitis && simdi > new Date(ay.bitis).getTime())
      return yanit({ error: "Davet dönemi sona erdi (" + new Date(ay.bitis).toLocaleString("tr-TR") + ")." }, 403);
    if (ay.toplam_limit) {
      const { count: toplam } = await admin.from("kullanici_davetleri").select("id", { count: "exact", head: true });
      if ((toplam ?? 0) >= ay.toplam_limit) return yanit({ error: `Toplam davet sınırına (${ay.toplam_limit}) ulaşıldı.` }, 429);
    }
  }
  const gunlukSinir = Math.min(ay?.gunluk_limit ?? MUTLAK_GUNLUK_TAVAN, MUTLAK_GUNLUK_TAVAN);

  // Kötüye kullanım sınırı (sınırsız ayarlansa bile mutlak tavan: ele geçirilmiş yönetici hesabı mail bombardımanı yapamasın)
  const dun = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from("kullanici_davetleri")
    .select("id", { count: "exact", head: true })
    .eq("davet_eden", callerId)
    .gte("olusturma", dun);
  if ((count ?? 0) >= gunlukSinir) return yanit({ error: `24 saatte en fazla ${gunlukSinir} davet gönderilebilir.` }, 429);

  // Zaten kayıtlı mı?
  const { data: mevcut } = await admin.from("profiles").select("id").ilike("email", eposta).maybeSingle();
  if (mevcut) return yanit({ error: "Bu e-posta ile zaten bir hesap var. Kullanıcı 'Şifremi unuttum' ile girebilir." }, 409);

  // Davet kaydı (kayıtlar kapalıyken handle_new_user bunu görüp hesap açılmasına izin verir)
  const { error: dErr } = await admin.from("kullanici_davetleri").insert({ eposta, davet_eden: callerId, rol });
  if (dErr) {
    console.error("davet kaydı yazılamadı (migration 0152 çalıştı mı?):", dErr);
    return yanit({ error: "Davet kaydı oluşturulamadı. Migration 0152 ve 0154'ün çalıştırıldığından emin ol." }, 500);
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
  return yanit({ success: true, eposta, rol });
});
