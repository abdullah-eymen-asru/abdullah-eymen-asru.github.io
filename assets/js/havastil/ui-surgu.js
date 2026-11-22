/**
 * ui-surgu.js — HavaStil ayar sayfaları için SÜRGÜLÜ AÇ/KAPAT düğmesi ("Yetki Ayarları"ndaki .ya-mini-toggle ile aynı görünüm ve mantık).
 * Kırmızı = kapalı, yeşil = açık; durum aynı zamanda YAZIYLA ("Açık"/"Kapalı") ve ekran okuyucu için role="switch" ile söylenir, böylece
 * rengi ayırt edemeyen biri de emin olabilir. Gerçek <input type="checkbox"> kullanılır (klavye: Boşluk; odak halkası görünür).
 *
 *   surgu({ ad, aciklama, acik, onDegis, kilitli, etiketler }) → { kok, input, ayarla(acikMi) }
 *   onDegis(yeniDeger) bir söz (Promise) dönebilir: reddedilirse düğme eski konumuna döner (kaydedilemeyen bir şey "açık" görünmesin).
 * CSP: inline stil/işleyici yok; görünüm havastil.css (.hv-surgu*).
 */
import { el, olay } from "./ui-temel.js";

let sayac = 0;
export function surgu({ ad, aciklama = "", acik = false, onDegis = null, kilitli = false, etiketler = ["Açık", "Kapalı"], simge = "" } = {}) {
  const id = `hv-surgu-${++sayac}`;
  const input = el("input", { type: "checkbox", id, role: "switch", class: "hv-surgu-input" });
  input.checked = !!acik; input.disabled = !!kilitli;
  input.setAttribute("aria-checked", String(!!acik));
  const durum = el("span", { class: "hv-surgu-durum", "aria-hidden": "true" });
  const kok = el("label", { class: "hv-surgu", for: id },
    el("span", { class: "hv-surgu-metin" },
      el("strong", { class: "hv-surgu-ad", text: `${simge ? `${simge} ` : ""}${ad}` }),
      aciklama ? el("small", { class: "hv-surgu-aciklama", text: aciklama }) : null),
    el("span", { class: "hv-surgu-sag" }, durum,
      el("span", { class: "hv-surgu-duzenek" }, input, el("span", { class: "hv-surgu-iz", "aria-hidden": "true" }, el("span", { class: "hv-surgu-top" })))));
  const boya = () => { kok.classList.toggle("acik", input.checked); durum.textContent = input.checked ? etiketler[0] : etiketler[1]; input.setAttribute("aria-checked", String(input.checked)); };
  boya();
  olay(input, "change", async () => {
    const yeni = input.checked; boya();
    if (!onDegis) return;
    input.disabled = true;
    try { await onDegis(yeni); } catch { input.checked = !yeni; boya(); } finally { input.disabled = !!kilitli; }
  });
  return { kok, input, ayarla: (v) => { input.checked = !!v; boya(); } };
}
