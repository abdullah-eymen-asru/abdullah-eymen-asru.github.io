/*
 * assets/js/gatekeeper/degisiklik-kaydi.js — Erişim Kalkanı "son değişiklik" kutusu + geçmiş
 * -----------------------------------------------------------------------------
 * kalkan-paneli.js tarafından kullanılır (sadece owner paneli). Veri kaynağı migration 0067:
 *   - site_ayarlari_loglarini_getir()  : sadece owner okur (sayfalı)
 *   - owner_site_log_sil / owner_site_loglarini_temizle : sadece owner siler
 * Kayıtları istemci YAZAMAZ; trigger/RPC yazar. Silme yetkisi ayrıca veritabanında owner'a kilitli,
 * buradaki butonlar sadece arayüzdür.
 *
 * innerHTML YOK: üye adı, e-posta, bakım mesajı, tarayıcı bilgisi kullanıcı verisidir; hepsi
 * textContent. Inline style YOK (CSP): görünüm dashboard.css'teki .gk-log-* sınıflarından gelir.
 */
import { supabase, showMessage } from "../core/supabase-client.js";

const SAYFA = 20;

const ROL_ETIKETI = {
  owner: "Site Sahibi",
  admin: "Yönetici (Admin)",
  manager: "İçerik Sorumlusu",
  editor: "Yazar (Editor)",
  special_user: "Özel Üye",
  user: "Üye",
};

const ISLEM_ETIKETI = {
  ayar_guncelleme: "Ayar güncellendi",
  onizleme_izni_verildi: "İzin verildi",
  onizleme_izni_kaldirildi: "İzin kaldırıldı",
};

