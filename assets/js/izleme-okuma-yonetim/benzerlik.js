/*
 * assets/js/izleme-okuma-yonetim/benzerlik.js
 *
 * İzlediklerim / Okuduklarım panosuna yeni kayıt eklerken, ZATEN var olan bir kaydı yanlışlıkla tekrar
 * eklemeyi önleyen BULANIK başlık eşleştirme. Harici kütüphane YOK (vanilla).
 *
 * Eski sürüm yalnızca bigram (Dice) benzerliğine ve parantez içini ATARAK çalışıyordu; bu yüzden
 *   kayıt:  "Karayip Korsanları: Siyah İnci'nin Laneti (Pirates of the Caribbean: The Curse of the Black Pearl)"
 *   yazılan: "Pirates of the Caribbean: The Curse of the Black Pearl"
 * eşleşmiyordu (başlığın yalnızca BAŞI uyarı veriyordu). Yeni mantık, başlığın NERESİNDEN yazılırsa yazılsın yakalar:
 *
 *   1) Normalleştirme: Türkçe küçük harf + aksan katlama (ı/İ→i, ş→s, ç→c, ğ→g, ö→o, ü→u, â→a …) + noktalama temizliği.
 *      Parantez içi ATILMAZ (alternatif/özgün ad orada durur) — hem kayıtlı hem yazılan başlıkta aynı şekilde korunur.
 *   2) Her kayıt için "varyantlar": tam başlık + parantez dışı kısım + her parantez içi parça + "/" ya da " - " ile ayrılan kısımlar.
 *      Yazılan metin bu varyantlardan HERHANGİ BİRİYLE eşleşirse kayıt yakalanır.
 *   3) Eşleşme türleri (güçten zayıfa):
 *        ayni      — bir varyantla birebir aynı                          (kesin kopya)
 *        baslangic — yazılan, varyantın başında / orta — ortasında / son — sonunda kelime sınırıyla geçiyor
 *        kapsar    — kayıtlı başlık, yazılanın içinde geçiyor (ör. "Dune" varken "Dune: Part Two" yazılıyor → devam/bölüm olabilir)
 *        kelime    — ortak anlamlı kelimeler (sıra önemsiz; "Siyah İnci Laneti Karayip")
 *        yazim     — yazım farkı (Sørensen–Dice bigram ≥ 0.6)
 *   4) Yazarken (son kelime yarım olsa bile) çalışır: "karayip kors" → "Karayip Korsanları".
 */
import { kucukHarfeCevirTr } from "../core/supabase-client.js";

const KATLA = { "ı": "i", "ş": "s", "ç": "c", "ğ": "g", "ö": "o", "ü": "u", "â": "a", "î": "i", "û": "u", "ê": "e", "ô": "o", "œ": "oe", "æ": "ae", "ø": "o", "ß": "ss", "đ": "d", "ł": "l" };
const DUR = new Set(["the", "of", "and", "a", "an", "in", "on", "to", "for", "de", "la", "le", "el", "ve", "bir", "ile", "ya", "da", "bu", "o", "part", "bolum", "sezon", "season", "cilt", "vol"]);

/** Karşılaştırma biçimi: küçük harf (tr) + aksan katlama + noktalama → boşluk. Parantez içi KORUNUR. */
export function normallestir(metin) {
  if (!metin) return "";
  let s = kucukHarfeCevirTr(String(metin)).normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[ıçşğöüâîûêôœæøßđł]/g, (c) => KATLA[c] || c);
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const anlamli = (t) => t.length >= 2 && !DUR.has(t);
const kelimeler = (n) => (n ? n.split(" ") : []);

function bigramlar(n) {
  const b = n.replace(/\s+/g, ""), o = [];
  for (let i = 0; i < b.length - 1; i++) o.push(b.slice(i, i + 2));
  return o;
}

/** İki başlık arasındaki bigram Dice benzerliği (0..1). */
export function diceBenzerligi(a, b) {
  const na = normallestir(a), nb = normallestir(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigramlar(na), bb = bigramlar(nb);
  if (!ba.length || !bb.length) return 0;
  const sayac = new Map();
  bb.forEach((g) => sayac.set(g, (sayac.get(g) || 0) + 1));
  let ortak = 0;
  ba.forEach((g) => { const k = sayac.get(g) || 0; if (k > 0) { ortak++; sayac.set(g, k - 1); } });
  return (2 * ortak) / (ba.length + bb.length);
}

/** Bir kayıt başlığından aranabilir varyantlar: tam, parantezsiz, parantez içleri, "/" ve " - " parçaları. */
export function varyantlar(baslik) {
  const ham = String(baslik || ""), v = new Set();
  const ekle = (x) => { const n = normallestir(x); if (n) v.add(n); };
  ekle(ham);
  ekle(ham.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
  for (const m of ham.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)) ekle(m[1] || m[2]);
  ham.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s[-–—|]\s|\s*\/\s*/).forEach((p) => { if (p.trim() !== ham.trim()) ekle(p); });
  return [...v];
}

