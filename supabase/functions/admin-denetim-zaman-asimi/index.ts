// ============================================================================
// supabase/functions/admin-denetim-zaman-asimi/index.ts
//
// NE İŞE YARAR?
// migration 0021'deki "AŞAMA 2c — ZAMAN AŞIMI (fail-safe)" adımını dışarıdan
// periyodik olarak tetikler. public.admin_denetim_zaman_asimini_isle() SQL
// fonksiyonu SADECE service_role tarafından çağrılabilir (bkz. o dosyadaki
// grant) — service_role anahtarı ASLA tarayıcıya/frontend koduna konulamaz,
// bu yüzden delete-account / admin-change-email ile AYNI desende ayrı bir
// Edge Function bu işi üstlenir.
//
// NEDEN GEREKLİ (pg_cron YERİNE Edge Function + GitHub Actions)?
// pg_cron her Supabase projesinde (özellikle ücretsiz katmanda) aktif
// olmayabilir. Bu repo zaten .github/workflows/zamanlanmis-yayin.yml ile
// "belirli aralıklarla bir HTTP isteği at" desenini kullanıyor — aynı
// deseni burada da uyguluyoruz (bkz. .github/workflows/admin-denetim-
// zaman-asimi.yml): GitHub Actions her 15 dakikada bir bu fonksiyonu
// çağırır, fonksiyon da service_role ile SQL RPC'sini tetikler.
//
// GÜVENLİK
//   - Bu fonksiyon KULLANICI oturumu DOĞRULAMAZ (cron tarafından, kullanıcı
//     olmadan çağrılır) — bunun yerine basit bir "paylaşılan sır" (shared
//     secret) header'ı ister: X-Cron-Secret. Bu, fonksiyonun herkese açık
//     URL'inin rastgele biri tarafından tetiklenip gereksiz yere
//     çalıştırılmasını (DoS/gürültü) önler. Sırrı hem Supabase Edge
//     Function secret'ı (CRON_SHARED_SECRET) hem de GitHub Actions repo
//     secret'ı (ADMIN_DENETIM_CRON_SECRET) olarak AYNI değerle ayarla.
//   - Asıl yetki kontrolü zaten veritabanı tarafında: RPC service_role
//     dışında hiç kimse tarafından çağrılamaz (bkz. migration 0021 § 10).
//
// Deploy:  supabase functions deploy admin-denetim-zaman-asimi
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatik enjekte edilir)
//          + elle: supabase secrets set CRON_SHARED_SECRET=<rastgele-uzun-bir-deger>
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET");

// GÜVENLİK AÇIĞI DÜZELTMESİ: aşağıdaki karşılaştırma ÖNCEDEN düz
// `gelenSir !== CRON_SHARED_SECRET` idi. JS'in string eşitlik kontrolü
// ilk farklı karakterde erken çıkar — bu, teorik olarak yanıt süresinden
// sırrın kaç karakterinin doğru tahmin edildiğine dair bilgi sızdırabilecek
// bir zamanlama yan-kanalı (timing attack) bırakır. Her iki değeri
// SHA-256 ile hash'leyip SABİT uzunluktaki (32 bayt) özetleri baytlarını
// XOR'layarak karşılaştırıyoruz — hem uzunluk farkı hem erken çıkış artık
// gözlemlenebilir bir zamanlama farkı yaratmıyor. Bu uç noktanın pratik
// riski zaten düşüktü (yalnızca zararsız bir bakım RPC'sini tetikliyor,
// asıl yetki veritabanı tarafında kilitli) ama savunma derinliği için
// düzeltildi; admin_guvenlik_bildirim_worker/worker.js'teki
// sabitZamanliEsitMi() ile AYNI desen.
async function sabitZamanliEsitMi(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ozetA, ozetB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const baytA = new Uint8Array(ozetA);
  const baytB = new Uint8Array(ozetB);
  let fark = 0;
  for (let i = 0; i < baytA.length; i++) {
    fark |= baytA[i] ^ baytB[i];
  }
  return fark === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Sadece GET/POST." }), { status: 405 });
  }

  // Paylaşılan sır ayarlanmışsa doğrula. Ayarlanmamışsa (kurulumun ilk
  // adımında test amaçlı) çalışmaya izin veriyoruz ama loga uyarı düşüyoruz
  // — production'da MUTLAKA ayarlanmalı.
  if (CRON_SHARED_SECRET) {
    const gelenSir = req.headers.get("x-cron-secret");
    const gecerliMi = gelenSir ? await sabitZamanliEsitMi(gelenSir, CRON_SHARED_SECRET) : false;
    if (!gecerliMi) {
      return new Response(JSON.stringify({ error: "Yetkisiz." }), { status: 401 });
    }
  } else {
    console.warn("CRON_SHARED_SECRET ayarlanmamış — bu fonksiyon şu an sırsız, herkes tetikleyebilir.");
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data, error } = await adminClient.rpc("admin_denetim_zaman_asimini_isle");
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, islenen_vaka_sayisi: data ?? 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("admin-denetim-zaman-asimi error:", err);
    return new Response(
      JSON.stringify({ error: "Zaman aşımı işlenirken hata: " + (err?.message ?? String(err)) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
