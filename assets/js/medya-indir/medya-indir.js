/*
 * assets/js/medya-indir/medya-indir.js — Araçlar › Medya Araçları › Evrensel Medya İndirici
 *  • Bağlantıyı kendi Worker'ın (medya-indirici-worker) üzerinden açık kaynak çözümleyiciye (Cobalt / kendi yt-dlp uç noktan) iletir.
 *  • Medya baytları Worker'dan geçmez; tarayıcı doğrudan çözümleyici adresinden indirir. Hiçbir bağlantı/IP kaydedilmez.
 *  • Biçimler: Video MP4 4K / 1080p / 720p · Ses MP3 320 / 128 kbps · M4A. CSP: inline stil/olay yok.
 * YASAL: yalnızca indirme hakkına sahip olduğun veya lisansı serbest içerik için kullan.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt } from "../donusturucu/ortak.js";
import { ilerlemeKur, lameYukle, sesCoz, monoOrnekle, mp3Kodla, sleep } from "../medya-donustur/ses-ortak.js";
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
import { sunucuyuTemizle } from "../donusturucu/sunucu-donustur.js";
import { kotaPaneli, kaynakSecici } from "../medya-kota/medya-kota.js";

const kok = document.getElementById("mi-kok");
const WORKER = "https://medya-indirici-worker.aeymena.workers.dev";
const SITELER = "YouTube · YouTube Music · X · Instagram · TikTok · Reddit · SoundCloud · Vimeo · Facebook · Twitch · LinkedIn* · NSosyal*";

function secenek(deger, yazi) { return el("option", { value: deger, text: yazi }); }

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("arac_yetkisi_var_mi", { p_arac: "medya_indir" });
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Bu araca erişim yetkin bulunmuyor. Site Sahibi, Yetki Ayarları › Özellikler bölümünden açabilir." }))); return; }
  const kota = kotaPaneli("medya_indir"), kaynak = kaynakSecici("medya_indir");

  const mesaj = el("p", { class: "md-mesaj", role: "status", "aria-live": "polite" });
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("md-hata", !!h); };
  const adres = el("input", { class: "md-girdi", type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://… (video / ses bağlantısını yapıştır)", "aria-label": "Medya bağlantısı" });
  const mod = el("select", { class: "md-girdi", "aria-label": "Tür" }, secenek("video", "🎬 Video (MP4)"), secenek("ses", "🎵 Yalnızca ses"));
  const kalite = el("select", { class: "md-girdi", "aria-label": "Video kalitesi" }, secenek("2160", "4K (2160p)"), secenek("1080", "1080p"), secenek("720", "720p"));
  kalite.value = "1080";
  const sesBicim = el("select", { class: "md-girdi", "aria-label": "Ses biçimi" }, secenek("mp3", "MP3"), secenek("m4a", "M4A"));
  const sesKbps = el("select", { class: "md-girdi", "aria-label": "Ses kalitesi" }, secenek("320", "320 kbps"), secenek("128", "128 kbps"));
  const sesAlani = el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Biçim", sesBicim), el("label", { class: "mi-etiket" }, "Kalite", sesKbps));
  const videoAlani = el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Kalite", kalite));
  const dugme = el("button", { class: "md-btn md-birincil", type: "button", text: "⬇ Videoyu indir" });
  const sonuc = el("div", { class: "mi-sonuc", hidden: true });
  const uyg = () => { const ses = mod.value === "ses"; dugme.textContent = ses ? `⬇ Sesi indir (${sesBicim.value.toUpperCase()})` : "⬇ Videoyu indir"; sesAlani.hidden = !ses; videoAlani.hidden = ses; sesKbps.disabled = sesBicim.value === "m4a"; };
  mod.addEventListener("change", uyg); sesBicim.addEventListener("change", uyg); uyg();

  const { ilr, cubuk, sureYazi } = ilerlemeKur(bildir);
  const YONTEM = { cobalt: "Cobalt", ytdlp: "yt-dlp", sayfa: "sayfa çözümleyici (kurulumsuz)", dogrudan: "doğrudan dosya" };
  const VIDEO_UZ = /\.(mp4|m4v|webm|mov|mkv)$/i, BUYUK = 300 * 1024 * 1024;
  const adHazirla = (ad, url) => { let a = (ad || "").trim(); if (!a) { try { a = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { a = ""; } } return (a || "medya").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").slice(0, 120); };

  /** Tek adımda indirir: ilerleme + kalan süre gösterir; ses modunda kaynak video geldiyse sesi tarayıcıda MP3'e çıkarır. */
  async function indirmeyiBaslat(url, adHam) {
    let ad = adHazirla(adHam, url); const sesMi = mod.value === "ses";
    dugme.disabled = true; sonuc.hidden = false;
    try {
      ilr.baslat("İndiriliyor", 30);
      let r; try { r = await fetch(url); } catch { r = null; }
      if (!r || !r.ok) throw Object.assign(new Error("tarayici-engeli"), { yedek: true });
      const toplam = Number(r.headers.get("content-length")) || 0;
      if (toplam > BUYUK) throw Object.assign(new Error("buyuk"), { yedek: true });
      const okuyucu = r.body.getReader(), parcalar = []; let alinan = 0;
      for (;;) { const { done, value } = await okuyucu.read(); if (done) break; parcalar.push(value); alinan += value.length; ilr.guncelle(toplam ? alinan / toplam : null, `İndiriliyor · ${bayt(alinan)}${toplam ? ` / ${bayt(toplam)}` : ""}`); }
      let blob = new Blob(parcalar, { type: r.headers.get("content-type") || "application/octet-stream" });
      if (sesMi && (VIDEO_UZ.test(ad) || /^video\//.test(blob.type))) {
        if (blob.size > 250 * 1024 * 1024) { bildir("Kaynak yalnızca video verdi ve ses çıkarmak için çok büyük; video olarak kaydedildi (Ses & Video aracıyla MP3'e çevirebilirsin).", true); }
        else {
          ilr.baslat("Kaynak video verdi — ses MP3'e çıkarılıyor", Math.max(4, blob.size / (10 * 1024 * 1024)));
          const lame = await lameYukle(), tampon = await sesCoz(new File([blob], ad)), f32 = await monoOrnekle(tampon); await sleep();
          blob = mp3Kodla(lame, f32, Number(sesKbps.value) || 128, (p) => ilr.guncelle(p, "MP3 kodlanıyor")); ad = ad.replace(/\.[^.]+$/, "") + ".mp3";
        }
      }
      ilr.bitir(); indir(blob, ad); bildir(`✔ İndirildi: ${ad} (${bayt(blob.size)}). Bir sonraki bağlantıyı yapıştırabilirsin.`);
    } catch (h) {
      ilr.bitir();
      if (h?.yedek) {                                   // CORS/büyük dosya: tarayıcıya doğrudan indirtir (sayfadan ayrılmadan, "attachment" yanıtı)
        const a = el("a", { href: url, rel: "noopener noreferrer" }); a.setAttribute("download", ad); document.body.append(a); a.click(); a.remove();
        bildir("İndirme tarayıcı tarafından başlatıldı (ilerleme bu kaynakta gösterilemiyor). Başlamazsa aşağıdaki bağlantıyı kullan.");
        sonuc.append(el("a", { class: "md-btn", href: url, target: "_blank", rel: "noopener noreferrer", text: "Başlamadıysa: bağlantıyı yeni sekmede aç" }));
      } else bildir(h?.message || "İndirme başarısız.", true);
    } finally { dugme.disabled = false; }
  }
  function ffmpegKutusu(url) {
    const komut = `ffmpeg -i "${url}" -c copy video.mp4`, kop = el("button", { type: "button", class: "md-btn", text: "📋 ffmpeg komutunu kopyala" });
    kop.addEventListener("click", async () => { try { await navigator.clipboard.writeText(komut); bildir("✔ Komut kopyalandı."); } catch { bildir("Pano erişimi reddedildi.", true); } });
    return el("div", { class: "mi-akis" }, el("p", { class: "md-soluk", text: "Bu bir HLS akışıdır (parçalı yayın); tarayıcı tek dosya olarak indiremez. Bağlantıyı VLC'de açabilir (Medya › Akışı Dönüştür/Kaydet) ya da ffmpeg ile kaydedebilirsin." }), kop);
  }
  const TUR = { photo: "🖼 Fotoğraf", gif: "🎞 GIF", ses: "🎵 Ses", video: "🎬 Video" };
  function sonucuGoster(j) {
    sonuc.replaceChildren(); sonuc.hidden = false;
    const not = el("p", { class: "md-soluk", text: `Yöntem: ${YONTEM[j.yontem] || j.yontem || "—"}${j.kaynak === "kendi" ? " · kendi çözümleyicin (kotadan düşmedi)" : ""}` });
    if (j.durum === "hazir" && j.tur !== "akis") { sonuc.append(not); indirmeyiBaslat(j.url, j.dosya_adi); return; }       // tek seçenek → hemen indir
    if (j.durum === "hazir") { sonuc.append(not, el("a", { class: "md-btn md-birincil", href: j.url, target: "_blank", rel: "noopener noreferrer", text: "🔗 Akış bağlantısını aç" }), ffmpegKutusu(j.url)); return; }
    if (j.durum === "secim") {
      sonuc.append(el("p", { class: "md-soluk", text: j.baslik ? `“${j.baslik}” sayfasında ${j.secenekler?.length || 0} medya bulundu. İndirmek istediğin satırın “İndir” düğmesine bas:` : "Birden çok öğe bulundu. İndirmek istediğin satırın “İndir” düğmesine bas:" }), not);
      const liste = el("ul", { class: "mi-liste" });
      (j.secenekler || []).forEach((x, i) => {
        const satir = el("li", { class: "mi-liste-satir" });
        if (x.tur === "akis") { satir.append(el("span", { text: `📡 Akış ${i + 1} (HLS — tarayıcıda indirilemez)` }), el("a", { class: "md-btn", href: x.url, target: "_blank", rel: "noopener noreferrer", text: "Aç" })); }
        else { const b = el("button", { type: "button", class: "md-btn md-birincil", text: "⬇ İndir" }); b.addEventListener("click", () => indirmeyiBaslat(x.url, "")); satir.append(el("span", { text: `${TUR[x.tur] || TUR.video} ${i + 1}` }), b); }
        liste.append(satir);
      });
      if (j.ses_url) { const b = el("button", { type: "button", class: "md-btn", text: "⬇ İndir" }); b.addEventListener("click", () => indirmeyiBaslat(j.ses_url, "ses.mp3")); liste.append(el("li", { class: "mi-liste-satir" }, el("span", { text: "🎵 Gönderinin sesi" }), b)); }
      sonuc.append(liste);
    }
  }
  async function hazirla() {
    const url = adres.value.trim();
    if (!/^https?:\/\//i.test(url)) { bildir("Geçerli bir http(s) bağlantısı gir.", true); return; }
    dugme.disabled = true; sonuc.hidden = true; ilr.baslat("Bağlantı çözümleniyor (ücretsiz sunucu uykudaysa ilk istek 30–60 sn sürebilir)", 25);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Oturum bulunamadı; yeniden giriş yap.");
      const sunucu = kaynak.hazirla();
      const r = await fetch(`${WORKER}/indir`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...sunucu.basliklar }, body: JSON.stringify({ url, mod: mod.value, kalite: kalite.value, ses_bicimi: sesBicim.value, ses_kbps: sesKbps.value }) });
      const j = await r.json().catch(() => ({}));
      ilr.bitir();
      if (!r.ok) throw new Error(j.kapali ? "Medya indirici servisi Site Sahibi tarafından geçici olarak kapatılmış." : (j.hata || j.error || `Hizmet hatası (${r.status}).`));
      if (j.kota) kota.yenile(j.kota);
      sonucuGoster(j);
    } catch (h) { ilr.bitir(); bildir(h.message || "İşlem başarısız.", true); kota.yenile(); }
    finally { dugme.disabled = false; }
  }
  dugme.addEventListener("click", hazirla);
  adres.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hazirla(); } });

  const sifirla = () => { adres.value = ""; mod.value = "video"; kalite.value = "1080"; sesBicim.value = "mp3"; sesKbps.value = "320"; sonuc.replaceChildren(); sonuc.hidden = true; ilr.bitir(); bildir(""); dugme.disabled = false; uyg(); };
  sekmeSifirlamaKaydet("tool-medya-indir", sifirla);
  const temizleBtn = el("button", { type: "button", class: "md-btn", text: "🧹 Belleği ve sunucuyu sıfırla", title: "Adres, sonuçlar ve bellekteki veriler silinir; sunucudaki geçici klasörler hemen temizlenir" });
  temizleBtn.addEventListener("click", async () => {
    temizleBtn.disabled = true; sifirla();
    const r = await sunucuyuTemizle();
    bildir(`Tarayıcı belleği temizlendi. ${r.mesaj}`, !r.ok); temizleBtn.disabled = false;
  });

  kok.replaceChildren(el("div", { class: "md-kart" },
    el("h2", { text: "🌐 Evrensel Medya İndirici" }),
    el("p", { class: "md-soluk", text: `Bilinen kaynaklar: ${SITELER}. Başka bir sitedeki video/ses bağlantısı ya da medya içeren sayfa da denenir (kurulum gerekmez).` }),
    adres,
    el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Tür", mod)), videoAlani, sesAlani,
    el("div", { class: "md-eylem" }, dugme, temizleBtn), cubuk, sureYazi, mesaj, sonuc,
    el("p", { class: "md-soluk", text: "Gizlilik: bağlantıların ve IP adresin kaydedilmez; medya dosyası Worker'dan geçmez. Gizlilik/anonimlik korumaları, DRM ve oturum gerektiren içerikler aşılmaz. Yalnızca indirme hakkına sahip olduğun ya da lisansı serbest içerikleri indir; platformların kullanım koşulları ve telif hakları sana aittir." }),
    el("p", { class: "md-soluk", text: "* LinkedIn ve NSosyal yalnızca yt-dlp çözümleyicisi bağlıysa (sistem ya da senin kendi çözümleyicin) çalışır." }),
  ), kota.kok, kaynak.kok);
}
kur();
