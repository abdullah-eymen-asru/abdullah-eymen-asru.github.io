/*
 * assets/js/medya-kota/medya-kota.js — Medya araçları ORTAK PARÇALARI (Transkript + Medya İndirici)
 *  • kotaPaneli(arac)   : bugünkü kullanıcı + genel (site) kota çubukları; Site Sahibi için limit ayarları ve kullanım özeti.
 *  • kaynakSecici(arac) : "Sistem anahtarı (kotaya sayılır)" ↔ "Kendi anahtarım (kotadan düşmez)". Kendi anahtar HavaStil ile AYNI şifreli kasada
 *                         (havastil_ai_kasasi; istemcide AES-GCM, sunucu/Worker/yedek asla düz anahtarı görmez) saklanır; isteğe bağlı yalnızca oturum belleğinde tutulur.
 * CSP: inline stil/olay yok. Güvenlik sınırı Worker + RPC'lerdedir (migration 0140); bu dosya yalnızca arayüzdür.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni } from "../donusturucu/ortak.js";
import * as Kasa from "../havastil/ai-kasa.js";

export const ARACLAR = {
  transkript: { saglayici: "groq", birim: "saniye", ad: "Transkript", sistemAd: "Sistem Groq anahtarı", kendiAd: "Kendi Groq anahtarım" },
  medya_indir: { saglayici: "cozumleyici", birim: "adet", ad: "Medya İndirici", sistemAd: "Sistem çözümleyicisi", kendiAd: "Kendi çözümleyicim" },
};

export function sureYazi(sn) {
  sn = Math.max(0, Math.round(Number(sn) || 0));
  const s = Math.floor(sn / 3600), d = Math.floor((sn % 3600) / 60), k = sn % 60;
  return s ? `${s} sa ${d} dk` : d ? `${d} dk${k && d < 10 ? ` ${k} sn` : ""}` : `${k} sn`;
}
const deger = (birim, n) => (n == null ? "sınırsız" : birim === "saniye" ? sureYazi(n) : `${Number(n).toLocaleString("tr-TR")} adet`);

function cubuk(baslik, kul, lim, birim) {
  const p = document.createElement("progress"); p.className = "mk-cubuk"; p.max = lim || 1; p.value = lim ? Math.min(kul, lim) : 0;
  if (lim != null && kul >= lim) p.classList.add("mk-dolu");
  const yuzde = lim ? Math.round((Math.min(kul, lim) / lim) * 100) : null;
  return el("div", { class: "mk-satir" },
    el("div", { class: "mk-ust" }, el("strong", { text: baslik }), el("span", { class: "md-soluk", text: lim == null ? `${deger(birim, kul)} kullanıldı · sınırsız` : `${deger(birim, kul)} / ${deger(birim, lim)}${yuzde != null ? ` · %${yuzde}` : ""}` })),
    lim == null ? null : p);
}

/** Kota paneli. durum() son okunan kota nesnesini döner; yenile(kota?) çubukları günceller (Worker yanıtındaki kota verilebilir). */
export function kotaPaneli(arac) {
  const t = ARACLAR[arac], kok = el("section", { class: "md-kart mk-kota" }), govde = el("div", { class: "mk-govde" }), ayarYeri = el("div", {});
  let son = null;
  const ciz = (k) => {
    son = k; if (!k) { govde.replaceChildren(el("p", { class: "md-soluk", text: "Kota bilgisi alınamadı." })); return; }
    const kalanKul = k.kullanici?.kalan;
    govde.replaceChildren(
      cubuk("👤 Senin bugünkü kullanımın", k.kullanici?.kullanilan || 0, k.kullanici?.limit, t.birim),
      cubuk("🌍 Tüm site (ortak) bugünkü kullanım", k.genel?.kullanilan || 0, k.genel?.limit, t.birim),
      el("p", { class: "md-soluk", text: `${kalanKul == null ? "Sınırsız kullanım hakkın var" : `Bugün kalan hakkın: ${deger(t.birim, kalanKul)}`}. Kota her gün gece yarısı (Türkiye saati) yenilenir.${k.kendi_anahtarla_kullanilan ? ` Kendi anahtarınla bugün ${deger(t.birim, k.kendi_anahtarla_kullanilan)} kullandın (sistem kotasına sayılmaz).` : ""}${k.sistem_anahtari_acik === false ? " ⚠ Sistem anahtarı şu an kapalı: yalnızca kendi anahtarınla kullanabilirsin." : ""}` }));
  };
  const yenile = async (k) => {
    if (k && typeof k === "object" && k.kullanici) return ciz(k);
    const { data, error } = await supabase.rpc("medya_kota_durumu", { p_arac: arac });
    if (error) { govde.replaceChildren(el("p", { class: "md-soluk", text: `Kota okunamadı: ${hataMetni(error)}` })); return; }
    ciz(data);
  };
  kok.append(el("h2", { text: "📊 Kota durumu (bugün)" }), govde, ayarYeri);
  yenile();
  supabase.rpc("is_owner").then(({ data }) => { if (data === true) ayarYeri.append(ownerAyar(arac, t, () => yenile())); }).catch(() => {});
  return { kok, yenile, durum: () => son };
}

