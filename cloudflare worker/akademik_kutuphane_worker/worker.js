/**
 * akademik-kutuphane-worker — Cloudflare Worker
 * -----------------------------------------------------------------------
 * "Akademik Kütüphane" PDF'lerinin R2'deki güvenli kapısı. Okuma (Range destekli),
 * yazma/üzerine yazma (PDF açıklamalarının geri yazımı), silme ve (isteğe bağlı) çok büyük
 * dosyalar için imzalı yükleme. Hepsi Supabase JWT'si ile doğrulanır.
 *
 * R2 YOLU:  akademik-kutuphane/users/<user_id>/<dosya_adi>.pdf
 *
 * BOYUT / KOTA: bu kodda HİÇBİR dosya boyutu ya da kullanıcı kotası sınırı YOKTUR (bilinçli istek).
 * Tek fiziksel sınır Cloudflare'in kendi "istek gövdesi" üst sınırıdır (Free/Pro 100 MB, Business
 * 200 MB, Enterprise 500 MB). Bunun üstündeki dosyalar için istemci otomatik olarak
 * /yukleme-imzasi uç noktasına geçer (tarayıcı R2'ye doğrudan, bu Worker'ın verdiği süreli imzalı
 * adresle yazar; Worker yine JWT'yi doğrular). O yol için R2_* secret'ları gerekir (rehber § 4.9).
 *
 * API (hepsi Authorization: Bearer <supabase access_token>; GET /saglik hariç)
 *   GET    /pdf/<kaynak_id>                  → PDF (Range destekli; ?indir=1 → indirme başlığı)
 *   PUT    /pdf/<kaynak_id>                  → gövde = PDF baytları (sadece kaynağın sahibi)
 *                                              başlıklar: X-Dosya-Adi (URI-encoded, ilk yüklemede),
 *                                                         X-Beklenen-Rev (iyimser kilit, isteğe bağlı)
 *   DELETE /pdf/<kaynak_id>                  → R2'den siler, satırın pdf_* alanlarını temizler
 *   POST   /pdf/<kaynak_id>/onceki-surum     → son geri yazımdan önceki kopyayı geri yükler
 *   POST   /pdf/<kaynak_id>/yukleme-imzasi   → {dosya_adi} → süreli imzalı PUT adresi (büyük dosya)
 *   POST   /pdf/<kaynak_id>/yukleme-tamam    → {anahtar} → R2'yi doğrula, satırı güncelle
 *   GET    /meta?url=<https adresi>          → makale sayfasındaki citation_* / Dublin Core / OpenGraph
 *                                              meta etiketlerinden künye önerisi (tarayıcı başka sitelerin
 *                                              HTML'ini CORS yüzünden okuyamaz; bu yüzden sunucuda yapılır)
 *   GET    /saglik                           → {ok, buyuk_dosya_imzasi}
 *
 * YETKİ (service_role YOK — Worker kullanıcının KENDİ jetonuyla Supabase'e sorar, RLS geçerlidir):
 *   - akademik_kutuphane_yetkili()  (Yetki Ayarları matrisi; kapalıysa 403)
 *   - Satırı görebilmek RLS'e bağlıdır: sahibi / paylaşım (ekip, herkese_acik) / owner (salt okuma)
 *   - Yazma/silme: yalnızca kaynağın sahibi. owner bile başkasının PDF'ini değiştiremez.
 *   - R2 anahtarı DB'deki pdf_r2_yolu'ndan gelir ve "akademik-kutuphane/users/<sahip uid>/" önekine
 *     BİREBİR uymalıdır (DB'de CHECK de var — iki bağımsız savunma).
 *
 * Ortam değişkenleri (Worker > Settings > Variables and Secrets):
 *   SUPABASE_URL        https://<proje-ref>.supabase.co                      (Text)
 *   SUPABASE_ANON_KEY   herkese açık anon key                                 (Text)
 *   — yalnızca büyük dosya imzası için (isteğe bağlı) —
 *   ACCOUNT_ID          Cloudflare hesap kimliği                              (Text)
 *   BUCKET_NAME         bu Worker'ın AKADEMIK_BUCKET'ına bağlı kovanın adı     (Text)
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   R2 API token çifti               (Secret)
 * R2 Binding:  AKADEMIK_BUCKET → akademik kütüphane kovası
 * -----------------------------------------------------------------------
 */

