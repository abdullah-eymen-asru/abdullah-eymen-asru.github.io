/*
 * assets/js/akademik/aciklama-ice.js — Dışarıdan (Zotero, Acrobat, Önizleme, Edge…) gelen PDF'in İÇİNDEKİ açıklamaları (vurgu, altı/üstü çizgi, yorum notu,
 * serbest metin, çizim) yükleme anında okuyup veritabanına işler: kütüphane PDF'i hiç açılmadan "kaç vurgu/not var" görür; okuyucu açılınca aynen gelir.
 * Okuma pdf-yaz.js/acikla() ile yapılır (okuyucunun kullandığı AYNI ayrıştırıcı → aynı sonuç). Alıntı METNİ (vurgulanan cümle) okuyucu ilk açıldığında
 * metin katmanından doldurulup otomatik kaydedilir. Hiçbir şey R2'ye yazılmaz.
 */
import { supabase, uuid } from "./ortak.js";
import { pdfLibAl } from "./motor.js";
import { acikla } from "./pdf-yaz.js";

/** @returns {Promise<number>} içe alınan açıklama sayısı (0: yok / okunamadı) */
export async function aciklamalariIceAl(kaynakId, dosya) {
  try {
    const bayt = new Uint8Array(await dosya.arrayBuffer());
    const pdflib = await pdfLibAl();
    const { aciklamalar, sifreli } = await acikla(pdflib, bayt);
    if (sifreli || !aciklamalar.length) return 0;
    const ozet = aciklamalar.map((a) => {
      const konum = {};
      for (const k of ["kutular", "cizgiler", "rect", "kalinlik", "yaziPt"]) if (a[k] !== undefined) konum[k] = a[k];
      return { ek_id: a.nm || `ae-${a.id || uuid()}`, tur: a.tur, sayfa: a.sayfa, metin: a.metin || null, yorum: a.yorum || null, renk: a.renk, konum };
    });
    const { error } = await supabase.rpc("akademik_aciklamalari_esitle", { p_kaynak_id: kaynakId, p_aciklamalar: ozet });
    if (error) throw new Error(error.message);
    return ozet.length;
  } catch (h) {
    console.warn("Açıklamalar içe alınamadı (PDF yine de eklendi):", h);
    return 0;
  }
}
