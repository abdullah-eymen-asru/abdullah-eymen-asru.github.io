/*
 * assets/js/sistem-durumu/sistem-durumu.js — SİSTEM DURUMU sekmesi (Sistem & Güvenlik): sitenin ve bağımlı servislerin ANLIK durumu.
 * Tüm kontroller TARAYICIDAN doğrudan yapılır → Cloudflare Worker/Pages kotası HARCANMAZ (Worker sınaması yalnızca butonla ve açıkça uyarılır).
 * Kartlar: Supabase (giriş, veritabanı, gecikme) · site/internet · GitHub · Cloudflare · Open-Meteo · RainViewer · jsDelivr (PDF motoru) ·
 *          bu cihaz (çevrimdışı kasa, önbellek, bekleyen işlemler, depolama) · R2 kotası (yalnızca yetkililer).
 * CSP: inline stil/olay yok, innerHTML yok.
 */
import { supabase } from "../core/supabase-client.js";
import { durum as kd, saglikKontrol, kuyrukOzet, kesintiOlay, kesintiOturumu } from "../core/kesinti.js";

const kok = document.getElementById("sd-kok");
const el = (t, oz = {}, ...c) => { const n = document.createElement(t); for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v); } n.append(...c.filter((x) => x != null)); return n; };
const bayt = (n) => { const u = ["B", "KB", "MB", "GB"]; let i = 0, v = Number(n || 0); while (v >= 1024 && i < 3) { v /= 1024; i++; } return `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${u[i]}`; };

async function sonda(url, { ms = 7000, secenek = {}, json = false } = {}) {
  const t0 = performance.now(), kontrol = new AbortController(), z = setTimeout(() => kontrol.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: kontrol.signal, ...secenek });
    return { ok: r.status < 500, durum: r.status, ms: Math.round(performance.now() - t0), veri: json && r.ok ? await r.json().catch(() => null) : null };
  } catch (h) { return { ok: false, durum: 0, ms: Math.round(performance.now() - t0), hata: h?.name === "AbortError" ? "zaman aşımı" : "ulaşılamadı" }; }
  finally { clearTimeout(z); }
}
const sev = (ok, yavasMs, ms) => (!ok ? "hata" : yavasMs && ms > yavasMs ? "uyari" : "ok");
function kart(baslik, seviye, deger, aciklama, ek) {
  return el("article", { class: `sd-kart sd-${seviye}` }, el("h3", {}, el("span", { class: "sd-nokta", "aria-hidden": "true" }), baslik), el("div", { class: "sd-deger", text: deger }), aciklama ? el("p", { text: aciklama }) : null, ek || null);
}
const durumMetni = { ok: "Çalışıyor", yavas: "Yavaş", kesinti: "Kesinti", veritabani: "Veritabanı yanıt vermiyor", giris: "Giriş servisi yanıt vermiyor", cevrimdisi: "İnternet yok", bilinmiyor: "Kontrol ediliyor…" };

