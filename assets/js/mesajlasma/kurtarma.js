/*
 * assets/js/mesajlasma/kurtarma.js — E2EE Kasa / Kurtarma Parolası arayüzleri (mesajlaşma).
 *  1) kilitPaneli(): "Özel anahtar açılamadı" durumunda hata yerine ÇÖZÜM paneli — kurtarma parolasıyla kilidi aç (başka cihaz, gizli sekme,
 *     Worker sırrı değişmiş hesap) ya da (parola hiç tanımlanmamışsa) son çare anahtar sıfırlama.
 *  2) kurtarmaAyariAc(): kurtarma parolası belirle / değiştir, "bu cihazda hatırla"yı kapat.
 * Parola ve türetilen anahtar sunucuya GİTMEZ (bkz. r2-arsiv/e2ee.js). innerHTML yok, inline stil yok (CSP).
 */
import { h, doldur, modalSor } from "./dom.js";
import * as E from "../r2-arsiv/e2ee.js";

/**
 * Parola formlu modal. islem(değerler[]) başarılıysa modal kapanır ve sonucu döner; hata fırlatırsa formda gösterilir.
 * Vazgeç/Escape/dış tıklama → null.
 */
function dogrulamaliForm({ baslik, aciklama, alanlar, tamamMetin = "Kaydet" }, islem) {
  return new Promise((coz) => {
    const onceki = document.activeElement;
    const kapat = (v) => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); coz(v); };
    const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(null); } };
    const hata = h("p", { class: "msj-kilit-hata", role: "alert", hidden: true });
    const girdiler = alanlar.map((a) => h("input", { type: "password", class: "msj-kilit-girdi", placeholder: a.ipucu, "aria-label": a.etiket, autocomplete: "new-password" }));
    const satirlar = alanlar.map((a, i) => h("label", { class: "msj-kilit-alan" }, h("span", { text: a.etiket }), girdiler[i]));
    const tamam = h("button", { type: "submit", class: "msj-btn msj-btn--birincil", text: tamamMetin });
    const form = h("form", { class: "msj-kilit-form", novalidate: true }, satirlar, hata,
      h("div", { class: "msj-modal-eylem" }, h("button", { type: "button", class: "msj-btn msj-btn--ikincil", text: "Vazgeç", onclick: () => kapat(null) }), tamam));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const deger = girdiler.map((g) => g.value);
      for (let i = 0; i < alanlar.length; i++) {
        if (alanlar[i].min && deger[i].length < alanlar[i].min) { hata.textContent = `${alanlar[i].etiket} en az ${alanlar[i].min} karakter olmalı.`; hata.hidden = false; return; }
      }
      tamam.disabled = true; hata.hidden = true;
      try { kapat(await islem(deger)); } catch (er) { hata.textContent = er.message || String(er); hata.hidden = false; tamam.disabled = false; }
    });
    const kutu = h("div", { class: "msj-modal", role: "dialog", "aria-modal": "true", "aria-label": baslik },
      h("h3", { class: "msj-modal-baslik", text: baslik }), aciklama ? h("p", { class: "msj-modal-metin", text: aciklama }) : null, form);
    const kaplama = h("div", { class: "msj-modal-kaplama" }, kutu);
    kaplama.addEventListener("mousedown", (e) => { if (e.target === kaplama) kapat(null); });
    document.body.append(kaplama);
    document.addEventListener("keydown", tus, true);
    girdiler[0]?.focus();
  });
}

export { dogrulamaliForm };

