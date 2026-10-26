/*
 * assets/js/sistem-yedek/disa-aktar.js — dışa aktarma MOTORU (arayüzsüz).
 * -----------------------------------------------------------------------
 * Akış:  sistem_export_baslat (denetim kaydı ÖNCE) → tablo sayfaları (RPC, kapsamı veritabanı belirler)
 *        → R2 dosyaları + GitHub zip (Worker, oturum kimliğiyle) → tek ZIP (akışlı) → sistem_export_tamamla.
 * Yetki ve veri izolasyonu veritabanındadır (migration 0074); bu dosya yalnızca paketi kurar.
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { AkisliZip, zipGirisleri, zipGirisOku } from "./zip-yazici.js";
import { workerFetch, hataMetni, bugunDamga } from "./ortak.js";

const SIRA = ["profiles", "e2ee_kullanici_anahtarlari", "not_kasasi", "notlar", "not_ek_kayitlari", "akademik_kaynaklar", "akademik_koleksiyonlar", "akademik_koleksiyon_ogeleri", "akademik_notlar", "akademik_eklenti_ayarlari", "r2_arsiv", "taslak_icerikler", "special_content", "content_access"];
const SAYFA = { notlar: 25, akademik_kaynaklar: 100, akademik_notlar: 100, akademik_koleksiyonlar: 200, akademik_koleksiyon_ogeleri: 500, special_content: 50, taslak_icerikler: 50, messages: 200 };
const kodla = new TextEncoder();

const siraNo = (t) => { const i = SIRA.indexOf(t); return i < 0 ? 999 : i; };

/* ------------------------------ SQL dump yardımcıları ------------------------------ */

const tirnak = (s) => `'${String(s).replace(/'/g, "''")}'`;
const kimlik = (s) => `"${String(s).replace(/"/g, '""')}"`;

