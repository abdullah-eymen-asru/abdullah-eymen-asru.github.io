/*
 * assets/js/sistem-yedek/ice-aktar.js — Akıllı Geri Yükleme / İçe Aktarma (yalnızca Site Sahibi).  Migration 0081.
 * -----------------------------------------------------------------------
 *  Girdi: sistemin indirdiği TAM .zip yedeği (ZIP64 dahil) ve/veya tekil/birkaç dosya.
 *   • .zip      → veritabani/json/*.json (+ notlar/json/*.json), r2/MANIFEST.json + r2 dosyaları otomatik ayrıştırılır.
 *                 Yedek olmayan ZIP'ler "tekil dosya yığını" gibi işlenir.
 *   • .json     → dosya adı tablo adıysa o tablo; değilse KOLON İMZASI (anahtarların tablo kolonlarıyla örtüşmesi).
 *   • PDF/görsel/.sifreli → ad+boyut ve anahtar adıyla veritabanındaki kayıtlarla eşleştirilir (sistem_r2_dosya_esle).
 *   Eşleşmeyen dosya ASLA tahmin edilerek yazılmaz: "eşleşme yok — atlanacak" denir.
 *  ÇAKIŞMA: "Yalnızca eksikleri tamamla" (varsayılan) | "Üzerine yaz". Korumalı tablolarda üzerine yazma YOKTUR
 *   (veritabanı bunu zorlar). SQL dökümleri tarayıcıdan çalıştırılmaz (güvenlik): JSON kullanılır.
 *  SIRA: önce tablolar (bağımlılık sırası; FK hatası alanlar sonraki turda yeniden denenir), sonra R2 dosyaları.
 *  Denetim: (Site Sahibi) işlem başlamadan günlüğe yazılır. innerHTML yok, inline stil yok (CSP).
 *  ÜYE MODU (opts.uye = true; migration 0084): her üye YALNIZCA KENDİ yedeğini kendi hesabına geri yükler — hesabı silinip yeniden
 *   açılmış olsa bile. Beyaz listeli tablolar (notlar, not_kasasi, not_ek_kayitlari, akademik_*, r2_arsiv); kullanıcı kimliği sunucuda
 *   oturumdan ZORLANIR; R2 anahtarlarındaki eski üye kimliği yenisiyle değiştirilir; dosya yalnızca kendi kaydının işaret ettiği anahtara yazılır.
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { zipAc } from "./zip-oku.js";
import { el, bayt, hataMetni, workerFetch, dugme, ikon, onayIste, r2AnahtarGecerli, R2_KAYNAK_ADLARI } from "./ortak.js";

const SIRA = ["profiles", "e2ee_kullanici_anahtarlari", "not_kasasi", "notlar", "not_ek_kayitlari", "akademik_kaynaklar", "akademik_notlar", "r2_arsiv", "taslak_icerikler", "special_content", "content_access"];
const SAYFA = 200;
const MAKS_JSON = 150 * 1024 * 1024;
const siraNo = (t) => { const i = SIRA.indexOf(t); return i < 0 ? 999 : i; };

/* ------------------------------ tablo tespiti ------------------------------ */