const IZINLI_ORIGINLER = [
  "https://abdullah-eymen-asru.github.io",
  "https://abdullah-eymen-asru.pages.dev",
  "http://localhost:4000",
  "http://127.0.0.1:5500",
];

const ANAHTAR_ONEKI = "akademik-kutuphane/users/";
const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMZA_SURESI_SN = 3600;
const enc = new TextEncoder();

/* ----------------------------- yardımcılar ----------------------------- */

function json(govde, durum, cors, ek = {}) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...cors, ...ek, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function dosyaAdiTemizle(ham) {
  let ad = String(ham || "");
  try { ad = decodeURIComponent(ad); } catch { /* ham haliyle devam */ }
  ad = ad.split(/[\\/]/).pop() || "";
  ad = ad.replace(/\.pdf$/i, "").normalize("NFKC");
  ad = ad.replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/\s+/g, " ").replace(/-{2,}/g, "-");
  ad = ad.replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 120);
  return ad || "belge";
}

function anahtarGecerliMi(anahtar, sahipId) {
  return (
    typeof anahtar === "string" &&
    anahtar.startsWith(`${ANAHTAR_ONEKI}${String(sahipId).toLowerCase()}/`) &&
    anahtar.toLowerCase().endsWith(".pdf") &&
    !anahtar.includes("..") &&
    !anahtar.includes("\\") &&
    anahtar.length <= 400
  );
}

const oncekiAnahtar = (sahipId, kaynakId) => `${ANAHTAR_ONEKI}${sahipId}/.onceki/${kaynakId}.pdf`;

/* ------------------------------ Supabase ------------------------------- */

async function kimlikDogrula(env, istek) {
  const baslik = istek.headers.get("Authorization") || "";
  if (!baslik.startsWith("Bearer ")) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: baslik, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const uid = String((await r.json()).id || "").toLowerCase();
    return UUID_DESENI.test(uid) ? { uid, baslik } : null;
  } catch {
    return null;
  }
}

const servisBasliklari = (env, kim) => ({ apikey: env.SUPABASE_ANON_KEY, Authorization: kim.baslik });

async function kutuphaneYetkiliMi(env, kim) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/akademik_kutuphane_yetkili`, {
    method: "POST",
    headers: { ...servisBasliklari(env, kim), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error("rpc");
  return (await r.json()) === true;
}

/** Satırı kullanıcının KENDİ jetonuyla çeker: RLS görünür değilse boş döner. */
async function kaynakGetir(env, kim, id) {
  const sorgu =
    "select=id,user_id,pdf_r2_yolu,pdf_dosya_adi,pdf_boyut_bayt,pdf_rev,gorunurluk";
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/akademik_kaynaklar?id=eq.${id}&${sorgu}`, {
    headers: servisBasliklari(env, kim),
  });
  if (!r.ok) throw new Error("kaynak");
  const satirlar = await r.json();
  return satirlar[0] || null;
}

