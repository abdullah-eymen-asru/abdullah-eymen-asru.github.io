/*
 * assets/js/demo/demo-mock-veri.js — Demo / Vitrin Modu: STATİK SAHTE VERİ (hiçbiri gerçek değildir).
 * -----------------------------------------------------------------------
 * Gerçek veri akışı yoktur: bu dosyadaki her şey jenerik/Lorem Ipsum içeriktir ve kod içinde durur.
 * demo-supabase.js, `supabase.from(tablo)` / `supabase.rpc(ad)` çağrılarını buradan yanıtlar.
 * Yalnızca demo modunda, ilk tablo okumasında tembel (dynamic import) yüklenir.
 *
 * İçerik:
 *   • notlar            : 6 sahte not + 2 klasör. Notlar E2EE'dir; bu yüzden çalışma anında DEMO anahtarıyla
 *                         (kasa.js -> demoKasaHazirla, bellek içi rastgele AES-GCM anahtarı) şifrelenip
 *                         gerçek arayüzün çözebileceği ciphertext/iv satırlarına çevrilir.
 *   • akademik_kaynaklar: 4 sahte kaynak (biri "Örnek Makale Taslağı.pdf" — herkese açık, telifsiz örnek PDF).
 *   • r2_arsiv          : sahte klasör/dosya ağacı (örnek PDF, örnek ZIP, örnek görsel; gerçek R2 anahtarı YOK).
 *   • rpc               : yetki/özet/kota RPC'lerinin sabit yanıtları (r2 "1.240 / 100.000 istek" vb.).
 */
import { DEMO_UID, DEMO_PROFIL } from "./demo-durum.js";
import { DEMO_DOSYALARI, DEMO_AKADEMIK_PDF_ID } from "./demo-ag-kalkani.js";

