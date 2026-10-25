/**
 * assets/js/sistem-yedek/kota-analitigi.js — "📊 Worker Kota Analitiği & Harcama Dökümü" (sys-yedek › Depolama Durumu)
 * -----------------------------------------------------------------------------------------------------------------------
 * Saatlik / Günlük / Haftalık / Aylık / Yıllık görünüm; önceki-sonraki dönem seçicileri. Değerler grafiğin ÜSTÜNE tıklamadan/hover
 * yapmadan DOĞRUDAN satırın içinde yazar: "1.420 istek · %1,4". Grafik kütüphanesi yok → taşma/üst üste binme riski yok;
 * her satır = etiket + <progress> + sayı (CSP: inline stil yok, harici bağımlılık yok).
 *
 * VERİ (sıfır ek maliyet — bkz. supabase/migrations/0106_worker_kota_gecmisi.sql):
 *   • saatlik  : sistem-yedek-worker GET /kota/analitik  (Cloudflare ücretsiz GraphQL Analytics, son ~31 gün, 5 dk edge cache)
 *   • günlük+  : aynı yanıttan türetilir; ayrıca Worker günlük toplamları worker_kota_gecmis tablosuna yazar → 31 günden eski
 *                aylık/yıllık görünüm bu küçük tablodan okunur (RPC worker_kota_gecmisi_getir, yalnızca Site Sahibi).
 * ZAMAN TANIMI: HER ŞEY UTC'dir (Cloudflare kotası UTC gününe göre sayılır; TR 03:00'te sıfırlanır) — saatlik görünüm de. Türkiye saati (UTC+3)
 * yalnızca satır etiketinin yanında küçük bilgi olarak yazılır. Böylece "Bugün" toplamı genel Worker sayacıyla BİRE BİR aynıdır (aynı veri kaynağı).
 * Çubuk uzunluğu o dönemdeki en yüksek satıra göre ölçeklenir; yüzde, satırın ait olduğu dönemin KOTASINA orandır.
 */
import { supabase } from "../core/supabase-client.js";
import { el, dugme, workerJson, hataMetni } from "./ortak.js";

const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const OLCEKLER = [
  { id: "saat", ad: "Saatlik" }, { id: "gun", ad: "Günlük" }, { id: "hafta", ad: "Haftalık" },
  { id: "ay", ad: "Aylık" }, { id: "yil", ad: "Yıllık" },
];

const sayi = (n) => Number(n || 0).toLocaleString("tr-TR");
const yuzde = (oran) => `%${(oran * 100).toLocaleString("tr-TR", { maximumFractionDigits: oran >= 0.1 ? 0 : 1 })}`;
const p2 = (n) => String(n).padStart(2, "0");
const gunAnahtari = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;       // UTC gün anahtarı
const yerelGunAnahtari = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const utcGun = (y, a, g) => new Date(Date.UTC(y, a, g));
const bugunUtcTarih = () => { const n = new Date(); return new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };   // takvim günü = UTC günü
/** UTC anının Türkiye saati karşılığı ("TR 03:00"); gün değişirse "+1 g". */
const trSaat = (utcAni) => {
  const t = utcAni.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false });
  const gun = (d) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  const ayniGun = gun(utcAni) === `${utcAni.getUTCFullYear()}-${String(utcAni.getUTCMonth() + 1).padStart(2, "0")}-${String(utcAni.getUTCDate()).padStart(2, "0")}`;
  return `TR ${t}${ayniGun ? "" : " +1g"}`;
};
const ayGunSayisi = (y, a) => new Date(Date.UTC(y, a + 1, 0)).getUTCDate();

