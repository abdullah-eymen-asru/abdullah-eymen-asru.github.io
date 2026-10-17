/**
 * ui-ayar.js — Ayarlar sekmesi: saat bazlı uyarılar (+bildirim izni ve tarayıcıya özel yardım), yapay zekâ + bağlantı testi, bulut senkronu,
 * gizlilik (her konum özelliğinin OPSİYONEL olduğu açıkça yazılı) ve teşhis.
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, cipGrubu, olay, izinYardimKarti, zamanOnce, bosalt, ekle, doldur } from "./ui-temel.js";
import { uyarilariOku, uyarilariKaydet, yeniUyari, bildirimDestegi, izinIste, bildirimGoster, sonrakiUyari, zamanEtiketi, GUN_ADLARI } from "./bildirim.js";
import { tarayiciTespit } from "./izin-yardim.js";

function opsiyonel(ikon, ad, metin, sinif = "") {
  return el("div", { class: "hv-gizlilik-satir" }, el("span", { class: "hv-gizlilik-ikon", "aria-hidden": "true", text: ikon }), el("div", {}, el("strong", { text: ad }), el("small", { class: "hv-ipucu", text: metin })), rozet("Opsiyonel", sinif || "hv-rozet-ok"));
}

export function ayarSekmesi(d, kb) {
  /* ---------- 1) Saat bazlı uyarılar ---------- */
  const uyariKutu = el("div", { class: "hv-uyari-liste" });
  const izinKutu = el("div", { class: "hv-izin-kutu" });
  const sonrakiKutu = el("p", { class: "hv-ipucu" });
  let liste = uyarilariOku();
  const kaydet = () => { uyarilariKaydet(liste); ciz(); };
  function ciz() {
    uyariKutu.replaceChildren(...liste.map((u, i) => {
      const saat = el("input", { type: "time", class: "hv-girdi hv-saat-girdi", value: u.saat, "aria-label": "Uyarı saati" });
      olay(saat, "change", () => { if (/^\d{2}:\d{2}$/.test(saat.value)) { liste[i] = { ...u, saat: saat.value }; kaydet(); } });
      const gunler = el("div", { class: "hv-gunler", role: "group", "aria-label": "Günler" }, ...GUN_ADLARI.map((ad, gi) => olay(el("button", { type: "button", class: "hv-gun-btn", "aria-pressed": String(u.gunler.includes(gi + 1)), text: ad }), "click", () => {
        const g = u.gunler.includes(gi + 1) ? u.gunler.filter((x) => x !== gi + 1) : [...u.gunler, gi + 1].sort();
        liste[i] = { ...u, gunler: g.length ? g : u.gunler }; kaydet();
      })));
      const tur = cipGrubu({ secenekler: [["oneri", "Günlük öneri"], ["yalniz_uyari", "Yalnızca uyarı varsa"]], aktif: () => liste[i].tur, onSec: (v) => { liste[i] = { ...liste[i], tur: v }; uyarilariKaydet(liste); ciz(); }, kucuk: true });
      const ac = el("input", { type: "checkbox", id: `uy-${u.id}`, "aria-label": "Uyarı açık" }); ac.checked = u.acik;
      olay(ac, "change", () => { liste[i] = { ...u, acik: ac.checked }; kaydet(); });
      const sil = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-tehlike", "aria-label": "Uyarıyı sil", text: "Sil" }), "click", () => { liste.splice(i, 1); kaydet(); });
      return el("div", { class: `hv-uyari-satir${u.acik ? "" : " kapali"}` }, el("div", { class: "hv-uyari-ust" }, saat, el("label", { class: "hv-onay", for: `uy-${u.id}` }, ac, el("span", { text: u.acik ? "Açık" : "Kapalı" })), sil), gunler, tur.kok);
    }));
    if (!liste.length) ekle(uyariKutu, ipucu("Henüz uyarı yok. “＋ Uyarı ekle” ile saat seç (örn. 07:30 sabah, 17:30 dönüş)."));
    const sn = sonrakiUyari(liste);
    sonrakiKutu.textContent = sn ? `⏰ Sonraki uyarı: ${zamanEtiketi(sn.t)}` : "";
    izinCiz();
  }
  function izinCiz() {
    const b = bildirimDestegi();
    const t = tarayiciTespit();
    bosalt(izinKutu);
    if (!b.destek) { ekle(izinKutu, el("p", { class: "hv-uyari", text: b.sebep }), t.os === "ios" ? izinYardimKarti("bildirim", { acik: true }) : null); return; }
    if (b.izin === "granted") {
      ekle(izinKutu, el("p", { class: "hv-ipucu", text: "✅ Bildirim izni açık." }), olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Test bildirimi gönder" }), "click", () => bildirimGoster("HavaStil test", "Uyarılar bu şekilde görünecek.")));
    } else if (b.izin === "denied") {
      ekle(izinKutu, el("p", { class: "hv-uyari", text: "Bildirim izni reddedilmiş. Tarayıcılar bunu bir daha sormaz; aşağıdaki adımlarla açabilirsin." }), izinYardimKarti("bildirim", { acik: true }));
    } else {
      ekle(izinKutu, el("p", { class: "hv-ipucu", text: "Uyarıların çalışması için tarayıcıdan bildirim izni gerekir. İzin yalnızca bu düğmeye basınca istenir." }),
        olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "🔔 Bildirimlere izin ver" }), "click", async () => { await izinIste(); izinCiz(); }),
        t.os === "ios" && !t.standalone ? izinYardimKarti("bildirim", { acik: true }) : null);
    }
  }
  const ekleBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "＋ Uyarı ekle" }), "click", () => { if (liste.length >= 8) return; liste.push(yeniUyari(liste.length ? "17:30" : "07:30")); kaydet(); });
  const uyariKart = kart("", bolumBasligi("⏰ Saat bazlı uyarılar"),
    ipucu("İstediğin saat ve günlerde o günün giyim önerisini (ya da yalnızca uyarı varsa uyarıyı) bildirim olarak alırsın."),
    uyariKutu, ekleBtn, sonrakiKutu, izinKutu,
    el("p", { class: "hv-uyari", text: "Dürüst not: Uyarılar HavaStil sekmesi/uygulaması açıkken (arka planda açık kalsa bile) saatinde çalışır. Tamamen kapalıyken tarayıcılar sunucusuz sitelerde bildirim gösteremez; bu durumda uygulamayı açtığında, 3 saat içindeyse “kaçırılan uyarı” olarak görürsün. Telefonda uygulamayı Ana Ekrana ekleyip arka planda açık tutmak güvenilirliği artırır." }));
  ciz();

  /* ---------- 2) Yapay zekâ ---------- */
  const taniKutu = el("div", { class: "hv-tani" });
  const aiKutu = el("input", { type: "checkbox", id: "hv-ai-modu2" }); aiKutu.checked = d.aiModu;
  olay(aiKutu, "change", () => kb.aiModu(aiKutu.checked));
  const taniBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🔧 Bağlantıyı test et" }), "click", async () => {
    taniBtn.disabled = true; taniKutu.replaceChildren(ipucu("Test ediliyor…"));
    const r = await kb.tani();
    taniBtn.disabled = false;
    doldur(taniKutu, ...(r.adimlar || []).map((a) => el("div", { class: `hv-tani-satir ${a.ok ? "ok" : "hata"}` }, el("span", { text: a.ok ? "✅" : "❌" }), el("div", {}, el("strong", { text: a.ad }), el("small", { class: "hv-ipucu", text: a.ayrinti })))), r.hata ? el("p", { class: "hv-uyari", text: r.hata }) : null);
  });
  const aiKart = kart("", bolumBasligi("✨ Yapay zekâ yorumu"),
    el("label", { class: "hv-onay", for: "hv-ai-modu2" }, aiKutu, el("span", { text: "Yapay zekâ destekli kısa yorum (Groq)" })),
    ipucu("Kapalıyken (varsayılan) hiçbir yapay zekâ isteği yapılmaz; kombin kararını zaten yerel CLO motoru verir. Açıkken yalnızca sıcaklık/rüzgâr gibi sayılar, kıyafet parçaları ve (varsa) doğrulanmış bir haber başlığı gönderilir; konum gönderilmez."),
    taniBtn, taniKutu);

  /* ---------- 3) Bulut ---------- */
  const bulutKutu = el("input", { type: "checkbox", id: "hv-bulut" }); bulutKutu.checked = d.bulut;
  const bulutDurum = el("p", { class: "hv-ipucu", id: "hv-bulut-durum" });
  olay(bulutKutu, "change", async () => { bulutDurum.textContent = ""; const m = await kb.bulutDegis(bulutKutu.checked); if (m) bulutDurum.textContent = m; bulutKutu.checked = d.bulut; });
  const bulutKart = kart("", bolumBasligi("☁️ Cihazlar arası senkron"),
    el("label", { class: "hv-onay", for: "hv-bulut" }, bulutKutu, el("span", { text: "Kayıtlı konumlarımı ve tercihlerimi hesabımda sakla" })),
    ipucu("Varsayılan KAPALI. Açarsan yalnızca ⭐ ile kaydettiğin konumlar (≈100 m'ye yuvarlanmış) ve tercihlerin hesabında tutulur; anlık GPS konumun ve aramaların asla kaydedilmez."), bulutDurum);

  /* ---------- 4) Haber doğrulama anahtarı ---------- */
  const haberKutu = el("input", { type: "checkbox", id: "hv-haber-acik" }); haberKutu.checked = d.haberAcik;
  olay(haberKutu, "change", () => kb.haberAcikDegis(haberKutu.checked));
  const haberKart = kart("", bolumBasligi("📰 Haber doğrulama"),
    el("label", { class: "hv-onay", for: "hv-haber-acik" }, haberKutu, el("span", { text: "Resmî uyarıları kontrol et ve kombine yansıt" })),
    ipucu("Bugünü ilgilendiren hava uyarılarını (fırtına, sağanak, don, çöl tozu…) arar. Konumun sunucuya gönderilmez; haberler herkese aynı havuzdan çekilir, yer süzmesi cihazında yapılır."));

  /* ---------- 5) Gizlilik ---------- */
  const gizlilik = kart("hv-gizlilik", bolumBasligi("🔒 Gizlilik ve KVKK"),
    el("p", { class: "hv-gizlilik-amac", text: "HavaStil'in tek amacı hava durumu ve günlük CLO (giysi yalıtımı) hesabıyla bugün ne giyeceğine karar vermene yardım etmektir. Konum toplamak amaç değildir; aşağıdaki her konum özelliği isteğe bağlıdır ve kapalı kalabilir." }),
    opsiyonel("📍", "Cihaz konumu (GPS)", "Kullanmazsan şehir adı yazman yeterli. Koordinat yalnızca hava servisine (Open-Meteo) gider; site sunucusuna ve hesabına kaydedilmez."),
    opsiyonel("⭐", "Konum kaydetme", "Kaydettiğin yerler varsayılan olarak yalnızca bu cihazda durur."),
    opsiyonel("☁️", "Hesapta saklama", "Varsayılan kapalı. Açarsan yalnızca kaydettiğin konumlar ≈100 m'ye yuvarlanarak tutulur."),
    opsiyonel("📰", "Haber doğrulama", "Kapatılabilir. Konum sunucuya gönderilmez."),
    opsiyonel("✨", "Yapay zekâ yorumu", "Varsayılan kapalı. Açılırsa konum değil, yalnızca sayılar ve kıyafet bilgisi gider."),
    el("a", { class: "hv-baglanti", href: "/kurumsal/kvkk-aydinlatma-metni.html#havastil", text: "KVKK Aydınlatma Metni — HavaStil bölümü →" }));

  /* ---------- 6) Teşhis ---------- */
  const tz = d.haber?.teshis;
  const teshis = el("details", { class: "hv-kart hv-kucuk hv-teshis" }, el("summary", { text: "🛠️ Teşhis (yalnızca sorun olursa)" }),
    el("p", { class: "hv-ipucu", text: `Hava verisi: ${d.hava ? `${zamanOnce(d.hava.alinma || Date.now())} alındı${d.hava.onbellek ? " (önbellek)" : ""}` : "yok"} · tarayıcı: ${tarayiciTespit().ad}/${tarayiciTespit().os}` }),
    tz ? el("div", {}, el("p", { class: "hv-ipucu", text: `Haber havuzu: ${d.haber.havuz === "tr" ? "Türkiye" : "Dünya"} · ${tz.havuzBoyutu} hava haberi · konum eşleşmesi: ${tz.yer}` }),
      el("ul", { class: "hv-liste" }, ...(tz.kaynaklar || []).map((k) => el("li", { text: `${k.ad} (${k.id}): ${k.durum === "ok" ? `çalışıyor — ${k.adet}/${k.toplam} haber hava ile ilgili` : k.durum === "bos" ? "boş yanıt" : `ulaşılamadı (${k.durum})`}` }))),
      el("p", { class: "hv-ipucu", text: `Ayıklanan: ${tz.elenen.clickbait} sansasyonel · ${tz.elenen.zaman} eski/gelecek · ${tz.elenen.konum} başka yer.` }))
      : ipucu("Haber verisi henüz yok."));

  return el("div", { class: "hv-sekme-govde" }, uyariKart, aiKart, haberKart, bulutKart, gizlilik, teshis);
}
