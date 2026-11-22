/*
 * ui-hava-kaynaklari.js — HavaStil › Ayarlar › "Veri kaynakları"
 * Herkes için, sade dille: HavaStil verileri nereden alır, resmî ölçümler açık mı, kendi (isteğe bağlı) hava kalitesi anahtarım, kaynakları test et.
 * Site sahibi / yönetici için: kaynak sırası, doğrulama ve düzeltme, hava kalitesi istasyonları, SİTE ANAHTARINI arayüzden girme.
 *
 * Tüm aç/kapat düğmeleri "Yetki Ayarları"ndaki gibi SÜRGÜLÜdür (ui-surgu.js): kırmızı kapalı, yeşil açık, yanında yazıyla "Açık/Kapalı".
 * Sistem ayarları değiştirildiği anda kaydedilir; kaydedilemezse düğme eski konumuna döner ve nedeni yazılır (yanlışlıkla "açık" sanılmasın).
 *
 * SİTE ANAHTARI GÜVENLİĞİ: yönetici anahtarı yazar → yalnızca HTTPS ile Cloudflare Worker'a gider → Worker anahtarı OpenAQ'da dener, AES-256-GCM ile
 * şifreler ve yalnızca şifreli hâli Supabase'e yazar (migration 0147). Çözme anahtarı Worker secret'ı HAVA_ANAHTAR_SIFRESI'dedir; tarayıcıya ya da
 * veritabanı yedeklerine girmez. Arayüz anahtarı bir daha GÖSTERMEZ (yalnızca son 4 karakter). CSP: inline stil/işleyici yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { surgu } from "./ui-surgu.js";
import { workerSaglik } from "./openmeteo.js";
import { hkAyar, hkAyarKaydet, hkTercihOku, hkTercihYaz, kendiOpenaqDurumu, kendiOpenaqKaydet, kendiOpenaqSil, kaynakTesti, siteAnahtarDurumu, siteAnahtarKaydet, siteAnahtarSil, SAGLAYICI_ADI, hkOnbellekSifirla } from "./hava-kaynak.js";

const KAYNAK_BILGI = {
  mgm: { ad: "Meteoroloji Genel Müdürlüğü (MGM)", aciklama: "Türkiye'de ilçene en yakın MGM istasyonunun resmî ölçümü (sıcaklık, nem, rüzgâr, basınç, yağış). Yalnızca Türkiye'de çalışır. MGM'nin herkese açık, belgelenmiş bir arayüzü yok; bu yüzden önce aşağıdaki testle değerlerini mgm.gov.tr ile karşılaştır, sonra aç." },
  metar: { ad: "Havalimanı resmî hava raporu", aciklama: "Dünyanın her yerinde en yakın havalimanının resmî hava raporu (METAR). Anahtar gerekmez. MGM ölçümü yoksa ya da Türkiye dışındaysan devreye girer." },
};
const tarihYaz = (iso) => { try { return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

export function havaKaynaklariKarti(d, kb) {
  const kok = kart("hv-hvk-kart", bolumBasligi("📡 Veri kaynakları"));
  if (d.vitrin || d.misafir) { kok.append(ipucu("Giriş yaptığında resmî ölçümleri ve kendi hava kalitesi anahtarını burada yönetebilirsin. Misafirlerde yalnızca tahmin modeli (Open-Meteo / Copernicus) kullanılır.")); return kok; }

  const durum = el("p", { class: "hv-hvk-durum", role: "status", "aria-live": "polite" });
  const mesaj = (m, hata = false) => { durum.textContent = m; durum.classList.toggle("hata", hata); durum.classList.toggle("basari", !hata && !!m); };
  const bolum = (baslik, ...cocuklar) => el("section", { class: "hv-hvk-bolum" }, el("h3", { class: "hv-hvk-baslik", text: baslik }), ...cocuklar);

  kok.append(
    el("p", { class: "hv-hvk-giris", text: "HavaStil verileri iki türlü kaynaktan alır: gerçekten ölçülmüş resmî veriler (Meteoroloji, havalimanları, hava kalitesi istasyonları) ve her yerde çalışan bilgisayar tahmin modeli (Open-Meteo / Copernicus). Resmî ölçüm varsa önce o gösterilir ve tahmin onunla karşılaştırılır; yoksa kesintisiz olarak modele geçilir." }),
    durum);

  /* ============================ HERKES İÇİN ============================ */
  const herkes = bolum("Senin için");
  const tercih = hkTercihOku();
  herkes.append(surgu({
    ad: "Resmî ölçümleri kullan", acik: tercih.istasyon, simge: "🏛️",
    aciklama: "Açıkken HavaStil, konumuna en yakın resmî ölçüm kaynaklarına bakar ve tahmini onlarla karşılaştırır. Kapalıyken yalnızca tahmin modeli gösterilir. Bu ayar yalnızca bu cihazda geçerlidir.",
    onDegis: (v) => { hkTercihYaz({ istasyon: v }); mesaj(v ? "Açıldı. Verileri yenileyince (↻) uygulanır." : "Kapatıldı. Verileri yenileyince (↻) yalnızca tahmin modeli gösterilir."); },
  }).kok);

  const anahtarKutu = el("div", { class: "hv-hvk-alt" });
  async function anahtarCiz() {
    const [k, a] = await Promise.all([kendiOpenaqDurumu(true), hkAyar()]);
    const alan = el("input", { type: "password", class: "hv-girdi", placeholder: "Anahtarını buraya yapıştır", autocomplete: "off", spellcheck: "false", "aria-label": "Kişisel hava kalitesi anahtarı" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: k.var ? "Anahtarı değiştir" : "Anahtarı kaydet" }), "click", async () => {
      kaydet.disabled = true;
      try { await kendiOpenaqKaydet(alan.value); alan.value = ""; mesaj("Anahtarın şifreli olarak kaydedildi; yalnızca senin hesabında kullanılacak."); await anahtarCiz(); }
      catch (h) { mesaj(h.message, true); } finally { kaydet.disabled = false; }
    });
    const sil = k.var ? olay(el("button", { type: "button", class: "hv-btn hv-btn-tehlike hv-btn-ince", text: "Anahtarımı sil" }), "click", async () => {
      try { await kendiOpenaqSil(); mesaj("Anahtarın silindi; sitenin ortak anahtarı (varsa) kullanılacak."); await anahtarCiz(); } catch (h) { mesaj(h.message, true); }
    }) : null;
    const izin = a.kendi_anahtar_izni !== false;
    anahtarKutu.replaceChildren(
      el("h4", { class: "hv-hvk-alt-baslik", text: "Kendi hava kalitesi anahtarım (isteğe bağlı)" }),
      el("p", { class: "hv-ipucu", text: k.var
        ? (k.kilitli ? "Kayıtlı bir anahtarın var ama anahtar kasan şu an kilitli. Yapay zekâ bölümünden kasayı aç; anahtarın otomatik devreye girer." : "Kendi anahtarın devrede: hava kalitesi istasyonları senin anahtarınla sorgulanır. Bu yalnızca senin hesabın için geçerlidir; başkalarını etkilemez.")
        : (a.openaq_site_anahtari_tanimli ? "Şu an sitenin ortak anahtarı kullanılıyor; yapman gereken bir şey yok. İstersen openaq.org'dan ücretsiz kendi anahtarını alıp buraya girebilirsin; o zaman yalnızca senin için o kullanılır." : "Hava kalitesinin resmî istasyonlardan gelmesi için ücretsiz bir OpenAQ anahtarı gerekir. Sitenin ortak anahtarı tanımlı değil; openaq.org'da ücretsiz hesap açıp anahtarını buraya girebilirsin. Girmezsen hava kalitesi tahmin modelinden gösterilir.") }),
      izin ? el("div", { class: "hv-btn-satir" }, alan, kaydet, sil) : el("p", { class: "hv-uyari", text: "Site yöneticisi kişisel anahtar girişini kapatmış." }),
      el("a", { class: "hv-baglanti", href: "https://explore.openaq.org/register", target: "_blank", rel: "noopener noreferrer", text: "Ücretsiz anahtar al (openaq.org) ↗" }));
  }
  herkes.append(anahtarKutu);

  const testKutu = el("div", { class: "hv-hvk-test" });
  const testDugme = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Kaynakları şu konumda test et" }), "click", async () => {
    testDugme.disabled = true; testDugme.textContent = "Test ediliyor…"; testKutu.replaceChildren();
    try {
      const rows = await kaynakTesti(d.konum);
      testKutu.replaceChildren(...rows.map((r) => el("div", { class: `satir ${r.durum === "ok" ? "ok" : r.durum === "hata" ? "hata" : ""}` },
        el("span", { "aria-hidden": "true", text: r.durum === "ok" ? "✅" : r.durum === "hata" ? "❌" : "⏭️" }),
        el("div", {}, el("strong", { text: r.ad }), el("small", { text: `${r.durum === "ok" ? "Çalışıyor" : r.durum === "hata" ? "Çalışmadı" : "Atlandı"}${r.ms ? ` · ${r.ms} ms` : ""} — ${r.ayrinti}` })))));
    } catch (h) { mesaj(`Test yapılamadı: ${h.message}`, true); }
    finally { testDugme.disabled = false; testDugme.textContent = "Kaynakları şu konumda test et"; }
  });
  herkes.append(el("div", { class: "hv-hvk-alt" }, el("h4", { class: "hv-hvk-alt-baslik", text: "Bağlantı testi" }), el("p", { class: "hv-ipucu", text: "Seçili konum için her kaynağı dener; hangisinin çalıştığını ve ne kadar sürede yanıt verdiğini gösterir." }), testDugme, testKutu));
  kok.append(herkes);

  /* ============================ SİTE SAHİBİ / YÖNETİCİ ============================ */
  const yonetimKutu = el("div");
  kok.append(yonetimKutu);
  async function yonetimCiz() {
    let yonetici = false;
    try { const [{ data: a }, { data: o }] = await Promise.all([supabase.rpc("is_admin"), supabase.rpc("is_owner")]); yonetici = !!(a || o); } catch { /* yok say */ }
    if (!yonetici) return;
    let ayar = await hkAyar(true);
    const [saglik, anahtarDurum] = await Promise.all([workerSaglik(), siteAnahtarDurumu()]);
    /** Tek noktadan kaydet: değişikliği uygular, başarısızsa hata fırlatır (düğme eski konumuna döner). */
    const degistir = async (mut, onay) => {
      const yeni = { ...ayar, gozlem_acik: { ...ayar.gozlem_acik }, gozlem_sira: [...ayar.gozlem_sira] }; mut(yeni);
      try { await hkAyarKaydet(yeni); ayar = await hkAyar(true); mesaj(`${onay || "Kaydedildi."} Tüm kullanıcılar için bir sonraki veri yenilemesinde geçerli olur.`); }
      catch (h) { mesaj(`Kaydedilemedi: ${h.message}`, true); throw h; }
    };
    const kutu = el("div", { class: "hv-hvk-yonetim" });
    const migrasyonUyari = ayar.migrasyonYok ? el("p", { class: "hv-uyari", text: "Sistem ayar tablosu kurulu değil: Supabase'de 0146 ve 0147 numaralı hava kaynağı SQL dosyalarını çalıştır. O zamana kadar varsayılanlar geçerlidir ve değişiklik kaydedilemez." }) : null;

    /* --- 1) resmî ölçüm kaynakları + sıra --- */
    const liste = el("ol", { class: "hv-hvk-zincir" });
    const cizSira = () => liste.replaceChildren(...ayar.gozlem_sira.map((id, i) => {
      const s = surgu({ ad: KAYNAK_BILGI[id].ad, aciklama: KAYNAK_BILGI[id].aciklama, acik: !!ayar.gozlem_acik[id], simge: id === "mgm" ? "🏛️" : "✈️", onDegis: (v) => degistir((y) => { y.gozlem_acik[id] = v; }, `${KAYNAK_BILGI[id].ad} ${v ? "açıldı" : "kapatıldı"}.`) });
      const tasi = (yon) => olay(el("button", { type: "button", class: "hv-hvk-mini", "aria-label": yon < 0 ? `${KAYNAK_BILGI[id].ad}: daha önce dene` : `${KAYNAK_BILGI[id].ad}: daha sonra dene`, text: yon < 0 ? "↑ Önce dene" : "↓ Sonra dene" }), "click", async () => {
        try { await degistir((y) => { const j = i + yon; [y.gozlem_sira[i], y.gozlem_sira[j]] = [y.gozlem_sira[j], y.gozlem_sira[i]]; }, "Deneme sırası değişti."); cizSira(); } catch { /* mesaj yazıldı */ }
      });
      const yukari = tasi(-1), asagi = tasi(1); yukari.disabled = i === 0; asagi.disabled = i === ayar.gozlem_sira.length - 1;
      return el("li", { class: "hv-hvk-satir" }, el("span", { class: "hv-hvk-sira", "aria-label": `${i + 1}. sırada denenir`, text: String(i + 1) }), el("div", { class: "hv-hvk-satir-ic" }, s.kok, el("div", { class: "hv-hvk-sirabtn" }, yukari, asagi)));
    }));
    cizSira();

    /* --- 2) doğrulama ve düzeltme --- */
    const dogrulamaSurgu = surgu({ ad: "Ölçümle tahmini karşılaştır", simge: "🔍", acik: ayar.dogrulama_acik !== false,
      aciklama: "Resmî ölçüm ile tahmin yan yana gösterilir ve aradaki fark yazılır. Kapatırsan resmî ölçüm yalnızca değerleriyle görünür.",
      onDegis: (v) => degistir((y) => { y.dogrulama_acik = v; }, `Karşılaştırma ${v ? "açıldı" : "kapatıldı"}.`) });
    const duzeltmeSurgu = surgu({ ad: "Ölçüme göre sıcaklığı düzelt", simge: "🛠️", acik: ayar.duzeltme_acik !== false,
      aciklama: "Ölçüm taze ve yakınsa, önümüzdeki birkaç saatin sıcaklığı ölçüme doğru en çok ±4° kaydırılır; kombin ve yağış kararı gerçeğe daha yakın olur. Ölçüm şu an yağış gösteriyorsa şemsiye önerisi de buna uyar. Kapalıyken ölçüm yalnızca gösterilir." ,
      onDegis: (v) => degistir((y) => { y.duzeltme_acik = v; }, `Ölçüme göre düzeltme ${v ? "açıldı" : "kapatıldı"}.`) });
    const saatGirdi = el("input", { type: "number", min: "1", max: "6", step: "1", class: "hv-girdi", value: String(ayar.duzeltme_saat || 3), "aria-label": "Düzeltmenin sönümlendiği süre (saat)" });
    olay(saatGirdi, "change", () => degistir((y) => { y.duzeltme_saat = Math.min(6, Math.max(1, Math.round(Number(saatGirdi.value) || 3))); }, "Düzeltme süresi kaydedildi.").catch(() => { saatGirdi.value = String(ayar.duzeltme_saat || 3); }));

    /* --- 3) hava kalitesi istasyonları --- */
    const kaliteSurgu = surgu({ ad: "Hava kalitesi için resmî istasyonlar", simge: "🌬️", acik: !!ayar.kalite_istasyon_acik,
      aciklama: "Hava kalitesini (toz, ozon, azot gazı…) konuma en yakın resmî ölçüm istasyonundan alır. Kapalıysa ya da istasyon yoksa tahmin modeli kullanılır.",
      onDegis: (v) => degistir((y) => { y.kalite_istasyon_acik = v; }, `Hava kalitesi istasyonları ${v ? "açıldı" : "kapatıldı"}.`) });
    const kendiSurgu = surgu({ ad: "Kullanıcılar kendi anahtarını girebilsin", simge: "🔑", acik: ayar.kendi_anahtar_izni !== false,
      aciklama: "Açıkken her kullanıcı kendi ücretsiz OpenAQ anahtarını girebilir; girdiği anahtar yalnızca onun için kullanılır. Girmeyenler sitenin ortak anahtarını kullanır.",
      onDegis: (v) => degistir((y) => { y.kendi_anahtar_izni = v; }, `Kişisel anahtar girişi ${v ? "açıldı" : "kapatıldı"}.`) });
    const yar = el("input", { type: "number", min: "1", max: "25", step: "1", class: "hv-girdi", value: String(ayar.yaricap_km), "aria-label": "İstasyon arama yarıçapı (km)" });
    const taze = el("input", { type: "number", min: "30", max: "1440", step: "10", class: "hv-girdi", value: String(ayar.tazelik_dk), "aria-label": "Ölçümün en çok kaç dakika eski olabileceği" });
    olay(yar, "change", () => degistir((y) => { y.yaricap_km = Math.min(25, Math.max(1, Math.round(Number(yar.value) || 25))); }, "Arama yarıçapı kaydedildi.").catch(() => { yar.value = String(ayar.yaricap_km); }));
    olay(taze, "change", () => degistir((y) => { y.tazelik_dk = Math.min(1440, Math.max(30, Math.round(Number(taze.value) || 180))); }, "Ölçüm yaşı sınırı kaydedildi.").catch(() => { taze.value = String(ayar.tazelik_dk); }));

    /* --- 4) site anahtarı --- */
    const anahtarAlani = el("div", { class: "hv-hvk-anahtar" });
    const sifreVar = saglik?.anahtar_sifresi_var === true, envVar = saglik?.openaq_anahtari_var === true;
    async function siteAnahtarCiz() {
      const d2 = await siteAnahtarDurumu();
      const girdi = el("input", { type: "password", class: "hv-girdi", placeholder: "Site OpenAQ anahtarı", autocomplete: "new-password", spellcheck: "false", "aria-label": "Site OpenAQ anahtarı", disabled: !sifreVar });
      const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: d2.var ? "Doğrula ve değiştir" : "Doğrula ve kaydet", disabled: !sifreVar }), "click", async () => {
        kaydet.disabled = true; kaydet.textContent = "Doğrulanıyor…";
        try { const j = await siteAnahtarKaydet(girdi.value); girdi.value = ""; mesaj(`Site anahtarı OpenAQ'da doğrulandı ve şifreli kaydedildi (…${j.son4 || ""}). Bu sayfa anahtarı bir daha göstermez.`); ayar = await hkAyar(true); await siteAnahtarCiz(); }
        catch (h) { mesaj(h.message, true); kaydet.disabled = false; kaydet.textContent = d2.var ? "Doğrula ve değiştir" : "Doğrula ve kaydet"; }
      });
      const sil = d2.var ? olay(el("button", { type: "button", class: "hv-btn hv-btn-tehlike hv-btn-ince", text: "Site anahtarını sil" }), "click", async () => {
        if (!window.confirm("Site anahtarı silinsin mi? Kullanıcılar kendi anahtarını girmediyse hava kalitesi tahmin modeline döner.")) return;
        try { const j = await siteAnahtarSil(); mesaj(j.env_anahtari_var ? "Kayıtlı anahtar silindi; Worker'daki OPENAQ_API_KEY secret'ı devrede kalır." : "Site anahtarı silindi."); ayar = await hkAyar(true); await siteAnahtarCiz(); } catch (h) { mesaj(h.message, true); }
      }) : null;
      const rozet = d2.var ? el("p", { class: "hv-hvk-anahtar-durum var" }, el("span", { "aria-hidden": "true", text: "🔒" }), el("span", { text: ` Kayıtlı ve şifreli · …${d2.son4 || "****"}${d2.guncelleme ? ` · ${tarihYaz(d2.guncelleme)}` : ""}` }))
        : envVar ? el("p", { class: "hv-hvk-anahtar-durum var" }, el("span", { "aria-hidden": "true", text: "🔒" }), el("span", { text: " Worker secret'ı olarak tanımlı (OPENAQ_API_KEY). Buradan yeni anahtar girersen o öncelikli olur." }))
          : el("p", { class: "hv-hvk-anahtar-durum yok" }, el("span", { "aria-hidden": "true", text: "⚠️" }), el("span", { text: " Site anahtarı tanımlı değil; kendi anahtarı olmayan kullanıcılar için hava kalitesi tahmin modelinden gelir." }));
      anahtarAlani.replaceChildren(
        el("h4", { class: "hv-hvk-alt-baslik", text: "Site anahtarı (OpenAQ — hava kalitesi istasyonları)" }), rozet,
        ...(d2.hata ? [el("p", { class: "hv-uyari", text: d2.hata })] : []),
        ...(!sifreVar ? [el("div", { class: "hv-uyari" },
          el("strong", { text: saglik ? "Arayüzden anahtar girmek için bir kez Worker'a şifreleme sırrı eklemelisin." : "Worker'a ulaşılamadı; anahtar girişi şu an kapalı." }),
          el("ol", { class: "hv-liste" },
            el("li", { text: "Cloudflare › Workers › havastil-worker › Settings › Variables and Secrets › Add → Type: Secret." }),
            el("li", { text: "Ad: HAVA_ANAHTAR_SIFRESI · Değer: en az 32 rastgele karakter (şifre yöneticinde üret). Bir kez belirle ve DEĞİŞTİRME." }),
            el("li", { text: "Deploy et, bu sayfayı yenile; anahtar kutusu açılır. (Worker kodu güncel değilse önce yeni worker.js'i yayınla.)" })))] : []),
        el("div", { class: "hv-btn-satir" }, girdi, kaydet, sil),
        el("details", { class: "hv-yardim-blok" }, el("summary", { text: "Anahtar nasıl saklanıyor? (güvenlik)" }),
          el("ul", { class: "hv-liste" },
            el("li", { text: "Yazdığın anahtar yalnızca HTTPS ile Cloudflare Worker'a gider. Worker önce OpenAQ'da dener (yanlışsa kaydetmez), sonra AES-256-GCM ile şifreler ve yalnızca şifreli hâlini veritabanına yazar." }),
            el("li", { text: "Şifreyi çözecek sır yalnızca Worker'dadır. Tarayıcı, veritabanı yöneticisi ve yedekler anahtarı okuyamaz; bu sayfa da bir daha göstermez, yalnızca son 4 karakteri yazar." }),
            el("li", { text: "Anahtarı değiştirmek için yenisini yazıp “Doğrula ve değiştir”e bas. Sağlayıcıyı değiştirmek için ilgili kaynağı yukarıdan kapat; yeni sağlayıcı eklenene kadar tahmin modeli devrede kalır." }),
            el("li", { text: "Anahtar önceliği: kullanıcının kendi anahtarı → burada girilen site anahtarı → Worker'daki OPENAQ_API_KEY secret'ı → tahmin modeli." }))));
    }
    siteAnahtarCiz().catch((h) => mesaj(`Site anahtarı durumu okunamadı: ${h.message}`, true));
    void anahtarDurum;

    kutu.append(
      el("h3", { class: "hv-hvk-baslik yonetim", text: "Site sahibi ve yöneticiler için" }),
      el("p", { class: "hv-ipucu", text: "Bu bölümü yalnızca Site Sahibi ve yetkili Yöneticiler görür. Buradaki her düğme, değiştirdiğin anda tüm kullanıcılar için kaydedilir." }),
      ...(migrasyonUyari ? [migrasyonUyari] : []),
      el("div", { class: "hv-hvk-blok" }, el("h4", { class: "hv-hvk-alt-baslik", text: "Resmî ölçüm kaynakları" }), el("p", { class: "hv-ipucu", text: "Sıra yukarıdan aşağıya denenir; ilk çalışan kaynak kullanılır. Hiçbiri çalışmazsa tahmin modeli gösterilir." }), liste),
      el("div", { class: "hv-hvk-blok" }, el("h4", { class: "hv-hvk-alt-baslik", text: "Doğrulama ve düzeltme" }), dogrulamaSurgu.kok, duzeltmeSurgu.kok,
        el("label", { class: "hv-hvk-alan" }, el("span", { class: "muted", text: "Düzeltmenin sönümlendiği süre (saat, 1–6)" }), saatGirdi)),
      el("div", { class: "hv-hvk-blok" }, el("h4", { class: "hv-hvk-alt-baslik", text: "Hava kalitesi istasyonları" }), kaliteSurgu.kok, kendiSurgu.kok,
        el("div", { class: "hv-hvk-iki" },
          el("label", { class: "hv-hvk-alan" }, el("span", { class: "muted", text: "Arama yarıçapı (km, en çok 25)" }), yar),
          el("label", { class: "hv-hvk-alan" }, el("span", { class: "muted", text: "Ölçüm en çok kaç dakika eski olabilir" }), taze))),
      el("div", { class: "hv-hvk-blok" }, anahtarAlani));
    yonetimKutu.replaceChildren(kutu);
  }
  yonetimCiz().catch(() => { /* yönetici değilse sessiz */ });
  anahtarCiz().catch((h) => mesaj(`Anahtar durumu okunamadı: ${h.message}`, true));
  void kb; void hkOnbellekSifirla; void SAGLAYICI_ADI;
  return kok;
}