function ownerAyar(arac, t, bitti) {
  const dak = t.birim === "saniye";
  const kul = el("input", { class: "md-girdi", type: "number", min: "0", inputmode: "numeric", "aria-label": "Kullanıcı başına günlük limit" });
  const gen = el("input", { class: "md-girdi", type: "number", min: "0", inputmode: "numeric", "aria-label": "Genel günlük limit" });
  const kendiIzin = el("input", { type: "checkbox" }), sistemAcik = el("input", { type: "checkbox" });
  const msg = el("p", { class: "md-mesaj", role: "status" }), ozet = el("div", { class: "mk-ozet" });
  const kaydet = el("button", { type: "button", class: "md-btn md-birincil", text: "Kaydet" });
  const birimYazi = dak ? "dakika" : "adet";
  const alan = (et, girdi, ipucu) => el("label", { class: "mi-etiket" }, et, girdi, el("small", { class: "md-soluk", text: ipucu }));
  async function yukle() {
    const { data } = await supabase.rpc("medya_kota_ayarlari"); const a = (data || []).find((x) => x.arac === arac); if (!a) return;
    kul.value = a.kullanici_gunluk == null ? "" : String(dak ? Math.round(a.kullanici_gunluk / 60) : a.kullanici_gunluk);
    gen.value = a.genel_gunluk == null ? "" : String(dak ? Math.round(a.genel_gunluk / 60) : a.genel_gunluk);
    kendiIzin.checked = a.kendi_anahtar_izni; sistemAcik.checked = a.sistem_anahtari_acik;
    const { data: oz } = await supabase.rpc("owner_medya_kota_ozeti");
    const satirlar = (oz || []).filter((x) => x.arac === arac);
    ozet.replaceChildren(el("strong", { text: "Bugün en çok kullananlar" }), ...(satirlar.length ? satirlar.slice(0, 10).map((x) => el("div", { class: "mk-ozet-satir" }, el("span", { text: x.ad }), el("span", { class: "md-soluk", text: `sistem: ${deger(t.birim, x.site || 0)} · kendi anahtar: ${deger(t.birim, x.kendi || 0)} · ${x.istek} istek` }))) : [el("p", { class: "md-soluk", text: "Bugün kullanım yok." })]));
  }
  kaydet.addEventListener("click", async () => {
    const sayi = (v) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v) * (dak ? 60 : 1))));
    kaydet.disabled = true; msg.textContent = "";
    const { error } = await supabase.rpc("owner_medya_kota_ayarla", { p_arac: arac, p_kullanici: sayi(kul.value), p_genel: sayi(gen.value), p_kendi_izni: kendiIzin.checked, p_sistem_acik: sistemAcik.checked });
    kaydet.disabled = false; msg.textContent = error ? `Kaydedilemedi: ${hataMetni(error)}` : "✔ Kaydedildi."; if (!error) bitti();
  });
  const d = el("details", { class: "mk-ayar" }, el("summary", { text: "⚙️ Kota ayarları (yalnızca Site Sahibi)" }),
    el("div", { class: "mi-satir" }, alan(`Kullanıcı başına günlük limit (${birimYazi})`, kul, "Boş = sınırsız"), alan(`Tüm site günlük limit (${birimYazi})`, gen, dak ? "Groq ücretsiz katmanı yaklaşık 28.800 sn/gün (8 saat) ses; güvenli pay için ~330 dk önerilir." : "Boş = sınırsız")),
    el("label", { class: "mk-onay" }, kendiIzin, " Üyeler kendi anahtarını/çözümleyicisini kullanabilsin (sistem kotasına sayılmaz)"),
    el("label", { class: "mk-onay" }, sistemAcik, " Sistem anahtarı açık (kapatılırsa herkes yalnızca kendi anahtarıyla kullanır)"),
    el("div", { class: "md-eylem" }, kaydet), msg, ozet);
  d.addEventListener("toggle", () => { if (d.open) yukle(); });
  return d;
}

