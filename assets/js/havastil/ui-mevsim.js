/**
 * ui-mevsim.js — "Mevsimlik eğilim" sekmesi (v5). 16 günün ötesi için hava tahmini DEĞİL, iklim eğilimi: seçilen ayın mevsim normaline (1991–2020)
 * göre beklenen sıcaklık ve yağış sapması (Open-Meteo Climate API, bkz. iklim.js). Takvimden 16 gün ötesi bir güne dokunmak bu sekmeyi o ayla açar.
 */
import { el, kart, ipucu, bolumBasligi, olay, rozet } from "./ui-temel.js";
import { iklimGetir, sapmaHesapla, IKLIM_MODELLERI, NORMAL_BASLANGIC, NORMAL_BITIS, SON_YIL } from "./iklim.js";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const isaret = (x, n = 1) => (x == null ? "—" : `${x > 0 ? "+" : ""}${Number(x).toFixed(n)}`);

function sicYorum(s) { const a = Math.abs(s); const yon = s > 0 ? "sıcak" : "soğuk"; return a < 0.5 ? "mevsim normali civarında" : a < 1.5 ? `normalden biraz ${yon}` : a < 3 ? `normalden belirgin ${yon}` : `normalden çok ${yon}`; }
function yagisYorum(p) { if (p == null) return "yağış normali sıfıra yakın: oran hesaplanamadı"; const a = Math.abs(p); const yon = p > 0 ? "yağışlı" : "kurak"; return a < 10 ? "mevsim normali civarında" : a < 30 ? `normalden biraz ${yon}` : a < 60 ? `normalden belirgin ${yon}` : `normalden çok ${yon}`; }

/** Sıfır çizgisinin iki yanında (pozitif yukarı, negatif aşağı), değer etiketli, tam yıllı sapma grafiği. */
function yilSeridi(seri, secili, alan, birim, esik) {
  const mx = Math.max(esik, ...seri.map((x) => Math.abs(x[alan] ?? 0)));
  const hane = alan === "sic" ? 1 : 0;
  return el("div", { class: "hv-yilserit", role: "img", "aria-label": `Yıllara göre ${alan === "sic" ? "sıcaklık" : "yağış"} sapması (${birim}): ${seri.map((x) => `${x.yil} ${isaret(x[alan] ?? 0, hane)}`).join(", ")}` }, ...seri.map((x) => {
    const v = x[alan] ?? 0, poz = v >= 0, sec = x.yil === secili;
    const cubuk = el("span", { class: `hv-yilcubuk ${poz ? "poz" : "neg"}${sec ? " secili" : ""}` });
    cubuk.style.height = `${v === 0 ? 0 : Math.max(4, (Math.abs(v) / mx) * 100)}%`;
    const deger = el("small", { class: "hv-yildeger", text: isaret(v, hane) });
    const kap = el("div", { class: "hv-yilkap" }, cubuk);
    return el("div", { class: `hv-yilkolon${sec ? " secili" : ""}`, title: `${x.yil}: ${isaret(v, hane)}${birim}` },
      el("div", { class: "hv-yilust" }, poz ? deger : null, poz ? kap : null),
      el("div", { class: "hv-yilalt" }, poz ? null : kap, poz ? null : deger),
      el("small", { class: "hv-yiletiket", text: `’${String(x.yil).slice(2)}` }));
  }));
}

