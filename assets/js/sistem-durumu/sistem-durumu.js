/*
 * assets/js/sistem-durumu/sistem-durumu.js — SİSTEM DURUMU sekmesi (Sistem & Güvenlik): sitenin ve bağımlı servislerin ANLIK durumu.
 * Tüm kontroller TARAYICIDAN doğrudan yapılır → Cloudflare Worker/Pages kotası HARCANMAZ (Worker sınaması yalnızca butonla ve açıkça uyarılır).
 * Kartlar: Supabase (giriş, veritabanı, gecikme) · site/internet · GitHub · Cloudflare · Open-Meteo · RainViewer · jsDelivr (PDF motoru) ·
 *          bu cihaz (çevrimdışı kasa, önbellek, bekleyen işlemler, depolama) · R2 kotası (yalnızca yetkililer).
 * CSP: inline stil/olay yok, innerHTML yok.
 */
import { supabase } from "../core/supabase-client.js";
import { durum as kd, saglikKontrol, kuyrukOzet, kuyrukTemizle, kesintiOlay, kesintiOturumu, depoOzeti, onbellekTemizle, kasaOlustur, kasaSil, kasaVarMi } from "../core/kesinti.js";

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


/* ------------------- BU CİHAZDAKİ VERİLER: önbellek sil · çevrimdışı giriş kasasını aç/kapat · kuyruk ------------------- */
async function cihazVerileriKarti(oturum) {
  const kap = el("section", { class: "sd-kart sd-cihaz-veri" }, el("h3", { text: "Bu cihazdaki veriler (tarayıcı hafızası)" }));
  const mesaj = el("p", { class: "kst-alt", role: "status" });
  const govde = el("div", { class: "sd-cihaz-satirlar" });
  const eposta = oturum?.user?.email || "", uid = oturum?.user?.id || "";
  const satir = (baslik, aciklama, ...kontroller) => el("div", { class: "sd-cihaz-satir" }, el("div", {}, el("strong", { text: baslik }), el("p", { class: "muted", text: aciklama })), el("div", { class: "sd-eylemler" }, ...kontroller));
  const dugme = (metin, fn, tehlike = false) => { const b = el("button", { type: "button", class: tehlike ? "sd-btn sd-btn-tehlike" : "sd-btn", text: metin }); b.addEventListener("click", async () => { b.disabled = true; try { await fn(); } catch (h) { mesaj.textContent = `Hata: ${h.message}`; } b.disabled = false; await yukle(); }); return b; };
  async function yukle() {
    const o = await depoOzeti(); const kasa = eposta ? await kasaVarMi(eposta) : false;
    const parola = el("input", { type: "password", class: "sd-girdi", placeholder: "Hesap parolan", autocomplete: "current-password", "aria-label": "Parola" });
    govde.replaceChildren(
      satir("Okuma önbelleği", `${o.onbellek} kayıt. Sunucuya ulaşılamazken son görülen verileri göstermek için şifreli tutulur. Silmek güvenlidir: siteyi kullanmayı etkilemez, veriler yeniden sunucudan okunur.`,
        dugme("Önbelleği sil", async () => { await onbellekTemizle(); mesaj.textContent = "Önbellek silindi."; })),
      satir("Çevrimdışı giriş (bu cihazdan girebileyim)", kasa ? "AÇIK: sunucu kesilirse bu cihazdan e-posta + parolanla kısıtlı moda girebilirsin. Kapatırsan bu cihazdaki giriş kasası silinir (hesabın etkilenmez)." : "KAPALI: sunucu kesilirse bu cihazdan giriş yapılamaz. Açmak için parolanı doğrula; kasa parolanla şifrelenir.",
        ...(kasa ? [dugme("Kapat ve kasayı sil", async () => { await kasaSil(eposta); mesaj.textContent = "Çevrimdışı giriş kapatıldı."; }, true)]
          : eposta ? [parola, dugme("Aç", async () => {
            if (!parola.value) throw new Error("Parolanı yaz.");
            const { error } = await supabase.auth.signInWithPassword({ email: eposta, password: parola.value });
            if (error) throw new Error("Parola doğrulanamadı.");
            const ok = await kasaOlustur({ eposta, parola: parola.value, uid }); mesaj.textContent = ok ? "Çevrimdışı giriş açıldı." : "Kasa oluşturulamadı (tarayıcı şifrelemeyi desteklemiyor olabilir).";
          })] : [])),
      satir("Bekleyen işlemler", o.kuyruk ? `${o.kuyruk} işlem sunucuya gönderilmeyi bekliyor. Silersen bu değişiklikler KAYBOLUR.` : "Bekleyen işlem yok.", ...(o.kuyruk ? [dugme("Kuyruğu sil", async () => { if (!window.confirm("Bekleyen işlemler kalıcı olarak silinsin mi? Gönderilmemiş değişiklikler kaybolur.")) return; await kuyrukTemizle(); mesaj.textContent = "Kuyruk silindi."; }, true)] : [])),
    );
  }
  kap.append(govde, mesaj); await yukle(); return kap;
}

