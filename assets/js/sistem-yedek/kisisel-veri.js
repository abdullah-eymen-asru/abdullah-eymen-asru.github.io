/*
 * assets/js/sistem-yedek/kisisel-veri.js — "👤 Kişisel Verilerim (Bireysel İçe/Dışa Aktarma)" sekmesi.   [2026-10 nihai mimari]
 * Tüm üyeler (demo dahil) VE Site Sahibi için TAMAMEN AYNI çalışır. Yalnızca oturum açan kişinin kendi notları, belgeleri ve mesajları.
 * Buradan yapılan içe aktarma ASLA sistem yapılandırmasını bozmaz: sunucu tarafında uye_geri_yukle_tablo (beyaz listeli tablolar, kullanıcı
 * kimliği oturumdan ZORLANIR) ve mesaj_yedek_ice_aktar (yalnızca kendi arşiv sohbeti) kullanılır. Tüm sistem / felaket kurtarma AYRI sekmededir.
 * Mesajlar: "Yedekleme Güvenlik Parolası" ile yeniden şifrelenir (mesaj-yedek.js) → başka hesaba/altyapıya taşınabilir.
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, hataMetni, dugme, ikon } from "./ortak.js";
import { yedekAl, dosyaAdi } from "./disa-aktar.js";
import { aliciOlustur } from "./zip-yazici.js";
import { zipAc } from "./zip-oku.js";
import { icAktarCiz } from "./ice-aktar.js";
import { mesajYedegiOlustur, mesajYedeginiIceAktar, mesajYedegiMi, MESAJ_YEDEK_YOLU, YEDEK_PAROLA_MIN } from "./mesaj-yedek.js";

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
  const mesajK = kart("kv-mesaj", "💬 Mesajlarım (parolalı)", "Sohbetlerin tarayıcıda çözülür ve senin belirleyeceğin parolayla yeniden şifrelenir; başka hesaba taşınabilir.");
  const p1 = parolaAlani("kv-p1", `Yedekleme Güvenlik Parolası (en az ${YEDEK_PAROLA_MIN} karakter)`); const p2 = parolaAlani("kv-p2", "Parolayı tekrar yaz");
  const parolaKutu = el("div", { class: "sy-alt" }, el("p", { class: "muted", text: "Bu parola yedek dosyasında YOKTUR. Unutursan mesajların kimse tarafından geri getirilemez; içe aktarırken sorulur." }), p1, p2);
  const guncelle = () => { parolaKutu.hidden = !mesajK.girdi.checked; };
  mesajK.girdi.addEventListener("change", guncelle); guncelle();
  const ilerleme = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  const indir = dugme({ metin: "Kişisel yedeği oluştur ve indir", ikonAdi: "indir", tur: "birincil" });
  indir.addEventListener("click", async () => {
    const bilesenler = []; if (notlarK.girdi.checked) bilesenler.push("notlar"); if (belgeK.girdi.checked) bilesenler.push("r2");
    const mesajlar = mesajK.girdi.checked;
    if (!bilesenler.length && !mesajlar) return mesaj("En az bir öğe seç.");
    if (mesajlar) {
      if (p1.value.length < YEDEK_PAROLA_MIN) return mesaj(`Yedekleme güvenlik parolası en az ${YEDEK_PAROLA_MIN} karakter olmalı.`);
      if (p1.value !== p2.value) return mesaj("Parolalar eşleşmiyor.");
    }
    indir.disabled = true; let alici = null;
    try {
      alici = await aliciOlustur(dosyaAdi());
      const ek = [];
      if (mesajlar) { ilerleme.textContent = "Mesajlar çözülüyor ve parolayla şifreleniyor…"; ek.push({ ad: MESAJ_YEDEK_YOLU, icerik: await mesajYedegiOlustur(p1.value, (m) => { ilerleme.textContent = m; }) }); }
      const sonuc = bilesenler.length
        ? await yedekAl({ bilesenler, kapsam: "kendi", hassas: false, bicimler: { json: true, sql: false }, alici, sinyal: undefined, ekDosyalar: ek, ilerleme: ({ asama }) => { ilerleme.textContent = asama || ""; } })
        : await yedekAl({ bilesenler: ["notlar"], kapsam: "kendi", hassas: false, bicimler: { json: true, sql: false }, alici, ekDosyalar: ek, sadeceEk: true, ilerleme: ({ asama }) => { ilerleme.textContent = asama || ""; } });
      if (sonuc.blob) { const u = URL.createObjectURL(sonuc.blob); const a = el("a", { href: u, download: dosyaAdi() }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
      p1.value = p2.value = "";
      mesaj(`Kişisel yedek hazır (${bayt(sonuc.boyut)}).`, "success");
    } catch (h) { try { await alici?.iptal?.(); } catch { /* yok say */ } mesaj(`Yedek alınamadı: ${hataMetni(h)}`); }
    finally { indir.disabled = false; ilerleme.textContent = ""; }
  });
  const disaPanel = el("div", { class: "sy-sekme-panel" }, el("h2", { text: "Kişisel verilerimi dışa aktar" }), notlarK.etiket, belgeK.etiket, mesajK.etiket, parolaKutu, el("div", { class: "sy-eylemler" }, indir), ilerleme);

  /* ---------------- içe aktar ---------------- */
  const icKok = el("div", { class: "sy-alt" });
  const mdGirdi = el("input", { type: "file", accept: ".json,.zip,application/json,application/zip", "aria-label": "Mesaj yedeği seç" });
  const mdParola = parolaAlani("kv-ip", "Yedekleme Güvenlik Parolası");
  const mdBtn = dugme({ metin: "Mesajlarımı içe aktar", ikonAdi: "geri", tur: "ikincil" });
  const mdDurum = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  mdBtn.addEventListener("click", async () => {
    const f = mdGirdi.files?.[0]; if (!f) return mesaj("Önce mesaj yedeği dosyasını (.json) ya da yedek ZIP'ini seç.");
    if (!mdParola.value) return mesaj("Yedekleme güvenlik parolasını gir.");
    mdBtn.disabled = true;
    try {
      let metin;
      if (/\.zip$/i.test(f.name)) { const z = await zipAc(f); const g = z.bul(MESAJ_YEDEK_YOLU); if (!g) throw new Error("Bu ZIP içinde parolalı mesaj yedeği yok."); metin = await z.metin(g); }
      else metin = await f.text();
      let nesne; try { nesne = JSON.parse(metin); } catch { throw new Error("Dosya geçerli bir JSON değil."); }
      if (!mesajYedegiMi(nesne)) throw new Error("Bu dosya bir mesaj yedeği değil.");
      const r = await mesajYedeginiIceAktar(nesne, mdParola.value, (m) => { mdDurum.textContent = m; });
      mdParola.value = ""; mdGirdi.value = "";
      mesaj(`${r.sohbet} sohbet (${r.mesaj} mesaj) bu hesabın anahtarıyla yeniden şifrelenip içe aktarıldı${r.atlanan ? `; ${r.atlanan} sohbet zaten içe aktarılmıştı` : ""}. Sohbet / Mesajlar'da arşiv sohbeti olarak görünür.`, "success");
    } catch (h) { mesaj(hataMetni(h)); } finally { mdBtn.disabled = false; mdDurum.textContent = ""; }
  });
  const mesajIc = el("section", { class: "sy-bolum" }, el("h2", { text: "Mesaj yedeğini içe aktar" }),
    el("p", { class: "muted", text: "Başka bir e-postayla açtığın yeni hesaba, sıfırlanmış bir veritabanına ya da farklı bir altyapıya da taşıyabilirsin: parola girilince yedek çözülür ve mesajlar BU hesabın anahtarına yeniden zarflanır." }),
    mdGirdi, mdParola, el("div", { class: "sy-eylemler" }, mdBtn), mdDurum);
  const digerIc = el("section", { class: "sy-bolum" });
  const icPanel = el("div", { class: "sy-sekme-panel", hidden: true }, el("h2", { text: "Kişisel verilerimi içe aktar" }), digerIc, mesajIc);
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
