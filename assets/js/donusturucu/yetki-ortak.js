/*
 * assets/js/donusturucu/yetki-ortak.js — can_use_converter anahtarlarının arayüzü (Yetki Ayarları sekmesi + araç içi "Erişim").
 * Gerçek yetki sınırı VERİTABANINDADIR (migration 0077): bu dosya yalnızca arayüzdür.
 *  - owner : tüm roller (admin dahil) + "adminler de yönetebilsin" anahtarı
 *  - yetkili admin (owner izin verdiyse) : admin DIŞINDAKİ roller
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { el, hataMetni } from "./ortak.js";

const ROLLER = {
  admin: "Yönetici (admin)",
  manager: "İçerik Sorumlusu (manager)",
  editor: "Yazar (editor)",
  special_user: "Özel Üye (special_user)",
  user: "Standart Üye (user)",
};

/** @param {HTMLElement} kok  @param {HTMLElement|null} mesaj */
export async function yetkiPaneliniKur(kok, mesaj) {
  const bildir = (m, t) => { if (mesaj) showMessage(mesaj, m, t); };
  const { data, error } = await supabase.rpc("donusturucu_yetkilerini_getir");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  const satirlar = data || [];
  const sahipMi = satirlar[0]?.owner_mi === true;
  const yonetebilir = satirlar[0]?.admin_yonetebilir === true;

  const anahtar = (r) => {
    const id = `dn-izin-${r.rol}`;
    const k = el("input", { type: "checkbox", role: "switch", id, "aria-label": `${ROLLER[r.rol]} için can_use_converter` });
    k.checked = !!r.can_use_converter;
    k.addEventListener("change", async () => {
      k.disabled = true;
      const { error: e } = await supabase.rpc("donusturucu_yetkisi_ayarla", { p_rol: r.rol, p_izinli: k.checked });
      k.disabled = false;
      if (e) { k.checked = !k.checked; bildir(hataMetni(e), "error"); return; }
      bildir(`${ROLLER[r.rol]}: dönüştürücü ${k.checked ? "AÇILDI" : "kapatıldı"}.`, "success");
    });
    return el("div", { class: "dn-yetki-satir" },
      el("label", { for: id }, el("strong", { text: ROLLER[r.rol] || r.rol }), el("p", { class: "dn-muted", text: r.updated_at ? `Son değişiklik: ${new Date(r.updated_at).toLocaleString("tr-TR")}` : "Varsayılan: kapalı" })),
      k);
  };

  const parcalar = [
    el("div", { class: "dn-yetki-satir" },
      el("div", {}, el("strong", { text: "Site Sahibi (owner)" }), el("p", { class: "dn-muted", text: "Her zaman yetkili." })),
      el("span", { class: "dn-rozet", text: "Her zaman açık" })),
    ...satirlar.map(anahtar),
  ];

  if (sahipMi) {
    const k = el("input", { type: "checkbox", role: "switch", id: "dn-admin-yonet", "aria-label": "Adminler diğer rollerin dönüştürücü erişimini yönetebilsin" });
    k.checked = yonetebilir;
    k.addEventListener("change", async () => {
      k.disabled = true;
      const { error: e } = await supabase.rpc("owner_donusturucu_admin_yonetimi_ayarla", { p_acik: k.checked });
      k.disabled = false;
      if (e) { k.checked = !k.checked; bildir(hataMetni(e), "error"); return; }
      bildir(`Adminler dönüştürücü erişimini yönetme: ${k.checked ? "AÇIK" : "kapalı"}.`, "success");
    });
    parcalar.push(el("div", { class: "dn-yetki-satir" },
      el("label", { for: "dn-admin-yonet" }, el("strong", { text: "Adminler de yönetebilsin" }), el("p", { class: "dn-muted", text: "Açıkken yöneticiler; manager, editor, özel üye ve standart üye için aracı açıp kapatabilir. Admin rolünün kendi anahtarını ve bu ayarı yalnızca Site Sahibi değiştirir." })),
      k));
  }
  kok.replaceChildren(el("div", { class: "dn-yetki-liste" }, ...parcalar),
    el("p", { class: "dn-muted", text: "Araç tamamen tarayıcıda çalışır; dosyalar sunucuya gitmez. Bu anahtarlar yalnızca menüde görünürlüğü ve sayfaya erişimi (Guard) belirler." }));
}
