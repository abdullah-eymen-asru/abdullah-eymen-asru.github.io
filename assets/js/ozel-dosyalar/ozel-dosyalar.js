/*
 * assets/js/ozel-dosyalar/ozel-dosyalar.js — İçerik Yönetimi › Özel / Gizli Makaleler formu › "📎 R2 dosyaları"
 * Siteden, Cloudflare'e girmeden, HER TÜR dosyayı R2'ye yükle; AYRI ana klasör "Özel Makaleler" içinde klasör/alt klasör aç, sil (Dosya Yöneticisi gibi),
 * dosyaları işaretleyip bu makaleye ekle. Okuyucu eki makale sayfasından indirir (erişimi veritabanı doğrular, 0131).
 * Depolama = Arşiv (aynı R2 kotası). Yetki: Arşiv yükleme/silme yetkisi + özel içerik yönetim yetkisi. CSP: inline stil/olay yok.
 * admin.js ile olay üzerinden konuşur: ozel-icerik:duzenle {id} · ozel-icerik:sifirla · ozel-icerik:kaydedildi {id, isler[]}.
 */
import { supabase } from "../core/supabase-client.js";
import { dosyalariTopla, kuyrukKur } from "../r2-arsiv/yukleme.js";
import { worker, boyutYaz } from "../r2-arsiv/ortak.js";

const KOK = "Özel Makaleler";
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f, oz = {}) { const b = el("button", `oz-btn ${c || ""}`.trim(), m); b.type = "button"; for (const [k, v] of Object.entries(oz)) b.setAttribute(k, v); if (f) b.addEventListener("click", f); return b; }
const adGecerli = (a) => a && !/[\/\\\u0000-\u001f\u007f]/.test(a) && a.trim() === a && a !== "." && a !== "..";

const durum = { yol: [], secili: new Map(), duzenlenen: null };      // yol: ["A","B"]; secili: arsivId → {ad, boyut}
let panel = null, ciz = () => {};

async function kokuGaranti() {
  const { error } = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: "", p_ad: KOK });
  if (error && !/zaten var/i.test(error.message || "")) throw new Error(error.message);
}
const klasorYolu = () => `${[KOK, ...durum.yol].join("/")}/`;

