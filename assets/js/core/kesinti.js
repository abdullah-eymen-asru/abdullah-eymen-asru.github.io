/*
 * assets/js/core/kesinti.js — SUPABASE KESİNTİ DAYANIKLILIĞI (sıfır Cloudflare kotası)
 * -----------------------------------------------------------------------------------------------------------------
 * Amaç: Supabase sunucularında sorun olduğunda kullanıcı (1) durumu ANLASIN, (2) eski oturumuyla eski verilerini görebilsin,
 * (3) yeni işlemlerini kaybetmesin, (4) oturumu açık olmasa bile — daha önce bu cihazdan giriş yaptıysa — şifresiyle girebilsin.
 *
 * 1) SAĞLIK İZLEME — tarayıcı DOĞRUDAN Supabase projesine bakar (Worker / Pages Function / Cloudflare isteği YOK):
 *      GET /auth/v1/health  (giriş servisi)  ·  GET /rest/v1/worker_anahtarlari?limit=1 (veritabanı/REST)
 *    Ağın kendisi mi gitti, Supabase mi? → aynı kaynak (site) /surum.json ile ayrılır. Sekmeler arası tek kontrol (localStorage).
 * 2) OKUMA ÖNBELLEĞİ — PostgREST GET (ve okuma-türü RPC) yanıtları IndexedDB'ye AES-GCM ile şifreli yazılır. Ağ/sunucu hatasında
 *    (fetch hatası, 502/503/504/52x, zaman aşımı) son başarılı kopya döner; yanıt başlığı X-Aea-Onbellek: 1 taşır.
 * 3) YAZMA KUYRUĞU — tablo yazmaları (POST/PATCH/DELETE /rest/v1/<tablo>) sunucuya ulaşamazsa cihazda şifreli kuyruğa alınır,
 *    arayüze "başarılı" benzeri sentetik yanıt döner; sunucu dönünce SIRAYLA gönderilir. RPC/Storage/Edge Function KUYRUĞA ALINMAZ
 *    (dönüş değerine/ayrıcalığa bağlıdır; dürüst hata verilir). Eski/yıkıcı işlemler otomatik değil, kullanıcı onayıyla gönderilir.
 * 4) ÇEVRİMDIŞI GİRİŞ KASASI (opt-in; 2FA'lı hesapta KAPALI) — girişte parola ile PBKDF2 → AES-GCM sarmalı cihaz anahtarı saklanır.
 *    Sunucu kapalıyken e-posta+parola yerelde doğrulanır (yanlış parola anahtarı açamaz), "kesinti oturumu" (sessionStorage) kurulur.
 *    Kesinti oturumunun gerçek JWT'si YOKTUR: sunucu RLS'i değişmez; yazmalar yalnızca sunucu dönüp gerçek girişten sonra uygulanır.
 * GİZLİLİK: anahtarlar düz metin olarak yalnızca açık oturum süresince IndexedDB'dedir (oturum belirteciyle aynı güven düzeyi);
 *    çıkışta silinir. Kasa yoksa çıkışta önbellek de tamamen silinir. Hiçbir veri sunucuya/üçüncü tarafa gönderilmez.
 * CSP: harici kaynak/inline stil/olay yok. Bu dosya UI çizmez (bkz. kesinti-arayuz.js).
 */
