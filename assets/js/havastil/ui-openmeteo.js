/*
 * ui-openmeteo.js — HavaStil › Ayarlar › "Open-Meteo API & Kota"
 * Herkes: kendi kullanımı + limitleri, kaynak tercihi (otomatik / kendi anahtarım), kendi API anahtarını girme/silme.
 * Site Sahibi + Yönetici: plan (ücretsiz/ticari), plan ve kişi başı limitler, kendi-anahtar izni, "site anahtarı tanımlı" işareti,
 *   herkesin bireysel kullanımı (arama) ve kişiye özel limit. Ticari anahtarın kendisi ASLA burada tutulmaz: Worker secret'ı (OPEN_METEO_API_KEY).
 * CSP: inline stil/işleyici yok.
 */
import { supabase } from "../core/supabase-client.js";
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import {
  omAyar, omTercihOku, omTercihYaz, kendiAnahtarDurumu, kendiAnahtariKaydet, kendiAnahtariSil, omKullanimOzeti,
  omYonetimKaydet, omKullanimTumu, omKullaniciLimitiKaydet, workerSaglik, PENCERE_ADI,
} from "./openmeteo.js";

const PENCERELER = ["dakika", "saat", "gun", "ay"];
const sayi = (v) => (v == null ? "∞" : Number(v).toLocaleString("tr-TR"));
const girdiDegeri = (v) => (v == null ? "" : String(v));
const oku = (g) => (g.value.trim() === "" ? null : Math.max(0, Math.floor(Number(g.value))));

function limitSatiri(baslik, limitler) {
  const girdiler = {};
  const kutu = el("fieldset", { class: "hv-om-limit" }, el("legend", { text: baslik }));
  for (const p of PENCERELER) {
    const g = el("input", { type: "number", min: "0", step: "1", class: "hv-girdi hv-girdi-kucuk", placeholder: "sınırsız", value: girdiDegeri(limitler?.[p]), "aria-label": `${baslik} — ${PENCERE_ADI[p]}` });
    girdiler[p] = g; kutu.append(el("label", {}, el("span", { class: "muted", text: `/${PENCERE_ADI[p]}` }), g));
  }
  return { kutu, deger: () => Object.fromEntries(PENCERELER.map((p) => [p, oku(girdiler[p])])) };
}

function kullanimTablosu(o) {
  const t = el("table", { class: "hv-isi-tablo hv-om-tablo" }, el("caption", { class: "muted", text: "Kullanım (çağrı ağırlığı) / sınır" }),
    el("thead", {}, el("tr", {}, el("th", { text: "" }), ...PENCERELER.map((p) => el("th", { text: PENCERE_ADI[p] })))));
  const satir = (ad, kul, lim) => el("tr", {}, el("th", { scope: "row", text: ad }), ...PENCERELER.map((p) => el("td", { text: `${sayi(kul?.[p] ?? 0)} / ${sayi(lim?.[p])}`, "data-etiket": PENCERE_ADI[p] })));
  t.append(el("tbody", {}, satir("Sen (site kaynağı)", o.ben, o.kullanici_limit), satir("Bu IP (ücretsiz)", o.ip, o.ip_limit), satir("Site (ticari)", o.site, o.site_limit), satir("Kendi anahtarın", o.ben_kendi_anahtar, null)));
  return el("div", { class: "hv-tablo-kap" }, t);
}

