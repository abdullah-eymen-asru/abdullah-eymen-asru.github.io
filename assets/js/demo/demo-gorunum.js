/*
 * assets/js/demo/demo-gorunum.js — Demo modunda panel görünümü: vitrin bandı, alt özellik gizleme, kritik eylem kalkanı,
 * "Örnek ZIP İnceleme" kartı.
 * -----------------------------------------------------------------------
 *  • Alt özellikler (yapılandırma: demo_config) <html data-demo-gizle="pdf-arac zip not-cip"> jetonlarıyla gizlenir;
 *    kurallar assets/css/demo.css'te. CSS ile gizleme, modüllerin sonradan (tembel) çizdiği öğeleri de kapsar.
 *    Kapalı "ZIP inceleme" kartı hiç DOM'a eklenmez.
 *  • Kritik düğmeler (yükle / klasör oluştur / toplu sil / kaynak ekle / içe aktar / yedek) capture fazında yakalanır:
 *    dosya seçici açılmadan ve istek hazırlanmadan toast gösterilir. (Ağ kalkanı yine ikinci emniyet olarak durur.)
 *  • innerHTML yok (CSP + XSS); metinler textContent.
 */
import { demoBildir, demoCikisYap, ozellikAcikMi } from "./demo-durum.js";

const KRITIK = [
  "#ra-yukle-dosya", "#ra-yukle-klasor", "#ra-klasor-yeni", "#ra-secim-sil",
  '[data-act="ekle"]', '[data-act="ice-aktar"]', "[data-ak-dz]",
  "#nt-yedek-sifreli-btn", "#nt-kurtarma-yenile-btn",
].join(",");

const el = (tag, ozellik = {}, ...cocuk) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(ozellik)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuk.flat()) if (c != null && c !== false) n.append(c);
  return n;
};

function bandKur() {
  const main = document.getElementById("dash-main");
  if (!main || document.getElementById("demo-bandi")) return;
  const cikis = el("button", { type: "button", class: "demo-bandi-btn", text: "Demodan çık" });
  cikis.addEventListener("click", async () => {
    cikis.disabled = true;
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("../core/supabase-client.js");
    await demoCikisYap(SUPABASE_URL, SUPABASE_ANON_KEY); // anonimde yalnızca bayrak; demo üyesinde gerçek oturum da kapanır
    window.location.href = "/hesap/giris.html";
  });
  main.prepend(
    el("div", { id: "demo-bandi", class: "demo-bandi", role: "note" },
      el("span", { class: "demo-bandi-ikon", "aria-hidden": "true", text: "🎭" }),
      el("span", { class: "demo-bandi-metin", text: "Vitrin modu: örnek verilerle salt-okunur deneyim. Hiçbir değişiklik kaydedilmez ve gerçek sunucuya iletilmez." }),
      cikis)
  );
}

function altOzellikleriUygula() {
  const g = [];
  if (!ozellikAcikMi("pdf.duzenlemeAraclari")) g.push("pdf-arac");
  if (!ozellikAcikMi("arsiv.zipInceleme")) g.push("zip");
  if (!ozellikAcikMi("notlar.filtreCipleri")) g.push("not-cip");
  document.documentElement.dataset.demoGizle = g.join(" ");
}

const bayt = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function zipKartiKur() {
  const gorunum = document.getElementById("view-media-arsiv");
  if (!gorunum || document.getElementById("demo-zip-karti") || !ozellikAcikMi("arsiv.zipInceleme")) return;
  const sonuc = el("div", { class: "demo-zip-sonuc", "aria-live": "polite" });
  const onizleme = el("pre", { class: "demo-zip-onizleme", hidden: true });
  const btn = el("button", { type: "button", class: "demo-btn", text: "Örnek paketi incele" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    sonuc.textContent = "Açılıyor…";
    onizleme.hidden = true;
    try {
      const r = await fetch("/assets/demo/ornek-arsiv.zip"); // aynı origin: statik örnek dosya (R2 değil)
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { zipOku } = await import("../notlar/ice-aktar/zip-oku.js");
      const zip = await zipOku(await r.arrayBuffer());
      const liste = el("ul", { class: "demo-zip-liste" });
      for (const g of zip.girisler) {
        const satir = el("li", {}, el("span", { text: `${g.dizin ? "📁" : "📄"} ${g.ad}` }), el("small", { class: "muted", text: g.dizin ? "" : ` · ${bayt(g.usize)}` }));
        if (!g.dizin && /\.(txt|md|csv|json)$/i.test(g.ad)) {
          const a = el("button", { type: "button", class: "demo-link", text: "göster" });
          a.addEventListener("click", async () => {
            onizleme.textContent = (await zip.metin(g)).slice(0, 4000);
            onizleme.hidden = false;
          });
          satir.append(" ", a);
        }
        liste.append(satir);
      }
      sonuc.replaceChildren(el("p", { class: "muted", text: `${zip.girisler.length} öğe (yalnızca okunur; hiçbir şey çıkarılmaz/kaydedilmez):` }), liste);
    } catch (h) {
      sonuc.textContent = "Örnek paket açılamadı: " + (h?.message || h);
    } finally {
      btn.disabled = false;
    }
  });
  gorunum.append(
    el("section", { id: "demo-zip-karti", class: "panel-section demo-zip-karti", "data-demo-ozellik": "zip" },
      el("h2", { text: "🗜️ Örnek ZIP İnceleme" }),
      el("p", { class: "muted", text: "Tarayıcıda, sunucuya hiçbir şey göndermeden bir ZIP paketinin içeriğini incele." }),
      btn, sonuc, onizleme)
  );
}

export function demoGorunumuKur() {
  bandKur();
  altOzellikleriUygula();
  zipKartiKur();
  // Kritik eylem kalkanı: capture fazı → hedef düğmenin kendi dinleyicisinden ÖNCE çalışır.
  document.addEventListener(
    "click",
    (e) => {
      const hedef = e.target instanceof Element ? e.target.closest(KRITIK) : null;
      if (!hedef) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      demoBildir();
    },
    true
  );
  // Sürükle-bırak yükleme: bırakma yakalanır, dosya hiç işlenmez.
  for (const ad of ["dragover", "drop"]) {
    document.addEventListener(
      ad,
      (e) => {
        if (!(e.target instanceof Element) || !e.target.closest("#view-media-arsiv, #view-lib-kutuphane")) return;
        e.preventDefault();
        if (ad === "drop") {
          e.stopImmediatePropagation();
          demoBildir();
        }
      },
      true
    );
  }
}
