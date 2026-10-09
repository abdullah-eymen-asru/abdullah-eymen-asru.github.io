/*
 * assets/js/sistem-yedek/sistem-yedek.js — "Sistem Yedekleme & Depolama Yönetimi" sekmesi (sys-yedek).
 * -----------------------------------------------------------------------
 * Görünürlük: owner her zaman; diğer roller yalnızca owner can_export_system'i açtıysa
 * (sistem_export_yetkisi_var_mi). Bu dosya yalnızca arayüzdür: butonu göstermek/gizlemek güvenlik DEĞİL,
 * kolaylıktır — gerçek sınır migration 0074/0075 RPC'lerinde ve sistem-yedek-worker'dadır.
 *
 * KAPSAM (migration 0075) artık zorunlu bir radyo seçimi değil, bileşenlerle aynı dilde isteğe bağlı kartlardır:
 *   • Benim verilerim   (varsayılan işaretli)
 *   • Seçili üyeler     (yalnızca Site Sahibi; açılır arama panelinden üye seçilir)
 *   • Tüm sistem        (yalnızca Site Sahibi; felaket yedeği — diğerlerini kapsar)
 * Birleştirilebilir: "Benim + seçili üyeler" tek pakette indirilebilir. Kişisel Notlar yalnızca kendi notlarındır.
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { el, bayt, hataMetni, BILESENLER, dugme, ikon, onayIste } from "./ortak.js";
import { depolamaCiz } from "./depolama.js";
import { gunlukCiz } from "./gunluk.js";
import { yedekAl, dosyaAdi } from "./disa-aktar.js";
import { aliciOlustur } from "./zip-yazici.js";

const ROLLER = { owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "Editör", special_user: "Özel Üye", user: "Üye" };

/** Onay kutusu kartı (kapsam ve bileşenler AYNI görünüm). */
function secenekKarti({ id, baslik, aciklama, kucuk = false, secili = false }) {
  const girdi = el("input", { type: "checkbox", id, checked: secili });
  const etiket = el("label", { class: `sy-secenek${kucuk ? " sy-secenek--kucuk" : ""}`, for: id }, girdi,
    el("span", { class: "sy-secenek-metin" }, el("strong", { text: baslik }), aciklama ? el("small", { text: aciklama }) : null));
  return { girdi, etiket };
}

function adim(no, baslik, aciklama, ...icerik) {
  return el("section", { class: "sy-adim" },
    el("h3", { class: "sy-adim-baslik" }, el("span", { class: "sy-adim-no", text: String(no) }), baslik),
    aciklama ? el("p", { class: "sy-adim-aciklama", text: aciklama }) : null,
    ...icerik
  );
}

/** Açılır üye seçici: arama kutusu + işaretlenebilir sonuçlar + seçilenler çip olarak. */
function uyeSecici(secilenler, degisti) {
  const arama = el("input", { type: "search", class: "sy-girdi", placeholder: "Ad ya da e-posta ile ara…", "aria-label": "Üye ara", autocomplete: "off", spellcheck: "false" });
  const liste = el("ul", { class: "sy-uye-liste", "aria-live": "polite" });
  const cipler = el("div", { class: "sy-yapi-secili" });
  const temizle = dugme({ metin: "Seçimi temizle", ikonAdi: "kapat", tur: "hayalet", kucuk: true, hidden: true });
  const durum = el("p", { class: "muted sy-not" });
  let zamanlayici = null;
  let sonSorgu = 0;

  const cipleriCiz = () => {
    cipler.replaceChildren(...[...secilenler.entries()].map(([id, ad]) => {
      const kaldir = el("button", { type: "button", "aria-label": `${ad} seçimini kaldır` }, ikon("kapat"));
      kaldir.addEventListener("click", () => { secilenler.delete(id); cipleriCiz(); sonuclariIsaretle(); degisti(); });
      return el("span", { class: "sy-cip" }, el("span", { text: ad, title: ad }), kaldir);
    }));
    temizle.hidden = secilenler.size === 0;
  };
  temizle.addEventListener("click", () => { secilenler.clear(); cipleriCiz(); sonuclariIsaretle(); degisti(); });

  let sonSatirlar = [];
  const sonuclariIsaretle = () => {
    for (const k of liste.querySelectorAll("input[data-id]")) k.checked = secilenler.has(k.dataset.id);
  };
  const sonuclariCiz = (satirlar) => {
    sonSatirlar = satirlar;
    if (!satirlar.length) {
      liste.replaceChildren(el("li", { class: "muted", text: "Eşleşen üye bulunamadı." }));
      return;
    }
    liste.replaceChildren(...satirlar.map((u) => {
      const k = el("input", { type: "checkbox", "data-id": u.id, "aria-label": `${u.ad} seç` });
      k.checked = secilenler.has(u.id);
      k.addEventListener("change", () => {
        if (k.checked) secilenler.set(u.id, u.ad);
        else secilenler.delete(u.id);
        cipleriCiz();
        degisti();
      });
      return el("li", {}, el("label", { class: "sy-uye" }, k,
        el("span", { class: "sy-uye-ad" }, el("strong", { text: u.ad }), u.eposta ? el("small", { text: u.eposta }) : null),
        el("span", { class: "sy-rozet", text: ROLLER[u.rol] || u.rol })));
    }));
  };

  const ara = async () => {
    const no = ++sonSorgu;
    durum.textContent = "Aranıyor…";
    const { data, error } = await supabase.rpc("sistem_export_kullanici_ara", { p_q: arama.value, p_limit: 20 });
    if (no !== sonSorgu) return; // daha yeni bir arama başladı
    if (error) {
      durum.textContent = "";
      liste.replaceChildren(el("li", { class: "auth-message error", text: hataMetni(error) }));
      return;
    }
    durum.textContent = (data || []).length >= 20 ? "İlk 20 sonuç gösteriliyor; aramayı daraltabilirsin." : "";
    sonuclariCiz(data || []);
  };
  arama.addEventListener("input", () => { clearTimeout(zamanlayici); zamanlayici = setTimeout(ara, 250); });

  const kok = el("div", { class: "sy-secici" },
    el("div", { class: "sy-arama" }, ikon("ara"), arama),
    cipler,
    temizle,
    liste,
    durum
  );
  cipleriCiz();
  return { kok, yukle: ara, cipleriCiz };
}

