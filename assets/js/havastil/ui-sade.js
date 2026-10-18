/**
 * ui-sade.js — "Bugün": sıradan kullanıcı için SIFIR SÜRTÜNME ana ekranı (3 saniye kuralı).
 * Hüküm + ölçülen/hissedilen sıcaklık + 4 kademeli yağış çubuğu → kombin özeti (tek satır, ayrıntı "Kombin" sekmesinde) → saatlik akış.
 * Kıyafetle ilgili her ayrıntı (katmanlar, tetikleyiciler, çanta, plan, tercihler) yalnızca "Kombin" sekmesindedir; sayılar "Derin analiz"dedir.
 */
import { el, rozet, ipucu, kart, bolumBasligi, olay, zamanOnce } from "./ui-temel.js";
import { havaKodu } from "./hava-kodlari.js";
import { YAGIS_SEVIYELERI, gunParcasi, saatAnaliz } from "./yagis-fizigi.js";
import { yagisOzeti } from "./ui-hava.js";

/** Sabah/öğle/akşam planından tek cümlelik "gün içi değişim" notu (hepsi aynıysa not yok: sabit bir gün). */
function degisimNotu(s) {
  const zp = s.zamanPlani || [];
  if (zp.length < 2) return "";
  const degisen = zp.slice(1).find((x) => x.tur !== zp[0].tur);
  if (!degisen) return "";
  const gp = gunParcasi(degisen.saat), Gp = gp[0].toUpperCase() + gp.slice(1);
  return degisen.tur === "ekle" ? `${Gp} serinliyor: dış katı kapat.` : degisen.tur === "cikar" ? `${Gp} ısınıyor: orta katı çantaya at.` : "";
}

/* ------------------------------ hüküm + sıcaklık + yağış çubuğu ------------------------------ */
function yagisCubugu(f) {
  const hucreler = YAGIS_SEVIYELERI.map((sv) => el("div", { class: `hv-olcer-hucre s${sv.id}${sv.id <= f.seviye ? " dolu" : ""}${sv.id === f.seviye ? " aktif" : ""}` },
    el("span", { class: "hv-olcer-blok", "aria-hidden": "true" }), el("span", { class: "hv-olcer-ad", text: sv.kisa })));
  return el("div", { class: "hv-olcer-kutu" },
    el("div", { class: "hv-olcer", role: "img", "aria-label": `Yağış seviyesi: ${f.seviyeAd}` }, ...hucreler),
    el("p", { class: "hv-olcer-yazi" }, el("strong", { text: f.seviyeAd }), f.aralik ? el("span", { text: ` · ${f.gun === "yarın" ? "yarın " : ""}${f.aralik}` }) : null),
    f.seviye > 0 ? el("p", { class: "hv-ipucu", text: f.benzetme }) : null);
}

function sicaklikSatiri(d) {
  const h = d.hava, f = d.fizik, g = h.gunluk?.[f.gun === "yarın" ? 1 : 0], s0 = h.saatListe?.[0];
  const kutu = (baslik, deger, sinif = "") => el("div", { class: `hv-sic ${sinif}` }, el("small", { text: baslik }), el("strong", { text: deger }));
  return el("div", { class: "hv-sicaklik" },
    kutu("Hissedilen", `${h.apparent}°`, "ana"), kutu("Ölçülen", `${h.raw}°`),
    g ? kutu(f.gun === "yarın" ? "Yarın" : "Bugün", `${g.min}°–${g.max}°`) : null,
    kutu("Rüzgâr / hamle", `${h.wind} / ${s0?.hamle ?? h.gust ?? "—"} km/s`));
}

function hukumKarti(d, kb) {
  const h = d.hava, s = d.sonuc, f = d.fizik;
  const hk = havaKodu(h.kod, h.isDay);
  const yenile = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", "aria-label": "Hava durumunu yenile", text: "↻" }), "click", () => kb.yenile(true));
  const not = degisimNotu(s);
  const simdiYagis = f.gun === "yarın" && h.saatListe?.[0] && saatAnaliz(h.saatListe[0]).seviye >= 1 ? yagisOzeti(h) : null;
  return el("section", { class: `hv-kart hv-hukumkart ton-${f.ton}` },
    el("div", { class: "hv-hukum-ust" }, el("span", { class: "hv-hukum-simdi", text: `${hk.ikon} ${d.konum.ad} · ${hk.ad.toLowerCase()}` }), yenile),
    sicaklikSatiri(d),
    el("p", { class: "hv-hukum-baslik", "aria-live": "polite", text: f.baslik }),
    el("p", { class: "hv-hukum-alt", text: [f.alt, not].filter(Boolean).join(" ") }),
    yagisCubugu(f),
    simdiYagis ? el("p", { class: "hv-ipucu", text: `Şu an: ${simdiYagis}` }) : null,
    el("small", { class: "hv-ipucu", text: `${h.onbellek ? "önbellek · " : ""}${zamanOnce(h.alinma || Date.now())}${h.eski ? " · ÇEVRİMDIŞI son bilinen veri" : ""}` }));
}

