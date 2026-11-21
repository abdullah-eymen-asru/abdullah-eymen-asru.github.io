/* assets/js/medya-transkript/transkript-mantik.js — Transkript Stüdyosu'nun SAF (DOM'suz) mantığı: zaman biçimleri, konuşmacı istatistikleri, başlık önerisi, dışa aktarma metinleri. */
export const RENKLER = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#65a30d", "#475569", "#ea580c"];

const p2 = (n) => String(n).padStart(2, "0");
export function saat(sn, ms = false) {
  sn = Math.max(0, Number(sn) || 0); const t = Math.floor(sn), s = Math.floor(t / 3600), d = Math.floor((t % 3600) / 60), k = t % 60;
  return `${p2(s)}:${p2(d)}:${p2(k)}${ms ? `.${String(Math.round((sn - t) * 1000)).padStart(3, "0").slice(0, 3)}` : ""}`;
}
const srtZaman = (sn, nokta) => { const t = Math.round(Math.max(0, sn) * 1000), s = Math.floor(t / 3600000), d = Math.floor((t % 3600000) / 60000), k = Math.floor((t % 60000) / 1000), m = t % 1000; return `${p2(s)}:${p2(d)}:${p2(k)}${nokta}${String(m).padStart(3, "0")}`; };
/** "14:05" ya da "14:05:30" → saniye (gün içi); geçersizse null. */
export function gunSaniyesi(txt) { const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(txt || "").trim()); if (!m) return null; const [s, d, k] = [+m[1], +m[2], +(m[3] || 0)]; return s < 24 && d < 60 && k < 60 ? s * 3600 + d * 60 + k : null; }
export const gunSaati = (sn) => saat(((sn % 86400) + 86400) % 86400);

export const kelimeSay = (m) => (String(m).match(/[\p{L}\p{N}'’]+/gu) || []).length;

/** Konuşmacının aralıkları: aralarındaki boşluk ≤ bosluk sn olan segmentler tek aralıkta birleşir. */
export function araliklar(segmentler, k, bosluk = 3) {
  const l = segmentler.filter((s) => s.k === k).sort((a, b) => a.b - b.b), out = [];
  for (const s of l) { const son = out[out.length - 1]; if (son && s.b - son.s <= bosluk) son.s = Math.max(son.s, s.s); else out.push({ b: s.b, s: s.s }); }
  return out;
}
export function istatistik(segmentler, konusmacilar) {
  const toplam = segmentler.reduce((t, s) => t + Math.max(0, s.s - s.b), 0) || 1;
  const satirlar = konusmacilar.map((_, k) => { const l = segmentler.filter((s) => s.k === k); const sn = l.reduce((t, s) => t + Math.max(0, s.s - s.b), 0), kel = l.reduce((t, s) => t + kelimeSay(s.m), 0); return { k, sn, kelime: kel, bolum: l.length, pay: sn / toplam, wpm: sn > 0 ? Math.round(kel / (sn / 60)) : 0, aralik: araliklar(segmentler, k) }; });
  const atanmamis = segmentler.filter((s) => s.k == null || !konusmacilar[s.k]);
  if (atanmamis.length) { const sn = atanmamis.reduce((t, s) => t + Math.max(0, s.s - s.b), 0); satirlar.push({ k: null, sn, kelime: atanmamis.reduce((t, s) => t + kelimeSay(s.m), 0), bolum: atanmamis.length, pay: sn / toplam, wpm: 0, aralik: [] }); }
  return satirlar;
}

/** Whisper konuşmacı tanımaz: duraklamaya göre TAHMİNİ ayrım — ≥ esik sn sessizlikte sıradaki konuşmacıya geçer. */
export function tahminiAyir(segmentler, n, esik = 1.5, bas = 0) {
  let k = bas % n, onceki = null;
  for (const s of segmentler) { if (onceki && s.b - onceki.s >= esik) k = (k + 1) % n; s.k = k; onceki = s; }
  return segmentler;
}

const DOLGU = /(^|[\s,.…])(?:e{2,}h*|ı{2,}h*|i{2,}|hmm+|hım+|mm+|um+|uh+|uhm+)(?=[\s,.…!?]|$)/giu;   // yalnızca belirgin dolgu sesleri; "şey", "er" gibi gerçek sözcüklere dokunulmaz
export function dolguTemizle(m) { return String(m).replace(DOLGU, "$1").replace(/\s{2,}/g, " ").replace(/\s+([,.!?…])/g, "$1").replace(/^[\s,.]+/, "").trim(); }

const DURAK = new Set(("ve veya ama fakat ile için gibi çok daha en bir bu şu o ben sen biz siz onlar var yok mı mi mu mü de da ki ne ya yani işte şey olarak olan oldu olur olarak değil bunu bunun şunu ondan bundan sonra önce kadar ancak çünkü eğer zaman bence belki hani artık the and for are but not you all can had her was one our out has have with that this from they will would there their what about which when your said them these than then into just like also been were").split(" "));
export function anahtarKelimeler(metin, n = 8) {
  const sayac = new Map();
  for (const k of String(metin).toLocaleLowerCase("tr").match(/[\p{L}]{4,}/gu) || []) if (!DURAK.has(k)) sayac.set(k, (sayac.get(k) || 0) + 1);
  return [...sayac].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ kelime: k, adet: c }));
}

