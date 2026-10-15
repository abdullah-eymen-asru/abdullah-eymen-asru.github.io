/**
 * assets/js/sistem-yedek/worker-anahtarlari.js — "Worker anahtarları (kota koruması)" kartı (sys-yedek › Depolama Durumu)
 * -----------------------------------------------------------------------------------------------------------------------
 * Cloudflare ücretsiz kotası (100.000 istek/gün) Workers + Pages Functions için ORTAKTIR; dolunca hepsi hata verir. Bu kart,
 * her servisi tek tek AÇIP KAPATMAYI sağlar (migration 0088 · public.worker_anahtarlari). Kimler: Site Sahibi ve sistem yedekleme
 * yetkisi olan roller (bu kart zaten yalnızca depolamaCiz()'in çizildiği yetkili görünümde yer alır; gerçek yetki RPC'dedir).
 *
 * İKİ KATMAN (dürüst anlatım):
 *  1) YUMUŞAK (her zaman): durum veritabanına yazılır. Tarayıcılar kapalı servise İSTEK GÖNDERMEZ (assets/js/core/worker-kapi.js),
 *     Worker'lar da gelen isteği 503 ile hemen reddeder, Gatekeeper Function isteği işlemeden geçirir. Siteden gelen istekler
 *     kaynağında kesilir; doğrudan adrese gelen istekler yine sayılır (reddedilmiş olsa bile).
 *  2) SERT (isteğe bağlı): CF_WORKERS_TOKEN tanımlıysa Worker'ın workers.dev adresi Cloudflare API ile kapatılır → istek Worker'a
 *     hiç ulaşmaz, kotaya SAYILMAZ. Pages Function için sert kapatma yoktur (Cloudflare izin vermez; bkz. _routes.json).
 * innerHTML YOK, inline stil YOK (CSP).
 */
import { supabase } from "../core/supabase-client.js";
import { el, dugme, onayIste, silOnayiIste, hataMetni, tarihMetni, workerJson } from "./ortak.js";

const ONBELLEK_ANAHTARI = "aea_wk_v1"; // worker-kapi.js'in önbelleği: bu tarayıcıda değişiklik hemen görünsün

