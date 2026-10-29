/*
 * assets/js/core/kesinti-arayuz.js — kesinti.js'in ARAYÜZÜ: kapatılabilir bilgi/uyarı çubuğu, bekleyen işlem penceresi, bildirimler.
 * CSP: inline stil / inline olay YOK; yalnızca sınıflar (assets/css/kesinti.css, çalışma anında <link> ile eklenir). innerHTML YOK.
 */
const KAPAT_ANAHTARI = "aea_kesinti_kapat";
const el = (etiket, oz = {}, ...c) => {
  const n = document.createElement(etiket);
  for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v); }
  n.append(...c.filter((x) => x != null));
  return n;
};
const dkOnce = (ms) => { const dk = Math.max(0, Math.round(ms / 60000)); return dk < 1 ? "az önce" : dk < 60 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} sa önce` : `${Math.round(dk / 1440)} gün önce`; };

const MESAJ = {
  kesinti: {
    sev: "kirmizi", baslik: "Supabase sunucularına şu an ulaşılamıyor",
    kisa: "Giriş ve veritabanı işlemleri çalışmayabilir. Sorun bizde değil, hizmet sağlayıcıda olabilir.",
    adimlar: [
      "Oturumun zaten açıksa siteyi kullanmaya devam edebilirsin: daha önce açtığın bilgilerin cihazındaki son kopyası gösterilir.",
      "Yeni işlemlerin (kaydet, düzenle, ekle) bu cihazda ŞİFRELİ bir bekleme kuyruğuna alınır; sunucu dönünce gerçek oturumunla sırayla gönderilir.",
      "Kayıt kuyruğa alınana kadar bu sekmeyi ve tarayıcı verisini (site verisi/çerezler) silme; gizli sekmeyi kapatma.",
      "Çok önemli içerikleri ayrıca kendi cihazına da kopyala (metni kopyala, dosyayı indir). Sunucudaki kayıt, ancak kuyruk gönderildikten sonra kesinleşir.",
      "Oturumun kapalıysa: bu cihazdan daha önce “çevrimdışı giriş” açıkken giriş yaptıysan, giriş sayfasında e-posta ve parolanla kısıtlı moda girebilirsin.",
    ],
  },
  veritabani: {
    sev: "kirmizi", baslik: "Veritabanı servisi yanıt vermiyor",
    kisa: "Giriş açık olabilir ama veri okuma/yazma işlemleri başarısız olabilir.",
    adimlar: ["Gösterilen veriler cihazındaki son kopyadır.", "Yeni işlemlerin bekleme kuyruğuna alınır ve servis dönünce gönderilir.", "Bu sekmeyi ve tarayıcı verisini silme."],
  },
  giris: {
    sev: "sari", baslik: "Giriş servisi yanıt vermiyor",
    kisa: "Yeni giriş yapamayabilirsin; oturumu açık olanlar etkilenmez.",
    adimlar: ["Oturumun açıksa normal kullan.", "Bu cihazdan daha önce çevrimdışı girişi açtıysan giriş sayfasında e-posta + parolanla kısıtlı moda girebilirsin.", "Birkaç dakika sonra tekrar dene."],
  },
  yavas: { sev: "sari", baslik: "Sunucu yavaş yanıt veriyor", kisa: "İşlemler normalden uzun sürebilir. Bir şey yapman gerekmiyor.", adimlar: [] },
  cevrimdisi: {
    sev: "sari", baslik: "İnternet bağlantın yok gibi görünüyor",
    kisa: "Site sunucularına da ulaşılamıyor. Bağlantı gelene kadar işlemlerin cihazda bekletilir.",
    adimlar: ["Wi-Fi / mobil veriyi kontrol et.", "Bağlantı gelince bekleyen işlemler otomatik (veya onayınla) gönderilir.", "Bu sekmeyi ve tarayıcı verisini silme."],
  },
};

export function kesintiArayuzuKur(K) {
  const { durum, kesintiOlay, saglikKontrol, kuyrukOzet, kuyrukGonder, kuyrukSil, kuyrukTemizle, kuyrukIndir, kesintiOturumu, kesintiOturumunuBitir } = K;
  try {
    const css = el("link", { rel: "stylesheet", href: new URL("../../css/kesinti.css", import.meta.url).href });
    document.head.append(css);
  } catch { /* stil yüklenemezse çubuk yine metin olarak çalışır */ }

  let bar = null, rozet = null, sonUyari = 0;
  const kapaliAnahtar = () => { try { return sessionStorage.getItem(KAPAT_ANAHTARI) || ""; } catch { return ""; } };
  const kapatKaydet = (d) => { try { sessionStorage.setItem(KAPAT_ANAHTARI, d); } catch { /* yok say */ } };

  function cubugu_kaldir() { bar?.remove(); bar = null; }
  function cubukCiz() {
    const d = durum.durum, m = MESAJ[d];
    const kesintiOtu = kesintiOturumu();
    if (!m && !kesintiOtu) { cubugu_kaldir(); return; }
    if (m && kapaliAnahtar() === d && !kesintiOtu) { cubugu_kaldir(); return; }
    cubugu_kaldir();
    const sev = m?.sev || "sari";
    bar = el("section", { class: `kst-bar kst-${sev}`, role: "status", "aria-live": "polite" });
    const ust = el("div", { class: "kst-ust" });
    const metin = el("div", { class: "kst-metin" },
      el("strong", { text: kesintiOtu ? "Kısıtlı (çevrimdışı) oturumdasın" : m.baslik }),
      el("span", { text: kesintiOtu ? " Sunucuya bağlı değilsin: gösterilenler cihazındaki son kopyadır, yeni işlemlerin sunucu dönünce gönderilmek üzere bekletilir." : ` ${m.kisa}` }));
    const eylem = el("div", { class: "kst-eylem" });
    const ayr = el("button", { type: "button", class: "kst-dugme", "aria-expanded": "false" }, "Ne yapmalıyım?");
    const dene = el("button", { type: "button", class: "kst-dugme" }, "Yeniden dene");
    const kapat = el("button", { type: "button", class: "kst-dugme kst-kapat", "aria-label": "Bu uyarıyı kapat" }, "Kapat");
    const detay = el("div", { class: "kst-detay", hidden: true });
    const adimlar = [...(m?.adimlar || [])];
    if (kesintiOtu) adimlar.unshift("Sunucu dönünce çıkış yapıp normal giriş yap: bekleyen işlemlerin o zaman gerçek oturumunla gönderilir.");
    if (adimlar.length) detay.append(el("ul", {}, ...adimlar.map((a) => el("li", { text: a }))));
    detay.append(el("p", { class: "kst-alt", text: `Son kontrol: ${durum.sonKontrol ? new Date(durum.sonKontrol).toLocaleTimeString("tr-TR") : "—"} · giriş servisi: ${durum.auth?.ok ? "çalışıyor" : "yanıt yok"} · veritabanı: ${durum.rest?.ok ? "çalışıyor" : "yanıt yok"}${durum.gecikmeMs != null ? ` · ${durum.gecikmeMs} ms` : ""}. Kontrol doğrudan tarayıcından yapılır; Cloudflare kotası harcanmaz.` }));
    ayr.addEventListener("click", () => { detay.hidden = !detay.hidden; ayr.setAttribute("aria-expanded", String(!detay.hidden)); });
    dene.addEventListener("click", async () => { dene.disabled = true; dene.textContent = "Kontrol ediliyor…"; await saglikKontrol({ zorla: true }).catch(() => {}); dene.disabled = false; dene.textContent = "Yeniden dene"; });
    kapat.addEventListener("click", () => { kapatKaydet(d); cubugu_kaldir(); });
    if (adimlar.length) eylem.append(ayr);
    eylem.append(dene, kapat);
    ust.append(metin, eylem);
    bar.append(ust, detay);
    document.body.prepend(bar);
  }

  function rozetCiz() {
    rozet?.remove(); rozet = null;
    if (!durum.kuyruk) return;
    rozet = el("button", { type: "button", class: "kst-rozet", "aria-label": `${durum.kuyruk} bekleyen işlem` }, `⏳ ${durum.kuyruk} bekleyen işlem`);
    rozet.addEventListener("click", kuyrukPenceresi);
    document.body.append(rozet);
  }

  async function kuyrukPenceresi() {
    document.querySelector(".kst-modal")?.remove();
    const liste = await kuyrukOzet();
    const kap = el("div", { class: "kst-modal", role: "dialog", "aria-modal": "true", "aria-label": "Bekleyen işlemler" });
    const kutu = el("div", { class: "kst-kutu" });
    const kapat = el("button", { type: "button", class: "kst-dugme", "aria-label": "Pencereyi kapat" }, "Kapat");
    kapat.addEventListener("click", () => kap.remove());
    kap.addEventListener("click", (e) => { if (e.target === kap) kap.remove(); });
    const durumYazi = el("p", { class: "kst-alt", role: "status" });
    const ul = el("ul", { class: "kst-kuyruk-liste" });
    const YONTEM = { POST: "Ekleme", PATCH: "Güncelleme", DELETE: "Silme", PUT: "Yazma" };
    if (!liste.length) ul.append(el("li", { text: "Bekleyen işlem yok." }));
    for (const o of liste) {
      const sil = el("button", { type: "button", class: "kst-dugme" }, "Vazgeç");
      sil.addEventListener("click", async () => { await kuyrukSil(o.id); kuyrukPenceresi(); });
      const ozet = o.govde && typeof o.govde === "object" ? Object.keys(Array.isArray(o.govde) ? o.govde[0] || {} : o.govde).slice(0, 6).join(", ") : "";
      ul.append(el("li", {}, el("div", {}, el("strong", { text: `${YONTEM[o.yontem] || o.yontem} · ${o.tablo || "kayıt"}` }), el("small", { text: ` · ${dkOnce(o.yas)}${o.yontem === "DELETE" ? " · yıkıcı işlem" : ""}` }), ozet ? el("div", { class: "kst-alt", text: `Alanlar: ${ozet}` }) : null), sil));
    }
    const gonder = el("button", { type: "button", class: "kst-dugme kst-birincil" }, "Şimdi gönder");
    const indir = el("button", { type: "button", class: "kst-dugme" }, "Yedek olarak indir (JSON)");
    const hepsi = el("button", { type: "button", class: "kst-dugme kst-tehlike" }, "Hepsini sil");
    gonder.addEventListener("click", async () => {
      gonder.disabled = true; durumYazi.textContent = "Gönderiliyor…";
      const s = await kuyrukGonder({});
      durumYazi.textContent = s.girisGerek ? "Gönderebilmek için gerçek bir oturum gerekir: sunucu çalışırken çıkış yapıp normal giriş yap." : `Gönderilen: ${s.gonderilen} · hata: ${s.hata} · kalan: ${s.kalan}`;
      gonder.disabled = false; if (!s.kalan) setTimeout(() => kap.remove(), 1200);
    });
    indir.addEventListener("click", () => kuyrukIndir());
    hepsi.addEventListener("click", async () => { if (window.confirm("Bekleyen TÜM işlemler silinsin mi? Bu geri alınamaz; sunucuya hiç gönderilmeyecekler.")) { await kuyrukTemizle(); kap.remove(); } });
    kutu.append(el("h2", { text: "Bekleyen işlemler" }),
      el("p", { class: "kst-alt", text: "Sunucuya ulaşılamadığında yaptığın değişiklikler cihazında şifreli olarak bekletilir. Sunucu dönünce gerçek oturumunla sırayla gönderilir. Silme işlemleri ve 10 dakikadan eski kayıtlar otomatik gönderilmez; buradan onayınla gönderirsin." }),
      ul, durumYazi, el("div", { class: "kst-eylem" }, gonder, indir, hepsi, kapat));
    kap.append(kutu);
    document.body.append(kap);
    gonder.focus();
  }

  const bildir = (metin, tur = "") => {
    const t = el("div", { class: `kst-toast ${tur}`, role: "status" }, metin);
    document.body.append(t);
    setTimeout(() => t.remove(), 7000);
  };

  kesintiOlay("kesinti-durum", () => { cubukCiz(); });
  kesintiOlay("kesinti-duzeldi", () => {
    cubugu_kaldir();
    try { sessionStorage.removeItem(KAPAT_ANAHTARI); } catch { /* yok say */ }
    bildir("Sunucu bağlantısı yeniden kuruldu." + (durum.kuyruk ? " Bekleyen işlemlerin gönderiliyor…" : ""), "kst-ok");
  });
  kesintiOlay("kesinti-kuyruk", (e) => {
    rozetCiz();
    const d = e.detail || {};
    if (d.yeni && Date.now() - sonUyari > 20000) { sonUyari = Date.now(); bildir(`Sunucuya ulaşılamıyor: değişikliğin (${d.tablo || "kayıt"}) bu cihazda şifreli olarak bekletiliyor ve sunucu dönünce gönderilecek. Sekmeyi ve tarayıcı verisini silme.`, "kst-uyari"); }
    if (d.gonderilen) bildir(`${d.gonderilen} bekleyen işlem sunucuya gönderildi.${d.kalan ? ` ${d.kalan} işlem onayını bekliyor.` : ""}`, "kst-ok");
    if (d.hata && !d.gonderilen) bildir("Bazı bekleyen işlemler gönderilemedi. Sağ alttaki “bekleyen işlem” düğmesinden inceleyebilirsin.", "kst-uyari");
  });
  kesintiOlay("kesinti-onbellek", () => { /* çubuk zaten uyarıyor */ });
  window.addEventListener("pageshow", () => { cubukCiz(); rozetCiz(); });
  setTimeout(() => { cubukCiz(); rozetCiz(); }, 200);
  void kesintiOturumunuBitir;
}
