/**
 * ui-kombin.js — Kombin ile ilgili ortak yapı taşları (v3). Eski "Kombin" sekmesi kalktı:
 *   • Sıradan kullanıcı görünümü  → ui-sade.js › "Bugünün Zırhı" paneli
 *   • Uzman görünümü (CLO, gün içi plan, tüm öneriler) → ui-uzman.js, burada tanımlanan bloklarla.
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi } from "./ui-temel.js";

export const SLOT_SIRA = ["b", "m", "o", "p", "a"];
const ONCELIK_AD = { sart: "Şart", iyi: "İyi olur", olabilir: "İstersen" };
const AGIRLIK_AD = { hafif: "hafif", orta: "orta ağırlık", agir: "ağır" };

/** CLO bütçe çubuğu: parça parça yalıtım katkısı + hedef çizgisi. */
export function cloBar(k, s) {
  const parcalar = SLOT_SIRA.map((x) => k.parcalar[x]).filter(Boolean);
  const toplamPay = Math.max(s.clo.hedef, k.toplam) * 1.08;
  const seg = (deger, sinif, baslik) => { const e = el("span", { class: `hv-clo-seg ${sinif}`, title: baslik }); e.style.width = `${Math.max(1, (deger / toplamPay) * 100)}%`; return e; };
  const hedefIs = el("span", { class: "hv-clo-hedef", title: `Hedef ${s.clo.hedef.toFixed(2)} CLO` });
  hedefIs.style.left = `${(s.clo.hedef / toplamPay) * 100}%`;
  return el("div", { class: "hv-clo" },
    el("div", { class: "hv-clo-bar" }, seg(0.1, "taban", "İç çamaşırı + çorap 0,10"), ...parcalar.map((p, i) => seg(p.clo * 0.85, `p${i % 5}`, `${p.ad} ${(p.clo * 0.85).toFixed(2)}`)), hedefIs),
    el("small", { class: "hv-ipucu", text: `Toplam ${k.toplam.toFixed(2)} CLO · hedef ${s.clo.hedef.toFixed(2)} (${k.fark >= 0 ? "+" : ""}${k.fark.toFixed(2)}). Çubuktaki çizgi hedefi gösterir.` }));
}

/** Sabah/öğle/akşam: şunu çıkar / şunu ekle. */
export function zamanPlaniKarti(s) {
  if (!s.zamanPlani.length) return null;
  return kart("", bolumBasligi("Gün içi katman planı"),
    el("div", { class: "hv-zaman" }, ...s.zamanPlani.map((z) => el("div", { class: `hv-zaman-satir ${z.tur}` },
      el("div", { class: "hv-zaman-saat" }, el("strong", { text: z.ad }), el("small", { text: `${String(z.saat).padStart(2, "0")}:00` })),
      el("div", { class: "hv-zaman-metin" },
        el("span", { class: "hv-zaman-eylem", text: z.tur === "ok" ? "Bu kombin uygun" : /çıkar → çantaya$/.test(z.eylem) ? `Çıkar: ${z.eylem.replace(/ çıkar → çantaya$/, "")} → çantaya` : z.eylem }),
        el("small", { class: "hv-ipucu", text: `Hissedilen ${z.hissedilen}° · yağış %${z.yagis} · rüzgâr ${z.ruzgar} km/s` }))))));
}

/** Gruplu tüm öneriler (çanta durumuna göre). */
export function tumOnerilerKarti(d, s) {
  const gruplar = {};
  for (const e of s.ekstralar) (gruplar[e.grup] ||= []).push(e);
  if (!Object.keys(gruplar).length) return kart("hv-kucuk", ipucu("Bugün ekstra bir şeye gerek yok."));
  return kart("", bolumBasligi("Tüm öneriler"),
    ipucu(`Çanta durumuna göre seçildi: ${d.tercih.canta === "yok" ? "çantan yok → cebe sığanlar öne alındı" : d.tercih.canta === "sirt" ? "sırt çantan var" : "el çantan var"}.`),
    ...Object.entries(gruplar).map(([g, l]) => el("div", { class: "hv-ekstra-grup" }, etiket(g), ...l.map((e) => el("div", { class: "hv-ekstra" },
      el("span", { class: "hv-ekstra-ikon", "aria-hidden": "true", text: e.ikon }),
      el("div", {}, el("strong", { text: e.ad }), el("small", { class: "hv-ipucu", text: e.neden })),
      el("div", { class: "hv-ekstra-etiket" }, rozet(ONCELIK_AD[e.oncelik], e.oncelik === "sart" ? "hv-rozet-onemli" : ""), rozet(`${AGIRLIK_AD[e.agirlik]}${e.cebeSigar ? " · cebe sığar" : ""}`)))))));
}
