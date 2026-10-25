/*
 * assets/js/duyuru/duyuru-ziyaretci.js — Site ZİYARETÇİLERİNE açılış "uyarı ekranı" (migration 0113). Klasik script (defer), bağımlılık yok.
 * • Her sayfada (panel hariç: panelde üye şeridi çalışır) aktif duyuruları ucuz bir RPC ile sorar; 2 dk oturum önbelleği → sayfa gezerken tekrar istek yok.
 * • Duyuru yoksa HİÇBİR ŞEY çizilmez (sıfır görsel etki). Varsa <dialog> ile yönetilebilir bir pencere: Esc / "Anladım" ile kapanır, odak tuzağı yerleşiktir.
 * • Kapatma bu tarayıcıda hatırlanır (sürüm değişince yeniden gösterilir). Ziyaretçi için okundu kaydı SUNUCUYA yazılmaz (üyeler panelde kaydedilir).
 * • Metinler yalnızca textContent (XSS yok); bağlantı yalnızca https. Hata/ağ yoksa sessizce çıkar. CSP: inline stil/script yok.
 */
(function () {
  "use strict";
  var SB_URL = "https://eahvcirspmvntffzphye.supabase.co";
  // Public anon anahtar (gatekeeper.js / supabase-client.js ile AYNI; gizli değildir, RLS korur). RPC yalnızca YAYINDAKİ duyuruları döndürür.
  var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhaHZjaXJzcG12bnRmZnpwaHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTgxODMsImV4cCI6MjEwMTc3NDE4M30._f-GKSsffxFo66w3g0NJfmOWEhlsjU4Y6mlcTlcPJ2E";
  var yol = location.pathname || "/";
  if (/^\/panel(\/|$)/.test(yol)) return;

  var ONBELLEK = "aea_duy_zv1", TTL = 120000;
  function oku() { try { var o = JSON.parse(sessionStorage.getItem(ONBELLEK) || "null"); return o && Date.now() - o.t < TTL ? o.v : null; } catch (e) { return null; } }
  function yaz(v) { try { sessionStorage.setItem(ONBELLEK, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* yok say */ } }
  function kapaliMi(d) { try { return localStorage.getItem("aea_duy_k_" + d.id + "_" + d.surum) === "1"; } catch (e) { return false; } }
  function kapat(d) { try { localStorage.setItem("aea_duy_k_" + d.id + "_" + d.surum, "1"); } catch (e) { /* yok say */ } }

  function getir() {
    var c = oku(); if (c) return Promise.resolve(c);
    var k = new AbortController(), z = setTimeout(function () { k.abort(); }, 4000);
    return fetch(SB_URL + "/rest/v1/rpc/aktif_duyurular", { method: "POST", signal: k.signal, credentials: "omit",
      headers: { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON, "Content-Type": "application/json" }, body: JSON.stringify({ p_hedef: "ziyaretci" }) })
      .then(function (r) { clearTimeout(z); return r.ok ? r.json() : []; }).then(function (v) { if (!Array.isArray(v)) v = []; yaz(v); return v; })
      .catch(function () { clearTimeout(z); return []; });
  }

  function guvenliUrl(u) { try { var x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch (e) { return null; } }
  function goster(kuyruk) {
    var d = kuyruk.shift(); if (!d) return;
    var dlg = document.createElement("dialog");
    dlg.className = "dy-pencere dy-tur-" + d.tur; dlg.setAttribute("aria-labelledby", "dy-pencere-baslik");
    var ust = document.createElement("div"); ust.className = "dy-pencere-ust";
    var ikon = document.createElement("span"); ikon.className = "dy-pencere-ikon"; ikon.setAttribute("aria-hidden", "true"); ikon.textContent = d.tur === "kritik" ? "🚨" : d.tur === "uyari" ? "⚠️" : "ℹ️";
    var h = document.createElement("h2"); h.id = "dy-pencere-baslik"; h.textContent = d.baslik; ust.append(ikon, h);
    var govde = document.createElement("div"); govde.className = "dy-pencere-govde";
    String(d.metin).split("\n").forEach(function (s) { var p = document.createElement("p"); p.textContent = s; govde.append(p); });
    var alt = document.createElement("div"); alt.className = "dy-pencere-alt";
    var href = d.baglanti_url ? guvenliUrl(d.baglanti_url) : null;
    if (href) { var a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "dy-pencere-baglanti"; a.textContent = d.baglanti_metin || "Ayrıntılar"; alt.append(a); }
    var tamam = document.createElement("button"); tamam.type = "button"; tamam.className = "dy-pencere-tamam"; tamam.textContent = "Anladım"; alt.append(tamam);
    dlg.append(ust, govde, alt);
    function bitir() { kapat(d); dlg.close(); }
    tamam.addEventListener("click", bitir);
    dlg.addEventListener("cancel", function () { kapat(d); });
    dlg.addEventListener("close", function () { dlg.remove(); goster(kuyruk); });
    document.body.append(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    tamam.focus();
  }

  function baslat() { getir().then(function (v) { var k = v.filter(function (d) { return !kapaliMi(d); }); if (k.length) goster(k); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", baslat); else baslat();
})();
