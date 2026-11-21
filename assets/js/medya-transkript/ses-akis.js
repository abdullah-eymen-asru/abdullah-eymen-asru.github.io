/*
 * assets/js/medya-transkript/ses-akis.js — Transkript Stüdyosu için AKIŞLI ses işleme (tarayıcıda; sunucuya hiçbir şey gitmez).
 *
 * NEDEN: Eski yol, dosyanın TAMAMINI decodeAudioData ile belleğe açıyordu (40 dk ≈ 0,9 GB float). Safari/mobil tarayıcılarda bu
 * "Ses çözülüyor" ekranında sonsuza dek takılıyor ya da sekmeyi çökertiyordu. Yeni yol:
 *   1) Süre, dosya AÇILMADAN (medya meta verisinden) okunur → ayarlar hemen görünür, "çözülüyor" beklemesi yok.
 *   2) Ses, mediabunny (WebCodecs) ile PARÇA PARÇA çözülür; her an bellekte yalnızca bir parça (≈ 20 dk · 16 kHz mono ≈ 77 MB) bulunur.
 *   3) Seçilen aralık [bas, son) dışındaki ses hiç çözülmez/gönderilmez.
 *   4) mediabunny yüklenemez ya da kodek desteklenmezse eski yola (decodeAudioData) otomatik dönülür.
 * MP3 kodlama olay döngüsüne düzenli nefes aldırır (arayüz donmaz) ve iptal edilebilir.
 */
import { lameYukle } from "../medya-donustur/ses-ortak.js";

export const HEDEF_HZ = 16000;                 // Whisper zaten 16 kHz'e indirir; daha yüksek örnekleme boşuna bayt harcar
export const PARCA_SN = 20 * 60;               // tek Whisper isteğinde en çok 20 dk
export const MP3_KBPS = 32;                    // 16 kHz mono konuşma için yeterli; 20 dk ≈ 4,8 MB (Groq sınırı 25 MB)
const MB_URL = "https://cdn.jsdelivr.net/npm/mediabunny@1.65.2/dist/bundles/mediabunny.min.mjs";   // sürüm sabit (yayımlanalı >2 hafta)

let mbSoz = null;
export function mediabunnyYukle() {
  return (mbSoz ||= import(MB_URL).catch((h) => { console.warn("mediabunny yüklenemedi; eski ses çözme yoluna dönülecek:", h); mbSoz = null; return null; }));
}
const iptalHatasi = () => Object.assign(new Error("İptal edildi."), { name: "AbortError" });
/* Olay döngüsüne nefes: setTimeout(0) arka plan sekmelerinde ≥1 sn'ye (5 dk sonra dakikada 1'e) kısılır → uzun işler 2 dk yerine 5 dk sürüyordu.
 * MessageChannel kısılmaz; sekme arka plandayken de aynı hızda çalışır. */
const nefes = (() => {
  let kanal = null; const bekleyen = [];
  try { kanal = new MessageChannel(); kanal.port1.onmessage = () => { const f = bekleyen.shift(); f?.(); }; } catch { kanal = null; }
  return () => new Promise((r) => { if (kanal) { bekleyen.push(r); kanal.port2.postMessage(0); } else setTimeout(r, 0); });
})();

/**
 * Uzun iş sürerken sekmenin arka planda kısılmasını azaltır: (1) ekran uyku kilidi, (2) duyulmayacak kadar zayıf (≈ −54 dB, 30 Hz) sürekli ses —
 * tarayıcılar sesli sekmeleri zamanlayıcı kısmasından muaf tutar. Kullanıcı hareketi (tıklama) içinde çağrılmalıdır. Dönen fonksiyon her şeyi bırakır.
 * Garanti DEĞİL (tarayıcı/enerji tasarrufu karar verir) ama süreyi belirgin biçimde korur.
 */
export function uyanikTut() {
  let kilit = null, ac = null, bitti = false;
  try { navigator.wakeLock?.request?.("screen").then((k) => { if (bitti) k.release?.(); else kilit = k; }).catch(() => {}); } catch { /* destek yok */ }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ac = new AC(); const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 30; g.gain.value = 0.002; o.connect(g); g.connect(ac.destination); o.start(); ac.resume?.().catch(() => {});
    }
  } catch { ac = null; }
  return () => { bitti = true; try { kilit?.release?.(); } catch { /* yok */ } try { ac?.close?.(); } catch { /* yok */ } };
}

