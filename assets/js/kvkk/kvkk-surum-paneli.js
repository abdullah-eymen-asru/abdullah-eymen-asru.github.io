/*
 * assets/js/kvkk/kvkk-surum-paneli.js — "Hukuki Metinler" sekmesi (sys-kvkk)
 * -----------------------------------------------------------------------------
 * Üç AYRI metin vardır ve birbirinden bağımsız yönetilir:
 *   • Gizlilik Politikası      — genel bilgilendirme; üyeden onay istenmez (sürüm etiketi yok).
 *   • KVKK Aydınlatma Metni    — site_ayarlari.guncel_kvkk_surumu  (kvkk_surumunu_degistir)
 *   • Açık Rıza Metni          — site_ayarlari.guncel_riza_surumu  (riza_surumunu_degistir)
 * Eski "paket" onay kutusu ve "Gelişmiş" bölümü kaldırıldı: her kartın kendi sürüm kutusu ve kendi düğmesi vardır.
 * Yetki (migration 0076): owner her zaman; admin için iki AYRI anahtar (aydınlatma / açık rıza), yalnızca owner açar.
 * Ayrıca her üyenin hangi sürümü ne zaman onayladığı (onay_gecmisi) arama + filtreyle izlenir.
 * Gerçek sınır veritabanındadır; bu dosya yalnızca arayüzdür. innerHTML YOK, inline stil YOK (CSP).
 */
import { supabase, showMessage, guncelKvkkSurumu, guncelOnaySurumleri } from "../core/supabase-client.js";
import { el, dugme, ikon, onayIste, tarihMetni } from "../sistem-yedek/ortak.js";

const BICIM = /^v[0-9]{1,3}\.[0-9]{1,3}$/;
const ROLLER = { owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "Editör", special_user: "Özel Üye", user: "Üye" };
const TUR_AD = { aydinlatma: "KVKK Aydınlatma", acik_riza: "Açık Rıza" };

const sonrakiOneri = (s) => { const m = /^v(\d+)\.(\d+)$/.exec(s || ""); return m ? `v${m[1]}.${Number(m[2]) + 1}` : "v1.0"; };
const yokMu = (e) => /does not exist|42883|PGRST202|42703|schema cache/i.test(`${e?.code || ""} ${e?.message || ""}`);

