/*
 * assets/js/core/bot-kalkani.js — "Bot Kalkanı": sayfa içeriği ve veri istekleri başlamadan önce tam ekran Turnstile doğrulaması.
 * KLASİK (modül değil) betik; <head>'de, ilk sırada, küçük ve engelleyici olarak yüklenir. Durum Kontrol Merkezi'nden (migration 0157) gelir.
 *
 * VARSAYILAN KAPALI + KOTA DOSTU:
 *   • Kalkan kapalıyken ve önbellek tazeyken HİÇBİR ağ isteği yapılmaz (durum localStorage'da, en çok 5 dk).
 *   • Önbellek bayatsa tek, küçük bir Supabase RPC'si (turnstile_durum_getir) arka planda yenilenir — Worker'a istek GİTMEZ.
 *   • Worker'a (doğrulama) yalnızca kalkan AÇIKKEN ve ziyaretçinin geçerli bir geçiş kaydı yoksa gidilir.
 * KALKAN AÇIKKEN: içerik gizlenir, Turnstile geçilene kadar Supabase/Worker istekleri (fetch) BEKLETİLİR.
 * DÜRÜST SINIR: Statik sitede bu bir tarayıcı-tarafı kapıdır; JS çalıştırmayan botları ya da doğrudan dosya/API isteklerini durdurmaz.
 *   Önbellek yüzünden kalkanı yeni açmanız ziyaretçilere en çok 5 dk içinde yansır.
 * Hata modu (Kontrol Merkezi): "acik" (fail-open) = Cloudflare/Worker'a ulaşılamazsa geçişe izin ver; "kapali" = engelle + "Yeniden dene".
 */