/** CBR MP3'ten [bas, son) sn dilimi (144 baytlık çerçeve sınırından; yeniden kodlama gerekmez). blobBas/blobSure: blob'un kayıttaki başlangıcı ve süresi (sn). */
export function mp3Dilim(blob, blobBas, blobSure, bas, son) {
  const CERCEVE = 144, baytSn = blob.size / Math.max(0.001, blobSure);
  const a = Math.max(0, Math.floor(((bas - blobBas) * baytSn) / CERCEVE) * CERCEVE);
  const b = Math.min(blob.size, Math.ceil(((son - blobBas) * baytSn) / CERCEVE) * CERCEVE);
  return b - a > CERCEVE * 4 ? blob.slice(a, b, "audio/mpeg") : blob;
}

/** Dosyayı ÇÖZMEDEN süresini (sn) bulur; bulunamazsa 0. */
export async function sureOku(dosya) {
  const metaSure = await new Promise((coz) => {
    const video = /^video\//.test(dosya.type) || /\.(mp4|m4v|mov|webm)$/i.test(dosya.name);
    const m = document.createElement(video ? "video" : "audio");
    const u = URL.createObjectURL(dosya);
    const bit = (s) => { clearTimeout(z); URL.revokeObjectURL(u); m.removeAttribute("src"); m.load?.(); coz(Number.isFinite(s) && s > 0 ? s : 0); };
    const z = setTimeout(() => bit(0), 8000);
    m.preload = "metadata"; m.muted = true;
    m.onloadedmetadata = () => bit(m.duration);
    m.onerror = () => bit(0);
    m.src = u;
  });
  if (metaSure) return metaSure;
  const mb = await mediabunnyYukle();
  if (!mb) return 0;
  try {
    const input = new mb.Input({ source: new mb.BlobSource(dosya), formats: mb.ALL_FORMATS });
    return (await input.getDurationFromMetadata?.()) || (await input.computeDuration()) || 0;
  } catch { return 0; }
}

/** MP3 kodla (mono, HEDEF_HZ). Her ~2 sn'lik ses sonrası olay döngüsüne nefes verir; iptal edilebilir. */
export async function mp3Kodla(f32, { kbps = MP3_KBPS, ilerle, signal } = {}) {
  const lame = await lameYukle();
  const enc = new lame.Mp3Encoder(1, HEDEF_HZ, kbps), blok = 1152, parcalar = [];
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  for (let i = 0, k = 0; i < i16.length; i += blok, k++) {
    const b = enc.encodeBuffer(i16.subarray(i, i + blok));
    if (b.length) parcalar.push(new Uint8Array(b));
    if (k % 600 === 0) { if (signal?.aborted) throw iptalHatasi(); ilerle?.(i / i16.length); await nefes(); }
  }
  const son = enc.flush();
  if (son.length) parcalar.push(new Uint8Array(son));
  return new Blob(parcalar, { type: "audio/mpeg" });
}

/**
 * Sesi [bas, son) aralığında, PARCA_SN'lik mono HEDEF_HZ parçalar hâlinde üretir.
 *   parca({ i, bas, sure, f32 }) her parça dolunca ÇAĞRILIR ve beklenir (kodla/gönder). f32 yalnızca çağrı süresince geçerlidir.
 *   ilerle(0..1, metin) ilerleme bildirir. Dönüş: { sure: kaydın toplam süresi (biliniyorsa), yontem: "akis" | "tam" }
 */
export async function sesAkisi(dosya, { bas = 0, son = Infinity, signal, ilerle, parca }) {
  let basladi = false;
  const sar = async (p) => { basladi = true; await p; };
  const mb = await mediabunnyYukle();
  if (mb) {
    try { return await akisYolu(mb, dosya, { bas, son, signal, ilerle, parca: (x) => sar(parca(x)) }); }
    catch (h) {
      if (h?.name === "AbortError" || basladi) throw h;          // yarıda kalmış akıştan eski yola dönmek parçaları tekrarlardı
      console.warn("Akışlı çözme başlatılamadı, eski yola dönülüyor:", h);
    }
  }
  return tamYolu(dosya, { bas, son, signal, ilerle, parca });
}

