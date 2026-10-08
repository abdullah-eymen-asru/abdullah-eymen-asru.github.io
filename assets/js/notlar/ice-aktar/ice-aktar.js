/*
 * assets/js/notlar/ice-aktar/ice-aktar.js
 * -----------------------------------------------------------------------
 * "İçeri aktar" penceresi: dosya seç / sürükle-bırak → önizleme listesi → seçilenleri notlara yaz.
 *
 * KASA/E2EE: bu modül ŞİFRELEMEZ ve sunucuya hiçbir şey göndermez. Seçilen taslakları, notlar.js'in verdiği
 * uygula(secim, ilerleme) işlevine iletir; o işlev her notu mevcut akıştan (modelOlustur → Kasa.notuSifrele →
 * INSERT) geçirir. Yani içeri aktarılan notlar, elle yazılmış notlarla BİREBİR aynı şifreleme hattını kullanır.
 *
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { dosyalariCoz, KABUL_EDILEN } from "./ayristir.js";

function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

const boyutMetni = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const NOT_BASINA_GORSEL = 20; // notlar.js: NOT_BASINA_EK

const ozetMetni = (t) => {
  const duz = (new DOMParser().parseFromString(t.html, "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
  return duz.length > 110 ? duz.slice(0, 110) + "…" : duz || "(yalnızca başlık)";
};

/**
 * ctx: {turBul, durumBul, klasorSecenekleriDoldur(sec), mukerrerMi(taslak) → bool}
 * uygula(secim:{notlar:[taslak], hedefKlasorId, klasorYapisi}, ilerleme(i,n,metin)) → {eklenen, hata:[metin], basarisiz:[taslak]}
 */
