/*
 * assets/js/kurtarma-kiti/yeniden-zarfla.js — YEDEK İÇE AKTARMA: FARKLI HESAP / FARKLI ALTYAPI İÇİN YENİDEN ZARFLAMA (re-wrap) MOTORU.
 *
 * SORUN: Yedekteki şifreli veriler ESKİ hesabın anahtarlarına bağlıdır.
 *   • Notlar: AES-GCM, AAD = "eski-kullanıcı|not|not-id|v1" → başka kimlikle açılamaz; DEK, eski parolanın KEK'iyle sarılı.
 *   • Mesajlar: sohbet anahtarı eski kullanıcının RSA açık anahtarıyla zarflı; mesaj AAD'si eski sohbet kimliği.
 *   • Ekler (R2): AAD = "eski-kullanıcı|ek|r2-yolu|v1"; R2 yolu eski kullanıcı kimliğini içerir.
 * ÇÖZÜM (hepsi TARAYICIDA; sunucu düz metin GÖRMEZ):
 *   1) Yedekteki e2ee_kullanici_anahtarlari satırında Yedek Kurtarma Kodu blobu (kit_sarili) vardır. Kullanıcıdan kod istenir.
 *   2) Kod → eski DEK + eski RSA özel anahtarı (+ eski kullanıcı kimliği) hafızada açılır.
 *   3) Notlar: eski DEK ile çözülür → ek yolları yeni kimliğe çevrilir → YENİ hesabın DEK'iyle yeniden şifrelenir (AAD = yeni kimlik).
 *      Ekler: aynı şekilde çözülüp yeni DEK/yeni R2 yoluyla yeniden şifrelenir (R2'ye yazılırken).
 *   4) Sohbetler: eski RSA anahtarıyla zarf açılır → mesajlar çözülür → YENİ sohbet anahtarı üretilip YENİ hesabın açık anahtarına
 *      zarflanır (re-wrap) ve arşiv sohbeti olarak yazılır (mevcut mesaj_yedek_ice_aktar RPC'si; yinelenmez).
 *   5) Eski hesabın kasa/anahtar satırları (not_kasasi, e2ee_kullanici_anahtarlari) ve ham mesaj tabloları YAZILMAZ:
 *      yeni hesabın kendi kasasını/anahtarını ezmesinler, çözülemez veri üretmesinler.
 * SINIR (dürüst): Kod yalnızca KODU ÜRETEN kullanıcının verisini açar. Tam sistem yedeğinde başka kullanıcıların şifreli verileri
 * (kendi kodları yok) bu yolla açılamaz ve atlanır; onlar kendi yedeklerini kendi kodlarıyla aktarır.
 */
import { supabase } from "../core/supabase-client.js";
import * as Kasa from "../notlar/kasa.js";
import * as S from "../mesajlasma/sifre.js";
import * as Kit from "./kit.js";
import { kodSor, cssYukle } from "./kit-arayuz.js";
import { h } from "../mesajlasma/dom.js";
import { arsivSohbetiYaz } from "../sistem-yedek/mesaj-yedek.js";

/** ice-aktar.js bu tabloların satırlarını (üye kipinde "kapsam dışı" olsalar bile) plan.ozel'e kopyalar. */
export const OZEL_TABLOLAR = ["e2ee_kullanici_anahtarlari", "not_kasasi", "conversations", "konusma_zarflari", "messages"];
const MESAJ_TABLOLARI = ["conversations", "messages", "konusma_zarflari", "konusma_gizlemeleri", "mesaj_gizlemeleri", "konusma_durumlari", "konusma_uyeleri"];
const KASA_TABLOLARI = ["not_kasasi", "e2ee_kullanici_anahtarlari"];

const satirlar = (plan, ad) => plan.tablolar.find((t) => t.tablo === ad)?.satirlar || plan.ozel?.[ad] || [];
export const ekAnahtariDonustur = (anahtar, eskiUid, yeniUid) => (typeof anahtar === "string" ? anahtar.replace(`notlar/${eskiUid}/`, `notlar/${yeniUid}/`) : anahtar);

/**
 * Plan "yabancı" bir kaynaktan mı geliyor? Dönüş: { yabanci, kitVar, kitSatirlari, notSayisi, sohbetSayisi }.
 * Yabancı = yedekteki şifreli veri/anahtar satırları şu anki hesabın kimliğine ya da açık anahtarına ait DEĞİL.
 */
