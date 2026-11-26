/* ortak-arayuz.js
 * Tüm sayfalarda ortak küçük yardımcılar (hiçbir mevcut ID / dinleyiciye dokunmaz):
 *  1) .ui-surgu sürgüsü değişince kısa "Uygulandı" geri bildirimi (data-ui-sessiz ile kapatılır)
 *  2) details.ui-cekmece için yumuşak açılıp kapanma
 *  3) window.UIYardim: zaman aşımlı fetch, Türkçe hata metni, buton kilidi (yükleniyor + çift tık koruması)
 */
(function () {
  "use strict";

  /* ---------- 1) "Uygulandı" geri bildirimi ---------- */
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("ui-surgu") || t.hasAttribute("data-ui-sessiz")) return;
    var kap = t.closest("label") || t.parentNode;
    if (!kap) return;
    var eski = kap.querySelector(":scope > .ui-uygulandi");
    if (eski) eski.remove();
    var rozet = document.createElement("span");
    rozet.className = "ui-uygulandi";
    rozet.setAttribute("role", "status");
    rozet.textContent = "Uygulandı";
    kap.appendChild(rozet);
    setTimeout(function () { if (rozet.parentNode) rozet.remove(); }, 1600);
  });

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

  window.UIYardim = { getir: getir, hataMetni: hataMetni, kilitle: kilitle, hataGoster: hataGoster };
})();
