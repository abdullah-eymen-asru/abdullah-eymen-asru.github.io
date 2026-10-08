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

const SIRA = ["profiles", "e2ee_kullanici_anahtarlari", "not_kasasi", "notlar", "not_ek_kayitlari", "akademik_kaynaklar", "akademik_notlar", "r2_arsiv", "taslak_icerikler", "special_content", "content_access"];
const SAYFA = { notlar: 25, akademik_kaynaklar: 100, akademik_notlar: 100, special_content: 50, taslak_icerikler: 50, messages: 200 };
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

async function veritabaniYaz(zip, oturum, tablolar, bicimler, ilerleme, sinyal, ozet) {
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
          giris.yaz(kodla.encode(insertSatirlari(t.tablo, t.kolonlar, satirlar)))
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
  if (d.kaynak === "akademik") return `r2/${d.anahtar}`;
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
 * @param {object} p { bilesenler:Set<string>, kapsam:'kendi'|'tum', hassas:boolean, bicimler:{json,sql}, alici, ilerleme(fn), sinyal }
 * @returns {Promise<{boyut:number, blob:Blob|null, ozet:object}>}
 */
export async function yedekAl({ bilesenler, kapsam, hassas, bicimler, alici, ilerleme, sinyal }) {
  const secili = new Set(bilesenler);
  const { data: oturum, error } = await supabase.rpc("sistem_export_baslat", {
    p_bilesenler: [...secili], p_kapsam: kapsam, p_hassas: !!hassas,
  });
  if (error) {
    await alici.iptal();
    throw new Error(hataMetni(error));
  }

  const zip = new AkisliZip(alici);
  const ozet = {
    surum: 1, olusturma: new Date().toISOString(), kapsam, bilesenler: [...secili],
    tablolar: {}, r2: { adet: 0, bayt: 0 }, github: { bayt: 0 }, icerik: { adet: 0 }, hatalar: [],
  };

  try {
    if (secili.has("veritabani") || secili.has("notlar")) {
      ilerleme({ asama: "Tablo listesi alınıyor…" });
      const { data: tablolar, error: te } = await supabase.rpc("sistem_export_tablo_listesi", { p_id: oturum });
      if (te) throw new Error(hataMetni(te));
      if (!bicimler.json && !bicimler.sql) throw new Error("Veritabanı için en az bir biçim (JSON / SQL) seç.");
      await veritabaniYaz(zip, oturum, tablolar || [], bicimler, ilerleme, sinyal, ozet);
    }
    if (secili.has("r2") || secili.has("notlar")) {
      await r2Yaz(zip, oturum, ilerleme, sinyal, ozet);
    }
    if (secili.has("github") || secili.has("icerik_md")) {
      await githubYaz(zip, oturum, secili, ilerleme, sinyal, ozet);
    }

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
    `Kapsam   : ${o.kapsam === "tum" ? "TÜM SİSTEM (felaket yedeği, yalnızca Site Sahibi)" : "Yalnızca oturumu açan kullanıcının kendi verileri"}`,
    `Bileşenler: ${o.bilesenler.join(", ")}`,
    "",
    "KLASÖRLER",
    "  veritabani/json/<tablo>.json   Tablo başına JSON (to_jsonb çıktısı)",
    "  veritabani/yedek-*.sql         INSERT ... ON CONFLICT DO NOTHING (bağımlılık sırasıyla)",
    "  notlar/                        Kişisel notlar, alıntılar, kaynaklar (+ ekler/)",
    "  r2/                            R2 dosyaları + MANIFEST.json (anahtar ↔ paket yolu eşlemesi)",
    "  icerik-md/                     Depodaki tüm .md dosyaları (klasör yapısı korunur)",
    "  github/                        Kaynak kod zip'i",
    "",
    "ÖNEMLİ",
    "  * Notlar ve .sifreli uzantılı dosyalar UÇTAN UCA ŞİFRELİDİR; bu pakette şifreli halleriyle durur.",
    "    Açabilmek için kullanıcının parolası/kurtarma anahtarı gerekir (not_kasasi tablosundaki sarılı anahtarlar da pakettedir).",
    "  * Parolalar, 2FA yedek kodları ve servis anahtarları pakete HİÇBİR ZAMAN girmez.",
    "  * SQL geri yükleme: önce migration'ları uygula, sonra dosyayı Supabase SQL Editor'de çalıştır.",
    o.hatalar.length ? `\nUYARILAR (${o.hatalar.length}):\n  - ${o.hatalar.slice(0, 50).join("\n  - ")}` : "",
    "",
  ].join("\n");
}
