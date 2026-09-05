// ============================================================================
// supabase/functions/mesajlasma-kalici-silme/index.ts
//
// NE İŞE YARAR?
// migration 0035'teki public.mesajlasma_kalici_silmeyi_isle() SQL
// fonksiyonunu dışarıdan periyodik olarak tetikler: gerekli tüm taraflarca
// (konuşma sahibi üye + aktif tüm admin/owner) kendi tarafından "silinmiş"
// (gizlenmiş) ve son gizlemenin üzerinden 30 gün geçmiş konuşma/mesajları
// Supabase'den KALICI olarak siler. Fonksiyon SADECE service_role tarafından
// çağrılabilir (bkz. o migration'daki grant) — service_role anahtarı ASLA
// tarayıcıya/frontend koduna konulamaz, bu yüzden delete-account /
// admin-denetim-zaman-asimi ile AYNI desende ayrı bir Edge Function bu işi
// üstlenir.
//
// NEDEN GEREKLİ (pg_cron YERİNE Edge Function + GitHub Actions)?
// pg_cron her Supabase projesinde (özellikle ücretsiz katmanda) aktif
// olmayabilir. Bu repo zaten .github/workflows/zamanlanmis-yayin.yml ve
// admin-denetim-zaman-asimi.yml ile "belirli aralıklarla bir HTTP isteği at"
// desenini kullanıyor — aynı deseni burada da uyguluyoruz (bkz.
// .github/workflows/mesajlasma-kalici-silme.yml): GitHub Actions GÜNDE BİR
// KEZ bu fonksiyonu çağırır (30 günlük bir eşik için admin-denetimdeki 15
// dakikalık sıklık gerekmez), fonksiyon da service_role ile SQL RPC'sini
// tetikler.
//
// GÜVENLİK
//   - Bu fonksiyon KULLANICI oturumu DOĞRULAMAZ (cron tarafından, kullanıcı
//     olmadan çağrılır) — bunun yerine aynı paylaşılan sır (shared secret)
//     header'ını ister: X-Cron-Secret. Sırrı hem Supabase Edge Function
//     secret'ı (CRON_SHARED_SECRET) hem de GitHub Actions repo secret'ı
//     (MESAJ_KALICI_SILME_CRON_SECRET) olarak admin-denetim-zaman-asimi ile
//     AYNI değerle ayarlayabilirsin (secret paylaşılabilir, iki farklı
//     fonksiyonu tetikliyor olması sorun değil).
//   - Asıl yetki kontrolü zaten veritabanı tarafında: RPC service_role
//     dışında hiç kimse tarafından çağrılamaz (bkz. migration 0035).
//   - Sabit zamanlı (timing-safe) sır karşılaştırması admin-denetim-zaman-
//     asimi ile BİREBİR AYNI — bkz. oradaki yorum.
//
// Deploy:  supabase functions deploy mesajlasma-kalici-silme
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatik enjekte edilir)
//          + elle (zaten ayarlıysa atlanabilir): supabase secrets set CRON_SHARED_SECRET=<rastgele-uzun-bir-deger>
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET");

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
    const { data, error } = await adminClient.rpc("mesajlasma_kalici_silmeyi_isle");
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, silinen_satir_sayisi: data ?? 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mesajlasma-kalici-silme error:", err);
    return new Response(
      JSON.stringify({ error: "Kalıcı silme işlenirken hata: " + (err?.message ?? String(err)) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