async function ciz() {
  if (!kok) return;
  const oturum = (await supabase.auth.getSession()).data?.session;
  const [sb, site, gh, cf, om, rv, jd, surum] = await Promise.all([
    saglikKontrol({ zorla: true }),
    sonda(`/surum.json?_=${Date.now()}`, { json: true }),
    sonda("https://www.githubstatus.com/api/v2/status.json", { json: true }),
    sonda("https://www.cloudflarestatus.com/api/v2/status.json", { json: true }),
    sonda("https://api.open-meteo.com/v1/forecast?latitude=41&longitude=29&current=temperature_2m"),
    sonda("https://api.rainviewer.com/public/weather-maps.json", { json: true }),
    sonda("https://cdn.jsdelivr.net/npm/pdfjs-dist/package.json", { secenek: { method: "HEAD" } }),
    Promise.resolve(null),
  ]);
  void surum;
  const kartlar = [];
  const sbSev = kd.durum === "ok" ? "ok" : kd.durum === "yavas" || kd.durum === "giris" ? "uyari" : "hata";
  kartlar.push(kart("Supabase — giriş (Auth)", sev(kd.auth?.ok, 2500, kd.auth?.ms), kd.auth?.ok ? `Çalışıyor · ${kd.auth.ms} ms` : "Yanıt yok", "Üye girişi, oturum yenileme, şifre sıfırlama."));
  kartlar.push(kart("Supabase — veritabanı (REST)", sev(kd.rest?.ok, 2500, kd.rest?.ms), kd.rest?.ok ? `Çalışıyor · ${kd.rest.ms} ms` : "Yanıt yok", "Panel verileri, kütüphane, notlar, ayarlar."));
  kartlar.push(kart("Bu sitenin kendisi", sev(site.ok, 2500, site.ms), site.ok ? `Ulaşılabilir · ${site.ms} ms` : "Ulaşılamıyor", site.veri?.surum || site.veri?.version ? `Sürüm: ${site.veri.surum || site.veri.version}` : "Statik dosya sunumu (GitHub Pages / Cloudflare Pages)."));
  const stDurum = (r) => r.veri?.status?.description || (r.ok ? "Ulaşılabilir" : "Ulaşılamıyor");
  const stSev = (r) => (!r.ok ? "yok" : r.veri?.status?.indicator === "none" || !r.veri ? "ok" : r.veri.status.indicator === "minor" ? "uyari" : "hata");
  kartlar.push(kart("GitHub (içerik deposu / Pages)", stSev(gh), stDurum(gh), "Resmî durum sayfasından (githubstatus.com)."));
  kartlar.push(kart("Cloudflare (Workers / R2 / DNS)", stSev(cf), stDurum(cf), "Resmî durum sayfasından (cloudflarestatus.com)."));
  kartlar.push(kart("Open-Meteo (HavaStil tahminleri)", sev(om.ok, 3000, om.ms), om.ok ? `Çalışıyor · ${om.ms} ms` : "Ulaşılamıyor", "Saatlik tahmin ve ızgara verisi."));
  const kareSay = rv.veri?.radar?.past?.length;
  kartlar.push(kart("RainViewer (canlı radar)", sev(rv.ok && kareSay, 4000, rv.ms), rv.ok ? `${kareSay || 0} radar karesi · ${rv.ms} ms` : "Ulaşılamıyor", rv.veri?.generated ? `Veri üretimi: ${new Date(rv.veri.generated * 1000).toLocaleTimeString("tr-TR")} (${Math.max(0, Math.round((Date.now() / 1000 - rv.veri.generated) / 60))} dk önce)` : "Radar (geçmiş ~2 saat)."));
  kartlar.push(kart("jsDelivr (PDF okuyucu motoru)", sev(jd.ok, 3000, jd.ms), jd.ok ? `Çalışıyor · ${jd.ms} ms` : "Ulaşılamıyor", "PDF.js bu CDN'den yüklenir; kapalıysa okuyucu açılmayabilir."));

  /* cihaz */
  const n = (await kuyrukOzet().catch(() => [])).length;
  let kota = "—";
  try { const e = await navigator.storage?.estimate?.(); if (e?.quota) kota = `${bayt(e.usage)} / ${bayt(e.quota)}`; } catch { /* yok say */ }
  const cihaz = [
    kart("Oturum", oturum ? "ok" : "uyari", kesintiOturumu() ? "Kısıtlı (çevrimdışı) oturum" : oturum ? "Açık" : "Kapalı", oturum?.user?.email || ""),
    kart("Çevrimdışı giriş kasası", kd.kasaVar ? "ok" : "yok", kd.kasaVar ? "Bu cihazda hazır" : "Kapalı / yok", "Girişte “Sunucu kesintisinde bu cihazdan girebileyim” işaretliyse parolanla şifreli oluşturulur (2FA'lı hesapta oluşturulmaz)."),
    kart("Bekleyen işlemler", n ? "uyari" : "ok", n ? `${n} işlem sunucuya gönderilmeyi bekliyor` : "Yok", n ? "Sağ alttaki “bekleyen işlem” düğmesinden incele / gönder." : "Sunucuya ulaşılamadığında yapılan değişiklikler burada bekletilir."),
    kart("Tarayıcı depolaması", "ok", kota, "Önbellek ve kuyruk burada (IndexedDB) şifreli tutulur."),
  ];
  const ozet = el("section", { class: `sd-ozet sd-${sbSev}` }, el("h2", {}, el("span", { class: "sd-nokta", "aria-hidden": "true" }), `Supabase: ${durumMetni[kd.durum] || kd.durum}`),
    el("div", { class: "sd-eylemler" }));
  const yenile = el("button", { type: "button", class: "sd-btn" }, "⟳ Şimdi yeniden kontrol et");
  yenile.addEventListener("click", () => { yenile.disabled = true; yenile.textContent = "Kontrol ediliyor…"; ciz(); });
  const durak = el("a", { class: "sd-btn", href: "https://status.supabase.com", target: "_blank", rel: "noopener noreferrer" }, "Supabase resmî durum sayfası ↗");
  ozet.querySelector(".sd-eylemler").append(yenile, durak);
  const alt = el("p", { class: "kst-alt", text: `Son kontrol: ${new Date().toLocaleTimeString("tr-TR")}. Tüm kontroller doğrudan tarayıcından yapılır; Cloudflare kotası harcanmaz. Sayfa açıkken 60 sn'de bir otomatik yenilenir.` });

  const r2Yer = el("div", { hidden: true });
  const workerKutu = el("div", { class: "sd-kart" }, el("h3", { text: "Cloudflare Worker'lar" }), el("p", { text: "Worker sınaması her Worker için 1 istek harcar (günlük 100.000 kotanın binde biri). Yalnızca ihtiyaç olunca çalıştır." }));
  const sinaBtn = el("button", { type: "button", class: "sd-btn" }, "Worker'ları sına");
  const sinaSonuc = el("ul", { class: "sd-liste" });
  sinaBtn.addEventListener("click", async () => {
    sinaBtn.disabled = true; sinaSonuc.replaceChildren(el("li", { text: "Sınanıyor…" }));
    try {
      const { data } = await supabase.from("worker_anahtarlari").select("ad, acik");
      const liste = (data || []).filter((w) => w.acik !== false && /^[a-z0-9-]+$/.test(w.ad));
      const sonuc = await Promise.all(liste.map(async (w) => ({ ad: w.ad, r: await sonda(`https://${w.ad}.aeymena.workers.dev/saglik`, { ms: 6000 }) })));
      const kapali = (data || []).filter((w) => w.acik === false).map((w) => `${w.ad}: panelden kapatılmış`);
      sinaSonuc.replaceChildren(...sonuc.map((x) => el("li", { text: `${x.ad}: ${x.r.durum ? (x.r.ok ? "yanıt veriyor" : `HTTP ${x.r.durum}`) : x.r.hata} (${x.r.ms} ms)` })), ...kapali.map((t) => el("li", { text: t })));
      if (!sonuc.length && !kapali.length) sinaSonuc.replaceChildren(el("li", { text: "Liste okunamadı." }));
    } catch (h) { sinaSonuc.replaceChildren(el("li", { text: `Hata: ${h.message}` })); }
    sinaBtn.disabled = false;
  });
  workerKutu.append(sinaBtn, sinaSonuc);

  kok.replaceChildren(ozet,
    el("h3", { class: "sd-bolum-baslik", text: "Çekirdek servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(0, 3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bağımlı dış servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bu cihaz" }), el("div", { class: "sd-izgara" }, ...cihaz),
    el("h3", { class: "sd-bolum-baslik", text: "Kotalar & Worker'lar (yetkililere)" }), r2Yer, workerKutu, alt);
  import("../sistem-yedek/r2-kota.js").then((m) => m.r2KotaKartiKur(r2Yer, { baslik: "R2 kullanımı (bu ay) — tüm kovalar" })).catch(() => {});
}

let zaman = null;
function planla() { clearTimeout(zaman); zaman = setTimeout(async () => { if (!document.hidden && kok && kok.offsetParent !== null) await ciz().catch(() => {}); planla(); }, 60000); }
ciz().catch((h) => { if (kok) kok.textContent = `Durum okunamadı: ${h.message}`; });
planla();
kesintiOlay("kesinti-durum", () => { /* sonraki turda tazelenir */ });
