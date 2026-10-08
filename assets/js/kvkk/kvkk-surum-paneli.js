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
 * HUKUKİ PAKET (migration 0073): Gizlilik Politikası + KVKK Aydınlatma + Açık Rıza tek pakettir.
 * "Yeni Sürümü Yayınla" varsayılan olarak hukuki_paket_surumu_yayinla() RPC'siyle Aydınlatma VE Açık Rıza
 * etiketini AYNI değere ve TEK işlemde (atomik) yükseltir; iki etiket ayrışırsa panel uyarı gösterir.
 * Açık rızayı tek başına yükseltmek "gelişmiş" bölümde kalır (açık rıza metni tek başına değiştiğinde).
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
function rizaBolumu(satir, mesaj, surumDegisti) {
  if (satir.riza_surumu === undefined || satir.riza_surumu === null) {
    return el("p", { class: "muted csp-mt-18", text: "Açık rıza için ayrı sürüm (0070 numaralı migration) henüz çalıştırılmamış görünüyor." });
  }
  let mevcut = satir.riza_surumu;
  surumDegisti?.({ riza: mevcut }, true);
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
      surumDegisti?.({ riza: mevcut });
      showMessage(mesaj, `Kaydedildi: yürürlükteki açık rıza sürümü ${mevcut}. Deploy gerekmez.`, "success");
    } catch (hata) {
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      btn.disabled = false;
    }
  });
  return el(
    "details",
    { class: "csp-mt-18 kvkk-gelismis" },
    el("summary", { text: "Gelişmiş: yalnızca Açık Rıza sürümünü değiştir" }),
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

  // Eşgüdüm göstergesi: Aydınlatma ve Açık Rıza etiketleri aynı olmalı (hukuki paket).
  let rizaMevcut = satir.riza_surumu ?? null;
  const esgudum = el("p", { class: "kvkk-esgudum", role: "status" });
  const esgudumuCiz = () => {
    if (rizaMevcut === null) {
      esgudum.hidden = true;
      return;
    }
    esgudum.hidden = false;
    const esit = rizaMevcut === mevcut;
    esgudum.className = "kvkk-esgudum " + (esit ? "kvkk-esgudum--tamam" : "kvkk-esgudum--uyari");
    esgudum.textContent = esit
      ? `✓ Hukuki paket eşgüdümlü: Aydınlatma ve Açık Rıza ${mevcut}.`
      : `⚠ Sürümler ayrışmış: Aydınlatma ${mevcut}, Açık Rıza ${rizaMevcut}. Eşitlemek için aşağıdan yeni bir sürüm yayınla (açık rıza kutusu işaretli kalsın).`;
  };
  const sürümDegisti = (k, ilk) => {
    if (k?.riza) rizaMevcut = k.riza;
    if (!ilk) esgudumuCiz();
  };
  esgudumuCiz();

  const rizaKutu = el("input", { type: "checkbox", id: "kvkk-paket-riza" });
  rizaKutu.checked = true;
  const rizaSatiri = rizaMevcut === null
    ? null
    : el(
        "label",
        { class: "kvkk-paket-secenek", for: "kvkk-paket-riza" },
        rizaKutu,
        el("span", { text: "Açık Rıza sürümünü de aynı etikete yükselt (önerilir: Gizlilik Politikası + Aydınlatma + Açık Rıza tek paket)" })
      );

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
    const rizaDa = rizaMevcut !== null && rizaKutu.checked;
    const onay = window.confirm(
      `Sürüm ${mevcut} -> ${yeni} olarak değişecek` + (rizaDa ? " (Aydınlatma + Açık Rıza)." : " (yalnızca Aydınlatma).") + "\n\n" +
        `Onayı ${yeni} ile eşleşmeyen tüm üyeler bir sonraki girişlerinde ekranı kilitleyen ` +
        `"Rıza Yenileme" modalını görecek (şu an ${toplam} üye).\n\n` +
        `Gizlilik politikası ve açık rıza metnini ÖNCE yayınladığından emin ol. Devam edilsin mi?`
    );
    if (!onay) return;

    yayinlaBtn.disabled = true;
    try {
      // Tek yazma yolu RPC: yetkiyi (owner / anahtarı açık admin) sunucu denetler; iki sürüm TEK işlemde yazılır.
      const { data, error: hata } = await supabase.rpc("hukuki_paket_surumu_yayinla", { p_surum: yeni, p_riza_da: rizaDa });
      if (hata) {
        if (/does not exist|42883|PGRST202|schema cache/i.test(`${hata.code || ""} ${hata.message || ""}`)) {
          throw new Error("0073 numaralı migration henüz çalıştırılmamış: dosyayı SQL Editor'de çalıştır.");
        }
        throw hata;
      }
      const yeniSatir = Array.isArray(data) ? data[0] : data;
      if (!yeniSatir?.kvkk_surumu) throw new Error("Sürüm güncellenmedi.");

      mevcut = yeniSatir.kvkk_surumu;
      rizaMevcut = yeniSatir.riza_surumu ?? rizaMevcut;
      await Promise.all([guncelKvkkSurumu({ yenile: true }), guncelOnaySurumleri({ yenile: true })]);
      mevcutMetin.textContent = mevcut;
      girdi.value = "";
      girdi.placeholder = sonrakiOneri(mevcut);
      esgudumuCiz();
      ozetMetin.textContent = `Yeni sürüm ${mevcut} yürürlükte. Üyeler bir sonraki sayfa yüklemelerinde modalı görür.`;
      showMessage(mesaj, `Kaydedildi: Aydınlatma ${mevcut}` + (rizaDa ? ` · Açık Rıza ${rizaMevcut}` : "") + ". Deploy gerekmez.", "success");
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
    el("p", {}, "Yürürlükteki Aydınlatma sürümü: ", mevcutMetin),
    esgudum,
    ozetMetin,
    el("div", { class: "form-field csp-mt-16" }, el("label", { for: "kvkk-surum-girdi", text: "Yeni sürüm etiketi" }), girdi),
    rizaSatiri,
    el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, yayinlaBtn),
    el("p", {
      class: "gy-yardim-metni",
      text:
        "Sıra: (1) kurumsal/gizlilik-politikasi.md değişikliğini deploy et, (2) burada sürümü yükselt. " +
        "Sadece yazım düzeltmesi için sürümü değiştirme; her değişiklik tüm üyelere yeniden onay ekranı gösterir. " +
        "Onay damgasını tarayıcı değil veritabanı yazar; sürüm okunamazsa kimse kilitlenmez.",
    }),
    rizaBolumu(satir, mesaj, sürümDegisti),
    yetkiBolumu
  );
}

kur().catch((hata) => {
  console.error("kvkk-surum-paneli.js:", hata);
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (mesaj) showMessage(mesaj, `KVKK sürüm paneli yüklenemedi: ${hata.message || hata}`, "error");
});
