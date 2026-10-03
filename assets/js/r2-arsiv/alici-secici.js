/*
 * assets/js/r2-arsiv/alici-secici.js — yeniden kullanılabilir kullanıcı arama kutusu
 * (combobox): odaklanınca öneri listesi, yazdıkça arama (Türkçe-duyarsız, çok kelimeli),
 * ↑/↓/Enter/Esc klavye desteği, "yükleniyor / sonuç yok / hata" durumları.
 *
 * Sunucu: public.arsiv_kullanici_ara(p_q) -> (kullanici_id, ad, rol, anahtar_var)
 * E-posta ASLA gösterilmez. Şifreli paylaşımda anahtarı olmayan (panele hiç girmemiş)
 * kullanıcı seçilemez ve nedeni yazılır.
 */
import { supabase } from "../core/supabase-client.js";
import { el, basHarfler, avatarSinifi, ROL_ETIKETI } from "./ortak.js";

let sayac = 0;

export function aliciSeciciKur({ kok, yerTutucu = "İsim ara…", anahtarGerekli = true, haric = () => new Set(), sec }) {
  const id = `ra-as-${++sayac}`;
  const sarmal = el("div", "ra-as");
  const girdi = document.createElement("input");
  girdi.type = "search"; girdi.className = "ra-as-girdi"; girdi.placeholder = yerTutucu;
  girdi.autocomplete = "off"; girdi.setAttribute("role", "combobox");
  girdi.setAttribute("aria-expanded", "false"); girdi.setAttribute("aria-controls", `${id}-liste`);
  girdi.setAttribute("aria-label", yerTutucu);
  const liste = el("ul", "ra-as-liste"); liste.id = `${id}-liste`; liste.setAttribute("role", "listbox"); liste.hidden = true;
  sarmal.append(girdi, liste);
  kok.appendChild(sarmal);

  let zamanlayici = null, istek = 0, sonuclar = [], aktif = -1;

  const kapat = () => { liste.hidden = true; girdi.setAttribute("aria-expanded", "false"); aktif = -1; };
  const ac = () => { liste.hidden = false; girdi.setAttribute("aria-expanded", "true"); };

  function durumSatiri(metin, hata = false) {
    liste.replaceChildren(el("li", `ra-as-durum${hata ? " ra-as-hata" : ""}`, metin));
    ac();
  }

  function ciz() {
    const yok = haric();
    const gorunen = sonuclar.filter((u) => !yok.has(u.kullanici_id));
    if (!gorunen.length) { durumSatiri(girdi.value.trim() ? "Eşleşen kullanıcı bulunamadı." : "Gösterilecek kullanıcı yok."); return; }
    liste.replaceChildren();
    gorunen.forEach((u, i) => {
      const secilemez = anahtarGerekli && !u.anahtar_var;
      const li = el("li", `ra-as-oge${secilemez ? " ra-as-pasif" : ""}`);
      li.setAttribute("role", "option"); li.setAttribute("aria-selected", "false");
      if (secilemez) li.setAttribute("aria-disabled", "true");
      li.dataset.sira = String(i);
      li.appendChild(el("span", `ra-avatar ${avatarSinifi(u.ad)}`, basHarfler(u.ad)));
      const metin = el("span", "ra-as-metin");
      metin.append(el("span", "ra-as-ad", u.ad),
        el("span", "ra-meta", secilemez ? "Panele henüz giriş yapmamış — şifreli dosya alamaz" : (ROL_ETIKETI[u.rol] || u.rol)));
      li.appendChild(metin);
      // mousedown: input blur olup liste kapanmadan seçimi yakala
      li.addEventListener("mousedown", (e) => { e.preventDefault(); if (!secilemez) sec_(u); });
      liste.appendChild(li);
    });
    liste._gorunen = gorunen;
    ac();
  }

  function sec_(u) {
    sec({ id: u.kullanici_id, ad: u.ad, rol: u.rol });
    girdi.value = ""; kapat();
    sonuclar = [];
  }

  async function ara() {
    const bu = ++istek;
    durumSatiri("Aranıyor…");
    const { data, error } = await supabase.rpc("arsiv_kullanici_ara", { p_q: girdi.value });
    if (bu !== istek) return;                       // eski yanıtı at (yarış durumu)
    if (error) {
      const yetkisiz = error.code === "42501";
      durumSatiri(yetkisiz ? "Kullanıcı arama yetkin yok." : "Arama başarısız. Veritabanı güncellemesi (0058) yapıldı mı?", true);
      console.warn("arsiv_kullanici_ara:", error.message);
      return;
    }
    sonuclar = data || []; aktif = -1; ciz();
  }

  girdi.addEventListener("input", () => { clearTimeout(zamanlayici); zamanlayici = setTimeout(ara, 220); });
  girdi.addEventListener("focus", () => { ara(); });
  girdi.addEventListener("blur", () => setTimeout(kapat, 120));
  girdi.addEventListener("keydown", (e) => {
    const ogeler = [...liste.querySelectorAll(".ra-as-oge:not(.ra-as-pasif)")];
    if (e.key === "Escape") { kapat(); return; }
    if (!ogeler.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      aktif = (aktif + (e.key === "ArrowDown" ? 1 : -1) + ogeler.length) % ogeler.length;
      ogeler.forEach((o, i) => { o.classList.toggle("ra-as-aktif", i === aktif); o.setAttribute("aria-selected", String(i === aktif)); });
      ogeler[aktif].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && aktif >= 0) {
      e.preventDefault();
      const u = (liste._gorunen || [])[Number(ogeler[aktif].dataset.sira)];
      if (u) sec_(u);
    }
  });

  return { odakla: () => girdi.focus(), temizle: () => { girdi.value = ""; kapat(); } };
}