export function mevsimSekmesi(d, kb) {
  const simdi = new Date();
  const varsayilan = d.mevsimAy || { y: simdi.getMonth() === 11 ? simdi.getFullYear() + 1 : simdi.getFullYear(), m: (simdi.getMonth() + 1) % 12 };
  d.mevsimAy = varsayilan;
  const ayS = el("select", { class: "hv-girdi hv-secim", "aria-label": "Ay" }, ...AYLAR.map((a, i) => el("option", { value: String(i), text: a })));
  const yilS = el("select", { class: "hv-girdi hv-secim", "aria-label": "Yıl" }, ...Array.from({ length: SON_YIL - simdi.getFullYear() + 1 }, (_, i) => simdi.getFullYear() + i).map((y) => el("option", { value: String(y), text: String(y) })));
  ayS.value = String(varsayilan.m); yilS.value = String(varsayilan.y);
  const sonuc = el("div", { class: "hv-mevsim-sonuc" });
  const degis = () => { d.mevsimAy = { y: Number(yilS.value), m: Number(ayS.value) }; yukle(); };
  olay(ayS, "change", degis); olay(yilS, "change", degis);
  const hizli = el("div", { class: "hv-btn-satir" }, ...[1, 2, 3, 6].map((n) => olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: `+${n} ay` }), "click", () => {
    const t = new Date(simdi.getFullYear(), simdi.getMonth() + n, 1); yilS.value = String(t.getFullYear()); ayS.value = String(t.getMonth()); degis();
  })));
  let no = 0;
  async function yukle() {
    const benim = ++no, { y, m } = d.mevsimAy;
    sonuc.replaceChildren(ipucu("İklim modelleri okunuyor… (ilk seferde birkaç saniye sürebilir)"));
    try {
      if (!d.iklim || d.iklim.anahtar !== `${d.konum.lat},${d.konum.lon}`) d.iklim = { anahtar: `${d.konum.lat},${d.konum.lon}`, ...(await iklimGetir(d.konum.lat, d.konum.lon)) };
      if (benim !== no) return;
      const s = sapmaHesapla(d.iklim.aylar, y, m);
      const kutu = (baslik, deger, alt, sinif) => el("div", { class: `hv-ozet-kutu ${sinif}${Array.isArray(deger) ? " hv-ozet-genis" : ""}` }, el("small", { class: "hv-ozet-baslik", text: baslik }),
        Array.isArray(deger) ? el("strong", { class: "hv-ozet-deger hv-ozet-cift" }, ...deger.map((p) => el("span", { class: "hv-ozet-parca", text: p }))) : el("strong", { class: "hv-ozet-deger", text: deger }), el("small", { class: "hv-ozet-alt", text: alt }));
      const sc = Math.abs(s.sicSapma) >= 3 ? "d5" : Math.abs(s.sicSapma) >= 1.5 ? "d4" : Math.abs(s.sicSapma) >= 0.5 ? "d3" : "d1";
      const yc = s.yagisSapmaYuzde == null ? "d1" : Math.abs(s.yagisSapmaYuzde) >= 60 ? "d5" : Math.abs(s.yagisSapmaYuzde) >= 30 ? "d4" : Math.abs(s.yagisSapmaYuzde) >= 10 ? "d3" : "d1";
      sonuc.replaceChildren(
        el("div", { class: "hv-ozet-grid" },
          kutu("Sıcaklık sapması", `${isaret(s.sicSapma)}°C`, `${AYLAR[m]} ${y}: ${sicYorum(s.sicSapma)}`, sc),
          kutu("Yağış sapması", s.yagisSapmaYuzde == null ? "—" : `${isaret(s.yagisSapmaYuzde, 0)}%`, `${isaret(s.yagisSapmaMm, 0)} mm · ${yagisYorum(s.yagisSapmaYuzde)}`, yc),
          kutu("Mevsim normali (sıcaklık)", `${s.normalSic}°C`, `${AYLAR[m]} ayı ortalaması, ${NORMAL_BASLANGIC}–${NORMAL_BITIS}`, "d1"),
          kutu("Mevsim normali (yağış)", `${s.normalYagis} mm`, `${AYLAR[m]} ayı toplamı, ${NORMAL_BASLANGIC}–${NORMAL_BITIS}`, "d1"),
          kutu("Beklenen ay (eğilim)", [`${s.trendSic}°C`, `${s.trendYagis} mm`], `${s.pencereYil} yıllık model penceresi`, "d1")),
        el("h3", { class: "hv-alt-baslik", text: "Sıcaklık sapması · çevre yıllar (°C, normale göre)" }), yilSeridi(s.seri, y, "sic", "°C", 1), el("p", { class: "hv-yil-aciklama", text: "Çizginin üstü normalden sıcak, altı soğuk; çerçeveli sütun seçtiğin yıl." }),
        el("h3", { class: "hv-alt-baslik", text: "Yağış sapması · çevre yıllar (%, normale göre)" }), yilSeridi(s.seri, y, "yagis", "%", 25), el("p", { class: "hv-yil-aciklama", text: "Çizginin üstü normalden yağışlı, altı kurak." }),
        el("p", { class: "hv-anlam" }, el("strong", { text: "Senin için anlamı: " }), el("span", { text: `${AYLAR[m]} ${y} için genel eğilim ${sicYorum(s.sicSapma)} ve ${yagisYorum(s.yagisSapmaYuzde)}. Bu bir günlük hava tahmini değil; hangi gün yağacağını söylemez, yalnızca ayın genel karakterini gösterir.` })),
        el("small", { class: "hv-ipucu", text: `Kaynak: Open-Meteo Climate API (${IKLIM_MODELLERI.join(", ")} ortalaması${d.iklim.onbellek ? " · önbellekten" : ""}).` }));
    } catch (h) {
      if (benim !== no) return;
      sonuc.replaceChildren(el("p", { class: "hv-uyari", text: "İklim eğilimi şu an alınamadı (ağ ya da Open-Meteo Climate API). Biraz sonra tekrar dene." }), olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Tekrar dene" }), "click", () => { d.iklim = null; yukle(); }));
      console.warn("HavaStil iklim:", h);
    }
  }
  yukle();
  return el("div", { class: "hv-sekme-govde" }, kart("hv-mevsim-kart", bolumBasligi("🌍 Mevsimlik eğilim (16 gün ötesi)"),
    el("p", { class: "hv-uyari", text: "16 günün ötesi için saatlik/günlük hava tahmini verilemez (atmosfer kaotiktir; Open-Meteo deterministik sınırı 16 gündür). Burada yalnızca iklim modellerinin seçilen ay için gösterdiği GENEL eğilim var: normalden ne kadar sıcak/soğuk ve yağışlı/kurak." }),
    el("div", { class: "hv-mevsim-secim" }, ayS, yilS), hizli, sonuc,
    rozet(`${d.konum.ad} · iklim ızgarası kabadır (≈ 25 km)`)));
}
