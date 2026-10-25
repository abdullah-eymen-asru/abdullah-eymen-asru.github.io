/**
 * veri-paketi.js — HavaStil v8 · "Günün Veri Paketi" (saf JS + küçük indirme yardımcısı).
 * Derin analizdeki TÜM sayısal verileri (saatlik dahil) tek dosyada toplar; ekran görüntüsü almadan herhangi bir yapay zekâya yapıştırılabilir.
 * Biçimler:
 *   • Markdown (.md)  — ÖNERİLEN: yapay zekâ modelleri tabloyu ve başlıkları en doğru okuyan biçim; açıklamalar ve okuma kılavuzu içinde.
 *   • JSON (.json)    — makine okunur; kod/analiz araçları için.
 *   • Düz metin (.txt)— Markdown'ın aynısı, uzantısı farklı (bazı sohbet uygulamaları yalnızca .txt kabul eder).
 * (PDF bilerek yok: yapay zekâ için tablo metni PDF'ten kötü çıkar ve dosya şişer.)
 * KURALLAR: karar motoruna dokunmaz; yalnızca gün analizlerinden (yagis-fizigi.js) ve veri.js'ten okur. Konum adı ve koordinat dosyaya YAZILIR
 * (kullanıcı kendi cihazından indiriyor); hesap bilgisi, e-posta, API anahtarı asla girmez.
 */
import { gunAnalizleri, saatAnaliz, capeSeviye, efektifSiddet, saatMetniTam } from "./yagis-fizigi.js";
import { hedefClo } from "./cekirdek.js";
import { gunHikayesi, cisentiFiltresiDurumu, uyumGoster } from "./hikaye.js";

const r1 = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100) / 100);
const TUR_AD = { yok: "yok", cise: "çisenti", genis: "yaygın düzenli yağmur", konvektif: "ani sağanak", karma: "karma", kar: "kar" };

function saatSatiri(x, d) {
  const a = saatAnaliz(x);
  const clo = hedefClo({ apparent: x.app, raw: x.temp, precip: x.yagis, hum: x.nem }, d.tercih.tol, d.tercih.sen).clo;
  return {
    saat: saatMetniTam(x.saat), sicaklik_c: x.temp, hissedilen_c: x.app, nem_yuzde: x.nem, cig_noktasi_c: x.cig, basinc_hpa: x.basinc, bulut_yuzde: x.bulut,
    ruzgar_kmh: x.ruzgar, hamle_kmh: x.hamle, ruzgar_yonu_derece: x.yon, uv_indeksi: x.uv,
    yagis_ihtimali_yuzde: a.pop, model_uyumu_yuzde: a.guven, yayilim_yuzde: a.kapsam, ayrisma_tahmini: !!a.tahmini,
    yagis_mm: r2(a.mm), yagmur_mm: r2(a.yagmur), saganak_mm: r2(a.saganak), beklenen_mm: r2(a.E),
    yagis_turu: TUR_AD[a.tur] || a.tur, yagis_seviyesi_0_3: a.seviye, cape_jkg: Math.round(a.cape), cape_bandi: capeSeviye(a.cape).ad,
    taze_kar_cm: a.karli ? r1(a.karCm) : 0, buzlanma_riski: a.buz.ad, yuzey_sicakligi_c: r1(a.yuzey), sifir_izotermi_m: a.donma,
    hava_kodu_wmo: x.kod, gunduz: !!x.gunduz, yalitim_ihtiyaci_clo: r2(clo),
  };
}

/**
 * @param {object} d   havastil durum nesnesi (hava, konum, tercih, sonuc, fizik, haber)
 * @param {number} gi  seçili günün indeksi (0 = bugün)
 * @param {{ekGun?:number}} o  ekGun: seçili günden sonra saatlik tam dökümü eklenecek gün sayısı (0–2)
 */
