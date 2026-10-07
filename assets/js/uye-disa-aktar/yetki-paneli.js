/*
 * assets/js/uye-disa-aktar/yetki-paneli.js — "Üye Verisi Dışa Aktarma Yetkisi" sekmesi (sys-uye-aktarim, SADECE owner)
 * -----------------------------------------------------------------------
 * Site Sahibi, hangi yöneticinin HANGİ üyelerin bilgisini indirebileceğini buradan belirler:
 *   • tüm üyeler  • seçili roller  • tek tek eklenen üyeler  • her koşulda hariç tutulan üyeler
 * Gerçek sınır veritabanındadır (migration 0069: uye_aktarim_yetkileri + uye_verisi_disa_aktar). Bu dosya yalnızca arayüzdür.
 * Site Sahibi her zaman tam yetkilidir; owner verisini başkası indiremez.
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { ROL_ETIKETLERI, tarihMetni } from "./yazicilar.js";

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

const HEDEF_ROLLER = ["user", "special_user", "editor", "manager", "admin"];
const hataMetni = (h) => (/does not exist|42883|PGRST202|schema cache/i.test(h?.message || h?.code || "") ? "0069 numaralı migration henüz çalıştırılmamış görünüyor: dosyayı SQL Editor'de çalıştır." : h?.message || String(h));

/** Arama kutulu üye seçici: seçilenler çip olarak listelenir. */
function uyeSecici(baslik, tumUyeler, baslangic) {
  const secili = new Map(baslangic.map((id) => [id, tumUyeler.find((u) => u.id === id)]));
  const ara = el("input", { type: "search", placeholder: "Üye adı ara…", "aria-label": `${baslik}: üye ara` });
  const sec = el("select", { "aria-label": `${baslik}: üye seç` });
  const cipler = el("div", { class: "uya-yp-cipler" });
  const ekle = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Ekle" });
  const etiket = (u) => `${u?.full_name || "İsimsiz üye"} · ${ROL_ETIKETLERI[u?.role] || u?.role || "?"}`;
  const ciz = () => {
    const q = ara.value.trim().toLocaleLowerCase("tr");
    sec.replaceChildren(el("option", { value: "", text: "— üye seç —" }), ...tumUyeler.filter((u) => !secili.has(u.id) && (!q || (u.full_name || "").toLocaleLowerCase("tr").includes(q))).slice(0, 80).map((u) => el("option", { value: u.id, text: etiket(u) })));
    cipler.replaceChildren(
      ...[...secili.entries()].map(([id, u]) =>
        el("span", { class: "uya-yp-cip" }, etiket(u), el("button", { type: "button", "aria-label": "Kaldır", text: "×", onclick: () => (secili.delete(id), ciz()) }))
      )
    );
  };
  ara.addEventListener("input", ciz);
  ekle.addEventListener("click", () => {
    const u = tumUyeler.find((x) => x.id === sec.value);
    if (u) secili.set(u.id, u);
    ara.value = "";
    ciz();
  });
  ciz();
  return { kok: el("div", { class: "form-field" }, el("label", { text: baslik }), el("div", { class: "uya-yp-secici" }, ara, sec, ekle), cipler), deger: () => [...secili.keys()] };
}

function kapsamOzeti(y, adBul) {
  const parcalar = [];
  parcalar.push(y.tum_uyeler ? "Tüm üyeler" : y.hedef_roller.length ? `Roller: ${y.hedef_roller.map((r) => ROL_ETIKETLERI[r] || r).join(", ")}` : "Rol kuralı yok");
  if (y.ekstra_uyeler.length) parcalar.push(`+ ${y.ekstra_uyeler.length} tek tek eklenen üye`);
  if (y.haric_uyeler.length) parcalar.push(`− ${y.haric_uyeler.length} hariç üye (${y.haric_uyeler.slice(0, 3).map(adBul).join(", ")}${y.haric_uyeler.length > 3 ? "…" : ""})`);
  return parcalar.join(" · ");
}

