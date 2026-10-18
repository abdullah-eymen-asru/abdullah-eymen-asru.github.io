/**
 * ui-hava.js — 14 Gün sekmesi + ortak yardımcılar (v3).
 * Özet / Saatlik / ayrıntı ızgarası artık ui-sade.js (Bugün) ve ui-uzman.js (Derin analiz) içinde.
 * 14 günlük (v4) satırlar da aynı 4 kademeli yağış dilini kullanır (yagis-fizigi.js › gunSeviyesi): %100 yağış ihtimali 0,2 mm çisentiyi şiddetli göstermez.
 */
import { el, ipucu, kart, bolumBasligi } from "./ui-temel.js";
import { havaKodu, gunAdi } from "./hava-kodlari.js";
import { hedefClo } from "./cekirdek.js";
import { gunSeviyesi } from "./yagis-fizigi.js";

/** Apple Hava Durumu tarzı tek cümlelik yağış özeti (15 dk'lık veri varsa onu, yoksa saatlik listeyi kullanır). */
export function yagisOzeti(h) {
  const sl = (h.saatListe || []).slice(0, 24);
  const yagmurlu = (x) => x.yagisOlasi >= 50 || x.yagis >= 0.3;
  if (h.dakikalik?.length && h.dakikalik.slice(0, 8).some((x) => x.mm > 0.05)) {
    const ilk = h.dakikalik.findIndex((x) => x.mm > 0.05);
    if (ilk === 0) return "Şu an yağış var; saatlik tahmine göre gelişimi aşağıda.";
    return `Yaklaşık ${ilk * 15} dk içinde yağış başlıyor.`;
  }
  const i0 = sl.findIndex(yagmurlu);
  if (i0 < 0) return "Önümüzdeki 24 saatte belirgin yağış beklenmiyor.";
  let i1 = i0; while (i1 + 1 < sl.length && yagmurlu(sl[i1 + 1])) i1++;
  const p = (x) => `${String(x.saat).padStart(2, "0")}:00`;
  if (i0 === 0) return i1 + 1 >= sl.length ? "Yağış gün boyu sürecek." : `Yağış şu an sürüyor; ${p(sl[Math.min(i1 + 1, sl.length - 1)])} civarında dinmesi bekleniyor.`;
  return i1 === i0 ? `${p(sl[i0])} civarında kısa süreli yağış bekleniyor.` : `${p(sl[i0])} – ${p(sl[Math.min(i1 + 1, sl.length - 1)])} arasında yağış bekleniyor.`;
}

const gunEtiketi = (tarih, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(tarih));

/* ------------------------------ 10 GÜN ------------------------------ */
export function giyimIpucu(g, tercih) {
  const ort = (g.appMax + g.appMin) / 2;
  const c = hedefClo({ apparent: ort, raw: ort }, tercih.tol, tercih.sen).clo;
  const ana = c < 0.5 ? "Kısa kollu, hafif" : c < 0.8 ? "İnce uzun kollu / hafif ceket" : c < 1.1 ? "Ceket veya hırka" : c < 1.5 ? "Mont / kaban" : "Kalın mont, bere, eldiven";
  const gs = gunSeviyesi(g);
  const yagis = gs.firtina ? " + kapüşonlu teknik kabuk (şemsiye değil)" : gs.seviye >= 3 ? " + yağmurluk ve su geçirmez bot" : gs.seviye === 2 ? " + yağmurluk/şemsiye" : "";
  return `${ana}${yagis}${g.uv >= 6 ? " + güneş koruması" : ""}`;
}

export function gunlukSekmesi(d) {
  const h = d.hava;
  if (!h?.gunluk?.length) return kart("hv-bos", ipucu("Günlük tahmin yükleniyor…"));
  const mn = Math.min(...h.gunluk.map((g) => g.min)), mx = Math.max(...h.gunluk.map((g) => g.max));
  const satirlar = h.gunluk.map((g, i) => {
    const k = havaKodu(g.kod, true);
    const gs = gunSeviyesi(g);
    const aralik = el("span", { class: "hv-aralik" }, (() => { const ic = el("span"); ic.style.left = `${((g.min - mn) / (mx - mn || 1)) * 100}%`; ic.style.width = `${Math.max(6, ((g.max - g.min) / (mx - mn || 1)) * 100)}%`; return ic; })());
    return el("div", { class: "hv-gun" },
      el("div", { class: "hv-gun-ad" }, el("strong", { class: "hv-gun-ad-yazi", text: gunEtiketi(g.tarih, i) }), el("small", { text: g.tarih.slice(8, 10) + "." + g.tarih.slice(5, 7) })),
      el("span", { class: "hv-saat-ikon", "aria-hidden": "true", title: k.ad, text: k.ikon }),
      el("div", { class: "hv-gun-yagis" }, el("small", { class: `hv-yagis-etiket s${gs.seviye}`, text: gs.kisa }), g.yagisToplam >= 0.1 ? el("small", { text: `${g.yagisToplam} mm` }) : null),
      el("div", { class: "hv-gun-aralik" }, el("small", { text: `${g.min}°` }), aralik, el("small", { text: `${g.max}°` })),
      el("small", { class: "hv-gun-ek", text: `💨 ${g.ruzgar}–${g.hamle} km/s · UV ${g.uv}` }),
      el("small", { class: "hv-gun-giyim", text: giyimIpucu(g, d.tercih) }));
  });
  return el("div", { class: "hv-sekme-govde" }, kart("", bolumBasligi(`${h.gunluk.length} günlük tahmin`), ipucu("Yağış etiketi olasılığa değil, beklenen su miktarına bakar. Öneri, günün ortalama hissedilen sıcaklığı ve senin tercihlerinle hesaplanır."), ...satirlar));
}
