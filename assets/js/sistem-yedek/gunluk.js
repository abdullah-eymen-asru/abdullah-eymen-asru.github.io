/*
 * assets/js/sistem-yedek/gunluk.js — Dışa Aktarma Denetim Günlüğü (SADECE owner).
 * Satır satır silme + "Tüm Günlüğü Temizle". Gerçek yetki: owner_sistem_export_* RPC'leri (is_owner()).
 * Düğmeler her temada okunur (sy-btn), onaylar uygulama içi pencereyle alınır. innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, tarihMetni, hataMetni, dugme, onayIste, BILESENLER } from "./ortak.js";

const SAYFA = 25;
const DURUM = { basladi: "Başladı", tamamlandi: "Tamamlandı", basarisiz: "Başarısız", gunluk_temizlendi: "Günlük temizlendi" };
const ADLAR = Object.fromEntries(BILESENLER.map((b) => [b.id, b.ad]));

function kapsamMetni(s) {
  if (s.kapsam === "tum") return "Tüm sistem";
  if (s.kapsam === "secili") return s.hedef_adlari ? `Seçili üyeler: ${s.hedef_adlari}` : "Seçili üyeler";
  return "Yalnızca kendi verileri";
}

export async function gunlukCiz(kok, mesaj) {
  let ofset = 0;

  const yukle = async () => {
    const { data, error } = await supabase.rpc("owner_sistem_export_loglari", { p_limit: SAYFA, p_ofset: ofset });
    if (error) {
      kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) }));
      return;
    }
    const satirlar = data || [];
    const toplam = satirlar[0] ? Number(satirlar[0].toplam) : 0;

    const sil = async (s) => {
      const tamam = await onayIste({
        baslik: "Günlük kaydı silinsin mi?",
        metin: `${tarihMetni(s.olusturma_tarihi)} tarihli kayıt kalıcı olarak silinir. Bu işlem geri alınamaz.`,
        tamam: "Kaydı sil",
        tehlike: true,
      });
      if (!tamam) return;
      const { error: e } = await supabase.rpc("owner_sistem_export_logu_sil", { p_id: s.id });
      if (e) return mesaj(hataMetni(e), "error");
      mesaj("Kayıt silindi.", "success");
      if (satirlar.length === 1 && ofset > 0) ofset = Math.max(0, ofset - SAYFA);
      yukle();
    };
    const temizle = async () => {
      const tamam = await onayIste({
        baslik: "Tüm günlük temizlensin mi?",
        metin: [
          `${toplam.toLocaleString("tr-TR")} kayıt kalıcı olarak silinir.`,
          'Geriye yalnızca kimin, ne zaman, kaç kayıt temizlediğini gösteren tek bir "günlük temizlendi" notu kalır.',
        ],
        tamam: "Hepsini sil",
        tehlike: true,
      });
      if (!tamam) return;
      const { data: n, error: e } = await supabase.rpc("owner_sistem_export_logunu_temizle");
      if (e) return mesaj(hataMetni(e), "error");
      mesaj(`${n} kayıt silindi.`, "success");
      ofset = 0;
      yukle();
    };

    const etiketli = (etiket, ...cocuk) => el("td", { "data-etiket": etiket }, ...cocuk);
    const tablo = satirlar.length
      ? el("div", { class: "sy-tablo-kap" }, el("table", { class: "sy-tablo" },
          el("thead", {}, el("tr", {}, ["Tarih", "Kullanıcı", "Bileşenler", "Kapsam", "Boyut", "IP", "Durum", ""].map((b) => el("th", { scope: "col", text: b })))),
          el("tbody", {}, satirlar.map((s) => el("tr", {},
            etiketli("Tarih", tarihMetni(s.olusturma_tarihi)),
            etiketli("Kullanıcı", s.kullanici_eposta || "—"),
            etiketli("Bileşenler", (s.indirilen_bilesenler || []).map((b) => ADLAR[b] || b).join(", ")),
            etiketli("Kapsam", kapsamMetni(s)),
            etiketli("Boyut", s.dosya_boyutu == null ? "—" : bayt(s.dosya_boyutu)),
            etiketli("IP", s.ip_adresi || "—"),
            etiketli("Durum", el("span", { class: `sy-rozet sy-rozet--d-${s.durum}`, text: DURUM[s.durum] || s.durum })),
            etiketli("", dugme({ metin: "Sil", ikonAdi: "cop", tur: "tehlike-hafif", kucuk: true, "aria-label": `${tarihMetni(s.olusturma_tarihi)} tarihli kaydı sil`, onclick: () => sil(s) }))
          )))
        ))
      : el("p", { class: "muted", text: "Henüz dışa aktarma yapılmadı." });

    const onceki = dugme({ metin: "Daha yeni", tur: "ikincil", kucuk: true, disabled: ofset === 0, onclick: () => { ofset = Math.max(0, ofset - SAYFA); yukle(); } });
    const sonraki = dugme({ metin: "Daha eski", tur: "ikincil", kucuk: true, disabled: ofset + SAYFA >= toplam, onclick: () => { ofset += SAYFA; yukle(); } });

    kok.replaceChildren(
      el("div", { class: "sy-gunluk-ust" },
        el("p", { class: "muted", text: `${toplam.toLocaleString("tr-TR")} kayıt` }),
        dugme({ metin: "Tüm günlüğü temizle", ikonAdi: "cop", tur: "tehlike-hafif", disabled: toplam === 0, onclick: temizle })
      ),
      tablo,
      el("div", { class: "sy-sayfalama" }, onceki, el("span", { class: "muted", text: toplam ? `${ofset + 1}–${Math.min(ofset + SAYFA, toplam)} / ${toplam.toLocaleString("tr-TR")}` : "" }), sonraki)
    );
  };

  await yukle();
}
