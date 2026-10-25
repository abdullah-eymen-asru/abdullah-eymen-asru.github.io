/**
 * ui-kombin.js — TEK "Kombin" sekmesi (v3.1). Kıyafetle ilgili her şey burada ve birbirine bağlı:
 *   1) Bugünün kombini: 5 satır (iç · çıkarılabilir orta · dış kabuk · alt · ayakkabı). Her satırın altında o öneriyi doğuran TETİKLEYİCİ etiketleri.
 *   2) Tetikleyiciler: hangi veri (ısı, yağış, rüzgâr…) ölçüldü, eşiği neydi, hangi öneriyi etkiledi (tersi yönde okuma).
 *   3) Çantaya at / yanına al: gruplu ekstralar, her biri tetikleyici etiketiyle.
 *   4) Gün içi kritik an (stilist) + gün içi katman planı.
 *   5) Plan ve tercihler (plan, sıcaklık algın, çanta, tarz) + ısı yalıtımı (CLO) hesabı.
 * Veri: cekirdek.js › degerlendir (tetik.liste, tetik.parca, ekstralar[].tetik) — burada hesap yok, yalnızca gösterim.
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, cipGrubu, olay } from "./ui-temel.js";
import { SENARYOLAR, TOLERANSLAR, CANTA_SECENEKLERI, STIL_SECENEKLERI, KATALOG } from "./cekirdek.js";
import { gunParcasi } from "./yagis-fizigi.js";

export const SLOT_SIRA = ["b", "m", "o", "p", "a"];
const SLOT_AD = { b: "İç kat", m: "Çıkarılabilir orta kat", o: "Koruyucu dış kabuk", p: "Alt giyim", a: "Ayakkabı" };
const ONCELIK_AD = { sart: "Şart", iyi: "İyi olur", olabilir: "İstersen" };
const AGIRLIK_AD = { hafif: "hafif", orta: "orta ağırlık", agir: "ağır" };
const ETIKET_METNI = { g: "su geçirmez", s: "su itici", r: "rüzgâr geçirmez", k: "kaymaz taban", p: "çantaya girer", t: "hızlı kurur", n: "nefes alır", h: "katlanır" };
const ETIKET_SIRASI = ["g", "s", "r", "k", "p", "t", "n", "h"];

function ozellikMetni(id, en = 3) {
  const e = KATALOG[id]?.etiket;
  if (!e) return "";
  const l = [];
  for (const k of ETIKET_SIRASI) { if (!e.has(k)) continue; if (k === "s" && e.has("g")) continue; l.push(ETIKET_METNI[k]); }
  return l.slice(0, en).join(" · ");
}

/* ------------------------------ tetikleyici etiketleri ------------------------------ */
const tetikCipi = (id, liste) => {
  const t = liste.find((x) => x.id === id);
  if (!t) return null;
  return el("span", { class: `hv-tetik t-${id}`, title: [t.ad, t.olcum, t.esik && `eşik: ${t.esik}`].filter(Boolean).join(" · "), text: `${t.ikon} ${t.kisa}` });
};
const tetikSatiri = (ids, liste) => {
  const c = (ids || []).map((i) => tetikCipi(i, liste)).filter(Boolean);
  return c.length ? el("div", { class: "hv-tetik-satir" }, el("span", { class: "hv-tetik-ok", "aria-hidden": "true", text: "← neden:" }), ...c) : null;
};

/* ------------------------------ 1) bugünün kombini ------------------------------ */
function katmanSatiri(sira, slot, p, not, tetikIds, liste) {
  return el("div", { class: `hv-katman k${sira}${p ? "" : " bos"}` },
    el("span", { class: "hv-katman-rol", text: SLOT_AD[slot] }),
    el("strong", { class: "hv-katman-ad", text: p ? p.ad : "Gerekmiyor" }),
    not ? el("small", { class: "hv-ipucu", text: not }) : null,
    p ? tetikSatiri(tetikIds, liste) : null);
}

