/**
 * assets/js/havastil/arayuz.js — HavaStil arayüzü (panel sekmesi VE bağımsız PWA sayfası aynı kodu kullanır).
 * CSP uyumu: innerHTML YOK, satır içi stil/olay YOK; metinler textContent ile basılır (konum adı gibi dış veri güvenle gösterilir).
 * Karar = cekirdek.js (deterministik). Veri = veri.js (tarayıcıdan Open-Meteo). AI = havastil-worker (yalnızca süs).
 */
import { supabase } from "../core/supabase-client.js";
import { degerlendir, hedefClo, SENARYOLAR, TOLERANSLAR } from "./cekirdek.js";
import { havaGetir, yerOner, sokakAra } from "./veri.js";
import { HAVASTIL_WORKER_URL, haberTaktigi } from "./haber.js";
import { taktikUygula, seviyeAdi } from "./taktik.js";
import { ILLER, IL_ADLARI, ilBul, ilAdindan, ilAdresten, enYakinIl } from "./iller.js";
import { birlestir, bulutKonumEkle, bulutKonumSil, bulutTumunuSil, bulutTercihOku, bulutTercihYaz } from "./bulut.js";

export { HAVASTIL_WORKER_URL };
const VARSAYILAN_KONUM = { ad: "İstanbul", lat: 41.0082, lon: 28.9784 };
const LS = { konumlar: "hv_konumlar", aktif: "hv_aktif", tercih: "hv_tercih", bulut: "hv_bulut", bildirim: "hv_bildirim", snap: "hv_snap", ai: "hv_ai_", aiModu: "hv_ai_modu", ilManuel: "hv_il_manuel" };

/** Konumdan il: (1) geokodlama admin1 / adres metni, (2) en yakın il merkezi (tarayıcıda, ağ yok). Türkiye dışı → null. */
function ilTespit(k) {
  if (k.ulke && k.ulke !== "TR") return null;
  if (k.adres && !/türkiye|turkey/i.test(k.adres)) return null;
  return ilAdindan(k.ilAd) || (k.adres ? ilAdresten(k.adres) : null) || ilBul(k.il) || enYakinIl(k.lat, k.lon);
}

const el = (e, oz = {}, ...c) => {
  const d = document.createElement(e);
  for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") d.className = v; else if (k === "text") d.textContent = v; else d.setAttribute(k, v === true ? "" : v); }
  for (const x of c.flat()) if (x != null && x !== false) d.append(x);
  return d;
};
const lsOku = (k, v) => { try { const x = JSON.parse(localStorage.getItem(k)); return x ?? v; } catch { return v; } };
const lsYaz = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depo kapalı */ } };
const gec = (ms) => new Promise((r) => setTimeout(r, ms));