async function akisYolu(mb, dosya, { bas, son, signal, ilerle, parca }) {
  const input = new mb.Input({ source: new mb.BlobSource(dosya), formats: mb.ALL_FORMATS });
  const iz = await input.getPrimaryAudioTrack();
  if (!iz) throw new Error("Bu dosyada ses izi bulunamadı.");
  if (!(await iz.canDecode())) throw Object.assign(new Error("Bu ses kodeği tarayıcıda çözülemiyor."), { kodek: true });
  const toplam = (await input.getDurationFromMetadata?.().catch(() => null)) || (await input.computeDuration());
  const bitis = Math.min(son, toplam || son), uzunluk = Math.max(0.001, bitis - bas);
  const sink = new mb.AudioSampleSink(iz);
  const parcaN = PARCA_SN * HEDEF_HZ;
  let tampon = new Float32Array(parcaN + 262144), dolu = 0, parcaBas = bas, idx = 0;   // pay: tek bir AudioSample parçayı aşsa da taşma olmaz
  // kutu ortalamalı örnek azaltma (konuşma için yeterli kalite; ek bağımlılık yok)
  let oran = 0, oIdx = -1, toplamX = 0, say = 0, g = 0;
  const bosalt = async (zorla) => {
    if (!dolu || (!zorla && dolu < parcaN)) return;
    if (signal?.aborted) throw iptalHatasi();
    await parca({ i: idx, bas: parcaBas, sure: dolu / HEDEF_HZ, f32: tampon.subarray(0, dolu) });
    idx++; parcaBas += dolu / HEDEF_HZ; dolu = 0;
  };
  const kanalTamponlari = [];
  for await (const ornek of sink.samples(bas, bitis)) {
    if (signal?.aborted) { ornek.close(); throw iptalHatasi(); }
    const sr = ornek.sampleRate, kanal = ornek.numberOfChannels, n = ornek.numberOfFrames, t0 = ornek.timestamp;
    if (!oran) oran = sr / HEDEF_HZ;
    for (let c = 0; c < kanal; c++) {
      if (!kanalTamponlari[c] || kanalTamponlari[c].length < n) kanalTamponlari[c] = new Float32Array(n);
      ornek.copyTo(kanalTamponlari[c], { planeIndex: c, format: "f32-planar", frameCount: n });
    }
    ornek.close();
    const atla = Math.max(0, Math.round((bas - t0) * sr));                       // aralık başlangıcından önceki kısım
    const kes = t0 + n / sr > bitis ? Math.max(atla, Math.floor((bitis - t0) * sr)) : n;   // aralık bitişinden sonraki kısım
    for (let f = atla; f < kes; f++) {
      let x = 0; for (let c = 0; c < kanal; c++) x += kanalTamponlari[c][f];
      const o = Math.floor(g / oran);
      if (o !== oIdx) { if (say) tampon[dolu++] = toplamX / (say * kanal); oIdx = o; toplamX = 0; say = 0; }
      toplamX += x; say++; g++;
    }
    ilerle?.(Math.min(1, (t0 + n / sr - bas) / uzunluk), "Ses işleniyor");
    await bosalt(false);
    if (t0 + n / sr >= bitis) break;
  }
  if (say) tampon[dolu++] = toplamX / (say * (kanalTamponlari.length || 1));
  await bosalt(true);
  return { sure: toplam || bitis, yontem: "akis" };
}

/** Eski yol: dosyanın tamamını çözer (bellek yoğun); yalnızca akışlı yol kullanılamıyorsa. */
async function tamYolu(dosya, { bas, son, signal, ilerle, parca }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let buf;
  try { ilerle?.(0, "Ses çözülüyor (bu tarayıcıda uzun sürebilir)"); buf = await ac.decodeAudioData(await dosya.arrayBuffer()); }
  catch { throw new Error("Bu dosyanın sesi tarayıcıda çözülemedi. MP3, WAV, M4A, OGG, MP4, MOV veya WEBM dene; çok uzun kayıtlarda Chrome/Edge/Safari'nin güncel sürümünü kullan."); }
  finally { ac.close?.(); }
  if (signal?.aborted) throw iptalHatasi();
  const bitis = Math.min(son, buf.duration);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * HEDEF_HZ)), HEDEF_HZ), k = off.createBufferSource();
  k.buffer = buf; k.connect(off.destination); k.start();
  const tum = (await off.startRendering()).getChannelData(0);
  const parcaN = PARCA_SN * HEDEF_HZ, b0 = Math.floor(bas * HEDEF_HZ), b1 = Math.min(tum.length, Math.floor(bitis * HEDEF_HZ));
  for (let i = 0, p = b0; p < b1; i++, p += parcaN) {
    if (signal?.aborted) throw iptalHatasi();
    const dilim = tum.subarray(p, Math.min(b1, p + parcaN));
    await parca({ i, bas: p / HEDEF_HZ, sure: dilim.length / HEDEF_HZ, f32: dilim });
    ilerle?.((p + dilim.length - b0) / Math.max(1, b1 - b0), "Ses işleniyor");
  }
  return { sure: buf.duration, yontem: "tam" };
}
