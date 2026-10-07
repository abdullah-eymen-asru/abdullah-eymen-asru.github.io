/*
 * assets/js/notlar/notlar.js
 * -----------------------------------------------------------------------
 * "Notlarım" — arayüz ve veri katmanı (uçtan uca şifreli not sistemi).
 *
 * v3: üç panelli çalışma alanı (klasör ağacı · not listesi · düzenleyici), tür + durum
 * sistemi (Tohum/Filiz/Ağaç kalktı), konu tarihi, arşiv, çoklu seçim ve her biçimde
 * (PDF, Word, Markdown, HTML, metin, ZIP) dışa aktarma. Veri modeli geriye uyumludur:
 * eski notlardaki tohum/filiz/ağaç değerleri açılışta gelen/devam/tamam olarak okunur;
 * yeni tablo ya da migration gerekmez (yeni alanlar şifreli yükün içinde).
 *
 * dashboard.js bu dosyayı SADECE kullanıcı "Notlarım" sekmesine ilk kez tıkladığında
 * dynamic import() ile yükler; import edilince init() kendiliğinden çalışır.
 *
 * KURALLAR
 *  - Sunucuya giden TEK içerik: Kasa.notuSifrele() çıktısı (ciphertext + iv).
 *  - Arama, filtre, sıralama TAMAMEN tarayıcıda, bellekte çözülmüş nesneler üzerinde.
 *  - Not içeriği HİÇBİR ZAMAN innerHTML ile basılmaz: tüm metinler textContent / DOM düğümü
 *    ile üretilir (not içeriği = güvenilmeyen girdi; bkz. kasa.js tehdit modeli notu).
 *  - Ekler (görsel/PDF) R2'ye ŞİFRELİ bayt olarak gider (bkz. r2_not_ek_worker).
 *  - Dışa aktarma (disa-aktar/) yalnızca bu cihazda, çözülmüş veriyle çalışır.
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage, kucukHarfeCevirTr, guvenliDisUrlMi } from "../core/supabase-client.js";
import { requireAuthOrShowError } from "../auth/auth-guard.js";
import * as Kasa from "./kasa.js";
import * as Bicim from "./bicim.js";

/* ------------------------------------------------------------------ */
/* 0) Ayarlar                                                          */
/* ------------------------------------------------------------------ */

// ---- BURAYI DOLDUR: r2_not_ek_worker deploy edildikten sonra aldığın adres ----
const EK_WORKER_URL = "https://r2-not-ek-worker.aeymena.workers.dev";
// -------------------------------------------------------------------------------

/** Çalışma durumu: notun hayat döngüsü. */
const DURUMLAR = {
  gelen: { ad: "Gelen kutusu", ipucu: "Henüz düzenlenmedi" },
  devam: { ad: "Devam ediyor", ipucu: "Üzerinde çalışıyorsun" },
  tamam: { ad: "Tamamlandı", ipucu: "Hazır, gözden geçirildi" },
};
/** Eski (tohum/filiz/ağaç) kayıtların yeni karşılığı. */
const ESKI_DURUM = { tohum: "gelen", filiz: "devam", agac: "tamam" };

/** İçerik türü: ders, sunum, proje, etkinlik… Renk, CSS'te nt-tur-<anahtar> sınıfıyla verilir. */
const TURLER = {
  genel: { ad: "Genel" },
  ders: { ad: "Ders" },
  sunum: { ad: "Sunum" },
  proje: { ad: "Proje" },
  etkinlik: { ad: "Etkinlik" },
  toplanti: { ad: "Toplantı" },
  kaynak: { ad: "Kitap / makale" },
  fikir: { ad: "Fikir" },
};

const SIRALAMA_AD = { guncelleme: "Son düzenlenen", olusturma: "Oluşturulma", baslik: "Başlık (A–Z)", tarih: "Konu tarihi" };
const SIRALAMA = {
  guncelleme: (a, b) => b.guncelleme.localeCompare(a.guncelleme),
  olusturma: (a, b) => b.olusturma.localeCompare(a.olusturma),
  baslik: (a, b) => (a.baslik || "").localeCompare(b.baslik || "", "tr"),
  tarih: (a, b) => (b.tarih || "").localeCompare(a.tarih || "") || b.guncelleme.localeCompare(a.guncelleme),
};

const GORUNUMLER = [
  { id: "tum", ad: "Tüm notlar", ikon: "layers" },
  { id: "son", ad: "Son düzenlenenler", ikon: "clock" },
  { id: "sabit", ad: "Sabitlenenler", ikon: "pin" },
];
const GORUNUMLER_ALT = [
  { id: "arsiv", ad: "Arşiv", ikon: "archive" },
  { id: "cop", ad: "Çöp kutusu", ikon: "trash" },
];

const IZINLI_EK_TIPLERI = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const EK_UST_SINIR = 15 * 1024 * 1024; // tek dosya 15 MB (Worker'da 25 MB tavan var)
const NOT_BASINA_EK = 20;
const SAYFA_BOYUTU = 80;
const SON_SAYISI = 30;
const OTOKAYIT_MS = 2500;

/* ------------------------------------------------------------------ */
/* 1) Durum                                                            */
/* ------------------------------------------------------------------ */