async function kur(form) {
  if (document.getElementById("oz-r2-panel")) return;
  durum.secili.clear(); durum.yol = []; durum.duzenlenen = null;     // yeni form örneği: önceki oturumdan seçim kalmasın
  const hedef = form.querySelector("#harici_dosya_url")?.closest(".form-field"); if (!hedef) return;
  panel = el("details", "oz-panel"); panel.id = "oz-r2-panel"; panel.open = true;
  panel.append(el("summary", "oz-ozet", "📎 R2 dosyaları — her tür dosya (isteğe bağlı)"));
  const ic = el("div", "oz-ic"); panel.append(ic);
  const mesaj = el("p", "oz-mesaj"); mesaj.setAttribute("role", "status"); mesaj.setAttribute("aria-live", "polite");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("oz-hata", !!h); };
  const yol = el("nav", "oz-yol"); yol.setAttribute("aria-label", "Klasör konumu");
  const arac = el("div", "oz-arac"), liste = el("ul", "oz-liste"), secimKutu = el("div", "oz-secim");
  const dosyaGirdi = el("input"); dosyaGirdi.type = "file"; dosyaGirdi.multiple = true; dosyaGirdi.className = "oz-gizli-girdi";
  const kuyrukListe = el("ul", "oz-kuyruk"), kuyrukOzet = el("p", "oz-soluk"), kuyrukTemizle = dg("Temizle", "oz-kucuk"); kuyrukOzet.hidden = true; kuyrukTemizle.hidden = true;
  let kayitlar = [];

  const kuyruk = kuyrukKur({ liste: kuyrukListe, ozet: kuyrukOzet, temizleBtn: kuyrukTemizle,
    baglam: () => ({ yukleyebilir: true, klasor: klasorYolu(), sifreli: false, alicilar: [], uid: null }),
    bitti: async () => { const once = new Set(kayitlar.map((k) => k.id)); await yenile(); kayitlar.filter((k) => k.tur === "dosya" && !once.has(k.id)).forEach((k) => durum.secili.set(k.id, { ad: k.ad, boyut: k.boyut })); ciz(); bildir("✔ Yüklendi ve bu makaleye eklenmek üzere işaretlendi."); } });

  async function yenile() {
    const { data, error } = await supabase.from("r2_arsiv").select("id,tur,ad,boyut,durum,sifreli").eq("klasor_yolu", klasorYolu()).eq("durum", "hazir").order("tur", { ascending: false }).order("ad").limit(500);
    if (error) { kayitlar = []; liste.replaceChildren(el("li", "oz-soluk", /42501|permission|policy/i.test(error.message) ? "R2 dosyaları için Arşiv erişim yetkisi gerekir (Yetki Ayarları › Arşiv)." : error.message)); return; }
    kayitlar = (data || []).filter((k) => !k.sifreli); cizListe();
  }
  /** Taşı: hedef klasörü seç (Özel Makaleler ağacı) → r2_arsiv_tasi (0133). Klasör kendi altına taşınamaz; ad çakışması sunucuda reddedilir. */
  async function tasiKutusu(li, k) {
    const { data } = await supabase.from("r2_arsiv").select("klasor_yolu,ad").eq("tur", "klasor").like("klasor_yolu", `${KOK}/%`).limit(1000);
    const yollar = [`${KOK}/`, ...(data || []).map((f) => `${f.klasor_yolu}${f.ad}/`)].filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => a.localeCompare(b, "tr"));
    const kendi = k.tur === "klasor" ? `${klasorYolu()}${k.ad}/` : null;
    const sec = el("select", "oz-girdi"); sec.setAttribute("aria-label", "Hedef klasör");
    yollar.filter((y) => y !== klasorYolu() && !(kendi && y.startsWith(kendi))).forEach((y) => { const o = el("option", null, `📁 ${y.replace(/\/$/, "").replace(`${KOK}`, KOK) || KOK}`); o.value = y; sec.append(o); });
    if (!sec.options.length) { bildir("Taşınacak başka klasör yok. Önce “Yeni klasör” oluştur.", true); return; }
    const tamam = dg("Taşı", "oz-birincil oz-kucuk", async () => { try { const { error } = await supabase.rpc("r2_arsiv_tasi", { p_id: k.id, p_hedef_yol: sec.value }); if (error) throw new Error(error.message); durum.secili.forEach(() => {}); await yenile(); bildir(`“${k.ad}” taşındı.`); } catch (h) { bildir(h.message, true); } });
    li.replaceChildren(el("span", "oz-soluk", `“${k.ad}” nereye taşınsın?`), sec, tamam, dg("Vazgeç", "oz-kucuk", () => cizListe()));
  }
  function cizYol() {
    yol.replaceChildren(dg(`🗂 ${KOK}`, "oz-kucuk", () => { durum.yol = []; yenile(); cizYol(); }));
    durum.yol.forEach((p, i) => { yol.append(el("span", "oz-soluk", "›"), dg(p, "oz-kucuk", () => { durum.yol = durum.yol.slice(0, i + 1); yenile(); cizYol(); })); });
  }
  function cizListe() {
    liste.replaceChildren();
    if (!kayitlar.length) { liste.append(el("li", "oz-soluk", "Bu klasör boş. Yukarıdan dosya yükle ya da klasör oluştur.")); return; }
    for (const k of kayitlar) {
      const li = el("li", "oz-oge");
      if (k.tur === "klasor") {
        const ac = dg(`📁 ${k.ad}`, "oz-klasor", () => { durum.yol = [...durum.yol, k.ad]; yenile(); cizYol(); });
        li.append(ac, dg("↪ Taşı", "oz-kucuk", () => tasiKutusu(li, k), { title: "Klasörü başka klasöre taşı" }), dg("🗑", "oz-kucuk oz-tehlike", async () => {
          // Varsayılan: klasör kalkar, içindekiler BİR ÜST klasöre çıkar. İstersen hepsi silinir.
          if (window.confirm(`“${k.ad}” klasörü silinsin mi?\n\nTamam: klasör kalkar, içindeki dosya ve klasörler bir üst klasöre taşınır (silinmez).\nİptal: bir sonraki adımda içindekilerle birlikte silme seçeneği sunulur.`)) {
            try { const { error } = await supabase.rpc("r2_arsiv_klasor_sil_tasi", { p_id: k.id }); if (error) throw new Error(error.message); await yenile(); bildir("Klasör silindi; içindekiler bir üst klasöre taşındı."); } catch (h) { bildir(h.message, true); }
            return;
          }
          if (!window.confirm(`“${k.ad}” klasörü ve İÇİNDEKİ TÜM dosyalar R2'den silinsin mi? Geri alınamaz.`)) return;
          try { await worker("/sil", { id: k.id }); await yenile(); bildir("Klasör ve içindekiler silindi."); } catch (h) { bildir(h.message, true); }
        }, { "aria-label": `${k.ad} klasörünü sil`, title: "Klasörü sil (içindekiler üst klasöre çıkar)" }));
      } else {
        const c = el("input"); c.type = "checkbox"; c.checked = durum.secili.has(k.id); c.setAttribute("aria-label", `${k.ad} dosyasını bu makaleye ekle`);
        c.addEventListener("change", () => { if (c.checked) durum.secili.set(k.id, { ad: k.ad, boyut: k.boyut }); else durum.secili.delete(k.id); cizSecim(); });
        const lab = el("label", "oz-dosya"); lab.append(c, el("span", "oz-ad", `📄 ${k.ad}`), el("small", "oz-soluk", boyutYaz(k.boyut)));
        li.append(lab, dg("↪ Taşı", "oz-kucuk", () => tasiKutusu(li, k), { title: "Dosyayı başka klasöre taşı" }), dg("🗑", "oz-kucuk oz-tehlike", async () => {
          if (!window.confirm(`“${k.ad}” R2'den silinsin mi? Geri alınamaz.`)) return;
          try { await worker("/sil", { id: k.id }); durum.secili.delete(k.id); await yenile(); cizSecim(); bildir("Dosya silindi."); } catch (h) { bildir(h.message, true); }
        }, { "aria-label": `${k.ad} dosyasını sil` }));
      }
      liste.append(li);
    }
  }
  function cizSecim() {
    secimKutu.replaceChildren(); const n = durum.secili.size;
    secimKutu.append(el("strong", null, n ? `✔ Bu makaleye eklenecek: ${n} dosya` : "Bu makaleye henüz dosya eklenmedi."));
    if (!n) return;
    const ul = el("ul", "oz-chipler");
    durum.secili.forEach((v, id) => { const li = el("li", "oz-chip"); li.append(el("span", null, v.ad), dg("✕", "oz-kucuk", () => { durum.secili.delete(id); cizSecim(); cizListe(); }, { "aria-label": `${v.ad} ekini kaldır` })); ul.append(li); });
    secimKutu.append(ul);
  }
  ciz = () => { cizYol(); cizListe(); cizSecim(); };

  arac.append(
    dg("📁 Yeni klasör", "", async () => {
      const ad = window.prompt("Klasör adı:"); if (ad === null) return; const t = ad.trim(); if (!adGecerli(t)) { bildir("Geçerli bir ad yaz ('/' ve '\\' kullanılamaz).", true); return; }
      try { await kokuGaranti(); const ust = [KOK, ...durum.yol].join("/") + "/"; const { error } = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: durum.yol.length ? ust.slice(0, -1) + "/" : `${KOK}/`, p_ad: t });
        if (error) throw new Error(error.message); await yenile(); bildir("Klasör oluşturuldu."); } catch (h) { bildir(h.message, true); }
    }),
    dg("📤 Dosya yükle (her format, birden çok)", "oz-birincil", () => dosyaGirdi.click()));   // tıklama hemen dosya seçiciyi açar (tarayıcılar async sonrası click()'i engeller)
  async function klasorHazirla() {                                 // alt klasör zincirinin var olduğundan emin ol
    let ust = `${KOK}/`; for (const p of durum.yol) { await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: ust, p_ad: p }); ust += `${p}/`; }
  }
  dosyaGirdi.addEventListener("change", async () => {
    try {
      bildir("Klasör hazırlanıyor…"); await kokuGaranti(); await klasorHazirla(); bildir("");
      await kuyruk.ekle(await dosyalariTopla({ files: dosyaGirdi.files }));
    } catch (h) { bildir(h.message || String(h), true); }
    dosyaGirdi.value = "";
  });

  ic.append(el("p", "oz-soluk", "Dosyalar siteden R2'ye yüklenir; Cloudflare'e girmen gerekmez. Dosyaları işaretle: makaleye erişimi olan üyeler makale sayfasından indirir. Büyük dosyalar için üstteki “harici link” alanı da kullanılabilir."),
    yol, arac, dosyaGirdi, kuyrukListe, kuyrukOzet, kuyrukTemizle, liste, secimKutu, mesaj);
  hedef.insertAdjacentElement("afterend", panel);
  ciz(); kokuGaranti().then(yenile).catch((h) => bildir(h.message, true));
}