const ALAN_ETIKETI = {
  github_io_aktif: "GitHub Pages erişimi",
  pages_dev_aktif: "Cloudflare Pages erişimi",
  kilitli_rotalar: "Kilitli sayfalar",
  bakim_mesaji: "Kilit ekranı mesajı",
  onizleme_izni: "Kilitli siteyi görme izni",
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

function tarihMetni(z) {
  if (!z) return "—";
  const d = new Date(z);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR");
}

function evetHayir(v) {
  return v === true ? "Evet" : v === false ? "Hayır" : "—";
}

function degerMetni(alan, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return alan === "onizleme_izni" ? (v ? "Var" : "Yok") : v ? "Açık" : "Kapalı";
  if (alan === "kilitli_rotalar" && typeof v === "object") {
    const parcalar = Object.entries(v).map(([host, liste]) => `${host}: ${Array.isArray(liste) && liste.length ? liste.join(", ") : "kilitli sayfa yok"}`);
    return parcalar.join(" · ");
  }
  return String(v);
}

function uyeAdi(b) {
  return b?.full_name || [b?.first_name, b?.last_name].filter(Boolean).join(" ") || b?.email || "Bilinmeyen üye";
}

function bilgiSatiri(etiket, deger) {
  return [el("dt", { text: etiket }), el("dd", { text: deger == null || deger === "" ? "—" : String(deger) })];
}

function uyeBilgileri(b, baslik) {
  const k = b || {};
  return el(
    "div",
    { class: "gk-log-blok" },
    el("h5", { text: baslik }),
    el(
      "dl",
      { class: "gk-log-dl" },
      bilgiSatiri("Ad Soyad", uyeAdi(k) === "Bilinmeyen üye" ? "—" : uyeAdi(k)),
      bilgiSatiri("E-posta", k.email),
      bilgiSatiri("Rol", ROL_ETIKETI[k.role] || k.role),
      bilgiSatiri("Hesap durumu", k.is_suspended ? "Askıya alınmış" : k.id ? "Aktif" : "—"),
      bilgiSatiri("Üyelik tarihi", k.created_at ? tarihMetni(k.created_at) : "—"),
      bilgiSatiri("Son giriş", k.son_giris ? tarihMetni(k.son_giris) : "—"),
      bilgiSatiri(
        "KVKK onayı",
        k.kvkk_onay_verildi === undefined
          ? "—"
          : `${evetHayir(k.kvkk_onay_verildi)}${k.kvkk_onay_tarihi ? ` · ${tarihMetni(k.kvkk_onay_tarihi)}` : ""}${k.kvkk_onay_versiyonu ? ` · sürüm ${k.kvkk_onay_versiyonu}` : ""}`
      ),
      bilgiSatiri(
        "Yurt dışı aktarım onayı",
        k.yurtdisi_onay_verildi === undefined
          ? "—"
          : `${evetHayir(k.yurtdisi_onay_verildi)}${k.yurtdisi_onay_tarihi ? ` · ${tarihMetni(k.yurtdisi_onay_tarihi)}` : ""}`
      ),
      bilgiSatiri("Hakkında", k.bio),
      bilgiSatiri("Üye kimliği", k.id)
    )
  );
}

function degisiklikBlogu(kayit) {
  const girdiler = Object.entries(kayit.degisiklikler || {});
  const liste = girdiler.length
    ? girdiler.map(([alan, fark]) =>
        el(
          "li",
          {},
          el("strong", { text: ALAN_ETIKETI[alan] || alan }),
          el(
            "span",
            { class: "gk-log-fark" },
            el("span", { class: "gk-log-eski", text: degerMetni(alan, fark?.eski) }),
            el("span", { class: "gk-log-ok", text: "→", "aria-label": "olarak değiştirildi" }),
            el("span", { class: "gk-log-yeni", text: degerMetni(alan, fark?.yeni) })
          )
        )
      )
    : [el("li", { class: "muted", text: "Ayrıntı kaydedilmemiş." })];
  return el("div", { class: "gk-log-blok" }, el("h5", { text: "Değişiklik ayrıntısı" }), el("ul", { class: "gk-log-degisiklikler" }, liste));
}

function islemBlogu(kayit) {
  return el(
    "div",
    { class: "gk-log-blok" },
    el("h5", { text: "İşlem bilgisi" }),
    el(
      "dl",
      { class: "gk-log-dl" },
      bilgiSatiri("Zaman", tarihMetni(kayit.created_at)),
      bilgiSatiri("İşlem", ISLEM_ETIKETI[kayit.islem] || kayit.islem),
      bilgiSatiri("IP adresi", kayit.ip),
      bilgiSatiri("Tarayıcı / cihaz", kayit.user_agent),
      bilgiSatiri("Kayıt no", kayit.id)
    )
  );
}

/**
 * @param {{gecmis: boolean}} secenek gecmis=true: kutunun altında geçmiş listesi + "daha fazla" + toplu temizle.
 * @returns {{kok: HTMLElement, yenile: () => Promise<void>}}
 */
export function logPaneliKur({ gecmis }) {
  const mesaj = el("div", { class: "auth-message", hidden: true });
  const kutuAlani = el("div", { class: "gk-log-kutu-alani", "aria-live": "polite" }, el("p", { class: "muted", text: "Değişiklik kaydı yükleniyor…" }));
  const gecmisListesi = el("div", { class: "gk-log-liste" });
  const dahaFazla = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Daha eski kayıtları göster", hidden: true });
  const temizle = el("button", { type: "button", class: "btn-danger csp-w-auto", text: "Tüm kayıtları temizle", hidden: true });

  let sonId = null; // en eski yüklenen kaydın id'si (sayfalama imleci)

  function kayitOgesi(kayit, { vurgulu = false } = {}) {
    const silBtn = el("button", {
      type: "button",
      class: "btn-danger csp-w-auto gk-log-sil",
      text: "Bu kaydı sil (sadece Site Sahibi)",
      onclick: async (olay) => {
        if (!window.confirm("Bu değişiklik kaydı kalıcı olarak silinecek. Geri alınamaz. Devam edilsin mi?")) return;
        const d = olay.currentTarget;
        d.disabled = true;
        try {
          const { error } = await supabase.rpc("owner_site_log_sil", { p_id: kayit.id });
          if (error) throw error;
          showMessage(mesaj, "Kayıt silindi.", "success");
          await yenile();
        } catch (hata) {
          showMessage(mesaj, `Silinemedi: ${hata.message || hata}`, "error");
          d.disabled = false;
        }
      },
    });

    const ad = uyeAdi(kayit.actor_bilgi);
    const rol = ROL_ETIKETI[kayit.actor_bilgi?.role] || kayit.actor_bilgi?.role || "";
    const ozet = el(
      "summary",
      { class: "gk-log-ozet" },
      el("span", { class: "gk-log-baslik" }, vurgulu ? el("span", { class: "gk-log-etiket", text: "Son değişiklik" }) : null, el("strong", { text: ad }), rol ? el("span", { class: "muted", text: ` · ${rol}` }) : null),
      el("span", { class: "gk-log-zaman muted", text: tarihMetni(kayit.created_at) }),
      el("span", { class: "gk-log-metin", text: kayit.ozet }),
      el("span", { class: "gk-log-ipucu muted", text: "Ayrıntı için tıkla" })
    );

    const ayrinti = el(
      "div",
      { class: "gk-log-ayrinti" },
      degisiklikBlogu(kayit),
      uyeBilgileri(kayit.actor_bilgi, "İşlemi yapan üye"),
      kayit.hedef_bilgi && Object.keys(kayit.hedef_bilgi).length ? uyeBilgileri(kayit.hedef_bilgi, "İzin verilen / alınan üye") : null,
      islemBlogu(kayit),
      el("div", { class: "csp-flex-gap10-wrap" }, silBtn)
    );
    return el("details", { class: `gk-log${vurgulu ? " gk-log-vurgulu" : ""}` }, ozet, ayrinti);
  }

  async function sayfaGetir(oncesi) {
    const { data, error } = await supabase.rpc("site_ayarlari_loglarini_getir", { p_limit: SAYFA, p_oncesi_id: oncesi });
    if (error) throw error;
    return data || [];
  }

  async function yenile() {
    try {
      const kayitlar = await sayfaGetir(null);
      sonId = null;
      gecmisListesi.replaceChildren();
      if (!kayitlar.length) {
        kutuAlani.replaceChildren(el("p", { class: "muted", text: "Henüz kayıtlı bir değişiklik yok. Bundan sonraki her değişiklik burada görünür." }));
        dahaFazla.hidden = true;
        temizle.hidden = true;
        return;
      }
      kutuAlani.replaceChildren(kayitOgesi(kayitlar[0], { vurgulu: true }));
      if (gecmis) {
        gecmisListesi.append(...kayitlar.slice(1).map((k) => kayitOgesi(k)));
        temizle.hidden = false;
        dahaFazla.hidden = kayitlar.length < SAYFA;
      }
      sonId = kayitlar[kayitlar.length - 1].id;
    } catch (hata) {
      const yok = /does not exist|42883|PGRST202/i.test(hata.message || hata.code || "");
      kutuAlani.replaceChildren(
        el("p", { class: "muted", text: yok ? "0067_site_ayarlari_degisiklik_kaydi.sql henüz çalıştırılmamış görünüyor." : `Değişiklik kaydı yüklenemedi: ${hata.message || hata}` })
      );
    }
  }

  dahaFazla.addEventListener("click", async () => {
    dahaFazla.disabled = true;
    try {
      const kayitlar = await sayfaGetir(sonId);
      gecmisListesi.append(...kayitlar.map((k) => kayitOgesi(k)));
      if (kayitlar.length) sonId = kayitlar[kayitlar.length - 1].id;
      dahaFazla.hidden = kayitlar.length < SAYFA;
    } catch (hata) {
      showMessage(mesaj, `Yüklenemedi: ${hata.message || hata}`, "error");
    } finally {
      dahaFazla.disabled = false;
    }
  });

  temizle.addEventListener("click", async () => {
    if (!window.confirm("TÜM değişiklik kayıtları kalıcı olarak silinecek. Bu işlem geri alınamaz ve silmenin kendisi kayıt altına alınmaz. Devam edilsin mi?")) return;
    temizle.disabled = true;
    try {
      const { data, error } = await supabase.rpc("owner_site_loglarini_temizle");
      if (error) throw error;
      showMessage(mesaj, `${data ?? 0} kayıt silindi.`, "success");
      await yenile();
    } catch (hata) {
      showMessage(mesaj, `Temizlenemedi: ${hata.message || hata}`, "error");
    } finally {
      temizle.disabled = false;
    }
  });

  const kok = el(
    "div",
    { class: "gk-log-kok" },
    el("h3", { text: "Son değişiklik" }),
    el("p", {
      class: "muted gk-p-kucuk",
      text:
        "Kim, ne zaman, ne değiştirdi? Kutuya tıklayınca üyenin bilgileri ve eski → yeni değerler açılır. " +
        "Kayıtlar düzenlenemez; yalnızca Site Sahibi silebilir.",
    }),
    kutuAlani,
    gecmis
      ? el(
          "details",
          { class: "gk-log-gecmis" },
          el("summary", { text: "Daha eski değişiklikler (geçmiş)" }),
          gecmisListesi,
          el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, dahaFazla, temizle)
        )
      : null,
    mesaj
  );

  yenile();
  return { kok, yenile };
}
