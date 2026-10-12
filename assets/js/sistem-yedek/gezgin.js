/*
 * assets/js/sistem-yedek/gezgin.js — Depolama Gezgini (yalnızca Site Sahibi).  Migration 0081 + sistem-yedek-worker v2.
 * -----------------------------------------------------------------------
 *  • Veritabanı: her tablo için GERÇEK satır sayısı + boyut; seçmeli/toplu analiz; seçilenleri silme.
 *  • R2: kova → klasör → nesne gezgini; her nesnenin veritabanında kaydı var mı (kayıtlı / yetim) görünür.
 *  • KORUMA KİLİDİ: sitenin çalışması için zorunlu tablolar (ve tüm sistem şemaları) ile bilinen biçime uymayan
 *    R2 anahtarları 🔒 ile gösterilir, seçim kutusu DEVRE DIŞIDIR. Bu yalnızca arayüzdür — GERÇEK bariyer
 *    veritabanında (sistem_korumali_tablo_mu + sistem_tablo_temizle) ve Worker'da (ANAHTAR_DESENLERI)dır;
 *    arayüz atlatılsa bile korumalı öğe silinemez. Kovaların kendisini silen hiçbir uç nokta yoktur.
 *  • SİLME: iki aşamalı onay (özet → "SİL" yazma) + işlem günlüğü (işlemden ÖNCE yazılır).
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import {
  el, bayt, tarihMetni, hataMetni, workerJson, dugme, ikon, silOnayiIste,
  R2_KAYNAK_ADLARI, SISTEM_YEDEK_WORKER_URL,
} from "./ortak.js";
import { tabloBilgisi, KATEGORILER } from "./depolama.js";

const sayi = (n) => Number(n || 0).toLocaleString("tr-TR");
const KILIT_METNI = {
  korumali_tablo: "Korumalı tablo — sitenin çalışması için zorunlu",
  zincir: "Zincirleme silme korumalı bir tabloyu etkiler",
  sistem_semasi: "Sistem şeması — silinemez",
};

/* ------------------------------ ortak parçalar ------------------------------ */

/** Büyük, kaydırılabilir bilgi/işlem penceresi. kur(govde, kapat) içeriği doldurur. Kapanınca düğümü söker. */
function pencereAc(baslik, kur) {
  const d = el("dialog", { class: "sy-dialog sy-dialog--genis" });
  const govde = el("div", { class: "sy-dialog-govde sy-dialog-govde--genis" });
  const kapat = dugme({ metin: "Kapat", ikonAdi: "kapat", tur: "ikincil", kucuk: true });
  kapat.addEventListener("click", () => d.close());
  d.append(el("div", { class: "sy-dialog-ust" }, el("h3", { class: "sy-dialog-baslik", text: baslik }), kapat), govde);
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  kur(govde, () => d.close());
  return d;
}

/** Bir tablo satırını okunur kısa bir blok olarak gösterir (ilk alanlar açık, kalanı "tümü" içinde). */
function satirOnizleme(veri) {
  const girisler = Object.entries(veri || {}).filter(([, v]) => v !== null && v !== "");
  const ilk = girisler.slice(0, 4);
  const geri = girisler.slice(4);
  const satir = ([k, v]) => el("div", { class: "sy-sat-alan" }, el("span", { class: "sy-sat-k", text: k }), el("span", { class: "sy-sat-v", text: String(v) }));
  return el("div", { class: "sy-sat-onizleme" }, ...ilk.map(satir),
    geri.length ? el("details", {}, el("summary", { text: `+${geri.length} alan daha` }), ...geri.map(satir)) : null);
}

function sayfalayici(toplam, sayfa, boyut, git, boyutSec) {
  const sayfaSayisi = Math.max(1, Math.ceil(toplam / boyut));
  const geri = dugme({ metin: "Önceki", tur: "ikincil", kucuk: true, disabled: sayfa <= 0, "aria-label": "Önceki sayfa" });
  const ileri = dugme({ metin: "Sonraki", tur: "ikincil", kucuk: true, disabled: sayfa >= sayfaSayisi - 1, "aria-label": "Sonraki sayfa" });
  geri.addEventListener("click", () => git(sayfa - 1));
  ileri.addEventListener("click", () => git(sayfa + 1));
  const s = boyutSec ? el("select", { "aria-label": "Sayfa başına öğe" }, [10, 20, 50].map((n) => el("option", { value: String(n), text: `${n} / sayfa`, selected: n === boyut ? "" : null }))) : null;
  s?.addEventListener("change", () => boyutSec(Number(s.value)));
  return el("nav", { class: "sy-sayfalayici", "aria-label": "Sayfalama" }, geri,
    el("span", { class: "sy-sayfa-bilgi", text: `Sayfa ${sayfa + 1} / ${sayfaSayisi} · ${sayi(toplam)} öğe` }), ileri, s);
}

/* ====================================================================== */
/* A) VERİTABANI                                                            */
/* ====================================================================== */

