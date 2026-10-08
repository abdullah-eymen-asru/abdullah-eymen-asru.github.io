/*
 * assets/js/uye-disa-aktar/yetki-paneli.js — "Üye Verisi İndirme" sekmesi (sys-uye-aktarim, SADECE Site Sahibi)
 * -----------------------------------------------------------------------
 * Sade akış: her yönetici için tek satır → "Düzenle" → üç seçenek (Erişim yok · Tüm üyeler · Belirli roller),
 * isteğe bağlı gelişmiş kısım (tek tek üye ekle / hariç tut). Altında indirme geçmişi (tam ad, seç, sil).
 * Gerçek sınır veritabanındadır (migration 0069 + 0071); bu dosya yalnızca arayüzdür.
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
const hataMetni = (h) => (/does not exist|42883|PGRST202|schema cache/i.test(h?.message || h?.code || "") ? "Gerekli migration (0069 ve 0071) henüz çalıştırılmamış görünüyor: dosyaları SQL Editor'de sırayla çalıştır." : h?.message || String(h));
const tamAd = (u) => (u?.full_name || "").trim() || [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "İsimsiz üye";
const bas = (ad) => (ad.trim()[0] || "?").toLocaleUpperCase("tr");

/** Arama kutulu üye seçici: seçilenler çip olarak listelenir. */
function uyeSecici(baslik, tumUyeler, baslangic) {
  const secili = new Map(baslangic.map((id) => [id, tumUyeler.find((u) => u.id === id)]));
  const ara = el("input", { type: "search", placeholder: "Ad ara…", "aria-label": `${baslik}: üye ara` });
  const sec = el("select", { "aria-label": `${baslik}: üye seç` });
  const cipler = el("div", { class: "uya-yp-cipler" });
  const etiket = (u) => `${tamAd(u)} · ${ROL_ETIKETLERI[u?.role] || "?"}`;
  const ciz = () => {
    const q = ara.value.trim().toLocaleLowerCase("tr");
    sec.replaceChildren(el("option", { value: "", text: "Üye seç…" }), ...tumUyeler.filter((u) => !secili.has(u.id) && (!q || tamAd(u).toLocaleLowerCase("tr").includes(q))).slice(0, 80).map((u) => el("option", { value: u.id, text: etiket(u) })));
    cipler.replaceChildren(...[...secili.entries()].map(([id, u]) => el("span", { class: "uya-yp-cip" }, etiket(u), el("button", { type: "button", "aria-label": "Kaldır", text: "×", onclick: () => (secili.delete(id), ciz()) }))));
  };
  ara.addEventListener("input", ciz);
  sec.addEventListener("change", () => {
    const u = tumUyeler.find((x) => x.id === sec.value);
    if (u) secili.set(u.id, u);
    ara.value = "";
    ciz();
  });
  ciz();
  return { kok: el("div", { class: "uya-yp-alan" }, el("span", { class: "uya-yp-etiket", text: baslik }), el("div", { class: "uya-yp-secici" }, ara, sec), cipler), deger: () => [...secili.keys()] };
}

function durumRozeti(y) {
  if (!y.izinli) return el("span", { class: "uya-yp-rozet uya-yp-rozet--yok", text: "Erişim yok" });
  const parca = [];
  if (y.ekstra_uyeler.length) parca.push(`${y.ekstra_uyeler.length} üye eklendi`);
  if (y.haric_uyeler.length) parca.push(`${y.haric_uyeler.length} üye hariç`);
  const ek = parca.length ? ` (${parca.join(", ")})` : "";
  if (y.tum_uyeler) return el("span", { class: "uya-yp-rozet uya-yp-rozet--tum", text: "Tüm üyeler" + ek });
  return el("span", { class: "uya-yp-rozet uya-yp-rozet--rol", text: (y.hedef_roller.length ? y.hedef_roller.map((r) => ROL_ETIKETLERI[r]).join(", ") : "Yalnızca seçili üyeler") + ek });
}

