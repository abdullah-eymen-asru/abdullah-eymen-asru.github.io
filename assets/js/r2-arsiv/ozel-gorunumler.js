/*
 * assets/js/r2-arsiv/ozel-gorunumler.js — "Benimle paylaşılanlar" ve "Paylaştıklarım" ekranları
 *
 * Bu iki ekran Arşiv'den bilinçli olarak AYRIDIR:
 *   Arşiv           = şifresiz, klasörlü, arşiv erişimi olan herkesin gördüğü ekip arşivi.
 *   Özel gönderim   = şifreli, klasörsüz, yalnızca gönderen + seçilen alıcılar.
 * Her satır "kim — hangi dosya — ne zaman" bilgisini açıkça gösterir; gün bölümlerine
 * (Bugün / Dün / Bu hafta / Ay) ayrılır. Veriler tek RPC ile gelir (DB; R2 işlemi yok):
 *   arsiv_benimle_paylasilanlar()  /  arsiv_paylastiklarim()
 */
import { supabase } from "../core/supabase-client.js";
import { aliciSeciciKur } from "./alici-secici.js";
import {
  el, btn, boyutYaz, zamanYaz, gunGrubu, normalize, aramaKelimeleri, vurgulu,
  basHarfler, avatarSinifi, kategori, KATEGORI_IKON, trSirala,
} from "./ortak.js";

/* ------------------------------- ortak parçalar ------------------------------- */
function avatar(ad, kucuk = false) {
  return el("span", `ra-avatar ${kucuk ? "ra-avatar-k" : ""} ${avatarSinifi(ad)}`.replace(/\s+/g, " ").trim(), basHarfler(ad));
}
function ikonBtn(simge, etiket, tikla, ek = "") {
  return btn(simge, `ra-ikon-btn ${ek}`.trim(), tikla, { "aria-label": etiket, title: etiket });
}
function zamanEtiketi(iso) {
  const z = zamanYaz(iso);
  const t = el("time", "ra-zaman", z.goreli);
  t.dateTime = iso; t.title = z.tam;
  return t;
}
function aramaKutusu(yerTutucu, degisti) {
  const kutu = el("div", "ra-ara-kutu");
  const ikon = el("span", "ra-ara-ikon", "🔍"); ikon.setAttribute("aria-hidden", "true");
  const girdi = document.createElement("input");
  girdi.type = "search"; girdi.placeholder = yerTutucu; girdi.autocomplete = "off"; girdi.setAttribute("aria-label", yerTutucu);
  const temizle = btn("✕", "ra-ikon-btn", () => { girdi.value = ""; temizle.hidden = true; degisti(""); girdi.focus(); }, { "aria-label": "Aramayı temizle" });
  temizle.hidden = true;
  let z = null;
  girdi.addEventListener("input", () => { temizle.hidden = !girdi.value; clearTimeout(z); z = setTimeout(() => degisti(girdi.value), 150); });
  girdi.addEventListener("keydown", (e) => { if (e.key === "Escape" && girdi.value) { e.preventDefault(); temizle.click(); } });
  kutu.append(ikon, girdi, temizle);
  return kutu;
}
function gruplaCiz(hedef, ogeler, tarihAlani, ogeYap) {
  hedef.replaceChildren();
  const gruplar = new Map();
  ogeler.forEach((o) => {
    const g = gunGrubu(o[tarihAlani]);
    if (!gruplar.has(g)) gruplar.set(g, []);
    gruplar.get(g).push(o);
  });
  gruplar.forEach((liste, ad) => {
    const bolum = el("section", "ra-oz-grup");
    bolum.appendChild(el("h3", "ra-oz-grup-baslik", `${ad}  `)).appendChild(el("span", "ra-meta", String(liste.length)));
    const ul = el("ul", "ra-oz-grup-liste");
    liste.forEach((o) => ul.appendChild(ogeYap(o)));
    bolum.appendChild(ul); hedef.appendChild(bolum);
  });
}
function chipBtn(icerik, basili, tikla) {
  const b = el("button", "ra-filtre ra-oz-chip");
  b.type = "button"; b.setAttribute("aria-pressed", String(basili));
  icerik.forEach((n) => b.append(n));
  b.addEventListener("click", tikla);
  return b;
}
const dosyaNesnesi = (s) => ({ id: s.id, ad: s.ad, tur: "dosya", sifreli: true, gercek_mime: s.gercek_mime, mime: "application/octet-stream", boyut: s.boyut });
function tarihOku(a) { try { return localStorage.getItem(a); } catch { return null; } }
function tarihYaz(a, d) { try { localStorage.setItem(a, d); } catch { /* özel pencere vb. */ } }

