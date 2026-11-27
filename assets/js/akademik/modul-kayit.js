/*
 * assets/js/akademik/modul-kayit.js — Akademik Kütüphane / PDF okuyucu için MODÜL (plugin) KAYIT DEFTERİ.
 *
 * AMAÇ: İleride yeni özellik (ör. etiketli açıklama, OCR, yapay zekâ özeti) eklenirken ya da çekirdek bileşenler güncellenirken
 * mevcut okuyucunun, notların ve veritabanının BOZULMAMASI. Bunun için:
 *   1) SÖZLEŞME: Çekirdek, modüllere yalnızca bu dosyadaki dar ve donmuş "bağlam" (ctx) nesnesini verir; modüller okuyucunun
 *      iç değişkenlerine dokunamaz. Çekirdek iç yapısını değiştirse bile ctx sözleşmesi (API_SURUMU) aynı kaldıkça modüller çalışır.
 *   2) SÜRÜM KONTROLÜ: Her modül `apiMin`/`apiMax` bildirir; çekirdek API'si aralığın dışındaysa modül YÜKLENMEZ (okuyucu etkilenmez).
 *   3) HATA YALITIMI: Her kanca (hook) çağrısı try/catch + zaman aşımı içindedir. Bir modül 3 kez hata verirse oturum boyunca
 *      askıya alınır; okuyucu çalışmaya devam eder.
 *   4) AÇ/KAPA: Kullanıcı bir modülü Ayarlar'dan kapatabilir (localStorage `aea_ak_modul_kapali`); sorunlu bir güncelleme
 *      böylece kod değiştirmeden devre dışı bırakılır.
 *   5) VERİ ŞEMASI: Açıklama `konum` verisi `sema` numarası taşır (bkz. okuyucu.js → SEMA_SURUMU). Bilinmeyen alanlar silinmez
 *      (ileri uyumluluk): yeni bir modül kendi alanını yazsa bile eski sürüm onu bozmadan geri kaydeder.
 *
 * KANCALAR (ad → yük):
 *   okuyucu:acildi      { kaynak, salt }
 *   okuyucu:secim       { metin, sayfa }                       (seçim durulunca)
 *   okuyucu:aciklama    { tip: "ekle"|"guncelle"|"sil", aciklama }   (kopya; değiştirilemez)
 *   okuyucu:kapandi     { kaynak }
 *   kutuphane:acildi    { }
 *
 * KULLANIM:
 *   import { modulKaydet } from "./modul-kayit.js";
 *   modulKaydet({ id: "ornek", ad: "Örnek", surum: "1.0.0", apiMin: 2, kancalar: { "okuyucu:secim": (yuk, ctx) => {…} } });
 */

import { hata as trHata } from "../core/hata-metni.js";
export const API_SURUMU = 2;                         // çekirdek modül sözleşmesi; uyumsuz değişiklikte artırılır
export const CEKIRDEK_SURUMU = "2026.11.20";
const KAPALI_ANAHTAR = "aea_ak_modul_kapali";
const HATA_ESIGI = 3;
const KANCA_ZAMAN_ASIMI_MS = 4000;

const moduller = new Map();                           // id → { tanim, durum, hata, sonHata }
const dinleyiciler = new Set();

function kapaliOku() { try { return new Set(JSON.parse(localStorage.getItem(KAPALI_ANAHTAR) || "[]")); } catch { return new Set(); } }
function kapaliYaz(k) { try { localStorage.setItem(KAPALI_ANAHTAR, JSON.stringify([...k])); } catch { /* depo kapalı */ } }
const bildir = () => dinleyiciler.forEach((f) => { try { f(modulDurumlari()); } catch { /* yok say */ } });