/** q (normalize) v içinde kelime sınırıyla geçiyor mu? Son kelime yarım olabilir (yazarken). → "baslangic" | "orta" | "son" | "" */
function gecis(q, v) {
  const kv = " " + v + " ", tam = kv.indexOf(" " + q + " ");
  let i = tam;
  if (i < 0 && q.length >= 4) i = (" " + v).indexOf(" " + q);          // yarım son kelime (öneklenmiş)
  if (i < 0) return "";
  if (i === 0 || (tam < 0 && i === 0)) return "baslangic";
  const bitis = (" " + v).indexOf(q, i) + q.length;
  return bitis >= v.length + 1 || (tam >= 0 && tam + q.length + 2 >= kv.length) ? "son" : "orta";
}

/**
 * Tek kayıt için en iyi eşleşmeyi döner: { tur, konum, oran, kelimeler:Set } ya da null.
 * oran: 0..1 (sıralama için).
 */
export function baslikEslestir(yazilan, kayitBasligi) {
  const q = normallestir(yazilan);
  if (q.length < 3) return null;
  const qk = kelimeler(q).filter(anlamli);
  if (!qk.length) return null;
  let en = null;
  const dene = (c) => { if (!en || c.oran > en.oran) en = c; };
  for (const v of varyantlar(kayitBasligi)) {
    if (v === q) { dene({ tur: "ayni", oran: 1 }); continue; }
    const g = gecis(q, v);
    if (g) {
      const kapsama = Math.min(1, q.length / Math.max(v.length, 1));
      dene({ tur: g === "baslangic" ? "baslangic" : g === "son" ? "son" : "orta", oran: 0.78 + 0.2 * kapsama });
    }
    const vk = kelimeler(v).filter(anlamli);
    if (v.length >= 4 && vk.length && (" " + q + " ").includes(" " + v + " ")) dene({ tur: "kapsar", oran: 0.7 + 0.1 * Math.min(1, v.length / q.length) });
    const vs = new Set(vk), ortak = qk.filter((t) => vs.has(t) || (t.length >= 4 && vk.some((x) => x.startsWith(t) || (x.length >= 5 && t.startsWith(x)))));
    if (ortak.length >= 2 || (ortak.length === 1 && qk.length === 1 && ortak[0].length >= 5)) {
      const kapsama = ortak.length / Math.min(qk.length, vk.length || 1);
      if (kapsama >= 0.75 && ortak.length >= Math.min(2, qk.length)) dene({ tur: "kelime", oran: 0.55 + 0.2 * kapsama });
    }
    const d = diceBenzerligi(q, v);
    if (d >= 0.6) dene({ tur: "yazim", oran: d * 0.9 });
  }
  return en;
}

/**
 * Yazılan başlığa benzeyen kayıtlar. Dönüş: [{ kayit, oran, tur, guclu }] — oran azalan; guclu = "büyük olasılıkla aynı kayıt".
 * esik: en düşük oran. Eski çağrılarla uyumlu imza: (baslik, kayitlar, esik, limit).
 */
export function enBenzerKayitlariBul(baslik, kayitlar, esik = 0.55, limit = 3) {
  if (!baslik || !Array.isArray(kayitlar) || !kayitlar.length) return [];
  const sonuc = [];
  for (const kayit of kayitlar) {
    const e = baslikEslestir(baslik, kayit.title);
    if (e && e.oran >= esik) sonuc.push({ kayit, oran: e.oran, tur: e.tur, guclu: e.tur === "ayni" || (e.oran >= 0.9 && e.tur !== "kapsar") });
  }
  return sonuc.sort((a, b) => b.oran - a.oran).slice(0, limit);
}

export const TUR_ETIKET = {
  ayni: "Aynı başlık",
  baslangic: "Başlığın başında geçiyor",
  orta: "Başlığın ortasında geçiyor",
  son: "Başlığın sonunda geçiyor",
  kapsar: "Kayıtlı başlık, yazdığının içinde (devam/bölüm olabilir)",
  kelime: "Ortak anahtar kelimeler",
  yazim: "Yazımı çok benziyor",
};

/** Başlıkta yazılanla örtüşen KELİMELERİ [{metin, vurgu}] parçalarına ayırır (arayüzde <mark> için). */
export function vurguParcalari(baslik, yazilan) {
  const qk = new Set(kelimeler(normallestir(yazilan)).filter(anlamli));
  const qSon = kelimeler(normallestir(yazilan)).slice(-1)[0] || "";
  return String(baslik || "").split(/(\s+)/).map((p) => {
    const n = normallestir(p);
    const vurgu = !!n && (qk.has(n) || (qSon.length >= 3 && n.startsWith(qSon)) );
    return { metin: p, vurgu };
  });
}