export async function kurtarmaAyariAc(duyur = () => {}) {
  let d;
  try { d = await E.anahtarDurumu(); } catch (e) { return duyur(e.message, true); }
  const var_ = !!d.kurtarma_var;
  const sonuc = await dogrulamaliForm({
    baslik: var_ ? "Kurtarma parolasını değiştir" : "Kurtarma parolası belirle",
    aciklama: `Bu parola, şifreli sohbetlerinin anahtarını farklı bir cihazda/tarayıcıda ya da kasa anahtarı değiştiğinde açmanı sağlar. Sunucuya GİTMEZ; unutursan kimse sıfırlayamaz — güvenli bir yere not et. (PBKDF2-SHA256, ${E.KURTARMA_KDF_TUR.toLocaleString("tr-TR")} tur)`,
    alanlar: [
      { etiket: "Yeni kurtarma parolası", ipucu: `En az ${E.KURTARMA_PAROLA_MIN} karakter`, min: E.KURTARMA_PAROLA_MIN },
      { etiket: "Parolayı tekrar yaz", ipucu: "Aynı parola", min: E.KURTARMA_PAROLA_MIN },
    ],
    tamamMetin: "Kaydet",
  }, async ([p1, p2]) => {
    if (p1 !== p2) throw new Error("Parolalar eşleşmiyor.");
    await E.kurtarmaParolasiBelirle(p1);
    return true;
  });
  if (sonuc) duyur("Kurtarma parolası kaydedildi. Artık başka bir cihazda aynı parolayla sohbetlerini açabilirsin.");
  return !!sonuc;
}

/** Kilitli durum paneli (sohbet alanında hata yerine gösterilir). onAcildi() → sohbetleri yeniden yükle. */
export function kilitPaneli({ kurtarmaVar, onAcildi }) {
  const hata = h("p", { class: "msj-kilit-hata", role: "alert", hidden: true });
  const parola = h("input", { type: "password", class: "msj-kilit-girdi", placeholder: "Kurtarma parolan", "aria-label": "Kurtarma parolası", autocomplete: "current-password" });
  const hatirla = h("input", { type: "checkbox" });
  const ac = h("button", { type: "submit", class: "msj-btn msj-btn--birincil", text: "Kilidi aç" });
  const form = h("form", { class: "msj-kilit-form", novalidate: true },
    h("label", { class: "msj-kilit-alan" }, h("span", { text: "Kurtarma parolası" }), parola),
    h("label", { class: "msj-kilit-onay" }, hatirla, h("span", { text: "Bu cihazda hatırla (yalnızca kendi cihazında işaretle)" })), hata, ac);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); if (!parola.value) return parola.focus();
    ac.disabled = true; hata.hidden = true;
    try { const r = await E.kurtarmaParolasiylaAc(parola.value, { cihazdaHatirla: hatirla.checked }); parola.value = ""; onAcildi(r); }
    catch (er) { hata.textContent = er.message || String(er); hata.hidden = false; ac.disabled = false; parola.focus(); }
  });
  const sifirla = h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk", text: kurtarmaVar ? "Parolamı unuttum — anahtarı sıfırla" : "Anahtarı sıfırla (son çare)" });
  sifirla.addEventListener("click", async () => {
    const o = await modalSor({ baslik: "Şifreleme anahtarı sıfırlansın mı?", metin: "Yeni bir anahtar çifti oluşturulur. Eski sohbetlerin anahtarı sende silinir; sohbetin karşı tarafı (anahtarı hâlâ bilen) sohbeti açınca geçmişi sana yeniden paylaşır. Karşı tarafın da erişimi yoksa o sohbet geri getirilemez. Şifreli özel dosyaların için sana verilen anahtarlar da silinir (sahipleri yeniden paylaşmalı).", secenekler: [{ metin: "Evet, sıfırla", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    sifirla.disabled = true;
    try { await E.anahtariSifirla(); onAcildi({ sifirlandi: true }); } catch (er) { hata.textContent = er.message || String(er); hata.hidden = false; sifirla.disabled = false; }
  });
  return h("div", { class: "msj-kilit", role: "region", "aria-label": "Şifreli sohbet kilidi" },
    h("div", { class: "msj-kilit-ikon", "aria-hidden": "true", text: "🔐" }),
    h("h3", { class: "msj-kilit-baslik", text: "Şifreli sohbetlerin kilitli" }),
    h("p", { class: "msj-kilit-metin", text: kurtarmaVar
      ? "Bu cihazda/oturumda sohbet anahtarın açılamadı. Kurtarma parolanı girersen anahtar çözülür, eski ve yeni tüm mesajların ekrana gelir."
      : "Bu hesapta kurtarma parolası tanımlı değil ve anahtarın açılamıyor. Başka bir cihazda sohbetlerin açıksa oradan “Kurtarma Parolası” belirle, sonra buradan gir. Hiçbiri mümkün değilse son çare olarak anahtarı sıfırlayabilirsin." }),
    kurtarmaVar ? form : null, sifirla);
}

export { doldur };
