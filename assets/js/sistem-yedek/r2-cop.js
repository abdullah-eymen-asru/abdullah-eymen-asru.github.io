/*
 * assets/js/sistem-yedek/r2-cop.js — R2 AKILLI ARTIK DOSYA (ORPHAN) GEZGİNİ & GÜVENLİ TEMİZLEME (yalnızca Site Sahibi).
 * R2'de bulunup veritabanında karşılığı OLMAYAN, 24 saatten eski nesneleri bulur ve her biri için "Neden artık dosya?" tahmini üretir
 * (Worker: artikNeden + migration 0107 kanıtı: sahibin hesabı/kasası var mı?). Hiçbir şey otomatik silinmez:
 *   • Her satırda ad (anahtar), boyut, son değiştirilme tarihi ve gerekçe görünür.
 *   • Tek tek: onay kutusu + satır "Sil"; toplu: "Seçilenleri sil" ve filtrelenenlerin hepsi için "Tüm Artık Dosyaları Tasfiye Et".
 *   • Silme /r2/sil akışıyla (anahtar biçimi beyaz listesi + denetim günlüğü) yapılır; toplu işlem iki aşamalı onay penceresinden geçer.
 * Tarama kota dostudur: "Tara" tek kaynağı ve en çok 20 sayfayı (10.000 nesne) gezer, kaldığı yerden devam eder. innerHTML/inline stil YOK.
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, hataMetni, dugme, onayIste, silOnayiIste, tarihMetni, workerJson } from "./ortak.js";

const KAYNAKLAR = [["arsiv", "Dosya Yöneticisi (arsiv/)"], ["notek", "Not ekleri (notlar/)"], ["akademik", "Akademik kütüphane (PDF)"]];
const NEDEN_ETIKET = {
  yetim_not_eki: "Yetim not eki", sahip_silinmis: "Sahibi silinmiş hesap", kasa_yok: "Kasası olmayan hesap",
  yarim_yukleme: "Yarım/silinmiş yükleme", yetim_akademik: "Yetim akademik PDF", bilinmiyor: "Bilinmeyen",
};
const SAYFA_SINIRI = 20;
const GOSTERIM = 100;

export function r2CopCiz(kok, mesaj) {
  const sec = el("select", { class: "sy-girdi", "aria-label": "Kaynak kova" }, KAYNAKLAR.map(([k, ad]) => el("option", { value: k, text: ad })));
  const tara = dugme({ metin: "Artık dosyaları tara", ikonAdi: "ara", tur: "birincil" });
  const devam = dugme({ metin: "Taramaya devam et", ikonAdi: "yenile", tur: "ikincil", hidden: true });
  const durum = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  const filtre = el("select", { class: "sy-girdi", "aria-label": "Gerekçeye göre filtrele", hidden: true });
  const hepsiniSec = el("input", { type: "checkbox", "aria-label": "Görünen tüm artık dosyaları seç" });
  const hepsiEtiket = el("label", { class: "ac-hepsi", hidden: true }, hepsiniSec, el("span", { text: "Görünenlerin hepsini seç" }));
  const seciliSil = dugme({ metin: "Seçilenleri sil", ikonAdi: "kapat", tur: "tehlike-hafif", disabled: true, hidden: true });
  const tumunuSil = dugme({ metin: "Tüm Artık Dosyaları Tasfiye Et", ikonAdi: "kapat", tur: "tehlike", hidden: true });
  const liste = el("ul", { class: "ac-liste" });
  const dahaFazla = dugme({ metin: "Daha fazla göster", tur: "ikincil", kucuk: true, hidden: true });

  let bulunan = [];            // {anahtar, boyut, yuklenme, kod, neden}
  const secili = new Set();
  let imlec = null, kaynak = "arsiv", taranan = 0, mesgul = false, gosterilen = GOSTERIM;

  const gorunen = () => (filtre.value ? bulunan.filter((x) => x.kod === filtre.value) : bulunan);

  function filtreDoldur() {
    const onceki = filtre.value;
    const kodlar = [...new Set(bulunan.map((x) => x.kod))];
    filtre.replaceChildren(el("option", { value: "", text: `Tüm gerekçeler (${bulunan.length})` }),
      ...kodlar.map((k) => el("option", { value: k, text: `${NEDEN_ETIKET[k] || k} (${bulunan.filter((x) => x.kod === k).length})` })));
    filtre.value = kodlar.includes(onceki) ? onceki : "";
    filtre.hidden = kodlar.length < 2;
  }

  function ciz() {
    for (const a of [...secili]) if (!bulunan.some((x) => x.anahtar === a)) secili.delete(a);
    filtreDoldur();
    const g = gorunen();
    const toplam = bulunan.reduce((n, x) => n + x.boyut, 0);
    durum.textContent = `${taranan.toLocaleString("tr-TR")} nesne tarandı · ${bulunan.length} artık dosya (${bayt(toplam)})${imlec ? " · tarama sürüyor (devam edebilirsin)" : ""}`;
    liste.replaceChildren(...g.slice(0, gosterilen).map(satirCiz));
    dahaFazla.hidden = g.length <= gosterilen;
    devam.hidden = !imlec;
    const var_ = bulunan.length > 0;
    hepsiEtiket.hidden = seciliSil.hidden = tumunuSil.hidden = !var_;
    hepsiniSec.checked = g.length > 0 && g.slice(0, gosterilen).every((x) => secili.has(x.anahtar));
    seciliSil.disabled = secili.size === 0 || mesgul;
    seciliSil.querySelector("span").textContent = secili.size ? `Seçilenleri sil (${secili.size})` : "Seçilenleri sil";
    const gSayi = g.length;
    tumunuSil.querySelector("span").textContent = filtre.value ? `Filtrelenen ${gSayi} Artık Dosyayı Tasfiye Et` : "Tüm Artık Dosyaları Tasfiye Et";
  }

  function satirCiz(x) {
    const kutu = el("input", { type: "checkbox", "aria-label": `${x.anahtar} dosyasını seç`, checked: secili.has(x.anahtar) });
    kutu.addEventListener("change", () => { if (kutu.checked) secili.add(x.anahtar); else secili.delete(x.anahtar); ciz(); });
    const sil = dugme({ metin: "Sil", ikonAdi: "cop", tur: "tehlike-hafif", kucuk: true, "aria-label": `${x.anahtar} dosyasını sil` });
    sil.addEventListener("click", () => sil1(x));
    return el("li", { class: "ac-satir" },
      el("label", { class: "ac-sec" }, kutu),
      el("div", { class: "ac-bilgi" },
        el("code", { class: "ac-ad", text: x.anahtar }),
        el("p", { class: "ac-meta" }, el("span", { text: bayt(x.boyut) }), el("span", { text: `Son değişiklik: ${tarihMetni(x.yuklenme)}` }), el("span", { class: "sy-etiket", text: NEDEN_ETIKET[x.kod] || x.kod })),
        el("p", { class: "ac-neden" }, el("strong", { text: "Neden artık dosya? " }), x.neden)),
      sil);
  }

  async function sunucudanSil(liste_) {
    let silinen = 0;
    const silinenler = [];
    try {
      for (let i = 0; i < liste_.length; i += 500) {
        const parca = liste_.slice(i, i + 500).map((x) => x.anahtar);
        const r = await workerJson("/r2/sil", { yontem: "POST", govde: { kaynak, anahtarlar: parca } });
        if (r.error) throw new Error(r.error);
        silinen += r.silinen || parca.length; silinenler.push(...parca);
      }
      return { silinen, hata: null };
    } catch (h) {
      return { silinen, hata: h, silinenler };
    } finally { /* liste çağıran tarafta güncellenir */ }
  }

  function listedenCikar(anahtarlar) {
    const k = new Set(anahtarlar);
    bulunan = bulunan.filter((x) => !k.has(x.anahtar));
    for (const a of k) secili.delete(a);
  }

  async function sil1(x) {
    if (mesgul) return;
    const tamam = await onayIste({ baslik: "Bu artık dosya silinsin mi?", metin: [x.anahtar, `${bayt(x.boyut)} · ${x.neden}`, "Silme geri alınamaz; işlem denetim günlüğüne yazılır."], tamam: "Kalıcı sil", tehlike: true });
    if (!tamam) return;
    await topluYurut([x]);
  }

  async function topluYurut(hedef) {
    mesgul = true; ciz();
    const r = await sunucudanSil(hedef);
    if (r.hata) listedenCikar(r.silinenler || []); else listedenCikar(hedef.map((x) => x.anahtar));
    mesgul = false; ciz();
    if (r.hata) mesaj(`Silme yarım kaldı (${r.silinen} silindi): ${hataMetni(r.hata)}`);
    else mesaj(`${r.silinen} artık dosya silindi.`, "success");
  }

  async function secilenleriSil() {
    const hedef = bulunan.filter((x) => secili.has(x.anahtar));
    if (!hedef.length || mesgul) return;
    const toplam = hedef.reduce((n, x) => n + x.boyut, 0);
    const tamam = await onayIste({ baslik: `${hedef.length} seçili dosya silinsin mi?`, metin: [`Toplam ${bayt(toplam)}.`, "Silme geri alınamaz; işlem denetim günlüğüne yazılır."], tamam: "Seçilenleri sil", tehlike: true });
    if (tamam) await topluYurut(hedef);
  }

  async function tumunuTasfiyeEt() {
    const hedef = gorunen();
    if (!hedef.length || mesgul) return;
    const toplam = hedef.reduce((n, x) => n + x.boyut, 0);
    const ozet = [`${hedef.length.toLocaleString("tr-TR")} dosya · toplam ${bayt(toplam)}`];
    for (const [kod, n] of Object.entries(hedef.reduce((m, x) => ((m[x.kod] = (m[x.kod] || 0) + 1), m), {}))) ozet.push(`${NEDEN_ETIKET[kod] || kod}: ${n}`);
    const tamam = await silOnayiIste({
      baslik: `${hedef.length} artık dosya tasfiye edilsin mi?`, ozet,
      uyari: ["Bu dosyaların veritabanında karşılığı yok ve 24 saatten eski; gerekçeler listede tahmindir.", "Geri alınamaz; işlem denetim günlüğüne yazılır."],
      onayMetni: "SİL", tamam: "Hepsini tasfiye et",
    });
    if (tamam) await topluYurut(hedef);
  }

  async function tarama(sifirla) {
    if (mesgul) return; mesgul = true; tara.disabled = devam.disabled = true;
    try {
      if (sifirla) { bulunan = []; secili.clear(); imlec = null; taranan = 0; kaynak = sec.value; gosterilen = GOSTERIM; }
      for (let i = 0; i < SAYFA_SINIRI; i++) {
        const r = await workerJson(`/r2/hayalet-tara?b=${kaynak}${imlec ? `&c=${encodeURIComponent(imlec)}` : ""}`);
        if (r.error) throw new Error(r.error);
        taranan += r.taranan; bulunan.push(...r.hayalet.map((x) => ({ ...x, kod: x.kod || "bilinmiyor", neden: x.neden || "Veritabanında karşılığı yok." })));
        imlec = r.sonraki; ciz();
        if (!imlec) break;
      }
      if (!bulunan.length && !imlec) mesaj("Artık dosya bulunamadı: R2 ve veritabanı tutarlı.", "success");
    } catch (h) { mesaj(`Tarama başarısız: ${hataMetni(h)}`); }
    finally { mesgul = false; tara.disabled = devam.disabled = false; ciz(); }
  }

  tara.addEventListener("click", () => tarama(true));
  devam.addEventListener("click", () => tarama(false));
  filtre.addEventListener("change", () => { gosterilen = GOSTERIM; ciz(); });
  dahaFazla.addEventListener("click", () => { gosterilen += GOSTERIM; ciz(); });
  hepsiniSec.addEventListener("change", () => {
    for (const x of gorunen().slice(0, gosterilen)) { if (hepsiniSec.checked) secili.add(x.anahtar); else secili.delete(x.anahtar); }
    ciz();
  });
  seciliSil.addEventListener("click", secilenleriSil);
  tumunuSil.addEventListener("click", tumunuTasfiyeEt);

  kok.replaceChildren(
    el("h2", { text: "R2 artık dosya gezgini" }),
    el("p", { class: "muted", text: "R2'de bulunup veritabanında karşılığı olmayan nesneleri bulur ve neden artık sayıldığını açıklar. 24 saatten yeni dosyalara dokunulmaz; hiçbir şey kendiliğinden silinmez." }),
    el("div", { class: "sy-eylemler" }, sec, tara, devam), durum,
    el("div", { class: "ac-arac" }, hepsiEtiket, filtre),
    liste, el("div", { class: "sy-eylemler" }, dahaFazla),
    el("div", { class: "sy-eylemler ac-toplu" }, seciliSil, tumunuSil));
}

