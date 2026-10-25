/**
 * ui-ai.js — HavaStil v8 · "Yapay Zekâ Analizi" (kendi API anahtarınla) + "Günün Veri Paketi" dışa aktarma + geçici sohbet.
 * KOTA GÜVENCESİ: hiçbir yapay zekâ isteği kendiliğinden yapılmaz (sayfa açılışı, konum/gün/sekme değişimi, yenileme, tercih değişimi → istek YOK).
 *   Yalnızca "Analiz et" / "Gönder" düğmesi istek yapar. Aynı veri + aynı model için sonuç bellekte tutulur (ikinci tıklama yeni istek yapmaz;
 *   "Yeniden analiz et" bilerek zorlar). Çift tıklama ve eşzamanlı istek engellenir. Gönderilecek veri boyutu istekten ÖNCE gösterilir.
 * GEÇİCİ SOHBET: sorular ve cevaplar yalnızca bu sayfanın belleğindedir (kaydedilmez, hesaba/sunucuya yazılmaz). Her soru bağımsız gönderilir:
 *   veri paketi + (varsa) analiz + o soru; önceki sorular gönderilmez (az token, az yanlılık taşınımı).
 * Vitrin/demo/misafir: tamamen kilitli (anahtar kasası ve sağlayıcı isteği yok).
 */
import { el, rozet, ipucu, kart, bolumBasligi, olay, doldur, ekle, lsOku, lsYaz } from "./ui-temel.js";
import { SAGLAYICILAR, SAGLAYICI_SIRASI, yorumIste, modelleriListele } from "./ai-saglayici.js";
import * as Kasa from "./ai-kasa.js";
import { ANALIZ_SISTEM, SOHBET_SISTEM, analizKullanici, sohbetKullanici, ozet } from "./ai-istem.js";
import { gunVeriPaketi, paketMetni, paketJson, dosyaAdi, indir, panoyaKopyala } from "./veri-paketi.js";

/* ------------------------------ güvenli mini Markdown → DOM ------------------------------ */
function satirIci(metin) {
  const parcalar = String(metin).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parcalar.map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? el("strong", { text: p.slice(2, -2) }) : /^`[^`]+`$/.test(p) ? el("code", { text: p.slice(1, -1) }) : document.createTextNode(p)));
}
export function mdCiz(metin) {
  const kok = el("div", { class: "hv-md" });
  const satirlar = String(metin || "").replace(/\r/g, "").split("\n");
  let liste = null, tablo = null, par = [];
  const parBitir = () => { if (par.length) { kok.append(el("p", {}, ...satirIci(par.join(" ")))); par = []; } };
  const bitir = () => { parBitir(); liste = null; tablo = null; };
  for (const ham of satirlar) {
    const s = ham.trimEnd();
    if (!s.trim()) { bitir(); continue; }
    let m;
    if ((m = s.match(/^(#{1,4})\s+(.*)$/))) { bitir(); kok.append(el("h4", { class: "hv-md-baslik", text: m[2] })); continue; }
    if (/^\s*\|.*\|\s*$/.test(s)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(s)) continue;
      parBitir(); liste = null;
      const hucreler = s.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (!tablo) { tablo = el("table", { class: "hv-md-tablo" }); kok.append(el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "Tablo" }, tablo)); tablo.append(el("thead", {}, el("tr", {}, ...hucreler.map((h) => el("th", { scope: "col" }, ...satirIci(h)))))); tablo.append(el("tbody")); }
      else tablo.querySelector("tbody").append(el("tr", {}, ...hucreler.map((h) => el("td", {}, ...satirIci(h)))));
      continue;
    }
    tablo = null;
    if ((m = s.match(/^\s*(?:[-*•])\s+(.*)$/)) || (m = s.match(/^\s*\d+[.)]\s+(.*)$/))) {
      parBitir();
      const sirali = /^\s*\d+[.)]/.test(s);
      if (!liste || liste.tagName !== (sirali ? "OL" : "UL")) { liste = el(sirali ? "ol" : "ul", { class: "hv-liste" }); kok.append(liste); }
      liste.append(el("li", {}, ...satirIci(m[1]))); continue;
    }
    liste = null; par.push(s.trim());
  }
  bitir();
  return kok;
}

/* ------------------------------ ortak durum yardımcıları ------------------------------ */
const KILITLI_MESAJ = "Vitrin/demo ve misafir görünümünde yapay zekâ ve anahtar kasası kapalıdır. Giriş yapıp HavaStil yetkin varsa kendi anahtarınla kullanabilirsin.";
const tokenTahmin = (metin) => Math.round(metin.length / 3.2);
const kb_ = (n) => `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
function kokBul() { return document.querySelector(".hv") || document.body; }