export function gunVeriPaketi(d, gi = 0, { ekGun = 0 } = {}) {
  const gunler = gunAnalizleri(d.hava.tumSaatler, { canta: d.tercih.canta, rakim: d.hava.rakim });
  const i = Math.min(Math.max(0, gi), gunler.length - 1), G = gunler[i];
  const gunPaket = (g, tam) => {
    const f = g.fizik, h = gunHikayesi(g), c = cisentiFiltresiDurumu(f);
    const an = g.saatler.map(saatAnaliz);
    const zi = an.reduce((m, x, k) => (x.pop > (an[m]?.pop ?? -1) ? k : m), 0), zirve = an[zi];
    return {
      tarih: g.tarih,
      ozet_cumle: [h.cumle, h.miktar].filter(Boolean).join(" "),
      yagis_seviyesi: f.seviyeAd, yagis_turu: TUR_AD[f.tur] || f.tur, yagis_penceresi: f.aralik,
      en_yuksek_yagis_ihtimali_yuzde: f.enYuksekPop, ihtimalin_zirve_saati: zirve?.pop >= 5 ? saatMetniTam(g.saatler[zi].saat) : null,
      zirvede_model_uyumu_yuzde: zirve?.guven ?? null, zirvede_yayilim_yuzde: zirve?.kapsam ?? null,
      toplam_yagis_mm: f.toplamMm, beklenen_yagis_mm: f.beklenenMm, beklenen_yagis_siddeti: efektifSiddet(f.beklenenMm).ad,
      konvektif_saganak_mm: f.saganakToplam, yaygin_yagmur_mm: f.yagmurToplam,
      cape_max_jkg: f.capeMax, cape_bandi: f.capeSeviye.ad, cape_zirve_saati: f.capeSaat != null ? saatMetniTam(f.capeSaat) : null,
      hamle_max_kmh: f.hamleMax, taze_kar_cm: f.kar.var ? f.kar.toplamCm : 0, buzlanma: f.buzlanma.ad, sifir_izotermi_min_m: f.donma.minM,
      kurallar: f.kurallar.map((k) => ({ kural: k.id === "k1" ? "Çisenti filtresi (sahte alarm engelleyici)" : k.ad, kosul: k.kosul, etkin: k.id === "k1" ? c.etkin : k.tetik, aciklama: k.id === "k1" ? c.metin : k.ozet })),
      ...(tam ? { saatlik: g.saatler.map((x) => saatSatiri(x, d)) } : {}),
    };
  };
  const secili = gunPaket(G, true);
  const ekler = gunler.slice(i + 1, i + 1 + Math.min(2, Math.max(0, ekGun))).map((g) => gunPaket(g, true));
  const gunlukTablo = (d.hava.gunluk || []).map((g) => ({ tarih: g.tarih, min_c: g.min, max_c: g.max, hissedilen_min_c: g.appMin, hissedilen_max_c: g.appMax, yagis_ihtimali_max_yuzde: g.yagisOlasi, yagis_toplam_mm: g.yagisToplam, kar_toplam_cm: g.karToplam, ruzgar_max_kmh: g.ruzgar, hamle_max_kmh: g.hamle, uv_max: g.uv }));
  const kombin = d.sonuc?.kombinler?.[Math.min(d.kombinNo || 0, (d.sonuc?.kombinler?.length || 1) - 1)]?.parcalar || {};
  const modelAnahtar = Object.keys(d.hava.modelDizi || {});
  return {
    belge: "HavaStil Günlük Veri Paketi", surum: 2, olusturma: new Date().toISOString(),
    konum: { ad: d.konum.etiket || d.konum.ad, enlem: d.konum.lat, boylam: d.konum.lon, rakim_m: d.hava.rakim ?? null },
    kaynak: `Open-Meteo (ana tahmin${modelAnahtar.length ? " + " + modelAnahtar.map((m) => m.toUpperCase()).join(", ") + " model karşılaştırması" : ""}). Veri zamanı: ${d.hava.alinma ? new Date(d.hava.alinma).toISOString() : "bilinmiyor"}.`,
    secili_gun: secili, sonraki_gunler_saatlik: ekler, on_alti_gun_ozeti: gunlukTablo,
    onerilen_kombin: Object.fromEntries(["b", "m", "o", "p", "a"].filter((x) => kombin[x]).map((x) => [{ b: "ic_kat", m: "orta_kat", o: "dis_kat", p: "alt_giyim", a: "ayakkabi" }[x], kombin[x].ad])),
    kullanici_tercihi: { senaryo: d.tercih.sen, sicaklik_toleransi: d.tercih.tol, canta: d.tercih.canta },
    dogrulanmis_hava_haberleri: (d.haber?.uygulananlar || []).slice(0, 3).map((u) => ({ baslik: u.baslik, kaynak: u.kurum || u.kaynakAd })),
    okuma_kilavuzu: [
      "Yağış ihtimali (PoP) = Model uyumu × Yayılım. Open-Meteo yalnızca PoP verir; model uyumu = yağış gören model oranı, yayılım = PoP ÷ model uyumu. Bu TAHMİNİ bir ayrıştırmadır; ayrisma_tahmini=true ise yayılım üst sınırdır.",
      "Beklenen yağış (E) = saatlik PoP × saatlik yağış mm; günün beklenen yağışı saatlik E'lerin toplamıdır. Garanti edilen miktar değil, olasılıkla tartılmış beklentidir.",
      "CAPE (J/kg) fırtına enerjisidir: düşük CAPE yağmur olmayacağı anlamına GELMEZ; yalnızca gök gürültüsü/dolu/ani sağanak ihtimalini ölçer. Yaygın düzenli yağmur düşük CAPE ile de yağar.",
      "yagis_seviyesi_0_3: 0 kurak · 1 hafif çisenti (zararsız) · 2 sürekli yağmur · 3 tehlikeli/ani sağanak. Çisenti filtresi yalnızca 'ihtimal ≥ %70 ve beklenen hacim < 0,8 mm' saatleri zararsız sayar.",
      "Yalıtım ihtiyacı (CLO): büyük sayı = daha kalın giyim; hissedilen sıcaklık ve kullanıcı tercihlerinden hesaplanır.",
      "Tüm saatler konumun yerel saatidir. Modeller tahmindir; kesin değildir.",
    ],
  };
}

