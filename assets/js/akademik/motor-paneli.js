/*
 * assets/js/akademik/motor-paneli.js — "PDF okuyucu motoru" paneli (sürüm seçimi + doğrulama kanıtı).
 *
 * Herkes KENDİ tercihini seçer (yalnızca bu tarayıcıda; bkz. motor.js → tercihOku/tercihYaz):
 *   • Otomatik        — site varsayılanı (Site Sahibi'nin sınadığı sürüm). ÖNERİLEN.
 *   • Her zaman en yeni — internetten (jsDelivr) o an yayımlanmış en yeni KARARLI sürüm.
 *   • Belirli sürüm   — listeden seçilen tek sürüm.
 * Site Sahibi ayrıca "site varsayılanı"nı (herkesin Otomatik modu) panelin altındaki bölümden değiştirir.
 *
 * "Gerçekten internetten mi geliyor?" sorusunun cevabı panelde KANIT olarak durur: sürüm listesinin kaynağı
 * (canlı / önbellek), çekilme zamanı, sorgulanan adres (tıklanabilir), sürüm sayısı, en yeni kararlı sürüm,
 * npm/jsDelivr doğrulama bağlantıları ve — en önemlisi — "Gerçek sınama": seçilen sürümü CDN'den yükleyip bir
 * PDF'i açar, kütüphanenin KENDİ bildirdiği sürüm numarasını ve CDN adresini gösterir.
 *
 * CSP: satır içi stil/olay yok; tüm metin textContent ile yazılır (el yardımcısı), olaylar addEventListener ile.
 */
import { el, toast } from "./ortak.js";
import {
  motorAyarlari, surumListesiGetir, surumuDene, surumuSabitle, surumKarsilastir,
  tercihOku, tercihYaz, planlananSurum, motorDurumu, motorYuklendiMi,
  SURUM_API_URL, NPM_SAYFA_URL, JSDELIVR_SAYFA_URL,
} from "./motor.js";

let sayac = 0;

const KAYNAK_ETIKETI = {
  site: "Site varsayılanı",
  "tercih-sabit": "Senin seçtiğin sürüm",
  "tercih-en-yeni": "Her zaman en yeni (senin tercihin)",
  "tercih-en-yeni-bekliyor": "Her zaman en yeni (sürüm okuyucu açılırken belirlenir)",
  varsayilan: "Yedek (sınanmış) sürüm",
};

const MOD_KARTLARI = [
  { mod: "otomatik", baslik: "Otomatik", rozet: "Önerilen", aciklama: "Site Sahibi'nin sınadığı sürüm kullanılır. Hiçbir şey seçmek zorunda değilsin." },
  { mod: "en-yeni", baslik: "Her zaman en yeni", aciklama: "İnternetten o an yayımlanmış en yeni kararlı sürüm. Yeni özellik/düzeltme erken gelir; nadiren yeni sürümde sorun çıkabilir (sorun olursa otomatik olarak site sürümüne düşülür)." },
  { mod: "sabit", baslik: "Belirli sürüm", aciklama: "Aşağıdaki listeden seçtiğin sürüm sabit kalır — bir sürümde sorun yaşıyorsan eskiye dönmek için kullan." },
];

function goreceli(iso) {
  const sn = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sn < 10) return "az önce";
  if (sn < 60) return `${sn} sn önce`;
  if (sn < 3600) return `${Math.round(sn / 60)} dk önce`;
  if (sn < 86400) return `${Math.round(sn / 3600)} sa önce`;
  return `${Math.round(sn / 86400)} gün önce`;
}
const mutlak = (iso) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "medium" });
const anaSurum = (v) => Number(v.split(".")[0]);

