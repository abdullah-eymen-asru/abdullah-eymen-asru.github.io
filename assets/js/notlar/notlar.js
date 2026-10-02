/*
 * assets/js/notlar/notlar.js
 * -----------------------------------------------------------------------
 * "Fikir & Araştırma Tezgâhı" — arayüz ve veri katmanı.
 * dashboard.js bu dosyayı SADECE kullanıcı "Fikir & Araştırma Tezgâhı"
 * sekmesine ilk kez tıkladığında dynamic import() ile yükler (diğer modüllerle
 * aynı desen); import edilince init() kendiliğinden çalışır.
 *
 * KURALLAR
 *  - Sunucuya giden TEK içerik: Kasa.notuSifrele() çıktısı (ciphertext + iv).
 *  - Arama, filtre, sıralama TAMAMEN tarayıcıda, bellekte çözülmüş nesneler üzerinde.
 *  - HİÇ innerHTML yok: tüm metinler textContent / DOM düğümü ile basılır
 *    (not içeriği = güvenilmeyen girdi; ayrıca XSS, şifre çözme anahtarını
 *    "kullanabilir" — bkz. kasa.js başındaki tehdit modeli notu).
 *  - Ekler (görsel/PDF) R2'ye ŞİFRELİ bayt olarak gider (bkz. r2_not_ek_worker).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage, kucukHarfeCevirTr, guvenliDisUrlMi } from "../core/supabase-client.js";
import { requireAuthOrShowError } from "../auth/auth-guard.js";
import * as Kasa from "./kasa.js";

/* ------------------------------------------------------------------ */
/* 0) Ayarlar                                                          */
/* ------------------------------------------------------------------ */

// ---- BURAYI DOLDUR: r2_not_ek_worker deploy edildikten sonra aldığın adres ----
const EK_WORKER_URL = "https://r2-not-ek-worker.aeymena.workers.dev";
// -------------------------------------------------------------------------------

const DURUMLAR = {
  tohum: { simge: "🌱", ad: "Tohum", sonraki: "filiz", ipucu: "Hızlı fikir" },
  filiz: { simge: "🌿", ad: "Filiz", sonraki: "agac", ipucu: "Geliştirilen argüman" },
  agac: { simge: "🌳", ad: "Ağaç", sonraki: null, ipucu: "Yayına hazır taslak" },
};

const IZINLI_EK_TIPLERI = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const EK_UST_SINIR = 15 * 1024 * 1024; // tek dosya 15 MB (Worker'da 25 MB tavan var)
const NOT_BASINA_EK = 20;
const COP_GUN = 30;
const SAYFA_BOYUTU = 60;
const OTOKAYIT_MS = 2500;

/* ------------------------------------------------------------------ */
/* 1) Durum                                                            */
/* ------------------------------------------------------------------ */

const S = {
  session: null,
  notlar: new Map(), // id -> model
  filtre: { durum: "tum", etiket: "", arama: "" },
  gorunenSayi: SAYFA_BOYUTU,
  duz: null, // düzenlenen nokta (çalışma kopyası)
  duzYeni: false,
  kirli: false,
  kaydediliyor: false,
  tekrarKaydet: false,
  silinecekEkler: [],
  sonSenkron: 0,
  bozukSayisi: 0,
  otoKayitZamanlayici: null,
  otoKilitZamanlayici: null,
  blobOnbellek: new Map(), // r2 anahtarı -> blob URL
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 2) DOM yardımcıları (innerHTML'siz)                                 */
/* ------------------------------------------------------------------ */

function el(etiket, ozellikler = {}, ...cocuklar) {
  const d = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellikler)) {
    if (v == null || v === false) continue;
    if (k === "class") d.className = v;
    else if (k === "text") d.textContent = v;
    else if (k.startsWith("on")) d.addEventListener(k.slice(2), v);
    else if (k === "data") Object.assign(d.dataset, v);
    else d.setAttribute(k, v === true ? "" : v);
  }
  for (const c of cocuklar.flat()) if (c != null) d.append(c);
  return d;
}

function bildir(metin, tur = "success", sure = 6000) {
  const kutu = $("nt-mesaj");
  if (!kutu) return;
  showMessage(kutu, metin, tur);
  clearTimeout(bildir.t);
  if (sure) bildir.t = setTimeout(() => (kutu.hidden = true), sure);
}

const tarihYaz = (iso) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "";
const saatYaz = (d = new Date()) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

/* ------------------------------------------------------------------ */
/* 3) Arama: Türkçe duyarlı, aksan duyarsız, vurgulu                   */
/* ------------------------------------------------------------------ */

const KATLA = { ı: "i", ğ: "g", ü: "u", ş: "s", ö: "o", ç: "c" };

/** Karakter sayısını KORUYARAK katlar (vurgulama indeksleri bozulmasın): "Şişman" → "sisman". */
function katla(metin) {
  const kucuk = kucukHarfeCevirTr(metin || "");
  let cikti = "";
  for (let i = 0; i < kucuk.length; i++) {
    const c = kucuk[i];
    cikti += KATLA[c] || c.normalize("NFD")[0] || c;
  }
  return cikti;
}

const aramaTokenleri = (q) => katla(q).split(/\s+/).filter(Boolean);

function aramaIndeksiKur(m) {
  const parcalar = [
    m.baslik,
    m.etiketler.join(" "),
    m.govde,
    ...m.alintilar.flatMap((a) => [a.alinti, a.kaynak, a.yorum]),
    ...m.ekler.map((e) => e.ad),
  ];
  m.ara = katla(parcalar.join("\n"));
  m.araBaslik = katla(m.baslik);
  m.araEtiket = katla(m.etiketler.join(" "));
}

/** Düz metne vurgu (<mark>) ekler; DOM düğümleri ile, innerHTML'siz. */
function vurguluMetin(kap, metin, tokenler) {
  kap.textContent = "";
  if (!tokenler.length || !metin) return void kap.append(metin || "");
  const katlanmis = katla(metin);
  if (katlanmis.length !== metin.length) return void kap.append(metin); // nadir: uzunluk değişirse vurgusuz
  const aralik = [];
  for (const t of tokenler) {
    let i = katlanmis.indexOf(t);
    while (i !== -1) {
      aralik.push([i, i + t.length]);
      i = katlanmis.indexOf(t, i + t.length);
    }
  }
  aralik.sort((a, b) => a[0] - b[0]);
  const birlesik = [];
  for (const r of aralik) {
    const son = birlesik[birlesik.length - 1];
    if (son && r[0] <= son[1]) son[1] = Math.max(son[1], r[1]);
    else birlesik.push([...r]);
  }
  let konum = 0;
  for (const [b, s] of birlesik) {
    if (b > konum) kap.append(metin.slice(konum, b));
    kap.append(el("mark", { text: metin.slice(b, s) }));
    konum = s;
  }
  if (konum < metin.length) kap.append(metin.slice(konum));
}

