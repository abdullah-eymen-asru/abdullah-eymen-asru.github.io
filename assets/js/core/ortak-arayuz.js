/* ortak-arayuz.js
 * Tüm sayfalarda ortak küçük yardımcılar (hiçbir mevcut ID / dinleyiciye dokunmaz):
 *  1) .ui-surgu sürgüsü değişince kısa "Uygulandı" geri bildirimi (data-ui-sessiz ile kapatılır)
 *  2) details.ui-cekmece için yumuşak açılıp kapanma
 *  3) window.UIYardim: zaman aşımlı fetch, Türkçe hata metni, buton kilidi (yükleniyor + çift tık koruması)
 */
(function () {
  "use strict";

  /* ---------- 1) "Uygulandı" geri bildirimi ----------
   * Rozet YALANCI olmasın diye: kayıt sürerken kutu kilitliyse (disabled) beklenir; kayıt bitince kutu hâlâ
   * kullanıcının seçtiği konumdaysa "Uygulandı" gösterilir. Kayıt hata verip eski konuma dönerse rozet çıkmaz. */
  function rozetGoster(t, hedefDurum) {
    var kap = t.closest("label") || t.parentNode;
    if (!kap || !t.isConnected || t.checked !== hedefDurum) return;
    var eski = kap.querySelector(":scope > .ui-uygulandi");
    if (eski) eski.remove();
    var rozet = document.createElement("span");
    rozet.className = "ui-uygulandi";
    rozet.setAttribute("role", "status");
    rozet.textContent = "Uygulandı";
    kap.appendChild(rozet);
    setTimeout(function () { if (rozet.parentNode) rozet.remove(); }, 1600);
  }
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("ui-surgu") || t.hasAttribute("data-ui-sessiz")) return;
    var hedefDurum = t.checked, bekle = 0;
    (function dene() {
      if (t.disabled && bekle < 40) { bekle++; setTimeout(dene, 250); return; }   // en çok ~10 sn kayıt beklenir
      if (bekle >= 40) return;
      rozetGoster(t, hedefDurum);
    })();
  });

  /* ---------- 1b) Güvenlik ağı: role="switch" olan ama stili olmayan kutular da sürgü olur ----------
   * (Sonradan JS ile üretilen kutular için; kendi sürgüsü olanlara — .ya-mini-toggle, .gy-toggle, .hv-surgu, .bt-anahtar — dokunmaz.) */
  var KENDI_SURGUSU = ".ya-mini-toggle, .gy-toggle, .hv-surgu, .hv-surgu-duzenek";
  function surguYap(kok) {
    var liste = (kok.querySelectorAll ? kok.querySelectorAll('input[type="checkbox"][role="switch"]:not(.ui-surgu):not(.bt-anahtar):not(.hv-surgu-input)') : []);
    for (var i = 0; i < liste.length; i++) {
      if (!liste[i].closest(KENDI_SURGUSU)) liste[i].classList.add("ui-surgu");
    }
  }
  function surguBaslat() {
    surguYap(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function (kayitlar) {
      for (var i = 0; i < kayitlar.length; i++) {
        var ek = kayitlar[i].addedNodes;
        for (var j = 0; j < ek.length; j++) if (ek[j].nodeType === 1) { if (ek[j].matches && ek[j].matches('input[type="checkbox"][role="switch"]')) surguYap(ek[j].parentNode || document); else surguYap(ek[j]); }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", surguBaslat); else surguBaslat();

  /* ---------- 2) Yumuşak çekmece ---------- */
  var azHareket = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.addEventListener("click", function (e) {
    var ozet = e.target && e.target.closest ? e.target.closest("details.ui-cekmece > summary") : null;
    if (!ozet || azHareket) return;
    var det = ozet.parentNode;
    var icerik = det.querySelector(":scope > .ui-cekmece-icerik");
    if (!icerik || typeof icerik.animate !== "function") return;
    e.preventDefault();
    if (det._ui_anim) { det._ui_anim.cancel(); det._ui_anim = null; }
    var ac = !det.open;
    if (ac) det.open = true;
    var h = icerik.scrollHeight;
    var anim = icerik.animate(
      [{ height: (ac ? 0 : h) + "px", opacity: ac ? 0 : 1 }, { height: (ac ? h : 0) + "px", opacity: ac ? 1 : 0 }],
      { duration: 200, easing: "ease" }
    );
    det._ui_anim = anim;
    anim.onfinish = function () { det._ui_anim = null; if (!ac) det.open = false; };
    anim.oncancel = function () { det._ui_anim = null; };
  });

  /* ---------- 2b) Linkle (#bolum) gelinen bölüm kapalı bir çekmecenin içindeyse otomatik aç ---------- */
  function hedefCekmeceAc() {
    var id = decodeURIComponent((location.hash || "").slice(1));
    if (!id) return;
    var h = document.getElementById(id);
    for (var n = h; n; n = n.parentElement) if (n.tagName === "DETAILS" && n.classList.contains("ui-cekmece")) n.open = true;
    if (h && h.scrollIntoView) h.scrollIntoView();
  }
  window.addEventListener("hashchange", hedefCekmeceAc);

  /* ---------- 3) Yardımcılar ---------- */
  function hataMetni(err, durum) {
    var ad = err && err.name;
    var msg = String((err && err.message) || "");
    if (ad === "AbortError" || ad === "TimeoutError") return "Sunucu geç yanıt verdi. Lütfen tekrar dene.";
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.";
    if (durum === 401 || durum === 403) return "Bu işlem için yetkin yok ya da oturumun kapanmış. Yeniden giriş yap.";
    if (durum === 404) return "İstenen içerik bulunamadı.";
    if (durum === 429) return "Çok fazla istek gönderdin. Biraz bekleyip tekrar dene.";
    if (durum >= 500) return "Sunucuda geçici bir sorun var. Biraz sonra tekrar dene.";
    return "İşlem tamamlanamadı. Lütfen tekrar dene.";
  }

  /* Zaman aşımlı fetch. Başarısızsa Türkçe mesajlı bir Error fırlatır (hata.kullaniciMesaji).
   * opts.zamanAsimi (ms, varsayılan 20000), opts.bekleMesaji(el) gibi ek alan yoktur — sade tutuldu. */
  function getir(url, opts) {
    opts = opts || {};
    var ms = opts.zamanAsimi || 20000;
    var ac = new AbortController();
    var zamanlayici = setTimeout(function () { ac.abort(); }, ms);
    var init = Object.assign({}, opts);
    delete init.zamanAsimi;
    if (opts.signal) opts.signal.addEventListener("abort", function () { ac.abort(); });
    init.signal = ac.signal;
    return fetch(url, init).then(
      function (r) {
        clearTimeout(zamanlayici);
        if (!r.ok) {
          var e = new Error("HTTP " + r.status);
          e.durum = r.status;
          e.kullaniciMesaji = hataMetni(e, r.status);
          throw e;
        }
        return r;
      },
      function (err) {
        clearTimeout(zamanlayici);
        err.kullaniciMesaji = hataMetni(err);
        throw err;
      }
    );
  }

  /* Butonu işlem boyunca kilitler (çift tık koruması + dönen simge); bitince eski hâline döner.
   * kullanım: UIYardim.kilitle(btn, async () => { ... }) */
  function kilitle(btn, fn) {
    if (!btn || btn.disabled || btn.getAttribute("aria-busy") === "true") return Promise.resolve();
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    btn.classList.add("ui-yukleniyor");
    function bitir() {
      btn.classList.remove("ui-yukleniyor");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
    var sonuc;
    try { sonuc = Promise.resolve(fn()); } catch (e) { bitir(); return Promise.reject(e); }
    return sonuc.then(function (v) { bitir(); return v; }, function (e) { bitir(); throw e; });
  }

  /* Hata + "Tekrar dene" kutusunu kapsayıcıya yazar (innerHTML kullanmaz → XSS güvenli). */
  function hataGoster(kap, mesaj, tekrar) {
    if (!kap) return;
    kap.textContent = "";
    var kutu = document.createElement("div");
    kutu.className = "ui-durum hata";
    kutu.setAttribute("role", "alert");
    var p = document.createElement("span");
    p.textContent = mesaj;
    kutu.appendChild(p);
    if (typeof tekrar === "function") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ak-btn";
      b.textContent = "Tekrar dene";
      b.addEventListener("click", function () { kilitle(b, tekrar); });
      kutu.appendChild(b);
    }
    kap.appendChild(kutu);
  }


  /* ---------- 5) Hata metni süzgeci (güvenlik ağı) ----------
   * Hata/uyarı/bildirim kutularına yazılan İngilizce teknik metinleri ("Failed to fetch", "JWT expired", "violates row-level
   * security policy", PGRST/SQL kodları, "undefined" vb.) sade Türkçe ile değiştirir; ham metin yalnızca konsola gider.
   * Yalnızca KISA (<300 kr) hata/uyarı kutularına bakar; bilinçli yazılmış Türkçe mesajlara dokunmaz. */
  var HATA_KUTUSU = '[role="alert"], .auth-message.error, .error, .ak-hata, [class*="toast"], [class*="hata"], .gy-durum.hata, [class*="-err"]';
  var HATA_KURALLARI = [
    [/failed to fetch|networkerror|load failed|network request failed|err_internet|fetch failed/i, "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene."],
    [/user aborted a request|signal is aborted|aborterror|aborted without reason/i, "İstek zaman aşımına uğradı veya iptal edildi. Tekrar dene."],
    [/row-level security|permission denied|\b42501\b|not authorized|insufficient.?privilege|new row violates/i, "Bu işlem için yetkin yok."],
    [/jwt expired|invalid jwt|jwt (is )?malformed|invalid refresh token|refresh token not found/i, "Oturumun süresi dolmuş. Yeniden giriş yap."],
    [/duplicate key value|violates unique constraint|\b23505\b/i, "Bu kayıt zaten var."],
    [/violates foreign key|\b23503\b/i, "Bu kayıt başka bir kayda bağlı olduğu için işlem yapılamadı."],
    [/could not find the function|schema cache|\bPGRST\d+\b|\b42P01\b|\b42883\b|relation .* does not exist|column .* does not exist/i, "Bu özellik şu an kullanılamıyor. Lütfen daha sonra tekrar dene."],
    [/internal server error|\b(status|http|error)[ :]*5\d\d\b/i, "Sunucuda geçici bir sorun var. Biraz sonra tekrar dene."],
    [/unexpected token|is not valid json|unexpected end of json/i, "Sunucudan beklenmeyen bir yanıt geldi. Tekrar dene."],
    [/\bundefined\b|\[object object\]|\bnull\b is not|cannot read propert/i, "İşlem tamamlanamadı. Lütfen tekrar dene."]
  ];
  function hataSuz(dugum) {
    var el = dugum && dugum.nodeType === 1 ? dugum : dugum && dugum.parentElement;
    if (!el || !el.closest) return;
    var kutu = el.closest(HATA_KUTUSU);
    if (!kutu || kutu.children.length > 0) return;
    var t = kutu.textContent || "";
    if (!t || t.length > 300) return;
    for (var i = 0; i < HATA_KURALLARI.length; i++) {
      if (HATA_KURALLARI[i][0].test(t)) {
        try { console.warn("Gizlenen teknik ayrıntı:", t); } catch (e) { /* yok say */ }
        kutu.textContent = HATA_KURALLARI[i][1];
        return;
      }
    }
  }
  function hataSuzBaslat() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (kayitlar) {
      for (var i = 0; i < kayitlar.length; i++) {
        var k = kayitlar[i];
        if (k.type === "characterData") { hataSuz(k.target); continue; }
        hataSuz(k.target);
        for (var j = 0; j < k.addedNodes.length; j++) {
          var n = k.addedNodes[j];
          if (n.nodeType === 3) hataSuz(n);
          else if (n.nodeType === 1) {
            hataSuz(n);
            if (n.querySelectorAll) { var a = n.querySelectorAll(HATA_KUTUSU); for (var x = 0; x < a.length; x++) hataSuz(a[x]); }
          }
        }
      }
    }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hataSuzBaslat); else hataSuzBaslat();

  /* ---------- 4) Bekleme / zaman aşımı bandı (worker-kapi.js olayları) ----------
   * aea:yavas {acik}: bir Worker isteği 5 sn'yi aştı / bitti → "Veriler hazırlanıyor" bandı. aea:zaman-asimi: süre doldu. */
  var bekleSay = 0, band = null, bandZ = null;
  function bandAl() {
    if (band && band.isConnected) return band;
    band = document.createElement("div");
    band.className = "ui-bekle";
    band.setAttribute("role", "status");
    band.setAttribute("aria-live", "polite");
    band.hidden = true;
    document.body.appendChild(band);
    return band;
  }
  window.addEventListener("aea:yavas", function (e) {
    bekleSay += e.detail && e.detail.acik ? 1 : -1;
    if (bekleSay < 0) bekleSay = 0;
    var b = bandAl();
    if (bekleSay > 0) {
      clearTimeout(bandZ);
      b.className = "ui-bekle";
      b.textContent = "Veriler hazırlanıyor, lütfen bekleyin…";
      b.hidden = false;
    } else if (!b.classList.contains("hata")) {
      b.hidden = true;
    }
  });
  window.addEventListener("aea:zaman-asimi", function () {
    var b = bandAl();
    bekleSay = 0;
    b.className = "ui-bekle hata";
    b.textContent = "Sunucu geç yanıt verdi. İşlemi birazdan tekrar dene. ";
    var tamam = document.createElement("button");
    tamam.type = "button";
    tamam.textContent = "Tamam";
    tamam.addEventListener("click", function () { b.hidden = true; });
    b.appendChild(tamam);
    b.hidden = false;
    clearTimeout(bandZ);
    bandZ = setTimeout(function () { b.hidden = true; }, 10000);
  });

  window.UIYardim = { getir: getir, hataMetni: hataMetni, kilitle: kilitle, hataGoster: hataGoster };
})();
