/*
 * assets/js/kurtarma-kiti/kit-arayuz.js — Yedek Kurtarma Kodu arayüzleri (innerHTML YOK, inline stil YOK; CSP uyumlu).
 *   kitKartiAc(duyur)        : bilgi kartı + kod üret / yenile (kod YALNIZCA bir kez gösterilir)
 *   kodSor({...})            : kod girişi penceresi (içe aktarma / kilit açma); dogrula(kod) hata fırlatırsa pencere açık kalır
 *   kitHatirlatma(kok, ...)  : "henüz kod üretmedin" şeridi
 */
import { h } from "../mesajlasma/dom.js";
import * as Kit from "./kit.js";

let cssYuklendi = false;
export function cssYukle() {
  if (cssYuklendi || document.querySelector('link[data-kk-css]')) { cssYuklendi = true; return; }
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/assets/css/kurtarma-kiti.css"; l.setAttribute("data-kk-css", "1");
  document.head.append(l); cssYuklendi = true;
}

/** Kısa, net açıklama kartı: hangi kod neyi açar. */
export function bilgiKarti() {
  return h("div", { class: "kk-bilgi", role: "note" },
    h("strong", { class: "kk-bilgi-baslik", text: "🔑 Yedek Kurtarma Kodu — Notlar + Mesajlar + yedekler için TEK kod" }),
    h("p", { class: "kk-bilgi-metin", text: "Bu tek kod Notlarını ve Mesajlaşma sohbetlerini BİRLİKTE açar. Kodu Notlar'da da Mesajlar'da da aynı pencereden üretirsin; hangisinden yenilersen yenile, yeni kod ikisini de açar ve eski kod ikisi için de geçersiz olur. Normal girişte hiç gerekmez; yalnızca şu durumlarda lazım olur:" }),
    h("ul", { class: "kk-bilgi-liste" },
      h("li", {}, h("b", { text: "Notlar: " }), "giriş parolanı sıfırlayıp eski kasan açılmıyorsa notlarını geri açar."),
      h("li", {}, h("b", { text: "Mesajlaşma: " }), "yedeğini FARKLI bir e-posta/hesaba aktarırken, siteyi başka bir veritabanına taşırken ya da mesaj yedeğini (Sistem Yedekleme › Kişisel verilerim) dışa/içe aktarırken sohbetlerini çözer; yedek dosyası için ayrı bir parola yoktur."),
      h("li", {}, h("b", { text: "Yedek içe aktarma: " }), "Sistem/üye yedeğini geri yüklerken aynı kod istenir; eski notların ve sohbetlerin yeni hesabının anahtarlarına yeniden zarflanır, hiçbir şey kaybolmaz.")),
    h("p", { class: "kk-bilgi-uyari", text: "Kod sunucuya gönderilmez ve saklanmaz; kaybedersen ve parolanı da unutursan geri getirilemez. Güvenli bir yere (parola yöneticisi, kâğıt) yaz." }));
}

function dosyaIndir(ad, metin) {
  const url = URL.createObjectURL(new Blob([metin], { type: "text/plain;charset=utf-8" }));
  const a = h("a", { href: url, download: ad });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pencere(baslik, icerik, kapatinca) {
  cssYukle();
  const onceki = document.activeElement;
  const kapat = (v) => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); kapatinca?.(v); };
  const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(null); } };
  const kutu = h("div", { class: "kk-modal", role: "dialog", "aria-modal": "true", "aria-label": baslik }, h("h3", { class: "kk-modal-baslik", text: baslik }), icerik);
  const kaplama = h("div", { class: "kk-kaplama" }, kutu);
  kaplama.addEventListener("mousedown", (e) => { if (e.target === kaplama) kapat(null); });
  document.body.append(kaplama);
  document.addEventListener("keydown", tus, true);
  return { kapat, kutu };
}

