/**
 * ui-kombin.js — "Ne giyeyim?" sekmesi: 3 alternatif kombin, CLO bütçesi, gün içi zaman planı, gündelik ek öneriler (çanta durumuna göre),
 * kaçınılacaklar, kumaş/renk/ayakkabı ve stilist yorumu (Mod A yerel / Mod B Groq).
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, cipGrubu, olay } from "./ui-temel.js";
import { STIL_SECENEKLERI } from "./cekirdek.js";
import { SLOTLAR, STILLER } from "./katalog.js";

const SLOT_SIRA = ["b", "m", "o", "p", "a"];
const ONCELIK_AD = { sart: "Şart", iyi: "İyi olur", olabilir: "İstersen" };
const AGIRLIK_AD = { hafif: "hafif", orta: "orta ağırlık", agir: "ağır" };

function cloBar(k, s) {
  const parcalar = SLOT_SIRA.map((x) => k.parcalar[x]).filter(Boolean);
  const toplamPay = Math.max(s.clo.hedef, k.toplam) * 1.08;
  const seg = (deger, sinif, baslik) => { const e = el("span", { class: `hv-clo-seg ${sinif}`, title: baslik }); e.style.width = `${Math.max(1, (deger / toplamPay) * 100)}%`; return e; };
  const hedefIs = el("span", { class: "hv-clo-hedef", title: `Hedef ${s.clo.hedef.toFixed(2)} CLO` });
  hedefIs.style.left = `${(s.clo.hedef / toplamPay) * 100}%`;
  return el("div", { class: "hv-clo" },
    el("div", { class: "hv-clo-bar" }, seg(0.1, "taban", "İç çamaşırı + çorap 0,10"), ...parcalar.map((p, i) => seg(p.clo * 0.85, `p${i % 5}`, `${p.ad} ${(p.clo * 0.85).toFixed(2)}`)), hedefIs),
    el("small", { class: "hv-ipucu", text: `Toplam ${k.toplam.toFixed(2)} CLO · hedef ${s.clo.hedef.toFixed(2)} (${k.fark >= 0 ? "+" : ""}${k.fark.toFixed(2)}). Çubuktaki çizgi hedefi gösterir.` }));
}

export function kombinSekmesi(d, kb) {
  const s = d.sonuc;
  if (!s) return kart("hv-bos", ipucu("Önce hava verisi yüklenmeli…"));
  const no = Math.min(d.kombinNo, s.kombinler.length - 1);
  const k = s.kombinler[no];

  const secici = el("div", { class: "hv-cipgrup", role: "group", "aria-label": "Kombin alternatifleri" },
    ...s.kombinler.map((x, i) => olay(el("button", { type: "button", class: "hv-cip-btn", "aria-pressed": String(i === no), text: `${x.ad} · ${STILLER[x.stil] || ""}` }), "click", () => { d.kombinNo = i; kb.ciz(); })));
  const baska = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🎲 Başka kombinler getir" }), "click", () => kb.tercihDegis({ tohumKaydir: (d.tercih.tohumKaydir || 0) + 1 }));

  const liste = el("div", { class: "hv-kombin-liste" }, ...SLOT_SIRA.map((x) => {
    const p = k.parcalar[x];
    if (!p) return x === "m" || x === "o" ? el("div", { class: "hv-parca bos" }, el("small", { text: SLOTLAR[x] }), el("span", { text: x === "m" ? "Orta katman gerekmiyor" : "Dış katman gerekmiyor" })) : null;
    return el("div", { class: "hv-parca" }, el("small", { text: SLOTLAR[x] }), el("strong", { text: p.ad }), el("span", { class: "hv-ipucu", text: `Kumaş: ${p.kumas} · ${(p.clo * 0.85).toFixed(2)} CLO` }));
  }));

  const nedenKutu = el("details", { class: "hv-detay-ac" }, el("summary", { text: "Neden bu kombin?" }), el("ul", { class: "hv-liste" }, ...s.neden.map((t) => el("li", { text: t }))));

  // zaman planı
  const plan = s.zamanPlani.length ? kart("hv-kucuk", etiket("🕒 Gün içi plan"), el("div", { class: "hv-zaman" }, ...s.zamanPlani.map((z) => el("div", { class: `hv-zaman-satir ${z.tur}` },
    el("div", { class: "hv-zaman-saat" }, el("strong", { text: z.ad }), el("small", { text: `${String(z.saat).padStart(2, "0")}:00` })),
    el("div", {}, el("span", { class: "hv-zaman-eylem", text: z.tur === "cikar" ? `➖ ${z.eylem}` : z.tur === "ekle" ? `➕ ${z.eylem}` : `✅ ${z.eylem}` }), el("small", { class: "hv-ipucu", text: `Hissedilen ${z.hissedilen}° · yağış %${z.yagis} · rüzgâr ${z.ruzgar} km/s` })))))) : null;

  // ekstralar (gruplu)
  const gruplar = {};
  for (const e of s.ekstralar) (gruplar[e.grup] ||= []).push(e);
  const ekstra = Object.keys(gruplar).length ? kart("", bolumBasligi("🎒 Yanına al / yap"), ipucu(`Çanta durumuna göre seçildi: ${d.tercih.canta === "yok" ? "çantan yok → cebe sığanlar öne alındı" : d.tercih.canta === "sirt" ? "sırt çantan var" : "el çantan var"}.`),
    ...Object.entries(gruplar).map(([g, l]) => el("div", { class: "hv-ekstra-grup" }, etiket(g), ...l.map((e) => el("div", { class: "hv-ekstra" },
      el("span", { class: "hv-ekstra-ikon", "aria-hidden": "true", text: e.ikon }),
      el("div", {}, el("strong", { text: e.ad }), el("small", { class: "hv-ipucu", text: e.neden })),
      el("div", { class: "hv-ekstra-etiket" }, rozet(ONCELIK_AD[e.oncelik], e.oncelik === "sart" ? "hv-rozet-onemli" : ""), rozet(`${AGIRLIK_AD[e.agirlik]}${e.cebeSigar ? " · cebe sığar" : ""}`))))))) : kart("hv-kucuk", ipucu("Bugün ekstra bir şeye gerek yok."));

  const kacin = s.kacin.length ? el("div", { class: "hv-parca-cipleri" }, ...s.kacin.map((x) => rozet(`🚫 ${x}`, "hv-rozet-yasak"))) : null;
  const stilSecici = cipGrubu({ baslik: "Tarz", secenekler: Object.entries(STIL_SECENEKLERI), aktif: () => d.tercih.stil, onSec: (v) => kb.tercihDegis({ stil: v }), kucuk: true });

  return el("div", { class: "hv-sekme-govde" },
    kart("", bolumBasligi("Önerilen kombin"), secici, liste, cloBar(k, s), nedenKutu, el("div", { class: "hv-btn-satir" }, baska), stilSecici.kok),
    plan, ekstra,
    kart("hv-iki", el("div", {}, etiket("👟 Zemin ve ayakkabı"), el("p", { class: "hv-katman-ad", text: s.ayakkabi })), el("div", {}, etiket("🎨 Renk ve görünürlük"), el("p", { class: "hv-katman-ad", text: s.renk }))),
    kart("hv-kucuk", etiket("🧵 Kumaş"), ...s.kumas.tercih.map((t) => el("p", { class: "hv-ipucu", text: `✔ ${t}` })), ...s.kumas.kacin.map((t) => el("p", { class: "hv-ipucu", text: `✖ ${t}` })), kacin),
    stilistKarti(d, kb));
}

export function stilistKarti(d, kb) {
  const a = d.ai;
  const kutu = el("input", { type: "checkbox", id: "hv-ai-modu" });
  kutu.checked = d.aiModu;
  olay(kutu, "change", () => kb.aiModu(kutu.checked));
  return kart("hv-ai",
    etiket("✨ Stilist yorumu"),
    el("p", { class: "hv-ai-metin", text: a.metin || "…" }),
    el("small", { class: "hv-ipucu", text: a.etiket || "" }),
    a.hata ? el("p", { class: "hv-uyari", text: a.hata }) : null,
    el("label", { class: "hv-onay hv-ai-anahtar", for: "hv-ai-modu" }, kutu, el("span", { text: "Yapay zekâ yorumu (isteğe bağlı) — kapalıyken hiçbir yapay zekâ isteği yapılmaz" })),
    d.aiModu ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Yeniden yorumla" }), "click", () => kb.aiYorumIste(true)) : null);
}
