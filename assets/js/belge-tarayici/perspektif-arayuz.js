/*
 * assets/js/belge-tarayici/perspektif-arayuz.js — Dört noktalı perspektif düzeltme penceresi (büyüteçli köşe pinleri).
 * Pinler: sürükle (fare/dokunma/kalem) ya da odaklanıp ok tuşları (Shift = büyük adım). Büyüteç sürüklerken pinin 4× yakınını gösterir.
 * Inline stil YOK (CSP): konumlar CSSOM (element.style) ile verilir. Sonuç: normalize köşeler [[x,y]×4] ya da null (vazgeç).
 */
import { el, dugme } from "../donusturucu/ortak.js";
import { kaynakTuvaliAl, otomatikKose, VARSAYILAN_KOSELER } from "./tarama.js";
import { tuvalBirak } from "./bellek-kalkani.js";

const ETIKET = ["Sol üst köşe", "Sağ üst köşe", "Sağ alt köşe", "Sol alt köşe"];
const LUP = 128; const ZOOM = 4;

export async function koseDuzenle(oge) {
  let kaynak = null;
  try { kaynak = await kaynakTuvaliAl(oge.blob, oge.ad, oge.dondur || 0, 1600); } catch (h) { throw new Error(`Görsel açılamadı: ${h.message || h}`); }
  const { tuval, w, h } = kaynak;
  let kose = (oge.kose || VARSAYILAN_KOSELER()).map(([x, y]) => [x, y]);

  return new Promise((coz) => {
    const d = el("dialog", { class: "dn-dialog bt-koseler-dialog" });
    const sahne = el("div", { class: "bt-sahne" });
    const ust = document.createElement("canvas");
    ust.width = w; ust.height = h; ust.className = "bt-sahne-ust";
    tuval.className = "bt-sahne-taban";
    const lup = document.createElement("canvas");
    lup.width = LUP; lup.height = LUP; lup.className = "bt-lup"; lup.hidden = true;
    lup.setAttribute("aria-hidden", "true");
    const pinler = ETIKET.map((e, i) => el("button", { type: "button", class: "bt-pin", "aria-label": `${e}: sürükle veya ok tuşlarıyla taşı`, "data-i": String(i), text: String(i + 1) }));
    sahne.append(tuval, ust, ...pinler, lup);

    const cizUst = (aktif = -1) => {
      const g = ust.getContext("2d");
      g.clearRect(0, 0, w, h);
      const px = kose.map(([x, y]) => [x * w, y * h]);
      g.lineWidth = Math.max(2, w / 300);
      g.strokeStyle = "#22c55e"; g.fillStyle = "rgba(34,197,94,.14)";
      g.beginPath(); px.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke();
      pinler.forEach((p, i) => { p.style.left = `${kose[i][0] * 100}%`; p.style.top = `${kose[i][1] * 100}%`; p.classList.toggle("bt-pin--aktif", i === aktif); });
    };
    const cizLup = (i) => {
      const g = lup.getContext("2d");
      const [cx, cy] = [kose[i][0] * w, kose[i][1] * h];
      const kare = Math.max(24, LUP / ZOOM / ((sahne.clientWidth || w) / w)); // ekranda ~4× büyütme
      g.fillStyle = "#fff"; g.fillRect(0, 0, LUP, LUP);
      g.imageSmoothingEnabled = true;
      g.drawImage(tuval, cx - kare / 2, cy - kare / 2, kare, kare, 0, 0, LUP, LUP);
      g.strokeStyle = "#ef4444"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(LUP / 2, 0); g.lineTo(LUP / 2, LUP); g.moveTo(0, LUP / 2); g.lineTo(LUP, LUP / 2); g.stroke();
      lup.hidden = false;
      // büyüteç, pinin bulunduğu yarının karşısında durur (parmağın altında kalmasın)
      lup.classList.toggle("bt-lup--sag", kose[i][0] < 0.5);
      lup.classList.toggle("bt-lup--alt", kose[i][1] < 0.5);
    };
    const tasi = (i, x, y) => { kose[i] = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]; cizUst(i); cizLup(i); };

    pinler.forEach((p, i) => {
      p.addEventListener("pointerdown", (e) => { e.preventDefault(); p.setPointerCapture(e.pointerId); p.dataset.surukle = "1"; cizUst(i); cizLup(i); });
      p.addEventListener("pointermove", (e) => {
        if (p.dataset.surukle !== "1") return;
        const r = sahne.getBoundingClientRect();
        tasi(i, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      });
      const bitir = () => { p.dataset.surukle = ""; lup.hidden = true; cizUst(-1); };
      p.addEventListener("pointerup", bitir);
      p.addEventListener("pointercancel", bitir);
      p.addEventListener("keydown", (e) => {
        const a = e.shiftKey ? 0.01 : 0.002;
        const f = { ArrowLeft: [-a, 0], ArrowRight: [a, 0], ArrowUp: [0, -a], ArrowDown: [0, a] }[e.key];
        if (!f) return;
        e.preventDefault(); tasi(i, kose[i][0] + f[0], kose[i][1] + f[1]);
      });
      p.addEventListener("keyup", () => { lup.hidden = true; cizUst(-1); });
    });

    const otomatik = dugme({ metin: "Otomatik algıla", ikon: "✨" });
    const sifirla = dugme({ metin: "Sıfırla" });
    const iptal = dugme({ metin: "Vazgeç" });
    const uygula = dugme({ metin: "Uygula", tur: "birincil" });
    const not = el("p", { class: "dn-muted", role: "status" });
    otomatik.addEventListener("click", async () => {
      otomatik.disabled = true; not.textContent = "Kâğıt kenarları aranıyor…";
      try {
        const k = await otomatikKose(tuval);
        if (k) { kose = k; cizUst(-1); not.textContent = "Köşeler bulundu; gerekirse pinleri ince ayarla."; } else not.textContent = "Otomatik algılanamadı (arka plan–kâğıt kontrastı düşük). Pinleri elle yerleştir.";
      } finally { otomatik.disabled = false; }
    });
    sifirla.addEventListener("click", () => { kose = VARSAYILAN_KOSELER(); cizUst(-1); not.textContent = ""; });

    let sonuc = null;
    iptal.addEventListener("click", () => d.close());
    uygula.addEventListener("click", () => { sonuc = kose; d.close(); });
    d.addEventListener("close", () => { tuvalBirak(tuval); tuvalBirak(ust); tuvalBirak(lup); d.remove(); coz(sonuc); });
    d.append(el("div", { class: "dn-dialog-govde bt-koseler-govde" },
      el("h3", { class: "dn-dialog-baslik", text: "Köşeleri düzelt (perspektif)" }),
      el("p", { class: "dn-muted", text: "Dört pini belgenin köşelerine yerleştir; masa/arka plan kırpılır, eğik çekim düzleşir." }),
      sahne, not,
      el("div", { class: "dn-dialog-eylem bt-koseler-eylem" }, otomatik, sifirla, iptal, uygula)));
    document.body.append(d);
    d.showModal();
    cizUst(-1);
    pinler[0].focus();
  });
}
