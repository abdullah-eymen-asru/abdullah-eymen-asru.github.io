/**
 * ui-sade.js — "Bugün": sıradan kullanıcı için SIFIR SÜRTÜNME ana ekranı (3 saniye kuralı).
 * Üstten alta: tek bakışta hüküm + 4 kademeli yağış çubuğu → Bugünün Zırhı (katmanlar · ayakkabı · çanta · renk) → gün içi kritik an (stilist)
 * → saatlik akış → plan/tercihler (kapalı). Sayılar, formüller ve CLO "Derin analiz" sekmesindedir (ui-uzman.js).
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, cipGrubu, olay, zamanOnce } from "./ui-temel.js";
import { havaKodu } from "./hava-kodlari.js";
import { SENARYOLAR, TOLERANSLAR, CANTA_SECENEKLERI, STIL_SECENEKLERI, KATALOG } from "./cekirdek.js";
import { YAGIS_SEVIYELERI, gunParcasi, saatAnaliz } from "./yagis-fizigi.js";
import { yagisOzeti } from "./ui-hava.js";

const ETIKET_METNI = { g: "su geçirmez", s: "su itici", r: "rüzgâr geçirmez", k: "kaymaz taban", p: "çantaya girer", t: "hızlı kurur", n: "nefes alır", h: "katlanır" };
const ETIKET_SIRASI = ["g", "s", "r", "k", "p", "t", "n", "h"];
function ozellikMetni(id, en = 3) {
  const e = KATALOG[id]?.etiket;
  if (!e) return "";
  const l = [];
  for (const k of ETIKET_SIRASI) { if (!e.has(k)) continue; if (k === "s" && e.has("g")) continue; l.push(ETIKET_METNI[k]); }
  return l.slice(0, en).join(" · ");
}

/** Sabah/öğle/akşam planından tek cümlelik "gün içi değişim" notu (hepsi aynıysa not yok: sabit bir gün). */
function degisimNotu(s) {
  const zp = s.zamanPlani || [];
  if (zp.length < 2) return "";
  const degisen = zp.slice(1).find((x) => x.tur !== zp[0].tur);
  if (!degisen) return "";
  const gp = gunParcasi(degisen.saat);
  return degisen.tur === "ekle" ? `${gp[0].toUpperCase()}${gp.slice(1)} serinliyor: dış katı kapat.` : degisen.tur === "cikar" ? `${gp[0].toUpperCase()}${gp.slice(1)} ısınıyor: orta katı çantaya at.` : "";
}

/* ------------------------------ 1) hüküm + yağış çubuğu ------------------------------ */
function yagisCubugu(f) {
  const hucreler = YAGIS_SEVIYELERI.map((sv) => el("div", { class: `hv-olcer-hucre s${sv.id}${sv.id <= f.seviye ? " dolu" : ""}${sv.id === f.seviye ? " aktif" : ""}` },
    el("span", { class: "hv-olcer-blok", "aria-hidden": "true" }), el("span", { class: "hv-olcer-ad", text: sv.kisa })));
  return el("div", { class: "hv-olcer-kutu" },
    el("div", { class: "hv-olcer", role: "img", "aria-label": `Yağış seviyesi: ${f.seviyeAd}` }, ...hucreler),
    el("p", { class: "hv-olcer-yazi" }, el("strong", { text: f.seviyeAd }), f.aralik ? el("span", { text: ` · ${f.gun === "yarın" ? "yarın " : ""}${f.aralik}` }) : null),
    f.seviye > 0 ? el("p", { class: "hv-ipucu", text: f.benzetme }) : null);
}

function hukumKarti(d, kb) {
  const h = d.hava, s = d.sonuc, f = d.fizik;
  const hk = havaKodu(h.kod, h.isDay);
  const g = h.gunluk?.[f.gun === "yarın" ? 1 : 0];
  const yenile = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", "aria-label": "Hava durumunu yenile", text: "↻" }), "click", () => kb.yenile(true));
  const not = degisimNotu(s);
  const simdiYagis = f.gun === "yarın" && (h.saatListe?.[0] && saatAnaliz(h.saatListe[0]).seviye >= 1) ? yagisOzeti(h) : null;
  return el("section", { class: `hv-kart hv-hukumkart ton-${f.ton}` },
    el("div", { class: "hv-hukum-ust" },
      el("span", { class: "hv-hukum-simdi", text: `${hk.ikon} ${d.konum.ad} · şimdi ${h.apparent}° ${hk.ad.toLowerCase()}` }), yenile),
    el("p", { class: "hv-hukum-baslik", "aria-live": "polite", text: f.baslik }),
    el("p", { class: "hv-hukum-alt", text: [f.alt, not].filter(Boolean).join(" ") }),
    yagisCubugu(f),
    simdiYagis ? el("p", { class: "hv-ipucu", text: `Şu an: ${simdiYagis}` }) : null,
    el("small", { class: "hv-ipucu", text: `${g ? `${f.gun === "yarın" ? "Yarın" : "Bugün"} ${g.min}°–${g.max}° · ` : ""}${h.onbellek ? "önbellek · " : ""}${zamanOnce(h.alinma || Date.now())}${h.eski ? " · ÇEVRİMDIŞI son bilinen veri" : ""}` }));
}