export async function havastilKur(kok, { bagimsiz = false } = {}) {
  /* ------------------------------ durum ------------------------------ */
  const tercih = lsOku(LS.tercih, { tol: 0, sen: "toplu" });
  const d = {
    konum: lsOku(LS.aktif, VARSAYILAN_KONUM),
    tol: [-3, 0, 3].includes(tercih.tol) ? tercih.tol : 0,
    sen: SENARYOLAR[tercih.sen] ? tercih.sen : "toplu",
    kayitli: lsOku(LS.konumlar, []).filter((k) => k && Number.isFinite(k.lat) && Number.isFinite(k.lon)).slice(0, 20),
    bulut: lsOku(LS.bulut, false) === true,
    hava: null, sonuc: null, yenilemeNo: 0,
    aiModu: lsOku(LS.aiModu, false) === true,   // MOD A (varsayılan, false): hiçbir LLM çağrısı yok · MOD B (true): AI yorumu
    ilManuel: lsOku(LS.ilManuel, null),
    haber: null, haberNo: 0,
  };
  d.il = () => ilBul(d.ilManuel) || ilTespit(d.konum);

  /* ------------------------------ iskelet ------------------------------ */
  const hukumMetin = el("p", { class: "hv-hukum-metin", text: "Hesaplanıyor…" });
  const hukumIkon = el("span", { class: "hv-hukum-ikon", "aria-hidden": "true", text: "⚡" });
  const hukum = el("section", { class: "hv-kart hv-hukum", "aria-live": "polite" },
    hukumIkon, el("div", {}, el("span", { class: "hv-etiket", text: "3 saniyede günün kararı" }), hukumMetin));

  const arama = el("input", { type: "search", class: "hv-girdi", placeholder: "İlçe, semt veya sokak ara…", "aria-label": "Konum ara", autocomplete: "off", enterkeyhint: "search", maxlength: "80" });
  const gpsBtn = el("button", { type: "button", class: "hv-btn", "aria-label": "Konumumu kullan" }, el("span", { "aria-hidden": "true", text: "📍" }), el("span", { text: "Konumum" }));
  const oneriler = el("ul", { class: "hv-oneriler", role: "listbox", hidden: true });
  const konumNot = el("p", { class: "hv-ipucu", text: "Yazarken şehir/ilçe önerilir. Sokak ve mahalle için Enter'a bas." });
  const kayitliSatir = el("div", { class: "hv-cipler", role: "group", "aria-label": "Kayıtlı konumlar" });
  const kaydetBtn = el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "⭐ Bu konumu kaydet" });
  const konumKart = el("section", { class: "hv-kart" },
    el("div", { class: "hv-arama-satir" }, arama, gpsBtn), oneriler, konumNot, kayitliSatir, kaydetBtn);

  const segGrup = (baslik, secenekler, aktifFn, secFn, aciklama) => {
    const kutu = el("div", { class: "hv-seg", role: "group", "aria-label": baslik });
    const ciz = () => kutu.replaceChildren(...secenekler.map(([deger, etiket]) => {
      const b = el("button", { type: "button", class: "hv-seg-btn", "aria-pressed": String(aktifFn() === deger), text: etiket });
      b.addEventListener("click", () => { secFn(deger); ciz(); });
      return b;
    }));
    ciz();
    return el("div", { class: "hv-kart hv-kucuk" }, el("span", { class: "hv-etiket", text: baslik }), kutu, aciklama ? el("p", { class: "hv-ipucu", text: aciklama }) : null);
  };
  const tolKart = segGrup("Kişisel sıcaklık algın", Object.entries(TOLERANSLAR).map(([k, v]) => [Number(k), v]), () => d.tol,
    (v) => { d.tol = v; tercihKaydet(); degerlendirVeCiz(); });
  const senKart = segGrup("Günün planı", Object.entries(SENARYOLAR).map(([k, v]) => [k, v.ad]), () => d.sen,
    (v) => { d.sen = v; tercihKaydet(); degerlendirVeCiz(); });
  const senIpucu = el("p", { class: "hv-ipucu" });
  senKart.append(senIpucu);
  const tercihGrid = el("div", { class: "hv-grid-2" }, tolKart, senKart);

  const konumRozet = el("span", { class: "hv-etiket hv-vurgu", text: d.konum.ad });
  const hissedilen = el("span", { class: "hv-buyuk", text: "--°C" });
  const hamSic = el("span", { class: "hv-ipucu", text: "Termometre: --°C" });
  const dunMetin = el("p", { class: "hv-ipucu", text: "" });
  const durumRozet = el("p", { class: "hv-uyari", hidden: true });
  const modelNot = el("p", { class: "hv-uyari", hidden: true });
  const metrik = (ad) => { const v = el("strong", { text: "--" }); return { v, kutu: el("div", { class: "hv-metrik" }, el("span", { text: ad }), v) }; };
  const mDelta = metrik("Gün içi fark"), mRuzgar = metrik("Rüzgâr"), mYagis = metrik("Yağış riski"), mUv = metrik("UV");
  const yenileBtn = el("button", { type: "button", class: "hv-btn hv-btn-ince", "aria-label": "Hava durumunu yenile", text: "↻ Yenile" });
  const havaKart = el("section", { class: "hv-kart" },
    el("div", { class: "hv-hava-ust" }, el("div", {}, konumRozet, el("div", { class: "hv-sicaklik-satir" }, hissedilen, hamSic), dunMetin), yenileBtn),
    durumRozet, modelNot,
    el("div", { class: "hv-metrikler" }, mDelta.kutu, mRuzgar.kutu, mYagis.kutu, mUv.kutu));

  const cloRozet = el("span", { class: "hv-rozet", text: "Yalıtım: -- CLO" });
  const katman = (baslik, sinif) => {
    const ad = el("p", { class: "hv-katman-ad", text: "…" }), kumas = el("span", { class: "hv-ipucu", text: "" });
    return { ad, kumas, kutu: el("div", { class: `hv-kart hv-katman ${sinif}` }, el("span", { class: "hv-etiket", text: baslik }), ad, kumas) };
  };
  const k1 = katman("1 · Çekirdek", "hv-k1"), k2 = katman("2 · Modüler katman", "hv-k2"), k3 = katman("3 · Koruyucu kabuk", "hv-k3");
  const katmanSection = el("section", { class: "hv-bolum" },
    el("div", { class: "hv-bolum-ust" }, el("h2", { text: "Önerilen katman mimarisi" }), cloRozet),
    el("div", { class: "hv-grid-3" }, k1.kutu, k2.kutu, k3.kutu));

  const ayakMetin = el("p", { class: "hv-katman-ad", text: "…" }), renkMetin = el("p", { class: "hv-katman-ad", text: "…" });
  const zeminGrid = el("div", { class: "hv-grid-2" },
    el("div", { class: "hv-kart hv-kucuk" }, el("span", { class: "hv-etiket", text: "👟 Zemin & ayakkabı" }), ayakMetin),
    el("div", { class: "hv-kart hv-kucuk" }, el("span", { class: "hv-etiket", text: "🎨 Renk & güvenlik" }), renkMetin));
  const aksKutu = el("div", { class: "hv-kart hv-kucuk hv-aks" });

  const aiMetin = el("p", { class: "hv-ai-metin", text: "Stilist değerlendiriyor…" });
  const aiEtiket = el("span", { class: "hv-ipucu", text: "" });
  const aiKutu = el("input", { type: "checkbox", id: "hv-ai-modu" });
  const aiAnahtar = el("label", { class: "hv-onay hv-ai-anahtar", for: "hv-ai-modu" }, aiKutu,
    el("span", { text: "AI destekli yorum (Groq) — kapalıyken hiçbir yapay zekâ isteği yapılmaz" }));
  const aiKart = el("section", { class: "hv-kart hv-ai" }, el("span", { class: "hv-etiket", text: "✨ Stilist yorumu" }), aiMetin, aiEtiket, aiAnahtar);

  /* ---- Haber Doğrulama & Taktik ---- */
  const ilSecici = el("select", { class: "hv-girdi hv-il-sec", "aria-label": "Haberler için il" });
  const haberDurum = el("p", { class: "hv-ipucu", text: "Haberler kontrol ediliyor…" });
  const haberListe = el("div", { class: "hv-haberler" });
  const haberTaktikNot = el("p", { class: "hv-ipucu", hidden: true });
  const haberOzetEl = el("summary", { text: "Nasıl çalışıyor? Neden elendi?" });
  const haberAyrinti = el("details", { class: "hv-haber-ayrinti", hidden: true }, haberOzetEl);
  const haberKart = el("section", { class: "hv-kart hv-kucuk" },
    el("div", { class: "hv-bolum-ust" }, el("span", { class: "hv-etiket", text: "📰 Haber doğrulama & taktik" }), ilSecici),
    haberDurum, haberListe, haberTaktikNot, haberAyrinti);

  const bildirimBtn = el("button", { type: "button", class: "hv-btn hv-btn-ince" });
  const bildirimDurum = el("p", { class: "hv-ipucu" });
  const bildirimKart = el("section", { class: "hv-kart hv-kucuk" },
    el("span", { class: "hv-etiket", text: "🔔 Sabah uyarısı" }),
    el("p", { class: "hv-ipucu", text: "Sabah çıkmadan hava belirgin sertleşirse (yağış ihtimali artışı ya da ≥5 °C düşüş) haber ver." }),
    bildirimBtn, bildirimDurum);

  const bulutKutu = el("input", { type: "checkbox", id: "hv-bulut" });
  const bulutDurum = el("p", { class: "hv-ipucu", text: "" });
  const bulutKart = el("section", { class: "hv-kart hv-kucuk" },
    el("span", { class: "hv-etiket", text: "☁️ Cihazlar arası senkron" }),
    el("label", { class: "hv-onay", for: "hv-bulut" }, bulutKutu, el("span", { text: "Kayıtlı konumlarımı ve tercihlerimi hesabımda sakla" })),
    el("p", { class: "hv-ipucu", text: "Kapalıyken her şey yalnızca bu cihazdadır. Açıkken yalnızca ⭐ ile kaydettiğin konumlar (≈100 m'ye yuvarlanmış) hesabında tutulur; anlık GPS konumun ve aramaların hiçbir yere kaydedilmez." }),
    bulutDurum);
  const kvkk = el("details", { class: "hv-kart hv-kucuk hv-kvkk" },
    el("summary", { text: "🔒 KVKK ve gizlilik" }),
    el("p", { class: "hv-ipucu", text: "Koordinatın ve aradığın yerler site sunucusuna, veritabanına ya da Worker'a gönderilmez; hava verisi tarayıcından doğrudan Open-Meteo'dan, konum araması Open-Meteo Geocoding ve (yalnızca Enter ile) OpenStreetMap Nominatim'den çekilir — bu servisler IP adresini görür. Stilist yorumu için Worker'a yalnızca sıcaklık/rüzgâr gibi sayılar ve kıyafet kodları gider; konum gitmez. Ayrıntı: Aydınlatma Metni." }),
    el("a", { href: "/kurumsal/kvkk-aydinlatma-metni", text: "KVKK Aydınlatma Metni →" }));
  const ayarlar = el("div", { class: "hv-grid-2" }, bildirimKart, bulutKart);

  kok.classList.add("hv");
  kok.replaceChildren(hukum, konumKart, tercihGrid, havaKart, haberKart, katmanSection, zeminGrid, aksKutu, aiKart, ayarlar, kvkk);

  /* ------------------------------ tercih / konum ------------------------------ */
  function tercihKaydet() {
    lsYaz(LS.tercih, { tol: d.tol, sen: d.sen });
    if (d.bulut) bulutTercihYaz({ tolerans: d.tol, senaryo: d.sen }).catch(() => { /* sessiz */ });
  }

  function kayitliCiz() {
    kayitliSatir.replaceChildren(...d.kayitli.map((k) => {
      const b = el("button", { type: "button", class: "hv-cip", text: k.ad });
      b.addEventListener("click", () => konumSec(k));
      const x = el("button", { type: "button", class: "hv-cip-sil", "aria-label": `${k.ad} konumunu sil`, text: "×" });
      x.addEventListener("click", async () => {
        d.kayitli = d.kayitli.filter((y) => y !== k);
        lsYaz(LS.konumlar, d.kayitli);
        if (d.bulut && k.bid) { try { await bulutKonumSil(k.bid); } catch { /* sessiz */ } }
        kayitliCiz();
      });
      return el("span", { class: "hv-cip-kap" }, b, x);
    }));
    kaydetBtn.hidden = d.kayitli.some((k) => k.ad === d.konum.ad && Math.abs(k.lat - d.konum.lat) < 0.01 && Math.abs(k.lon - d.konum.lon) < 0.01) || d.kayitli.length >= 20;
  }

  function konumSec(k) {
    d.konum = { ad: k.ad, lat: Number(k.lat), lon: Number(k.lon), ...(k.ilAd ? { ilAd: k.ilAd } : {}), ...(k.ulke ? { ulke: k.ulke } : {}), ...(k.adres ? { adres: k.adres } : {}), ...(k.il ? { il: k.il } : {}) };
    d.ilManuel = null; lsYaz(LS.ilManuel, null);
    lsYaz(LS.aktif, d.konum);
    oneriler.hidden = true; arama.value = "";
    kayitliCiz();
    yenile();
  }

  kaydetBtn.addEventListener("click", async () => {
    if (d.kayitli.length >= 20) return;
    const ad = (window.prompt("Bu konuma bir ad ver (örn. Ev, İş):", d.konum.ad) || "").trim().slice(0, 40);
    if (!ad) return;
    const k = { ad, lat: d.konum.lat, lon: d.konum.lon, ...(d.il() ? { il: d.il().ad } : {}) };
    if (d.bulut) { try { k.bid = await bulutKonumEkle(k); } catch (h) { bulutDurum.textContent = `Buluta yazılamadı: ${h.message || h}`; } }
    d.kayitli.push(k);
    lsYaz(LS.konumlar, d.kayitli);
    kayitliCiz();
  });

  gpsBtn.addEventListener("click", () => {
    if (!navigator.geolocation) { konumNot.textContent = "Bu tarayıcı konum desteklemiyor; arama kutusunu kullan."; return; }
    gpsBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => { gpsBtn.disabled = false; konumSec({ ad: "Bulunduğum konum", lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { gpsBtn.disabled = false; konumNot.textContent = "Konum izni alınamadı. Arama kutusundan şehir/semt yazabilirsin."; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
  });

  function onerileriCiz(liste, bosMetin) {
    oneriler.replaceChildren(...(liste.length ? liste.map((r) => {
      const li = el("li", { role: "option", tabindex: "0", class: "hv-oneri" }, el("strong", { text: r.ad }), r.ayrinti ? el("span", { class: "hv-ipucu", text: r.ayrinti }) : null);
      const sec = () => konumSec(r);
      li.addEventListener("click", sec);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sec(); } });
      return li;
    }) : [el("li", { class: "hv-oneri hv-ipucu", text: bosMetin })]));
    oneriler.hidden = false;
  }

  let aramaZamanlayici = 0, aramaNo = 0;
  arama.addEventListener("input", () => {
    clearTimeout(aramaZamanlayici);
    const q = arama.value.trim();
    if (q.length < 2) { oneriler.hidden = true; return; }
    aramaZamanlayici = setTimeout(async () => {
      const no = ++aramaNo;
      try { const r = await yerOner(q); if (no === aramaNo) onerileriCiz(r, "Eşleşme yok — sokak/mahalle için Enter'a bas."); }
      catch { if (no === aramaNo) onerileriCiz([], "Öneri alınamadı (ağ). Enter ile sokak araması deneyebilirsin."); }
    }, 350);
  });
  arama.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { oneriler.hidden = true; return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = arama.value.trim();
    if (q.length < 3) return;
    clearTimeout(aramaZamanlayici); aramaNo += 1;
    onerileriCiz([], "Aranıyor…");
    try { onerileriCiz(await sokakAra(q), "Sokak/mahalle bulunamadı."); }
    catch { onerileriCiz([], "Arama şu an yapılamadı. Biraz sonra tekrar dene."); }
  });
  document.addEventListener("click", (e) => { if (!konumKart.contains(e.target)) oneriler.hidden = true; });

  /* ------------------------------ hava + karar ------------------------------ */
  async function yenile() {
    const no = ++d.yenilemeNo;
    konumRozet.textContent = d.konum.ad;
    yenileBtn.disabled = true;
    try {
      const h = await havaGetir(d.konum.lat, d.konum.lon);
      if (no !== d.yenilemeNo) return;
      d.hava = h;
      degerlendirVeCiz();
      bildirimKontrol(h);
      haberYenile(); // hava gösterildikten SONRA, bağımsız (haber hatası hava/giyim önerisini etkilemez)
    } catch {
      if (no !== d.yenilemeNo) return;
      hukumMetin.textContent = "Hava verisi alınamadı. Bağlantını kontrol edip ↻ Yenile'ye bas.";
      durumRozet.textContent = "Hava servisine ulaşılamadı ve kayıtlı veri yok."; durumRozet.hidden = false;
    } finally { if (no === d.yenilemeNo) yenileBtn.disabled = false; }
  }
  yenileBtn.addEventListener("click", yenile);

  function degerlendirVeCiz() {
    senIpucu.textContent = SENARYOLAR[d.sen].ipucu;
    const h = d.hava;
    if (!h) return;
    // Çekirdek (CLO) kararı + (varsa) doğrulanmış haberden çıkan yerel kuralların bindirmesi (Mod A). LLM burada YOK.
    const temel = degerlendir(h, { tolerans: d.tol, senaryo: d.sen });
    const kurallar = (d.haber?.durum === "ok" ? d.haber.secilen : []).flatMap((x) => x.kurallar);
    const s = taktikUygula(temel, kurallar);
    d.sonuc = s;

    hissedilen.textContent = `${h.apparent}°C`;
    hamSic.textContent = `Termometre: ${h.raw}°C`;
    dunMetin.textContent = h.yesterdayDiff == null ? "" : h.yesterdayDiff > 2 ? `Dün bu saate göre ${h.yesterdayDiff}°C daha ılık.` : h.yesterdayDiff < -2 ? `Dün bu saate göre ${Math.abs(h.yesterdayDiff)}°C daha soğuk${h.yesterdayDiff <= -4 ? " — dünkü kıyafet yetmeyebilir." : "."}` : "Dünle hemen hemen aynı sıcaklıkta.";
    durumRozet.hidden = !h.eski;
    if (h.eski) durumRozet.textContent = "⚠ Çevrimdışı/erişilemiyor: son bilinen veri gösteriliyor.";
    modelNot.hidden = !h.modelFarki;
    if (h.modelFarki) modelNot.textContent = `⚠ Hava modelleri yağışta ayrışıyor (${h.yagisVerenModel}/${h.modelSayisi} model yağış gösteriyor). Sürpriz yaşamamak için riskten kaçınıldı.`;
    mDelta.v.textContent = `${h.delta}°C`;
    mRuzgar.v.textContent = `${h.wind} km/s`;
    mYagis.v.textContent = `%${h.rainProb}`;
    mUv.v.textContent = String(h.uv);

    cloRozet.textContent = `Yalıtım: ${s.clo.toFixed(2)} CLO`;
    const doldur = (k, kat, bos) => { k.ad.textContent = kat.ad; k.kumas.textContent = bos ? "" : `Kumaş: ${kat.kumas}`; };
    doldur(k1, s.katmanlar.cekirdek, false);
    doldur(k2, s.katmanlar.orta, s.kodlar.m === "m_yok");
    doldur(k3, s.katmanlar.kabuk, s.kodlar.o === "o_yok");
    hukumMetin.textContent = s.hukum;
    hukumIkon.textContent = h.minRaw <= 1 ? "🧊" : s.yagisli ? "☔" : s.moduler ? "🧅" : s.clo >= 1.35 ? "🧥" : s.clo < 0.55 ? "☀️" : "⚡";
    ayakMetin.textContent = s.ayakkabi;
    renkMetin.textContent = s.renk;
    aksKutu.replaceChildren(el("span", { class: "hv-etiket", text: "🎒 Çantaya at" }),
      ...(s.aksesuar.length ? s.aksesuar.map((a) => el("span", { class: "hv-rozet", text: a })) : [el("span", { class: "hv-ipucu", text: "Ekstra aksesuara gerek yok." })]),
      ...(s.yasaklar?.length ? [el("span", { class: "hv-etiket hv-yasak-etiket", text: "🚫 Giyme" }), ...s.yasaklar.map((a) => el("span", { class: "hv-rozet hv-rozet-yasak", text: a }))] : []));
    haberTaktikNot.hidden = !(s.taktikNotlari?.length);
    if (s.taktikNotlari?.length) haberTaktikNot.textContent = s.taktikNotlari.join(" ");
    stilistIste();
  }

  /* ------------------------------ haber doğrulama & taktik ------------------------------ */
  const DURUM_METIN = {
    turkiye_disi: "Haber doğrulama yalnızca Türkiye'deki konumlar için çalışır.",
    worker_kapali: "Haber servisi şu an kapalı (Worker anahtarı). Hava ve giyim önerisi etkilenmez.",
    yetkisiz: "Haber servisine erişim yetkin yok.",
    oturum_yok: "Oturum bulunamadı; haber kontrolü yapılamadı.",
    hiz_siniri: "Haber servisi çok sık istendi; birazdan yenilenecek.",
    ulasilamadi: "Haber servisine ulaşılamadı. Hava ve giyim önerisi etkilenmez.",
  };
  const zamanOnce = (iso) => { const sa = (Date.now() - Date.parse(iso)) / 36e5; return sa < 1 ? `${Math.max(1, Math.round(sa * 60))} dk önce` : `${Math.round(sa)} sa önce`; };
  const BARIYER_AD = { clickbait: "Clickbait", zaman: "Zaman", konum: "Konum" };

  function ilSeciciKur() {
    const aktif = d.il();
    ilSecici.replaceChildren(el("option", { value: "", text: aktif && !d.ilManuel ? `Otomatik: ${aktif.ad}` : "Otomatik (il tespit et)" }), ...IL_ADLARI.map((ad) => el("option", { value: ad, text: ad })));
    ilSecici.value = d.ilManuel || "";
  }
  ilSecici.addEventListener("change", () => { d.ilManuel = ilSecici.value || null; lsYaz(LS.ilManuel, d.ilManuel); haberYenile(); });

  function haberCiz(s, il) {
    haberListe.replaceChildren();
    haberAyrinti.hidden = true;
    if (s.durum !== "ok" && s.durum !== "bos") { haberDurum.textContent = DURUM_METIN[s.durum] || "Haber kontrol edilemedi."; return; }
    const eski = s.eski ? " · önbellekten (ağ yok)" : "";
    if (s.durum === "ok") {
      haberDurum.textContent = `${il.ad} için ${s.katman === 1 ? "resmî kaynaklardan (Tier-1)" : "genel haberlerden (Tier-2; resmî kaynaklarda kritik uyarı yok)"} ${s.secilen.length} doğrulanmış uyarı — giyim önerisine uygulandı${eski}.`;
      haberListe.replaceChildren(...s.secilen.map((h) => el("article", { class: "hv-haber" },
        el("div", { class: "hv-haber-ust" }, el("span", { class: "hv-rozet", text: `Tier-${h.tier} · ${h.kaynakAd}` }), el("span", { class: "hv-ipucu", text: zamanOnce(h.yayin) })),
        el("p", { class: "hv-haber-baslik" }, h.link ? el("a", { href: h.link, target: "_blank", rel: "noopener noreferrer", text: h.baslik }) : el("span", { text: h.baslik })),
        el("div", { class: "hv-cipler" }, ...h.kurallar.map((k) => el("span", { class: `hv-rozet hv-sev-${k.seviye}`, text: `${k.ikon} ${k.etiket} · ${seviyeAdi(k.seviye)}` }))))));
    } else {
      haberDurum.textContent = `${il.ad} için son saatlerde giyimi etkileyen doğrulanmış bir uyarı bulunamadı${eski}.`;
    }
    const st = s.istatistik;
    const kaynakMetni = (s.kaynaklar || []).map((k) => `${k.ad} (Tier-${k.tier}) ${k.durum === "ok" ? `✓ ${k.adet}` : k.durum === "bos" ? "– boş" : `✗ ${k.durum}`}`).join(" · ");
    haberAyrinti.replaceChildren(haberOzetEl,
      el("p", { class: "hv-ipucu", text: `Kaynaklar: ${kaynakMetni || "—"}` }),
      el("p", { class: "hv-ipucu", text: `Elenen: ${st.clickbait} clickbait · ${st.zaman} zaman · ${st.konum} konum · ${st.kuralsiz} giyimle ilgisiz (çekilen ${st.cekilen}${st.tier2Kullanildi ? ", Tier-2 devreye girdi" : ""}).` }),
      el("p", { class: "hv-ipucu", text: "Sıra: soru işareti/sansasyonel kalıp → yalnızca bugünü ilgilendirenler → seçili il/bölge anılmalı → giyim kuralına dönüşebilmeli. Hiçbir yapay zekâ çağrısı yoktur (Mod A)." }),
      ...(st.ayrinti.slice(0, 8).map((a) => el("p", { class: "hv-ipucu hv-elendi", text: `✗ ${BARIYER_AD[a.bariyer]}: ${a.baslik.slice(0, 90)} → ${a.neden}` }))));
    haberAyrinti.hidden = false;
  }

  async function haberYenile() {
    const no = ++d.haberNo;
    const il = d.il();
    ilSeciciKur();
    haberDurum.textContent = "Haberler kontrol ediliyor…"; haberListe.replaceChildren(); haberAyrinti.hidden = true;
    let sonuc;
    try { sonuc = await haberTaktigi({ il }); } catch { sonuc = { durum: "ulasilamadi" }; }
    if (no !== d.haberNo) return; // daha yeni bir istek var
    d.haber = sonuc;
    haberCiz(sonuc, il || { ad: "" });
    if (d.hava) degerlendirVeCiz(); // taktik bindirmesi (+ Mod B ise haberId ile stilist)
  }

  /* ------------------------------ stilist (MOD A: yerel kural · MOD B: Groq, Worker üzerinden) ------------------------------ */
  let aiZamanlayici = 0;
  function stilistIste() {
    const s = d.sonuc, h = d.hava;
    const yedek = (etiket = "Mod B seçili ama stilist yanıt vermedi: yerel kural özeti gösteriliyor.") => { aiMetin.textContent = `${s.hukum} Kombin: ${s.gorunenKatmanMetni}.`; aiEtiket.textContent = etiket; };
    clearTimeout(aiZamanlayici);
    // MOD A (varsayılan): hiçbir LLM/Worker isteği yok — yerel kural motoru (çekirdek + haber taktiği)
    if (!d.aiModu) return yedek("Mod A · yerel kural motoru (AI kapalı: hiçbir yapay zekâ isteği yapılmaz).");
    aiMetin.textContent = "Stilist değerlendiriyor…"; aiEtiket.textContent = "";
    aiZamanlayici = setTimeout(async () => {
      // MOD B girdisi: YALNIZCA sayılar + katman kodları + (varsa) filtreden geçmiş temiz başlığın id'si. Ham haber/serbest metin ve konum gitmez.
      const haberId = d.haber?.durum === "ok" ? d.haber.secilen[0]?.id : undefined;
      const govde = { sicaklik: h.apparent, delta: h.delta, yagis: h.rainProb, ruzgar: h.wind, uv: h.uv, senaryo: d.sen, tolerans: d.tol, kodlar: s.kodlar, ...(haberId ? { haberId } : {}) };
      const anahtar = LS.ai + JSON.stringify(govde);
      const k = lsOku(anahtar, null);
      if (k && Date.now() - k.t < 30 * 60 * 1000) { aiMetin.textContent = k.metin; aiEtiket.textContent = "Mod B · Groq (Llama)" + (haberId ? " · haber başlığıyla" : ""); return; }
      try {
        const { data } = await supabase.auth.getSession();
        const jeton = data?.session?.access_token;
        if (!jeton) return yedek();
        const r = await fetch(`${HAVASTIL_WORKER_URL}/stilist`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(govde) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.metin) return yedek();
        aiMetin.textContent = j.metin; aiEtiket.textContent = "Mod B · Groq (Llama)" + (haberId ? " · haber başlığıyla" : "");
        lsYaz(anahtar, { t: Date.now(), metin: j.metin });
        // eski önbellek anahtarlarını temizle (depo şişmesin)
        try { for (const a of Object.keys(localStorage)) if (a.startsWith(LS.ai) && a !== anahtar) { const e = JSON.parse(localStorage.getItem(a) || "null"); if (!e || Date.now() - e.t > 30 * 60 * 1000) localStorage.removeItem(a); } } catch { /* yok say */ }
      } catch { yedek(); }
    }, 700);
  }

  /* ------------------------------ bildirim (bağlamsal izin) ------------------------------ */
  function bildirimCiz() {
    if (!("Notification" in window)) { bildirimBtn.hidden = true; bildirimDurum.textContent = "Bu tarayıcı bildirimleri desteklemiyor."; return; }
    const izin = Notification.permission, acik = lsOku(LS.bildirim, false) === true;
    bildirimBtn.hidden = false;
    if (izin === "denied") { bildirimBtn.hidden = true; bildirimDurum.textContent = "Bildirim izni tarayıcı ayarlarından engellenmiş."; }
    else if (izin === "granted" && acik) { bildirimBtn.textContent = "Uyarıyı kapat"; bildirimDurum.textContent = "Açık: uygulama açıkken/açıldığında sertleşme kontrol edilir (arka plan bildirimi için bkz. teslimat notu)."; }
    else { bildirimBtn.textContent = "Sabah uyarısını aç"; bildirimDurum.textContent = ""; }
  }
  bildirimBtn.addEventListener("click", async () => {
    const acik = lsOku(LS.bildirim, false) === true;
    if (acik && Notification.permission === "granted") { lsYaz(LS.bildirim, false); bildirimCiz(); return; }
    // İzin YALNIZCA bu düğmeye basılınca istenir (sayfa açılışında asla).
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p === "granted") { lsYaz(LS.bildirim, true); await bildirimGoster("HavaStil uyarıları açık", "Hava belirgin sertleşirse haber vereceğim."); }
    bildirimCiz();
  });
  async function bildirimGoster(baslik, govde) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) return void (await reg.showNotification(baslik, { body: govde, icon: "/panel/havastil/ikon-192.png", badge: "/panel/havastil/ikon-192.png", tag: "havastil" }));
    } catch { /* düşer */ }
    try { new Notification(baslik, { body: govde, tag: "havastil" }); } catch { /* yok say */ }
  }
  function bildirimKontrol(h) {
    const onceki = lsOku(LS.snap, null);
    const bugun = h.guncelleme.slice(0, 10);
    if (lsOku(LS.bildirim, false) === true && "Notification" in window && Notification.permission === "granted" && onceki && onceki.gun === bugun && onceki.ad === d.konum.ad) {
      if (h.rainProb - onceki.rainProb >= 30) bildirimGoster("HavaStil: yağış ihtimali arttı", `Yağış riski %${onceki.rainProb} → %${h.rainProb}. Şemsiyeni al.`);
      else if (onceki.apparent - h.apparent >= 5) bildirimGoster("HavaStil: hava soğudu", `Hissedilen ${onceki.apparent}°C → ${h.apparent}°C. Bir kat ekle.`);
    }
    if (!onceki || onceki.gun !== bugun || onceki.ad !== d.konum.ad) lsYaz(LS.snap, { gun: bugun, ad: d.konum.ad, rainProb: h.rainProb, apparent: h.apparent });
  }

  /* ------------------------------ bulut senkronu ------------------------------ */
  bulutKutu.checked = d.bulut;
  async function bulutBaslat() {
    bulutDurum.textContent = "Senkronize ediliyor…";
    try {
      d.kayitli = await birlestir(d.kayitli);
      lsYaz(LS.konumlar, d.kayitli);
      const t = await bulutTercihOku();
      if (t) { d.tol = t.tolerans; d.sen = t.senaryo; lsYaz(LS.tercih, { tol: d.tol, sen: d.sen }); tolKart.replaceWith(tolKartYeni()); senKart.replaceWith(senKartYeni()); }
      else await bulutTercihYaz({ tolerans: d.tol, senaryo: d.sen });
      kayitliCiz(); degerlendirVeCiz();
      bulutDurum.textContent = "Senkron açık.";
    } catch (h) {
      d.bulut = false; bulutKutu.checked = false; lsYaz(LS.bulut, false);
      bulutDurum.textContent = /does not exist|42P01|PGRST205|schema cache/i.test(h?.message || "") ? "Gerekli migration (0099) henüz çalıştırılmamış." : `Senkron başlatılamadı: ${h.message || h}`;
    }
  }
  // Tercih kartlarını (senkron sonrası) taze durumla yeniden kur
  function tolKartYeni() { return segGrup("Kişisel sıcaklık algın", Object.entries(TOLERANSLAR).map(([k, v]) => [Number(k), v]), () => d.tol, (v) => { d.tol = v; tercihKaydet(); degerlendirVeCiz(); }); }
  function senKartYeni() { const k = segGrup("Günün planı", Object.entries(SENARYOLAR).map(([k2, v]) => [k2, v.ad]), () => d.sen, (v) => { d.sen = v; tercihKaydet(); degerlendirVeCiz(); }); k.append(senIpucu); return k; }

  bulutKutu.addEventListener("change", async () => {
    if (bulutKutu.checked) { d.bulut = true; lsYaz(LS.bulut, true); await bulutBaslat(); return; }
    d.bulut = false; lsYaz(LS.bulut, false);
    d.kayitli = d.kayitli.map(({ bid, ...r }) => r); lsYaz(LS.konumlar, d.kayitli);
    bulutDurum.textContent = "";
    if (window.confirm("Hesabında saklanan HavaStil konumları ve tercihleri de silinsin mi? (Bu cihazdakiler kalır.)")) {
      try { await bulutTumunuSil(); bulutDurum.textContent = "Bulut verisi silindi."; } catch (h) { bulutDurum.textContent = `Silinemedi: ${h.message || h}`; }
    } else bulutDurum.textContent = "Senkron kapatıldı; bulut verisi hesabında duruyor.";
  });

  aiKutu.checked = d.aiModu;
  aiKutu.addEventListener("change", () => { d.aiModu = aiKutu.checked; lsYaz(LS.aiModu, d.aiModu); if (d.sonuc) stilistIste(); });

  /* ------------------------------ başlat ------------------------------ */
  ilSeciciKur();
  bildirimCiz();
  kayitliCiz();
  senIpucu.textContent = SENARYOLAR[d.sen].ipucu;
  if (d.bulut) bulutBaslat();
  await yenile();
  // Açık kalan sekmede 30 dk'da bir tazele (önbellek omrüyle aynı)
  const aralik = setInterval(() => { if (!kok.isConnected) return clearInterval(aralik); if (!document.hidden) yenile(); }, 30 * 60 * 1000);
  // Uygulamaya geri dönülünce tazele (havaGetir 30 dk önbellek kullanır → gereksiz ağ isteği olmaz)
  const gorunur = async () => { if (!kok.isConnected) return document.removeEventListener("visibilitychange", gorunur); if (!document.hidden && d.hava) { await gec(200); yenile(); } };
  document.addEventListener("visibilitychange", gorunur);
}