/* ============================ BENİMLE PAYLAŞILANLAR ============================ */
export function paylasilanGorunumuKur({ kok, uid, eylemler, bildir }) {
  const ANAHTAR = `ra-paylasilan-goruldu:${uid}`;
  const durum = { veri: [], arama: "", gonderen: null, referans: null };

  const ust = el("div", "ra-oz-ust");
  ust.appendChild(aramaKutusu("Dosya ya da gönderen ara…", (m) => { durum.arama = m; ciz(); }));
  const ozet = el("p", "ra-ozet");
  ust.appendChild(ozet);
  const chipler = el("div", "ra-filtreler ra-oz-chipler");
  chipler.setAttribute("role", "group"); chipler.setAttribute("aria-label", "Gönderene göre filtrele");
  const liste = el("div", "ra-oz-liste");
  const bos = el("div", "ra-bos"); bos.hidden = true;
  kok.replaceChildren(ust, chipler, liste, bos);

  const yeniMi = (s) => !durum.referans || new Date(s.paylasildi_at) > new Date(durum.referans);

  function filtrele() {
    const kel = aramaKelimeleri(durum.arama);
    return durum.veri.filter((s) =>
      (!durum.gonderen || s.gonderen_id === durum.gonderen) &&
      kel.every((k) => normalize(s.ad).includes(k) || normalize(s.gonderen_ad).includes(k)));
  }

  function chipCiz() {
    const gonderenler = new Map();
    durum.veri.forEach((s) => {
      const g = gonderenler.get(s.gonderen_id) || { ad: s.gonderen_ad, sayi: 0, yeni: 0 };
      g.sayi++; if (yeniMi(s)) g.yeni++;
      gonderenler.set(s.gonderen_id, g);
    });
    chipler.replaceChildren();
    chipler.hidden = gonderenler.size < 2;           // tek gönderen varsa filtre gereksiz
    chipler.appendChild(chipBtn([document.createTextNode(`Hepsi (${durum.veri.length})`)], !durum.gonderen, () => { durum.gonderen = null; ciz(); }));
    [...gonderenler.entries()].sort((a, b) => trSirala.compare(a[1].ad, b[1].ad)).forEach(([id, g]) => {
      const icerik = [avatar(g.ad, true), el("span", "", `${g.ad} (${g.sayi})`)];
      if (g.yeni) icerik.push(el("span", "ra-nokta", ""));
      chipler.appendChild(chipBtn(icerik, durum.gonderen === id, () => { durum.gonderen = durum.gonderen === id ? null : id; ciz(); }));
    });
  }

  function ogeYap(s, kelimeler) {
    const kat = kategori(dosyaNesnesi(s));
    const li = el("li", `ra-oz-oge ra-k-${kat}`);
    li.dataset.id = s.id;
    li.appendChild(avatar(s.gonderen_ad));
    const govde = el("div", "ra-govde");
    const ad = el("button", "ra-ad ra-tiklanir"); ad.type = "button"; ad.title = s.ad;
    vurgulu(ad, s.ad, kelimeler);
    ad.addEventListener("click", () => (kat === "gorsel" ? eylemler.onizle(dosyaNesnesi(s)) : eylemler.indir(dosyaNesnesi(s))));
    const baslik = el("div", "ra-oz-baslik"); baslik.appendChild(ad);
    if (yeniMi(s)) baslik.appendChild(el("span", "ra-rozet ra-rozet-yeni", "Yeni"));
    govde.appendChild(baslik);

    const kimden = el("div", "ra-oz-kimden");
    kimden.appendChild(btn(s.gonderen_ad, "ra-link", () => { durum.gonderen = s.gonderen_id; ciz(); }, { title: "Bu kişinin gönderdiklerini göster" }));
    kimden.append(document.createTextNode(" gönderdi · "), zamanEtiketi(s.paylasildi_at));
    govde.appendChild(kimden);

    const meta = el("div", "ra-meta-satir");
    meta.append(el("span", "ra-meta", boyutYaz(s.boyut)), el("span", "ra-rozet", "🔒 Şifreli"));
    govde.appendChild(meta);
    li.appendChild(govde);

    const islem = el("div", "ra-islemler");
    if (kat === "gorsel") islem.appendChild(ikonBtn("👁", "Önizle", () => eylemler.onizle(dosyaNesnesi(s))));
    islem.appendChild(ikonBtn("⬇", "İndir", (e) => eylemler.indir(dosyaNesnesi(s), e.currentTarget)));
    li.appendChild(islem);
    return li;
  }

  function ciz() {
    const sonuc = filtrele();
    const kel = aramaKelimeleri(durum.arama);
    chipCiz();
    const yeniSayi = durum.veri.filter(yeniMi).length;
    const gonderenSayi = new Set(durum.veri.map((s) => s.gonderen_id)).size;
    ozet.textContent = durum.veri.length
      ? `${durum.veri.length} dosya · ${gonderenSayi} gönderen${yeniSayi ? ` · ${yeniSayi} yeni` : ""}`
      : "";
    gruplaCiz(liste, sonuc, "paylasildi_at", (s) => ogeYap(s, kel));
    bos.hidden = sonuc.length > 0;
    if (!sonuc.length) {
      bos.textContent = durum.veri.length
        ? "Aramayla ya da seçtiğin gönderenle eşleşen dosya yok."
        : "Henüz sana şifreli dosya gönderilmedi. Biri sana dosya gönderdiğinde burada kimin, ne zaman gönderdiğiyle birlikte görünür.";
    }
  }

  async function yukle() {
    durum.referans = tarihOku(ANAHTAR);                // "Yeni" rozetleri bir önceki ziyarete göre
    const { data, error } = await supabase.rpc("arsiv_benimle_paylasilanlar");
    if (error) {
      console.warn("arsiv_benimle_paylasilanlar:", error.message);
      bildir("Paylaşılanlar alınamadı. 0062 SQL dosyasının Supabase'te çalıştığından emin ol.");
      durum.veri = [];
    } else durum.veri = data || [];
    ciz();
    tarihYaz(ANAHTAR, new Date().toISOString());       // bu ziyaret "görüldü" sayılır
  }

  /** Sekme rozeti için: görülmemiş dosya sayısı (görüldü işaretini DEĞİŞTİRMEZ). */
  async function yeniSayisi() {
    const { data, error } = await supabase.rpc("arsiv_benimle_paylasilanlar");
    if (error) return 0;
    const ref = tarihOku(ANAHTAR);
    return (data || []).filter((s) => !ref || new Date(s.paylasildi_at) > new Date(ref)).length;
  }

  return { yukle, yeniSayisi };
}

