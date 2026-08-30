/**
 * admin-guvenlik-bildirim-worker — Cloudflare Worker (Dashboard "Quick Edit"
 * ile uyumlu, sıfır npm bağımlılığı)
 * -----------------------------------------------------------------------
 * migration 0021 -> public._denetim_bildirim_gonder() fonksiyonu, bir admin
 * askıya alındığında / oy kullanıldığında / vaka sonuçlandığında (kalıcı
 * düşürme, iptal, zaman aşımı) bu Worker'ın URL'ine pg_net ile async bir
 * HTTP POST atar. Bu Worker, gelen JSON'u insan tarafından okunabilir bir
 * mesaja çevirip Telegram ve/veya SMS (Twilio) üzerinden ilgili kişilere
 * iletir — tıpkı r2_storage_worker / github_icerik_yonetim_worker'daki gibi,
 * gerçek üçüncü taraf sırları (Telegram bot token'ı, Twilio anahtarları)
 * SADECE burada, Cloudflare Worker ortam değişkenlerinde durur; veritabanı
 * bu sırları asla görmez.
 *
 * GELEN İSTEĞİ DOĞRULAMA — GÜVENLİK AÇIĞI DÜZELTMESİ (bkz. migration
 * 0034_guvenlik_bildirim_paylasilan_sir.sql): bu Worker ÖNCEDEN SADECE
 * URL'in tahmin edilmesi zor bir path segmenti (GIZLI_YOL) içermesine
 * güveniyordu — kriptografik bir doğrulama YOKTU. GIZLI_YOL bir şekilde
 * sızarsa (tarayıcı geçmişi, Cloudflare Analytics/Logs ekranı, kazara
 * paylaşılan bir ekran görüntüsü) o adresi bilen HERKES rastgele bir JSON
 * gövdesiyle POST atıp sahte "bir admin askıya alındı" gibi Telegram/SMS
 * bildirimleri tetikleyebilirdi. Artık migration 0034 ile
 * public._denetim_bildirim_gonder() isteğe "X-Webhook-Secret" header'ı
 * EKLİYOR (guvenlik_bildirim_ayarlari.webhook_secret sütunundan) ve bu
 * Worker aşağıda bunu WEBHOOK_SHARED_SECRET ortam değişkeniyle SABİT
 * ZAMANLI (timing-safe) karşılaştırıyor — admin-denetim-zaman-asimi Edge
 * Function'ındaki AYNI desen. GIZLI_YOL kontrolü de KALDIRILMADI (savunma
 * derinliği): İKİ katman da geçilmeden istek işlenmez.
 *
 * Gerekli ortam değişkenleri (Cloudflare Dashboard > Worker > Settings
 * > Variables and Secrets):
 *   GIZLI_YOL               URL'e eklenecek tahmin edilmesi zor bir segment
 *                            (ör. "x7f3-admin-guvenlik") — worker sadece
 *                            /GIZLI_YOL isteğine cevap verir, başka her şeye 404.
 *   WEBHOOK_SHARED_SECRET    migration 0034'teki
 *                            guvenlik_bildirim_ayarlari.webhook_secret ile
 *                            AYNI değer (Encrypt/Secret). Ayarlanmamışsa bu
 *                            Worker eski davranışa (sadece GIZLI_YOL) geri
 *                            düşer ve loga uyarı yazar — production'da
 *                            MUTLAKA ayarlanmalı.
 *   TELEGRAM_BOT_TOKEN       (opsiyonel) Telegram bot token'ı
 *   TELEGRAM_CHAT_ID         (opsiyonel) bildirimin gideceği chat/kanal id'si
 *   TWILIO_ACCOUNT_SID       (opsiyonel) SMS için Twilio hesap SID'i
 *   TWILIO_AUTH_TOKEN        (opsiyonel) Twilio auth token       (Encrypt/Secret)
 *   TWILIO_FROM_NUMBER       (opsiyonel) Twilio gönderen numara
 *   TWILIO_TO_NUMBER         (opsiyonel) bildirimin gideceği numara
 *
 * En az bir kanal (Telegram VEYA SMS) yapılandırılmalı; ikisi de boşsa
 * Worker isteği 200 ile kabul eder ama hiçbir yere iletmez (loglar).
 *
 * KURULUM:
 *   1) Bu dosyayı Cloudflare Dashboard'da yeni bir Worker'a yapıştır, yukarıdaki
 *      ortam değişkenlerini gir (WEBHOOK_SHARED_SECRET dahil), deploy et.
 *   2) Supabase'de:
 *        update public.guvenlik_bildirim_ayarlari
 *        set webhook_url    = 'https://<worker-adresin>.workers.dev/<GIZLI_YOL>',
 *            webhook_secret = '<WEBHOOK_SHARED_SECRET İLE AYNI DEĞER>',
 *            aktif          = true
 *        where id = 1;
 */

