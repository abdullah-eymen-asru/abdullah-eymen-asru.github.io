/*
 * assets/js/sistem-yedek/sistem-yedek.js — "Sistem Yedekleme & Depolama Yönetimi" sekmesi (sys-yedek).
 * -----------------------------------------------------------------------
 * Görünürlük: owner her zaman; diğer roller yalnızca owner can_export_system'i açtıysa
 * (sistem_export_yetkisi_var_mi). Bu dosya yalnızca arayüzdür: butonu göstermek/gizlemek güvenlik DEĞİL,
 * kolaylıktır — gerçek sınır migration 0074 RPC'lerinde ve sistem-yedek-worker'dadır.
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { el, bayt, hataMetni, BILESENLER } from "./ortak.js";
import { depolamaCiz } from "./depolama.js";
import { gunlukCiz } from "./gunluk.js";
import { yedekAl, dosyaAdi } from "./disa-aktar.js";
import { aliciOlustur } from "./zip-yazici.js";

async function kur() {
  const kok = document.getElementById("sy-kok");
  const mesajKutu = document.getElementById("sy-mesaj");
  if (!kok) return;
  const mesaj = (m, tur = "error") => mesajKutu && showMessage(mesajKutu, m, tur);

  const { data: yetkili, error: ye } = await supabase.rpc("sistem_export_yetkisi_var_mi");
  if (ye) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(ye) })); return; }
  if (!yetkili) {
    kok.replaceChildren(el("p", { class: "auth-message error", text: "Bu bölüm için sistem dışa aktarma yetkin yok. Site Sahibi, Yetki Ayarları > Sistem Yedekleme sekmesinden açabilir." }));
    return;
  }
  const { data: owner } = await supabase.rpc("is_owner");
  const ownerMi = owner === true;

  /* ---------------- 1) Depolama durumu ---------------- */
  const depolamaKok = el("div", { class: "sy-depolama" });
  const yenile = el("button", { type: "button", class: "btn sy-ikincil", text: "↻ Yenile", onclick: () => depolamaCiz(depolamaKok) });

  /* ---------------- 2) Dışa aktarma formu ---------------- */
  const kutular = new Map();
  const bilesenSatirlari = BILESENLER.map((b) => {
    const k = el("input", { type: "checkbox", id: `sy-b-${b.id}`, value: b.id });
    kutular.set(b.id, k);
    return el("label", { class: "sy-secenek", for: `sy-b-${b.id}` }, k,
      el("span", {}, el("strong", { text: `${b.ikon} ${b.ad}` }), el("small", { class: "muted", text: b.aciklama })));
  });
  const tumu = el("input", { type: "checkbox", id: "sy-tumu" });
  tumu.addEventListener("change", () => { for (const k of kutular.values()) k.checked = tumu.checked; bicimGuncelle(); });

  const jsonK = el("input", { type: "checkbox", id: "sy-json" });
  const sqlK = el("input", { type: "checkbox", id: "sy-sql" });
  jsonK.checked = true;
  sqlK.checked = true;
  const bicimKutu = el("div", { class: "sy-alt", hidden: true },
    el("strong", { text: "Veritabanı biçimi" }),
    el("label", { class: "sy-secenek sy-secenek--kucuk", for: "sy-json" }, jsonK, el("span", { text: "JSON (tablo başına)" })),
    el("label", { class: "sy-secenek sy-secenek--kucuk", for: "sy-sql" }, sqlK, el("span", { text: "SQL dump (INSERT)" }))
  );

  const kapsamKendi = el("input", { type: "radio", name: "sy-kapsam", id: "sy-kapsam-kendi", value: "kendi", checked: true });
  const kapsamTum = el("input", { type: "radio", name: "sy-kapsam", id: "sy-kapsam-tum", value: "tum" });
  const hassasK = el("input", { type: "checkbox", id: "sy-hassas" });
  const kapsamKutu = el("div", { class: "sy-alt", hidden: !ownerMi },
    el("strong", { text: "Kapsam" }),
    el("label", { class: "sy-secenek sy-secenek--kucuk", for: "sy-kapsam-kendi" }, kapsamKendi, el("span", { text: "Yalnızca benim verilerim" })),
    el("label", { class: "sy-secenek sy-secenek--kucuk", for: "sy-kapsam-tum" }, kapsamTum, el("span", { text: "Tüm sistem — felaket yedeği (tüm kullanıcılar)" })),
    el("label", { class: "sy-secenek sy-secenek--kucuk", for: "sy-hassas", hidden: true, id: "sy-hassas-etiket" }, hassasK,
      el("span", { text: "Mesajlaşma kayıtlarını da dahil et (KVKK açısından hassas)" }))
  );
  const hassasEtiket = kapsamKutu.querySelector("#sy-hassas-etiket");

  function bicimGuncelle() {
    bicimKutu.hidden = !kutular.get("veritabani").checked;
    if (hassasEtiket) hassasEtiket.hidden = !(kapsamTum.checked && kutular.get("veritabani").checked);
    if (hassasEtiket && hassasEtiket.hidden) hassasK.checked = false;
    tumu.checked = [...kutular.values()].every((k) => k.checked);
  }
  for (const k of kutular.values()) k.addEventListener("change", bicimGuncelle);
  kapsamKendi.addEventListener("change", bicimGuncelle);
  kapsamTum.addEventListener("change", bicimGuncelle);

  const ilerleme = el("div", { class: "sy-ilerleme", "aria-live": "polite", hidden: true });
  const indir = el("button", { type: "button", class: "btn sy-birincil", text: "⬇️ Yedeği oluştur ve indir" });
  const iptalDugme = el("button", { type: "button", class: "btn sy-ikincil", text: "İptal", hidden: true });
  let denetci = null;

  iptalDugme.addEventListener("click", () => denetci?.abort());

  indir.addEventListener("click", async () => {
    const secili = [...kutular.entries()].filter(([, k]) => k.checked).map(([id]) => id);
    if (!secili.length) return mesaj("En az bir bileşen seç.");
    const bicimler = { json: jsonK.checked, sql: sqlK.checked };
    if (secili.includes("veritabani") && !bicimler.json && !bicimler.sql) return mesaj("Veritabanı için JSON ve/veya SQL seç.");
    const kapsam = ownerMi && kapsamTum.checked ? "tum" : "kendi";
    if (kapsam === "tum" && !window.confirm("TÜM kullanıcıların verilerini içeren tam sistem yedeği alınacak. Paket gizli verileri içerir; güvenli bir yerde sakla. Devam edilsin mi?")) return;

    indir.disabled = true;
    iptalDugme.hidden = false;
    ilerleme.hidden = false;
    mesajKutu && (mesajKutu.hidden = true);
    denetci = new AbortController();
    const asama = el("p", { class: "sy-asama", text: "Hazırlanıyor…" });
    const ayrinti = el("p", { class: "muted sy-ayrinti" });
    ilerleme.replaceChildren(el("progress", { class: "sy-cubuk sy-cubuk--bekle", "aria-label": "İşlem sürüyor" }), asama, ayrinti);

    let alici = null;
    try {
      // Dosya seçici, tıklama hareketinin hemen ardından (ilk await) açılmalı.
      alici = await aliciOlustur(dosyaAdi());
      const sonuc = await yedekAl({
        bilesenler: secili, kapsam, hassas: hassasK.checked, bicimler, alici, sinyal: denetci.signal,
        ilerleme: ({ asama: a, ayrinti: d }) => { asama.textContent = a || ""; ayrinti.textContent = d || ""; },
      });
      if (sonuc.blob) {
        const url = URL.createObjectURL(sonuc.blob);
        const a = el("a", { href: url, download: dosyaAdi() });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      const uyari = sonuc.ozet.hatalar.length ? ` ${sonuc.ozet.hatalar.length} dosya alınamadı (ayrıntı pakettedeki OKUBENI.txt'de).` : "";
      mesaj(`Yedek hazır: ${dosyaAdi()} (${bayt(sonuc.boyut)}).${uyari}`, sonuc.ozet.hatalar.length ? "error" : "success");
      depolamaCiz(depolamaKok);
      if (ownerMi) gunlukYukle();
    } catch (h) {
      if (h?.name === "AbortError") mesaj("Dışa aktarma iptal edildi.");
      else mesaj(`Dışa aktarma başarısız: ${hataMetni(h)}`);
      if (ownerMi) gunlukYukle();
    } finally {
      indir.disabled = false;
      iptalDugme.hidden = true;
      ilerleme.hidden = true;
      denetci = null;
    }
  });

  const bellekUyarisi = typeof window.showSaveFilePicker === "function" ? null
    : el("p", { class: "muted sy-not", text: "Bu tarayıcı diske doğrudan yazmayı desteklemiyor; paket bellekte hazırlanır. Büyük arşivler için Chrome veya Edge önerilir." });

  /* ---------------- 3) Günlük (owner) ---------------- */
  const gunlukKok = el("div", { class: "sy-gunluk" });
  const gunlukYukle = () => gunlukCiz(gunlukKok, mesaj);

  kok.replaceChildren(
    el("section", { class: "sy-bolum" },
      el("div", { class: "sy-bolum-ust" }, el("h2", { text: "Depolama Durumu" }), yenile),
      depolamaKok
    ),
    el("section", { class: "sy-bolum" },
      el("h2", { text: "Dışa Aktar" }),
      el("p", { class: "muted", text: ownerMi
        ? "Seçtiğin bileşenler tek, tarih damgalı bir ZIP paketinde indirilir. Her işlem denetim günlüğüne kaydedilir."
        : "Seçtiğin bileşenler tek, tarih damgalı bir ZIP paketinde indirilir. Pakete yalnızca SENİN kendi verilerin girer; her işlem denetim günlüğüne kaydedilir." }),
      kapsamKutu,
      el("label", { class: "sy-secenek sy-secenek--tumu", for: "sy-tumu" }, tumu, el("strong", { text: "Tümünü seç" })),
      el("div", { class: "sy-bilesenler" }, bilesenSatirlari),
      bicimKutu,
      bellekUyarisi,
      el("div", { class: "sy-eylemler" }, indir, iptalDugme),
      ilerleme
    ),
    ownerMi ? el("section", { class: "sy-bolum" }, el("h2", { text: "Dışa Aktarma Denetim Günlüğü" }), gunlukKok) : null
  );

  await depolamaCiz(depolamaKok);
  if (ownerMi) await gunlukYukle();
}

kur().catch((h) => {
  console.error("sistem-yedek.js:", h);
  const m = document.getElementById("sy-mesaj");
  if (m) showMessage(m, `Modül yüklenemedi: ${h.message || h}`, "error");
});
