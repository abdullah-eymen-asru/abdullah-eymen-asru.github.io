/**
 * ui-plan.js — "Saatlik plan" sekmesi (v5): gelecekteki herhangi bir günü (bugünden itibaren 16 güne kadar; Open-Meteo deterministik sınırı) SAAT SAAT planla.
 *   • v6 GÜN SEÇİCİ: 16 gün tek ızgarada (kaydırma yok), ‹ › okları, klavye okları, Bugün/+7/Son gün (ui-gun-secici.js). Eski yatay şerit + mini takvim kaldırıldı.
 *   • Seçilen günün 24 saati: Sıcaklık, Hissedilen, Rüzgâr yönü/hızı, Yağış (mm), PoP (%) ve Kıyafet önerisi (katman ikonu).
 *   • Bir saate dokununca kombin tavsiyesi dinamik güncellenir (ör. "14:00 - Tişört yeterli", "20:00 - Sıcaklık 7°C düşüyor, kaban şart").
 * Hesap: kıyafet katmanı, Kombin sekmesiyle AYNI CLO motorundan (cekirdek.js › hedefClo) ve aynı yağış fiziğinden (yagis-fizigi.js › saatAnaliz) gelir;
 * burada yeni bir model yoktur — yalnızca her saat için aynı formül yeniden uygulanır.
 */
import { el, kart, ipucu, bolumBasligi, olay, rozet } from "./ui-temel.js";
import { havaKodu, ruzgarYonu, gunAdi } from "./hava-kodlari.js";
import { hedefClo } from "./cekirdek.js";
import { saatAnaliz, efektifSiddet } from "./yagis-fizigi.js";
import { gunIzgarasi } from "./ui-gun-secici.js";

const pad = (s) => String(s).padStart(2, "0");
const gunEtiketi = (tarih, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(tarih));
const KATMANLAR = [
  { ust: 0.5, ikon: "👕", ad: "Tişört yeterli", kisa: "tişört" },
  { ust: 0.7, ikon: "👔", ad: "İnce uzun kollu / gömlek", kisa: "ince uzun kollu" },
  { ust: 0.95, ikon: "🧶", ad: "Hırka veya hafif ceket", kisa: "hırka/hafif ceket" },
  { ust: 1.25, ikon: "🧥", ad: "Ceket + ara kat", kisa: "ceket" },
  { ust: 1.6, ikon: "🧥", ad: "Mont / kaban", kisa: "kaban" },
  { ust: Infinity, ikon: "🧣", ad: "Kalın mont, bere, eldiven", kisa: "kalın mont" },
];

/** Tek saat için kıyafet katmanı: CLO (hedefClo) → katman bandı + yağış/güneş eki. */
export function katman(x, tercih) {
  const a = saatAnaliz(x);
  a.karZorunluSaat = (a.karli && a.karCm >= 0.1) || a.buz.seviye >= 2;
  const clo = hedefClo({ apparent: x.app, raw: x.temp, precip: x.yagis, hum: x.nem }, tercih.tol, tercih.sen).clo;
  const bant = KATMANLAR.find((b) => clo < b.ust);
  const ek = [];
  if (a.firtina) ek.push("☔✖ kapüşonlu teknik kabuk (şemsiye değil)");
  else if (a.karZorunluSaat) ek.push("☔✖ şemsiye iptal");
  if (a.karli && a.karCm >= 0.1) ek.push(`❄️ ${a.karCm} cm taze kar: derin kauçuk dişli kar botu, termal içlik, polar/yün, bere + eldiven`);
  else if (a.buz.seviye >= 2) ek.push(`🧊 gizli buzlanma (yüzey ${a.buz.yuzey}°): derin kauçuk dişli bot, bere + eldiven`);
  if (a.firtina || a.karZorunluSaat) { /* yukarıda */ } else if (a.seviye >= 3) ek.push("🧥 yağmurluk + su geçirmez bot");
  else if (a.seviye === 2) ek.push("☂️ yağmurluk/şemsiye");
  else if (a.seviye === 1 && !a.zararsiz) ek.push("🌦️ hafif kabuk");
  if (x.gunduz && x.uv >= 6) ek.push("🧴 güneş koruması");
  return { clo, ...bant, ek, analiz: a };
}

