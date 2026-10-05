/*
 * assets/js/notlar/disa-aktar/disa-aktar.js
 * -----------------------------------------------------------------------
 * "Dışa aktar": tek not, seçili notlar, bir klasör ya da TÜM notlar → Markdown, PDF,
 * Word (.docx), HTML, düz metin; tek dosya ya da ZIP.
 *
 * Hepsi TARAYICIDA, zaten çözülmüş notlar üzerinde çalışır: sunucuya hiçbir şey gitmez,
 * şifreli yapı bozulmaz. Ekler (şifreli R2 nesneleri) yalnızca bu cihazda çözülür.
 *
 * ZIP DÜZENİ — klasör ağacı, ad ve zaman mantığı korunur:
 *   Notlarım_2026-10-04_17-30/
 *     [Markdown|PDF|Word|HTML|Metin]/      ← yalnızca birden çok biçim seçilmişse
 *       Ders/Sosyoloji/                    ← notun KLASÖR YOLU, aynen
 *         2026-10-04_17-01_Not başlığı.md  ← OLUŞTURMA zamanı + başlık
 *     Ekler/Ders/Sosyoloji/2026-10-04_17-01_Not başlığı/grafik.png
 *     Dizin.md                             ← her notun yolu, oluşturma ve güncelleme zamanı
 *   Her dosyanın ZIP "değiştirilme tarihi" = notun SON GÜNCELLEME zamanı.
 * -----------------------------------------------------------------------
 */
import { ZipYazici } from "./zip.js";
import { adTemizle, zamanDamgasi, yerelIso, insanTarih, dosyaAdi, htmlBloklari, bloklariMetneCevir, kunyeSatirlari } from "./ir.js";
import { pdfUret } from "./pdf.js";
import { docxUret } from "./docx.js";

export const BICIMLER = [
  { id: "md", ad: "Markdown", uzanti: "md", klasor: "Markdown", ipucu: "Başlık bilgisi dosyanın başında; ekler yanında" },
  { id: "pdf", ad: "PDF", uzanti: "pdf", klasor: "PDF", ipucu: "Her yerde aynı görünür, yazdırmaya hazır" },
  { id: "docx", ad: "Word", uzanti: "docx", klasor: "Word", ipucu: "Word, Pages ve Google Dokümanlar'da düzenlenir" },
  { id: "html", ad: "Web sayfası", uzanti: "html", klasor: "HTML", ipucu: "Tek dosya, görseller içinde, çevrimdışı açılır" },
  { id: "txt", ad: "Düz metin", uzanti: "txt", klasor: "Metin", ipucu: "Biçimsiz, her yerde açılır" },
];

const kodla = new TextEncoder();

/* ---------- görsel hazırlama (canvas ile; WebP/GIF dahil her şey dönüşür) ---------- */

const EN_UZUN_KENAR = 2000;

async function bitmapAl(bayt, tip) {
  return createImageBitmap(new Blob([bayt], { type: tip }));
}

async function tuvaleCiz(bmp, beyazZemin) {
  let g = bmp.width;
  let y = bmp.height;
  const olcek = Math.min(1, EN_UZUN_KENAR / Math.max(g, y));
  g = Math.max(1, Math.round(g * olcek));
  y = Math.max(1, Math.round(y * olcek));
  const tuval = document.createElement("canvas");
  tuval.width = g;
  tuval.height = y;
  const c = tuval.getContext("2d");
  if (beyazZemin) {
    c.fillStyle = "#fff";
    c.fillRect(0, 0, g, y);
  }
  c.drawImage(bmp, 0, 0, g, y);
  return { tuval, g, y };
}

const blobBayt = async (b) => new Uint8Array(await b.arrayBuffer());
const tuvalBlob = (t, tur, kalite) => new Promise((coz) => t.toBlob(coz, tur, kalite));

async function pdfResmi(bayt, tip) {
  const bmp = await bitmapAl(bayt, tip);
  const { tuval, g, y } = await tuvaleCiz(bmp, true);
  bmp.close?.();
  return { jpeg: await blobBayt(await tuvalBlob(tuval, "image/jpeg", 0.9)), g, y };
}

