/*
 * assets/js/notlar/yetki-paneli.js
 * -----------------------------------------------------------------------
 * "Yetki Ayarları" sekmesine eklenen KULLANICI BAZLI bölümler (sadece owner).
 *   - Rol bazlı kapatma/açma (tüm editörler / tüm adminler / tümü) zaten
 *     Yetki Ayarları matrisinin "Notlarım" satırında.
 *   - Bu dosya iki bölüm kurar:
 *       1) KAPAT : modülü zaten kullanabilen (editor/manager/admin) tek bir kişiye kapat.
 *       2) AÇ    : modülü NORMALDE kullanamayan (user/special_user) tek bir üyeye aç.
 *
 * github-yonetim.js -> wireYetkiAyarlari() bu dosyayı dynamic import() ile yükler.
 * Hiç innerHTML yok (isim/e-posta kullanıcı verisi); her şey textContent ile basılır.
 * Asıl sınır veritabanında: RPC'ler is_owner() ister (migration 0059/0060), burası görünüm.
 *
 * DÜĞME MANTIĞI (iki bölüm AYNI fabrikayı kullanır; farkı yapılandırma belirler):
 *   Her kişinin bir "etkin" durumu vardır:
 *     KAPAT bölümünde  etkin = kişi şu an KAPALI (kısıtlı)
 *     AÇ    bölümünde  etkin = kişiye şu an İZİN VERİLMİŞ
 *   Düğme etkin durumu TERS ÇEVİRİR. Sunucuya giden p_izinli değeri:
 *     KAPAT bölümü: p_izinli = etkin      (kapalıysa "Yeniden aç" → true, değilse "Kapat" → false)
 *     AÇ    bölümü: p_izinli = !etkin     (izinliyse "İzni kaldır" → false, değilse "İzin ver" → true)
 *   Bu eşleme `izinliDegeri` ile yapılandırmada AÇIKÇA yazılır ve testle doğrulanır.
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";

const OZELLIK = "notlar_modulu";
const ROL_ETIKETI = {
  editor: "Yazar (Editor)",
  manager: "İçerik Sorumlusu",
  admin: "Yönetici (Admin)",
  user: "Üye",
  special_user: "Özel Üye",
};

const BOLUMLER = {
  kapat: {
    baslik: "Kapat: yetkili bir kişinin erişimini kes",
    aciklama:
      "Yazar, içerik sorumlusu ya da yönetici olan tek bir kişiye modülü kapatırsın. Kapatılan kişi notlarını " +
      "göremez, yeni not yazamaz, eklerini indiremez. Notları SİLİNMEZ; yeniden açınca aynen geri gelir.",
    aramaRpc: "owner_ozellik_uye_ara",
    listeRpc: "ozellik_kullanici_kisitlarini_getir",
    ayarlaRpc: "owner_ozellik_kullanici_ayarla",
    durumAlani: "kisitli", // arama sonucunda "etkin" bilgisini taşıyan alan
    listeBaslik: "Şu an kapalı olanlar",
    listeBos: "Kişi bazında kapatılmış kimse yok.",
    aramaBos: "Eşleşen yazar/içerik sorumlusu/yönetici bulunamadı.",
    migrationAdi: "0059_notlar_yetki_ayarlari.sql",
    izinliDegeri: (etkin) => etkin, // kapalıysa → true (aç); açıksa → false (kapat)
    etiket: (etkin) =>
      etkin
        ? { durum: "Kapalı", dugme: "Yeniden aç", tehlikeli: false, kapaliGorunum: true }
        : { durum: "Açık", dugme: "Kapat", tehlikeli: true, kapaliGorunum: false },
    basariMesaji: (ad, izinli) =>
      izinli
        ? `${ad} için Notlarım yeniden açıldı.`
        : `${ad} için kapatıldı. Notları silinmedi; yeniden açınca geri gelir.`,
  },
  ac: {
    baslik: "Aç: normalde erişimi olmayan bir üyeye modülü ver",
    aciklama:
      "Üye ya da özel üye olan tek bir kişiye Notlarım'nı açarsın. Kişi YALNIZCA kendi şifreli " +
      "notlarını görür; yazı yayınlama, içerik/dosya yönetimi ya da başka hiçbir panel yetkisi kazanmaz, başkasının " +
      "hiçbir verisini göremez. Hesabı askıya alınırsa kullanamaz. İzni kaldırınca notları SİLİNMEZ; yeniden " +
      "verince aynen geri gelir.",
    aramaRpc: "owner_ozellik_uye_ara_izin",
    listeRpc: "ozellik_kullanici_izinlerini_getir",
    ayarlaRpc: "owner_ozellik_izin_ver",
    durumAlani: "izinli",
    listeBaslik: "Şu an izin verilmiş üyeler",
    listeBos: "Kişi bazında izin verilmiş üye yok.",
    aramaBos: "Eşleşen üye bulunamadı (yalnızca üye ve özel üye aranır).",
    migrationAdi: "0060_notlar_uye_izni.sql",
    izinliDegeri: (etkin) => !etkin, // izinliyse → false (kaldır); değilse → true (ver)
    etiket: (etkin) =>
      etkin
        ? { durum: "İzinli", dugme: "İzni kaldır", tehlikeli: true, kapaliGorunum: false }
        : { durum: "İzni yok", dugme: "İzin ver", tehlikeli: false, kapaliGorunum: true },
    basariMesaji: (ad, izinli) =>
      izinli
        ? `${ad} artık Notlarım'nı kullanabilir (yalnızca kendi notlarını görür).`
        : `${ad} için izin kaldırıldı. Notları silinmedi; izin yeniden verilirse geri gelir.`,
  },
};

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

/** Bir bölümü (arama + sonuçlar + etkin kişiler listesi) kurar ve DOM düğümünü döndürür. */
function bolumKur(anahtar, cfg, mesaj) {
  const aramaId = `nt-ya-arama-${anahtar}`;
  const arama = el("input", {
    type: "search",
    id: aramaId,
    autocomplete: "off",
    placeholder: "İsim ya da e-posta yaz (en az 2 harf)…",
    "aria-label": "Kullanıcı ara",
  });
  const sonuclar = el("div", { class: "nt-ya-liste", "aria-live": "polite" });
  const etkinler = el("div", { class: "nt-ya-liste" });

  const kisiSatiri = (k, etkin) => {
    const e = cfg.etiket(etkin);
    const durumSiniflari = [
      "nt-ya-durum",
      e.kapaliGorunum ? "nt-ya-durum-kapali" : "nt-ya-durum-acik",
      anahtar === "ac" && !etkin ? "nt-ya-durum-yok" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return el(
      "div",
      { class: `nt-ya-satir${anahtar === "kapat" && etkin ? " nt-ya-kapali" : ""}` },
      el(
        "div",
        { class: "nt-ya-bilgi" },
        el("strong", { text: k.full_name || "(isimsiz)" }),
        el("span", { class: "muted", text: `${k.email || "—"} · ${ROL_ETIKETI[k.rol] || k.rol}` })
      ),
      el("span", { class: durumSiniflari, text: e.durum }),
      el("button", {
        type: "button",
        class: e.tehlikeli ? "btn-danger csp-w-auto" : "btn-secondary csp-w-auto",
        text: e.dugme,
        onclick: (olay) => ayarla(k, etkin, olay.currentTarget),
      })
    );
  };

  async function ayarla(k, etkin, dugme) {
    dugme.disabled = true;
    const izinli = cfg.izinliDegeri(etkin);
    try {
      const { error } = await supabase.rpc(cfg.ayarlaRpc, {
        p_ozellik: OZELLIK,
        p_user_id: k.user_id,
        p_izinli: izinli,
      });
      if (error) throw error;
      showMessage(mesaj, cfg.basariMesaji(k.full_name || k.email || "Kullanıcı", izinli), "success");
      await Promise.all([etkinleriYukle(), aramayiYenile()]);
    } catch (hata) {
      console.error(hata);
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      dugme.disabled = false;
    }
  }

  async function etkinleriYukle() {
    const { data, error } = await supabase.rpc(cfg.listeRpc, { p_ozellik: OZELLIK });
    if (error) {
      const yok = /does not exist|42883|PGRST202/i.test(error.message || error.code || "");
      etkinler.replaceChildren(
        el("p", {
          class: "muted",
          text: yok ? `${cfg.migrationAdi} henüz çalıştırılmamış görünüyor.` : `Yüklenemedi: ${error.message}`,
        })
      );
      return;
    }
    etkinler.replaceChildren(
      ...(data?.length ? data.map((k) => kisiSatiri(k, true)) : [el("p", { class: "muted", text: cfg.listeBos })])
    );
  }

  let sonArama = 0;
  async function aramayiYenile() {
    const metin = arama.value.trim();
    const sira = ++sonArama;
    if (metin.length < 2) {
      sonuclar.replaceChildren();
      return;
    }
    const { data, error } = await supabase.rpc(cfg.aramaRpc, { p_ozellik: OZELLIK, p_arama: metin });
    if (sira !== sonArama) return; // daha yeni bir arama başladı, bu sonuç bayat
    if (error) return void sonuclar.replaceChildren(el("p", { class: "muted", text: `Aranamadı: ${error.message}` }));
    sonuclar.replaceChildren(
      ...(data?.length
        ? data.map((k) => kisiSatiri(k, !!k[cfg.durumAlani]))
        : [el("p", { class: "muted", text: cfg.aramaBos })])
    );
  }

  let zamanlayici;
  arama.addEventListener("input", () => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(aramayiYenile, 250);
  });

  etkinleriYukle();

  return el(
    "div",
    { class: "nt-ya-bolum", "data-bolum": anahtar },
    el("h4", { text: cfg.baslik }),
    el("p", { class: "muted", text: cfg.aciklama }),
    el("div", { class: "form-field" }, el("label", { for: aramaId, text: "Kullanıcı ara" }), arama),
    sonuclar,
    el("h5", { text: cfg.listeBaslik }),
    etkinler
  );
}

let kuruldu = false;

export function kur() {
  const kok = document.getElementById("ya-kullanici-alani");
  if (!kok || kuruldu) return;
  kuruldu = true;

  const mesaj = el("div", { class: "auth-message", hidden: true });

  kok.replaceChildren(
    el("h3", { text: "Notlarım — kullanıcı bazlı erişim" }),
    el("p", {
      class: "muted",
      text:
        "\"Özellikler\" sekmesindeki matristen bir rolün TAMAMI için kapatabilirsin. Burada ise tek tek kişilerle çalışırsın. " +
        "Yazar/içerik sorumlusu/yönetici için modül, rol kapalıysa VEYA kişi kapalıysa kapalıdır (ikisinin de açık olması gerekir). " +
        "Üye ve özel üye için modül varsayılan olarak kapalıdır; yalnızca sen açarsan çalışır.",
    }),
    bolumKur("kapat", BOLUMLER.kapat, mesaj),
    bolumKur("ac", BOLUMLER.ac, mesaj),
    mesaj
  );
}
