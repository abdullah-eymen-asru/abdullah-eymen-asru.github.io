/*
 * assets/js/uye-disa-aktar/uye-disa-aktar.js — Üye Ayarları > "Üye bilgilerini dışa aktar"
 * -----------------------------------------------------------------------
 * Pencere + indirme. Veri YALNIZCA uye_verisi_disa_aktar() RPC'sinden gelir; hangi üyelerin gelebileceğini
 * veritabanı belirler (migration 0069: Site Sahibi tümünü; yönetici ise Site Sahibi'nin verdiği kapsam kadarını).
 * Bu dosya yalnızca arayüzdür: butonu gizlemek/göstermek güvenlik DEĞİL, kolaylıktır.
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";

function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

const BICIMLER = [
  { id: "csv", ad: "CSV", ipucu: "Mailchimp, Brevo, Google Contacts vb. için", uzanti: "csv" },
  { id: "xlsx", ad: "Excel (.xlsx)", ipucu: "Süzgeç ve sabit başlık satırıyla", uzanti: "xlsx" },
  { id: "txt", ad: "TXT", ipucu: "Düz metin; \"yalnızca e-posta\" ile satır satır liste", uzanti: "txt" },
  { id: "pdf", ad: "PDF", ipucu: "Yazdırmaya hazır, kart düzeninde", uzanti: "pdf" },
];
const ROLLER = [["", "Tüm roller (yetki kapsamımdaki)"], ["user", "Üye"], ["special_user", "Özel Üye"], ["editor", "Editör"], ["manager", "İçerik Sorumlusu"], ["admin", "Yönetici"]];

function indir(blob, ad) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: ad, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function uyeDisaAktarAc({ bildir = () => {}, yazar = "" } = {}) {
  const d = el("dialog", { class: "uya-dlg" });
  let bicim = "csv";

  const bicimGrubu = el("div", { class: "uya-dlg-bicimler", role: "radiogroup", "aria-label": "Dosya biçimi" });
  const ayracSec = el("select", { "aria-label": "CSV ayracı" }, el("option", { value: ";", text: "Noktalı virgül ( ; ) — Türkçe Excel" }), el("option", { value: ",", text: "Virgül ( , ) — Mailchimp vb." }));
  const ayracAlan = el("div", { class: "form-field uya-dlg-alan" }, el("label", { text: "CSV ayracı" }), ayracSec);
  const rolSec = el("select", { "aria-label": "Rol süzgeci" }, ROLLER.map(([v, a]) => el("option", { value: v, text: a })));
  const kvkkKutu = el("input", { type: "checkbox" });
  const epostaKutu = el("input", { type: "checkbox" });
  const hata = el("p", { class: "auth-message auth-message--error", hidden: true, role: "alert" });
  const durum = el("p", { class: "muted uya-dlg-durum", "aria-live": "polite" });
  const indirBtn = el("button", { type: "submit", class: "btn-primary csp-w-auto", text: "İndir" });
  const kapatBtn = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Kapat" });

  const bicimCiz = () => {
    bicimGrubu.replaceChildren(
      ...BICIMLER.map((b) => {
        const r = el("input", { type: "radio", name: "uya-bicim", value: b.id });
        r.checked = b.id === bicim;
        r.addEventListener("change", () => {
          bicim = b.id;
          ayracAlan.hidden = bicim !== "csv";
          bicimCiz();
        });
        return el("label", { class: "uya-dlg-bicim" + (b.id === bicim ? " uya-dlg-secili" : "") }, r, el("span", { class: "uya-dlg-bicim-ad", text: b.ad }), el("span", { class: "muted", text: b.ipucu }));
      })
    );
  };
  bicimCiz();

  const form = el(
    "form",
    { class: "uya-dlg-form", novalidate: true },
    el("div", { class: "uya-dlg-ust" }, el("h3", { text: "Üye bilgilerini dışa aktar" }), el("p", { class: "muted", text: "Dosya bu cihazda oluşturulur. Yalnızca Site Sahibi'nin sana tanıdığı kapsamdaki üyeler dosyaya girer; her indirme denetim kaydına yazılır." })),
    el(
      "div",
      { class: "uya-dlg-govde" },
      el("fieldset", { class: "uya-dlg-grup" }, el("legend", { text: "Biçim" }), bicimGrubu, ayracAlan),
      el("fieldset", { class: "uya-dlg-grup" }, el("legend", { text: "Kapsam" }), el("div", { class: "form-field uya-dlg-alan" }, rolSec),
        el("label", { class: "uya-dlg-secenek" }, kvkkKutu, el("span", { text: "Yalnızca KVKK aydınlatma onayı olan üyeler (toplu e-posta için)" })),
        el("label", { class: "uya-dlg-secenek" }, epostaKutu, el("span", { text: "Yalnızca e-posta adresleri (diğer alanlar dosyaya girmez)" }))),
      el("p", { class: "muted uya-dlg-not", text: "Dosya; e-posta, ad/soyad, rol, üyelik tarihi, hesap durumu, son giriş, KVKK aydınlatma ve yurt dışı açık rıza durumları (tarih + sürüm) ve üye kimliğini içerir. Kişisel veridir: yalnızca yetkili amaçla kullan, güvenli sakla." }),
      durum,
      hata
    ),
    el("div", { class: "uya-dlg-alt" }, kapatBtn, indirBtn)
  );

  form.addEventListener("submit", async (o) => {
    o.preventDefault();
    hata.hidden = true;
    indirBtn.disabled = true;
    durum.textContent = "Üyeler alınıyor…";
    try {
      const { data, error } = await supabase.rpc("uye_verisi_disa_aktar", { p_bicim: bicim });
      if (error) throw error;
      let uyeler = data || [];
      if (rolSec.value) uyeler = uyeler.filter((u) => u.role === rolSec.value);
      if (kvkkKutu.checked) uyeler = uyeler.filter((u) => u.kvkk_onay_verildi);
      if (!uyeler.length) throw new Error("Seçtiğin kapsamda üye bulunamadı (yetki kapsamın ya da süzgeçler sonucu boş).");

      durum.textContent = `${uyeler.length} üye hazırlanıyor…`;
      const Y = await import("./yazicilar.js");
      const secenek = { sadeceEposta: epostaKutu.checked, ayrac: ayracSec.value, yazar };
      const blob =
        bicim === "csv" ? Y.csvUret(uyeler, secenek) : bicim === "xlsx" ? await Y.xlsxUret(uyeler, secenek) : bicim === "txt" ? Y.txtUret(uyeler, secenek) : await Y.pdfUret(uyeler, secenek);
      const uzanti = BICIMLER.find((b) => b.id === bicim).uzanti;
      indir(blob, `uyeler_${Y.tarihMetni(new Date())}.${uzanti}`);
      durum.textContent = `${uyeler.length} üye indirildi.`;
      bildir(`${uyeler.length} üyenin bilgileri .${uzanti} olarak indirildi.`);
    } catch (h) {
      console.error(h);
      hata.hidden = false;
      hata.textContent = "Dışa aktarılamadı: " + (h.message || h);
      durum.textContent = "";
    } finally {
      indirBtn.disabled = false;
    }
  });

  kapatBtn.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (o) => o.target === d && d.close());
  d.append(form);
  document.body.append(d);
  ayracAlan.hidden = bicim !== "csv";
  d.showModal();
}