function veritabaniPaneli(mesaj) {
  const kok = el("div", { class: "sy-gz-pane" });
  let tablolar = [];
  const secili = new Set(); // "sema.tablo"
  let arama = "";
  let kategori = "hepsi";
  let sadeceSilinebilir = false;
  let sira = "boyut";
  let calisiyor = false;
  let sayfa = 0;
  let sayfaBoyu = 15;
  let sonGorunen = [];

  const anahtar = (t) => `${t.sema}.${t.tablo}`;
  const SIRALAR = {
    boyut: ["Boyut (büyükten küçüğe)", (a, b) => b.toplam - a.toplam],
    satir: ["Satır sayısı", (a, b) => b.satir - a.satir],
    ad: ["Ad (A → Z)", (a, b) => anahtar(a).localeCompare(anahtar(b), "tr")],
  };

  const girdi = el("input", { type: "search", class: "sy-girdi", placeholder: "Tablo adı veya açıklamada ara…", "aria-label": "Tabloları ara", autocomplete: "off" });
  const siraSec = el("select", { "aria-label": "Sıralama" }, Object.entries(SIRALAR).map(([k, v]) => el("option", { value: k, text: v[0] })));
  const sadeceK = el("input", { type: "checkbox", id: "sy-gz-sadece" });
  const cipler = el("div", { class: "sy-cipler", role: "group", "aria-label": "Kategori filtresi" });
  const liste = el("ul", { class: "sy-gz-liste" });
  const sayfalamaKutu = el("div", { class: "sy-gz-sayfalama" });
  const cubuk = el("div", { class: "sy-gz-cubuk", role: "status", "aria-live": "polite" });
  const ozetMetin = el("span", { class: "sy-gz-cubuk-metin" });
  const analizBtn = dugme({ metin: "Seçimi analiz et / içeriği gör", ikonAdi: "ara", tur: "ikincil", kucuk: true });
  const silinebilirBtn = dugme({ metin: "Neler silinebilir?", ikonAdi: "ara", tur: "ikincil", kucuk: true });
  const sayfaSecBtn = dugme({ metin: "Bu sayfadakileri seç", tur: "ikincil", kucuk: true });
  const silBtn = dugme({ metin: "Seçilenleri sil…", ikonAdi: "cop", tur: "tehlike", kucuk: true });
  const temizleBtn = dugme({ metin: "Seçimi temizle", ikonAdi: "kapat", tur: "hayalet", kucuk: true });
  cubuk.append(ozetMetin, analizBtn, silBtn, temizleBtn);
  const yenileBtn = dugme({ metin: "Yeniden tara", ikonAdi: "yenile", tur: "ikincil", kucuk: true });

  const secilenler = () => tablolar.filter((t) => secili.has(anahtar(t)) && t.silinebilir);

  function ozetGuncelle() {
    const s = secilenler();
    const satir = s.reduce((n, t) => n + Number(t.satir), 0);
    const boyut = s.reduce((n, t) => n + Number(t.toplam), 0);
    cubuk.hidden = s.length === 0;
    ozetMetin.textContent = `${s.length} tablo seçili · ${sayi(satir)} satır · ${bayt(boyut)}`;
    silBtn.disabled = calisiyor || s.length === 0;
    analizBtn.disabled = s.length === 0;
  }

  function cipleriCiz() {
    cipler.replaceChildren(...KATEGORILER.map((k) => {
      const n = k.id === "hepsi" ? tablolar.length : tablolar.filter((t) => t.kategori === k.id).length;
      const b = el("button", { type: "button", class: "sy-sec", "aria-pressed": String(kategori === k.id), text: `${k.ad} (${n})` });
      b.addEventListener("click", () => { kategori = k.id; sayfa = 0; cipleriCiz(); ciz(); });
      return b;
    }));
  }

  function satirCiz(t, enBuyuk) {
    const k = anahtar(t);
    const kilitli = !t.silinebilir;
    const kutu = el("input", { type: "checkbox", "aria-label": `${t.tablo} tablosunu seç`, disabled: kilitli });
    kutu.checked = !kilitli && secili.has(k);
    kutu.addEventListener("change", () => { if (kutu.checked) secili.add(k); else secili.delete(k); ozetGuncelle(); });
    const baslikAlani = kilitli
      ? el("span", { class: "sy-gz-kilit", title: KILIT_METNI[t.kilit] || "Kilitli", "aria-label": KILIT_METNI[t.kilit] || "Kilitli" }, ikon("kilit"))
      : kutu;
    const zincir = (t.cascade || []).map((x) => x.replace(/^public\./, ""));
    return el("li", { class: `sy-tablo-satir sy-gz-satir${kilitli ? " sy-gz-satir--kilitli" : ""}` },
      el("div", { class: "sy-tablo-ust" },
        el("label", { class: "sy-gz-etiket" }, baslikAlani,
          el("code", { text: t.sema === "public" ? t.tablo : `${t.sema}.${t.tablo}` }),
          el("span", { class: "sy-etiket", text: KATEGORILER.find((c) => c.id === t.kategori)?.ad || "" }),
          kilitli ? el("span", { class: "sy-rozet sy-rozet--uyari", text: "Kilitli" }) : null),
        el("span", { class: "sy-tablo-boyut", text: bayt(t.toplam) })),
      el("progress", { class: "sy-cubuk sy-cubuk--ince", max: "100", value: String(Math.max(1, Math.round((Number(t.toplam) / enBuyuk) * 100))), "aria-label": `${t.tablo} göreli boyut` }),
      el("p", { class: "sy-tablo-acik", text: kilitli ? (KILIT_METNI[t.kilit] || "") : t.aciklama }),
      el("div", { class: "sy-eylemler" }, icerikBtn(t)),
      el("p", { class: "sy-tablo-meta" },
        el("span", { text: `${t.satir_kesin ? "" : "≈ "}${sayi(t.satir)} satır` }),
        el("span", { text: `Veri ${bayt(t.veri)}` }),
        el("span", { text: `İndeks ${bayt(t.indeks)}` }),
        zincir.length ? el("span", { class: "sy-gz-zincir", title: `Silinirse bağlı satırları da gider: ${zincir.join(", ")}`, text: `⛓ ${zincir.length} bağlı tablo` }) : null));
  }

  function ciz() {
    const q = arama.trim().toLocaleLowerCase("tr");
    const gorunen = tablolar
      .filter((t) => kategori === "hepsi" || t.kategori === kategori)
      .filter((t) => !sadeceSilinebilir || t.silinebilir)
      .filter((t) => !q || `${anahtar(t)} ${t.aciklama}`.toLocaleLowerCase("tr").includes(q))
      .sort(SIRALAR[sira][1]);
    sayfa = Math.min(sayfa, Math.max(0, Math.ceil(gorunen.length / sayfaBoyu) - 1));
    const dilim = gorunen.slice(sayfa * sayfaBoyu, (sayfa + 1) * sayfaBoyu);
    sonGorunen = dilim;
    const enBuyuk = Math.max(1, ...gorunen.map((t) => Number(t.toplam)));
    liste.replaceChildren(...(dilim.length ? dilim.map((t) => satirCiz(t, enBuyuk)) : [el("li", { class: "muted", text: "Bu filtreyle eşleşen tablo yok." })]));
    sayfalamaKutu.replaceChildren(gorunen.length > 10 ? sayfalayici(gorunen.length, sayfa, sayfaBoyu, (n) => { sayfa = n; ciz(); liste.scrollIntoView({ block: "start" }); }, (b) => { sayfaBoyu = b; sayfa = 0; ciz(); }) : "");
    ozetGuncelle();
  }

  function icerikBtn(t) {
    const b = dugme({ metin: "İçeriği gör", ikonAdi: "goz", tur: "hayalet", kucuk: true, disabled: t.sema !== "public" });
    b.addEventListener("click", () => satirGezgini(t));
    return b;
  }

  /** Satır gezgini: tablonun kayıtlarını sayfalı gösterir; işaretlenen satırlar silinir (kilitli tabloda yalnızca okuma). */
  function satirGezgini(t) {
    pencereAc(`${t.tablo} — içerik`, (govde, kapat) => {
      const adet = 20;
      let ofset = 0, veri = null, yukleniyor = false;
      const secilen = new Map();
      const durum = el("p", { class: "muted", role: "status" });
      const icerik = el("div", { class: "sy-sat-liste" });
      const sayfaYeri = el("div");
      const silB = dugme({ metin: "Seçilenleri sil…", ikonAdi: "cop", tur: "tehlike", kucuk: true, disabled: true });
      const tumTablo = dugme({ metin: "Tüm tabloyu temizle…", tur: "tehlike-hafif", kucuk: true, disabled: !t.silinebilir });
      const sayfaSec = dugme({ metin: "Bu sayfayı seç", tur: "ikincil", kucuk: true });
      const cubuk2 = el("div", { class: "sy-gz-cubuk" }, el("span", { class: "sy-gz-cubuk-metin", text: `${sayi(t.satir)} satır · ${bayt(t.toplam)}` }), sayfaSec, silB, tumTablo);
      const guncelle = () => {
        silB.disabled = !secilen.size || !t.silinebilir;
        const m = silB.querySelector(".dn-btn-metin, .sy-dugme-metin, span:last-child");
        if (m) m.textContent = secilen.size ? `${secilen.size} satırı sil…` : "Seçilenleri sil…";
      };
      async function yukle() {
        if (yukleniyor) return;
        yukleniyor = true; durum.textContent = "Yükleniyor…";
        const { data, error } = await supabase.rpc("sistem_tablo_satirlari", { p_tablo: t.tablo, p_ofset: ofset, p_adet: adet });
        yukleniyor = false;
        if (error) { durum.textContent = hataMetni(error); return; }
        durum.textContent = "";
        veri = data;
        icerik.replaceChildren(...(veri.satirlar.length ? veri.satirlar.map((r) => {
          const k = JSON.stringify(r.pk);
          const silinebilirSatir = t.silinebilir && veri.pk.length > 0;
          const kutu = el("input", { type: "checkbox", disabled: silinebilirSatir ? null : "", "aria-label": "Satırı seç" });
          kutu.checked = secilen.has(k);
          kutu.addEventListener("change", () => { if (kutu.checked) secilen.set(k, r.pk); else secilen.delete(k); guncelle(); });
          r._kutu = kutu; r._k = k;
          return el("div", { class: "sy-sat" }, silinebilirSatir ? kutu : el("span", { class: "sy-gz-kilit" }, ikon("kilit")), satirOnizleme(r.veri));
        }) : [el("p", { class: "muted", text: "Bu tabloda kayıt yok." })]));
        sayfaYeri.replaceChildren(sayfalayici(veri.toplam, Math.floor(ofset / adet), adet, (n) => { ofset = n * adet; yukle(); }));
        guncelle();
      }
      sayfaSec.addEventListener("click", () => { for (const r of veri?.satirlar || []) if (r._kutu && !r._kutu.disabled) { r._kutu.checked = true; secilen.set(r._k, r.pk); } guncelle(); });
      silB.addEventListener("click", async () => {
        const pkler = [...secilen.values()];
        const ok = await silOnayiIste({ baslik: `${t.tablo}: seçili satırlar silinsin mi?`, ozet: [`${pkler.length} satır silinecek`, `Tablo: ${t.tablo}`],
          uyari: [...(t.cascade?.length ? [`Zincirleme etkilenen tablolar: ${t.cascade.map((x) => x.replace(/^public\./, "")).join(", ")}.`] : []), "Geri alınamaz."] });
        if (!ok) return;
        let islem = null;
        try {
          const b = await supabase.rpc("sistem_islem_baslat", { p_tur: "satir_sil", p_ayrinti: { tablo: t.tablo, satir: pkler.length } });
          if (b.error) throw b.error;
          islem = b.data;
          for (let i = 0; i < pkler.length; i += 500) {
            const r = await supabase.rpc("sistem_satir_sil", { p_tablo: t.tablo, p_pkler: pkler.slice(i, i + 500), p_onay: "SİL", p_islem: i + 500 >= pkler.length ? islem : null });
            if (r.error) throw r.error;
          }
          mesaj(`${pkler.length} satır silindi (${t.tablo}).`, "success");
          secilen.clear(); ofset = 0;
          await yukle();
          yukleTablolarSessiz();
        } catch (h) {
          if (islem) { try { await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: false, p_ozet: { hata: String(h?.message || h).slice(0, 200) } }); } catch { /* best-effort */ } }
          durum.textContent = `Silinemedi: ${hataMetni(h)}`;
        }
      });
      tumTablo.addEventListener("click", () => { kapat(); secili.clear(); secili.add(anahtar(t)); tumSil(); });
      govde.append(el("p", { class: "sy-bilgi" }, ikon(t.silinebilir ? "kalkan" : "kilit"), el("span", { text: t.silinebilir ? "Silmek istediğin kayıtları işaretle; yalnızca işaretlenenler silinir. Gizli alanlar (parola, anahtar, jeton…) maskelenir." : `${KILIT_METNI[t.kilit] || "Kilitli"}: içerik yalnızca okunabilir.` })),
        cubuk2, durum, icerik, sayfaYeri);
      yukle();
    });
  }

  async function yukleTablolarSessiz() { try { await yukle(true); } catch { /* yok say */ } }
  const tumSil = () => sil();

  async function analiz(tum = false) {
    const s = tum ? tablolar.filter((t) => t.silinebilir && t.satir > 0) : secilenler();
    if (!s.length) { mesaj(tum ? "Silinebilir ve dolu tablo yok." : "Önce analiz edilecek tabloları seç.", "info"); return; }
    pencereAc(tum ? "Neler silinebilir? (dolu, kilitsiz tablolar)" : "Seçim analizi", (govde) => {
      const adlar = new Set(s.map((t) => t.tablo));
      const zincirEk = [...new Set(s.flatMap((t) => t.cascade || []))].map((x) => x.replace(/^public\./, "")).filter((x) => !adlar.has(x));
      const satir = s.reduce((n, t) => n + Number(t.satir), 0);
      const boyut = s.reduce((n, t) => n + Number(t.toplam), 0);
      govde.append(
        el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: `${s.length} tablo · ${sayi(satir)} satır · ${bayt(boyut)}. Bu yalnızca analizdir; hiçbir şey silinmedi.` })),
        zincirEk.length ? el("p", { class: "sy-bilgi sy-bilgi--uyari" }, ikon("uyari"), el("span", { text: `Zincirleme (CASCADE) etkilenecek seçili olmayan tablolar: ${zincirEk.join(", ")}.` })) : null);
      for (const t of s) {
        const blok = el("section", { class: "sy-analiz-blok" });
        const gor = dugme({ metin: "Tüm içeriği gör / seç", ikonAdi: "goz", tur: "ikincil", kucuk: true });
        gor.addEventListener("click", () => satirGezgini(t));
        const ornek = el("div", { class: "sy-sat-liste" }, el("p", { class: "muted", text: "Örnek kayıtlar yükleniyor…" }));
        blok.append(el("div", { class: "sy-analiz-ust" }, el("code", { text: t.tablo }), el("span", { class: "muted", text: `${sayi(t.satir)} satır · ${bayt(t.toplam)}` }), gor), ornek);
        govde.append(blok);
        supabase.rpc("sistem_tablo_satirlari", { p_tablo: t.tablo, p_ofset: 0, p_adet: 3 }).then(({ data, error }) => {
          if (error) { ornek.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
          ornek.replaceChildren(...(data.satirlar.length ? data.satirlar.map((r) => el("div", { class: "sy-sat" }, satirOnizleme(r.veri))) : [el("p", { class: "muted", text: "Kayıt yok." })]),
            ...(data.toplam > 3 ? [el("p", { class: "muted", text: `… ve ${sayi(data.toplam - 3)} kayıt daha.` })] : []));
        });
      }
    });
  }

  async function sil() {
    const s = secilenler();
    if (!s.length || calisiyor) return;
    const adlar = s.map((t) => t.tablo);
    const satir = s.reduce((n, t) => n + Number(t.satir), 0);
    const boyut = s.reduce((n, t) => n + Number(t.toplam), 0);
    const secAd = new Set(adlar);
    const zincirEk = [...new Set(s.flatMap((t) => t.cascade || []))].map((x) => x.replace(/^public\./, "")).filter((x) => !secAd.has(x));
    const tamam = await silOnayiIste({
      baslik: "Seçili tabloların verileri kalıcı silinsin mi?",
      ozet: [
        `${adlar.length} tablo: ${adlar.slice(0, 8).join(", ")}${adlar.length > 8 ? ` ve ${adlar.length - 8} tane daha` : ""}`,
        `Silinecek kayıt: ${sayi(satir)} satır`,
        `Bu tabloların kapladığı alan: ${bayt(boyut)}`,
      ],
      uyari: [
        ...(zincirEk.length ? [`Zincirleme (CASCADE) olarak şu tablolardaki bağlı satırlar da silinir: ${zincirEk.join(", ")}.`] : []),
        "Tablo yapısı (şema) silinmez, yalnızca satırlar silinir. Önce “Dışa Aktar” ile yedek almanı öneririz.",
      ],
    });
    if (!tamam) return;

    calisiyor = true;
    ozetGuncelle();
    let islem = null;
    try {
      const b = await supabase.rpc("sistem_islem_baslat", { p_tur: "tablo_temizle", p_ayrinti: { tablolar: adlar, satir, boyut } });
      if (b.error) throw b.error;
      islem = b.data;
      const r = await supabase.rpc("sistem_tablo_temizle", { p_tablolar: adlar, p_onay: "SİL", p_islem: islem });
      if (r.error) throw r.error;
      mesaj(`${sayi(r.data?.toplam)} satır silindi (${adlar.length} tablo).`, "success");
      secili.clear();
    } catch (h) {
      if (islem) {
        try { await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: false, p_ozet: { hata: String(h?.message || h).slice(0, 300) } }); } catch { /* günlük best-effort */ }
      }
      mesaj(`Silinemedi (hiçbir tablo değişmedi): ${hataMetni(h)}`);
    } finally {
      calisiyor = false;
    }
    await yukle();
  }

  async function yukle(sessiz = false) {
    if (!sessiz) liste.replaceChildren(el("li", { class: "muted", text: "Tablolar taranıyor (gerçek satır sayıları sayılıyor)…" }));
    const { data, error } = await supabase.rpc("sistem_depolama_gezgini");
    if (error) { liste.replaceChildren(el("li", { class: "auth-message error", text: hataMetni(error) })); return; }
    tablolar = (data || []).map((t) => ({ ...t, ...tabloBilgisi(t), toplam: Number(t.toplam), satir: Number(t.satir), veri: Number(t.veri), indeks: Number(t.indeks) }));
    for (const k of [...secili]) if (!tablolar.some((t) => anahtar(t) === k && t.silinebilir)) secili.delete(k);
    cipleriCiz();
    ciz();
  }

  girdi.addEventListener("input", () => { arama = girdi.value; sayfa = 0; ciz(); });
  siraSec.addEventListener("change", () => { sira = siraSec.value; sayfa = 0; ciz(); });
  sadeceK.addEventListener("change", () => { sadeceSilinebilir = sadeceK.checked; sayfa = 0; ciz(); });
  analizBtn.addEventListener("click", () => analiz(false));
  silinebilirBtn.addEventListener("click", () => analiz(true));
  sayfaSecBtn.addEventListener("click", () => { for (const t of sonGorunen) if (t.silinebilir) secili.add(anahtar(t)); ciz(); });
  silBtn.addEventListener("click", sil);
  temizleBtn.addEventListener("click", () => { secili.clear(); ciz(); });
  yenileBtn.addEventListener("click", yukle);

  kok.append(
    el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: "🔒 kilitli tablolar (kimlik, roller, yetkiler, site ayarları, şifreleme anahtarları, denetim kayıtları, tüm sistem şemaları) hiçbir koşulda silinemez; kilit veritabanında ve Worker'da da uygulanır." })),
    el("div", { class: "sy-filtre" }, el("div", { class: "sy-arama" }, ikon("ara"), girdi), siraSec, yenileBtn),
    el("div", { class: "sy-eylemler" }, silinebilirBtn, sayfaSecBtn),
    el("label", { class: "sy-gz-sadece", for: "sy-gz-sadece" }, sadeceK, el("span", { text: "Yalnızca silinebilir olanları göster" })),
    cipler, cubuk, liste, sayfalamaKutu
  );
  yukle();
  return kok;
}