/** Kod üret / yenile penceresi. Dönüş: kod üretildiyse true. */
export function kitKartiAc(duyur = () => {}) {
  return new Promise(async (coz) => {
    let durum;
    try { durum = await Kit.kitDurumu(); } catch (e) { duyur(e.message || String(e), true); return coz(false); }
    const govde = h("div", { class: "kk-govde" });
    let uretildi = false;
    const p = pencere("Yedek Kurtarma Kodu", govde, () => coz(uretildi));

    function baslangic() {
      const hata = h("p", { class: "kk-hata", role: "alert", hidden: true });
      const uret = h("button", { type: "button", class: "kk-btn kk-btn--birincil", text: durum.kitVar ? "Yeni kod üret (eskisi geçersiz olur)" : "Kodu oluştur" });
      const kapat = h("button", { type: "button", class: "kk-btn", text: "Kapat", onclick: () => p.kapat(null) });
      uret.addEventListener("click", async () => {
        uret.disabled = true; hata.hidden = true;
        try { const r = await Kit.kitOlustur(); uretildi = true; goster(r); }
        catch (e) { hata.textContent = e.message || String(e); hata.hidden = false; uret.disabled = false; }
      });
      govde.replaceChildren(bilgiKarti(),
        h("p", { class: "kk-durum", text: "ℹ️ Tek kod: Notlar + Mesajlar. Burada ya da Notlar'da yeni kod üretirsen eski kod ikisi için de geçersiz olur. Mesaj şifreleme anahtarını sıfırlarsan kod silinir; yeni kodu hemen üretirsen Notlar'ı da kapsar. Kod, Notlar kasan ve mesaj anahtarın ikisi de açılabiliyorsa üretilir."}),
        durum.kitVar
          ? h("p", { class: "kk-durum kk-durum--iyi", text: `✓ Bir kod üretilmiş (${new Date(durum.kitAt).toLocaleString("tr-TR")}). Kodu kaybettiysen yenisini üretebilirsin; eski kod çalışmaz.` })
          : h("p", { class: "kk-durum kk-durum--uyari", text: "Henüz kod üretilmedi. Yedeğini başka bir hesaba taşıyabilmek için bir kez oluştur." }),
        hata, h("div", { class: "kk-eylem" }, kapat, uret));
    }

    function goster(r) {
      const kodEl = h("code", { class: "kk-kod", text: r.kod, "aria-label": "Yedek kurtarma kodun" });
      const kopyala = h("button", { type: "button", class: "kk-btn", text: "Kopyala" });
      kopyala.addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.kod); kopyala.textContent = "Kopyalandı ✓"; } catch { kopyala.textContent = "Kopyalanamadı — elle yaz"; } });
      const indir = h("button", { type: "button", class: "kk-btn", text: "İndir (.txt)" });
      indir.addEventListener("click", () => dosyaIndir("asru-yedek-kurtarma-kodu.txt",
        `Asru — Yedek Kurtarma Kodu\n\n${r.kod}\n\nBu kod notlarını ve mesajlaşma sohbetlerini farklı bir hesapta/altyapıda açar.\nSunucuda SAKLANMAZ; kaybedersen geri getirilemez. Bu dosyayı güvenli bir yerde sakla, kimseyle paylaşma.\nOluşturma: ${new Date().toLocaleString("tr-TR")}\n`));
      const onay = h("input", { type: "checkbox", id: "kk-onay" });
      const bitti = h("button", { type: "button", class: "kk-btn kk-btn--birincil", text: "Bitti", disabled: true, onclick: () => p.kapat(true) });
      onay.addEventListener("change", () => { bitti.disabled = !onay.checked; });
      govde.replaceChildren(
        h("p", { class: "kk-durum kk-durum--iyi", text: "Kodun hazır. Bu pencereyi kapatınca bir daha gösterilmez:" }),
        kodEl, h("div", { class: "kk-eylem kk-eylem--sol" }, kopyala, indir),
        !r.notlar ? h("p", { class: "kk-durum kk-durum--uyari", text: "Not: Bu hesapta henüz bir Notlar kasası yok; kod şimdilik yalnızca mesajlarını kapsıyor. Notlar kasasını kurduktan sonra kodu yenile." }) : null,
        !r.mesajlar ? h("p", { class: "kk-durum kk-durum--uyari", text: "Not: Mesaj anahtarı oluşturulamadığı için kod şimdilik yalnızca notlarını kapsıyor; Mesajlar'ı bir kez açıp kodu yenile." }) : null,
        h("label", { class: "kk-onay", for: "kk-onay" }, onay, h("span", { text: "Kodu güvenli bir yere kaydettim." })),
        h("div", { class: "kk-eylem" }, bitti));
    }
    baslangic();
  });
}

/**
 * Kod girişi. dogrula(kod) başarılıysa pencere kapanır ve sonucu döner; hata fırlatırsa formda gösterilir.
 * parolaAlani: kod girişiyle birlikte (opsiyonel) parola istenecekse { etiket, ipucu, zorunlu }.
 */
export function kodSor({ baslik = "Yedek Kurtarma Kodu", aciklama = "", tamamMetin = "Kodu doğrula", parolaAlani = null, dogrula }) {
  return new Promise((coz) => {
    const kod = h("input", { type: "text", class: "kk-girdi kk-girdi--kod", placeholder: "XXXX-XXXX-XXXX-XXXX", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "19", "aria-label": "Yedek kurtarma kodu", inputmode: "text" });
    kod.addEventListener("input", () => { const s = kod.selectionStart; kod.value = Kit.kodBicimle(kod.value); try { kod.setSelectionRange(kod.value.length, kod.value.length); } catch { void s; } });
    const parola = parolaAlani ? h("input", { type: "password", class: "kk-girdi", placeholder: parolaAlani.ipucu || "", autocomplete: "new-password", "aria-label": parolaAlani.etiket }) : null;
    const hata = h("p", { class: "kk-hata", role: "alert", hidden: true });
    const tamam = h("button", { type: "submit", class: "kk-btn kk-btn--birincil", text: tamamMetin });
    const vazgec = h("button", { type: "button", class: "kk-btn", text: "Vazgeç" });
    const form = h("form", { class: "kk-form", novalidate: true },
      aciklama ? h("p", { class: "kk-modal-metin", text: aciklama }) : null,
      h("label", { class: "kk-alan" }, h("span", { text: "Kurtarma kodu" }), kod),
      parola ? h("label", { class: "kk-alan" }, h("span", { text: parolaAlani.etiket }), parola) : null,
      hata, h("div", { class: "kk-eylem" }, vazgec, tamam));
    const p = pencere(baslik, form, (v) => coz(v));
    vazgec.addEventListener("click", () => p.kapat(null));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); hata.hidden = true;
      if (kod.value.replace(/-/g, "").length !== 16) { hata.textContent = "Kod 16 karakter olmalı (XXXX-XXXX-XXXX-XXXX)."; hata.hidden = false; return kod.focus(); }
      if (parolaAlani?.zorunlu && !parola.value) { hata.textContent = `${parolaAlani.etiket} gerekli.`; hata.hidden = false; return parola.focus(); }
      tamam.disabled = true; tamam.textContent = "Çözülüyor…";
      try { p.kapat(await dogrula(kod.value, parola?.value || null)); }
      catch (er) { hata.textContent = er.message || String(er); hata.hidden = false; tamam.disabled = false; tamam.textContent = tamamMetin; }
    });
    kod.focus();
  });
}
