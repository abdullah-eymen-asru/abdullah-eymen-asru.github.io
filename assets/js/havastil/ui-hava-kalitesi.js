/*
 * ui-hava-kalitesi.js — HavaStil › Derin analiz › "Hava kalitesi" (açılır/kapanır panel) + "Resmî ölçüm" kartı.
 * Kapalıyken tek satır: seviye + tek cümlelik öneri + veri kaynağı. Açılınca: yaşam önerileri, her kirletici için sade Türkçe ad + açıklama +
 * renkli seviye, saat saat gidişat ve verinin nereden geldiği. Ekranda ham kısaltma ya da çıplak birim YOKTUR (kirletici.js sözlüğü).
 * Seçili gün bugünse "şu an" (istasyon varsa istasyon ölçümü), ileri günlerse model tahmininin O GÜNKÜ en yüksek saati gösterilir.
 * CSP: inline stil/işleyici yok; dinamik ölçüler CSSOM ile.
 */
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { KIRLETICILER, SEVIYELER, seviye, rehberYuzde, doluluk, degerMetni, genelDurum, eaqiIndeks, tavsiyeler, KIRLETICI } from "./kirletici.js";

const yuvarla1 = (x) => Math.round(x * 10) / 10;
const dakikaOnce = (iso) => {
  const dk = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return dk < 2 ? "az önce" : dk < 90 ? `${dk} dk önce` : `${Math.round(dk / 60)} sa önce`;
};
const km = (x) => (x == null ? "" : ` · ${String(x).replace(".", ",")} km`);