/** Üye modunda R2 anahtarındaki ESKİ üye kimliğini mevcut kimlikle değiştirir (hesap silinip yeniden açıldıysa kimlik değişir). */
function yeniAnahtar(kaynak, k, ctx) {
  if (!ctx?.uye) return k;
  if (kaynak === "notek") return k.replace(/^notlar\/[0-9a-f-]{36}\//i, `notlar/${ctx.uid}/`);
  if (kaynak === "akademik") return k.replace(/^akademik-kutuphane\/users\/[0-9a-f-]{36}\//i, `akademik-kutuphane/users/${ctx.uid}/`);
  return k;
}

function tabloTespit(ad, satirlar, sema) {
  const kok = ad.split("/").pop().replace(/\.json$/i, "");
  const adayAd = sema.find((t) => t.tablo === kok);
  const anahtarlar = new Set();
  for (const s of satirlar.slice(0, 25)) if (s && typeof s === "object") for (const k of Object.keys(s)) anahtarlar.add(k);
  if (!anahtarlar.size) return null;
  const imza = (t) => {
    const kol = new Set(t.kolonlar);
    let ort = 0;
    for (const k of anahtarlar) if (kol.has(k)) ort += 1;
    return { oran: ort / anahtarlar.size, kapsam: ort / Math.max(1, kol.size), ort };
  };
  if (adayAd) { const i = imza(adayAd); if (i.oran >= 0.8) return { tablo: adayAd.tablo, yontem: "dosya adı", guven: i.oran }; }
  let en = null;
  for (const t of sema) {
    const i = imza(t);
    if (i.oran >= 0.95 && i.ort >= 3 && (!en || i.kapsam > en.i.kapsam)) en = { t, i };
  }
  return en ? { tablo: en.t.tablo, yontem: "kolon imzası", guven: en.i.oran } : null;
}

async function jsonSatirlari(blob) {
  if (blob.size > MAKS_JSON) throw new Error(`JSON çok büyük (${bayt(blob.size)} > ${bayt(MAKS_JSON)}).`);
  const v = JSON.parse(await blob.text());
  if (!Array.isArray(v)) throw new Error("JSON bir satır dizisi değil (tek tablo yedeği değil).");
  return v;
}

/* ------------------------------ analiz ------------------------------ */

async function analizEt(dosyalar, sema, ilerleme, ctx = {}) {
  const tablolar = new Map(); // tablo -> {tablo, parcalar:[satirlar], kaynaklar:[], yontem, korumali}
  const r2 = [];              // {kaynak, anahtar, ad, boyut, al: ()=>Promise<Blob>, secenekler?}
  const notlar = [];
  const gevsek = [];          // eşleştirilecek tekil dosyalar {ad, boyut, al}

  const tabloEkle = (tablo, satirlar, kaynak, yontem) => {
    const t = sema.find((x) => x.tablo === tablo);
    if (!tablolar.has(tablo)) tablolar.set(tablo, { tablo, satirlar: [], kaynaklar: [], yontem, korumali: !!t?.korumali });
    const k = tablolar.get(tablo);
    k.satirlar.push(...satirlar);
    k.kaynaklar.push(kaynak);
  };

  async function jsonIsle(ad, blob, etiket) {
    let satirlar;
    try { satirlar = await jsonSatirlari(blob); } catch (h) { notlar.push(`${etiket}: atlandı — ${h.message}`); return; }
    if (!satirlar.length) { notlar.push(`${etiket}: boş tablo, atlandı.`); return; }
    const t = tabloTespit(ad, satirlar, sema);
    if (!t) { notlar.push(`${etiket}: hangi tabloya ait olduğu belirlenemedi — atlanacak.`); return; }
    tabloEkle(t.tablo, satirlar, etiket, t.yontem);
  }

  for (const f of dosyalar) {
    ilerleme(`Çözümleniyor: ${f.name}`);
    const ad = f.name;
    if (/\.zip$/i.test(ad)) {
      let z;
      try { z = await zipAc(f); } catch (h) { notlar.push(`${ad}: ${h.message}`); continue; }
      const manifestG = z.bul("r2/MANIFEST.json");
      const yedekMi = !!z.bul("manifest.json") || !!manifestG || z.girisler.some((g) => /^(veritabani|notlar)\/json\//.test(g.ad));
      const manifestYollari = new Set();
      if (manifestG) {
        try {
          const m = JSON.parse(await z.metin(manifestG));
          for (const e of Array.isArray(m) ? m : []) {
            if (e.hata || !e.yol) continue;
            const g = z.bul(e.yol);
            manifestYollari.add(e.yol);
            if (!g) { notlar.push(`MANIFEST: ${e.yol} pakette yok.`); continue; }
            if (!r2AnahtarGecerli(e.kaynak, e.anahtar)) { notlar.push(`MANIFEST: ${e.anahtar} bilinen anahtar biçimi değil (korumalı) — atlanacak.`); continue; }
            r2.push({ kaynak: e.kaynak, anahtar: yeniAnahtar(e.kaynak, e.anahtar, ctx), ad: e.anahtar.split("/").pop(), boyut: g.usize, al: () => z.oku(g) });
          }
        } catch (h) { notlar.push(`r2/MANIFEST.json okunamadı: ${h.message}`); }
      }
      let sqlVar = false;
      for (const g of z.girisler) {
        if (g.dizin || manifestYollari.has(g.ad) || g.ad === "r2/MANIFEST.json") continue;
        if (/^(icerik-md|github)\//.test(g.ad)) continue;
        if (/\.sql$/i.test(g.ad)) { sqlVar = true; continue; }
        if (/^(manifest\.json|OKUBENI\.txt)$/.test(g.ad)) continue;
        if (/\.json$/i.test(g.ad)) {
          if (/^notlar\/ekler\//.test(g.ad)) continue;
          if (yedekMi && !/^(veritabani|notlar)\/json\//.test(g.ad)) continue;
          await jsonIsle(g.ad, await z.oku(g), `${ad} › ${g.ad}`);
        } else if (!yedekMi) {
          gevsek.push({ ad: g.ad.split("/").pop(), boyut: g.usize, al: () => z.oku(g), etiket: `${ad} › ${g.ad}` });
        }
      }
      if (sqlVar) notlar.push(`${ad}: SQL dökümü tarayıcıdan çalıştırılmaz (güvenlik). Bu paketteki JSON dosyaları kullanıldı; SQL için Supabase SQL Editor'ü kullan.`);
      if (!yedekMi && !gevsek.length) notlar.push(`${ad}: tanınan bir içerik bulunamadı.`);
    } else if (/\.json$/i.test(ad)) {
      await jsonIsle(ad, f, ad);
    } else {
      gevsek.push({ ad, boyut: f.size, al: async () => f, etiket: ad });
    }
  }

  // tekil dosyaları veritabanı kayıtlarıyla eşleştir
  if (gevsek.length) {
    ilerleme("Tekil dosyalar kayıtlarla eşleştiriliyor…");
    for (let i = 0; i < gevsek.length; i += 100) {
      const parca = gevsek.slice(i, i + 100);
      const { data, error } = await supabase.rpc(ctx.uye ? "uye_r2_dosya_esle" : "sistem_r2_dosya_esle", { p_dosyalar: parca.map((g) => ({ ad: g.ad, boyut: g.boyut })) });
      if (error) throw new Error(hataMetni(error));
      parca.forEach((g, j) => {
        const adaylar = (data?.[j]?.adaylar || []).filter((a) => r2AnahtarGecerli(a.kaynak, a.anahtar));
        if (adaylar.length === 1) r2.push({ kaynak: adaylar[0].kaynak, anahtar: adaylar[0].anahtar, ad: g.ad, boyut: g.boyut, al: g.al, etiket: adaylar[0].etiket });
        else if (adaylar.length > 1) r2.push({ kaynak: null, adaylar, ad: g.ad, boyut: g.boyut, al: g.al });
        else notlar.push(`${g.etiket}: veritabanında eşleşen kayıt yok — atlanacak (hangi üyeye/klasöre ait olduğu bilinmeden R2'ye yazılmaz).`);
      });
    }
  }
  return { tablolar: [...tablolar.values()].sort((a, b) => siraNo(a.tablo) - siraNo(b.tablo) || a.tablo.localeCompare(b.tablo)), r2, notlar };
}

/* ------------------------------ arayüz ------------------------------ */

export async function icAktarCiz(kok, mesaj, { uye = false } = {}) {
  let uid = null;
  if (uye) {
    const { data: o } = await supabase.auth.getUser();
    uid = o?.user?.id || null;
    if (!uid) { kok.replaceChildren(el("p", { class: "auth-message error", text: "Oturum bulunamadı." })); return; }
  }
  const ctx = { uye, uid };
  const { data: sema, error: se } = await supabase.rpc(uye ? "uye_geri_yukleme_tablolari" : "sistem_geri_yukleme_tablolari");
  if (se) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(se) })); return; }

  let plan = null;
  let denetci = null;
  const girdi = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "Yedek veya dosya seç" });
  const surukle = el("div", { class: "sy-ia-birak", role: "button", tabindex: "0", "aria-label": "Yedek dosyalarını seç ya da buraya bırak" },
    ikon("yukle"), el("strong", { text: "Tam yedek (.zip) ya da tekil dosyalar seç / buraya bırak" }),
    el("span", { class: "muted", text: "ZIP yedeği, tablo JSON'ları, PDF/görsel/.sifreli dosyalar. Dosyalar tarayıcında okunur; yalnızca onayladığın kayıtlar yazılır." }));
  const durum = el("p", { class: "muted sy-not", role: "status", "aria-live": "polite" });
  const planKutu = el("div", { class: "sy-ia-plan" });
  const sonucKutu = el("div", { class: "sy-ia-sonuc" });
  let mod = "eksikleri";

  const modSec = (deger, baslik, acik) => {
    const r = el("input", { type: "radio", name: "sy-ia-mod", value: deger, checked: deger === mod });
    r.addEventListener("change", () => { mod = deger; });
    return el("label", { class: "sy-secenek sy-secenek--kucuk" }, r, el("span", { class: "sy-secenek-metin" }, el("strong", { text: baslik }), el("small", { text: acik })));
  };

  async function dosyaAl(liste) {
    sonucKutu.replaceChildren();
    plan = null;
    planKutu.replaceChildren();
    if (!liste.length) return;
    try {
      plan = await analizEt(liste, sema, (m) => { durum.textContent = m; }, ctx);
      durum.textContent = "";
      planCiz();
    } catch (h) { durum.textContent = ""; mesaj(`Analiz başarısız: ${hataMetni(h)}`); }
  }

  function planCiz() {
    const tSatir = plan.tablolar.map((t) => {
      const k = el("input", { type: "checkbox", checked: true, "aria-label": `${t.tablo} tablosunu geri yükle` });
      k.addEventListener("change", () => { t.secili = k.checked; });
      t.secili = true;
      return el("li", { class: "sy-ia-satir" }, k,
        el("code", { text: t.tablo }),
        el("span", { class: "muted", text: `${t.satirlar.length.toLocaleString("tr-TR")} satır · ${t.yontem}` }),
        t.korumali ? el("span", { class: "sy-rozet sy-rozet--uyari", title: "Korumalı tablo: yalnızca eksik satırlar eklenir, mevcutlar ezilmez." }, "🔒 yalnızca eksikler") : null);
    });
    const rSatir = plan.r2.map((r) => {
      const k = el("input", { type: "checkbox", checked: !!r.kaynak, disabled: !r.kaynak && !r.adaylar, "aria-label": `${r.ad} dosyasını geri yükle` });
      r.secili = !!r.kaynak;
      k.addEventListener("change", () => { r.secili = k.checked; });
      let hedef;
      if (r.kaynak) hedef = el("span", { class: "muted", text: `${R2_KAYNAK_ADLARI[r.kaynak]} · ${r.etiket || r.anahtar}` });
      else {
        const s = el("select", { "aria-label": `${r.ad} için hedef` }, el("option", { value: "", text: "— hedef seç —" }),
          ...r.adaylar.map((a, i) => el("option", { value: String(i), text: `${R2_KAYNAK_ADLARI[a.kaynak]} · ${a.etiket || a.anahtar}` })));
        s.addEventListener("change", () => { const a = r.adaylar[Number(s.value)]; r.kaynak = a ? a.kaynak : null; r.anahtar = a?.anahtar; r.secili = !!a; k.checked = !!a; });
        hedef = s;
      }
      return el("li", { class: "sy-ia-satir" }, k, el("span", { class: "sy-ia-ad", text: r.ad }), el("span", { class: "muted", text: bayt(r.boyut) }), hedef);
    });
    const basla = dugme({ metin: "Geri yüklemeyi başlat", ikonAdi: "geri", tur: "birincil", disabled: !plan.tablolar.length && !plan.r2.length });
    basla.addEventListener("click", () => calistir(basla));
    planKutu.replaceChildren(
      el("h3", { text: "Analiz sonucu" }),
      plan.tablolar.length ? el("div", {}, el("strong", { text: "Veritabanı tabloları" }), el("ul", { class: "sy-ia-liste" }, tSatir)) : null,
      plan.r2.length ? el("div", {}, el("strong", { text: "R2 dosyaları" }), el("ul", { class: "sy-ia-liste" }, rSatir)) : null,
      plan.notlar.length ? el("div", { class: "sy-bilgi sy-bilgi--uyari" }, ikon("uyari"), el("ul", { class: "sy-ia-notlar" }, plan.notlar.slice(0, 30).map((n) => el("li", { text: n })))) : null,
      !plan.tablolar.length && !plan.r2.length ? el("p", { class: "auth-message error", text: "Geri yüklenebilecek bir şey bulunamadı." }) : null,
      el("div", { class: "sy-secenekler" }, el("strong", { text: "Çakışma yönetimi" }),
        modSec("eksikleri", "Yalnızca eksikleri tamamla", "Mevcut kayıt/dosya olduğu gibi kalır; yalnızca olmayanlar eklenir. (Önerilen)"),
        modSec("uzerine", "Üzerine yaz", "Aynı kimlikli kayıtlar ve aynı yoldaki dosyalar yedektekiyle DEĞİŞTİRİLİR. Korumalı tablolarda uygulanmaz.")),
      el("div", { class: "sy-eylemler" }, basla)
    );
  }

  async function calistir(basla) {
    const tSec = plan.tablolar.filter((t) => t.secili);
    const rSec = plan.r2.filter((r) => r.secili && r.kaynak);
    if (!tSec.length && !rSec.length) return mesaj("Geri yüklenecek bir öğe seç.");
    const tamam = await onayIste({
      baslik: mod === "uzerine" ? "Mevcut veriler yedektekiyle EZİLSİN mi?" : "Eksik veriler geri yüklensin mi?",
      metin: [`${tSec.length} tablo (${tSec.reduce((n, t) => n + t.satirlar.length, 0).toLocaleString("tr-TR")} satır) ve ${rSec.length} R2 dosyası işlenecek.`,
        mod === "uzerine" ? "Üzerine yazma geri alınamaz; önce güncel bir yedek almanı öneririz." : "Mevcut kayıtlara dokunulmaz.", "İşlem denetim günlüğüne kaydedilir."],
      tamam: "Başlat", tehlike: mod === "uzerine",
    });
    if (!tamam) return;

    basla.disabled = true;
    denetci = new AbortController();
    const iptal = dugme({ metin: "İptal", ikonAdi: "durdur", tur: "ikincil", kucuk: true });
    iptal.addEventListener("click", () => denetci?.abort());
    const asama = el("p", { class: "sy-asama", text: "Başlıyor…" });
    sonucKutu.replaceChildren(el("progress", { class: "sy-cubuk sy-cubuk--bekle", "aria-label": "Geri yükleme sürüyor" }), asama, iptal);

    const rapor = { tablolar: {}, dosyalar: { yazildi: 0, atlandi: 0, hata: [] }, mod };
    let islem = null;
    try {
      if (!uye) { // denetim günlüğü yalnızca Site Sahibi işlemleri için (üyenin kendi geri yüklemesi kendi verisidir)
        const b = await supabase.rpc("sistem_islem_baslat", { p_tur: "geri_yukleme", p_ayrinti: { mod, tablolar: tSec.map((t) => t.tablo), dosya: rSec.length } });
        if (b.error) throw b.error;
        islem = b.data;
      }
      const iptalKontrol = () => { if (denetci.signal.aborted) throw new DOMException("İptal edildi", "AbortError"); };

      // 1) tablolar — en çok 3 tur; FK hatası alan tablolar sonraki turda "eksikleri" kipiyle tekrar denenir
      let bekleyen = tSec;
      for (let tur = 1; tur <= 3 && bekleyen.length; tur++) {
        const sonraki = [];
        for (const t of bekleyen) {
          const m = tur === 1 ? mod : "eksikleri";
          const top = rapor.tablolar[t.tablo] || { eklenen: 0, guncellenen: 0, atlanan: 0, hatali: 0, hatalar: [] };
          let hataliBu = 0;
          for (let i = 0; i < t.satirlar.length; i += SAYFA) {
            iptalKontrol();
            asama.textContent = `Tablo ${t.tablo} (tur ${tur}) — ${Math.min(i + SAYFA, t.satirlar.length)}/${t.satirlar.length}`;
            const { data, error } = await supabase.rpc(uye ? "uye_geri_yukle_tablo" : "sistem_geri_yukle_tablo", { p_tablo: t.tablo, p_satirlar: t.satirlar.slice(i, i + SAYFA), p_mod: m });
            if (error) throw new Error(`${t.tablo}: ${hataMetni(error)}`);
            top.eklenen += data.eklenen; top.guncellenen += data.guncellenen; hataliBu += data.hatali;
            if (tur === 1) top.atlanan += data.atlanan;
            for (const h of data.hatalar || []) if (top.hatalar.length < 5 && !top.hatalar.includes(h)) top.hatalar.push(h);
          }
          top.hatali = hataliBu; // son turdaki kalan hata
          rapor.tablolar[t.tablo] = top;
          if (hataliBu && tur < 3) sonraki.push(t);
        }
        bekleyen = sonraki;
      }

      // 2) R2 dosyaları (tek tek; Worker gövde sınırı aşılırsa o dosya "hata" olarak raporlanır, diğerleri sürer)
      let n = 0;
      for (const r of rSec) {
        iptalKontrol();
        n += 1;
        asama.textContent = `R2 dosyası ${n}/${rSec.length}: ${r.ad}`;
        try {
          const blob = await r.al();
          const res = await workerFetch(`${uye ? "/uye/yukle" : "/r2/yukle"}?b=${r.kaynak}&k=${encodeURIComponent(r.anahtar)}&m=${mod}`, { yontem: "PUT", govde: blob, sinyal: denetci.signal });
          const g = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(g.error || `HTTP ${res.status}`);
          if (g.durum === "atlandi") rapor.dosyalar.atlandi += 1; else rapor.dosyalar.yazildi += 1;
        } catch (h) {
          if (h?.name === "AbortError") throw h;
          rapor.dosyalar.hata.push(`${r.ad}: ${h.message || h}`);
        }
      }
      const hatali = Object.values(rapor.tablolar).reduce((x, t) => x + t.hatali, 0) + rapor.dosyalar.hata.length;
      if (islem) await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: true, p_ozet: { tablolar: rapor.tablolar, dosyalar: { yazildi: rapor.dosyalar.yazildi, atlandi: rapor.dosyalar.atlandi, hata: rapor.dosyalar.hata.length } } });
      raporCiz(rapor);
      mesaj(hatali ? `Geri yükleme bitti; ${hatali} kayıt/dosya aktarılamadı (raporda).` : "Geri yükleme tamamlandı.", hatali ? "error" : "success");
    } catch (h) {
      if (islem) { try { await supabase.rpc("sistem_islem_bitir", { p_id: islem, p_basarili: false, p_ozet: { hata: String(h.message || h).slice(0, 300) } }); } catch { /* best-effort */ } }
      raporCiz(rapor);
      mesaj(h?.name === "AbortError" ? "Geri yükleme iptal edildi (o ana dek yazılanlar kalır; işlem tekrarlanabilir)." : `Geri yükleme durdu: ${hataMetni(h)}`);
    } finally {
      denetci = null;
      basla.disabled = false;
      // gizlilik/bellek: yedek içeriğini bellekten bırak
      for (const t of plan?.tablolar || []) t.satirlar = [];
      for (const r of plan?.r2 || []) r.al = null;
      plan = null;
    }
  }

  function raporCiz(r) {
    const tab = Object.entries(r.tablolar);
    const indir = dugme({ metin: "Raporu indir (JSON)", ikonAdi: "indir", tur: "ikincil", kucuk: true });
    indir.addEventListener("click", () => {
      const u = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
      const a = el("a", { href: u, download: `geri-yukleme-raporu-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    });
    sonucKutu.replaceChildren(
      el("h3", { text: "Geri yükleme raporu" }),
      tab.length ? el("ul", { class: "sy-ia-liste" }, tab.map(([ad, t]) => el("li", { class: "sy-ia-satir" }, el("code", { text: ad }),
        el("span", { class: "muted", text: `+${t.eklenen} eklendi · ${t.guncellenen} güncellendi · ${t.atlanan} zaten vardı${t.hatali ? ` · ${t.hatali} HATALI` : ""}` }),
        t.hatalar.length ? el("small", { class: "muted", text: t.hatalar[0] }) : null))) : null,
      el("p", { text: `R2: ${r.dosyalar.yazildi} yazıldı · ${r.dosyalar.atlandi} zaten vardı · ${r.dosyalar.hata.length} hata` }),
      r.dosyalar.hata.length ? el("ul", { class: "sy-ia-notlar" }, r.dosyalar.hata.slice(0, 20).map((h) => el("li", { text: h }))) : null,
      indir
    );
    planKutu.replaceChildren();
  }

  surukle.addEventListener("click", () => girdi.click());
  surukle.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); girdi.click(); } });
  for (const o of ["dragenter", "dragover"]) surukle.addEventListener(o, (e) => { e.preventDefault(); surukle.classList.add("sy-ia-birak--ustte"); });
  for (const o of ["dragleave", "drop"]) surukle.addEventListener(o, (e) => { e.preventDefault(); surukle.classList.remove("sy-ia-birak--ustte"); });
  surukle.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) dosyaAl([...e.dataTransfer.files]); });
  girdi.addEventListener("change", () => { const l = [...girdi.files]; girdi.value = ""; dosyaAl(l); });

  kok.replaceChildren(
    el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: uye ? "Kendi yedeğini (indirdiğin ZIP ya da tek tek dosyalar) kendi hesabına geri yükle. Hesabını silip yeniden açtıysan da çalışır: kayıtlar yeni hesabına bağlanır. Yalnızca notlar, kaynaklar ve dosyalar geri yüklenir; hesap/rol/yetki bilgileri yüklenmez." : "Yalnızca Site Sahibi. Tablolar veritabanında, dosyalar Worker üzerinden R2'ye yazılır; her işlem günlüğe kaydedilir. Auth hesapları (giriş bilgileri) yedekten geri yüklenemez." })),
    surukle, girdi, durum, planKutu, sonucKutu
  );
}
