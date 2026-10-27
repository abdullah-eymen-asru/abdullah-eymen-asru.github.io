/*
 * assets/js/akademik/eklenti-paneli.js — Akademik Kütüphane › "🧩 Okuyucu eklentileri" ayar paneli (her kullanıcı kendi eklentilerini yönetir).
 * Eklenti mantığı eklentiler.js'tedir; burada yalnızca açma/kapama, eklenti ayarları ve "özel arama bağlantısı" ekleme arayüzü vardır.
 * Depolama: kullanıcı başına tek küçük satır (≤ 8 KB) + yerel yedek. PDF/çeviri içeriği HİÇBİR yere kaydedilmez. CSP: satır içi stil/olay yok.
 */
import { el, toast } from "./ortak.js";
import { KATALOG, eklentilerAcikMi, ayarYukle, ayarKaydet, ozelUrlGecerli } from "./eklentiler.js";

export async function eklentiPaneliKur(yer) {
  if (!yer) return;
  if (!(await eklentilerAcikMi())) { yer.replaceChildren(); yer.hidden = true; return; }       // Yetki Ayarları'ndan kapalıysa panel hiç görünmez
  const a = structuredClone(await ayarYukle());
  const durum = el("small", { class: "ak-alt", role: "status" });
  let zamanlayici = null;
  const kaydet = () => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(async () => {
      const s = await ayarKaydet(a);
      durum.textContent = s.bulut ? "Kaydedildi (hesabına bağlı; tüm cihazlarında geçerli)." : `Bu tarayıcıya kaydedildi (hesaba yazılamadı${s.hata ? `: ${s.hata}` : ""}).`;
    }, 350);
  };
  const ciz = () => {
    const liste = el("div", { class: "ak-ek-liste" });
    const satir = (id, ad, simge, aciklama, ayarlar, ozel, gizlilik) => {
      const kutu = el("input", { type: "checkbox", id: `ak-ek-${id}`, checked: a.acik.includes(id) });
      kutu.addEventListener("change", () => { a.acik = kutu.checked ? [...new Set([...a.acik, id])] : a.acik.filter((x) => x !== id); kaydet(); });
      const ayarAlan = el("div", { class: "ak-ek-ayar" });
      for (const s of ayarlar || []) {
        const sec = el("select", { "aria-label": s.etiket }, ...Object.entries(s.secenekler).map(([k, v]) => el("option", { value: k }, v)));
        sec.value = a.ayar[id]?.[s.anahtar] || s.varsayilan;
        sec.addEventListener("change", () => { a.ayar[id] = { ...(a.ayar[id] || {}), [s.anahtar]: sec.value }; kaydet(); });
        ayarAlan.append(el("label", {}, `${s.etiket}: `, sec));
      }
      const sil = ozel ? el("button", { type: "button", class: "ak-btn" }, "Sil") : null;
      sil?.addEventListener("click", () => { a.ozel = a.ozel.filter((x) => x.id !== id); a.acik = a.acik.filter((x) => x !== id); kaydet(); ciz(); });
      return el("div", { class: "ak-ek-satir" },
        el("label", { class: "ak-ek-ust", for: `ak-ek-${id}` }, kutu, el("span", { class: "ak-ek-simge", "aria-hidden": "true" }, simge), el("strong", {}, ad), el("span", { class: `ak-ek-rozet ${gizlilik === "yerel" ? "yerel" : "dis"}` }, gizlilik === "yerel" ? "🔒 Yerel — veri cihazdan çıkmaz" : "↗ Dış site — tıklayınca yeni sekmede açar")),
        el("small", { class: "ak-alt" }, aciklama), ayarAlan, sil);
    };
    for (const [id, k] of Object.entries(KATALOG)) liste.append(satir(id, k.ad, k.simge, k.aciklama, k.ayarlar, false, k.gizlilik));
    for (const o of a.ozel) liste.append(satir(o.id, o.ad, o.simge, `Özel arama bağlantısı: ${o.url}`, [], true, "baglanti"));

    const ad = el("input", { type: "text", maxlength: "40", placeholder: "Ad (örn. Dergipark)", "aria-label": "Eklenti adı" });
    const url = el("input", { type: "url", maxlength: "500", placeholder: "https://…?q={metin}", "aria-label": "Arama adresi ({metin} içermeli)" });
    const ekle = el("button", { type: "button", class: "ak-btn" }, "＋ Arama eklentisi ekle");
    ekle.addEventListener("click", () => {
      if (!ad.value.trim()) { toast("Bir ad yaz.", "uyari"); return; }
      if (!ozelUrlGecerli(url.value.trim())) { toast("Adres https:// ile başlamalı ve {metin} içermeli.", "uyari"); return; }
      if (a.ozel.length >= 10) { toast("En fazla 10 özel eklenti eklenebilir.", "uyari"); return; }
      const id = `ozel-${Date.now().toString(36)}`;
      a.ozel.push({ id, ad: ad.value.trim(), simge: "🔗", url: url.value.trim() }); a.acik.push(id); kaydet(); ciz();
    });
    yer.replaceChildren(el("details", { class: "ak-motor-kart ak-ek-kart" },
      el("summary", {}, "🧩 Okuyucu eklentileri", el("small", { class: "ak-alt" }, " — PDF'te metin seçince balonda çıkar (çeviri, sözlük, Vikipedi, künye bulma…)")),
      el("p", { class: "ak-alt" }, "Gizlilik: hiçbir eklenti seçili metni sitemizden bir üçüncü tarafa göndermez. “Yerel” eklentiler tamamen cihazında çalışır; “Dış site” eklentileri yalnızca SEN tıklayınca yeni sekmede bir adres açar (Google/DeepL gibi servisler varsayılan KAPALIDIR, tercih sende). Depolama kotanı kullanmaz; dış kod çalıştırılmaz."),
      liste,
      el("div", { class: "ak-ek-ekle" }, el("strong", {}, "Özel arama eklentisi"), ad, url, ekle, el("small", { class: "ak-alt" }, "Örnek: https://dergipark.org.tr/tr/search?q={metin}")),
      durum));
  };
  ciz();
}