/** Modülü kaydeder. Geçersiz/uyumsuz modül sessizce "reddedildi" durumuna alınır; asla istisna fırlatmaz. */
export function modulKaydet(tanim) {
  try {
    if (!tanim || typeof tanim.id !== "string" || !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(tanim.id)) return { ok: false, neden: "geçersiz id" };
    if (moduller.has(tanim.id)) return { ok: false, neden: "bu id zaten kayıtlı" };
    const apiMin = Number(tanim.apiMin ?? 1), apiMax = Number(tanim.apiMax ?? Infinity);
    let durum = "etkin", neden = "";
    if (API_SURUMU < apiMin || API_SURUMU > apiMax) { durum = "reddedildi"; neden = `API ${API_SURUMU} bu modülün desteklediği aralıkta değil (${apiMin}–${apiMax === Infinity ? "∞" : apiMax}).`; }
    else if (kapaliOku().has(tanim.id)) { durum = "kapali"; neden = "kullanıcı kapattı"; }
    moduller.set(tanim.id, { tanim: Object.freeze({ ...tanim }), durum, neden, hata: 0, sonHata: "" });
    bildir();
    return { ok: durum === "etkin", neden };
  } catch (h) { return { ok: false, neden: String(trHata(h)) }; }
}

/** Kanca çalıştırır; her etkin modülün işleyicisi yalıtılmıştır. Sonuçlar dizisi döner (hatalı işleyiciler atlanır). */
export async function kancaCalistir(ad, yuk, ctx = {}) {
  const sonuclar = [];
  for (const [id, m] of moduller) {
    if (m.durum !== "etkin") continue;
    const f = m.tanim.kancalar?.[ad];
    if (typeof f !== "function") continue;
    try {
      const sonuc = await Promise.race([
        Promise.resolve(f(Object.freeze({ ...yuk }), ctx)),
        new Promise((_, red) => setTimeout(() => red(new Error("zaman aşımı")), KANCA_ZAMAN_ASIMI_MS)),
      ]);
      if (sonuc !== undefined) sonuclar.push({ modul: id, sonuc });
    } catch (h) {
      m.hata++; m.sonHata = String(trHata(h));
      console.warn(`[modül:${id}] ${ad} hatası (${m.hata}/${HATA_ESIGI}):`, h);
      if (m.hata >= HATA_ESIGI) { m.durum = "askida"; m.neden = `art arda hata: ${m.sonHata}`; bildir(); }
    }
  }
  return sonuclar;
}

export function modulAyarla(id, etkin) {
  const m = moduller.get(id);
  if (!m) return false;
  const k = kapaliOku();
  if (etkin) k.delete(id); else k.add(id);
  kapaliYaz(k);
  if (m.durum !== "reddedildi") { m.durum = etkin ? "etkin" : "kapali"; m.hata = 0; m.neden = etkin ? "" : "kullanıcı kapattı"; }
  bildir();
  return true;
}

export function modulDurumlari() {
  return [...moduller].map(([id, m]) => ({ id, ad: m.tanim.ad || id, surum: m.tanim.surum || "?", aciklama: m.tanim.aciklama || "", durum: m.durum, neden: m.neden, hata: m.hata }));
}
export function modulDinle(f) { dinleyiciler.add(f); return () => dinleyiciler.delete(f); }

/* ---------------- veri şeması (açıklama `konum` alanı) ---------------- */
export const SEMA_SURUMU = 2;
/** Çekirdeğin bildiği konum alanları; DIŞINDAKİLER silinmeden korunur (bir modül ya da daha yeni bir sürüm yazmış olabilir). */
export const BILINEN_KONUM_ALANLARI = Object.freeze(["kutular", "cizgiler", "rect", "kalinlik", "yaziPt", "norm", "sema"]);

/** Eski (sema yok / 1) konum verisini güncel şemaya yükseltir. Girdiyi DEĞİŞTİRMEZ; bilinmeyen alanları korur. */
export function konumuYukselt(konum) {
  if (!konum || typeof konum !== "object") return konum;
  const k = { ...konum };
  const surum = Number(k.sema || 1);
  if (surum > SEMA_SURUMU) return k;                  // daha yeni sürümde yazılmış: dokunma, olduğu gibi taşı
  k.sema = SEMA_SURUMU;                               // v1 → v2: `norm` (yüzdelik koordinat) isteğe bağlı; okuyucu ilk kayıtta üretir
  return k;
}
/** Bilinmeyen alanları ayıklar (kaydederken geri eklemek için). */
export function konumEkstra(konum) {
  const e = {};
  for (const [k, v] of Object.entries(konum || {})) if (!BILINEN_KONUM_ALANLARI.includes(k)) e[k] = v;
  return e;
}
