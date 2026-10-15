/*
 * assets/js/mesajlasma/kurtarma.js — mesajlaşma kilit paneli.   [2026-10: ayrı "Kurtarma Parolası" kutusu KALDIRILDI]
 * Mesajların anahtarı giriş oturumuna (Notlar kasası) bağlıdır; panel yalnızca anahtar açılamadığında görünür ve şunları sunar:
 *   1) Giriş parolanla (Google hesaplarında Kasa Parolanla) Notlar kasasını aç → mesajlar da açılır.
 *   2) Yedek Kurtarma Koduyla aç (parola unutuldu / farklı cihaz / kasa anahtarı değişti).
 *   3) Yalnızca ESKİ kurtarma parolası olan hesaplar için küçük bir "eski parola" seçeneği (yeni parola belirlenemez).
 *   4) Son çare: anahtarı sıfırla.
 * innerHTML yok, inline stil yok (CSP).
 */
import { h, doldur, modalSor } from "./dom.js";
import * as E from "../r2-arsiv/e2ee.js";
import * as Kasa from "../notlar/kasa.js";
import * as Kit from "../kurtarma-kiti/kit.js";
import { kitKartiAc, cssYukle } from "../kurtarma-kiti/kit-arayuz.js";
import { supabase } from "../core/supabase-client.js";

export { kitKartiAc };

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

/**
 * Kilitli durum paneli (sohbet alanında hata yerine gösterilir). durum: E2EEKilitHatasi.durum. onAcildi(sonuc) → sohbetleri yeniden yükle.
 * SADE AKIŞ (2026-10): tek parola kutusu + tek birincil düğme. Notlar kasası zaten açıksa parola bile sorulmaz: anahtar sessizce
 * onarılır. Yedek kod / eski parola / sıfırlama "Parolamı unuttum ya da açılmıyor" altında KAPALI durur.
 */