const S = {
  session: null,
  notlar: new Map(), // id -> not modeli
  klasorler: new Map(), // id -> klasör modeli
  gorunum: "tum", // tum | son | sabit | arsiv | cop | klasor
  konum: null, // gorunum === "klasor" iken klasör id'si
  acik: new Set(), // ağaçta açık klasörler
  otoBaslik: "", // hızlı notun otomatik başlığı
  surukle: null,
  menu: null,
  menuBagla: null,
  odak: false,
  filtre: { etiket: "", arama: "", durum: "", tur: "", sirala: "guncelleme" },
  secimModu: false,
  secim: new Set(),
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
  if (m.tur === "klasor") {
    m.ara = katla(m.ad);
    m.araBaslik = m.ara;
    m.araEtiket = "";
    return;
  }
  m.metin = m.html ? Bicim.duzMetinHtml(m.html) : duzMetin(m.govde);
  const parcalar = [
    m.baslik,
    m.etiketler.join(" "),
    m.metin,
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
  const tum = duzMetin([m.metin, ...m.alintilar.map((a) => `${a.alinti} ${a.yorum}`)].join(" "));
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
/* 2b) Simgeler (satır içi SVG, innerHTML'siz)                         */
/* ------------------------------------------------------------------ */

const IKONLAR = {
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM21 21l-4.3-4.3",
  x: "M18 6L6 18M6 6l12 12",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  more: "M12 12h.01M5 12h.01M19 12h.01",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  "folder-plus": "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2zM12 10v6M9 13h6",
  "file-text": "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8",
  "arrow-left": "M19 12H5M12 19l-7-7 7-7",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
  plus: "M12 5v14M5 12h14",
  pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  check: "M20 6L9 17l-5-5",
  quote: "M10 11H6a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h1M20 11h-4a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h1M5 11v2a4 4 0 0 0 4 4M15 11v2a4 4 0 0 0 4 4",
};
const SVG_NS = "http://www.w3.org/2000/svg";

function ikon(ad) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", ad === "more" ? "3" : "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", IKONLAR[ad] || "");
  s.append(p);
  return s;
}

function ikonlariKur(kok = document) {
  kok.querySelectorAll("[data-ikon]").forEach((k) => {
    if (!k.firstChild) k.append(ikon(k.dataset.ikon));
  });
}

/** 4 Ekim 17:03 → "17:03", dün → "Dün", bu hafta → "Salı", eski → "4 Eki". */
function zamanYaz(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bugun = new Date();
  const gun = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const fark = Math.round((gun(bugun) - gun(d)) / 86400000);
  if (fark === 0) return saatYaz(d);
  if (fark === 1) return "Dün";
  if (fark > 1 && fark < 7) return d.toLocaleDateString("tr-TR", { weekday: "long" });
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", ...(d.getFullYear() !== bugun.getFullYear() ? { year: "numeric" } : {}) });
}
const konuTarihiYaz = (t) => (t ? new Date(t + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "");
const yerelTarih = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ------------------------------------------------------------------ */
/* 4) Model ⇄ şifreli zarf                                             */
/* ------------------------------------------------------------------ */

/** İçeri aktarılan notun özgün oluşturma zamanı (şifreli yükte saklanır; geçersizse null). */
function kokenTarihi(v) {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) || t > Date.now() + 86400000 ? null : new Date(t).toISOString();
}

function modelOlustur(id, satir, yuk) {
  const m = {
    id,
    rev: satir?.rev ?? 0,
    olusturma: kokenTarihi(yuk?.kokenOlusturma) || satir?.created_at || new Date().toISOString(),
    kokenOlusturma: kokenTarihi(yuk?.kokenOlusturma),
    guncelleme: satir?.updated_at || new Date().toISOString(),
    silindiAt: satir?.silindi_at || null,
    tur: "not",
    klasor: yuk?.klasor ? String(yuk.klasor) : null,
    sabit: !!yuk?.sabit,
    arsiv: !!yuk?.arsiv,
    html: String(yuk?.html || ""),
    baslik: String(yuk?.baslik || ""),
    etiketler: Array.isArray(yuk?.etiketler) ? yuk.etiketler.map(String) : [],
    durum: DURUMLAR[yuk?.durum] ? yuk.durum : ESKI_DURUM[yuk?.durum] || "gelen",
    kategori: TURLER[yuk?.kategori] ? yuk.kategori : "genel",
    tarih: /^\d{4}-\d{2}-\d{2}$/.test(yuk?.tarih || "") ? yuk.tarih : "",
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

function klasorModeli(id, satir, yuk) {
  const m = {
    tur: "klasor",
    id,
    rev: satir?.rev ?? 0,
    olusturma: satir?.created_at || new Date().toISOString(),
    guncelleme: satir?.updated_at || new Date().toISOString(),
    silindiAt: satir?.silindi_at || null,
    ad: String(yuk?.ad || "Adsız klasör").slice(0, 80),
    ust: yuk?.ust ? String(yuk.ust) : null,
    simge: String(yuk?.simge || "📁").slice(0, 8),
    sabit: !!yuk?.sabit,
  };
  aramaIndeksiKur(m);
  return m;
}

/** Şifreli zarfın içine giren yük. v3: v2 + kategori, tarih, arsiv (eski okuyucular fazlalığı yok sayar). */
const yukuHazirla = (m) =>
  m.tur === "klasor"
    ? { v: 2, tur: "klasor", ad: m.ad, ust: m.ust, simge: m.simge, sabit: m.sabit }
    : {
        v: 3,
        baslik: m.baslik,
        etiketler: m.etiketler,
        durum: m.durum,
        kategori: m.kategori,
        tarih: m.tarih,
        arsiv: m.arsiv,
        klasor: m.klasor,
        sabit: m.sabit,
        html: m.html,
        govde: m.govde,
        alintilar: m.alintilar,
        ekler: m.ekler,
        aktarildi: m.aktarildi,
        kokenOlusturma: m.kokenOlusturma || undefined,
      };

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
    return { ...m, rev: data.rev, olusturma: m.kokenOlusturma || data.created_at, guncelleme: data.updated_at };
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
  if (m.tur === "klasor") {
    S.klasorler.set(m.id, m);
    return;
  }
  S.notlar.set(m.id, m);

  // Aynı not editörde açıkken menü/seçim üzerinden bir işlem rev'i ilerletir; editör eski rev'le
  // kaydetmeye kalkarsa gereksiz "çakışma" sorusu çıkmasın.
  if (S.duz && S.duz.id === m.id) {
    S.duz.rev = m.rev;
    S.duz.guncelleme = m.guncelleme;
    S.duz.aktarildi = m.aktarildi;
    // Taşıma, sabitleme, arşivleme açık editörün eski değeriyle ezilmesin
    S.duz.klasor = m.klasor;
    S.duz.sabit = m.sabit;
    S.duz.arsiv = m.arsiv;
    const ks = $("nt-klasor-sec");
    if (ks && [...ks.options].some((o) => o.value === (m.klasor || ""))) ks.value = m.klasor || "";
    if (!S.kirli && S.duz.durum !== m.durum) {
      S.duz.durum = m.durum;
      $("nt-durum-sec").value = m.durum;
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
  S.klasorler.clear();
  S.bozukSayisi = 0;
  for (const satir of tum) {
    try {
      const yuk = await Kasa.notuCoz(satir.ciphertext, satir.iv, satir.id);
      haritayaIsle(yuk?.tur === "klasor" ? klasorModeli(satir.id, satir, yuk) : modelOlustur(satir.id, satir, yuk));
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

  if (S.konum && !klasorVarMi(S.konum)) S.konum = null;
  yetimEkleriSupur().catch((h) => console.warn("Yetim ek temizliği:", h));
  etiketFiltresiniDoldur();
  listeyiCiz();
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
/* 6) Klasör ağacı, görünümler, liste, seçim, menüler                  */
/* ------------------------------------------------------------------ */

const SIMGELER = ["📁", "📚", "🎓", "🎤", "🧠", "📝", "💼", "🔬", "🗓️", "💡", "⭐", "🌍", "🎧", "🧪"];

const klasorVarMi = (id) => !!id && S.klasorler.has(id) && !S.klasorler.get(id).silindiAt;
/** Klasörün gösterileceği üst klasör (üstü yok / çöpteyse kök). */
const klasorUstu = (k) => (klasorVarMi(k.ust) ? k.ust : null);
/** Notun gösterileceği klasör (klasör yok / çöpteyse kök). */
const notKlasoru = (m) => (klasorVarMi(m.klasor) ? m.klasor : null);

const adSirala = (a, b) => (b.sabit - a.sabit) || (a.ad || "").localeCompare(b.ad || "", "tr");

function yolDizisi(id) {
  const yol = [];
  const goruldu = new Set();
  while (id && S.klasorler.has(id) && !goruldu.has(id)) {
    goruldu.add(id);
    const k = S.klasorler.get(id);
    yol.unshift(k);
    id = k.ust;
  }
  return yol;
}
const yolMetni = (id) => yolDizisi(id).map((k) => k.ad).join(" / ");

function altKlasorler(ustId) {
  return [...S.klasorler.values()].filter((k) => !k.silindiAt && klasorUstu(k) === (ustId || null)).sort(adSirala);
}

/** adayId, atasId'nin kendisi ya da torunu mu? (döngü engelleme) */
function torunMu(adayId, atasId) {
  const g = new Set();
  let id = adayId;
  while (id && !g.has(id)) {
    if (id === atasId) return true;
    g.add(id);
    id = S.klasorler.get(id)?.ust || null;
  }
  return false;
}

/** k klasörünün altındaki klasör + notlar. ts verilirse yalnızca o anda (birlikte) çöpe gidenler. */
function altAgac(k, ts) {
  const uyar = (x) => (ts === undefined ? !x.silindiAt : x.silindiAt === ts);
  const klasorler = [k];
  const notlar = [];
  const gorulen = new Set([k.id]);
  const kuyruk = [k.id];
  while (kuyruk.length) {
    const id = kuyruk.pop();
    for (const c of S.klasorler.values()) {
      if (c.ust === id && !gorulen.has(c.id) && uyar(c)) {
        gorulen.add(c.id);
        klasorler.push(c);
        kuyruk.push(c.id);
      }
    }
    for (const n of S.notlar.values()) if (n.klasor === id && uyar(n)) notlar.push(n);
  }
  return { klasorler, notlar };
}

function sayimlariHesapla() {
  const notSayisi = new Map();
  const altSayisi = new Map();
  for (const m of S.notlar.values()) {
    if (m.silindiAt) continue;
    const g = new Set();
    let id = notKlasoru(m);
    while (id && !g.has(id)) {
      g.add(id);
      notSayisi.set(id, (notSayisi.get(id) || 0) + 1);
      id = klasorUstu(S.klasorler.get(id));
    }
  }
  for (const k of S.klasorler.values()) {
    if (k.silindiAt) continue;
    const u = klasorUstu(k);
    if (u) altSayisi.set(u, (altSayisi.get(u) || 0) + 1);
  }
  return { notSayisi, altSayisi };
}

const ustCopKlasorleri = () => [...S.klasorler.values()].filter((k) => k.silindiAt && S.klasorler.get(k.ust)?.silindiAt !== k.silindiAt);
const ustCopNotlari = () => [...S.notlar.values()].filter((m) => m.silindiAt && S.klasorler.get(m.klasor)?.silindiAt !== m.silindiAt);

const genelAramaMi = () => !!(S.filtre.arama || S.filtre.etiket);
const filtreAktifMi = () => !!(S.filtre.durum || S.filtre.tur || S.filtre.etiket || S.filtre.arama);

function filtrelenmisNotlar() {
  const { etiket, arama, durum, tur, sirala } = S.filtre;
  const tokenler = aramaTokenleri(arama);
  const etiketK = katla(etiket);
  const genel = !!(tokenler.length || etiketK);

  let liste;
  if (S.gorunum === "cop") {
    liste = ustCopNotlari();
  } else {
    liste = [...S.notlar.values()].filter((m) => !m.silindiAt);
    if (!genel) {
      if (S.gorunum === "arsiv") liste = liste.filter((m) => m.arsiv);
      else {
        liste = liste.filter((m) => !m.arsiv);
        if (S.gorunum === "klasor") liste = liste.filter((m) => notKlasoru(m) === S.konum);
        else if (S.gorunum === "sabit") liste = liste.filter((m) => m.sabit);
      }
    }
  }
  if (durum) liste = liste.filter((m) => m.durum === durum);
  if (tur) liste = liste.filter((m) => m.kategori === tur);
  if (etiketK) liste = liste.filter((m) => m.etiketler.some((e) => katla(e) === etiketK));
  if (tokenler.length) liste = liste.filter((m) => tokenler.every((t) => m.ara.includes(t)));

  const puan = (m) => tokenler.reduce((p, t) => p + (m.araBaslik.includes(t) ? 3 : 0) + (m.araEtiket.includes(t) ? 2 : 0), 0);
  const kiyas = SIRALAMA[S.gorunum === "son" ? "guncelleme" : sirala] || SIRALAMA.guncelleme;
  const sabitOnce = S.gorunum !== "son" && S.gorunum !== "cop";
  liste.sort((a, b) => (tokenler.length ? puan(b) - puan(a) : 0) || (sabitOnce ? b.sabit - a.sabit : 0) || kiyas(a, b));
  if (S.gorunum === "son" && !genel) liste = liste.slice(0, SON_SAYISI);
  return { liste, tokenler };
}

function gorunenKlasorler(tokenler) {
  if (S.gorunum === "cop") return ustCopKlasorleri().sort(adSirala);
  if (tokenler.length) return [...S.klasorler.values()].filter((k) => !k.silindiAt && tokenler.every((t) => k.ara.includes(t))).sort(adSirala);
  if (S.filtre.etiket || filtreAktifMi()) return [];
  if (S.gorunum === "klasor") return altKlasorler(S.konum);
  return [];
}

function etiketFiltresiniDoldur() {
  const sec = $("nt-etiket-filtre");
  const onceki = S.filtre.etiket;
  const tum = new Map();
  for (const m of S.notlar.values()) {
    if (m.silindiAt) continue;
    for (const e of m.etiketler) tum.set(katla(e), e);
  }
  sec.replaceChildren(el("option", { value: "", text: "Etiket" }));
  [...tum.values()]
    .sort((a, b) => a.localeCompare(b, "tr"))
    .forEach((e) => sec.append(el("option", { value: e, text: e })));
  sec.value = tum.has(katla(onceki)) ? onceki : "";
  if (!sec.value) S.filtre.etiket = "";
}

function filtreSecenekleriniKur() {
  $("nt-durum-filtre").replaceChildren(el("option", { value: "", text: "Durum" }), ...Object.entries(DURUMLAR).map(([k, v]) => el("option", { value: k, text: v.ad })));
  $("nt-tur-filtre").replaceChildren(el("option", { value: "", text: "Tür" }), ...Object.entries(TURLER).map(([k, v]) => el("option", { value: k, text: v.ad })));
  $("nt-sirala").replaceChildren(...Object.entries(SIRALAMA_AD).map(([k, v]) => el("option", { value: k, text: `Sırala: ${v}` })));
  $("nt-tur-sec").replaceChildren(...Object.entries(TURLER).map(([k, v]) => el("option", { value: k, text: v.ad })));
  $("nt-durum-sec").replaceChildren(...Object.entries(DURUMLAR).map(([k, v]) => el("option", { value: k, text: v.ad })));
  $("nt-sablon").replaceChildren(el("option", { value: "", text: "Şablon ekle…" }), ...Object.entries(Bicim.SABLONLAR).map(([k, v]) => el("option", { value: k, text: v.ad })));
}

function filtreleriTemizle() {
  S.filtre.durum = S.filtre.tur = S.filtre.etiket = S.filtre.arama = "";
  $("nt-durum-filtre").value = $("nt-tur-filtre").value = $("nt-etiket-filtre").value = $("nt-arama").value = "";
  $("nt-arama-temizle").hidden = true;
  S.gorunenSayi = SAYFA_BOYUTU;
  listeyiCiz();
}

/* ---- gezinme ---- */

function seciminiSifirla() {
  S.secim.clear();
}

function gorunumeGit(id) {
  S.gorunum = id;
  S.konum = null;
  S.filtre.arama = S.filtre.etiket = "";
  $("nt-arama").value = "";
  $("nt-arama-temizle").hidden = true;
  $("nt-etiket-filtre").value = "";
  S.gorunenSayi = SAYFA_BOYUTU;
  seciminiSifirla();
  navKapat();
  panelGoster(S.duz ? "editor" : "liste");
  listeyiCiz();
  $("nt-liste-pane").querySelector(".nt-liste-kaydirma").scrollTop = 0;
}

function klasoreGit(id) {
  if (!id || !klasorVarMi(id)) return gorunumeGit("tum");
  gorunumeGit("klasor");
  S.konum = id;
  for (const k of yolDizisi(id)) S.acik.add(k.id);
  listeyiCiz();
}

function panelGoster(p) {
  $("nt-duzen").dataset.panel = p;
}

function navAc(ac) {
  $("nt-duzen").classList.toggle("nt-nav-acik", ac);
  $("nt-nav-perde").hidden = !ac;
  $("nt-nav-btn").setAttribute("aria-expanded", String(ac));
}
const navKapat = () => navAc(false);

function odakAcKapa(ac = !S.odak) {
  S.odak = ac && !$("nt-editor").hidden;
  $("nt-duzen").classList.toggle("nt-odak", S.odak);
  $("nt-odak-btn").setAttribute("aria-pressed", String(S.odak));
}

function arayuzuSifirla() {
  S.notlar.clear();
  S.klasorler.clear();
  S.gorunum = "tum";
  S.konum = null;
  S.secim.clear();
  S.secimModu = false;
  menuKapat();
  S.duz = null;
  S.kirli = false;
  blobUrlleriniBirak();
  $("nt-liste").replaceChildren();
  $("nt-klasorler").replaceChildren();
  $("nt-agac").replaceChildren();
  $("nt-editor").hidden = true;
  $("nt-bos-editor").hidden = false;
  odakAcKapa(false);
  panelGoster("liste");
}

/* ---- sol gezinti: görünümler + klasör ağacı ---- */

function gorunumSayilari() {
  const s = { tum: 0, sabit: 0, arsiv: 0, cop: ustCopNotlari().length + ustCopKlasorleri().length };
  for (const m of S.notlar.values()) {
    if (m.silindiAt) continue;
    if (m.arsiv) s.arsiv++;
    else {
      s.tum++;
      if (m.sabit) s.sabit++;
    }
  }
  return s;
}

function gorunumleriCiz() {
  const say = gorunumSayilari();
  const yap = (g) => {
    const aktif = S.gorunum === g.id;
    const n = say[g.id];
    const b = el(
      "button",
      { type: "button", class: `nt-gorunum${aktif ? " nt-aktif" : ""}`, "aria-current": aktif ? "page" : null, onclick: () => gorunumeGit(g.id) },
      ikon(g.ikon),
      el("span", { class: "nt-gorunum-ad", text: g.ad }),
      n ? el("span", { class: "nt-sayi", text: String(n) }) : null
    );
    if (g.id === "tum") birakHedefiYap(b, null);
    return b;
  };
  $("nt-gorunumler").replaceChildren(...GORUNUMLER.map(yap));
  $("nt-nav-alt").replaceChildren(...GORUNUMLER_ALT.map(yap));
}

function klasorMenuOgeleri(k) {
  return [
    { ad: "Adı ve simgesi…", islem: () => klasorDuzenle(k) },
    { ad: "Alt klasör ekle…", islem: () => klasorOlustur(k.id) },
    { ad: k.sabit ? "Sabitlemeyi kaldır" : "Sabitle", islem: () => kayitSabitle(k) },
    { ad: "Başka klasöre taşı…", islem: () => tasimaDiyalogu(k) },
    { ad: "Dışa aktar…", islem: () => disaAktarAc("klasor", k) },
    { ad: "Çöpe at", islem: () => klasorCopeAt(k), tehlike: true },
  ];
}

function menuDugmesi(etiket, ogeler, sinif = "nt-menu-ac") {
  const dugme = el("button", { type: "button", class: sinif, "aria-label": etiket, "aria-haspopup": "menu", "aria-expanded": "false" }, ikon("more"));
  dugme.addEventListener("click", (o) => {
    o.stopPropagation();
    if (S.menu && S.menuBagla === dugme) return menuKapat();
    menuAc(dugme, typeof ogeler === "function" ? ogeler() : ogeler);
  });
  return dugme;
}

function suruklenebilirYap(dugum, tur, id) {
  dugum.draggable = true;
  dugum.addEventListener("dragstart", (o) => {
    S.surukle = { tur, id };
    o.dataTransfer.setData("text/plain", id);
    o.dataTransfer.effectAllowed = "move";
    dugum.classList.add("nt-suruklenen");
  });
  dugum.addEventListener("dragend", () => {
    S.surukle = null;
    dugum.classList.remove("nt-suruklenen");
  });
}

function agacCiz() {
  const kap = $("nt-agac");
  const sayim = sayimlariHesapla();
  kap.replaceChildren();

  const yurut = (ustId, derinlik) => {
    for (const k of altKlasorler(ustId)) {
      const alt = altKlasorler(k.id);
      const acik = S.acik.has(k.id);
      const aktif = S.gorunum === "klasor" && S.konum === k.id;
      const n = sayim.notSayisi.get(k.id) || 0;

      const ok = el(
        "button",
        {
          type: "button",
          class: "nt-agac-ok",
          tabindex: alt.length ? null : "-1",
          disabled: alt.length ? null : true,
          "aria-label": `${k.ad} ${acik ? "daralt" : "genişlet"}`,
          onclick: (o) => {
            o.stopPropagation();
            if (acik) S.acik.delete(k.id);
            else S.acik.add(k.id);
            agacCiz();
          },
        },
        ikon("chevron-right")
      );
      const ana = el(
        "button",
        {
          type: "button",
          class: "nt-agac-ana",
          "aria-current": aktif ? "page" : null,
          onclick: () => {
            if (alt.length) S.acik.add(k.id);
            klasoreGit(k.id);
          },
        },
        el("span", { class: "nt-agac-simge", "aria-hidden": "true", text: k.simge }),
        el("span", { class: "nt-agac-ad", text: k.ad }),
        k.sabit ? el("span", { class: "nt-agac-sabit", title: "Sabitlendi" }, ikon("pin")) : null,
        n ? el("span", { class: "nt-sayi", text: String(n) }) : null
      );
      const satir = el(
        "div",
        {
          class: `nt-agac-oge nt-d${Math.min(derinlik, 6)}${aktif ? " nt-aktif" : ""}${acik ? " nt-acik" : ""}`,
          role: "treeitem",
          "aria-expanded": alt.length ? String(acik) : null,
          "aria-selected": String(aktif),
          data: { id: k.id },
        },
        ok,
        ana,
        el("span", { class: "nt-mk" }, menuDugmesi(`${k.ad} klasör işlemleri`, () => klasorMenuOgeleri(k)))
      );
      suruklenebilirYap(satir, "klasor", k.id);
      birakHedefiYap(satir, k.id);
      kap.append(satir);
      if (acik) yurut(k.id, derinlik + 1);
    }
  };
  yurut(null, 0);
  if (!kap.children.length) {
    kap.append(el("p", { class: "nt-agac-bos", text: "Henüz klasör yok. Ders, proje ya da etkinlik için bir klasör aç." }));
  }
}

/* ---- orta panel: başlık, yol, klasör satırları, liste ---- */

function listeBasligi() {
  if (S.filtre.arama) return `“${S.filtre.arama}” için sonuçlar`;
  if (S.filtre.etiket) return `Etiket: ${S.filtre.etiket}`;
  if (S.gorunum === "klasor") {
    const k = S.klasorler.get(S.konum);
    return k ? `${k.simge} ${k.ad}` : "Klasör";
  }
  return [...GORUNUMLER, ...GORUNUMLER_ALT].find((g) => g.id === S.gorunum)?.ad || "Notlar";
}

function yolCiz() {
  const nav = $("nt-yol");
  nav.replaceChildren();
  let goster = false;

  if (S.gorunum === "cop" && !genelAramaMi()) {
    goster = true;
    nav.append(el("span", { class: "nt-yol-bilgi", text: "Çöpteki her şey sen silene kadar durur." }));
    if (ustCopNotlari().length || ustCopKlasorleri().length) {
      nav.append(el("button", { type: "button", class: "nt-btn nt-btn-kucuk nt-btn-tehlike nt-yol-eylem", text: "Çöpü boşalt", onclick: copuBosalt }));
    }
  } else if (S.gorunum === "klasor" && !genelAramaMi()) {
    goster = true;
    nav.append(el("button", { type: "button", class: "nt-yol-oge", text: "Tüm notlar", onclick: () => gorunumeGit("tum") }));
    const yol = yolDizisi(S.konum);
    yol.forEach((k, i) => {
      const son = i === yol.length - 1;
      nav.append(
        el("span", { class: "nt-yol-ayrac", "aria-hidden": "true" }, ikon("chevron-right")),
        el("button", { type: "button", class: `nt-yol-oge${son ? " nt-aktif" : ""}`, "aria-current": son ? "page" : null, text: k.ad, onclick: () => klasoreGit(k.id) })
      );
    });
    nav.append(el("button", { type: "button", class: "nt-btn nt-btn-kucuk nt-yol-eylem", onclick: () => klasorOlustur(S.konum) }, ikon("folder-plus"), "Alt klasör"));
  } else if (S.gorunum === "arsiv" && !genelAramaMi()) {
    goster = true;
    nav.append(el("span", { class: "nt-yol-bilgi", text: "Bitirdiğin ders ve projeleri buraya kaldır; aramada yine bulunur." }));
  }
  nav.hidden = !goster;
}

function klasorSatiri(k, sayim, tokenler, copta) {
  const ad = el("span", { class: "nt-klasor-ad" });
  vurguluMetin(ad, k.ad, tokenler);
  const alt = sayim.altSayisi.get(k.id) || 0;
  const n = sayim.notSayisi.get(k.id) || 0;
  const bilgi = copta ? "" : [alt ? `${alt} klasör` : "", `${n} not`].filter(Boolean).join(" · ");
  const ana = el(
    "button",
    { type: "button", class: "nt-klasor-ana", disabled: copta ? true : null, "aria-label": `${k.ad} klasörünü aç`, onclick: () => klasoreGit(k.id) },
    el("span", { class: "nt-klasor-simge", "aria-hidden": "true", text: k.simge }),
    ad,
    bilgi ? el("span", { class: "nt-klasor-bilgi", text: bilgi }) : null
  );
  const kart = el("div", { class: `nt-klasor${k.sabit ? " nt-sabit" : ""}`, data: { id: k.id } }, ana);
  if (copta) {
    kart.append(
      el("span", { class: "nt-klasor-cop" },
        el("button", { type: "button", class: "nt-btn nt-btn-kucuk", text: "Geri al", onclick: () => klasorGeriAl(k) }),
        el("button", { type: "button", class: "nt-btn nt-btn-kucuk nt-btn-tehlike", text: "Kalıcı sil", onclick: () => klasorKaliciSilOnayli(k) })
      )
    );
    return kart;
  }
  suruklenebilirYap(kart, "klasor", k.id);
  birakHedefiYap(kart, k.id);
  return kart;
}

function notMenuOgeleri(m) {
  return [
    { ad: "Yazıya dönüştür", islem: () => yaziyaDonustur(m) },
    { ad: m.sabit ? "Sabitlemeyi kaldır" : "Sabitle", islem: () => kayitSabitle(m) },
    { ad: m.arsiv ? "Arşivden çıkar" : "Arşivle", islem: () => arsivle(m) },
    { ad: "Taşı…", islem: () => tasimaDiyalogu(m) },
    { ad: "Dışa aktar…", islem: () => disaAktarAc("bu", m) },
    { ad: "Çöpe at", islem: () => copeAt(m), tehlike: true },
  ];
}

function satirCiz(m, tokenler) {
  const secili = S.duz?.id === m.id;
  const secimde = S.secim.has(m.id);
  const baslik = el("h3", { class: "nt-satir-baslik" });
  vurguluMetin(baslik, m.baslik || "Başlıksız not", tokenler);

  const ozet = el("p", { class: "nt-ozet" });
  vurguluMetin(ozet, ozetUret(m, tokenler), tokenler);

  const rozetler = el("div", { class: "nt-satir-alt" });
  rozetler.append(el("span", { class: `nt-rozet nt-tur-${m.kategori}`, text: TURLER[m.kategori].ad }));
  if (m.durum !== "devam") rozetler.append(el("span", { class: `nt-durum nt-durum-${m.durum}`, text: DURUMLAR[m.durum].ad, title: DURUMLAR[m.durum].ipucu }));
  if (m.tarih) rozetler.append(el("span", { class: "nt-meta-oge" }, ikon("calendar"), konuTarihiYaz(m.tarih)));
  const klasorAdi = (genelAramaMi() || S.gorunum !== "klasor") && notKlasoru(m) ? yolMetni(notKlasoru(m)) : "";
  if (klasorAdi) rozetler.append(el("span", { class: "nt-meta-oge nt-meta-klasor", title: klasorAdi }, ikon("folder"), klasorAdi));
  for (const e of m.etiketler.slice(0, 3)) {
    const r = el("button", {
      type: "button",
      class: "nt-etiket",
      title: "Bu etikete göre filtrele",
      onclick: (o) => {
        o.stopPropagation();
        S.filtre.etiket = e;
        $("nt-etiket-filtre").value = e;
        S.gorunenSayi = SAYFA_BOYUTU;
        listeyiCiz();
      },
    });
    vurguluMetin(r, `#${e}`, tokenler.map((t) => t));
    rozetler.append(r);
  }
  if (m.etiketler.length > 3) rozetler.append(el("span", { class: "nt-meta-oge", text: `+${m.etiketler.length - 3}` }));
  if (m.alintilar.length) rozetler.append(el("span", { class: "nt-meta-oge", title: `${m.alintilar.length} alıntı` }, ikon("quote"), String(m.alintilar.length)));
  if (m.ekler.length) rozetler.append(el("span", { class: "nt-meta-oge", title: `${m.ekler.length} ek` }, ikon("paperclip"), String(m.ekler.length)));

  const ust = el("div", { class: "nt-satir-ust" }, m.sabit ? el("span", { class: "nt-satir-sabit", title: "Sabitlendi" }, ikon("pin")) : null, baslik, el("time", { class: "nt-satir-zaman", datetime: m.guncelleme, text: zamanYaz(m.guncelleme), title: `Son güncelleme: ${tarihYaz(m.guncelleme)}` }));

  const govde = el("div", { class: "nt-satir-govde" }, ust, ozet.textContent ? ozet : null, rozetler);

  let ana;
  if (m.silindiAt) {
    ana = el("div", { class: "nt-satir-ana nt-satir-cop" }, govde,
      el("div", { class: "nt-satir-cop-eylem" },
        el("button", { type: "button", class: "nt-btn nt-btn-kucuk", text: "Geri al", onclick: () => copTenGeriAl(m) }),
        el("button", { type: "button", class: "nt-btn nt-btn-kucuk nt-btn-tehlike", text: "Kalıcı sil", onclick: () => kaliciSilOnayli(m) })
      )
    );
  } else {
    ana = el("button", { type: "button", class: "nt-satir-ana", "aria-pressed": S.secimModu ? String(secimde) : null, "aria-current": !S.secimModu && secili ? "true" : null }, govde);
    ana.addEventListener("click", () => (S.secimModu ? secimiDegistir(m.id) : duzenleyiciAc(m)));
  }

  const kart = el("article", { class: `nt-satir nt-tur-${m.kategori}${secili ? " nt-secili" : ""}${secimde ? " nt-secimde" : ""}${m.silindiAt ? " nt-copte" : ""}`, data: { id: m.id } });
  if (S.secimModu && !m.silindiAt) {
    const kutu = el("input", { type: "checkbox", class: "nt-satir-kutu", "aria-label": `${m.baslik || "Başlıksız not"} seç`, tabindex: "-1" });
    kutu.checked = secimde;
    kutu.addEventListener("click", (o) => o.stopPropagation());
    kutu.addEventListener("change", () => secimiDegistir(m.id));
    kart.append(kutu);
  }
  kart.append(ana);
  if (!m.silindiAt && !S.secimModu) {
    kart.append(el("span", { class: "nt-mk nt-satir-menu" }, menuDugmesi(`${m.baslik || "Başlıksız not"} işlemleri`, () => notMenuOgeleri(S.notlar.get(m.id) || m))));
    suruklenebilirYap(kart, "not", m.id);
  }
  return kart;
}

function bosDurumCiz(cop) {
  const kutu = el("div", { class: "nt-bos" });
  const hic = !S.notlar.size && !S.klasorler.size;
  let baslik = "Bu görünümde not yok.";
  let aciklama = "";
  const dugmeler = [];

  if (filtreAktifMi()) {
    baslik = S.filtre.arama ? `“${S.filtre.arama}” ile eşleşen not yok.` : "Bu filtrelere uyan not yok.";
    aciklama = "Başka bir sözcük dene ya da filtreleri temizle.";
    dugmeler.push(el("button", { type: "button", class: "nt-btn", text: "Filtreleri temizle", onclick: filtreleriTemizle }));
  } else if (cop) {
    baslik = "Çöp kutusu boş.";
  } else if (S.gorunum === "arsiv") {
    baslik = "Arşiv boş.";
    aciklama = "Bitirdiğin ders ve projeleri bir notun ⋯ menüsünden arşive kaldır.";
  } else if (S.gorunum === "sabit") {
    baslik = "Sabitlenmiş not yok.";
    aciklama = "Sık döndüğün notları ⋯ menüsünden sabitle; burada ve listenin başında durur.";
  } else if (hic) {
    baslik = "İlk notunu yaz.";
    aciklama = "Ders, sunum, proje ya da etkinlik için bir şablonla başla; ya da aklına geleni hızlıca not et.";
    dugmeler.push(el("button", { type: "button", class: "nt-btn nt-btn-birincil", onclick: hizliNot }, ikon("zap"), "Hızlı not"), el("button", { type: "button", class: "nt-btn", text: "Şablon seç", onclick: (o) => yeniNotMenusu(o.currentTarget) }));
  } else if (S.gorunum === "klasor") {
    baslik = "Bu klasör boş.";
    aciklama = "Buraya not ekle ya da bir alt klasör aç.";
    dugmeler.push(el("button", { type: "button", class: "nt-btn nt-btn-birincil", onclick: () => yeniNot("") }, ikon("plus"), "Yeni not"));
  }
  kutu.append(el("p", { class: "nt-bos-baslik", text: baslik }));
  if (aciklama) kutu.append(el("p", { class: "muted", text: aciklama }));
  if (dugmeler.length) kutu.append(el("div", { class: "nt-bos-eylem" }, dugmeler));
  return kutu;
}

function listeyiCiz() {
  gorunumleriCiz();
  agacCiz();

  const { liste, tokenler } = filtrelenmisNotlar();
  const sayim = sayimlariHesapla();
  const klasorler = gorunenKlasorler(tokenler);
  const cop = S.gorunum === "cop";

  for (const id of [...S.secim]) if (!liste.some((m) => m.id === id)) S.secim.delete(id);

  $("nt-liste-baslik").textContent = listeBasligi();
  const parcalar = [];
  if (klasorler.length) parcalar.push(`${klasorler.length} klasör`);
  parcalar.push(`${liste.length} ${S.filtre.arama ? "sonuç" : "not"}`);
  $("nt-sayac").textContent = parcalar.join(" · ");
  yolCiz();

  const kk = $("nt-klasorler");
  kk.replaceChildren(...klasorler.map((k) => klasorSatiri(k, sayim, tokenler, cop)));
  kk.hidden = !klasorler.length;

  const kap = $("nt-liste");
  kap.replaceChildren();
  if (!liste.length) {
    if (!klasorler.length) kap.append(bosDurumCiz(cop));
  } else {
    for (const m of liste.slice(0, S.gorunenSayi)) kap.append(satirCiz(m, tokenler));
    if (liste.length > S.gorunenSayi) {
      kap.append(
        el("button", {
          type: "button",
          class: "nt-btn nt-daha",
          text: `${liste.length - S.gorunenSayi} not daha göster`,
          onclick: () => {
            S.gorunenSayi += SAYFA_BOYUTU;
            listeyiCiz();
          },
        })
      );
    }
  }
  secimCubuguGuncelle(liste);
  $("nt-sec-btn").hidden = cop;
}

/* ---- çoklu seçim ---- */

function secimiDegistir(id) {
  if (S.secim.has(id)) S.secim.delete(id);
  else S.secim.add(id);
  const satir = $("nt-liste").querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (satir) {
    const secimde = S.secim.has(id);
    satir.classList.toggle("nt-secimde", secimde);
    const k = satir.querySelector(".nt-satir-kutu");
    if (k) k.checked = secimde;
    satir.querySelector(".nt-satir-ana")?.setAttribute("aria-pressed", String(secimde));
  }
  secimCubuguGuncelle();
}

function secimModuAyarla(ac) {
  S.secimModu = ac;
  if (!ac) S.secim.clear();
  listeyiCiz();
}

function secimCubuguGuncelle(liste) {
  const cubuk = $("nt-secim-cubugu");
  cubuk.hidden = !S.secimModu;
  const sec = $("nt-sec-btn");
  sec.setAttribute("aria-pressed", String(S.secimModu));
  sec.textContent = S.secimModu ? "Bitti" : "Seç";
  const n = S.secim.size;
  $("nt-secim-sayi").textContent = n ? `${n} not seçildi` : "Not seçmek için satırlara dokun";
  for (const id of ["nt-secim-aktar", "nt-secim-tasi", "nt-secim-durum", "nt-secim-cop"]) $(id).disabled = !n;
  if (liste) $("nt-secim-hepsi").dataset.toplam = String(liste.length);
}

function gorunenleriSec() {
  const { liste } = filtrelenmisNotlar();
  const hepsiSecili = liste.length && liste.every((m) => S.secim.has(m.id));
  if (hepsiSecili) S.secim.clear();
  else for (const m of liste) S.secim.add(m.id);
  listeyiCiz();
}

const secilenNotlar = () => [...S.secim].map((id) => S.notlar.get(id)).filter(Boolean);

async function topluTasi() {
  const notlar = secilenNotlar();
  if (!notlar.length) return;
  const sec = el("select", { "aria-label": "Hedef klasör" });
  klasorSecenekleriDoldur(sec, { secili: null, kok: "Ana klasör (kök)" });
  const ok = await diyalog({
    baslik: `${notlar.length} not nereye taşınsın?`,
    tamam: "Taşı",
    govde: el("div", { class: "form-field" }, el("label", { text: "Hedef klasör" }), sec),
  });
  if (!ok) return;
  for (const m of notlar) await hizliGuncelle(S.notlar.get(m.id) || m, { klasor: sec.value || null });
  bildir(`${notlar.length} not ${sec.value ? `“${yolMetni(sec.value)}” klasörüne` : "ana klasöre"} taşındı.`);
}

async function topluDurum(d) {
  const notlar = secilenNotlar();
  for (const m of notlar) await hizliGuncelle(S.notlar.get(m.id) || m, { durum: d });
  bildir(`${notlar.length} not “${DURUMLAR[d].ad}” yapıldı.`);
}

async function topluCope() {
  const notlar = secilenNotlar();
  if (!notlar.length) return;
  if (!window.confirm(`${notlar.length} not çöp kutusuna taşınsın mı?\n\nÇöptekiler sen silene kadar durur; istediğin an geri alabilirsin.`)) return;
  if (S.duz && S.secim.has(S.duz.id)) {
    S.kirli = false;
    await duzenleyiciKapat();
  }
  try {
    await topluSilindiAyarla(notlar, new Date().toISOString());
  } catch (h) {
    return bildir("Çöpe taşınamadı: " + (h.message || h), "error");
  }
  S.secim.clear();
  bildir(`${notlar.length} not çöpe taşındı.`);
  etiketFiltresiniDoldur();
  listeyiCiz();
}

async function arsivle(m) {
  const yeni = await hizliGuncelle(m, { arsiv: !m.arsiv });
  if (yeni) bildir(yeni.arsiv ? `“${yeni.baslik || "Başlıksız not"}” arşive kaldırıldı.` : `“${yeni.baslik || "Başlıksız not"}” arşivden çıkarıldı.`);
}

/* ---- menüler (position: fixed; kaydırma alanlarında kırpılmaz) ---- */

function menuKapat() {
  S.menuBagla?.setAttribute("aria-expanded", "false");
  S.menu?.remove();
  S.menu = null;
  S.menuBagla = null;
}

function menuAc(bagla, ogeler) {
  menuKapat();
  const menu = el(
    "div",
    { class: "nt-menu", role: "menu" },
    ogeler.map((o) =>
      el("button", {
        type: "button",
        role: "menuitem",
        class: o.tehlike ? "nt-menu-tehlike" : o.ayrac ? "nt-menu-ayrac-oge" : "",
        text: o.ad,
        onclick: () => {
          menuKapat();
          bagla.focus?.({ preventScroll: true });
          o.islem();
        },
      })
    )
  );
  $("notlar").append(menu);
  const r = bagla.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let ust = r.bottom + 4;
  if (ust + mr.height > window.innerHeight - 8) ust = Math.max(8, r.top - mr.height - 4);
  const sol = Math.min(Math.max(8, r.right - mr.width), window.innerWidth - mr.width - 8);
  menu.style.top = `${ust}px`;
  menu.style.left = `${sol}px`;
  S.menu = menu;
  S.menuBagla = bagla;
  bagla.setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
  menu.addEventListener("keydown", (o) => {
    const dugmeler = [...menu.querySelectorAll("button")];
    const i = dugmeler.indexOf(document.activeElement);
    if (o.key === "ArrowDown") {
      o.preventDefault();
      dugmeler[(i + 1) % dugmeler.length].focus();
    } else if (o.key === "ArrowUp") {
      o.preventDefault();
      dugmeler[(i - 1 + dugmeler.length) % dugmeler.length].focus();
    } else if (o.key === "Escape") {
      o.stopPropagation();
      const b = S.menuBagla;
      menuKapat();
      b?.focus();
    } else if (o.key === "Tab") menuKapat();
  });
}

function yeniNotMenusu(bagla) {
  menuAc(bagla, [
    { ad: "Boş not", islem: () => yeniNot("") },
    ...Object.entries(Bicim.SABLONLAR).map(([k, v]) => ({ ad: v.ad, islem: () => yeniNot(k) })),
  ]);
}

function dahaMenusu(bagla) {
  menuAc(bagla, [
    { ad: "İçeri aktar…", islem: () => iceAktarAc().catch((h) => bildir("İçeri aktarma açılamadı: " + (h.message || h), "error")) },
    { ad: "Kasa ve yedek…", islem: () => $("nt-kasa-dlg").showModal() },
    { ad: "Notları yeniden yükle", islem: () => notlariYukle().catch((h) => bildir("Yenilenemedi: " + h.message, "error")) },
    { ad: "Kasayı kilitle", islem: () => kilitle("Kasa kilitlendi; bu cihazdaki anahtar silindi.") },
  ]);
}

function editorMenusu(bagla) {
  const m = S.notlar.get(S.duz?.id);
  if (!m) return;
  menuAc(bagla, [
    { ad: "Yazıya dönüştür", islem: async () => {
        if (S.kirli) await kaydet({ sessiz: true });
        yaziyaDonustur(S.notlar.get(S.duz.id) || S.duz);
      } },
    { ad: m.sabit ? "Sabitlemeyi kaldır" : "Sabitle", islem: () => kayitSabitle(S.notlar.get(S.duz.id) || m) },
    { ad: m.arsiv ? "Arşivden çıkar" : "Arşivle", islem: () => arsivle(S.notlar.get(S.duz.id) || m) },
    { ad: "Dışa aktar…", islem: async () => {
        if (S.kirli) await kaydet({ sessiz: true });
        disaAktarAc("bu", S.notlar.get(S.duz.id) || m);
      } },
    { ad: "Çöpe at", tehlike: true, islem: async () => {
        if (!window.confirm("Bu not çöp kutusuna taşınsın mı? Çöpteki notlar sen silene kadar durur; istediğin an geri alabilirsin.")) return;
        const g = S.notlar.get(S.duz.id) || m;
        S.kirli = false;
        await copeAt(g);
        await duzenleyiciKapat();
      } },
  ]);
}

/* ---- sürükle-bırak taşıma ---- */

function birakHedefiYap(dugum, hedefId) {
  dugum.addEventListener("dragover", (o) => {
    if (!S.surukle || S.surukle.id === hedefId) return;
    o.preventDefault();
    dugum.classList.add("nt-birak-hedef");
  });
  dugum.addEventListener("dragleave", () => dugum.classList.remove("nt-birak-hedef"));
  dugum.addEventListener("drop", async (o) => {
    o.preventDefault();
    dugum.classList.remove("nt-birak-hedef");
    const s = S.surukle;
    S.surukle = null;
    if (!s || s.id === hedefId) return;
    if (s.tur === "not") {
      const m = S.notlar.get(s.id);
      if (m) await notuTasi(m, hedefId);
    } else {
      const k = S.klasorler.get(s.id);
      if (k) await klasoruTasi(k, hedefId);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 7) Hızlı işlemler                                                  */
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

async function copeAt(m) {
  const ts = new Date().toISOString();
  const { data, error } = await supabase.from("notlar").update({ silindi_at: ts }).eq("id", m.id).select("rev, updated_at");
  if (error || !data?.length) return bildir("Çöpe atılamadı: " + (error?.message || "not bulunamadı"), "error");
  haritayaIsle({ ...m, rev: data[0].rev, guncelleme: data[0].updated_at, silindiAt: ts });
  bildir(`“${m.baslik || "Başlıksız not"}” çöpe atıldı. Sen silene kadar çöp kutusunda durur; istediğin an geri alabilirsin.`);
  etiketFiltresiniDoldur();
  listeyiCiz();
}

async function copTenGeriAl(m) {
  const { data, error } = await supabase.from("notlar").update({ silindi_at: null }).eq("id", m.id).select("rev, updated_at");
  if (error || !data?.length) return bildir("Geri alınamadı: " + (error?.message || "not bulunamadı"), "error");
  haritayaIsle({ ...m, rev: data[0].rev, guncelleme: data[0].updated_at, silindiAt: null });
  const klasorGitti = m.klasor && !klasorVarMi(m.klasor);
  bildir(klasorGitti ? "Not geri alındı. Klasörü çöpte olduğu için ana klasörde görünüyor; istersen taşıyabilirsin." : "Not geri alındı.");
  etiketFiltresiniDoldur();
  listeyiCiz();
}

function kaliciSilOnayli(m) {
  if (!window.confirm(`“${m.baslik || "Başlıksız not"}” ve ${m.ekler.length} eki kalıcı olarak silinecek. Bu geri alınamaz.`)) return;
  kaliciSil(m);
}

/** Satırları önce siler, sonra R2'deki ekleri (kalan olursa yetim süpürmesi temizler). */
async function kayitlariKaliciSil(klasorler, notlar) {
  const hepsi = [...klasorler, ...notlar];
  for (let i = 0; i < hepsi.length; i += 100) {
    const parca = hepsi.slice(i, i + 100);
    const { error } = await supabase.from("notlar").delete().in("id", parca.map((x) => x.id));
    if (error) throw error;
    for (const x of parca) (x.tur === "klasor" ? S.klasorler : S.notlar).delete(x.id);
  }
  for (const n of notlar) for (const e of n.ekler) await ekiTamamenSil(e.anahtar);
}

async function kaliciSil(m) {
  try {
    await kayitlariKaliciSil([], [m]);
    bildir("Not kalıcı olarak silindi.");
  } catch (h) {
    bildir("Silinemedi: " + (h.message || h), "error");
  }
  etiketFiltresiniDoldur();
  listeyiCiz();
}

/** Klasör + notlarını TEK zaman damgasıyla çöpe atar / geri alır (ts = null). */
async function topluSilindiAyarla(kayitlar, ts) {
  for (let i = 0; i < kayitlar.length; i += 100) {
    const parca = kayitlar.slice(i, i + 100);
    const { data, error } = await supabase
      .from("notlar")
      .update({ silindi_at: ts })
      .in("id", parca.map((x) => x.id))
      .select("id, rev, updated_at");
    if (error) throw error;
    for (const satir of data) {
      const m = S.notlar.get(satir.id) || S.klasorler.get(satir.id);
      if (m) haritayaIsle({ ...m, rev: satir.rev, guncelleme: satir.updated_at, silindiAt: ts });
    }
  }
}

async function copuBosalt() {
  const klasorler = [...S.klasorler.values()].filter((k) => k.silindiAt);
  const notlar = [...S.notlar.values()].filter((m) => m.silindiAt);
  if (!klasorler.length && !notlar.length) return;
  if (!window.confirm(`Çöp kutusundaki ${notlar.length} not ve ${klasorler.length} klasör, ekleriyle birlikte KALICI olarak silinecek. Bu geri alınamaz.`)) return;
  try {
    await kayitlariKaliciSil(klasorler, notlar);
    bildir("Çöp kutusu boşaltıldı.");
  } catch (h) {
    bildir("Boşaltılamadı: " + (h.message || h), "error");
  }
  etiketFiltresiniDoldur();
  listeyiCiz();
}

/* ------------------------------------------------------------------ */
/* 7b) Klasör işlemleri + diyaloglar                                   */
/* ------------------------------------------------------------------ */

/** Genel amaçlı <dialog>. Onaylanırsa true döner. */
function diyalog({ baslik, govde, tamam = "Kaydet", dogrula = null }) {
  return new Promise((coz) => {
    const d = el("dialog", { class: "nt-diyalog" });
    const form = el(
      "form",
      { class: "nt-diyalog-form", novalidate: true },
      el("h3", { text: baslik }),
      govde,
      el(
        "div",
        { class: "nt-diyalog-eylem" },
        el("button", { type: "button", class: "btn-secondary csp-w-auto", text: "Vazgeç", onclick: () => d.close("iptal") }),
        el("button", { type: "submit", class: "btn-primary csp-w-auto", text: tamam })
      )
    );
    form.addEventListener("submit", (o) => {
      o.preventDefault();
      if (dogrula && !dogrula()) return;
      d.close("tamam");
    });
    d.addEventListener("close", () => {
      const sonuc = d.returnValue === "tamam";
      d.remove();
      coz(sonuc);
    });
    d.append(form);
    $("notlar").append(d);
    d.showModal();
    d.querySelector("input[type=text], select")?.focus();
  });
}

async function klasorDiyalogu({ baslik, ad = "", simge = "📁", tamam }) {
  const girdi = el("input", { type: "text", maxlength: "80", autocomplete: "off", placeholder: "Klasör adı", "aria-label": "Klasör adı" });
  girdi.value = ad;
  let secili = simge;
  const izgara = el(
    "div",
    { class: "nt-simge-izgara", role: "radiogroup", "aria-label": "Klasör simgesi" },
    SIMGELER.map((s) => {
      const r = el("input", { type: "radio", name: "nt-simge", value: s });
      r.checked = s === secili;
      r.addEventListener("change", () => (secili = s));
      return el("label", { class: "nt-simge-secenek", title: s }, r, el("span", { text: s }));
    })
  );
  const tamamMi = await diyalog({
    baslik,
    tamam,
    govde: el("div", { class: "form-field" }, el("label", { text: "Ad" }), girdi, izgara),
    dogrula: () => {
      if (girdi.value.trim()) return true;
      girdi.focus();
      return false;
    },
  });
  return tamamMi ? { ad: girdi.value.trim().replace(/\s+/g, " ").slice(0, 80), simge: secili } : null;
}

/** <select>'i girintili klasör ağacıyla doldurur. haric: bu klasör ve altındakiler listelenmez. */
function klasorSecenekleriDoldur(sec, { haric = null, secili = null, kok = "🏠 Ana klasör (kök)" } = {}) {
  sec.replaceChildren(el("option", { value: "", text: kok }));
  const yurut = (ustId, derinlik) => {
    for (const k of altKlasorler(ustId)) {
      if (haric && torunMu(k.id, haric)) continue;
      const girinti = "   ".repeat(derinlik) + (derinlik ? "└ " : "");
      sec.append(el("option", { value: k.id, text: `${girinti}${k.simge} ${k.ad}` }));
      yurut(k.id, derinlik + 1);
    }
  };
  yurut(null, 0);
  sec.value = secili && [...sec.options].some((o) => o.value === secili) ? secili : "";
}

async function tasimaDiyalogu(oge) {
  const klasorMu = oge.tur === "klasor";
  const sec = el("select", { "aria-label": "Hedef klasör" });
  klasorSecenekleriDoldur(sec, { haric: klasorMu ? oge.id : null, secili: klasorMu ? klasorUstu(oge) : notKlasoru(oge) });
  const ok = await diyalog({
    baslik: `“${klasorMu ? oge.ad : oge.baslik || "Başlıksız not"}” nereye taşınsın?`,
    tamam: "Taşı",
    govde: el("div", { class: "form-field" }, el("label", { text: "Hedef klasör" }), sec),
  });
  if (!ok) return;
  if (klasorMu) await klasoruTasi(oge, sec.value || null);
  else await notuTasi(oge, sec.value || null);
}

async function notuTasi(m, hedefId) {
  if ((m.klasor || null) === (hedefId || null)) return;
  const yeni = await hizliGuncelle(m, { klasor: hedefId || null });
  if (yeni) bildir(`“${yeni.baslik || "Başlıksız not"}” ${hedefId ? `“${yolMetni(hedefId)}” klasörüne` : "ana klasöre"} taşındı.`);
}

async function klasoruTasi(k, hedefId) {
  if (hedefId && torunMu(hedefId, k.id)) return bildir("Bir klasör kendi içine taşınamaz.", "warning");
  if ((klasorUstu(k) || null) === (hedefId || null)) return;
  const yeni = await hizliGuncelle(k, { ust: hedefId || null });
  if (yeni) bildir(`“${yeni.ad}” ${hedefId ? `“${yolMetni(hedefId)}” içine` : "ana klasöre"} taşındı.`);
}

async function kayitSabitle(m) {
  await hizliGuncelle(m, { sabit: !m.sabit });
}

async function klasorOlustur(ustId = S.konum) {
  const ust = ustId ? S.klasorler.get(ustId) : null;
  const sonuc = await klasorDiyalogu({ baslik: ust ? `“${ust.ad}” içine yeni klasör` : "Yeni klasör", tamam: "Oluştur" });
  if (!sonuc) return;
  const m = klasorModeli(crypto.randomUUID(), null, { ad: sonuc.ad, simge: sonuc.simge, ust: ust ? ust.id : null });
  try {
    haritayaIsle(await modeliKaydet(m, true));
    bildir(`“${sonuc.ad}” klasörü oluşturuldu.`);
    listeyiCiz();
  } catch (h) {
    console.error(h);
    bildir("Klasör oluşturulamadı: " + (h.message || h), "error");
  }
}

async function klasorDuzenle(k) {
  const sonuc = await klasorDiyalogu({ baslik: "Klasörü düzenle", ad: k.ad, simge: k.simge, tamam: "Kaydet" });
  if (sonuc) await hizliGuncelle(k, { ad: sonuc.ad, simge: sonuc.simge });
}

async function klasorCopeAt(k) {
  const { klasorler, notlar } = altAgac(k);
  const ozet =
    `“${k.ad}” klasörü` +
    (klasorler.length > 1 ? `, içindeki ${klasorler.length - 1} alt klasör` : "") +
    (notlar.length ? ` ve ${notlar.length} not` : "");
  if (!window.confirm(`${ozet} çöp kutusuna taşınsın mı?\n\nÇöp kutusundakiler sen silene kadar durur; istediğin an geri alabilirsin.`)) return;

  const ustId = klasorUstu(k);
  if (S.duz && notlar.some((n) => n.id === S.duz.id)) await duzenleyiciKapat();
  try {
    await topluSilindiAyarla([...klasorler, ...notlar], new Date().toISOString());
  } catch (h) {
    console.error(h);
    return bildir("Çöpe taşınamadı: " + (h.message || h), "error");
  }
  if (S.gorunum === "klasor" && klasorler.some((x) => x.id === S.konum)) {
    if (ustId) S.konum = ustId;
    else {
      S.gorunum = "tum";
      S.konum = null;
    }
  }
  bildir(`“${k.ad}” çöpe taşındı. Sen silene kadar durur.`);
  etiketFiltresiniDoldur();
  listeyiCiz();
}

async function klasorGeriAl(k) {
  const { klasorler, notlar } = altAgac(k, k.silindiAt);
  try {
    await topluSilindiAyarla([...klasorler, ...notlar], null);
  } catch (h) {
    return bildir("Geri alınamadı: " + (h.message || h), "error");
  }
  bildir(`“${k.ad}” klasörü içindekilerle birlikte geri alındı.`);
  etiketFiltresiniDoldur();
  listeyiCiz();
}

async function klasorKaliciSilOnayli(k) {
  const { klasorler, notlar } = altAgac(k, k.silindiAt);
  if (!window.confirm(`“${k.ad}” klasörü, ${klasorler.length - 1} alt klasörü ve ${notlar.length} notu ekleriyle birlikte KALICI olarak silinecek. Bu geri alınamaz.`)) return;
  try {
    await kayitlariKaliciSil(klasorler, notlar);
    bildir("Klasör kalıcı olarak silindi.");
  } catch (h) {
    bildir("Silinemedi: " + (h.message || h), "error");
  }
  etiketFiltresiniDoldur();
  listeyiCiz();
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
  gorselEditoreEkle(ek);
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
  detayBasliklari();
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
          yazi().querySelectorAll("img[data-ek]").forEach((i) => i.dataset.ek === ek.id && i.remove());
          yaziyiKontrolEt();
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

/* ---- zengin metin yardımcıları ---- */

const yazi = () => $("nt-govde");

function seciliDugum() {
  const s = window.getSelection();
  const n = s && s.rangeCount ? s.anchorNode : null;
  return n ? (n.nodeType === 3 ? n.parentElement : n) : null;
}
function seciliAta(secici) {
  const a = seciliDugum()?.closest(secici);
  return a && a !== yazi() && yazi().contains(a) ? a : null;
}
function imlecEditordeMi() {
  const s = window.getSelection();
  return !!(s && s.rangeCount && yazi().contains(s.anchorNode));
}
function imleciSonaTasi() {
  const y = yazi();
  if (!y.firstChild) bosParagrafEkle();
  // İmleç kök kapsayıcıda değil, SON bloğun İÇİNDE olmalı (yoksa yazılanlar bloğun dışına düşer)
  let son = y.lastElementChild || y;
  while (son.lastElementChild && !["BR", "IMG", "HR"].includes(son.lastElementChild.tagName)) son = son.lastElementChild;
  const r = document.createRange();
  if (son !== y && !son.textContent) r.setStart(son, 0);
  else r.selectNodeContents(son);
  r.collapse(son === y || !!son.textContent ? false : true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
function metniImlecteEkle(metin) {
  yazi().focus();
  if (!imlecEditordeMi()) imleciSonaTasi();
  document.execCommand("insertText", false, metin);
}

function bosParagrafEkle() {
  const p = el("p", {}, el("br"));
  yazi().append(p);
  return p;
}

/** Chrome, liste/başlık komutlarında bloğu <p> içine sarabiliyor: sarmalayıcıyı çöz (düğümler taşınır, seçim bozulmaz). */
function sarmalayicilariCoz() {
  const y = yazi();
  for (const p of [...y.querySelectorAll(":scope > p")]) {
    if (!p.querySelector(":scope > ul, :scope > ol, :scope > h2, :scope > h3, :scope > blockquote, :scope > hr, :scope > p")) continue;
    while (p.firstChild) p.before(p.firstChild);
    p.remove();
  }
  // Girinti komutu <ul> içine doğrudan <ul> koyar: önceki maddenin içine al, görev sınıfını miras ver
  for (const alt of [...y.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol")]) {
    const ust = alt.parentElement;
    let li = alt.previousElementSibling;
    if (!li || li.localName !== "li") {
      li = document.createElement("li");
      alt.before(li);
    }
    if (ust.classList.contains("nt-gorev") && alt.localName === "ul") alt.classList.add("nt-gorev");
    li.append(alt);
  }
  // Biçim komutları boş <p></p> artığı bırakabilir (br'siz): kaldır
  for (const p of [...y.querySelectorAll(":scope > p")]) {
    if (!p.firstChild && p !== y.lastElementChild) p.remove();
  }
}

/** Placeholder, boş belge güvencesi. */
function yaziyiKontrolEt() {
  sarmalayicilariCoz();
  const y = yazi();
  if (!y.firstChild) {
    const p = bosParagrafEkle();
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  y.classList.toggle("nt-yazi-bos", !y.textContent.trim() && !y.querySelector("img,hr,li"));
}
let sozcukT;
function sozcukGuncelle() {
  clearTimeout(sozcukT);
  sozcukT = setTimeout(() => {
    const t = yazi().textContent.trim();
    const n = t ? t.split(/\s+/).length : 0;
    $("nt-sozcuk").textContent = n ? `${n} sözcük` : "";
  }, 300);
}

async function gorselYukle(img, ek) {
  try {
    img.src = await ekBlobAl(ek);
  } catch {
    img.alt = "Görsel açılamadı";
  }
}

function editoreIcerikKur(m) {
  const y = yazi();
  if (m.html) Bicim.htmlKur(m.html, y);
  else if (m.govde) Bicim.markdownKur(m.govde, y);
  else y.replaceChildren();
  if (!y.firstChild) bosParagrafEkle();
  y.querySelectorAll("img[data-ek]").forEach((img) => {
    const ek = m.ekler.find((e) => e.id === img.dataset.ek);
    if (ek) gorselYukle(img, ek);
    else img.alt = "Ek bulunamadı";
  });
  y.classList.toggle("nt-yazi-bos", !y.textContent.trim() && !y.querySelector("img,hr,li"));
}

function gorselEditoreEkle(ek) {
  const img = el("img", { "data-ek": ek.id, alt: ek.ad });
  const p = el("p", {}, img);
  const y = yazi();
  let blok = imlecEditordeMi() ? window.getSelection().anchorNode : null;
  while (blok && blok.parentNode !== y) blok = blok.parentNode;
  if (blok && blok.parentNode === y) blok.after(p);
  else y.append(p);
  gorselYukle(img, ek);
  yaziyiKontrolEt();
  sozcukGuncelle();
}

/* ---- biçim komutları ---- */

function vurguAcKapa() {
  const s = window.getSelection();
  if (!s.rangeCount || s.isCollapsed) return bildir("Vurgulamak için önce metni seç.", "warning", 2500);
  const r = s.getRangeAt(0);
  const kok = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
  const parcalar = [];
  const yurur = document.createTreeWalker(kok, NodeFilter.SHOW_TEXT);
  for (let n = yurur.nextNode(); n; n = yurur.nextNode()) {
    if (!r.intersectsNode(n)) continue;
    const a = n === r.startContainer ? r.startOffset : 0;
    const b = n === r.endContainer ? r.endOffset : n.nodeValue.length;
    if (b > a) parcalar.push({ n, a, b });
  }
  if (!parcalar.length) return;

  if (parcalar.every((p) => p.n.parentElement.closest("mark"))) {
    for (const mk of new Set(parcalar.map((p) => p.n.parentElement.closest("mark")))) {
      while (mk.firstChild) mk.before(mk.firstChild);
      mk.remove();
    }
    return;
  }
  const yeniler = [];
  for (const { n, a, b } of parcalar) {
    if (n.parentElement.closest("mark")) continue;
    if (b < n.nodeValue.length) n.splitText(b);
    const orta = a > 0 ? n.splitText(a) : n;
    const mk = document.createElement("mark");
    orta.before(mk);
    mk.append(orta);
    yeniler.push(mk);
  }
  if (yeniler.length) {
    const r2 = document.createRange();
    r2.setStartBefore(yeniler[0]);
    r2.setEndAfter(yeniler[yeniler.length - 1]);
    s.removeAllRanges();
    s.addRange(r2);
  }
}

function blokBicimi(etiket) {
  const mevcut = seciliAta("h2,h3");
  document.execCommand("formatBlock", false, `<${mevcut && mevcut.localName === etiket ? "p" : etiket}>`);
}

function alintiBlokuAcKapa() {
  const bq = seciliAta("blockquote");
  if (bq) {
    while (bq.firstChild) bq.before(bq.firstChild);
    bq.remove();
  } else document.execCommand("formatBlock", false, "<blockquote>");
}

function gorevListesiAcKapa() {
  let ul = seciliAta("ul");
  if (!ul) {
    document.execCommand("insertUnorderedList");
    ul = seciliAta("ul");
    if (ul) ul.classList.add("nt-gorev");
  } else ul.classList.toggle("nt-gorev");
}

function komutUygula(k) {
  yazi().focus();
  if (!imlecEditordeMi()) imleciSonaTasi();
  switch (k) {
    case "bold":
    case "italic":
    case "underline":
    case "strikeThrough":
    case "undo":
    case "redo":
      document.execCommand(k);
      break;
    case "ul":
      document.execCommand("insertUnorderedList");
      break;
    case "ol":
      document.execCommand("insertOrderedList");
      break;
    case "gorev":
      gorevListesiAcKapa();
      break;
    case "h2":
    case "h3":
      blokBicimi(k);
      break;
    case "quote":
      alintiBlokuAcKapa();
      break;
    case "hr":
      document.execCommand("insertHorizontalRule");
      break;
    case "mark":
      vurguAcKapa();
      break;
    case "girinti":
      if (seciliAta("li")) document.execCommand("indent");
      break;
    case "girintiAzalt":
      if (seciliAta("li")) document.execCommand("outdent");
      break;
    case "temizle":
      document.execCommand("removeFormat");
      document.execCommand("formatBlock", false, "<p>");
      break;
    default:
      return;
  }
  yaziyiKontrolEt();
  kirlendi();
  sozcukGuncelle();
  araciGuncelle();
}

const ACIK_KAPALI_KOMUTLAR = ["bold", "italic", "underline", "strikeThrough", "mark", "h2", "h3", "ul", "ol", "gorev", "quote"];
function araciGuncelle() {
  if ($("nt-editor").hidden) return;
  const odakta = imlecEditordeMi();
  document.querySelectorAll("#nt-arac [data-kmt]").forEach((b) => {
    const k = b.dataset.kmt;
    if (!ACIK_KAPALI_KOMUTLAR.includes(k)) return;
    let acik = false;
    if (odakta) {
      try {
        if (["bold", "italic", "underline", "strikeThrough"].includes(k)) acik = document.queryCommandState(k);
        else if (k === "ul") acik = !!seciliAta("ul:not(.nt-gorev)");
        else if (k === "ol") acik = !!seciliAta("ol");
        else if (k === "gorev") acik = !!seciliAta("ul.nt-gorev");
        else if (k === "quote") acik = !!seciliAta("blockquote");
        else acik = !!seciliAta(k);
      } catch {
        acik = false;
      }
    }
    b.classList.toggle("nt-arac-aktif", acik);
    b.setAttribute("aria-pressed", String(acik));
  });
}

/** Satır başında "- ", "1. ", "# ", "## ", "[] ", "> " yazınca ilgili biçime geçer (hızlı not için). */
const KISAYOLLAR = { "-": "ul", "*": "ul", "1.": "ol", "#": "h2", "##": "h3", "[]": "gorev", ">": "quote" };

function yaziTusu(o) {
  if (o.key === " " && !o.ctrlKey && !o.metaKey && !o.altKey) {
    const s = window.getSelection();
    const blok = seciliAta("p");
    if (s.rangeCount && s.isCollapsed && blok && blok.parentNode === yazi()) {
      const r = document.createRange();
      r.setStart(blok, 0);
      r.setEnd(s.anchorNode, s.anchorOffset);
      const k = KISAYOLLAR[r.toString()];
      if (k) {
        o.preventDefault();
        r.deleteContents();
        if (!blok.textContent) blok.replaceChildren(el("br")); // boş metin düğümü kalmasın
        // Seçimi açıkça bu bloğa koy; yoksa execCommand yanlış bloğu dönüştürebilir
        const yeniSecim = document.createRange();
        yeniSecim.setStart(blok, 0);
        yeniSecim.collapse(true);
        s.removeAllRanges();
        s.addRange(yeniSecim);
        komutUygula(k);
        return;
      }
    }
  }
  if (o.key === "Tab" && !o.ctrlKey && !o.metaKey && !o.altKey && seciliAta("li")) {
    o.preventDefault();
    komutUygula(o.shiftKey ? "girintiAzalt" : "girinti");
    return;
  }
  if ((o.ctrlKey || o.metaKey) && o.shiftKey && o.key.toLowerCase() === "h") {
    o.preventDefault();
    komutUygula("mark");
    return;
  }
  if (o.key === "Enter" && !o.shiftKey) {
    // Yeni açılan boş madde, öncekinin "yapıldı" işaretini taşımasın
    setTimeout(() => {
      const li = seciliAta("li[data-yapildi]");
      if (li && !li.textContent.trim()) li.removeAttribute("data-yapildi");
    }, 0);
  }
}

function sablonEkle(anahtar) {
  const dugumler = Bicim.sablonDugumleri(anahtar);
  if (!dugumler.length || !S.duz) return;
  const y = yazi();
  if (!y.textContent.trim() && !y.querySelector("img,hr,li")) y.replaceChildren();
  y.append(...dugumler);
  const ilk = y.querySelector("p, li");
  y.focus();
  if (ilk) {
    const r = document.createRange();
    r.selectNodeContents(ilk);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  const tur = Bicim.SABLONLAR[anahtar]?.tur;
  if (tur && $("nt-tur-sec").value === "genel") $("nt-tur-sec").value = tur;
  yaziyiKontrolEt();
  kirlendi();
  sozcukGuncelle();
}

/* ---- açma ---- */

function hizliNot() {
  yeniNot("");
}

/** sablon: "" (boş/hızlı) ya da Bicim.SABLONLAR anahtarı. */
function yeniNot(sablon = "") {
  const s = sablon ? Bicim.SABLONLAR[sablon] : null;
  const simdi = new Date();
  const t = simdi.toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  duzenleyiciAc(null, {
    otoBaslik: s ? `${s.ad} · ${simdi.toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}` : `Not · ${t}`,
    tur: s?.tur || "genel",
    durum: s ? "devam" : "gelen",
    tarih: s ? yerelTarih(simdi) : "",
    sablon,
    govdeyeOdak: !s,
  });
}

/** Başlık çok satıra sarabilsin (tek satırlık input uzun başlığı kesiyordu). */
function baslikBoyutla() {
  const b = $("nt-baslik");
  b.style.height = "auto";
  b.style.height = `${b.scrollHeight}px`;
}

function detayBasliklari() {
  if (!S.duz) return;
  const a = S.duz.alintilar.length;
  const e = S.duz.ekler.length;
  $("nt-alinti-baslik").textContent = a ? `Kaynaklı alıntılar (${a})` : "Kaynaklı alıntılar";
  $("nt-ek-baslik").textContent = e ? `Ekler (${e})` : "Ekler";
}

function duzenleyiciAc(m, secenek = {}) {
  if (S.duz && S.kirli) kaydet({ sessiz: true });
  blobUrlleriniBirak();
  S.silinecekEkler = [];
  S.duzYeni = !m;
  S.duz = m
    ? structuredClone(m)
    : modelOlustur(crypto.randomUUID(), null, {
        durum: secenek.durum || "gelen",
        kategori: secenek.tur || "genel",
        tarih: secenek.tarih || "",
        etiketler: [],
        klasor: S.gorunum === "klasor" ? S.konum : null,
      });
  S.otoBaslik = !m && secenek.otoBaslik ? secenek.otoBaslik : "";
  if (S.otoBaslik) S.duz.baslik = S.otoBaslik;
  S.kirli = false;

  $("nt-baslik").value = S.duz.baslik;
  baslikBoyutla();
  $("nt-etiketler").value = S.duz.etiketler.join(", ");
  editoreIcerikKur(S.duz);
  klasorSecenekleriDoldur($("nt-klasor-sec"), { secili: klasorVarMi(S.duz.klasor) ? S.duz.klasor : null, kok: "Ana klasör" });
  $("nt-tur-sec").value = S.duz.kategori;
  $("nt-durum-sec").value = S.duz.durum;
  $("nt-tarih").value = S.duz.tarih;
  $("nt-editor-menu-btn").hidden = S.duzYeni;
  durumYaz(S.duzYeni ? "Yeni not — yazmaya başla, kendiliğinden kaydedilir." : `Son güncelleme: ${tarihYaz(S.duz.guncelleme)}`);

  alintilariCiz();
  eklerCiz();
  $("nt-alinti-detay").open = !!S.duz.alintilar.length;
  $("nt-ek-detay").open = !!S.duz.ekler.length;
  $("nt-editor").hidden = false;
  $("nt-bos-editor").hidden = true;
  panelGoster("editor");
  sozcukGuncelle();
  araciGuncelle();
  if (secenek.sablon) sablonEkle(secenek.sablon);
  if (secenek.govdeyeOdak) {
    yazi().focus();
    imleciSonaTasi();
  } else if (!m && !secenek.sablon) $("nt-baslik").focus();
  listeyiCiz();
  $("nt-editor").scrollTop = 0;
}

async function duzenleyiciKapat() {
  if (S.kirli) await kaydet({ sessiz: true });
  clearTimeout(S.otoKayitZamanlayici);
  S.duz = null;
  S.kirli = false;
  blobUrlleriniBirak();
  $("nt-editor").hidden = true;
  $("nt-bos-editor").hidden = false;
  odakAcKapa(false);
  panelGoster("liste");
  listeyiCiz();
}

function formuOku() {
  S.duz.baslik = $("nt-baslik").value.trim();
  S.duz.etiketler = [
    ...new Set(
      $("nt-etiketler")
        .value.split(",")
        .map((e) => e.trim().replace(/^#/, "").replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 20)
    ),
  ];
  S.duz.html = Bicim.duzenleyiciHtml(yazi());
  S.duz.govde = Bicim.htmlMarkdown(S.duz.html);
  S.duz.durum = $("nt-durum-sec").value in DURUMLAR ? $("nt-durum-sec").value : "gelen";
  S.duz.kategori = $("nt-tur-sec").value in TURLER ? $("nt-tur-sec").value : "genel";
  S.duz.tarih = $("nt-tarih").value || "";
  S.duz.klasor = $("nt-klasor-sec").value || null;
  return S.duz;
}

async function kaydet({ sessiz = false } = {}) {
  if (!S.duz) return;
  if (S.kaydediliyor) {
    S.tekrarKaydet = true;
    return;
  }
  const m = formuOku();
  const bos = (!m.baslik || m.baslik === S.otoBaslik) && !m.html.trim() && !m.alintilar.length && !m.ekler.length;
  if (bos && S.duzYeni) return;

  clearTimeout(S.otoKayitZamanlayici);
  S.kaydediliyor = true;
  durumYaz("Şifreleniyor ve kaydediliyor…");
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
      $("nt-editor-menu-btn").hidden = false;
    }
    haritayaIsle(sonuc);
    S.kirli = false;
    durumYaz(`Kaydedildi ${saatYaz()} · uçtan uca şifreli`);
    etiketFiltresiniDoldur();
    listeyiCiz();

    if (S.silinecekEkler.length) {
      const silinecek = S.silinecekEkler.splice(0);
      for (const a of silinecek) await ekiTamamenSil(a);
    }
    if (!sessiz) bildir("Not şifrelenip kaydedildi.");
  } catch (h) {
    console.error(h);
    durumYaz("Kaydedilemedi");
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
  detayBasliklari();
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
            title: "Yazıda imlecin olduğu yere {{alinti:N}} yer tutucusu koyar; yazıya dönüşürken burada belirir",
            onclick: () => {
              metniImlecteEkle(`{{alinti:${i + 1}}}`);
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
  arayuzuSifirla();
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

async function kurtarmaAnahtariniYenile() {
  if (!window.confirm("Yeni bir kurtarma anahtarı üretilecek; ESKİSİ GEÇERSİZ olacak. Devam edilsin mi?")) return;
  try {
    kurtarmaKartiniGoster(await Kasa.kurtarmaAnahtariniYenile(), () => ekranGoster("ana"));
  } catch (h) {
    bildir(h.message || "Kurtarma anahtarı yenilenemedi.", "error");
  }
}

/* ------------------------------------------------------------------ */
/* 12b) Dışa aktarma (PDF · Word · Markdown · HTML · metin · ZIP)      */
/* ------------------------------------------------------------------ */

function kayitaCevir(kaynak) {
  // Not editörde açıksa, kayıt kuyruğundaki/eski sürüm yerine EDİTÖRÜN O ANKİ içeriği dışa aktarılır:
  // "künye var ama gövde boş" ya da son yazılanların eksik çıkması böylece imkânsız olur.
  const m = S.duz && S.duz.id === kaynak.id ? { ...kaynak, ...structuredClone(formuOku()) } : kaynak;
  const yol = yolDizisi(notKlasoru(m));
  let html = m.html || "";
  let govde = m.govde || "";
  if (!html.trim() && govde.trim()) {
    const g = document.createElement("div");
    Bicim.markdownKur(govde, g);
    html = Bicim.duzenleyiciHtml(g);
  } else if (html.trim() && !govde.trim()) govde = Bicim.htmlMarkdown(html);
  return {
    id: m.id,
    baslik: m.baslik,
    klasorYolu: yol.map((k) => k.ad),
    klasorTarihleri: yol.map((k) => k.guncelleme),
    olusturma: m.olusturma,
    guncelleme: m.guncelleme,
    tarih: m.tarih,
    kategori: m.kategori,
    durum: m.durum,
    etiketler: m.etiketler,
    html,
    govde,
    alintilar: m.alintilar,
    ekler: m.ekler,
  };
}

const klasorKaydi = (k) => ({ yol: yolDizisi(k.id).map((x) => x.ad), guncelleme: k.guncelleme });

/** baslangic: "bu" | "secili" | "klasor" | "gorunen" | "tum"; oge: not ya da klasör. */
async function disaAktarAc(baslangic = "tum", oge = null) {
  // Devam eden bir kayıt varsa bitmesini bekle (en çok 10 sn), sonra bekleyen değişikliği kaydet.
  for (let i = 0; i < 100 && S.kaydediliyor; i++) await new Promise((r) => setTimeout(r, 100));
  if (S.kirli) await kaydet({ sessiz: true });
  const Aktar = await import("./disa-aktar/disa-aktar.js");

  const canli = () => [...S.notlar.values()].filter((m) => !m.silindiAt);
  const sirali = (l) => l.sort((a, b) => a.olusturma.localeCompare(b.olusturma));
  const kapsamlar = [];
  const ekle = (id, ad, notlarFn, klasorlerFn, paketAdi) => {
    const n = notlarFn();
    kapsamlar.push({ id, ad, sayi: n.length, ekVar: n.some((m) => m.ekler.length), kayitlar: () => sirali(notlarFn()).map(kayitaCevir), klasorler: klasorlerFn, paketAdi });
  };

  if (oge && oge.tur !== "klasor") ekle("bu", `Bu not: ${oge.baslik || "Başlıksız not"}`, () => [S.notlar.get(oge.id) || (S.duz?.id === oge.id ? S.duz : oge)], null, oge.baslik);
  if (S.secim.size) ekle("secili", "Seçili notlar", () => secilenNotlar(), null, "Seçili notlar");
  const klasor = oge?.tur === "klasor" ? oge : S.gorunum === "klasor" ? S.klasorler.get(S.konum) : null;
  if (klasor) {
    ekle("klasor", `Klasör: ${klasor.ad} (alt klasörlerle)`, () => altAgac(klasor).notlar, () => altAgac(klasor).klasorler.map(klasorKaydi), klasor.ad);
  }
  if (S.gorunum !== "tum" || filtreAktifMi()) ekle("gorunen", "Şu an listelenenler", () => filtrelenmisNotlar().liste.filter((m) => !m.silindiAt), null, listeBasligi());
  ekle("tum", "Tüm notlar (arşiv dahil)", canli, () => [...S.klasorler.values()].filter((k) => !k.silindiAt).map(klasorKaydi), "Notlarım");

  const secilen = kapsamlar.find((k) => k.id === baslangic && k.sayi) || kapsamlar.find((k) => k.sayi) || kapsamlar[0];
  const meta = S.session?.user?.user_metadata || {};
  const ctx = {
    turAdi: (k) => TURLER[k]?.ad || "Genel",
    durumAdi: (d) => DURUMLAR[d]?.ad || d,
    yazar: meta.full_name || meta.name || "",
    temizHtml: (h) => {
      const d = document.createElement("div");
      Bicim.htmlKur(h, d);
      return d.innerHTML; // yalnızca OKUMA: beyaz listeyle yeniden kurulmuş ağaç
    },
    ekBayt: async (ek) => {
      const yanit = await ekIstegi("GET", ek.anahtar);
      return new Uint8Array(await Kasa.ekiCoz(await yanit.arrayBuffer(), ek.anahtar));
    },
  };
  await Aktar.disaAktarDiyalogu({ kapsamlar, ctx, baslangic: { kapsam: secilen.id, bicimler: ["pdf"] }, kok: $("notlar"), bildir });
}


/* ------------------------------------------------------------------ */
/* 12c) İçeri aktarma (Markdown · metin · JSON · HTML · Word · ZIP)    */
/* ------------------------------------------------------------------ */

const katlaAd = (a) => katla(String(a || "").trim());

/** Aynı başlık + aynı düz metin zaten (çöpte olmayan) bir notta varsa true: kopya yaratmayı önler. */
function mukerrerMi(t) {
  const baslik = katlaAd(t.baslik);
  const metin = katlaAd(Bicim.duzMetinHtml(t.html));
  for (const m of S.notlar.values()) {
    if (m.silindiAt) continue;
    if (katlaAd(m.baslik) === baslik && katlaAd(m.html ? Bicim.duzMetinHtml(m.html) : duzMetin(m.govde)) === metin) return true;
  }
  return false;
}

function degerBul(sozluk, v) {
  const a = katlaAd(v);
  if (!a) return null;
  for (const [anahtar, oge] of Object.entries(sozluk)) if (katlaAd(anahtar) === a || katlaAd(oge.ad) === a) return anahtar;
  return null;
}

/** Hedef klasörün altında yolu (yoksa oluşturarak) çözer; her klasör şifreli yükle kaydedilir. */
async function klasorYoluCoz(yol, kokId, onbellek) {
  let ust = kokId || null;
  for (const ad of yol) {
    const anahtar = `${ust || ""}|${katlaAd(ad)}`;
    let id = onbellek.get(anahtar);
    if (!id) {
      const var_ = altKlasorler(ust).find((k) => katlaAd(k.ad) === katlaAd(ad));
      if (var_) id = var_.id;
      else {
        const km = klasorModeli(crypto.randomUUID(), null, { ad, ust });
        haritayaIsle(await modeliKaydet(km, true));
        id = km.id;
      }
      onbellek.set(anahtar, id);
    }
    ust = id;
  }
  return ust;
}

/** Taslakları MEVCUT E2EE hattından geçirir: modelOlustur → Kasa.notuSifrele → INSERT (modeliKaydet). */
async function iceAktarimiYaz({ notlar, hedefKlasorId, klasorYapisi }, ilerleme) {
  const onbellek = new Map();
  const hata = [];
  const basarisiz = [];
  let eklenen = 0;
  for (let i = 0; i < notlar.length; i++) {
    const t = notlar[i];
    ilerleme(i, notlar.length, t.baslik || "Başlıksız not");
    try {
      const klasor = klasorYapisi && t.klasorYolu.length ? await klasorYoluCoz(t.klasorYolu, hedefKlasorId, onbellek) : hedefKlasorId || null;
      const m = modelOlustur(crypto.randomUUID(), null, {
        baslik: t.baslik,
        etiketler: t.etiketler,
        durum: t.durum || "gelen",
        kategori: t.kategori || "genel",
        tarih: t.tarih || "",
        klasor,
        html: t.html,
        govde: t.govde,
        alintilar: t.alintilar.map((a) => ({ id: crypto.randomUUID(), ...a })),
        ekler: [],
        kokenOlusturma: t.olusturma,
      });
      haritayaIsle(await modeliKaydet(m, true));
      eklenen++;
    } catch (h) {
      console.error(h);
      hata.push(`${t.baslik || "Başlıksız not"}: ${h.message || h}`);
      basarisiz.push(t);
    }
  }
  ilerleme(notlar.length, notlar.length, "");
  etiketFiltresiniDoldur();
  listeyiCiz();
  return { eklenen, hata, basarisiz };
}

async function iceAktarAc() {
  if (S.kirli) await kaydet({ sessiz: true });
  const Ice = await import("./ice-aktar/ice-aktar.js");
  await Ice.iceAktarDiyalogu({
    ctx: {
      turBul: (v) => degerBul(TURLER, v),
      durumBul: (v) => degerBul(DURUMLAR, v) || ESKI_DURUM[String(v).trim().toLowerCase()] || null,
      klasorSecenekleriDoldur: (sec) => klasorSecenekleriDoldur(sec, { secili: S.gorunum === "klasor" ? S.konum : null }),
      mukerrerMi,
    },
    kok: $("notlar"),
    uygula: iceAktarimiYaz,
    bildir,
  });
}

/* ------------------------------------------------------------------ */
/* 13) Olay bağlama                                                    */
/* ------------------------------------------------------------------ */

function baglantilariKur() {
  ikonlariKur($("notlar"));
  filtreSecenekleriniKur();

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
  $("nt-arama").addEventListener("keydown", (o) => {
    if (o.key === "Escape" && $("nt-arama").value) {
      o.stopPropagation();
      $("nt-arama-temizle").click();
    } else if (o.key === "ArrowDown") {
      o.preventDefault();
      $("nt-liste").querySelector(".nt-satir-ana")?.focus();
    }
  });
  $("nt-arama-temizle").addEventListener("click", () => {
    $("nt-arama").value = "";
    S.filtre.arama = "";
    $("nt-arama-temizle").hidden = true;
    listeyiCiz();
    $("nt-arama").focus();
  });

  // Süzgeçler
  const suz = (id, anahtar) =>
    $(id).addEventListener("change", (o) => {
      S.filtre[anahtar] = o.target.value;
      S.gorunenSayi = SAYFA_BOYUTU;
      listeyiCiz();
    });
  suz("nt-durum-filtre", "durum");
  suz("nt-tur-filtre", "tur");
  suz("nt-etiket-filtre", "etiket");
  suz("nt-sirala", "sirala");

  // Üst çubuk
  $("nt-hizli-btn").addEventListener("click", hizliNot);
  $("nt-yeni-menu-btn").addEventListener("click", (o) => {
    o.stopPropagation();
    if (S.menu && S.menuBagla === o.currentTarget) return menuKapat();
    yeniNotMenusu(o.currentTarget);
  });
  $("nt-ice-btn")?.addEventListener("click", () => iceAktarAc().catch((h) => bildir("İçeri aktarma açılamadı: " + (h.message || h), "error")));
  $("nt-aktar-btn").addEventListener("click", () => {
    const acik = S.duz ? S.notlar.get(S.duz.id) || S.duz : null;
    if (acik) return disaAktarAc("bu", acik);
    disaAktarAc(S.secim.size ? "secili" : S.gorunum === "klasor" ? "klasor" : filtreAktifMi() || S.gorunum !== "tum" ? "gorunen" : "tum");
  });
  $("nt-daha-btn").addEventListener("click", (o) => {
    o.stopPropagation();
    if (S.menu && S.menuBagla === o.currentTarget) return menuKapat();
    dahaMenusu(o.currentTarget);
  });
  $("nt-klasor-btn").addEventListener("click", () => klasorOlustur(S.gorunum === "klasor" ? S.konum : null));
  $("nt-nav-btn").addEventListener("click", () => navAc(!$("nt-duzen").classList.contains("nt-nav-acik")));
  $("nt-nav-perde").addEventListener("click", navKapat);
  $("nt-odak-btn").addEventListener("click", () => odakAcKapa());
  $("nt-editor-menu-btn").addEventListener("click", (o) => {
    o.stopPropagation();
    if (S.menu && S.menuBagla === o.currentTarget) return menuKapat();
    editorMenusu(o.currentTarget);
  });

  // Çoklu seçim
  $("nt-sec-btn").addEventListener("click", () => secimModuAyarla(!S.secimModu));
  $("nt-secim-hepsi").addEventListener("click", gorunenleriSec);
  $("nt-secim-aktar").addEventListener("click", () => disaAktarAc("secili"));
  $("nt-secim-tasi").addEventListener("click", topluTasi);
  $("nt-secim-cop").addEventListener("click", topluCope);
  $("nt-secim-durum").addEventListener("click", (o) => {
    o.stopPropagation();
    if (S.menu && S.menuBagla === o.currentTarget) return menuKapat();
    menuAc(o.currentTarget, Object.entries(DURUMLAR).map(([k, v]) => ({ ad: `${v.ad} yap`, islem: () => topluDurum(k) })));
  });

  // Başlık: tek satırlık anlam (Enter gövdeye geçer), uzun başlık sarılır
  $("nt-baslik").addEventListener("keydown", (o) => {
    if (o.key === "Enter") {
      o.preventDefault();
      yazi().focus();
    }
  });
  $("nt-baslik").addEventListener("input", (o) => {
    if (/[\r\n]/.test(o.target.value)) o.target.value = o.target.value.replace(/\s*[\r\n]+\s*/g, " ");
    baslikBoyutla();
  });
  window.addEventListener("resize", () => !$("nt-editor").hidden && baslikBoyutla());

  // Listede ok tuşlarıyla gezinme
  $("nt-liste").addEventListener("keydown", (o) => {
    if (o.key !== "ArrowDown" && o.key !== "ArrowUp") return;
    const dugmeler = [...$("nt-liste").querySelectorAll(".nt-satir-ana")];
    const i = dugmeler.indexOf(document.activeElement);
    if (i < 0) return;
    o.preventDefault();
    if (o.key === "ArrowUp" && i === 0) return $("nt-arama").focus();
    dugmeler[Math.min(dugmeler.length - 1, Math.max(0, i + (o.key === "ArrowDown" ? 1 : -1)))].focus();
  });

  // Menüler: dışarı tıklayınca / kaydırınca kapanır
  document.addEventListener("click", (o) => {
    if (S.menu && !S.menu.contains(o.target)) menuKapat();
  });
  document.addEventListener("scroll", () => S.menu && menuKapat(), true);
  window.addEventListener("resize", () => {
    menuKapat();
    if (window.innerWidth >= 1280) navKapat();
  });
  document.addEventListener("keydown", (o) => {
    if (o.key !== "Escape" || o.defaultPrevented) return;
    if (S.menu) return menuKapat();
    if ($("nt-duzen").classList.contains("nt-nav-acik")) return navKapat();
    if (S.secimModu && $("nt-ana") && !$("nt-ana").hidden) secimModuAyarla(false);
  });

  // Kasa penceresi
  $("nt-kasa-kapat").addEventListener("click", () => $("nt-kasa-dlg").close());
  $("nt-yenile-btn").addEventListener("click", () => {
    $("nt-kasa-dlg").close();
    notlariYukle().catch((h) => bildir("Yenilenemedi: " + h.message, "error"));
  });
  $("nt-kilitle-btn").addEventListener("click", () => {
    $("nt-kasa-dlg").close();
    kilitle("Kasa kilitlendi; bu cihazdaki anahtar silindi.");
  });
  $("nt-otokilit").addEventListener("change", (o) => {
    try {
      localStorage.setItem("aea_nt_otokilit", o.target.value);
    } catch {
      /* depo kapalı */
    }
    otoKilidiKur();
  });
  $("nt-yedek-sifreli-btn").addEventListener("click", sifreliYedekIndir);
  $("nt-kurtarma-yenile-btn").addEventListener("click", () => {
    $("nt-kasa-dlg").close();
    kurtarmaAnahtariniYenile();
  });

  // Zengin metin editörü
  $("nt-arac").addEventListener("mousedown", (o) => {
    if (o.target.closest("button")) o.preventDefault(); // seçim kaybolmasın
  });
  $("nt-arac").addEventListener("click", (o) => {
    const b = o.target.closest("[data-kmt]");
    if (b) komutUygula(b.dataset.kmt);
  });
  $("nt-sablon").addEventListener("change", (o) => {
    sablonEkle(o.target.value);
    o.target.value = "";
  });
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, false);
  } catch {
    /* eski tarayıcı */
  }
  yazi().addEventListener("keydown", yaziTusu);
  yazi().addEventListener("input", () => {
    yaziyiKontrolEt();
    sozcukGuncelle();
  });
  yazi().addEventListener("click", (o) => {
    // Yapılacaklar listesinde onay kutusuna tıklama
    const li = o.target;
    if (li.localName === "li" && li.parentElement?.classList.contains("nt-gorev") && o.offsetX < parseFloat(getComputedStyle(li).paddingLeft)) {
      li.toggleAttribute("data-yapildi");
      kirlendi();
    }
  });
  document.addEventListener("selectionchange", araciGuncelle);
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
    if (o.target.id === "nt-sablon" || !S.duz) return;
    kirlendi();
  });
  $("nt-form").addEventListener("change", (o) => {
    if (o.target.id === "nt-klasor-sec" && S.duz) kirlendi();
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
  // Yazı alanına doğrudan görsel yapıştırma/bırakma da çalışsın; metin yapıştırma düz metin olur
  yazi().addEventListener("dragover", (o) => {
    if (o.dataTransfer?.types?.includes("Files")) o.preventDefault();
  });
  yazi().addEventListener("drop", (o) => {
    if (!o.dataTransfer?.files?.length) return;
    o.preventDefault();
    dosyalariEkle([...o.dataTransfer.files]);
  });
  yazi().addEventListener("paste", (o) => {
    const dosyalar = [...(o.clipboardData?.files || [])];
    if (dosyalar.length) {
      o.preventDefault();
      dosyalariEkle(dosyalar);
      return;
    }
    const metin = o.clipboardData?.getData("text/plain");
    if (metin == null) return;
    o.preventDefault();
    document.execCommand("insertText", false, metin);
  });

  // Genel
  window.addEventListener("beforeunload", (o) => {
    if (S.kirli) {
      o.preventDefault();
      o.returnValue = "";
    }
  });
  document.addEventListener("keydown", (o) => {
    const gorunur = $("nt-ana") && !$("nt-ana").hidden && $("view-content-notlar") && !$("view-content-notlar").hidden;
    if (!gorunur) return;
    const yaziyor = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if (o.key === "/" && !yaziyor && !o.ctrlKey && !o.metaKey) {
      o.preventDefault();
      $("nt-arama").focus();
    } else if ((o.key === "n" || o.key === "N") && !yaziyor && !o.ctrlKey && !o.metaKey && !o.altKey && !document.querySelector("dialog[open]")) {
      o.preventDefault();
      hizliNot();
    } else if ((o.ctrlKey || o.metaKey) && o.shiftKey && o.key.toLowerCase() === "f" && !$("nt-editor").hidden) {
      o.preventDefault();
      odakAcKapa();
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
  // Rol şartı KOYMUYORUZ: modülü owner'ın açtığı bir üye (user/special_user) de girebilmeli.
  // Yetki kararı veritabanındaki not_modulu_yetkili()'den gelir (rol listesi + owner'ın rol/kişi
  // bazlı kapatmaları + üyeye açmaları, migration 0059/0060); RLS ve R2 worker'ı da aynısını sorar.
  const { session, profile } = await requireAuthOrShowError();
  S.session = session;
  if (!$("notlar")) return;

  const { data: yetkili, error: yetkiHatasi } = await supabase.rpc("not_modulu_yetkili");
  // RPC yoksa/erişilemezse (migration eksik, ağ) eski rol kuralına düş; RLS yine veriyi korur.
  const izinVar = yetkiHatasi
    ? ["editor", "manager", "admin", "owner"].includes(profile?.role)
    : yetkili === true;
  if (!izinVar) {
    await Kasa.tumAnahtarlariTemizle();
    $("notlar").replaceChildren(
      el(
        "div",
        { class: "nt-kilit" },
        el("h2", { text: "🔒 Notlarım hesabın için etkin değil" }),
        el("p", {
          class: "muted",
          text:
            "Bu özelliğe erişimi site sahibi yönetir. Daha önce notların varsa silinmedi; erişim " +
            "(yeniden) açıldığında aynen geri gelecek.",
        })
      )
    );
    return;
  }

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
