/*
 * assets/js/silme-onayi/dosyalar.js — Silinen üyenin R2 dosyalarını listele / önizle / indir (yalnızca Site Sahibi).
 * Migration 0081 (hesap_silme_dosya_listesi) + sistem-yedek-worker v2 (/uye/dosya).
 *  • Yetki: Worker her dosya için hesap_silme_dosya_izinli_mi() ile "bu dosya bu üyenin silme kuyruğundaki verisi mi" doğrular.
 *  • Önizleme yalnızca şifresiz PDF (ilk sayfa, PDF.js) ve PNG/JPEG/WebP/GIF içindir; şifreli (E2EE) dosyalar önizlenemez,
 *    ham haliyle (.sifreli) indirilir. SVG/HTML asla önizlenmez.
 *  • Toplu indirme: tek ZIP (akışlı; Dosya Sistemi API'si varsa doğrudan diske) ya da dosyayı tek tek.
 *  • Maliyet: R2 → Worker → tarayıcı; R2'den çıkış ücreti yoktur (zero-egress).
 *  • İndirmeler denetim günlüğüne yazılır. innerHTML yok, inline stil yok (CSP).
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, workerFetch, hataMetni, dugme } from "../sistem-yedek/ortak.js";
import { AkisliZip, aliciOlustur } from "../sistem-yedek/zip-yazici.js";

const ONIZLENEBILIR = /^image\/(png|jpe?g|webp|gif)$/i;
const temizYol = (s) => String(s || "").replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter((p) => p && p !== "..").join("/");
const sayi = (n) => Number(n || 0).toLocaleString("tr-TR");

export function dosyaPaneliKur(kok, uye, mesaj) {
  let dosyalar = [];
  const secili = new Set();
  const urller = new Set();
  const liste = el("div", { class: "so-dosya-izgara" });
  const cubuk = el("div", { class: "sy-gz-cubuk", role: "status", "aria-live": "polite" });
  const ozet = el("span", { class: "sy-gz-cubuk-metin" });
  const zipBtn = dugme({ metin: "Seçilenleri ZIP indir", ikonAdi: "indir", tur: "birincil", kucuk: true });
  const hepsiBtn = dugme({ metin: "Hepsini seç", tur: "ikincil", kucuk: true });
  const iptalBtn = dugme({ metin: "İptal", ikonAdi: "durdur", tur: "ikincil", kucuk: true, hidden: true });
  cubuk.append(ozet, hepsiBtn, zipBtn, iptalBtn);
  let denetci = null;

  const anahtar = (d) => `${d.kaynak}|${d.anahtar}`;
  const url = (d) => `/uye/dosya?u=${uye}&b=${d.kaynak}&k=${encodeURIComponent(d.anahtar)}`;
  const dosyaAdi = (d) => `${d.ad}${d.sifreli && !/\.sifreli$/.test(d.ad) ? ".sifreli" : ""}`;

  function ozetGuncelle() {
    const s = dosyalar.filter((d) => secili.has(anahtar(d)));
    ozet.textContent = `${sayi(dosyalar.length)} dosya · ${bayt(dosyalar.reduce((n, d) => n + Number(d.boyut || 0), 0))} — ${sayi(s.length)} seçili (${bayt(s.reduce((n, d) => n + Number(d.boyut || 0), 0))})`;
    zipBtn.disabled = !s.length || !!denetci;
  }

  async function onizle(d, alan, btn) {
    btn.disabled = true;
    try {
      const r = await workerFetch(url(d));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const blob = await r.blob();
      if (ONIZLENEBILIR.test(blob.type)) {
        const u = URL.createObjectURL(blob);
        urller.add(u);
        alan.replaceChildren(el("img", { src: u, alt: d.ad }));
      } else if (blob.type === "application/pdf") {
        const { pdfjsAl, pdfBirak } = await import("../donusturucu/pdf-yukle.js");
        const pdfjs = await pdfjsAl();
        const gorev = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        try {
          const pdf = await gorev.promise;
          const sayfa = await pdf.getPage(1);
          const vp0 = sayfa.getViewport({ scale: 1 });
          const vp = sayfa.getViewport({ scale: Math.min(2, 440 / vp0.width) });
          const tuval = document.createElement("canvas");
          tuval.width = Math.floor(vp.width); tuval.height = Math.floor(vp.height);
          await sayfa.render({ canvasContext: tuval.getContext("2d"), viewport: vp }).promise;
          alan.replaceChildren(tuval);
          pdfBirak(gorev, pdf);
        } catch (h) { pdfBirak(gorev); throw h; }
      } else {
        alan.replaceChildren(el("p", { class: "muted", text: "Bu tür önizlenemez; indirerek aç." }));
      }
    } catch (h) {
      alan.replaceChildren(el("p", { class: "auth-message error", text: `Önizleme başarısız: ${h.message || h}` }));
    } finally { btn.disabled = false; }
  }

  async function tekIndir(d) {
    try {
      const r = await workerFetch(url(d));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = el("a", { href: u, download: dosyaAdi(d) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    } catch (h) { mesaj(`İndirilemedi: ${h.message || h}`); }
  }

  function karti(d) {
    const kutu = el("input", { type: "checkbox", "aria-label": `${d.ad} dosyasını seç` });
    kutu.checked = secili.has(anahtar(d));
    kutu.addEventListener("change", () => { if (kutu.checked) secili.add(anahtar(d)); else secili.delete(anahtar(d)); ozetGuncelle(); });
    const alan = el("div", { class: "so-dosya-onizleme" });
    const izleBtn = dugme({ metin: "Önizle", ikonAdi: "goz", tur: "ikincil", kucuk: true, disabled: d.sifreli || !(d.kaynak === "akademik" || ONIZLENEBILIR.test(d.mime || "") || d.mime === "application/pdf") });
    izleBtn.addEventListener("click", () => onizle(d, alan, izleBtn));
    const indirBtn = dugme({ metin: "İndir", ikonAdi: "indir", tur: "ikincil", kucuk: true });
    indirBtn.addEventListener("click", () => tekIndir(d));
    return el("article", { class: "so-dosya-kart" },
      el("label", { class: "sy-gz-etiket" }, kutu, el("span", { class: "so-dosya-ad", text: `${d.klasor || ""}${d.ad}` })),
      el("span", { class: "muted", text: `${bayt(d.boyut)}${d.sifreli ? " · şifreli (E2EE)" : ""}` }),
      alan,
      el("div", { class: "sy-eylemler" }, izleBtn, indirBtn));
  }

  async function zipIndir() {
    const sec = dosyalar.filter((d) => secili.has(anahtar(d)));
    if (!sec.length || denetci) return;
    denetci = new AbortController();
    zipBtn.disabled = true; iptalBtn.hidden = false;
    let islem = null;
    let zip = null;
    try {
      const ad = `silinen-uye-${uye.slice(0, 8)}-dosyalar-${new Date().toISOString().slice(0, 10)}.zip`;
      // Dosya seçici tıklama hareketinin hemen ardından (ilk await) açılmalı
      const alici = await aliciOlustur(ad);
      zip = new AkisliZip(alici);
      const b = await supabase.rpc("sistem_islem_baslat", { p_tur: "silinen_uye_dosya_indirme", p_ayrinti: { uye, adet: sec.length, bayt: sec.reduce((n, d) => n + Number(d.boyut || 0), 0) } });
      if (b.error) throw b.error;
      islem = b.data;
      const hatalar = [];
      let i = 0;
      for (const d of sec) {
        i += 1;
        ozet.textContent = `ZIP hazırlanıyor ${i}/${sec.length}: ${d.ad}`;
        try {
          const r = await workerFetch(url(d), { sinyal: denetci.signal });
          if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
          await zip.akisEkle(temizYol(`${d.klasor || ""}${dosyaAdi(d)}`) || dosyaAdi(d), r.body, { sinyal: denetci.signal });
        } catch (h) {
          if (h?.name === "AbortError") throw h;
          hatalar.push(`${d.ad}: ${h.message || h}`);
        }
      }
      if (hatalar.length) await zip.dosyaEkle("HATALAR.txt", hatalar.join("\n"));
      const sonuc = await zip.bitir();
      zip = null;
      if (sonuc.blob) {
        const u = URL.createObjectURL(sonuc.blob);
        const a = el("a", { href: u, download: ad });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 60000);
      }
      await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: true, p_ozet: { boyut: sonuc.boyut, hata: hatalar.length } });
      mesaj(`ZIP hazır: ${ad} (${bayt(sonuc.boyut)}).${hatalar.length ? ` ${hatalar.length} dosya alınamadı (HATALAR.txt).` : ""}`, hatalar.length ? "error" : "success");
    } catch (h) {
      if (zip) { try { await zip.iptal(); } catch { /* yok say */ } }
      if (islem) { try { await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: false, p_ozet: { hata: String(h.message || h).slice(0, 200) } }); } catch { /* best-effort */ } }
      mesaj(h?.name === "AbortError" ? "ZIP indirme iptal edildi." : `ZIP oluşturulamadı: ${hataMetni(h)}`);
    } finally {
      denetci = null; iptalBtn.hidden = true; ozetGuncelle();
    }
  }

  hepsiBtn.addEventListener("click", () => {
    const hepsi = dosyalar.every((d) => secili.has(anahtar(d)));
    for (const d of dosyalar) { if (hepsi) secili.delete(anahtar(d)); else secili.add(anahtar(d)); }
    ciz();
  });
  zipBtn.addEventListener("click", zipIndir);
  iptalBtn.addEventListener("click", () => denetci?.abort());

  function ciz() {
    liste.replaceChildren(...(dosyalar.length ? dosyalar.map(karti) : [el("p", { class: "muted", text: "Bu üyenin R2'de dosyası yok." })]));
    hepsiBtn.querySelector("span").textContent = dosyalar.every((d) => secili.has(anahtar(d))) && dosyalar.length ? "Seçimi kaldır" : "Hepsini seç";
    ozetGuncelle();
  }

  /** Panel kapanırken/yenilenirken önizleme URL'leri ve tuvaller bırakılır. */
  function temizle() {
    for (const u of urller) URL.revokeObjectURL(u);
    urller.clear();
    for (const c of liste.querySelectorAll("canvas")) { c.width = 0; c.height = 0; }
    liste.replaceChildren();
    denetci?.abort();
  }

  async function yukle() {
    kok.replaceChildren(el("p", { class: "muted", text: "Dosyalar listeleniyor…" }));
    const { data, error } = await supabase.rpc("hesap_silme_dosya_listesi", { p_user: uye });
    if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
    dosyalar = data || [];
    kok.replaceChildren(
      el("p", { class: "muted sy-not", text: "Dosyalar R2'den doğrudan okunur; şifreli (E2EE) dosyaların içeriği yalnızca üyenin parolasıyla açılabilir. İncelemeyi bitirince kalıcı silme kararını ver." }),
      cubuk, liste);
    ciz();
  }

  yukle();
  return { temizle };
}
