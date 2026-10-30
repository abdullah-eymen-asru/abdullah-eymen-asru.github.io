/*
 * baglantilar.js — Dosya Yöneticisi › 🔗 Bağlantılar (migration 0123)
 * Adlı + açıklamalı herkese açık dosya bağlantıları: süre (dakika→yıl, tarih seç, SINIRSIZ), arama, düzenleme, iptal/yeniden açma, silme,
 * kopyalama (her alan adı için), kullanım sayısı; "Ayarlar" alt sekmesinde alan adları (github.io / pages.dev / ileride kendi alan adın).
 * Bağlantı: https://<alan>/d/<slug> → site yönlendirir → r2-arsiv-worker her tıklamada DB'den doğrular. Şifreli dosya paylaşılamaz.
 * CSP: inline stil/işleyici yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, btn, boyutYaz, tarihYaz } from "./ortak.js";

const BIRIMLER = [["dk", "dakika", 60], ["sa", "saat", 3600], ["g", "gün", 86400], ["ay", "ay", 2592000], ["y", "yıl", 31536000]];
const HAZIR = [["1s", "1 saat", 3600], ["1g", "1 gün", 86400], ["7g", "7 gün", 7 * 86400], ["30g", "30 gün", 30 * 86400], ["1y", "1 yıl", 365 * 86400], ["sinirsiz", "Sınırsız (kendim kapatana kadar)", null]];
const DURUM_ROZET = { aktif: ["✅ Aktif", "ra-rozet"], doldu: ["⌛ Süresi doldu", "ra-rozet"], iptal: ["⛔ İptal edildi", "ra-rozet"], dosya_yok: ["🗑 Dosya silinmiş", "ra-rozet"] };
const alanAdlariVarsayilan = [{ ad: "github.io (ana site)", url: "https://abdullah-eymen-asru.github.io", aktif: true }, { ad: "pages.dev (yedek)", url: "https://abdullah-eymen-asru.pages.dev", aktif: true }];

const yerelInput = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function panoyaKopyala(m) { try { await navigator.clipboard.writeText(m); return true; } catch { const t = el("textarea"); t.value = m; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { /* yok say */ } t.remove(); return ok; } }

