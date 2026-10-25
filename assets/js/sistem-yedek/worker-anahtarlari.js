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
import { el, dugme, silOnayiIste, hataMetni, tarihMetni, workerJson } from "./ortak.js";

/**
 * "Kapat" düğmesinin akıllı onay penceresi (mobil dostu <dialog>): Standart (503) ya da Sert (workers.dev'i kes) seçilir.
 * @returns {Promise<"standart"|"sert"|null>}
 */
function kapatmaSecimiIste({ satir, sertKullanilabilir, sertNeden }) {
  return new Promise((coz) => {
    if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") {
      coz(window.confirm(`${satir.etiket} kapatılsın mı? (Standart kapatma)`) ? "standart" : null);
      return;
    }
    const d = el("dialog", { class: "sy-dialog wk-secim" });
    let sonuc = null;
    const secenek = (anahtar, baslik, aciklama, tur, devreDisi) => {
      const b = el("button", { type: "button", class: `wk-secenek wk-secenek--${tur}`, disabled: devreDisi || null },
        el("strong", { text: baslik }), el("span", { text: aciklama }));
      b.addEventListener("click", () => { sonuc = anahtar; d.close(); });
      return b;
    };
    const iptal = dugme({ metin: "Vazgeç", tur: "ikincil" });
    iptal.addEventListener("click", () => d.close());
    d.append(el("div", { class: "sy-dialog-govde" },
      el("h3", { class: "sy-dialog-baslik", text: `${satir.etiket} nasıl kapatılsın?` }),
      el("p", { class: "muted", text: satir.tur === "pages_function"
        ? "Gatekeeper kapalıyken pages.dev adresinde SUNUCU TARAFI KİLİT yoktur: kilitli rotalar herkese açık olur. Yalnızca geçici kapat."
        : "Kapatılınca bu servise dayanan özellikler (dosya yükleme/indirme, listeler) çalışmaz; kullanıcılar “geçici olarak kapatıldı” görür." }),
      secenek("standart", "Standart Kapat (503)", "Worker gelen isteğe hemen 503 döner. İstek yine de kotaya yazılır.", "standart", false),
      secenek("sert", "Sert Kapat — workers.dev'i kes (0 kota)", sertKullanilabilir
        ? "Adres Cloudflare'de kapatılır; istek Worker'a hiç ulaşmaz ve kotaya SAYILMAZ. Tekrar Açtığında adres otomatik açılır."
        : sertNeden, "sert", !sertKullanilabilir),
      el("div", { class: "sy-dialog-eylem" }, iptal)));
    d.addEventListener("close", () => { d.remove(); coz(sonuc); });
    document.body.append(d);
    d.showModal();
  });
}

const ONBELLEK_ANAHTARI = "aea_wk_v1"; // worker-kapi.js'in önbelleği: bu tarayıcıda değişiklik hemen görünsün

