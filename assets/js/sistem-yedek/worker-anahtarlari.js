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
import { el, dugme, onayIste, hataMetni, tarihMetni, workerJson } from "./ortak.js";

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
        try { await workerJson("/worker-sert", { yontem: "POST", govde: { ad: satir.ad, acik } }); }
        catch (h) { sertUyari = `Sert katman uygulanamadı: ${h.message || h}`; }
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
      const { data, error } = await supabase.from("worker_anahtarlari")
        .select("ad, etiket, tur, acik, korumali, guncelleme").order("tur", { ascending: false }).order("etiket");
      if (error) throw error;
      const sertKutu = el("input", { type: "checkbox", id: "sy-wk-sert", checked: sertSecili, disabled: !sertDestek });
      sertKutu.addEventListener("change", () => { sertSecili = sertKutu.checked; });
      const gunlukKok = el("div", {});
      const gunluk = el("details", { class: "sy-wk-gunluk" }, el("summary", { text: "Son değişiklikler" }), gunlukKok);
      let gunlukYuklendi = false;
      gunluk.addEventListener("toggle", async () => {
        if (!gunluk.open || gunlukYuklendi) return;
        gunlukYuklendi = true;
        const { data: g, error: e } = await supabase.rpc("worker_anahtar_gunlugu_getir", { p_adet: 15 });
        gunlukKok.replaceChildren(e
          ? el("p", { class: "auth-message error", text: hataMetni(e) })
          : el("ul", { class: "sy-kota-liste" }, (g || []).map((x) => el("li", {},
              el("span", { text: `${x.ad} → ${x.acik ? "açıldı" : "kapatıldı"} · ${x.kullanici}` }),
              el("span", { class: "muted", text: tarihMetni(x.zaman) })))));
      });
      govde.replaceChildren(
        uyari ? el("p", { class: "auth-message error", text: uyari }) : null,
        el("p", { class: "muted sy-not", text: "Kapalı bir servise tarayıcılar istek göndermez, Worker'lar gelen isteği hemen reddeder; Gatekeeper Function ise isteği işlemeden geçirir. Kota dolmadan önce yoğun/gereksiz servisleri buradan kapatabilirsin." }),
        el("ul", { class: "sy-wk-liste" }, (data || []).map(satirCiz)),
        el("label", { class: "sy-wk-sert", for: "sy-wk-sert" }, sertKutu,
          el("span", { text: sertDestek
            ? "Sert kapatma: Worker'ı kapatırken workers.dev adresini de kapat (istek kotaya hiç sayılmaz)."
            : "Sert kapatma kapalı: CF_WORKERS_TOKEN (Workers Scripts › Edit) tanımlı değil — rehber/04-cloudflare-secretlar.md § 4.10c." })),
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