async function kur() {
  const kok = document.getElementById("uye-aktarim-kok");
  const mesaj = document.getElementById("uye-aktarim-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  const [{ data: yetkiler, error: e1 }, { data: uyeler, error: e2 }] = await Promise.all([
    supabase.rpc("owner_uye_aktarim_yetkilerini_getir"),
    supabase.from("profiles").select("id, full_name, role").order("full_name"),
  ]);
  if (e1 || e2) {
    kok.replaceChildren(el("p", { class: "muted", text: hataMetni(e1 || e2) }));
    return;
  }
  const tumUyeler = (uyeler || []).filter((u) => u.role !== "owner");
  const adlar = new Map((uyeler || []).map((u) => [u.id, u.full_name || "İsimsiz üye"]));
  const adBul = (id) => adlar.get(id) || "silinmiş üye";
  const yoneticiler = tumUyeler.filter((u) => u.role === "admin");

  const liste = el("div", { class: "uya-yp-liste" });
  const formAlani = el("div", { class: "panel-section csp-mt-16" });

  const yenile = async () => {
    const { data, error } = await supabase.rpc("owner_uye_aktarim_yetkilerini_getir");
    if (error) return showMessage(mesaj, "Liste yenilenemedi: " + hataMetni(error), "error");
    yetkiler.length = 0;
    yetkiler.push(...(data || []));
    listeCiz();
  };

  const formAc = (var_ = null) => {
    const yoneticiSec = el("select", { id: "uya-yp-yonetici", "aria-label": "Yönetici" }, yoneticiler.map((u) => el("option", { value: u.id, text: u.full_name || "İsimsiz yönetici" })));
    if (var_) yoneticiSec.value = var_.yetkili_id;
    yoneticiSec.disabled = !!var_;
    const tumRadio = el("input", { type: "radio", name: "uya-yp-kapsam", value: "tum" });
    const rolRadio = el("input", { type: "radio", name: "uya-yp-kapsam", value: "rol" });
    (var_?.tum_uyeler ? tumRadio : rolRadio).checked = true;
    const rolKutulari = HEDEF_ROLLER.map((r) => {
      const k = el("input", { type: "checkbox", value: r });
      k.checked = !!var_?.hedef_roller.includes(r);
      return k;
    });
    const ekstra = uyeSecici("Rol kuralından bağımsız, tek tek izin verilen üyeler", tumUyeler, var_?.ekstra_uyeler || []);
    const haric = uyeSecici("Her durumda HARİÇ tutulan üyeler (en yüksek öncelik)", tumUyeler, var_?.haric_uyeler || []);
    const kaydet = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Kaydet" });
    const vazgec = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Vazgeç", onclick: () => formAlani.replaceChildren() });

    kaydet.addEventListener("click", async () => {
      if (!yoneticiSec.value) return showMessage(mesaj, "Önce bir yönetici seç.", "error");
      const roller = rolKutulari.filter((k) => k.checked).map((k) => k.value);
      if (!tumRadio.checked && !roller.length && !ekstra.deger().length) return showMessage(mesaj, "En az bir kapsam seç: tüm üyeler, bir rol ya da tek tek üye.", "error");
      kaydet.disabled = true;
      try {
        const { error } = await supabase.rpc("owner_uye_aktarim_yetkisi_ver", { p_yetkili: yoneticiSec.value, p_tum: tumRadio.checked, p_roller: tumRadio.checked ? [] : roller, p_ekstra: ekstra.deger(), p_haric: haric.deger() });
        if (error) throw error;
        showMessage(mesaj, "İzin kaydedildi.", "success");
        formAlani.replaceChildren();
        await yenile();
      } catch (h) {
        showMessage(mesaj, "Kaydedilemedi: " + hataMetni(h), "error");
      } finally {
        kaydet.disabled = false;
      }
    });

    formAlani.replaceChildren(
      el("h3", { class: "csp-mt-0", text: var_ ? "İzni düzenle" : "Yeni izin ver" }),
      el("div", { class: "form-field" }, el("label", { for: "uya-yp-yonetici", text: "Yönetici" }), yoneticiSec),
      el("fieldset", { class: "uya-yp-grup" }, el("legend", { text: "Hangi üyelerin verisini indirebilsin?" }),
        el("label", { class: "uya-yp-secenek" }, tumRadio, el("span", { text: "Tüm üyeler (Site Sahibi hariç)" })),
        el("label", { class: "uya-yp-secenek" }, rolRadio, el("span", { text: "Yalnızca seçtiğim roller:" })),
        el("div", { class: "uya-yp-roller" }, HEDEF_ROLLER.map((r, i) => el("label", { class: "uya-yp-secenek" }, rolKutulari[i], el("span", { text: ROL_ETIKETLERI[r] }))))),
      ekstra.kok,
      haric.kok,
      el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, kaydet, vazgec)
    );
  };

  const listeCiz = () => {
    liste.replaceChildren(
      ...(yetkiler.length
        ? yetkiler.map((y) =>
            el("div", { class: "uya-yp-kart" },
              el("div", { class: "uya-yp-kart-metin" }, el("strong", { text: y.yetkili_ad }), el("span", { class: "muted", text: kapsamOzeti(y, adBul) })),
              el("div", { class: "uya-yp-kart-eylem" },
                el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Düzenle", onclick: () => formAc(y) }),
                el("button", { type: "button", class: "btn-danger csp-w-auto", text: "Kaldır", onclick: async () => {
                  if (!window.confirm(`${y.yetkili_ad} artık üye verisini indiremeyecek. Devam edilsin mi?`)) return;
                  const { error } = await supabase.rpc("owner_uye_aktarim_yetkisi_kaldir", { p_yetkili: y.yetkili_id });
                  if (error) return showMessage(mesaj, "Kaldırılamadı: " + hataMetni(error), "error");
                  showMessage(mesaj, "İzin kaldırıldı.", "success");
                  await yenile();
                } })))
          )
        : [el("p", { class: "muted", text: "Henüz hiçbir yöneticiye izin verilmedi: yalnızca sen (Site Sahibi) üye verisini indirebilirsin." })])
    );
  };
  listeCiz();

  const yeniBtn = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Yeni izin ver", onclick: () => (yoneticiler.length ? formAc() : showMessage(mesaj, "Henüz yönetici rolünde üye yok.", "error")) });

  // Son indirmeler (denetim kaydı)
  const kayitKutusu = el("div", { class: "csp-mt-18" }, el("h3", { text: "Son indirmeler" }));
  const { data: kayitlar, error: e3 } = await supabase.rpc("owner_uye_aktarim_kayitlari", { p_limit: 15 });
  kayitKutusu.append(
    e3
      ? el("p", { class: "muted", text: hataMetni(e3) })
      : (kayitlar || []).length
        ? el("ul", { class: "uya-yp-kayit" }, kayitlar.map((k) => el("li", { text: `${tarihMetni(k.created_at, true)} · ${k.yetkili_ad || "?"} · ${k.adet} üye${k.bicim ? " · " + k.bicim.toUpperCase() : ""}` })))
        : el("p", { class: "muted", text: "Henüz indirme yapılmadı." })
  );

  kok.replaceChildren(liste, el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, yeniBtn), formAlani, kayitKutusu);
}

kur().catch((hata) => {
  console.error("yetki-paneli.js (üye aktarım):", hata);
  const mesaj = document.getElementById("uye-aktarim-mesaj");
  if (mesaj) showMessage(mesaj, `Panel yüklenemedi: ${hata.message || hata}`, "error");
});