/* ------------------------------ sağlayıcı / kasa penceresi ------------------------------ */
export function aiAyarDialogu(d, { onKapat } = {}) {
  const dlg = el("dialog", { class: "hv-dlg", "aria-labelledby": "hv-dlg-baslik" });
  const govde = el("div", { class: "hv-dlg-govde" });
  const mesaj = el("p", { class: "hv-uyari", role: "status", hidden: true });
  const hata = (m, ok = false) => { mesaj.hidden = !m; mesaj.textContent = m || ""; mesaj.classList.toggle("hv-uyari-ok", ok); };
  let kayitli = {}, yukleniyor = true;
  const modelListesi = {};

  const kapat = el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Kapat" });
  olay(kapat, "click", () => dlg.close());
  olay(dlg, "close", () => { dlg.remove(); onKapat?.(); });
  olay(dlg, "click", (e) => { if (e.target === dlg) dlg.close(); });

  async function yenile() {
    try { kayitli = await Kasa.kayitliSaglayicilar(); } catch (h) { hata(h.message); kayitli = {}; }
    yukleniyor = false; ciz();
  }
  function kasaBolumu() {
    const kayitSayisi = Object.keys(kayitli).length;
    if (Kasa.kasaAcikMi()) return el("div", { class: "hv-kasa-durum acik" }, el("strong", { text: "🔓 Kasa açık" }), el("small", { class: "hv-ipucu", text: "Çözülmüş anahtarlar yalnızca bu sekmenin belleğinde. Sekme kapanınca ya da 20 dk kullanılmazsa kilitlenir." }),
      olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Kasayı kilitle" }), "click", () => { Kasa.kilitle(); ciz(); }));
    const parola = el("input", { type: "password", class: "hv-girdi", autocomplete: kayitSayisi ? "current-password" : "new-password", "aria-label": "Kasa parolası", placeholder: kayitSayisi ? "Kasa parolan" : "Yeni kasa parolası (en az 8 karakter)" });
    const parola2 = kayitSayisi ? null : el("input", { type: "password", class: "hv-girdi", autocomplete: "new-password", "aria-label": "Kasa parolası (tekrar)", placeholder: "Parolayı tekrar yaz" });
    const git = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: kayitSayisi ? "🔓 Kasayı aç" : "🔐 Kasayı oluştur" }), "click", async () => {
      git.disabled = true; hata("");
      try {
        if (kayitSayisi) await Kasa.kasaAc(parola.value);
        else { if (parola.value !== parola2.value) throw new Error("Parolalar aynı değil."); await Kasa.kasaKur(parola.value); }
        parola.value = ""; if (parola2) parola2.value = ""; ciz();
      } catch (h) { hata(h.message); } finally { git.disabled = false; }
    });
    return el("div", { class: "hv-kasa-durum" },
      el("strong", { text: kayitSayisi ? "🔒 Kasa kilitli" : "Önce bir kasa parolası belirle" }),
      el("small", { class: "hv-ipucu", text: kayitSayisi ? "Kayıtlı anahtarlarını kullanmak için kasa parolanı gir." : "Bu parola yalnızca bu tarayıcıda anahtarlarını şifrelemek için kullanılır; sunucuya GİTMEZ ve kurtarılamaz (unutursan kasayı sıfırlayıp anahtarları yeniden girersin)." }),
      parola, parola2, git,
      kayitSayisi ? olay(el("button", { type: "button", class: "hv-baglanti", text: "Parolayı unuttum → kasayı sıfırla" }), "click", async () => {
        if (!window.confirm("Kayıtlı TÜM yapay zekâ anahtarların silinecek. Devam edilsin mi?")) return;
        try { await Kasa.kasayiSifirla(); hata("Kasa sıfırlandı.", true); await yenile(); } catch (h) { hata(h.message); }
      }) : null);
  }
  function saglayiciKarti(id) {
    const S = SAGLAYICILAR[id], kayit = kayitli[id], acik = Kasa.kasaAcikMi();
    const anahtar = el("input", { type: "password", class: "hv-girdi", autocomplete: "off", spellcheck: "false", "aria-label": `${S.kisa} API anahtarı`, placeholder: kayit ? "Yeni anahtar yapıştır (değiştirmek için)" : S.anahtarIpucu, disabled: !acik });
    const model = el("input", { type: "text", class: "hv-girdi", list: `hv-modeller-${id}`, autocomplete: "off", spellcheck: "false", "aria-label": `${S.kisa} model adı`, value: kayit?.model || (Kasa.secimOku()?.saglayici === id ? Kasa.secimOku().model : "") || S.varsayilan, disabled: !acik });
    const dl = el("datalist", { id: `hv-modeller-${id}` }, ...(modelListesi[id] || S.oneri).map((m) => el("option", { value: m })));
    const durum = el("small", { class: "hv-ipucu" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: kayit ? "Güncelle" : "Kaydet", disabled: !acik }), "click", async () => {
      kaydet.disabled = true; durum.textContent = "";
      try {
        if (anahtar.value.trim()) await Kasa.anahtarKaydet(id, anahtar.value, model.value.trim() || S.varsayilan);
        else if (kayit) await Kasa.modelKaydet(id, model.value.trim() || S.varsayilan);
        else throw new Error("Önce API anahtarını yapıştır.");
        anahtar.value = ""; Kasa.secimYaz(id, model.value.trim() || S.varsayilan);
        hata(`${S.kisa} kaydedildi (şifreli).`, true); await yenile();
      } catch (h) { durum.textContent = h.message; kaydet.disabled = false; }
    });
    const dogrula = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "🔎 Doğrula / modelleri getir", disabled: !acik || !kayit && !anahtar.value }), "click", async () => {
      const a = anahtar.value.trim() || Kasa.anahtarAl(id);
      if (!a) { durum.textContent = "Önce anahtarı yapıştır ya da kaydet."; return; }
      dogrula.disabled = true; durum.textContent = "Kontrol ediliyor…";
      const r = await modelleriListele({ saglayici: id, anahtar: a });
      modelListesi[id] = r.liste; dl.replaceChildren(...r.liste.map((m) => el("option", { value: m })));
      durum.textContent = r.canli ? `✅ Anahtar çalışıyor · ${r.liste.length} model listelendi (alana tıklayıp seç).` : `⚠️ Liste alınamadı (${r.hata || "boş"}); önerilen adlar kullanılıyor. Model adını elle yazabilirsin.`;
      dogrula.disabled = false;
    });
    anahtar.addEventListener("input", () => { dogrula.disabled = !acik || (!kayit && !anahtar.value); });
    const sil = kayit ? olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-tehlike", text: "Sil", disabled: !acik }), "click", async () => {
      if (!window.confirm(`${S.kisa} anahtarı silinsin mi?`)) return;
      try { await Kasa.anahtarSil(id); await yenile(); } catch (h) { durum.textContent = h.message; }
    }) : null;
    return el("div", { class: `hv-ai-saglayici${kayit ? " kayitli" : ""}` },
      el("div", { class: "hv-bolum-ust" }, el("strong", { text: S.ad }), kayit ? rozet("Kayıtlı (şifreli)", "hv-rozet-ok") : rozet("Anahtar yok")),
      el("a", { class: "hv-baglanti", href: S.yardim, target: "_blank", rel: "noopener noreferrer", text: "Anahtarı nereden alırım? ↗" }),
      anahtar, model, dl, el("div", { class: "hv-btn-satir" }, kaydet, dogrula, sil), durum);
  }
  function ciz() {
    doldur(govde,
      el("p", { class: "hv-ipucu", text: "Kendi API anahtarınla yorum alırsın. Anahtarın bu tarayıcıda kasa parolanla ŞİFRELENİR; hesabına yalnızca şifreli hâli kaydedilir (Site Sahibi dâhil kimse okuyamaz, yedeklere girmez). İstekler tarayıcından doğrudan sağlayıcıya gider; HavaStil sunucusundan geçmez. Kota ve ücret senin sağlayıcı hesabından düşer — bu yüzden hiçbir istek kendiliğinden yapılmaz." }),
      yukleniyor ? ipucu("Yükleniyor…") : kasaBolumu(), mesaj,
      ...SAGLAYICI_SIRASI.map(saglayiciKarti));
  }
  dlg.append(el("div", { class: "hv-dlg-ust" }, el("h2", { id: "hv-dlg-baslik", text: "🤖 Yapay zekâ sağlayıcıları" }), kapat), govde);
  kokBul().append(dlg);
  const abone = Kasa.kasaDegisti(() => { if (dlg.isConnected) ciz(); else abone(); });
  ciz(); yenile();
  dlg.showModal();
  return dlg;
}