/** Seçili saat için dinamik tavsiye cümlesi (yalnızca verideki sayılarla; uydurma yok). */
export function saatTavsiyesi(liste, i, tercih) {
  const x = liste[i], k = katman(x, tercih), S = `${pad(x.saat)}:00`;
  let metin = `${S} - ${k.ad}`;
  let ton = "sakin";
  const ileri = liste.slice(i + 1, i + 7);
  let dus = null, isin = null;
  for (const y of ileri) {
    const fark = x.app - y.app;
    if (fark >= 4 && (!dus || fark > dus.fark)) dus = { y, fark };
    if (-fark >= 5 && (!isin || -fark > isin.fark)) isin = { y, fark: -fark };
  }
  if (dus) { const ky = katman(dus.y, tercih); metin = `${S} - Sıcaklık ${Math.round(dus.fark)}°C düşüyor (${pad(dus.y.saat)}:00'de ${dus.y.app}°), ${ky.kisa} şart`; ton = "dikkat"; }
  else if (isin) metin = `${S} - ${k.ad}; ${pad(isin.y.saat)}:00'e doğru ${Math.round(isin.fark)}°C ısınıyor, üstten bir kat çıkarabilirsin`;
  const a = k.analiz;
  if (a.karli && a.karCm >= 0.1) { metin += `. ❄️ Saatte ${a.karCm} cm taze kar (SLR 1:${a.slr}): şemsiyeyi bırak; derin kauçuk dişli kar botu, termal içlik, polar/yün ara kat, bere ve eldiven şart`; ton = "dikkat"; }
  else if (a.buz.seviye >= 2) { metin += `. 🧊 Zemin yüzeyi ${a.buz.yuzey}°C: gizli buzlanma, kauçuk dişli bot ve kısa adım`; ton = "dikkat"; }
  else if (a.firtina) { metin += `. Rüzgâr hamlesi ${Math.round(a.hamle)} km/s / CAPE ${Math.round(a.cape)} J/kg: şemsiye yerine kapüşonlu teknik kabuk`; ton = "tehlike"; }
  else if (a.seviye >= 2) { metin += `. Yağış var (${x.yagis.toFixed(1)} mm): yağmurluk veya şemsiye al`; ton = ton === "sakin" ? "dikkat" : ton; }
  else {
    const baslayan = ileri.slice(0, 3).find((y) => saatAnaliz(y).seviye >= 2);
    if (baslayan && a.seviye < 2) { metin += `. ${pad(baslayan.saat)}:00 civarında yağış başlıyor: yağmurluk hazırla`; ton = ton === "sakin" ? "dikkat" : ton; }
  }
  return { metin: `${metin}.`, ikon: k.ikon, ton };
}