function duzMetin(md) {
  return (md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*\s]+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ozetUret(m, tokenler) {
  const tum = duzMetin([m.govde, ...m.alintilar.map((a) => `${a.alinti} ${a.yorum}`)].join(" "));
  if (!tum) return "";
  if (tokenler.length) {
    const k = katla(tum);
    const yer = tokenler.map((t) => k.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (yer !== undefined && yer > 60) {
      return "… " + tum.slice(Math.max(0, yer - 50), yer + 150) + (tum.length > yer + 150 ? " …" : "");
    }
  }
  return tum.length > 200 ? tum.slice(0, 200) + " …" : tum;
}

/* ------------------------------------------------------------------ */
/* 4) Model ⇄ şifreli zarf                                             */
/* ------------------------------------------------------------------ */

function modelOlustur(id, satir, yuk) {
  const m = {
    id,
    rev: satir?.rev ?? 0,
    olusturma: satir?.created_at || new Date().toISOString(),
    guncelleme: satir?.updated_at || new Date().toISOString(),
    silindiAt: satir?.silindi_at || null,
    baslik: String(yuk?.baslik || ""),
    etiketler: Array.isArray(yuk?.etiketler) ? yuk.etiketler.map(String) : [],
    durum: DURUMLAR[yuk?.durum] ? yuk.durum : "tohum",
    govde: String(yuk?.govde || ""),
    alintilar: Array.isArray(yuk?.alintilar)
      ? yuk.alintilar.map((a) => ({
          id: String(a.id || crypto.randomUUID()),
          alinti: String(a.alinti || ""),
          kaynak: String(a.kaynak || ""),
          sayfa: String(a.sayfa || ""),
          yorum: String(a.yorum || ""),
        }))
      : [],
    ekler: Array.isArray(yuk?.ekler)
      ? yuk.ekler.map((e) => ({
          id: String(e.id),
          ad: String(e.ad || "dosya"),
          tip: String(e.tip || ""),
          boyut: Number(e.boyut || 0),
          anahtar: String(e.anahtar || ""),
        }))
      : [],
    aktarildi: yuk?.aktarildi || null,
  };
  aramaIndeksiKur(m);
  return m;
}

const yukuHazirla = (m) => ({
  v: 1,
  baslik: m.baslik,
  etiketler: m.etiketler,
  durum: m.durum,
  govde: m.govde,
  alintilar: m.alintilar,
  ekler: m.ekler,
  aktarildi: m.aktarildi,
});

class CakismaHatasi extends Error {}

/** Şifreler ve yazar. Yeni ise INSERT, değilse rev ile iyimser kilitli UPDATE. */
async function modeliKaydet(m, yeni) {
  const { ciphertext, iv } = await Kasa.notuSifrele(yukuHazirla(m), m.id);
  if (yeni) {
    const { data, error } = await supabase
      .from("notlar")
      .insert({ id: m.id, ciphertext, iv })
      .select("rev, created_at, updated_at")
      .single();
    if (error) throw error;
    return { ...m, rev: data.rev, olusturma: data.created_at, guncelleme: data.updated_at };
  }
  const { data, error } = await supabase
    .from("notlar")
    .update({ ciphertext, iv })
    .eq("id", m.id)
    .eq("rev", m.rev)
    .select("rev, updated_at");
  if (error) throw error;
  if (!data?.length) throw new CakismaHatasi();
  return { ...m, rev: data[0].rev, guncelleme: data[0].updated_at };
}

async function cakismadaOnayVeYenidenDene(m) {
  const { data } = await supabase.from("notlar").select("rev").eq("id", m.id).maybeSingle();
  if (!data) throw new Error("Bu not başka bir cihazda silinmiş.");
  const tamam = window.confirm(
    "Bu not başka bir cihazda ya da sekmede değişmiş.\n\nTamam: benim sürümümle üzerine yaz\nİptal: kaydetme (listeyi yenileyip sunucudaki sürümü gör)"
  );
  if (!tamam) throw new Error("Kayıt iptal edildi; sunucudaki sürümü görmek için listeyi yenile.");
  return modeliKaydet({ ...m, rev: data.rev }, false);
}

function haritayaIsle(m) {
  aramaIndeksiKur(m);
  S.notlar.set(m.id, m);

  // Aynı not editörde açıkken kart üzerinden bir işlem (aşama değiştirme, "yazıya aktarıldı" izi vb.)
  // rev'i ilerletir; editör eski rev'le kaydetmeye kalkarsa gereksiz "çakışma" sorusu çıkmasın.
  if (S.duz && S.duz.id === m.id) {
    S.duz.rev = m.rev;
    S.duz.guncelleme = m.guncelleme;
    S.duz.aktarildi = m.aktarildi;
    if (!S.kirli && S.duz.durum !== m.durum) {
      S.duz.durum = m.durum;
      const radyo = document.querySelector(`input[name="nt-durum"][value="${m.durum}"]`);
      if (radyo) radyo.checked = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5) Yükleme / senkron                                                */
/* ------------------------------------------------------------------ */

async function notlariYukle({ sessiz = false } = {}) {
  if (!sessiz) $("nt-liste").replaceChildren(el("p", { class: "muted", text: "Notlar yükleniyor ve çözülüyor…" }));
  const tum = [];
  for (let bas = 0; ; bas += 500) {
    const { data, error } = await supabase
      .from("notlar")
      .select("id, ciphertext, iv, rev, silindi_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .range(bas, bas + 499);
    if (error) throw error;
    tum.push(...data);
    if (data.length < 500) break;
  }

  S.notlar.clear();
  S.bozukSayisi = 0;
  for (const satir of tum) {
    try {
      const yuk = await Kasa.notuCoz(satir.ciphertext, satir.iv, satir.id);
      haritayaIsle(modelOlustur(satir.id, satir, yuk));
    } catch {
      S.bozukSayisi++;
    }
  }
  S.sonSenkron = Date.now();

  if (S.bozukSayisi) {
    bildir(
      `${S.bozukSayisi} not bu anahtarla çözülemedi (başka bir kasa anahtarıyla şifrelenmiş ya da bozulmuş olabilir). ` +
        "Hiçbiri silinmedi.",
      "warning",
      0
    );
  }

  copuSupur().catch((h) => console.warn("Çöp temizliği:", h));
  yetimEkleriSupur().catch((h) => console.warn("Yetim ek temizliği:", h));
  etiketFiltresiniDoldur();
  listeyiCiz();
}

/** 30 günü geçen çöp notları (eklerini de) kalıcı siler. */
async function copuSupur() {
  const sinir = Date.now() - COP_GUN * 86400000;
  const eski = [...S.notlar.values()].filter((m) => m.silindiAt && new Date(m.silindiAt).getTime() < sinir).slice(0, 20);
  for (const m of eski) await kaliciSil(m, { sessiz: true });
}

/**
 * Kayıtlı olup HİÇBİR notun (çöp dahil) başvurmadığı ekleri siler.
 * GÜVENLİK PAYI: tek bir not bile çözülemediyse (başvurusu bilinmiyor) hiçbir şey silinmez;
 * ve 2 saatten genç kayıtlara dokunulmaz (kullanıcı şu an bir not yazıyor olabilir).
 */
async function yetimEkleriSupur() {
  if (S.bozukSayisi || S.duz) return;
  const kullanilan = new Set([...S.notlar.values()].flatMap((m) => m.ekler.map((e) => e.anahtar)));
  const { data, error } = await supabase.from("not_ek_kayitlari").select("r2_key, created_at");
  if (error || !data) return;
  const sinir = Date.now() - 2 * 3600 * 1000;
  for (const k of data) {
    if (!kullanilan.has(k.r2_key) && new Date(k.created_at).getTime() < sinir) await ekiTamamenSil(k.r2_key);
  }
}

/* ------------------------------------------------------------------ */
/* 6) Liste çizimi                                                     */
/* ------------------------------------------------------------------ */

function filtrelenmisNotlar() {
  const { durum, etiket, arama } = S.filtre;
  const tokenler = aramaTokenleri(arama);
  const etiketK = katla(etiket);

  let liste = [...S.notlar.values()].filter((m) => (durum === "cop" ? !!m.silindiAt : !m.silindiAt));
  if (durum !== "tum" && durum !== "cop") liste = liste.filter((m) => m.durum === durum);
  if (etiketK) liste = liste.filter((m) => m.etiketler.some((e) => katla(e) === etiketK));
  if (tokenler.length) liste = liste.filter((m) => tokenler.every((t) => m.ara.includes(t)));

  const puan = (m) =>
    tokenler.reduce((p, t) => p + (m.araBaslik.includes(t) ? 3 : 0) + (m.araEtiket.includes(t) ? 2 : 0), 0);
  liste.sort((a, b) => (tokenler.length ? puan(b) - puan(a) : 0) || b.guncelleme.localeCompare(a.guncelleme));
  return { liste, tokenler };
}

function sayilariGuncelle() {
  const canli = [...S.notlar.values()].filter((m) => !m.silindiAt);
  const sayi = { tum: canli.length, tohum: 0, filiz: 0, agac: 0, cop: S.notlar.size - canli.length };
  for (const m of canli) sayi[m.durum]++;
  document.querySelectorAll("#nt-durum-chips [data-durum]").forEach((b) => {
    const d = b.dataset.durum;
    const etiket = b.dataset.etiket;
    b.textContent = `${etiket} (${sayi[d] ?? 0})`;
  });
}

function etiketFiltresiniDoldur() {
  const sec = $("nt-etiket-filtre");
  const onceki = S.filtre.etiket;
  const tum = new Map();
  for (const m of S.notlar.values()) {
    if (m.silindiAt) continue;
    for (const e of m.etiketler) tum.set(katla(e), e);
  }
  sec.replaceChildren(el("option", { value: "", text: "Tüm etiketler" }));
  [...tum.values()]
    .sort((a, b) => a.localeCompare(b, "tr"))
    .forEach((e) => sec.append(el("option", { value: e, text: e })));
  sec.value = tum.has(katla(onceki)) ? onceki : "";
  if (!sec.value) S.filtre.etiket = "";
}

function listeyiCiz() {
  sayilariGuncelle();
  const { liste, tokenler } = filtrelenmisNotlar();
  const kap = $("nt-liste");
  kap.replaceChildren();

  const sayac = $("nt-sayac");
  sayac.textContent = S.filtre.arama
    ? `${liste.length} sonuç`
    : S.filtre.durum === "cop"
      ? `${liste.length} not çöpte`
      : `${liste.length} not`;

  if (!liste.length) {
    const bosMesaj = S.filtre.arama || S.filtre.etiket
      ? "Aramanla eşleşen not yok. Başka bir sözcük dene ya da filtreleri temizle."
      : S.filtre.durum === "cop"
        ? "Çöp kutusu boş."
        : "Henüz notun yok. Aklına gelen ilk fikri bir tohum olarak yaz.";
    kap.append(el("p", { class: "muted nt-bos", text: bosMesaj }));
    return;
  }

  for (const m of liste.slice(0, S.gorunenSayi)) kap.append(kartCiz(m, tokenler));

  if (liste.length > S.gorunenSayi) {
    kap.append(
      el("button", {
        type: "button",
        class: "btn-secondary csp-w-auto nt-daha",
        text: `${liste.length - S.gorunenSayi} not daha göster`,
        onclick: () => {
          S.gorunenSayi += SAYFA_BOYUTU;
          listeyiCiz();
        },
      })
    );
  }
}

function kartCiz(m, tokenler) {
  const d = DURUMLAR[m.durum];
  const baslik = el("h3", { class: "nt-kart-baslik" });
  vurguluMetin(baslik, m.baslik || "Başlıksız not", tokenler);

  const ozet = el("p", { class: "nt-ozet" });
  vurguluMetin(ozet, ozetUret(m, tokenler), tokenler);

  const etiketler = el(
    "div",
    { class: "nt-etiketler" },
    m.etiketler.map((e) => {
      const rozet = el("button", {
        type: "button",
        class: "nt-etiket",
        title: "Bu etikete göre filtrele",
        onclick: (olay) => {
          olay.stopPropagation();
          S.filtre.etiket = e;
          $("nt-etiket-filtre").value = e;
          S.gorunenSayi = SAYFA_BOYUTU;
          listeyiCiz();
        },
      });
      vurguluMetin(rozet, e, tokenler);
      return rozet;
    })
  );

  const meta = [`Güncellendi: ${tarihYaz(m.guncelleme)}`];
  if (m.alintilar.length) meta.push(`❝ ${m.alintilar.length} alıntı`);
  if (m.ekler.length) meta.push(`📎 ${m.ekler.length} ek`);
  if (m.aktarildi) meta.push(`✍️ ${tarihYaz(m.aktarildi)} tarihinde yazıya aktarıldı`);

  const alt = el("div", { class: "nt-kart-alt" });
  if (m.silindiAt) {
    alt.append(
      el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Geri al", onclick: () => copTenGeriAl(m) }),
      el("button", { type: "button", class: "btn-danger csp-w-auto", text: "Kalıcı olarak sil", onclick: () => kaliciSilOnayli(m) })
    );
  } else {
    alt.append(
      el("button", { type: "button", class: "btn-primary csp-w-auto nt-donustur", text: "✍️ Yazıya dönüştür", onclick: () => yaziyaDonustur(m) }),
      el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Aç", onclick: () => duzenleyiciAc(m) })
    );
    if (d.sonraki) {
      const s = DURUMLAR[d.sonraki];
      alt.append(
        el("button", {
          type: "button",
          class: "btn-secondary csp-w-auto",
          text: `${s.simge} ${s.ad} aşamasına geçir`,
          onclick: () => durumIlerlet(m),
        })
      );
    }
  }

  return el(
    "article",
    { class: `nt-kart nt-seviye-${m.durum}${S.duz?.id === m.id ? " nt-kart-secili" : ""}`, data: { id: m.id } },
    el("div", { class: "nt-kart-ust" }, baslik, el("span", { class: `nt-rozet nt-rozet-${m.durum}`, text: `${d.simge} ${d.ad}`, title: d.ipucu })),
    ozet,
    etiketler,
    el("p", { class: "nt-meta muted", text: meta.join(" · ") }),
    alt
  );
}

/* ------------------------------------------------------------------ */
/* 7) Hızlı işlemler (kart üzerinden)                                  */
/* ------------------------------------------------------------------ */

async function hizliGuncelle(m, degisiklik) {
  try {
    const yeni = await modeliKaydet({ ...structuredClone(m), ...degisiklik }, false).catch(async (h) => {
      if (h instanceof CakismaHatasi) return cakismadaOnayVeYenidenDene({ ...structuredClone(m), ...degisiklik });
      throw h;
    });
    haritayaIsle(yeni);
    listeyiCiz();
    return yeni;
  } catch (h) {
    console.error(h);
    bildir("İşlem kaydedilemedi: " + (h.message || h), "error");
    return null;
  }
}

async function durumIlerlet(m) {
  const sonraki = DURUMLAR[m.durum].sonraki;
  if (!sonraki) return;
  const yeni = await hizliGuncelle(m, { durum: sonraki });
  if (yeni) bildir(`“${yeni.baslik || "Başlıksız not"}” artık ${DURUMLAR[sonraki].simge} ${DURUMLAR[sonraki].ad}.`);
}

async function copeAt(m) {
  const { data, error } = await supabase
    .from("notlar")
    .update({ silindi_at: new Date().toISOString() })
    .eq("id", m.id)
    .select("rev, updated_at");
  if (error || !data?.length) return bildir("Çöpe atılamadı: " + (error?.message || "not bulunamadı"), "error");
  haritayaIsle({ ...m, rev: data[0].rev, guncelleme: data[0].updated_at, silindiAt: new Date().toISOString() });
  bildir(`“${m.baslik || "Başlıksız not"}” çöpe atıldı. ${COP_GUN} gün içinde geri alabilirsin.`);
  listeyiCiz();
}

async function copTenGeriAl(m) {
  const { data, error } = await supabase.from("notlar").update({ silindi_at: null }).eq("id", m.id).select("rev, updated_at");
  if (error || !data?.length) return bildir("Geri alınamadı: " + (error?.message || "not bulunamadı"), "error");
  haritayaIsle({ ...m, rev: data[0].rev, guncelleme: data[0].updated_at, silindiAt: null });
  bildir("Not geri alındı.");
  listeyiCiz();
}

function kaliciSilOnayli(m) {
  if (!window.confirm(`“${m.baslik || "Başlıksız not"}” ve ${m.ekler.length} eki kalıcı olarak silinecek. Bu geri alınamaz.`)) return;
  kaliciSil(m);
}

async function kaliciSil(m, { sessiz = false } = {}) {
  for (const e of m.ekler) await ekiTamamenSil(e.anahtar);
  const { error } = await supabase.from("notlar").delete().eq("id", m.id);
  if (error) {
    if (!sessiz) bildir("Silinemedi: " + error.message, "error");
    return;
  }
  S.notlar.delete(m.id);
  if (!sessiz) {
    bildir("Not kalıcı olarak silindi.");
    listeyiCiz();
  }
}

/* ------------------------------------------------------------------ */
/* 8) Ekler: şifrele → R2                                              */
/* ------------------------------------------------------------------ */

async function erisimJetonu() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Oturum bulunamadı, yeniden giriş yap.");
  return session.access_token;
}

async function ekIstegi(yontem, anahtar, govde) {
  const yanit = await fetch(`${EK_WORKER_URL}?key=${encodeURIComponent(anahtar)}`, {
    method: yontem,
    headers: { Authorization: `Bearer ${await erisimJetonu()}` },
    body: govde,
  });
  if (!yanit.ok) {
    let mesaj = `Depolama hatası (HTTP ${yanit.status})`;
    try {
      mesaj = (await yanit.json()).error || mesaj;
    } catch {
      /* gövde JSON değil */
    }
    throw new Error(mesaj);
  }
  return yanit;
}

/** Tarayıcının bildirdiği MIME'a güvenme: ilk baytlara bak. */
function tipiDogrula(u8, bildirilen) {
  const eslesir = (...b) => b.every((v, i) => u8[i] === v);
  const dogru = {
    "image/png": () => eslesir(0x89, 0x50, 0x4e, 0x47),
    "image/jpeg": () => eslesir(0xff, 0xd8, 0xff),
    "image/gif": () => eslesir(0x47, 0x49, 0x46, 0x38),
    "image/webp": () => eslesir(0x52, 0x49, 0x46, 0x46) && u8[8] === 0x57 && u8[9] === 0x45,
    "application/pdf": () => eslesir(0x25, 0x50, 0x44, 0x46),
  }[bildirilen];
  return !!dogru && dogru();
}

async function dosyalariEkle(dosyalar) {
  if (!S.duz) return;
  const uid = Kasa.kullaniciKimligi();
  for (const f of dosyalar) {
    if (S.duz.ekler.length >= NOT_BASINA_EK) return bildir(`Bir nota en fazla ${NOT_BASINA_EK} ek eklenebilir.`, "warning");
    if (!IZINLI_EK_TIPLERI.has(f.type)) {
      bildir(`“${f.name}” eklenemedi: yalnızca PNG, JPEG, WebP, GIF ve PDF desteklenir.`, "warning");
      continue;
    }
    if (f.size > EK_UST_SINIR) {
      bildir(`“${f.name}” eklenemedi: ${EK_UST_SINIR / 1048576} MB sınırını aşıyor.`, "warning");
      continue;
    }

    durumYaz(`📎 “${f.name}” şifreleniyor ve yükleniyor…`);
    const anahtar = `notlar/${uid}/${crypto.randomUUID()}`;
    try {
      const ham = await f.arrayBuffer();
      if (!tipiDogrula(new Uint8Array(ham, 0, 16), f.type)) throw new Error("dosya içeriği bildirilen türle uyuşmuyor");
      const sifreli = await Kasa.ekiSifrele(ham, anahtar);
      await ekIstegi("PUT", anahtar, sifreli);
      const { error } = await supabase.from("not_ek_kayitlari").insert({ r2_key: anahtar, boyut_bayt: sifreli.byteLength });
      if (error) {
        await ekIstegi("DELETE", anahtar).catch(() => {});
        throw error;
      }
      const ek = { id: crypto.randomUUID(), ad: f.name.slice(0, 120), tip: f.type, boyut: f.size, anahtar };
      S.duz.ekler.push(ek);
      if (f.type.startsWith("image/")) metneEkReferansiEkle(ek);
      kirlendi();
      eklerCiz();
      durumYaz(`✓ “${f.name}” eklendi (şifreli)`);
    } catch (h) {
      console.error(h);
      bildir(`“${f.name}” yüklenemedi: ${h.message || h}`, "error");
    }
  }
}

function metneEkReferansiEkle(ek) {
  const ta = $("nt-govde");
  const metin = `![${ek.ad}](ek:${ek.id})`;
  const bas = ta.selectionStart ?? ta.value.length;
  const son = ta.selectionEnd ?? bas;
  ta.setRangeText((bas && ta.value[bas - 1] !== "\n" ? "\n" : "") + metin + "\n", bas, son, "end");
  S.duz.govde = ta.value;
}

async function ekBlobAl(ek) {
  if (S.blobOnbellek.has(ek.anahtar)) return S.blobOnbellek.get(ek.anahtar);
  const yanit = await ekIstegi("GET", ek.anahtar);
  const acik = await Kasa.ekiCoz(await yanit.arrayBuffer(), ek.anahtar);
  const url = URL.createObjectURL(new Blob([acik], { type: ek.tip }));
  S.blobOnbellek.set(ek.anahtar, url);
  return url;
}

function blobUrlleriniBirak() {
  for (const u of S.blobOnbellek.values()) URL.revokeObjectURL(u);
  S.blobOnbellek.clear();
}

async function ekiTamamenSil(anahtar) {
  try {
    await ekIstegi("DELETE", anahtar);
  } catch (h) {
    console.warn("R2 silme:", h);
    return; // nesne silinemediyse kaydı tut: bir sonraki süpürmede tekrar denenir
  }
  await supabase.from("not_ek_kayitlari").delete().eq("r2_key", anahtar);
}

function eklerCiz() {
  const kap = $("nt-ekler");
  kap.replaceChildren();
  if (!S.duz.ekler.length) return;

  for (const ek of S.duz.ekler) {
    const resimMi = ek.tip.startsWith("image/");
    const onizleme = el("div", { class: "nt-ek-onizleme" }, resimMi ? "🖼️" : "📄");
    if (resimMi) {
      ekBlobAl(ek)
        .then((url) => onizleme.replaceChildren(el("img", { src: url, alt: ek.ad, loading: "lazy" })))
        .catch(() => (onizleme.textContent = "⚠️"));
    }
    const islemler = el("div", { class: "nt-ek-islemler" });
    if (resimMi) {
      islemler.append(el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Metne ekle", onclick: () => { metneEkReferansiEkle(ek); kirlendi(); } }));
    }
    islemler.append(
      el("button", {
        type: "button",
        class: "btn-secondary csp-w-auto",
        text: resimMi ? "Aç" : "İndir",
        onclick: async () => {
          try {
            const url = await ekBlobAl(ek);
            if (resimMi) return void window.open(url, "_blank", "noopener");
            // PDF: sitenin CSP'si object-src 'none' olduğundan tarayıcı içi PDF görüntüleyici
            // blob: adresinde engellenebilir; güvenilir yol dosyayı indirmek.
            const a = el("a", { href: url, download: ek.ad, hidden: true });
            document.body.append(a);
            a.click();
            a.remove();
          } catch (h) {
            bildir("Ek açılamadı: " + h.message, "error");
          }
        },
      }),
      el("button", {
        type: "button",
        class: "btn-danger csp-w-auto",
        text: "Kaldır",
        onclick: () => {
          S.duz.ekler = S.duz.ekler.filter((x) => x.id !== ek.id);
          S.silinecekEkler.push(ek.anahtar);
          kirlendi();
          eklerCiz();
        },
      })
    );
    kap.append(
      el(
        "div",
        { class: "nt-ek" },
        onizleme,
        el("div", { class: "nt-ek-bilgi" }, el("strong", { text: ek.ad }), el("span", { class: "muted", text: `${(ek.boyut / 1024).toFixed(0)} KB` })),
        islemler
      )
    );
  }
}

/* ------------------------------------------------------------------ */
/* 9) Düzenleyici                                                      */
/* ------------------------------------------------------------------ */

function durumYaz(metin) {
  const k = $("nt-kayit-durumu");
  if (k) k.textContent = metin;
}

function kirlendi() {
  S.kirli = true;
  durumYaz("Kaydedilmemiş değişiklik var…");
  clearTimeout(S.otoKayitZamanlayici);
  S.otoKayitZamanlayici = setTimeout(() => kaydet({ sessiz: true }), OTOKAYIT_MS);
}

function duzenleyiciAc(m) {
  if (S.duz && S.kirli) kaydet({ sessiz: true });
  blobUrlleriniBirak();
  S.silinecekEkler = [];
  S.duzYeni = !m;
  S.duz = m
    ? structuredClone(m)
    : modelOlustur(crypto.randomUUID(), null, { durum: "tohum", etiketler: [] });
  S.kirli = false;

  $("nt-baslik").value = S.duz.baslik;
  $("nt-etiketler").value = S.duz.etiketler.join(", ");
  $("nt-govde").value = S.duz.govde;
  document.querySelector(`input[name="nt-durum"][value="${S.duz.durum}"]`).checked = true;
  $("nt-sil-btn").hidden = S.duzYeni || !!S.duz.silindiAt;
  $("nt-donustur-btn").hidden = S.duzYeni || !!S.duz.silindiAt;
  durumYaz(S.duzYeni ? "Yeni not — yazmaya başla, kendiliğinden kaydedilir." : `Son güncelleme: ${tarihYaz(S.duz.guncelleme)}`);

  alintilariCiz();
  eklerCiz();
  $("nt-editor").hidden = false;
  $("nt-duzen").classList.add("nt-editor-acik");
  $("nt-baslik").focus();
  listeyiCiz();
  if (window.matchMedia("(max-width: 900px)").matches) $("nt-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function duzenleyiciKapat() {
  if (S.kirli) await kaydet({ sessiz: true });
  clearTimeout(S.otoKayitZamanlayici);
  S.duz = null;
  S.kirli = false;
  blobUrlleriniBirak();
  $("nt-editor").hidden = true;
  $("nt-duzen").classList.remove("nt-editor-acik");
  listeyiCiz();
}

function formuOku() {
  S.duz.baslik = $("nt-baslik").value.trim();
  S.duz.etiketler = [
    ...new Set(
      $("nt-etiketler")
        .value.split(",")
        .map((e) => e.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 20)
    ),
  ];
  S.duz.govde = $("nt-govde").value;
  S.duz.durum = document.querySelector('input[name="nt-durum"]:checked')?.value || "tohum";
  return S.duz;
}

async function kaydet({ sessiz = false } = {}) {
  if (!S.duz) return;
  if (S.kaydediliyor) {
    S.tekrarKaydet = true;
    return;
  }
  const m = formuOku();
  const bos = !m.baslik && !m.govde.trim() && !m.alintilar.length && !m.ekler.length;
  if (bos && S.duzYeni) return;

  clearTimeout(S.otoKayitZamanlayici);
  S.kaydediliyor = true;
  durumYaz("🔐 Şifreleniyor ve kaydediliyor…");
  const kaydedilecek = structuredClone(m);
  try {
    const sonuc = await modeliKaydet(kaydedilecek, S.duzYeni).catch(async (h) => {
      if (h instanceof CakismaHatasi) return cakismadaOnayVeYenidenDene(kaydedilecek);
      throw h;
    });
    if (S.duz?.id === sonuc.id) {
      S.duz.rev = sonuc.rev;
      S.duz.guncelleme = sonuc.guncelleme;
      S.duz.olusturma = sonuc.olusturma;
      S.duzYeni = false;
      $("nt-sil-btn").hidden = false;
      $("nt-donustur-btn").hidden = false;
    }
    haritayaIsle(sonuc);
    S.kirli = false;
    durumYaz(`Kaydedildi ✓ ${saatYaz()} · uçtan uca şifreli`);
    etiketFiltresiniDoldur();
    listeyiCiz();

    if (S.silinecekEkler.length) {
      const silinecek = S.silinecekEkler.splice(0);
      for (const a of silinecek) await ekiTamamenSil(a);
    }
    if (!sessiz) bildir("Not şifrelenip kaydedildi.");
  } catch (h) {
    console.error(h);
    durumYaz("⚠️ Kaydedilemedi");
    bildir("Not kaydedilemedi: " + (h.message || h), "error");
  } finally {
    S.kaydediliyor = false;
    if (S.tekrarKaydet) {
      S.tekrarKaydet = false;
      kaydet({ sessiz: true });
    }
  }
}

function alintilariCiz() {
  const kap = $("nt-alintilar");
  kap.replaceChildren();
  S.duz.alintilar.forEach((a, i) => {
    const alan = (etiket, deger, tur, satir, anahtar, ipucu) => {
      const girdi = tur === "textarea" ? el("textarea", { rows: satir, placeholder: ipucu }) : el("input", { type: "text", placeholder: ipucu, autocomplete: "off" });
      girdi.value = deger;
      girdi.addEventListener("input", () => {
        a[anahtar] = girdi.value;
        kirlendi();
      });
      return el("div", { class: "form-field" }, el("label", { text: etiket }), girdi);
    };

    kap.append(
      el(
        "fieldset",
        { class: "nt-alinti" },
        el("legend", { text: `Alıntı ${i + 1}` }),
        alan("Doğrudan alıntı (kaynaktan birebir)", a.alinti, "textarea", 3, "alinti", "Kaynaktaki cümle(ler), olduğu gibi"),
        el(
          "div",
          { class: "nt-alinti-kaynak" },
          alan("Kaynak (yazar, eser, yıl)", a.kaynak, "input", 1, "kaynak", "ör. Bourdieu, Distinction, 1984"),
          alan("Sayfa ya da URL", a.sayfa, "input", 1, "sayfa", "s. 112 ya da https://…")
        ),
        alan("Kendi yorumum", a.yorum, "textarea", 3, "yorum", "Bu alıntı sana ne düşündürüyor? Kendi cümlelerinle yaz"),
        el(
          "div",
          { class: "nt-alinti-islemler" },
          el("button", {
            type: "button",
            class: "btn-secondary csp-w-auto",
            text: "Metne yerleştir",
            title: "Gövdede imlecin olduğu yere {{alinti:N}} yer tutucusu koyar; yazıya dönüşürken burada belirir",
            onclick: () => {
              const ta = $("nt-govde");
              ta.setRangeText(`{{alinti:${i + 1}}}`, ta.selectionStart, ta.selectionEnd, "end");
              S.duz.govde = ta.value;
              kirlendi();
            },
          }),
          el("button", {
            type: "button",
            class: "btn-danger csp-w-auto",
            text: "Alıntıyı sil",
            onclick: () => {
              S.duz.alintilar.splice(i, 1);
              kirlendi();
              alintilariCiz();
            },
          })
        )
      )
    );
  });
}

/* ------------------------------------------------------------------ */
/* 10) "Yazıya dönüştür" — içerik formuna aktarım                      */
/* ------------------------------------------------------------------ */

const htmlKacis = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function alintiBlogu(a) {
  const paragraflar = a.alinti
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${htmlKacis(p.trim()).replaceAll("\n", "<br>")}</p>`)
    .join("\n");

  const sayfa = a.sayfa.trim();
  const url = guvenliDisUrlMi(sayfa) ? sayfa : "";
  const kunye = [htmlKacis(a.kaynak.trim()), !url && sayfa ? htmlKacis(sayfa) : ""].filter(Boolean).join(", ");
  const kunyeSon = url
    ? `${kunye ? kunye + " " : ""}(<a href="${htmlKacis(url)}" rel="noopener noreferrer">kaynak</a>)`
    : kunye;

  return [`<blockquote${url ? ` cite="${htmlKacis(url)}"` : ""}>`, paragraflar, kunyeSon ? `<footer>— ${kunyeSon}</footer>` : "", "</blockquote>"]
    .filter(Boolean)
    .join("\n");
}

/**
 * Not → yayın Markdown'ı.
 *  - Gövde olduğu gibi (kendi yorumun/ana metin).
 *  - {{alinti:N}} yer tutucusu varsa alıntı tam oraya, yoksa metnin sonuna eklenir.
 *  - Her alıntı HTML <blockquote> olur (içerik KAÇIŞLANIR; yayında ham HTML enjeksiyonu olmaz),
 *    ardından o alıntıya ait "Kendi yorumum" düz paragraf olarak gelir.
 *  - ek:ID görsel başvuruları çıkarılır: ekler ŞİFRELİ, yayında açılamaz.
 */
function markdownUret(m) {
  let kullanilmayan = new Set(m.alintilar.keys());
  let ekAtlanan = 0;

  let govde = m.govde.replace(/!\[[^\]]*\]\(ek:[^)]*\)\n?/g, () => (ekAtlanan++, ""));
  const bloklar = m.alintilar.map((a) => {
    const parca = [];
    if (a.alinti.trim()) parca.push(alintiBlogu(a));
    if (a.yorum.trim()) parca.push(a.yorum.trim());
    return parca.join("\n\n");
  });

  govde = govde.replace(/\{\{alinti:(\d+)\}\}/g, (_, n) => {
    const i = Number(n) - 1;
    if (!bloklar[i]) return "";
    kullanilmayan.delete(i);
    return `\n\n${bloklar[i]}\n\n`;
  });

  const sonaEklenecek = [...kullanilmayan].map((i) => bloklar[i]).filter(Boolean);
  const md = [govde.trim(), ...sonaEklenecek].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  return { md, ekAtlanan, ekToplam: m.ekler.length };
}

function gorunurBekle(kosul, zamanAsimi = 8000) {
  return new Promise((coz) => {
    const bas = Date.now();
    const dene = () => {
      const sonuc = kosul();
      if (sonuc || Date.now() - bas > zamanAsimi) return coz(sonuc || null);
      setTimeout(dene, 100);
    };
    dene();
  });
}

async function yaziyaDonustur(m) {
  const { md, ekToplam } = markdownUret(m);
  if (!md.trim() && !m.baslik) return bildir("Aktarılacak içerik yok: önce nota bir şeyler yaz.", "warning");

  // dashboard.js'in mevcut delege dinleyicisini kullanıyoruz: [data-dash-git] bağlantısına tıklamak
  // = sol menüden "Yeni İçerik Ekle"ye tıklamakla AYNI (sekme değişir, gy modülü gerekirse yüklenir).
  const kopru = el("a", { href: "#content-new", data: { dashGit: "content-new" }, hidden: true });
  document.body.append(kopru);
  kopru.click();
  kopru.remove();

  const form = await gorunurBekle(() => {
    const gorunum = $("view-content-new");
    const baslik = $("ic-title");
    const govde = $("ic-body");
    return gorunum && !gorunum.hidden && baslik && govde ? { baslik, govde } : null;
  });
  if (!form) return bildir("“Yeni İçerik Ekle” formu açılamadı; sol menüden elle açıp tekrar dene.", "error");

  await new Promise((r) => setTimeout(r, 250)); // github-yonetim.js'in form başlatması (varsa) bitsin

  const duzenlemeModu = $("ic-iptal-btn") && !$("ic-iptal-btn").hidden;
  const doluMu = form.baslik.value.trim() || form.govde.value.trim();
  if (doluMu || duzenlemeModu) {
    const uyari = duzenlemeModu
      ? "Şu an mevcut bir içeriği DÜZENLİYORSUN. Başlık ve metin bu notla değiştirilsin mi?"
      : "İçerik formunda zaten yazılmış bir şey var. Başlık ve metin bu notla değiştirilsin mi?";
    if (!window.confirm(uyari)) return;
  }

  form.baslik.value = m.baslik;
  form.govde.value = md;
  for (const alan of [form.baslik, form.govde]) alan.dispatchEvent(new Event("input", { bubbles: true }));
  form.baslik.focus();

  const mesajKutusu = $("ic-message");
  if (mesajKutusu) {
    showMessage(
      mesajKutusu,
      `“${m.baslik || "Başlıksız not"}” forma aktarıldı.` +
        (m.alintilar.length ? ` ${m.alintilar.length} alıntı <blockquote> olarak eklendi.` : "") +
        (ekToplam ? ` ${ekToplam} ek şifreli olduğu için taşınmadı; yayında görsel kullanacaksan notu açıp ekleri indir, siteye ayrıca yükle.` : "") +
        " Yayına almadan önce gözden geçir.",
      "success"
    );
  }

  // Not kartında "yazıya aktarıldı" izi (şifreli yükün içinde, sunucu görmez).
  const guncel = S.notlar.get(m.id) || m;
  hizliGuncelle(guncel, { aktarildi: new Date().toISOString() }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* 11) Kasa durumu: kilit / kurtarma / ana ekran                       */
/* ------------------------------------------------------------------ */

function ekranGoster(hangisi) {
  $("nt-kilit").hidden = hangisi !== "kilit";
  $("nt-kurtarma-goster").hidden = hangisi !== "kurtarma-goster";
  $("nt-ana").hidden = hangisi !== "ana";
}

function googleMiYalnizca(session) {
  const kimlikler = session.user.identities || [];
  return kimlikler.length > 0 && !kimlikler.some((k) => k.provider === "email");
}

function kilitKartiniHazirla({ kasaVar, kurtarmaGerekli }) {
  ekranGoster("kilit");
  const aciklama = $("nt-kilit-aciklama");
  const oturumGoogle = googleMiYalnizca(S.session);

  if (kurtarmaGerekli) {
    aciklama.textContent =
      "Giriş parolan bu kasanın zarfını açmıyor. Parolan başka bir yerden değişmiş olabilir (ör. “şifremi unuttum”). " +
      "Kurtarma anahtarını ve şu anki giriş parolanı yaz; kasa yeni parolana göre yeniden kurulur, notların korunur.";
    $("nt-kurtarma-alan").hidden = false;
  } else if (!kasaVar) {
    aciklama.textContent =
      "İlk kurulum: Notların bu cihazda, giriş parolandan türetilen bir anahtarla şifrelenecek. " +
      "Yeni bir parola belirlemene gerek yok — mevcut giriş parolanı yaz. Seni bir kez doğrularız.";
  } else {
    aciklama.textContent =
      "Bu cihazda anahtar yok (Google ile giriş yaptın, oturumun başka yerden devam ediyor ya da kasayı kilitledin). " +
      "Giriş parolanı bir kez yaz; yeni bir parola istemiyoruz.";
  }
  $("nt-google-ipucu").hidden = !oturumGoogle;
  $("nt-kilit-parola").focus();
}

function kurtarmaKartiniGoster(metin, sonra) {
  ekranGoster("kurtarma-goster");
  $("nt-kurtarma-metin").textContent = metin;
  $("nt-kurtarma-onay").checked = false;
  $("nt-kurtarma-devam").disabled = true;
  $("nt-kurtarma-devam").onclick = () => sonra();
}

async function kasaSonucunuUygula(sonuc) {
  switch (sonuc.durum) {
    case "acik":
      return anaEkraniAc();
    case "yeni-kasa":
      return kurtarmaKartiniGoster(sonuc.kurtarmaMetni, anaEkraniAc);
    case "kurtarma-gerekli":
      return kilitKartiniHazirla({ kasaVar: true, kurtarmaGerekli: true });
    default:
      return kilitKartiniHazirla({ kasaVar: !!sonuc.kasaVar, kurtarmaGerekli: false });
  }
}

async function anaEkraniAc() {
  ekranGoster("ana");
  otoKilidiKur();
  try {
    await notlariYukle();
  } catch (h) {
    console.error(h);
    bildir("Notlar yüklenemedi: " + (h.message || h), "error", 0);
  }
}

/**
 * İLK KURULUMDA yanlış parolayla kasa oluşturmayı önlemek için, yazılan parola gerçekten giriş
 * parolası mı diye GEÇİCİ ve oturumu kaydetmeyen ikinci bir istemciyle doğrularız.
 * (Ana oturumu ezmez; 2FA'lı hesapta da çalışır çünkü sadece parolayı sınar.)
 */
async function girisParolasiniDogrula(parola) {
  const gecici = window.supabase.createClient(supabase.supabaseUrl, supabase.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await gecici.auth.signInWithPassword({ email: S.session.user.email, password: parola });
  if (!error) await gecici.auth.signOut({ scope: "local" }).catch(() => {});
  return !error;
}

async function kilitFormuGonderildi(olay) {
  olay.preventDefault();
  const btn = $("nt-kilit-btn");
  const girdi = $("nt-kilit-parola");
  let parola = girdi.value;
  girdi.value = "";
  if (!parola) return bildir("Giriş parolanı yaz.", "warning");

  btn.disabled = true;
  try {
    const kurtarmaModu = !$("nt-kurtarma-alan").hidden;
    let sonuc;
    if (kurtarmaModu) {
      const k = $("nt-kilit-kurtarma").value;
      sonuc = await Kasa.kurtarmaIleAc(S.session, k, parola);
      $("nt-kilit-kurtarma").value = "";
    } else {
      const { kasaVar } = await kasaVarMi();
      if (!kasaVar && !(await girisParolasiniDogrula(parola))) {
        parola = null;
        return bildir("Bu, giriş parolan değil gibi görünüyor. Tekrar dene.", "error");
      }
      sonuc = await Kasa.parolaIleAc(S.session, parola);
    }
    parola = null;

    if (sonuc.durum === "kurtarma-gerekli") {
      kilitKartiniHazirla({ kasaVar: true, kurtarmaGerekli: true });
      return bildir("Bu parola kasayı açmadı. Yanlış yazmış olabilirsin; ya da parolan değişmişse kurtarma anahtarını kullan.", "error");
    }
    await kasaSonucunuUygula(sonuc);
  } catch (h) {
    console.error(h);
    bildir(h.message || "Kasa açılamadı.", "error");
  } finally {
    parola = null;
    btn.disabled = false;
  }
}

async function kasaVarMi() {
  const { data } = await supabase.from("not_kasasi").select("user_id").maybeSingle();
  return { kasaVar: !!data };
}

/** Bellekteki her şeyi bırakır, anahtarı cihazdan siler, kilit kartını gösterir. */
async function kilitle(sebep) {
  if (S.kirli) await kaydet({ sessiz: true }).catch(() => {});
  await Kasa.kilitle();
  S.notlar.clear();
  S.duz = null;
  S.kirli = false;
  blobUrlleriniBirak();
  $("nt-liste").replaceChildren();
  $("nt-editor").hidden = true;
  $("nt-duzen").classList.remove("nt-editor-acik");
  kilitKartiniHazirla({ kasaVar: true, kurtarmaGerekli: false });
  if (sebep) bildir(sebep, "success");
}

function otoKilidiKur() {
  clearTimeout(S.otoKilitZamanlayici);
  let dk = 0;
  try {
    dk = Number(localStorage.getItem("aea_nt_otokilit") || 0);
  } catch {
    /* depo kapalı */
  }
  $("nt-otokilit").value = String(dk);
  if (!dk) return;
  S.otoKilitZamanlayici = setTimeout(() => kilitle(`${dk} dakika işlem yapılmadığı için kasa kilitlendi.`), dk * 60000);
}

/* ------------------------------------------------------------------ */
/* 12) Yedek / güvenlik araçları                                       */
/* ------------------------------------------------------------------ */

function dosyaIndir(ad, icerik, tur) {
  const url = URL.createObjectURL(new Blob([icerik], { type: tur }));
  const a = el("a", { href: url, download: ad, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function sifreliYedekIndir() {
  const { data, error } = await supabase.from("notlar").select("id, ciphertext, iv, rev, silindi_at, created_at, updated_at");
  if (error) return bildir("Yedek alınamadı: " + error.message, "error");
  const kasa = Kasa.sifreliYedekIcinKasaSatiri();
  dosyaIndir(
    `notlar-sifreli-yedek-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ sema: 1, kasa, notlar: data }, null, 1),
    "application/json"
  );
  bildir("Şifreli yedek indirildi. Parolan ya da kurtarma anahtarın olmadan açılamaz.");
}

function okunurYedekIndir() {
  if (!window.confirm("Bu dosya notlarını ŞİFRESİZ, düz metin olarak içerecek. Yalnızca güvendiğin bir yerde sakla. Devam edilsin mi?")) return;
  const canli = [...S.notlar.values()].filter((m) => !m.silindiAt).sort((a, b) => a.baslik.localeCompare(b.baslik, "tr"));
  const metin = canli
    .map((m) => {
      const parcalar = [`# ${m.baslik || "Başlıksız not"}`, `Durum: ${DURUMLAR[m.durum].ad} · Etiketler: ${m.etiketler.join(", ") || "-"}`, "", m.govde];
      m.alintilar.forEach((a, i) => parcalar.push("", `> ${a.alinti.replaceAll("\n", "\n> ")}`, `> — ${a.kaynak} ${a.sayfa}`.trim(), a.yorum ? `\nYorumum: ${a.yorum}` : ""));
      return parcalar.join("\n");
    })
    .join("\n\n---\n\n");
  dosyaIndir(`notlar-okunur-yedek-${new Date().toISOString().slice(0, 10)}.md`, metin, "text/markdown");
}

async function kurtarmaAnahtariniYenile() {
  if (!window.confirm("Yeni bir kurtarma anahtarı üretilecek; ESKİSİ GEÇERSİZ olacak. Devam edilsin mi?")) return;
  try {
    kurtarmaKartiniGoster(await Kasa.kurtarmaAnahtariniYenile(), () => ekranGoster("ana"));
  } catch (h) {
    bildir(h.message || "Kurtarma anahtarı yenilenemedi.", "error");
  }
}

/* ------------------------------------------------------------------ */
/* 13) Olay bağlama                                                    */
/* ------------------------------------------------------------------ */

function baglantilariKur() {
  // Arama (anlık, 90 ms sönümleme)
  let aramaT;
  $("nt-arama").addEventListener("input", (o) => {
    clearTimeout(aramaT);
    aramaT = setTimeout(() => {
      S.filtre.arama = o.target.value.trim();
      S.gorunenSayi = SAYFA_BOYUTU;
      $("nt-arama-temizle").hidden = !S.filtre.arama;
      listeyiCiz();
    }, 90);
  });
  $("nt-arama-temizle").addEventListener("click", () => {
    $("nt-arama").value = "";
    S.filtre.arama = "";
    $("nt-arama-temizle").hidden = true;
    listeyiCiz();
    $("nt-arama").focus();
  });

  // Filtreler
  $("nt-durum-chips").addEventListener("click", (o) => {
    const b = o.target.closest("[data-durum]");
    if (!b) return;
    S.filtre.durum = b.dataset.durum;
    S.gorunenSayi = SAYFA_BOYUTU;
    document.querySelectorAll("#nt-durum-chips [data-durum]").forEach((x) => {
      const secili = x === b;
      x.classList.toggle("active", secili);
      x.setAttribute("aria-selected", String(secili));
    });
    listeyiCiz();
  });
  $("nt-etiket-filtre").addEventListener("change", (o) => {
    S.filtre.etiket = o.target.value;
    S.gorunenSayi = SAYFA_BOYUTU;
    listeyiCiz();
  });

  $("nt-yeni-btn").addEventListener("click", () => duzenleyiciAc(null));
  $("nt-yenile-btn").addEventListener("click", () => notlariYukle().catch((h) => bildir("Yenilenemedi: " + h.message, "error")));
  $("nt-kilitle-btn").addEventListener("click", () => kilitle("Kasa kilitlendi; bu cihazdaki anahtar silindi."));
  $("nt-otokilit").addEventListener("change", (o) => {
    try {
      localStorage.setItem("aea_nt_otokilit", o.target.value);
    } catch {
      /* depo kapalı */
    }
    otoKilidiKur();
  });
  $("nt-yedek-sifreli-btn").addEventListener("click", sifreliYedekIndir);
  $("nt-yedek-okunur-btn").addEventListener("click", okunurYedekIndir);
  $("nt-kurtarma-yenile-btn").addEventListener("click", kurtarmaAnahtariniYenile);

  // Kilit / kurtarma
  $("nt-kilit-form").addEventListener("submit", kilitFormuGonderildi);
  $("nt-kurtarma-toggle").addEventListener("click", () => {
    const alan = $("nt-kurtarma-alan");
    alan.hidden = !alan.hidden;
    if (!alan.hidden) $("nt-kilit-kurtarma").focus();
  });
  $("nt-kurtarma-onay").addEventListener("change", (o) => ($("nt-kurtarma-devam").disabled = !o.target.checked));
  $("nt-kurtarma-kopyala").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("nt-kurtarma-metin").textContent);
      bildir("Kurtarma anahtarı panoya kopyalandı. Pano geçmişinde kalmaması için bir parola yöneticisine yapıştır.", "success");
    } catch {
      bildir("Kopyalanamadı; anahtarı elle seçip kopyala.", "warning");
    }
  });
  $("nt-kurtarma-indir").addEventListener("click", () =>
    dosyaIndir(
      "not-kasasi-kurtarma-anahtari.txt",
      `Not Kasası kurtarma anahtarı (${new Date().toLocaleDateString("tr-TR")})\n\n${$("nt-kurtarma-metin").textContent}\n\n` +
        "Bu anahtar parolan unutulursa ya da değişirse notlarını açabilen TEK yoldur.\nKimseyle paylaşma; yalnızca güvenli bir yerde sakla.\n",
      "text/plain"
    )
  );

  // Düzenleyici
  $("nt-form").addEventListener("submit", (o) => {
    o.preventDefault();
    kaydet();
  });
  $("nt-form").addEventListener("input", (o) => {
    if (o.target.closest("#nt-alintilar")) return; // alıntı alanları kendi dinleyicisiyle kirletir
    if (!S.duz) return;
    formuOku();
    kirlendi();
  });
  $("nt-form").addEventListener("keydown", (o) => {
    if ((o.ctrlKey || o.metaKey) && o.key.toLowerCase() === "s") {
      o.preventDefault();
      kaydet();
    }
  });
  $("nt-geri-btn").addEventListener("click", duzenleyiciKapat);
  $("nt-kapat-btn").addEventListener("click", duzenleyiciKapat);
  $("nt-alinti-ekle-btn").addEventListener("click", () => {
    S.duz.alintilar.push({ id: crypto.randomUUID(), alinti: "", kaynak: "", sayfa: "", yorum: "" });
    alintilariCiz();
    kirlendi();
    $("nt-alintilar").lastElementChild?.querySelector("textarea")?.focus();
  });
  $("nt-sil-btn").addEventListener("click", async () => {
    const m = S.duz;
    if (!m || !window.confirm("Bu not çöp kutusuna taşınsın mı? 30 gün içinde geri alabilirsin.")) return;
    if (S.kirli) await kaydet({ sessiz: true });
    S.kirli = false;
    await copeAt(S.notlar.get(m.id) || m);
    await duzenleyiciKapat();
  });
  $("nt-donustur-btn").addEventListener("click", async () => {
    if (S.kirli) await kaydet({ sessiz: true });
    yaziyaDonustur(S.notlar.get(S.duz.id) || S.duz);
  });

  // Sürükle-bırak
  const birak = $("nt-birak");
  for (const ad of ["dragenter", "dragover"]) {
    birak.addEventListener(ad, (o) => {
      o.preventDefault();
      birak.classList.add("nt-birak-uzerinde");
    });
  }
  for (const ad of ["dragleave", "drop"]) {
    birak.addEventListener(ad, (o) => {
      o.preventDefault();
      birak.classList.remove("nt-birak-uzerinde");
    });
  }
  birak.addEventListener("drop", (o) => dosyalariEkle([...o.dataTransfer.files]));
  $("nt-dosya-sec-btn").addEventListener("click", () => $("nt-dosya").click());
  $("nt-dosya").addEventListener("change", (o) => {
    dosyalariEkle([...o.target.files]);
    o.target.value = "";
  });
  // Metin alanına doğrudan görsel yapıştırma/bırakma da çalışsın
  $("nt-govde").addEventListener("drop", (o) => {
    if (!o.dataTransfer?.files?.length) return;
    o.preventDefault();
    dosyalariEkle([...o.dataTransfer.files]);
  });
  $("nt-govde").addEventListener("paste", (o) => {
    const dosyalar = [...(o.clipboardData?.files || [])];
    if (!dosyalar.length) return;
    o.preventDefault();
    dosyalariEkle(dosyalar);
  });

  // Genel
  window.addEventListener("beforeunload", (o) => {
    if (S.kirli) {
      o.preventDefault();
      o.returnValue = "";
    }
  });
  document.addEventListener("keydown", (o) => {
    const yaziyor = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "");
    const gorunur = $("nt-ana") && !$("nt-ana").hidden && !$("view-content-notlar").hidden;
    if (o.key === "/" && !yaziyor && gorunur) {
      o.preventDefault();
      $("nt-arama").focus();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Kasa.kasaAcikMi() && !S.kirli && !S.duz && Date.now() - S.sonSenkron > 120000) {
      notlariYukle({ sessiz: true }).catch(() => {});
    }
  });
  // Etkinlik varsa otomatik kilit sayacı yeniden başlar
  for (const ad of ["pointerdown", "keydown"]) $("notlar").addEventListener(ad, () => Kasa.kasaAcikMi() && otoKilidiKur(), { passive: true });
}

/* ------------------------------------------------------------------ */
/* 14) Başlangıç                                                       */
/* ------------------------------------------------------------------ */

async function init() {
  const { session } = await requireAuthOrShowError({ role: ["editor", "manager"] });
  S.session = session;
  if (!$("notlar")) return;
  baglantilariKur();

  try {
    await kasaSonucunuUygula(await Kasa.kasaBaslat(session));
  } catch (h) {
    console.error(h);
    ekranGoster("kilit");
    const sema = /relation .*not_kasasi|does not exist|42P01/i.test(h?.message || "");
    bildir(
      sema
        ? "Not tablosu bulunamadı: 0056_notlar_e2ee.sql migration'ını Supabase'de çalıştırdın mı?"
        : "Not Kasası başlatılamadı: " + (h.message || h),
      "error",
      0
    );
  }
}

init();
