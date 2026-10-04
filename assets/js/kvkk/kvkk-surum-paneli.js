/*
 * assets/js/kvkk/kvkk-surum-paneli.js — Yetki Ayarları > "KVKK Sürümü"
 * -----------------------------------------------------------------------------
 * dashboard.js, "Yetki Ayarları" sekmesi (sys-yetki) açılınca bu modülü import() eder
 * (MODULES.kvkkSurum, role: "owner"). Asıl sınır veritabanında (migration 0064):
 *   - site_ayarlari.guncel_kvkk_surumu için UPDATE yalnızca owner (RLS + kolon GRANT),
 *   - owner_kvkk_onay_ozeti() is_owner() ister.
 * Bu dosya yalnızca arayüzdür.
 *
 * innerHTML YOK; inline style YOK (CSP). Görünüm mevcut .ya-* / .gk-p-* / .form-field
 * sınıflarından gelir.
 */
import { supabase, showMessage, guncelKvkkSurumu } from "../core/supabase-client.js";

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

async function kur() {
  const kok = document.getElementById("kvkk-surum-kok");
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  const { data: ozet, error } = await supabase.rpc("owner_kvkk_onay_ozeti");
  const satir = Array.isArray(ozet) ? ozet[0] : ozet;
  if (error || !satir) {
    const yok = /does not exist|42883|PGRST202|42703|schema cache/i.test(error?.message || error?.code || "");
    kok.replaceChildren(
      el("p", {
        class: "muted",
        text: yok || (!error && !satir)
          ? "0064_guncel_kvkk_surumu.sql henüz çalıştırılmamış görünüyor: dosyayı SQL Editor'de çalıştır."
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
      // .select() ŞART: RLS yetkisiz UPDATE'i hata vermeden 0 satıra çevirir.
      const { data, error: hata } = await supabase
        .from("site_ayarlari")
        .update({ guncel_kvkk_surumu: yeni })
        .eq("id", 1)
        .select("guncel_kvkk_surumu")
        .maybeSingle();
      if (hata) throw hata;
      if (!data) throw new Error("Kayıt güncellenmedi (yetkin yok ya da satır bulunamadı).");

      mevcut = data.guncel_kvkk_surumu;
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
    })
  );
}

kur().catch((hata) => {
  console.error("kvkk-surum-paneli.js:", hata);
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (mesaj) showMessage(mesaj, `KVKK sürüm paneli yüklenemedi: ${hata.message || hata}`, "error");
});
