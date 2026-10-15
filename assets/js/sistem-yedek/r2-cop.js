/*
 * assets/js/sistem-yedek/r2-cop.js — R2 ÇÖP TOPLAYICI (yalnızca Site Sahibi).   [2026-10, kör nokta 6]
 * Silinen kayıtlardan/yarım kalan yüklemelerden artakalan HAYALET R2 nesnelerini bulur: veritabanında karşılığı olmayan, 24 saatten eski nesneler.
 * Tarama Worker'da sayfa sayfa (500 nesne/istek) yapılır; kota için "Tara" tek bir kaynağı ve en çok 20 sayfayı (10.000 nesne) gezer, kaldığı yerden devam eder.
 * Silme YALNIZCA onaydan sonra, mevcut /r2/sil akışıyla (biçim beyaz listesi + denetim günlüğü) yapılır. Hiçbir şey otomatik silinmez.
 */
import { el, bayt, hataMetni, dugme, onayIste, workerJson } from "./ortak.js";

const KAYNAKLAR = [["arsiv", "Dosya Yöneticisi (arsiv/)"], ["notek", "Not ekleri (notlar/)"], ["akademik", "Akademik kütüphane (PDF)"]];
const SAYFA_SINIRI = 20;

export function r2CopCiz(kok, mesaj) {
  const sec = el("select", { class: "sy-girdi", "aria-label": "Kaynak kova" }, KAYNAKLAR.map(([k, ad]) => el("option", { value: k, text: ad })));
  const tara = dugme({ metin: "Hayalet dosyaları tara", ikonAdi: "ara", tur: "birincil" });
  const devam = dugme({ metin: "Taramaya devam et", ikonAdi: "yenile", tur: "ikincil", hidden: true });
  const sil = dugme({ metin: "Bulunanları sil", ikonAdi: "kapat", tur: "tehlike", hidden: true });
  const durum = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  const liste = el("ul", { class: "sy-ia-liste" });
  let bulunan = []; let imlec = null; let kaynak = "arsiv"; let taranan = 0; let mesgul = false;

  const ciz = () => {
    const toplam = bulunan.reduce((n, x) => n + x.boyut, 0);
    durum.textContent = `${taranan.toLocaleString("tr-TR")} nesne tarandı · ${bulunan.length} hayalet (${bayt(toplam)})${imlec ? " · tarama sürüyor (devam edebilirsin)" : ""}`;
    liste.replaceChildren(...bulunan.slice(0, 50).map((x) => el("li", { class: "sy-ia-satir" }, el("code", { text: x.anahtar }), el("span", { class: "muted", text: bayt(x.boyut) }))));
    devam.hidden = !imlec; sil.hidden = !bulunan.length;
  };

  async function tarama(sifirla) {
    if (mesgul) return; mesgul = true; tara.disabled = devam.disabled = sil.disabled = true;
    try {
      if (sifirla) { bulunan = []; imlec = null; taranan = 0; kaynak = sec.value; }
      for (let i = 0; i < SAYFA_SINIRI; i++) {
        const r = await workerJson(`/r2/hayalet-tara?b=${kaynak}${imlec ? `&c=${encodeURIComponent(imlec)}` : ""}`);
        if (r.error) throw new Error(r.error);
        taranan += r.taranan; bulunan.push(...r.hayalet); imlec = r.sonraki; ciz();
        if (!imlec) break;
      }
      if (!bulunan.length && !imlec) mesaj("Hayalet dosya bulunamadı: R2 ve veritabanı tutarlı.", "success");
    } catch (h) { mesaj(`Tarama başarısız: ${hataMetni(h)}`); }
    finally { mesgul = false; tara.disabled = devam.disabled = sil.disabled = false; }
  }
  tara.addEventListener("click", () => tarama(true));
  devam.addEventListener("click", () => tarama(false));
  sil.addEventListener("click", async () => {
    const toplam = bulunan.reduce((n, x) => n + x.boyut, 0);
    const tamam = await onayIste({ baslik: `${bulunan.length} hayalet dosya silinsin mi?`, metin: [`Toplam ${bayt(toplam)}. Bu nesnelerin veritabanında karşılığı yok ve 24 saatten eski.`, "Silme geri alınamaz; işlem denetim günlüğüne yazılır."], tamam: "Kalıcı sil", tehlike: true });
    if (!tamam) return;
    mesgul = true; sil.disabled = true; let silinen = 0;
    try {
      for (let i = 0; i < bulunan.length; i += 500) {
        const parca = bulunan.slice(i, i + 500).map((x) => x.anahtar);
        const r = await workerJson("/r2/sil", { yontem: "POST", govde: { kaynak, anahtarlar: parca } });
        if (r.error) throw new Error(r.error);
        silinen += r.silinen || parca.length;
      }
      bulunan = []; ciz(); mesaj(`${silinen} hayalet dosya silindi.`, "success");
    } catch (h) { mesaj(`Silme yarım kaldı (${silinen} silindi): ${hataMetni(h)}`); }
    finally { mesgul = false; sil.disabled = false; }
  });
  kok.replaceChildren(el("h2", { text: "R2 çöp toplayıcı" }),
    el("p", { class: "muted", text: "Veritabanında karşılığı olmayan (hayalet) R2 nesnelerini bulur. 24 saatten yeni dosyalara dokunulmaz; silme yalnızca onayınla yapılır." }),
    el("div", { class: "sy-eylemler" }, sec, tara, devam), durum, liste, el("div", { class: "sy-eylemler" }, sil));
}
