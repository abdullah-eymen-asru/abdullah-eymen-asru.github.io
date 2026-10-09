/*
 * assets/js/sistem-yedek/depolama.js — Depolama Durumu kartları (Supabase DB + Cloudflare R2) + TÜM tablolar.
 * Veri: sistem_depolama_durumu() (toplamlar; yetkili herkes) ve sistem_depolama_tablolari() (tüm tablolar; YALNIZCA owner).
 * Owner ayrıca Worker'dan R2'yi GERÇEKTEN tarayabilir (DB'de izi olmayan artık dosyalar dahil). %80 → uyarı, %90 → kritik.
 * innerHTML YOK, inline stil YOK (CSP): çubuklar <progress> ile çizilir.
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, hataMetni, workerFetch, dugme, ikon, VARSAYILAN_DB_KOTA, VARSAYILAN_R2_KOTA } from "./ortak.js";

const KAYNAK_ADLARI = { arsiv: "Dosya Yöneticisi", akademik: "Akademik Kütüphane", notek: "Not ekleri" };

export function durumSeviyesi(oran) {
  if (oran >= 0.9) return { sinif: "kritik", etiket: "Kritik · %90+" };
  if (oran >= 0.8) return { sinif: "uyari", etiket: "Uyarı · %80+" };
  return { sinif: "iyi", etiket: "Normal" };
}

/* -------- tablo açıklamaları + kategoriler (bilinmeyen tablo için şema/ad tabanlı genel açıklama) -------- */

const KATEGORILER = [
  { id: "hepsi", ad: "Hepsi" },
  { id: "uye", ad: "Üyeler & onaylar" },
  { id: "icerik", ad: "İçerik & dosyalar" },
  { id: "notlar", ad: "Notlar & kütüphane" },
  { id: "mesaj", ad: "Mesajlaşma" },
  { id: "guvenlik", ad: "Güvenlik & denetim" },
  { id: "ayar", ad: "Ayarlar & yetkiler" },
  { id: "supabase", ad: "Supabase dahili" },
];

const TABLO_BILGI = {
  profiles: ["uye", "Üye profilleri: ad, e-posta, rol ve KVKK / açık rıza durumu."],
  onay_gecmisi: ["uye", "Üyelerin aydınlatma ve açık rıza onay / geri çekme geçmişi (sürüm + zaman damgası)."],
  e2ee_kullanici_anahtarlari: ["uye", "Uçtan uca şifreleme için üyelerin açık anahtarları."],
  uye_aktarim_yetkileri: ["uye", "Hangi yöneticinin üye bilgilerini indirebileceği."],
  uye_aktarim_kayitlari: ["uye", "Üye verisi indirme geçmişi."],
  taslak_icerikler: ["icerik", "Gizli yayınlanan / taslak yazı ve proje içerikleri."],
  special_content: ["icerik", "Özel / gizli makaleler."],
  content_access: ["icerik", "Özel içeriklere kimin erişebildiği ve okuduğu."],
  r2_arsiv: ["icerik", "Dosya Yöneticisi dizini: klasörler, dosya adları, boyutlar (dosyaların kendisi R2'de)."],
  r2_arsiv_izinleri: ["icerik", "Dosya Yöneticisi paylaşım ve erişim izinleri."],
  r2_islem_sayaci: ["icerik", "R2 işlem kotası sayacı."],
  indirme_loglari: ["icerik", "Dosya indirme günlüğü."],
  ozel_icerik_anahtarlar: ["icerik", "Özel içerik ve dosya paylaşımı için sarılı şifre anahtarları."],
  notlar: ["notlar", "Üyelerin kişisel notları (metinler uçtan uca şifreli)."],
  not_kasasi: ["notlar", "Not kasası: sarılı şifreleme anahtarları ve kasa ayarları."],
  not_ek_kayitlari: ["notlar", "Not eklerinin kayıtları (dosyalar R2'de, şifreli)."],
  akademik_kaynaklar: ["notlar", "Akademik Kütüphane kaynakları (PDF'lerin R2 yolu dahil)."],
  akademik_notlar: ["notlar", "Kaynaklara bağlı akademik notlar."],
  akademik_okuyucu_ayarlari: ["notlar", "PDF okuyucu tercihleri."],
  conversations: ["mesaj", "Mesajlaşma konuşmaları."],
  messages: ["mesaj", "Mesaj içerikleri (KVKK açısından hassas)."],
  konusma_gizlemeleri: ["mesaj", "Üyelerin kendi tarafında gizlediği konuşmalar."],
  mesaj_gizlemeleri: ["mesaj", "Üyelerin kendi tarafında sildiği mesajlar."],
  denetim_kayitlari: ["guvenlik", "Yönetici ve sistem işlemlerinin denetim günlüğü."],
  admin_denetim: ["guvenlik", "Yöneticilerin karşılıklı denetim / onay talepleri."],
  admin_denetim_log: ["guvenlik", "Yönetici denetim talepleri için işlem günlüğü."],
  admin_denetim_oylari: ["guvenlik", "Yönetici denetim talepleri için verilen oylar."],
  sahip_onay_oylari: ["guvenlik", "Site sahibi onayı gerektiren işlemlerin oyları."],
  mfa_yedek_kodlar: ["guvenlik", "İki aşamalı doğrulama yedek kodları."],
  guvenlik_bildirim_ayarlari: ["guvenlik", "Güvenlik bildirimi (webhook) ayarları."],
  sistem_export_loglari: ["guvenlik", "Sistem dışa aktarma denetim günlüğü."],
  _tek_seferlik_islemler: ["guvenlik", "Tek seferlik işlem işaretleri (tekrar saldırısı koruması)."],
  site_settings: ["ayar", "Site genel ayarları (ör. üyelik kayıtlarının açık/kapalı olması)."],
  site_ayarlari: ["ayar", "Erişim kalkanı, KVKK / açık rıza sürümleri ve diğer site ayarları."],
  site_ayarlari_loglari: ["ayar", "Site ayarlarındaki değişikliklerin kaydı."],
  site_onizleme_izinleri: ["ayar", "Önizleme erişimi verilen üyeler."],
  ozellik_erisimleri: ["ayar", "Yetki Ayarları: rol bazlı özellik izinleri."],
  ozellik_kullanici_kisitlari: ["ayar", "Yetki Ayarları: kullanıcıya özel kısıtlar."],
  ozellik_kullanici_izinleri: ["ayar", "Yetki Ayarları: kullanıcıya özel izinler."],
  sistem_export_yetkileri: ["ayar", "Hangi rolün sistem dışa aktarma yapabileceği."],
};

