/*
 * assets/js/demo/demo-metrik.js — Demo "Sistem / Metrikler" sekmesi: STATİK vitrin grafikleri.
 * Gerçek R2/Supabase/Worker kullanım metriği ASLA sorgulanmaz; rakamlar bu dosyada sabittir.
 * Import edilince #demo-metrik-kok'u doldurur. innerHTML yok; stil yalnızca assets/css/demo.css sınıflarıyla.
 */
const kok = document.getElementById("demo-metrik-kok");

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

// Değer çubuğu: genişlik yüzdesi `data-yuzde` ile değil, 5'lik adımlı sınıfla (CSP: inline style yok).
const adim = (y) => `demo-w-${Math.max(0, Math.min(100, Math.round(y / 5) * 5))}`;

function olcer(baslik, etiket, yuzde, alt) {
  return el("section", { class: "panel-section demo-olcer" },
    el("h2", { text: baslik }),
    el("p", { class: "demo-olcer-deger", text: etiket }),
    el("div", { class: "demo-cubuk", role: "img", "aria-label": `${baslik}: ${etiket}` },
      el("div", { class: `demo-cubuk-dolu ${adim(yuzde)}` })),
    el("p", { class: "muted", text: alt }));
}

// Son 14 gün istek sayısı (örnek). Toplam = 1.240 → "1.240 / 100.000 istek".
const GUNLUK = [62, 71, 80, 95, 88, 64, 58, 90, 101, 97, 92, 85, 73, 84];

function seri() {
  const enBuyuk = Math.max(...GUNLUK);
  const cubuklar = GUNLUK.map((v, i) =>
    el("div", { class: "demo-seri-kol", title: `${14 - i} gün önce: ${v} istek` },
      el("div", { class: `demo-seri-cubuk ${adim((v / enBuyuk) * 100)}` })));
  return el("section", { class: "panel-section" },
    el("h2", { text: "Son 14 gün · günlük istek (örnek)" }),
    el("div", { class: "demo-seri", role: "img", "aria-label": "Son 14 günün örnek istek sayıları" }, cubuklar),
    el("p", { class: "muted", text: `Toplam ${GUNLUK.reduce((a, b) => a + b, 0).toLocaleString("tr-TR")} istek (statik örnek veri).` }));
}

if (kok && !kok.dataset.hazir) {
  kok.dataset.hazir = "1";
  kok.replaceChildren(
    el("p", { class: "muted", text: "Bu sayfadaki rakamlar vitrin için hazırlanmış statik örneklerdir; gerçek depolama veya istek kullanımı sorgulanmaz." }),
    el("div", { class: "panel-grid" },
      olcer("💾 Depolama", "%42 Depolama", 42, "4,2 GB / 10 GB (örnek)"),
      olcer("⚡ Worker İstekleri", "1.240 / 100.000 İstek", 1.24, "Bugün · günlük kota %1,2 (örnek)"),
      olcer("📦 R2 Okuma/Yazma", "38 yazma · 1.240 okuma", 12, "Bu ay (örnek)")),
    seri());
}