export function baglantilarGorunumuKur({ kok, bildir, yonetici = false }) {
  let ayar = { alan_adlari: alanAdlariVarsayilan, varsayilan_gecerlilik: "7g" }, liste = [], ara = "", altSekme = "liste", ilkYukleme = true;
  const ustSerit = el("div", "ra-ust-serit");
  const baglantiSekme = btn("🔗 Bağlantılar", "ra-sekme", () => { altSekme = "liste"; ciz(); }, { role: "tab" });
  const ayarSekme = btn("⚙ Ayarlar", "ra-sekme", () => { altSekme = "ayar"; ciz(); }, { role: "tab" });
  ustSerit.append(el("div", "ra-sekmeler"), el("span"));
  ustSerit.firstChild.append(baglantiSekme, ayarSekme);
  const icerik = el("div", "ra-baglanti-icerik");
  kok.replaceChildren(ustSerit, icerik);

  async function ayarYukle() {
    try { const { data, error } = await supabase.rpc("r2_baglanti_ayar_oku"); if (!error && data?.alan_adlari?.length) ayar = data; } catch { /* varsayılan */ }
  }
  async function listeYukle() {
    const { data, error } = await supabase.rpc("r2_baglanti_listele", { p_ara: ara || null });
    if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? "Bağlantı sistemi kurulu değil (Supabase: 0123_r2_paylasim_baglantilari.sql)." : error.message);
    liste = data || [];
  }
  const aktifAlanlar = () => (ayar.alan_adlari || []).filter((a) => a.aktif !== false);
  const adres = (alan, slug) => `${alan.url.replace(/\/+$/, "")}/d/${slug}`;

  function ciz() {
    baglantiSekme.setAttribute("aria-selected", String(altSekme === "liste")); ayarSekme.setAttribute("aria-selected", String(altSekme === "ayar"));
    icerik.replaceChildren(altSekme === "liste" ? listeGorunumu() : ayarGorunumu());
  }

  /* ----------------------------- liste ----------------------------- */
  function listeGorunumu() {
    const kap = el("div");
    const arama = el("input", "ra-ara-girdi"); arama.type = "search"; arama.placeholder = "Bağlantılarda ara (ad, açıklama, dosya adı)…"; arama.value = ara; arama.setAttribute("aria-label", "Bağlantılarda ara");
    let z; arama.addEventListener("input", () => { clearTimeout(z); z = setTimeout(async () => { ara = arama.value.trim(); try { await listeYukle(); listeKap.replaceChildren(...satirlar()); } catch (h) { bildir(h.message); } }, 250); });
    const yeni = btn("＋ Yeni bağlantı", "ra-btn ra-btn-birincil", () => olustur());
    const eski = eskiYontemKutusu();
    const listeKap = el("ul", "ra-liste"); listeKap.append(...satirlar());
    kap.append(el("p", "ra-bilgi-seridi", "🔗 Dosyaları herkese açık, adlandırılmış bağlantıyla paylaş. Süreyi dakikadan yıla seçebilir ya da SINIRSIZ bırakabilirsin; istediğin an iptal edebilirsin. Arşive dosya yüklemek için “Arşiv” sekmesini kullan, sonra dosyadaki 🔗 düğmesine bas."),
      el("div", "ra-arac", null), el("div", "ra-ara-kutu"), listeKap, eski);
    const arac = kap.querySelector(".ra-arac"), aramaKutu = kap.querySelector(".ra-ara-kutu"); aramaKutu.append(arama); arac.append(aramaKutu, yeni);
    kap.insertBefore(arac, listeKap);
    return kap;
  }
  function satirlar() {
    if (!liste.length) return [el("li", "ra-bos", ara ? "Aramaya uyan bağlantı yok." : "Henüz bağlantı yok. “＋ Yeni bağlantı” ile oluştur.")];
    return liste.map(satir);
  }
  function satir(b) {
    const li = el("li", "ra-satir ra-baglanti-satir");
    const [rozetMetin] = DURUM_ROZET[b.durum] || [b.durum];
    const bitisYazi = b.bitis ? `bitiş: ${tarihYaz(b.bitis)}` : "süresiz";
    const govde = el("div", "ra-govde");
    govde.append(el("strong", null, b.ad), el("div", "ra-meta-satir", null));
    govde.lastChild.append(el("span", "ra-rozet", rozetMetin), el("span", "ra-meta", bitisYazi), el("span", "ra-meta", `${Number(b.indirme_sayisi).toLocaleString("tr-TR")} açılış`), el("span", "ra-meta", `dosya: ${b.dosya_ad}`));
    if (b.sahip_ad) govde.lastChild.append(el("span", "ra-meta", `sahip: ${b.sahip_ad}`));
    if (b.aciklama) govde.append(el("p", "ra-meta", b.aciklama));
    const adresler = el("div", "ra-baglanti-adresler");
    if (b.durum === "aktif") for (const a of aktifAlanlar()) adresler.append(btn(`📋 ${a.ad}`, "ra-btn ra-btn-kucuk", async (e) => { const ok = await panoyaKopyala(adres(a, b.slug)); e.currentTarget.textContent = ok ? "✔ Kopyalandı" : "Kopyalanamadı"; setTimeout(() => { e.currentTarget.textContent = `📋 ${a.ad}`; }, 1500); }, { title: adres(a, b.slug) }));
    govde.append(adresler);
    const islem = el("div", "ra-islemler");
    if (b.benim || yonetici) {
      islem.append(btn("✏️", "ra-ikon-btn", () => duzenle(b), { title: "Düzenle (ad, açıklama, süre)", "aria-label": "Düzenle" }),
        btn(b.iptal ? "▶" : "⏸", "ra-ikon-btn", () => guncelle(b, { iptal: !b.iptal }), { title: b.iptal ? "Yeniden etkinleştir" : "İptal et (bağlantı çalışmaz)", "aria-label": b.iptal ? "Yeniden etkinleştir" : "İptal et" }),
        btn("🗑", "ra-ikon-btn ra-btn-tehlike", () => sil(b), { title: "Kaydı sil", "aria-label": "Sil" }));
    }
    li.append(govde, islem);
    return li;
  }
  async function yenile() { try { await listeYukle(); } catch (h) { bildir(h.message); } ciz(); }
  async function guncelle(b, { iptal }) {
    const { error } = await supabase.rpc("r2_baglanti_guncelle", { p_id: b.id, p_ad: b.ad, p_aciklama: b.aciklama, p_bitis_degistir: false, p_bitis: null, p_iptal: iptal });
    if (error) return bildir(error.message); await yenile();
  }
  async function sil(b) {
    if (!window.confirm(`“${b.ad}” bağlantı kaydı silinsin mi? (Bağlantı çalışmaz olur; dosya SİLİNMEZ.)\nGeçmişi korumak için silmek yerine ⏸ ile iptal edebilirsin.`)) return;
    const { error } = await supabase.from("r2_baglantilari").delete().eq("id", b.id); if (error) return bildir(error.message); await yenile();
  }

  /** Eski "R2 Dosya Paylaşımı": herhangi bir R2 yolu için geçici imzalı link (S3 kuralı: en çok 7 gün). Aynı Worker (/imza) kullanılır. */
  function eskiYontemKutusu() {
    const d = el("details", "ra-eski-yontem"); d.append(el("summary", null, "Gelişmiş: R2 yolu (key) ile geçici imzalı link — eski yöntem"));
    const key = metinGirdi("", "R2 dosya yolu (örn. icerik-id/dosya.pdf)", 500), sayi = el("input", "ra-ara-girdi"); sayi.type = "number"; sayi.min = "1"; sayi.value = "1";
    const birim = el("select", "ra-secim"); [["dk", "dakika"], ["sa", "saat"], ["g", "gün (en çok 7)"]].forEach(([v, a]) => { const o = el("option", null, a); o.value = v; birim.append(o); }); birim.value = "sa";
    const sonuc = el("input", "ra-ara-girdi"); sonuc.readOnly = true; sonuc.hidden = true; sonuc.addEventListener("click", () => sonuc.select());
    const mesaj = el("p", "ra-meta"); mesaj.setAttribute("role", "status");
    const uret = btn("İmzalı link üret", "ra-btn", async () => {
      try {
        const sn = Math.floor(Number(sayi.value)) * { dk: 60, sa: 3600, g: 86400 }[birim.value];
        if (!key.value.trim()) throw new Error("Önce bir R2 dosya yolu gir.");
        if (!(sn >= 60) || sn > 7 * 86400) throw new Error("İmzalı linkler en az 1 dakika, en çok 7 gün geçerli olabilir. Daha uzunu için yukarıdaki kalıcı bağlantıları kullan.");
        const { imzaliLinkUret } = await import("../dosya-paylasim.js");
        const r = await imzaliLinkUret(key.value.trim(), { expiresIn: sn }); const link = r?.url || r?.downloadUrl;
        if (!link) throw new Error("Worker bağlantı döndürmedi (adres/sürüm?)."); sonuc.value = link; sonuc.hidden = false; sonuc.select(); mesaj.textContent = "Link üretildi; kopyalayabilirsin.";
      } catch (h) { mesaj.textContent = h.message; }
    });
    const satir = el("div", "ra-satir-ici"); satir.append(sayi, birim, uret); d.append(key, satir, sonuc, mesaj); return d;
  }

  /* ----------------------------- form (oluştur / düzenle) ----------------------------- */
  function sureAlanlari(mevcutBitis) {
    const sec = el("select", "ra-secim"); sec.setAttribute("aria-label", "Geçerlilik süresi");
    const secenekler = [...HAZIR.map(([v, a]) => [v, a]), ["ozel", "Özel süre…"], ["tarih", "Belirli tarih ve saat…"]];
    if (mevcutBitis !== undefined) secenekler.unshift(["koru", mevcutBitis ? `Değiştirme (şu an: ${tarihYaz(mevcutBitis)})` : "Değiştirme (şu an: sınırsız)"]);
    secenekler.forEach(([v, a]) => { const o = el("option", null, a); o.value = v; sec.append(o); });
    sec.value = mevcutBitis !== undefined ? "koru" : (ayar.varsayilan_gecerlilik || "7g");
    const sayi = el("input", "ra-ara-girdi"); sayi.type = "number"; sayi.min = "1"; sayi.step = "1"; sayi.value = "1"; sayi.setAttribute("aria-label", "Süre miktarı");
    const birim = el("select", "ra-secim"); BIRIMLER.forEach(([v, a]) => { const o = el("option", null, a); o.value = v; birim.append(o); }); birim.value = "g"; birim.setAttribute("aria-label", "Süre birimi");
    const tarih = el("input", "ra-ara-girdi"); tarih.type = "datetime-local"; tarih.value = yerelInput(new Date(Date.now() + 86400000)); tarih.setAttribute("aria-label", "Bitiş tarihi ve saati");
    const ozelKutu = el("div", "ra-satir-ici"); ozelKutu.append(sayi, birim); const tarihKutu = el("div", "ra-satir-ici"); tarihKutu.append(tarih);
    const goster = () => { ozelKutu.hidden = sec.value !== "ozel"; tarihKutu.hidden = sec.value !== "tarih"; }; sec.addEventListener("change", goster); goster();
    const kok2 = el("div"); kok2.append(sec, ozelKutu, tarihKutu);
    return { kok: kok2, /** {degistir, bitis(ISO|null)} */ deger() {
      const v = sec.value;
      if (v === "koru") return { degistir: false, bitis: null };
      if (v === "sinirsiz") return { degistir: true, bitis: null };
      if (v === "tarih") { const t = new Date(tarih.value); if (!tarih.value || isNaN(t) || t <= new Date()) throw new Error("Bitiş tarihi gelecekte olmalı."); return { degistir: true, bitis: t.toISOString() }; }
      let sn;
      if (v === "ozel") { const n = Math.floor(Number(sayi.value)); if (!(n >= 1)) throw new Error("Süre miktarı en az 1 olmalı."); sn = n * BIRIMLER.find((b) => b[0] === birim.value)[2]; }
      else sn = HAZIR.find((h) => h[0] === v)[2];
      if (sn > 100 * 31536000) throw new Error("Süre en çok 100 yıl olabilir (daha uzunu için “Sınırsız” seç).");
      return { degistir: true, bitis: new Date(Date.now() + sn * 1000).toISOString() };
    } };
  }
  function dialogAc(baslik, govdeEl, onayMetin, onay) {
    const dl = el("dialog", "ra-dlg"); const form = el("form", "ra-dlg-form"); form.method = "dialog";
    const hata = el("p", "ra-hata"); hata.hidden = true;
    const tamam = btn(onayMetin, "ra-btn ra-btn-birincil"); tamam.type = "submit"; const iptal = btn("Vazgeç", "ra-btn", () => dl.close());
    form.append(el("h3", null, baslik), govdeEl, hata, el("div", "ra-dlg-alt")); form.lastChild.append(iptal, tamam); dl.append(form); document.body.append(dl);
    form.addEventListener("submit", async (e) => { e.preventDefault(); hata.hidden = true; tamam.disabled = true; try { await onay(); dl.close(); } catch (h) { hata.textContent = h.message || String(h); hata.hidden = false; } finally { tamam.disabled = false; } });
    dl.addEventListener("close", () => dl.remove()); dl.showModal(); return dl;
  }
  const alan = (etiket, girdi) => { const l = el("label", "ra-alan"); l.append(el("span", "ra-meta", etiket), girdi); return l; };
  const metinGirdi = (v, ph, max) => { const g = el("input", "ra-ara-girdi"); g.type = "text"; g.value = v || ""; g.placeholder = ph; if (max) g.maxLength = max; return g; };

  /** Yeni bağlantı. Arşivdeki bir dosya satırından çağrılırsa dosya hazır gelir (`hazirDosya`). */
  async function olustur(hazirDosya = null) {
    let secili = hazirDosya;
    const ad = metinGirdi(hazirDosya?.ad || "", "Bağlantı adı (örn. 2026 Faaliyet Raporu)"), acik = el("textarea", "ra-ara-girdi"); acik.rows = 3; acik.placeholder = "Açıklama (ileride ne olduğu anlaşılsın)";
    const sure = sureAlanlari();
    const dosyaAra = el("input", "ra-ara-girdi"); dosyaAra.type = "search"; dosyaAra.placeholder = "Arşivde dosya ara…"; dosyaAra.setAttribute("aria-label", "Arşivde dosya ara");
    const sonuc = el("ul", "ra-baglanti-dosyalar"), secimYazi = el("p", "ra-meta", secili ? `Seçili dosya: ${secili.ad}` : "Dosya seçilmedi.");
    const dosyaBul = async () => {
      const t = dosyaAra.value.trim().replace(/[%_\\]/g, (c) => `\\${c}`); let q = supabase.from("r2_arsiv").select("id,ad,boyut,klasor_yolu").eq("tur", "dosya").eq("sifreli", false).eq("durum", "hazir").order("ad").limit(12);
      if (t) q = q.ilike("ad", `%${t}%`);
      const { data } = await q; sonuc.replaceChildren(...(data || []).map((d) => { const li = el("li"); li.append(btn(`📄 ${d.klasor_yolu ? `/${d.klasor_yolu}` : "/"}${d.ad} · ${boyutYaz(d.boyut)}`, "ra-btn ra-btn-kucuk", () => { secili = d; if (!ad.value) ad.value = d.ad; secimYazi.textContent = `Seçili dosya: ${d.ad}`; })); return li; }));
    };
    let z; dosyaAra.addEventListener("input", () => { clearTimeout(z); z = setTimeout(dosyaBul, 250); });
    const govde = el("div", "ra-dlg-govde");
    if (!hazirDosya) govde.append(alan("Dosya (yalnızca şifresiz arşiv dosyaları)", dosyaAra), sonuc, secimYazi); else govde.append(secimYazi);
    govde.append(alan("Bağlantı adı", ad), alan("Açıklama", acik), alan("Geçerlilik", sure.kok));
    dialogAc("Yeni paylaşım bağlantısı", govde, "Bağlantıyı oluştur", async () => {
      if (!secili) throw new Error("Önce bir dosya seç.");
      const s = sure.deger();
      const { data, error } = await supabase.rpc("r2_baglanti_olustur", { p_dosya_id: secili.id, p_ad: ad.value, p_aciklama: acik.value, p_bitis: s.bitis });
      if (error) throw new Error(error.message);
      bildir("Bağlantı oluşturuldu.", "ok"); altSekme = "liste"; await yenile();
      const ilk = aktifAlanlar()[0]; if (ilk && data?.[0]?.slug) await panoyaKopyala(adres(ilk, data[0].slug));
    });
    if (!hazirDosya) dosyaBul();
  }
  function duzenle(b) {
    const ad = metinGirdi(b.ad, "Bağlantı adı"), acik = el("textarea", "ra-ara-girdi"); acik.rows = 3; acik.value = b.aciklama || "";
    const sure = sureAlanlari(b.bitis || null);
    const govde = el("div", "ra-dlg-govde"); govde.append(alan("Bağlantı adı", ad), alan("Açıklama", acik), alan("Geçerlilik", sure.kok));
    dialogAc("Bağlantıyı düzenle", govde, "Kaydet", async () => {
      const s = sure.deger();
      const { error } = await supabase.rpc("r2_baglanti_guncelle", { p_id: b.id, p_ad: ad.value, p_aciklama: acik.value, p_bitis_degistir: s.degistir, p_bitis: s.bitis, p_iptal: null });
      if (error) throw new Error(error.message); await yenile();
    });
  }

  /* ----------------------------- ayarlar (alan adları) ----------------------------- */
  function ayarGorunumu() {
    const kap = el("div", "ra-baglanti-ayar");
    kap.append(el("p", "ra-bilgi-seridi", "Bağlantılar şu biçimdedir: https://<alan adı>/d/<ad-ve-rastgele-kuyruk>. Aşağıdaki her etkin alan adı için ayrı kopyalama düğmesi çıkar. github.io ana site, pages.dev yedektir; kendi alan adını alırsan buraya ekle (alan adının bu siteye bağlı ve /d/ yolunu aynı şekilde yönlendiriyor olması gerekir)."));
    let alanlar = JSON.parse(JSON.stringify(ayar.alan_adlari || alanAdlariVarsayilan));
    const satirlarKap = el("div", "ra-baglanti-alanlar");
    const varsayilan = el("select", "ra-secim"); HAZIR.forEach(([v, a]) => { const o = el("option", null, a); o.value = v; varsayilan.append(o); }); varsayilan.value = ayar.varsayilan_gecerlilik || "7g";
    const dur = el("p", "ra-meta"); dur.setAttribute("role", "status");
    const ciz2 = () => {
      satirlarKap.replaceChildren(...alanlar.map((a, i) => {
        const s = el("div", "ra-satir-ici"); const ad = metinGirdi(a.ad, "Ad", 60), url = metinGirdi(a.url, "https://alan-adi.com", 200); const ak = el("input"); ak.type = "checkbox"; ak.checked = a.aktif !== false;
        ad.disabled = url.disabled = ak.disabled = !yonetici; ad.addEventListener("input", () => { a.ad = ad.value; }); url.addEventListener("input", () => { a.url = url.value.trim().replace(/\/+$/, ""); }); ak.addEventListener("change", () => { a.aktif = ak.checked; });
        const kal = btn("✕", "ra-ikon-btn", () => { alanlar.splice(i, 1); ciz2(); }, { "aria-label": "Alan adını kaldır" }); kal.disabled = !yonetici || alanlar.length < 2;
        const lab = el("label", "ra-meta"); lab.append(ak, document.createTextNode(" etkin")); s.append(ad, url, lab, kal); return s;
      }));
    };
    ciz2();
    const ekle = btn("＋ Alan adı ekle", "ra-btn", () => { alanlar.push({ ad: "Kendi alan adım", url: "https://", aktif: true }); ciz2(); }); ekle.disabled = !yonetici;
    const kaydet = btn("Kaydet", "ra-btn ra-btn-birincil", async () => {
      try { const { error } = await supabase.rpc("r2_baglanti_ayar_kaydet", { p_alan_adlari: alanlar, p_varsayilan: varsayilan.value }); if (error) throw new Error(error.message); await ayarYukle(); dur.textContent = "Kaydedildi."; } catch (h) { dur.textContent = h.message; }
    }); kaydet.disabled = !yonetici; varsayilan.disabled = !yonetici;
    kap.append(satirlarKap, ekle, alan("Yeni bağlantılar için varsayılan süre", varsayilan), kaydet, dur);
    if (!yonetici) kap.append(el("p", "ra-meta", "Alan adlarını yalnızca site sahibi ve yöneticiler değiştirebilir."));
    return kap;
  }

  return { async yukle() { if (ilkYukleme) { await ayarYukle(); ilkYukleme = false; } try { await listeYukle(); } catch (h) { bildir(h.message); } ciz(); }, olustur };
}