export function workerAnahtarKarti() {
  const govde = el("div", {}, el("p", { class: "muted", text: "Anahtarlar okunuyor…" }));
  const yenile = dugme({ metin: "Yenile", ikonAdi: "yenile", tur: "ikincil", kucuk: true });
  const kart = el("article", { class: "sy-kart sy-kota sy-wk-kart" },
    el("div", { class: "sy-kota-ust" }, el("h3", { text: "🔌 Worker anahtarları (kota koruması)" })),
    govde,
    el("div", { class: "sy-eylemler" }, yenile));

  let sertDestek = false;
  let sertSecili = false;
  let ownerMi = false;

  async function sertDurumu() {
    try { sertDestek = (await workerJson("/worker-sert/durum")).yapilandirildi === true; } catch { sertDestek = false; }
  }

  async function degistir(satir, acik, dugmeEl) {
    const kapatiyor = !acik;
    if (kapatiyor) {
      const ok = await onayIste({
        baslik: `${satir.etiket} kapatılsın mı?`,
        metin: [
          satir.tur === "pages_function"
            ? "Gatekeeper kapalıyken pages.dev adresinde SUNUCU TARAFI KİLİT yoktur: kilitli rotalar herkese açık olur (tarayıcıdaki perde güvenlik sınırı değildir). Kota için bunu yalnızca geçici olarak kapat."
            : "Kapatılınca bu servise dayanan özellikler (ör. dosya yükleme/indirme, listeler) çalışmaz; kullanıcılar “geçici olarak kapatıldı” görür.",
          sertSecili && satir.tur === "worker" ? "Sert kapatma açık: workers.dev adresi de kapatılacak (istek kotaya sayılmaz)." : null,
        ],
        tamam: "Kapat", tehlike: true,
      });
      if (!ok) return;
    }
    dugmeEl.disabled = true;
    try {
      // Açarken sert katman yapılandırılmışsa önce workers.dev'i aç (önceden sert kapatılmış olabilir); kapatırken yalnızca seçiliyse kapat.
      let sertUyari = null;
      if (satir.tur === "worker" && sertDestek && (acik || sertSecili)) {
        try {
          const r = await workerJson("/worker-sert", { yontem: "POST", govde: { ad: satir.ad, acik } });
          if (r?.dogrulandi === false) sertUyari = `Cloudflare isteği kabul etti ama workers.dev adresi beklenen durumda değil (şu an: ${r.workersDev ? "AÇIK" : "KAPALI"}). Birkaç saniye sonra Yenile'ye bas; sürerse Cloudflare panelinden kontrol et.`;
        } catch (h) { sertUyari = `Sert katman uygulanamadı: ${h.message || h}`; }
      }
      const { error } = await supabase.rpc("worker_anahtari_ayarla", { p_ad: satir.ad, p_acik: acik });
      if (error) throw error;
      try { localStorage.removeItem(ONBELLEK_ANAHTARI); } catch { /* yok say */ }
      await yukle(sertUyari);
    } catch (h) {
      govde.prepend(el("p", { class: "auth-message error", text: `Değiştirilemedi: ${hataMetni(h)}` }));
      dugmeEl.disabled = false;
    }
  }

  function satirCiz(s) {
    const btn = dugme({ metin: s.acik ? "Kapat" : "Aç", tur: s.acik ? "ikincil" : "birincil", kucuk: true });
    if (s.korumali) { btn.disabled = true; btn.title = "Korumalı servis: kapatılamaz"; }
    else btn.addEventListener("click", () => degistir(s, !s.acik, btn));
    return el("li", { class: "sy-wk-satir" },
      el("div", { class: "sy-wk-ad" },
        el("strong", { text: s.etiket }),
        el("code", { text: s.ad }),
        s.korumali ? el("span", { class: "muted sy-not", text: "Korumalı (her zaman açık)" }) : null),
      el("span", { class: `sy-rozet sy-rozet--${s.acik ? "iyi" : "kritik"}`, text: s.acik ? "Açık" : "Kapalı" }),
      btn);
  }

  async function yukle(uyari) {
    yenile.disabled = true;
    try {
      await sertDurumu();
      try { ownerMi = (await supabase.rpc("is_owner")).data === true; } catch { ownerMi = false; }
      const { data, error } = await supabase.from("worker_anahtarlari")
        .select("ad, etiket, tur, acik, korumali, guncelleme").order("tur", { ascending: false }).order("etiket");
      if (error) throw error;
      const sertKutu = el("input", { type: "checkbox", id: "sy-wk-sert", checked: sertSecili, disabled: !sertDestek });
      sertKutu.addEventListener("change", () => { sertSecili = sertKutu.checked; });
      const gunlukKok = el("div", {});
      const gunluk = el("details", { class: "sy-wk-gunluk" }, el("summary", { text: "Son değişiklikler" }), gunlukKok);
      async function gunlukCiz() {
        const { data: g, error: e } = await supabase.rpc("worker_anahtar_gunlugu_getir", { p_adet: 15 });
        if (e) { gunlukKok.replaceChildren(el("p", { class: "auth-message error", text: /does not exist|PGRST202|42883|schema cache/i.test(e.message || "") ? "Günlük için migration 0096 çalıştırılmalı." : hataMetni(e) })); return; }
        const satirlar = g || [];
        const temizle = ownerMi && satirlar.length
          ? dugme({ metin: "🗑 Günlüğü temizle", tur: "ikincil", kucuk: true }) : null;
        temizle?.addEventListener("click", async () => {
          const ok = await silOnayiIste({
            baslik: "Değişiklik günlüğü kalıcı olarak silinsin mi?",
            ozet: ["Tüm “Son değişiklikler” kayıtları veritabanından silinir."],
            uyari: ["Geri alınamaz. Servislerin açık/kapalı durumu etkilenmez.", "Yalnızca “günlük temizlendi (kim, ne zaman)” izi kalır."],
            onayMetni: "SİL", tamam: "Günlüğü temizle",
          });
          if (!ok) return;
          temizle.disabled = true;
          const { error: er } = await supabase.rpc("owner_worker_gunlugunu_temizle");
          if (er) { gunlukKok.prepend(el("p", { class: "auth-message error", text: `Temizlenemedi: ${hataMetni(er)}` })); temizle.disabled = false; return; }
          await gunlukCiz();
        });
        gunlukKok.replaceChildren(
          satirlar.length ? el("ul", { class: "sy-kota-liste" }, satirlar.map((x) => {
            const sil = ownerMi ? dugme({ metin: "Sil", tur: "ikincil", kucuk: true }) : null;
            sil?.addEventListener("click", async () => {
              sil.disabled = true;
              const { error: er } = await supabase.rpc("owner_worker_gunluk_satiri_sil", { p_id: x.id });
              if (er) { sil.disabled = false; gunlukKok.prepend(el("p", { class: "auth-message error", text: `Silinemedi: ${hataMetni(er)}` })); return; }
              await gunlukCiz();
            });
            return el("li", { class: "sy-wk-gunluk-satir" },
              el("span", { text: x.ozet ? `Günlük temizlendi · ${x.kullanici}` : `${x.ad} → ${x.acik ? "açıldı" : "kapatıldı"} · ${x.kullanici}` }),
              el("span", { class: "muted", text: tarihMetni(x.zaman) }), sil);
          })) : el("p", { class: "muted sy-not", text: "Kayıtlı değişiklik yok." }),
          temizle ? el("div", { class: "sy-eylemler" }, temizle) : null);
      }
      let gunlukYuklendi = false;
      gunluk.addEventListener("toggle", async () => {
        if (!gunluk.open || gunlukYuklendi) return;
        gunlukYuklendi = true; await gunlukCiz();
      });
      // Açılır-kapanır bilgi kartı: "Sert kapatma" ne yapar, ne zaman açılmalı?
      const bilgi = el("details", { class: "sy-wk-bilgi" },
        el("summary", { text: "ℹ️ Sert kapatma nedir? Ne zaman açılmalı?" }),
        el("div", { class: "sy-wk-bilgi-icerik" },
          el("p", {}, el("strong", { text: "Ne yapar? " }), "Cloudflare Workers'ın varsayılan *.workers.dev adresini kapatır. Adres kapalıyken gelen istek Worker'a hiç ulaşmaz ve günlük 100.000 ücretsiz istek kotasına SAYILMAZ; böylece yetkisiz istekler ve tarama botları kotayı bitiremez. (Normal “Kapat” yalnızca erken 503 döner; o istekler yine kotaya yazılır.)"),
          el("p", {}, el("strong", { text: "Ne zaman açılmalı? " }), "Bakım/yedekleme sırasında dış trafiği tamamen kesmek ya da kota saldırısı altında olduğunda işaretle ve ilgili Worker'ı kapat. Normal yayında işaretsiz bırak; Worker'ı tekrar AÇARKEN adres otomatik yeniden açılır."),
          el("p", { class: "muted", text: "Pages Function (Gatekeeper) için sert kapatma yoktur; sistem-yedek-worker kendini kapatamaz. İşlem sonrası adresin gerçek durumu Cloudflare'dan geri okunarak doğrulanır." })));
      govde.replaceChildren(
        uyari ? el("p", { class: "auth-message error", text: uyari }) : null,
        el("p", { class: "muted sy-not", text: "Kapalı bir servise tarayıcılar istek göndermez, Worker'lar gelen isteği hemen reddeder; Gatekeeper Function ise isteği işlemeden geçirir. Kota dolmadan önce yoğun/gereksiz servisleri buradan kapatabilirsin." }),
        el("ul", { class: "sy-wk-liste" }, (data || []).map(satirCiz)),
        el("label", { class: "sy-wk-sert", for: "sy-wk-sert" }, sertKutu,
          el("span", { text: sertDestek
            ? "Sert kapatma: Worker'ı kapatırken workers.dev adresini de kapat (istek kotaya hiç sayılmaz)."
            : "Sert kapatma kapalı: CF_WORKERS_TOKEN (Workers Scripts › Edit) tanımlı değil — rehber/04-cloudflare-secretlar.md § 4.10c." })),
        bilgi,
        gunluk);
    } catch (h) {
      govde.replaceChildren(el("p", { class: "auth-message error", text: /does not exist|42P01|PGRST205|schema cache/i.test(h?.message || "")
        ? "Gerekli migration (0088) henüz çalıştırılmamış."
        : `Anahtarlar okunamadı: ${h.message || h}` }));
    } finally { yenile.disabled = false; }
  }

  yenile.addEventListener("click", () => yukle());
  yukle();
  return kart;
}
