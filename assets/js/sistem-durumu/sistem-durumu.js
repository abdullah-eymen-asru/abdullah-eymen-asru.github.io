/*
 * assets/js/sistem-durumu/sistem-durumu.js — SİSTEM DURUMU sekmesi (Sistem & Güvenlik): sitenin ve bağımlı servislerin ANLIK durumu.
 * Tüm kontroller TARAYICIDAN doğrudan yapılır → Cloudflare Worker/Pages kotası HARCANMAZ (Worker sınaması yalnızca butonla ve açıkça uyarılır).
 * Kartlar: Supabase (giriş, veritabanı, gecikme) · site/internet · GitHub · Cloudflare · Open-Meteo · RainViewer · jsDelivr (PDF motoru) ·
 *          bu cihaz (çevrimdışı kasa, önbellek, bekleyen işlemler, depolama) · R2 kotası (yalnızca yetkililer).
 * CSP: inline stil/olay yok, innerHTML yok.
 */
import { supabase } from "../core/supabase-client.js";
import { workerJson } from "../sistem-yedek/ortak.js";
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
/* Oturum içi ölçüm geçmişi (bellekte; sayfa kapanınca silinir): "bir an yavaşladı mı, sürekli mi?" sorusuna cevap verir. */
const gecmis = {};
function gecmisEkle(ad, ok, ms) { const g = (gecmis[ad] ||= []); g.push({ ok, ms }); if (g.length > 20) g.shift(); }
function gecmisYazi(ad) {
  const g = gecmis[ad]; if (!g || g.length < 2) return "";
  const basarili = g.filter((x) => x.ok), ort = basarili.length ? Math.round(basarili.reduce((a, x) => a + x.ms, 0) / basarili.length) : 0;
  return `Bu oturumda ${g.length} ölçüm: ${g.length - basarili.length} başarısız · ort. ${ort} ms · en yavaş ${Math.max(0, ...basarili.map((x) => x.ms))} ms`;
}
const sev = (ok, yavasMs, ms) => (!ok ? "hata" : yavasMs && ms > yavasMs ? "uyari" : "ok");
function kart(baslik, seviye, deger, aciklama, ek, oneri, gecmisAd) {
  const gy = gecmisAd ? gecmisYazi(gecmisAd) : "";
  return el("article", { class: `sd-kart sd-${seviye}` }, el("h3", {}, el("span", { class: "sd-nokta", "aria-hidden": "true" }), baslik), el("div", { class: "sd-deger", text: deger }), aciklama ? el("p", { text: aciklama }) : null,
    gy ? el("p", { class: "muted sd-gecmis", text: gy }) : null,
    seviye !== "ok" && seviye !== "yok" && oneri ? el("p", { class: "sd-oneri" }, el("strong", { text: "Ne yapmalı? " }), oneri) : null, ek || null);
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

let kalici = null;   // Worker/Render sınama kutuları ve rehber: 60 sn'lik yenilemede SIFIRLANMAZ (sonuçlar kaybolmasın)

async function kaliciKur(oturum) {
  const r2Yer = el("div", { hidden: true });
  let rol = null;
  try { const uid = oturum?.user?.id; if (uid) rol = (await supabase.from("profiles").select("role").eq("id", uid).maybeSingle()).data?.role || null; } catch { /* yok say */ }
  const yonetici = rol === "admin" || rol === "owner";
  let workerIzin = yonetici;
  if (!yonetici && rol) { try { const { data } = await supabase.rpc("ozellik_erisimi_var_mi", { p_ozellik: "sistem_durumu_worker", p_rol: rol }); workerIzin = data === true; } catch { workerIzin = false; } }

  /* ---- Cloudflare Worker'lar: sınama (yalnızca düğmeyle) + bugünkü (UTC) kullanım / günlük sert sınır ---- */
  const workerKutu = el("div", { class: "sd-kart" }, el("h3", { text: "Cloudflare Worker'lar" }),
    el("p", { text: "Sınama her Worker için 1 istek harcar (günlük 100.000 kotanın binde biri). Yalnızca ihtiyaç olunca çalıştır. Bugünkü kullanım Cloudflare Analytics'ten gelir (1–3 dk gecikmeli)." }));
  const sinaBtn = el("button", { type: "button", class: "sd-btn" }, "Worker'ları sına");
  const sinaSonuc = el("ul", { class: "sd-liste" });
  sinaBtn.addEventListener("click", async () => {
    sinaBtn.disabled = true; sinaSonuc.replaceChildren(el("li", { text: "Sınanıyor…" }));
    try {
      let { data, error } = await supabase.from("worker_anahtarlari").select("ad, etiket, acik, tur, gunluk_limit");
      if (error) ({ data } = await supabase.from("worker_anahtarlari").select("ad, etiket, acik, tur"));
      const hepsi = data || [];
      const kullanim = await workerJson("/worker-limit/kullanim").then((k) => k?.kullanim || null).catch(() => null);
      const liste = hepsi.filter((w) => w.acik !== false && w.tur === "worker" && /^[a-z0-9-]+$/.test(w.ad));
      const sonuc = await Promise.all(liste.map(async (w) => { const r = await sonda(`https://${w.ad}.aeymena.workers.dev/saglik`, { ms: 6000 }); gecmisEkle(`worker:${w.ad}`, r.ok, r.ms); return { w, r }; }));
      const satir = (w, metin, seviye) => el("li", {}, el("span", { class: `sd-rozet-m sd-rozet-${seviye}`, text: seviye === "ok" ? "✓" : seviye === "uyari" ? "!" : "✕" }), ` ${w.etiket || w.ad} — ${metin}`);
      const gunluk = (w) => { const kul = kullanim ? (kullanim[w.ad] || 0) : null; if (kul == null) return ""; return w.gunluk_limit ? ` · bugün ${kul.toLocaleString("tr-TR")} / ${w.gunluk_limit.toLocaleString("tr-TR")} (${Math.max(w.gunluk_limit - kul, 0).toLocaleString("tr-TR")} hak kaldı)` : ` · bugün ${kul.toLocaleString("tr-TR")} istek`; };
      const satirlar = sonuc.map(({ w, r }) => {
        const kul = kullanim ? (kullanim[w.ad] || 0) : null, doldu = w.gunluk_limit && kul != null && kul >= w.gunluk_limit;
        if (doldu) return satir(w, `günlük sınır doldu${gunluk(w)}; workers.dev adresi bilerek kesilmiş olabilir (UTC 00:00'da ya da sınır yükselince açılır)`, "uyari");
        if (!r.durum) return satir(w, `ulaşılamadı (${r.hata}, ${r.ms} ms) — Cloudflare kesintisi, sert kapatma ya da silinmiş Worker olabilir${gunluk(w)}`, "hata");
        if (!r.ok) return satir(w, `HTTP ${r.durum} (${r.ms} ms)${gunluk(w)}`, "hata");
        return satir(w, `yanıt veriyor · ${r.ms} ms${r.ms > 3000 ? " (yavaş)" : ""}${gunluk(w)}`, r.ms > 3000 ? "uyari" : "ok");
      });
      const kapali = hepsi.filter((w) => w.acik === false).map((w) => satir(w, "panelden KAPATILMIŞ (sınanmadı)", "uyari"));
      const gy = sonuc.map(({ w }) => gecmisYazi(`worker:${w.ad}`) && `${w.ad}: ${gecmisYazi(`worker:${w.ad}`)}`).filter(Boolean);
      sinaSonuc.replaceChildren(...satirlar, ...kapali, ...(gy.length ? [el("li", { class: "muted", text: gy.join(" | ") })] : []));
      if (!satirlar.length && !kapali.length) sinaSonuc.replaceChildren(el("li", { text: "Liste okunamadı." }));
    } catch (h) { sinaSonuc.replaceChildren(el("li", { text: `Hata: ${h.message}` })); }
    sinaBtn.disabled = false;
  });
  workerKutu.append(sinaBtn, sinaSonuc);

  /* ---- Render.com (kendi servislerim): yalnızca düğmeyle — ücretsiz servis uykuda ise uyandırır (30–60 sn) ve ücretsiz saatten yer ---- */
  const renderKutu = el("div", { class: "sd-kart" }, el("h3", { text: "Render.com — benim servislerim" }),
    el("p", { text: "Render platformunun genel durumu yukarıdaki kartta kendiliğinden izlenir. Aşağıdaki sınama KENDİ servislerini (Cobalt, yt-dlp, LibreOffice) gerçekten çağırır; ücretsiz Render servisi uykudaysa uyandırır (30–60 sn) ve aylık 750 ücretsiz saatten harcar — bu yüzden otomatik değil, yalnızca düğmeyle çalışır. Uykudan uyanma kesinti sayılmaz." }));
  const rBtn = el("button", { type: "button", class: "sd-btn" }, "Render servislerimi sına");
  const rSonuc = el("ul", { class: "sd-liste" });
  const SON = "aea_sd_render_v1";
  const rYaz = (ad, v) => {
    if (!v || v.yapilandirildi === false) return el("li", { text: `➖ ${ad}: Worker'da adres tanımlı değil (rehber 4.13 / 4.14).` });
    if (!v.ulasilabilir) return el("li", { text: `❌ ${ad}: ulaşılamadı (${v.neden || "bilinmiyor"}, ${v.ms} ms). Render panelinde servis "Failed/Suspended" mı bak; Logs sekmesini oku.` });
    const ek = [];
    if (v.surum) ek.push(`sürüm ${v.surum}`);
    if ("deno" in v) ek.push(`deno ${v.deno ? "✓" : "✗ (YouTube çalışmaz → Dockerfile'ı yeniden dağıt)"}`);
    if ("ffmpeg" in v) ek.push(`ffmpeg ${v.ffmpeg ? "✓" : "✗ (ses çıkarma çalışmaz)"}`);
    if ("soffice" in v) ek.push(`LibreOffice ${v.soffice ? "✓" : "✗ (sunucuda belge dönüşümü çalışmaz)"}`);
    if (v.auth_sorunu) ek.push("⚠ kimlik doğrulama sorunu: Cobalt API_AUTH_REQUIRED=1 ama geçerli anahtar yok (rehber 4.13)");
    else if ("auth_sorunu" in v) ek.push("kimlik doğrulama sorunu yok");
    if (v.test_kodu) ek.push(`deneme yanıtı: ${v.test_kodu}`);
    const kotu = v.auth_sorunu || v.deno === false || v.ffmpeg === false || v.soffice === false;
    return el("li", { text: `${kotu ? "⚠" : "✅"} ${ad}: yanıt veriyor · ${v.ms} ms${v.ms > 8000 ? " (uykudan uyanmış)" : ""} · ${ek.join(" · ")}` });
  };
  function rCiz(j, zaman, eski) {
    rSonuc.replaceChildren(
      ...(rol === "owner" ? [rYaz("Cobalt çözümleyici", j.cobalt), rYaz("yt-dlp servisi", j.ytdlp)] : [el("li", { class: "muted", text: "Cobalt/yt-dlp ayrıntısı yalnızca Site Sahibi'ne gösterilir." })]),
      rYaz("Belge dönüştürme (LibreOffice)", j.belge),
      el("li", { class: "muted", text: `${eski ? "Son sınama (kayıtlı): " : "Kontrol: "}${new Date(zaman).toLocaleString("tr-TR")}` }));
  }
  try { const k = JSON.parse(localStorage.getItem(SON) || "null"); if (k?.j && k?.z) rCiz(k.j, k.z, true); } catch { /* yok say */ }
  rBtn.addEventListener("click", async () => {
    if (!yonetici) { rSonuc.replaceChildren(el("li", { text: "Bu sınama yalnızca Admin ve Site Sahibi içindir." })); return; }   // arayüz + Worker (sunucu) ikisi de denetler
    rBtn.disabled = true; rBtn.textContent = "Sınanıyor… (60 sn'ye kadar sürebilir)"; rSonuc.replaceChildren(el("li", { text: "Servisler uyandırılıyor…" }));
    const jeton = (await supabase.auth.getSession()).data?.session?.access_token;
    const cagri = async (url) => {
      const t0 = performance.now();
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${jeton}` }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(110000) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) return { hata: j?.hata || j?.error || `HTTP ${r.status}` };
        return j;
      } catch (h) { return { hata: h.name === "TimeoutError" ? "zaman aşımı" : "ulaşılamadı", ms: Math.round(performance.now() - t0) }; }
    };
    const [m, b] = await Promise.all([rol === "owner" ? cagri("https://medya-indirici-worker.aeymena.workers.dev/saglik") : Promise.resolve(null), cagri("https://belge-donusturucu-worker.aeymena.workers.dev/saglik")]);
    const j = { cobalt: m?.cobalt || (m?.hata ? { yapilandirildi: true, ulasilabilir: false, neden: m.hata, ms: m.ms || 0 } : null), ytdlp: m?.ytdlp || null,
      belge: b?.hata ? { yapilandirildi: true, ulasilabilir: false, neden: b.hata, ms: b.ms || 0 } : b };
    const zaman = new Date().toISOString();
    for (const [ad, v] of [["cobalt", j.cobalt], ["ytdlp", j.ytdlp], ["belge", j.belge]]) if (v && v.yapilandirildi !== false) gecmisEkle(`render:${ad}`, !!v.ulasilabilir, v.ms || 0);
    rCiz(j, zaman, false);
    try { localStorage.setItem(SON, JSON.stringify({ j, z: zaman })); } catch { /* yok say */ }
    rBtn.disabled = false; rBtn.textContent = "Render servislerimi sına";
  });
  renderKutu.append(rBtn, rSonuc);

  /* ---- Kesinti olursa ne yapmalıyım? (bileşen bileşen) ---- */
  const rehberSatir = (baslik, ...adimlar) => el("details", { class: "sd-rehber" }, el("summary", { text: baslik }), el("ol", { class: "sd-liste" }, ...adimlar.map((a) => el("li", { text: a }))));
  const kesintiRehberi = el("section", { class: "sd-kart" }, el("h3", { text: "Kesinti olursa ne yapmalıyım?" }),
    el("p", { class: "muted", text: "Önce yukarıdaki kartlara bak: hangisi kırmızı/sarıysa aşağıdaki ilgili maddeyi aç." }),
    rehberSatir("Supabase (giriş/veritabanı) kırmızı",
      "status.supabase.com'a bak. Resmî kesintiyse bekle: site okuma önbelleğiyle ve (açıksa) çevrimdışı girişle kısıtlı çalışır, yaptığın değişiklikler kuyruğa alınır ve bağlantı gelince gönderilir.",
      "Resmî kesinti yoksa Supabase panelinde projenin 'Paused' (ücretsiz plan 7 gün hareketsizlikte uyutur) olup olmadığına bak → Restore project.",
      "Sürekli 'JWT/oturum' hatası varsa çıkış yapıp yeniden gir."),
    rehberSatir("Site (GitHub Pages) açılmıyor",
      "githubstatus.com'da 'Pages' bileşenine bak. Sorun yoksa deponun Actions sekmesinde son 'pages build and deployment' çalışmasının yeşil olduğunu doğrula.",
      "Son yayın hatalıysa son commit'i geri al (git revert) ve yeniden gönder. Özel alan adında Settings › Pages › Custom domain doğrulamasını kontrol et."),
    rehberSatir("Cloudflare Worker/R2 hatalı",
      "cloudflarestatus.com'a bak. 'Worker'ları sına' ile hangi Worker'ın yanıt vermediğini gör.",
      "Kota bitmiş olabilir (ücretsiz: günlük 100.000 istek) → Cloudflare paneli › Workers › Metrics. Gece yarısı UTC'de sıfırlanır.",
      "Yakın zamanda dağıttıysan Workers › Deployments'tan önceki sürüme dön (Rollback)."),
    rehberSatir("Medya indirici / belge dönüştürücü (Render) çalışmıyor",
      "'Render servislerini sına'ya bas. İlk yanıt 60 sn'ye kadar gecikebilir (uyku) — tekrar dene.",
      "Cobalt kartında 'kimlik doğrulama sorunu' varsa: Render › Cobalt › Environment: API_AUTH_REQUIRED=0 yap (ya da keys.json + API_KEY_URL tanımla ve aynı UUID'yi Worker'a COBALT_API_KEY olarak gir).",
      "deno ✗ / ffmpeg ✗ / LibreOffice ✗ görürsen: Render › yt-dlp servisi › Manual Deploy › 'Clear build cache & deploy'.",
      "YouTube özellikle başarısızsa: yt-dlp YouTube'da sık değişir → 'Clear build cache & deploy' ile güncelle. Bulut IP'leri YouTube tarafından 'bot' diye engellenebilir; bu durumda Cobalt'ı dene ya da bekle. Özel/yaş kısıtlı/DRM'li içerik indirilemez.",
      "Render panelinde servis 'Suspended' ise aylık 750 saatlik ücretsiz süre bitmiş olabilir; yeni ayı bekle veya hesabı doğrula.",
      "Hâlâ çözülmezse Yetki Ayarları › Worker anahtarlarından ilgili aracı geçici KAPAT (üyeler bozuk araç yerine açıklayıcı mesaj görür)."),
    rehberSatir("Bir Worker'ın 'günlük sınırı doldu' deniyor / adres ulaşılamıyor",
      "Yedekleme & Verilerim › Worker anahtarları'nda o Worker'ın satırına bak: 'hak kalmadı' yazıyorsa sınır dolmuş, workers.dev adresi bilerek kesilmiştir (kotaya sayılmaz).",
      "Sınırı yükselt ya da kaldır: 1 dk içinde adres kendiliğinden açılır. Aksi hâlde UTC 00:00'da (Türkiye saatiyle 03:00) otomatik açılır.",
      "Worker'ı elle kapattıysan (Kapalı rozeti) cron ona dokunmaz; 'Aç' ile sen aç."),
    rehberSatir("HavaStil / harita verisi yok",
      "Open-Meteo ve RainViewer kartlarına bak. Sağlayıcı kapalıysa tahmin/radar kendiliğinden döner; sitenin hatası değildir.",
      "Groq/AI özetleri çalışmıyorsa kasadaki anahtar süresi dolmuş olabilir: HavaStil › Ayarlar'dan anahtarı yenile."),
    rehberSatir("Hiçbiri kırmızı değil ama bir şey bozuk",
      "Sayfayı Ctrl+F5 ile yenile; 'Bu cihazdaki veriler' bölümünden önbelleği sil.",
      "Tarayıcı konsolunda (F12) kırmızı hata varsa ekran görüntüsüyle bildir; bekleyen işlem sayısı > 0 ise sağ alttaki düğmeden gönder."));


  if (yonetici) import("../r2-arsiv/depolama.js").then((m) => m.depolamaGostergesiKur(r2Yer, { esitle: false, sahip: rol === "owner" })).catch(() => {});
  if (yonetici) import("../sistem-yedek/r2-kota.js").then((m) => m.r2KotaKartiKur(r2Yer, { baslik: "R2 kullanımı (bu ay) — tüm kovalar" })).catch(() => {});
  return { r2Yer, workerKutu, renderKutu, kesintiRehberi, rol, yonetici, workerIzin };
}

async function ciz() {
  if (!kok) return;
  const oturum = (await supabase.auth.getSession()).data?.session;
  const [sb, site, gh, cf, sbs, rnd, rnd2, om, rv, jd] = await Promise.all([
    saglikKontrol({ zorla: true }),
    sonda(`/surum.json?_=${Date.now()}`, { json: true }),
    sonda("https://www.githubstatus.com/api/v2/summary.json", { json: true }),
    sonda("https://www.cloudflarestatus.com/api/v2/summary.json", { json: true }),
    sonda("https://status.supabase.com/api/v2/summary.json", { json: true }),
    sonda("https://status.render.com/api/v2/summary.json", { json: true }),
    sonda("https://status.render.com/proxy/status.render.com", { json: true }),
    sonda("https://api.open-meteo.com/v1/forecast?latitude=41&longitude=29&current=temperature_2m"),
    sonda("https://api.rainviewer.com/public/weather-maps.json", { json: true }),
    sonda("https://cdn.jsdelivr.net/npm/pdfjs-dist/package.json", { secenek: { method: "HEAD" } }),
  ]);
  void sb;
  const kartlar = [];
  gecmisEkle("auth", !!kd.auth?.ok, kd.auth?.ms || 0); gecmisEkle("rest", !!kd.rest?.ok, kd.rest?.ms || 0); gecmisEkle("site", site.ok, site.ms);
  const sbSev = kd.durum === "ok" ? "ok" : kd.durum === "yavas" || kd.durum === "giris" ? "uyari" : "hata";
  kartlar.push(kart("Supabase — giriş (Auth)", sev(kd.auth?.ok, 2500, kd.auth?.ms), kd.auth?.ok ? `Çalışıyor · ${kd.auth.ms} ms` : "Yanıt yok", "Üye girişi, oturum yenileme, şifre sıfırlama.", null, "status.supabase.com'a bak; resmî kesinti yoksa Supabase panelinde projenin 'Paused' (7 gün hareketsizlikte uyur) olup olmadığına bak → Restore. Çevrimdışı giriş kasası açıksa bu cihazdan kısıtlı girebilirsin.", "auth"));
  kartlar.push(kart("Supabase — veritabanı (REST)", sev(kd.rest?.ok, 2500, kd.rest?.ms), kd.rest?.ok ? `Çalışıyor · ${kd.rest.ms} ms` : "Yanıt yok", "Panel verileri, kütüphane, notlar, ayarlar.", null, "Birkaç dakika bekle; sürerse Supabase panelinde proje durumuna ve Logs › API'ye bak (kota/pause/yanlış RLS). Okuma önbelleği sayesinde site son görülen verileri gösterebilir.", "rest"));
  kartlar.push(kart("Bu sitenin kendisi", sev(site.ok, 2500, site.ms), site.ok ? `Ulaşılabilir · ${site.ms} ms` : "Ulaşılamıyor", site.veri?.surum || site.veri?.version ? `Sürüm: ${site.veri.surum || site.veri.version}` : "Statik dosya sunumu (GitHub Pages / Cloudflare Pages).", null, "githubstatus.com'da Pages bileşenine bak; sorun yoksa depoda Actions › 'pages build and deployment' çalışmasının yeşil olduğunu doğrula.", "site"));
  /* Resmî durum sayfaları (Atlassian Statuspage) → yalnızca BU SİTENİN kullandığı bileşenlere göre durum. Genel gösterge ("Partial System Outage")
   * dünyadaki herhangi bir veri merkezinin sorununu da yansıttığı için sürekli yanlış alarm veriyordu. */
  const BILESEN_DURUM = { operational: "Çalışıyor", degraded_performance: "Yavaş / kısmen bozuk", partial_outage: "Kısmi kesinti", major_outage: "Büyük kesinti", under_maintenance: "Bakımda" };
  const BILESEN_SEV = { operational: 0, under_maintenance: 1, degraded_performance: 1, partial_outage: 2, major_outage: 3 };
  const baglanti = (url, metin) => el("a", { class: "sd-btn", href: url, target: "_blank", rel: "noopener noreferrer", text: `${metin} ↗` });
  function durumKarti(baslik, r, ilgili, sayfaUrl, aciklama, oneri) {
    if (!r.ok || !r.veri?.components) return kart(baslik, "yok", "Durum sayfasına ulaşılamadı", "Bu kontrol tarayıcından yapılır; ağ ya da reklam/gizlilik engelleyici durum sayfasını engelliyor olabilir.", el("div", { class: "sd-eylemler" }, baglanti(sayfaUrl, "Resmî durum sayfasını aç")));
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
    return kart(baslik, sevi, deger, aciklama, ek, oneri);
  }
  kartlar.push(durumKarti("GitHub (içerik deposu / Pages)", gh, /pages|git operations|api requests|actions|webhooks/i, "https://www.githubstatus.com", "Yalnızca Pages, Git, API ve Actions bileşenleri sayılır.", "Site yayını etkileniyorsa bekle (yayın kuyruğa alınır); acil içerik değişikliği gerekiyorsa Actions'ı Re-run et."));
  kartlar.push(durumKarti("Cloudflare (Workers / R2 / Pages / DNS)", cf, /workers|r2|pages|dns|cdn|sites and services|api|dashboard/i, "https://www.cloudflarestatus.com", "Yalnızca Workers, R2, Pages, DNS ve CDN bileşenleri sayılır; tek bir veri merkezindeki yerel sorun alarm vermez.", "Worker/R2 etkileniyorsa Yedekleme & Verilerim › Worker anahtarlarından gereksiz servisleri geçici kapat; resmî sayfadaki olayı izle."));
  kartlar.push(durumKarti("Supabase platformu (resmî durum sayfası)", sbs, /database|auth|rest|api|storage|realtime|dashboard|edge|connection pooler|east|west|europe|frankfurt|london|ireland|paris/i, "https://status.supabase.com", "Veritabanı, giriş, API ve depolama bileşenleri sayılır. Yukarıdaki 'Auth' ve 'REST' kartları ise SENİN projenin anlık ölçümüdür.", "Platform kesintisindeyse bekle; yalnızca senin projen yanıt vermiyorsa panelde 'Paused' durumunu ve kotaları kontrol et."));
  /* Render.com platformu: Atlassian biçimi (api/v2/summary.json) ya da incident.io biçimi (/proxy/…) — hangisi okunabiliyorsa. Kendi servislerin için 'Render.com — benim servislerim' bölümü var. */
  (() => {
    const baslik = "Render.com platformu (medya indirme + belge dönüştürme)", url = "https://status.render.com";
    const oneri = "Render kesintisindeyse medya indirici ve sunucuda dönüştürme geçici çalışmaz; 'Tarayıcıda' dönüştürme etkilenmez. Kesinti bitince 1–2 dk içinde kendiliğinden düzelir.";
    if (rnd.ok && rnd.veri?.components) { kartlar.push(durumKarti(baslik, rnd, /web service|docker|build|deploy|dashboard|api|network|oregon|frankfurt|ohio|singapore|virginia|services/i, url, "Web hizmetleri, derleme/dağıtım ve ağ bileşenleri sayılır.", oneri)); return; }
    const o = rnd2.veri?.summary;
    if (rnd2.ok && o) {
      const etkilenen = (o.affected_components || []).filter((c) => c.status && c.status !== "operational"), olaylar = o.ongoing_incidents || [];
      const sevi = etkilenen.some((c) => /full_outage|major/.test(c.status)) ? "hata" : etkilenen.length || olaylar.length ? "uyari" : "ok";
      const ek = el("div", { class: "sd-detay" }, ...(etkilenen.length ? [el("ul", { class: "sd-liste" }, ...etkilenen.map((c) => el("li", { text: `${c.name}: ${c.status}` })))] : []), ...(olaylar.length ? [el("ul", { class: "sd-liste" }, ...olaylar.slice(0, 4).map((x) => el("li", { text: x.name })))] : []), el("div", { class: "sd-eylemler" }, baglanti(url, "Resmî durum sayfası")));
      kartlar.push(kart(baslik, sevi, sevi === "ok" ? "Bildirilen sorun yok" : `${etkilenen.length} bileşende sorun · ${olaylar.length} açık olay`, "Render platformunun resmî durum sayfası.", ek, oneri));
      return;
    }
    kartlar.push(kart(baslik, "yok", "Durum sayfasına tarayıcıdan ulaşılamadı", "Render'ın durum sayfası bu tarayıcıdan okunamadı (ağ ya da CORS/engelleyici). Bu, Render'ın çöktüğü anlamına GELMEZ.", el("div", { class: "sd-eylemler" }, baglanti(url, "Resmî durum sayfasını aç")), "Aşağıdaki 'Render.com — benim servislerim' sınamasını kullan: asıl önemli olan senin servislerinin yanıt vermesidir."));
  })();
  kartlar.push(kart("Open-Meteo (HavaStil tahminleri)", sev(om.ok, 3000, om.ms), om.ok ? `Çalışıyor · ${om.ms} ms` : "Ulaşılamıyor", "Saatlik tahmin ve ızgara verisi.", null, "Open-Meteo kapalıysa HavaStil önbellekteki son tahmini gösterir; kendiliğinden düzelir. open-meteo.com'dan duyuruya bak."));
  const kareSay = rv.veri?.radar?.past?.length;
  kartlar.push(kart("RainViewer (canlı radar)", sev(rv.ok && kareSay, 4000, rv.ms), rv.ok ? `${kareSay || 0} radar karesi · ${rv.ms} ms` : "Ulaşılamıyor", rv.veri?.generated ? `Veri üretimi: ${new Date(rv.veri.generated * 1000).toLocaleTimeString("tr-TR")} (${Math.max(0, Math.round((Date.now() / 1000 - rv.veri.generated) / 60))} dk önce)` : "Radar (geçmiş ~2 saat)."));
  kartlar.push(kart("jsDelivr (PDF okuyucu motoru)", sev(jd.ok, 3000, jd.ms), jd.ok ? `Çalışıyor · ${jd.ms} ms` : "Ulaşılamıyor", "PDF.js bu CDN'den yüklenir; kapalıysa okuyucu açılmayabilir.", null, "Reklam/gizlilik engelleyiciyi bu site için kapat; değilse jsDelivr kesintisidir, bekle."));

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
  const tumKartlar = [...kartlar, ...cihaz];
  const kotuIsim = (sinif) => tumKartlar.filter((k) => k.classList.contains(sinif)).map((k) => k.querySelector("h3")?.textContent.trim());
  const hatalar = kotuIsim("sd-hata"), uyarilar = kotuIsim("sd-uyari");
  const genelSev = hatalar.length ? "hata" : uyarilar.length ? "uyari" : "ok";
  const ozet = el("section", { class: `sd-ozet sd-${genelSev === "ok" ? sbSev : genelSev}` },
    el("h2", {}, el("span", { class: "sd-nokta", "aria-hidden": "true" }), genelSev === "ok" ? "Her şey normal görünüyor" : hatalar.length ? `${hatalar.length} serviste sorun var` : `${uyarilar.length} serviste dikkat gerekiyor`),
    el("p", { class: "sd-ozet-alt", text: `Supabase: ${durumMetni[kd.durum] || kd.durum} · ${tumKartlar.length} kontrol: ${tumKartlar.length - hatalar.length - uyarilar.length} sağlıklı, ${uyarilar.length} uyarı, ${hatalar.length} sorun.` }),
    ...(hatalar.length || uyarilar.length ? [el("ul", { class: "sd-liste" }, ...hatalar.map((x) => el("li", { text: `❌ ${x}` })), ...uyarilar.map((x) => el("li", { text: `⚠ ${x}` }))), el("p", { class: "muted", text: "Her kartta 'Ne yapmalı?' notu var; ayrıntılı adımlar sayfanın altındaki 'Kesinti olursa ne yapmalıyım?' bölümünde." })] : []),
    el("div", { class: "sd-eylemler" }));
  const yenile = el("button", { type: "button", class: "sd-btn" }, "⟳ Şimdi yeniden kontrol et");
  yenile.addEventListener("click", () => { yenile.disabled = true; yenile.textContent = "Kontrol ediliyor…"; ciz(); });
  const durak = el("a", { class: "sd-btn", href: "https://status.supabase.com", target: "_blank", rel: "noopener noreferrer" }, "Supabase resmî durum sayfası ↗");
  ozet.querySelector(".sd-eylemler").append(yenile, durak);
  const alt = el("p", { class: "kst-alt", text: `Son kontrol: ${new Date().toLocaleTimeString("tr-TR")}. Tüm kontroller doğrudan tarayıcından yapılır; Cloudflare kotası harcanmaz. Sayfa açıkken 60 sn'de bir otomatik yenilenir.` });

  kalici ||= await kaliciKur(oturum);
  const { r2Yer, workerKutu, renderKutu, kesintiRehberi, rol, yonetici, workerIzin } = kalici;

  kok.replaceChildren(ozet,
    el("h3", { class: "sd-bolum-baslik", text: "Çekirdek servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(0, 3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bağımlı dış servisler" }), el("div", { class: "sd-izgara" }, ...kartlar.slice(3)),
    el("h3", { class: "sd-bolum-baslik", text: "Bu cihaz" }), el("div", { class: "sd-izgara" }, ...cihaz), await cihazVerileriKarti(oturum),
    ...(yonetici || workerIzin ? [el("h3", { class: "sd-bolum-baslik", text: yonetici ? "Kotalar & Worker'lar" : "Worker sınaması" }), ...(yonetici ? [r2Yer] : []), workerKutu, ...(yonetici ? [renderKutu] : [])]
      : [el("p", { class: "kst-alt", text: "Cloudflare Worker sınaması sistem kotasını harcadığı için varsayılan olarak yalnızca yönetici ve site sahibine açıktır; site sahibi Yetki Ayarları'ndan rolüne açabilir. Yukarıdaki kontroller herkes için ücretsizdir." })]), alt);
  if (yonetici) kok.append(kesintiRehberi);
}

let zaman = null;
function planla() { clearTimeout(zaman); zaman = setTimeout(async () => { if (!document.hidden && kok && kok.offsetParent !== null) await ciz().catch(() => {}); planla(); }, 60000); }
ciz().catch((h) => { if (kok) kok.textContent = `Durum okunamadı: ${h.message}`; });
planla();
kesintiOlay("kesinti-durum", () => { /* sonraki turda tazelenir */ });
