/*
 * assets/js/notlar/kasa.js
 * -----------------------------------------------------------------------
 * "Not Kasası" — istemci tarafı (client-side) sıfır bilgi şifreleme çekirdeği.
 * Bu dosya SADECE Web Crypto (SubtleCrypto) kullanır; hiçbir harici kütüphane
 * yok (CSP: script-src 'self' + hash ile uyumlu).
 *
 * ANAHTAR HİYERARŞİSİ (zarf şifreleme / envelope encryption)
 * ----------------------------------------------------------
 *   giriş parolası ──PBKDF2-SHA256 (600k tur, kullanıcıya özel salt)──► KEK
 *                                                                      │ (AES-GCM wrap)
 *   rastgele 256-bit DEK  ◄────────────────── not_kasasi.dek_parola ◄──┘
 *        │
 *        ├─ AES-GCM ile her notu şifreler  (AAD = kullanıcı|not|not-id)
 *        └─ AES-GCM ile her eki şifreler   (AAD = kullanıcı|ek|r2-anahtarı)
 *
 *   kurtarma anahtarı (256-bit rastgele, kullanıcıya BİR KEZ gösterilir)
 *        └─ ikinci bir KEK ► not_kasasi.dek_kurtarma (aynı DEK'in 2. kopyası)
 *
 * NEDEN DOĞRUDAN "PAROLA → NOT ANAHTARI" DEĞİL, ARAYA DEK KOYDUK?
 *   Parolayı değiştirdiğinde (Panelim > Şifre Değiştir) ya da "şifremi
 *   unuttum" ile sıfırladığında anahtar değişir. Notları doğrudan paroladan
 *   türetilen anahtarla şifrelesek, HER parola değişiminde TÜM notları yeniden
 *   şifrelemek (ya da kaybetmek) gerekirdi. DEK sayesinde değişen tek şey
 *   küçücük bir zarf: dek_parola satırı.
 *
 * "extractable: false" NEREDE, NEREDE DEĞİL? (dürüst özet)
 *   - Parola malzemesi (PBKDF2 baz anahtarı)  : extractable:false
 *   - KEK (IndexedDB'de saklanan)             : extractable:false
 *   - Oturumdaki çalışma DEK'i                : extractable:false
 *   - AMA DEK'i sarmak (wrapKey) için o anda extractable:true olmak ZORUNDA —
 *     Web Crypto'nun kuralı. Bu yalnızca (1) kasa ilk kurulurken, (2) parola
 *     değişince zarf yenilenirken, (3) kurtarma anahtarı yenilenirken, birkaç
 *     milisaniyeliğine, bir fonksiyonun yerel değişkeninde yaşar ve hemen
 *     çöpe gider; hiçbir yere saklanmaz, hiçbir global'e atanmaz.
 *   - JS string'leri bellekten "silinemez" (değiştirilemez nesnelerdir).
 *     Parolayı bu yüzden Uint8Array'e çevirip importKey'den hemen sonra
 *     .fill(0) ile gerçekten sıfırlıyoruz; string referanslarını da null'a
 *     çekiyoruz. Girdi kutusundaki değer ise giriş formunun kendisine ait.
 *
 * NE KORUR / NE KORUMAZ?
 *   + Supabase çalışanı, yedekler, SQL enjeksiyonu, sızan service_role →
 *     hiçbiri notu okuyamaz (sadece ciphertext var).
 *   - Sitende bir XSS olursa, saldırgan kodu o oturumda DEK'i KULLANARAK
 *     (anahtar baytlarını okuyamasa da) şifre çözebilir. extractable:false
 *     anahtarın SIZDIRILMASINI engeller, KULLANILMASINI değil. Buna karşı
 *     asıl savunma sıkı CSP + tüm DOM çıktılarının textContent ile basılması
 *     (notlar.js'te hiç innerHTML yok).
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_TUR = 600000; // OWASP 2023: PBKDF2-HMAC-SHA256 için asgari 600.000
const SEMA = "v1";
const PAD_BLOK = 512; // düz metin boyutunu 512 bayt basamaklarına yuvarla (uzunluk sızıntısını azaltır)
const BEKLEYEN_OMRU_MS = 15 * 60 * 1000; // girişte yakalanan parola malzemesi 15 dk geçerli (2FA süresi dahil)

/* ------------------------------------------------------------------ */
/* 1) Küçük yardımcılar                                                */
/* ------------------------------------------------------------------ */

