/*
 * assets/js/r2-arsiv/izin-paneli.js — Yetki Ayarları > "R2 Erişim İzni" (SADECE owner)
 *
 * Gerçek yetki sunucuda: r2_arsiv_izin_ayarla / r2_arsiv_izin_kaldir RPC'leri is_owner() ister;
 * Worker her işlemde r2_arsiv_yetkisi() ile 403 üretir. Bu dosya yalnızca arayüzdür.
 * Kural: kullanıcıya özel kayıt rol kaydının önüne geçer; kayıt yoksa varsayılan:
 * owner tam, admin tam, diğer roller YOK.
 *
 * ARAYÜZ (kalabalığı önlemek için):
 *  - İki sekme: "Roller" (sabit 5 satır) ve "Kişiye özel" (sayı rozetli).
 *  - Üç onay kutusu yerine tek "erişim düzeyi" seçici (Yok / Görüntüle / Görüntüle+Yükle / Tam).
 *    Bu 4 hazır düzeye uymayan kombinasyonlar "Özel" olarak açılıp onay kutularıyla düzenlenir.
 *  - Kişi listesi: arama + sayfalama (8'er kişi); kişi eklenince listede ilgili sayfaya atlanır.
 */
import { supabase } from "../core/supabase-client.js";
import { aliciSeciciKur } from "./alici-secici.js";
import { el, btn, normalize, basHarfler, avatarSinifi, trSirala } from "./ortak.js";

const ROLLER = [
  ["admin", "Yönetici (Admin)"], ["manager", "İçerik Sorumlusu"], ["editor", "İçerik Editörü"],
  ["special_user", "Özel Üye"], ["user", "Üye"],
];
const DUZEYLER = [
  ["yok", "Erişim yok", { oku: false, yukle: false, sil: false }],
  ["oku", "Yalnızca görüntüle / indir", { oku: true, yukle: false, sil: false }],
  ["yaz", "Görüntüle + yükle / klasör", { oku: true, yukle: true, sil: false }],
  ["tam", "Tam yetki (silme dahil)", { oku: true, yukle: true, sil: true }],
];
const ISLEMLER = [["oku", "Görüntüle / indir"], ["yukle", "Yükle / klasör"], ["sil", "Sil"]];
const SAYFA = 8;
const VARSAYILAN = (rol) => (rol === "admin" ? { oku: true, yukle: true, sil: true } : { oku: false, yukle: false, sil: false });

const duzeyBul = (d) =>
  DUZEYLER.find(([, , v]) => v.oku === !!d.oku && v.yukle === !!d.yukle && v.sil === !!d.sil)?.[0] ?? "ozel";

