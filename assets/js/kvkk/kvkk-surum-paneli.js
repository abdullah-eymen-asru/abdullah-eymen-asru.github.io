/*
 * assets/js/kvkk/kvkk-surum-paneli.js — "KVKK Sürümü" sekmesi (sys-kvkk)
 * -----------------------------------------------------------------------------
 * dashboard.js, sekme açılınca bu modülü import() eder (MODULES.kvkkSurum). Sekmeyi owner
 * her zaman, admin ise yalnızca owner "adminler değiştirebilsin" anahtarını açtıysa görür.
 * Asıl sınır veritabanında (migration 0064/0065):
 *   - sürümü yalnızca kvkk_surumunu_degistir() yazar (owner; admin ise anahtar açıkken),
 *   - özeti kvkk_onay_ozeti() verir (aynı yetki),
 *   - anahtar (kvkk_surum_admin_degistirebilir) için UPDATE yalnızca owner (RLS + kolon GRANT).
 * Bu dosya yalnızca arayüzdür.
 *
 * innerHTML YOK; inline style YOK (CSP). Görünüm mevcut .ya-* / .gk-p-* / .form-field
 * sınıflarından gelir.
 */
import { supabase, showMessage, guncelKvkkSurumu, guncelOnaySurumleri } from "../core/supabase-client.js";

const BICIM = /^v[0-9]{1,3}\.[0-9]{1,3}$/; // DB check kısıtıyla aynı

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

function sonrakiOneri(surum) {
  const m = /^v(\d+)\.(\d+)$/.exec(surum || "");
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : "v1.0";
}

/**
 * "Açık Rıza Sürümü" bölümü (migration 0070): yurt dışı açık rıza metninin AYRI sürümü. Yükseltince, daha önce
 * rıza vermiş üyelere bir sonraki girişte (kutusu işaretsiz) rızayı yeniden soran modal düşer.
 */
function rizaBolumu(satir, mesaj) {
  if (satir.riza_surumu === undefined || satir.riza_surumu === null) {
    return el("p", { class: "muted csp-mt-18", text: "Açık rıza için ayrı sürüm (0070 numaralı migration) henüz çalıştırılmamış görünüyor." });
  }
  let mevcut = satir.riza_surumu;
  const verenler = Number(satir.riza_verenler);
  const eski = Number(satir.riza_eski);
  const mevcutMetin = el("strong", { text: mevcut });
  const ozet = el("p", {
    class: "muted",
    text:
      `${verenler} üye açık rıza vermiş; ${verenler - eski}'i bu sürümü onaylamış` +
      (eski > 0 ? `, ${eski}'ine bir sonraki girişte rızayı yenileme modalı çıkacak.` : "."),
  });
  const girdi = el("input", { type: "text", id: "riza-surum-girdi", maxlength: "8", autocomplete: "off", spellcheck: "false", placeholder: sonrakiOneri(mevcut), "aria-label": "Yeni açık rıza sürüm etiketi" });
  const btn = el("button", { type: "button", id: "riza-surum-kaydet", class: "btn-primary csp-w-auto", text: "Açık Rıza Sürümünü Yayınla" });
  btn.addEventListener("click", async () => {
    const yeni = girdi.value.trim();
    if (!BICIM.test(yeni)) return showMessage(mesaj, 'Sürüm "v1.2" biçiminde olmalı (v + sayı + nokta + sayı).', "error");
    if (yeni === mevcut) return showMessage(mesaj, "Bu zaten yürürlükteki açık rıza sürümü.", "error");
    if (!window.confirm(`Açık rıza sürümü ${mevcut} -> ${yeni} olacak.\n\nŞu an rıza vermiş ${verenler} üyenin hepsi bir sonraki girişte rızayı yeniden verme/geri çekme ekranını görecek. Açık rıza metnini ÖNCE yayınladığından emin ol. Devam edilsin mi?`)) return;
    btn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("riza_surumunu_degistir", { p_surum: yeni });
      if (error) throw error;
      if (!data) throw new Error("Sürüm güncellenmedi.");
      mevcut = data;
      await guncelOnaySurumleri({ yenile: true });
      mevcutMetin.textContent = mevcut;
      girdi.value = "";
      girdi.placeholder = sonrakiOneri(mevcut);
      showMessage(mesaj, `Kaydedildi: yürürlükteki açık rıza sürümü ${mevcut}. Deploy gerekmez.`, "success");
    } catch (hata) {
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      btn.disabled = false;
    }
  });
  return el(
    "div",
    { class: "csp-mt-18" },
    el("h3", { text: "Açık Rıza Sürümü" }),
    el("p", {}, "Yürürlükteki açık rıza sürümü: ", mevcutMetin),
    ozet,
    el("div", { class: "form-field csp-mt-16" }, el("label", { for: "riza-surum-girdi", text: "Yeni açık rıza sürüm etiketi" }), girdi),
    el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, btn),
    el("p", {
      class: "gy-yardim-metni",
      text:
        "Aydınlatma sürümünden BAĞIMSIZDIR: yalnızca açık rıza metni değiştiğinde bunu yükselt. Rıza, üyelik şartı değildir; " +
        "modalda kutu işaretsiz gelir, işaretlemeden devam eden üyenin rızası geri çekilmiş sayılır.",
    })
  );
}