const SEMA_BILGI = {
  auth: "Supabase Auth: hesaplar, oturumlar ve kimlik kayıtları.",
  storage: "Supabase Storage: kova ve nesne kayıtları (dosyaların meta verisi).",
  realtime: "Supabase Realtime dahili tabloları.",
  vault: "Supabase Vault (gizli anahtar deposu).",
  extensions: "Eklenti tabloları.",
  supabase_functions: "Edge Function / webhook dahili kayıtları.",
  net: "HTTP istekleri kuyruğu (pg_net).",
  cron: "Zamanlanmış görevler (pg_cron).",
  graphql: "GraphQL dahili tabloları.",
  pgsodium: "Şifreleme eklentisi dahili tabloları.",
  _realtime: "Supabase Realtime dahili tabloları.",
  supabase_migrations: "Uygulanan migration kayıtları (Supabase CLI).",
};

function tabloBilgisi(t) {
  if (t.sema === "public") {
    const b = TABLO_BILGI[t.tablo];
    return b ? { kategori: b[0], aciklama: b[1] } : { kategori: "ayar", aciklama: "Açıklama tanımlı değil (yeni eklenmiş tablo olabilir)." };
  }
  return { kategori: "supabase", aciklama: SEMA_BILGI[t.sema] || "Supabase dahili şema." };
}

const SIRALAMA = {
  boyut: { ad: "Boyut (büyükten küçüğe)", fn: (a, b) => b.toplam - a.toplam },
  ad: { ad: "Ad (A → Z)", fn: (a, b) => `${a.sema}.${a.tablo}`.localeCompare(`${b.sema}.${b.tablo}`, "tr") },
  satir: { ad: "Satır sayısı", fn: (a, b) => b.satir - a.satir },
  indeks: { ad: "İndeks boyutu", fn: (a, b) => b.indeks - a.indeks },
};

