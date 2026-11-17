/*
 * assets/js/medya-indir/medya-indir.js — Araçlar › Medya Araçları › Evrensel Medya İndirici
 *  • Bağlantıyı kendi Worker'ın (medya-indirici-worker) üzerinden açık kaynak çözümleyiciye (Cobalt / kendi yt-dlp uç noktan) iletir.
 *  • Medya baytları Worker'dan geçmez; tarayıcı doğrudan çözümleyici adresinden indirir. Hiçbir bağlantı/IP kaydedilmez.
 *  • Biçimler: Video MP4 4K / 1080p / 720p · Ses MP3 320 / 128 kbps · M4A. CSP: inline stil/olay yok.
 * YASAL: yalnızca indirme hakkına sahip olduğun veya lisansı serbest içerik için kullan.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni } from "../donusturucu/ortak.js";
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
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
  const dugme = el("button", { class: "md-btn md-birincil", type: "button", text: "İndirme bağlantısını hazırla" });
  const sonuc = el("div", { class: "mi-sonuc", hidden: true });
  const uyg = () => { const ses = mod.value === "ses"; sesAlani.hidden = !ses; videoAlani.hidden = ses; sesKbps.disabled = sesBicim.value === "m4a"; };
  mod.addEventListener("change", uyg); sesBicim.addEventListener("change", uyg); uyg();

  function baglanti(url, yazi, ad) {
    const a = el("a", { class: "md-btn md-birincil mi-indir", href: url, target: "_blank", rel: "noopener noreferrer", text: yazi });
    if (ad) a.setAttribute("download", ad);
    return a;
  }
  const YONTEM = { cobalt: "Cobalt", ytdlp: "yt-dlp", sayfa: "sayfa çözümleyici (kurulumsuz)", dogrudan: "doğrudan dosya" };
  function ffmpegKutusu(url) {
    const komut = `ffmpeg -i "${url}" -c copy video.mp4`, kop = el("button", { type: "button", class: "md-btn", text: "📋 ffmpeg komutunu kopyala" });
    kop.addEventListener("click", async () => { try { await navigator.clipboard.writeText(komut); bildir("✔ Komut kopyalandı."); } catch { bildir("Pano erişimi reddedildi.", true); } });
    return el("div", { class: "mi-akis" }, el("p", { class: "md-soluk", text: "Bu bir HLS akışıdır (parçalı yayın); tarayıcı tek dosya olarak indiremez. Bağlantıyı VLC'de açabilir (Medya › Akışı Dönüştür/Kaydet) ya da ffmpeg ile kaydedebilirsin." }), kop);
  }
  function sonucuGoster(j) {
    sonuc.replaceChildren(); sonuc.hidden = false;
    const not = el("p", { class: "md-soluk", text: `Yöntem: ${YONTEM[j.yontem] || j.yontem || "—"}${j.kaynak === "kendi" ? " · kendi çözümleyicin (kotadan düşmedi)" : ""}` });
    if (j.durum === "hazir") {
      sonuc.append(el("p", { class: "md-soluk", text: j.dosya_adi ? `Hazır: ${j.dosya_adi}` : "Hazır." }), not);
      if (j.tur === "akis") sonuc.append(baglanti(j.url, "🔗 Akış bağlantısını aç"), ffmpegKutusu(j.url)); else sonuc.append(baglanti(j.url, "⬇ İndir", j.dosya_adi));
    } else if (j.durum === "secim") {
      sonuc.append(el("p", { class: "md-soluk", text: j.baslik ? `“${j.baslik}” sayfasında bulunan medya bağlantıları — indirmek istediğini seç:` : "Birden çok öğe bulundu; indirmek istediklerini seç:" }), not);
      (j.secenekler || []).forEach((x, i) => {
        if (x.tur === "akis") { sonuc.append(baglanti(x.url, `📡 Akış ${i + 1} (HLS)`), ffmpegKutusu(x.url)); return; }
        sonuc.append(baglanti(x.url, `⬇ ${x.tur === "photo" ? "Fotoğraf" : x.tur === "gif" ? "GIF" : x.tur === "ses" ? "Ses" : "Video"} ${i + 1}`));
      });
      if (j.ses_url) sonuc.append(baglanti(j.ses_url, "⬇ Ses"));
    }
  }
  async function hazirla() {
    const url = adres.value.trim();
    if (!/^https?:\/\//i.test(url)) { bildir("Geçerli bir http(s) bağlantısı gir.", true); return; }
    dugme.disabled = true; sonuc.hidden = true; bildir("Bağlantı çözümleniyor…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Oturum bulunamadı; yeniden giriş yap.");
      const sunucu = kaynak.hazirla();
      const r = await fetch(`${WORKER}/indir`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...sunucu.basliklar }, body: JSON.stringify({ url, mod: mod.value, kalite: kalite.value, ses_bicimi: sesBicim.value, ses_kbps: sesKbps.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.kapali ? "Medya indirici servisi Site Sahibi tarafından geçici olarak kapatılmış." : (j.hata || j.error || `Hizmet hatası (${r.status}).`));
      sonucuGoster(j); if (j.kota) kota.yenile(j.kota); bildir("Hazır. İndirme bağlantısı kısa süre geçerlidir.");
    } catch (h) { bildir(h.message || "İşlem başarısız.", true); kota.yenile(); }
    finally { dugme.disabled = false; }
  }
  dugme.addEventListener("click", hazirla);
  adres.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hazirla(); } });

  const sifirla = () => { adres.value = ""; mod.value = "video"; kalite.value = "1080"; sesBicim.value = "mp3"; sesKbps.value = "320"; sonuc.replaceChildren(); sonuc.hidden = true; bildir(""); dugme.disabled = false; uyg(); };
  sekmeSifirlamaKaydet("tool-medya-indir", sifirla);

  kok.replaceChildren(el("div", { class: "md-kart" },
    el("h2", { text: "🌐 Evrensel Medya İndirici" }),
    el("p", { class: "md-soluk", text: `Bilinen kaynaklar: ${SITELER}. Başka bir sitedeki video/ses bağlantısı ya da medya içeren sayfa da denenir (kurulum gerekmez).` }),
    adres,
    el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Tür", mod)), videoAlani, sesAlani,
    el("div", { class: "md-eylem" }, dugme), mesaj, sonuc,
    el("p", { class: "md-soluk", text: "Gizlilik: bağlantıların ve IP adresin kaydedilmez; medya dosyası Worker'dan geçmez. Gizlilik/anonimlik korumaları, DRM ve oturum gerektiren içerikler aşılmaz. Yalnızca indirme hakkına sahip olduğun ya da lisansı serbest içerikleri indir; platformların kullanım koşulları ve telif hakları sana aittir." }),
    el("p", { class: "md-soluk", text: "* LinkedIn ve NSosyal yalnızca yt-dlp çözümleyicisi bağlıysa (sistem ya da senin kendi çözümleyicin) çalışır." }),
  ), kota.kok, kaynak.kok);
}
kur();