/* ------------------------------ Ayarlar kartı ------------------------------ */
export function aiAyarKarti(d, kb) {
  const durum = el("p", { class: "hv-ipucu" });
  const yaz = async () => {
    if (d.vitrin || d.misafir) { durum.textContent = KILITLI_MESAJ; return; }
    try {
      const k = await Kasa.kayitliSaglayicilar(); const ad = Object.keys(k).map((x) => SAGLAYICILAR[x].kisa);
      durum.textContent = ad.length ? `Kayıtlı sağlayıcılar: ${ad.join(", ")} · kasa ${Kasa.kasaAcikMi() ? "açık" : "kilitli"}.` : "Henüz sağlayıcı eklenmedi.";
    } catch (h) { durum.textContent = h.message; }
  };
  const yonet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: "🤖 Sağlayıcıları yönet", disabled: d.vitrin || d.misafir }), "click", () => aiAyarDialogu(d, { onKapat: () => { yaz(); kb.ciz(); } }));
  yaz();
  return kart("", bolumBasligi("🤖 Yapay zekâ analizi (kendi anahtarınla)"),
    ipucu("Gemini, ChatGPT (OpenAI), Claude ve OpenRouter anahtarlarından istediğini ekle; Derin analiz sekmesinde günün tüm saatlik verisiyle yansız bir analiz iste ve geçici sohbette sor. Hiçbir istek kendiliğinden yapılmaz."),
    durum, yonet);
}