function tabloDetayi(kokDb) {
  let yuklendi = false;
  const govde = el("div", { class: "sy-detay-govde" }, el("p", { class: "muted", text: "Tablolar yükleniyor…" }));
  const detay = el("details", { class: "sy-detay" },
    el("summary", {}, ikon("ara"), "Tüm tablolar ve boyutları"),
    govde
  );

  async function yukle() {
    const { data, error } = await supabase.rpc("sistem_depolama_tablolari");
    if (error) {
      govde.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) }));
      yuklendi = false;
      return;
    }
    const tumu = (data?.tablolar || []).map((t) => ({ ...t, ...tabloBilgisi(t) }));
    const dbBayt = Number(data?.db_bayt) || 0;
    const tabloToplam = tumu.reduce((n, t) => n + Number(t.toplam), 0);
    const kovalar = data?.storage_kovalari || [];

    let arama = "";
    let kategori = "hepsi";
    let sira = "boyut";
    const liste = el("ul", { class: "sy-tablo-satirlari" });
    const ozet = el("p", { class: "muted sy-not" });
    const girdi = el("input", { type: "search", class: "sy-girdi", placeholder: "Tablo adı veya açıklamada ara…", "aria-label": "Tabloları ara", autocomplete: "off" });
    const siraSec = el("select", { "aria-label": "Sıralama" }, Object.entries(SIRALAMA).map(([k, v]) => el("option", { value: k, text: v.ad })));
    const cipler = el("div", { class: "sy-cipler", role: "group", "aria-label": "Kategori filtresi" });

    const cipleriCiz = () => {
      cipler.replaceChildren(...KATEGORILER.map((k) => {
        const n = k.id === "hepsi" ? tumu.length : tumu.filter((t) => t.kategori === k.id).length;
        const b = el("button", { type: "button", class: "sy-sec", "aria-pressed": String(kategori === k.id), text: `${k.ad} (${n})` });
        b.addEventListener("click", () => { kategori = k.id; cipleriCiz(); ciz(); });
        return b;
      }));
    };

    const ciz = () => {
      const q = arama.trim().toLocaleLowerCase("tr");
      const gorunen = tumu
        .filter((t) => kategori === "hepsi" || t.kategori === kategori)
        .filter((t) => !q || `${t.sema}.${t.tablo} ${t.aciklama}`.toLocaleLowerCase("tr").includes(q))
        .sort(SIRALAMA[sira].fn);
      const enBuyuk = Math.max(1, ...gorunen.map((t) => Number(t.toplam)));
      const gToplam = gorunen.reduce((n, t) => n + Number(t.toplam), 0);
      ozet.textContent = `${gorunen.length} / ${tumu.length} tablo gösteriliyor · bu listenin toplamı ${bayt(gToplam)}`;
      if (!gorunen.length) {
        liste.replaceChildren(el("li", { class: "muted", text: "Bu filtreyle eşleşen tablo yok." }));
        return;
      }
      liste.replaceChildren(...gorunen.map((t) =>
        el("li", { class: "sy-tablo-satir" },
          el("div", { class: "sy-tablo-ust" },
            el("div", { class: "sy-tablo-ad" },
              el("code", { text: t.sema === "public" ? t.tablo : `${t.sema}.${t.tablo}` }),
              el("span", { class: "sy-etiket", text: KATEGORILER.find((k) => k.id === t.kategori)?.ad || "" }),
              t.sema === "public" && !t.rls ? el("span", { class: "sy-rozet sy-rozet--kritik", text: "RLS kapalı" }) : null
            ),
            el("span", { class: "sy-tablo-boyut", text: bayt(t.toplam) })
          ),
          el("progress", { class: "sy-cubuk sy-cubuk--ince", max: "100", value: String(Math.max(1, Math.round((Number(t.toplam) / enBuyuk) * 100))), "aria-label": `${t.tablo} göreli boyut` }),
          el("p", { class: "sy-tablo-acik", text: t.aciklama }),
          el("p", { class: "sy-tablo-meta" },
            el("span", { text: `Veri ${bayt(t.veri)}` }),
            el("span", { text: `İndeks ${bayt(t.indeks)}` }),
            el("span", { text: `≈ ${Number(t.satir).toLocaleString("tr-TR")} satır` })
          )
        )
      ));
    };

    girdi.addEventListener("input", () => { arama = girdi.value; ciz(); });
    siraSec.addEventListener("change", () => { sira = siraSec.value; ciz(); });
    cipleriCiz();
    ciz();

    const fark = Math.max(0, dbBayt - tabloToplam);
    const kovaListesi = kovalar.length
      ? el("div", {},
          el("strong", { text: "Supabase Storage kovaları" }),
          el("ul", { class: "sy-liste" }, kovalar.map((k) => el("li", {}, el("code", { text: k.kova }), el("span", { class: "muted", text: `${Number(k.adet).toLocaleString("tr-TR")} nesne · ${bayt(k.bayt)}` })))),
          el("p", { class: "muted sy-not", text: "Storage dosyaları veritabanı kotasına değil, ayrı bir depolama kotasına sayılır." })
        )
      : null;

    govde.replaceChildren(
      el("p", { class: "sy-bilgi" }, ikon("kalkan"), el("span", { text: `Her satır tablo + indeks + TOAST (büyük alanlar) toplamıdır. Tablolar toplamı ${bayt(tabloToplam)}; veritabanının geri kalanı (${bayt(fark)}) WAL, sistem kataloğu ve boş alandır.` })),
      el("div", { class: "sy-filtre" }, el("div", { class: "sy-arama" }, ikon("ara"), girdi), siraSec),
      cipler,
      ozet,
      liste,
      kovaListesi
    );
  }

  detay.addEventListener("toggle", () => {
    if (detay.open && !yuklendi) { yuklendi = true; yukle(); }
  });
  kokDb.append(detay);
}

