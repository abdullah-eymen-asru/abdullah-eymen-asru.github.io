/* Paylaşılan dosya adresleri (GitHub Pages'te 404 olarak gelir) için DOSYA KARTI — yönlendirme/sıçrama YOK (tur 20).
 *   /d/<slug>  ·  /m/<yazi>/<dosya>  ·  /<yazi>/<dosya.uzanti>
 * Sayfa hemen "yükleniyor" kartına dönüşür (404 metni görünmez); dosya bilgisi Worker'dan (?json=1) gelir ve aynı sayfada gösterilir:
 * ad, tür, boyut, tarih + "Dosyayı indir" düğmesi + (indirme çalışmazsa) kopyalanabilir indirme adresi. Her cihazda çalışır; JS engellenirse düz bağlantı kalır. */
(function () {
  var WORKER = "https://r2-arsiv-worker.aeymena.workers.dev", yol = location.pathname, hedef = null;
  var mm = yol.match(/^\/m\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150})$/);
  var tm = yol.match(/^\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.[A-Za-z0-9]{1,10})$/);
  var dm = yol.match(/^\/d\/([A-Za-z0-9-]{6,80})\/?$/);
  if (mm) hedef = WORKER + "/m/" + mm[1] + "/" + encodeURIComponent(mm[2]);
  else if (tm) hedef = WORKER + "/m/" + tm[1] + "/" + encodeURIComponent(tm[2]);
  else if (dm) hedef = WORKER + "/d/" + dm[1].toLowerCase();
  if (!hedef) return;
  document.title = "Paylaşılan dosya";
  function yap(t, c, m) { var e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
  function boyut(n) { n = Number(n); if (!(n >= 0)) return "—"; var b = ["B", "KB", "MB", "GB", "TB"], i = 0; while (n >= 1024 && i < b.length - 1) { n /= 1024; i++; } return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + " " + b[i]; }
  function tarih(t) { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(t)); } catch (e) { return ""; } }
  function kapsayici() { var ana = document.querySelector("main") || document.body, kok = ana.querySelector(".page-content, article, .post") || ana; return kok; }
  function goster(ic) { kapsayici().replaceChildren(ic); }
  var yukleniyor = yap("div", "dosya-karti"); yukleniyor.append(yap("h1", null, "Dosya bilgisi yükleniyor…"), yap("p", null, "Birkaç saniye sürebilir."));
  function kur() { goster(yukleniyor); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kur); else kur();

  fetch(hedef + "?json=1", { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) { return r.json().catch(function () { return { durum: "hata" }; }); }).then(function (b) {
    var k = yap("div", "dosya-karti");
    if (b.durum === "yok" || b.durum === "hata" || b.durum === "dosya_yok" || b.durum === "kapali" || b.durum === "doldu" || b.durum === "iptal") {
      var baslik = { yok: "Bağlantı bulunamadı", hata: "Şimdilik açılamıyor", dosya_yok: "Dosya artık yok", kapali: "Medya geçici olarak kapalı", doldu: "Bağlantının süresi doldu", iptal: "Bağlantı iptal edildi" }[b.durum];
      k.append(yap("h1", null, baslik), yap("p", null, b.durum === "hata" ? "Bağlantı doğrulanamadı. Biraz sonra tekrar dene." : "Bu paylaşım bağlantısı geçerli değil. Dosyayı sana gönderen kişiden yeni bir bağlantı iste."));
      goster(k); return;
    }
    k.append(yap("div", "dosya-ikon", /^image\//.test(b.mime || "") ? "🖼️" : b.mime === "application/pdf" ? "📕" : "📄"), yap("h1", null, b.ad || b.dosya_ad));
    if (b.aciklama) k.append(yap("p", "dosya-aciklama", b.aciklama));
    if (b.riskli) k.append(yap("p", "dosya-uyari", "⚠️ Bu dosya türü çalıştırılabilir olabilir. Yalnızca göndereni tanıyorsan ve güveniyorsan aç."));
    var dl = yap("dl", "dosya-bilgi");
    [["Dosya adı", b.dosya_ad || b.ad], ["Boyut", boyut(b.boyut)], ["Tür", b.mime || "—"], ["Paylaşım", tarih(b.olusturma)], ["Geçerlilik", b.bitis ? tarih(b.bitis) + " tarihine kadar" : "Süresiz"]].forEach(function (s) { dl.append(yap("dt", null, s[0]), yap("dd", null, s[1])); });
    var a = yap("a", "dosya-btn dosya-btn-ana", "⬇ Dosyayı indir"); a.href = b.indir; a.rel = "nofollow";
    var eylem = yap("div", "dosya-eylem"); eylem.append(a);
    if (b.onizle && (/^image\//.test(b.mime || "") || b.mime === "application/pdf" || /^(audio|video)\//.test(b.mime || ""))) { var o = yap("a", "dosya-btn", "👁 Aç / Önizle"); o.href = b.onizle; o.target = "_blank"; o.rel = "noopener nofollow"; eylem.append(o); }
    var yedek = yap("div", "dosya-yedek"), girdi = yap("input"); girdi.type = "text"; girdi.readOnly = true; girdi.value = b.indir; girdi.setAttribute("aria-label", "İndirme adresi");
    girdi.addEventListener("focus", function () { girdi.select(); });
    var kop = yap("button", "dosya-btn", "📋 Adresi kopyala"); kop.type = "button";
    kop.addEventListener("click", function () { (navigator.clipboard ? navigator.clipboard.writeText(b.indir) : Promise.reject()).then(function () { kop.textContent = "✔ Kopyalandı"; }, function () { girdi.select(); kop.textContent = "Seçildi: kopyala (Ctrl/⌘+C)"; }); });
    yedek.append(yap("p", "dosya-ipucu", "İndirme çalışmazsa bağlantıyı kopyalayıp tarayıcıya yapıştırabilirsiniz."), girdi, kop);
    k.append(dl, eylem, yedek); goster(k);
  }).catch(function () { var k = yap("div", "dosya-karti"); var a = yap("a", "dosya-btn dosya-btn-ana", "Dosya sayfasını aç"); a.href = hedef; k.append(yap("h1", null, "Dosya bilgisi alınamadı"), yap("p", null, "Doğrudan açmayı dene:"), a); goster(k); });
})();
