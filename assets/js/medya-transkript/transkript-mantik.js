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

function sar(t, g = 42) { const w = String(t).split(/\s+/), s = []; let a = ""; for (const k of w) { if (a && (a + " " + k).length > g) { s.push(a); a = k; } else a = a ? `${a} ${k}` : k; } if (a) s.push(a); return s.join("\n"); }
const ad = (T, s) => (s.k != null && T.konusmacilar[s.k] ? T.konusmacilar[s.k].ad : null);

/** Dışa aktarma metinleri. o = { zaman:boolean, konusmaci:boolean, baslangicSn: gün içi başlangıç (isteğe bağlı) } */
export function metinUret(T, tur, o = {}) {
  const S = T.segmentler, z = (sn) => (o.baslangicSn != null ? gunSaati(o.baslangicSn + sn) : saat(sn));
  if (tur === "json") return JSON.stringify({ baslik: T.baslik, dil: T.dil || null, sure_sn: T.sure || null, konusmacilar: T.konusmacilar.map((k) => k.ad), segmentler: S.map((s) => ({ baslangic: +s.b.toFixed(2), bitis: +s.s.toFixed(2), konusmaci: ad(T, s), metin: s.m })) }, null, 2);
  if (tur === "csv") { const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; return "﻿" + ["baslangic,bitis,konusmaci,metin", ...S.map((s) => [saat(s.b, true), saat(s.s, true), ad(T, s) || "", s.m].map(q).join(","))].join("\r\n"); }
  if (tur === "srt") return S.map((s, i) => `${i + 1}\n${srtZaman(s.b, ",")} --> ${srtZaman(s.s, ",")}\n${sar((o.konusmaci && ad(T, s) ? `${ad(T, s)}: ` : "") + s.m)}\n`).join("\n");
  if (tur === "vtt") return "WEBVTT\n\n" + S.map((s) => `${srtZaman(s.b, ".")} --> ${srtZaman(s.s, ".")}\n${sar((o.konusmaci && ad(T, s) ? `<v ${ad(T, s)}>` : "") + s.m)}\n`).join("\n");
  // txt / md: art arda aynı konuşmacı birleşir
  const bloklar = []; for (const s of S) { const a = ad(T, s), son = bloklar[bloklar.length - 1]; if (o.konusmaci && son && son.a === a && a) { son.m += ` ${s.m}`; } else bloklar.push({ a, b: s.b, m: s.m }); }
  const satir = (x) => `${o.zaman ? `[${z(x.b)}] ` : ""}${o.konusmaci && x.a ? (tur === "md" ? `**${x.a}:** ` : `${x.a}: `) : ""}${x.m}`;
  const bas = tur === "md" ? `# ${T.baslik}\n\n` : `${T.baslik}\n${"=".repeat(Math.min(60, T.baslik.length))}\n\n`;
  return bas + bloklar.map(satir).join(tur === "md" ? "\n\n" : "\n\n") + "\n";
}