export function planSekmesi(d, kb) {
  const h = d.hava;
  if (!h?.tumSaatler?.length) return kart("hv-bos", ipucu("Saatlik veri yükleniyor…"));
  const gruplar = new Map();
  for (const x of h.tumSaatler) { const t = x.t.slice(0, 10); if (!gruplar.has(t)) gruplar.set(t, []); gruplar.get(t).push(x); }
  const gunler = [...gruplar].map(([tarih, saatler]) => ({ tarih, saatler }));
  const gi = Math.min(d.planGun || 0, gunler.length - 1), G = gunler[gi], simdiT = h.saatListe?.[0]?.t;

  const secici = gunIzgarasi({
    gunler: gunler.map((g, i) => {
      const mn = Math.min(...g.saatler.map((x) => x.app)), mx = Math.max(...g.saatler.map((x) => x.app));
      const analizler = g.saatler.map((x) => saatAnaliz(x)), yagmur = analizler.some((a) => a.seviye >= 2 && !a.karli), karGun = analizler.some((a) => a.karli && a.karCm >= 0.1), buzGun = analizler.some((a) => a.buz.seviye >= 2);
      const isaret = karGun ? "❄️" : buzGun ? "🧊" : yagmur ? "🌧️" : "";
      return { tarih: g.tarih, alt: `${mn}°/${mx}°${isaret ? ` ${isaret}` : ""}`, baslik: `${gunEtiketi(g.tarih, i)} ${g.tarih.slice(8, 10)}.${g.tarih.slice(5, 7)}: ${mn}° – ${mx}° hissedilen${isaret ? ` ${isaret}` : ""}` };
    }),
    aktif: gi, etiket: "Planlanacak gün", onSec: (i) => { d.planGun = i; d.planSaat = null; kb.ciz(); },
  });
  const mevsimeGit = olay(el("button", { type: "button", class: "hv-baglanti", text: "16 günden sonrası için → Mevsimlik eğilim" }), "click", () => {
    const son = gunler[gunler.length - 1].tarih, t = new Date(Date.UTC(Number(son.slice(0, 4)), Number(son.slice(5, 7)) - 1 + 1, 1));
    d.mevsimAy = { y: t.getUTCFullYear(), m: t.getUTCMonth() }; kb.sekmeGit("mevsim");
  });

  // Gün özeti
  const app = G.saatler.map((x) => x.app), mm = G.saatler.reduce((t, x) => t + x.yagis, 0), E = G.saatler.reduce((t, x) => t + saatAnaliz(x).E, 0);
  const popMax = Math.max(...G.saatler.map((x) => x.yagisOlasi)), sid = efektifSiddet(E);
  const karCmGun = Math.round(G.saatler.reduce((s, x) => { const a = saatAnaliz(x); return s + (a.karli ? a.karCm : 0); }, 0) * 10) / 10;
  const ozet = el("div", { class: "hv-plan-ozet" },
    el("span", {}, el("small", { text: "Hissedilen" }), el("strong", { text: `${Math.min(...app)}° – ${Math.max(...app)}°` })),
    el("span", {}, el("small", { text: karCmGun > 0 ? "Taze kar" : "Toplam yağış" }), el("strong", { text: karCmGun > 0 ? `❄️ ${karCmGun} cm` : `${mm.toFixed(1)} mm` })),
    el("span", {}, el("small", { text: "En yüksek PoP" }), el("strong", { text: `%${popMax}` })),
    el("span", {}, el("small", { text: "Efektif yağış" }), el("strong", { text: `${E.toFixed(1)} mm` }), el("em", { class: `hv-siddet ${sid.sinif}`, text: sid.ad })));

  // Seçili saat: öntanımlı = bugünse şimdi, değilse 09:00 (planlama için en kullanışlı ilk saat)
  const varsayilan = gi === 0 ? G.saatler.findIndex((x) => x.t === simdiT) : G.saatler.findIndex((x) => x.saat === 9);
  let secili = d.planSaat ? G.saatler.findIndex((x) => x.t === d.planSaat) : -1;
  if (secili < 0) secili = Math.max(0, varsayilan);

  const tavsiyeMetin = el("p", { class: "hv-plan-tavsiye-metin" });
  const tavsiyeIkon = el("span", { class: "hv-plan-tavsiye-ikon", "aria-hidden": "true" });
  const tavsiye = el("div", { class: "hv-plan-tavsiye", role: "status", "aria-live": "polite" }, tavsiyeIkon, el("div", {}, el("small", { text: "Seçili saat için kombin tavsiyesi" }), tavsiyeMetin));
  const satirlar = [];
  function sec(i) {
    secili = i; d.planSaat = G.saatler[i].t;
    const t = saatTavsiyesi(G.saatler, i, d.tercih);
    tavsiyeMetin.textContent = t.metin; tavsiyeIkon.textContent = t.ikon; tavsiye.dataset.ton = t.ton;
    satirlar.forEach((tr, k) => { tr.classList.toggle("secili", k === i); tr.setAttribute("aria-selected", String(k === i)); });
  }

  const th = (t) => el("th", { scope: "col", text: t });
  const govde = G.saatler.map((x, i) => {
    const k = katman(x, d.tercih), a = k.analiz, hv = havaKodu(x.kod, x.gunduz);
    const tr = el("tr", { class: `hv-plan-satir s${a.seviye}${x.t < simdiT ? " gecmis" : ""}${x.t === simdiT ? " simdi" : ""}`, tabindex: "0", role: "row", "aria-selected": "false", title: "Kombin tavsiyesi için dokun" },
      el("th", { scope: "row", text: `${pad(x.saat)}:00` }),
      el("td", {}, el("span", { class: "hv-saat-ikon", title: hv.ad, text: hv.ikon })),
      el("td", { class: "hv-plan-sic", text: `${x.temp}°` }), el("td", { text: `${x.app}°` }),
      el("td", { text: `${ruzgarYonu(x.yon)} ${x.ruzgar} km/s${x.hamle >= x.ruzgar + 12 ? ` (hamle ${x.hamle})` : ""}` }),
      el("td", { class: x.yagis >= 0.05 ? "" : "sessiz", text: a.karli && a.karCm >= 0.1 ? `❄️ ${a.karCm} cm` : x.yagis >= 0.05 ? `${x.yagis.toFixed(1)} mm` : "—" }),
      el("td", { class: x.yagisOlasi < 10 ? "sessiz" : "", text: `%${x.yagisOlasi}` }),
      el("td", { class: a.buz.seviye >= 1 || (a.karli && a.karCm >= 0.1) ? "hv-plan-kar" : "sessiz", title: a.buz.neden }, a.karli && a.karCm >= 0.1 ? `SLR 1:${a.slr}` : null, a.karli && a.karCm >= 0.1 && a.buz.seviye >= 1 ? " · " : null, a.buz.seviye >= 1 ? `🧊 ${a.buz.ad}` : null, !(a.karli && a.karCm >= 0.1) && a.buz.seviye < 1 ? "—" : null),
      el("td", { class: "hv-plan-giyim" }, el("span", { class: "hv-plan-katman", "aria-hidden": "true", text: k.ikon }), el("span", {}, el("strong", { text: k.ad }), k.ek.length ? el("small", { text: k.ek.join(" · ") }) : null)));
    olay(tr, "click", () => sec(i)); olay(tr, "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sec(i); } });
    satirlar.push(tr);
    return tr;
  });
  const tablo = el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "Saat saat plan, yatay kaydırılabilir" },
    el("table", { class: "hv-matris hv-plan-tablo" }, el("thead", {}, el("tr", {}, ...["Saat", "Hava", "Sıcaklık", "Hissedilen", "Rüzgâr", "Yağış / kar", "PoP", "Kar oranı · Buz", "Kıyafet"].map(th))), el("tbody", {}, ...govde)));
  sec(secili);

  return el("div", { class: "hv-sekme-govde" },
    kart("hv-plan-kart", bolumBasligi("Detaylı saatlik planlama"),
      ipucu(`Planlamak istediğin güne dokun (${gunler.length} gün tek bakışta; ‹ › okları ya da klavyedeki ← → ile de gezebilirsin). 24 saatin her biri için sıcaklık, rüzgâr, yağış/kar ve kıyafet katmanı listelenir. Bir saate dokun, o saatin kombin tavsiyesi güncellenir.`),
      secici, mevsimeGit, ozet, tavsiye, tablo,
      el("p", { class: "hv-ipucu", text: `Kıyafet katmanı: CLO = (33 − etkin sıcaklık) ÷ 15 − aktivite; plan “${d.tercih.sen}”, tolerans ${d.tercih.tol > 0 ? "+" : ""}${d.tercih.tol}°. Gelecek günlerde model belirsizliği artar: 7 günden sonrası eğilim olarak oku.` }),
      gi >= 7 ? rozet("⚠️ 7+ gün: tahmin belirsizliği yüksek", "hv-rozet-onemli") : null));
}
