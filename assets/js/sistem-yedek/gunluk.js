/*
 * assets/js/sistem-yedek/gunluk.js — Dışa Aktarma Denetim Günlüğü (SADECE owner).
 * Satır satır silme + "Tüm Günlüğü Temizle". Gerçek yetki: owner_sistem_export_* RPC'leri (is_owner()).
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, tarihMetni, hataMetni, BILESENLER } from "./ortak.js";

const SAYFA = 25;
const DURUM = { basladi: "Başladı", tamamlandi: "Tamamlandı", basarisiz: "Başarısız", gunluk_temizlendi: "Günlük temizlendi" };
const ADLAR = Object.fromEntries(BILESENLER.map((b) => [b.id, b.ad]));

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
      if (!window.confirm("Bu günlük kaydı kalıcı olarak silinsin mi?")) return;
      const { error: e } = await supabase.rpc("owner_sistem_export_logu_sil", { p_id: s.id });
      if (e) return mesaj(hataMetni(e), "error");
      mesaj("Kayıt silindi.", "success");
      if (satirlar.length === 1 && ofset > 0) ofset = Math.max(0, ofset - SAYFA);
      yukle();
    };
    const temizle = async () => {
      if (!window.confirm(`Tüm günlük (${toplam} kayıt) kalıcı olarak silinsin mi? Geriye yalnızca "günlük temizlendi" notu kalır.`)) return;
      const { data: n, error: e } = await supabase.rpc("owner_sistem_export_logunu_temizle");
      if (e) return mesaj(hataMetni(e), "error");
      mesaj(`${n} kayıt silindi.`, "success");
      ofset = 0;
      yukle();
    };

    const tablo = satirlar.length
      ? el("div", { class: "sy-tablo-kap" }, el("table", { class: "sy-tablo" },
          el("thead", {}, el("tr", {}, ["Tarih", "Kullanıcı", "Bileşenler", "Kapsam", "Boyut", "IP", "Durum", ""].map((b) => el("th", { scope: "col", text: b })))),
          el("tbody", {}, satirlar.map((s) => el("tr", {},
            el("td", { text: tarihMetni(s.olusturma_tarihi) }),
            el("td", { text: s.kullanici_eposta || "—" }),
            el("td", { text: (s.indirilen_bilesenler || []).map((b) => ADLAR[b] || b).join(", ") }),
            el("td", { text: s.kapsam === "tum" ? "Tüm sistem" : "Kendi" }),
            el("td", { text: s.dosya_boyutu == null ? "—" : bayt(s.dosya_boyutu) }),
            el("td", { text: s.ip_adresi || "—" }),
            el("td", {}, el("span", { class: `sy-rozet sy-rozet--d-${s.durum}`, text: DURUM[s.durum] || s.durum })),
            el("td", {}, el("button", { type: "button", class: "btn sy-tehlike-kucuk", text: "Sil", "aria-label": "Bu kaydı sil", onclick: () => sil(s) }))
          )))
        ))
      : el("p", { class: "muted", text: "Henüz dışa aktarma yapılmadı." });

    const onceki = el("button", { type: "button", class: "btn sy-ikincil", text: "← Yeni", disabled: ofset === 0, onclick: () => { ofset = Math.max(0, ofset - SAYFA); yukle(); } });
    const sonraki = el("button", { type: "button", class: "btn sy-ikincil", text: "Eski →", disabled: ofset + SAYFA >= toplam, onclick: () => { ofset += SAYFA; yukle(); } });

    kok.replaceChildren(
      el("div", { class: "sy-gunluk-ust" },
        el("p", { class: "muted", text: `${toplam.toLocaleString("tr-TR")} kayıt` }),
        el("button", { type: "button", class: "btn sy-tehlike", text: "Tüm Günlüğü Temizle", disabled: toplam === 0, onclick: temizle })
      ),
      tablo,
      el("div", { class: "sy-sayfalama" }, onceki, el("span", { class: "muted", text: toplam ? `${ofset + 1}–${Math.min(ofset + SAYFA, toplam)}` : "" }), sonraki)
    );
  };

  await yukle();
}