async function kaynakGuncelle(env, kim, id, alanlar) {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/akademik_kaynaklar?id=eq.${id}&user_id=eq.${kim.uid}`,
    {
      method: "PATCH",
      headers: {
        ...servisBasliklari(env, kim),
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(alanlar),
    }
  );
  if (!r.ok) return null;
  const satirlar = await r.json();
  return satirlar[0] || null;
}

/* ------------------------- SigV4 (büyük dosya imzası) ------------------------- */

const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(anahtar, veri) {
  const k = await crypto.subtle.importKey("raw", anahtar, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, typeof veri === "string" ? enc.encode(veri) : veri);
}
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

function imzaYapilandirildiMi(env) {
  return !!(env.ACCOUNT_ID && env.BUCKET_NAME && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

async function presignPut(env, key) {
  const host = `${env.ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bolge = "auto", servis = "s3";
  const amzTarih = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const gun = amzTarih.slice(0, 8);
  const kapsam = `${gun}/${bolge}/${servis}/aws4_request`;
  const sorgu = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${kapsam}`,
    "X-Amz-Date": amzTarih,
    "X-Amz-Expires": String(IMZA_SURESI_SN),
    "X-Amz-SignedHeaders": "host",
  };
  const kanonikSorgu = Object.keys(sorgu).sort().map((k) => `${rfc3986(k)}=${rfc3986(sorgu[k])}`).join("&");
  const yol = `/${env.BUCKET_NAME}/${key.split("/").map(rfc3986).join("/")}`;
  const kanonikIstek = ["PUT", yol, kanonikSorgu, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const imzalanacak = ["AWS4-HMAC-SHA256", amzTarih, kapsam, await sha256Hex(kanonikIstek)].join("\n");
  let k = await hmac(enc.encode("AWS4" + env.R2_SECRET_ACCESS_KEY), gun);
  k = await hmac(k, bolge); k = await hmac(k, servis); k = await hmac(k, "aws4_request");
  return `https://${host}${yol}?${kanonikSorgu}&X-Amz-Signature=${hex(await hmac(k, imzalanacak))}`;
}


/* --------------------------- URL → künye önerisi --------------------------- */

const META_UST_SINIR_BAYT = 1024 * 1024; // yalnızca <head> gerekir; 1 MB'ta kesilir

function ozelAdresMi(host) {
  // Cloudflare Workers zaten iç ağa ulaşamaz; yine de açık bir kötüye kullanım reddi:
  return (
    /^(localhost|.*\.local|.*\.internal)$/i.test(host) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^\[?(::1|fc|fd|fe80)/i.test(host) ||
    !host.includes(".")
  );
}

async function urlKunyesi(env, istek, cors) {
  const hedef = new URL(istek.url).searchParams.get("url") || "";
  let u;
  try { u = new URL(hedef); } catch { return json({ error: "Geçersiz adres." }, 400, cors); }
  if (u.protocol !== "https:" || ozelAdresMi(u.hostname)) {
    return json({ error: "Yalnızca herkese açık https adresleri çözümlenir." }, 400, cors);
  }

  let yanit;
  try {
    yanit = await fetch(u.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AkademikKutuphane/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      cf: { cacheTtl: 300 },
    });
  } catch {
    return json({ error: "Sayfaya ulaşılamadı." }, 502, cors);
  }
  const tur = yanit.headers.get("Content-Type") || "";
  if (!yanit.ok || !/html|xml/i.test(tur)) {
    return json({ error: `Sayfa okunamadı (HTTP ${yanit.status}) ya da HTML değil.` }, 422, cors);
  }

  // Gövdenin yalnızca başını oku (</head>'e ya da 1 MB'a kadar).
  const okuyucu = yanit.body.getReader();
  const dec = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let okunan = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    okunan += value.byteLength;
    html += dec.decode(value, { stream: true });
    if (/<\/head\s*>/i.test(html) || okunan >= META_UST_SINIR_BAYT) break;
  }
  await okuyucu.cancel().catch(() => {});

  const meta = {};
  const ekle = (ad, deger) => {
    const k = String(ad || "").trim().toLowerCase();
    const v = String(deger || "").replace(/\s+/g, " ").trim();
    if (!k || !v) return;
    (meta[k] ||= []).push(v);
  };
  let baslikMetni = "";
  await new HTMLRewriter()
    .on("meta", {
      element(e) {
        ekle(e.getAttribute("name") || e.getAttribute("property"), e.getAttribute("content"));
      },
    })
    .on("title", { text(t) { baslikMetni += t.text; } })
    .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();

  const ilk = (...anahtarlar) => {
    for (const a of anahtarlar) if (meta[a]?.length) return meta[a][0];
    return "";
  };
  const hepsi = (...anahtarlar) => {
    for (const a of anahtarlar) if (meta[a]?.length) return meta[a];
    return [];
  };
  const tarih = ilk("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "dc.date.issued", "article:published_time", "date");
  const yil = (/(\d{4})/.exec(tarih) || [])[1] || "";
  const sayfaBas = ilk("citation_firstpage");
  const sayfaSon = ilk("citation_lastpage");

  return json(
    {
      ok: true,
      kunye: {
        baslik: ilk("citation_title", "dc.title", "og:title", "twitter:title") || baslikMetni.replace(/\s+/g, " ").trim(),
        yazarlar: hepsi("citation_author", "dc.creator", "article:author", "author"),
        yil,
        tarih,
        dergi: ilk("citation_journal_title", "citation_conference_title", "prism.publicationname"),
        cilt: ilk("citation_volume", "prism.volume"),
        sayi: ilk("citation_issue", "prism.number"),
        sayfa: sayfaBas ? (sayfaSon ? `${sayfaBas}-${sayfaSon}` : sayfaBas) : "",
        doi: ilk("citation_doi", "dc.identifier.doi", "prism.doi", "doi"),
        isbn: ilk("citation_isbn", "books:isbn"),
        ozet: ilk("citation_abstract", "dc.description", "og:description", "description"),
        yayinevi: ilk("citation_publisher", "dc.publisher"),
        site: ilk("og:site_name"),
        pdf_url: ilk("citation_pdf_url"),
        url: yanit.url || u.toString(),
      },
    },
    200,
    cors
  );
}

/* ------------------------------ Range çözümü ------------------------------ */

/** R2'nin döndürdüğü range'i (offset/length ya da suffix) [baslangic, bitis] bayt aralığına çevirir. */
function aralikHesapla(range, boyut) {
  if (!range) return null;
  let bas, uzunluk;
  if (range.suffix !== undefined) {
    uzunluk = Math.min(range.suffix, boyut);
    bas = boyut - uzunluk;
  } else {
    bas = range.offset ?? 0;
    uzunluk = range.length ?? boyut - bas;
  }
  return [bas, Math.min(boyut - 1, bas + uzunluk - 1)];
}

/* ------------------------------ işleyiciler ------------------------------- */

async function pdfOku(env, istek, kim, kaynak, cors) {
  if (!kaynak.pdf_r2_yolu || !anahtarGecerliMi(kaynak.pdf_r2_yolu, kaynak.user_id)) {
    return json({ error: "Bu kaynağın PDF'i yok." }, 404, cors);
  }
  const url = new URL(istek.url);
  const aralikIstendi = istek.headers.has("Range");
  const nesne = await env.AKADEMIK_BUCKET.get(kaynak.pdf_r2_yolu, aralikIstendi ? { range: istek.headers } : undefined);
  if (!nesne) return json({ error: "PDF R2'de bulunamadı." }, 404, cors);

  const indir = url.searchParams.get("indir") === "1";
  const ad = `${dosyaAdiTemizle(kaynak.pdf_dosya_adi || kaynak.pdf_r2_yolu.split("/").pop())}.pdf`;
  const basliklar = {
    ...cors,
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    ETag: nesne.httpEtag,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Pdf-Rev": String(kaynak.pdf_rev ?? 0),
    "Content-Disposition": `${indir ? "attachment" : "inline"}; filename*=UTF-8''${rfc3986(ad)}`,
  };

  const aralik = aralikIstendi ? aralikHesapla(nesne.range, nesne.size) : null;
  if (aralik) {
    basliklar["Content-Range"] = `bytes ${aralik[0]}-${aralik[1]}/${nesne.size}`;
    basliklar["Content-Length"] = String(aralik[1] - aralik[0] + 1);
    return new Response(nesne.body, { status: 206, headers: basliklar });
  }
  basliklar["Content-Length"] = String(nesne.size);
  return new Response(nesne.body, { status: 200, headers: basliklar });
}

/** İlk yüklemede yeni anahtar üretir; mevcutsa onu korur (üzerine yazma). */
async function anahtarBelirle(env, kaynak, kim, dosyaAdiHam) {
  if (kaynak.pdf_r2_yolu && anahtarGecerliMi(kaynak.pdf_r2_yolu, kim.uid)) return kaynak.pdf_r2_yolu;
  const taban = `${ANAHTAR_ONEKI}${kim.uid}/${dosyaAdiTemizle(dosyaAdiHam)}`;
  let anahtar = `${taban}.pdf`;
  if (await env.AKADEMIK_BUCKET.head(anahtar)) anahtar = `${taban}-${kaynak.id.slice(0, 8)}.pdf`;
  return anahtar;
}

async function pdfYaz(env, istek, kim, kaynak, cors) {
  const beklenen = istek.headers.get("X-Beklenen-Rev");
  if (beklenen !== null && Number(beklenen) !== Number(kaynak.pdf_rev ?? 0)) {
    return json(
      { error: "PDF başka bir sekmede/cihazda güncellenmiş. Sayfayı yenileyip tekrar dene.", rev: kaynak.pdf_rev },
      409,
      cors
    );
  }

  const uzunluk = parseInt(istek.headers.get("Content-Length") || "0", 10);
  if (!istek.body || !uzunluk || uzunluk < 8) return json({ error: "Boş ya da geçersiz gövde." }, 400, cors);

  // PDF imzası: "%PDF-" ilk 1024 baytın içinde olmalı (PDF belirtimi). Ön tampon akışa geri verilir.
  const okuyucu = istek.body.getReader();
  const onTampon = [];
  let toplam = 0;
  let baslikOk = false;
  while (toplam < 1024) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    onTampon.push(value);
    toplam += value.byteLength;
    const bakilan = new Uint8Array(await new Blob(onTampon).arrayBuffer()).subarray(0, 1024);
    if (new TextDecoder("latin1").decode(bakilan).includes("%PDF-")) { baslikOk = true; break; }
  }
  if (!baslikOk) {
    await okuyucu.cancel().catch(() => {});
    return json({ error: "Bu dosya geçerli bir PDF değil." }, 415, cors);
  }

  const anahtar = await anahtarBelirle(env, kaynak, kim, istek.headers.get("X-Dosya-Adi"));
  const yeniMi = anahtar !== kaynak.pdf_r2_yolu;

  // Üzerine yazmadan önce bir önceki sürümü sakla (en iyi gayret; başarısız olursa kayıt engellenmez).
  if (!yeniMi) {
    try {
      const eski = await env.AKADEMIK_BUCKET.get(anahtar);
      if (eski) {
        await env.AKADEMIK_BUCKET.put(oncekiAnahtar(kim.uid, kaynak.id), eski.body, {
          httpMetadata: { contentType: "application/pdf" },
        });
      }
    } catch (_e) { /* yedek alınamadı; devam */ }
  }

  const { readable, writable } = new FixedLengthStream(uzunluk);
  const yazici = writable.getWriter();
  const koyma = env.AKADEMIK_BUCKET.put(anahtar, readable, { httpMetadata: { contentType: "application/pdf" } });
  const pompa = (async () => {
    try {
      for (const parca of onTampon) await yazici.write(parca);
      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        await yazici.write(value);
      }
      await yazici.close();
    } catch (hata) {
      await yazici.abort(hata).catch(() => {});
      throw hata;
    }
  })();
  const [nesne] = await Promise.all([koyma, pompa]);

  const adHam = istek.headers.get("X-Dosya-Adi");
  const guncel = await kaynakGuncelle(env, kim, kaynak.id, {
    pdf_r2_yolu: anahtar,
    ...(yeniMi || adHam ? { pdf_dosya_adi: `${dosyaAdiTemizle(adHam || kaynak.pdf_dosya_adi)}.pdf` } : {}),
    pdf_boyut_bayt: nesne.size,
    pdf_rev: Number(kaynak.pdf_rev ?? 0) + 1,
    pdf_guncelleme_tarihi: new Date().toISOString(),
  });
  if (!guncel) {
    return json({ error: "PDF R2'ye yazıldı ama kayıt güncellenemedi. Tekrar kaydetmeyi dene." }, 502, cors);
  }
  return json({ ok: true, boyut: nesne.size, rev: guncel.pdf_rev, yol: anahtar }, 200, cors);
}