export const paketJson = (p) => JSON.stringify(p, null, 2);

const SUTUNLAR = [["saat", "Saat"], ["sicaklik_c", "°C"], ["hissedilen_c", "His."], ["nem_yuzde", "Nem%"], ["ruzgar_kmh", "Rüz."], ["hamle_kmh", "Hamle"], ["yagis_ihtimali_yuzde", "PoP%"],
  ["model_uyumu_yuzde", "Uyum%"], ["yayilim_yuzde", "Yayılım%"], ["yagis_mm", "mm"], ["beklenen_mm", "E mm"], ["yagis_turu", "Tür"], ["yagis_seviyesi_0_3", "Sev."], ["cape_jkg", "CAPE"],
  ["basinc_hpa", "hPa"], ["bulut_yuzde", "Bulut%"], ["uv_indeksi", "UV"], ["taze_kar_cm", "Kar cm"], ["buzlanma_riski", "Buz"], ["yalitim_ihtiyaci_clo", "CLO"]];
const hucre = (v) => (v == null ? "–" : typeof v === "boolean" ? (v ? "E" : "H") : String(v).replace(/\|/g, "/"));

function gunMetni(g, baslikSeviye = "###") {
  const s = [`${baslikSeviye} ${g.tarih}`, `**Özet:** ${g.ozet_cumle}`, "",
    `- Yağış seviyesi: ${g.yagis_seviyesi} · tür: ${g.yagis_turu}${g.yagis_penceresi ? ` · pencere: ${g.yagis_penceresi}` : ""}`,
    `- En yüksek yağış ihtimali: %${g.en_yuksek_yagis_ihtimali_yuzde}${g.zirvede_model_uyumu_yuzde != null ? ` (zirvede model uyumu %${g.zirvede_model_uyumu_yuzde}, yayılım %${g.zirvede_yayilim_yuzde})` : ""}`,
    `- Toplam yağış: ${g.toplam_yagis_mm} mm · beklenen (ihtimalle tartılmış): ${g.beklenen_yagis_mm} mm (${g.beklenen_yagis_siddeti}) · ani sağanak: ${g.konvektif_saganak_mm} mm · yaygın yağmur: ${g.yaygin_yagmur_mm} mm`,
    `- Fırtına enerjisi (CAPE) en yüksek: ${g.cape_max_jkg} J/kg (${g.cape_bandi})${g.cape_zirve_saati ? ` @ ${g.cape_zirve_saati}` : ""} · rüzgâr hamlesi en yüksek: ${g.hamle_max_kmh} km/s`,
    `- Kar: ${g.taze_kar_cm} cm · buzlanma: ${g.buzlanma}${g.sifir_izotermi_min_m != null ? ` · sıfır izotermi en düşük: ${g.sifir_izotermi_min_m} m` : ""}`, "",
    "Karar kuralları:", ...g.kurallar.map((k) => `- ${k.kural}: ${k.etkin ? "ETKİN" : "gerekmedi"} — ${k.aciklama}`)];
  if (g.saatlik) {
    s.push("", `Saatlik döküm (${g.tarih}):`, "", `| ${SUTUNLAR.map((c) => c[1]).join(" | ")} |`, `|${SUTUNLAR.map(() => "---").join("|")}|`,
      ...g.saatlik.map((r) => `| ${SUTUNLAR.map((c) => hucre(r[c[0]])).join(" | ")} |`));
  }
  return s.join("\n");
}