export function openMeteoAyarKarti(d, kb) {
  const kok = kart("hv-om-kart", bolumBasligi("🌐 Open-Meteo API & Kota"));
  if (d.vitrin || d.misafir) { kok.append(ipucu("Giriş yaptığında kişisel Open-Meteo kotanı ve API kaynağını burada yönetebilirsin. Misafirler için günlük küçük bir yerel sınır uygulanır.")); return kok; }
  const durum = el("p", { class: "hv-ipucu", role: "status" });
  const kullanimKutu = el("div");
  const tercihKutu = el("div", { class: "hv-om-tercih" });
  const yonetimKutu = el("div");
  kok.append(ipucu("HavaStil'in tüm hava istekleri (radar dâhil) bu kotaya sayılır. Ücretsiz Open-Meteo kotası IP adresi başınadır; farklı IP = ayrı sayaç. İstersen kendi API anahtarını gir: o zaman site kotasına hiç sayılmazsın."), durum, kullanimKutu, tercihKutu, yonetimKutu);

  async function kullanimYukle() {
    try {
      const o = await omKullanimOzeti(); kullanimKutu.replaceChildren(kullanimTablosu(o));
      const a = await omAyar(true);
      durum.textContent = `Plan: ${a.plan === "ticari" ? "ticari" : "ücretsiz"} · etkin kaynak: ${a.aktif_kaynak === "site" ? "site API anahtarı (Worker)" : "ücretsiz Open-Meteo (IP başına)"}${a.migrasyonYok ? " · (kota tabloları kurulu değil: 0121 migration'ı çalıştır)" : ""}.`;
    } catch (h) { durum.textContent = /does not exist|schema cache/i.test(h.message) ? "Kota sistemi henüz kurulmamış (Supabase: 0121_openmeteo_kota_ve_api.sql)." : `Kullanım okunamadı: ${h.message}`; }
  }

  async function tercihCiz() {
    const [a, k] = await Promise.all([omAyar(), kendiAnahtarDurumu(true)]);
    const t = omTercihOku().kaynak;
    const sec = el("select", { class: "hv-girdi", "aria-label": "API kaynağı" },
      el("option", { value: "otomatik", text: "Otomatik (site/ücretsiz kaynağı)" }), el("option", { value: "kendi", text: "Kendi API anahtarımı kullan" }));
    sec.value = t; olay(sec, "change", () => { omTercihYaz(sec.value); durum.textContent = "Kaynak tercihi kaydedildi (bu cihazda)."; kb?.ciz?.(); });
    const girdi = el("input", { type: "password", class: "hv-girdi", placeholder: k.var ? "Kayıtlı anahtarı değiştirmek için yeni anahtar yaz" : "Open-Meteo API anahtarın", autocomplete: "off", spellcheck: "false", "aria-label": "Open-Meteo API anahtarı" });
    const mesaj = el("p", { class: "hv-ipucu", role: "status" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: "Anahtarı şifreli kaydet" }), "click", async () => {
      try { await kendiAnahtariKaydet(girdi.value); girdi.value = ""; mesaj.textContent = "Kaydedildi (şifreli; kimse okuyamaz). Kaynağı “Kendi API anahtarımı kullan” yap."; await tercihCiz(); } catch (h) { mesaj.textContent = h.message; mesaj.classList.add("hv-uyari"); }
    });
    const sil = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Anahtarı sil", disabled: !k.var }), "click", async () => {
      if (!window.confirm("Kayıtlı Open-Meteo anahtarın silinsin mi?")) return;
      try { await kendiAnahtariSil(); omTercihYaz("otomatik"); await tercihCiz(); } catch (h) { mesaj.textContent = h.message; }
    });
    tercihKutu.replaceChildren(
      el("h3", { text: "API kaynağım" }),
      el("label", { class: "hv-om-alan" }, el("span", { class: "muted", text: "Kaynak" }), sec),
      a.kendi_anahtar_izni === false ? el("p", { class: "hv-uyari", text: "Kendi API anahtarı kullanımı yönetici tarafından kapatıldı." }) : el("div", { class: "hv-om-alan" }, girdi, kaydet, sil),
      el("p", { class: "hv-ipucu", text: k.var ? (k.kilitli ? "Kayıtlı anahtar var ama kasa kilitli (kasayı aç)." : "Kayıtlı bir anahtarın var.") : "Kayıtlı anahtar yok. Ticari anahtar için open-meteo.com › Pricing." }), mesaj);
  }

  async function yonetimCiz() {
    let yonetici = false;
    try { const [{ data: a }, { data: o }] = await Promise.all([supabase.rpc("is_admin"), supabase.rpc("is_owner")]); yonetici = !!(a || o); } catch { /* yok say */ }
    if (!yonetici) return;
    const a = await omAyar(true), saglik = await workerSaglik();
    const plan = el("select", { class: "hv-girdi", "aria-label": "Plan" }, el("option", { value: "ucretsiz", text: "Ücretsiz (tarayıcıdan, IP başına)" }), el("option", { value: "ticari", text: "Ticari (site anahtarı, Worker vekili)" }));
    plan.value = a.plan;
    const uc = limitSatiri("Ücretsiz plan sınırı (IP başına)", a.ucretsiz_limit), ti = limitSatiri("Ticari plan sınırı (site toplamı)", a.ticari_limit), ku = limitSatiri("Kişi başı varsayılan sınır", a.kullanici_limit);
    const izin = el("input", { type: "checkbox", checked: a.kendi_anahtar_izni !== false });
    const tanimli = el("input", { type: "checkbox", checked: !!a.site_anahtari_tanimli });
    const not = el("input", { type: "text", class: "hv-girdi", value: a.aciklama || "", placeholder: "Not (örn. plan adı, yenileme tarihi)" });
    const mesaj = el("p", { class: "hv-ipucu", role: "status" });
    const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "Yönetici ayarlarını kaydet" }), "click", async () => {
      try {
        await omYonetimKaydet({ plan: plan.value, ucretsiz_limit: uc.deger(), ticari_limit: ti.deger(), kullanici_limit: ku.deger(), kendi_anahtar_izni: izin.checked, site_anahtari_tanimli: tanimli.checked, aciklama: not.value });
        mesaj.textContent = "Kaydedildi."; mesaj.classList.remove("hv-uyari"); await kullanimYukle(); await tercihCiz();
      } catch (h) { mesaj.textContent = h.message; mesaj.classList.add("hv-uyari"); }
    });
    const workerDurum = saglik ? (saglik.open_meteo_anahtari_var ? "✅ Worker'da OPEN_METEO_API_KEY tanımlı." : "⚠️ Worker'da OPEN_METEO_API_KEY tanımlı DEĞİL (ticari plan için ekle: rehber/04).") : "⚠️ Worker'a ulaşılamadı (yeniden yayınlanmış mı?).";
    const aramaGirdi = el("input", { type: "search", class: "hv-girdi", placeholder: "Üye ara (ad veya e-posta)", "aria-label": "Üye ara" });
    const tabloKutu = el("div", { class: "hv-tablo-kap" });
    async function tabloYukle() {
      tabloKutu.textContent = "Yükleniyor…";
      try {
        const s = await omKullanimTumu(aramaGirdi.value.trim() || null);
        const t = el("table", { class: "hv-isi-tablo hv-om-tablo" }, el("thead", {}, el("tr", {}, ...["Üye", "Rol", "dk", "saat", "gün", "ay", "Kendi anahtarı (ay)", "IP", "Limit (gün)", ""].map((x) => el("th", { text: x })))));
        const g = el("tbody");
        for (const r of s) {
          const duzenle = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "Limit" }), "click", async () => {
            const mevcut = PENCERELER.map((p) => (r.kisiye_ozel_limit?.[p] ?? "")).join(",");
            const gir = window.prompt(`${r.ad} için kişiye özel limit: dakika,saat,gün,ay (boş = varsayılan; ∞ için "-" yaz). Tümünü silmek için boş bırak.`, mevcut);
            if (gir === null) return;
            try {
              const parca = gir.split(",").map((x) => x.trim());
              const nesne = gir.trim() === "" || gir.trim() === ",,," ? null : Object.fromEntries(PENCERELER.map((p, i) => [p, parca[i] === undefined || parca[i] === "" ? undefined : parca[i] === "-" ? null : Math.max(0, Math.floor(Number(parca[i])))]).filter(([, v]) => v !== undefined));
              if (nesne && Object.values(nesne).some((v) => v !== null && !Number.isFinite(v))) throw new Error("Sayı geçersiz.");
              await omKullaniciLimitiKaydet(r.user_id, nesne); await tabloYukle();
            } catch (h) { window.alert(h.message); }
          });
          g.append(el("tr", {}, el("th", { scope: "row", text: `${r.ad} · ${r.eposta_maskeli}` }), el("td", { text: r.rol || "", "data-etiket": "Rol" }), ...[["dakika", "dk"], ["saat", "saat"], ["gun", "gün"], ["ay", "ay"], ["kendi_ay", "Kendi anahtarı (ay)"], ["ip_sayisi", "IP"]].map(([a2, et]) => el("td", { text: sayi(r[a2]), "data-etiket": et })),
            el("td", { text: `${sayi(r.etkin_limit?.gun)}${r.kisiye_ozel_limit ? " *" : ""}`, "data-etiket": "Limit (gün)" }), el("td", {}, duzenle)));
        }
        t.append(g); tabloKutu.replaceChildren(s.length ? t : el("p", { class: "muted", text: "Kayıt yok." }));
      } catch (h) { tabloKutu.textContent = h.message; }
    }
    olay(aramaGirdi, "input", (() => { let z; return () => { clearTimeout(z); z = setTimeout(tabloYukle, 350); }; })());
    yonetimKutu.replaceChildren(el("details", { class: "hv-om-yonetim" },
      el("summary", { text: "🛠️ Yönetici: plan, limitler, herkesin kullanımı" }),
      ipucu("Plan değişince limitler buradan güncellenir; ücretli plan alırsan ticari limitleri o planın değerleriyle doldur (boş = sınırsız). Ticari anahtarı Cloudflare Worker secret'ı olarak ekle (OPEN_METEO_API_KEY); burada anahtar tutulmaz."),
      el("label", { class: "hv-om-alan" }, el("span", { class: "muted", text: "Plan" }), plan), uc.kutu, ti.kutu, ku.kutu,
      el("label", { class: "hv-onay" }, izin, el("span", { text: "Kullanıcılar kendi API anahtarını kullanabilsin" })),
      el("label", { class: "hv-onay" }, tanimli, el("span", { text: "Site (ticari) anahtarı Worker'da tanımlı — işaretle" })),
      el("p", { class: "hv-ipucu", text: workerDurum }), not, kaydet, mesaj,
      el("h3", { text: "Herkesin bireysel kullanımı (bu ay)" }), aramaGirdi, tabloKutu));
    tabloYukle();
  }

  kullanimYukle(); tercihCiz().catch(() => {}); yonetimCiz().catch(() => {});
  return kok;
}