/**
 * Sabit zamanlı (timing-safe) sır karşılaştırması. Düz `===`/`!==`
 * kullanmak teorik bir zamanlama yan-kanalı (timing attack) bırakır: string
 * karşılaştırması ilk farklı karakterde erken çıkar, bu da yanıt süresinden
 * doğru sırrın kaç karakterinin tutturulduğuna dair (çok küçük de olsa) bilgi
 * sızdırabilir. Her iki değeri SHA-256 ile hash'leyip SABİT uzunluktaki
 * (32 bayt) özetleri baytlarını XOR'layarak karşılaştırıyoruz — hem uzunluk
 * farkı hem erken çıkış artık gözlemlenebilir bir zamanlama farkı yaratmıyor.
 * (admin-denetim-zaman-asimi/index.ts'teki AYNI desen.)
 */
async function sabitZamanliEsitMi(a, b) {
  const enc = new TextEncoder();
  const [ozetA, ozetB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a ?? "")),
    crypto.subtle.digest("SHA-256", enc.encode(b ?? "")),
  ]);
  const baytA = new Uint8Array(ozetA);
  const baytB = new Uint8Array(ozetB);
  let fark = 0;
  for (let i = 0; i < baytA.length; i++) {
    fark |= baytA[i] ^ baytB[i];
  }
  return fark === 0;
}

const OLAY_METINLERI = {
  askiya_alindi: "🔴 ACİL: Bir admin ASKIYA ALINDI",
  oy_kullanildi: "🗳️ Admin denetim vakasına oy kullanıldı",
  kalici_dusuruldu: "⛔ Bir admin KALICI OLARAK DÜŞÜRÜLDÜ",
  iptal_edildi: "✅ Askıya alma İPTAL EDİLDİ, yetki iade edildi",
  suresi_doldu_geri_acildi: "⏱️ Karar süresi doldu — hesap OTOMATİK olarak geri açıldı",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const beklenenYol = `/${env.GIZLI_YOL || ""}`;
    if (!env.GIZLI_YOL || url.pathname !== beklenenYol) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Sadece POST.", { status: 405 });
    }

    // GÜVENLİK (bkz. dosya başı notu / migration 0034): GIZLI_YOL tek
    // başına kriptografik bir doğrulama DEĞİL, sadece URL'i tahmin
    // edilmesi zorlaştırır. WEBHOOK_SHARED_SECRET ayarlıysa, isteğin
    // public._denetim_bildirim_gonder()'ın gönderdiği "X-Webhook-Secret"
    // header'ını taşıması ve bunun değerinin SABİT ZAMANLI olarak
    // eşleşmesi ZORUNLU — aksi halde GIZLI_YOL sızmış olsa bile istek
    // reddedilir. WEBHOOK_SHARED_SECRET ayarlanmamışsa (henüz migration
    // 0034 kurulumu tamamlanmadıysa) eski davranışa geri düşülür ve loga
    // uyarı yazılır — production'da MUTLAKA ayarlanmalı.
    if (env.WEBHOOK_SHARED_SECRET) {
      const gelenSir = request.headers.get("X-Webhook-Secret");
      const gecerliMi = gelenSir ? await sabitZamanliEsitMi(gelenSir, env.WEBHOOK_SHARED_SECRET) : false;
      if (!gecerliMi) {
        return new Response("Yetkisiz.", { status: 401 });
      }
    } else {
      console.warn(
        "WEBHOOK_SHARED_SECRET ayarlanmamış — bu Worker şu an sadece GIZLI_YOL ile korunuyor, " +
          "migration 0034'teki kurulum adımlarını tamamlayıp bu değeri ekle."
      );
    }

    let yuk;
    try {
      yuk = await request.json();
    } catch {
      return new Response("Geçersiz JSON.", { status: 400 });
    }

    const baslik = OLAY_METINLERI[yuk.olay] || `Admin denetim olayı: ${yuk.olay}`;
    const mesaj = [
      baslik,
      `Sebep: ${yuk.sebep || "-"}`,
      `Durum: ${yuk.durum || "-"}`,
      `Vaka: ${yuk.denetim_id || "-"}`,
      `Zaman: ${yuk.zaman || new Date().toISOString()}`,
    ].join("\n");

    const gonderimSonuclari = await Promise.allSettled([
      telegramGonder(env, mesaj),
      smsGonder(env, mesaj),
    ]);

    return new Response(
      JSON.stringify({ ok: true, kanallar: gonderimSonuclari.map((r) => r.status) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
};

async function telegramGonder(env, mesaj) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: mesaj }),
  });
  if (!res.ok) throw new Error(`Telegram gönderimi başarısız: ${res.status}`);
}

async function smsGonder(env, mesaj) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !env.TWILIO_TO_NUMBER) return;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({
    From: env.TWILIO_FROM_NUMBER,
    To: env.TWILIO_TO_NUMBER,
    Body: mesaj.slice(0, 300), // SMS uzunluk sınırı
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );
  if (!res.ok) throw new Error(`SMS gönderimi başarısız: ${res.status}`);
}