/* ------------------------------ Derin analiz paneli ------------------------------ */
export function aiPaneli(d, kb) {
  const gi = d.derinGun || 0;
  const st = (d.aiOturum = d.aiOturum || { onbellek: new Map(), analiz: null, sohbet: [], paketAnahtar: null, ekGun: 0 });
  const kok = el("section", { class: "hv-kart hv-uzman-kart hv-ai-panel" }, bolumBasligi("🤖 Veri paketi ve yapay zekâ analizi"));
  if (d.vitrin || d.misafir) { kok.append(el("p", { class: "hv-uyari", text: KILITLI_MESAJ })); return kok; }

  const ekSecim = el("select", { class: "hv-girdi hv-girdi-kucuk", "aria-label": "Pakete dâhil edilecek gün sayısı" },
    el("option", { value: "0", text: "Yalnızca seçili gün (saatlik)" }), el("option", { value: "1", text: "Seçili gün + sonraki gün (saatlik)" }), el("option", { value: "2", text: "Seçili gün + sonraki 2 gün (saatlik)" }));
  ekSecim.value = String(st.ekGun);
  const paketUret = () => { const p = gunVeriPaketi(d, gi, { ekGun: Number(ekSecim.value) }); return { p, metin: paketMetni(p) }; };
  const boyutYazi = el("small", { class: "hv-ipucu" });
  const boyutGuncelle = () => { const { metin } = paketUret(); boyutYazi.textContent = `Pakete giren veri: ${kb_(new Blob([metin]).size)} (≈ ${tokenTahmin(metin).toLocaleString("tr-TR")} token). 16 günlük özet her zaman dâhildir.`; };
  olay(ekSecim, "change", () => { st.ekGun = Number(ekSecim.value); boyutGuncelle(); });
  boyutGuncelle();

  /* --- 1) dışa aktarma --- */
  const bilgi = el("small", { class: "hv-ipucu", role: "status" });
  const kopya = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "📋 Kopyala (yapay zekâya yapıştır)" }), "click", async () => { bilgi.textContent = (await panoyaKopyala(paketUret().metin)) ? "Kopyalandı: istediğin yapay zekâ sohbetine yapıştır." : "Kopyalanamadı; .md indir."; });
  const mdBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-birincil", text: "⬇️ Markdown (.md) — önerilen" }), "click", () => { const { p, metin } = paketUret(); indir(dosyaAdi(p, "md"), metin, "text/markdown"); bilgi.textContent = "İndirildi."; });
  const jsonBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "⬇️ JSON" }), "click", () => { const { p } = paketUret(); indir(dosyaAdi(p, "json"), paketJson(p), "application/json"); bilgi.textContent = "İndirildi."; });
  const txtBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "⬇️ Düz metin (.txt)" }), "click", () => { const { p, metin } = paketUret(); indir(dosyaAdi(p, "txt"), metin, "text/plain"); bilgi.textContent = "İndirildi."; });
  kok.append(
    ipucu("Seçili günün TÜM sayısal verisi (saatlik: sıcaklık, hissedilen, nem, rüzgâr/hamle, yağış ihtimali, model uyumu, yayılım, mm, beklenen mm, CAPE, basınç, bulut, UV, kar/buzlanma, CLO) + 16 günlük özet + karar kuralları tek dosyada. Ekran görüntüsüne gerek kalmaz. Biçim önerisi: Markdown — yapay zekâ modelleri tablo ve başlıkları en doğru bu biçimde okur; makine işlemesi için JSON."),
    el("label", { class: "hv-etiket", text: "Pakete dâhil edilecek veri" }), ekSecim, boyutYazi,
    el("div", { class: "hv-btn-satir" }, mdBtn, kopya, jsonBtn, txtBtn), bilgi);

  /* --- 2) analiz --- */
  const secimAlani = el("div", { class: "hv-ai-secim" });
  const analizKutu = el("div", { class: "hv-ai-sonuc", "aria-live": "polite" });
  const analizDurum = el("small", { class: "hv-ipucu" });
  let istekte = false, iptal = null;
  const aktif = () => { const s = Kasa.secimOku(); return s && SAGLAYICILAR[s.saglayici] ? s : null; };

  async function saglayiciHazir() {
    let kayit; try { kayit = await Kasa.kayitliSaglayicilar(); } catch (h) { return { hata: h.message }; }
    const adlar = Object.keys(kayit);
    if (!adlar.length) return { ac: true, neden: "Önce bir yapay zekâ sağlayıcısı ekle." };
    let s = aktif(); if (!s || !kayit[s.saglayici]) { s = { saglayici: adlar[0], model: kayit[adlar[0]].model || SAGLAYICILAR[adlar[0]].varsayilan }; Kasa.secimYaz(s.saglayici, s.model); }
    if (!Kasa.kasaAcikMi()) return { ac: true, neden: "Kasa kilitli: parolanı gir." };
    const anahtar = Kasa.anahtarAl(s.saglayici);
    if (!anahtar) return { ac: true, neden: `${SAGLAYICILAR[s.saglayici].kisa} için anahtar kasada yok.` };
    return { s, anahtar, kayit };
  }
  function secimCiz() {
    Kasa.kayitliSaglayicilar().then((kayit) => {
      const adlar = Object.keys(kayit); const s = aktif();
      if (!adlar.length) { doldur(secimAlani, el("p", { class: "hv-ipucu", text: "Henüz sağlayıcı yok." }), olay(el("button", { type: "button", class: "hv-btn hv-btn-ince hv-btn-birincil", text: "＋ Sağlayıcı ekle" }), "click", () => aiAyarDialogu(d, { onKapat: () => { secimCiz(); } }))); return; }
      const sec = el("select", { class: "hv-girdi hv-girdi-kucuk", "aria-label": "Sağlayıcı" }, ...adlar.map((a) => el("option", { value: a, text: SAGLAYICILAR[a].ad })));
      sec.value = s && kayit[s.saglayici] ? s.saglayici : adlar[0];
      const model = el("input", { type: "text", class: "hv-girdi hv-girdi-kucuk", list: "hv-ai-model-liste", autocomplete: "off", spellcheck: "false", "aria-label": "Model", value: (s?.saglayici === sec.value ? s.model : kayit[sec.value]?.model) || SAGLAYICILAR[sec.value].varsayilan });
      const dl = el("datalist", { id: "hv-ai-model-liste" }, ...SAGLAYICILAR[sec.value].oneri.map((m) => el("option", { value: m })));
      olay(sec, "change", () => { model.value = kayit[sec.value]?.model || SAGLAYICILAR[sec.value].varsayilan; dl.replaceChildren(...SAGLAYICILAR[sec.value].oneri.map((m) => el("option", { value: m }))); Kasa.secimYaz(sec.value, model.value); });
      olay(model, "change", () => { Kasa.secimYaz(sec.value, model.value.trim() || SAGLAYICILAR[sec.value].varsayilan); });
      doldur(secimAlani, el("div", { class: "hv-ai-secim-satir" }, sec, model, dl, olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "⚙️ Yönet" }), "click", () => aiAyarDialogu(d, { onKapat: () => { secimCiz(); } }))),
        Kasa.kasaAcikMi() ? el("small", { class: "hv-ipucu", text: "🔓 Kasa açık" }) : olay(el("button", { type: "button", class: "hv-baglanti", text: "🔒 Kasa kilitli — aç" }), "click", () => aiAyarDialogu(d, { onKapat: () => { secimCiz(); } })));
    }).catch((h) => doldur(secimAlani, el("p", { class: "hv-uyari", text: h.message })));
  }

  const analizBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "✨ Analiz et" }), "click", () => calistir(false));
  const yenidenBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Yeniden analiz et", hidden: true }), "click", () => calistir(true));
  const iptalBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "İptal", hidden: true }), "click", () => iptal?.abort());

  function sonucGoster() {
    if (!st.analiz) { doldur(analizKutu); return; }
    doldur(analizKutu, mdCiz(st.analiz.metin), el("small", { class: "hv-ipucu", text: `${SAGLAYICILAR[st.analiz.saglayici].kisa} · ${st.analiz.model} · ${st.analiz.zaman}${st.analiz.onbellek ? " · önbellekten (yeni istek yapılmadı)" : ""}${st.analiz.kullanim ? ` · ${kullanimMetni(st.analiz.kullanim)}` : ""}` }),
      el("p", { class: "hv-ipucu", text: "Yapay zekâ yorumu bilgilendirme amaçlıdır; kesin değildir. Güvenlik kararları için resmî uyarıları (MGM) kontrol et." }));
    yenidenBtn.hidden = false;
  }
  const kullanimMetni = (k) => { const g = k.prompt_tokens ?? k.input_tokens ?? k.promptTokenCount, c = k.completion_tokens ?? k.output_tokens ?? k.candidatesTokenCount; return g != null || c != null ? `token: ${g ?? "?"} gönderilen · ${c ?? "?"} alınan` : ""; };

  async function calistir(zorla) {
    if (istekte) return;
    analizDurum.textContent = "";
    const h = await saglayiciHazir();
    if (h.hata) { analizDurum.textContent = h.hata; return; }
    if (h.ac) { analizDurum.textContent = h.neden; aiAyarDialogu(d, { onKapat: () => { secimCiz(); } }); return; }
    const { s, anahtar } = h;
    const { p, metin } = paketUret();
    const model = (s.model || SAGLAYICILAR[s.saglayici].varsayilan).trim();
    const anahtarOz = `${ozet(metin)}|${s.saglayici}|${model}`;
    if (st.paketAnahtar !== ozet(metin)) { st.sohbet = []; st.paketAnahtar = ozet(metin); sohbetCiz(); }
    if (!zorla && st.onbellek.has(anahtarOz)) { st.analiz = { ...st.onbellek.get(anahtarOz), onbellek: true }; sonucGoster(); return; }
    istekte = true; analizBtn.disabled = true; yenidenBtn.disabled = true; iptalBtn.hidden = false; iptal = new AbortController();
    analizDurum.textContent = `${SAGLAYICILAR[s.saglayici].kisa} analiz ediyor… (≈ ${tokenTahmin(metin).toLocaleString("tr-TR")} token gönderiliyor)`;
    try {
      const r = await yorumIste({ saglayici: s.saglayici, model, anahtar, sistem: ANALIZ_SISTEM, kullanici: analizKullanici(metin), sinyal: iptal.signal });
      st.analiz = { metin: r.metin, saglayici: s.saglayici, model: r.model, kullanim: r.kullanim, zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), onbellek: false, tarih: p.secili_gun.tarih };
      st.onbellek.set(anahtarOz, st.analiz); if (st.onbellek.size > 8) st.onbellek.delete(st.onbellek.keys().next().value);
      analizDurum.textContent = ""; sonucGoster();
    } catch (hh) { analizDurum.textContent = hh.message; }
    finally { istekte = false; analizBtn.disabled = false; yenidenBtn.disabled = false; iptalBtn.hidden = true; iptal = null; }
  }

  kok.append(el("h3", { class: "hv-alt-baslik", text: "Yapay zekâ analizi" }),
    ipucu("Tıklamadan hiçbir istek gitmez. Aynı veri için ikinci tıklama yeni istek yapmaz. Yorum yalnızca pakettaki sayılara dayanır; lehte ve aleyhte işaretleri birlikte verir, kesinlik iddia etmez."),
    secimAlani, el("div", { class: "hv-btn-satir" }, analizBtn, yenidenBtn, iptalBtn), analizDurum, analizKutu);

  /* --- 3) geçici sohbet --- */
  const sohbetKutu = el("div", { class: "hv-sohbet", "aria-live": "polite" });
  const soruGirdi = el("textarea", { class: "hv-girdi hv-sohbet-girdi", rows: "2", maxlength: "600", "aria-label": "Sorun", placeholder: "Örn. 08:00–10:00 arası yağmur olur mu? / Akşam 18'de ne giymeliyim?" });
  const gonder = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "Gönder" }), "click", () => soruSor(soruGirdi.value));
  const temizle = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Sohbeti temizle" }), "click", () => { st.sohbet = []; sohbetCiz(); });
  const hizli = ["Sabah 07–10 arası nasıl?", "Öğleden sonra yağmur riski?", "Akşam eve dönüşte ne giymeliyim?", "En riskli saat hangisi, neden?", "Rüzgâr ne zaman en sert?"];
  olay(soruGirdi, "keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); soruSor(soruGirdi.value); } });
  function sohbetCiz() {
    doldur(sohbetKutu, ...st.sohbet.map((m) => el("div", { class: `hv-sohbet-mesaj ${m.rol}` }, el("small", { class: "hv-etiket", text: m.rol === "ben" ? "Sen" : "Yapay zekâ" }), m.rol === "ben" ? el("p", { text: m.metin }) : mdCiz(m.metin))));
    if (!st.sohbet.length) sohbetKutu.append(el("p", { class: "hv-ipucu", text: "Henüz soru yok. Belirli bir saat aralığını ya da konuyu sor." }));
    sohbetKutu.scrollTop = sohbetKutu.scrollHeight;
  }
  async function soruSor(soru) {
    soru = String(soru || "").trim();
    if (!soru || istekte) return;
    const h = await saglayiciHazir();
    if (h.hata) { analizDurum.textContent = h.hata; return; }
    if (h.ac) { analizDurum.textContent = h.neden; aiAyarDialogu(d, { onKapat: () => { secimCiz(); } }); return; }
    const { s, anahtar } = h; const { metin } = paketUret();
    st.paketAnahtar = ozet(metin);
    istekte = true; gonder.disabled = true; st.sohbet.push({ rol: "ben", metin: soru }); st.sohbet.push({ rol: "ai", metin: "…" }); sohbetCiz(); soruGirdi.value = "";
    try {
      const r = await yorumIste({ saglayici: s.saglayici, model: (s.model || SAGLAYICILAR[s.saglayici].varsayilan).trim(), anahtar, sistem: SOHBET_SISTEM, kullanici: sohbetKullanici(metin, st.analiz?.metin || "", soru), maksToken: 1200 });
      st.sohbet[st.sohbet.length - 1] = { rol: "ai", metin: r.metin };
    } catch (hh) { st.sohbet[st.sohbet.length - 1] = { rol: "ai", metin: `⚠️ ${hh.message}` }; }
    finally { istekte = false; gonder.disabled = false; sohbetCiz(); }
  }
  kok.append(el("h3", { class: "hv-alt-baslik", text: "Geçici sohbet" }),
    ipucu("Analizden sonra belirli bir saat aralığını ya da konuyu sor. Sohbet kaydedilmez: sayfayı yenilediğinde ya da “Sohbeti temizle”ye bastığında silinir; hesabına/sunucuya yazılmaz. Her soru ayrı bir istektir (kendi kotandan düşer)."),
    el("div", { class: "hv-cipgrup" }, ...hizli.map((q) => olay(el("button", { type: "button", class: "hv-cip-btn", text: q }), "click", () => { soruGirdi.value = q; soruGirdi.focus(); }))),
    sohbetKutu, soruGirdi, el("div", { class: "hv-btn-satir" }, gonder, temizle));
  sonucGoster(); sohbetCiz(); secimCiz();
  return kok;
}

void rozet; void ekle; void lsOku; void lsYaz;