async function docxResmi(bayt, tip) {
  const bmp = await bitmapAl(bayt, tip);
  try {
    if (tip === "image/png" || tip === "image/jpeg" || tip === "image/gif") {
      return { bayt, tip: tip.split("/")[1], g: bmp.width, y: bmp.height };
    }
    const { tuval, g, y } = await tuvaleCiz(bmp, false);
    return { bayt: await blobBayt(await tuvalBlob(tuval, "image/png")), tip: "png", g, y };
  } finally {
    bmp.close?.();
  }
}

function base64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------- tek kaydı biçime çevirme ---------- */

const yamlDizgi = (s) => JSON.stringify(String(s ?? ""));

function alintiMarkdown(a) {
  const p = [];
  if (a.alinti.trim()) p.push(a.alinti.trim().split("\n").map((s) => `> ${s}`).join("\n"));
  const k = [a.kaynak.trim(), a.sayfa.trim()].filter(Boolean).join(", ");
  if (k) p.push(`> — ${k}`);
  if (a.yorum.trim()) p.push(`**Yorumum:** ${a.yorum.trim()}`);
  return p.join("\n\n");
}

function markdownUret(k, ctx, ekHedef) {
  const on = [
    "---",
    `baslik: ${yamlDizgi(k.baslik)}`,
    `klasor: ${yamlDizgi(k.klasorYolu.join("/"))}`,
    `tur: ${yamlDizgi(ctx.turAdi(k.kategori))}`,
    `durum: ${yamlDizgi(ctx.durumAdi(k.durum))}`,
    k.tarih ? `konu_tarihi: ${k.tarih}` : null,
    `etiketler: [${k.etiketler.map(yamlDizgi).join(", ")}]`,
    `olusturma: ${yerelIso(k.olusturma)}`,
    `guncelleme: ${yerelIso(k.guncelleme)}`,
    "---",
    "",
  ].filter((x) => x !== null);

  let govde = (k.govde || "").replace(/\{\{alinti:\d+\}\}/g, "");
  govde = govde.replace(/!\[([^\]]*)\]\(ek:([^)]*)\)/g, (_, alt, id) => {
    const ek = k.ekler.find((e) => e.id === id);
    const yol = ek && ekHedef ? ekHedef(ek) : null;
    return yol ? `![${alt || ek.ad}](${yol})` : `*[Görsel: ${alt || (ek ? ek.ad : "eklenemedi")}]*`;
  });
  const parcalar = [...on, `# ${k.baslik || "Başlıksız not"}`, "", govde.trim()];
  if (k.alintilar.length) {
    parcalar.push("", "## Kaynaklı alıntılar", "", k.alintilar.map(alintiMarkdown).filter(Boolean).join("\n\n"));
  }
  const dosyaEkleri = k.ekler.filter((e) => !e.tip.startsWith("image/") && ekHedef);
  if (dosyaEkleri.length) {
    parcalar.push("", "## Ekler", "", dosyaEkleri.map((e) => `- [${e.ad}](${ekHedef(e)})`).join("\n"));
  }
  return parcalar.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function metinUret(k, ctx) {
  const kunye = kunyeSatirlari(k, { turAdi: ctx.turAdi(k.kategori), durumAdi: ctx.durumAdi(k.durum) });
  const bloklar = htmlBloklari(ctx.temizHtml(k.html || ""));
  const baslik = k.baslik || "Başlıksız not";
  const p = [baslik, "=".repeat(Math.min(60, baslik.length)), ...kunye.map(([e, d]) => `${e}: ${d}`), "", bloklariMetneCevir(bloklar, (ek) => `[Görsel: ${k.ekler.find((x) => x.id === ek)?.ad || ek}]`)];
  if (k.alintilar.length) {
    p.push("", "KAYNAKLI ALINTILAR", "");
    for (const a of k.alintilar) {
      if (a.alinti.trim()) p.push(a.alinti.trim().split("\n").map((s) => `  | ${s}`).join("\n"));
      const kn = [a.kaynak.trim(), a.sayfa.trim()].filter(Boolean).join(", ");
      if (kn) p.push(`  — ${kn}`);
      if (a.yorum.trim()) p.push(`  Yorumum: ${a.yorum.trim()}`);
      p.push("");
    }
  }
  return p.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const HTML_STIL = `:root{color-scheme:light dark;--t:#1a1a1a;--m:#6b7280;--b:#e5e7eb;--a:#2b5797;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--t:#e8e8e8;--m:#9a9a9a;--b:#2c2f36;--a:#6ea8ff;--bg:#14161a}}
body{margin:0;background:var(--bg);color:var(--t);font:17px/1.65 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 22px 80px}
h1{font-size:2rem;line-height:1.2;margin:0 0 12px}h2{font-size:1.45rem;margin:2rem 0 .5rem}h3{font-size:1.15rem;margin:1.6rem 0 .4rem}
dl.k{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:0 0 26px;padding-bottom:18px;border-bottom:1px solid var(--b);color:var(--m);font-size:.88rem}
dl.k dt{font-weight:600}dl.k dd{margin:0}
blockquote{margin:1rem 0;padding:.2rem 0 .2rem 1rem;border-left:3px solid var(--b);color:var(--m)}
blockquote footer{font-size:.9rem;margin-top:.3rem}
mark{background:#fde68a;color:#111;border-radius:3px;padding:0 2px}
img{max-width:100%;height:auto;border-radius:8px}hr{border:0;border-top:1px solid var(--b);margin:2rem 0}
ul.g{list-style:none;padding-left:1.2rem}ul.g li::before{content:"☐ ";margin-left:-1.2rem}ul.g li[data-yapildi]::before{content:"☑ "}
ul.g li[data-yapildi]{color:var(--m);text-decoration:line-through}
@media print{main{padding:0}body{font-size:12pt}}`;

async function htmlUret(k, ctx, ekBayt) {
  const temiz = ctx.temizHtml(k.html || "");
  const belge = new DOMParser().parseFromString(temiz, "text/html");
  for (const img of [...belge.querySelectorAll("img[data-ek]")]) {
    const ek = k.ekler.find((e) => e.id === img.getAttribute("data-ek"));
    if (!ek) {
      img.remove();
      continue;
    }
    try {
      img.setAttribute("src", `data:${ek.tip};base64,${base64(await ekBayt(ek))}`);
      img.removeAttribute("data-ek");
    } catch {
      img.remove();
    }
  }
  for (const ul of belge.querySelectorAll("ul.nt-gorev")) {
    ul.className = "g";
  }
  const e = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const kunye = kunyeSatirlari(k, { turAdi: ctx.turAdi(k.kategori), durumAdi: ctx.durumAdi(k.durum) });
  const alintilar = k.alintilar
    .map((a) => {
      const kn = [a.kaynak.trim(), a.sayfa.trim()].filter(Boolean).join(", ");
      return (
        (a.alinti.trim() ? `<blockquote>${a.alinti.trim().split(/\n{2,}/).map((p) => `<p>${e(p).replaceAll("\n", "<br>")}</p>`).join("")}${kn ? `<footer>— ${e(kn)}</footer>` : ""}</blockquote>` : "") +
        (a.yorum.trim() ? `<p><strong>Yorumum:</strong> ${e(a.yorum.trim())}</p>` : "")
      );
    })
    .join("");
  return (
    `<!doctype html>\n<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${e(k.baslik || "Başlıksız not")}</title><meta name="created" content="${e(yerelIso(k.olusturma))}"><meta name="modified" content="${e(yerelIso(k.guncelleme))}">` +
    `<style>${HTML_STIL}</style></head><body><main><h1>${e(k.baslik || "Başlıksız not")}</h1>` +
    `<dl class="k">${kunye.map(([a, d]) => `<dt>${e(a)}</dt><dd>${e(d)}</dd>`).join("")}</dl>` +
    `<article>${belge.body.innerHTML}</article>${alintilar ? `<h2>Kaynaklı alıntılar</h2>${alintilar}` : ""}</main></body></html>\n`
  );
}

/** kayit + biçim → {bayt:Uint8Array|string, uzanti} */
async function kayitUret(k, bicim, ctx, { ekBayt, ekHedef, dahilEk }) {
  const kunye = kunyeSatirlari(k, { turAdi: ctx.turAdi(k.kategori), durumAdi: ctx.durumAdi(k.durum) });
  const onbellek = new Map();
  const ekBul = (id) => k.ekler.find((e) => e.id === id);

  if (bicim === "md") return markdownUret(k, ctx, dahilEk ? ekHedef : null);
  if (bicim === "txt") return metinUret(k, ctx);
  if (bicim === "html") return htmlUret(k, ctx, ekBayt);

  const bloklar = htmlBloklari(ctx.temizHtml(k.html || ""));
  const ortak = { baslik: k.baslik, kunye, bloklar, alintilar: k.alintilar, yazar: ctx.yazar, olusturma: k.olusturma, guncelleme: k.guncelleme };

  if (bicim === "pdf") {
    return pdfUret({
      ...ortak,
      resimAl: async (id) => {
        const ek = ekBul(id);
        if (!ek) return null;
        if (!onbellek.has(id)) onbellek.set(id, ekBayt(ek).then((b) => pdfResmi(b, ek.tip)).catch(() => null));
        return onbellek.get(id);
      },
    });
  }
  if (bicim === "docx") {
    return docxUret({
      ...ortak,
      resimAl: async (id) => {
        const ek = ekBul(id);
        if (!ek) return null;
        if (!onbellek.has(id)) onbellek.set(id, ekBayt(ek).then((b) => docxResmi(b, ek.tip)).catch(() => null));
        return onbellek.get(id);
      },
    });
  }
  throw new Error("Bilinmeyen biçim: " + bicim);
}

/* ---------- paketleme ---------- */

const MIME = { md: "text/markdown;charset=utf-8", txt: "text/plain;charset=utf-8", html: "text/html;charset=utf-8", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip" };

export function indir(blob, ad) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ad;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const kokAdi = (ad) => `${adTemizle(ad || "Notlarım", "Notlarım", 40)}_${zamanDamgasi(new Date().toISOString())}`;
const parcaKodla = (yol) => yol.split("/").map(encodeURIComponent).join("/");

/**
 * kayitlar: [{id,baslik,klasorYolu:[],klasorTarihleri:[],olusturma,guncelleme,tarih,kategori,durum,etiketler,html,govde,alintilar,ekler}]
 * secenek: {bicimler:[id], zip:bool, ekler:bool, klasorler:[{yol,guncelleme}], paketAdi, ilerleme(i,n,metin)}
 * Dönüş: {blob, ad, dosyaSayisi, atlanan:[...]}
 */
export async function paketle(kayitlar, ctx, secenek) {
  const bicimler = secenek.bicimler.filter((b) => BICIMLER.some((x) => x.id === b));
  if (!bicimler.length) throw new Error("En az bir biçim seç.");
  if (!kayitlar.length) throw new Error("Dışa aktarılacak not yok.");
  const dahilEk = secenek.ekler !== false;
  const coklu = bicimler.length > 1;
  const zipMi = secenek.zip || kayitlar.length > 1 || coklu || (bicimler[0] === "md" && dahilEk && kayitlar.some((k) => k.ekler.length));
  const toplam = kayitlar.length * bicimler.length;
  let yapilan = 0;
  const atlanan = [];
  const bildir = (m) => secenek.ilerleme?.(yapilan, toplam, m);

  const ekOnbellek = new Map();
  const ekBayt = (ek) => {
    if (!ekOnbellek.has(ek.anahtar)) ekOnbellek.set(ek.anahtar, ctx.ekBayt(ek));
    return ekOnbellek.get(ek.anahtar);
  };

  /* tek dosya */
  if (!zipMi) {
    const k = kayitlar[0];
    const b = bicimler[0];
    bildir(k.baslik || "Başlıksız not");
    const icerik = await kayitUret(k, b, ctx, { ekBayt, ekHedef: null, dahilEk });
    const uz = BICIMLER.find((x) => x.id === b).uzanti;
    return { blob: new Blob([icerik], { type: MIME[b] }), ad: dosyaAdi(k, uz), dosyaSayisi: 1, atlanan };
  }

  /* ZIP */
  const kok = kokAdi(secenek.paketAdi);
  const zip = new ZipYazici();
  const simdi = new Date();
  zip.klasorEkle(kok, simdi);
  const dizin = [];

  const klasorYolu = (k, bicimKlasoru) => {
    const parcalar = [kok];
    if (bicimKlasoru) parcalar.push(bicimKlasoru);
    return parcalar;
  };

  // boş klasörler dahil tüm klasör ağacı
  for (const kl of secenek.klasorler || []) {
    const adlar = kl.yol.map((a) => adTemizle(a, "Klasör"));
    for (const b of bicimler) {
      const tabanlar = klasorYolu(null, coklu ? BICIMLER.find((x) => x.id === b).klasor : null);
      for (let i = 0; i < adlar.length; i++) zip.klasorEkle([...tabanlar, ...adlar.slice(0, i + 1)].join("/"), new Date(kl.guncelleme));
    }
  }

  for (const k of kayitlar) {
    const adlar = k.klasorYolu.map((a) => adTemizle(a, "Klasör"));
    const taban = dosyaAdi(k, "x").slice(0, -2);
    const ekKlasoru = [kok, "Ekler", ...adlar, taban].join("/");
    const ekAdlari = new Map(); // ek.id -> zip içi ad
    const kullanilan = new Set();
    for (const ek of k.ekler) {
      let ad = adTemizle(ek.ad, "ek", 100);
      const nokta = ad.lastIndexOf(".");
      const govde = nokta > 0 ? ad.slice(0, nokta) : ad;
      const uz = nokta > 0 ? ad.slice(nokta) : "";
      for (let i = 2; kullanilan.has(ad.toLowerCase()); i++) ad = `${govde} (${i})${uz}`;
      kullanilan.add(ad.toLowerCase());
      ekAdlari.set(ek.id, ad);
    }

    // ekleri bir kez yaz (klasör başına)
    if (dahilEk && k.ekler.length) {
      for (const ek of k.ekler) {
        try {
          await zip.dosyaEkle(`${ekKlasoru}/${ekAdlari.get(ek.id)}`, await ekBayt(ek), new Date(k.guncelleme));
        } catch (h) {
          atlanan.push(`${k.baslik || "Başlıksız not"} → ${ek.ad}: ${h.message || h}`);
          ekAdlari.delete(ek.id);
        }
      }
    }

    for (const b of bicimler) {
      const bi = BICIMLER.find((x) => x.id === b);
      const dizinYolu = [...klasorYolu(k, coklu ? bi.klasor : null), ...adlar];
      for (let i = 0; i < adlar.length + (coklu ? 2 : 1); i++) {
        // klasör girişleri (zaman damgalı)
        const kesim = dizinYolu.slice(0, i + 1).join("/");
        const klasorTarihi = i >= (coklu ? 2 : 1) ? k.klasorTarihleri?.[i - (coklu ? 2 : 1)] : null;
        zip.klasorEkle(kesim, klasorTarihi ? new Date(klasorTarihi) : simdi);
      }
      bildir(`${k.baslik || "Başlıksız not"} → ${bi.ad}`);
      try {
        const ust = dizinYolu.length - 1; // kok dahil: göreli yol için kökten kaç klasör derinde
        const ekHedef = (ek) => {
          const ad = ekAdlari.get(ek.id);
          if (!ad) return null;
          return "../".repeat(ust) + parcaKodla(["Ekler", ...adlar, taban, ad].join("/"));
        };
        const icerik = await kayitUret(k, b, ctx, { ekBayt, ekHedef, dahilEk });
        const yol = `${dizinYolu.join("/")}/${taban}.${bi.uzanti}`;
        const yazilan = await zip.dosyaEkle(yol, icerik instanceof Uint8Array ? icerik : kodla.encode(icerik), new Date(k.guncelleme));
        dizin.push({ k, bicim: bi, yol: yazilan.slice(kok.length + 1) });
      } catch (h) {
        console.error(h);
        atlanan.push(`${k.baslik || "Başlıksız not"} (${bi.ad}): ${h.message || h}`);
      }
      yapilan++;
      bildir("");
    }
  }

  // Dizin.md
  const satirlar = [
    "# Notlarım — dışa aktarma dizini",
    "",
    `Dışa aktarma zamanı: ${insanTarih(simdi.toISOString())}`,
    `Not sayısı: ${kayitlar.length} · Biçim: ${bicimler.map((b) => BICIMLER.find((x) => x.id === b).ad).join(", ")}`,
    "",
    "| Klasör | Not | Oluşturma | Son güncelleme | Dosya |",
    "|---|---|---|---|---|",
  ];
  const kacis = (s) => String(s).replaceAll("|", "\\|");
  for (const { k, yol } of dizin) {
    satirlar.push(`| ${kacis(k.klasorYolu.join(" / ") || "—")} | ${kacis(k.baslik || "Başlıksız not")} | ${yerelIso(k.olusturma).replace("T", " ").slice(0, 16)} | ${yerelIso(k.guncelleme).replace("T", " ").slice(0, 16)} | ${kacis(yol)} |`);
  }
  if (atlanan.length) satirlar.push("", "## Atlanan öğeler", "", ...atlanan.map((a) => `- ${a}`));
  await zip.dosyaEkle(`${kok}/Dizin.md`, satirlar.join("\n") + "\n", simdi);

  return { blob: zip.bitir(), ad: `${kok}.zip`, dosyaSayisi: dizin.length, atlanan };
}

/* ---------- Diyalog ---------- */

function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

/**
 * kapsamlar: [{id, ad, sayi, kayitlar:()=>[...], klasorler:()=>[...]}]
 * baslangic: {kapsam, bicimler}
 */
export function disaAktarDiyalogu({ kapsamlar, ctx, baslangic = {}, kok = document.body, bildir = () => {} }) {
  return new Promise((coz) => {
    const d = el("dialog", { class: "nt-diyalog nt-da" });
    const secili = { kapsam: baslangic.kapsam || kapsamlar[0].id, bicimler: new Set(baslangic.bicimler || ["pdf"]), zip: null, ekler: true };

    const kapsamKutusu = el("div", { class: "nt-da-secenekler", role: "radiogroup", "aria-label": "Kapsam" });
    const bicimKutusu = el("div", { class: "nt-da-secenekler nt-da-bicimler" });
    const secenekKutusu = el("div", { class: "nt-da-secenekler" });
    const ozet = el("p", { class: "nt-da-ozet", "aria-live": "polite" });
    const ilerleme = el("p", { class: "nt-da-ilerleme muted", hidden: true, "aria-live": "polite" });
    const hata = el("p", { class: "nt-da-hata", hidden: true, role: "alert" });
    const indirBtn = el("button", { type: "submit", class: "nt-btn nt-btn-birincil", text: "İndir" });
    const vazgecBtn = el("button", { type: "button", class: "nt-btn", text: "Kapat" });

    const mevcutKapsam = () => kapsamlar.find((k) => k.id === secili.kapsam) || kapsamlar[0];

    const ciz = () => {
      kapsamKutusu.replaceChildren(
        ...kapsamlar.map((k) => {
          const r = el("input", { type: "radio", name: "nt-da-kapsam", value: k.id });
          r.checked = k.id === secili.kapsam;
          r.addEventListener("change", () => {
            secili.kapsam = k.id;
            ciz();
          });
          return el("label", { class: "nt-da-secenek" }, r, el("span", { class: "nt-da-ad", text: k.ad }), el("span", { class: "nt-da-sayi", text: `${k.sayi} not` }));
        })
      );

      bicimKutusu.replaceChildren(
        ...BICIMLER.map((b) => {
          const c = el("input", { type: "checkbox", value: b.id });
          c.checked = secili.bicimler.has(b.id);
          c.addEventListener("change", () => {
            c.checked ? secili.bicimler.add(b.id) : secili.bicimler.delete(b.id);
            ciz();
          });
          return el("label", { class: "nt-da-secenek" }, c, el("span", { class: "nt-da-ad", text: b.ad }), el("span", { class: "nt-da-ipucu", text: b.ipucu }));
        }),
        el("button", {
          type: "button",
          class: "nt-btn nt-btn-kucuk nt-da-hepsi",
          text: secili.bicimler.size === BICIMLER.length ? "Seçimi temizle" : "Tüm biçimler",
          onclick: () => {
            secili.bicimler = secili.bicimler.size === BICIMLER.length ? new Set() : new Set(BICIMLER.map((b) => b.id));
            ciz();
          },
        })
      );

      const kap = mevcutKapsam();
      const kayitSayisi = kap.sayi;
      const ekVar = kap.ekVar;
      const zorunlu = kayitSayisi > 1 || secili.bicimler.size > 1;
      const zipDeger = zorunlu ? true : secili.zip ?? false;
      const zipKutu = el("input", { type: "checkbox", disabled: zorunlu });
      zipKutu.checked = zipDeger;
      zipKutu.addEventListener("change", () => (secili.zip = zipKutu.checked));
      const ekKutu = el("input", { type: "checkbox" });
      ekKutu.checked = secili.ekler;
      ekKutu.addEventListener("change", () => {
        secili.ekler = ekKutu.checked;
        ciz();
      });
      secenekKutusu.replaceChildren(
        ...[el("label", { class: "nt-da-secenek" }, zipKutu, el("span", { class: "nt-da-ad", text: "ZIP olarak paketle" }), el("span", { class: "nt-da-ipucu", text: zorunlu ? "Birden çok dosya olduğu için zorunlu" : "Tek dosyayı doğrudan indirmek için kapat" })),
        ekVar ? el("label", { class: "nt-da-secenek" }, ekKutu, el("span", { class: "nt-da-ad", text: "Ekleri dahil et" }), el("span", { class: "nt-da-ipucu", text: "Görseller ve PDF'ler bu cihazda çözülüp pakete konur" })) : null].filter(Boolean)
      );

      const dosya = kayitSayisi * secili.bicimler.size;
      ozet.textContent = secili.bicimler.size
        ? zorunlu || secili.zip
          ? `${kayitSayisi} not × ${secili.bicimler.size} biçim = ${dosya} dosya, tek ZIP. Klasörler, dosya adları ve tarihler korunur.`
          : "1 dosya, doğrudan indirilir."
        : "En az bir biçim seç.";
      indirBtn.disabled = !secili.bicimler.size || !kayitSayisi;
    };

    d.addEventListener("close", () => {
      d.remove();
      coz(null);
    });
    vazgecBtn.addEventListener("click", () => d.close());

    const form = el(
      "form",
      { class: "nt-diyalog-form", novalidate: true },
      el("h3", { text: "Dışa aktar" }),
      el("p", { class: "muted nt-da-aciklama", text: "Dosyalar bu cihazda oluşturulur; hiçbir şey sunucuya gönderilmez." }),
      el("fieldset", { class: "nt-da-grup" }, el("legend", { text: "Ne indirilsin?" }), kapsamKutusu),
      el("fieldset", { class: "nt-da-grup" }, el("legend", { text: "Hangi biçimde?" }), bicimKutusu),
      el("fieldset", { class: "nt-da-grup" }, el("legend", { text: "Paket" }), secenekKutusu),
      ozet,
      ilerleme,
      hata,
      el("div", { class: "nt-diyalog-eylem" }, vazgecBtn, indirBtn)
    );

    form.addEventListener("submit", async (o) => {
      o.preventDefault();
      if (indirBtn.disabled) return;
      hata.hidden = true;
      indirBtn.disabled = true;
      vazgecBtn.disabled = true;
      ilerleme.hidden = false;
      ilerleme.textContent = "Hazırlanıyor…";
      try {
        const kap = mevcutKapsam();
        const sonuc = await paketle(kap.kayitlar(), ctx, {
          bicimler: [...secili.bicimler],
          zip: secili.zip ?? false,
          ekler: secili.ekler,
          klasorler: kap.klasorler?.() || [],
          paketAdi: kap.paketAdi,
          ilerleme: (i, n, m) => (ilerleme.textContent = m ? `${i + 1} / ${n} · ${m}` : `${i} / ${n} tamamlandı`),
        });
        indir(sonuc.blob, sonuc.ad);
        bildir(
          `${sonuc.dosyaSayisi} dosya hazırlandı: ${sonuc.ad}` + (sonuc.atlanan.length ? ` · ${sonuc.atlanan.length} öğe atlandı (ayrıntı Dizin.md içinde)` : ""),
          sonuc.atlanan.length ? "warning" : "success"
        );
        d.close();
      } catch (h) {
        console.error(h);
        hata.hidden = false;
        hata.textContent = "Dışa aktarılamadı: " + (h.message || h);
        ilerleme.hidden = true;
        indirBtn.disabled = false;
        vazgecBtn.disabled = false;
      }
    });

    d.append(form);
    kok.append(d);
    ciz();
    d.showModal();
    form.querySelector("input")?.focus();
  });
}