(function () {
  "use strict";
  var DURUM_ANAHTAR = "aea_ts_durum_v1", GECIS_ANAHTAR = "aea_bk_gecis_v1", EN_FAZLA_MS = 300000;
  var html = document.documentElement;
  function meta(ad) { try { var e = document.querySelector('meta[name="' + ad + '"]'); return e && e.content ? e.content.trim() : ""; } catch (x) { return ""; } }
  function oku(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (x) { return null; } }
  function yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* özel pencere */ } }

  var siteKey = meta("turnstile-sitekey"), workerUrl = meta("turnstile-worker");
  var sbUrl = meta("aea-sb-url"), sbKey = meta("aea-sb-key");
  if (!siteKey || !sbUrl || !sbKey) return;                       // yapılandırma yok → özellik tamamen pasif

  var onbellek = oku(DURUM_ANAHTAR);
  var gecis = oku(GECIS_ANAHTAR);
  var gecisGecerli = !!(gecis && gecis.exp && gecis.exp > Date.now());
  var durum = onbellek && onbellek.v ? onbellek.v : null;
  var taze = !!(onbellek && Date.now() - onbellek.t < Math.min(EN_FAZLA_MS, Math.max(1, Number(durum && durum.gecerlilik_sn) || 60) * 1000));

  var serbest, kapiAktif = false;
  var hazir = new Promise(function (c) { serbest = c; });
  var serbestMi = false;
  function ac() { if (serbestMi) return; serbestMi = true; html.classList.remove("bk-bekle", "bk-aktif"); var k = document.getElementById("bk-kalkan"); if (k && k.parentNode) k.parentNode.removeChild(k); serbest(); }
  window.__botKalkani = { hazir: hazir };

  // --- Bekleyen istekleri (Supabase/Worker) kapı açılana dek tut; durum/doğrulama uçları serbest
  function fetchSar() {
    var orijinal = window.fetch;
    if (typeof orijinal !== "function") return;
    window.fetch = function (girdi, init) {
      var u = ""; try { u = typeof girdi === "string" ? girdi : (girdi && girdi.url) || String(girdi); } catch (x) { /* yok say */ }
      var serbestUc = u.indexOf("/rpc/turnstile_") !== -1 || (workerUrl && u.indexOf(workerUrl) === 0) || u.indexOf("challenges.cloudflare.com") !== -1;
      if (serbestMi || serbestUc) return orijinal.call(this, girdi, init);
      var self = this;
      return hazir.then(function () { return orijinal.call(self, girdi, init); });
    };
  }

  function rpc(ad, govde) {
    return fetch(sbUrl + "/rest/v1/rpc/" + ad, { method: "POST", keepalive: true, headers: { apikey: sbKey, Authorization: "Bearer " + sbKey, "Content-Type": "application/json" }, body: JSON.stringify(govde || {}) });
  }
  function olay(sonuc) { try { rpc("turnstile_olay_kaydet", { p_tur: "kalkan", p_sonuc: sonuc }).catch(function () {}); } catch (x) { /* sayaç kritik değil */ } }

  function durumYenile(sonra) {
    var kd = typeof AbortController === "function" ? new AbortController() : null;
    var z = setTimeout(function () { if (kd) kd.abort(); }, 3000);
    return rpc("turnstile_durum_getir", {}).then(function (r) { if (!r.ok) throw new Error("durum"); return r.json(); }).then(function (v) {
      clearTimeout(z);
      if (!v || !v.moduller) throw new Error("biçim");
      yaz(DURUM_ANAHTAR, { t: Date.now(), v: v });
      return v;
    }).catch(function () { clearTimeout(z); return null; }).then(sonra);
  }

  // --- Kapı arayüzü (yalnızca DOM API; satır içi stil/betik YOK)
  var widgetId = null, hataModu = "acik", dogrulamaDk = 30;
  function kalkanEkle() {
    var k = document.getElementById("bk-kalkan");
    if (k) return k;
    k = document.createElement("div"); k.id = "bk-kalkan"; k.setAttribute("role", "alertdialog"); k.setAttribute("aria-label", "Güvenlik doğrulaması");
    var b = document.createElement("h1"); b.textContent = "Güvenlik doğrulaması";
    var p = document.createElement("p"); p.id = "bk-mesaj"; p.textContent = "Siteye girmeden önce kısa bir doğrulama yapılıyor…";
    var kutu = document.createElement("div"); kutu.id = "bk-kutu";
    k.appendChild(b); k.appendChild(p); k.appendChild(kutu);
    (document.body || html).appendChild(k);
    return k;
  }
  function mesaj(m, yenidenDene) {
    var p = document.getElementById("bk-mesaj"); if (p) p.textContent = m;
    var eski = document.getElementById("bk-yeniden"); if (eski && eski.parentNode) eski.parentNode.removeChild(eski);
    if (yenidenDene) {
      var d = document.createElement("button"); d.type = "button"; d.id = "bk-yeniden"; d.textContent = "Yeniden dene";
      d.addEventListener("click", function () { try { if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); else widgetCiz(); } catch (x) { widgetCiz(); } mesaj("Doğrulama yapılıyor…", false); });
      var k = document.getElementById("bk-kalkan"); if (k) k.appendChild(d);
    }
  }
  function hataYonet(neden) {
    // Ulaşılamama (Cloudflare/Worker) → hata moduna göre; "doğrulanamadı" → her zaman engel + yeniden dene.
    if (neden === "ulasilamadi") {
      olay("hata");
      if (hataModu === "acik") { ac(); return; }
      mesaj("Doğrulama servisine ulaşılamadı. İnternetini kontrol edip tekrar dene.", true); return;
    }
    olay("engellendi");
    mesaj("Doğrulama başarısız oldu. Lütfen tekrar dene.", true);
  }
  function dogrula(token) {
    if (!workerUrl) { console.warn("Bot Kalkanı: turnstile_worker_url tanımlı değil."); hataYonet("ulasilamadi"); return; }
    var kd = typeof AbortController === "function" ? new AbortController() : null;
    var z = setTimeout(function () { if (kd) kd.abort(); }, 10000);
    fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token }), signal: kd ? kd.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (o) {
        clearTimeout(z);
        if (o.j && o.j.ok === true) { yaz(GECIS_ANAHTAR, { exp: Date.now() + Math.max(1, dogrulamaDk) * 60000 }); olay("gecti"); ac(); }
        else if (o.s >= 500 || (o.j && (o.j.hata === "ulasilamadi" || o.j.hata === "yapilandirma"))) hataYonet("ulasilamadi");
        else hataYonet("dogrulanamadi");
      }).catch(function () { clearTimeout(z); hataYonet("ulasilamadi"); });
  }
  function widgetCiz() {
    var kutu = document.getElementById("bk-kutu"); if (!kutu || !window.turnstile) return;
    try { if (widgetId !== null) window.turnstile.remove(widgetId); } catch (x) { /* yok say */ }
    widgetId = window.turnstile.render(kutu, {
      sitekey: siteKey, language: "tr", appearance: "always", retry: "auto", "refresh-expired": "auto",
      theme: html.getAttribute("data-theme") === "dark" ? "dark" : "auto",
      callback: dogrula,
      "error-callback": function () { hataYonet("ulasilamadi"); return true; },
      "timeout-callback": function () { mesaj("Doğrulama zaman aşımına uğradı.", true); },
    });
  }
  function turnstileYukle() {
    if (window.turnstile) { widgetCiz(); return; }
    var s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.defer = true;
    var zaman = setTimeout(function () { hataYonet("ulasilamadi"); }, 15000);
    s.onload = function () { clearTimeout(zaman); widgetCiz(); };
    s.onerror = function () { clearTimeout(zaman); hataYonet("ulasilamadi"); };
    document.head.appendChild(s);
  }
  function kapiyiAc(v) {
    hataModu = v.hata_modu === "kapali" ? "kapali" : "acik"; dogrulamaDk = Number(v.dogrulama_dk) || 30;
    if (kapiAktif) return; kapiAktif = true;
    html.classList.remove("bk-bekle"); html.classList.add("bk-aktif");
    var kur = function () { kalkanEkle(); turnstileYukle(); };
    if (document.body) kur(); else document.addEventListener("DOMContentLoaded", kur, { once: true });
  }
  function karar(v) {
    if (!v) { ac(); return; }                       // durum okunamadı → site açık (erişilebilirlik öncelikli)
    if (v.kalkan === true && !(gecisGecerli)) kapiyiAc(v); else ac();
  }

  if (durum && durum.kalkan === true && !gecisGecerli) {
    // Önbellek "kalkan AÇIK" diyor → hemen kapı; arka planda durumu doğrula (kapatıldıysa kapı açılır).
    fetchSar(); kapiyiAc(durum);
    if (!taze) durumYenile(function (v) { if (v && v.kalkan !== true) ac(); else if (v) { hataModu = v.hata_modu === "kapali" ? "kapali" : "acik"; dogrulamaDk = Number(v.dogrulama_dk) || dogrulamaDk; } });
  } else if (durum) {
    // Önbellek "kapalı" (ya da geçiş kaydı var): sayfa HEMEN görünür, istek bekletilmez.
    serbestMi = true; serbest();
    if (!taze) durumYenile(function (v) { if (v && v.kalkan === true && !gecisGecerli) { serbestMi = false; hazirYenile(); fetchSar(); kapiyiAc(v); } });
  } else {
    // İlk ziyaret: durum bilinmiyor → kısa süre (en çok ~3 sn) içerik gizli + istekler beklemede, sonra karar.
    html.classList.add("bk-bekle"); fetchSar();
    durumYenile(function (v) { html.classList.remove("bk-bekle"); karar(v); });
  }
  function hazirYenile() { hazir = new Promise(function (c) { serbest = c; }); window.__botKalkani.hazir = hazir; }
})();