/* ====================================================================== */
/* B) R2                                                                    */
/* ====================================================================== */

function r2Paneli(mesaj) {
  const kok = el("div", { class: "sy-gz-pane" });
  const kuyrukKutu = el("div", { class: "sy-gz-kuyruk" });
  const kovaKutu = el("div", { class: "sy-izgara" });
  const gezginKutu = el("div", { class: "sy-gz-r2" });
  let bagli = {};
  let d = null; // açık gezgin durumu

  async function kuyrukBandi() {
    try {
      const { data, error } = await supabase.rpc("sistem_r2_kuyruk_listesi", { p_limit: 5 });
      if (error) throw error;
      const adet = Number(data?.adet) || 0;
      if (!adet) { kuyrukKutu.replaceChildren(); return; }
      const dene = dugme({ metin: "Tekrar dene", ikonAdi: "yenile", tur: "birincil", kucuk: true });
      dene.addEventListener("click", async () => {
        dene.disabled = true;
        try {
          const g = await workerJson("/r2/kuyruk-isle", { yontem: "POST" });
          mesaj(`Kuyruk işlendi: ${sayi(g.silinen)} nesne silindi, ${sayi(g.kalan)} kaldı.`, g.kalan ? "error" : "success");
        } catch (h) { mesaj(`Kuyruk işlenemedi: ${h.message}`); }
        await kuyrukBandi();
      });
      kuyrukKutu.replaceChildren(el("div", { class: "sy-bilgi sy-bilgi--uyari" }, ikon("uyari"),
        el("span", { text: `${sayi(adet)} R2 nesnesi silinmek üzere kuyrukta bekliyor (veritabanı kaydı silindi ama dosya R2'de duruyor olabilir).` }), dene));
    } catch { kuyrukKutu.replaceChildren(); }
  }

  async function kovalar() {
    try {
      const r = await fetch(`${SISTEM_YEDEK_WORKER_URL}/saglik`);
      const g = await r.json();
      bagli = g.kaynaklar || {};
    } catch { bagli = {}; }
    kovaKutu.replaceChildren(...Object.entries(R2_KAYNAK_ADLARI).map(([kaynak, ad]) => {
      const ac = dugme({ metin: "Gezgini aç", ikonAdi: "klasor", tur: "ikincil", kucuk: true, disabled: !bagli[kaynak] });
      ac.addEventListener("click", () => gezginAc(kaynak, ""));
      return el("article", { class: "sy-kart sy-kota" },
        el("div", { class: "sy-kota-ust" }, el("h3", { text: `☁️ ${ad}` }),
          el("span", { class: "sy-rozet sy-rozet--iyi", title: "Kovalar (bucket) bu arayüzden ya da Worker'dan silinemez." }, "🔒 Kova silinemez")),
        el("p", { class: "muted sy-not", text: bagli[kaynak] ? "Kova Worker'a bağlı." : "Bu kova Worker'da bağlı değil (binding ekle)." }),
        el("div", { class: "sy-eylemler" }, ac));
    }));
  }

  /* ------------------------------ gezgin ------------------------------ */
  function gezginAc(kaynak, onek) {
    d = { kaynak, onek, klasorler: [], nesneler: [], imlec: null, secili: new Map(), yukleniyor: false, calisiyor: false, boyutlar: new Map(), tur: 0 };
    sayfaYukle(false);
  }

  async function sayfaYukle(devam) {
    if (!d || d.yukleniyor) return;
    const tur = d.tur;
    d.yukleniyor = true;
    gezginCiz();
    try {
      const g = await workerJson(`/r2/gezgin?b=${d.kaynak}&o=${encodeURIComponent(d.onek)}${devam && d.imlec ? `&c=${encodeURIComponent(d.imlec)}` : ""}`);
      if (!d || d.tur !== tur) return; // arada başka klasöre geçildi
      d.klasorler = devam ? [...d.klasorler, ...g.klasorler] : g.klasorler;
      d.nesneler = devam ? [...d.nesneler, ...g.nesneler] : g.nesneler;
      d.imlec = g.imlec;
    } catch (h) {
      mesaj(`Gezgin yüklenemedi: ${h.message}`);
    } finally {
      if (d) { d.yukleniyor = false; gezginCiz(); }
    }
  }

  function git(onek) {
    d.onek = onek; d.klasorler = []; d.nesneler = []; d.imlec = null; d.tur += 1; d.yukleniyor = false;
    sayfaYukle(false);
  }

  function secimOzeti() {
    const v = [...d.secili.values()];
    return { adet: v.length, bayt: v.reduce((n, o) => n + Number(o.boyut), 0), kayitli: v.filter((o) => o.kayitli).length, yetim: v.filter((o) => !o.kayitli).length };
  }

  async function sil() {
    if (!d || d.calisiyor) return;
    const o = secimOzeti();
    if (!o.adet) return;
    const kaynak = d.kaynak;
    const tamam = await silOnayiIste({
      baslik: `${R2_KAYNAK_ADLARI[kaynak]}: seçili dosyalar kalıcı silinsin mi?`,
      ozet: [`${sayi(o.adet)} nesne · ${bayt(o.bayt)}`, `Veritabanında kaydı olan (üyelere ait): ${sayi(o.kayitli)}`, `Yetim (veritabanında kaydı yok): ${sayi(o.yetim)}`],
      uyari: [
        ...(o.kayitli ? ["Kayıtlı dosyaların veritabanındaki kaydı/bağlantısı da kaldırılır; üyeler bu dosyalara bir daha erişemez."] : []),
        "R2 nesneleri geri getirilemez (sürüm geçmişi yoktur). Önce “Dışa Aktar” ile yedek almanı öneririz.",
      ],
    });
    if (!tamam) return;

    d.calisiyor = true; gezginCiz();
    let islem = null;
    const anahtarlar = [...d.secili.keys()];
    let silinen = 0;
    try {
      const { data, error } = await supabase.rpc("sistem_islem_baslat", { p_tur: "r2_temizle", p_ayrinti: { kaynak, adet: o.adet, bayt: o.bayt, kayitli: o.kayitli } });
      if (error) throw error;
      islem = data;
      for (let i = 0; i < anahtarlar.length; i += 500) {
        const parca = anahtarlar.slice(i, i + 500);
        await workerJson("/r2/sil", { yontem: "POST", govde: { kaynak, anahtarlar: parca, islem } });
        silinen += parca.length;
        mesaj(`Siliniyor… ${sayi(silinen)} / ${sayi(anahtarlar.length)}`, "info");
      }
      if (islem) await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: true, p_ozet: { silinen } });
      mesaj(`${sayi(silinen)} nesne silindi.`, "success");
    } catch (h) {
      if (islem) {
        try { await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: false, p_ozet: { silinen, hata: String(h.message || h).slice(0, 300) } }); } catch { /* best-effort */ }
      }
      mesaj(`Silme tamamlanamadı (${sayi(silinen)} nesne silindi): ${h.message || h}`);
    } finally {
      if (d) d.calisiyor = false;
    }
    if (d) { d.secili.clear(); git(d.onek); }
    kuyrukBandi();
  }

  function gezginCiz() {
    if (!d) { gezginKutu.replaceChildren(); return; }
    const parcalar = d.onek.split("/").filter(Boolean);
    const kirinti = el("nav", { class: "sy-gz-kirinti", "aria-label": "Konum" },
      ...[{ ad: R2_KAYNAK_ADLARI[d.kaynak], onek: "" }, ...parcalar.map((p, i) => ({ ad: p, onek: `${parcalar.slice(0, i + 1).join("/")}/` }))]
        .flatMap((k, i, a) => {
          const b = el("button", { type: "button", class: "sy-gz-kirinti-btn", text: k.ad, "aria-current": i === a.length - 1 ? "page" : null });
          b.addEventListener("click", () => git(k.onek));
          return i < a.length - 1 ? [b, el("span", { "aria-hidden": "true", text: "›" })] : [b];
        }));
    const kapat = dugme({ metin: "Gezgini kapat", ikonAdi: "kapat", tur: "hayalet", kucuk: true });
    kapat.addEventListener("click", () => { d = null; gezginCiz(); });

    const klasorSatirlari = d.klasorler.map((k) => {
      const ac = el("button", { type: "button", class: "sy-gz-klasor-btn" }, ikon("klasor"), el("span", { text: k.ad }));
      ac.addEventListener("click", () => git(k.onek));
      const hesapla = dugme({ metin: "Boyut hesapla", tur: "hayalet", kucuk: true });
      const sonuc = d.boyutlar.get(k.onek);
      if (sonuc) hesapla.hidden = true;
      hesapla.addEventListener("click", async () => {
        hesapla.disabled = true;
        try {
          const g = await workerJson(`/r2/boyut?b=${d.kaynak}&o=${encodeURIComponent(k.onek)}`);
          d.boyutlar.set(k.onek, `${sayi(g.adet)} nesne · ${bayt(g.bayt)}${g.kismi ? " (kısmi tarama)" : ""}`);
          gezginCiz();
        } catch (h) { mesaj(`Boyut alınamadı: ${h.message}`); hesapla.disabled = false; }
      });
      return el("li", { class: "sy-gz-nesne sy-gz-nesne--klasor" }, ac, sonuc ? el("span", { class: "muted", text: sonuc }) : hesapla);
    });

    const nesneSatirlari = d.nesneler.map((n) => {
      const kilitli = !n.silinebilir;
      const kutu = el("input", { type: "checkbox", "aria-label": `${n.ad} dosyasını seç`, disabled: kilitli || d.calisiyor });
      kutu.checked = !kilitli && d.secili.has(n.anahtar);
      kutu.addEventListener("change", () => { if (kutu.checked) d.secili.set(n.anahtar, n); else d.secili.delete(n.anahtar); gezginCiz(); });
      return el("li", { class: `sy-gz-nesne${kilitli ? " sy-gz-satir--kilitli" : ""}` },
        kilitli ? el("span", { class: "sy-gz-kilit", title: "Korumalı: bilinen anahtar biçimi değil" }, ikon("kilit")) : kutu,
        el("span", { class: "sy-gz-nesne-ad", title: n.anahtar }, ikon("dosya"), el("span", { text: n.etiket || n.ad })),
        el("span", { class: `sy-rozet ${n.kayitli ? "sy-rozet--iyi" : "sy-rozet--uyari"}`, text: kilitli ? "Korumalı" : n.kayitli ? "Kayıtlı" : "Yetim" }),
        n.sifreli ? el("span", { class: "sy-etiket", text: "şifreli" }) : null,
        el("span", { class: "muted sy-gz-nesne-meta", text: `${bayt(n.boyut)} · ${tarihMetni(n.yuklenme)}` }));
    });

    const o = secimOzeti();
    const yetimSec = dugme({ metin: "Görünen yetimleri seç", tur: "ikincil", kucuk: true });
    yetimSec.addEventListener("click", () => { for (const n of d.nesneler) if (n.silinebilir && !n.kayitli) d.secili.set(n.anahtar, n); gezginCiz(); });
    const temizle = dugme({ metin: "Seçimi temizle", ikonAdi: "kapat", tur: "hayalet", kucuk: true, hidden: !o.adet });
    temizle.addEventListener("click", () => { d.secili.clear(); gezginCiz(); });
    const silBtn = dugme({ metin: "Seçilenleri sil…", ikonAdi: "cop", tur: "tehlike", kucuk: true, disabled: !o.adet || d.calisiyor });
    silBtn.addEventListener("click", sil);
    const analizB = dugme({ metin: "Seçimi analiz et", ikonAdi: "ara", tur: "ikincil", kucuk: true, disabled: !o.adet });
    analizB.addEventListener("click", () => {
      const v = [...d.secili.values()];
      pencereAc("R2 seçim analizi", (govde) => {
        const kayitli = v.filter((x) => x.kayitli);
        govde.append(
          el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: `${sayi(v.length)} nesne · ${bayt(o.bayt)} — ${sayi(kayitli.length)} kayıtlı, ${sayi(v.length - kayitli.length)} yetim. Bu yalnızca analizdir; hiçbir şey silinmedi.` })),
          el("ul", { class: "sy-gz-liste" }, v.slice(0, 200).map((x) => el("li", { class: "sy-gz-nesne" },
            el("span", { class: "sy-gz-nesne-ad", title: x.anahtar }, ikon("dosya"), el("span", { text: x.etiket || x.ad })),
            el("span", { class: `sy-rozet ${x.kayitli ? "sy-rozet--iyi" : "sy-rozet--uyari"}`, text: x.kayitli ? "Kayıtlı" : "Yetim" }),
            x.sahip ? el("span", { class: "muted", text: `Üye: ${String(x.sahip).slice(0, 8)}…` }) : null,
            el("span", { class: "muted", text: `${bayt(x.boyut)} · ${tarihMetni(x.yuklenme)}` })))),
          v.length > 200 ? el("p", { class: "muted", text: `… ve ${sayi(v.length - 200)} nesne daha.` }) : null);
      });
    });
    const dahaFazla = d.imlec ? dugme({ metin: "Daha fazla yükle", tur: "ikincil", kucuk: true, disabled: d.yukleniyor }) : null;
    dahaFazla?.addEventListener("click", () => sayfaYukle(true));

    gezginKutu.replaceChildren(
      el("div", { class: "sy-gz-r2-ust" }, kirinti, kapat),
      el("div", { class: "sy-gz-cubuk", role: "status", "aria-live": "polite" },
        el("span", { class: "sy-gz-cubuk-metin", text: o.adet ? `${sayi(o.adet)} nesne seçili · ${bayt(o.bayt)} (${sayi(o.kayitli)} kayıtlı, ${sayi(o.yetim)} yetim)` : "Silmek için dosya seç; kilitli (korumalı) öğeler seçilemez." }),
        yetimSec, analizB, temizle, silBtn),
      d.yukleniyor && !d.nesneler.length && !d.klasorler.length ? el("p", { class: "muted", text: "Yükleniyor…" }) : null,
      el("ul", { class: "sy-gz-liste sy-gz-liste--r2" }, [...klasorSatirlari, ...nesneSatirlari].length
        ? [...klasorSatirlari, ...nesneSatirlari]
        : (d.yukleniyor ? [] : [el("li", { class: "muted", text: "Bu konumda öğe yok." })])),
      dahaFazla
    );
  }

  kok.append(
    el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: "R2'de yalnızca bilinen anahtar biçimlerindeki (arsiv/…, notlar/<üye>/…, akademik-kutuphane/users/<üye>/…) nesneler silinebilir. Bilinmeyen anahtarlar 🔒 korumalıdır; kovaların kendisi silinemez." })),
    kuyrukKutu, kovaKutu, gezginKutu
  );
  kuyrukBandi();
  kovalar();
  return kok;
}

/* ====================================================================== */

export function gezginCiz(kok, mesaj) {
  const sekmeler = [
    { id: "db", ad: "🗃️ Veritabanı tabloları", kur: () => veritabaniPaneli(mesaj) },
    { id: "r2", ad: "☁️ R2 dosyaları", kur: () => r2Paneli(mesaj) },
  ];
  const govde = el("div", { class: "sy-gz-govde" });
  const serit = el("div", { class: "sy-altsekmeler", role: "tablist", "aria-label": "Depolama gezgini bölümleri" });
  const panelOnbellek = new Map();
  const sec = (id) => {
    for (const b of serit.querySelectorAll("[role=tab]")) b.setAttribute("aria-selected", String(b.dataset.id === id));
    if (!panelOnbellek.has(id)) panelOnbellek.set(id, sekmeler.find((s) => s.id === id).kur());
    govde.replaceChildren(panelOnbellek.get(id));
  };
  for (const s of sekmeler) {
    const b = el("button", { type: "button", role: "tab", class: "sy-altsekme", "data-id": s.id, text: s.ad, "aria-selected": "false" });
    b.addEventListener("click", () => sec(s.id));
    serit.append(b);
  }
  kok.replaceChildren(serit, govde);
  sec("db");
}