export async function tespit(plan, uid) {
  const e2ee = satirlar(plan, "e2ee_kullanici_anahtarlari");
  const kasalar = satirlar(plan, "not_kasasi");
  const notlar = satirlar(plan, "notlar");
  const sohbetler = satirlar(plan, "conversations");
  const sifreliSohbet = sohbetler.filter((c) => c.e2ee || c.user_id || c.hedef_admin_id);
  if (!e2ee.length && !kasalar.length && !notlar.length && !sifreliSohbet.length) return { yabanci: false };

  const kaynakIdler = new Set([...e2ee.map((r) => r.kullanici_id), ...kasalar.map((r) => r.user_id), ...notlar.map((r) => r.user_id)].filter(Boolean));
  let yabanci = [...kaynakIdler].some((id) => id !== uid);
  if (!yabanci) { // aynı kimlik ama başka altyapı/sıfırlanmış anahtar olabilir: açık anahtar farkı
    const benim = e2ee.find((r) => r.kullanici_id === uid);
    if (benim) {
      const { data } = await supabase.from("e2ee_kullanici_anahtarlari").select("acik_anahtar").eq("kullanici_id", uid).maybeSingle();
      if (data && data.acik_anahtar !== benim.acik_anahtar) yabanci = true;
    }
  }
  const kitSatirlari = e2ee.filter((r) => r.kit_sarili && r.kit_iv && r.kit_tuz);
  return { yabanci, kitVar: kitSatirlari.length > 0, kitSatirlari, notSayisi: notlar.length, sohbetSayisi: sifreliSohbet.length };
}

/** Plan ekranında gösterilen bilgi şeridi. */
export function seritCiz(rw) {
  cssYukle();
  if (!rw?.yabanci) return null;
  return h("div", { class: "kk-yabanci", role: "note" },
    h("strong", { text: "🔑 Bu yedek başka bir hesaba / altyapıya ait görünüyor" }),
    h("span", { text: rw.kitVar
      ? "Geri yüklemeyi başlatınca Yedek Kurtarma Kodu istenecek. Kod girilince eski notların ve sohbetlerin bu hesabın anahtarlarına yeniden zarflanıp yazılır:"
      : "Yedekte Yedek Kurtarma Kodu bilgisi YOK (yedek, kod üretilmeden önce alınmış). Şifreli notlar ve sohbetler eski hesabın anahtarlarına bağlı olduğundan çözülemez; bunlar ATLANACAK. Diğer veriler normal geri yüklenir." }),
    rw.kitVar ? h("ul", {},
      h("li", { text: `${rw.notSayisi.toLocaleString("tr-TR")} not (ve ekleri) bu hesabın Not Kasası'yla yeniden şifrelenir — önce Notlar'ı bir kez açmış olmalısın.` }),
      h("li", { text: `${rw.sohbetSayisi.toLocaleString("tr-TR")} sohbet yeni anahtarla “arşiv sohbeti” olarak yazılır (yalnızca sana görünür).` }),
      h("li", { text: "Eski hesabın kasa/anahtar satırları yazılmaz; mevcut anahtarların bozulmaz." })) : null);
}

const iptal = () => new DOMException("İptal edildi", "AbortError");

/**
 * Yeniden zarflamayı çalıştırır. plan DEĞİŞTİRİLİR: notlar/not_ek_kayitlari satırları yeniden şifrelenmiş hâliyle değişir, mesaj/kasa
 * tabloları plandan çıkarılır, R2 not ekleri yeniden şifreleyerek okunacak şekilde sarılır.
 * Dönüş: { rapor, temizle() } — temizle() ham DEK/RSA baytlarını sıfırlar; R2 yazımları BİTTİKTEN sonra çağrılmalıdır.
 */
