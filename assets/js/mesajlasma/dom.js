/*
 * assets/js/mesajlasma/dom.js — mesajlaşma modüllerinin ortak DOM yardımcıları.
 * innerHTML YOK (çözülmüş mesaj metni asla HTML olarak yorumlanmaz), inline stil YOK (CSP).
 * h(): null/false çocuklar ve öznitelikler YOK SAYILIR (eski "null" yazısı hatasının kök nedeni replaceChildren(null) idi).
 */
export function h(etiket, oz = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(oz || {})) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of cocuklar.flat(Infinity)) if (c != null && c !== false) d.append(c);
  return d;
}

/** replaceChildren'in null-güvenli hâli. */
export function doldur(kap, ...cocuklar) {
  kap.replaceChildren(...cocuklar.flat(Infinity).filter((c) => c != null && c !== false));
}

export function saatMetni(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bugun = new Date();
  const ayniGun = d.toDateString() === bugun.toDateString();
  return ayniGun
    ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Tarayıcı confirm() yerine erişilebilir modal. secenekler: [{metin, deger, tur:"tehlike"|"birincil"|"ikincil"}] → seçilen değer ya da null. */
export function modalSor({ baslik, metin, secenekler }) {
  return new Promise((coz) => {
    const onceki = document.activeElement;
    const kapat = (v) => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); coz(v); };
    const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(null); } };
    const dugmeler = secenekler.map((s) => h("button", { type: "button", class: `msj-btn msj-btn--${s.tur || "ikincil"}`, text: s.metin, onclick: () => kapat(s.deger) }));
    const kutu = h("div", { class: "msj-modal", role: "dialog", "aria-modal": "true", "aria-label": baslik },
      h("h3", { class: "msj-modal-baslik", text: baslik }),
      metin ? h("p", { class: "msj-modal-metin", text: metin }) : null,
      h("div", { class: "msj-modal-eylem" }, dugmeler));
    const kaplama = h("div", { class: "msj-modal-kaplama", onclick: (e) => { if (e.target === kaplama) kapat(null); } }, kutu);
    document.body.append(kaplama);
    document.addEventListener("keydown", tus, true);
    (dugmeler.find((d) => d.className.includes("birincil")) || dugmeler[0])?.focus();
  });
}