/** Markdown / düz metin gövdesi (yapay zekâya yapıştırılabilir). */
export function paketMetni(p) {
  const L = [`# ${p.belge}`, "", `- Konum: **${p.konum.ad}** (${p.konum.enlem}, ${p.konum.boylam}${p.konum.rakim_m != null ? `, ${p.konum.rakim_m} m` : ""})`, `- Oluşturma: ${p.olusturma}`, `- Kaynak: ${p.kaynak}`, "",
    "## Nasıl okunur", ...p.okuma_kilavuzu.map((x) => `- ${x}`), "",
    "## Seçili gün", gunMetni(p.secili_gun)];
  for (const g of p.sonraki_gunler_saatlik) L.push("", gunMetni(g));
  L.push("", "## 16 günlük özet", "", "| Tarih | Min | Maks | His.min | His.maks | PoP maks% | Yağış mm | Kar cm | Rüzgâr | Hamle | UV |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ...p.on_alti_gun_ozeti.map((g) => `| ${g.tarih} | ${g.min_c} | ${g.max_c} | ${g.hissedilen_min_c} | ${g.hissedilen_max_c} | ${g.yagis_ihtimali_max_yuzde} | ${g.yagis_toplam_mm} | ${g.kar_toplam_cm} | ${g.ruzgar_max_kmh} | ${g.hamle_max_kmh} | ${g.uv_max} |`));
  L.push("", "## HavaStil'in önerdiği kombin", ...Object.entries(p.onerilen_kombin).map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`),
    `- Tercihler: senaryo ${p.kullanici_tercihi.senaryo}, sıcaklık toleransı ${p.kullanici_tercihi.sicaklik_toleransi}, çanta ${p.kullanici_tercihi.canta}`);
  if (p.dogrulanmis_hava_haberleri.length) L.push("", "## Doğrulanmış hava uyarıları (haber)", ...p.dogrulanmis_hava_haberleri.map((h) => `- ${h.baslik} (${h.kaynak})`));
  L.push("", "## Yapay zekâya önerilen talimat", "Aşağıdaki veriyi yalnızca bu dosyadaki sayılara dayanarak yorumla. Tahmin belirsizliğini (model uyumu, ayrıştırmanın tahmini olması) açıkça belirt, kesinlik iddia etme; sayısal çelişki görürsen göster. Soruma saat aralığı vererek cevap ver.");
  return L.join("\n");
}

const damga = (p) => `${p.secili_gun.tarih}-${String(p.konum.ad).toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "konum"}`;
export const dosyaAdi = (p, uzanti) => `havastil-veri-${damga(p)}.${uzanti}`;

/** Tarayıcıdan indirme (Blob; CSP uyumlu, sunucuya hiçbir şey gitmez). */
export function indir(ad, icerik, mime) {
  const url = URL.createObjectURL(new Blob([icerik], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: ad });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function panoyaKopyala(metin) {
  try { await navigator.clipboard.writeText(metin); return true; }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: metin }); t.setAttribute("readonly", ""); t.className = "hv-gizli-kopya";
    document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { /* yok say */ } t.remove(); return ok;
  }
}
export { uyumGoster };