const DB_AD = "aea-kesinti";
const SAGLIK_ANAHTARI = "aea_sb_durum";
const KESINTI_OTURUM = "aea_kesinti_oturum";
const KASA_OMRU_MS = 30 * 24 * 3600 * 1000;
const PBKDF2_TUR = 250000;
const OKUMA_ZAMAN_ASIMI = 12000;
const ONBELLEK_ENFAZLA = 400;
const ONBELLEK_GOVDE_ENFAZLA = 600 * 1024;
const OKUMA_RPC = /(getir|listele|liste|oku$|_oku|var_mi|_mi$|yetkili|yetkilerim|izin|durum|ozet|sayi|^is_|^can_|^get_|_gor)/i;
const AG_DURUMLARI = new Set([0, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

const olaylar = new EventTarget();
export const kesintiOlay = (ad, fn) => { olaylar.addEventListener(ad, fn); return () => olaylar.removeEventListener(ad, fn); };
const yay = (ad, detay) => { try { olaylar.dispatchEvent(new CustomEvent(ad, { detail: detay })); window.dispatchEvent(new CustomEvent(`aea:${ad}`, { detail: detay })); } catch { /* yok say */ } };

/* ------------------------------ durum ------------------------------ */
export const durum = { durum: "bilinmiyor", gecikmeMs: null, auth: null, rest: null, sonKontrol: 0, kasaVar: false, kuyruk: 0, onbellekten: false };
let ayar = { url: "", anon: "" };
let gercekFetch = null;
let supabaseIstemci = null;

/* ------------------------------ IndexedDB ------------------------------ */
let dbSozu = null;
function idb() {
  if (dbSozu) return dbSozu;
  dbSozu = new Promise((coz, red) => {
    try {
      const r = indexedDB.open(DB_AD, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("kasa");        // anahtar: e-posta (küçük harf)
        db.createObjectStore("onbellek");    // anahtar: istek özeti
        db.createObjectStore("anahtar");     // "cihaz" → CryptoKey
        db.createObjectStore("kuyruk", { autoIncrement: true });
      };
      r.onsuccess = () => coz(r.result);
      r.onerror = () => { dbSozu = null; red(r.error); };
    } catch (h) { dbSozu = null; red(h); }
  });
  return dbSozu;
}
async function idbIs(depo, mod, fn) {
  const db = await idb();
  return new Promise((coz, red) => {
    const tx = db.transaction(depo, mod);
    let sonuc;
    try { sonuc = fn(tx.objectStore(depo)); } catch (h) { red(h); return; }
    tx.oncomplete = () => coz(sonuc && "result" in sonuc ? sonuc.result : undefined);
    tx.onerror = () => red(tx.error);
    tx.onabort = () => red(tx.error);
  });
}
const idbOku = (d, k) => idbIs(d, "readonly", (s) => s.get(k)).catch(() => undefined);
const idbYaz = (d, k, v) => idbIs(d, "readwrite", (s) => s.put(v, k)).catch(() => undefined);
const idbSil = (d, k) => idbIs(d, "readwrite", (s) => s.delete(k)).catch(() => undefined);
const idbTemizle = (d) => idbIs(d, "readwrite", (s) => s.clear()).catch(() => undefined);
const idbTumAnahtarlar = (d) => idbIs(d, "readonly", (s) => s.getAllKeys()).catch(() => []);

/* ------------------------------ kripto ------------------------------ */
const enc = new TextEncoder(), dec = new TextDecoder();
const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));
let cihazAnahtari = null;
async function cihazAnahtariAl({ olustur = false } = {}) {
  if (cihazAnahtari) return cihazAnahtari;
  const k = await idbOku("anahtar", "cihaz");
  if (k) { cihazAnahtari = k; return k; }
  if (!olustur) return null;
  cihazAnahtari = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
  await idbYaz("anahtar", "cihaz", cihazAnahtari);
  return cihazAnahtari;
}
async function sifrele(metin) {
  const k = await cihazAnahtariAl({ olustur: true });
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(metin));
  return { iv, ct };
}
async function coz(kayit) {
  const k = await cihazAnahtariAl();
  if (!k || !kayit?.iv || !kayit?.ct) throw new Error("anahtar yok");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: kayit.iv }, k, kayit.ct));
}
async function parolaAnahtari(parola, tuz, tur = PBKDF2_TUR) {
  const ham = await crypto.subtle.importKey("raw", enc.encode(parola), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: tuz, iterations: tur, hash: "SHA-256" }, ham, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

/* ------------------------------ yardımcılar ------------------------------ */
const kucuk = (s) => String(s || "").trim().toLowerCase();
function ozetle(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
export function kesintiOturumu() {
  try { const o = JSON.parse(sessionStorage.getItem(KESINTI_OTURUM) || "null"); return o && o.uid ? o : null; } catch { return null; }
}
function depoOturumuHam() {
  try {
    const ref = new URL(ayar.url).hostname.split(".")[0];
    const anahtar = `sb-${ref}-auth-token`;
    const ham = localStorage.getItem(anahtar) || sessionStorage.getItem(anahtar);
    const o = ham ? JSON.parse(ham) : null;
    return o?.user?.id ? o : null;
  } catch { return null; }
}
const aktifUid = () => kesintiOturumu()?.uid || depoOturumuHam()?.user?.id || "anon";
function agHatasiMi(h) {
  if (!h) return false;
  const m = String(h.message || h);
  return h.name === "TypeError" || h.name === "AbortError" || h.name === "AuthRetryableFetchError" || h.status === 0 || AG_DURUMLARI.has(h.status) || /fetch|network|failed to|load failed|timeout/i.test(m);
}
const iyi = () => durum.durum === "ok" || durum.durum === "yavas" || durum.durum === "bilinmiyor";

/* ------------------------------ SAĞLIK İZLEME ------------------------------ */
async function sondala(url, ekBaslik = {}) {
  const t0 = performance.now();
  const kontrol = new AbortController();
  const z = setTimeout(() => kontrol.abort(), 6000);
  try {
    const r = await gercekFetch(url, { method: "GET", headers: { apikey: ayar.anon, ...ekBaslik }, cache: "no-store", signal: kontrol.signal });
    return { ok: r.ok || r.status === 401 || r.status === 404, durum: r.status, ms: Math.round(performance.now() - t0) };
  } catch (h) { return { ok: false, durum: 0, ms: Math.round(performance.now() - t0), hata: h?.name === "AbortError" ? "zaman aşımı" : "bağlanılamadı" }; }
  finally { clearTimeout(z); }
}
async function kendiSiteyeUlasilir() {
  try {
    const kontrol = new AbortController();
    const z = setTimeout(() => kontrol.abort(), 5000);
    const r = await gercekFetch(`/surum.json?_=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: kontrol.signal });
    clearTimeout(z);
    return r.status < 500;
  } catch { return false; }
}
let sondaCalisiyor = null;
/** Tam sağlık kontrolü. Sonuç durum nesnesine yazılır ve olay yayılır. Cloudflare isteği YOK. */
export function saglikKontrol({ zorla = false } = {}) {
  if (sondaCalisiyor) return sondaCalisiyor;
  if (!zorla) {
    try { const p = JSON.parse(localStorage.getItem(SAGLIK_ANAHTARI) || "null"); if (p && Date.now() - p.t < 15000) { Object.assign(durum, p.d, { sonKontrol: p.t }); return Promise.resolve(durum); } } catch { /* yok say */ }
  }
  sondaCalisiyor = (async () => {
    const onceki = durum.durum;
    const [a, r] = await Promise.all([
      sondala(`${ayar.url}/auth/v1/health`),
      sondala(`${ayar.url}/rest/v1/worker_anahtarlari?select=ad&limit=1`, { Authorization: `Bearer ${ayar.anon}` }),
    ]);
    let d;
    if (a.ok && r.ok) d = Math.max(a.ms, r.ms) > 3000 ? "yavas" : "ok";
    else if (a.ok && !r.ok) d = "veritabani";
    else if (!a.ok && r.ok) d = "giris";
    else d = (!navigator.onLine || !(await kendiSiteyeUlasilir())) ? "cevrimdisi" : "kesinti";
    Object.assign(durum, { durum: d, auth: a, rest: r, gecikmeMs: Math.max(a.ms, r.ms), sonKontrol: Date.now() });
    try { localStorage.setItem(SAGLIK_ANAHTARI, JSON.stringify({ t: durum.sonKontrol, d: { durum: d, auth: a, rest: r, gecikmeMs: durum.gecikmeMs } })); } catch { /* yok say */ }
    yay("kesinti-durum", { ...durum, onceki });
    if (!["ok", "yavas"].includes(onceki) && ["ok", "yavas"].includes(d)) { yay("kesinti-duzeldi", { onceki }); kuyrukGonderPlanla(); }
    return durum;
  })().finally(() => { sondaCalisiyor = null; });
  return sondaCalisiyor;
}
let izlemeZamani = null;
function izlemeBaslat() {
  const adim = () => {
    clearTimeout(izlemeZamani);
    const bekle = iyi() ? 60000 : 12000;
    izlemeZamani = setTimeout(async () => { if (!document.hidden) await saglikKontrol().catch(() => {}); adim(); }, bekle);
  };
  setTimeout(() => saglikKontrol({ zorla: true }).catch(() => {}), 1500);
  adim();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - durum.sonKontrol > 30000) saglikKontrol().catch(() => {}); });
  window.addEventListener("online", () => saglikKontrol({ zorla: true }).catch(() => {}));
  window.addEventListener("offline", () => saglikKontrol({ zorla: true }).catch(() => {}));
}
let hataZamani = 0;
function hataBildir() {
  if (Date.now() - hataZamani < 4000) return;
  hataZamani = Date.now();
  saglikKontrol({ zorla: true }).catch(() => {});
}

/* ------------------------------ ÖNBELLEK ------------------------------ */
function onbellekAnahtari(yontem, url, basliklar, govde) {
  return `${aktifUid()}|${yontem}|${url}|${basliklar.get("accept") || ""}|${basliklar.get("prefer") || ""}|${govde ? ozetle(govde) : ""}`;
}
async function onbellegeYaz(anahtar, yanit) {
  try {
    const metin = await yanit.clone().text();
    if (metin.length > ONBELLEK_GOVDE_ENFAZLA) return;
    const s = await sifrele(metin);
    await idbYaz("onbellek", anahtar, { iv: s.iv, ct: s.ct, durum: yanit.status, tur: yanit.headers.get("content-type") || "application/json", aralik: yanit.headers.get("content-range") || "", t: Date.now() });
    if (Math.random() < 0.05) onbellekBudala();
  } catch { /* önbellek en iyi çabadır */ }
}
async function onbellekBudala() {
  try {
    const anahtarlar = await idbTumAnahtarlar("onbellek");
    if (anahtarlar.length <= ONBELLEK_ENFAZLA) return;
    const kayitlar = await Promise.all(anahtarlar.map(async (k) => [k, (await idbOku("onbellek", k))?.t || 0]));
    kayitlar.sort((x, y) => x[1] - y[1]).slice(0, anahtarlar.length - ONBELLEK_ENFAZLA + 40).forEach(([k]) => idbSil("onbellek", k));
  } catch { /* yok say */ }
}
async function onbellekYaniti(anahtar) {
  const k = await idbOku("onbellek", anahtar);
  if (!k) return null;
  try {
    const metin = await coz(k);
    const b = new Headers({ "Content-Type": k.tur, "X-Aea-Onbellek": "1", "X-Aea-Onbellek-Zaman": String(k.t) });
    if (k.aralik) b.set("Content-Range", k.aralik);
    durum.onbellekten = true;
    yay("kesinti-onbellek", { t: k.t });
    return new Response(metin, { status: k.durum, headers: b });
  } catch { return null; }
}

/* ------------------------------ KUYRUK ------------------------------ */
async function kuyrukSay() { try { const n = (await idbTumAnahtarlar("kuyruk")).length; durum.kuyruk = n; return n; } catch { return 0; } }
export async function kuyrukListele() {
  const db = await idb();
  return new Promise((coz2, red) => {
    const tx = db.transaction("kuyruk", "readonly"), s = tx.objectStore("kuyruk"), cikti = [];
    const c = s.openCursor();
    c.onsuccess = () => { const i = c.result; if (i) { cikti.push({ id: i.key, ...i.value }); i.continue(); } else coz2(cikti); };
    c.onerror = () => red(c.error);
  });
}
export async function kuyrukOzet() {
  const l = await kuyrukListele();
  const cikti = [];
  for (const o of l) {
    let govde = null;
    try { govde = JSON.parse(await coz(o.govde)); } catch { /* yok say */ }
    const tablo = (o.url.split("/rest/v1/")[1] || "").split("?")[0];
    cikti.push({ id: o.id, uid: o.uid, t: o.t, yontem: o.yontem, tablo, govde, yas: Date.now() - o.t });
  }
  return cikti;
}
export async function kuyrukSil(id) { await idbSil("kuyruk", id); await kuyrukSay(); yay("kesinti-kuyruk", { n: durum.kuyruk }); }
export async function kuyrukTemizle() { await idbTemizle("kuyruk"); durum.kuyruk = 0; yay("kesinti-kuyruk", { n: 0 }); }
async function kuyrugaAl(yontem, url, basliklar, govde) {
  const s = await sifrele(govde || "");
  const b = {}; ["content-type", "prefer", "accept", "accept-profile", "content-profile"].forEach((h) => { const v = basliklar.get(h); if (v) b[h] = v; });
  await idbIs("kuyruk", "readwrite", (st) => st.add({ uid: aktifUid(), t: Date.now(), yontem, url, bas: b, govde: s }));
  await kuyrukSay();
  yay("kesinti-kuyruk", { n: durum.kuyruk, yeni: true, tablo: (url.split("/rest/v1/")[1] || "").split("?")[0] });
}
function sentetikYanit(yontem, basliklar, govde) {
  const prefer = basliklar.get("prefer") || "", tek = /object\+json/.test(basliklar.get("accept") || "");
  const h = { "Content-Type": "application/json", "X-Aea-Kuyrukta": "1" };
  if (!/return=representation/.test(prefer)) return new Response(null, { status: yontem === "POST" ? 201 : 204, headers: h });
  let g = null; try { g = govde ? JSON.parse(govde) : null; } catch { /* yok say */ }
  if (yontem === "DELETE") return new Response(tek ? "null" : "[]", { status: tek ? 406 : 200, headers: h });
  const dizi = Array.isArray(g) ? g : g ? [g] : [];
  return new Response(JSON.stringify(tek ? dizi[0] ?? null : dizi), { status: yontem === "POST" ? 201 : 200, headers: h });
}
let gonderiyor = false, gonderZamani = null;
function kuyrukGonderPlanla() { clearTimeout(gonderZamani); gonderZamani = setTimeout(() => kuyrukGonder({ otomatik: true }).catch(() => {}), 2500); }
/** Kuyruktaki işlemleri sırayla gönderir. otomatik:true → yalnızca taze (≤10 dk) ve yıkıcı olmayanlar. Gerçek oturum şarttır. */
export async function kuyrukGonder({ otomatik = false, yalnizId = null } = {}) {
  if (gonderiyor) return { gonderilen: 0, hata: 0, kalan: durum.kuyruk };
  gonderiyor = true;
  let ok = 0, hata = 0;
  try {
    const { data } = await supabaseIstemci.auth.getSession();
    const oturum = data?.session;
    if (!oturum?.access_token || kesintiOturumu()) return { gonderilen: 0, hata: 0, kalan: await kuyrukSay(), girisGerek: true };
    const liste = (await kuyrukListele()).filter((o) => o.uid === oturum.user.id && (yalnizId == null || o.id === yalnizId));
    for (const o of liste) {
      if (otomatik && (o.yontem === "DELETE" || Date.now() - o.t > 10 * 60 * 1000)) continue;
      let govde; try { govde = await coz(o.govde); } catch { await idbSil("kuyruk", o.id); hata++; continue; }
      try {
        const r = await gercekFetch(o.url, { method: o.yontem, headers: { ...o.bas, apikey: ayar.anon, Authorization: `Bearer ${oturum.access_token}` }, body: govde || undefined });
        if (r.ok) { await idbSil("kuyruk", o.id); ok++; }
        else if (AG_DURUMLARI.has(r.status)) { hata++; break; }
        else { hata++; const { id: kimlik, ...govdeli } = o; await idbIs("kuyruk", "readwrite", (st) => st.put({ ...govdeli, basarisiz: `HTTP ${r.status}`, deneme: (o.deneme || 0) + 1 }, kimlik)); }
      } catch { hata++; break; }
    }
  } finally { gonderiyor = false; }
  const kalan = await kuyrukSay();
  yay("kesinti-kuyruk", { n: kalan, gonderilen: ok, hata });
  return { gonderilen: ok, hata, kalan };
}
export async function kuyrukIndir() {
  const ozet = await kuyrukOzet();
  const blob = new Blob([JSON.stringify({ olusturuldu: new Date().toISOString(), not: "Bu dosya sunucuya gönderilemeyen işlemlerin yedeğidir.", islemler: ozet }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bekleyen-islemler-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ------------------------------ FETCH SARMALAYICI (Supabase istemcisine verilir) ------------------------------ */
export function kesintiFetchOlustur(supabaseUrl, anonAnahtar) {
  ayar = { url: supabaseUrl.replace(/\/$/, ""), anon: anonAnahtar };
  gercekFetch = window.fetch.bind(window);
  const REST = `${ayar.url}/rest/v1/`;
  return async function kesintiFetch(girdi, init = {}) {
    let url, yontem, basliklar, govde;
    try {
      url = typeof girdi === "string" ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
      if (!url.startsWith(REST)) return gercekFetch(girdi, init);               // auth/storage/functions: aynen geç
      yontem = String(init.method || (typeof girdi !== "string" && girdi.method) || "GET").toUpperCase();
      basliklar = new Headers(init.headers || (typeof girdi !== "string" ? girdi.headers : undefined));
      govde = typeof init.body === "string" ? init.body : null;
    } catch { return gercekFetch(girdi, init); }

    const rpc = url.startsWith(`${REST}rpc/`);
    const rpcAd = rpc ? url.slice(`${REST}rpc/`.length).split("?")[0] : "";
    const okumaMi = yontem === "GET" || yontem === "HEAD" || (rpc && yontem === "POST" && OKUMA_RPC.test(rpcAd));
    try {
      /* ---- OKUMA ---- */
      if (okumaMi) {
        const anahtar = onbellekAnahtari(yontem, url, basliklar, govde);
        if (!iyi() && durum.durum !== "giris") { const o = await onbellekYaniti(anahtar); if (o) return o; }     // bilinen kesintide anında önbellek
        const kontrol = new AbortController();
        const dis = init.signal;
        if (dis) dis.addEventListener("abort", () => kontrol.abort(), { once: true });
        const z = setTimeout(() => kontrol.abort(), OKUMA_ZAMAN_ASIMI);
        try {
          const r = await gercekFetch(girdi, { ...init, signal: kontrol.signal });
          clearTimeout(z);
          if (r.ok && yontem !== "HEAD") onbellegeYaz(anahtar, r);
          if (AG_DURUMLARI.has(r.status)) { hataBildir(); const o = await onbellekYaniti(anahtar); if (o) return o; }
          else if (durum.onbellekten && iyi()) durum.onbellekten = false;
          return r;
        } catch (h) {
          clearTimeout(z);
          if (dis?.aborted) throw h;                                               // çağıran kendi iptal etti
          hataBildir();
          const o = await onbellekYaniti(anahtar);
          if (o) return o;
          throw h;
        }
      }
      /* ---- YAZMA ---- */
      const yazma = yontem === "POST" || yontem === "PATCH" || yontem === "DELETE" || yontem === "PUT";
      if (!yazma) return gercekFetch(girdi, init);
      const kuyrukUygun = !rpc && yontem !== "PUT";
      const gercekOturum = !kesintiOturumu();
      if (!iyi() && kuyrukUygun && (durum.durum !== "giris")) { await kuyrugaAl(yontem, url, basliklar, govde); return sentetikYanit(yontem, basliklar, govde); }
      if (!iyi() && rpc) throw Object.assign(new TypeError("Bu işlem sunucu gerektirir; Supabase şu an yanıt vermiyor."), { aeaKesinti: true });
      try {
        const r = await gercekFetch(girdi, init);
        if (AG_DURUMLARI.has(r.status) && kuyrukUygun && gercekOturum) { hataBildir(); await kuyrugaAl(yontem, url, basliklar, govde); return sentetikYanit(yontem, basliklar, govde); }
        return r;
      } catch (h) {
        if (agHatasiMi(h) && kuyrukUygun && h?.name !== "AbortError") { hataBildir(); await kuyrugaAl(yontem, url, basliklar, govde); return sentetikYanit(yontem, basliklar, govde); }
        throw h;
      }
    } catch (h) {
      if (h?.aeaKesinti) throw h;
      throw h;
    }
  };
}

/* ------------------------------ ÇEVRİMDIŞI GİRİŞ KASASI ------------------------------ */
export async function kasaVarMi(eposta) { const k = await idbOku("kasa", kucuk(eposta)); return !!k && Date.now() - k.t < KASA_OMRU_MS; }
export async function kasaOlustur({ eposta, parola, uid }) {
  const e = kucuk(eposta);
  if (!e || !parola || !uid || !crypto?.subtle) return false;
  try {
    let k = await cihazAnahtariAl();
    const eski = await idbOku("kasa", e);
    if (!k && eski) {                                    // çıkış sonrası düz anahtar silindi: aynı parola ise sarmaldan geri aç
      try { k = await crypto.subtle.unwrapKey("raw", eski.sarmal, await parolaAnahtari(parola, eski.tuz, eski.tur), { name: "AES-GCM", iv: eski.iv }, { name: "AES-GCM" }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]); cihazAnahtari = k; await idbYaz("anahtar", "cihaz", k); } catch { k = null; await idbTemizle("onbellek"); }
    }
    if (!k) { await idbTemizle("onbellek"); k = await cihazAnahtariAl({ olustur: true }); }
    const tuz = rastgele(16), iv = rastgele(12);
    const sarmal = await crypto.subtle.wrapKey("raw", k, await parolaAnahtari(parola, tuz), { name: "AES-GCM", iv });
    await idbYaz("kasa", e, { uid, tuz, iv, sarmal, tur: PBKDF2_TUR, t: Date.now() });
    durum.kasaVar = true;
    return true;
  } catch (h) { console.warn("kesinti: kasa oluşturulamadı", h); return false; }
}
export async function kasaSil(eposta) { await idbSil("kasa", kucuk(eposta)); durum.kasaVar = false; }
const DENEME_ANAHTARI = "aea_kesinti_deneme";
/** Sunucuya hiç gitmeden e-posta+parolayı kasayla doğrular; doğruysa "kesinti oturumu" kurar. */
export async function cevrimdisiGiris(eposta, parola) {
  const e = kucuk(eposta);
  try {
    const d = JSON.parse(sessionStorage.getItem(DENEME_ANAHTARI) || "{}");
    if (d.kilit && Date.now() < d.kilit) return { ok: false, neden: "kilit", saniye: Math.ceil((d.kilit - Date.now()) / 1000) };
  } catch { /* yok say */ }
  const k = await idbOku("kasa", e);
  if (!k) return { ok: false, neden: "kasa-yok" };
  if (Date.now() - k.t > KASA_OMRU_MS) { await idbSil("kasa", e); return { ok: false, neden: "suresi-doldu" }; }
  try {
    const anahtar = await crypto.subtle.unwrapKey("raw", k.sarmal, await parolaAnahtari(parola, k.tuz, k.tur), { name: "AES-GCM", iv: k.iv }, { name: "AES-GCM" }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
    cihazAnahtari = anahtar; await idbYaz("anahtar", "cihaz", anahtar);
    sessionStorage.removeItem(DENEME_ANAHTARI);
    sessionStorage.setItem(KESINTI_OTURUM, JSON.stringify({ uid: k.uid, eposta: e, t: Date.now() }));
    return { ok: true, uid: k.uid };
  } catch {
    let d = {}; try { d = JSON.parse(sessionStorage.getItem(DENEME_ANAHTARI) || "{}"); } catch { /* yok say */ }
    d.n = (d.n || 0) + 1; if (d.n >= 5) { d.kilit = Date.now() + 30000 * Math.min(8, d.n - 4); }
    try { sessionStorage.setItem(DENEME_ANAHTARI, JSON.stringify(d)); } catch { /* yok say */ }
    return { ok: false, neden: "parola" };
  }
}
export function kesintiOturumunuBitir() { try { sessionStorage.removeItem(KESINTI_OTURUM); } catch { /* yok say */ } }

/** Çıkışta: düz cihaz anahtarını sil. Kasa yoksa önbellek + kuyruk (gönderilmemişler hariç) tamamen silinir. */
async function cikisTemizligi() {
  const e = kucuk(kesintiOturumu()?.eposta || depoOturumuHam()?.user?.email || "");
  const kasa = e ? await idbOku("kasa", e) : null;
  cihazAnahtari = null;
  await idbSil("anahtar", "cihaz");
  if (!kasa) await idbTemizle("onbellek");
  kesintiOturumunuBitir();
}

/* ------------------------------ Supabase auth yamaları ------------------------------ */
function sahteOturum(k) {
  return {
    access_token: "kesinti-oturumu", refresh_token: "", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: k.uid, email: k.eposta, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "", factors: [] },
    aeaKesinti: true,
  };
}
function authYamala(supabase) {
  const auth = supabase.auth;
  if (auth.__aeaKesinti) return;
  auth.__aeaKesinti = true;
  const getSession0 = auth.getSession.bind(auth);
  auth.getSession = async (...a) => {
    let r;
    try { r = await getSession0(...a); } catch (h) { if (!agHatasiMi(h)) throw h; r = { data: { session: null }, error: h }; }
    if (r?.data?.session) return r;
    const k = kesintiOturumu();
    if (k) return { data: { session: sahteOturum(k) }, error: null };
    const ham = depoOturumuHam();
    if (ham && (!iyi() || agHatasiMi(r?.error))) { return { data: { session: { ...ham, aeaEskiBelirtec: true } }, error: null }; }   // süresi dolmuş ama yenilenemiyor: salt-görüntüleme + kuyruk
    return r;
  };
  const getUser0 = auth.getUser.bind(auth);
  auth.getUser = async (...a) => {
    let r;
    try { r = await getUser0(...a); } catch (h) { if (!agHatasiMi(h)) throw h; r = { data: { user: null }, error: h }; }
    if (r?.data?.user) return r;
    if (a.length && a[0]) return r;                                                  // açık jwt verilmişse dokunma
    if (kesintiOturumu() || !iyi() || agHatasiMi(r?.error)) {
      const s = await auth.getSession();
      if (s?.data?.session?.user) return { data: { user: s.data.session.user }, error: null };
    }
    return r;
  };
  const cikis0 = auth.signOut.bind(auth);
  auth.signOut = async (secenek) => {
    if (secenek?.scope !== "others") { try { await cikisTemizligi(); } catch { /* yok say */ } }
    try { return await cikis0(secenek); } catch (h) { if (agHatasiMi(h)) return { error: null }; throw h; }   // sunucuya ulaşılamasa da yerel çıkış tamam
  };
  auth.onAuthStateChange((olay, oturum) => {
    if ((olay === "SIGNED_IN" || olay === "TOKEN_REFRESHED") && oturum?.access_token && !oturum.aeaKesinti) { kesintiOturumunuBitir(); kuyrukGonderPlanla(); }
  });
}

/* ------------------------------ başlatma ------------------------------ */
export function kesintiKur(supabase) {
  if (typeof window === "undefined" || window.__aeaKesinti || !gercekFetch) return;
  window.__aeaKesinti = true;
  supabaseIstemci = supabase;
  authYamala(supabase);
  kuyrukSay();
  try { const e = kesintiOturumu()?.eposta || depoOturumuHam()?.user?.email; if (e) kasaVarMi(e).then((v) => { durum.kasaVar = v; }); } catch { /* yok say */ }
  izlemeBaslat();
  import("./kesinti-arayuz.js").then((m) => m.kesintiArayuzuKur({ durum, kesintiOlay, saglikKontrol, kuyrukOzet, kuyrukGonder, kuyrukSil, kuyrukTemizle, kuyrukIndir, kesintiOturumu, kesintiOturumunuBitir })).catch((h) => console.warn("kesinti arayüzü yüklenemedi:", h));
}

/** Girişten sonra (auth-pages.js): kasa oluştur/yenile. 2FA'lı hesapta kasa OLUŞTURULMAZ. */
export async function girisSonrasi({ eposta, parola, uid, kasaIste }) {
  kesintiOturumunuBitir();
  if (!kasaIste) { await kasaSil(eposta); return { kasa: false }; }
  try {
    const { data } = await supabaseIstemci.auth.mfa.listFactors();
    if ((data?.totp || []).some((f) => f.status === "verified")) { await kasaSil(eposta); return { kasa: false, neden: "2fa" }; }
  } catch { /* faktör okunamadı: güvenli tarafta kal */ return { kasa: false, neden: "belirsiz" }; }
  return { kasa: await kasaOlustur({ eposta, parola, uid }) };
}
export const kesintiIcinTemizle = cikisTemizligi;
