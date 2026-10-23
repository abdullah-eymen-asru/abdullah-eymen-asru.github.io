/*
 * assets/js/sistem-yedek/kisisel-veri.js — "👤 Kişisel Verilerim (Bireysel İçe/Dışa Aktarma)" sekmesi.   [2026-10 nihai mimari]
 * Tüm üyeler (demo dahil) VE Site Sahibi için TAMAMEN AYNI çalışır. Yalnızca oturum açan kişinin kendi notları, belgeleri ve mesajları.
 * Buradan yapılan içe aktarma ASLA sistem yapılandırmasını bozmaz: sunucu tarafında uye_geri_yukle_tablo (beyaz listeli tablolar, kullanıcı
 * kimliği oturumdan ZORLANIR) ve mesaj_yedek_ice_aktar (yalnızca kendi arşiv sohbeti) kullanılır. Tüm sistem / felaket kurtarma AYRI sekmededir.
 * Mesajlar: 16 haneli Yedek Kurtarma Koduyla (Notlar ile TEK kod) yeniden şifrelenir (mesaj-yedek.js); ayrı parola yok → başka hesaba/altyapıya taşınabilir.
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, hataMetni, dugme, ikon } from "./ortak.js";
import { yedekAl, dosyaAdi } from "./disa-aktar.js";
import { aliciOlustur } from "./zip-yazici.js";
import { zipAc } from "./zip-oku.js";
import { icAktarCiz } from "./ice-aktar.js";
import { mesajYedegiOlustur, mesajKodunuDogrula, MESAJ_YEDEK_YOLU } from "./mesaj-yedek.js";
import { kodBicimle } from "../kurtarma-kiti/kit.js";

const kart = (id, baslik, aciklama, secili = true) => {
  const girdi = el("input", { type: "checkbox", id, checked: secili });
  return { girdi, etiket: el("label", { class: "sy-secenek sy-secenek--kucuk", for: id }, girdi, el("span", { class: "sy-secenek-metin" }, el("strong", { text: baslik }), el("small", { text: aciklama }))) };
};
const parolaAlani = (id, etiket) => { const g = el("input", { type: "password", id, class: "sy-girdi", autocomplete: "new-password", "aria-label": etiket, placeholder: etiket }); return g; };

export function kisiselVeriCiz(kok, mesaj) {
  const uyari = el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: "Bu bölüm yalnızca SENİN verilerin içindir: notların, yüklediğin belgeler ve mesajların. Buradan yapılan içe aktarma site ayarlarını, rolleri ve yetkileri ASLA değiştirmez." }));

  /* ---------------- dışa aktar ---------------- */
  const notlarK = kart("kv-notlar", "📝 Notlarım", "Kişisel notlar, alıntılar, kaynaklar (uçtan uca şifreli kalır).");
  const belgeK = kart("kv-belge", "📄 Yüklediğim belgeler", "Dosya yöneticisi ve kütüphanedeki kendi dosyaların.");
  const mesajK = kart("kv-mesaj", "💬 Mesajlarım (Yedek Kurtarma Koduyla şifreli)", "Sohbetlerin tarayıcıda çözülür ve 16 haneli Yedek Kurtarma Kodunla yeniden şifrelenir; başka hesaba taşınabilir.");
  const kodGirdi = el("input", { type: "text", id: "kv-kod", class: "sy-girdi", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "19", inputmode: "text", "aria-label": "Yedek Kurtarma Kodu", placeholder: "XXXX-XXXX-XXXX-XXXX" });
  kodGirdi.addEventListener("input", () => { kodGirdi.value = kodBicimle(kodGirdi.value); });
  const parolaKutu = el("div", { class: "sy-alt" }, el("p", { class: "muted", text: "Mesaj dosyası senin Yedek Kurtarma Kodunla şifrelenir (ayrı bir parola YOK). Kodu gir; hesabındaki kayıtla doğrulanır. Kod yedeğin içinde değildir; içe aktarırken yalnızca bu kod istenir." }), kodGirdi);
  const guncelle = () => { parolaKutu.hidden = !mesajK.girdi.checked; };
  mesajK.girdi.addEventListener("change", guncelle); guncelle();
  const ilerleme = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  const indir = dugme({ metin: "Kişisel yedeği oluştur ve indir", ikonAdi: "indir", tur: "birincil" });
  indir.addEventListener("click", async () => {
    const bilesenler = []; if (notlarK.girdi.checked) bilesenler.push("notlar"); if (belgeK.girdi.checked) bilesenler.push("r2");
    const mesajlar = mesajK.girdi.checked;
    if (!bilesenler.length && !mesajlar) return mesaj("En az bir öğe seç.");
    if (mesajlar) {
      if (kodGirdi.value.replace(/-/g, "").length !== 16) return mesaj("Yedek Kurtarma Kodu 16 karakter olmalı (XXXX-XXXX-XXXX-XXXX).");
    }
    indir.disabled = true; let alici = null;
    try {
      const kod = mesajlar ? await mesajKodunuDogrula(kodGirdi.value) : null;
      alici = await aliciOlustur(dosyaAdi());
      const ek = [];
      if (mesajlar) { ilerleme.textContent = "Mesajlar çözülüyor ve kodunla şifreleniyor…"; ek.push({ ad: MESAJ_YEDEK_YOLU, icerik: await mesajYedegiOlustur(kod, (m) => { ilerleme.textContent = m; }, { kodlu: true }) }); }
      const sonuc = bilesenler.length
        ? await yedekAl({ bilesenler, kapsam: "kendi", hassas: false, bicimler: { json: true, sql: false }, alici, sinyal: undefined, ekDosyalar: ek, ilerleme: ({ asama }) => { ilerleme.textContent = asama || ""; } })
        : await yedekAl({ bilesenler: ["notlar"], kapsam: "kendi", hassas: false, bicimler: { json: true, sql: false }, alici, ekDosyalar: ek, sadeceEk: true, ilerleme: ({ asama }) => { ilerleme.textContent = asama || ""; } });
      if (sonuc.blob) { const u = URL.createObjectURL(sonuc.blob); const a = el("a", { href: u, download: dosyaAdi() }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
      kodGirdi.value = "";
      mesaj(`Kişisel yedek hazır (${bayt(sonuc.boyut)}).`, "success");
    } catch (h) { try { await alici?.iptal?.(); } catch { /* yok say */ } mesaj(`Yedek alınamadı: ${hataMetni(h)}`); }
    finally { indir.disabled = false; ilerleme.textContent = ""; }
  });
  const disaPanel = el("div", { class: "sy-sekme-panel" }, el("h2", { text: "Kişisel verilerimi dışa aktar" }), notlarK.etiket, belgeK.etiket, mesajK.etiket, parolaKutu, el("div", { class: "sy-eylemler" }, indir), ilerleme);

  /* ---------------- içe aktar ---------------- */
  const icKok = el("div", { class: "sy-alt" });
  const digerIc = el("section", { class: "sy-bolum" });
  const icPanel = el("div", { class: "sy-sekme-panel", hidden: true }, el("h2", { text: "Kişisel verilerimi içe aktar" }), digerIc);
  let icKuruldu = false;

  /* ---------------- alt sekmeler ---------------- */
  const serit = el("div", { class: "sy-altsekmeler", role: "tablist", "aria-label": "Kişisel veri işlemleri" });
  const sek = [{ id: "disa", ad: "📤 Dışa aktar", panel: disaPanel }, { id: "ice", ad: "📥 İçe aktar (geri yükle)", panel: icPanel }];
  const sec = (id) => {
    for (const t of sek) { t.panel.hidden = t.id !== id; t.dugme.setAttribute("aria-selected", String(t.id === id)); t.dugme.tabIndex = t.id === id ? 0 : -1; }
    if (id === "ice" && !icKuruldu) { icKuruldu = true; icAktarCiz(digerIc, mesaj, { uye: true }).catch((h) => mesaj(hataMetni(h))); }
  };
  for (const t of sek) { t.dugme = el("button", { type: "button", role: "tab", class: "sy-altsekme", text: t.ad, "aria-selected": "false" }); t.dugme.addEventListener("click", () => sec(t.id)); serit.append(t.dugme); }
  kok.replaceChildren(uyari, serit, ...sek.map((t) => t.panel));
  sec("disa");
  void icKok; void supabase;
}