async function pdfSil(env, kim, kaynak, cors) {
  if (kaynak.pdf_r2_yolu && anahtarGecerliMi(kaynak.pdf_r2_yolu, kim.uid)) {
    await env.AKADEMIK_BUCKET.delete(kaynak.pdf_r2_yolu);
  }
  await env.AKADEMIK_BUCKET.delete(oncekiAnahtar(kim.uid, kaynak.id)).catch(() => {});
  const guncel = await kaynakGuncelle(env, kim, kaynak.id, {
    pdf_r2_yolu: null,
    pdf_dosya_adi: null,
    pdf_boyut_bayt: null,
    pdf_guncelleme_tarihi: null,
    pdf_rev: Number(kaynak.pdf_rev ?? 0) + 1,
  });
  if (!guncel) return json({ error: "PDF silindi ama kayıt güncellenemedi." }, 502, cors);
  return json({ ok: true }, 200, cors);
}

async function oncekiSurumuGeriYukle(env, kim, kaynak, cors) {
  if (!kaynak.pdf_r2_yolu || !anahtarGecerliMi(kaynak.pdf_r2_yolu, kim.uid)) {
    return json({ error: "Bu kaynağın PDF'i yok." }, 404, cors);
  }
  const onceki = await env.AKADEMIK_BUCKET.get(oncekiAnahtar(kim.uid, kaynak.id));
  if (!onceki) return json({ error: "Geri yüklenecek önceki sürüm yok." }, 404, cors);
  const boyut = onceki.size;
  await env.AKADEMIK_BUCKET.put(kaynak.pdf_r2_yolu, onceki.body, { httpMetadata: { contentType: "application/pdf" } });
  const guncel = await kaynakGuncelle(env, kim, kaynak.id, {
    pdf_boyut_bayt: boyut,
    pdf_rev: Number(kaynak.pdf_rev ?? 0) + 1,
    pdf_guncelleme_tarihi: new Date().toISOString(),
  });
  if (!guncel) return json({ error: "Geri yüklendi ama kayıt güncellenemedi." }, 502, cors);
  return json({ ok: true, boyut, rev: guncel.pdf_rev }, 200, cors);
}

