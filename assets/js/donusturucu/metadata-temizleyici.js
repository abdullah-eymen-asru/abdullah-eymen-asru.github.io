/*
 * assets/js/donusturucu/metadata-temizleyici.js — "🧼 Evrensel Metadata Temizleyici" kartı (Gelişmiş Belge ve Gizlilik Araçları içinde).
 * Yetki: Dönüştürücü ile AYNI tek yetki satırı (donusturucu_yetkisi_var_mi); bu kart yalnızca o kapıdan geçildikten sonra kurulur.
 * Motor: metadata-motor.js (JPEG/PNG/WebP/MP4-MOV akışlı, DOCX/XLSX/PPTX/ODF/ZIP/PDF bellekte). Dosya hiçbir yere yüklenmez.
 * "Belleği Güvenli Sıfırla": nesne URL'leri, çıktı Blob'ları ve listeler bırakılır (donusturucu/bellek.js ile ortak).
 */
import { el, dugme, bayt, indir, hataMetni } from "./ortak.js";
import { pdfLibAl } from "./pdf-yukle.js";
import { sifirla as bellekSifirla } from "./bellek.js";
import { metadataTemizle, turTespit, BELLEK_SINIRI, AKIS_SINIRI, CLI_YONERGESI } from "./metadata-motor.js";

export function metadataKartiYap() {
  let kayitlar = [];                                  // { dosya, durum, mesaj, sonuc }
  const girdi = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "Metadata temizlenecek dosyalar" });
  const birak = el("div", { class: "dn-dropzone", role: "button", tabindex: "0", "aria-label": "Dosya seç ya da buraya bırak" },
    el("strong", { text: "Dosya seç ya da buraya bırak" }),
    el("span", { class: "dn-muted", text: `Görsel (JPEG/PNG/WebP) · video/ses (MP4/MOV/M4A) · Office (DOCX/XLSX/PPTX) · ODF · PDF · ZIP. Görsel, medya, Office/ODF ve ZIP ${AKIS_SINIRI / 1024 ** 3} GB'a, PDF ${BELLEK_SINIRI / 1024 ** 2} MB'a kadar.` }));
  const liste = el("ul", { class: "dn-md-liste" });
  const durum = el("p", { class: "dn-muted", role: "status", "aria-live": "polite" });
  const hepsi = dugme({ metin: "Hepsini temizle", ikon: "🧼", tur: "birincil", disabled: true });
  const sifirla = dugme({ metin: "Belleği Güvenli Sıfırla", ikon: "🧹", title: "Listeyi, çıktı dosyalarını ve nesne URL'lerini bellekten bırakır" });

  function ciz() {
    liste.replaceChildren(...kayitlar.map((k, i) => {
      const islem = dugme({ metin: k.sonuc ? "Tekrar indir" : "Temizle", tur: "ikincil", kucuk: true, disabled: k.durum === "calisiyor" });
      islem.addEventListener("click", () => (k.sonuc ? indir(k.sonuc.blob, k.sonuc.ad) : calistir(i)));
      const kaldir = dugme({ metin: "Kaldır", tur: "ikincil", kucuk: true, "aria-label": `${k.dosya.name} dosyasını listeden kaldır` });
      kaldir.addEventListener("click", () => { kayitlar.splice(i, 1); ciz(); });
      return el("li", { class: `dn-md-satir dn-md-satir--${k.durum}` },
        el("div", { class: "dn-md-bilgi" },
          el("strong", { class: "dn-md-ad", text: k.dosya.name }),
          el("span", { class: "dn-muted", text: `${bayt(k.dosya.size)} · ${k.durum === "hazir" ? "bekliyor" : k.durum === "calisiyor" ? "işleniyor…" : k.durum === "bitti" ? `temizlendi (${k.sonuc.yontem === "akis" ? "akışla, belleğe okunmadan" : "bellekte"})` : "hata"}` }),
          k.mesaj ? el("span", { class: k.durum === "hata" ? "auth-message error" : "dn-muted", text: k.mesaj }) : null,
          k.sonuc?.ozet?.length ? el("ul", { class: "dn-md-ozet" }, k.sonuc.ozet.map((s) => el("li", { text: s }))) : null),
        el("div", { class: "dn-md-eylem" }, islem, kaldir));
    }));
    hepsi.disabled = !kayitlar.some((k) => k.durum === "hazir" || k.durum === "hata");
  }

  async function calistir(i) {
    const k = kayitlar[i]; if (!k || k.durum === "calisiyor") return;
    k.durum = "calisiyor"; k.mesaj = ""; ciz();
    try {
      const tur = turTespit(k.dosya.name, new Uint8Array(await k.dosya.slice(0, 16).arrayBuffer()));
      const lib = {};
      if (tur === "pdf") lib.PDFLib = await pdfLibAl();
      k.sonuc = await metadataTemizle(k.dosya, lib);
      k.durum = "bitti";
      indir(k.sonuc.blob, k.sonuc.ad);
    } catch (h) { k.durum = "hata"; k.mesaj = `${hataMetni(h)}`; }
    ciz();
  }

  function ekle(dosyalar) {
    for (const f of dosyalar) kayitlar.push({ dosya: f, durum: "hazir", mesaj: f.size === 0 ? "Boş dosya." : "", sonuc: null });
    durum.textContent = ""; ciz();
  }
  birak.addEventListener("click", () => girdi.click());
  birak.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); girdi.click(); } });
  for (const o of ["dragover", "dragenter"]) birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.add("dn-surukle"); });
  for (const o of ["dragleave", "drop"]) birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.remove("dn-surukle"); });
  birak.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) ekle([...e.dataTransfer.files]); });
  girdi.addEventListener("change", () => { const l = [...girdi.files]; girdi.value = ""; ekle(l); });
  hepsi.addEventListener("click", async () => {
    hepsi.disabled = true;
    for (let i = 0; i < kayitlar.length; i++) if (kayitlar[i].durum === "hazir" || kayitlar[i].durum === "hata") await calistir(i);   // sırayla: aynı anda tek dosya (RAM)
  });
  sifirla.addEventListener("click", () => {
    kayitlar = []; try { bellekSifirla(); } catch { /* yok say */ }
    ciz(); durum.textContent = "Bellek sıfırlandı: liste, çıktı dosyaları ve nesne URL'leri bırakıldı. (En kesin temizlik sayfayı yenilemektir.)";
  });

  ciz();
  return el("section", { class: "dn-kart dn-md-kart", "aria-label": "Evrensel Metadata Temizleyici" },
    el("h2", { text: "🧼 Evrensel Metadata Temizleyici" }),
    el("p", { class: "dn-muted", text: "Dosyadaki gizli üst veriyi (konum, cihaz, yazar, yazılım, tarih, küçük resim) siler. Dosya cihazından çıkmaz. Büyük görsel/video dosyaları belleğe OKUNMADAN, parça parça işlenir; yalnızca küçük başlık bölgeleri okunur." }),
    birak, girdi, durum, liste,
    el("div", { class: "dn-md-araclar" }, hepsi, sifirla),
    el("details", { class: "dn-md-cli" }, el("summary", { text: "Çok büyük dosya mı? Yerel komut satırı yönergesi" }),
      el("p", { class: "dn-muted", text: `${CLI_YONERGESI.medya}` }), el("p", { class: "dn-muted", text: `${CLI_YONERGESI.belge}` }),
      el("p", { class: "dn-muted", text: "Not: Belgenin görünen içeriği (metin, yorum yazarları, izlenen değişiklikler) ve görüntünün içindeki ayrıntılar temizlenmez; yalnızca dosya üst verisi." })));
}