export function workerAnahtarKarti() {
  const govde = el("div", {}, el("p", { class: "muted", text: "Anahtarlar okunuyor…" }));
  const yenile = dugme({ metin: "Yenile", ikonAdi: "yenile", tur: "ikincil", kucuk: true });
  // Açılır/kapanır kart: varsayılan KAPALI → sekme aşağı doğru uzamaz. Özet satırında "N servis · M kapalı" sayacı görünür.
  const ozetSayac = el("span", { class: "muted sy-wk-sayac", text: "" });
  const kapsayici = el("details", { class: "sy-wk-kapsayici" },
    el("summary", { class: "sy-wk-ozet" }, el("h3", { text: "🔌 Worker anahtarları (kota koruması)" }), ozetSayac),
    govde,
    el("div", { class: "sy-eylemler" }, yenile));
  const kart = el("article", { class: "sy-kart sy-kota sy-wk-kart" }, kapsayici);
  const aramaTr = (s) => String(s || "").toLocaleLowerCase("tr");
  let aramaMetni = "";                                    // yenilemeler (yukle) arasında korunur
  let listeAnahtarlar = [];

  let sertDestek = false;
  let ownerMi = false;
  const rozetler = new Map();   // servis adı -> {metin, sinif}: Cloudflare API onay rozeti (oturum boyunca)

  async function sertDurumu() {
    try { sertDestek = (await workerJson("/worker-sert/durum")).yapilandirildi === true; } catch { sertDestek = false; }
  }

  async function degistir(satir, acik, dugmeEl) {
    let mod = null;                                        // "standart" | "sert" (yalnızca kapatırken)
    if (!acik) {
      const sertUygun = satir.tur === "worker" && sertDestek;
      mod = await kapatmaSecimiIste({
        satir, sertKullanilabilir: sertUygun,
        sertNeden: satir.tur !== "worker"
          ? "Bu servis için sert kapatma yoktur (Cloudflare Pages Function'ı workers.dev adresiyle kapatılamaz)."
          : "Sert kapatma yapılandırılmamış: sistem-yedek-worker'a CF_WORKERS_TOKEN (Workers Scripts › Edit) eklenmeli — rehber/04-cloudflare-secretlar.md § 4.10c.",
      });
      if (!mod) return;
    }
    // Yükleniyor (spinner) — düğme ve satır kilitlenir
    dugmeEl.disabled = true;
    dugmeEl.classList.add("wk-yukleniyor");
    dugmeEl.replaceChildren(el("span", { class: "wk-donen", "aria-hidden": "true" }), el("span", { text: "İşleniyor…" }));
    try {
      // Açarken sert katman yapılandırılmışsa önce workers.dev'i aç (önceden sert kapatılmış olabilir); kapatırken yalnızca "sert" seçildiyse kes.
      let sertUyari = null, rozet = { metin: acik ? "Açıldı ✓" : "Kapatıldı ✓ (standart 503)", sinif: "iyi" };
      if (satir.tur === "worker" && sertDestek && (acik || mod === "sert")) {
        try {
          const r = await workerJson("/worker-sert", { yontem: "POST", govde: { ad: satir.ad, acik } });
          if (r?.dogrulandi === true) rozet = { metin: `Cloudflare API doğruladı ✓ workers.dev ${r.workersDev ? "AÇIK" : "KAPALI"}`, sinif: "iyi" };
          else if (r?.dogrulandi === false) {
            rozet = { metin: `Cloudflare doğrulaması tutmadı (workers.dev şu an ${r.workersDev ? "AÇIK" : "KAPALI"})`, sinif: "uyari" };
            sertUyari = `Cloudflare isteği kabul etti ama workers.dev adresi beklenen durumda değil (şu an: ${r.workersDev ? "AÇIK" : "KAPALI"}). Birkaç saniye sonra Yenile'ye bas; sürerse Cloudflare panelinden kontrol et.`;
          } else rozet = { metin: "Cloudflare'e iletildi (durum geri okunamadı)", sinif: "uyari" };
        } catch (h) {
          rozet = { metin: "Sert katman uygulanamadı", sinif: "kritik" };
          sertUyari = `Sert katman uygulanamadı: ${h.message || h}`;
        }
      }
      const { error } = await supabase.rpc("worker_anahtari_ayarla", { p_ad: satir.ad, p_acik: acik });
      if (error) throw error;
      rozetler.set(satir.ad, rozet);
      try { localStorage.removeItem(ONBELLEK_ANAHTARI); } catch { /* yok say */ }
      await yukle(sertUyari);
    } catch (h) {
      govde.prepend(el("p", { class: "auth-message error", text: `Değiştirilemedi: ${hataMetni(h)}` }));
      await yukle();
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
      btn,
      rozetler.has(s.ad) ? el("span", { class: `sy-rozet sy-rozet--${rozetler.get(s.ad).sinif} wk-onay`, text: rozetler.get(s.ad).metin, role: "status" }) : null);
  }

  /** Arama kutusu + sabit yükseklikli kaydırılabilir liste (ad, etiket veya durum "açık/kapalı" ile süzer). */
  function aramaVeListe(veri, satirCizici) {
    const arama = el("input", { type: "search", class: "sy-wk-arama", placeholder: "Servis ara… (ad, etiket, açık/kapalı)", "aria-label": "Worker anahtarlarında ara", autocomplete: "off" });
    arama.value = aramaMetni;
    const liste = el("ul", { class: "sy-wk-liste sy-wk-kaydir" });
    const bos = el("p", { class: "muted sy-not", role: "status", hidden: true, text: "Aramayla eşleşen servis yok." });
    const satirlar = veri.map((s) => ({ s, li: satirCizici(s), metin: aramaTr(`${s.etiket} ${s.ad} ${s.tur} ${s.acik ? "açık" : "kapalı"}${s.korumali ? " korumalı" : ""}`) }));
    liste.append(...satirlar.map((x) => x.li));
    function sirala() {
      const q = aramaTr(arama.value).trim(); aramaMetni = arama.value;
      let gorunen = 0;
      for (const x of satirlar) { const g = !q || q.split(/\s+/).every((k) => x.metin.includes(k)); x.li.hidden = !g; if (g) gorunen++; }
      bos.hidden = gorunen !== 0;
    }
    arama.addEventListener("input", sirala);
    sirala();
    return el("div", { class: "sy-wk-alan" }, arama, liste, bos);
  }

  async function yukle(uyari) {
    yenile.disabled = true;
    try {
      await sertDurumu();
      try { ownerMi = (await supabase.rpc("is_owner")).data === true; } catch { ownerMi = false; }
      const { data, error } = await supabase.from("worker_anahtarlari")
        .select("ad, etiket, tur, acik, korumali, guncelleme").order("tur", { ascending: false }).order("etiket");
      if (error) throw error;
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
      govde.replaceChildren(
        uyari ? el("p", { class: "auth-message error", text: uyari }) : null,
        el("p", { class: "muted sy-not", text: "Kapalı bir servise tarayıcılar istek göndermez, Worker'lar gelen isteği hemen reddeder; Gatekeeper Function ise isteği işlemeden geçirir. Kota dolmadan önce yoğun/gereksiz servisleri buradan kapatabilirsin." }),
        aramaVeListe((data || []), satirCiz),
        gunluk);
      const kapali = (data || []).filter((x) => !x.acik).length;
      ozetSayac.textContent = `${(data || []).length} servis · ${kapali} kapalı`;
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