export function iceAktarDiyalogu({ ctx, kok = document.body, uygula, bildir = () => {} }) {
  return new Promise((coz) => {
    const d = el("dialog", { class: "nt-diyalog nt-da nt-ia" });
    let taslaklar = []; // {t, secili, mukerrer}
    let atlanan = [];
    let meşgul = false;
    const gorselUrl = new Map(); // görsel nesnesi -> blob URL (önizleme; pencere kapanınca bırakılır)
    const urlAl = (g) => {
      if (!gorselUrl.has(g)) gorselUrl.set(g, URL.createObjectURL(new Blob([g.bayt], { type: g.tip })));
      return gorselUrl.get(g);
    };
    const urlleriBirak = () => {
      for (const u of gorselUrl.values()) URL.revokeObjectURL(u);
      gorselUrl.clear();
    };

    const girdi = el("input", { type: "file", class: "nt-gizli", multiple: true, accept: KABUL_EDILEN, "aria-label": "İçeri aktarılacak dosyalar" });
    const birak = el(
      "label",
      { class: "nt-ia-birak" },
      girdi,
      el("strong", { text: "Dosya seç ya da buraya bırak" }),
      el("span", { class: "muted", text: "Markdown · Metin · JSON · HTML · Word · PDF · ZIP paketi" })
    );
    const liste = el("div", { class: "nt-ia-liste", hidden: true });
    const uyari = el("div", { class: "nt-ia-uyari", hidden: true });
    const hedefSec = el("select", { "aria-label": "Hedef klasör" });
    ctx.klasorSecenekleriDoldur(hedefSec);
    const yapiKutu = el("input", { type: "checkbox" });
    yapiKutu.checked = true;
    const yapiSatiri = el(
      "label",
      { class: "nt-da-secenek" },
      yapiKutu,
      el("span", { class: "nt-da-ad", text: "Dosyadaki klasör yapısını koru" }),
      el("span", { class: "nt-da-ipucu", text: "Klasör bilgisi olan notlar, hedef klasörün altında aynı yolla oluşturulur" })
    );
    const ozet = el("p", { class: "nt-da-ozet", "aria-live": "polite", text: "Bir dosya seç; notlar önce burada listelenir, hiçbir şey kendiliğinden eklenmez." });
    const ilerleme = el("p", { class: "nt-da-ilerleme muted", hidden: true, "aria-live": "polite" });
    const hata = el("p", { class: "nt-da-hata", hidden: true, role: "alert" });
    const tamamBtn = el("button", { type: "submit", class: "nt-btn nt-btn-birincil", text: "İçeri aktar", disabled: true });
    const kapatBtn = el("button", { type: "button", class: "nt-btn", text: "Kapat" });

    const secilenler = () => taslaklar.filter((x) => x.secili);
    const seciliGorselSayisi = (x) => (x.t.gorseller || []).filter((g) => g.secili !== false).length;

    /** Notun içindeki görseller: açılır önizleme + tek tek seç/çıkar. Düğüm bir kez kurulur; yeniden çizimlerde açık/kapalı durumu korunur. */
    const gorselKutusu = (x) => {
      const gs = x.t.gorseller || [];
      if (!gs.length) return null;
      if (x.gorselDugumu) return x.gorselDugumu;
      const ozetEl = el("summary", { class: "nt-ia-gorsel-ozet" });
      const izgara = el("div", { class: "nt-ia-gorsel-izgara" });
      const yaz = () => {
        const n = seciliGorselSayisi(x);
        ozetEl.textContent = `🖼 ${gs.length} görsel bulundu — ${n} tanesi eklere yüklenecek` + (n > NOT_BASINA_GORSEL ? ` (ilk ${NOT_BASINA_GORSEL} alınır)` : "");
        ozetGuncelle();
      };
      const topluBtn = (metin, deger) =>
        el("button", { type: "button", class: "nt-btn nt-ia-kucukbtn", text: metin, onclick: () => {
          for (const g of gs) g.secili = deger;
          izgara.querySelectorAll("input").forEach((k) => (k.checked = deger));
          yaz();
        } });
      const kur = () => {
        izgara.replaceChildren(
          ...gs.map((g, i) => {
            const kutu = el("input", { type: "checkbox", "aria-label": `Görsel ${i + 1} eklere yüklensin` });
            kutu.checked = g.secili !== false;
            kutu.addEventListener("change", () => {
              g.secili = kutu.checked;
              yaz();
            });
            const boyut = g.pxG && g.pxY ? `${g.pxG}×${g.pxY} · ` : "";
            return el(
              "label",
              { class: "nt-ia-gorsel" },
              kutu,
              el("img", { class: "nt-ia-kucuk", src: urlAl(g), alt: `Görsel ${i + 1} önizlemesi`, loading: "lazy" }),
              el("span", { class: "nt-ia-gorsel-bilgi muted", text: `Görsel ${i + 1} · ${boyut}${boyutMetni(g.bayt.length)}${g.sayfa ? ` · s.${g.sayfa}` : ""}` })
            );
          })
        );
      };
      const det = el(
        "details",
        { class: "nt-ia-gorseller" },
        ozetEl,
        el("p", { class: "muted nt-ia-gorsel-not", text: "Seçili görseller şifrelenip notun Ekler bölümüne yüklenir ve metinde bulundukları yere yerleştirilir. İstemediklerinin işaretini kaldır." }),
        el("div", { class: "nt-ia-gorsel-arac" }, topluBtn("Hepsini seç", true), topluBtn("Hiçbirini seçme", false)),
        izgara
      );
      det.addEventListener("toggle", () => {
        if (det.open && !izgara.childElementCount) kur();
      });
      yaz();
      x.gorselDugumu = det;
      return det;
    };
    const ozetGuncelle = () => {
      const n = secilenler().length;
      const g = secilenler().reduce((t, x) => t + Math.min(seciliGorselSayisi(x), NOT_BASINA_GORSEL), 0);
      ozet.textContent = taslaklar.length
        ? `${taslaklar.length} not bulundu, ${n} seçili. Şifreli kasana eklenecek; aynı başlıkta olanlar işaretlenmemiştir.` + (g ? ` ${g} görsel Ekler'e yüklenecek.` : "")
        : "Bir dosya seç; notlar önce burada listelenir, hiçbir şey kendiliğinden eklenmez.";
    };

    const ciz = () => {
      liste.hidden = !taslaklar.length;
      liste.replaceChildren(
        ...taslaklar.map((x, i) => {
          const kutu = el("input", { type: "checkbox" });
          kutu.checked = x.secili;
          kutu.addEventListener("change", () => {
            x.secili = kutu.checked;
            ciz();
          });
          const meta = [x.t.klasorYolu.join(" / "), x.t.etiketler.length ? `#${x.t.etiketler.join(" #")}` : "", x.mukerrer ? "zaten var gibi görünüyor" : ""].filter(Boolean).join(" · ");
          return el(
            "div",
            { class: "nt-ia-satir" },
            el(
              "label",
              { class: "nt-ia-oge" + (x.mukerrer ? " nt-ia-mukerrer" : "") },
              kutu,
              el("span", { class: "nt-ia-ad", text: x.t.baslik || "Başlıksız not" }),
              el("span", { class: "nt-ia-ozet muted", text: ozetMetni(x.t) }),
              meta ? el("span", { class: "nt-ia-meta muted", text: meta }) : null,
              x.t.uyarilar.length ? el("span", { class: "nt-ia-meta nt-ia-ikaz", text: x.t.uyarilar.join(" ") }) : null
            ),
            gorselKutusu(x)
          );
        })
      );
      uyari.hidden = !atlanan.length;
      uyari.replaceChildren(el("strong", { text: `${atlanan.length} öğe alınamadı` }), el("ul", {}, ...atlanan.slice(0, 12).map((a) => el("li", { text: a })), atlanan.length > 12 ? el("li", { text: `… ve ${atlanan.length - 12} öğe daha` }) : null));
      const n = secilenler().length;
      yapiSatiri.hidden = !taslaklar.some((x) => x.t.klasorYolu.length);
      ozetGuncelle();
      tamamBtn.disabled = !n || meşgul;
    };
    yapiSatiri.hidden = true;

    const oku = async (dosyalar) => {
      if (!dosyalar.length || meşgul) return;
      hata.hidden = true;
      ozet.textContent = "Dosyalar okunuyor…";
      meşgul = true;
      tamamBtn.disabled = true;
      try {
        const sonuc = await dosyalariCoz(dosyalar, ctx);
        const mevcut = new Set(taslaklar.map((x) => x.t));
        for (const t of sonuc.notlar) if (!mevcut.has(t)) {
          const mukerrer = ctx.mukerrerMi(t);
          taslaklar.push({ t, secili: !mukerrer, mukerrer });
        }
        atlanan = [...atlanan, ...sonuc.atlanan];
      } catch (h) {
        console.error(h);
        hata.hidden = false;
        hata.textContent = "Dosyalar okunamadı: " + (h.message || h);
      } finally {
        meşgul = false;
        ciz();
      }
    };

    girdi.addEventListener("change", () => {
      oku([...girdi.files]);
      girdi.value = "";
    });
    for (const ad of ["dragenter", "dragover"]) {
      birak.addEventListener(ad, (o) => {
        o.preventDefault();
        birak.classList.add("nt-ia-ustte");
      });
    }
    for (const ad of ["dragleave", "drop"]) birak.addEventListener(ad, () => birak.classList.remove("nt-ia-ustte"));
    birak.addEventListener("drop", (o) => {
      o.preventDefault();
      oku([...(o.dataTransfer?.files || [])]);
    });

    d.addEventListener("cancel", (o) => {
      if (meşgul) o.preventDefault();
    });
    d.addEventListener("close", () => {
      urlleriBirak();
      d.remove();
      coz(null);
    });
    kapatBtn.addEventListener("click", () => !meşgul && d.close());

    const form = el(
      "form",
      { class: "nt-diyalog-form nt-da-form", novalidate: true },
      el("div", { class: "nt-da-ust" }, el("h3", { text: "İçeri aktar" }), el("p", { class: "muted nt-da-aciklama", text: "Dosyalar bu cihazda okunur; notlar uçtan uca şifrelenerek kasana eklenir." })),
      el(
        "div",
        { class: "nt-da-govde" },
        birak,
        liste,
        uyari,
        el("fieldset", { class: "nt-da-grup" }, el("legend", { text: "Nereye eklensin?" }), el("div", { class: "form-field" }, hedefSec), yapiSatiri),
        ozet,
        ilerleme,
        hata
      ),
      el("div", { class: "nt-diyalog-eylem nt-da-alt" }, kapatBtn, tamamBtn)
    );

    form.addEventListener("submit", async (o) => {
      o.preventDefault();
      const secim = secilenler().map((x) => x.t);
      if (!secim.length || meşgul) return;
      meşgul = true;
      hata.hidden = true;
      tamamBtn.disabled = true;
      kapatBtn.disabled = true;
      ilerleme.hidden = false;
      ilerleme.textContent = "Şifreleniyor ve kaydediliyor…";
      try {
        const sonuc = await uygula({ notlar: secim, hedefKlasorId: hedefSec.value || null, klasorYapisi: yapiKutu.checked && !yapiSatiri.hidden }, (i, n, m) => (ilerleme.textContent = `${i} / ${n}${m ? " · " + m : ""}`));
        bildir(
          `${sonuc.eklenen} not içeri aktarıldı.` + (sonuc.gorselEklenen ? ` ${sonuc.gorselEklenen} görsel eklere yüklendi.` : "") + (sonuc.hata.length ? ` ${sonuc.hata.length} not eklenemedi.` : "") + (sonuc.gorselSorunlari?.length ? ` ${sonuc.gorselSorunlari.length} görsel yüklenemedi.` : ""),
          sonuc.hata.length || sonuc.gorselSorunlari?.length ? "warning" : "success"
        );
        if (sonuc.hata.length) {
          atlanan = [...sonuc.hata, ...(sonuc.gorselSorunlari || [])];
          taslaklar = taslaklar.filter((x) => sonuc.basarisiz.includes(x.t));
          taslaklar.forEach((x) => (x.secili = true));
          meşgul = false;
          kapatBtn.disabled = false;
          ilerleme.hidden = true;
          ciz();
          return;
        }
        meşgul = false;
        d.close();
        coz(sonuc);
      } catch (h) {
        console.error(h);
        hata.hidden = false;
        hata.textContent = "İçeri aktarılamadı: " + (h.message || h);
        ilerleme.hidden = true;
        meşgul = false;
        kapatBtn.disabled = false;
        ciz();
      }
    });

    d.append(form);
    kok.append(d);
    ciz();
    d.showModal();
  });
}