async function yuklemeImzasi(env, istek, kim, kaynak, cors) {
  if (!imzaYapilandirildiMi(env)) {
    return json({ error: "Çok büyük dosya imzası bu Worker'da yapılandırılmamış (ACCOUNT_ID, BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)." }, 501, cors);
  }
  let g = {};
  try { g = await istek.json(); } catch { /* boş */ }
  const anahtar = await anahtarBelirle(env, kaynak, kim, g.dosya_adi);
  const url = await presignPut(env, anahtar);
  return json({ ok: true, url, anahtar, rev: kaynak.pdf_rev ?? 0, sure_sn: IMZA_SURESI_SN }, 200, cors);
}

async function yuklemeTamam(env, istek, kim, kaynak, cors) {
  let g = {};
  try { g = await istek.json(); } catch { /* boş */ }
  if (!anahtarGecerliMi(g.anahtar, kim.uid)) return json({ error: "Geçersiz anahtar." }, 400, cors);
  const nesne = await env.AKADEMIK_BUCKET.head(g.anahtar);
  if (!nesne || !nesne.size) return json({ error: "R2'de yüklenmiş dosya bulunamadı." }, 404, cors);

  // İlk 1 KB'ta %PDF- doğrulaması (imzalı yüklemede gövdeyi Worker görmediği için burada yapılır).
  const bas = await env.AKADEMIK_BUCKET.get(g.anahtar, { range: { offset: 0, length: Math.min(1024, nesne.size) } });
  const metin = bas ? new TextDecoder("latin1").decode(await bas.arrayBuffer()) : "";
  if (!metin.includes("%PDF-")) {
    await env.AKADEMIK_BUCKET.delete(g.anahtar);
    return json({ error: "Yüklenen dosya geçerli bir PDF değil; silindi." }, 415, cors);
  }

  const yeniMi = g.anahtar !== kaynak.pdf_r2_yolu;
  const guncel = await kaynakGuncelle(env, kim, kaynak.id, {
    pdf_r2_yolu: g.anahtar,
    ...(yeniMi || g.dosya_adi ? { pdf_dosya_adi: `${dosyaAdiTemizle(g.dosya_adi || g.anahtar.split("/").pop())}.pdf` } : {}),
    pdf_boyut_bayt: nesne.size,
    pdf_rev: Number(kaynak.pdf_rev ?? 0) + 1,
    pdf_guncelleme_tarihi: new Date().toISOString(),
  });
  if (!guncel) return json({ error: "Kayıt güncellenemedi." }, 502, cors);
  return json({ ok: true, boyut: nesne.size, rev: guncel.pdf_rev, yol: g.anahtar }, 200, cors);
}

