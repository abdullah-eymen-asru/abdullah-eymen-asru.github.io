/*
 * ui-hava-kalitesi.js — HavaStil › Derin analiz › "Hava kalitesi" (açılır/kapanır panel) + "Resmî ölçüm" kartı.
 * Kapalıyken tek satır: seviye + tek cümlelik öneri + veri kaynağı. Açılınca: yaşam önerileri, her kirletici için sade Türkçe ad + bilimsel ad ve formül,
 * ölçülen SAYI + birim (örn. 35 µg/m³), altı renkli bandı olan ölçek (işaretçi + her bandın gerçek eşik değeri), Dünya Sağlık Örgütü sınırıyla oran,
 * saat saat gidişat ve verinin nereden geldiği. "İyi/orta/kötü" tek başına yetmez: her zaman sayı ve eşikler de yazılıdır.
 * Seçili gün bugünse "şu an" (istasyon varsa istasyon ölçümü), ileri günlerse model tahmininin O GÜNKÜ en yüksek saati gösterilir.
 * CSP: inline stil/işleyici yok; dinamik ölçüler CSSOM ile.
 */
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { KIRLETICILER, SEVIYELER, seviye, rehberYuzde, doluluk, degerSayisi, sinirlar, rehberMetni, bilimselAd, genelDurum, eaqiIndeks, tavsiyeler, KIRLETICI } from "./kirletici.js";
import { olcumKarti } from "./ui-olcum.js";
import { sonCekilme, zamanYazisi } from "./ui-zaman.js";

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
  return el("span", { class: "hv-hk-kaynak", title: "Ölçüm değil: Copernicus CAMS atmosfer modelinin hesapladığı tahmin (Open-Meteo üzerinden)", text: "🛰️ Model tahmini" });
}

function olcekCubugu(k, v, sv) {
  const bantlar = SEVIYELER.map((_, i) => { const b = el("span", { class: "hv-hk-bant-parca" }); b.dataset.s = String(i); if (i === sv.idx) b.classList.add("aktif"); return b; });
  const isaret = el("span", { class: "hv-hk-isaret", "aria-hidden": "true" }); isaret.style.left = `${Math.round(Math.min(0.985, Math.max(0.015, doluluk(k.id, v))) * 1000) / 10}%`;
  const sn = sinirlar(k.id);
  const etiketler = el("div", { class: "hv-hk-sinirlar", "aria-hidden": "true" }, ...sn.map((x, i) => { const e = el("span", { text: x.ust.replace(/ (µg|mg)\/m³$/, "") }); e.dataset.s = String(i); return e; }));
  return el("div", { class: "hv-hk-olcek" },
    el("div", { class: "hv-hk-cubuk", role: "img", "aria-label": `${k.ad}: ${sv.ad}. Seviye sınırları: ${sn.map((x) => `${x.ad} ${x.ust}`).join(", ")}` }, ...bantlar, isaret), etiketler);
}

/** Kutunun altındaki küçük not: ölçüm saati (istasyon) ya da "model tahmini" + verinin çekildiği an. İleri günlerde çekilme saati yazılmaz (tahmin zaten model). */
function zamanNotu(kaynak, etiket, alinma) {
  if (etiket !== "şu an") return null;
  const t = kaynak?.tur === "istasyon" ? (kaynak.alinma || alinma) : alinma;
  const olcum = kaynak?.tur === "istasyon" && kaynak.zaman ? `Ölçüm saati ${new Date(Date.parse(kaynak.zaman)).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · ` : kaynak?.tur === "istasyon" ? "" : "Hesaplanmış tahmin · ";
  return t ? el("small", { class: "hv-hk-k-zaman muted", text: `🕒 ${olcum}çekildi ${zamanYazisi(t)}` }) : null;
}