export function b64Kodla(bayt) {
  const u8 = bayt instanceof Uint8Array ? bayt : new Uint8Array(bayt);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64Coz(metin) {
  const s = atob(metin);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function birlestir(...parcalar) {
  const toplam = parcalar.reduce((t, p) => t + p.length, 0);
  const cikti = new Uint8Array(toplam);
  let konum = 0;
  for (const p of parcalar) {
    cikti.set(p, konum);
    konum += p.length;
  }
  return cikti;
}

const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));
const aad = (...parcalar) => enc.encode([...parcalar, SEMA].join("|"));

// Crockford base32 (I, L, O, U yok → elle yazarken karışmaz)
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32Kodla(u8) {
  let bit = 0;
  let deger = 0;
  let cikti = "";
  for (const b of u8) {
    deger = (deger << 8) | b;
    bit += 8;
    while (bit >= 5) {
      cikti += B32[(deger >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  if (bit > 0) cikti += B32[(deger << (5 - bit)) & 31];
  return cikti;
}

function base32Coz(metin) {
  const temiz = metin
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  let bit = 0;
  let deger = 0;
  const cikti = [];
  for (const ch of temiz) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Kurtarma anahtarında geçersiz karakter var.");
    deger = (deger << 5) | i;
    bit += 5;
    if (bit >= 8) {
      cikti.push((deger >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return new Uint8Array(cikti);
}

/** 32 bayt → "ABCD-EFGH-..." (13 grup). */
function kurtarmaMetniYap(u8) {
  return base32Kodla(u8).match(/.{1,4}/g).join("-");
}

/* ------------------------------------------------------------------ */
/* 2) IndexedDB — CryptoKey nesneleri "structured clone" ile saklanır, */
/*    baytları JS'e HİÇ açılmaz (extractable:false).                   */
/* ------------------------------------------------------------------ */

const DB_ADI = "aea-notlar-kasa";
const DEPO = "anahtarlar";
const bellekDeposu = new Map(); // IndexedDB kullanılamazsa (gizli sekme vb.) sadece bu sekme boyunca yaşar

function dbAc() {
  return new Promise((coz, red) => {
    if (!("indexedDB" in window)) return red(new Error("IndexedDB yok"));
    const istek = indexedDB.open(DB_ADI, 1);
    istek.onupgradeneeded = () => istek.result.createObjectStore(DEPO);
    istek.onsuccess = () => coz(istek.result);
    istek.onerror = () => red(istek.error);
  });
}

async function depoOku(anahtar) {
  try {
    const db = await dbAc();
    return await new Promise((coz, red) => {
      const istek = db.transaction(DEPO, "readonly").objectStore(DEPO).get(anahtar);
      istek.onsuccess = () => coz(istek.result ?? null);
      istek.onerror = () => red(istek.error);
    });
  } catch {
    return bellekDeposu.get(anahtar) ?? null;
  }
}

async function depoYaz(anahtar, deger) {
  try {
    const db = await dbAc();
    await new Promise((coz, red) => {
      const tx = db.transaction(DEPO, "readwrite");
      tx.objectStore(DEPO).put(deger, anahtar);
      tx.oncomplete = () => coz();
      tx.onerror = () => red(tx.error);
    });
  } catch {
    bellekDeposu.set(anahtar, deger);
  }
}

async function depoSil(anahtar) {
  bellekDeposu.delete(anahtar);
  try {
    const db = await dbAc();
    await new Promise((coz, red) => {
      const tx = db.transaction(DEPO, "readwrite");
      tx.objectStore(DEPO).delete(anahtar);
      tx.oncomplete = () => coz();
      tx.onerror = () => red(tx.error);
    });
  } catch {
    /* sessizce geç */
  }
}

const KEK_ANAHTARI = (uid) => `${uid}:kek`;
const BEKLEYEN_ANAHTARI = "bekleyen-parola";
const SEKME_ISARETI = "aea_kasa_sekme"; // "Oturumumu hatırla" kapalıysa anahtarın tarayıcı oturumunu aşmasını engeller

/* ------------------------------------------------------------------ */
/* 3) Parola malzemesi (giriş sayfası kancası burayı kullanır)         */
/* ------------------------------------------------------------------ */

/**
 * Ham parolayı "tek yönlü, dışa aktarılamayan" bir PBKDF2 baz anahtarına çevirir.
 * Ham baytlar importKey'den hemen sonra sıfırlanır. Dönen CryptoKey'in içeriğini
 * hiçbir JS kodu okuyamaz; sadece deriveKey() girdisi olarak kullanılabilir.
 */
export async function parolaMalzemesiOlustur(parola) {
  const bayt = enc.encode(parola);
  try {
    return await crypto.subtle.importKey("raw", bayt, "PBKDF2", false, ["deriveKey"]);
  } finally {
    bayt.fill(0);
  }
}

/** Giriş kancası: parola malzemesini (ham parolayı DEĞİL) kısa ömürlü olarak saklar. */
export async function bekleyenParolaMalzemesiKaydet(eposta, baz) {
  await depoYaz(BEKLEYEN_ANAHTARI, { baz, eposta: eposta.trim().toLowerCase(), zaman: Date.now() });
}

async function bekleyenParolaMalzemesiAl(eposta) {
  const kayit = await depoOku(BEKLEYEN_ANAHTARI);
  if (!kayit) return null;
  const taze = Date.now() - kayit.zaman < BEKLEYEN_OMRU_MS;
  const ayniHesap = !eposta || kayit.eposta === eposta.trim().toLowerCase();
  if (!taze || !ayniHesap) {
    await depoSil(BEKLEYEN_ANAHTARI);
    return null;
  }
  return kayit.baz;
}

export const bekleyenParolaMalzemesiniSil = () => depoSil(BEKLEYEN_ANAHTARI);

/* ------------------------------------------------------------------ */
/* 4) Anahtar türetme / sarma / açma                                   */
/* ------------------------------------------------------------------ */

function kekTuret(baz, tuzBayt, tur) {
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: tuzBayt, iterations: tur },
    baz,
    { name: "AES-GCM", length: 256 },
    false, // extractable:false
    ["wrapKey", "unwrapKey"]
  );
}

async function dekSar(dekGecici, kek, uid, etiket) {
  const iv = rastgele(12);
  const sarili = await crypto.subtle.wrapKey("raw", dekGecici, kek, {
    name: "AES-GCM",
    iv,
    additionalData: aad(uid, etiket),
  });
  return b64Kodla(birlestir(iv, new Uint8Array(sarili)));
}

function dekAc(sariliB64, kek, uid, etiket, disaAktarilabilir) {
  const ham = b64Coz(sariliB64);
  return crypto.subtle.unwrapKey(
    "raw",
    ham.slice(12),
    kek,
    { name: "AES-GCM", iv: ham.slice(0, 12), additionalData: aad(uid, etiket) },
    { name: "AES-GCM" },
    disaAktarilabilir,
    ["encrypt", "decrypt"]
  );
}

async function kurtarmaKekiOlustur(kurtarmaBaytlari) {
  return crypto.subtle.importKey("raw", kurtarmaBaytlari, "AES-GCM", false, ["wrapKey", "unwrapKey"]);
}

/* ------------------------------------------------------------------ */
/* 5) Oturum durumu                                                    */
/* ------------------------------------------------------------------ */

let oturum = null; // { uid, eposta, dek, kek, satir }

export const kasaAcikMi = () => !!oturum?.dek;

function sekmeIsaretiniKoy(uid) {
  try {
    sessionStorage.setItem(SEKME_ISARETI, uid);
  } catch {
    /* önemsiz */
  }
}

async function kekiOnbellegeAl(uid, kek) {
  await depoYaz(KEK_ANAHTARI(uid), kek);
  sekmeIsaretiniKoy(uid);
}

async function onbellekliKekiAl(uid) {
  // "Oturumumu hatırla" kapalıysa (oturum sessionStorage'da) anahtar da SADECE bu
  // tarayıcı oturumu kadar yaşasın: sekme işareti yoksa yeni bir tarayıcı oturumu
  // demektir, önbellekteki anahtar atılır → parola yeniden türetilir.
  let hatirla = true;
  try {
    hatirla = localStorage.getItem("aea_oturumu_hatirla") !== "0";
    if (!hatirla && sessionStorage.getItem(SEKME_ISARETI) !== uid) {
      await depoSil(KEK_ANAHTARI(uid));
      return null;
    }
  } catch {
    /* depolar kapalıysa önbelleğe güvenme */
  }
  return depoOku(KEK_ANAHTARI(uid));
}

async function kasaSatiriniGetir(uid) {
  const { data, error } = await supabase.from("not_kasasi").select("*").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ */
/* 6) Kasa kurma / açma                                                */
/* ------------------------------------------------------------------ */

async function yeniKasaKur(uid, baz) {
  // DEK: SADECE burada, sarılana kadar geçici olarak extractable:true.
  const dekGecici = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const tuz = rastgele(16);
  const kek = await kekTuret(baz, tuz, KDF_TUR);

  const kurtarmaBaytlari = rastgele(32);
  const kurtarmaMetni = kurtarmaMetniYap(kurtarmaBaytlari);
  const kurtarmaKek = await kurtarmaKekiOlustur(kurtarmaBaytlari);
  kurtarmaBaytlari.fill(0);

  const satir = {
    user_id: uid,
    kdf_iter: KDF_TUR,
    kdf_salt: b64Kodla(tuz),
    dek_parola: await dekSar(dekGecici, kek, uid, "dek-parola"),
    dek_kurtarma: await dekSar(dekGecici, kurtarmaKek, uid, "dek-kurtarma"),
  };

  const { data, error } = await supabase.from("not_kasasi").insert(satir).select("*").single();
  if (error) throw error;

  const dek = await dekAc(data.dek_parola, kek, uid, "dek-parola", false);
  return { dek, kek, satir: data, kurtarmaMetni };
}

async function kekIleDekAc(satir, kek, uid) {
  try {
    return await dekAc(satir.dek_parola, kek, uid, "dek-parola", false);
  } catch {
    return null; // AES-GCM doğrulaması başarısız = parola yanlış ya da parola başka yerden değişmiş
  }
}

/**
 * Not sekmesi açıldığında çağrılır.
 * Dönüş: { durum: "acik" | "kilitli" | "kurtarma-gerekli" | "yeni-kasa", kurtarmaMetni? }
 *   acik             → anahtar bu cihazda hazır (önbellek ya da girişte yakalanan parola)
 *   kilitli          → bu cihazda anahtar yok; kullanıcı AYNI giriş parolasını bir kez yazmalı
 *   kurtarma-gerekli → girişteki parola kasayı açmıyor (parola dışarıdan değişmiş); kurtarma anahtarı lazım
 *   yeni-kasa        → ilk kez kuruldu; kurtarma anahtarı kullanıcıya GÖSTERİLMELİ
 */
export async function kasaBaslat(session) {
  const uid = session.user.id;
  const eposta = session.user.email || "";
  const satir = await kasaSatiriniGetir(uid);

  // 1) Bu cihazda kalıcı (dışa aktarılamaz) KEK var mı?
  if (satir) {
    const kekOnbellek = await onbellekliKekiAl(uid);
    if (kekOnbellek) {
      const dek = await kekIleDekAc(satir, kekOnbellek, uid);
      if (dek) {
        oturum = { uid, eposta, dek, kek: kekOnbellek, satir };
        return { durum: "acik" };
      }
      await depoSil(KEK_ANAHTARI(uid)); // eski/geçersiz → at
    }
  }

  // 2) Girişte yakalanan parola malzemesi var mı?
  const baz = await bekleyenParolaMalzemesiAl(eposta);
  if (baz) {
    const sonuc = await bazIleBaslat(uid, eposta, satir, baz);
    // "kurtarma-gerekli"de malzeme SİLİNMEZ: kullanıcı kurtarma anahtarını girince zarfı bu
    // (girişte yakalanan) parolayla yeniden kurmamız gerekecek. 15 dk TTL zaten sınırlıyor.
    if (sonuc.durum === "acik" || sonuc.durum === "yeni-kasa") await bekleyenParolaMalzemesiniSil();
    return sonuc;
  }

  return { durum: "kilitli", kasaVar: !!satir };
}

async function bazIleBaslat(uid, eposta, satir, baz) {
  if (!satir) {
    const k = await yeniKasaKur(uid, baz);
    oturum = { uid, eposta, dek: k.dek, kek: k.kek, satir: k.satir };
    await kekiOnbellegeAl(uid, k.kek);
    return { durum: "yeni-kasa", kurtarmaMetni: k.kurtarmaMetni };
  }
  const kek = await kekTuret(baz, b64Coz(satir.kdf_salt), satir.kdf_iter);
  const dek = await kekIleDekAc(satir, kek, uid);
  if (!dek) return { durum: "kurtarma-gerekli" };
  oturum = { uid, eposta, dek, kek, satir };
  await kekiOnbellegeAl(uid, kek);
  return { durum: "acik" };
}

/** Kilit kartındaki form: kullanıcı GİRİŞ parolasını yazar (ikinci bir parola DEĞİL). */
export async function parolaIleAc(session, parola) {
  const uid = session.user.id;
  let p = parola;
  const baz = await parolaMalzemesiOlustur(p);
  p = null; // ham parola referansı anında bırakılır
  const satir = await kasaSatiriniGetir(uid);
  return bazIleBaslat(uid, session.user.email || "", satir, baz);
}

/**
 * Parola dışarıdan değiştiyse (şifremi unuttum, başka cihazda değişim):
 * kurtarma anahtarıyla DEK açılır, YENİ parola için zarf yeniden kurulur.
 * `parola`: şu anki giriş parolası (kullanıcı yazar) — null ise girişte yakalanan malzeme kullanılır.
 */
export async function kurtarmaIleAc(session, kurtarmaMetni, parola) {
  const uid = session.user.id;
  const eposta = session.user.email || "";
  const satir = await kasaSatiriniGetir(uid);
  if (!satir) throw new Error("Bu hesapta henüz bir Not Kasası yok.");

  let baz = null;
  if (parola) {
    let p = parola;
    baz = await parolaMalzemesiOlustur(p);
    p = null;
  } else {
    baz = await bekleyenParolaMalzemesiAl(eposta);
  }
  if (!baz) throw new Error("Zarfı yeniden kurmak için giriş parolanı da yazmalısın.");

  const kurtarmaBaytlari = base32Coz(kurtarmaMetni);
  if (kurtarmaBaytlari.length !== 32) throw new Error("Kurtarma anahtarı eksik ya da fazla karakter içeriyor.");
  const kurtarmaKek = await kurtarmaKekiOlustur(kurtarmaBaytlari);
  kurtarmaBaytlari.fill(0);

  let dekGecici;
  try {
    dekGecici = await dekAc(satir.dek_kurtarma, kurtarmaKek, uid, "dek-kurtarma", true); // geçici: yeniden sarılacak
  } catch {
    throw new Error("Kurtarma anahtarı yanlış.");
  }

  await zarfiYenile(uid, satir, dekGecici, baz);
  const taze = await kasaSatiriniGetir(uid);
  const kek = await kekTuret(baz, b64Coz(taze.kdf_salt), taze.kdf_iter);
  const dek = await dekAc(taze.dek_parola, kek, uid, "dek-parola", false);
  oturum = { uid, eposta, dek, kek, satir: taze };
  await kekiOnbellegeAl(uid, kek);
  await bekleyenParolaMalzemesiniSil();
  return { durum: "acik" };
}

/** dek_parola zarfını YENİ bir tuz + yeni KEK ile baştan yazar (iyimser kilitli). */
async function zarfiYenile(uid, satir, dekGecici, yeniBaz) {
  const tuz = rastgele(16);
  const yeniKek = await kekTuret(yeniBaz, tuz, KDF_TUR);
  const { data, error } = await supabase
    .from("not_kasasi")
    .update({
      kdf_iter: KDF_TUR,
      kdf_salt: b64Kodla(tuz),
      dek_parola: await dekSar(dekGecici, yeniKek, uid, "dek-parola"),
    })
    .eq("user_id", uid)
    .eq("rev", satir.rev)
    .select("rev");
  if (error) throw error;
  if (!data?.length) throw new Error("Kasa başka bir cihazda değişti; sayfayı yenileyip tekrar dene.");
}

/**
 * Parola değişimi (kasa-kancalari.js çağırır): yeni parola malzemesiyle zarf yenilenir.
 * Eski KEK önbellekte yoksa (bu cihazda kasa kilitliyse) yapılamaz → kurtarma anahtarı yolu.
 */
export async function parolaDegisimindeZarfiYenile(uid, yeniBaz) {
  const satir = await kasaSatiriniGetir(uid);
  if (!satir) return { yapildi: false, sebep: "kasa-yok" };
  const eskiKek = oturum?.uid === uid ? oturum.kek : await onbellekliKekiAl(uid);
  if (!eskiKek) return { yapildi: false, sebep: "kilitli" };

  let dekGecici;
  try {
    dekGecici = await dekAc(satir.dek_parola, eskiKek, uid, "dek-parola", true);
  } catch {
    return { yapildi: false, sebep: "eski-anahtar-gecersiz" };
  }
  await zarfiYenile(uid, satir, dekGecici, yeniBaz);

  const taze = await kasaSatiriniGetir(uid);
  const yeniKek = await kekTuret(yeniBaz, b64Coz(taze.kdf_salt), taze.kdf_iter);
  const dek = await dekAc(taze.dek_parola, yeniKek, uid, "dek-parola", false);
  oturum = { uid, eposta: oturum?.eposta || "", dek, kek: yeniKek, satir: taze };
  await kekiOnbellegeAl(uid, yeniKek);
  return { yapildi: true };
}

/** Yeni kurtarma anahtarı üretir (eskisi geçersiz olur). Kasa açıkken çağrılır. */
export async function kurtarmaAnahtariniYenile() {
  if (!oturum) throw new Error("Kasa kilitli.");
  const { uid, kek } = oturum;
  const satir = await kasaSatiriniGetir(uid);
  const dekGecici = await dekAc(satir.dek_parola, kek, uid, "dek-parola", true);

  const baytlar = rastgele(32);
  const metin = kurtarmaMetniYap(baytlar);
  const kurtarmaKek = await kurtarmaKekiOlustur(baytlar);
  baytlar.fill(0);

  const { data, error } = await supabase
    .from("not_kasasi")
    .update({ dek_kurtarma: await dekSar(dekGecici, kurtarmaKek, uid, "dek-kurtarma") })
    .eq("user_id", uid)
    .eq("rev", satir.rev)
    .select("*");
  if (error) throw error;
  if (!data?.length) throw new Error("Kasa başka bir cihazda değişti; sayfayı yenileyip tekrar dene.");
  oturum.satir = data[0];
  return metin;
}

/** Bellekteki DEK'i bırakır ve bu cihazdaki KEK önbelleğini siler → bir sonraki açılışta parola gerekir. */
export async function kilitle() {
  const uid = oturum?.uid;
  oturum = null;
  if (uid) await depoSil(KEK_ANAHTARI(uid));
  try {
    sessionStorage.removeItem(SEKME_ISARETI);
  } catch {
    /* önemsiz */
  }
}

/** Çıkış (SIGNED_OUT) olunca: tüm anahtar malzemesi cihazdan silinir. */
export async function tumAnahtarlariTemizle() {
  oturum = null;
  await depoSil(BEKLEYEN_ANAHTARI);
  try {
    const db = await dbAc();
    await new Promise((coz) => {
      const tx = db.transaction(DEPO, "readwrite");
      tx.objectStore(DEPO).clear();
      tx.oncomplete = () => coz();
      tx.onerror = () => coz();
    });
  } catch {
    /* önemsiz */
  }
  bellekDeposu.clear();
  try {
    sessionStorage.removeItem(SEKME_ISARETI);
  } catch {
    /* önemsiz */
  }
}

/* ------------------------------------------------------------------ */
/* 7) Not / ek şifreleme                                               */
/* ------------------------------------------------------------------ */

function oturumGerekli() {
  if (!oturum?.dek) throw new Error("Not Kasası kilitli.");
  return oturum;
}

/** Nesneyi JSON → 512 baytlık basamağa doldur → AES-GCM. AAD notun id'sine bağlıdır. */
export async function notuSifrele(nesne, notId) {
  const { uid, dek } = oturumGerekli();
  let bayt = enc.encode(JSON.stringify(nesne));
  const dolgu = (PAD_BLOK - (bayt.length % PAD_BLOK)) % PAD_BLOK;
  if (dolgu) bayt = birlestir(bayt, new Uint8Array(dolgu).fill(0x20)); // JSON sondaki boşlukları yok sayar
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(uid, "not", notId) }, dek, bayt);
  return { ciphertext: b64Kodla(ct), iv: b64Kodla(iv) };
}

export async function notuCoz(ciphertextB64, ivB64, notId) {
  const { uid, dek } = oturumGerekli();
  const acik = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64Coz(ivB64), additionalData: aad(uid, "not", notId) },
    dek,
    b64Coz(ciphertextB64)
  );
  return JSON.parse(dec.decode(acik));
}

/** Ek (görsel/PDF) baytları: [12 bayt iv][ciphertext]. R2'ye giden şey budur. */
export async function ekiSifrele(arrayBuffer, r2Anahtari) {
  const { uid, dek } = oturumGerekli();
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(uid, "ek", r2Anahtari) },
    dek,
    arrayBuffer
  );
  return birlestir(iv, new Uint8Array(ct));
}

export async function ekiCoz(arrayBuffer, r2Anahtari) {
  const { uid, dek } = oturumGerekli();
  const ham = new Uint8Array(arrayBuffer);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ham.slice(0, 12), additionalData: aad(uid, "ek", r2Anahtari) },
    dek,
    ham.slice(12)
  );
}

export const kullaniciKimligi = () => oturum?.uid || null;
export const sifreliYedekIcinKasaSatiri = () => oturum?.satir || null;