/* --------------------------------- giriş --------------------------------- */

export default {
  async fetch(istek, env) {
    const origin = istek.headers.get("Origin") || "";
    const izinli = IZINLI_ORIGINLER.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": izinli ? origin : IZINLI_ORIGINLER[0],
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-Dosya-Adi, X-Beklenen-Rev",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, X-Pdf-Rev, Content-Disposition",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!izinli) return json({ error: "Erişim reddedildi: yetkisiz Origin." }, 403, cors);

    const url = new URL(istek.url);
    if (istek.method === "GET" && url.pathname === "/saglik") {
      return json({ ok: true, buyuk_dosya_imzasi: imzaYapilandirildiMi(env) }, 200, cors);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.AKADEMIK_BUCKET) {
      return json({ error: "Worker yapılandırması eksik (SUPABASE_URL, SUPABASE_ANON_KEY, AKADEMIK_BUCKET)." }, 500, cors);
    }

    if (url.pathname === "/meta") {
      if (istek.method !== "GET") return json({ error: "Desteklenmeyen yöntem." }, 405, cors);
      const kimMeta = await kimlikDogrula(env, istek);
      if (!kimMeta) return json({ error: "Giriş gerekli ya da oturum doğrulanamadı." }, 401, cors);
      try {
        if (!(await kutuphaneYetkiliMi(env, kimMeta))) {
          return json({ error: "Akademik Kütüphane hesabın için kapalı ya da yetkin yok." }, 403, cors);
        }
      } catch {
        return json({ error: "Yetki doğrulanamadı." }, 502, cors);
      }
      return urlKunyesi(env, istek, cors);
    }

    const eslesme = /^\/pdf\/([0-9a-f-]{36})(?:\/(onceki-surum|yukleme-imzasi|yukleme-tamam))?$/i.exec(url.pathname);
    if (!eslesme || !UUID_DESENI.test(eslesme[1])) return json({ error: "Bulunamadı." }, 404, cors);
    const kaynakId = eslesme[1].toLowerCase();
    const eylem = eslesme[2] || null;

    const izinliYontemler = eylem ? ["POST"] : ["GET", "PUT", "DELETE"];
    if (!izinliYontemler.includes(istek.method)) return json({ error: "Desteklenmeyen yöntem." }, 405, cors);

    const kim = await kimlikDogrula(env, istek);
    if (!kim) return json({ error: "Giriş gerekli ya da oturum doğrulanamadı." }, 401, cors);

    try {
      if (!(await kutuphaneYetkiliMi(env, kim))) {
        return json({ error: "Akademik Kütüphane hesabın için kapalı ya da yetkin yok." }, 403, cors);
      }
    } catch {
      return json({ error: "Yetki doğrulanamadı." }, 502, cors);
    }

    let kaynak;
    try {
      kaynak = await kaynakGetir(env, kim, kaynakId);
    } catch {
      return json({ error: "Kaynak okunamadı." }, 502, cors);
    }
    // RLS görünür kılmadıysa 404 (varlığı bile sızdırılmaz).
    if (!kaynak) return json({ error: "Kaynak bulunamadı." }, 404, cors);

    try {
      if (istek.method === "GET") return await pdfOku(env, istek, kim, kaynak, cors);

      // Buradan sonrası yazma işlemi: yalnızca sahibi.
      if (String(kaynak.user_id).toLowerCase() !== kim.uid) {
        return json({ error: "Bu kaynağı yalnızca sahibi değiştirebilir." }, 403, cors);
      }
      if (eylem === "onceki-surum") return await oncekiSurumuGeriYukle(env, kim, kaynak, cors);
      if (eylem === "yukleme-imzasi") return await yuklemeImzasi(env, istek, kim, kaynak, cors);
      if (eylem === "yukleme-tamam") return await yuklemeTamam(env, istek, kim, kaynak, cors);
      if (istek.method === "PUT") return await pdfYaz(env, istek, kim, kaynak, cors);
      if (istek.method === "DELETE") return await pdfSil(env, kim, kaynak, cors);
      return json({ error: "Desteklenmeyen yöntem." }, 405, cors);
    } catch (hata) {
      return json({ error: "Depolama hatası: " + (hata?.message || "bilinmiyor") }, 500, cors);
    }
  },
};
