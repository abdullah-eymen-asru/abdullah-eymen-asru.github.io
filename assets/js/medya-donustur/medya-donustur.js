/*
 * assets/js/medya-donustur/medya-donustur.js — Araçlar › Ses & Video Dönüştürücü + Çok Dilli Transkript (tur 20)
 *  • MP4 / MOV / WAV / MP3 / M4A / OGG / WEBM dosyalarının SESİNİ tarayıcıda çözer (Web Audio), MONO MP3'e küçültür (64 veya 128 kbps; lamejs, açık kaynak).
 *  • Transkript: ses 64 kbps mono MP3 parçalara (≤ 20 dk) bölünür → "transkript-worker" (Groq Whisper large-v3) → 3 mod: Orijinal dilde · Türkçe'ye çevirerek · İngilizce'ye çevirerek.
 *    TXT / PDF indir, "Taslağa aktar" (Yeni İçerik formunu doldurur).
 * GİZLİLİK: Dönüştürme tamamen tarayıcıda; transkript için YALNIZCA küçültülmüş SES, kendi Worker'ın üzerinden Groq'a gider (GROQ_API_KEY tarayıcıya inmez).
 * SINIR: AVI ve tarayıcının çözemediği kodekler desteklenmez (FFmpeg.wasm çekirdeği ~30 MB'ı kendi sunucuna koymayı gerektirir — sonraki tur). CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, adsizAl } from "../donusturucu/ortak.js";
import { pdfLibAl } from "../donusturucu/pdf-yukle.js";

const kok = document.getElementById("md-kok");
const WORKER = "https://transkript-worker.aeymena.workers.dev";
const LAME = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
const SINIR = 400 * 1024 * 1024, ORNEK = 22050, PARCA_SN = 20 * 60;

let lamePromise = null;
function lameYukle() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  return (lamePromise ||= new Promise((coz, red) => { const s = document.createElement("script"); s.src = LAME; s.crossOrigin = "anonymous"; s.onload = () => (window.lamejs ? coz(window.lamejs) : red(new Error("MP3 kodlayıcı yüklenemedi."))); s.onerror = () => red(new Error("MP3 kodlayıcı (lamejs) indirilemedi; ağ ya da engelleyiciyi kontrol et.")); document.head.append(s); }));
}
async function sesCoz(dosya) {
  const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
  try { return await ac.decodeAudioData(await dosya.arrayBuffer()); }
  catch { throw new Error("Bu dosyanın sesi tarayıcıda çözülemedi (AVI/özel kodek olabilir). MP4, MOV, WAV, MP3, M4A, OGG veya WEBM dene."); }
  finally { ac.close?.(); }
}
async function monoOrnekle(buf) {                                   // tüm kanalları ortala + ORNEK Hz'e indir (OfflineAudioContext)
  const frames = Math.ceil(buf.duration * ORNEK), off = new OfflineAudioContext(1, frames, ORNEK), kaynak = off.createBufferSource();
  kaynak.buffer = buf; kaynak.connect(off.destination); kaynak.start(); return (await off.startRendering()).getChannelData(0);
}
function mp3Kodla(lame, f32, kbps, ilerle) {
  const enc = new lame.Mp3Encoder(1, ORNEK, kbps), blok = 1152, parcalar = [], i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  for (let i = 0; i < i16.length; i += blok) { const b = enc.encodeBuffer(i16.subarray(i, i + blok)); if (b.length) parcalar.push(new Uint8Array(b)); if (ilerle && i % (blok * 400) === 0) ilerle(i / i16.length); }
  const son = enc.flush(); if (son.length) parcalar.push(new Uint8Array(son)); return new Blob(parcalar, { type: "audio/mpeg" });
}
const sleep = () => new Promise((r) => setTimeout(r, 0));

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Bu araca erişim yetkin bulunmuyor." }))); return; }
  let dosya = null, buf = null, metin = "";
  const mesaj = el("p", { class: "md-mesaj", role: "status", "aria-live": "polite" }), bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("md-hata", !!h); };
  const girdi = el("input", { type: "file", accept: "audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm", hidden: true });
  const sec = el("button", { type: "button", class: "md-btn md-birincil", text: "🎬 Ses / video seç" }), bilgi = el("p", { class: "md-soluk", text: "Dosya tarayıcında işlenir. MP4, MOV, WAV, MP3, M4A, OGG, WEBM." });
  sec.addEventListener("click", () => girdi.click());
  const kbps = el("select", { class: "md-girdi", "aria-label": "MP3 kalitesi" }, el("option", { value: "64", text: "64 kbps mono (en küçük — konuşma için)" }), el("option", { value: "128", text: "128 kbps mono (daha iyi kalite)" }));
  const mod = el("select", { class: "md-girdi", "aria-label": "Transkript modu" }, el("option", { value: "orijinal", text: "Orijinal dilde" }), el("option", { value: "tr", text: "Türkçe'ye çevirerek" }), el("option", { value: "en", text: "İngilizce'ye çevirerek" }));
  const dil = el("select", { class: "md-girdi", "aria-label": "Konuşulan dil ipucu" }, ...[["", "Dil: otomatik algıla"], ["tr", "Türkçe"], ["en", "İngilizce"], ["de", "Almanca"], ["fr", "Fransızca"], ["es", "İspanyolca"], ["ru", "Rusça"], ["ar", "Arapça"], ["zh", "Çince"], ["ja", "Japonca"]].map(([v, a]) => el("option", { value: v, text: a })));
  const donusturBtn = el("button", { type: "button", class: "md-btn md-birincil", text: "🗜 MP3'e küçült ve indir" }), transBtn = el("button", { type: "button", class: "md-btn", text: "📝 Transkript çıkar" });
  const sonuc = el("textarea", { class: "md-girdi md-sonuc", rows: 14, placeholder: "Transkript burada görünür…", "aria-label": "Transkript" }); sonuc.hidden = true;
  const cikti = el("div", { class: "md-eylem" }); cikti.hidden = true;
  const dugmeler = [donusturBtn, transBtn]; dugmeler.forEach((b) => { b.disabled = true; });

  async function yukle(f) {
    try {
      if (f.size > SINIR) throw new Error(`Dosya çok büyük (${bayt(f.size)}); üst sınır ${bayt(SINIR)}.`);
      bildir("Ses çözülüyor…"); dosya = f; buf = await sesCoz(f);
      bilgi.textContent = `${f.name} · ${bayt(f.size)} · ${Math.round(buf.duration / 60 * 10) / 10} dk`; dugmeler.forEach((b) => { b.disabled = false; }); bildir("Hazır.");
    } catch (h) { bildir(h.message, true); dosya = null; buf = null; dugmeler.forEach((b) => { b.disabled = true; }); }
  }
  girdi.addEventListener("change", () => { if (girdi.files?.[0]) yukle(girdi.files[0]); girdi.value = ""; });

  donusturBtn.addEventListener("click", async () => {
    if (!buf) return; donusturBtn.disabled = true;
    try { const lame = await lameYukle(); bildir("Mono'ya indiriliyor…"); const f32 = await monoOrnekle(buf); await sleep();
      const blob = mp3Kodla(lame, f32, Number(kbps.value), (p) => bildir(`MP3 kodlanıyor… %${Math.round(p * 100)}`));
      indir(blob, `${adsizAl(dosya.name)}_${kbps.value}kbps.mp3`); bildir(`✔ ${bayt(dosya.size)} → ${bayt(blob.size)} (mono ${kbps.value} kbps MP3).`); }
    catch (h) { bildir(h.message || String(h), true); } finally { donusturBtn.disabled = false; }
  });

  transBtn.addEventListener("click", async () => {
    if (!buf) return; transBtn.disabled = true; sonuc.hidden = true; cikti.hidden = true; metin = "";
    try {
      const lame = await lameYukle(), { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error("Oturum gerekli.");
      bildir("Ses hazırlanıyor…"); const f32 = await monoOrnekle(buf), parcaN = PARCA_SN * ORNEK, adet = Math.max(1, Math.ceil(f32.length / parcaN)), parcalar = [];
      for (let i = 0; i < adet; i++) {
        bildir(`Parça ${i + 1}/${adet} sıkıştırılıyor…`); await sleep();
        const blob = mp3Kodla(lame, f32.subarray(i * parcaN, Math.min(f32.length, (i + 1) * parcaN)), 64);
        const fd = new FormData(); fd.append("dosya", new File([blob], `parca-${i + 1}.mp3`, { type: "audio/mpeg" })); fd.append("mod", mod.value); if (dil.value) fd.append("dil", dil.value);
        bildir(`Parça ${i + 1}/${adet} yazıya dökülüyor…`);
        const r = await fetch(`${WORKER}/transkript`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: fd }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.hata || `Transkript hatası (${r.status})`); parcalar.push(j.metin || "");
      }
      metin = parcalar.join("\n\n").trim(); sonuc.value = metin; sonuc.hidden = false; cikti.hidden = false; bildir(`✔ Transkript hazır (${metin.length.toLocaleString("tr-TR")} karakter). İstersen metni düzenle.`);
    } catch (h) { bildir(h.message || String(h), true); } finally { transBtn.disabled = false; }
  });

  const dg = (m, f) => { const b = el("button", { type: "button", class: "md-btn", text: m }); b.addEventListener("click", f); return b; };
  const guncel = () => sonuc.value;
  cikti.append(
    dg("⬇ TXT indir", () => indir(new Blob([guncel()], { type: "text/plain;charset=utf-8" }), `${adsizAl(dosya?.name || "transkript")}_transkript.txt`)),
    dg("⬇ PDF indir", async () => { try { bildir("PDF hazırlanıyor…"); indir(await metinPdf(guncel(), adsizAl(dosya?.name || "Transkript")), `${adsizAl(dosya?.name || "transkript")}_transkript.pdf`); bildir("✔ PDF indirildi."); } catch (h) { bildir(h.message, true); } }),
    dg("📝 Taslağa aktar (Yeni İçerik)", () => { sessionStorage.setItem("gy_onbilgi", JSON.stringify({ baslik: `${adsizAl(dosya?.name || "Transkript")} — transkript`, govde: guncel() })); location.hash = "#content-new"; }));
  const temizle = dg("🧹 Belleği temizle", () => { dosya = null; buf = null; metin = ""; sonuc.value = ""; sonuc.hidden = true; cikti.hidden = true; dugmeler.forEach((b) => { b.disabled = true; }); bilgi.textContent = "Dosya tarayıcında işlenir."; bildir("🧹 Bellek temizlendi."); });
  kok.classList.add("md-kok");
  kok.replaceChildren(el("div", { class: "md-kart" }, el("p", { class: "md-soluk", text: "🔒 Dönüştürme tarayıcıda yapılır. Transkriptte yalnızca küçültülmüş SES, kendi Worker'ın üzerinden Groq Whisper'a gider." }), sec, girdi, bilgi),
    el("div", { class: "md-kart" }, el("h2", { text: "1) MP3'e küçült" }), kbps, donusturBtn), el("div", { class: "md-kart" }, el("h2", { text: "2) Transkript" }), mod, dil, transBtn, sonuc, cikti), temizle, mesaj);
}

/** Türkçe karakter güvenli PDF: sayfalar tuvalde çizilir, PNG olarak gömülür (metin seçilemez; seçilebilir metin için TXT kullan). */
async function metinPdf(metin, baslik) {
  const { PDFDocument } = await pdfLibAl(), doc = await PDFDocument.create(), W = 1240, H = 1754, kenar = 110, satirH = 34, yaz = 26;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  const satirlar = []; x.font = `${yaz}px Arial, Helvetica, sans-serif`;
  for (const p of [baslik, "", ...String(metin).split(/\r?\n/)]) { if (!p.trim()) { satirlar.push(""); continue; } let sat = ""; for (const k of p.split(/\s+/)) { const t = sat ? `${sat} ${k}` : k; if (x.measureText(t).width > W - 2 * kenar && sat) { satirlar.push(sat); sat = k; } else sat = t; } if (sat) satirlar.push(sat); }
  const sayfaSat = Math.floor((H - 2 * kenar) / satirH);
  for (let i = 0; i < Math.max(1, satirlar.length); i += sayfaSat) {
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.fillStyle = "#111"; x.font = `${yaz}px Arial, Helvetica, sans-serif`;
    satirlar.slice(i, i + sayfaSat).forEach((s, k) => { if (i === 0 && k === 0) x.font = `bold ${yaz + 4}px Arial, Helvetica, sans-serif`; else x.font = `${yaz}px Arial, Helvetica, sans-serif`; x.fillText(s, kenar, kenar + (k + 1) * satirH); });
    const png = await new Promise((r) => c.toBlob(r, "image/png")), img = await doc.embedPng(new Uint8Array(await png.arrayBuffer())), sf = doc.addPage([595.28, 841.89]); sf.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    await sleep();
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}
kur().catch((h) => { console.error("medya-donustur.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` })); });