function kirleticiKutusu(k, v, kaynak, etiket, alinma) {
  const sv = seviye(k.id, v), sayi = degerSayisi(k.id, v);
  const kutu = el("div", { class: "hv-hk-kirletici" });
  const adBlok = el("span", { class: "hv-hk-k-adlar" }, el("strong", { text: k.ad }), el("small", { class: "hv-hk-bilimsel", text: bilimselAd(k.id) }));
  if (!sv || !sayi) {
    kutu.append(el("div", { class: "hv-hk-k-ust" }, el("span", { class: "hv-hk-k-ikon", "aria-hidden": "true", text: k.ikon }), adBlok),
      el("small", { class: "hv-hk-k-acik", text: k.aciklama }), el("small", { class: "hv-hk-yok", text: "Bu bölge ve gün için ölçüm ya da tahmin yok." }));
    return kutu;
  }
  kutu.dataset.s = String(sv.idx);
  const y = rehberYuzde(k.id, v), rehber = rehberMetni(k.id);
  const oran = y == null ? null : y <= 100 ? `Rehber sınırının %${y}'i (sınır altında)` : `Rehber sınırının ${String(Math.round(y / 10) / 10).replace(".", ",")} katı (sınır aşıldı)`;
  kutu.append(
    el("div", { class: "hv-hk-k-ust" }, el("span", { class: "hv-hk-k-ikon", "aria-hidden": "true", text: k.ikon }), adBlok, el("span", { class: "hv-hk-chip", text: sv.ad })),
    el("small", { class: "hv-hk-k-acik", text: k.aciklama }),
    el("div", { class: "hv-hk-k-sayi" }, el("strong", { class: "hv-hk-k-buyuk", text: sayi.sayi }), el("span", { class: "hv-hk-k-birim", text: sayi.birim }), el("span", { class: "hv-hk-k-etiket", text: etiket })),
    olcekCubugu(k, v, sv),
    el("small", { class: "hv-hk-k-deger", text: rehber ? `Dünya Sağlık Örgütü rehber sınırı ${rehber}${oran ? ` · ${oran}` : ""}` : "Bu madde için Dünya Sağlık Örgütü rehber sınırı yoktur." }),
    el("small", { class: "hv-hk-k-kaynak" }, kaynakRozeti(kaynak)),
    zamanNotu(kaynak, etiket, alinma),
    ...(k.resmiIndeksYok ? [el("small", { class: "hv-ipucu", text: "Çöl tozu için resmî bir seviye ölçeği yoktur; bantlar HavaStil'in kendi ölçeğidir." })] : []));
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

/** "Neden istasyon değil de model?" — teşhis kayıtlarından sade Türkçe bir cümle. Vitrin/misafirde istasyon kaynakları hakkında HİÇBİR şey söylenmez. */
function modelNedeni(d, gd, bugunMu) {
  if (!bugunMu || gd.genelKaynak === "istasyon" || d.vitrin || d.misafir) return null;
  const t = (d.hava?.kaynakTeshis || []).find((x) => x.kaynak === "openaq");
  if (!t) return "Bu oturumda resmî istasyon kaynakları kullanılmadı (kapalı ya da giriş gerekli); bu yüzden model gösteriliyor.";
  if (t.kapali) return "Yönetici istasyon kaynağını kapattığı için model gösteriliyor.";
  if (t.anahtarYok) return "İstasyon verisi için OpenAQ anahtarı tanımlı değil; bu yüzden model gösteriliyor. (Ayarlar › Veri kaynakları)";
  if (!t.ok) return `İstasyon kaynağına (OpenAQ) ulaşılamadı (${t.not}); bu yüzden model gösteriliyor.`;
  return "Konumunun yakınında şu an ölçüm yapan istasyon bulunamadı. OpenAQ'da Türkiye için istasyon sayısı sınırlıdır; bu yüzden model gösteriliyor.";
}

/** Model değerleri gösterildiğinde (ya da ileri günde) KAPALI açıklama yerine görünür kısa not + "Model tahmini nedir?" açılırı. */
function modelBilgi(d, gd, bugunMu) {
  const modelVar = !bugunMu || Object.values(gd.kaynaklar || {}).some((k) => k?.tur === "model");
  if (!modelVar) return null;
  const neden = modelNedeni(d, gd, bugunMu);
  return el("div", { class: "hv-hk-model-bilgi" },
    el("p", { class: "hv-hk-model-ozet" }, el("strong", { text: "🛰️ Model tahmini ne demek? " }), el("span", { text: "Ölçüm değil, Copernicus atmosfer modelinin hesapladığı tahmindir; yaklaşık 10 km'lik bölgenin genel düzeyini verir." })),
    neden ? el("p", { class: "hv-hk-neden", text: neden }) : null,
    el("details", { class: "hv-hk-model-nedir" }, el("summary", { text: "Ayrıntılı açıklama" }), el("ul", { class: "hv-hk-kaynak-liste" }, ...MODEL_NEDIR.map((t) => el("li", { text: t })))));
}

const MODEL_NEDIR = [
  "Model tahmini ölçüm değildir; bilgisayarın hesapladığı bir tahmindir. Avrupa'nın Copernicus (CAMS) atmosfer servisi; uydu gözlemlerini, yer ölçümlerini ve havanın fiziğini birleştirerek her yer için kirletici miktarını hesaplar.",
  "Yaklaşık 10–11 km'lik karelerle çalışır: bir mahalledeki yoğun trafiği ya da tek bir fabrikayı göremez, bölgenin genel düzeyini verir. Yine de 4 gün ileriyi gösterebilen tek kaynaktır.",
  "Yakında gerçek bir istasyon varsa onun ölçümü her zaman modele tercih edilir.",
];

function kaynakBolumu(d, kb, kalite, gd, bugunMu) {
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
      el("li", { text: "Değerler µg/m³ (metreküp havadaki mikrogram) cinsindendir; karbonmonoksit mg/m³ (miligram). Seviyeler Avrupa Çevre Ajansı'nın 6 kademeli hava kalitesi ölçeğine, oranlar Dünya Sağlık Örgütü 2021 rehber sınırlarına göre hesaplanır. Karbonmonoksit için Avrupa'da ölçek yoktur; Dünya Sağlık Örgütü ve AB sınırları kullanılır." }),
      ...(d.vitrin || d.misafir ? [] : [el("li", { text: "Kaynak sırası: önce konumuna yakın ölçüm istasyonları (OpenAQ), olmazsa model. Anahtar ve kaynak ayarları: Doğrulama & Ayar › Ayarlar › Veri kaynakları." })])));
}

