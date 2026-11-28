/*
 * assets/js/turnstile-yonetim/turnstile-yonetim.js — Kontrol Merkezi › "Turnstile Güvenliği" (yalnızca Site Sahibi + Admin).
 * Veri: public.turnstile_ayarlari (migration 0157). Okuma/yazma YALNIZCA turnstile_ayar_getir / turnstile_ayar_kaydet RPC'leriyle;
 * yetki veritabanında (RLS + SECURITY DEFINER içinde is_owner()/is_admin()) doğrulanır — bu dosya yalnızca arayüzdür.
 * Zamanlama UTC'dir: girilen saat UTC kabul edilir, yanında yerel karşılığı gösterilir. innerHTML YOK, satır içi stil YOK (CSP).
 */
import { supabase } from "../core/supabase-client.js";
import { hata as trHata } from "../core/hata-metni.js";

const KOK_ID = "ts-yonetim-kok";
const MODULLER = [
  ["mod_giris", "Giriş yap"],
  ["mod_kayit", "Kayıt ol"],
  ["mod_sifre_sifirlama", "Şifre sıfırlama"],
  ["mod_dogrulama", "Doğrulama maili / tek kullanımlık kod"],
  ["mod_diger", "Diğer (ör. Notlar parola sınaması)"],
];
const ALAN_ADI = { "kalkan": "Bot Kalkanı", giris: "Giriş", kayit: "Kayıt", sifre_sifirlama: "Şifre sıfırlama", dogrulama: "Doğrulama", diger: "Diğer" };
const SONUC_ADI = { gecti: "geçti", engellendi: "engellendi", hata: "hata" };

function el(t, o = {}, ...cocuklar) {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of cocuklar) if (c != null) e.append(c);
  return e;
}
function surgu(id, etiket, aciklama) {
  const girdi = el("input", { type: "checkbox", id, class: "ui-surgu", "data-ui-sessiz": true, role: "switch" });
  const satir = el("label", { class: "ui-surgu-satir", for: id }, girdi, el("span", {}, el("strong", { text: etiket }), aciklama ? el("small", { class: "muted", text: ` ${aciklama}` }) : null));
  return { girdi, satir };
}
const pad = (n) => String(n).padStart(2, "0");
/** ISO (UTC) → <input type=datetime-local> değeri (UTC bileşenleriyle, tarayıcı saat dilimi UYGULANMAZ). */
function utcYerel(iso) { if (!iso) return ""; const d = new Date(iso); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
/** Geçersiz/boş tarihte hata fırlatmaz. */
function utcMetin(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " "); }
function utcIso(v) { return v ? `${v}:00Z` : null; }
function yerelKarsilik(iso) { try { return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } }
/** "HH:MM" (UTC) → bugünün yerel saat karşılığı. */
function saatYerel(hhmm) { if (!/^\d{2}:\d{2}/.test(hhmm || "")) return ""; const [h, m] = hhmm.split(":").map(Number); const d = new Date(); d.setUTCHours(h, m, 0, 0); return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }); }