async function kur() {
  const kok = document.getElementById("uye-aktarim-kok");
  const mesaj = document.getElementById("uye-aktarim-mesaj");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";

  const [yon, uye] = await Promise.all([supabase.rpc("owner_uye_aktarim_yoneticileri"), supabase.from("profiles").select("id, full_name, first_name, last_name, role").order("full_name")]);
  if (yon.error || uye.error) {
    kok.replaceChildren(el("p", { class: "muted", text: hataMetni(yon.error || uye.error) }));
    return;
  }
  const yoneticiler = yon.data || [];
  const tumUyeler = (uye.data || []).filter((u) => u.role !== "owner");

  /* ---------------- 1) Yöneticiler ---------------- */
  const liste = el("div", { class: "uya-yp-liste" });
  const listeBaslik = el("div", { class: "uya-yp-liste-baslik" });
  const listeKutu = el("div", { class: "uya-yp-kaydirma" }, listeBaslik, liste);
  const yenile = async () => {
    const { data, error } = await supabase.rpc("owner_uye_aktarim_yoneticileri");
    if (error) return showMessage(mesaj, "Liste yenilenemedi: " + hataMetni(error), "error");
    yoneticiler.length = 0;
    yoneticiler.push(...(data || []));
    listeCiz();
  };

  const duzenleyici = (y, kapat) => {
    const mevcut = !y.izinli ? "yok" : y.tum_uyeler ? "tum" : "rol";
    let mod = mevcut;
    const secenekler = [["yok", "Erişim yok", "Üye verisini indiremez."], ["tum", "Tüm üyeler", "Site Sahibi hariç herkes."], ["rol", "Belirli roller", "Yalnızca seçtiğin rollerdeki üyeler."]];
    const rolKutulari = HEDEF_ROLLER.map((r) => {
      const k = el("input", { type: "checkbox", value: r });
      k.checked = y.hedef_roller.includes(r);
      return el("label", { class: "uya-yp-pil" }, k, el("span", { text: ROL_ETIKETLERI[r] }));
    });
    const rolAlani = el("div", { class: "uya-yp-roller" }, rolKutulari);
    const ekstra = uyeSecici("Ek olarak şu üyeler", tumUyeler, y.ekstra_uyeler);
    const haric = uyeSecici("Şu üyeler hariç", tumUyeler, y.haric_uyeler);
    const gelismis = el("details", { class: "uya-yp-gelismis" }, el("summary", { text: "Gelişmiş: tek tek üye ekle / hariç tut" }), ekstra.kok, haric.kok);
    gelismis.open = y.ekstra_uyeler.length + y.haric_uyeler.length > 0;
    const ciz = () => {
      rolAlani.hidden = mod !== "rol";
      gelismis.hidden = mod === "yok";
      segment.querySelectorAll(".uya-yp-seg").forEach((b) => b.classList.toggle("uya-yp-seg--secili", b.dataset.mod === mod));
    };
    const segment = el("div", { class: "uya-yp-segmentler", role: "radiogroup", "aria-label": "Erişim türü" },
      secenekler.map(([m, ad, ipucu]) => el("button", { type: "button", class: "uya-yp-seg", "data-mod": m, role: "radio", onclick: () => ((mod = m), ciz()) }, el("strong", { text: ad }), el("span", { text: ipucu }))));
    const kaydet = el("button", { type: "button", class: "btn-primary csp-w-auto", text: "Kaydet" });
    kaydet.addEventListener("click", async () => {
      const roller = rolKutulari.map((l) => l.querySelector("input")).filter((k) => k.checked).map((k) => k.value);
      if (mod === "rol" && !roller.length && !ekstra.deger().length) return showMessage(mesaj, "En az bir rol seç ya da Gelişmiş bölümünden üye ekle.", "error");
      kaydet.disabled = true;
      try {
        const { error } = mod === "yok"
          ? await supabase.rpc("owner_uye_aktarim_yetkisi_kaldir", { p_yetkili: y.yetkili_id })
          : await supabase.rpc("owner_uye_aktarim_yetkisi_ver", { p_yetkili: y.yetkili_id, p_tum: mod === "tum", p_roller: mod === "tum" ? [] : roller, p_ekstra: ekstra.deger(), p_haric: haric.deger() });
        if (error) throw error;
        showMessage(mesaj, `${y.yetkili_ad} için izin güncellendi.`, "success");
        await yenile();
      } catch (h) {
        showMessage(mesaj, "Kaydedilemedi: " + hataMetni(h), "error");
        kaydet.disabled = false;
      }
    });
    const kap = el("div", { class: "uya-yp-duzen" }, segment, rolAlani, gelismis, el("div", { class: "uya-yp-eylem" }, el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Vazgeç", onclick: kapat }), kaydet));
    ciz();
    return kap;
  };

  const listeCiz = () => {
    listeBaslik.textContent = yoneticiler.length ? `${yoneticiler.length} yönetici` : "";
    listeBaslik.hidden = !yoneticiler.length;
    liste.replaceChildren(
      ...(yoneticiler.length
        ? yoneticiler.map((y) => {
            const alan = el("div", { class: "uya-yp-duzen-alani", hidden: true });
            const btn = el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Düzenle", "aria-expanded": "false" });
            btn.addEventListener("click", () => {
              const acik = !alan.hidden;
              if (acik) {
                alan.hidden = true;
                alan.replaceChildren();
              } else {
                alan.replaceChildren(duzenleyici(y, () => ((alan.hidden = true), alan.replaceChildren(), btn.setAttribute("aria-expanded", "false"))));
                alan.hidden = false;
              }
              btn.setAttribute("aria-expanded", String(!acik));
            });
            return el("div", { class: "uya-yp-satir" }, el("div", { class: "uya-yp-ust" }, el("span", { class: "uya-yp-avatar", text: bas(y.yetkili_ad) }), el("div", { class: "uya-yp-kimlik" }, el("strong", { text: y.yetkili_ad }), durumRozeti(y)), btn), alan);
          })
        : [el("p", { class: "muted", text: "Henüz yönetici rolünde üye yok. İzin yalnızca Yönetici rolündeki üyelere verilebilir." })])
    );
  };
  listeCiz();

  /* ---------------- 2) İndirme geçmişi ---------------- */
  const gecmisKutu = el("div", { class: "uya-yp-gecmis" });
  let kayitlar = [];
  const secili = new Set();
  let silmeSuruyor = false;
  // Uzun listelerde mesaj sayfanın en altında kalıp görünmüyordu: göster + görünür alana kaydır.
  const mesajGoster = (metin, tur) => {
    showMessage(mesaj, metin, tur);
    mesaj.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const gecmisCiz = () => {
    const secimSayisi = secili.size;
    const hepsi = el("input", { type: "checkbox", "aria-label": "Tümünü seç" });
    hepsi.checked = kayitlar.length > 0 && secimSayisi === kayitlar.length;
    hepsi.addEventListener("change", () => {
      secili.clear();
      if (hepsi.checked) kayitlar.forEach((k) => secili.add(k.id));
      gecmisCiz();
    });
    const sil = async (ids, hepsiMi) => {
      const n = hepsiMi ? kayitlar.length : ids.length;
      if (!n) return;
      if (!window.confirm(hepsiMi ? `Tüm indirme geçmişi (${n} kayıt) kalıcı olarak silinecek. Devam edilsin mi?` : `${n} kayıt kalıcı olarak silinecek. Devam edilsin mi?`)) return;
      if (silmeSuruyor) return;
      silmeSuruyor = true;
      gecmisKutu.classList.add("uya-yp-gecmis--mesgul");
      try {
        const { data, error } = await supabase.rpc("owner_uye_aktarim_kayitlari_sil", { p_ids: hepsiMi ? null : ids, p_hepsi: hepsiMi });
        if (error) return mesajGoster("Silinemedi: " + hataMetni(error), "error");
        const silinen = Number.isFinite(Number(data)) ? Number(data) : n; // sunucunun gerçek sayısı
        mesajGoster(silinen ? `${silinen} kayıt silindi.` : "Silinecek kayıt bulunamadı (zaten silinmiş olabilir).", silinen ? "success" : "warning");
        secili.clear();
        await gecmisYukle();
      } catch (h) {
        mesajGoster("Silinemedi: " + hataMetni(h), "error");
      } finally {
        silmeSuruyor = false;
        gecmisKutu.classList.remove("uya-yp-gecmis--mesgul");
      }
    };
    gecmisKutu.replaceChildren(
      el("div", { class: "uya-yp-gecmis-ust" },
        el("h3", { text: "İndirme geçmişi" }),
        kayitlar.length
          ? el("div", { class: "uya-yp-gecmis-eylem" },
              el("button", { type: "button", class: "btn-secondary csp-w-auto", text: secimSayisi ? `Seçilenleri sil (${secimSayisi})` : "Seçilenleri sil", disabled: !secimSayisi, onclick: () => sil([...secili], false) }),
              el("button", { type: "button", class: "btn-danger csp-w-auto", text: "Tümünü temizle", onclick: () => sil([], true) }))
          : null),
      kayitlar.length
        ? el("div", { class: "uya-yp-tablo", role: "table" },
            el("div", { class: "uya-yp-tr uya-yp-tr--baslik", role: "row" }, el("label", { class: "uya-yp-hucre-kutu" }, hepsi), el("span", { text: "Kim indirdi" }), el("span", { text: "Biçim" }), el("span", { text: "Üye" }), el("span", { text: "Tarih" })),
            kayitlar.map((k) => {
              const kutu = el("input", { type: "checkbox", "aria-label": `${k.yetkili_ad} kaydını seç` });
              kutu.checked = secili.has(k.id);
              kutu.addEventListener("change", () => {
                kutu.checked ? secili.add(k.id) : secili.delete(k.id);
                gecmisCiz();
              });
              return el("div", { class: "uya-yp-tr", role: "row" },
                el("label", { class: "uya-yp-hucre-kutu" }, kutu),
                el("span", { class: "uya-yp-kim" }, el("strong", { text: k.yetkili_ad }), el("small", { class: "muted", text: ROL_ETIKETLERI[k.yetkili_rol] || "" })),
                el("span", { text: (k.bicim || "—").toUpperCase() }),
                el("span", { text: `${k.adet}` }),
                el("span", { class: "muted", text: tarihMetni(k.created_at, true) }));
            }))
        : el("p", { class: "muted", text: "Henüz indirme yapılmadı." })
    );
  };
  const gecmisYukle = async () => {
    const { data, error } = await supabase.rpc("owner_uye_aktarim_kayitlari", { p_limit: 200 });
    if (error) {
      gecmisKutu.replaceChildren(el("h3", { text: "İndirme geçmişi" }), el("p", { class: "muted", text: hataMetni(error) }));
      return;
    }
    kayitlar = data || [];
    gecmisCiz();
  };

  kok.replaceChildren(
    el("section", { class: "uya-yp-kart" }, el("h3", { text: "Yöneticiler" }), el("p", { class: "muted uya-yp-aciklama", text: "Bir yöneticinin üye bilgilerini indirmesine izin ver. Sen her zaman tüm üyeleri indirebilirsin; Site Sahibi'nin verisini kimse indiremez." }), listeKutu),
    el("section", { class: "uya-yp-kart" }, gecmisKutu)
  );
  await gecmisYukle();
}

kur().catch((hata) => {
  console.error("yetki-paneli.js (üye aktarım):", hata);
  const mesaj = document.getElementById("uye-aktarim-mesaj");
  if (mesaj) showMessage(mesaj, `Panel yüklenemedi: ${hata.message || hata}`, "error");
});