export async function calistir(plan, { uid }, { logla = () => {}, asama = () => {} } = {}) {
  const rw = plan.rewrap;
  const rapor = { notlar: { aktarilan: 0, atlanan: 0, hatali: 0 }, ekler: 0, sohbet: { yeni: 0, tekrar: 0, atlanan: 0, mesaj: 0 }, notlarKapsam: [] };
  let dek = null, rsa = null;
  const temizle = () => { dek?.fill(0); rsa?.fill(0); dek = rsa = null; };

  // Şifreli içerik atlanacaksa bile eski hesabın anahtar/kasa satırları ve ham mesaj tabloları ASLA yazılmaz.
  plan.tablolar = plan.tablolar.filter((t) => !MESAJ_TABLOLARI.includes(t.tablo) && !KASA_TABLOLARI.includes(t.tablo));

  if (!rw.kitVar) {
    const nt = plan.tablolar.find((t) => t.tablo === "notlar");
    if (nt) { rapor.notlar.atlanan += nt.satirlar.length; nt.satirlar = []; }
    const ek = plan.tablolar.find((t) => t.tablo === "not_ek_kayitlari");
    if (ek) ek.satirlar = [];
    plan.r2 = plan.r2.filter((r) => r.kaynak !== "notek");
    logla("⚠️ Kurtarma Kodu bilgisi yok: şifreli notlar/sohbetler atlandı.");
    return { rapor, temizle };
  }

  // 1) Kod → eski anahtarlar
  const kaynak = await kodSor({
    baslik: "Yedek Kurtarma Kodunu gir",
    aciklama: "Bu yedek başka bir hesaba/altyapıya ait. Yedeği alan hesabın Yedek Kurtarma Kodunu yaz; notların ve sohbetlerin bu hesabın anahtarlarına yeniden zarflanacak. Kod sunucuya gönderilmez.",
    tamamMetin: "Çöz ve devam et",
    dogrula: async (kod) => {
      let sonSatirHatasi = null;
      for (const satir of rw.kitSatirlari) {
        try { return await Kit.kitSatiriniAc(satir, kod); }
        catch (e) { if (e.kod !== "KOD_YANLIS") throw e; sonSatirHatasi = e; }
      }
      throw sonSatirHatasi || new Kit.KitHatasi("KOD_YANLIS", "Kod yanlış.");
    },
  });
  if (!kaynak) throw iptal();
  dek = kaynak.dek; rsa = kaynak.rsa;
  const eskiUid = kaynak.uid;
  logla("✓ Kurtarma Kodu doğrulandı; eski anahtarlar hafızada açıldı.");

  // 2) NOTLAR (+ ek kayıtları + R2 ekleri)
  const notTablosu = plan.tablolar.find((t) => t.tablo === "notlar");
  const ekTablosu = plan.tablolar.find((t) => t.tablo === "not_ek_kayitlari");
  if (notTablosu?.satirlar.length || ekTablosu?.satirlar.length) {
    if (!dek) { logla("⚠️ Kodda Notlar anahtarı yok: notlar atlandı."); }
    else {
      if (!Kasa.kasaAcikMi()) {
        const { data } = await supabase.auth.getSession();
        await Kasa.kasaSessizAc(data.session).catch(() => false);
      }
      if (!Kasa.kasaAcikMi()) throw new Error("Notlar bu hesapta yeniden şifrelenebilmek için bu hesabın Not Kasası açık olmalı. Önce Notlar sekmesini açıp kasayı kur/aç, sonra içe aktarmayı tekrarla.");
      if (notTablosu) {
        const yeni = [];
        let i = 0;
        for (const s of notTablosu.satirlar) {
          if (++i % 25 === 0) asama(`Notlar yeniden şifreleniyor… ${i}/${notTablosu.satirlar.length}`);
          if (s.user_id !== eskiUid) { rapor.notlar.atlanan += 1; continue; }
          try {
            const nesne = await Kasa.eskiDekIleNotCoz(dek, eskiUid, s.id, s.ciphertext, s.iv);
            if (Array.isArray(nesne?.ekler)) for (const e of nesne.ekler) if (e && typeof e === "object") e.anahtar = ekAnahtariDonustur(e.anahtar, eskiUid, uid);
            const y = await Kasa.notuSifrele(nesne, s.id);
            yeni.push({ ...s, user_id: uid, ciphertext: y.ciphertext, iv: y.iv });
            rapor.notlar.aktarilan += 1;
          } catch { rapor.notlar.hatali += 1; }
        }
        notTablosu.satirlar = yeni;
      }
      if (ekTablosu) {
        ekTablosu.satirlar = ekTablosu.satirlar.filter((s) => s.user_id === eskiUid).map((s) => ({ ...s, user_id: uid, r2_key: ekAnahtariDonustur(s.r2_key, eskiUid, uid) }));
      }
      for (const r of plan.r2) {
        if (r.kaynak !== "notek" || !r.eskiAnahtar || !r.eskiAnahtar.startsWith(`notlar/${eskiUid}/`)) continue;
        const eskiAnahtar = r.eskiAnahtar, yeniAnahtar = ekAnahtariDonustur(eskiAnahtar, eskiUid, uid), alEski = r.al;
        r.anahtar = yeniAnahtar;
        r.al = async () => {
          const duz = await Kasa.eskiDekIleEkCoz(dek, eskiUid, eskiAnahtar, await (await alEski()).arrayBuffer());
          return new Blob([await Kasa.ekiSifrele(duz, yeniAnahtar)], { type: "application/octet-stream" });
        };
        rapor.ekler += 1;
      }
      // Bu kod/hesapla yeniden şifrelenemeyen R2 not ekleri (eski anahtarı bilinmeyen) yazılmaz: çözülemez dosya üretmesin.
      plan.r2 = plan.r2.filter((r) => r.kaynak !== "notek" || r.eskiAnahtar?.startsWith(`notlar/${eskiUid}/`));
      logla(`✓ Notlar yeniden şifrelendi: ${rapor.notlar.aktarilan} not, ${rapor.ekler} ek${rapor.notlar.hatali ? ` · ${rapor.notlar.hatali} not çözülemedi` : ""}.`);
    }
  }

  // 3) SOHBETLER
  const sohbetler = satirlar(plan, "conversations");
  const mesajlar = satirlar(plan, "messages");
  const zarflar = new Map(satirlar(plan, "konusma_zarflari").filter((z) => z.user_id === eskiUid).map((z) => [z.conversation_id, z.zarf]));
  if (sohbetler.length) {
    const ozel = rsa ? await crypto.subtle.importKey("pkcs8", rsa, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]) : null;
    const mesajHaritasi = new Map();
    for (const m of mesajlar) { if (!mesajHaritasi.has(m.conversation_id)) mesajHaritasi.set(m.conversation_id, []); mesajHaritasi.get(m.conversation_id).push(m); }
    let n = 0;
    for (const c of sohbetler) {
      asama(`Sohbetler yeniden zarflanıyor… ${++n}/${sohbetler.length}`);
      const ms = mesajHaritasi.get(c.id) || [];
      const uyeydi = c.user_id === eskiUid || c.hedef_admin_id === eskiUid || ms.some((m) => m.sender_id === eskiUid);
      let anahtar = null, konu = c.konu || "Arşiv";
      if (c.e2ee) {
        const zarf = zarflar.get(c.id);
        if (!ozel || !zarf) { rapor.sohbet.atlanan += 1; continue; }
        try {
          const ham = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, ozel, Uint8Array.from(atob(zarf), (x) => x.charCodeAt(0)));
          anahtar = await crypto.subtle.importKey("raw", ham, "AES-GCM", false, ["decrypt"]);
        } catch { rapor.sohbet.atlanan += 1; continue; }
        konu = (await S.coz(anahtar, c.konu_sifreli, "konu")) || "Arşiv";
      } else if (!uyeydi) { rapor.sohbet.atlanan += 1; continue; }
      const duz = [];
      for (const m of ms.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
        const metin = m.sifreli ? await S.coz(anahtar, m.body, c.id) : m.body;
        if (metin != null) duz.push({ g: m.sender_id, t: m.created_at, m: metin });
      }
      try {
        const r = await arsivSohbetiYaz({ kaynakId: c.id, konu, mesajlar: duz });
        if (r.yeni) { rapor.sohbet.yeni += 1; rapor.sohbet.mesaj += r.mesaj; } else rapor.sohbet.tekrar += 1;
      } catch (e) { throw new Error(`Sohbet yeniden zarflanamadı: ${e.message || e}`); }
    }
    logla(`✓ Sohbetler yeniden zarflandı: ${rapor.sohbet.yeni} yeni arşiv sohbeti (${rapor.sohbet.mesaj} mesaj)${rapor.sohbet.tekrar ? ` · ${rapor.sohbet.tekrar} zaten aktarılmıştı` : ""}${rapor.sohbet.atlanan ? ` · ${rapor.sohbet.atlanan} atlandı (anahtarı yok)` : ""}.`);
  }
  return { rapor, temizle };
}