const SELAM = /^(merhaba(lar)?|selam(lar)?|evet|tamam|peki|şimdi|yani|işte|hello|hi|hey|okay|ok|well|so|alright)[\s,.!…]+/iu;
/** Dosya adından DEĞİL, içerikten başlık: ilk anlamlı cümle (selamlaşma/dolgu atılır), ≤ 64 karakter. */
export function baslikOner(segmentler) {
  const metin = segmentler.map((s) => dolguTemizle(s.m)).join(" ").replace(/\s+/g, " ").trim();
  if (metin.length < 12) return "Başlıksız transkript";
  const cumleler = metin.split(/(?<=[.!?…])\s+/).map((c) => { let t = c.trim(); for (let i = 0; i < 3 && SELAM.test(t); i++) t = t.replace(SELAM, ""); return t; });
  let c = cumleler.find((t) => t.split(/\s+/).length >= 4 && t.length >= 20) || cumleler.find((t) => t.length >= 8) || metin;
  c = c.replace(/[.!?…,;:\s]+$/, "");
  let kes = false;
  if (c.length > 64) { c = c.slice(0, 64); const i = c.lastIndexOf(" "); if (i > 30) c = c.slice(0, i); kes = true; c = c.replace(/[.!?…,;:\s]+$/, ""); }
  return (c.charAt(0).toLocaleUpperCase("tr") + c.slice(1)) + (kes ? "…" : "");
}

/* ---------------- Okunabilir belge yapısı: konuşma turları + paragraflar ----------------
   Ham Whisper satırları (≈ 5-15 sn) duvar gibi tek metin olarak dökülürse okunmaz. Burada:
     1) art arda aynı konuşmacının satırları TEK "tur" olur (konuşmacı yoksa ~90 sn'lik zaman bölümleri),
     2) tur metni cümlelere bölünür (kısaltmalar: Dr., Prof., U.S., vb. cümle sonu sayılmaz),
     3) cümleler 3'lü (≤ ~520 karakter) paragraflara gruplanır; uzun sessizlik (≥ 2,5 sn) de paragraf sınırıdır. */