/* ------------------------------ 2) haber uyarı bandı (varsa) ------------------------------ */
function kapsamMetni(u) { return u.kapsam === "sokak" ? `${u.kapsamAd} sokağı` : u.kapsam === "mahalle" ? `${u.kapsamAd} mahallesi` : u.kapsam === "ilce" ? `${u.kapsamAd} ilçesi` : u.kapsam === "il" ? `${u.kapsamAd}` : u.kapsam === "bolge" ? `${u.kapsamAd} bölgesi` : `${u.kapsamAd} geneli`; }
function uyariBandi(d, kb) {
  const hb = d.haber;
  if (hb?.durum === "ok" && hb.uygulananlar.length) {
    return kart("hv-uyari-bandi", ...hb.uygulananlar.slice(0, 2).map((u) => el("div", { class: "hv-band-satir" }, el("span", { class: "hv-band-ikon", text: u.kurallar[0].ikon }), el("div", {}, el("strong", { text: u.baslik }), el("small", { text: `${u.kurum || u.kaynakAd} · ${u.kurallar[0].etiket} · ${kapsamMetni(u)}` })))),
      olay(el("button", { type: "button", class: "hv-baglanti", text: "Ayrıntı ve ne yapmalı" }), "click", () => kb.sekmeGit("haber")));
  }
  return null;
}

/* ------------------------------ 3) Bugünün Zırhı ------------------------------ */
function katmanSatiri(sira, rol, p, not) {
  return el("div", { class: `hv-katman k${sira}${p ? "" : " bos"}` },
    el("span", { class: "hv-katman-rol", text: rol }),
    el("strong", { class: "hv-katman-ad", text: p ? p.ad : "Gerekmiyor" }),
    not ? el("small", { class: "hv-ipucu", text: not }) : null);
}

function zirhPaneli(d, kb) {
  const s = d.sonuc, no = Math.min(d.kombinNo, s.kombinler.length - 1), k = s.kombinler[no], p = k.parcalar;
  const cikanSaat = (s.zamanPlani || []).find((z) => z.tur === "cikar");
  const icNot = [d.tercih.sen === "yuruyus_ofis" ? "ofiste de rahat" : "", ozellikMetni(p.b?.id, 2)].filter(Boolean).join(" · ");
  const ortaNot = p.m ? (cikanSaat ? `${gunParcasi(cikanSaat.saat)} ısınınca çıkar, çantaya girer` : ozellikMetni(p.m.id, 2)) : "";
  const disNot = p.o ? ozellikMetni(p.o.id, 3) : "";
  const baska = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🎲 Başka kombin" }), "click", () => kb.tercihDegis({ tohumKaydir: (d.tercih.tohumKaydir || 0) + 1 }));

  const onemli = [...s.ekstralar.filter((e) => e.oncelik === "sart"), ...s.ekstralar.filter((e) => e.oncelik === "iyi")].slice(0, 6);
  const canta = onemli.length
    ? el("div", { class: "hv-zirh-blok" }, el("span", { class: "hv-zirh-baslik", text: "Çantaya at / yanına al" }),
      el("div", { class: "hv-parca-cipleri" }, ...onemli.map((e) => { const r = rozet(`${e.ikon} ${e.ad.replace(/\s*\(.*\)$/, "")}`, e.oncelik === "sart" ? "hv-rozet-onemli" : ""); r.title = e.neden; return r; })))
    : null;

  return kart("hv-zirh",
    bolumBasligi("Bugünün Zırhı", baska),
    el("div", { class: "hv-katmanlar" },
      katmanSatiri(0, "İç kat", p.b, icNot),
      katmanSatiri(1, "Çıkarılabilir orta kat", p.m, ortaNot),
      katmanSatiri(2, "Koruyucu dış kabuk", p.o, disNot)),
    el("div", { class: "hv-zirh-iki" },
      el("div", { class: "hv-zirh-blok" }, el("span", { class: "hv-zirh-baslik", text: "Alt giyim" }), el("strong", { text: p.p?.ad || "—" })),
      el("div", { class: "hv-zirh-blok" }, el("span", { class: "hv-zirh-baslik", text: "Ayakkabı" }), el("strong", { text: p.a?.ad || "—" }))),
    el("p", { class: "hv-zirh-zemin", text: s.ayakkabi }),
    canta,
    el("p", { class: "hv-zirh-renk", text: s.renk }),
    s.kacin.length ? el("div", { class: "hv-parca-cipleri" }, ...s.kacin.map((x) => rozet(`Giyme: ${x}`, "hv-rozet-yasak"))) : null);
}

