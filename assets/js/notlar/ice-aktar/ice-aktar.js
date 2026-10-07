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
            "label",
            { class: "nt-ia-oge" + (x.mukerrer ? " nt-ia-mukerrer" : "") },
            kutu,
            el("span", { class: "nt-ia-ad", text: x.t.baslik || "Başlıksız not" }),
            el("span", { class: "nt-ia-ozet muted", text: ozetMetni(x.t) }),
            meta ? el("span", { class: "nt-ia-meta muted", text: meta }) : null,
            x.t.uyarilar.length ? el("span", { class: "nt-ia-meta nt-ia-ikaz", text: x.t.uyarilar.join(" ") }) : null
          );
        })
      );
      uyari.hidden = !atlanan.length;
      uyari.replaceChildren(el("strong", { text: `${atlanan.length} öğe alınamadı` }), el("ul", {}, ...atlanan.slice(0, 12).map((a) => el("li", { text: a })), atlanan.length > 12 ? el("li", { text: `… ve ${atlanan.length - 12} öğe daha` }) : null));
      const n = secilenler().length;
      yapiSatiri.hidden = !taslaklar.some((x) => x.t.klasorYolu.length);
      ozet.textContent = taslaklar.length ? `${taslaklar.length} not bulundu, ${n} seçili. Şifreli kasana eklenecek; aynı başlıkta olanlar işaretlenmemiştir.` : "Bir dosya seç; notlar önce burada listelenir, hiçbir şey kendiliğinden eklenmez.";
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
          `${sonuc.eklenen} not içeri aktarıldı.` + (sonuc.hata.length ? ` ${sonuc.hata.length} not eklenemedi.` : ""),
          sonuc.hata.length ? "warning" : "success"
        );
        if (sonuc.hata.length) {
          atlanan = sonuc.hata;
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
