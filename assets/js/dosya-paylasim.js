/*
 * assets/js/dosya-paylasim.js
 * -----------------------------------------------------------------------
 * R2 Dosya Paylaşım & Admin Paneli mimarisinin istemci (frontend) tarafı.
 * Supabase JS SDK'nın mevcut oturumunu kullanarak Cloudflare Worker'dan
 * (r2-imza-worker) süreli imzalı indirme linki ister.
 *
 * İki fonksiyon dışa aktarılır:
 *   imzaliLinkUret(dosyaAdi, opts?)  — linki üretir ve panoya kopyalar
 *                                       (admin panelinde "Linki Kopyala"
 *                                       butonu için).
 *   guvenliIndir(dosyaAdi, opts?)    — linki üretir ve TARAYICIYI
 *                                       beklemeden doğrudan indirmeye
 *                                       yönlendirir (kullanıcı tarafı
 *                                       "İndir" butonu için).
 *
 * Kullanım (bir sayfada):
 *   import { imzaliLinkUret, guvenliIndir } from "/assets/js/dosya-paylasim.js";
 *   document.getElementById("kopyala-btn").addEventListener("click", () => {
 *     imzaliLinkUret("3f2504e0-.../rapor.pdf");
 *   });
 *   document.getElementById("indir-btn").addEventListener("click", () => {
 *     guvenliIndir("3f2504e0-.../rapor.pdf");
 *   });
 */
import { supabase } from "./core/supabase-client.js";

// ---- BURAYI DOLDUR: Worker deploy edildikten sonra aldığın URL ----
// ör. "https://r2-imza-worker.KULLANICI-ADIN.workers.dev"
// veya kendi domainine bağladıysan (Custom Domain) o adres.
const WORKER_URL = "https://r2-imza-worker.aeymena.workers.dev";
// ---------------------------------------------------------------------

const VARSAYILAN_GECERLILIK_SANIYE = 3600; // 1 saat

/**
 * Worker'dan imzalı bir indirme URL'i ister. Her iki dışa açık fonksiyon
 * da (imzaliLinkUret, guvenliIndir) bunu kullanır.
 *
 * @param {string} dosyaAdi - R2 bucket içindeki tam nesne yolu (key).
 * @param {{ expiresIn?: number }} [opts]
 * @returns {Promise<{ url: string, expiresAt: string }>}
 */
async function presignedLinkIste(dosyaAdi, opts = {}) {
  if (!dosyaAdi || typeof dosyaAdi !== "string") {
    throw new Error("Geçerli bir dosya adı/yolu belirtmelisin.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Bu işlem için giriş yapmış olmalısın.");
  }

  const expiresIn = opts.expiresIn ?? VARSAYILAN_GECERLILIK_SANIYE;
  const url = new URL(WORKER_URL);
  url.searchParams.set("key", dosyaAdi);
  url.searchParams.set("expiresIn", String(expiresIn));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  let body;
  try {
    body = await res.json();
  } catch (_e) {
    throw new Error(`Sunucudan beklenmeyen yanıt (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(body?.error || `İstek başarısız oldu (HTTP ${res.status}).`);
  }
  return body; // { url, expiresAt, key, expiresIn }
}

/**
 * FONKSİYON 1 (Admin/Genel Kullanım)
 * Verilen dosya için 1 saat (veya opts.expiresIn) geçerli imzalı indirme
 * linkini üretir ve panoya (clipboard) kopyalar. Admin panelinde "Linki
 * Kopyala" gibi bir butona bağlamak için idealdir.
 *
 * @param {string} dosyaAdi - R2 bucket içindeki tam nesne yolu.
 * @param {{ expiresIn?: number, onBaslarken?: () => void, onBasarili?: (sonuc: {url:string, expiresAt:string}) => void, onHata?: (err: Error) => void }} [opts]
 */
export async function imzaliLinkUret(dosyaAdi, opts = {}) {
  try {
    opts.onBaslarken?.();
    const sonuc = await presignedLinkIste(dosyaAdi, opts);

    // Panoya kopyala (clipboard API HTTPS/localhost gerektirir — admin
    // panelin zaten öyle çalışıyor).
    try {
      await navigator.clipboard.writeText(sonuc.url);
    } catch (_panoHatasi) {
      // Clipboard API başarısız olursa (ör. tarayıcı izni yok) linki
      // yine de kullanıcıya geri döndürüyoruz; çağıran taraf isterse
      // kendi UI'ında gösterebilir.
    }

    opts.onBasarili?.(sonuc);
    return sonuc;
  } catch (err) {
    opts.onHata?.(err);
    throw err;
  }
}

/**
 * FONKSİYON 2 (Kullanıcı Tarafı / Doğrudan İndirme)
 * Kullanıcının oturumunu doğrulayıp imzalı bir link üretir ve tarayıcıyı
 * ARKA PLANDA BEKLETMEDEN doğrudan o adrese yönlendirerek indirmeyi
 * başlatır (gizli bir <a download> tıklaması ile — yeni sekme/pop-up
 * engelleyicilere takılmaz).
 *
 * @param {string} dosyaAdi - R2 bucket içindeki tam nesne yolu.
 * @param {{ expiresIn?: number, dosyaGorunenAdi?: string, onBaslarken?: () => void, onBasarili?: () => void, onHata?: (err: Error) => void }} [opts]
 */
export async function guvenliIndir(dosyaAdi, opts = {}) {
  try {
    opts.onBaslarken?.();
    const sonuc = await presignedLinkIste(dosyaAdi, opts);

    const a = document.createElement("a");
    a.href = sonuc.url;
    // "download" attribute'u sadece AYNI ORIJİN linklerde dosya adını
    // zorlayabilir; R2 (farklı origin) presigned URL'lerinde tarayıcı
    // genelde Content-Disposition başlığına göre davranır — yine de
    // belirtmek zararsızdır ve bazı tarayıcılarda ipucu olarak kullanılır.
    if (opts.dosyaGorunenAdi) a.download = opts.dosyaGorunenAdi;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    opts.onBasarili?.();
  } catch (err) {
    opts.onHata?.(err);
    throw err;
  }
}