/** Sürümleri ana sürüme göre <optgroup>'lara böler. Varsayılan görünümde yalnızca en yeni ana sürüm (+ seçili/aktif olanın ana sürümü). */
function surumSecenekleri({ surumler, en_yeni, siteSurumu, secili, eskiGoster }) {
  const enYeniAna = surumler.length ? anaSurum(en_yeni || surumler[0]) : null;
  const gosterilecekAnalar = new Set([enYeniAna]);
  if (siteSurumu) gosterilecekAnalar.add(anaSurum(siteSurumu));
  if (secili) gosterilecekAnalar.add(anaSurum(secili));
  const gruplar = new Map();
  for (const v of surumler) {
    const a = anaSurum(v);
    if (!eskiGoster && !gosterilecekAnalar.has(a)) continue;
    if (!gruplar.has(a)) gruplar.set(a, []);
    gruplar.get(a).push(v);
  }
  // Listede olmayan ama seçili/site sürümü (ör. kaldırılmış) yine de görünsün.
  for (const ozel of [secili, siteSurumu]) {
    if (ozel && !surumler.includes(ozel)) {
      const a = anaSurum(ozel);
      if (!gruplar.has(a)) gruplar.set(a, []);
      gruplar.get(a).unshift(ozel);
    }
  }
  return [...gruplar.entries()].sort((x, y) => y[0] - x[0]).map(([a, liste]) => {
    const g = el("optgroup", { label: a === enYeniAna ? `${a}.x — güncel seri` : `${a}.x — eski seri` });
    [...new Set(liste)].sort((x, y) => surumKarsilastir(y, x)).forEach((v) => {
      const notlar = [v === en_yeni ? "en yeni" : null, v === siteSurumu ? "site varsayılanı" : null].filter(Boolean);
      const o = el("option", { value: v }, notlar.length ? `${v} — ${notlar.join(", ")}` : v);
      if (v === secili) o.selected = true;
      g.append(o);
    });
    return g;
  });
}

/**
 * @param {HTMLElement} yer      panelin kurulacağı kutu
 * @param {{owner?: boolean}} secenek
 */
