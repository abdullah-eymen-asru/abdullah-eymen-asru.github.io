/*
 * assets/js/akademik/eklenti-paneli.js — Akademik Kütüphane › "🧩 Okuyucu eklentileri" ayar paneli (her kullanıcı kendi eklentilerini yönetir).
 * Eklenti mantığı eklentiler.js'tedir; burada yalnızca açma/kapama, eklenti ayarları ve "özel arama bağlantısı" ekleme arayüzü vardır.
 * Depolama: kullanıcı başına tek küçük satır (≤ 8 KB) + yerel yedek. PDF/çeviri içeriği HİÇBİR yere kaydedilmez. CSP: satır içi stil/olay yok.
 */
import { el, toast } from "./ortak.js";
import { KATALOG, eklentilerAcikMi, ayarYukle, ayarKaydet, ozelUrlGecerli, aramaAdresiniCevir, cevirRizasiVarMi, cevirRizasiVer, cevirRizasiGeriAl, RIZA_METNI } from "./eklentiler.js";

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
        el("label", { class: "ak-ek-ust", for: `ak-ek-${id}` }, kutu, el("span", { class: "ak-ek-simge", "aria-hidden": "true" }, simge), el("strong", {}, ad), el("span", { class: `ak-ek-rozet ${gizlilik === "yerel" ? "yerel" : "dis"}` }, gizlilik === "yerel" ? "🔒 Yerel — veri cihazdan çıkmaz" : gizlilik === "karma" ? "🌐 Önce cihazda; olmazsa onayınla çevrimiçi" : "↗ Yeni sekmede açar")),
        el("small", { class: "ak-alt" }, aciklama), ayarAlan, sil);
    };
    const GRUPLAR = [["ceviri", "🌐 Çeviri"], ["metin", "🧰 Metin araçları"], ["arama", "🔎 Arama kaynakları (yeni sekmede açılır)"]];
    for (const [g, baslik] of GRUPLAR) {
      const ogeler = Object.entries(KATALOG).filter(([, k]) => (k.grup || "arama") === g);
      if (!ogeler.length) continue;
      const kutu = el("div", { class: "ak-ek-grup" }, el("h4", { text: baslik }));
      for (const [id, k] of ogeler) kutu.append(satir(id, k.ad, k.simge, k.aciklama, k.ayarlar, false, k.gizlilik));
      if (g === "arama") for (const o of a.ozel) kutu.append(satir(o.id, o.ad, o.simge, `Senin eklediğin arama sitesi`, [], true, "baglanti"));
      liste.append(kutu);
    }
    // Çevrimiçi çeviri rızası (tek yerden aç/kapat)
    const riza = el("input", { type: "checkbox", id: "ak-ek-riza", checked: cevirRizasiVarMi() });
    riza.addEventListener("change", () => { if (riza.checked) { if (window.confirm(RIZA_METNI)) cevirRizasiVer(); else riza.checked = false; } else cevirRizasiGeriAl(); });
    liste.prepend(el("label", { class: "ak-ek-satir ak-ek-riza", for: "ak-ek-riza" }, el("span", { class: "ak-ek-ust" }, riza, el("strong", { text: "Çevrimiçi çeviriye izin ver" })), el("small", { class: "ak-alt", text: "Açıkken seçtiğin metin (en çok 1500 karakter) ve dil çifti çeviri servisine (Google Çeviri / MyMemory) gönderilir; başka hiçbir bilgin gönderilmez. Kapalıyken yalnızca cihaz içi çeviri (Chrome/Edge) çalışır." })));

    const ad = el("input", { type: "text", maxlength: "40", placeholder: "Sitenin adı (örn. Dergipark)", "aria-label": "Arama sitesinin adı" });
    const url = el("input", { type: "url", maxlength: "500", placeholder: "Sonuç sayfasının adresini buraya yapıştır", "aria-label": "Sonuç sayfası adresi" });
    const ekle = el("button", { type: "button", class: "ak-btn" }, "＋ Ekle");
    ekle.addEventListener("click", () => {
      if (!ad.value.trim()) { toast("Sitenin adını yaz.", "uyari"); return; }
      const cevrilen = aramaAdresiniCevir(url.value);
      if (!cevrilen || !ozelUrlGecerli(cevrilen)) { toast("Adreste “test” kelimesi bulunamadı. O sitede tam olarak test kelimesini arat, çıkan sayfanın adresini yapıştır.", "uyari"); return; }
      if (a.ozel.length >= 10) { toast("En fazla 10 arama sitesi eklenebilir.", "uyari"); return; }
      const id = `ozel-${Date.now().toString(36)}`;
      a.ozel.push({ id, ad: ad.value.trim(), simge: "🔗", url: cevrilen }); a.acik.push(id); kaydet(); ciz();
    });
    const ekleKutu = el("details", { class: "ak-ek-ekle" }, el("summary", { text: "Başka bir arama sitesi eklemek ister misin? (isteğe bağlı)" }),
      el("ol", { class: "ak-alt" }, el("li", { text: "Eklemek istediğin sitede (ör. kendi üniversiten, bir dergi) “test” kelimesini arat." }), el("li", { text: "Çıkan sonuç sayfasının adresini aşağıya yapıştır." }), el("li", { text: "PDF'te metin seçince bu site o metni arar." })),
      ad, url, ekle);
    yer.replaceChildren(el("details", { class: "ak-motor-kart ak-ek-kart" },
      el("summary", {}, "🧩 Okuyucu eklentileri", el("small", { class: "ak-alt" }, " — PDF'te metin seçince balonda çıkar (çeviri, sözlük, Vikipedi, künye bulma…)")),
      el("p", { class: "ak-alt" }, "PDF'te bir metin seçince çıkan balonda hangi araçların görüneceğini buradan seçersin. İşaretli olanlar balonda görünür. Depolama kotanı kullanmaz; dış kod çalıştırılmaz."),
      liste, ekleKutu, durum));
  };
  ciz();
}
