/*
 * assets/js/gatekeeper/kalkan-paneli.js — Yetki Ayarları > "Alan Adı & Sayfa Erişim Kalkanı"
 * -----------------------------------------------------------------------------
 * dashboard.js, "Yetki Ayarları" sekmesi (sys-yetki) açılınca bu modülü import() eder
 * (MODULES.kalkan, role: "owner"). Asıl sınır veritabanında (migration 0061):
 *   - site_ayarlari UPDATE politikası is_owner() ister,
 *   - izin RPC'leri is_owner() ister.
 * Bu dosya yalnızca arayüzdür.
 *
 * Rota kataloğu burada TEKRAR YAZILMAZ: window.AeaGatekeeper.ROTALAR (gatekeeper.js)
 * kullanılır — matris ile kilit kararı aynı listeden beslenir, ayrışamaz.
 *
 * innerHTML YOK: üye adı/e-posta/bakım mesajı kullanıcı verisidir, hepsi textContent/value.
 * Inline style YOK (CSP): görünüm dashboard.css'teki .gk-p-* ve github-yonetim.css'teki
 * .ya-tablo/.ya-mini-toggle sınıflarından gelir.
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { logPaneliKur } from "./degisiklik-kaydi.js";

// "Son değişiklik" kutuları (Erişim Kalkanı + Kilit İzinleri sekmeleri): bir işlem kaydedilince
// ikisi de aynı anda tazelenir. Kayıtları veritabanı trigger/RPC'si yazar (migration 0067).
const logYenileyiciler = [];
const logYenile = () => logYenileyiciler.forEach((f) => f());

const HOSTLAR = [
  { anahtar: "github.io", ad: "GitHub Pages" },
  { anahtar: "pages.dev", ad: "Cloudflare Pages" },
];
const ROL_ETIKETI = {
  editor: "Yazar (Editor)",
  manager: "İçerik Sorumlusu",
  special_user: "Özel Üye",
  user: "Üye",
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

function anahtarSatiri(id, etiket, secili) {
  const input = el("input", { type: "checkbox", id });
  input.checked = !!secili;
  const kutu = el(
    "label",
    { class: "ya-mini-toggle", for: id },
    input,
    el("span", { class: "ya-mini-track" }, el("span", { class: "ya-mini-thumb" }))
  );
  return { input, satir: el("div", { class: "gk-p-anahtar" }, kutu, el("label", { for: id, text: etiket })) };
}

/* ---------------------------- Üye bazlı izin ---------------------------- */