function kombinKarti(d, kb) {
  const s = d.sonuc, no = Math.min(d.kombinNo, s.kombinler.length - 1), k = s.kombinler[no], p = k.parcalar, L = s.tetik.liste, T = s.tetik.parca;
  const cikanSaat = (s.zamanPlani || []).find((z) => z.tur === "cikar");
  const notlar = {
    b: [d.tercih.sen === "yuruyus_ofis" ? "ofiste de rahat" : "", p.b ? ozellikMetni(p.b.id, 2) : ""].filter(Boolean).join(" · "),
    m: p.m ? (cikanSaat ? `${gunParcasi(cikanSaat.saat)} ısınınca çıkar, çantaya girer` : ozellikMetni(p.m.id, 2)) : "",
    o: p.o ? ozellikMetni(p.o.id, 3) : "", p: p.p ? ozellikMetni(p.p.id, 2) : "", a: p.a ? ozellikMetni(p.a.id, 2) : "",
  };
  const baska = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🎲 Başka kombin" }), "click", () => kb.tercihDegis({ tohumKaydir: (d.tercih.tohumKaydir || 0) + 1 }));
  const secici = s.kombinler.length > 1 ? el("div", { class: "hv-cipgrup", role: "group", "aria-label": "Kombin alternatifleri" },
    ...s.kombinler.map((x, i) => olay(el("button", { type: "button", class: "hv-cip-btn", "aria-pressed": String(i === no), text: x.ad }), "click", () => { d.kombinNo = i; kb.ciz(); }))) : null;
  return kart("hv-zirh",
    bolumBasligi("Bugünün kombini", baska), secici,
    ipucu("Her satırın altındaki etiketler, o önerinin hangi hava verisinden doğduğunu gösterir. Ayrıntısı aşağıdaki “Tetikleyiciler” bölümünde."),
    el("div", { class: "hv-katmanlar" }, ...SLOT_SIRA.slice(0, 3).map((x, i) => katmanSatiri(i, x, p[x], notlar[x], T[x], L))),
    el("div", { class: "hv-katmanlar hv-katmanlar-alt" }, katmanSatiri(3, "p", p.p, notlar.p, T.p, L), katmanSatiri(4, "a", p.a, notlar.a, T.a, L)),
    el("p", { class: "hv-zirh-zemin", text: s.ayakkabi }),
    el("p", { class: "hv-zirh-renk", text: s.renk }),
    s.kacin.length ? el("div", { class: "hv-parca-cipleri" }, ...s.kacin.map((x) => rozet(`Giyme: ${x}`, "hv-rozet-yasak"))) : null);
}

/* ------------------------------ 2) tetikleyiciler (iki yönlü) ------------------------------ */
function tetikleyiciKarti(d) {
  const s = d.sonuc, L = s.tetik.liste, T = s.tetik.parca, ana = s.kombinler[Math.min(d.kombinNo, s.kombinler.length - 1)].parcalar;
  const etkilenen = (id) => {
    const o = SLOT_SIRA.filter((x) => ana[x] && T[x]?.includes(id)).map((x) => SLOT_AD[x]);
    const e = s.ekstralar.filter((x) => x.tetik?.includes(id)).map((x) => x.ad.replace(/\s*\(.*\)$/, ""));
    return [...o, ...e];
  };
  return kart("", bolumBasligi("Tetikleyiciler"),
    ipucu("Aşağıdaki veriler bugün öneriyi değiştirdi. Her satırda ölçülen değer, eşik ve bu yüzden etkilenen öneriler var."),
    ...L.map((t) => {
      const et = etkilenen(t.id);
      return el("div", { class: `hv-tetik-kart t-${t.id}` },
        el("div", { class: "hv-tetik-ust" }, el("span", { class: `hv-tetik t-${t.id}`, text: `${t.ikon} ${t.kisa}` }), el("strong", { text: t.ad }), t.olcum ? el("span", { class: "hv-tetik-deger", text: t.olcum }) : null),
        t.esik ? el("small", { class: "hv-ipucu", text: `Eşik: ${t.esik}` }) : null,
        el("small", { text: t.etki }),
        et.length ? el("div", { class: "hv-tetik-etki" }, el("span", { class: "hv-tetik-ok", "aria-hidden": "true", text: "→ etkilediği:" }), ...et.map((x) => rozet(x))) : null);
    }));
}

