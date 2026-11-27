/*
 * assets/js/medya-donustur/medya-donustur.js — Araçlar › Medya Araçları › Ses & Video Dönüştürücü
 *  • MP4 / MOV / WAV / MP3 / M4A / OGG / WEBM dosyalarının SESİNİ tarayıcıda çözer (Web Audio), MONO MP3'e küçültür (64 veya 128 kbps; lamejs, açık kaynak).
 *  • Transkript ayrı araçtır: bkz. assets/js/medya-transkript/ (kendi yetki anahtarı, kota ve isteğe bağlı kendi API anahtarı).
 * GİZLİLİK: Dönüştürme tamamen tarayıcıda; hiçbir şey sunucuya gitmez. SINIR: AVI ve tarayıcının çözemediği kodekler desteklenmez. CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, adsizAl } from "../donusturucu/ortak.js";
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
import { lameYukle, sesCoz, monoOrnekle, mp3Kodla, sleep, SINIR, ilerlemeKur } from "./ses-ortak.js";
import { hata as trHata } from "../core/hata-metni.js";

const kok = document.getElementById("md-kok");

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("arac_yetkisi_var_mi", { p_arac: "medya_donustur" });
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Bu araca erişim yetkin bulunmuyor. Site Sahibi, Yetki Ayarları › Özellikler bölümünden açabilir." }))); return; }
  let dosya = null, buf = null;
  const mesaj = el("p", { class: "md-mesaj", role: "status", "aria-live": "polite" }), bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("md-hata", !!h); };
  const { ilr, cubuk, sureYazi } = ilerlemeKur(bildir);
  const girdi = el("input", { type: "file", accept: "audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm", hidden: true });
  const sec = el("button", { type: "button", class: "md-btn md-birincil", text: "🎬 Ses / video seç" }), bilgi = el("p", { class: "md-soluk", text: "Dosya tarayıcında işlenir. MP4, MOV, WAV, MP3, M4A, OGG, WEBM." });
  sec.addEventListener("click", () => girdi.click());
  const kbps = el("select", { class: "md-girdi", "aria-label": "MP3 kalitesi" }, el("option", { value: "64", text: "64 kbps mono (en küçük — konuşma için)" }), el("option", { value: "128", text: "128 kbps mono (daha iyi kalite)" }));
  const donusturBtn = el("button", { type: "button", class: "md-btn md-birincil", text: "🗜 MP3'e küçült ve indir" }); donusturBtn.disabled = true;
  async function yukle(f) {
    try {
      if (f.size > SINIR) throw new Error(`Dosya çok büyük (${bayt(f.size)}); üst sınır ${bayt(SINIR)}.`);
      ilr.baslat("Ses çözülüyor", Math.max(2, f.size / (12 * 1024 * 1024))); dosya = f; buf = await sesCoz(f); ilr.bitir();
      bilgi.textContent = `${f.name} · ${bayt(f.size)} · ${Math.round(buf.duration / 60 * 10) / 10} dk`; donusturBtn.disabled = false; bildir("Hazır.");
    } catch (h) { ilr.bitir(); bildir(trHata(h), true); dosya = null; buf = null; donusturBtn.disabled = true; }
  }
  girdi.addEventListener("change", () => { if (girdi.files?.[0]) yukle(girdi.files[0]); girdi.value = ""; });
  donusturBtn.addEventListener("click", async () => {
    if (!buf) return; donusturBtn.disabled = true;
    try { ilr.baslat("Hazırlanıyor (mono'ya indiriliyor)", Math.max(2, buf.duration / 40)); const lame = await lameYukle(), f32 = await monoOrnekle(buf); await sleep();
      const blob = mp3Kodla(lame, f32, Number(kbps.value), (p) => ilr.guncelle(p, "MP3 kodlanıyor")); ilr.bitir();
      indir(blob, `${adsizAl(dosya.name)}_${kbps.value}kbps.mp3`); bildir(`✔ ${bayt(dosya.size)} → ${bayt(blob.size)} (mono ${kbps.value} kbps MP3).`); }
    catch (h) { ilr.bitir(); bildir(trHata(h), true); } finally { donusturBtn.disabled = false; }
  });
  const temizle = el("button", { type: "button", class: "md-btn", text: "🧹 Belleği temizle" });
  temizle.addEventListener("click", () => { dosya = null; buf = null; ilr.bitir(); donusturBtn.disabled = true; bilgi.textContent = "Dosya tarayıcında işlenir."; bildir("🧹 Bellek temizlendi."); });
  sekmeSifirlamaKaydet("tool-medya-donustur", () => temizle.click());
  kok.classList.add("md-kok");
  kok.replaceChildren(el("div", { class: "md-kart" }, el("p", { class: "md-soluk", text: "🔒 Dönüştürme tamamen tarayıcıda yapılır; dosyan hiçbir yere gönderilmez. Konuşmayı yazıya dökmek için “Transkript Stüdyosu” sekmesini kullan." }), sec, girdi, bilgi),
    el("div", { class: "md-kart" }, el("h2", { text: "MP3'e küçült" }), kbps, donusturBtn), temizle, cubuk, sureYazi, mesaj);
}
kur().catch((h) => { console.error("medya-donustur.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${trHata(h)}` })); });