function izinBolumuKur(mesaj) {
  const arama = el("input", {
    type: "search",
    id: "gk-uye-arama",
    autocomplete: "off",
    placeholder: "İsim ya da e-posta yaz (en az 2 harf)…",
    "aria-label": "Üye ara",
  });
  const sonuclar = el("div", { class: "nt-ya-liste", "aria-live": "polite" });
  const izinliler = el("div", { class: "nt-ya-liste" });

  const satir = (k, izinli) =>
    el(
      "div",
      { class: "nt-ya-satir" },
      el(
        "div",
        { class: "nt-ya-bilgi" },
        el("strong", { text: k.full_name || "(isimsiz)" }),
        el("span", { class: "muted", text: `${k.email || "—"} · ${ROL_ETIKETI[k.rol] || k.rol}` })
      ),
      el("span", {
        class: `nt-ya-durum ${izinli ? "nt-ya-durum-acik" : "nt-ya-durum-kapali nt-ya-durum-yok"}`,
        text: izinli ? "Görebilir" : "İzni yok",
      }),
      el("button", {
        type: "button",
        class: izinli ? "btn-danger csp-w-auto" : "btn-secondary csp-w-auto",
        text: izinli ? "İzni kaldır" : "İzin ver",
        onclick: (olay) => degistir(k, !izinli, olay.currentTarget),
      })
    );

  async function degistir(k, yeniDeger, dugme) {
    dugme.disabled = true;
    try {
      const { error } = await supabase.rpc("owner_site_onizleme_izni_ver", {
        p_user_id: k.user_id,
        p_izinli: yeniDeger,
      });
      if (error) throw error;
      const ad = k.full_name || k.email || "Kullanıcı";
      showMessage(
        mesaj,
        yeniDeger
          ? `${ad} artık kilitli sayfaları görebilir (izin, tarayıcısında en geç 5 dk içinde geçerli olur).`
          : `${ad} için izin kaldırıldı.`,
        "success"
      );
      await Promise.all([izinlileriYukle(), aramayiYenile()]);
      logYenile();
    } catch (hata) {
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      dugme.disabled = false;
    }
  }

  async function izinlileriYukle() {
    const { data, error } = await supabase.rpc("site_onizleme_izinlilerini_getir");
    if (error) {
      const yok = /does not exist|42883|PGRST202/i.test(error.message || error.code || "");
      izinliler.replaceChildren(
        el("p", { class: "muted", text: yok ? "0061_site_ayarlari_gatekeeper.sql henüz çalıştırılmamış görünüyor." : `Yüklenemedi: ${error.message}` })
      );
      return;
    }
    izinliler.replaceChildren(
      ...(data?.length ? data.map((k) => satir(k, true)) : [el("p", { class: "muted", text: "Kişi bazında izin verilmiş üye yok." })])
    );
  }

  let sonArama = 0;
  async function aramayiYenile() {
    const metin = arama.value.trim();
    const sira = ++sonArama;
    if (metin.length < 2) return void sonuclar.replaceChildren();
    const { data, error } = await supabase.rpc("owner_site_onizleme_uye_ara", { p_arama: metin });
    if (sira !== sonArama) return; // daha yeni bir arama başladı
    if (error) return void sonuclar.replaceChildren(el("p", { class: "muted", text: `Aranamadı: ${error.message}` }));
    sonuclar.replaceChildren(
      ...(data?.length ? data.map((k) => satir(k, !!k.izinli)) : [el("p", { class: "muted", text: "Eşleşen üye bulunamadı (owner ve adminler zaten otomatik görür)." })])
    );
  }

  let zamanlayici;
  arama.addEventListener("input", () => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(aramayiYenile, 250);
  });
  izinlileriYukle();

  return el(
    "div",
    { class: "nt-ya-bolum" },
    el("h3", { text: "Kilitli sayfaları görüntüleme izni (üye bazlı)" }),
    el("p", {
      class: "muted",
      text:
        "Owner ve (askıda olmayan) adminler kilidi her zaman otomatik aşar. Burada, bunların dışındaki " +
        "tek tek üyelere (yazar, içerik sorumlusu, özel üye, üye) 'kilitli siteyi yine de görebilir' izni verirsin. " +
        "Askıya alınmış hesap izinli olsa da göremez. İzin yalnızca siteyi GÖRÜNTÜLEME içindir; panel yetkisi vermez.",
    }),
    el("div", { class: "form-field" }, el("label", { for: "gk-uye-arama", text: "Üye ara" }), arama),
    sonuclar,
    el("h5", { text: "Şu an izin verilmiş üyeler" }),
    izinliler
  );
}

/* ------------------------------ Ana bölüm ------------------------------ */