const GUN = 86400000;
const once = (gun, saat = 0) => new Date(Date.now() - gun * GUN - saat * 3600000).toISOString();
const id = (n) => `d3c10000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* ------------------------------------------------------------------ */
/* NOTLAR (şifrelenmeden önceki düz yükler)                             */
/* ------------------------------------------------------------------ */
const K_PROJE = id(101);
const K_DERS = id(102);

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

const NOT_YUKLERI = [
  {
    id: id(1), gun: 1, v: 3, baslik: "Proje Yol Haritası (Örnek)", etiketler: ["planlama", "demo", "yol-haritasi"],
    durum: "devam", kategori: "proje", tarih: "2026-10-05", klasor: K_PROJE, sabit: true, arsiv: false,
    govde: "Çeyrek hedefleri. Aşama 1: keşif. Aşama 2: prototip. Aşama 3: geri bildirim ve yayın. " + LOREM,
    html:
      "<h2>Çeyrek hedefleri</h2><ul><li><strong>Aşama 1 — Keşif:</strong> ihtiyaçların toplanması</li>" +
      "<li><strong>Aşama 2 — Prototip:</strong> ilk çalışan sürüm</li><li><strong>Aşama 3 — Yayın:</strong> geri bildirim ve iyileştirme</li></ul>" +
      `<p>${LOREM}</p>`,
    alintilar: [],
  },
  {
    id: id(2), gun: 2, v: 3, baslik: "Araştırma Özeti Demo", etiketler: ["araştırma", "özet", "demo"],
    durum: "tamam", kategori: "kaynak", tarih: "2026-10-02", klasor: K_PROJE, sabit: false, arsiv: false,
    govde: "Araştırma sorusu, yöntem ve ana bulgular kısaca özetlenmiştir. " + LOREM,
    html:
      "<h2>Araştırma sorusu</h2><p>Dolor sit amet nedir, hangi koşullarda değişir?</p><h2>Yöntem</h2><p>Karma yöntem; örneklem n=120 (örnek).</p>" +
      `<h2>Ana bulgular</h2><ol><li>Consectetur adipiscing elit</li><li>Sed do eiusmod tempor</li></ol><p>${LOREM}</p>`,
    alintilar: [
      { id: id(901), alinti: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", kaynak: "Örnek Makale Taslağı", sayfa: "2", yorum: "Girişte kullanılabilir." },
    ],
  },
  {
    id: id(3), gun: 3, v: 3, baslik: "Toplantı Notları (Örnek)", etiketler: ["toplantı", "demo"],
    durum: "gelen", kategori: "toplanti", tarih: "2026-09-30", klasor: null, sabit: false, arsiv: false,
    govde: "Gündem maddeleri, kararlar ve sorumlular. " + LOREM,
    html: "<h2>Gündem</h2><ul><li>Açılış</li><li>Durum güncellemesi</li><li>Sonraki adımlar</li></ul><h2>Kararlar</h2><p>Lorem ipsum dolor sit amet.</p>",
    alintilar: [],
  },
  {
    id: id(4), gun: 5, v: 3, baslik: "Okuma Listesi — Demo", etiketler: ["okuma", "kaynak", "demo"],
    durum: "devam", kategori: "kaynak", tarih: "2026-09-27", klasor: K_DERS, sabit: false, arsiv: false,
    govde: "Okunacak örnek kaynaklar listesi. " + LOREM,
    html: "<ul><li>Örnek Kitap I — Yazar A</li><li>Örnek Makale II — Yazar B</li><li>Örnek Rapor III — Kurum C</li></ul>",
    alintilar: [],
  },
  {
    id: id(5), gun: 8, v: 3, baslik: "Fikir Defteri (Örnek)", etiketler: ["fikir", "demo"],
    durum: "gelen", kategori: "fikir", tarih: "2026-09-24", klasor: null, sabit: false, arsiv: false,
    govde: "Kısa fikir notları. " + LOREM,
    html: `<p>${LOREM}</p><p>Duis aute irure dolor in reprehenderit in voluptate velit esse.</p>`,
    alintilar: [],
  },
  {
    id: id(6), gun: 12, v: 3, baslik: "Ders Notu: Lorem Ipsum 101", etiketler: ["ders", "demo"],
    durum: "tamam", kategori: "ders", tarih: "2026-09-20", klasor: K_DERS, sabit: false, arsiv: false,
    govde: "Ders notu örneği. " + LOREM,
    html: `<h2>Bölüm 1</h2><p>${LOREM}</p><h2>Bölüm 2</h2><p>Excepteur sint occaecat cupidatat non proident.</p>`,
    alintilar: [],
  },
];

const KLASOR_YUKLERI = [
  { id: K_PROJE, gun: 20, yuk: { v: 2, tur: "klasor", ad: "Örnek Proje", ust: null, simge: "🗂️", sabit: false } },
  { id: K_DERS, gun: 21, yuk: { v: 2, tur: "klasor", ad: "Ders Notları", ust: null, simge: "🎓", sabit: false } },
];

let notSatirlari = null;
/** Notları DEMO kasa anahtarıyla şifreleyip DB satırı biçimine (id, ciphertext, iv, rev, ...) çevirir. */
export async function notSatirlariniHazirla() {
  if (notSatirlari) return notSatirlari;
  const Kasa = await import("../notlar/kasa.js");
  await Kasa.demoKasaHazirla();
  const satirlar = [];
  for (const n of NOT_YUKLERI) {
    const { id: nid, gun, ...yuk } = n;
    const { ciphertext, iv } = await Kasa.notuSifrele(yuk, nid);
    satirlar.push({ id: nid, ciphertext, iv, rev: 1, silindi_at: null, created_at: once(gun + 10), updated_at: once(gun) });
  }
  for (const k of KLASOR_YUKLERI) {
    const { ciphertext, iv } = await Kasa.notuSifrele(k.yuk, k.id);
    satirlar.push({ id: k.id, ciphertext, iv, rev: 1, silindi_at: null, created_at: once(k.gun + 5), updated_at: once(k.gun) });
  }
  notSatirlari = satirlar.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return notSatirlari;
}

/* ------------------------------------------------------------------ */
/* AKADEMİK KÜTÜPHANE                                                   */
/* ------------------------------------------------------------------ */
const kaynak = (n, o) => ({
  id: `d3b20000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  user_id: DEMO_UID,
  yazarlar: [],
  yayin_yili: null,
  dergi_veya_yayinevi: null,
  doi: null,
  isbn: null,
  url: null,
  ozet: null,
  etiketler: [],
  ek_alanlar: {},
  tur: "makale",
  pdf_r2_yolu: null,
  pdf_dosya_adi: null,
  pdf_boyut_bayt: null,
  pdf_rev: 0,
  pdf_guncelleme_tarihi: null,
  gorunurluk: "ozel",
  olusturma_tarihi: once(10),
  guncelleme_tarihi: once(1),
  sahip_ad: DEMO_PROFIL.full_name,
  sahip_eposta: DEMO_PROFIL.email,
  ...o,
});

