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
 * GELEN İSTEĞİ DOĞRULAMA (bkz. migration 0034): X-Webhook-Secret header'ı
 * WEBHOOK_SHARED_SECRET ile sabit zamanlı karşılaştırılır. GIZLI_YOL
 * kontrolü de KALDIRILMADI (savunma derinliği).
 *
 * Gerekli ortam değişkenleri: GIZLI_YOL, WEBHOOK_SHARED_SECRET,
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, (opsiyonel) TWILIO_*.
 *
 * DEĞİŞİKLİK (bkz. migration 0035): mesaj artık hedef adminin ad-soyadını
 * gösteriyor, Vaka ID kısaltıldı (ilk 8 karakter yeterli, tamamı gerekmiyor),
 * ve Zaman alanı Türkiye saatine (Europe/Istanbul) çevrilerek gösteriliyor.
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
  oy_geri_alindi: "↩️ Bir oy geri alındı",
  kalici_dusuruldu: "⛔ Bir admin KALICI OLARAK DÜŞÜRÜLDÜ",
  iptal_edildi: "✅ Askıya alma İPTAL EDİLDİ, yetki iade edildi",
  suresi_doldu_geri_acildi: "⏱️ Karar süresi doldu — hesap OTOMATİK olarak geri açıldı",
};

// admin_denetim_oy_kullan()'ın gönderdiği ham "dusur"/"geri_ac" değerini
// okunabilir Türkçe metne çevirir (bkz. migration 0036).
const OY_METINLERI = {
  dusur: "Düşür",
  geri_ac: "Geri Aç",
};

// Zaman damgasını Türkiye saatine (Europe/Istanbul) çevirir. Geçersiz/eksik
// bir değer gelirse olduğu gibi geri döner (mesajın tamamen bozulmaması için).
function turkiyeSaati(isoString) {
  if (!isoString) return "-";
  const tarih = new Date(isoString);
  if (isNaN(tarih.getTime())) return isoString;
  return (
    new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(tarih) + " (TR)"
  );
}

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
    const hedefAdi = yuk.hedef_admin_ad_soyad || yuk.hedef_admin_email || yuk.hedef_admin_id || "-";
    const baslatanAdi = yuk.baslatan_admin_ad_soyad || "-";
    const vakaKisa = yuk.denetim_id ? String(yuk.denetim_id).slice(0, 8) : "-";

    const mesajSatirlari = [baslik, `Admin: ${hedefAdi}`, `Başlatan: ${baslatanAdi}`];

    // oy_kullanildi olayına özel: kim, neye oy verdi (bkz. migration 0036 —
    // sadece ilk oy ya da GERÇEKTEN değişen bir oy bu olayı tetikler, aynı
    // oyun tekrarında bildirim zaten gönderilmiyor).
    if (yuk.olay === "oy_kullanildi" && yuk.oy_veren_ad_soyad) {
      const oyMetni = OY_METINLERI[yuk.oy] || yuk.oy || "-";
      const degisimNotu = yuk.oy_degisti ? " (oyunu değiştirdi)" : "";
      mesajSatirlari.push(`Oy veren: ${yuk.oy_veren_ad_soyad} → ${oyMetni}${degisimNotu}`);
    }

    // oy_geri_alindi olayına özel (bkz. migration 0037): kim, hangi oyunu
    // geri aldı.
    if (yuk.olay === "oy_geri_alindi" && yuk.oy_veren_ad_soyad) {
      const eskiOyMetni = OY_METINLERI[yuk.eski_oy] || yuk.eski_oy || "-";
      mesajSatirlari.push(`Oyunu geri alan: ${yuk.oy_veren_ad_soyad} (önceki oy: ${eskiOyMetni})`);
    }

    mesajSatirlari.push(
      `Sebep: ${yuk.sebep || "-"}`,
      `Durum: ${yuk.durum || "-"}`,
      `Vaka: ${vakaKisa}`,
      `Zaman: ${turkiyeSaati(yuk.zaman)}`
    );

    const mesaj = mesajSatirlari.join("\n");

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
    Body: mesaj.slice(0, 300),
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