/* ================================ PAYLAŞTIKLARIM ================================ */
export function paylastiklarimGorunumuKur({ kok, eylemler, bildir, gonder, yetkili }) {
  const durum = { veri: [], arama: "", alici: null, secili: new Map() };   // alici: null | "ben" | uid

  /* --- Yeni özel gönderim kartı --- */
  const kart = el("section", "ra-gonder-kart");
  kart.setAttribute("aria-label", "Yeni özel gönderim");
  const baslik = el("div", "ra-gonder-baslik");
  baslik.append(el("strong", "", "📤 Yeni özel gönderim"), el("span", "ra-meta", "Şifreli · Arşivden bağımsız · Klasörsüz"));
  kart.appendChild(baslik);

  const adim1 = el("div", "ra-adim");
  adim1.appendChild(el("span", "ra-adim-no", "1"));
  const a1 = el("div", "ra-adim-govde");
  a1.appendChild(el("strong", "", "Kime gönderilsin?"));
  const pickerKok = el("div", "ra-gonder-picker");
  const chipListe = el("ul", "ra-chipler"); chipListe.setAttribute("aria-label", "Seçili alıcılar");
  const ozet = el("p", "ra-gonder-ozet");
  a1.append(pickerKok, chipListe, ozet);
  adim1.appendChild(a1);

  const adim2 = el("div", "ra-adim");
  adim2.appendChild(el("span", "ra-adim-no", "2"));
  const a2 = el("div", "ra-adim-govde");
  a2.appendChild(el("strong", "", "Dosyayı seç ya da bu sayfaya sürükle"));
  const girdi = document.createElement("input"); girdi.type = "file"; girdi.multiple = true; girdi.className = "ra-gizli";
  const cta = btn("", "ra-btn ra-btn-birincil ra-gonder-cta", () => girdi.click());
  a2.append(cta, girdi, el("p", "ra-yardim", "Dosya tarayıcında şifrelenir; sunucu içeriği göremez. Şifreli gönderimde en fazla 100 MB."));
  adim2.appendChild(a2);
  kart.append(adim1, adim2);

  girdi.addEventListener("change", () => { gonder(girdi); setTimeout(() => { girdi.value = ""; }, 0); });

  function kartGuncelle() {
    const n = durum.secili.size;
    cta.textContent = n === 0 ? "🔐 Dosya seç — yalnızca bana kaydet" : `📤 Dosya seç — ${n} kişiye gönder`;
    const adlar = [...durum.secili.values()];
    ozet.textContent = n === 0
      ? "Kimseyi seçmezsen dosya yalnızca sana kaydedilir (özel kasan). Sonradan 👥 ile kişi ekleyebilirsin."
      : `Şifreli olarak şu kişilere gönderilecek: ${adlar.length <= 2 ? adlar.join(", ") : `${adlar.slice(0, 2).join(", ")} +${adlar.length - 2} kişi`}. Sen de açabilirsin.`;
    chipListe.replaceChildren();
    durum.secili.forEach((ad, id) => {
      const li = el("li"); const c = el("span", "ra-chip");
      c.append(avatar(ad, true), el("span", "", ad),
        btn("✕", "ra-chip-x", () => { durum.secili.delete(id); kartGuncelle(); }, { "aria-label": `${ad} alıcısını kaldır` }));
      li.appendChild(c); chipListe.appendChild(li);
    });
  }
  aliciSeciciKur({
    kok: pickerKok, yerTutucu: "Alıcı ekle (isim ara)…", anahtarGerekli: true,
    haric: () => new Set(durum.secili.keys()),
    sec: (u) => { durum.secili.set(u.id, u.ad); kartGuncelle(); },
  });

  /* --- Liste --- */
  const ust = el("div", "ra-oz-ust");
  ust.appendChild(aramaKutusu("Dosya ya da alıcı ara…", (m) => { durum.arama = m; ciz(); }));
  const ozetListe = el("p", "ra-ozet"); ust.appendChild(ozetListe);
  const chipler = el("div", "ra-filtreler ra-oz-chipler");
  chipler.setAttribute("role", "group"); chipler.setAttribute("aria-label", "Alıcıya göre filtrele");
  const liste = el("div", "ra-oz-liste");
  const bos = el("div", "ra-bos"); bos.hidden = true;
  kok.replaceChildren(...(yetkili ? [kart] : []), ust, chipler, liste, bos);
  kartGuncelle();

  function filtrele() {
    const kel = aramaKelimeleri(durum.arama);
    return durum.veri.filter((s) => {
      if (durum.alici === "ben" && s.alicilar.length) return false;
      if (durum.alici && durum.alici !== "ben" && !s.alicilar.some((a) => a.id === durum.alici)) return false;
      return kel.every((k) => normalize(s.ad).includes(k) || s.alicilar.some((a) => normalize(a.ad).includes(k)));
    });
  }

  function chipCiz() {
    const alicilar = new Map(); let sadeceBen = 0;
    durum.veri.forEach((s) => {
      if (!s.alicilar.length) sadeceBen++;
      s.alicilar.forEach((a) => { const g = alicilar.get(a.id) || { ad: a.ad, sayi: 0 }; g.sayi++; alicilar.set(a.id, g); });
    });
    chipler.replaceChildren();
    chipler.hidden = alicilar.size === 0;
    chipler.appendChild(chipBtn([document.createTextNode(`Hepsi (${durum.veri.length})`)], !durum.alici, () => { durum.alici = null; ciz(); }));
    if (sadeceBen) chipler.appendChild(chipBtn([document.createTextNode(`🔐 Sadece ben (${sadeceBen})`)], durum.alici === "ben", () => { durum.alici = durum.alici === "ben" ? null : "ben"; ciz(); }));
    [...alicilar.entries()].sort((a, b) => trSirala.compare(a[1].ad, b[1].ad)).forEach(([id, g]) => {
      chipler.appendChild(chipBtn([avatar(g.ad, true), el("span", "", `${g.ad} (${g.sayi})`)], durum.alici === id, () => { durum.alici = durum.alici === id ? null : id; ciz(); }));
    });
  }

  function aliciSatiri(s) {
    const satir = el("div", "ra-oz-alicilar");
    if (!s.alicilar.length) { satir.appendChild(el("span", "ra-rozet", "🔐 Sadece sen")); return satir; }
    const yigin = el("span", "ra-avatar-yigin");
    s.alicilar.slice(0, 4).forEach((a) => {
      const av = avatar(a.ad, true); av.title = `${a.ad} · ${zamanYaz(a.paylasildi_at).tam}`; yigin.appendChild(av);
    });
    if (s.alicilar.length > 4) yigin.appendChild(el("span", "ra-avatar ra-avatar-k ra-av-7", `+${s.alicilar.length - 4}`));
    const adlar = s.alicilar.map((a) => a.ad);
    const metin = adlar.length <= 2 ? adlar.join(", ") : `${adlar.slice(0, 2).join(", ")} +${adlar.length - 2} kişi`;
    satir.append(yigin, el("span", "ra-oz-alici-metin", metin));
    return satir;
  }

  function ogeYap(s, kelimeler) {
    const kat = kategori(dosyaNesnesi(s));
    const li = el("li", `ra-oz-oge ra-k-${kat}`);
    li.dataset.id = s.id;
    li.appendChild(el("span", "ra-ikon", KATEGORI_IKON[kat] === "📁" ? "📄" : "🔒"));
    const govde = el("div", "ra-govde");
    const ad = el("button", "ra-ad ra-tiklanir"); ad.type = "button"; ad.title = s.ad;
    vurgulu(ad, s.ad, kelimeler);
    ad.addEventListener("click", () => (kat === "gorsel" ? eylemler.onizle(dosyaNesnesi(s)) : eylemler.indir(dosyaNesnesi(s))));
    govde.appendChild(ad);
    const gonderildi = el("div", "ra-oz-kimden");
    gonderildi.append(document.createTextNode("Gönderildi · "), zamanEtiketi(s.dosya_tarihi), document.createTextNode(` · ${boyutYaz(s.boyut)}`));
    govde.append(gonderildi, aliciSatiri(s));
    li.appendChild(govde);

    const islem = el("div", "ra-islemler");
    if (kat === "gorsel") islem.appendChild(ikonBtn("👁", "Önizle", () => eylemler.onizle(dosyaNesnesi(s))));
    islem.appendChild(ikonBtn("👥", "Paylaşımı yönet", () => eylemler.paylasAc(dosyaNesnesi(s))));
    islem.appendChild(ikonBtn("⬇", "İndir", (e) => eylemler.indir(dosyaNesnesi(s), e.currentTarget)));
    if (eylemler.silebilir()) islem.appendChild(ikonBtn("🗑", "Sil", () => eylemler.sil(dosyaNesnesi(s)), "ra-btn-tehlike"));
    li.appendChild(islem);
    return li;
  }

  function ciz() {
    const sonuc = filtrele();
    const kel = aramaKelimeleri(durum.arama);
    chipCiz();
    ozetListe.textContent = durum.veri.length ? `${durum.veri.length} gönderim` : "";
    gruplaCiz(liste, sonuc, "dosya_tarihi", (s) => ogeYap(s, kel));
    bos.hidden = sonuc.length > 0;
    if (!sonuc.length) {
      bos.textContent = durum.veri.length
        ? "Aramayla ya da seçtiğin alıcıyla eşleşen gönderim yok."
        : "Henüz özel gönderim yapmadın. Yukarıdan bir alıcı seçip (ya da kimseyi seçmeden) bir dosya gönderebilirsin.";
    }
  }

  async function yukle() {
    const { data, error } = await supabase.rpc("arsiv_paylastiklarim");
    if (error) {
      console.warn("arsiv_paylastiklarim:", error.message);
      bildir("Gönderimler alınamadı. 0062 SQL dosyasının Supabase'te çalıştığından emin ol.");
      durum.veri = [];
    } else durum.veri = (data || []).map((s) => ({ ...s, alicilar: s.alicilar || [] }));
    ciz();
  }

  return { yukle, alicilar: () => [...durum.secili.keys()], aliciSayisi: () => durum.secili.size };
}