async function ciz() {
  if (!kok) return;
  const oturum = (await supabase.auth.getSession()).data?.session;
  const [sb, site, gh, cf, om, rv, jd, surum] = await Promise.all([
    saglikKontrol({ zorla: true }),
    sonda(`/surum.json?_=${Date.now()}`, { json: true }),
    sonda("https://www.githubstatus.com/api/v2/summary.json", { json: true }),
    sonda("https://www.cloudflarestatus.com/api/v2/summary.json", { json: true }),
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
  /* Resmî durum sayfaları (Atlassian Statuspage) → yalnızca BU SİTENİN kullandığı bileşenlere göre durum. Genel gösterge ("Partial System Outage")
   * dünyadaki herhangi bir veri merkezinin sorununu da yansıttığı için sürekli yanlış alarm veriyordu. */
  const BILESEN_DURUM = { operational: "Çalışıyor", degraded_performance: "Yavaş / kısmen bozuk", partial_outage: "Kısmi kesinti", major_outage: "Büyük kesinti", under_maintenance: "Bakımda" };
  const BILESEN_SEV = { operational: 0, under_maintenance: 1, degraded_performance: 1, partial_outage: 2, major_outage: 3 };
  const baglanti = (url, metin) => el("a", { class: "sd-btn", href: url, target: "_blank", rel: "noopener noreferrer", text: `${metin} ↗` });
  function durumKarti(baslik, r, ilgili, sayfaUrl, aciklama) {
    if (!r.ok || !r.veri?.components) return kart(baslik, "hata", "Durum sayfasına ulaşılamadı", "Bu kontrol tarayıcından yapılır; ağ ya da reklam/gizlilik engelleyici durum sayfasını engelliyor olabilir.", el("div", { class: "sd-eylemler" }, baglanti(sayfaUrl, "Resmî durum sayfasını aç")));
    const bilesenler = r.veri.components.filter((c) => !c.group && ilgili.test(c.name));
    const secili = bilesenler.length ? bilesenler : r.veri.components.filter((c) => !c.group);
    const kotu = secili.filter((c) => c.status !== "operational");
    const enKotu = Math.max(0, ...secili.map((c) => BILESEN_SEV[c.status] ?? 0));
    const olaylar = (r.veri.incidents || []).filter((o) => o.status !== "resolved" && o.status !== "postmortem" && ((o.components || []).some((c) => ilgili.test(c.name)) || ilgili.test(o.name)));   // yalnızca bizi ilgilendiren olaylar
    const sevi = enKotu >= 2 ? "hata" : enKotu === 1 || olaylar.length ? "uyari" : "ok";
    const deger = enKotu === 0 && !olaylar.length ? `Kullandığımız ${secili.length} bileşen çalışıyor` : kotu.length ? `${kotu.length} bileşende sorun` : `${olaylar.length} açık olay`;
    const ek = el("div", { class: "sd-detay" });
    if (kotu.length) ek.append(el("ul", { class: "sd-liste" }, ...kotu.map((c) => el("li", { text: `${c.name}: ${BILESEN_DURUM[c.status] || c.status}` }))));
    if (olaylar.length) ek.append(el("ul", { class: "sd-liste" }, ...olaylar.slice(0, 4).map((o) => el("li", {}, el("a", { href: o.shortlink || sayfaUrl, target: "_blank", rel: "noopener noreferrer", text: `${o.name} (${o.status})` })))));
    ek.append(el("p", { class: "muted", text: `Genel durum (tüm dünya, ilgisiz veri merkezleri dahil): ${r.veri.status?.description || "—"}.` }), el("div", { class: "sd-eylemler" }, baglanti(sayfaUrl, "Resmî durum sayfası")));
    return kart(baslik, sevi, deger, aciklama, ek);
  }
  kartlar.push(durumKarti("GitHub (içerik deposu / Pages)", gh, /pages|git operations|api requests|actions|webhooks/i, "https://www.githubstatus.com", "Yalnızca Pages, Git, API ve Actions bileşenleri sayılır."));
  kartlar.push(durumKarti("Cloudflare (Workers / R2 / Pages / DNS)", cf, /workers|r2|pages|dns|cdn|sites and services|api|dashboard/i, "https://www.cloudflarestatus.com", "Yalnızca Workers, R2, Pages, DNS ve CDN bileşenleri sayılır; tek bir veri merkezindeki yerel sorun alarm vermez."));
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
  /* Worker sınaması (kota koruması): admin ve site sahibi HER ZAMAN kullanır (düğmeye bağlı değil). Diğer üyeler yalnızca Yetki Ayarları › "Sistem Durumu: Worker sınaması"
   * anahtarı kendi rolleri için AÇILMIŞSA (varsayılan KAPALI). Sınama yalnızca düğmeye basılınca çalışır; kendiliğinden hiç istek atılmaz. */
  let rol = null;
  try { const uid = oturum?.user?.id; if (uid) rol = (await supabase.from("profiles").select("role").eq("id", uid).maybeSingle()).data?.role || null; } catch { /* yok say */ }
  const yonetici = rol === "admin" || rol === "owner";
  let workerIzin = yonetici;
  if (!yonetici && rol) { try { const { data } = await supabase.rpc("ozellik_erisimi_var_mi", { p_ozellik: "sistem_durumu_worker", p_rol: rol }); workerIzin = data === true; } catch { workerIzin = false; } }
  workerKutu.append(sinaBtn, sinaSonuc);

  kok.replaceChildren(ozet,
    el("h3", { class: "sd-bolum-baslik", text: "Çekirdek servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(0, 3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bağımlı dış servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bu cihaz" }), el("div", { class: "sd-izgara" }, ...cihaz), await cihazVerileriKarti(oturum),
    ...(yonetici || workerIzin ? [el("h3", { class: "sd-bolum-baslik", text: yonetici ? "Kotalar & Worker'lar" : "Worker sınaması" }), ...(yonetici ? [r2Yer] : []), workerKutu]
      : [el("p", { class: "kst-alt", text: "Cloudflare Worker sınaması sistem kotasını harcadığı için varsayılan olarak yalnızca yönetici ve site sahibine açıktır; site sahibi Yetki Ayarları'ndan rolüne açabilir. Yukarıdaki kontroller herkes için ücretsizdir." })]), alt);
  if (yonetici) import("../r2-arsiv/depolama.js").then((m) => m.depolamaGostergesiKur(r2Yer, { esitle: false, sahip: rol === "owner" })).catch(() => {});
  if (yonetici) import("../sistem-yedek/r2-kota.js").then((m) => m.r2KotaKartiKur(r2Yer, { baslik: "R2 kullanımı (bu ay) — tüm kovalar" })).catch(() => {});
}

let zaman = null;
function planla() { clearTimeout(zaman); zaman = setTimeout(async () => { if (!document.hidden && kok && kok.offsetParent !== null) await ciz().catch(() => {}); planla(); }, 60000); }
ciz().catch((h) => { if (kok) kok.textContent = `Durum okunamadı: ${h.message}`; });
planla();
kesintiOlay("kesinti-durum", () => { /* sonraki turda tazelenir */ });