/** Kaynak seçici. hazirla() → { basliklar, kendi } ; kendi anahtar eksikse Error fırlatır. */
export function kaynakSecici(arac) {
  const t = ARACLAR[arac], SEC = `medya_kaynak_${arac}`, cozumleyici = t.saglayici === "cozumleyici";
  let bellek = null, kasaAcik = false, kayitli = false, izin = true;
  const oku = () => { try { return localStorage.getItem(SEC) === "kendi" ? "kendi" : "site"; } catch { return "site"; } };
  const yaz = (v) => { try { localStorage.setItem(SEC, v); } catch { /* depo kapalı */ } };
  const r1 = el("input", { type: "radio", name: `mk-${arac}`, value: "site" }), r2 = el("input", { type: "radio", name: `mk-${arac}`, value: "kendi" });
  const adres = el("input", { class: "md-girdi", type: "url", placeholder: "https://kullanici-space.hf.space/", autocomplete: "off", spellcheck: "false", "aria-label": "Çözümleyici adresi" });
  const tur = el("select", { class: "md-girdi", "aria-label": "Çözümleyici türü" }, el("option", { value: "ytdlp", text: "yt-dlp servisi (Hugging Face Space vb.)" }), el("option", { value: "cobalt", text: "Cobalt API" }));
  const anahtar = el("input", { class: "md-girdi", type: "password", autocomplete: "off", spellcheck: "false", placeholder: cozumleyici ? "API anahtarı (varsa)" : "gsk_…", "aria-label": cozumleyici ? "Çözümleyici anahtarı" : "Groq API anahtarı" });
  const sakla = el("input", { type: "checkbox", checked: true }), durum = el("p", { class: "md-soluk mk-durum" });
  const kaydetBtn = el("button", { type: "button", class: "md-btn", text: "🔐 Kullan / Kasaya kaydet" }), silBtn = el("button", { type: "button", class: "md-btn", text: "🗑 Kayıtlı anahtarı sil", hidden: true });
  const kendiKutu = el("div", { class: "mk-kendi", hidden: true },
    cozumleyici ? el("p", { class: "md-soluk", text: "Kendi çözümleyicin (ücretsiz Hugging Face Space ya da kendi Cobalt/yt-dlp'n): adres + isteğe bağlı anahtar. Medya senin çözümleyicinden akar; sistem kotasına sayılmaz." }) : el("p", { class: "md-soluk", text: "Ücretsiz Groq anahtarını console.groq.com/keys adresinden alabilirsin. Ses, doğrudan SENİN anahtarınla Groq'a gider; sistem kotasına sayılmaz (Groq'un kendi ücretsiz sınırların geçerlidir)." }),
    cozumleyici ? el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Adres", adres), el("label", { class: "mi-etiket" }, "Tür", tur)) : null,
    el("label", { class: "mi-etiket" }, cozumleyici ? "Anahtar (isteğe bağlı)" : "Groq API anahtarı", anahtar),
    el("label", { class: "mk-onay" }, sakla, " Şifreli kasaya kaydet (tüm cihazlarımda hazır olsun). İşaretlenmezse yalnızca bu sekmenin belleğinde tutulur."),
    el("div", { class: "md-eylem" }, kaydetBtn, silBtn), durum);
  const kok = el("fieldset", { class: "md-kart mk-kaynak" }, el("legend", { text: "🔑 Hangi anahtarla çalışsın?" }),
    el("label", { class: "mk-secenek" }, r1, el("span", {}, el("strong", { text: `${t.sistemAd} (kotaya sayılır)` }), el("small", { class: "md-soluk", text: "Ek bir şey girmen gerekmez. Günlük kota geçerlidir." }))),
    el("label", { class: "mk-secenek" }, r2, el("span", {}, el("strong", { text: `${t.kendiAd} (kotadan düşmez)` }), el("small", { class: "md-soluk", text: "Anahtarın şifreli saklanır; Site Sahibi dâhil kimse göremez." }))),
    kendiKutu);
  const uygula = () => { const kendi = r2.checked; kendiKutu.hidden = !kendi; yaz(kendi ? "kendi" : "site"); silBtn.hidden = !kayitli; };
  r1.addEventListener("change", uygula); r2.addEventListener("change", uygula);
  (oku() === "kendi" ? r2 : r1).checked = true;

  const paketle = () => (cozumleyici ? `${adres.value.trim()}|${tur.value}|${anahtar.value.trim()}` : anahtar.value.trim());
  const coz = (s) => { if (!cozumleyici) return { anahtar: s }; const [a, ty, ...k] = s.split("|"); return { adres: a, tur: ty === "cobalt" ? "cobalt" : "ytdlp", anahtar: k.join("|") }; };
  async function kasaHazirla() {
    try { kasaAcik = await Kasa.otomatikAc(); } catch { kasaAcik = false; }
    if (!kasaAcik) { durum.textContent = "Şifreli kasa şu an açılamadı (Notlarım kasasını bir kez aç ya da yeniden giriş yap). Anahtarı yine de bu oturumda kullanabilirsin."; return; }
    const kayit = Kasa.anahtarAl(t.saglayici); kayitli = !!kayit;
    if (kayit) { const c = coz(kayit); if (cozumleyici) { adres.value = c.adres || ""; tur.value = c.tur; } anahtar.value = c.anahtar || ""; bellek = kayit; durum.textContent = "✔ Şifreli kasada kayıtlı anahtarın hazır."; }
    uygula();
  }
  kaydetBtn.addEventListener("click", async () => {
    const v = paketle();
    if (cozumleyici ? !/^https:\/\/[^\s|]+\.[^\s|]+/.test(adres.value.trim()) : !/^gsk_[A-Za-z0-9]{20,120}$/.test(v)) { durum.textContent = cozumleyici ? "Adres https:// ile başlamalı." : "Groq anahtarı gsk_ ile başlar ve boşluk içermez."; return; }
    bellek = v;
    if (sakla.checked && kasaAcik) { try { await Kasa.anahtarKaydet(t.saglayici, v, null); kayitli = true; durum.textContent = "✔ Şifreli kasaya kaydedildi ve kullanılacak."; } catch (h) { durum.textContent = `Kasaya yazılamadı (${h.message}); bu oturumda kullanılacak.`; } }
    else durum.textContent = "✔ Bu oturum için ayarlandı (kasaya kaydedilmedi).";
    uygula();
  });
  silBtn.addEventListener("click", async () => { try { await Kasa.anahtarSil(t.saglayici); } catch (h) { durum.textContent = h.message; return; } kayitli = false; bellek = null; anahtar.value = ""; adres.value = ""; durum.textContent = "Kayıtlı anahtar silindi."; uygula(); });
  supabase.rpc("medya_kota_ayarlari").then(({ data }) => {
    const a = (data || []).find((x) => x.arac === arac); izin = a ? a.kendi_anahtar_izni : true;
    if (!izin) { r2.disabled = true; r1.checked = true; kendiKutu.hidden = true; yaz("site"); durum.textContent = "Kendi anahtarla kullanım Site Sahibi tarafından kapatılmış."; }
  }).catch(() => {});
  kasaHazirla(); uygula();

  return {
    kok,
    kendiMi: () => r2.checked,
    hazirla() {
      if (!r2.checked) return { basliklar: {}, kendi: false };
      const v = bellek || (anahtar.value.trim() ? paketle() : "");
      if (!v) throw new Error(cozumleyici ? "Kendi çözümleyici adresini gir ve “Kullan” de." : "Kendi Groq anahtarını gir ve “Kullan” de (ya da sistem anahtarını seç).");
      const c = coz(v);
      return { kendi: true, basliklar: cozumleyici ? { "X-Cozumleyici-Adresi": c.adres, "X-Cozumleyici-Turu": c.tur, ...(c.anahtar ? { "X-Cozumleyici-Anahtari": c.anahtar } : {}) } : { "X-Groq-Anahtari": c.anahtar } };
    },
    sifirla() { anahtar.value = anahtar.value; },
  };
}