export const AKADEMIK_KAYNAKLARI = [
  kaynak(1, {
    id: DEMO_AKADEMIK_PDF_ID,
    baslik: "Örnek Makale Taslağı",
    yazarlar: [{ adi: "Ayşe", soyadi: "Örnek" }, { adi: "Mehmet", soyadi: "Demo" }],
    yayin_yili: 2026,
    dergi_veya_yayinevi: "Örnek Bilim Dergisi",
    ozet: "Bu, vitrin modu için hazırlanmış jenerik bir makale taslağıdır. İçerik Lorem Ipsum niteliğindedir; PDF okuyucuyu denemek içindir.",
    etiketler: ["demo", "taslak", "pdf"],
    ek_alanlar: { cilt: "1", sayi: "1", sayfa: "1-2" },
    pdf_r2_yolu: `akademik-kutuphane/users/${DEMO_UID}/ornek-makale-taslagi.pdf`,
    pdf_dosya_adi: "Örnek Makale Taslağı.pdf",
    pdf_boyut_bayt: 46187,
    pdf_rev: 1,
    pdf_guncelleme_tarihi: once(1),
    guncelleme_tarihi: once(0, 3),
  }),
  kaynak(2, {
    baslik: "Örnek Kitap: Yöntem Üzerine Notlar",
    tur: "kitap",
    yazarlar: [{ adi: "Zeynep", soyadi: "Örnek" }],
    yayin_yili: 2024,
    dergi_veya_yayinevi: "Demo Yayınları",
    isbn: "978-0-00-000000-0",
    ozet: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    etiketler: ["demo", "yöntem"],
    ek_alanlar: { sehir: "İstanbul", baski: "1" },
    guncelleme_tarihi: once(4),
  }),
  kaynak(3, {
    baslik: "Örnek Rapor: Genel Değerlendirme",
    tur: "rapor",
    yazarlar: [{ kurum: "Örnek Kurum" }],
    yayin_yili: 2025,
    dergi_veya_yayinevi: "Örnek Kurum Yayınları",
    url: "https://example.com/ornek-rapor",
    etiketler: ["demo", "rapor"],
    guncelleme_tarihi: once(7),
  }),
  kaynak(4, {
    baslik: "Örnek Bildiri: Prototip Sonuçları",
    tur: "bildiri",
    yazarlar: [{ adi: "Can", soyadi: "Demo" }, { adi: "Elif", soyadi: "Örnek" }, { adi: "Burak", soyadi: "Test" }],
    yayin_yili: 2023,
    dergi_veya_yayinevi: "Örnek Kongre 2023",
    doi: "10.0000/ornek.2023.001",
    etiketler: ["demo", "bildiri"],
    guncelleme_tarihi: once(15),
  }),
];