async function kur() {
  const kok = document.getElementById("sy-kok");
  const mesajKutu = document.getElementById("sy-mesaj");
  if (!kok) return;
  kok.classList.add("sy-kok");
  const mesaj = (m, tur = "error") => mesajKutu && showMessage(mesajKutu, m, tur);

  const { data: yetkili, error: ye } = await supabase.rpc("sistem_export_yetkisi_var_mi");
  if (ye) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(ye) })); return; }
  if (!yetkili) {
    kok.replaceChildren(el("p", { class: "auth-message error", text: "Bu bölüm için sistem dışa aktarma yetkin yok. Site Sahibi, Yetki Ayarları > Sistem Yedekleme sekmesinden açabilir." }));
    return;
  }
  const { data: owner } = await supabase.rpc("is_owner");
  const ownerMi = owner === true;
  const { data: oturum } = await supabase.auth.getSession();
  const benimId = oturum?.session?.user?.id || null;

  /* ---------------- 1) Depolama durumu ---------------- */
  const depolamaKok = el("div", { class: "sy-depolama" });
  const yenile = dugme({ metin: "Yenile", ikonAdi: "yenile", tur: "ikincil", kucuk: true, onclick: () => depolamaCiz(depolamaKok) });

  /* ---------------- 2) Dışa aktarma formu ---------------- */
  // Kapsam kartları (yalnızca owner'da seçenek vardır; diğer roller yalnızca kendi verisini alır)
  const benim = secenekKarti({ id: "sy-kapsam-benim", baslik: "Benim verilerim", aciklama: "Hesabına ait kayıtlar, dosyalar ve notlar.", kucuk: true, secili: true });
  const seciliK = secenekKarti({ id: "sy-kapsam-secili", baslik: "Seçili üyeler", aciklama: "Üyeleri arayıp işaretle; yalnızca onların kayıtları ve dosyaları pakete girer (notlar hariç).", kucuk: true });
  const tumK = secenekKarti({ id: "sy-kapsam-tum", baslik: "Tüm sistem — felaket yedeği", aciklama: "Bütün kullanıcıların verisi. Yukarıdaki iki seçeneği kapsar.", kucuk: true });
  const secilenler = new Map();
  const secici = ownerMi ? uyeSecici(secilenler, () => durumGuncelle()) : null;
  const seciciKutu = el("div", { class: "sy-alt", hidden: true }, secici?.kok);
  let seciciYuklendi = false;

  const hassasK = secenekKarti({ id: "sy-hassas", baslik: "Mesajlaşma kayıtlarını da dahil et", aciklama: "KVKK açısından hassas veri içerir; yalnızca gerçekten gerekliyse işaretle.", kucuk: true });
  const hassasKutu = el("div", { class: "sy-alt", hidden: true }, hassasK.etiket);

  const kapsamIcerik = ownerMi
    ? [
        el("div", { class: "sy-secenekler" }, benim.etiket, seciliK.etiket, seciciKutu, tumK.etiket),
        hassasKutu,
      ]
    : [el("p", { class: "sy-bilgi" }, ikon("kisi"), el("span", { text: "Pakete yalnızca SENİN kendi verilerin girer. Başka üyelerin verisini yalnızca Site Sahibi alabilir." }))];

  // Bileşenler
  const kutular = new Map();
  const bilesenKartlari = BILESENLER.map((b) => {
    const k = secenekKarti({ id: `sy-b-${b.id}`, baslik: `${b.ikon} ${b.ad}`, aciklama: b.aciklama });
    kutular.set(b.id, k);
    return k.etiket;
  });
  const tumuDugme = dugme({ metin: "Tümünü seç", ikonAdi: "tik", tur: "ikincil", kucuk: true });
  tumuDugme.addEventListener("click", () => {
    const hepsi = [...kutular.values()].every((k) => k.girdi.checked || k.girdi.disabled);
    for (const k of kutular.values()) if (!k.girdi.disabled) k.girdi.checked = !hepsi;
    durumGuncelle();
  });

  // Veritabanı biçimi
  const jsonK = secenekKarti({ id: "sy-json", baslik: "JSON (tablo başına)", kucuk: true, secili: true });
  const sqlK = secenekKarti({ id: "sy-sql", baslik: "SQL dump (INSERT)", kucuk: true, secili: true });
  const bicimKutu = el("div", { class: "sy-alt", hidden: true }, el("strong", { text: "Veritabanı biçimi" }), jsonK.etiket, sqlK.etiket);

  const notlarK = kutular.get("notlar");

  function durumGuncelle() {
    if (ownerMi) {
      const tum = tumK.girdi.checked;
      benim.girdi.disabled = tum;
      seciliK.girdi.disabled = tum;
      seciciKutu.hidden = !seciliK.girdi.checked || tum;
      if (!seciciKutu.hidden && !seciciYuklendi) { seciciYuklendi = true; secici.yukle(); }
      hassasKutu.hidden = !(tum && kutular.get("veritabani").girdi.checked);
      if (hassasKutu.hidden) hassasK.girdi.checked = false;
      // Kişisel notlar yalnızca çağıranın kendi notlarıdır: "benim" kapsamı yoksa seçilemez.
      const notlarMumkun = tum || benim.girdi.checked;
      notlarK.girdi.disabled = !notlarMumkun;
      if (!notlarMumkun) notlarK.girdi.checked = false;
      seciliK.etiket.querySelector("small").textContent = secilenler.size
        ? `${secilenler.size} üye seçili. Yalnızca onların kayıtları ve dosyaları pakete girer (notlar hariç).`
        : "Üyeleri arayıp işaretle; yalnızca onların kayıtları ve dosyaları pakete girer (notlar hariç).";
    }
    bicimKutu.hidden = !kutular.get("veritabani").girdi.checked;
    tumuDugme.querySelector("span").textContent = [...kutular.values()].every((k) => k.girdi.checked || k.girdi.disabled) ? "Seçimi kaldır" : "Tümünü seç";
  }
  for (const k of kutular.values()) k.girdi.addEventListener("change", durumGuncelle);
  for (const k of [benim, seciliK, tumK]) k.girdi.addEventListener("change", durumGuncelle);

  const ilerleme = el("div", { class: "sy-ilerleme", "aria-live": "polite", hidden: true });
  const indir = dugme({ metin: "Yedeği oluştur ve indir", ikonAdi: "indir", tur: "birincil" });
  const iptalDugme = dugme({ metin: "İptal", ikonAdi: "durdur", tur: "ikincil", hidden: true });
  let denetci = null;
  iptalDugme.addEventListener("click", () => denetci?.abort());

  indir.addEventListener("click", async () => {
    const secili = [...kutular.entries()].filter(([, k]) => k.girdi.checked).map(([id]) => id);
    if (!secili.length) return mesaj("En az bir bileşen seç.");
    const bicimler = { json: jsonK.girdi.checked, sql: sqlK.girdi.checked };
    if (secili.includes("veritabani") && !bicimler.json && !bicimler.sql) return mesaj("Veritabanı için JSON ve/veya SQL seç.");

    // Kapsamı çöz
    let kapsam = "kendi";
    let hedefler = [];
    let hedefAdlari = [];
    if (ownerMi) {
      if (tumK.girdi.checked) kapsam = "tum";
      else if (seciliK.girdi.checked) {
        if (!secilenler.size) return mesaj('"Seçili üyeler" işaretli ama listeden kimse seçilmedi: üye seç ya da kutuyu kaldır.');
        kapsam = "secili";
        hedefler = [...secilenler.keys()];
        hedefAdlari = [...secilenler.values()];
        if (benim.girdi.checked && benimId && !hedefler.includes(benimId)) { hedefler.push(benimId); hedefAdlari.push("Ben"); }
      } else if (!benim.girdi.checked) {
        return mesaj("Kapsam için en az bir seçenek işaretle (Benim verilerim, Seçili üyeler ya da Tüm sistem).");
      }
      if (kapsam === "secili" && secili.includes("notlar") && !hedefler.includes(benimId)) {
        return mesaj("Kişisel Notlar yalnızca kendi notlarını içerir: 'Benim verilerim'i işaretle ya da bu bileşeni kaldır.");
      }
    }

    if (kapsam === "tum") {
      const tamam = await onayIste({
        baslik: "Tüm sistem yedeği alınsın mı?",
        metin: ["TÜM kullanıcıların verilerini içeren tam sistem yedeği alınacak.", "Paket gizli veriler içerir; güvenli bir yerde sakla ve yetkisiz kimseyle paylaşma."],
        tamam: "Yedeği oluştur",
        tehlike: true,
      });
      if (!tamam) return;
    } else if (kapsam === "secili") {
      const tamam = await onayIste({
        baslik: `${hedefler.length} üyenin verisi indirilsin mi?`,
        metin: [`Pakete şu üyelerin kayıtları ve dosyaları girer: ${hedefAdlari.slice(0, 8).join(", ")}${hedefAdlari.length > 8 ? ` ve ${hedefAdlari.length - 8} kişi daha` : ""}.`, "İşlem denetim günlüğüne kaydedilir."],
        tamam: "Devam et",
      });
      if (!tamam) return;
    }

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
      // Dosya seçici, tıklama hareketinin hemen ardından açılmalı (kullanıcı hareketi geçerliliği).
      alici = await aliciOlustur(dosyaAdi());
      const sonuc = await yedekAl({
        bilesenler: secili, kapsam, hassas: hassasK.girdi.checked, bicimler, alici, sinyal: denetci.signal, hedefler, hedefAdlari,
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
    : el("p", { class: "sy-bilgi sy-bilgi--uyari" }, ikon("uyari"), el("span", { text: "Bu tarayıcı diske doğrudan yazmayı desteklemiyor; paket bellekte hazırlanır. Büyük arşivler için Chrome veya Edge önerilir." }));

  /* ---------------- 3) Günlük (owner) ---------------- */
  const gunlukKok = el("div", { class: "sy-gunluk" });
  const gunlukYukle = () => gunlukCiz(gunlukKok, mesaj);

  let no = 0;
  kok.replaceChildren(
    el("section", { class: "sy-bolum" },
      el("div", { class: "sy-bolum-ust" }, el("h2", { text: "Depolama Durumu" }), yenile),
      depolamaKok
    ),
    el("section", { class: "sy-bolum" },
      el("h2", { text: "Dışa Aktar" }),
      el("p", { class: "muted", text: "Seçtiğin bileşenler tek, tarih damgalı bir ZIP paketinde indirilir. Her işlem denetim günlüğüne kaydedilir." }),
      adim(++no, "Kimin verileri?", ownerMi ? "Hepsi isteğe bağlıdır; birlikte işaretleyebilirsin." : null, ...kapsamIcerik),
      adim(++no, "Neler pakete girsin?", null,
        el("div", { class: "sy-ustarac" }, el("span", { class: "muted", text: "İstediklerini işaretle." }), tumuDugme),
        el("div", { class: "sy-secenekler" }, bilesenKartlari),
        bicimKutu
      ),
      bellekUyarisi,
      el("div", { class: "sy-eylemler" }, indir, iptalDugme),
      ilerleme
    ),
    ownerMi ? el("section", { class: "sy-bolum" }, el("h2", { text: "Dışa Aktarma Denetim Günlüğü" }), gunlukKok) : null
  );

  durumGuncelle();
  await depolamaCiz(depolamaKok);
  if (ownerMi) await gunlukYukle();
}

kur().catch((h) => {
  console.error("sistem-yedek.js:", h);
  const m = document.getElementById("sy-mesaj");
  if (m) showMessage(m, `Modül yüklenemedi: ${h.message || h}`, "error");
});