/** Seçili gün için kirletici değerleri. Bugün → şu anki (istasyon/model) değerler; ileri gün → modelin o günkü en yüksek saati; veri yoksa null. */
export function gunDegerleri(kalite, tarih, bugunMu) {
  if (!kalite) return null;
  if (bugunMu && kalite.degerler) return { degerler: kalite.degerler, kaynaklar: kalite.kaynaklar || {}, etiket: "şu an", genelIdx: kalite.genelIdx, baskin: kalite.baskin, genelKaynak: kalite.genelKaynak };
  const s = kalite.saatlik;
  if (!s?.t || !tarih) return null;
  const idx = s.t.map((t, i) => (t.startsWith(tarih) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const degerler = {}, kaynaklar = {};
  for (const k of KIRLETICILER) {
    const v = idx.map((i) => s[k.id]?.[i]).filter(Number.isFinite);
    if (v.length) { degerler[k.id] = yuvarla1(Math.max(...v)); kaynaklar[k.id] = { tur: "model" }; }
  }
  const g = genelDurum(degerler);
  return { degerler, kaynaklar, etiket: "gün içi en yüksek", genelIdx: g?.idx ?? null, baskin: g?.baskin ?? null, genelKaynak: "model" };
}

function seviyeBandi(idx) {
  const b = el("span", { class: "hv-hk-bant", "aria-hidden": "true" });
  SEVIYELER.forEach((_, i) => { const p = el("span", { class: i === idx ? "aktif" : null }); p.dataset.s = String(i); b.append(p); });
  return b;
}
function kaynakRozeti(k) {
  if (k?.tur === "istasyon") return el("span", { class: "hv-hk-kaynak ist", title: `${k.kurum ? `${k.kurum} · ` : ""}${k.zaman ? dakikaOnce(k.zaman) : ""}`, text: `📡 İstasyon ölçümü${km(k.mesafeKm)}` });
  return el("span", { class: "hv-hk-kaynak", title: "Copernicus CAMS atmosfer modeli (Open-Meteo)", text: "🛰️ Model tahmini" });
}

function kirleticiKutusu(k, v, kaynak, etiket) {
  const sv = seviye(k.id, v);
  const kutu = el("div", { class: "hv-hk-kirletici" });
  if (!sv) {
    kutu.append(el("div", { class: "hv-hk-k-ust" }, el("span", { class: "hv-hk-k-ikon", "aria-hidden": "true", text: k.ikon }), el("strong", { text: k.ad })),
      el("small", { class: "hv-hk-k-acik", text: k.aciklama }), el("small", { class: "hv-hk-yok", text: "Bu bölge ve gün için ölçüm ya da tahmin yok." }));
    return kutu;
  }
  kutu.dataset.s = String(sv.idx);
  const dolu = el("span", { class: "hv-hk-dolu" }); dolu.style.width = `${Math.round(Math.max(0.04, doluluk(k.id, v)) * 100)}%`;
  const y = rehberYuzde(k.id, v);
  kutu.append(
    el("div", { class: "hv-hk-k-ust" }, el("span", { class: "hv-hk-k-ikon", "aria-hidden": "true", text: k.ikon }), el("strong", { text: k.ad }), el("span", { class: "hv-hk-chip", text: sv.ad })),
    el("small", { class: "hv-hk-k-acik", text: k.aciklama }),
    el("span", { class: "hv-hk-cubuk", role: "img", "aria-label": `${k.ad}: ${sv.ad}` }, dolu),
    el("small", { class: "hv-hk-k-deger", text: [y == null ? null : y <= 100 ? `Dünya Sağlık Örgütü rehber sınırının %${y}'i` : `Dünya Sağlık Örgütü rehber sınırının ${String(Math.round(y / 10) / 10).replace(".", ",")} katı`, `${etiket}: ${degerMetni(k.id, v)}`].filter(Boolean).join(" · ") }),
    el("small", { class: "hv-hk-k-kaynak" }, kaynakRozeti(kaynak)),
    el("small", { class: "hv-ipucu", text: k.resmiIndeksYok ? "Çöl tozu için resmî bir seviye ölçeği yoktur; renkler HavaStil'in kendi ölçeğidir." : null }));
  if (!k.resmiIndeksYok) kutu.lastElementChild.remove();
  return kutu;
}

function saatSeridi(kalite, tarih, simdiT) {
  const s = kalite?.saatlik; if (!s?.t) return null;
  const idx = s.t.map((t, i) => (t.startsWith(tarih) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 6) return null;
  const sutunlar = idx.map((i) => {
    const v = s.eaqi?.[i], sx = eaqiIndeks(v), c = el("span", { class: `hv-hk-saat${s.t[i] === simdiT ? " simdi" : ""}`, title: `${s.t[i].slice(11, 16)} · ${sx == null ? "veri yok" : SEVIYELER[sx].ad}` });
    if (sx == null) c.classList.add("bos"); else { c.dataset.s = String(sx); c.style.height = `${18 + ((sx + 1) / 6) * 82}%`; }
    return c;
  });
  const etk = (i) => s.t[idx[Math.min(i, idx.length - 1)]].slice(11, 13);
  return el("div", { class: "hv-hk-gidisat" },
    el("strong", { class: "hv-hk-alt-baslik", text: "Gün boyunca hava kalitesi" }),
    el("div", { class: "hv-hk-saatler", role: "img", "aria-label": "Saat saat hava kalitesi seviyesi" }, ...sutunlar),
    el("div", { class: "hv-hk-saat-etiket" }, el("span", { text: `${etk(0)}:00` }), el("span", { text: `${etk(6)}:00` }), el("span", { text: `${etk(12)}:00` }), el("span", { text: `${etk(18)}:00` }), el("span", { text: `${etk(23)}:00` })),
    el("small", { class: "hv-ipucu", text: "Yüksek sütun = daha kötü hava. Renk ne kadar sıcaksa (yeşilden kırmızıya) kirlilik o kadar fazladır." }));
}

function oneriler(gd) {
  const t = tavsiyeler(gd.genelIdx, gd.baskin);
  const satir = (ikon, ad, yazi) => el("li", {}, el("span", { class: "hv-hk-o-ikon", "aria-hidden": "true", text: ikon }), el("span", {}, el("strong", { text: `${ad} ` }), yazi));
  return el("div", { class: "hv-hk-oneri" },
    el("strong", { class: "hv-hk-alt-baslik", text: "Ne yapmalı?" }),
    el("ul", {}, satir("🧑", "Herkes:", t.genel), satir("🫶", "Hassas kişiler:", t.hassas), satir("🏃", "Spor:", t.spor), satir("🪟", "Pencere:", t.pencere), satir("😷", "Maske:", t.maske)),
    t.baskinNot ? el("p", { class: "hv-hk-baskin", text: t.baskinNot }) : null);
}

function kaynakBolumu(kalite, gd, bugunMu) {
  const ist = kalite?.istasyonlar || [];
  const satirlar = [];
  if (bugunMu && ist.length) {
    for (const s of ist.slice(0, 3)) satirlar.push(el("li", { text: `${s.ad}${km(s.mesafeKm)} · ${s.zaman ? dakikaOnce(s.zaman) : ""}${s.kurum ? ` · ${s.kurum}` : ""}` }));
  }
  return el("details", { class: "hv-hk-kaynak-bolum" },
    el("summary", { text: "Bu veriler nereden geliyor?" }),
    el("ul", { class: "hv-hk-kaynak-liste" },
      el("li", { text: bugunMu
        ? (gd.genelKaynak === "istasyon" ? "Şu anki değerler, konumuna en yakın resmî ölçüm istasyonundan alındı; istasyonun ölçmediği kirleticiler için atmosfer modeli kullanıldı." : "Konumuna yakın taze bir resmî istasyon ölçümü bulunamadı; değerler atmosfer modelinden (Copernicus CAMS) geliyor.")
        : "İleri günler yalnızca atmosfer modelinden (Copernicus CAMS) gelir; ölçüm istasyonları geleceği bilemez. Model en fazla 4 gün ileriyi verir." }),
      ...satirlar,
      el("li", { text: "Seviyeler Avrupa Çevre Ajansı'nın 6 kademeli hava kalitesi ölçeğine, yüzdeler Dünya Sağlık Örgütü 2021 rehber sınırlarına göre hesaplanır. Karbonmonoksit için Avrupa'da ölçek yoktur; Dünya Sağlık Örgütü ve AB sınırları kullanılır." }),
      el("li", { text: "Kaynak sırası: önce resmî ölçüm istasyonları (OpenAQ üzerinden ülkelerin resmî ağları), olmazsa model. Anahtar ve kaynak ayarları: Doğrulama & Ayar › Ayarlar › Hava veri kaynakları." })));
}

/**
 * Açılır "Hava kalitesi" paneli. tarih: seçili günün YYYY-MM-DD'si; bugunMu: seçili gün bugün mü.
 * Açık/kapalı durumu d.hkAcik'te tutulur (sekme yeniden çizilse de korunur); tıklama yalnızca bu paneli günceller, sayfa zıplamaz.
 */
export function havaKalitesiKarti(d, tarih, bugunMu) {
  const kalite = d.hava?.kalite;
  const gd = gunDegerleri(kalite, tarih, bugunMu);
  const kok = el("section", { class: "hv-kart hv-hk" });
  if (!gd || (!Object.keys(gd.degerler).length)) {
    kok.append(bolumBasligi("🌬️ Hava kalitesi"), ipucu(bugunMu || !kalite ? "Bu konum için hava kalitesi verisi alınamadı. Birkaç dakika sonra yenile (⟳)." : "Bu gün için hava kalitesi tahmini yok; model en fazla 4 gün ileriyi verir."));
    return kok;
  }
  const idx = gd.genelIdx ?? 1, sv = SEVIYELER[idx];
  kok.dataset.s = String(idx);
  const t = tavsiyeler(idx, gd.baskin);
  const acik = d.hkAcik === true;
  const govdeId = `hv-hk-govde-${tarih || "x"}`;
  const kaynak = gd.genelKaynak === "istasyon" ? kalite.istasyonlar?.[0] : null;
  const baslik = el("button", { type: "button", class: "hv-hk-baslik", "aria-expanded": String(acik), "aria-controls": govdeId },
    el("span", { class: "hv-hk-ikon", "aria-hidden": "true", text: "🌬️" }),
    el("span", { class: "hv-hk-metin" },
      el("span", { class: "hv-hk-ad", text: bugunMu ? "Hava kalitesi" : "Hava kalitesi (tahmin)" }),
      el("strong", { class: "hv-hk-seviye", text: sv.ad }),
      el("span", { class: "hv-hk-ozet", text: t.genel })),
    el("span", { class: "hv-hk-sag" }, kaynakRozeti(gd.genelKaynak === "istasyon" ? { tur: "istasyon", mesafeKm: kaynak?.mesafeKm } : { tur: "model" }), el("span", { class: "hv-hk-ok", "aria-hidden": "true", text: "▾" })),
    seviyeBandi(idx));
  const kutular = KIRLETICILER.map((k) => kirleticiKutusu(k, gd.degerler[k.id], gd.kaynaklar[k.id], gd.etiket));
  const ic = el("div", { class: "hv-hk-ic" },
    oneriler(gd),
    el("div", { class: "hv-hk-izgara" }, ...kutular),
    saatSeridi(kalite, tarih, d.hava?.saatListe?.[0]?.t),
    kaynakBolumu(kalite, gd, bugunMu));
  const govde = el("div", { class: "hv-hk-govde", id: govdeId, role: "region", "aria-label": "Hava kalitesi ayrıntıları" }, ic);
  if (!acik) ic.setAttribute("inert", "");
  kok.classList.toggle("acik", acik);
  olay(baslik, "click", () => {
    d.hkAcik = !(d.hkAcik === true);
    kok.classList.toggle("acik", d.hkAcik);
    baslik.setAttribute("aria-expanded", String(d.hkAcik));
    if (d.hkAcik) ic.removeAttribute("inert"); else ic.setAttribute("inert", "");
  });
  kok.append(baslik, govde);
  return kok;
}

/** "Resmî ölçüm" kartı: en yakın resmî istasyonun ŞİMDİ ölçtükleri + modelle fark. Gözlem yoksa hiç çizilmez (ekran sade kalır). */
export function gozlemKarti(d) {
  const g = d.hava?.gozlem, h = d.hava;
  if (!g) return null;
  const yon = (x) => (x == null ? "" : ["kuzey", "kuzeydoğu", "doğu", "güneydoğu", "güney", "güneybatı", "batı", "kuzeybatı"][Math.round(x / 45) % 8]);
  const kutu = (ad, deger, alt) => el("div", { class: "hv-metrik" }, el("span", { class: "hv-metrik-baslik", text: ad }), el("strong", { text: deger }), alt ? el("small", { text: alt }) : null);
  const fark = g.sicaklik != null && Number.isFinite(h.raw) ? Math.round((g.sicaklik - h.raw) * 10) / 10 : null;
  const farkYazi = fark == null ? null : Math.abs(fark) < 0.8 ? "Tahmin modeliyle uyumlu." : `Ölçüm, tahmin modelinden ${String(Math.abs(fark)).replace(".", ",")}° ${fark > 0 ? "daha sıcak" : "daha soğuk"}.`;
  const kok = kart("hv-gozlem", bolumBasligi("📡 Resmî ölçüm"));
  kok.append(
    el("p", { class: "hv-uzman-ne", text: `${g.ad}${km(g.mesafeKm)} · ${dakikaOnce(g.zaman)} · ${g.saglayici === "mgm" ? "Meteoroloji Genel Müdürlüğü" : "havalimanı resmî rasadı"}` }),
    el("div", { class: "hv-detay-grid" },
      g.sicaklik != null ? kutu("Sıcaklık", `${g.sicaklik}°`, g.hissedilen != null ? `Hissedilen ${g.hissedilen}°` : null) : null,
      g.nem != null ? kutu("Nem", `%${g.nem}`, g.cig != null ? `Çiğ noktası ${g.cig}°` : null) : null,
      g.ruzgar != null ? kutu("Rüzgâr", `${g.ruzgar} km/s`, [g.yon != null ? `${yon(g.yon)} yönünden` : null, g.hamle ? `hamle ${g.hamle} km/s` : null].filter(Boolean).join(" · ") || null) : null,
      g.basinc != null ? kutu("Hava basıncı", `${g.basinc} hPa`, null) : null,
      g.gorus != null ? kutu("Görüş mesafesi", g.gorus >= 10000 ? "10 km+" : `${Math.round(g.gorus / 100) / 10} km`.replace(".", ","), null) : null),
    ...(farkYazi ? [el("p", { class: "hv-ipucu", text: `${farkYazi} Kombin ve yağış kararı tahmin modeliyle verilir; bu kart ölçümle karşılaştırman içindir.` })] : []));
  return kok;
}

export { KIRLETICI };