/* ------------------------------ 4) gün içi kritik an (stilist) ------------------------------ */
function krizKarti(d, kb) {
  const k = d.kriz;
  const metin = el("p", { class: "hv-kriz-metin" });
  const alt = el("small", { class: "hv-ipucu" });
  const hata = el("p", { class: "hv-uyari" });
  const boya = () => {
    const a = d.ai;
    metin.textContent = a.metin || "…";
    alt.textContent = a.etiket || "";
    hata.textContent = a.hata || "";
    hata.hidden = !a.hata;
  };
  boya();
  kb.aiYenileEkran = boya;
  const kutu = el("input", { type: "checkbox", id: "hv-ai-modu" });
  kutu.checked = d.aiModu;
  olay(kutu, "change", () => kb.aiModu(kutu.checked));
  return kart(`hv-kriz${k?.var ? " var" : ""}`,
    bolumBasligi("Gün içi kritik an", k?.var ? rozet(`${String(k.saat).padStart(2, "0")}:00`, "hv-rozet-onemli") : null),
    metin, alt, hata,
    el("label", { class: "hv-onay hv-ai-anahtar", for: "hv-ai-modu" }, kutu, el("span", { text: "Yapay zekâ stilist (isteğe bağlı): kritik anı yorumlasın. Kapalıyken hiçbir yapay zekâ isteği yapılmaz." })),
    d.aiModu ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Yeniden yorumla" }), "click", () => kb.aiYorumIste(true)) : null);
}

/* ------------------------------ 5) saatlik akış ------------------------------ */
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
  return kart("hv-kucuk", bolumBasligi("Gün içi akış", olay(el("button", { type: "button", class: "hv-baglanti", text: "48 saatlik matris" }), "click", () => kb.sekmeGit("derin"))),
    el("div", { class: "hv-saat-serit" }, ...hucreler));
}

/* ------------------------------ 6) plan + tercihler (kapalı) ------------------------------ */
function planKutusu(d, kb) {
  const ozet = `${SENARYOLAR[d.tercih.sen].ad} · ${TOLERANSLAR[d.tercih.tol]} · ${CANTA_SECENEKLERI[d.tercih.canta]}`;
  const det = el("details", { class: "hv-kart hv-kucuk hv-plan", open: d.planAcik ? true : null },
    el("summary", {}, el("span", { class: "hv-plan-baslik", text: "Planın ve tercihlerin" }), el("small", { class: "hv-ipucu", text: ozet })),
    cipGrubu({ baslik: "Bugünkü planın", secenekler: Object.entries(SENARYOLAR).map(([k, v]) => [k, v.ad]), aktif: () => d.tercih.sen, onSec: (v) => kb.tercihDegis({ sen: v }) }).kok,
    ipucu(SENARYOLAR[d.tercih.sen].ipucu),
    el("div", { class: "hv-iki-sutun" },
      cipGrubu({ baslik: "Sıcaklık algın", secenekler: Object.entries(TOLERANSLAR).map(([k, v]) => [Number(k), v]), aktif: () => d.tercih.tol, onSec: (v) => kb.tercihDegis({ tol: v }), kucuk: true }).kok,
      cipGrubu({ baslik: "Çantan", secenekler: Object.entries(CANTA_SECENEKLERI), aktif: () => d.tercih.canta, onSec: (v) => kb.tercihDegis({ canta: v }), kucuk: true }).kok),
    cipGrubu({ baslik: "Tarz", secenekler: Object.entries(STIL_SECENEKLERI), aktif: () => d.tercih.stil, onSec: (v) => kb.tercihDegis({ stil: v }), kucuk: true }).kok);
  olay(det, "toggle", () => { d.planAcik = det.open; });
  return det;
}

/* ------------------------------ sekme ------------------------------ */
export function bugunSekmesi(d, kb) {
  if (!d.hava || !d.sonuc || !d.fizik) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  return el("div", { class: "hv-sekme-govde" },
    hukumKarti(d, kb), uyariBandi(d, kb), zirhPaneli(d, kb), krizKarti(d, kb), akisSeridi(d, kb), planKutusu(d, kb),
    el("div", { class: "hv-btn-satir" }, olay(el("button", { type: "button", class: "hv-btn", text: "🔬 Derin analiz ve uzman görünümü" }), "click", () => kb.sekmeGit("derin"))));
}