/* admin.js olayları */
async function mevcutEkleriYukle(id) {
  durum.secili.clear(); durum.duzenlenen = id;
  const { data } = await supabase.rpc("ozel_icerik_dosyalari_listele", { p_content_id: id });
  (data || []).forEach((d) => durum.secili.set(d.arsiv_id, { ad: d.ad, boyut: d.boyut })); ciz();
}
document.addEventListener("ozel-icerik:duzenle", (e) => { mevcutEkleriYukle(e.detail.id).catch(() => {}); });
document.addEventListener("ozel-icerik:sifirla", () => { durum.secili.clear(); durum.duzenlenen = null; ciz(); });
document.addEventListener("ozel-icerik:kaydedildi", (e) => {
  const idler = [...durum.secili.keys()];
  if (!idler.length && !durum.duzenlenen) return;                                   // yeni makale + hiç ek yok → yazacak bir şey yok
  e.detail.isler.push((async () => { const { error } = await supabase.rpc("ozel_icerik_dosya_ata", { p_content_id: e.detail.id, p_arsiv_idler: idler }); if (error) throw new Error(error.message); })());
});

/* Form <template> klonu olduğundan gözlemle; her görünüşünde paneli yeniden ekle. */
let kuruyor = false;
const dene = () => { const f = document.getElementById("icerik-form"); if (!f || kuruyor || document.getElementById("oz-r2-panel")) return; kuruyor = true; kur(f).catch((h) => console.error("ozel-dosyalar.js:", h)).finally(() => { kuruyor = false; }); };
new MutationObserver(dene).observe(document.documentElement, { childList: true, subtree: true });
dene();
