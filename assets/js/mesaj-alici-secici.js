/*
 * assets/js/mesaj-alici-secici.js — Site Sahibi / Yönetici için "Kime mesaj?" seçici.
 * Gruplu (Site yönetimi · İçerik ekibi · Özel üyeler · Üyeler · Demo) + isimle arama + sayfalı liste ("Daha fazla").
 * Üye sayısı ne olursa olsun liste taşmaz: bir grup açılana dek kişi gösterilmez; sayfa 20'şer yüklenir.
 * GİZLİLİK: e-posta ne istenir ne gösterilir (RPC'ler: mesaj_alici_ozeti / mesaj_alici_listesi, migration 0092). innerHTML YOK.
 */
import { supabase } from "./core/supabase-client.js";

export const GRUPLAR = [
  { k: "yonetim", ad: "Site yönetimi", ikon: "🛡️", not: "Site sahibi ve yöneticiler" },
  { k: "icerik", ad: "İçerik ekibi", ikon: "✍️", not: "İçerik sorumluları ve editörler" },
  { k: "ozel", ad: "Özel üyeler", ikon: "⭐", not: "Özel içerik erişimi olanlar" },
  { k: "uye", ad: "Üyeler", ikon: "👥", not: "Standart üyeler" },
  { k: "demo", ad: "Demo hesaplar", ikon: "🎭", not: "Vitrin / deneme hesapları" },
];
const ROL_AD = { owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "İçerik Editörü", special_user: "Özel Üye", user: "Üye", demo: "Demo Üye" };
const SAYFA = 20;

const e = (t, o = {}, ...c) => {
  const d = document.createElement(t);
  for (const [k, v] of Object.entries(o)) { if (v == null || v === false) continue; if (k === "class") d.className = v; else if (k === "text") d.textContent = v; else d.setAttribute(k, v === true ? "" : v); }
  for (const x of c.flat()) if (x != null) d.append(x);
  return d;
};

/** @param {{kok:HTMLElement, onSec:(u:{id:string,isim:string,rol:string})=>void, onKapat:()=>void}} p */
export function aliciSeciciKur({ kok, onSec, onKapat }) {
  let grup = null; let q = ""; let ofset = 0; let toplam = 0; let istekNo = 0; let zaman = null; let ozet = null; let satirlar = [];

  const geri = e("button", { type: "button", class: "msg-alici-geri", "aria-label": "Kapat" , text: "←" });
  const baslik = e("span", { class: "msg-alici-baslik", text: "Kime mesaj göndereceksin?" });
  const arama = e("input", { type: "search", class: "msg-uye-arama", placeholder: "İsimle ara…", "aria-label": "Alıcı ara", autocomplete: "off", maxlength: "60" });
  const govde = e("div", { class: "msg-alici-govde" });
  const ust = e("div", { class: "msg-alici-ust" }, geri, baslik);
  kok.replaceChildren(ust, arama, govde);

  const rolRozet = (r) => e("span", { class: "msg-hedef-rozet", text: ROL_AD[r] || "Üye" });

  function gruplariCiz() {
    baslik.textContent = "Kime mesaj göndereceksin?";
    const adet = Object.fromEntries((ozet || []).map((o) => [o.grup, Number(o.adet)]));
    govde.replaceChildren(e("div", { class: "msg-alici-gruplar" }, ...GRUPLAR.map((g) => {
      const n = adet[g.k] || 0;
      const b = e("button", { type: "button", class: "msg-alici-grup", disabled: n === 0 },
        e("span", { class: "msg-alici-ikon", "aria-hidden": "true", text: g.ikon }),
        e("span", { class: "msg-alici-grup-ad" }, e("strong", { text: g.ad }), e("small", { text: g.not })),
        e("span", { class: "msg-alici-adet", text: String(n) }));
      b.addEventListener("click", () => { grup = g.k; ofset = 0; satirlar = []; yukle(); });
      return b;
    })));
  }

  function listeyiCiz(mesgul) {
    const g = GRUPLAR.find((x) => x.k === grup);
    baslik.textContent = g ? `${g.ikon} ${g.ad}` : `Arama sonuçları`;
    const ogeler = satirlar.map((u) => {
      const b = e("button", { type: "button", class: "msg-uye-sonuc-item" }, e("span", { class: "msg-uye-sonuc-isim" }, `${u.ad} `, rolRozet(u.rol)));
      b.addEventListener("click", () => onSec({ id: u.id, isim: u.ad, rol: u.rol }));
      return b;
    });
    const ic = [];
    if (!ogeler.length && !mesgul) ic.push(e("p", { class: "chat-bos chat-bos--arama", text: "Eşleşen kişi yok." }));
    ic.push(e("div", { class: "msg-alici-liste" }, ...ogeler));
    if (satirlar.length < toplam) {
      const d = e("button", { type: "button", class: "msg-filtre-temizle-btn msg-alici-daha", text: mesgul ? "Yükleniyor…" : `Daha fazla göster (${toplam - satirlar.length} kişi daha)`, disabled: mesgul });
      d.addEventListener("click", () => { ofset += SAYFA; yukle(true); });
      ic.push(d);
    }
    govde.replaceChildren(...ic);
  }

  async function yukle(ekle = false) {
    const no = ++istekNo;
    if (!ekle) { satirlar = []; govde.replaceChildren(e("p", { class: "chat-bos", text: "Yükleniyor…" })); }
    else listeyiCiz(true);
    const { data, error } = await supabase.rpc("mesaj_alici_listesi", { p_grup: grup, p_q: q, p_limit: SAYFA, p_ofset: ofset });
    if (no !== istekNo) return;
    if (error) {
      const yok = /does not exist|PGRST202|42883|schema cache/i.test(error.message || "");
      govde.replaceChildren(e("p", { class: "chat-bos", text: yok ? "0092 numaralı migration henüz çalıştırılmamış." : "Liste yüklenemedi." }));
      return;
    }
    toplam = data?.[0] ? Number(data[0].toplam) : 0;
    satirlar = ekle ? satirlar.concat(data || []) : data || [];
    listeyiCiz(false);
  }

  function anaGorunum() { grup = null; q = ""; arama.value = ""; ofset = 0; istekNo += 1; if (ozet) gruplariCiz(); }

  arama.addEventListener("input", () => {
    clearTimeout(zaman);
    zaman = setTimeout(() => {
      const yeni = arama.value.trim();
      if (yeni === q) return;
      q = yeni; ofset = 0;
      if (!q && !grup) { anaGorunum(); return; }
      yukle();
    }, 300);
  });
  geri.addEventListener("click", () => { if (grup || q) anaGorunum(); else onKapat(); });
  arama.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); if (grup || q) anaGorunum(); else onKapat(); } });

  return {
    async ac() {
      kok.hidden = false; anaGorunum();
      govde.replaceChildren(e("p", { class: "chat-bos", text: "Yükleniyor…" }));
      const { data, error } = await supabase.rpc("mesaj_alici_ozeti");
      if (error) { govde.replaceChildren(e("p", { class: "chat-bos", text: /does not exist|PGRST202|42883|schema cache/i.test(error.message || "") ? "0092 numaralı migration henüz çalıştırılmamış." : "Gruplar yüklenemedi." })); return; }
      ozet = data || []; gruplariCiz(); arama.focus();
    },
  };
}
