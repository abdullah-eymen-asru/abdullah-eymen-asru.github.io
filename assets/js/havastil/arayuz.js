/**
 * arayuz.js — HavaStil kabuğu (panel sekmesi VE bağımsız PWA sayfası aynı kodu kullanır).
 * v4 sekmeler: Bugün (sade, 3 saniye kuralı) · Kombin (tek yer: katmanlar, tetikleyiciler, çanta, plan) · Saatlik plan (7-14 gün, 24 saat) · Derin analiz (uzman, gün seçicili) · 14 gün · Uyarılar · Veri doğrulama (herkese açık şeffaflık laboratuvarı) · Ayarlar.
 * VİTRİN MODU (demo / misafir): konum her zaman İstanbul, "Konumu kaydet/düzenle" pasif, Mod B (Groq Worker) ve haber Worker'ı HİÇ çağrılmaz — yalnızca ücretsiz kural tabanlı (Mod A) cümle.
 * Akış: havaGetir (Open-Meteo, tarayıcıdan) → haberTaktigi (havuz, kısıtlar) → yagisMotoru (PoP × hacim, showers, CAPE, hamle)
 *       → degerlendir (CLO motoru, kısıtlarla) → krizAniBul (gün içi çelişki anı) → ekran.
 * Karar HER ZAMAN yerel motordan çıkar; yapay zekâ (isteğe bağlı) yalnızca "gün içi kritik an" için 2 cümlelik yorum ekler.
 */
import { supabase } from "../core/supabase-client.js";
import { degerlendir, SENARYOLAR, STIL_SECENEKLERI, CANTA_SECENEKLERI } from "./cekirdek.js";
import { havaGetir } from "./veri.js";
import { HAVASTIL_WORKER_URL, haberTaktigi } from "./haber.js";
import { KURALLAR } from "./taktik.js";
import { havaKodu } from "./hava-kodlari.js";
import { el, lsOku, lsYaz, olay, gec } from "./ui-temel.js";
import { konumBileseni } from "./ui-konum.js";
import { yagisMotoru, krizAniBul, krizSatiri } from "./yagis-fizigi.js";
import { bugunSekmesi } from "./ui-sade.js";
import { derinSekmesi } from "./ui-uzman.js";
import { kombinSekmesi } from "./ui-kombin.js";
import { gunlukSekmesi } from "./ui-hava.js";
import { planSekmesi } from "./ui-plan.js";
import { dogrulaSekmesi } from "./ui-lab.js";
import { demoModuAktifMi } from "../demo/demo-durum.js";
import { haberSekmesi } from "./ui-haber.js";
import { ayarSekmesi } from "./ui-ayar.js";
import { zamanlayiciBaslat } from "./bildirim.js";
import * as K from "./konumlar.js";
import { birlestir, bulutKonumEkle, bulutKonumGuncelle, bulutKonumSil, bulutTumunuSil, bulutTercihOku, bulutTercihYaz } from "./bulut.js";

export { HAVASTIL_WORKER_URL };
const VARSAYILAN_KONUM = { id: "41.008,28.978", ad: "İstanbul", lat: 41.008, lon: 28.978, ulke: "TR", ulkeAd: "Türkiye", ulkeAdEn: "Turkey", admin1: "İstanbul", il: "İstanbul", ikon: "diger" };
const LS = { tercih: "hv_tercih2", eskiTercih: "hv_tercih", bulut: "hv_bulut", aiModu: "hv_ai_modu", haberAcik: "hv_haber_acik", sekme: "hv_sekme", ai: "hv_ai3_" };
const SEKMELER = [["bugun", "Bugün", "🏠"], ["kombin", "Kombin", "🧥"], ["plan", "Saatlik plan", "🗓️"], ["derin", "Derin analiz", "🔬"], ["gunluk", "14 gün", "📅"], ["haber", "Uyarılar", "🛰️"], ["dogrula", "Veri doğrulama", "🔍"], ["ayar", "Ayarlar", "⚙️"]];
const ESKI_SEKME = { ozet: "bugun", saatlik: "derin" };      // v2'de kaydedilmiş sekme adları
const HAVA_TTL_MS = 30 * 60 * 1000, HABER_TTL_MS = 15 * 60 * 1000;