/**
 * Açılır "Hava kalitesi" paneli. tarih: seçili günün YYYY-MM-DD'si; bugunMu: seçili gün bugün mü.
 * Açık/kapalı durumu d.hkAcik'te tutulur (sekme yeniden çizilse de korunur); tıklama yalnızca bu paneli günceller, sayfa zıplamaz.
 */
export function havaKalitesiKarti(d, tarih, bugunMu, kb) {
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
      el("span", { class: "hv-hk-ozet", text: t.genel }),
      ...(gd.baskin && Number.isFinite(gd.degerler[gd.baskin]) ? [el("small", { class: "hv-hk-baskin-satir", text: `En yüksek: ${KIRLETICI[gd.baskin].ad} · ${degerSayisi(gd.baskin, gd.degerler[gd.baskin]).tam}` })] : [])),
    el("span", { class: "hv-hk-sag" }, kaynakRozeti(gd.genelKaynak === "istasyon" ? { tur: "istasyon", mesafeKm: kaynak?.mesafeKm } : { tur: "model" }), el("span", { class: "hv-hk-ok", "aria-hidden": "true", text: "▾" })),
    seviyeBandi(idx));
  const kutular = KIRLETICILER.map((k) => kirleticiKutusu(k, gd.degerler[k.id], gd.kaynaklar[k.id], gd.etiket, d.hava?.alinma));
  const ic = el("div", { class: "hv-hk-ic" },
    el("div", { class: "hv-hk-cekilmeler" }, bugunMu ? sonCekilme(d, kb, "model") : null, bugunMu ? sonCekilme(d, kb, "openaq") : null),
    oneriler(gd),
    modelBilgi(d, gd, bugunMu),
    el("div", { class: "hv-hk-izgara" }, ...kutular),
    saatSeridi(kalite, tarih, d.hava?.saatListe?.[0]?.t),
    kaynakBolumu(d, kb, kalite, gd, bugunMu));
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

/** Eski ad korunur: Derin analiz bu işlevi çağırır; kart artık ui-olcum.js'te ("Resmî ölçümle doğrulama"). */
export const gozlemKarti = (d, kb) => olcumKarti(d, kb);

export { KIRLETICI };