/* ------------------------------ 3) çantaya at / yanına al ------------------------------ */
function cantaKarti(d) {
  const s = d.sonuc, L = s.tetik.liste;
  const gruplar = {};
  for (const e of s.ekstralar) (gruplar[e.grup] ||= []).push(e);
  if (!Object.keys(gruplar).length) return kart("hv-kucuk", bolumBasligi("Çantaya at / yanına al"), ipucu("Bugün ekstra bir şeye gerek yok."));
  return kart("", bolumBasligi("Çantaya at / yanına al"),
    ipucu(`Çanta durumuna göre seçildi: ${d.tercih.canta === "yok" ? "çantan yok → cebe sığanlar öne alındı" : d.tercih.canta === "sirt" ? "sırt çantan var" : "el çantan var"}.`),
    ...Object.entries(gruplar).map(([g, l]) => el("div", { class: "hv-ekstra-grup" }, etiket(g), ...l.map((e) => el("div", { class: "hv-ekstra" },
      el("span", { class: "hv-ekstra-ikon", "aria-hidden": "true", text: e.ikon }),
      el("div", {}, el("strong", { text: e.ad }), el("small", { class: "hv-ipucu", text: e.neden }), tetikSatiri(e.tetik, L)),
      el("div", { class: "hv-ekstra-etiket" }, rozet(ONCELIK_AD[e.oncelik], e.oncelik === "sart" ? "hv-rozet-onemli" : ""), rozet(`${AGIRLIK_AD[e.agirlik]}${e.cebeSigar ? " · cebe sığar" : ""}`)))))));
}

/* ------------------------------ 4) gün içi kritik an + katman planı ------------------------------ */
function krizKarti(d, kb) {
  const k = d.kriz;
  const metin = el("p", { class: "hv-kriz-metin" });
  const alt = el("small", { class: "hv-ipucu" });
  const hata = el("p", { class: "hv-uyari" });
  const boya = () => { const a = d.ai; metin.textContent = a.metin || "…"; alt.textContent = a.etiket || ""; hata.textContent = a.hata || ""; hata.hidden = !a.hata; };
  boya();
  kb.aiYenileEkran = boya;
  const kutu = el("input", { type: "checkbox", id: "hv-ai-modu" });
  kutu.checked = d.aiModu;
  olay(kutu, "change", () => kb.aiModu(kutu.checked));
  return kart(`hv-kriz${k?.var ? " var" : ""}`,
    bolumBasligi("Gün içi kritik an", k?.var ? rozet(`${String(k.saat).padStart(2, "0")}:00`, "hv-rozet-onemli") : null),
    ipucu("Planına göre en çok çelişkinin olduğu an: sıcak ortamdan çıkış, ani soğuma, hamle veya yağışın başlaması."),
    metin, alt, hata,
    el("label", { class: "hv-onay hv-ai-anahtar", for: "hv-ai-modu" }, kutu, el("span", { text: "Yapay zekâ stilist (isteğe bağlı): kritik anı yorumlasın. Kapalıyken hiçbir yapay zekâ isteği yapılmaz." })),
    d.aiModu ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "✨ Yapay zekâya yorumlat (istek yapar)" }), "click", () => kb.aiYorumIste(true)) : null);
}