export async function motorPaneliKur(yer, { owner = false } = {}) {
  if (!yer) return;
  const kimlik = ++sayac;
  const d = {
    ayar: { pdfjs: "", pdflib: "" },
    kanit: null,        // surumListesiGetir() sonucu
    kanitHata: "",
    tercih: tercihOku(),
    plan: null,
    eskiGoster: false,
    siteSecili: "",
    sinama: null,       // son "gerçek sınama" sonucu
    mesgul: false,
    acik: false,
  };

  yer.replaceChildren(el("p", { class: "ak-bos" }, "Okuyucu motoru bilgisi alınıyor…"));

  async function yukle({ zorla = false } = {}) {
    d.ayar = await motorAyarlari();
    d.siteSecili ||= d.ayar.pdfjs;
    try {
      d.kanit = await surumListesiGetir({ zorla });
      d.kanitHata = d.kanit.hata || "";
    } catch (h) {
      d.kanit = null;
      d.kanitHata = h.message || "Sürüm listesi alınamadı.";
    }
    d.plan = await planlananSurum();
  }

  /* ------------------------------ parçalar ------------------------------ */

  function ozetSatiri() {
    const durum = motorDurumu();
    const surum = durum?.surum || d.plan?.surum || d.ayar.pdfjs;
    const kaynak = durum?.kaynak || d.plan?.kaynak || "site";
    const yeni = d.kanit && d.kanit.en_yeni && d.kanit.en_yeni !== surum && surumKarsilastir(d.kanit.en_yeni, surum) > 0;
    return el("summary", { class: "ak-mt-ozet" },
      el("span", { class: "ak-mt-ikon", "aria-hidden": "true" }, "⚙️"),
      el("span", { class: "ak-mt-ozet-metin" },
        el("strong", {}, "PDF okuyucu motoru"),
        el("span", { class: "ak-mt-ozet-alt" }, `PDF.js ${surum} · ${KAYNAK_ETIKETI[kaynak] || kaynak}`)),
      yeni ? el("span", { class: "ak-rozet ak-yeni" }, `Yeni sürüm var: ${d.kanit.en_yeni}`) : null,
      el("span", { class: "ak-mt-ok", "aria-hidden": "true" }, "▾"));
  }

  function modBolumu() {
    const ad = `ak-mt-mod-${kimlik}`;
    const kartlar = MOD_KARTLARI.map((m) => {
      const id = `${ad}-${m.mod}`;
      const girdi = el("input", { type: "radio", name: ad, id, value: m.mod, "data-mt": "mod" });
      girdi.checked = d.tercih.mod === m.mod;
      return el("label", { class: `ak-mt-mod${d.tercih.mod === m.mod ? " secili" : ""}`, for: id },
        girdi,
        el("span", { class: "ak-mt-mod-baslik" }, m.baslik, m.rozet ? el("span", { class: "ak-rozet" }, m.rozet) : null),
        el("span", { class: "ak-mt-mod-aciklama" }, m.aciklama));
    });

    const surumler = d.kanit?.surumler || [];
    const secili = d.tercih.mod === "sabit" ? d.tercih.surum : (surumler.includes(d.tercih.surum) ? d.tercih.surum : (d.kanit?.en_yeni || d.ayar.pdfjs));
    const secici = el("select", { "data-mt": "surum", "aria-label": "PDF.js sürümü" },
      surumSecenekleri({ surumler, en_yeni: d.kanit?.en_yeni, siteSurumu: d.ayar.pdfjs, secili: d.tercih.surum || secili, eskiGoster: d.eskiGoster }));
    if (d.tercih.mod !== "sabit") secici.disabled = true;

    const eskiOnay = el("label", { class: "ak-onay ak-mt-eski" },
      Object.assign(el("input", { type: "checkbox", "data-mt": "eski" }), { checked: d.eskiGoster }),
      " Eski sürüm serilerini de göster");

    const hedef = hedefSurum();
    const ozet = el("p", { class: "ak-mt-hedef", "aria-live": "polite" },
      "Bir sonraki okuyucu açılışında kullanılacak: ",
      el("strong", {}, hedef.surum ? `PDF.js ${hedef.surum}` : "PDF.js (en yeni — açılışta belirlenir)"),
      ` · ${KAYNAK_ETIKETI[hedef.kaynak] || hedef.kaynak}`);

    const dene = el("button", { type: "button", class: "ak-btn", "data-mt": "dene", disabled: d.mesgul }, "Gerçek sınama yap");
    const kaydet = el("button", { type: "button", class: "ak-btn ak-btn-birincil", "data-mt": "kaydet", disabled: d.mesgul }, "Tercihimi kaydet");
    const durum = el("span", { class: "ak-mt-durum", "data-mt-durum": "", "aria-live": "polite" }, d.sinama ? sinamaMetni(d.sinama) : "");
    if (d.sinama) durum.classList.add(d.sinama.ok ? "ak-mt-ok-metin" : "ak-mt-hata-metin");

    return el("section", { class: "ak-mt-bolum" },
      el("h4", {}, "1 · Hangi sürüm kullanılsın?"),
      el("p", { class: "ak-mt-not" }, "Bu seçim yalnızca senin için ve yalnızca bu tarayıcıda geçerlidir; başkalarını etkilemez."),
      el("div", { class: "ak-mt-modlar", role: "radiogroup", "aria-label": "Sürüm seçimi" }, kartlar),
      el("div", { class: "ak-mt-secici" }, el("label", {}, "Sürüm ", secici), eskiOnay),
      ozet,
      el("div", { class: "ak-mt-eylem" }, dene, kaydet, durum));
  }

  function hedefSurum() {
    const t = d.tercih;
    if (t.mod === "sabit") return { surum: t.surum, kaynak: "tercih-sabit" };
    if (t.mod === "en-yeni") return { surum: d.kanit?.en_yeni || null, kaynak: "tercih-en-yeni" };
    return { surum: d.ayar.pdfjs, kaynak: "site" };
  }

  function sinamaMetni(s) {
    if (!s.ok) return `✗ PDF.js ${s.surum} yüklenemedi: ${s.hata}`;
    return `✓ PDF.js ${s.gercekSurum || s.surum} yüklendi ve örnek PDF açıldı (${s.cdn}, ${s.sureMs} ms${s.legacy ? ", uyumlu/legacy derleme" : ""})`;
  }

  function satir(etiket, ...icerik) {
    return el("div", { class: "ak-mt-kanit-satir" }, el("dt", {}, etiket), el("dd", {}, ...icerik));
  }
  const baglanti = (href, metin) => el("a", { href, target: "_blank", rel: "noopener noreferrer" }, metin);

  function kanitBolumu() {
    const k = d.kanit;
    const satirlar = [];
    if (k) {
      const canli = k.kaynak === "canli";
      satirlar.push(
        satir("Sürüm listesi", el("span", { class: `ak-rozet ${canli ? "ak-mt-canli" : "ak-mt-onbellek"}` }, canli ? "● Canlı (internetten çekildi)" : "◌ Önbellekten"),
          k.hata ? el("span", { class: "ak-mt-hata-metin" }, ` — canlı çekim başarısız: ${k.hata}`) : null,
          !canli && !k.hata ? el("span", { class: "ak-mt-not" }, " (6 saatten tazeyse yeniden çekilmez; “Canlı yenile” ile zorlayabilirsin)") : null),
        satir("Çekilme zamanı", `${mutlak(k.cekildi)} (${goreceli(k.cekildi)})${k.sureMs ? ` · ${k.sureMs} ms` : ""}`),
        satir("Sorgulanan adres", baglanti(SURUM_API_URL, SURUM_API_URL), el("span", { class: "ak-mt-not" }, " — tıklayıp ham yanıtı kendin görebilirsin")),
        satir("Bulunan", `${k.surumler.length} kararlı sürüm · en yeni: `, el("strong", {}, k.en_yeni || "—")),
      );
    } else {
      satirlar.push(satir("Sürüm listesi", el("span", { class: "ak-mt-hata-metin" }, d.kanitHata || "Alınamadı."), el("span", { class: "ak-mt-not" }, " İnternet bağlantını kontrol edip “Canlı yenile”ye bas. Bu sırada site varsayılanı kullanılır.")));
    }
    satirlar.push(satir("Bağımsız doğrulama", baglanti(NPM_SAYFA_URL, "npm sayfası"), " · ", baglanti(JSDELIVR_SAYFA_URL, "jsDelivr paket sayfası"), " · ", baglanti("https://github.com/mozilla/pdf.js/releases", "PDF.js sürüm notları (GitHub)")));

    const yuklu = motorDurumu();
    if (yuklu) {
      satirlar.push(satir("Bu oturumda yüklenen",
        el("strong", {}, `PDF.js ${yuklu.gercekSurum || yuklu.surum}`),
        ` · ${yuklu.cdn} · ${yuklu.sureMs} ms · ${KAYNAK_ETIKETI[yuklu.kaynak] || yuklu.kaynak}${yuklu.legacy ? " · legacy derleme" : ""}`,
        yuklu.atlanan?.length ? el("span", { class: "ak-mt-hata-metin" }, ` · yüklenemeyip atlanan: ${yuklu.atlanan.join(", ")}`) : null));
    } else {
      satirlar.push(satir("Bu oturumda yüklenen", el("span", { class: "ak-mt-not" }, "Henüz okuyucu açılmadı. Bir PDF açtığında burada kütüphanenin kendi bildirdiği sürüm görünür.")));
    }

    return el("section", { class: "ak-mt-bolum" },
      el("div", { class: "ak-mt-baslik-satir" },
        el("h4", {}, "2 · Kanıt: sürümler gerçekten internetten mi geliyor?"),
        el("button", { type: "button", class: "ak-btn", "data-mt": "yenile", disabled: d.mesgul }, "↻ Canlı yenile")),
      el("dl", { class: "ak-mt-kanit" }, satirlar));
  }

  function siteBolumu() {
    if (!owner) return null;
    const surumler = d.kanit?.surumler || [];
    const secici = el("select", { "data-mt": "site-surum", "aria-label": "Site varsayılanı sürümü" },
      surumSecenekleri({ surumler, en_yeni: d.kanit?.en_yeni, siteSurumu: d.ayar.pdfjs, secili: d.siteSecili || d.ayar.pdfjs, eskiGoster: d.eskiGoster }));
    const durum = el("span", { class: "ak-mt-durum", "data-mt-site-durum": "", "aria-live": "polite" });
    const sonYeni = d.kanit?.en_yeni && surumKarsilastir(d.kanit.en_yeni, d.ayar.pdfjs) > 0;
    return el("section", { class: "ak-mt-bolum ak-mt-site" },
      el("h4", {}, "3 · Site varsayılanı ", el("span", { class: "ak-rozet" }, "Yalnızca Site Sahibi")),
      el("p", { class: "ak-mt-not" }, `Şu an: PDF.js ${d.ayar.pdfjs} · pdf-lib ${d.ayar.pdflib}. “Otomatik” modundaki TÜM kullanıcılar bu sürümü kullanır. Önce sına, sonra varsayılan yap.`),
      el("div", { class: "ak-mt-eylem" },
        el("label", {}, "Sürüm ", secici),
        el("button", { type: "button", class: "ak-btn", "data-mt": "site-dene", disabled: d.mesgul }, "Gerçek sınama yap"),
        el("button", { type: "button", class: "ak-btn ak-btn-birincil", "data-mt": "site-sabitle", disabled: d.mesgul }, "Herkes için varsayılan yap"),
        sonYeni ? el("button", { type: "button", class: "ak-btn ak-btn-birincil", "data-mt": "site-son", disabled: d.mesgul }, `En yeniyi sına ve uygula (${d.kanit.en_yeni})`) : null,
        durum));
  }

  function ciz() {
    const acikti = yer.querySelector("details")?.open ?? d.acik;
    const kutu = el("details", { class: "ak-motor-kutu ak-mt" },
      ozetSatiri(),
      el("p", { class: "ak-mt-giris" }, "PDF'leri açan motor (PDF.js) kodun içine gömülü değildir; resmî paket internetten (jsDelivr CDN) yüklenir. Hangi sürümü kullanacağını burada seçebilirsin."),
      modBolumu(), kanitBolumu(), siteBolumu());
    kutu.open = acikti;
    yer.replaceChildren(kutu);
  }

  /* ------------------------------ olaylar ------------------------------ */

  const durumYaz = (secici, metin, tur = "") => {
    const e = yer.querySelector(secici);
    if (!e) return;
    e.textContent = metin;
    e.classList.toggle("ak-mt-ok-metin", tur === "ok");
    e.classList.toggle("ak-mt-hata-metin", tur === "hata");
  };

  const secilenSurum = () => yer.querySelector('[data-mt="surum"]')?.value || d.tercih.surum || d.kanit?.en_yeni || d.ayar.pdfjs;

  async function sinaVe(surum, durumSecici) {
    d.mesgul = true;
    durumYaz(durumSecici, `PDF.js ${surum} CDN'den yükleniyor ve örnek PDF açılıyor…`);
    yer.querySelectorAll("[data-mt]").forEach((e) => { if (e.tagName === "BUTTON") e.disabled = true; });
    const s = await surumuDene(surum);
    d.mesgul = false;
    d.sinama = s;
    return s;
  }

  yer.addEventListener("change", (e) => {
    const t = e.target.closest("[data-mt]");
    if (!t) return;
    if (t.dataset.mt === "mod") {
      d.tercih = { mod: t.value, surum: t.value === "sabit" ? (d.tercih.surum || d.kanit?.en_yeni || d.ayar.pdfjs) : null };
      d.sinama = null;
      ciz();
    } else if (t.dataset.mt === "surum") {
      d.tercih = { mod: "sabit", surum: t.value };
      d.sinama = null;
      ciz();
    } else if (t.dataset.mt === "eski") {
      d.eskiGoster = t.checked;
      d.acik = true;
      ciz();
    } else if (t.dataset.mt === "site-surum") {
      d.siteSecili = t.value;
    }
  });

  yer.addEventListener("click", async (e) => {
    const t = e.target.closest("button[data-mt]")?.dataset.mt;
    if (!t || d.mesgul) return;

    if (t === "yenile") {
      d.mesgul = true;
      await yukle({ zorla: true }).catch(() => {});
      d.mesgul = false;
      ciz();
      if (d.kanit?.kaynak === "canli") toast(`Sürüm listesi internetten yenilendi (${d.kanit.surumler.length} sürüm, en yeni ${d.kanit.en_yeni}).`, "basari");
      else toast("Canlı yenileme başarısız: " + (d.kanitHata || "bağlantı yok") + (d.kanit ? " — önbellekteki liste gösteriliyor." : ""), "uyari");
      return;
    }

    if (t === "dene") {
      const hedef = hedefSurum();
      const surum = hedef.surum || secilenSurum();
      const s = await sinaVe(surum, "[data-mt-durum]");
      ciz();
      return void (s.ok ? toast(`PDF.js ${s.gercekSurum || surum} çalışıyor.`, "basari") : toast(`PDF.js ${surum} yüklenemedi.`, "hata"));
    }

    if (t === "kaydet") {
      let tercih = d.tercih;
      if (tercih.mod === "sabit") tercih = { mod: "sabit", surum: secilenSurum() };
      if (tercih.mod !== "otomatik") {
        const hedef = tercih.mod === "sabit" ? tercih.surum : d.kanit?.en_yeni;
        if (hedef) {
          const s = await sinaVe(hedef, "[data-mt-durum]");
          if (!s.ok) { ciz(); toast(`PDF.js ${hedef} yüklenemedi; tercih KAYDEDİLMEDİ.`, "hata"); return; }
        }
      }
      if (!tercihYaz(tercih)) { toast("Tarayıcı bu tercihi saklamaya izin vermiyor (gizli sekme/depo kapalı olabilir).", "uyari"); return; }
      d.tercih = tercihOku();
      d.plan = await planlananSurum();
      ciz();
      toast(motorYuklendiMi()
        ? "Tercih kaydedildi. Okuyucu bu sayfada zaten açıldığı için yeni sürüm sayfayı yenileyince geçerli olur."
        : "Tercih kaydedildi; bir sonraki PDF açılışında kullanılacak.", "basari", 6000);
      return;
    }

    if (t === "site-dene" || t === "site-sabitle" || t === "site-son") {
      const surum = t === "site-son" ? d.kanit?.en_yeni : (yer.querySelector('[data-mt="site-surum"]')?.value || d.siteSecili);
      if (!surum) return;
      const s = await sinaVe(surum, "[data-mt-site-durum]");
      if (!s.ok) { ciz(); durumYaz("[data-mt-site-durum]", `✗ ${surum} yüklenemedi; varsayılan yapılmadı. (${s.hata})`, "hata"); return; }
      if (t === "site-dene") { ciz(); durumYaz("[data-mt-site-durum]", `✓ ${sinamaMetni(s).slice(2)} — henüz varsayılan değil.`, "ok"); return; }
      try {
        await surumuSabitle(surum);
        d.ayar = await motorAyarlari();
        d.siteSecili = surum;
        d.plan = await planlananSurum();
        ciz();
        durumYaz("[data-mt-site-durum]", `✓ ${surum} herkes için varsayılan oldu. Kullanıcılar bir sonraki sayfa yenilemesinde geçer.`, "ok");
        toast(`Site varsayılanı PDF.js ${surum} oldu.`, "basari");
      } catch (h) {
        ciz();
        durumYaz("[data-mt-site-durum]", `✗ ${h.message}`, "hata");
      }
    }
  });

  await yukle();
  ciz();
}