const KISALTMA = new Set(["dr", "prof", "doç", "yrd", "sn", "mr", "mrs", "ms", "st", "vs", "vb", "bkz", "örn", "no", "tel", "inc", "ltd", "co", "jr", "sr", "etc", "approx", "dept", "fig", "al", "ed", "vol", "pp", "cf", "ca", "ör", "av", "müh", "uzm", "öğr", "gör", "alb", "gen", "kur", "yzb", "bnb", "ort"]);
export function cumleyeBol(metin) {
  const t = String(metin).replace(/\s+/g, " ").trim(), out = []; let bas = 0;
  const re = /[.!?…]+["”’')\]]*\s+/g; let m;
  while ((m = re.exec(t))) {
    const son = m.index + m[0].length, onceki = t.slice(bas, m.index + 1), sonraki = t.slice(son, son + 1);
    const kelime = (onceki.match(/([\p{L}]+)\.?$/u) || [])[1] || "";
    const kisaltma = m[0].trim() === "." && (KISALTMA.has(kelime.toLocaleLowerCase("tr")) || /(^|[\s(])\p{Lu}$/u.test(onceki.slice(0, -1)) || /\b\p{L}\.\p{L}$/u.test(onceki.slice(0, -1)) );
    if (kisaltma || !sonraki || !/[\p{Lu}\p{N}"“‘'(\[]/u.test(sonraki)) continue;
    out.push(t.slice(bas, son).trim()); bas = son;
  }
  if (bas < t.length) out.push(t.slice(bas).trim());
  return out.filter(Boolean);
}
/** Konuşma turları: [{ k, ad, b, s, paragraflar:[{ b, m }] }] — b/s kayıt içi saniye. */
export function turlariUret(T, { konusmaci = true, bolumSn = 90, cumleSayisi = 3, azamiKarakter = 520 } = {}) {
  const tur = [];
  for (const s of T.segmentler) {
    const k = konusmaci && s.k != null && T.konusmacilar[s.k] ? s.k : null, son = tur[tur.length - 1];
    const yeniMi = !son || son.k !== k || (k == null && s.b - son.b >= bolumSn && /[.!?…]["”’')]*$/.test(son.parcalar[son.parcalar.length - 1].m.trim()));
    if (yeniMi) tur.push({ k, ad: k != null ? T.konusmacilar[k].ad : null, b: s.b, s: s.s, parcalar: [{ b: s.b, s: s.s, m: s.m }] });
    else { son.parcalar.push({ b: s.b, s: s.s, m: s.m }); son.s = Math.max(son.s, s.s); }
  }
  for (const t of tur) {
    // cümleleri başlangıç zamanıyla topla (cümle, ait olduğu satırın başlangıcını taşır)
    const cumleler = []; let kuyruk = "", kuyrukB = t.b, onceS = null;
    for (const p of t.parcalar) {
      const sessiz = onceS != null && p.b - onceS >= 2.5;
      if (kuyruk && sessiz) { cumleler.push({ b: kuyrukB, m: kuyruk, mola: true }); kuyruk = ""; }
      if (!kuyruk) kuyrukB = p.b;
      kuyruk = kuyruk ? `${kuyruk} ${p.m}` : p.m; onceS = p.s;
      const c = cumleyeBol(kuyruk);
      if (c.length > 1) { for (const x of c.slice(0, -1)) cumleler.push({ b: kuyrukB, m: x }); kuyruk = c[c.length - 1]; }
    }
    if (kuyruk) cumleler.push({ b: kuyrukB, m: kuyruk });
    const par = []; let a = null, n = 0;
    for (const c of cumleler) {
      if (!a) { a = { b: c.b, m: c.m }; n = 1; } else { a.m += ` ${c.m}`; n++; }
      if (n >= cumleSayisi || a.m.length >= azamiKarakter || c.mola) { par.push(a); a = null; n = 0; }
    }
    if (a) par.push(a);
    t.paragraflar = par.length ? par : [{ b: t.b, m: t.parcalar.map((x) => x.m).join(" ") }];
    delete t.parcalar;
  }
  return tur;
}
/** Kısa zaman: 1 saatten kısa kayıtlarda mm:ss, aksi hâlde ss:dd:ss. */
export const kisaSaat = (sn, uzun) => (uzun ? saat(sn) : saat(sn).slice(3));
const aralikYazi = (b, s, uzun, o, z) => (o.baslangicSn != null ? `${z(b)} – ${z(s)}` : `${kisaSaat(b, uzun)} – ${kisaSaat(s, uzun)}`);

/** Belge blokları (PDF/Word için IR). TurboScribe benzeri: başlık, künye, konuşmacı + zaman aralığı başlıkları, kısa paragraflar. */
export function belgeBloklari(T, o = {}, kunye = "") {
  const z = (sn) => (o.baslangicSn != null ? gunSaati(o.baslangicSn + sn) : saat(sn)), uzun = (T.sure || 0) >= 3600;
  const tur = turlariUret(T, { konusmaci: !!o.konusmaci }), bl = [];
  bl.push({ t: "h", lv: 1, runs: [{ text: T.baslik || "Transkript" }], altBosluk: 2 });
  if (kunye) bl.push({ t: "p", runs: [{ text: kunye, renk: "#6b7280", kucuk: 9.5 }], altBosluk: 6 });
  const kisiler = T.konusmacilar.filter((_, i) => T.segmentler.some((s) => s.k === i));
  if (o.konusmaci && kisiler.length) bl.push({ t: "p", runs: [{ text: "Konuşmacılar: ", b: true, renk: "#374151", kucuk: 9.5 }, { text: kisiler.map((k) => k.ad).join(" · "), renk: "#374151", kucuk: 9.5 }], altBosluk: 4 });
  bl.push({ t: "hr" });
  for (const t of tur) {
    const baslik = [];
    if (t.ad) baslik.push({ text: t.ad, b: true, renk: RENKLER[t.k % RENKLER.length] });
    if (o.zaman) baslik.push({ text: `${t.ad ? "   " : ""}${aralikYazi(t.b, t.s, uzun, o, z)}`, renk: "#6b7280", kucuk: 9.5 });
    if (baslik.length) bl.push({ t: "p", runs: baslik, ustBosluk: 8, altBosluk: 3, bitisikSonraki: true });
    for (const p of t.paragraflar) {
      const runs = [];
      if (o.zaman && !baslik.length) runs.push({ text: `${kisaSaat(p.b, uzun)}  `, renk: "#6b7280", kucuk: 9.5 });
      runs.push({ text: p.m });
      bl.push({ t: "p", runs, align: "justify", altBosluk: 6 });
    }
  }
  return bl;
}

function sar(t, g = 42) { const w = String(t).split(/\s+/), s = []; let a = ""; for (const k of w) { if (a && (a + " " + k).length > g) { s.push(a); a = k; } else a = a ? `${a} ${k}` : k; } if (a) s.push(a); return s.join("\n"); }
const ad = (T, s) => (s.k != null && T.konusmacilar[s.k] ? T.konusmacilar[s.k].ad : null);
const kacis = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kunyeMetni = (T) => { const kel = kelimeSay(T.segmentler.map((s) => s.m).join(" ")); return [saat(T.sure || (T.segmentler.at(-1)?.s ?? 0)), `${kel.toLocaleString("tr-TR")} kelime`, T.dil ? `dil: ${T.dil}` : null].filter(Boolean).join(" · "); };
export { kunyeMetni };

/** Dışa aktarma metinleri. o = { zaman:boolean, konusmaci:boolean, baslangicSn: gün içi başlangıç (isteğe bağlı) } */
export function metinUret(T, tur, o = {}) {
  const S = T.segmentler, z = (sn) => (o.baslangicSn != null ? gunSaati(o.baslangicSn + sn) : saat(sn));
  if (tur === "json") return JSON.stringify({ baslik: T.baslik, dil: T.dil || null, sure_sn: T.sure || null, konusmacilar: T.konusmacilar.map((k) => k.ad), segmentler: S.map((s) => ({ baslangic: +s.b.toFixed(2), bitis: +s.s.toFixed(2), konusmaci: ad(T, s), metin: s.m })) }, null, 2);
  if (tur === "csv") { const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; return "﻿" + ["baslangic,bitis,konusmaci,metin", ...S.map((s) => [saat(s.b, true), saat(s.s, true), ad(T, s) || "", s.m].map(q).join(","))].join("\r\n"); }
  if (tur === "srt") return S.map((s, i) => `${i + 1}\n${srtZaman(s.b, ",")} --> ${srtZaman(s.s, ",")}\n${sar((o.konusmaci && ad(T, s) ? `${ad(T, s)}: ` : "") + s.m)}\n`).join("\n");
  if (tur === "vtt") return "WEBVTT\n\n" + S.map((s) => `${srtZaman(s.b, ".")} --> ${srtZaman(s.s, ".")}\n${sar((o.konusmaci && ad(T, s) ? `<v ${ad(T, s)}>` : "") + s.m)}\n`).join("\n");
  // txt / md / html: konuşma turları + paragraflar
  const turlar = turlariUret(T, { konusmaci: !!o.konusmaci }), uzun = (T.sure || 0) >= 3600, kunye = kunyeMetni(T);
  const bas = (t) => [t.ad, o.zaman ? aralikYazi(t.b, t.s, uzun, o, z) : null].filter(Boolean);
  if (tur === "html") {
    const govde = turlar.map((t) => { const b = bas(t); return `<section>${b.length ? `<h2>${t.ad ? `<b style="color:${RENKLER[t.k % RENKLER.length]}">${kacis(t.ad)}</b>` : ""}${o.zaman ? ` <small>${kacis(aralikYazi(t.b, t.s, uzun, o, z))}</small>` : ""}</h2>` : ""}${t.paragraflar.map((p) => `<p>${o.zaman && !t.ad ? `<small>${kacis(kisaSaat(p.b, uzun))}</small> ` : ""}${kacis(p.m)}</p>`).join("")}</section>`; }).join("\n");
    return `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kacis(T.baslik)}</title><style>body{font:17px/1.65 Georgia,serif;max-width:46rem;margin:2.5rem auto;padding:0 1.2rem;color:#1f2937}h1{font:700 1.8rem system-ui,sans-serif;margin:0 0 .2rem}.k{color:#6b7280;font:.85rem system-ui,sans-serif;margin:0 0 1.5rem}h2{font:600 .95rem system-ui,sans-serif;margin:1.6rem 0 .3rem}h2 small,p small{color:#6b7280;font-weight:400}p{margin:0 0 .9rem;text-align:justify}@media print{body{margin:0;max-width:none}}</style><h1>${kacis(T.baslik)}</h1><p class="k">${kacis(kunye)}</p>\n${govde}\n`;
  }
  const md = tur === "md", ayr = md ? "\n\n" : "\n\n";
  const parcalar = turlar.map((t) => { const b = bas(t), baslik = b.length ? (md ? `### ${t.ad ? `**${t.ad}**` : ""}${o.zaman ? `${t.ad ? " · " : ""}${aralikYazi(t.b, t.s, uzun, o, z)}` : ""}` : (t.ad ? `${t.ad}${o.zaman ? ` (${aralikYazi(t.b, t.s, uzun, o, z)})` : ""}` : `[${aralikYazi(t.b, t.s, uzun, o, z)}]`)) : ""; return [baslik, ...t.paragraflar.map((p) => (o.zaman && !t.ad && !b.length ? `[${kisaSaat(p.b, uzun)}] ` : "") + p.m)].filter(Boolean).join("\n\n"); });
  const ust = md ? `# ${T.baslik}\n\n_${kunye}_\n\n` : `${T.baslik}\n${"=".repeat(Math.min(60, T.baslik.length))}\n${kunye}\n\n`;
  return ust + parcalar.join(ayr) + "\n";
}