/** Sabah/öğle/akşam: şunu çıkar / şunu ekle. */
function zamanPlaniKarti(s) {
  if (!s.zamanPlani.length) return null;
  return kart("", bolumBasligi("Gün içi katman planı"),
    el("div", { class: "hv-zaman" }, ...s.zamanPlani.map((z) => el("div", { class: `hv-zaman-satir ${z.tur}` },
      el("div", { class: "hv-zaman-saat" }, el("strong", { text: z.ad }), el("small", { text: `${String(z.saat).padStart(2, "0")}:00` })),
      el("div", { class: "hv-zaman-metin" },
        el("span", { class: "hv-zaman-eylem", text: z.tur === "ok" ? "Bu kombin uygun" : /çıkar → çantaya$/.test(z.eylem) ? `Çıkar: ${z.eylem.replace(/ çıkar → çantaya$/, "")} → çantaya` : z.eylem }),
        el("small", { class: "hv-ipucu", text: `Hissedilen ${z.hissedilen}° · yağış %${z.yagis} · rüzgâr ${z.ruzgar} km/s` }))))));
}

/* ------------------------------ 5) plan/tercihler + CLO ------------------------------ */
function planKutusu(d, kb) {
  const ozet = `${SENARYOLAR[d.tercih.sen].ad} · ${TOLERANSLAR[d.tercih.tol]} · ${CANTA_SECENEKLERI[d.tercih.canta]}`;
  const det = el("details", { class: "hv-kart hv-kucuk hv-plan", open: d.planAcik ? true : null },
    el("summary", {}, el("span", { class: "hv-plan-baslik", text: "Plan ve tercihler (kombini bunlar şekillendirir)" }), el("small", { class: "hv-ipucu", text: ozet })),
    cipGrubu({ baslik: "Bugünkü planın", secenekler: Object.entries(SENARYOLAR).map(([k, v]) => [k, v.ad]), aktif: () => d.tercih.sen, onSec: (v) => kb.tercihDegis({ sen: v }) }).kok,
    ipucu(SENARYOLAR[d.tercih.sen].ipucu),
    el("div", { class: "hv-iki-sutun" },
      cipGrubu({ baslik: "Sıcaklık algın", secenekler: Object.entries(TOLERANSLAR).map(([k, v]) => [Number(k), v]), aktif: () => d.tercih.tol, onSec: (v) => kb.tercihDegis({ tol: v }), kucuk: true }).kok,
      cipGrubu({ baslik: "Çantan", secenekler: Object.entries(CANTA_SECENEKLERI), aktif: () => d.tercih.canta, onSec: (v) => kb.tercihDegis({ canta: v }), kucuk: true }).kok),
    cipGrubu({ baslik: "Tarz", secenekler: Object.entries(STIL_SECENEKLERI), aktif: () => d.tercih.stil, onSec: (v) => kb.tercihDegis({ stil: v }), kucuk: true }).kok);
  olay(det, "toggle", () => { d.planAcik = det.open; });
  return det;
}

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
function cloKutusu(d) {
  const s = d.sonuc, no = Math.min(d.kombinNo, s.kombinler.length - 1), k = s.kombinler[no];
  return el("details", { class: "hv-kart hv-kucuk hv-plan" },
    el("summary", {}, el("span", { class: "hv-plan-baslik", text: "Isı yalıtımı hesabı (CLO)" }), el("small", { class: "hv-ipucu", text: `Hedef ${s.clo.hedef.toFixed(2)} · seçilen kombin ${k.toplam.toFixed(2)}` })),
    ipucu("CLO, kıyafetin yalıtım birimidir (1 CLO ≈ ofis kıyafeti). Hedef CLO = (33 − etkin sıcaklık) / 15 − aktivite. Seçilen parçaların toplamı: 0,10 + 0,85 × Σ parça CLO."),
    cloBar(k, s), el("ul", { class: "hv-liste" }, ...s.neden.map((t) => el("li", { text: t }))));
}

/* ------------------------------ sekme ------------------------------ */
export function kombinSekmesi(d, kb) {
  if (!d.hava || !d.sonuc) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  return el("div", { class: "hv-sekme-govde" },
    kombinKarti(d, kb), tetikleyiciKarti(d), cantaKarti(d), krizKarti(d, kb), zamanPlaniKarti(d.sonuc), planKutusu(d, kb), cloKutusu(d));
}