export function kilitPaneli({ durum = {}, onAcildi }) {
  cssYukle();
  const hata = h("p", { class: "msj-kilit-hata", role: "alert", hidden: true });
  const hataYaz = (m) => { hata.textContent = m; hata.hidden = !m; };
  const girdi = (ipucu, etiket, ac = "current-password") => h("input", { type: "password", class: "msj-kilit-girdi", placeholder: ipucu, "aria-label": etiket, autocomplete: ac });

  /** Anahtar açılamadıysa: güvenliyse sessizce yenile (kurtarma kodu istemeden); değilse kullanıcıyı kod bölümüne yönlendir. */
  const anahtariHazirlaYadaOnar = async () => {
    try { await E.anahtarlariHazirla(); await E.anahtariGirisaBagla(); return { giris: true }; }
    catch (er) {
      if (er?.name !== "E2EEKilitHatasi") throw er;
      const o = await E.anahtariOtomatikOnar();
      if (o.onarildi) return { giris: true, yenilendi: true };
      kodBolumu.open = true;
      throw new Error(o.neden === "zarf-var"
        ? "Parolan doğru ve kasan açıldı, ancak mevcut sohbetlerinin anahtarı bu cihazda açılamıyor. Yedek Kurtarma Kodunu gir (aşağıda açıldı)."
        : "Parolan doğru ve kasan açıldı, ancak mesaj anahtarı onarılamadı. Yedek Kurtarma Kodunu dene ya da sayfayı yenileyip tekrar dene.");
    }
  };

  // 1) Notlar kasasını giriş/Kasa parolasıyla aç (ANA YOL)
  const parola = girdi("Giriş parolan", "Giriş parolası");
  const etiketMetin = h("span", { text: "Giriş parolan" });
  const acBtn = h("button", { type: "submit", class: "msj-btn msj-btn--birincil msj-kilit-ana", text: "Kilidi aç" });
  const parolaForm = h("form", { class: "msj-kilit-form", novalidate: true }, h("label", { class: "msj-kilit-alan" }, etiketMetin, parola), acBtn);
  (async () => { // Google (bağımsız) kasada parola alanı "Kasa Parolası" olur
    try { const uid = (await supabase.auth.getUser()).data?.user?.id; const o = await Kasa.kasaOzeti(uid); if (o.bagimsiz) { etiketMetin.textContent = "Kasa Parolan (Google hesabı)"; parola.placeholder = "Kasa Parolan"; } } catch { /* varsayılan */ }
  })();
  parolaForm.addEventListener("submit", async (e) => {
    e.preventDefault(); if (!parola.value) return parola.focus();
    acBtn.disabled = true; hataYaz("");
    try {
      const { data } = await supabase.auth.getSession();
      const r = await Kasa.parolaIleAc(data.session, parola.value);
      parola.value = "";
      if (r.durum !== "acik" && r.durum !== "yeni-kasa") throw new Error("Hatalı parola. Unuttuysan aşağıdan Yedek Kurtarma Kodunu kullan.");
      E.anahtarOnbellegiTemizle();
      onAcildi(await anahtariHazirlaYadaOnar());
    } catch (er) { hataYaz(er.message || String(er)); acBtn.disabled = false; }
  });

  // 2) Yedek Kurtarma Kodu (+ isteğe bağlı kasa parolasını yeniden kurma) — KAPALI başlar
  const kod = h("input", { type: "text", class: "msj-kilit-girdi", placeholder: "XXXX-XXXX-XXXX-XXXX", "aria-label": "Yedek kurtarma kodu", autocomplete: "off", autocapitalize: "characters", maxlength: "19" });
  kod.addEventListener("input", () => { kod.value = Kit.kodBicimle(kod.value); });
  const yeniParola = girdi("Yeni parola (yalnızca giriş parolanı unuttuysan)", "Notlar kasası için yeni parola", "new-password");
  const hatirla = h("input", { type: "checkbox" });
  const kodBtn = h("button", { type: "submit", class: "msj-btn msj-btn--ikincil", text: "Kodla aç" });
  const kodForm = h("form", { class: "msj-kilit-form", novalidate: true },
    h("label", { class: "msj-kilit-alan" }, h("span", { text: "Yedek Kurtarma Kodu" }), kod),
    h("label", { class: "msj-kilit-alan" }, h("span", { text: "Yeni parola (isteğe bağlı)" }), yeniParola),
    h("label", { class: "msj-kilit-onay" }, hatirla, h("span", { text: "Bu cihazda hatırla (yalnızca kendi cihazında)" })), kodBtn);
  kodForm.addEventListener("submit", async (e) => {
    e.preventDefault(); if (!kod.value) return kod.focus();
    kodBtn.disabled = true; hataYaz("");
    try { const r = await Kit.kitIleAc(kod.value, { parola: yeniParola.value || null, cihazdaHatirla: hatirla.checked }); kod.value = yeniParola.value = ""; onAcildi(r); }
    catch (er) { hataYaz(er.message || String(er)); kodBtn.disabled = false; }
  });

  // 3) ESKİ kurtarma parolası (yalnızca zaten varsa)
  let eskiForm = null;
  if (durum.kurtarmaVar) {
    const eski = girdi("Eski kurtarma parolan", "Eski kurtarma parolası");
    const eskiBtn = h("button", { type: "submit", class: "msj-btn msj-btn--ikincil", text: "Eski parolayla aç" });
    eskiForm = h("form", { class: "msj-kilit-form", novalidate: true }, eski, eskiBtn);
    eskiForm.addEventListener("submit", async (e) => {
      e.preventDefault(); if (!eski.value) return eski.focus(); eskiBtn.disabled = true; hataYaz("");
      try { const r = await E.kurtarmaParolasiylaAc(eski.value); eski.value = ""; onAcildi(r); } catch (er) { hataYaz(er.message || String(er)); eskiBtn.disabled = false; }
    });
  }

  // 4) Son çare
  const sifirla = h("button", { type: "button", class: "msj-btn msj-btn--tehlike msj-kucuk", text: "Yedek kodum yok → yeni anahtar oluştur" });
  sifirla.addEventListener("click", async () => {
    const o = await modalSor({ baslik: "Şifreleme anahtarı sıfırlansın mı?", metin: "Bu cihazda açılamayan eski anahtarın yerine yenisi oluşturulur ve parolana bağlanır; bundan sonra parolan yeterli olur. Eski sohbet anahtarların silinir; karşı taraf sohbeti açınca geçmişi sana otomatik yeniden paylaşır. Karşı tarafın da erişimi yoksa o eski sohbet geri getirilemez. DİKKAT: Notlar + Mesajlar için TEK olan Yedek Kurtarma Kodun da geçersiz olur (Notlar'ın kurtarması da dahil); kilit açıldıktan sonra yenisini üretip indirmelisin. Şifreli özel dosyaların için sana verilen anahtarlar da silinir.", secenekler: [{ metin: "Evet, sıfırla", deger: true, tur: "tehlike" }, { metin: "Vazgeç", deger: null }] });
    if (!o) return;
    sifirla.disabled = true;
    try { await E.anahtariSifirla(); onAcildi({ sifirlandi: true }); } catch (er) { hataYaz(er.message || String(er)); sifirla.disabled = false; }
  });

  const kodBolumu = h("details", { class: "msj-kilit-detay" },
    h("summary", { text: "Parolamı unuttum / açılmıyor" }), kodForm, eskiForm, sifirla);

  const metin = h("p", { class: "msj-kilit-metin", text: "Devam etmek için giriş parolanı yaz. Bu parola Notlar kasanı ve mesajlarını birlikte açar." });
  const kutu = h("div", { class: "msj-kilit", role: "region", "aria-label": "Şifreli sohbet kilidi" },
    h("h3", { class: "msj-kilit-baslik", text: "🔐 Şifreli sohbetler" }), metin, parolaForm, hata, kodBolumu);

  // Notlar kasası ZATEN açıksa (girişte sessiz açıldı) parola sorma: anahtarı sessizce onar/bağla.
  if (Kasa.kasaAcikMi()) {
    metin.textContent = "Kilit açılıyor…"; parolaForm.hidden = true; kodBolumu.hidden = true;
    (async () => {
      try { E.anahtarOnbellegiTemizle(); onAcildi(await anahtariHazirlaYadaOnar()); }
      catch (er) { metin.textContent = "Devam etmek için giriş parolanı yaz."; parolaForm.hidden = false; kodBolumu.hidden = false; hataYaz(er.message || String(er)); }
    })();
  }
  return kutu;
}

export { doldur };