async function kur() {
  const kok = document.getElementById(KOK_ID);
  if (!kok || kok.dataset.kuruldu) return;
  kok.dataset.kuruldu = "1";
  kok.replaceChildren(el("p", { class: "muted", text: "Yükleniyor…" }));

  let a;
  try {
    const { data, error } = await supabase.rpc("turnstile_ayar_getir");
    if (error) throw error;
    a = data;
  } catch (h) {
    const yok = /does not exist|42883|PGRST202|schema cache/i.test(String(h?.message || "") + String(h?.code || ""));
    kok.replaceChildren(el("p", { class: "auth-message error", text: yok ? "Bu özellik henüz kurulmamış. Veritabanı güncellemesini (0157) çalıştır." : trHata(h, "Ayarlar okunamadı.") }));
    return;
  }

  const durum = el("div", { class: "auth-message", role: "status", hidden: true });
  const bildir = (m, hataMi = false) => { durum.textContent = m; durum.hidden = !m; durum.className = `auth-message${hataMi ? " error" : ""}`; };

  // --- Şu anki durum özeti
  const ozetKutu = el("p", { class: "muted" });
  const ozetGuncelle = (x) => {
    ozetKutu.textContent = `Şu an: ${x.etkin_simdi ? "Koruma AKTİF" : "Koruma PASİF"} · Sunucu saati (UTC): ${utcMetin(x.sunucu_utc)}` + ` · Bot Kalkanı: ${x.kalkan_acik ? "AÇIK" : "kapalı"}`;
  };
  ozetGuncelle(a);

  // --- Ana şalter + modüller
  const ana = surgu("ts-acik", "Turnstile korumasını aç", "Kapalıysa hiçbir modülde doğrulama istenmez.");
  ana.girdi.checked = !!a.acik;
  const modulSurgu = {};
  const modulKutu = el("div", { class: "ts-moduller" });
  for (const [k, ad] of MODULLER) { const s = surgu(`ts-${k}`, ad); s.girdi.checked = !!a[k]; modulSurgu[k] = s.girdi; modulKutu.append(s.satir); }
  const modulGuncelle = () => { for (const g of Object.values(modulSurgu)) g.disabled = !ana.girdi.checked; };
  ana.girdi.addEventListener("change", modulGuncelle); modulGuncelle();

  // --- Zamanlama (UTC)
  const tur = el("select", { id: "ts-plan-tur", class: "sy-girdi" },
    el("option", { value: "surekli", text: "Süresiz (hep böyle kalsın)" }),
    el("option", { value: "aralik", text: "Belirli tarih-saat aralığında" }),
    el("option", { value: "gunluk", text: "Her gün belirli saatlerde" }));
  tur.value = a.plan_tur;
  const etki = el("select", { id: "ts-plan-etki", class: "sy-girdi" },
    el("option", { value: "aktif", text: "Aralıkta koruma AKTİF olsun (dışında pasif)" }),
    el("option", { value: "pasif", text: "Aralıkta koruma PASİF olsun (dışında aktif)" }));
  etki.value = a.plan_etki;
  const bas = el("input", { type: "datetime-local", id: "ts-plan-bas", class: "sy-girdi", value: utcYerel(a.plan_baslangic) });
  const bit = el("input", { type: "datetime-local", id: "ts-plan-bit", class: "sy-girdi", value: utcYerel(a.plan_bitis) });
  const gBas = el("input", { type: "time", id: "ts-gun-bas", class: "sy-girdi", value: (a.gunluk_baslangic || "").slice(0, 5) });
  const gBit = el("input", { type: "time", id: "ts-gun-bit", class: "sy-girdi", value: (a.gunluk_bitis || "").slice(0, 5) });
  const yerelNot = el("p", { class: "muted", id: "ts-yerel-not" });
  const aralikKutu = el("div", { class: "ts-plan-alan" }, el("label", { for: "ts-plan-bas", text: "Başlangıç (UTC)" }), bas, el("label", { for: "ts-plan-bit", text: "Bitiş (UTC)" }), bit);
  const gunlukKutu = el("div", { class: "ts-plan-alan" }, el("label", { for: "ts-gun-bas", text: "Başlangıç saati (UTC)" }), gBas, el("label", { for: "ts-gun-bit", text: "Bitiş saati (UTC)" }), gBit);
  const planGuncelle = () => {
    aralikKutu.hidden = tur.value !== "aralik"; gunlukKutu.hidden = tur.value !== "gunluk"; etki.disabled = tur.value === "surekli";
    const p = [];
    if (tur.value === "aralik") { if (bas.value) p.push(`Başlangıç: yerel saatinle ${yerelKarsilik(utcIso(bas.value))}`); if (bit.value) p.push(`Bitiş: yerel saatinle ${yerelKarsilik(utcIso(bit.value))}`); }
    if (tur.value === "gunluk") { if (gBas.value) p.push(`Başlangıç: yerel saatinle ${saatYerel(gBas.value)}`); if (gBit.value) p.push(`Bitiş: yerel saatinle ${saatYerel(gBit.value)}`); }
    yerelNot.textContent = p.length ? `${p.join(" · ")} (tüm saatler UTC olarak saklanır)` : "Tüm saatler UTC olarak saklanır ve değerlendirilir.";
  };
  for (const g of [tur, bas, bit, gBas, gBit]) g.addEventListener("input", planGuncelle);
  planGuncelle();

  // --- Ek güvenlik
  const hataModu = el("select", { id: "ts-hata-modu", class: "sy-girdi" },
    el("option", { value: "acik", text: "Geçişe izin ver (Cloudflare'e ulaşılamazsa) — fail-open" }),
    el("option", { value: "kapali", text: "Engelle (Cloudflare'e ulaşılamazsa) — fail-closed" }));
  hataModu.value = a.hata_modu;
  const sure = el("input", { type: "number", id: "ts-dogrulama-dk", class: "sy-girdi", min: "1", max: "1440", step: "1", value: String(a.dogrulama_dk) });

  // --- Bot Kalkanı
  const kalkan = surgu("ts-kalkan", "Bot Kalkanı (tam ekran ön doğrulama)", "Varsayılan KAPALI. Yalnızca olağanüstü bot trafiğinde aç.");
  kalkan.girdi.checked = !!a.kalkan_acik;

  // --- Kaydet
  const kaydet = el("button", { type: "button", id: "ts-kaydet", class: "auth-submit", text: "Kaydet" });
  kaydet.addEventListener("click", async () => {
    if (kalkan.girdi.checked && !a.kalkan_acik && !window.confirm("Bot Kalkanı açılınca tüm ziyaretçiler önce doğrulama ekranını görür. Açılsın mı?")) return;
    const dk = Number(sure.value);
    if (!Number.isInteger(dk) || dk < 1 || dk > 1440) { bildir("Doğrulama süresi 1 ile 1440 dakika arasında olmalı.", true); return; }
    if (tur.value === "aralik" && bas.value && bit.value && bit.value <= bas.value) { bildir("Bitiş, başlangıçtan sonra olmalı.", true); return; }
    if (tur.value === "gunluk" && (!gBas.value || !gBit.value || gBas.value === gBit.value)) { bildir("Günlük plan için farklı bir başlangıç ve bitiş saati gir.", true); return; }
    const p = {
      acik: ana.girdi.checked, plan_tur: tur.value, plan_etki: etki.value,
      plan_baslangic: utcIso(bas.value), plan_bitis: utcIso(bit.value), gunluk_baslangic: gBas.value || null, gunluk_bitis: gBit.value || null,
      hata_modu: hataModu.value, dogrulama_dk: dk, kalkan_acik: kalkan.girdi.checked,
    };
    for (const [k, g] of Object.entries(modulSurgu)) p[k] = g.checked;
    kaydet.disabled = true; kaydet.classList.add("ui-yukleniyor"); bildir("");
    try {
      const { data, error } = await supabase.rpc("turnstile_ayar_kaydet", { p });
      if (error) throw error;
      a = data; ozetGuncelle(a);
      try { localStorage.removeItem("aea_ts_durum_v1"); } catch { /* yok say */ }   // bu tarayıcının önbelleğini hemen tazele
      bildir("Kaydedildi. Ziyaretçilere en geç 5 dakika içinde yansır.");
    } catch (h) { bildir(trHata(h, "Kaydedilemedi."), true); }
    finally { kaydet.disabled = false; kaydet.classList.remove("ui-yukleniyor"); }
  });

  // --- Son doğrulama / engelleme özeti
  const ozetListe = el("div", { class: "ts-ozet" }, el("p", { class: "muted", text: "Yükleniyor…" }));
  async function ozetYukle() {
    try {
      const { data, error } = await supabase.rpc("turnstile_ozet");
      if (error) throw error;
      const satirlar = (data.son7gun || []).map((x) => el("li", { text: `${ALAN_ADI[x.tur] || x.tur}: ${x.adet} ${SONUC_ADI[x.sonuc] || x.sonuc}` }));
      ozetListe.replaceChildren(
        el("p", { text: data.son_olay_zamani ? `Son olay: ${yerelKarsilik(data.son_olay_zamani)} (${data.son_olay_turu || "?"})` : "Henüz kayıtlı doğrulama olayı yok." }),
        satirlar.length ? el("ul", {}, ...satirlar) : el("p", { class: "muted", text: "Son 7 günde olay yok." }));
    } catch (h) { ozetListe.replaceChildren(el("p", { class: "muted", text: trHata(h, "Özet okunamadı.") })); }
  }
  const yenile = el("button", { type: "button", class: "auth-link-btn", text: "Özeti yenile" });
  yenile.addEventListener("click", ozetYukle);

  const bolum = (baslik, ...icerik) => el("details", { class: "ui-cekmece", open: baslik === "Genel" }, el("summary", { text: baslik }), el("div", { class: "ui-cekmece-icerik" }, ...icerik));
  kok.replaceChildren(
    ozetKutu,
    el("p", { class: "muted", text: "Not: Giriş/kayıt doğrulamasını Supabase yapar. Tam kapatmak için Supabase › Authentication › Attack Protection'daki Captcha da kapatılmalıdır." }),
    bolum("Genel", ana.satir, modulKutu),
    bolum("Zamanlama (UTC)", el("label", { for: "ts-plan-tur", text: "Plan" }), tur, el("label", { for: "ts-plan-etki", text: "Etki" }), etki, aralikKutu, gunlukKutu, yerelNot),
    bolum("Ek güvenlik", el("label", { for: "ts-hata-modu", text: "Servise ulaşılamazsa" }), hataModu, el("label", { for: "ts-dogrulama-dk", text: "Bot Kalkanı: doğrulanan tarayıcıya kaç dakika tekrar sorulmasın" }), sure),
    bolum("Bot Kalkanı", kalkan.satir, el("p", { class: "muted", text: "Doğrulama için Worker adresi (_config.yml › turnstile_worker_url) tanımlı olmalı." })),
    bolum("Son durum", ozetListe, yenile),
    el("div", { class: "ts-aksiyon" }, kaydet), durum);
  ozetYukle();
}

kur().catch((h) => console.error("Turnstile paneli kurulamadı:", h));