async function basla() {
  const kok = document.getElementById("ra-izin-kok");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";
  const mesaj = document.getElementById("ra-izin-mesaj");

  const durum = { satirlar: [], sekme: "roller", arama: "", sayfa: 0, yeniId: null, acikOzel: new Set() };
  let toastZ = null;
  const goster = (m, hata = true) => {
    clearTimeout(toastZ);
    mesaj.textContent = m || ""; mesaj.hidden = !m;
    mesaj.className = `auth-message ${hata ? "error" : "success"}`;
    if (m) toastZ = setTimeout(() => { mesaj.hidden = true; }, hata ? 10000 : 3500);
  };

  /* ------------------------------ iskelet (bir kez) ------------------------------ */
  const sekmeler = el("div", "ra-sekmeler ra-iz-sekmeler");
  sekmeler.setAttribute("role", "tablist");
  const sekmeRol = btn("Roller", "ra-sekme", () => sekmeSec("roller"), { role: "tab" });
  const sekmeKisi = btn("", "ra-sekme", () => sekmeSec("kisiler"), { role: "tab" });
  const kisiEtiket = el("span", "", "Kişiye özel");
  const sayiRozet = el("span", "ra-sekme-sayi", "0");
  sekmeKisi.append(kisiEtiket, sayiRozet);
  sekmeler.append(sekmeRol, sekmeKisi);

  const panelRol = el("div", "ra-iz-panel");
  panelRol.appendChild(el("p", "ra-yardim", "Bir rolün erişimini buradan belirle. Site Sahibi her zaman tam yetkilidir ve kısıtlanamaz."));
  const rolListe = el("div", "ra-iz-liste");
  panelRol.appendChild(rolListe);

  const panelKisi = el("div", "ra-iz-panel");
  panelKisi.appendChild(el("p", "ra-yardim", "Kişiye özel kayıt, rolün ayarının önüne geçer: bir kişiye rolünden fazlasını verebilir ya da erişimini kapatabilirsin."));
  const kisiArac = el("div", "ra-iz-arac");
  const ekleKok = el("div", "ra-iz-ekle");
  const aramaKutu = el("div", "ra-ara-kutu ra-iz-ara");
  const aramaIkon = el("span", "ra-ara-ikon", "🔍"); aramaIkon.setAttribute("aria-hidden", "true");
  const aramaGirdi = document.createElement("input");
  aramaGirdi.type = "search"; aramaGirdi.placeholder = "Kayıtlı kişilerde ara…"; aramaGirdi.setAttribute("aria-label", "Kayıtlı kişilerde ara");
  aramaGirdi.autocomplete = "off";
  aramaKutu.append(aramaIkon, aramaGirdi);
  kisiArac.append(ekleKok, aramaKutu);
  const kisiListe = el("div", "ra-iz-liste");
  const sayfalama = el("div", "ra-iz-sayfalama");
  panelKisi.append(kisiArac, kisiListe, sayfalama);

  kok.replaceChildren(sekmeler, panelRol, panelKisi);

  /* -------------------------------- satır bileşeni -------------------------------- */
  async function kaydet(tur, hedef, v) {
    const { error } = await supabase.rpc("r2_arsiv_izin_ayarla", { p_tur: tur, p_hedef: hedef, p_oku: v.oku, p_yukle: v.yukle, p_sil: v.sil });
    if (error) { goster(error.message || "Kaydedilemedi."); await yukle(); return false; }
    goster("Kaydedildi.", false);
    await yukle();
    return true;
  }
  async function kaldir(tur, hedef, mesajMetni) {
    const { error } = await supabase.rpc("r2_arsiv_izin_kaldir", { p_tur: tur, p_hedef: hedef });
    if (error) return goster(error.message || "Kaldırılamadı.");
    goster(mesajMetni, false);
    await yukle();
  }

  function satirYap({ tur, hedef, etiket, deger, kayitVar }) {
    const anahtar = `${tur}:${hedef}`;
    const duzey = duzeyBul(deger);
    const ozelAcik = duzey === "ozel" || durum.acikOzel.has(anahtar);

    const satir = el("div", "ra-iz-satir");
    if (durum.yeniId === anahtar) satir.classList.add("ra-iz-yeni");
    const sol = el("div", "ra-iz-sol");
    if (tur === "kullanici") sol.appendChild(el("span", `ra-avatar ${avatarSinifi(etiket)}`, basHarfler(etiket)));
    const ad = el("span", "ra-iz-ad");
    ad.appendChild(el("span", "ra-as-ad", etiket));
    if (!kayitVar) ad.appendChild(el("span", "ra-etiket-varsayilan", "varsayılan"));
    sol.appendChild(ad);

    const sec = document.createElement("select");
    sec.className = "ra-secim ra-iz-duzey"; sec.setAttribute("aria-label", `${etiket}: erişim düzeyi`);
    DUZEYLER.forEach(([id, ad2]) => sec.add(new Option(ad2, id)));
    sec.add(new Option("Özel (ayrıntılı)…", "ozel"));
    sec.value = ozelAcik ? "ozel" : duzey;
    sec.addEventListener("change", async () => {
      if (sec.value === "ozel") { durum.acikOzel.add(anahtar); ciz(); return; }
      durum.acikOzel.delete(anahtar);
      sec.disabled = true;
      await kaydet(tur, hedef, DUZEYLER.find(([id]) => id === sec.value)[2]);
    });

    const sag = el("div", "ra-iz-sag");
    sag.appendChild(sec);
    if (kayitVar) {
      sag.appendChild(btn(tur === "rol" ? "↺" : "✕", "ra-ikon-btn", () => kaldir(tur, hedef, tur === "rol" ? "Varsayılana dönüldü." : "Kişiye özel kayıt kaldırıldı."),
        { "aria-label": tur === "rol" ? `${etiket}: varsayılana dön` : `${etiket}: kaydı kaldır`, title: tur === "rol" ? "Varsayılana dön" : "Kaydı kaldır" }));
    }
    satir.append(sol, sag);

    if (ozelAcik) {
      const ayrinti = el("div", "ra-iz-ayrinti");
      const kutular = {};
      ISLEMLER.forEach(([k, e]) => {
        const lbl = el("label", "ra-iz-kutu");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!deger[k]; kutular[k] = cb;
        cb.addEventListener("change", async () => {
          cb.disabled = true;
          await kaydet(tur, hedef, { oku: kutular.oku.checked, yukle: kutular.yukle.checked, sil: kutular.sil.checked });
        });
        lbl.append(cb, document.createTextNode(` ${e}`)); ayrinti.appendChild(lbl);
      });
      satir.appendChild(ayrinti);
    }
    return satir;
  }

  /* ---------------------------------- çizim ---------------------------------- */
  function kisileriSiralaFiltrele() {
    const kel = normalize(durum.arama.trim()).split(/\s+/).filter(Boolean);
    return durum.satirlar
      .filter((s) => s.hedef_tur === "kullanici")
      .filter((s) => { const n = normalize(s.ad); return kel.every((x) => n.includes(x)); })
      .sort((a, b) => trSirala.compare(a.ad, b.ad));
  }

  function ciz() {
    const roller = new Map(durum.satirlar.filter((s) => s.hedef_tur === "rol").map((s) => [s.hedef, s]));
    const tumKisiler = durum.satirlar.filter((s) => s.hedef_tur === "kullanici");
    sayiRozet.textContent = String(tumKisiler.length);

    sekmeRol.setAttribute("aria-selected", String(durum.sekme === "roller"));
    sekmeKisi.setAttribute("aria-selected", String(durum.sekme === "kisiler"));
    panelRol.hidden = durum.sekme !== "roller"; panelKisi.hidden = durum.sekme !== "kisiler";

    rolListe.replaceChildren(...ROLLER.map(([rol, etiket]) => {
      const kayit = roller.get(rol);
      return satirYap({ tur: "rol", hedef: rol, etiket, deger: kayit || VARSAYILAN(rol), kayitVar: !!kayit });
    }));

    const liste = kisileriSiralaFiltrele();
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA));
    durum.sayfa = Math.min(Math.max(0, durum.sayfa), sayfaSayisi - 1);
    const dilim = liste.slice(durum.sayfa * SAYFA, durum.sayfa * SAYFA + SAYFA);

    if (!dilim.length) {
      kisiListe.replaceChildren(el("div", "ra-bos", tumKisiler.length
        ? "Aramayla eşleşen kayıt yok."
        : "Henüz kişiye özel izin yok. Yukarıdan bir kişi arayıp ekleyebilirsin."));
    } else {
      kisiListe.replaceChildren(...dilim.map((s) => satirYap({ tur: "kullanici", hedef: s.hedef, etiket: s.ad, deger: s, kayitVar: true })));
    }

    sayfalama.replaceChildren();
    sayfalama.hidden = liste.length <= SAYFA;
    if (liste.length > SAYFA) {
      const bas = durum.sayfa * SAYFA + 1, son = Math.min(liste.length, (durum.sayfa + 1) * SAYFA);
      sayfalama.append(
        btn("‹ Önceki", "ra-btn ra-btn-kucuk", () => { durum.sayfa--; ciz(); }, durum.sayfa === 0 ? { disabled: "" } : {}),
        el("span", "ra-meta", `${bas}–${son} / ${liste.length}`),
        btn("Sonraki ›", "ra-btn ra-btn-kucuk", () => { durum.sayfa++; ciz(); }, durum.sayfa >= sayfaSayisi - 1 ? { disabled: "" } : {}),
      );
    }
  }

  function sekmeSec(s) { durum.sekme = s; ciz(); }

  async function yukle() {
    const { data, error } = await supabase.rpc("r2_arsiv_izinlerini_getir");
    if (error) { kok.replaceChildren(el("p", "muted", "İzinler alınamadı (yalnızca Site Sahibi görebilir).")); return; }
    durum.satirlar = data || [];
    ciz();
  }

  /* ------------------------------ kişi ekleme / arama ------------------------------ */
  aliciSeciciKur({
    kok: ekleKok, yerTutucu: "➕ Kişi ekle (isim ara)…", anahtarGerekli: false,
    haric: () => new Set(durum.satirlar.filter((s) => s.hedef_tur === "kullanici").map((s) => s.hedef)),
    sec: async (u) => {
      if (u.rol === "owner") return goster("Site Sahibi zaten tam yetkilidir; kısıtlanamaz.");
      const { error } = await supabase.rpc("r2_arsiv_izin_ayarla", { p_tur: "kullanici", p_hedef: u.id, p_oku: true, p_yukle: false, p_sil: false });
      if (error) return goster(error.message || "Eklenemedi.");
      await yukle();
      // Eklenen kişinin bulunduğu sayfaya atla ve kısa süre vurgula
      durum.arama = ""; aramaGirdi.value = "";
      const sirali = kisileriSiralaFiltrele();
      durum.sayfa = Math.max(0, Math.floor(sirali.findIndex((s) => s.hedef === u.id) / SAYFA));
      durum.yeniId = `kullanici:${u.id}`; durum.sekme = "kisiler"; ciz();
      goster(`${u.ad} eklendi — varsayılan: yalnızca görüntüle. Düzeyi satırdan değiştirebilirsin.`, false);
      setTimeout(() => { durum.yeniId = null; document.querySelectorAll(".ra-iz-yeni").forEach((n) => n.classList.remove("ra-iz-yeni")); }, 2500);
    },
  });
  let aramaZ = null;
  aramaGirdi.addEventListener("input", () => {
    clearTimeout(aramaZ);
    aramaZ = setTimeout(() => { durum.arama = aramaGirdi.value; durum.sayfa = 0; ciz(); }, 150);
  });

  await yukle();
}

basla().catch((e) => console.error("izin-paneli.js:", e));
