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

const kok = document.getElementById("mi-kok");
const WORKER = "https://medya-indirici-worker.aeymena.workers.dev";
const SITELER = "YouTube · YouTube Music · X · Instagram · TikTok · Reddit · SoundCloud · Vimeo · Facebook · Twitch · LinkedIn* · NSosyal*";

function secenek(deger, yazi) { return el("option", { value: deger, text: yazi }); }

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "md-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "md-soluk", text: "Bu araca erişim yetkin bulunmuyor." }))); return; }

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
  function sonucuGoster(j) {
    sonuc.replaceChildren(); sonuc.hidden = false;
    if (j.durum === "hazir") {
      sonuc.append(el("p", { class: "md-soluk", text: j.dosya_adi ? `Hazır: ${j.dosya_adi}` : "Hazır." }), baglanti(j.url, "⬇ İndir", j.dosya_adi));
    } else if (j.durum === "secim") {
      sonuc.append(el("p", { class: "md-soluk", text: "Bu gönderide birden çok öğe var; indirmek istediklerini seç:" }));
      (j.secenekler || []).forEach((s, i) => sonuc.append(baglanti(s.url, `⬇ ${s.tur === "photo" ? "Fotoğraf" : s.tur === "gif" ? "GIF" : "Video"} ${i + 1}`)));
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
      const r = await fetch(`${WORKER}/indir`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ url, mod: mod.value, kalite: kalite.value, ses_bicimi: sesBicim.value, ses_kbps: sesKbps.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.hata || `Hizmet hatası (${r.status}).`);
      sonucuGoster(j); bildir("Hazır. İndirme bağlantısı kısa süre geçerlidir.");
    } catch (h) { bildir(h.message || "İşlem başarısız.", true); }
    finally { dugme.disabled = false; }
  }
  dugme.addEventListener("click", hazirla);
  adres.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hazirla(); } });

  const sifirla = () => { adres.value = ""; mod.value = "video"; kalite.value = "1080"; sesBicim.value = "mp3"; sesKbps.value = "320"; sonuc.replaceChildren(); sonuc.hidden = true; bildir(""); dugme.disabled = false; uyg(); };
  sekmeSifirlamaKaydet("tool-medya-indir", sifirla);

  kok.replaceChildren(el("div", { class: "md-kart" },
    el("h2", { text: "🌐 Evrensel Medya İndirici" }),
    el("p", { class: "md-soluk", text: `Desteklenen kaynaklar: ${SITELER}` }),
    adres,
    el("div", { class: "mi-satir" }, el("label", { class: "mi-etiket" }, "Tür", mod)), videoAlani, sesAlani,
    el("div", { class: "md-eylem" }, dugme), mesaj, sonuc,
    el("p", { class: "md-soluk", text: "Gizlilik: bağlantıların ve IP adresin kaydedilmez; medya dosyası Worker'dan geçmez. Yalnızca indirme hakkına sahip olduğun ya da lisansı serbest içerikleri indir; platformların kullanım koşulları ve telif hakları sana aittir." }),
    el("p", { class: "md-soluk", text: "* LinkedIn ve NSosyal, Cobalt tarafından desteklenmez; yalnızca yönetici kendi yt-dlp uç noktasını (YTDLP_API_URL) bağladıysa çalışır. Özel/oturum gerektiren içerikler indirilemez." }),
  ));
}
kur();
