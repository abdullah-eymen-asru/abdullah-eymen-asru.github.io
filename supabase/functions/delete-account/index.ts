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
// MİGRATION 0078 İLE DEĞİŞTİ — "arkada iz kalmasın":
//   * Üye KENDİ hesabını silerse hesap hemen KAPATILIR (giriş yasak + oturumlar sonlanır) ve verileri silinmek üzere
//     "hesap_silme_talepleri" kuyruğuna alınır; veriler yerinde kalır ki site sahibi inceleyip indirebilsin.
//     Site sahibi (veya yetkili admin önerisiyle owner) onaylayınca kalıcı silme yapılır: R2 + Storage + satırlar + auth.
//     İstisnalar (anında kalıcı silme): site sahibi hesabı, KVKK onayı hiç verilmemiş boş hesaplar.
//   * Site sahibi BAŞKASINI silerse (hedef_kullanici_id) de VARSAYILAN olarak veriler hemen silinmez: hesap kapatılır ve talep
//     kuyruğa (tur: owner) düşer; hangi verilerin indirileceği/silineceği "Silinen Hesap Verileri" sekmesinde seçilir.
//     Kalıcı silme yalnızca açıkça mod:"kalici" ile istenir (o sekme gönderir).
//     Gövde: { hedef_kullanici_id, mod?: "talep" | "kalici", secimler?: { arsiv: bool, icerik: bool } }
//   * R2 nesneleri sistem-yedek-worker'ın /uye-temizle ucuyla silinir (Secret: SISTEM_YEDEK_WORKER_URL, ör.
//     https://sistem-yedek-worker.<hesap>.workers.dev). Worker tanımlı değilse ve silinecek R2 verisi varsa İŞLEM DURDURULUR
//     (veri kaybı/iz kalması yerine açık hata).
//
// Deploy:  supabase functions deploy delete-account
// Secrets: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY, Supabase projelerinde
//          Edge Function ortamına otomatik enjekte edilir, elle eklemene
//          gerek yok. SERVICE_ROLE_KEY'i ASLA frontend koduna KOYMA.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_URL = (Deno.env.get("SISTEM_YEDEK_WORKER_URL") ?? "").replace(/\/+$/, "");

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
  let secimler: { arsiv: boolean; icerik: boolean } = { arsiv: true, icerik: true };
  let kaliciIstendi = false;
  try {
    const body = await req.json();
    kaliciIstendi = body?.mod === "kalici";
    if (body && typeof body.secimler === "object" && body.secimler) {
      secimler = { arsiv: body.secimler.arsiv !== false, icerik: body.secimler.icerik !== false };
    }
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

  const json = (govde: unknown, status = 200) => new Response(JSON.stringify(govde), { status, headers });

  try {
    const kendiHesabi = targetId === callerId;

    // Hedefin rolü + KVKK durumu (service_role ile okunur; istemci beyanına güvenilmez).
    const { data: hedefProfil } = await adminClient.from("profiles").select("*").eq("id", targetId).maybeSingle();
    const hedefOwner = hedefProfil?.role === "owner";
    const bosHesap = hedefProfil?.kvkk_onay_verildi === false; // hiç kayıt/onay olmamış (ör. Google ile gelip vazgeçen)

    // KUYRUK: sıradan üye kendi hesabını siliyor → kapat + talep aç. (owner / boş hesap / owner'ın silmesi: anında kalıcı.)
    if (hedefProfil && !hedefOwner && !bosHesap && (kendiHesabi || !kaliciIstendi)) {
      const { error: talepErr } = await adminClient.rpc("hesap_silme_talebi_olustur", { p_user: targetId, p_tur: kendiHesabi ? "kendisi" : "owner" });
      if (talepErr) throw talepErr;
      // Giriş yasağı (≈100 yıl) + tüm oturumları sonlandır.
      const { error: banErr } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
      if (banErr) throw banErr;
      if (kendiHesabi) {
        try { await adminClient.auth.admin.signOut(accessToken, "global"); } catch (e) { console.warn("signOut uyarısı:", e); }
      }
      return json({ success: true, bekliyor: true, silinen_id: targetId });
    }

    // ---- KALICI SİLME ----
    // 3) Depolama envanteri + R2 temizliği (DB satırları silinmeden ÖNCE: anahtarlar buradan okunur).
    const { data: yollar, error: yolErr } = await adminClient.rpc("hesap_silme_depolama_yollari", { p_user: targetId });
    if (yolErr) throw yolErr;
    const ozet = yollar?.ozet ?? {};
    const arsivAnahtarlari: string[] = secimler.arsiv ? (yollar?.arsiv_anahtarlari ?? []) : [];
    const ozelDosyalar: string[] = secimler.icerik ? (yollar?.ozel_dosya_yollari ?? []) : [];
    const r2Beklenen = arsivAnahtarlari.length + Number(ozet.not_ek ?? 0) + Number(ozet.akademik_pdf ?? 0);

    if (r2Beklenen > 0) {
      if (!WORKER_URL) {
        return json({ error: "Bu üyenin R2 dosyaları var ama SISTEM_YEDEK_WORKER_URL tanımlı değil; hiçbir şey silinmedi. Edge Function Secret'ını ekleyip tekrar dene." }, 500);
      }
      const wr = await fetch(`${WORKER_URL}/uye-temizle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hedef: targetId, arsiv_anahtarlari: arsivAnahtarlari }),
      });
      const wj = await wr.json().catch(() => ({}));
      if (!wr.ok) return json({ error: `R2 temizliği başarısız (${wr.status}): ${wj?.error ?? "bilinmeyen"}. Hiçbir veri satırı silinmedi.` }, 502);
      const bagsiz: string[] = wj?.bagsiz ?? [];
      if ((bagsiz.includes("notek") && Number(ozet.not_ek ?? 0) > 0) || (bagsiz.includes("akademik") && Number(ozet.akademik_pdf ?? 0) > 0) || (bagsiz.includes("arsiv") && arsivAnahtarlari.length > 0)) {
        return json({ error: `Worker'da şu R2 kovası bağlı değil: ${bagsiz.join(", ")}. Hiçbir veri satırı silinmedi.` }, 501);
      }
    }

    // 4) Supabase Storage ('ozel-dosyalar') — özel içeriğe eklenmiş dosyalar.
    if (ozelDosyalar.length) {
      const { error: stErr } = await adminClient.storage.from("ozel-dosyalar").remove(ozelDosyalar);
      if (stErr) console.warn("Storage temizliği uyarısı:", stErr);
    }

    // 5) Hesapla birlikte gitmeyen satırlar + talep kaydı.
    const { data: temizlik, error: temErr } = await adminClient.rpc("hesap_silme_kalici_temizle", { p_user: targetId, p_secimler: secimler });
    if (temErr) throw temErr;

    // 6) İlişkili verileri temizle (idempotent) ve asıl Auth hesabını sil — FK cascade kalan her şeyi götürür.
    try {
      const { error: rpcErr } = await adminClient.rpc("admin_delete_user_data", { p_user_id: targetId });
      if (rpcErr) console.warn("admin_delete_user_data RPC uyarısı (cascade zaten halledecek):", rpcErr);
    } catch (e) {
      console.warn("admin_delete_user_data RPC uyarısı (cascade zaten halledecek):", e);
    }
    const { error: delErr } = await adminClient.auth.admin.deleteUser(targetId);
    if (delErr) throw delErr;

    return json({ success: true, bekliyor: false, silinen_id: targetId, temizlik });
  } catch (err: any) {
    console.error("delete-account error:", err);
    return json({ error: "Hesap silinirken bir hata oluştu: " + (err?.message ?? String(err)) }, 500);
  }
});