export const AKADEMIK_NOTLARI = [
  { id: "d3b30000-0000-4000-8000-000000000001", kaynak_id: DEMO_AKADEMIK_PDF_ID, user_id: DEMO_UID, tur: "alinti", sayfa: 1, metin: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", yorum: null, created_at: once(1) },
  { id: "d3b30000-0000-4000-8000-000000000002", kaynak_id: DEMO_AKADEMIK_PDF_ID, user_id: DEMO_UID, tur: "yorum", sayfa: 2, metin: null, yorum: "Yöntem bölümü bu haliyle yeterli görünüyor; örneklem açıklaması eklenebilir.", created_at: once(1, 2) },
];

/* ------------------------------------------------------------------ */
/* R2 DOSYA YÖNETİCİSİ (r2_arsiv) — gerçek R2 anahtarı yok               */
/* ------------------------------------------------------------------ */
const D = DEMO_DOSYALARI;
const arsivSatiri = (n, o) => ({
  id: `d3a20000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tur: "dosya", ad: "", klasor_yolu: "", boyut: 0, mime: "application/octet-stream", gercek_mime: null,
  sifreli: false, sahip_id: DEMO_UID, durum: "hazir", created_at: once(3), ad_sira: null, ...o,
});
export const ARSIV_SATIRLARI = [
  arsivSatiri(1, { tur: "klasor", ad: "Belgeler", klasor_yolu: "", created_at: once(30) }),
  arsivSatiri(2, { tur: "klasor", ad: "Görseller", klasor_yolu: "", created_at: once(29) }),
  arsivSatiri(3, { tur: "klasor", ad: "Paketler", klasor_yolu: "", created_at: once(28) }),
  // Kökteki dosya: örnek PDF (id, DEMO_DOSYALARI ile aynı → ağ kalkanı /indir isteğini yerel dosyaya çevirir)
  { ...arsivSatiri(10, { ad: D["d3a10000-0000-4000-8000-000000000001"].ad, klasor_yolu: "", boyut: 46187, mime: "application/pdf", created_at: once(2) }), id: "d3a10000-0000-4000-8000-000000000001" },
  { ...arsivSatiri(11, { ad: D["d3a10000-0000-4000-8000-000000000002"].ad, klasor_yolu: "Paketler/", boyut: 869, mime: "application/zip", created_at: once(2) }), id: "d3a10000-0000-4000-8000-000000000002" },
  { ...arsivSatiri(12, { ad: D["d3a10000-0000-4000-8000-000000000003"].ad, klasor_yolu: "Görseller/", boyut: 564, mime: "image/svg+xml", created_at: once(2) }), id: "d3a10000-0000-4000-8000-000000000003" },
  { ...arsivSatiri(13, { ad: "Örnek Makale Taslağı (kopya).pdf", klasor_yolu: "Belgeler/", boyut: 46187, mime: "application/pdf", created_at: once(5) }), id: "d3a10000-0000-4000-8000-0000000000a1" },
];

/* ------------------------------------------------------------------ */
/* TABLO KAYDI                                                          */
/* ------------------------------------------------------------------ */
const profilSatiri = { ...DEMO_PROFIL, created_at: once(60), updated_at: once(1) };

/** tablo adı → satır dizisi (ya da async üretici). Burada OLMAYAN her tablo boş [] döner. */
const TABLOLAR = {
  profiles: () => [profilSatiri],
  site_ayarlari: () => [{ id: 1, guncel_kvkk_surumu: "v1.0", guncel_riza_surumu: "v1.0", github_io_aktif: true, pages_dev_aktif: true, kilitli_rotalar: { "github.io": [], "pages.dev": [] }, bakim_mesaji: "" }],
  site_settings: () => [{ id: 1, kayitlar_acik: true }],
  notlar: () => notSatirlariniHazirla(),
  not_kasasi: () => [],
  not_ek_kayitlari: () => [],
  akademik_kaynaklar: () => AKADEMIK_KAYNAKLARI,
  akademik_notlar: () => AKADEMIK_NOTLARI,
  akademik_okuyucu_ayarlari: () => [{ id: 1, pdfjs_surum: "5.6.205", pdflib_surum: "1.17.1", updated_at: once(30) }],
  r2_arsiv: () => ARSIV_SATIRLARI,
  ozel_icerik_anahtarlar: () => [],
};

export async function tabloSatirlari(ad) {
  const kaynakFn = TABLOLAR[ad];
  const satirlar = kaynakFn ? await kaynakFn() : [];
  return satirlar.map((s) => ({ ...s })); // çağıran değiştirse bile kaynak bozulmasın
}

/* ------------------------------------------------------------------ */
/* RPC                                                                  */
/* ------------------------------------------------------------------ */
const tumAcik = true;
const RPC_SABIT = {
  // yetkiler (demo: okuma + yükleme/silme düğmeleri GÖRÜNÜR ama eylem kalkana takılır)
  not_modulu_yetkili: tumAcik,
  ozellik_erisimi_var_mi: tumAcik,
  r2_arsiv_yetkilerim: { oku: true, yukle: true, sil: true, paylasilan_var: false },
  is_owner: false,
  is_admin: false,
  sistem_export_yetkisi_var_mi: false,
  donusturucu_yetkisi_var_mi: false,
  hukuki_metin_yetkisi_var_mi: false,
  hesap_silme_inceleme_yetkisi_var_mi: false,
  yetki_ayarlari_yonetim_yetkisi_var_mi: false,
  uye_aktarim_yetkisi_var_mi: false,
  // özet / kota (STATİK vitrin rakamları)
  r2_arsiv_ozet: [{ dosya_sayisi: ARSIV_SATIRLARI.filter((s) => s.tur !== "klasor").length, klasor_sayisi: 3, toplam_boyut: 93807 }],
  r2_kota_durumu: [{ sinif: "A", sayi: 38 }, { sinif: "B", sayi: 1240 }],
  arsiv_benimle_paylasilanlar: [],
  arsiv_kullanici_ara: [],
};

export async function rpcYaniti(ad, args = {}) {
  if (ad === "r2_arsiv_ara") {
    const q = String(args.p_q || "").toLocaleLowerCase("tr").trim().split(/\s+/).filter(Boolean);
    return ARSIV_SATIRLARI.filter((s) => !s.sifreli && q.every((t) => s.ad.toLocaleLowerCase("tr").includes(t))).map((s) => ({ ...s }));
  }
  if (Object.prototype.hasOwnProperty.call(RPC_SABIT, ad)) {
    const v = RPC_SABIT[ad];
    return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
  }
  return undefined; // tanımsız: çağıran null/boş döndürür
}
