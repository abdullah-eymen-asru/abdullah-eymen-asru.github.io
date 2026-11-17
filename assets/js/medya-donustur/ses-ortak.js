/* assets/js/medya-donustur/ses-ortak.js — Ses & Video Dönüştürücü ile Transkript Stüdyosu'nun ORTAK ses işleme parçaları (tarayıcıda; sunucuya hiçbir şey gitmez). */
const LAME = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
export const SINIR = 400 * 1024 * 1024, ORNEK = 22050, PARCA_SN = 20 * 60;
let lamePromise = null;
export function lameYukle() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  return (lamePromise ||= new Promise((coz, red) => { const s = document.createElement("script"); s.src = LAME; s.crossOrigin = "anonymous"; s.onload = () => (window.lamejs ? coz(window.lamejs) : red(new Error("MP3 kodlayıcı yüklenemedi."))); s.onerror = () => { lamePromise = null; red(new Error("MP3 kodlayıcı (lamejs) indirilemedi; ağ ya da engelleyiciyi kontrol et.")); }; document.head.append(s); }));
}
export async function sesCoz(dosya) {
  const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
  try { return await ac.decodeAudioData(await dosya.arrayBuffer()); }
  catch { throw new Error("Bu dosyanın sesi tarayıcıda çözülemedi (AVI/özel kodek olabilir). MP4, MOV, WAV, MP3, M4A, OGG veya WEBM dene."); }
  finally { ac.close?.(); }
}
export async function monoOrnekle(buf) {                                   // tüm kanalları ortala + ORNEK Hz'e indir (OfflineAudioContext)
  const frames = Math.ceil(buf.duration * ORNEK), off = new OfflineAudioContext(1, frames, ORNEK), kaynak = off.createBufferSource();
  kaynak.buffer = buf; kaynak.connect(off.destination); kaynak.start(); return (await off.startRendering()).getChannelData(0);
}
export function mp3Kodla(lame, f32, kbps, ilerle) {
  const enc = new lame.Mp3Encoder(1, ORNEK, kbps), blok = 1152, parcalar = [], i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  for (let i = 0; i < i16.length; i += blok) { const b = enc.encodeBuffer(i16.subarray(i, i + blok)); if (b.length) parcalar.push(new Uint8Array(b)); if (ilerle && i % (blok * 400) === 0) ilerle(i / i16.length); }
  const son = enc.flush(); if (son.length) parcalar.push(new Uint8Array(son)); return new Blob(parcalar, { type: "audio/mpeg" });
}
export const sleep = () => new Promise((r) => setTimeout(r, 0));

/** İlerleme çubuğu + geçen/kalan süre (iki araç da kullanır). */
export function ilerlemeKur(bildir) {
  const cubuk = document.createElement("progress"); cubuk.className = "md-ilerleme"; cubuk.max = 100; cubuk.hidden = true;
  const sureYazi = document.createElement("p"); sureYazi.className = "md-soluk md-sure"; sureYazi.hidden = true;
  const f = (n) => (n >= 60 ? `${Math.floor(n / 60)} dk ${Math.round(n % 60)} sn` : `${Math.round(n)} sn`);
  const ilr = { t0: 0, etiket: "", oran: null, tahmin: 0, z: null,
    baslat(etiket, tahminSn = 0) { this.t0 = Date.now(); this.etiket = etiket; this.oran = null; this.tahmin = tahminSn; cubuk.hidden = false; sureYazi.hidden = false; cubuk.removeAttribute("value"); clearInterval(this.z); this.z = setInterval(() => this.ciz(), 500); this.ciz(); },
    guncelle(oran, etiket) { if (etiket) this.etiket = etiket; this.oran = oran; this.ciz(); },
    ciz() { const g = (Date.now() - this.t0) / 1000; let kalan = "";
      if (this.oran != null && this.oran > 0.02) { cubuk.value = Math.round(this.oran * 100); kalan = ` · tahmini kalan ${f(Math.max(0, g * (1 - this.oran) / this.oran))}`; }
      else { cubuk.removeAttribute("value"); if (this.tahmin) kalan = ` · tahmini toplam ~${f(this.tahmin)}`; }
      bildir(`${this.etiket}${this.oran != null ? ` — %${Math.round(this.oran * 100)}` : ""}`); sureYazi.textContent = `Geçen süre ${f(g)}${kalan}`; },
    bitir(son) { clearInterval(this.z); cubuk.hidden = true; sureYazi.hidden = true; if (son) bildir(son); } };
  return { ilr, cubuk, sureYazi };
}