function tercihOku() {
  const t = lsOku(LS.tercih, null) || (() => { const e = lsOku(LS.eskiTercih, null); return e ? { tol: e.tol, sen: e.sen } : null; })() || {};
  return { tol: [-3, 0, 3].includes(t.tol) ? t.tol : 0, sen: SENARYOLAR[t.sen] ? t.sen : "toplu", canta: CANTA_SECENEKLERI[t.canta] ? t.canta : "el", stil: STIL_SECENEKLERI[t.stil] ? t.stil : "auto", tohumKaydir: 0 };
}

export async function havastilKur(kok, { bagimsiz = false, vitrin = demoModuAktifMi() } = {}) {
  const kayitliSekme = ESKI_SEKME[lsOku(LS.sekme, "bugun")] || lsOku(LS.sekme, "bugun");
  const d = {
    vitrin: !!vitrin,
    konum: vitrin ? { ...VARSAYILAN_KONUM } : K.aktifOku(VARSAYILAN_KONUM), konumlar: vitrin ? [] : K.listeyiOku(), tercih: tercihOku(),
    aiModu: vitrin ? false : lsOku(LS.aiModu, false) === true, ai: { metin: "", etiket: "", hata: "" }, bulut: vitrin ? false : lsOku(LS.bulut, false) === true,
    haberAcik: vitrin ? false : lsOku(LS.haberAcik, true) !== false, hava: null, sonuc: null, haber: null, kombinNo: 0, planGun: 0, planSaat: null,
    sekme: SEKMELER.some(([id]) => id === kayitliSekme) ? kayitliSekme : "bugun",
    fizik: null, kriz: null, planAcik: false, derinGun: 0,
    yenilemeNo: 0, haberNo: 0,
  };
  const kb = {};

  /* ---------------- iskelet ---------------- */
  const sekmeBar = el("nav", { class: "hv-sekmeler", role: "tablist", "aria-label": "HavaStil bölümleri" });
  const icerik = el("div", { class: "hv-icerik", role: "tabpanel", tabindex: "-1" });
  const konumB = konumBileseni(d, kb);
  kok.classList.add("hv");
  const vitrinBandi = vitrin ? el("div", { class: "hv-vitrin-bandi", role: "note" }, el("strong", { text: "🎭 Vitrin modu · İstanbul" }),
    el("span", { text: " Tüm görsel özellikler, kombin kartları, saatlik plan ve veri doğrulama açık. Konum kaydetme ve yapay zekâ yorumu (Mod B) kapalıdır; ücretsiz kural tabanlı stilist (Mod A) çalışır." })) : null;
  kok.replaceChildren(...[vitrinBandi, konumB.kok, sekmeBar, icerik].filter(Boolean));

  /* ---------------- çizim ---------------- */
  function sekmeBarCiz() {
    const rozetSay = d.haber?.uygulananlar?.length || 0;
    sekmeBar.replaceChildren(...SEKMELER.map(([id, ad, ikon]) => {
      const b = el("button", { type: "button", class: "hv-sekme", role: "tab", "aria-selected": String(d.sekme === id), id: `hv-sekme-${id}` },
        el("span", { class: "hv-sekme-ikon", "aria-hidden": "true", text: ikon }), el("span", { text: ad }), id === "haber" && rozetSay ? el("span", { class: "hv-sekme-sayac", text: String(rozetSay) }) : null);
      return olay(b, "click", () => kb.sekmeGit(id));
    }));
  }
  const CIZICI = { bugun: bugunSekmesi, kombin: kombinSekmesi, plan: planSekmesi, derin: derinSekmesi, gunluk: gunlukSekmesi, haber: haberSekmesi, dogrula: dogrulaSekmesi, ayar: ayarSekmesi };
  function ciz() {
    sekmeBarCiz();
    try { icerik.replaceChildren(CIZICI[d.sekme](d, kb)); }
    catch (h) { console.warn("HavaStil çizim hatası:", h); icerik.replaceChildren(el("p", { class: "hv-uyari", text: "Bu bölüm çizilemedi. Sayfayı yenile; sürerse Ayarlar › Teşhis'e bak." })); }
  }
  kb.ciz = ciz;
  kb.sekmeGit = (id) => { d.sekme = id; lsYaz(LS.sekme, id); ciz(); icerik.scrollIntoView?.({ block: "nearest" }); };

  /* ---------------- hesap ---------------- */
  function hesapla() {
    if (!d.hava) return;
    const ek = d.haberAcik && d.haber?.durum === "ok" ? d.haber.kisitlar : {};
    d.fizik = yagisMotoru(d.hava.yagisPencere, { gun: d.hava.gun, canta: d.tercih.canta });
    d.sonuc = degerlendir(d.hava, { tolerans: d.tercih.tol, senaryo: d.tercih.sen, stil: d.tercih.stil, canta: d.tercih.canta, tohumKaydir: d.tercih.tohumKaydir }, { ...ek, fizik: d.fizik });
    d.kriz = krizAniBul(d.hava.yagisPencere, { senaryo: d.tercih.sen });
    if (d.kombinNo >= d.sonuc.kombinler.length) d.kombinNo = 0;
    kb.aiYorumIste(false);
  }
  kb.tercihDegis = (patch) => {
    d.tercih = { ...d.tercih, ...patch };
    if (!("tohumKaydir" in patch)) d.tercih.tohumKaydir = 0;
    d.kombinNo = 0;
    const { tohumKaydir, ...kalici } = d.tercih; lsYaz(LS.tercih, kalici);
    if (d.bulut && !d.vitrin) bulutTercihYaz({ tolerans: d.tercih.tol, senaryo: d.tercih.sen, stil: d.tercih.stil, canta: d.tercih.canta }).catch(() => {});
    hesapla(); ciz();
  };

  /* ---------------- hava / haber yenileme ---------------- */
  kb.yenile = async (zorla = false) => {
    const no = ++d.yenilemeNo;
    try {
      const h = await havaGetir(d.konum.lat, d.konum.lon, { yenile: zorla });
      if (no !== d.yenilemeNo) return;
      d.hava = h; hesapla(); ciz(); konumB.ciz();
      if (!d.haber || zorla) kb.haberYenile(false);
    } catch {
      if (no !== d.yenilemeNo) return;
      icerik.replaceChildren(el("p", { class: "hv-uyari", text: "Hava verisi alınamadı ve kayıtlı veri yok. Bağlantını kontrol edip ↻ ile tekrar dene." }));
    }
  };
  kb.haberYenile = async (zorla = false) => {
    if (d.vitrin) { d.haber = { durum: "vitrin", uyarilar: [], uygulananlar: [], kisitlar: { kurallar: {} }, guncelleme: Date.now(), havuz: "yok" }; hesapla(); ciz(); return; }   // Worker'a HİÇ istek gitmez
    if (!d.haberAcik) { d.haber = null; hesapla(); ciz(); return; }
    const no = ++d.haberNo;
    let h;
    try { h = await haberTaktigi({ konum: d.konum, hava: d.hava, zorla }); } catch { h = { durum: "ulasilamadi", uyarilar: [], uygulananlar: [], kisitlar: { kurallar: {} } }; }
    if (no !== d.haberNo) return;
    d.haber = h; hesapla(); ciz();
  };
  kb.haberAcikDegis = (v) => { d.haberAcik = v; lsYaz(LS.haberAcik, v); d.haber = null; if (v) kb.haberYenile(true); else { hesapla(); ciz(); } };
  kb.kuralKisa = (id) => KURALLAR.find((k) => k.id === id)?.kisa || "";

  /* ---------------- konum işlemleri ---------------- */
  kb.sec = (k) => {
    d.konum = { ...K.temizle(k), ...(k.gps ? { gps: true } : {}) };
    d.kombinNo = 0; d.haber = null;
    if (!d.vitrin) K.aktifYaz(d.konum);               // vitrinde seçim kalıcı değildir: yenilemede yine İstanbul
    konumB.ciz(); kb.yenile(false);
  };
  async function bulutYaz(fn) { if (d.bulut && !d.vitrin) { try { return await fn(); } catch { /* sessiz */ } } return undefined; }
  kb.kaydetDegistir = async (k) => {
    if (d.vitrin) return;                               // vitrin: "Konumu kaydet" pasif
    const id = K.konumKimligi(k);
    if (K.kayitliMi(d.konumlar, k)) { const m = d.konumlar.find((x) => x.id === id || (x.ad === k.ad && K.ayniKonum(x, k))); if (m?.bid) await bulutYaz(() => bulutKonumSil(m.bid)); d.konumlar = K.sil(d.konumlar, m?.id || id); }
    else {
      if (d.konumlar.length >= 20) return;
      const yeni = { ...k, ad: k.ad === "Bulunduğum yer" ? "Konumum" : k.ad };
      d.konumlar = K.ekle(d.konumlar, yeni);
      const kayit = d.konumlar.find((x) => x.id === id);
      const bid = kayit && (await bulutYaz(() => bulutKonumEkle(kayit)));
      if (bid) d.konumlar = K.guncelle(d.konumlar, id, { bid });
    }
    K.listeyiYaz(d.konumlar); konumB.ciz();
  };
  /** Düzenle: isim/etiket, simge ve (yeni arama seçildiyse) koordinat + yer alanları. Bulutta UPDATE (satır kimliği bid ile). */
  kb.guncelle = async (id, alanlar) => {
    if (d.vitrin) return;
    const eski = d.konumlar.find((x) => x.id === id);
    if (!eski) return;
    const koordDegisti = (Number.isFinite(alanlar.lat) && alanlar.lat !== eski.lat) || (Number.isFinite(alanlar.lon) && alanlar.lon !== eski.lon);
    d.konumlar = K.guncelle(d.konumlar, id, alanlar);
    const yeniId = K.konumKimligi({ lat: alanlar.lat ?? eski.lat, lon: alanlar.lon ?? eski.lon });
    const yeni = d.konumlar.find((x) => x.id === yeniId);
    if (yeni && d.bulut) {
      if (yeni.bid) await bulutYaz(() => bulutKonumGuncelle(yeni.bid, yeni));
      else { const bid = await bulutYaz(() => bulutKonumEkle(yeni)); if (bid) d.konumlar = K.guncelle(d.konumlar, yeniId, { bid }); }
    }
    if (K.konumKimligi(d.konum) === id && yeni) {
      d.konum = { ...K.temizle(yeni), ...(d.konum.gps ? { gps: true } : {}) }; K.aktifYaz(d.konum);
      if (koordDegisti) { d.haber = null; d.kombinNo = 0; kb.yenile(true); }
    }
    K.listeyiYaz(d.konumlar); konumB.ciz(); ciz();
  };
  kb.sil = async (id) => { if (d.vitrin) return; const m = d.konumlar.find((x) => x.id === id); if (m?.bid) await bulutYaz(() => bulutKonumSil(m.bid)); d.konumlar = K.sil(d.konumlar, id); K.listeyiYaz(d.konumlar); konumB.ciz(); };
  kb.ilkeAl = (id) => { if (d.vitrin) return; d.konumlar = K.varsayilanYap(d.konumlar, id); K.listeyiYaz(d.konumlar); konumB.ciz(); };

  /* ---------------- gün içi kritik an: Mod A (yerel, deterministik) · Mod B (Groq, yalnızca sayılar) ---------------- */
  let aiZaman = 0;
  kb.aiModu = (v) => { if (d.vitrin) return; d.aiModu = v; lsYaz(LS.aiModu, v); d.ai = { metin: "", etiket: "", hata: "" }; kb.aiYorumIste(true); ciz(); };
  kb.aiYorumIste = (zorla = false) => {
    const s = d.sonuc, h = d.hava, k = d.kriz, f = d.fizik;
    if (!s || !h || !k || !f) return;
    const p = s.kombinler[Math.min(d.kombinNo, s.kombinler.length - 1)].parcalar;
    const yerel = (etiket, hata = "") => { d.ai = { metin: krizSatiri(k, p), etiket, hata }; kb.aiYenileEkran?.(); };
    clearTimeout(aiZaman);
    if (d.vitrin) return yerel("Vitrin modu · ücretsiz kural tabanlı stilist (Mod A). Yapay zekâ (Mod B) bu hesapta kilitli; Worker ve Groq kotasına istek gitmez.");
    if (!d.aiModu) return yerel("Yerel kural motoru · yapay zekâ kapalı, hiçbir yapay zekâ isteği yapılmaz.");
    if (!k.var) return yerel("Gün içinde kritik an yok; yapay zekâya sorulmadı.");
    d.ai = { ...d.ai, etiket: "Yapay zekâ kritik anı yorumluyor…", hata: "" }; kb.aiYenileEkran?.();
    aiZaman = setTimeout(async () => {
      const haberId = d.haberAcik && d.haber?.durum === "ok" ? d.haber.uygulananlar[0]?.id : undefined;
      // YALNIZCA sayılar, sabit kelimeler (enum) ve katalog id'leri gider; serbest metin, konum ve kimlik gitmez.
      const govde = {
        v: 3, sicaklik: h.apparent, delta: h.delta, hamle: f.hamleMax, cape: f.capeMax, yagisSeviye: f.seviye, yagisTur: f.tur, beklenenMm: Math.round(f.beklenenMm * 10) / 10, pop: f.enYuksekPop, uv: h.uv,
        senaryo: d.tercih.sen, tolerans: d.tercih.tol, canta: d.tercih.canta,
        kodlar: { b: p.b?.id ?? null, m: p.m?.id ?? null, o: p.o?.id ?? null, p: p.p?.id ?? null, a: p.a?.id ?? null },
        bayraklar: { semsiyeYasak: f.semsiyeYasak, zararsiz: f.zararsiz, surpriz: f.surpriz },
        kriz: { saat: k.saat, tur: k.tur, sicaklikOnce: k.sicaklikOnce, sicaklikSonra: k.sicaklikSonra, hamle: k.hamle, mm: k.mm, cape: k.cape },
        ...(haberId ? { haberId } : {}),
      };
      const anahtar = LS.ai + JSON.stringify(govde);
      const onbellek = lsOku(anahtar, null);
      if (!zorla && onbellek && Date.now() - onbellek.t < 30 * 60 * 1000) { d.ai = { metin: onbellek.metin, etiket: `Yapay zekâ yorumu${haberId ? " · haber başlığıyla" : ""}`, hata: "" }; kb.aiYenileEkran?.(); return; }
      try {
        const { data } = await supabase.auth.getSession();
        const jeton = data?.session?.access_token;
        if (!jeton) return yerel("Yapay zekâ yorumu alınamadı: oturum bulunamadı.", "Oturum bulunamadı; yeniden giriş yap.");
        const r = await fetch(`${HAVASTIL_WORKER_URL}/stilist`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(govde) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.metin) {
          const neden = r.status === 503 ? "Yapay zekâ servisi kapalı (Worker anahtarı)." : j.ipucu || j.error || `Sunucu yanıtı: ${r.status}`;
          return yerel("Yapay zekâ yorumu alınamadı; yerel özet gösteriliyor.", `${neden} Ayrıntı için Ayarlar › Yapay zekâ › “Bağlantıyı test et”.`);
        }
        d.ai = { metin: j.metin, etiket: `Yapay zekâ yorumu (${j.model || "Groq"})${haberId ? " · haber başlığıyla" : ""}`, hata: "" };
        lsYaz(anahtar, { t: Date.now(), metin: j.metin });
        try { for (const a of Object.keys(localStorage)) if (a.startsWith(LS.ai) && a !== anahtar) { const e = JSON.parse(localStorage.getItem(a) || "null"); if (!e || Date.now() - e.t > 30 * 60 * 1000) localStorage.removeItem(a); } } catch { /* yok say */ }
        kb.aiYenileEkran?.();
      } catch { yerel("Yapay zekâ yorumu alınamadı (ağ).", "Worker'a ulaşılamadı. Ayarlar › Bağlantıyı test et."); }
    }, 600);
  };
  kb.tani = async () => {
    if (d.vitrin) return { hata: "Vitrin modunda Worker bağlantı testi kapalıdır." };
    try {
      const { data } = await supabase.auth.getSession();
      const jeton = data?.session?.access_token;
      if (!jeton) return { hata: "Oturum bulunamadı." };
      const kontrol = new AbortController(); const z = setTimeout(() => kontrol.abort(), 30000);
      let r; try { r = await fetch(`${HAVASTIL_WORKER_URL}/tani`, { headers: { Authorization: `Bearer ${jeton}` }, signal: kontrol.signal }); } finally { clearTimeout(z); }
      if (r.status === 503) return { hata: "Worker kapalı (Yedekleme & Verilerim › Worker anahtarları'ndan açabilirsin)." };
      if (r.status === 404) return { hata: "Worker'da /tani yok: Worker kodu eski sürümde. Yeni worker.js'i deploy et." };
      const j = await r.json();
      return j.adimlar ? j : { hata: j.error || `Beklenmeyen yanıt (${r.status}).` };
    } catch (h) { return { hata: h?.name === "AbortError" ? "Test zaman aşımına uğradı." : "Worker'a ulaşılamadı (adres/ağ/CORS). Worker adresi: " + HAVASTIL_WORKER_URL }; }
  };

  /* ---------------- bulut senkronu ---------------- */
  kb.bulutDegis = async (ac) => {
    if (d.vitrin) return "Vitrin modunda hesap senkronu kapalıdır.";
    if (ac) {
      d.bulut = true; lsYaz(LS.bulut, true);
      try {
        d.konumlar = await birlestir(d.konumlar); K.listeyiYaz(d.konumlar);
        const t = await bulutTercihOku();
        if (t) { d.tercih = { ...d.tercih, tol: t.tolerans, sen: SENARYOLAR[t.senaryo] ? t.senaryo : d.tercih.sen, stil: STIL_SECENEKLERI[t.stil] ? t.stil : d.tercih.stil, canta: CANTA_SECENEKLERI[t.canta] ? t.canta : d.tercih.canta }; const { tohumKaydir, ...kalici } = d.tercih; lsYaz(LS.tercih, kalici); }
        else await bulutTercihYaz({ tolerans: d.tercih.tol, senaryo: d.tercih.sen, stil: d.tercih.stil, canta: d.tercih.canta });
        hesapla(); konumB.ciz(); ciz();
        return "Senkron açık.";
      } catch (h) {
        d.bulut = false; lsYaz(LS.bulut, false);
        return /does not exist|42P01|PGRST|schema cache|column/i.test(h?.message || "") ? "Gerekli migration (0099 ve 0100) henüz çalıştırılmamış." : `Senkron başlatılamadı: ${h.message || h}`;
      }
    }
    d.bulut = false; lsYaz(LS.bulut, false);
    d.konumlar = d.konumlar.map(({ bid, ...r }) => r); K.listeyiYaz(d.konumlar);
    if (window.confirm("Hesabında saklanan HavaStil konumları ve tercihleri de silinsin mi? (Bu cihazdakiler kalır.)")) {
      try { await bulutTumunuSil(); return "Bulut verisi silindi."; } catch (h) { return `Silinemedi: ${h.message || h}`; }
    }
    return "Senkron kapatıldı; bulut verisi hesabında duruyor.";
  };

  /* ---------------- saat bazlı uyarılar ---------------- */
  const uyariDurdur = zamanlayiciBaslat(() => {
    const s = d.sonuc, h = d.hava;
    if (!s || !h) return null;
    const k = s.kisitlar;
    const uyariVar = k.yagis >= 1 || k.buz || k.kar || k.ruzgar >= 2 || k.sicakAsiri || k.col || !!d.haber?.uygulananlar?.length;
    const ek = s.ekstralar.filter((x) => x.oncelik === "sart").slice(0, 2).map((x) => x.ad);
    return { baslik: `${d.konum.ad}: ${h.apparent}° · ${havaKodu(h.kod, h.isDay).ad}`, govde: `${s.hukum} ${s.ozet}.${ek.length ? ` Al: ${ek.join(", ")}.` : ""}`, uyariVar };
  });

  /* ---------------- zamanlayıcılar ---------------- */
  const tazele = async () => {
    if (!kok.isConnected) { clearInterval(aralik); document.removeEventListener("visibilitychange", gorunur); uyariDurdur(); return; }
    if (document.hidden) return;
    if (!d.hava || Date.now() - (d.hava.alinma || 0) > HAVA_TTL_MS) await kb.yenile(false);
    if (d.haberAcik && (!d.haber || Date.now() - (d.haber.guncelleme || 0) > HABER_TTL_MS)) kb.haberYenile(false);
  };
  const aralik = setInterval(tazele, 5 * 60 * 1000);
  const gorunur = async () => { if (!document.hidden) { await gec(300); tazele(); } };
  document.addEventListener("visibilitychange", gorunur);

  /* ---------------- başlat ---------------- */
  ciz();
  if (d.bulut && !d.vitrin) kb.bulutDegis(true).catch(() => {});
  await kb.yenile(false);
}