/* ---------------------- Kilitli Not Kasalarını Temizleme (migration 0108) ---------------------- */
export async function kilitliKasalariCiz(kok, mesaj) {
  const liste = el("ul", { class: "ac-liste" });
  kok.replaceChildren(
    el("h2", { text: "Kilitli not kasaları" }),
    el("p", { class: "muted", text: "Parolası/kurtarma kodu kaybolup açılamayan kullanıcıların not kasasını, notlarını ve R2 eklerini KALICI siler. Geri alınamaz; içerik şifreli olduğu için sen de okuyamazsın. İşlem denetim günlüğüne yazılır." }),
    liste);
  async function yukle() {
    const { data, error } = await supabase.rpc("kilitli_kasa_listesi");
    if (error) { liste.replaceChildren(el("li", { class: "muted", text: `Liste alınamadı: ${error.message}` })); return; }
    if (!data?.length) { liste.replaceChildren(el("li", { class: "muted", text: "Temizlenebilecek başka bir not kasası yok." })); return; }
    liste.replaceChildren(...data.map((k) => {
      const sil = dugme({ metin: "Kasayı kalıcı sil", ikonAdi: "cop", tur: "tehlike-hafif", kucuk: true });
      sil.addEventListener("click", async () => {
        const tamam = await silOnayiIste({
          baslik: `${k.ad} adlı kullanıcının not kasası silinsin mi?`,
          ozet: [`${k.not_sayisi} not · ${k.ek_sayisi} ek (${bayt(k.ek_bayt)})`, `Kasa oluşturma: ${tarihMetni(k.kasa_tarihi)}`],
          uyari: ["Notlar, ekler ve kasa anahtarı kalıcı silinir; kullanıcı sıfırdan yeni kasa kurabilir.", "Geri alınamaz."], onayMetni: "SİL", tamam: "Kalıcı sil",
        });
        if (!tamam) return;
        sil.disabled = true;
        try {
          const r = await workerJson("/kasa/temizle", { yontem: "POST", govde: { hedef: k.user_id } });
          if (r.error) throw new Error(r.error);
          mesaj(`${k.ad}: ${r.not ?? 0} not, ${r.ek ?? 0} ek ve ${r.r2_silinen ?? 0} R2 nesnesi silindi.`, "success");
        } catch (h) { mesaj(`Kasa temizlenemedi: ${hataMetni(h)}`); }
        await yukle();
      });
      return el("li", { class: "ac-satir ac-satir--kasa" },
        el("span", { "aria-hidden": "true", text: "🔒" }),
        el("div", { class: "ac-bilgi" }, el("strong", { text: k.ad }),
          el("p", { class: "ac-meta" }, el("span", { text: k.rol }), el("span", { text: `${k.not_sayisi} not` }), el("span", { text: `${k.ek_sayisi} ek · ${bayt(k.ek_bayt)}` }))),
        sil);
    }));
  }
  await yukle();
}