/** @returns {{rozet:HTMLElement}} — kartın kendisi */
export function kotaAnaliziKarti() {
  const durum = { olcek: "saat", ref: bugunUtcTarih(), saatlik: [], gecmis: new Map(), limit: 100000, hazir: false, pagesOkunamadi: false, gecmisYazildi: null };

  const govde = el("div", { class: "ka-govde" }, el("p", { class: "muted", text: "Analitik yükleniyor…" }));
  const yenile = dugme({ metin: "Yenile", ikonAdi: "yenile", tur: "ikincil", kucuk: true });
  // v8: kart AÇILIR-KAPANIR (varsayılan kapalı). Saatlik tablo çok uzundu; artık başlığa tıklayınca açılır, ilk açılışta veri yüklenir (gereksiz RPC yok).
  const ACIK_ANAHTAR = "sy_kota_analitik_acik";
  let acik = false; try { acik = localStorage.getItem(ACIK_ANAHTAR) === "1"; } catch { /* yok say */ }
  const icerik = el("div", { class: "ka-acilir-icerik", id: "ka-acilir-icerik", hidden: !acik }, govde, el("div", { class: "sy-eylemler" }, yenile));
  const anahtar = el("button", { type: "button", class: "ka-anahtar", "aria-controls": "ka-acilir-icerik", "aria-expanded": String(acik) },
    el("span", { class: "ka-ok", "aria-hidden": "true", text: acik ? "▾" : "▸" }), el("span", { class: "ka-anahtar-metin", text: acik ? "Kapat" : "Aç" }));
  const kart = el("article", { class: "sy-kart sy-kota ka-kart" },
    el("div", { class: "sy-kota-ust ka-acilir-ust" }, el("h3", { text: "📊 Worker Kota Analitiği & Harcama Dökümü" }), anahtar),
    icerik);
  let yuklendi = false;
  function acKapat(yeni) {
    acik = yeni; icerik.hidden = !acik; anahtar.setAttribute("aria-expanded", String(acik));
    anahtar.querySelector(".ka-ok").textContent = acik ? "▾" : "▸"; anahtar.querySelector(".ka-anahtar-metin").textContent = acik ? "Kapat" : "Aç";
    try { localStorage.setItem(ACIK_ANAHTAR, acik ? "1" : "0"); } catch { /* yok say */ }
    if (acik && !yuklendi) { yuklendi = true; yukle(); }
  }
  anahtar.addEventListener("click", () => acKapat(!acik));

  /* ------------------------------- veri kurma ------------------------------- */
  /** UTC gün anahtarı → {w,p}. Geçmiş tablosu + saatlik türetme (saatlik varsa o kazanır; ikisinde de en büyük değer). */
  function gunHaritasi() {
    const h = new Map();
    for (const [g, v] of durum.gecmis) h.set(g, { w: v.w, p: v.p });
    const turet = new Map();
    for (const s of durum.saatlik) {
      const g = s.t.slice(0, 10);
      const o = turet.get(g) || { w: 0, p: 0 };
      o.w += s.w; o.p += s.p; turet.set(g, o);
    }
    for (const [g, v] of turet) {
      const m = h.get(g);
      h.set(g, m ? { w: Math.max(m.w, v.w), p: Math.max(m.p, v.p) } : v);
    }
    return h;
  }

  const topla = (harita, anahtarlar) => {
    let w = 0, p = 0, var_ = false;
    for (const a of anahtarlar) { const v = harita.get(a); if (v) { w += v.w; p += v.p; var_ = true; } }
    return var_ ? { w, p } : null;
  };

  /** Seçili ölçek ve referans tarihe göre satırlar: {etiket, v:{w,p}|null, kota, gelecek, vurgu} */
  function satirlar() {
    const bugunUtc = gunAnahtari(new Date());
    const simdi = new Date();
    const y = durum.ref.getFullYear(), a = durum.ref.getMonth(), g = durum.ref.getDate();
    const harita = gunHaritasi();
    const limit = durum.limit;

    if (durum.olcek === "saat") {                                   // seçili takvim günü = UTC günü; 24 UTC saati
      const saatHarita = new Map(durum.saatlik.map((s) => [s.t, s]));
      const rows = [];
      for (let h = 0; h < 24; h++) {
        const bas = new Date(Date.UTC(y, a, g, h, 0, 0, 0));
        const kayit = saatHarita.get(bas.toISOString());
        const gelecek = bas > simdi;
        rows.push({ etiket: `${p2(h)}:00`, ek: trSaat(bas), v: kayit ? { w: kayit.w, p: kayit.p } : (gelecek ? null : { w: 0, p: 0 }), kota: limit, gelecek, vurgu: !gelecek && simdi - bas < 3600000 });
      }
      return rows;
    }
    if (durum.olcek === "gun") {                                     // refin bulunduğu haftanın 7 günü (Pzt–Paz)
      const pzt = new Date(y, a, g - ((durum.ref.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(pzt.getFullYear(), pzt.getMonth(), pzt.getDate() + i);
        const k = yerelGunAnahtari(d);
        return { etiket: `${p2(d.getDate())} ${AY_ADLARI[d.getMonth()].slice(0, 3)} ${GUN_KISA[d.getDay()]}`, v: harita.get(k) || null, kota: limit, gelecek: k > bugunUtc, vurgu: k === bugunUtc };
      });
    }
    if (durum.olcek === "hafta") {                                   // ayın haftaları (Pzt–Paz; ay sınırında kırpılır)
      const n = ayGunSayisi(y, a), rows = [];
      let d = 1;
      while (d <= n) {
        const gunIdx = (new Date(y, a, d).getDay() + 6) % 7;         // 0 = Pzt
        const son = Math.min(n, d + (6 - gunIdx));
        const anahtarlar = [];
        for (let x = d; x <= son; x++) anahtarlar.push(`${y}-${p2(a + 1)}-${p2(x)}`);
        const gelecek = anahtarlar[0] > bugunUtc;
        rows.push({ etiket: `${d}–${son} ${AY_ADLARI[a]}`, v: topla(harita, anahtarlar), kota: limit * anahtarlar.length, gelecek, vurgu: anahtarlar.includes(bugunUtc) });
        d = son + 1;
      }
      return rows;
    }
    if (durum.olcek === "ay") {                                      // ayın her günü
      const n = ayGunSayisi(y, a);
      return Array.from({ length: n }, (_, i) => {
        const k = `${y}-${p2(a + 1)}-${p2(i + 1)}`;
        return { etiket: `${p2(i + 1)} ${AY_ADLARI[a].slice(0, 3)} ${GUN_KISA[new Date(y, a, i + 1).getDay()]}`, v: harita.get(k) || null, kota: limit, gelecek: k > bugunUtc, vurgu: k === bugunUtc };
      });
    }
    return Array.from({ length: 12 }, (_, m) => {                    // yıl: 12 ay
      const n = ayGunSayisi(y, m);
      const anahtarlar = Array.from({ length: n }, (_, i) => `${y}-${p2(m + 1)}-${p2(i + 1)}`);
      return { etiket: AY_ADLARI[m], v: topla(harita, anahtarlar), kota: limit * n, gelecek: anahtarlar[0] > bugunUtc, vurgu: anahtarlar.includes(bugunUtc) };
    });
  }

  function donemEtiketi() {
    const y = durum.ref.getFullYear(), a = durum.ref.getMonth(), g = durum.ref.getDate();
    if (durum.olcek === "saat") return `${g} ${AY_ADLARI[a]} ${y} · 00:00 – 23:00 UTC`;
    if (durum.olcek === "gun") {
      const pzt = new Date(y, a, g - ((durum.ref.getDay() + 6) % 7)), paz = new Date(pzt.getFullYear(), pzt.getMonth(), pzt.getDate() + 6);
      return `${pzt.getDate()} ${AY_ADLARI[pzt.getMonth()].slice(0, 3)} – ${paz.getDate()} ${AY_ADLARI[paz.getMonth()].slice(0, 3)} ${paz.getFullYear()}`;
    }
    if (durum.olcek === "yil") return String(y);
    return `${AY_ADLARI[a]} ${y}`;
  }

  function kaydir(yon) {
    const r = durum.ref;
    if (durum.olcek === "saat") durum.ref = new Date(r.getFullYear(), r.getMonth(), r.getDate() + yon);
    else if (durum.olcek === "gun") durum.ref = new Date(r.getFullYear(), r.getMonth(), r.getDate() + 7 * yon);
    else if (durum.olcek === "yil") durum.ref = new Date(r.getFullYear() + yon, r.getMonth(), 1);
    else durum.ref = new Date(r.getFullYear(), r.getMonth() + yon, 1);
    ciz();
  }
  const gelecegeGidilir = () => {
    const kopya = durum.ref, simdi = new Date();
    if (durum.olcek === "saat") return Date.UTC(kopya.getFullYear(), kopya.getMonth(), kopya.getDate() + 1) <= simdi.getTime();
    if (durum.olcek === "gun") return new Date(kopya.getFullYear(), kopya.getMonth(), kopya.getDate() - ((kopya.getDay() + 6) % 7) + 7) <= simdi;
    if (durum.olcek === "yil") return kopya.getFullYear() < simdi.getFullYear();
    return kopya.getFullYear() * 12 + kopya.getMonth() < simdi.getFullYear() * 12 + simdi.getMonth();
  };

  /* --------------------------------- çizim --------------------------------- */
  function ciz() {
    const rows = satirlar();
    const toplamlar = rows.map((r) => (r.v ? r.v.w + r.v.p : null));
    const dolu = toplamlar.filter((t) => t != null);
    const toplam = dolu.reduce((t, x) => t + x, 0);
    const enBuyuk = Math.max(1, ...dolu);
    const tepe = dolu.length ? rows[toplamlar.indexOf(Math.max(...dolu))] : null;
    const ort = dolu.length ? Math.round(toplam / dolu.length) : 0;

    const olcekSerit = el("div", { class: "ka-olcekler", role: "tablist", "aria-label": "Zaman ölçeği" },
      OLCEKLER.map((o) => {
        const b = el("button", { type: "button", role: "tab", class: "ka-olcek", text: o.ad, "aria-selected": String(durum.olcek === o.id) });
        b.addEventListener("click", () => { durum.olcek = o.id; ciz(); });
        return b;
      }));

    const onceki = dugme({ metin: "◀ Önceki", tur: "ikincil", kucuk: true, "aria-label": "Önceki dönem" });
    const sonraki = dugme({ metin: "Sonraki ▶", tur: "ikincil", kucuk: true, "aria-label": "Sonraki dönem" });
    const bugun = dugme({ metin: "Bugün", tur: "ikincil", kucuk: true });
    onceki.addEventListener("click", () => kaydir(-1));
    sonraki.addEventListener("click", () => kaydir(1));
    bugun.addEventListener("click", () => { durum.ref = bugunUtcTarih(); ciz(); });
    sonraki.disabled = !gelecegeGidilir();
    const gezinti = el("div", { class: "ka-gezinti" }, onceki, el("strong", { class: "ka-donem", text: donemEtiketi(), "aria-live": "polite" }), sonraki, bugun);

    const ozet = el("p", { class: "ka-ozet" },
      el("span", {}, "Toplam: ", el("strong", { text: `${sayi(toplam)} istek` })),
      el("span", {}, "Ortalama: ", el("strong", { text: `${sayi(ort)}` })),
      el("span", {}, "En yoğun: ", el("strong", { text: tepe ? `${tepe.etiket} (${sayi(Math.max(...dolu))})` : "—" })),
      durum.guncelleme ? el("span", { class: "muted" }, `Veri zamanı: ${String(new Date(durum.guncelleme).getUTCHours()).padStart(2, "0")}:${String(new Date(durum.guncelleme).getUTCMinutes()).padStart(2, "0")} UTC`) : null);

    const liste = el("ol", { class: "ka-liste" }, rows.map((r, i) => {
      const t = toplamlar[i];
      const oran = t != null && r.kota > 0 ? t / r.kota : 0;
      const sev = oran >= 0.9 ? "kritik" : oran >= 0.7 ? "uyari" : "iyi";
      const deger = r.gelecek && t == null ? "—" : t == null ? "veri yok" : `${sayi(t)} istek`;
      return el("li", { class: `ka-satir${r.vurgu ? " ka-satir--simdi" : ""}${t == null ? " ka-satir--bos" : ""}` },
        el("span", { class: "ka-etiket" }, r.etiket, r.ek ? el("small", { class: "muted ka-tr", text: r.ek }) : null),
        el("progress", { class: `sy-cubuk sy-cubuk--ince sy-cubuk--${sev}`, max: String(enBuyuk), value: String(t ?? 0), "aria-label": `${r.etiket}: ${deger}` }),
        el("span", { class: "ka-deger" },
          el("strong", { text: deger }),
          t != null ? el("span", { class: "ka-yuzde", text: yuzde(oran) }) : null,
          t != null && r.v.p > 0 ? el("small", { class: "muted ka-alt", text: `W ${sayi(r.v.w)} · P ${sayi(r.v.p)}` }) : null));
    }));

    const notlar = [
      "Tüm saatler ve günler UTC'dir (Cloudflare kotası UTC gününe göre sayılır ve Türkiye saatiyle 03:00'te sıfırlanır). Saat satırlarındaki küçük “TR” yazısı yalnızca Türkiye saatidir (UTC+3).",
      "W = Workers, P = Pages Functions (Gatekeeper). Çubuk, bu dönemin en yüksek satırına göre ölçeklenir; yüzde, satırın dönem kotasına (günlük 100.000 × gün sayısı) oranıdır. “Bugün” toplamı, yukarıdaki genel Worker sayacıyla aynı veriden gelir.",
      durum.olcek === "saat"
        ? "Saatlik döküm yalnızca son ~31 gün için vardır; veri 5 dakikaya kadar gecikmeli olabilir."
        : "31 günden eski veriler, analitik ekranı açıldıkça kaydedilen günlük toplamlardan gelir; kayıt yoksa “veri yok” yazar.",
      durum.pagesOkunamadi ? "Pages Functions verisi Cloudflare'den okunamadı; yalnızca Workers sayıları gösteriliyor." : null,
      durum.gecmisYazildi === false ? "Günlük geçmiş tablosu yazılamadı (migration 0106 çalıştırılmamış olabilir): 31 günden eski görünümler boş kalır." : null,
    ].filter(Boolean);

    govde.replaceChildren(olcekSerit, gezinti, ozet, liste, ...notlar.map((n) => el("p", { class: "muted sy-not", text: n })));
  }

  /* --------------------------------- yükleme -------------------------------- */
  async function yukle() {
    yenile.disabled = true;
    try {
      const g = await workerJson("/kota/analitik");
      if (g.yapilandirilmadi) {
        govde.replaceChildren(el("p", { class: "muted sy-not", text: "Analitik için sistem-yedek-worker'a CF_ACCOUNT_ID ve CF_API_TOKEN (izin: Account Analytics › Read) ekle. Adımlar: rehber/04-cloudflare-secretlar.md § 4.10b." }));
        return;
      }
      durum.saatlik = Array.isArray(g.saatlik) ? g.saatlik : [];
      durum.limit = Number(g.limit) || 100000;
      durum.pagesOkunamadi = g.pages_okunamadi === true;
      durum.gecmisYazildi = g.gecmis_yazildi;
      durum.guncelleme = g.guncelleme || null;
      durum.gecmis = new Map();
      try {                                                              // Cloudflare'in unuttuğu günler (0106); tablo yoksa sessizce atla
        const { data, error } = await supabase.rpc("worker_kota_gecmisi_getir", { p_bas: null, p_bit: null });
        if (!error) for (const s of data || []) durum.gecmis.set(String(s.gun).slice(0, 10), { w: Number(s.workers) || 0, p: Number(s.pages) || 0 });
      } catch { /* geçmiş okunamadı: yalnızca saatlik veriyle devam */ }
      durum.hazir = true;
      ciz();
    } catch (h) {
      govde.replaceChildren(el("p", { class: "auth-message error", text: `Analitik okunamadı: ${hataMetni(h)}` }));
    } finally { yenile.disabled = false; }
  }

  yenile.addEventListener("click", yukle);
  if (acik) { yuklendi = true; yukle(); }
  return kart;
}