function dizi(a) {
  const ogeler = a.map((x) => {
    if (x == null) return "NULL";
    if (typeof x === "object") return `"${JSON.stringify(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${ogeler.join(",")}}`;
}

function deger(v, tip) {
  if (v === null || v === undefined) return "NULL";
  if (/\[\]$/.test(tip)) return `${tirnak(dizi(v))}::${tip}`;
  if (/^jsonb?$/.test(tip)) return `${tirnak(JSON.stringify(v))}::${tip}`;
  if (tip === "boolean") return v ? "true" : "false";
  if (/^(smallint|integer|bigint|numeric|real|double precision)/.test(tip)) return String(v);
  return tirnak(typeof v === "object" ? JSON.stringify(v) : v);
}

function insertSatirlari(tablo, kolonlar, satirlar) {
  const kul = kolonlar.filter((k) => !k.uretilmis);
  const adlar = kul.map((k) => kimlik(k.ad)).join(", ");
  return satirlar
    .map((s) => `INSERT INTO public.${kimlik(tablo)} (${adlar}) VALUES (${kul.map((k) => deger(s[k.ad], k.tip)).join(", ")}) ON CONFLICT DO NOTHING;`)
    .join("\n") + (satirlar.length ? "\n" : "");
}

/* ------------------------------------ tablo okuma ------------------------------------ */

async function sayfalar(oturum, tablo, kolonSayisi, sinyal, her) {
  const adet = SAYFA[tablo] || 300;
  let ofset = 0;
  let toplam = 0;
  for (;;) {
    if (sinyal?.aborted) throw new DOMException("İptal edildi", "AbortError");
    const { data, error } = await supabase.rpc("sistem_export_tablo_oku", { p_id: oturum, p_tablo: tablo, p_ofset: ofset, p_adet: adet });
    if (error) throw new Error(`${tablo}: ${hataMetni(error)}`);
    const satirlar = data || [];
    if (satirlar.length) await her(satirlar);
    toplam += satirlar.length;
    if (satirlar.length < adet) break;
    ofset += adet;
  }
  return toplam;
}

/* Akademik yedek düzeni: PDF'ler "akademik/dosyalar/<Kullanıcı Adı>/<Klasör yolu>/<Başlık>.pdf" altına konur (kullanıcının kendi klasörleme düzeniyle).
   Bunun için ilgili tablolar JSON/SQL yazılırken bellekte (yalnızca küçük künye alanları) toplanır. */
const AK = { kaynak: [], klasor: [], oge: [], uye: new Map() };
const AK_TABLO = new Set(["akademik_kaynaklar", "akademik_koleksiyonlar", "akademik_koleksiyon_ogeleri", "profiles"]);
function akTopla(tablo, satirlar) {
  if (!AK_TABLO.has(tablo)) return;
  for (const s of satirlar) {
    if (tablo === "akademik_kaynaklar") AK.kaynak.push({ id: s.id, user_id: s.user_id, baslik: s.baslik, yil: s.yayin_yili, yazarlar: s.yazarlar, pdf: s.pdf_r2_yolu, dosya: s.pdf_dosya_adi });
    else if (tablo === "akademik_koleksiyonlar") AK.klasor.push({ id: s.id, user_id: s.user_id, ust_id: s.ust_id, ad: s.ad });
    else if (tablo === "akademik_koleksiyon_ogeleri") AK.oge.push({ k: s.koleksiyon_id, s: s.kaynak_id });
    else if (tablo === "profiles") AK.uye.set(s.id, s.full_name || s.email || "");
  }
}
const guvenliAd = (s, yedek = "adsiz") => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || yedek;
function akKlasorYolu(id) {
  const harita = new Map(AK.klasor.map((k) => [k.id, k])); const parca = []; let k = harita.get(id), n = 0;
  while (k && n++ < 20) { parca.unshift(guvenliAd(k.ad, "klasor")); k = k.ust_id ? harita.get(k.ust_id) : null; }
  return parca;
}
function akPdfYolu(anahtar) {
  const k = AK.kaynak.find((x) => x.pdf === anahtar);
  if (!k) return null;
  const uye = guvenliAd(AK.uye.get(k.user_id) || String(k.user_id).slice(0, 8), "uye");
  const og = AK.oge.find((o) => o.s === k.id);
  const yol = og ? akKlasorYolu(og.k) : [];
  const ad = `${guvenliAd(k.baslik)} [${String(k.id).slice(0, 8)}].pdf`;
  return ["akademik", "dosyalar", uye, ...(yol.length ? yol : ["Klasörsüz"]), ad].join("/");
}
function akAgacMetni() {
  const satir = ["AKADEMİK KÜTÜPHANE — KLASÖR AĞACI (kullanıcıların kendi düzeniyle)", ""];
  const uyeler = [...new Set(AK.kaynak.map((k) => k.user_id).concat(AK.klasor.map((k) => k.user_id)))];
  for (const u of uyeler) {
    satir.push(`■ ${AK.uye.get(u) || u}`);
    const kl = AK.klasor.filter((k) => k.user_id === u);
    const yaz = (ust, girinti) => {
      for (const k of kl.filter((x) => (x.ust_id || null) === ust).sort((a, b) => a.ad.localeCompare(b.ad, "tr"))) {
        satir.push(`${girinti}📁 ${k.ad}`);
        for (const o of AK.oge.filter((x) => x.k === k.id)) { const s = AK.kaynak.find((x) => x.id === o.s); if (s) satir.push(`${girinti}   • ${s.baslik}${s.yil ? ` (${s.yil})` : ""}`); }
        yaz(k.id, `${girinti}   `);
      }
    };
    yaz(null, "  ");
    const dosyalanmamis = AK.kaynak.filter((s) => s.user_id === u && !AK.oge.some((o) => o.s === s.id));
    if (dosyalanmamis.length) { satir.push("  📁 Klasörsüz"); for (const s of dosyalanmamis) satir.push(`     • ${s.baslik}${s.yil ? ` (${s.yil})` : ""}`); }
    satir.push("");
  }
  return satir.join("\n");
}

async function veritabaniYaz(zip, oturum, tablolar, bicimler, ilerleme, sinyal, ozet) {
  AK.kaynak.length = 0; AK.klasor.length = 0; AK.oge.length = 0; AK.uye.clear();
  const gruplar = new Map();
  for (const t of tablolar) {
    if (!gruplar.has(t.hedef)) gruplar.set(t.hedef, []);
    gruplar.get(t.hedef).push(t);
  }
  for (const [hedef, liste] of gruplar) {
    liste.sort((a, b) => siraNo(a.tablo) - siraNo(b.tablo) || a.tablo.localeCompare(b.tablo));
    const say = {};

    if (bicimler.json) {
      for (const t of liste) {
        ilerleme({ asama: `Veritabanı (JSON): ${t.tablo}` });
        const giris = await zip.akisAc(`${hedef}/json/${t.tablo}.json`);
        let ilk = true;
        await giris.yaz(kodla.encode("[\n"));
        const n = await sayfalar(oturum, t.tablo, t.kolonlar.length, sinyal, async (satirlar) => {
          akTopla(t.tablo, satirlar);
          const metin = satirlar.map((s) => JSON.stringify(s)).join(",\n");
          await giris.yaz(kodla.encode((ilk ? "" : ",\n") + metin));
          ilk = false;
        });
        await giris.yaz(kodla.encode("\n]\n"));
        await giris.bitir();
        say[t.tablo] = n;
      }
    }

    if (bicimler.sql) {
      const giris = await zip.akisAc(`${hedef}/yedek-${bugunDamga()}.sql`);
      await giris.yaz(kodla.encode(
        `-- Sistem yedeği (${hedef}) — ${new Date().toISOString()}\n-- Satırlar INSERT ... ON CONFLICT DO NOTHING ile yazılır; aynı dosya tekrar çalıştırılabilir.\n` +
        `-- Bağımlılık sırasıyla dizilmiştir. profiles satırları auth.users'ta karşılığı olan hesaplar içindir.\n\nBEGIN;\n\n`
      ));
      for (const t of liste) {
        ilerleme({ asama: `Veritabanı (SQL): ${t.tablo}` });
        await giris.yaz(kodla.encode(`-- Tablo: ${t.tablo}\n`));
        const n = await sayfalar(oturum, t.tablo, t.kolonlar.length, sinyal, (satirlar) =>
          { if (!bicimler.json) akTopla(t.tablo, satirlar); return giris.yaz(kodla.encode(insertSatirlari(t.tablo, t.kolonlar, satirlar))); }
        );
        await giris.yaz(kodla.encode(`-- ${n} satır\n\n`));
        say[t.tablo] = n;
      }
      await giris.yaz(kodla.encode("COMMIT;\n"));
      await giris.bitir();
    }
    ozet.tablolar[hedef] = say;
  }
}

/* ------------------------------------- R2 dosyaları ------------------------------------- */

function r2Yolu(d) {
  if (d.kaynak === "akademik") return akPdfYolu(d.anahtar) || `r2/${d.anahtar}`;
  if (d.kaynak === "arsiv") return `r2/dosya-yoneticisi/${d.ad}${d.sifreli ? ".sifreli" : ""}`;
  return `notlar/ekler/${d.ad}`;
}

async function r2Yaz(zip, oturum, ilerleme, sinyal, ozet) {
  const r = await workerFetch(`/r2/liste?e=${oturum}`, { sinyal });
  const liste = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`R2 listesi alınamadı: ${liste?.error || r.status}`);
  const manifest = [];
  let i = 0;
  for (const d of liste) {
    i += 1;
    if (sinyal?.aborted) throw new DOMException("İptal edildi", "AbortError");
    const yol = r2Yolu(d);
    const kayit = { kaynak: d.kaynak, anahtar: d.anahtar, yol, boyut: d.boyut, sifreli: !!d.sifreli };
    if (!d.bagli) {
      kayit.hata = "Worker'da bu kaynağın R2 binding'i bağlı değil.";
      ozet.hatalar.push(`${d.kaynak}: ${d.anahtar} (binding yok)`);
      manifest.push(kayit);
      continue;
    }
    ilerleme({ asama: `R2 dosyaları (${i}/${liste.length})`, ayrinti: d.ad });
    try {
      const res = await workerFetch(`/r2/dosya?e=${oturum}&b=${d.kaynak}&k=${encodeURIComponent(d.anahtar)}`, { sinyal });
      if (!res.ok || !res.body) {
        const g = await res.json().catch(() => ({}));
        throw new Error(g.error || `HTTP ${res.status}`);
      }
      kayit.yol = zip.benzersiz(yol);
      kayit.boyut = await zip.akisEkle(yol, res.body, { sinyal });
      ozet.r2.adet += 1;
      ozet.r2.bayt += kayit.boyut;
    } catch (h) {
      if (h?.name === "AbortError") throw h;
      kayit.hata = String(h?.message || h);
      ozet.hatalar.push(`${d.kaynak}: ${d.anahtar} (${kayit.hata})`);
    }
    manifest.push(kayit);
  }
  await zip.dosyaEkle("r2/MANIFEST.json", JSON.stringify(manifest, null, 2));
  if (AK.kaynak.length || AK.klasor.length) await zip.dosyaEkle("akademik/KLASOR-AGACI.txt", akAgacMetni());
}

/* ------------------------------ GitHub zip + .md içerik ------------------------------ */

async function githubYaz(zip, oturum, secili, ilerleme, sinyal, ozet) {
  const bilesen = secili.has("github") ? "github" : "icerik_md";
  ilerleme({ asama: "GitHub deposu indiriliyor…" });
  const res = await workerFetch(`/github/zip?e=${oturum}&b=${bilesen}`, { sinyal });
  if (!res.ok || !res.body) {
    const g = await res.json().catch(() => ({}));
    throw new Error(`GitHub zip alınamadı: ${g.error || res.status}`);
  }
  const blob = await res.blob();
  if (secili.has("github")) {
    await zip.akisEkle(`github/kaynak-kod-${bugunDamga()}.zip`, blob.stream(), { sinyal });
    ozet.github.bayt = blob.size;
  }
  if (secili.has("icerik_md")) {
    ilerleme({ asama: "İçerik (.md) ayıklanıyor…" });
    const girisler = (await zipGirisleri(blob)).filter((g) => !g.dizin && /\.(md|markdown)$/i.test(g.ad));
    for (const g of girisler) {
      const yol = g.ad.split("/").slice(1).join("/");
      if (!yol || /^(node_modules|_site|vendor|\.git)\//.test(yol)) continue;
      await zip.dosyaEkle(`icerik-md/${yol}`, await zipGirisOku(blob, g));
      ozet.icerik.adet += 1;
    }
  }
}

/* ------------------------------------- ana akış ------------------------------------- */

export function dosyaAdi() {
  return `site-yedek-${bugunDamga()}.zip`;
}

/**
 * @param {object} p { bilesenler:Set<string>, kapsam:'kendi'|'secili'|'tum', hedefler:string[] (kapsam='secili' iken üye id'leri), hedefAdlari:string[], hassas:boolean, bicimler:{json,sql}, alici, ilerleme(fn), sinyal }
 * @returns {Promise<{boyut:number, blob:Blob|null, ozet:object}>}
 */
export async function yedekAl({ bilesenler, kapsam, hedefler = [], hedefAdlari = [], hassas, bicimler, alici, ilerleme, sinyal, ekDosyalar = [], sadeceEk = false }) {
  const secili = new Set(bilesenler);
  const { data: oturum, error } = await supabase.rpc("sistem_export_baslat", {
    p_bilesenler: [...secili], p_kapsam: kapsam, p_hassas: !!hassas, p_hedefler: kapsam === "secili" ? hedefler : [],
  });
  if (error) {
    await alici.iptal();
    throw new Error(hataMetni(error));
  }

  const zip = new AkisliZip(alici);
  const ozet = {
    surum: 2, olusturma: new Date().toISOString(), kapsam, hedefUyeler: kapsam === "secili" ? hedefAdlari : [], bilesenler: [...secili],
    tablolar: {}, r2: { adet: 0, bayt: 0 }, github: { bayt: 0 }, icerik: { adet: 0 }, hatalar: [],
  };

  try {
    if (!sadeceEk && (secili.has("veritabani") || secili.has("notlar") || secili.has("akademik"))) {
      ilerleme({ asama: "Tablo listesi alınıyor…" });
      const { data: tablolar, error: te } = await supabase.rpc("sistem_export_tablo_listesi", { p_id: oturum });
      if (te) throw new Error(hataMetni(te));
      if (!bicimler.json && !bicimler.sql) throw new Error("Veritabanı için en az bir biçim (JSON / SQL) seç.");
      await veritabaniYaz(zip, oturum, tablolar || [], bicimler, ilerleme, sinyal, ozet);
    }
    if (!sadeceEk && (secili.has("r2") || secili.has("notlar") || secili.has("akademik"))) {
      await r2Yaz(zip, oturum, ilerleme, sinyal, ozet);
    }
    if (secili.has("github") || secili.has("icerik_md")) {
      await githubYaz(zip, oturum, secili, ilerleme, sinyal, ozet);
    }

    for (const e of ekDosyalar) await zip.dosyaEkle(e.ad, e.icerik); // örn. mesajlar/mesajlarim.parolali.json (istemcide parolayla şifrelenmiş)
    ilerleme({ asama: "Paket kapatılıyor…" });
    await zip.dosyaEkle("manifest.json", JSON.stringify(ozet, null, 2));
    await zip.dosyaEkle("OKUBENI.txt", okubeni(ozet));
    const sonuc = await zip.bitir();
    await supabase.rpc("sistem_export_tamamla", { p_id: oturum, p_boyut: sonuc.boyut, p_basarili: true });
    return { boyut: sonuc.boyut, blob: sonuc.blob, ozet };
  } catch (h) {
    await zip.iptal();
    await supabase.rpc("sistem_export_tamamla", { p_id: oturum, p_boyut: 0, p_basarili: false });
    throw h;
  }
}

function okubeni(o) {
  return [
    "SİTE SİSTEM YEDEĞİ",
    `Oluşturma: ${o.olusturma}`,
    `Kapsam   : ${o.kapsam === "tum" ? "TÜM SİSTEM (felaket yedeği, yalnızca Site Sahibi)" : o.kapsam === "secili" ? `SEÇİLİ ÜYELER (${(o.hedefUyeler || []).join(", ")}) — yalnızca Site Sahibi` : "Yalnızca oturumu açan kullanıcının kendi verileri"}`,
    `Bileşenler: ${o.bilesenler.join(", ")}`,
    "",
    "KLASÖRLER",
    "  veritabani/json/<tablo>.json   Tablo başına JSON (to_jsonb çıktısı)",
    "  veritabani/yedek-*.sql         INSERT ... ON CONFLICT DO NOTHING (bağımlılık sırasıyla)",
    "  notlar/                        Kişisel notlar, alıntılar, kaynaklar (+ ekler/)",
    "  akademik/json/<tablo>.json     Akademik Kütüphane: künyeler, klasörler, vurgu/yorumlar (konum dahil), notlar",
    "  akademik/dosyalar/<Kullanıcı Adı>/<Klasör>/…pdf   PDF'ler kullanıcının kendi klasör düzeniyle · akademik/KLASOR-AGACI.txt okunabilir ağaç (r2/MANIFEST.json yine anahtar↔yol eşlemesini tutar)",
    "  r2/                            R2 dosyaları + MANIFEST.json (anahtar ↔ paket yolu eşlemesi)",
    "  notlar/ekler/                  Şifreli not ekleri (TÜM SİSTEM yedeğinde notlar/ekler/<kullanıcı-id>/<ek-id>.bin); notların ve klasör ağacının kendisi şifrelidir",
    "  icerik-md/                     Depodaki tüm .md dosyaları (klasör yapısı korunur)",
    "  github/                        Kaynak kod zip'i",
    "",
    "ÖNEMLİ",
    "  * Kişisel Notlar bileşeni her zaman yalnızca paketi alan kişinin kendi notlarını içerir.",
    "  * Notlar ve .sifreli uzantılı dosyalar UÇTAN UCA ŞİFRELİDİR; bu pakette şifreli halleriyle durur.",
    "    Açabilmek için kullanıcının parolası ya da Yedek Kurtarma Kodu (Notlar + Mesajlar için TEK 16 haneli kod) gerekir; kod blobu (e2ee_kullanici_anahtarlari) ve not_kasasi sarılı anahtarları da pakettedir.",
    "  * Parolalar, 2FA yedek kodları ve servis anahtarları pakete HİÇBİR ZAMAN girmez.",
    "  * SQL geri yükleme: önce migration'ları uygula, sonra dosyayı Supabase SQL Editor'de çalıştır.",
    o.hatalar.length ? `\nUYARILAR (${o.hatalar.length}):\n  - ${o.hatalar.slice(0, 50).join("\n  - ")}` : "",
    "",
  ].join("\n");
}
