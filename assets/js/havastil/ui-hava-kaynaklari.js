/*
 * ui-hava-kaynaklari.js — HavaStil › Ayarlar › "Hava veri kaynakları"
 * HERKES  : resmî istasyon verisini aç/kapat · kendi OpenAQ anahtarını gir/sil (yalnızca bu hesap için geçerli; şifreli kasada) · kaynakları bu konumda test et.
 * YÖNETİCİ (Site Sahibi + Yönetici): sistem geneli kaynak sırası ve açık/kapalı, MGM'yi açma, istasyon yarıçapı ve tazeliği, "site anahtarı tanımlı" işareti,
 *   kullanıcıların kendi anahtarını girme izni. Site OpenAQ anahtarının kendisi burada TUTULMAZ: Worker secret'ı OPENAQ_API_KEY
 *   (tarayıcıya/veritabanına hiç girmez). Anahtarı değiştirmek: Cloudflare › Worker › Settings › Variables → OPENAQ_API_KEY → kaydet (kod yayını gerekmez);
 *   ardından aşağıdaki "Test et" ile doğrula. Sağlayıcıyı değiştirmek: kaynak sırası/anahtarlar bu kartta.
 * CSP: inline stil/işleyici yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { workerSaglik } from "./openmeteo.js";
import { hkAyar, hkAyarKaydet, hkTercihOku, hkTercihYaz, kendiOpenaqDurumu, kendiOpenaqKaydet, kendiOpenaqSil, kaynakTesti, SAGLAYICI_ADI, hkOnbellekSifirla } from "./hava-kaynak.js";

const GOZLEM_ACIKLAMA = {
  mgm: "Yalnızca Türkiye. Resmî ama herkese açık bir arayüzü olmayan bir uç nokta kullanır; kurumun koşullarını değerlendirip bilerek aç. Açmadan önce aşağıdaki testle değerleri mgm.gov.tr ile karşılaştır.",
  metar: "Dünya genelinde en yakın havalimanının resmî rasadı (ABD NOAA sunucusundan; anahtar gerekmez). Türkiye'de havalimanı rasatları Meteoroloji ve DHMİ kaynaklıdır.",
};

export function havaKaynaklariKarti(d, kb) {
  const kok = kart("hv-hvk-kart", bolumBasligi("📡 Hava veri kaynakları"));
  if (d.vitrin || d.misafir) { kok.append(ipucu("Giriş yaptığında resmî istasyon verilerini ve kendi OpenAQ anahtarını burada yönetebilirsin. Misafirlerde yalnızca model verisi (Open-Meteo / Copernicus CAMS) kullanılır.")); return kok; }

  kok.append(ipucu("Hava durumu ve hava kalitesi için HavaStil önce konumuna en yakın resmî ölçüm istasyonlarına bakar; bulamazsa ya da bir kaynak çalışmazsa kesintisiz olarak Open-Meteo / Copernicus CAMS modeline geçer. Tahmin motoru (kombin, yağış) her zaman modelden beslenir; istasyon verisi ölçümü ve hava kalitesini gösterir."));
  const durum = el("p", { class: "hv-ipucu", role: "status" });
  const tercihKutu = el("div", { class: "hv-cipblok" }), anahtarKutu = el("div", { class: "hv-cipblok" }), testKutu = el("div", { class: "hv-hvk-test" }), yonetimKutu = el("div");
  const mesaj = (m, hata = false) => { durum.textContent = m; durum.classList.toggle("hv-uyari", hata); };
  let ayar = null;

  /* ---------- herkes: resmî istasyon tercihi ---------- */
  function tercihCiz() {
    const t = hkTercihOku();
    const kutu = el("input", { type: "checkbox" }); kutu.checked = t.istasyon;
    olay(kutu, "change", () => { hkTercihYaz({ istasyon: kutu.checked }); mesaj(kutu.checked ? "Resmî istasyon verisi açık. Verileri yenileyince uygulanır." : "Resmî istasyon verisi kapalı; yalnızca model kullanılacak. Verileri yenileyince uygulanır."); });
    tercihKutu.replaceChildren(el("label", { class: "hv-onay" }, kutu, el("span", {}, el("strong", { text: "Resmî ölçüm istasyonlarını kullan" }), el("br"), el("small", { class: "muted", text: "Bu cihazda geçerlidir. Kapatırsan yalnızca model tahmini gösterilir." }))));
  }

  /* ---------- herkes: kendi OpenAQ anahtarım ---------- */
  async function anahtarCiz() {
    const [k, a] = await Promise.all([kendiOpenaqDurumu(true), hkAyar()]);
    const izin = a.kendi_anahtar_izni !== false;
    const alan = el("input", { type: "password", class: "hv-girdi", placeholder: "OpenAQ API anahtarı", autocomplete: "off", spellcheck: "false", "aria-label": "OpenAQ API anahtarı" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: k.var ? "Anahtarı değiştir" : "Anahtarı kaydet" }), "click", async () => {
      kaydet.disabled = true;
      try { await kendiOpenaqKaydet(alan.value); alan.value = ""; mesaj("Kendi OpenAQ anahtarın şifreli olarak kaydedildi; yalnızca senin hesabında kullanılacak."); await anahtarCiz(); }
      catch (h) { mesaj(h.message, true); } finally { kaydet.disabled = false; }
    });
    const sil = k.var ? olay(el("button", { type: "button", class: "hv-btn hv-btn-tehlike hv-btn-ince", text: "Anahtarımı sil" }), "click", async () => {
      try { await kendiOpenaqSil(); mesaj("Anahtarın silindi; sistemin varsayılan kaynağı kullanılacak."); await anahtarCiz(); } catch (h) { mesaj(h.message, true); }
    }) : null;
    anahtarKutu.replaceChildren(
      el("h3", { text: "Kendi OpenAQ anahtarım" }),
      el("p", { class: "hv-ipucu", text: k.var
        ? (k.kilitli ? "Kayıtlı anahtarın var ama anahtar kasan şu an kilitli. Kasayı Yapay zekâ bölümünden aç; sonra anahtarın otomatik devreye girer." : "Kendi anahtarın devrede: hava kalitesi istasyonları senin anahtarınla sorgulanır (yalnızca bu hesap için).")
        : (a.openaq_site_anahtari_tanimli ? "Anahtar girmezsen sitenin ortak anahtarı kullanılır. İstersen openaq.org'dan ücretsiz kendi anahtarını alıp girebilirsin; o zaman yalnızca senin için o kullanılır." : "Resmî hava kalitesi istasyonları için ücretsiz bir OpenAQ anahtarı gerekir. Site anahtarı tanımlı değil; openaq.org'da ücretsiz hesap açıp anahtarını buraya girebilirsin. Girmezsen model verisi kullanılır.") }),
      izin ? el("div", { class: "hv-btn-satir" }, alan, kaydet, sil) : el("p", { class: "hv-uyari", text: "Site yöneticisi kişisel anahtar girişini kapatmış." }),
      el("a", { class: "hv-baglanti", href: "https://explore.openaq.org/register", target: "_blank", rel: "noopener noreferrer", text: "Ücretsiz OpenAQ anahtarı al ↗" }));
  }

  /* ---------- herkes: kaynak testi ---------- */
  const testDugme = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Kaynakları bu konumda test et" }), "click", async () => {
    testDugme.disabled = true; testDugme.textContent = "Test ediliyor…"; testKutu.replaceChildren();
    try {
      const rows = await kaynakTesti(d.konum);
      testKutu.replaceChildren(...rows.map((r) => el("div", { class: `satir ${r.durum === "ok" ? "ok" : r.durum === "hata" ? "hata" : ""}` },
        el("span", { "aria-hidden": "true", text: r.durum === "ok" ? "✅" : r.durum === "hata" ? "❌" : "⏭️" }),
        el("div", {}, el("strong", { text: r.ad }), el("small", { text: `${r.durum === "ok" ? "Çalışıyor" : r.durum === "hata" ? "Çalışmadı" : "Atlandı"}${r.ms ? ` · ${r.ms} ms` : ""} — ${r.ayrinti}` })))));
    } catch (h) { mesaj(`Test yapılamadı: ${h.message}`, true); }
    finally { testDugme.disabled = false; testDugme.textContent = "Kaynakları bu konumda test et"; }
  });

  /* ---------- yönetici ---------- */
  async function yonetimCiz() {
    let yonetici = false;
    try { const [{ data: a }, { data: o }] = await Promise.all([supabase.rpc("is_admin"), supabase.rpc("is_owner")]); yonetici = !!(a || o); } catch { /* yok say */ }
    if (!yonetici) return;
    ayar = await hkAyar(true);
    const saglik = await workerSaglik();
    const sira = [...ayar.gozlem_sira], acik = { ...ayar.gozlem_acik };
    for (const id of ["mgm", "metar"]) if (!sira.includes(id)) sira.push(id);
    const liste = el("ol", { class: "hv-hvk-zincir" });
    const cizSira = () => liste.replaceChildren(...sira.map((id, i) => {
      const cb = el("input", { type: "checkbox", "aria-label": `${SAGLAYICI_ADI[id]} açık` }); cb.checked = !!acik[id];
      olay(cb, "change", () => { acik[id] = cb.checked; cizSira(); });
      const yukari = olay(el("button", { type: "button", class: "hv-hvk-mini", "aria-label": "Yukarı taşı", text: "↑" }), "click", () => { [sira[i - 1], sira[i]] = [sira[i], sira[i - 1]]; cizSira(); });
      const asagi = olay(el("button", { type: "button", class: "hv-hvk-mini", "aria-label": "Aşağı taşı", text: "↓" }), "click", () => { [sira[i + 1], sira[i]] = [sira[i], sira[i + 1]]; cizSira(); });
      yukari.disabled = i === 0; asagi.disabled = i === sira.length - 1;
      return el("li", { class: `hv-hvk-satir${acik[id] ? "" : " kapali"}` }, el("div", {}, el("strong", { text: `${i + 1}. ${SAGLAYICI_ADI[id]}` }), el("small", { text: GOZLEM_ACIKLAMA[id] })),
        el("div", { class: "hv-hvk-kontrol" }, el("label", { class: "hv-onay" }, cb, el("span", { text: acik[id] ? "Açık" : "Kapalı" })), yukari, asagi));
    }));
    cizSira();
    const cek = (aciklama, ok) => { const c = el("input", { type: "checkbox" }); c.checked = ok; return [c, el("label", { class: "hv-onay" }, c, el("span", { text: aciklama }))]; };
    const [qCek, qEt] = cek("Hava kalitesi için resmî istasyonları (OpenAQ) kullan", ayar.kalite_istasyon_acik);
    const [sCek, sEt] = cek(`Site OpenAQ anahtarı Worker'da tanımlı${saglik ? (saglik.openaq_anahtari_var ? " (Worker'da bulundu ✓)" : " (Worker'da BULUNAMADI — secret eklenmemiş)") : " (Worker'a ulaşılamadı)"}`, ayar.openaq_site_anahtari_tanimli);
    const [kCek, kEt] = cek("Kullanıcılar kendi OpenAQ anahtarını girebilsin", ayar.kendi_anahtar_izni !== false);
    const yar = el("input", { type: "number", min: "1", max: "25", step: "1", class: "hv-girdi", value: String(ayar.yaricap_km), "aria-label": "İstasyon yarıçapı (km)" });
    const taze = el("input", { type: "number", min: "30", max: "1440", step: "10", class: "hv-girdi", value: String(ayar.tazelik_dk), "aria-label": "En eski ölçüm yaşı (dakika)" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: "Sistem ayarlarını kaydet" }), "click", async () => {
      kaydet.disabled = true;
      try {
        await hkAyarKaydet({ gozlem_sira: sira, gozlem_acik: acik, kalite_istasyon_acik: qCek.checked, openaq_site_anahtari_tanimli: sCek.checked, kendi_anahtar_izni: kCek.checked, yaricap_km: Math.round(Number(yar.value)), tazelik_dk: Math.round(Number(taze.value)), aciklama: null });
        mesaj("Sistem ayarları kaydedildi; tüm kullanıcılar için bir sonraki veri yenilemesinde geçerli olur."); await anahtarCiz();
      } catch (h) { mesaj(h.message, true); } finally { kaydet.disabled = false; }
    });
    yonetimKutu.replaceChildren(el("h3", { text: "Site sahibi / yönetici ayarları" }),
      ...(ayar.migrasyonYok ? [el("p", { class: "hv-uyari", text: "Sistem ayar tablosu kurulu değil: Supabase'de 0146_hava_kaynaklari.sql çalıştır. O zamana kadar varsayılanlar geçerli ve değişiklik kaydedilemez." })] : []),
      el("p", { class: "hv-ipucu", text: "Gözlem kaynakları üstten alta denenir; ilk çalışan kullanılır, hiçbiri çalışmazsa model değerleri gösterilir." }), liste,
      el("div", { class: "hv-hvk-alan" }, qEt, sEt, kEt),
      el("div", { class: "hv-hvk-iki" }, el("label", { class: "hv-hvk-alan" }, el("span", { class: "muted", text: "İstasyon yarıçapı (km, en çok 25)" }), yar), el("label", { class: "hv-hvk-alan" }, el("span", { class: "muted", text: "En eski ölçüm (dakika)" }), taze)),
      kaydet,
      el("details", { class: "hv-yardim-blok" }, el("summary", { text: "Site anahtarını nasıl değiştiririm?" }),
        el("ol", { class: "hv-liste" },
          el("li", { text: "openaq.org'dan (ücretsiz) yeni anahtar al — ücretli plana geçmen gerekirse aynı yerden." }),
          el("li", { text: "Cloudflare › Workers › havastil-worker › Settings › Variables and Secrets › OPENAQ_API_KEY değerini yenisiyle değiştir." }),
          el("li", { text: "Bu karttaki “Kaynakları bu konumda test et” ile doğrula. Kod yayını gerekmez." }),
          el("li", { text: "Başka bir sağlayıcıya geçiş: ilgili kaynağı yukarıdan kapat, yeni sağlayıcı kodu eklenene kadar model devrede kalır." })),
        el("p", { class: "hv-ipucu", text: "Anahtar bilerek tarayıcıdan ve veritabanından uzak tutulur; böylece sayfayı açan hiç kimse ve yedekler anahtarı göremez." })));
  }

  kok.append(durum, tercihKutu, anahtarKutu, el("h3", { text: "Bağlantı testi" }), el("p", { class: "hv-ipucu", text: "Her kaynağı seçili konum için dener; hangisinin çalıştığını ve ne kadar sürede yanıtladığını gösterir." }), testDugme, testKutu, yonetimKutu);
  tercihCiz();
  anahtarCiz().catch((h) => mesaj(`Anahtar durumu okunamadı: ${h.message}`, true));
  yonetimCiz().catch(() => { /* yönetici değilse sessiz */ });
  void kb; void hkOnbellekSifirla;
  return kok;
}
