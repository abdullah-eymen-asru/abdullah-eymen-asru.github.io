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
 * GELEN İSTEĞİ DOĞRULAMA:
 *   Supabase pg_net, isteğe kimlik doğrulama header'ı EKLEMEZ (fonksiyon
 *   içinde elle eklenmediği sürece) — bu yüzden Worker'ın URL'inin kendisini
 *   tahmin edilmesi zor, gizli bir path segmenti ile koru (aşağıdaki
 *   GIZLI_YOL) VE/VEYA migration'daki net.http_post çağrısına bir
 *   "Authorization" header'ı eklemeyi düşün (bkz. dosya sonu notu).
 *
 * Gerekli ortam değişkenleri (Cloudflare Dashboard > Worker > Settings
 * > Variables and Secrets):
 *   GIZLI_YOL              URL'e eklenecek tahmin edilmesi zor bir segment
 *                           (ör. "x7f3-admin-guvenlik") — worker sadece
 *                           /GIZLI_YOL isteğine cevap verir, başka her şeye 404.
 *   TELEGRAM_BOT_TOKEN      (opsiyonel) Telegram bot token'ı
 *   TELEGRAM_CHAT_ID        (opsiyonel) bildirimin gideceği chat/kanal id'si
 *   TWILIO_ACCOUNT_SID      (opsiyonel) SMS için Twilio hesap SID'i
 *   TWILIO_AUTH_TOKEN       (opsiyonel) Twilio auth token       (Encrypt/Secret)
 *   TWILIO_FROM_NUMBER      (opsiyonel) Twilio gönderen numara
 *   TWILIO_TO_NUMBER        (opsiyonel) bildirimin gideceği numara
 *
 * En az bir kanal (Telegram VEYA SMS) yapılandırılmalı; ikisi de boşsa
 * Worker isteği 200 ile kabul eder ama hiçbir yere iletmez (loglar).
 *
 * KURULUM:
 *   1) Bu dosyayı Cloudflare Dashboard'da yeni bir Worker'a yapıştır, yukarıdaki
 *      ortam değişkenlerini gir, deploy et.
 *   2) Supabase'de:
 *        update public.guvenlik_bildirim_ayarlari
 *        set webhook_url = 'https://<worker-adresin>.workers.dev/<GIZLI_YOL>',
 *            aktif = true
 *        where id = 1;
 */

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