async function kur() {
  const kok = document.getElementById("kvkk-surum-kok");
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  const { data: ozet, error } = await supabase.rpc("kvkk_onay_ozeti");
  const satir = Array.isArray(ozet) ? ozet[0] : ozet;
  if (error || !satir) {
    const yok = /does not exist|42883|PGRST202|42703|schema cache/i.test(error?.message || error?.code || "");
    kok.replaceChildren(
      el("p", {
        class: "muted",
        text: yok || (!error && !satir)
          ? "0064, 0065 ve 0070 numaralı KVKK migration'ları henüz çalıştırılmamış görünüyor: dosyaları SQL Editor'de çalıştır."
          : `Yüklenemedi: ${error.message}`,
      })
    );
    return;
  }

  let mevcut = satir.guncel_surum;
  const toplam = Number(satir.toplam);
  const eski = Number(satir.eski);

  const mevcutMetin = el("strong", { text: mevcut });
  const ozetMetin = el("p", {
    class: "muted",
    text:
      `${toplam} üyeden ${toplam - eski}'i bu sürümü onaylamış` +
      (eski > 0 ? `, ${eski}'inin onayı eski (giriş yapınca modal görecek).` : "."),
  });
  const girdi = el("input", {
    type: "text",
    id: "kvkk-surum-girdi",
    maxlength: "8",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: sonrakiOneri(mevcut),
    "aria-label": "Yeni KVKK sürüm etiketi",
  });
  const yayinlaBtn = el("button", { type: "button", id: "kvkk-surum-kaydet", class: "btn-primary csp-w-auto", text: "Yeni Sürümü Yayınla" });

  yayinlaBtn.addEventListener("click", async () => {
    const yeni = girdi.value.trim();
    if (!BICIM.test(yeni)) {
      showMessage(mesaj, 'Sürüm "v1.2" biçiminde olmalı (v + sayı + nokta + sayı).', "error");
      return;
    }
    if (yeni === mevcut) {
      showMessage(mesaj, "Bu zaten yürürlükteki sürüm.", "error");
      return;
    }
    const onay = window.confirm(
      `Sürüm ${mevcut} -> ${yeni} olarak değişecek.\n\n` +
        `Onayı ${yeni} ile eşleşmeyen tüm üyeler bir sonraki girişlerinde ekranı kilitleyen ` +
        `"Rıza Yenileme" modalını görecek (şu an ${toplam} üye).\n\n` +
        `Gizlilik politikası metnini ÖNCE yayınladığından emin ol. Devam edilsin mi?`
    );
    if (!onay) return;

    yayinlaBtn.disabled = true;
    try {
      // Tek yazma yolu RPC: yetkiyi (owner / anahtarı açık admin) sunucu denetler.
      const { data, error: hata } = await supabase.rpc("kvkk_surumunu_degistir", { p_surum: yeni });
      if (hata) throw hata;
      if (!data) throw new Error("Sürüm güncellenmedi.");

      mevcut = data;
      await guncelKvkkSurumu({ yenile: true }); // bu sekmenin önbelleğini tazele
      mevcutMetin.textContent = mevcut;
      girdi.value = "";
      girdi.placeholder = sonrakiOneri(mevcut);
      ozetMetin.textContent = `Yeni sürüm ${mevcut} yürürlükte. Üyeler bir sonraki sayfa yüklemelerinde modalı görür.`;
      showMessage(mesaj, `Kaydedildi: yürürlükteki sürüm ${mevcut}. Deploy gerekmez.`, "success");
    } catch (hata) {
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      yayinlaBtn.disabled = false;
    }
  });

  // Yetki anahtarı: YALNIZCA owner görür ve değiştirir (admin bu bölümü hiç görmez).
  let yetkiBolumu = null;
  if (satir.sahip_mi) {
    const kutu = el("input", { type: "checkbox", id: "kvkk-admin-anahtar" });
    kutu.checked = !!satir.admin_degistirebilir;
    kutu.addEventListener("change", async () => {
      const istenen = kutu.checked;
      kutu.disabled = true;
      try {
        // .select() ŞART: RLS yetkisiz UPDATE'i hata vermeden 0 satıra çevirir.
        const { data, error: hata } = await supabase
          .from("site_ayarlari")
          .update({ kvkk_surum_admin_degistirebilir: istenen })
          .eq("id", 1)
          .select("kvkk_surum_admin_degistirebilir")
          .maybeSingle();
        if (hata) throw hata;
        if (!data) throw new Error("Kayıt güncellenmedi (yetkin yok ya da satır bulunamadı).");
        kutu.checked = !!data.kvkk_surum_admin_degistirebilir;
        showMessage(
          mesaj,
          kutu.checked
            ? "Adminler artık KVKK sürümünü değiştirebilir (menüleri bir sonraki panel yüklemesinde görünür)."
            : "Admin yetkisi kapatıldı: sürümü yalnızca sen değiştirebilirsin (yetki sunucuda anında kalkar).",
          "success"
        );
      } catch (hata) {
        kutu.checked = !istenen; // başarısız: eski haline dön
        showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
      } finally {
        kutu.disabled = false;
      }
    });
    yetkiBolumu = el(
      "div",
      { class: "csp-mt-18" },
      el("h3", { text: "Yetki" }),
      el(
        "div",
        { class: "gk-p-anahtar" },
        el(
          "label",
          { class: "ya-mini-toggle", for: "kvkk-admin-anahtar" },
          kutu,
          el("span", { class: "ya-mini-track" }, el("span", { class: "ya-mini-thumb" }))
        ),
        el("label", { for: "kvkk-admin-anahtar", text: "Adminler de KVKK sürümünü değiştirebilsin" })
      ),
      el("p", {
        class: "gy-yardim-metni",
        text:
          "Kapalıyken yalnızca Site Sahibi (owner) değiştirir. Sürüm yükseltmek tüm üyelere yeniden onay ekranı " +
          "gösterdiği için varsayılan KAPALIDIR.",
      })
    );
  }

  kok.replaceChildren(
    el("p", {}, "Yürürlükteki sürüm: ", mevcutMetin),
    ozetMetin,
    el("div", { class: "form-field csp-mt-16" }, el("label", { for: "kvkk-surum-girdi", text: "Yeni sürüm etiketi" }), girdi),
    el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, yayinlaBtn),
    el("p", {
      class: "gy-yardim-metni",
      text:
        "Sıra: (1) kurumsal/gizlilik-politikasi.md değişikliğini deploy et, (2) burada sürümü yükselt. " +
        "Sadece yazım düzeltmesi için sürümü değiştirme; her değişiklik tüm üyelere yeniden onay ekranı gösterir. " +
        "Onay damgasını tarayıcı değil veritabanı yazar; sürüm okunamazsa kimse kilitlenmez.",
    }),
    rizaBolumu(satir, mesaj),
    yetkiBolumu
  );
}

kur().catch((hata) => {
  console.error("kvkk-surum-paneli.js:", hata);
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (mesaj) showMessage(mesaj, `KVKK sürüm paneli yüklenemedi: ${hata.message || hata}`, "error");
});