/** Tek metin kartı: yürürlükteki sürüm, istatistik, yeni sürüm kutusu ve kendi yayın düğmesi. */
function metinKarti({ baslik, link, surum, ozet, yetkili, yetkiNotu, onayMetni, yayinla, mesaj }) {
  let mevcut = surum;
  const surumMetni = el("p", { class: "hk-surum", text: mevcut });
  const ozetMetni = el("p", { class: "muted", text: ozet });
  const girdi = el("input", { type: "text", class: "sy-girdi", maxlength: "8", autocomplete: "off", spellcheck: "false", placeholder: sonrakiOneri(mevcut), "aria-label": `${baslik} yeni sürüm etiketi`, disabled: !yetkili });
  const dugmeYayin = dugme({ metin: "Yeni sürümü yayınla", ikonAdi: "tik", tur: "birincil", disabled: !yetkili });

  dugmeYayin.addEventListener("click", async () => {
    const yeni = girdi.value.trim();
    if (!BICIM.test(yeni)) return showMessage(mesaj, 'Sürüm "v1.2" biçiminde olmalı (v + sayı + nokta + sayı).', "error");
    if (yeni === mevcut) return showMessage(mesaj, "Bu zaten yürürlükteki sürüm.", "error");
    const sayilar = (v) => /^v(\d+)\.(\d+)$/.exec(v || "")?.slice(1).map(Number);
    const [yb, yk] = sayilar(yeni) || [0, 0]; const [mb, mk] = sayilar(mevcut) || [0, 0];
    if (yb < mb || (yb === mb && yk < mk)) return showMessage(mesaj, `Yeni sürüm (${yeni}) yürürlükteki sürümden (${mevcut}) küçük olamaz; sürüm numarası yalnızca artar.`, "error");
    const tamam = await onayIste({ baslik: `${baslik}: ${mevcut} → ${yeni}`, metin: [onayMetni, "Metni ÖNCE yayınladığından (deploy) emin ol. Yalnızca yazım düzeltmesi için sürüm yükseltme."], tamam: "Yayınla", tehlike: true });
    if (!tamam) return;
    dugmeYayin.disabled = true;
    try {
      mevcut = await yayinla(yeni);
      surumMetni.textContent = mevcut;
      girdi.value = "";
      girdi.placeholder = sonrakiOneri(mevcut);
      showMessage(mesaj, `Kaydedildi: ${baslik} ${mevcut} yürürlükte. Deploy gerekmez.`, "success");
    } catch (h) {
      showMessage(mesaj, `Kaydedilemedi: ${h.message || h}`, "error");
    } finally {
      dugmeYayin.disabled = !yetkili;
    }
  });

  return el("article", { class: "sy-kart hk-kart" },
    el("h3", { text: baslik }),
    surumMetni,
    ozetMetni,
    el("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "Sayfayı aç ↗" }),
    yetkili
      ? el("div", { class: "hk-form" }, el("label", { text: "Yeni sürüm etiketi" }), girdi, dugmeYayin)
      : el("p", { class: "sy-bilgi sy-bilgi--uyari" }, ikon("kalkan"), el("span", { text: yetkiNotu }))
  );
}

/** Admin yetki anahtarları (yalnızca owner görür): iki ayrı, açık etiketli anahtar. */
function yetkiBolumu(satir, mesaj) {
  const anahtar = (id, baslik, aciklama, ilkDeger, kolon) => {
    const kutu = el("input", { type: "checkbox", id, role: "switch" });
    kutu.checked = !!ilkDeger;
    kutu.addEventListener("change", async () => {
      const istenen = kutu.checked;
      kutu.disabled = true;
      try {
        // .select() ŞART: RLS yetkisiz UPDATE'i hata vermeden 0 satıra çevirir.
        const { data, error } = await supabase.from("site_ayarlari").update({ [kolon]: istenen }).eq("id", 1).select(kolon).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Kayıt güncellenmedi (yetkin yok ya da satır bulunamadı).");
        kutu.checked = !!data[kolon];
        showMessage(mesaj, `${baslik}: ${kutu.checked ? "açıldı (menü, adminin bir sonraki panel yüklemesinde görünür)" : "kapatıldı, yalnızca sen değiştirebilirsin"}.`, "success");
      } catch (h) {
        kutu.checked = !istenen;
        showMessage(mesaj, yokMu(h) ? "0076 numaralı migration henüz çalıştırılmamış." : `Kaydedilemedi: ${h.message || h}`, "error");
      } finally {
        kutu.disabled = false;
      }
    });
    return el("div", { class: "hk-anahtar" }, el("label", { for: id }, el("strong", { text: baslik }), el("p", { text: aciklama })), kutu);
  };
  return el("section", { class: "sy-kart hk-kart" },
    el("h3", { text: "Adminlere yetki ver" }),
    el("p", { class: "muted", text: "Sürüm yükseltmek tüm üyelere yeniden onay ekranı gösterdiği için ikisi de varsayılan KAPALIDIR. İki yetki birbirinden bağımsızdır." }),
    anahtar("hk-yetki-kvkk", "Adminler KVKK Aydınlatma sürümünü değiştirebilsin", "Kapalıyken yalnızca Site Sahibi yükseltir.", satir.admin_degistirebilir, "kvkk_surum_admin_degistirebilir"),
    anahtar("hk-yetki-riza", "Adminler Açık Rıza sürümünü değiştirebilsin", "Kapalıyken yalnızca Site Sahibi yükseltir.", satir.riza_admin_degistirebilir, "riza_surum_admin_degistirebilir")
  );
}

/** E-posta ekranda maskeli gösterilir (yalnızca Site Sahibi'ne zaten döner): "ey•••@gmail.com". */
const epostaMaskele = (e) => {
  const m = /^([^@]{1,2})[^@]*(@.+)$/.exec(String(e || ""));
  return m ? `${m[1]}•••${m[2]}` : "";
};

/**
 * Üye onay kayıtları: arama + filtre + sayfalama + her üyenin zaman damgalı geçmişi.
 * KARARLILIK (arama sırasında sayfanın kasması/zıplaması düzeltmeleri):
 *  - Liste her istekte "Yükleniyor…" ile BOŞALTILMAZ (yükseklik çökmüyor → sayfa zıplamıyor). Eski içerik soluk kalır,
 *    yanıt gelince tek hamlede değişir; ilk yüklemede sabit yükseklikli iskelet satırlar gösterilir.
 *  - İstek numarası: geç gelen eski yanıt yenisinin üzerine yazamaz (yarış durumu).
 *  - Debounce 350 ms, Türkçe IME bileşimi (composition) sırasında istek atılmaz, aynı sorgu tekrar sorulmaz.
 *  - Sayfa/filtre değişince boş sayfada kalınmaz; sayfa değişince araç çubuğu görünür alana getirilir.
 *  - İç içe kaydırma kaldırıldı (liste sayfayla birlikte kayar; sayfalama zaten uzunluğu sınırlar).
 */
function uyeKayitlari() {
  const SAYFA = 15;
  let q = "";
  let filtre = "hepsi";
  let ofset = 0;
  let toplam = 0;
  let istekNo = 0;
  let mesgul = false;
  let zamanlayici = null;
  let bilesim = false;
  let sonSorgu = "";

  const girdi = el("input", { type: "search", class: "sy-girdi", placeholder: "Üye adıyla ara…", "aria-label": "Üye ara", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", maxlength: "80" });
  const temizleBtn = el("button", { type: "button", class: "hk-arama-temizle", "aria-label": "Aramayı temizle", hidden: true });
  temizleBtn.append(ikon("kapat"));
  const cipler = el("div", { class: "sy-cipler", role: "group", "aria-label": "Onay durumu filtresi" });
  const liste = el("div", { class: "hk-liste", "aria-live": "polite", "aria-busy": "false" });
  const bilgi = el("span", { class: "muted hk-sayfa-bilgi", role: "status" });
  const oncekiBtn = dugme({ metin: "Önceki", tur: "ikincil", kucuk: true });
  const sonrakiBtn = dugme({ metin: "Sonraki", tur: "ikincil", kucuk: true });
  const sayfalama = el("div", { class: "sy-sayfalama hk-sayfalama" }, oncekiBtn, bilgi, sonrakiBtn);
  const FILTRELER = [["hepsi", "Hepsi"], ["eski", "Güncel olmayan onay"], ["rizasiz", "Açık rızası yok"], ["onaysiz", "Aydınlatma onayı yok"]];

  const cipCiz = () => cipler.replaceChildren(...FILTRELER.map(([k, ad]) => {
    const b = el("button", { type: "button", class: "sy-sec", "aria-pressed": String(filtre === k), text: ad });
    b.addEventListener("click", () => { if (filtre === k) return; filtre = k; ofset = 0; cipCiz(); yukle(); });
    return b;
  }));

  const rozet = (verildi, guncel, surum, tarih, ad) => {
    if (!verildi) return el("span", { class: "sy-rozet sy-rozet--d-basarisiz", text: `${ad}: yok` });
    return el("span", { class: `sy-rozet ${guncel ? "sy-rozet--iyi" : "sy-rozet--uyari"}`, text: `${ad}: ${surum || "?"} · ${tarih ? tarihMetni(tarih) : "tarih yok"}${guncel ? "" : " (eski)"}` });
  };

  const gecmisKutusu = async (u, kutu) => {
    const no = (kutu._no = (kutu._no || 0) + 1);
    kutu.replaceChildren(el("p", { class: "muted", text: "Yükleniyor…" }));
    const { data, error } = await supabase.rpc("uye_onay_gecmisi", { p_uye: u.id });
    if (no !== kutu._no) return;
    if (error) {
      const tekrar = dugme({ metin: "Tekrar dene", tur: "ikincil", kucuk: true });
      tekrar.addEventListener("click", () => gecmisKutusu(u, kutu));
      return kutu.replaceChildren(el("p", { class: "auth-message error", text: error.message }), tekrar);
    }
    kutu.replaceChildren(!data?.length
      ? el("p", { class: "muted", text: "Bu üye için kayıt yok." })
      : el("ul", { class: "hk-zaman" }, data.map((g) => el("li", {},
          el("strong", { text: `${TUR_AD[g.tur] || g.tur} · ${g.islem === "onay" ? "onayladı" : "geri çekti"}` }),
          ` ${g.surum || ""} — ${tarihMetni(g.olusturma_tarihi)}`,
          g.kaynak === "geri_doldurma" ? el("span", { class: "muted", text: " (mevcut durumdan aktarıldı; önceki sürümler bilinmiyor)" }) : null))));
  };

  const satirCiz = (u) => {
    const gecmis = el("div", { hidden: true });
    const btn = dugme({ metin: "Geçmiş", ikonAdi: "ara", tur: "ikincil", kucuk: true, "aria-expanded": "false" });
    const etiket = btn.querySelector("span");
    btn.addEventListener("click", () => {
      const acik = !gecmis.hidden;
      gecmis.hidden = acik;
      btn.setAttribute("aria-expanded", String(!acik));
      if (etiket) etiket.textContent = acik ? "Geçmiş" : "Gizle";
      if (!acik && !gecmis.dataset.yuklendi) { gecmis.dataset.yuklendi = "1"; gecmisKutusu(u, gecmis); }
    });
    return el("article", { class: "hk-satir" },
      el("div", { class: "hk-satir-ust" }, el("strong", { text: `${u.ad} · ${ROLLER[u.rol] || u.rol}` }), btn),
      u.eposta ? el("small", { class: "muted", text: epostaMaskele(u.eposta) }) : null,
      el("div", { class: "hk-satir-durum" }, rozet(u.kvkk_verildi, u.kvkk_guncel, u.kvkk_surum, u.kvkk_tarih, "Aydınlatma"), rozet(u.riza_verildi, u.riza_guncel, u.riza_surum, u.riza_tarih, "Açık rıza")),
      gecmis);
  };

  const iskelet = () => liste.replaceChildren(...[0, 1, 2].map(() => el("div", { class: "hk-satir hk-iskelet", "aria-hidden": "true" })));

  const durumuGuncelle = () => {
    liste.setAttribute("aria-busy", String(mesgul));
    liste.classList.toggle("hk-liste--mesgul", mesgul);
    oncekiBtn.disabled = mesgul || ofset === 0;
    sonrakiBtn.disabled = mesgul || ofset + SAYFA >= toplam;
    bilgi.textContent = toplam ? `${ofset + 1}–${Math.min(ofset + SAYFA, toplam)} / ${toplam}` : "";
    sayfalama.hidden = toplam <= SAYFA;
  };

  async function yukle({ kaydir = false } = {}) {
    const no = ++istekNo;
    mesgul = true;
    if (!liste.children.length) iskelet();
    durumuGuncelle();
    const { data, error } = await supabase.rpc("uye_onay_durumlari", { p_q: q, p_filtre: filtre, p_limit: SAYFA, p_ofset: ofset });
    if (no !== istekNo) return; // daha yeni bir istek var; bu yanıt eski
    mesgul = false;
    if (error) {
      const tekrar = dugme({ metin: "Tekrar dene", tur: "ikincil", kucuk: true });
      tekrar.addEventListener("click", () => yukle());
      liste.replaceChildren(el("p", { class: "auth-message error", text: yokMu(error) ? "0076 numaralı migration henüz çalıştırılmamış." : error.message }), tekrar);
      durumuGuncelle();
      return;
    }
    const satirlar = data || [];
    if (!satirlar.length && ofset > 0) { ofset = 0; return yukle(); } // silinme/filtre sonrası boş sayfada kalma
    toplam = satirlar[0] ? Number(satirlar[0].toplam) : 0;
    liste.replaceChildren(...(satirlar.length ? satirlar.map(satirCiz) : [el("p", { class: "muted hk-bos", text: q || filtre !== "hepsi" ? "Bu arama/filtreyle eşleşen üye yok." : "Henüz üye yok." })]));
    durumuGuncelle();
    if (kaydir) {
      const r = araCubugu.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) araCubugu.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  const sorguyuUygula = () => {
    const yeni = girdi.value.trim();
    temizleBtn.hidden = !girdi.value;
    if (yeni === sonSorgu) return;
    sonSorgu = yeni; q = yeni; ofset = 0;
    yukle();
  };
  girdi.addEventListener("compositionstart", () => { bilesim = true; });
  girdi.addEventListener("compositionend", () => { bilesim = false; clearTimeout(zamanlayici); zamanlayici = setTimeout(sorguyuUygula, 350); });
  girdi.addEventListener("input", () => {
    temizleBtn.hidden = !girdi.value;
    if (bilesim) return;
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(sorguyuUygula, 350);
  });
  girdi.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(zamanlayici); sorguyuUygula(); }
    else if (e.key === "Escape" && girdi.value) { e.preventDefault(); girdi.value = ""; clearTimeout(zamanlayici); sorguyuUygula(); }
  });
  temizleBtn.addEventListener("click", () => { girdi.value = ""; clearTimeout(zamanlayici); sorguyuUygula(); girdi.focus(); });
  oncekiBtn.addEventListener("click", () => { if (mesgul) return; ofset = Math.max(0, ofset - SAYFA); yukle({ kaydir: true }); });
  sonrakiBtn.addEventListener("click", () => { if (mesgul) return; ofset += SAYFA; yukle({ kaydir: true }); });

  const araCubugu = el("div", { class: "hk-aracubugu" }, el("div", { class: "sy-arama" }, ikon("ara"), girdi, temizleBtn), cipler);
  cipCiz();
  yukle();
  return el("section", { class: "sy-bolum hk-uyeler" },
    el("h2", { text: "Üye onay kayıtları" }),
    el("p", { class: "muted", text: "Her üyenin hangi aydınlatma ve açık rıza sürümünü ne zaman onayladığı (veya geri çektiği) otomatik kaydedilir. E-posta adresleri maskelenir." }),
    araCubugu, liste, sayfalama);
}

async function kur() {
  const kok = document.getElementById("kvkk-surum-kok");
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  const { data: ozet, error } = await supabase.rpc("kvkk_onay_ozeti");
  const satir = Array.isArray(ozet) ? ozet[0] : ozet;
  if (error || !satir || satir.kvkk_yetkim === undefined) {
    kok.replaceChildren(el("p", { class: "muted", text: yokMu(error) || (!error && (!satir || satir.kvkk_yetkim === undefined))
      ? "0064, 0065, 0070, 0073 ve 0076 numaralı migration'lar tam çalıştırılmamış görünüyor: dosyaları SQL Editor'de sırayla çalıştır."
      : `Yüklenemedi: ${error.message}` }));
    return;
  }

  const toplam = Number(satir.toplam);
  const kvkkKart = metinKarti({
    baslik: "KVKK Aydınlatma Metni", link: "/kurumsal/kvkk-aydinlatma-metni.html", surum: satir.guncel_surum, mesaj,
    ozet: `${toplam} üyeden ${satir.guncel}'i bu sürümü onaylamış` + (Number(satir.eski) > 0 ? `; ${satir.eski} üyeye giriş yapınca onay ekranı çıkacak.` : ".") + (Number(satir.onaysiz) > 0 ? ` ${satir.onaysiz} üye henüz onay vermemiş.` : ""),
    yetkili: !!satir.kvkk_yetkim, yetkiNotu: "Bu sürümü değiştirme yetkin yok. Site Sahibi bu yetkiyi senin için açabilir.",
    onayMetni: `Onayı eşleşmeyen üyelere (şu an ${satir.eski}) bir sonraki girişte ekranı kilitleyen yeniden onay penceresi gösterilir.`,
    yayinla: async (yeni) => {
      const { data, error: e } = await supabase.rpc("kvkk_surumunu_degistir", { p_surum: yeni });
      if (e) throw e;
      await guncelKvkkSurumu({ yenile: true });
      return data;
    },
  });
  const rizaKart = metinKarti({
    baslik: "Açık Rıza Metni", link: "/kurumsal/acik-riza-metni.html", surum: satir.riza_surumu, mesaj,
    ozet: `${satir.riza_verenler} üye açık rıza vermiş; ${satir.riza_guncel}'i bu sürümü onaylamış` + (Number(satir.riza_eski) > 0 ? `, ${satir.riza_eski}'ine giriş yapınca rızayı yenileme ekranı çıkacak.` : "."),
    yetkili: !!satir.riza_yetkim, yetkiNotu: "Açık rıza sürümünü değiştirme yetkin yok. Site Sahibi bu yetkiyi senin için açabilir.",
    onayMetni: `Rıza vermiş ${satir.riza_verenler} üye bir sonraki girişte rızayı yeniden verme / geri çekme ekranını görür.`,
    yayinla: async (yeni) => {
      const { data, error: e } = await supabase.rpc("riza_surumunu_degistir", { p_surum: yeni });
      if (e) throw e;
      await guncelOnaySurumleri({ yenile: true });
      return data;
    },
  });

  kok.classList.add("sy-kok");
  kok.replaceChildren(
    el("div", { class: "hk-kartlar" }, kvkkKart, rizaKart),
    el("p", { class: "sy-bilgi" }, ikon("uyari"), el("span", { text: "Sıra: (1) ilgili metin sayfasını değiştirip deploy et, (2) burada sürümü yükselt. Gizlilik Politikası genel bilgilendirmedir; üyeden onay istenmediği için sürümü burada yönetilmez." })),
    satir.sahip_mi ? yetkiBolumu(satir, mesaj) : null,
    uyeKayitlari()
  );
}

kur().catch((hata) => {
  console.error("kvkk-surum-paneli.js:", hata);
  const mesaj = document.getElementById("kvkk-surum-mesaj");
  if (mesaj) showMessage(mesaj, `Panel yüklenemedi: ${hata.message || hata}`, "error");
});