async function kur() {
  const kok = document.getElementById("gk-kok");
  const mesaj = document.getElementById("gk-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  // Üye bazlı izin listesi artık kendi alt sekmesinde ("Kilit İzinleri"): ayrı kök + ayrı mesaj
  // alanı (mesaj o sekmede görünür olmalı). Ana ayarlar yüklenemese bile bu liste bağımsız
  // çalışsın diye en başta kurulur. Eski HTML'de kök yoksa eskisi gibi ana kökün altına eklenir.
  const izinKok = document.getElementById("gk-izin-kok");
  const izinKurucu = () => izinBolumuKur(document.getElementById("gk-izin-mesaj") || mesaj);
  const izinLog = logPaneliKur({ gecmis: false });
  logYenileyiciler.push(izinLog.yenile);
  if (izinKok) izinKok.replaceChildren(izinLog.kok, izinKurucu());
  const kalkanLog = logPaneliKur({ gecmis: true });
  logYenileyiciler.push(kalkanLog.yenile);

  const katalog = window.AeaGatekeeper?.ROTALAR;
  if (!katalog) {
    kok.replaceChildren(el("p", { class: "muted", text: "gatekeeper.js yüklenemedi: rota kataloğu okunamadı." }));
    return;
  }

  const { data: mevcut, error } = await supabase.from("site_ayarlari").select("*").eq("id", 1).maybeSingle();
  if (error || !mevcut) {
    const yok = !mevcut && !error;
    const tabloYok = /does not exist|42P01|PGRST205|schema cache/i.test(error?.message || error?.code || "");
    kok.replaceChildren(
      el("p", {
        class: "muted",
        text:
          tabloYok || yok
            ? "site_ayarlari tablosu/satırı bulunamadı: supabase/migrations/0061_site_ayarlari_gatekeeper.sql dosyasını SQL Editor'de çalıştır."
            : `Ayarlar yüklenemedi: ${error.message}`,
      })
    );
    return;
  }

  // Alan adı anahtarları
  const hostAnahtar = {};
  const anahtarKutusu = el("div", { class: "gk-p-anahtarlar" });
  const hostBayrak = { "github.io": mevcut.github_io_aktif, "pages.dev": mevcut.pages_dev_aktif };
  for (const h of HOSTLAR) {
    const a = anahtarSatiri(`gk-host-${h.anahtar.replace(".", "-")}`, `${h.ad} (${h.anahtar}) erişime açık`, hostBayrak[h.anahtar]);
    hostAnahtar[h.anahtar] = a.input;
    anahtarKutusu.append(a.satir);
  }

  // Rota matrisi: işaretli = AÇIK; işaretsiz = kilitli. Alan adı kapalıysa o sütun pasif.
  const mevcutKilitler = mevcut.kilitli_rotalar || {};
  const katalogAnahtarlari = new Set(katalog.map((r) => r.anahtar));
  const hucre = {}; // `${host}::${rota}` -> input
  const govde = el("tbody", { role: "rowgroup" });
  for (const rota of katalog) {
    const tr = el("tr", { role: "row" }, el("td", { role: "rowheader", class: "ya-ozellik-hucre" }, el("span", { class: "ya-ozellik-adi", text: rota.ad }), el("span", { class: "ya-ozellik-aciklama", text: rota.anahtar })));
    for (const h of HOSTLAR) {
      const kilitli = Array.isArray(mevcutKilitler[h.anahtar]) && mevcutKilitler[h.anahtar].includes(rota.anahtar);
      const input = el("input", { type: "checkbox", "data-gk-host": h.anahtar, "data-gk-rota": rota.anahtar, "aria-label": `${rota.ad} — ${h.ad}` });
      input.checked = !kilitli;
      hucre[`${h.anahtar}::${rota.anahtar}`] = input;
      tr.append(el("td", { role: "cell", "data-label": h.ad }, el("label", { class: "ya-mini-toggle" }, input, el("span", { class: "ya-mini-track" }, el("span", { class: "ya-mini-thumb" })))));
    }
    govde.append(tr);
  }
  const tablo = el(
    "table",
    { class: "ya-tablo", role: "table" },
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, el("th", { scope: "col", text: "Sayfa / bölüm" }), ...HOSTLAR.map((h) => el("th", { scope: "col", text: h.ad })))),
    govde
  );

  const pasiflikGuncelle = () => {
    for (const h of HOSTLAR) {
      const kapali = !hostAnahtar[h.anahtar].checked;
      for (const rota of katalog) hucre[`${h.anahtar}::${rota.anahtar}`].disabled = kapali;
    }
  };
  for (const h of HOSTLAR) hostAnahtar[h.anahtar].addEventListener("change", pasiflikGuncelle);
  pasiflikGuncelle();

  const mesajAlani = el("textarea", { id: "gk-bakim-mesaji", rows: "3", maxlength: "500", spellcheck: "false" });
  mesajAlani.value = mevcut.bakim_mesaji || "";

  const kaydetBtn = el("button", { type: "button", id: "gk-kaydet-btn", class: "btn-primary csp-w-auto", text: "Ayarları Kaydet" });
  const sonGuncelleme = el("p", { class: "muted gk-p-kucuk", text: sonGuncellemeMetni(mevcut.guncellenme_tarihi) });

  kaydetBtn.addEventListener("click", async () => {
    const acikHost = Object.fromEntries(HOSTLAR.map((h) => [h.anahtar, hostAnahtar[h.anahtar].checked]));
    if (!acikHost["github.io"] && !acikHost["pages.dev"]) {
      const onay = window.confirm(
        "İki alan adı da erişime KAPATILACAK. Sen (owner) ve adminler kilidi aşmaya devam edersiniz, ama tüm ziyaretçiler " +
          "(Play Store uygulamasındaki WebView dahil) kilit ekranı görür. Devam edilsin mi?"
      );
      if (!onay) return;
    }

    // Katalogda olmayan (elle eklenmiş) rotalar silinmesin; katalogdakiler matristen yeniden kurulur.
    const kilitli = {};
    for (const h of HOSTLAR) {
      const eskiBilinmeyen = (Array.isArray(mevcutKilitler[h.anahtar]) ? mevcutKilitler[h.anahtar] : []).filter((r) => !katalogAnahtarlari.has(r));
      const yeni = katalog.filter((r) => !hucre[`${h.anahtar}::${r.anahtar}`].checked).map((r) => r.anahtar);
      kilitli[h.anahtar] = [...eskiBilinmeyen, ...yeni];
    }

    kaydetBtn.disabled = true;
    try {
      // .select() ŞART: RLS yetkisiz UPDATE'i hata vermeden 0 satıra çevirir; dönen satırı
      // kontrol etmezsek "kaydedildi" deyip hiçbir şey değişmemiş olurdu.
      const { data, error: hata } = await supabase
        .from("site_ayarlari")
        .update({
          github_io_aktif: acikHost["github.io"],
          pages_dev_aktif: acikHost["pages.dev"],
          kilitli_rotalar: kilitli,
          bakim_mesaji: mesajAlani.value.trim() || "Bu sayfa şu an bakımda. Kısa süre sonra yeniden açılacak.",
        })
        .eq("id", 1)
        .select()
        .maybeSingle();
      if (hata) throw hata;
      if (!data) throw new Error("Kayıt güncellenmedi (yetkin yok ya da satır bulunamadı).");

      // Bu tarayıcının gatekeeper önbelleğini at: ziyaretçiler en geç ~60 sn içinde yeni ayarı alır.
      try {
        localStorage.removeItem(window.AeaGatekeeper.AYAR_ANAHTARI);
      } catch {
        /* depo kapalı: önemli değil */
      }
      sonGuncelleme.textContent = sonGuncellemeMetni(data.guncellenme_tarihi);
      showMessage(mesaj, "Kaydedildi. Ziyaretçilere en geç yaklaşık 1 dakika içinde yansır; deploy gerekmez.", "success");
      logYenile();
    } catch (hata) {
      showMessage(mesaj, `Kaydedilemedi: ${hata.message || hata}`, "error");
    } finally {
      kaydetBtn.disabled = false;
    }
  });

  kok.replaceChildren(
    kalkanLog.kok,
    el("h3", { class: "csp-mt-18", text: "Alan adı erişimi" }),
    anahtarKutusu,
    el("h3", { class: "csp-mt-18", text: "Sayfa / bölüm bazlı kısıtlama" }),
    el("p", {
      class: "muted",
      text:
        "İşaretli = erişime açık, işaretsiz = kilitli. Alan adı tamamen kapalıysa o sütun pasif kalır (kapalı alan adında hiçbir sayfa açılmaz). " +
        "Giriş sayfaları (/hesap), panel ve gizlilik politikası hiçbir koşulda kilitlenmez; böylece kendini dışarıda bırakamazsın.",
    }),
    el("div", { class: "gk-p-tablo-sarmal ya-tablo-sarmal" }, tablo),
    el("div", { class: "form-field csp-mt-16" }, el("label", { for: "gk-bakim-mesaji", text: "Kilit ekranında görünecek mesaj (en çok 500 karakter)" }), mesajAlani),
    el("div", { class: "csp-flex-gap10-wrap csp-mt-12" }, kaydetBtn),
    sonGuncelleme,
    el("p", {
      class: "gy-yardim-metni",
      text:
        "Kilidi görmek için gizli pencere aç: owner/admin olarak giriş yaptıysan kilit seni etkilemez. " +
        "Bu kilit, sayfayı tarayıcıda gizleyen bir perdedir; HTML dosyalarını, RSS/sitemap'i ve R2 bağlantılarını sunucudan kaldırmaz.",
    })
  );
  if (!izinKok) kok.append(izinKurucu()); // eski HTML: ayrı kök yok
}

function sonGuncellemeMetni(zaman) {
  if (!zaman) return "";
  const d = new Date(zaman);
  return Number.isNaN(d.getTime()) ? "" : `Son güncelleme: ${d.toLocaleString("tr-TR")}`;
}

kur().catch((hata) => {
  console.error("kalkan-paneli.js:", hata);
  const mesaj = document.getElementById("gk-mesaj");
  if (mesaj) showMessage(mesaj, `Kalkan paneli yüklenemedi: ${hata.message || hata}`, "error");
});