function kota(baslik, ikonMetni, kullanilan, toplam, altSatirlar) {
  const oran = toplam > 0 ? Math.min(kullanilan / toplam, 1) : 0;
  const s = durumSeviyesi(oran);
  const cubuk = el("progress", { class: `sy-cubuk sy-cubuk--${s.sinif}`, max: "100", value: String(Math.round(oran * 1000) / 10), "aria-label": `${baslik} doluluk` });
  return el("article", { class: `sy-kart sy-kota sy-kota--${s.sinif}` },
    el("div", { class: "sy-kota-ust" },
      el("h3", { text: `${ikonMetni} ${baslik}` }),
      el("span", { class: `sy-rozet sy-rozet--${s.sinif}`, text: s.etiket })
    ),
    el("p", { class: "sy-kota-deger" }, el("strong", { text: bayt(kullanilan) }), ` / ${bayt(toplam)}`, el("span", { class: "muted", text: `  (%${(oran * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })})` })),
    cubuk,
    ...altSatirlar
  );
}

export async function depolamaCiz(kok) {
  kok.replaceChildren(el("p", { class: "muted", text: "Depolama durumu yükleniyor…" }));
  const { data: d, error } = await supabase.rpc("sistem_depolama_durumu");
  if (error) {
    kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) }));
    return;
  }

  const dbKota = Number(d.db_kota_bayt) || VARSAYILAN_DB_KOTA;
  const r2Kota = Number(d.r2_kota_bayt) || VARSAYILAN_R2_KOTA;
  let r2Adet = 0;
  let r2Bayt = 0;
  const r2Satirlar = [];
  for (const [k, v] of Object.entries(d.r2 || {})) {
    r2Adet += Number(v.adet) || 0;
    r2Bayt += Number(v.bayt) || 0;
    r2Satirlar.push(el("li", {}, el("span", { text: KAYNAK_ADLARI[k] || k }), el("span", { class: "muted", text: `${Number(v.adet).toLocaleString("tr-TR")} dosya · ${bayt(v.bayt)}` })));
  }

  const dbAlt = [el("p", { class: "muted sy-not", text: "Boyut, PostgreSQL veritabanının anlık toplam boyutudur (Supabase ücretsiz plan kotası: 500 MB)." })];
  if (d.owner) tabloDetayi({ append: (n) => dbAlt.push(n) });

  const tarananKutu = el("div", { class: "sy-taranan", "aria-live": "polite" });
  const r2Alt = [
    el("ul", { class: "sy-liste" }, r2Satirlar),
    el("p", { class: "muted sy-not", text: `Toplam ${r2Adet.toLocaleString("tr-TR")} dosya (veritabanı kayıtlarından hesaplanır; ücretsiz katman referansı: 10 GB).` }),
  ];
  if (d.owner) {
    const tara = dugme({ metin: "R2'yi gerçekten tara", ikonAdi: "ara", tur: "ikincil", kucuk: true });
    tara.addEventListener("click", async () => {
      tara.disabled = true;
      tarananKutu.replaceChildren(el("p", { class: "muted", text: "R2 kovaları taranıyor…" }));
      try {
        const r = await workerFetch("/depolama");
        const g = await r.json();
        if (!r.ok) throw new Error(g.error || `HTTP ${r.status}`);
        tarananKutu.replaceChildren(
          el("ul", { class: "sy-liste" }, Object.entries(g.kaynaklar).map(([k, v]) =>
            el("li", {}, el("span", { text: KAYNAK_ADLARI[k] || k }),
              el("span", { class: "muted", text: v.bagli ? `${v.adet.toLocaleString("tr-TR")} nesne · ${bayt(v.bayt)}${v.kismi ? " (kısmi tarama)" : ""}` : "binding bağlı değil" })))),
          el("p", { class: "muted sy-not", text: "Bu sayılar R2'nin kendisinden gelir; veritabanında kaydı olmayan artık dosyaları da içerir." })
        );
      } catch (h) {
        tarananKutu.replaceChildren(el("p", { class: "auth-message error", text: `Tarama başarısız: ${h.message || h}` }));
      } finally {
        tara.disabled = false;
      }
    });
    r2Alt.push(el("div", { class: "sy-eylemler" }, tara), tarananKutu);
  }

  kok.replaceChildren(
    el("div", { class: "sy-izgara" },
      kota("Supabase Veritabanı", "🗄️", Number(d.db_bayt) || 0, dbKota, dbAlt),
      kota("Cloudflare R2 Depolama", "☁️", r2Bayt, r2Kota, r2Alt)
    )
  );
}