/* ------------------------------ haber uyarı bandı (varsa) ------------------------------ */
function kapsamMetni(u) { return u.kapsam === "sokak" ? `${u.kapsamAd} sokağı` : u.kapsam === "mahalle" ? `${u.kapsamAd} mahallesi` : u.kapsam === "ilce" ? `${u.kapsamAd} ilçesi` : u.kapsam === "il" ? `${u.kapsamAd}` : u.kapsam === "bolge" ? `${u.kapsamAd} bölgesi` : `${u.kapsamAd} geneli`; }
function uyariBandi(d, kb) {
  const hb = d.haber;
  if (hb?.durum === "ok" && hb.uygulananlar.length) {
    return kart("hv-uyari-bandi", ...hb.uygulananlar.slice(0, 2).map((u) => el("div", { class: "hv-band-satir" }, el("span", { class: "hv-band-ikon", text: u.kurallar[0].ikon }), el("div", {}, el("strong", { text: u.baslik }), el("small", { text: `${u.kurum || u.kaynakAd} · ${u.kurallar[0].etiket} · ${kapsamMetni(u)}` })))),
      olay(el("button", { type: "button", class: "hv-baglanti", text: "Ayrıntı ve ne yapmalı" }), "click", () => kb.sekmeGit("haber")));
  }
  return null;
}

/* ------------------------------ kombin özeti (tek satır → Kombin sekmesi) ------------------------------ */
function kombinOzeti(d, kb) {
  const s = d.sonuc, no = Math.min(d.kombinNo, s.kombinler.length - 1), p = s.kombinler[no].parcalar;
  const parcalar = ["b", "m", "o", "p", "a"].map((x) => p[x]).filter(Boolean);
  const etkenler = s.tetik.liste.filter((t) => t.id !== "plan");
  return kart("hv-kucuk hv-kombin-ozet",
    bolumBasligi("Bugünkü kombin", olay(el("button", { type: "button", class: "hv-baglanti", text: "Ayrıntı ve nedenleri" }), "click", () => kb.sekmeGit("kombin"))),
    el("div", { class: "hv-parca-cipleri" }, ...parcalar.map((x) => rozet(x.ad))),
    etkenler.length ? el("div", { class: "hv-tetik-satir" }, el("span", { class: "hv-tetik-ok", "aria-hidden": "true", text: "Etkenler:" }),
      ...etkenler.map((t) => el("span", { class: `hv-tetik t-${t.id}`, title: `${t.ad}${t.olcum ? " · " + t.olcum : ""}`, text: `${t.ikon} ${t.kisa}` }))) : null);
}

/* ------------------------------ saatlik akış ------------------------------ */
function akisSeridi(d, kb) {
  const sl = (d.hava.saatListe || []).slice(0, 13);
  const hucreler = sl.map((x, i) => {
    const a = saatAnaliz(x), ic = havaKodu(x.kod, x.gunduz);
    return el("div", { class: "hv-saat" },
      el("small", { text: i === 0 ? "Şimdi" : `${String(x.saat).padStart(2, "0")}:00` }),
      el("span", { class: "hv-saat-ikon", "aria-hidden": "true", text: ic.ikon }),
      el("strong", { text: `${x.temp}°` }),
      el("span", { class: `hv-saat-seviye s${a.seviye}`, title: YAGIS_SEVIYELERI[a.seviye].ad }),
      el("small", { class: a.hamle > 40 ? "hv-hamle" : "", text: a.seviye >= 1 && a.mm >= 0.1 ? `${a.mm} mm` : a.hamle > 40 ? `💨${a.hamle}` : "" }));
  });
  return kart("hv-kucuk", bolumBasligi("Gün içi akış", olay(el("button", { type: "button", class: "hv-baglanti", text: "Saat saat matris" }), "click", () => kb.sekmeGit("derin"))),
    el("div", { class: "hv-saat-serit" }, ...hucreler));
}

/* ------------------------------ sekme ------------------------------ */
export function bugunSekmesi(d, kb) {
  if (!d.hava || !d.sonuc || !d.fizik) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  return el("div", { class: "hv-sekme-govde" },
    hukumKarti(d, kb), uyariBandi(d, kb), kombinOzeti(d, kb), akisSeridi(d, kb),
    el("div", { class: "hv-btn-satir" }, olay(el("button", { type: "button", class: "hv-btn", text: "🔬 Derin analiz ve uzman görünümü" }), "click", () => kb.sekmeGit("derin"))));
}
