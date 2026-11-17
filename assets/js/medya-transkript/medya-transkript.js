/*
 * assets/js/medya-transkript/medya-transkript.js — Araçlar › Medya Araçları › Transkript Stüdyosu
 *  • Ses/video tarayıcıda küçültülür (≤20 dk parçalar) → transkript-worker → Groq Whisper (zaman damgalı segmentler).
 *  • Konuşmacı yönetimi: adlandır, satırlara ata (toplu), duraklamaya göre TAHMİNİ ayır; her konuşmacının dakika/saat aralıkları, süre payı, kelime sayısı.
 *  • Başlık dosya adından DEĞİL, içerikten önerilir (düzenlenebilir). Arama/değiştir, oynatıcıyla senkron, böl/birleştir/sil + geri al, dolgu temizleme.
 *  • Dışa aktarma: TXT · Markdown · SRT · VTT · CSV · JSON · DOCX · PDF · panoya kopyala · Yeni İçerik taslağı.
 *  • Kota (kullanıcı + genel) ve isteğe bağlı KENDİ Groq anahtarı: medya-kota.js. Yerel geçmiş yalnızca bu tarayıcının IndexedDB'sindedir (sunucuya gitmez).
 * GİZLİLİK: ses yalnızca Worker üzerinden Groq'a gider (Groq üçüncü taraftır); Worker kayıt tutmaz. Whisper konuşmacı tanımaz — otomatik ayrım "tahmini"dir. CSP: inline stil/olay yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, dosyaAdiTemizle } from "../donusturucu/ortak.js";
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
import { lameYukle, sesCoz, monoOrnekle, mp3Kodla, sleep, SINIR, ORNEK, PARCA_SN, ilerlemeKur } from "../medya-donustur/ses-ortak.js";
import { kotaPaneli, kaynakSecici } from "../medya-kota/medya-kota.js";
import { RENKLER, saat, gunSaniyesi, gunSaati, kelimeSay, istatistik, tahminiAyir, dolguTemizle, anahtarKelimeler, baslikOner, metinUret } from "./transkript-mantik.js";

const kok = document.getElementById("mt-kok");
const WORKER = "https://transkript-worker.aeymena.workers.dev";
const SAYFA = 250;
const DILLER = [["", "Otomatik algıla"], ["tr", "Türkçe"], ["en", "İngilizce"], ["de", "Almanca"], ["fr", "Fransızca"], ["es", "İspanyolca"], ["it", "İtalyanca"], ["pt", "Portekizce"], ["nl", "Felemenkçe"], ["ru", "Rusça"], ["ar", "Arapça"], ["fa", "Farsça"], ["zh", "Çince"], ["ja", "Japonca"], ["ko", "Korece"], ["hi", "Hintçe"], ["uk", "Ukraynaca"], ["pl", "Lehçe"]];

/* ---------------- Yerel geçmiş (IndexedDB; yalnızca bu tarayıcı) ---------------- */
const gecmis = {
  ac() { return new Promise((coz, red) => { try { const r = indexedDB.open("mt-gecmis", 1); r.onupgradeneeded = () => r.result.createObjectStore("kayit", { keyPath: "id" }); r.onsuccess = () => coz(r.result); r.onerror = () => red(r.error); } catch (h) { red(h); } }); },
  async islem(mod, fn) { const db = await this.ac(); return new Promise((coz, red) => { const t = db.transaction("kayit", mod), s = t.objectStore("kayit"), r = fn(s); t.oncomplete = () => { db.close(); coz(r?.result); }; t.onerror = () => { db.close(); red(t.error); }; }); },
  kaydet(k) { return this.islem("readwrite", (s) => s.put(k)); },
  sil(id) { return this.islem("readwrite", (s) => s.delete(id)); },
  liste() { return this.islem("readonly", (s) => s.getAll()); },
};

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("arac_yetkisi_var_mi", { p_arac: "transkript" });
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Transkript aracına erişim yetkin yok. Site Sahibi, Yetki Ayarları › Özellikler bölümünden açabilir." }))); return; }

  /* ---------------- Durum ---------------- */
  let dosya = null, buf = null, ses = null, sesUrl = null, iptal = null, devam = null;
  let T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] };
  let nid = 1, sayfaBas = 0, secili = new Set(), bulunan = [], bulIdx = -1, aramaMetni = "", geriAl = [], kayitId = null, baslikElleMi = false;
  const yeniSeg = (o) => ({ id: nid++, ...o });

  const mesaj = el("p", { class: "md-mesaj", role: "status", "aria-live": "polite" }), bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("md-hata", !!h); };
  const { ilr, cubuk, sureYazi } = ilerlemeKur(bildir);
  const kota = kotaPaneli("transkript"), kaynak = kaynakSecici("transkript");

  /* ---------------- Kaynak + ayarlar ---------------- */
  const girdi = el("input", { type: "file", accept: "audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm", hidden: true });
  const sec = el("button", { type: "button", class: "md-btn md-birincil", text: "🎬 Ses / video seç" }), bilgi = el("p", { class: "md-soluk", text: "MP4, MOV, WAV, MP3, M4A, OGG, WEBM · dosya tarayıcında işlenir; yalnızca küçültülmüş ses transkript için gönderilir." });
  sec.addEventListener("click", () => girdi.click());
  const mod = el("select", { class: "md-girdi", "aria-label": "Transkript modu" }, el("option", { value: "orijinal", text: "Orijinal dilde yaz" }), el("option", { value: "tr", text: "Türkçe'ye çevirerek" }), el("option", { value: "en", text: "İngilizce'ye çevirerek" }));
  const dil = el("select", { class: "md-girdi", "aria-label": "Konuşulan dil" }, ...DILLER.map(([v, a]) => el("option", { value: v, text: `Dil: ${a}` })));
  const baslangic = el("input", { class: "md-girdi", type: "time", step: "1", "aria-label": "Kaydın başlangıç saati" });
  const basla = el("button", { type: "button", class: "md-btn md-birincil", text: "📝 Transkripti başlat" }), durdur = el("button", { type: "button", class: "md-btn", text: "⏹ Durdur", hidden: true });
  basla.disabled = true;
  const etiket = (y, g, ip) => el("label", { class: "mi-etiket" }, y, g, ip ? el("small", { class: "md-soluk", text: ip }) : null);

  /* ---------------- Stüdyo ---------------- */
  const stud = el("div", { class: "mt-studyo", hidden: true });
  const baslikGirdi = el("input", { class: "md-girdi mt-baslik", type: "text", maxlength: "140", placeholder: "Başlık (içerikten önerilir)", "aria-label": "Transkript başlığı" });
  const baslikOneri = el("button", { type: "button", class: "md-btn", text: "✨ İçerikten öner", title: "Dosya adını değil, konuşmanın içeriğini kullanır" });
  const meta = el("p", { class: "md-soluk mt-meta" }), anahtarlar = el("p", { class: "md-soluk mt-anahtar" });
  const geriBtn = el("button", { type: "button", class: "md-btn", text: "↩ Geri al" }); geriBtn.disabled = true;
  const ara = el("input", { class: "md-girdi", type: "search", placeholder: "Transkriptte ara…", "aria-label": "Ara", autocomplete: "off" }), araSay = el("span", { class: "md-soluk mt-arasay" });
  const onceki = el("button", { type: "button", class: "md-btn", text: "▲", "aria-label": "Önceki sonuç" }), sonraki = el("button", { type: "button", class: "md-btn", text: "▼", "aria-label": "Sonraki sonuç" });
  const degis = el("input", { class: "md-girdi", type: "text", placeholder: "Şununla değiştir…", "aria-label": "Değiştirilecek metin", autocomplete: "off" }), degisBtn = el("button", { type: "button", class: "md-btn", text: "Tümünü değiştir" });
  const dolguBtn = el("button", { type: "button", class: "md-btn", text: "🧹 Dolgu seslerini temizle (eee, ııı…)" });
  const oynatici = el("audio", { controls: true, preload: "metadata", class: "mt-oynatici", "aria-label": "Kayıt" });
  const hiz = el("select", { class: "md-girdi mt-hiz", "aria-label": "Oynatma hızı" }, ...["0.75", "1", "1.25", "1.5", "2"].map((v) => el("option", { value: v, text: `${v}×` })));
  hiz.value = "1";
  const takip = el("input", { type: "checkbox", checked: true }), sesBaglaBtn = el("button", { type: "button", class: "md-btn", text: "🔗 Kayıt dosyasını bağla (oynatma için)" });
  const liste = el("div", { class: "mt-liste", role: "list" }), sayfaYeri = el("div", { class: "mt-sayfa md-eylem" });
  const kPanel = el("section", { class: "md-kart mt-konusmacilar" });
  const topluSec = el("select", { class: "md-girdi", "aria-label": "Seçili satırlara atanacak konuşmacı" }), topluBtn = el("button", { type: "button", class: "md-btn", text: "Seçililere ata" }), sondanBtn = el("button", { type: "button", class: "md-btn", text: "İlk seçiliden sona kadar ata" }), secTumBtn = el("button", { type: "button", class: "md-btn", text: "Hepsini seç / kaldır" });
  const zamanSec = el("input", { type: "checkbox", checked: true }), kSec = el("input", { type: "checkbox", checked: true }), gunSaatiSec = el("input", { type: "checkbox" });

  /* ---------------- Yardımcılar ---------------- */
  const topSure = () => (T.segmentler.length ? T.segmentler[T.segmentler.length - 1].s : 0);
  const anlik = () => JSON.stringify({ s: T.segmentler, k: T.konusmacilar, b: T.baslik });
  function kaydetGeri() { geriAl.push(anlik()); if (geriAl.length > 25) geriAl.shift(); geriBtn.disabled = false; }
  geriBtn.addEventListener("click", () => { const x = geriAl.pop(); if (!x) return; const o = JSON.parse(x); T.segmentler = o.s; T.konusmacilar = o.k; T.baslik = o.b; baslikGirdi.value = o.b; secili.clear(); hepsiniCiz(); geriBtn.disabled = !geriAl.length; });
  const baslangicSn = () => (gunSaatiSec.checked ? gunSaniyesi(baslangic.value) : null);
  const zamanYazi = (sn) => { const b = gunSaniyesi(baslangic.value); return b != null ? `${saat(sn)} (${gunSaati(b + sn)})` : saat(sn); };
  const renk = (k) => (k == null ? "#94a3b8" : T.konusmacilar[k]?.renk || RENKLER[k % RENKLER.length]);

  /* ---------------- Satır listesi ---------------- */
  function satirYap(s, i) {
    const k = el("select", { class: "mt-kisi", "aria-label": "Konuşmacı" }, el("option", { value: "", text: "—" }), ...T.konusmacilar.map((x, j) => el("option", { value: String(j), text: x.ad })));
    k.value = s.k == null ? "" : String(s.k);
    const ta = el("textarea", { class: "mt-metin", rows: Math.max(1, Math.ceil(s.m.length / 70)), "aria-label": `Satır ${i + 1} metni`, spellcheck: "false" }); ta.value = s.m;
    const sat = el("div", { class: "mt-satir", role: "listitem", "data-i": String(i) },
      el("input", { type: "checkbox", class: "mt-sec", "aria-label": "Satırı seç", checked: secili.has(s.id) }),
      el("button", { type: "button", class: "mt-zaman", "data-islem": "git", title: "Buradan oynat", text: `▶ ${saat(s.b)}` }), k, ta,
      el("span", { class: "mt-islem" }, el("button", { type: "button", "data-islem": "bol", title: "İmleçten böl", text: "✂" }), el("button", { type: "button", "data-islem": "birles", title: "Sonrakiyle birleştir", text: "⤵" }), el("button", { type: "button", "data-islem": "sil", title: "Sil", text: "🗑" })));
    sat.style.setProperty("--renk", renk(s.k));
    if (bulunan.includes(i)) sat.classList.add("mt-bulundu");
    return sat;
  }
  function listeCiz() {
    const son = Math.min(T.segmentler.length, sayfaBas + SAYFA);
    liste.replaceChildren(...T.segmentler.slice(sayfaBas, son).map((s, j) => satirYap(s, sayfaBas + j)));
    sayfaYeri.replaceChildren();
    if (T.segmentler.length > SAYFA) {
      const o = el("button", { type: "button", class: "md-btn", text: "◀ Önceki", disabled: sayfaBas === 0 }), n = el("button", { type: "button", class: "md-btn", text: "Sonraki ▶", disabled: son >= T.segmentler.length });
      o.addEventListener("click", () => { sayfaBas = Math.max(0, sayfaBas - SAYFA); listeCiz(); }); n.addEventListener("click", () => { sayfaBas += SAYFA; listeCiz(); });
      sayfaYeri.append(o, el("span", { class: "md-soluk", text: `${sayfaBas + 1}–${son} / ${T.segmentler.length}` }), n);
    }
  }
  liste.addEventListener("input", (e) => { const sat = e.target.closest(".mt-satir"); if (!sat || !e.target.classList.contains("mt-metin")) return; const s = T.segmentler[Number(sat.dataset.i)]; s.m = e.target.value; e.target.rows = Math.max(1, Math.ceil(s.m.length / 70)); ozetGuncelle(); });
  liste.addEventListener("change", (e) => {
    const sat = e.target.closest(".mt-satir"); if (!sat) return; const i = Number(sat.dataset.i), s = T.segmentler[i];
    if (e.target.classList.contains("mt-sec")) { e.target.checked ? secili.add(s.id) : secili.delete(s.id); return; }
    if (e.target.classList.contains("mt-kisi")) { kaydetGeri(); s.k = e.target.value === "" ? null : Number(e.target.value); sat.style.setProperty("--renk", renk(s.k)); konusmacilariCiz(); }
  });
  liste.addEventListener("click", (e) => {
    const d = e.target.closest("[data-islem]"); if (!d) return; const sat = d.closest(".mt-satir"), i = Number(sat.dataset.i), s = T.segmentler[i];
    if (d.dataset.islem === "git") { if (!sesUrl) { bildir("Oynatmak için önce “Kayıt dosyasını bağla” ile dosyayı seç.", true); return; } oynatici.currentTime = s.b; oynatici.play().catch(() => {}); }
    else if (d.dataset.islem === "sil") { kaydetGeri(); T.segmentler.splice(i, 1); secili.delete(s.id); hepsiniCiz(); }
    else if (d.dataset.islem === "birles") { const n = T.segmentler[i + 1]; if (!n) return; kaydetGeri(); s.m = `${s.m} ${n.m}`.trim(); s.s = n.s; T.segmentler.splice(i + 1, 1); hepsiniCiz(); }
    else if (d.dataset.islem === "bol") {
      const ta = sat.querySelector(".mt-metin"), p = ta.selectionStart; if (!p || p <= 0 || p >= ta.value.length) { bildir("Bölmek için metinde imleci bölünecek yere koy.", true); return; }
      kaydetGeri(); const a = ta.value.slice(0, p).trim(), b = ta.value.slice(p).trim(), oran = a.length / (a.length + b.length || 1), orta = s.b + (s.s - s.b) * oran;
      T.segmentler.splice(i, 1, { ...s, m: a, s: orta }, yeniSeg({ b: orta, s: s.s, m: b, k: s.k })); hepsiniCiz();
    }
  });
  function seciliIndeksler() { return T.segmentler.map((s, i) => (secili.has(s.id) ? i : -1)).filter((i) => i >= 0); }
  topluBtn.addEventListener("click", () => { const l = seciliIndeksler(); if (!l.length) return bildir("Önce satırları işaretle.", true); kaydetGeri(); const v = topluSec.value === "" ? null : Number(topluSec.value); l.forEach((i) => { T.segmentler[i].k = v; }); hepsiniCiz(); });
  sondanBtn.addEventListener("click", () => { const l = seciliIndeksler(); if (!l.length) return bildir("Önce başlangıç satırını işaretle.", true); kaydetGeri(); const v = topluSec.value === "" ? null : Number(topluSec.value); for (let i = l[0]; i < T.segmentler.length; i++) T.segmentler[i].k = v; hepsiniCiz(); });
  secTumBtn.addEventListener("click", () => { const sayfadakiler = T.segmentler.slice(sayfaBas, sayfaBas + SAYFA), hepsi = sayfadakiler.every((s) => secili.has(s.id)); sayfadakiler.forEach((s) => (hepsi ? secili.delete(s.id) : secili.add(s.id))); listeCiz(); });

  /* ---------------- Konuşmacılar paneli ---------------- */
  function konusmacilariCiz() {
    topluSec.replaceChildren(el("option", { value: "", text: "— (atanmamış)" }), ...T.konusmacilar.map((x, j) => el("option", { value: String(j), text: x.ad })));
    const ist = istatistik(T.segmentler, T.konusmacilar), toplam = Math.max(topSure(), 1);
    const satirlar = ist.map((x) => {
      const kisi = x.k == null ? null : T.konusmacilar[x.k];
      const ad = kisi ? el("input", { class: "md-girdi mt-kad", type: "text", value: kisi.ad, maxlength: "40", "aria-label": "Konuşmacı adı" }) : el("strong", { text: "Atanmamış" });
      if (kisi) ad.addEventListener("change", () => { kisi.ad = ad.value.trim() || `Konuşmacı ${x.k + 1}`; listeCiz(); konusmacilariCiz(); });
      const sil = kisi ? el("button", { type: "button", class: "md-btn", text: "Kaldır", title: "Konuşmacıyı kaldır (satırları atanmamış olur)" }) : null;
      sil?.addEventListener("click", () => { kaydetGeri(); T.segmentler.forEach((s) => { if (s.k === x.k) s.k = null; else if (s.k > x.k) s.k -= 1; }); T.konusmacilar.splice(x.k, 1); hepsiniCiz(); });
      const cizgi = el("div", { class: "mt-zamanserit", "aria-hidden": "true" });
      for (const s of T.segmentler.filter((q) => (x.k == null ? q.k == null || !T.konusmacilar[q.k] : q.k === x.k))) { const b = el("span", { class: "mt-parca" }); b.style.left = `${(s.b / toplam) * 100}%`; b.style.width = `${Math.max(0.25, ((s.s - s.b) / toplam) * 100)}%`; cizgi.append(b); }
      cizgi.style.setProperty("--renk", renk(x.k));
      const aralikListe = x.aralik.length ? el("ul", { class: "mt-aralik" }, ...x.aralik.map((a) => el("li", {}, el("button", { type: "button", class: "mt-zaman", "data-git": String(a.b), text: `▶ ${zamanYazi(a.b)} – ${zamanYazi(a.s)}` })))) : null;
      const kart = el("div", { class: "mt-kkart" },
        el("div", { class: "mt-kust" }, el("span", { class: "mt-nokta" }), ad, sil),
        el("p", { class: "md-soluk", text: `${saat(x.sn)} konuştu · %${Math.round(x.pay * 100)} · ${x.kelime.toLocaleString("tr-TR")} kelime · ${x.bolum} bölüm${x.wpm ? ` · ~${x.wpm} kelime/dk` : ""}` }),
        cizgi, aralikListe ? el("details", { class: "mt-detay" }, el("summary", { text: `Konuştuğu aralıklar (${x.aralik.length})` }), aralikListe) : null);
      kart.style.setProperty("--renk", renk(x.k)); return kart;
    });
    const ekle = el("button", { type: "button", class: "md-btn", text: "➕ Konuşmacı ekle" });
    ekle.addEventListener("click", () => { kaydetGeri(); T.konusmacilar.push({ ad: `Konuşmacı ${T.konusmacilar.length + 1}`, renk: RENKLER[T.konusmacilar.length % RENKLER.length] }); hepsiniCiz(); });
    const nSec = el("select", { class: "md-girdi", "aria-label": "Konuşmacı sayısı" }, ...[2, 3, 4, 5, 6].map((n) => el("option", { value: String(n), text: `${n} kişi` })));
    const esik = el("select", { class: "md-girdi", "aria-label": "Duraklama eşiği" }, ...[["1", "≥ 1 sn duraklama"], ["1.5", "≥ 1,5 sn duraklama"], ["2.5", "≥ 2,5 sn duraklama"], ["4", "≥ 4 sn duraklama"]].map(([v, a]) => el("option", { value: v, text: a }))); esik.value = "1.5";
    const tahmin = el("button", { type: "button", class: "md-btn", text: "🪄 Tahmini ayır" });
    tahmin.addEventListener("click", () => { kaydetGeri(); const n = Number(nSec.value); while (T.konusmacilar.length < n) T.konusmacilar.push({ ad: `Konuşmacı ${T.konusmacilar.length + 1}`, renk: RENKLER[T.konusmacilar.length % RENKLER.length] }); tahminiAyir(T.segmentler, n, Number(esik.value)); hepsiniCiz(); bildir("Tahmini ayrım uygulandı: duraklamalarda sıradaki konuşmacıya geçildi. Whisper konuşmacıyı tanımaz; yanlış satırları elle düzelt."); });
    kPanel.replaceChildren(el("h2", { text: "👥 Konuşmacılar" }),
      el("p", { class: "md-soluk", text: "Her satırın solundaki listeden konuşmacıyı seç; satırları işaretleyip toplu da atayabilirsin. Hangi dakika/saat aralığında konuştukları aşağıda görünür." }),
      el("div", { class: "mt-kizgara" }, ...satirlar),
      el("div", { class: "md-eylem" }, ekle), el("div", { class: "md-eylem mt-tahmin" }, nSec, esik, tahmin),
      el("p", { class: "md-soluk", text: "⚠ Otomatik ayrım yalnızca duraklamalara bakar (tahmindir). Kayıtta kimin konuştuğunu ses tonundan tanıyan ücretsiz/açık bir yöntem tarayıcıda yoktur; kesin sonuç için satırları elle ata." }));
  }
  kPanel.addEventListener("click", (e) => { const g = e.target.closest("[data-git]"); if (g && sesUrl) { oynatici.currentTime = Number(g.dataset.git); oynatici.play().catch(() => {}); } else if (g) bildir("Oynatmak için önce “Kayıt dosyasını bağla” ile dosyayı seç.", true); });

  function ozetGuncelle() {
    const metin = T.segmentler.map((s) => s.m).join(" "), kel = kelimeSay(metin), sn = topSure();
    meta.textContent = `${saat(sn)} · ${kel.toLocaleString("tr-TR")} kelime · ${T.segmentler.length} satır${T.dil ? ` · dil: ${(DILLER.find(([v]) => v === T.dil) || [, T.dil])[1]}` : ""}${sn > 0 ? ` · ~${Math.round(kel / (sn / 60))} kelime/dk` : ""} · okuma ≈ ${Math.max(1, Math.round(kel / 220))} dk`;
    const k = anahtarKelimeler(metin); anahtarlar.textContent = k.length ? `Öne çıkan sözcükler: ${k.map((x) => `${x.kelime} (${x.adet})`).join(" · ")}` : "";
  }
  function hepsiniCiz() { if (sayfaBas >= T.segmentler.length) sayfaBas = Math.max(0, Math.floor((T.segmentler.length - 1) / SAYFA) * SAYFA); aramaYap(false); listeCiz(); konusmacilariCiz(); ozetGuncelle(); }

  /* ---------------- Arama / değiştir / dolgu ---------------- */
  function aramaYap(git = true) {
    aramaMetni = ara.value.trim().toLocaleLowerCase("tr"); bulunan = aramaMetni ? T.segmentler.map((s, i) => (s.m.toLocaleLowerCase("tr").includes(aramaMetni) ? i : -1)).filter((i) => i >= 0) : [];
    araSay.textContent = aramaMetni ? `${bulunan.length} sonuç` : ""; bulIdx = bulunan.length ? 0 : -1; if (git) { if (bulIdx >= 0) bulunanaGit(); else listeCiz(); }
  }
  function bulunanaGit() { const i = bulunan[bulIdx]; sayfaBas = Math.floor(i / SAYFA) * SAYFA; listeCiz(); araSay.textContent = `${bulIdx + 1} / ${bulunan.length}`; liste.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }
  ara.addEventListener("input", () => aramaYap());
  ara.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); (e.shiftKey ? onceki : sonraki).click(); } });
  sonraki.addEventListener("click", () => { if (!bulunan.length) return; bulIdx = (bulIdx + 1) % bulunan.length; bulunanaGit(); });
  onceki.addEventListener("click", () => { if (!bulunan.length) return; bulIdx = (bulIdx - 1 + bulunan.length) % bulunan.length; bulunanaGit(); });
  degisBtn.addEventListener("click", () => {
    const a = ara.value.trim(); if (!a) return bildir("Önce aranacak metni yaz.", true);
    const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"); kaydetGeri(); let n = 0;
    for (const s of T.segmentler) s.m = s.m.replace(re, () => { n += 1; return degis.value; });
    hepsiniCiz(); bildir(`${n} yer değiştirildi.`);
  });
  dolguBtn.addEventListener("click", () => { kaydetGeri(); let n = 0; for (const s of T.segmentler) { const y = dolguTemizle(s.m); if (y !== s.m) { n += 1; s.m = y; } } T.segmentler = T.segmentler.filter((s) => s.m.length > 0); hepsiniCiz(); bildir(`${n} satırda dolgu sesleri temizlendi.`); });

  /* ---------------- Oynatıcı ---------------- */
  let aktifI = -1;
  oynatici.addEventListener("timeupdate", () => {
    const t = oynatici.currentTime; const i = T.segmentler.findIndex((s) => t >= s.b && t < s.s); if (i === aktifI) return; aktifI = i;
    liste.querySelectorAll(".mt-aktif").forEach((x) => x.classList.remove("mt-aktif"));
    if (i < 0) return; if (takip.checked && (i < sayfaBas || i >= sayfaBas + SAYFA)) { sayfaBas = Math.floor(i / SAYFA) * SAYFA; listeCiz(); }
    const sat = liste.querySelector(`[data-i="${i}"]`); sat?.classList.add("mt-aktif"); if (takip.checked) sat?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  hiz.addEventListener("change", () => { oynatici.playbackRate = Number(hiz.value); });
  function sesBagla(f) { if (sesUrl) URL.revokeObjectURL(sesUrl); sesUrl = URL.createObjectURL(f); oynatici.src = sesUrl; oynatici.playbackRate = Number(hiz.value); }
  const bagGirdi = el("input", { type: "file", accept: "audio/*,video/*", hidden: true });
  sesBaglaBtn.addEventListener("click", () => bagGirdi.click());
  bagGirdi.addEventListener("change", () => { if (bagGirdi.files?.[0]) { sesBagla(bagGirdi.files[0]); sesBaglaBtn.textContent = "🔗 Kayıt bağlandı"; } bagGirdi.value = ""; });

  /* ---------------- Başlık ---------------- */
  baslikGirdi.addEventListener("input", () => { T.baslik = baslikGirdi.value; baslikElleMi = true; });
  baslikOneri.addEventListener("click", () => { T.baslik = baslikOner(T.segmentler); baslikGirdi.value = T.baslik; baslikElleMi = false; });

  /* ---------------- Dışa aktarma ---------------- */
  const adTaban = () => dosyaAdiTemizle(T.baslik || "transkript", "transkript");
  const secenek = () => ({ zaman: zamanSec.checked, konusmaci: kSec.checked, baslangicSn: baslangicSn() });
  const TURLER = { txt: ["text/plain;charset=utf-8", "txt"], md: ["text/markdown;charset=utf-8", "md"], srt: ["application/x-subrip;charset=utf-8", "srt"], vtt: ["text/vtt;charset=utf-8", "vtt"], csv: ["text/csv;charset=utf-8", "csv"], json: ["application/json;charset=utf-8", "json"] };
  function irBloklari() {
    const o = secenek(), z = (sn) => (o.baslangicSn != null ? gunSaati(o.baslangicSn + sn) : saat(sn)), bl = [{ t: "h", lv: 1, runs: [{ text: T.baslik || "Transkript" }] }, { t: "p", runs: [{ text: meta.textContent, i: true }] }];
    let son = null; for (const s of T.segmentler) { const a = T.konusmacilar[s.k]?.ad || null; if (o.konusmaci && son && son.a === a && a) { son.runs.push({ text: ` ${s.m}` }); continue; } const runs = []; if (o.zaman) runs.push({ text: `[${z(s.b)}] `, code: true }); if (o.konusmaci && a) runs.push({ text: `${a}: `, b: true }); runs.push({ text: s.m }); son = { t: "p", a, runs }; bl.push(son); }
    return bl;
  }
  async function disaAktar(tur) {
    if (!T.segmentler.length) return;
    try {
      if (TURLER[tur]) { indir(new Blob([metinUret({ ...T, baslik: T.baslik || "Transkript" }, tur, secenek())], { type: TURLER[tur][0] }), `${adTaban()}.${TURLER[tur][1]}`); return bildir(`✔ ${tur.toUpperCase()} indirildi.`); }
      bildir(`${tur.toUpperCase()} hazırlanıyor…`);
      if (tur === "docx") { const { irDenDocx } = await import("../donusturucu/belge-docx.js"); indir(await irDenDocx(irBloklari(), { baslik: T.baslik || "Transkript" }), `${adTaban()}.docx`); }
      else { const { irDenPdf } = await import("../donusturucu/belge-pdf.js"); indir(await irDenPdf(irBloklari(), { baslik: T.baslik || "Transkript" }), `${adTaban()}.pdf`); }
      bildir(`✔ ${tur.toUpperCase()} indirildi.`);
    } catch (h) { bildir(`Dışa aktarılamadı: ${h.message || h}`, true); }
  }
  const dugme = (m, f, t = "") => { const b = el("button", { type: "button", class: "md-btn", text: m, title: t }); b.addEventListener("click", f); return b; };
  const disaKart = el("section", { class: "md-kart" }, el("h2", { text: "⬇ Dışa aktar" }),
    el("div", { class: "mt-secenekler" }, el("label", { class: "mk-onay" }, zamanSec, " Zaman damgası"), el("label", { class: "mk-onay" }, kSec, " Konuşmacı adı"), el("label", { class: "mk-onay" }, gunSaatiSec, " Gün saati kullan (kayıt başlangıç saatini gir)")),
    el("div", { class: "md-eylem" }, ...[["txt", "TXT"], ["md", "Markdown"], ["docx", "Word"], ["pdf", "PDF"], ["srt", "SRT altyazı"], ["vtt", "VTT altyazı"], ["csv", "CSV"], ["json", "JSON"]].map(([t, a]) => dugme(`⬇ ${a}`, () => disaAktar(t)))),
    el("div", { class: "md-eylem" },
      dugme("📋 Panoya kopyala", async () => { try { await navigator.clipboard.writeText(metinUret({ ...T, baslik: T.baslik || "Transkript" }, "txt", secenek())); bildir("✔ Panoya kopyalandı."); } catch { bildir("Pano erişimi reddedildi.", true); } }),
      dugme("📝 Yeni İçerik taslağına aktar", () => { sessionStorage.setItem("gy_onbilgi", JSON.stringify({ baslik: T.baslik || "Transkript", govde: metinUret({ ...T, baslik: "" }, "md", { zaman: false, konusmaci: true }).replace(/^#\s*\n+/, "") })); location.hash = "#content-new"; }),
      dugme("💾 Bu cihazda sakla", kaydetYerel, "Yalnızca bu tarayıcının IndexedDB'sine; sunucuya gitmez")));

  /* ---------------- Yerel geçmiş ---------------- */
  const gecmisKart = el("section", { class: "md-kart" }), gecmisListe = el("div", { class: "mt-gecmis" });
  gecmisKart.append(el("h2", { text: "🗂 Bu cihazdaki kayıtlı transkriptler" }), el("p", { class: "md-soluk", text: "Yalnızca bu tarayıcıda saklanır (sunucuya gitmez); tarayıcı verisini silersen kaybolur. Ses dosyası saklanmaz — oynatmak için yeniden bağla." }), gecmisListe);
  async function gecmisCiz() {
    let l = []; try { l = (await gecmis.liste()) || []; } catch { gecmisListe.replaceChildren(el("p", { class: "md-soluk", text: "Yerel depolama bu tarayıcıda kullanılamıyor." })); return; }
    l.sort((a, b) => b.tarih - a.tarih);
    gecmisListe.replaceChildren(...(l.length ? l.map((k) => el("div", { class: "mt-gkayit" }, el("div", {}, el("strong", { text: k.baslik || "Başlıksız transkript" }), el("small", { class: "md-soluk", text: `${new Date(k.tarih).toLocaleString("tr-TR")} · ${saat(k.sure)} · ${k.T.segmentler.length} satır` })),
      el("div", { class: "md-eylem" }, dugme("Aç", () => ac(k)), dugme("Sil", async () => { await gecmis.sil(k.id); gecmisCiz(); })))) : [el("p", { class: "md-soluk", text: "Henüz kayıt yok." })]));
  }
  async function kaydetYerel() { try { kayitId ||= `t${Date.now()}`; await gecmis.kaydet({ id: kayitId, baslik: T.baslik, tarih: Date.now(), sure: topSure(), T }); bildir("✔ Bu cihaza kaydedildi."); gecmisCiz(); } catch { bildir("Yerel depolamaya yazılamadı (özel pencere ya da kota).", true); } }
  function ac(k) { T = k.T; kayitId = k.id; nid = Math.max(0, ...T.segmentler.map((s) => s.id || 0)) + 1; T.segmentler.forEach((s) => { s.id ||= nid++; }); studyoGoster(); bildir("Kayıt açıldı."); }

  function studyoGoster() { stud.hidden = false; baslikGirdi.value = T.baslik; secili.clear(); geriAl = []; geriBtn.disabled = true; sayfaBas = 0; hepsiniCiz(); stud.scrollIntoView?.({ block: "nearest" }); }

  /* ---------------- Çalıştır ---------------- */
  async function yukle(f) {
    try {
      if (f.size > SINIR) throw new Error(`Dosya çok büyük (${bayt(f.size)}); üst sınır ${bayt(SINIR)}.`);
      ilr.baslat("Ses çözülüyor", Math.max(2, f.size / (12 * 1024 * 1024))); dosya = f; devam = null; buf = await sesCoz(f); ilr.bitir(); sesBagla(f);
      bilgi.textContent = `${f.name} · ${bayt(f.size)} · ${Math.round((buf.duration / 60) * 10) / 10} dk`; basla.disabled = false; bildir("Hazır. Ayarları seçip “Transkripti başlat”a bas.");
    } catch (h) { ilr.bitir(); bildir(h.message, true); dosya = null; buf = null; basla.disabled = true; }
  }
  girdi.addEventListener("change", () => { if (girdi.files?.[0]) yukle(girdi.files[0]); girdi.value = ""; });
  durdur.addEventListener("click", () => iptal?.abort());

  async function parcaGonder(blob, i, sure, sunucu, oturum) {
    const fd = new FormData(); fd.append("dosya", new File([blob], `parca-${i + 1}.mp3`, { type: "audio/mpeg" })); fd.append("mod", mod.value); if (dil.value) fd.append("dil", dil.value); fd.append("ofset", String(i * PARCA_SN)); fd.append("sure", String(Math.ceil(sure)));
    for (let deneme = 0; ; deneme++) {
      let r, j;
      try { r = await fetch(`${WORKER}/transkript`, { method: "POST", headers: { Authorization: `Bearer ${oturum.access_token}`, ...sunucu.basliklar }, body: fd, signal: iptal.signal }); j = await r.json().catch(() => ({})); }
      catch (h) { if (h.name === "AbortError") throw h; if (deneme < 1) { await new Promise((q) => setTimeout(q, 1500)); continue; } throw new Error("Transkript hizmetine ulaşılamadı (ağ ya da Worker kapalı olabilir)."); }
      if (r.ok) return j;
      if (r.status >= 500 && deneme < 1) { await new Promise((q) => setTimeout(q, 2000)); continue; }
      throw new Error(j.kapali ? "Transkript servisi Site Sahibi tarafından geçici olarak kapatılmış." : (j.hata || j.error || `Transkript hatası (${r.status})`));
    }
  }
  basla.addEventListener("click", async () => {
    if (!buf) return; let sunucu; try { sunucu = kaynak.hazirla(); } catch (h) { return bildir(h.message, true); }
    basla.disabled = true; durdur.hidden = false; iptal = new AbortController();
    try {
      const lame = await lameYukle(), { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error("Oturum gerekli.");
      ilr.baslat("Ses hazırlanıyor", Math.max(2, buf.duration / 40));
      const f32 = await monoOrnekle(buf), parcaN = PARCA_SN * ORNEK, adet = Math.max(1, Math.ceil(f32.length / parcaN));
      if (!devam || devam.dosya !== dosya || devam.adet !== adet || devam.mod !== mod.value) devam = { dosya, adet, mod: mod.value, i: 0, segs: [], dil: null };
      for (let i = devam.i; i < adet; i++) {
        ilr.guncelle(i / adet, `Parça ${i + 1}/${adet} sıkıştırılıyor`); await sleep();
        const dilim = f32.subarray(i * parcaN, Math.min(f32.length, (i + 1) * parcaN)), blob = mp3Kodla(lame, dilim, 64);
        ilr.guncelle((i + 0.5) / adet, `Parça ${i + 1}/${adet} yazıya dökülüyor`);
        const j = await parcaGonder(blob, i, dilim.length / ORNEK, sunucu, session);
        devam.segs.push(...(j.segmentler || []).map((s) => yeniSeg({ b: s.b, s: s.s, m: s.m, k: null }))); devam.dil ||= j.dil; devam.i = i + 1;
        if (j.kota) kota.yenile(j.kota); ilr.guncelle((i + 1) / adet);
        T = { baslik: baslikElleMi ? T.baslik : "", dil: devam.dil, sure: buf.duration, konusmacilar: T.konusmacilar.length ? T.konusmacilar : [{ ad: "Konuşmacı 1", renk: RENKLER[0] }, { ad: "Konuşmacı 2", renk: RENKLER[1] }], segmentler: devam.segs };
        if (!baslikElleMi) T.baslik = baslikOner(T.segmentler);
        studyoGoster();
      }
      ilr.bitir(); bildir(`✔ Transkript hazır: ${T.segmentler.length} satır. Konuşmacıları atayabilir, metni düzenleyebilir ve dışa aktarabilirsin.`); devam = null; kayitId = null;
    } catch (h) {
      ilr.bitir();
      if (h.name === "AbortError") bildir(devam?.i ? `Durduruldu. ${devam.i}. parçaya kadar olan kısım korundu; “Transkripti başlat” ile kaldığı yerden devam edebilirsin.` : "Durduruldu.");
      else bildir(`${h.message || h}${devam?.i ? " — Tamamlanan parçalar korundu; tekrar başlatınca kaldığı yerden devam eder." : ""}`, true);
      kota.yenile();
    } finally { basla.disabled = !buf; durdur.hidden = true; iptal = null; }
  });

  const temizle = dugme("🧹 Belleği temizle", () => { dosya = null; buf = null; devam = null; T = { baslik: "", dil: null, sure: 0, konusmacilar: [], segmentler: [] }; secili.clear(); geriAl = []; baslikElleMi = false; if (sesUrl) { URL.revokeObjectURL(sesUrl); sesUrl = null; } oynatici.removeAttribute("src"); stud.hidden = true; ilr.bitir(); basla.disabled = true; bilgi.textContent = "Dosya tarayıcında işlenir."; bildir("🧹 Bellek temizlendi (yerel kayıtlar silinmez)."); });
  sekmeSifirlamaKaydet("tool-medya-transkript", () => temizle.click());

  /* ---------------- Yerleşim ---------------- */
  stud.append(
    el("section", { class: "md-kart" }, el("h2", { text: "📄 Transkript" }), el("div", { class: "mt-baslikalani" }, baslikGirdi, baslikOneri), meta, anahtarlar,
      el("div", { class: "mt-oynat" }, oynatici, hiz), el("div", { class: "md-eylem" }, sesBaglaBtn, el("label", { class: "mk-onay" }, takip, " Oynatmayı takip et"), bagGirdi),
      el("div", { class: "mt-arac" }, ara, onceki, sonraki, araSay), el("div", { class: "mt-arac" }, degis, degisBtn, dolguBtn, geriBtn)),
    kPanel,
    el("section", { class: "md-kart" }, el("div", { class: "mt-toplu md-eylem" }, topluSec, topluBtn, sondanBtn, secTumBtn), liste, sayfaYeri),
    disaKart);
  kok.classList.add("md-kok");
  kok.replaceChildren(
    el("div", { class: "md-kart" }, el("h2", { text: "📝 Transkript Stüdyosu" }), el("p", { class: "md-soluk", text: "🔒 Ses tarayıcıda küçültülür; yalnızca küçültülmüş ses Worker üzerinden Groq Whisper'a gider (Groq üçüncü taraftır; Worker hiçbir şey kaydetmez). Kendi Groq anahtarını kullanırsan ses doğrudan senin hesabınla işlenir." }), sec, girdi, bilgi,
      el("div", { class: "mi-satir" }, etiket("Mod", mod), etiket("Konuşulan dil", dil), etiket("Kaydın başlangıç saati (isteğe bağlı)", baslangic, "Girersen konuşmacı aralıkları gün saatiyle de gösterilir")),
      el("div", { class: "md-eylem" }, basla, durdur), cubuk, sureYazi, mesaj),
    kota.kok, kaynak.kok, stud, gecmisKart, temizle);
  gecmisCiz();
}
kur().catch((h) => { console.error("medya-transkript.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` })); });
