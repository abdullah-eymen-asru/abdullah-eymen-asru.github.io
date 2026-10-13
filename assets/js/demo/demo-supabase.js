/*
 * assets/js/demo/demo-supabase.js — Demo modunda `supabase` istemcisinin YERİNE geçen SAHTE istemci
 * -----------------------------------------------------------------------
 * supabase-client.js, isDemoMode iken gerçek createClient() YERİNE bunu export eder. Böylece panelin/modüllerin
 * (notlar.js, kutuphane.js, r2-arsiv.js, auth-guard.js, nav-auth.js …) TEK satırı değişmeden çalışır, ama:
 *
 *   • Hiçbir Supabase isteği atılmaz (ağ kalkanı ayrıca fetch/XHR/WebSocket'i de engeller — çift emniyet).
 *   • OKUMA  : demo-mock-veri.js'teki statik sahte veriyle yanıtlanır (filtre/sıralama/aralık desteklenir).
 *   • YAZMA  : insert/update/delete/upsert + yazma niteliğindeki rpc/storage/functions çağrıları
 *              → "salt-okunur" toast'ı + { data:null, error } (modül kendi hata akışını çalıştırır). Hiçbir şey kaydedilmez.
 *   • AUTH   : sahte oturum (demo@sistem.local, role 'demo'); signIn/updateUser/… engellenir.
 */
import { DEMO_PROFIL, DEMO_UID, DEMO_EPOSTA, demoBildir, demoHatasi, demoCikisYap, demoBitir } from "./demo-durum.js";
import "./demo-ag-kalkani.js"; // yan etki: demo ise ağ kalkanını hemen kurar

let mock = null;
const veri = () => (mock ||= import("./demo-mock-veri.js"));

const OTURUM = {
  access_token: "demo.sahte.jeton",
  refresh_token: "demo.sahte.yenileme",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: DEMO_UID,
    aud: "authenticated",
    role: "authenticated",
    email: DEMO_EPOSTA,
    app_metadata: { provider: "demo", providers: ["demo"] },
    user_metadata: { full_name: DEMO_PROFIL.full_name },
    identities: [],
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

/* ------------------------------ sorgu oluşturucu ------------------------------ */
const deger = (satir, kol) => kol.split(".").reduce((n, p) => (n == null ? n : n[p]), satir);
const trKarsilastir = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, "tr");
  return a < b ? -1 : a > b ? 1 : 0;
};
const likeRegex = (kalip, buyukKucukDuyarsiz) =>
  new RegExp("^" + kalip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", buyukKucukDuyarsiz ? "is" : "s");

const SUZGEC = {
  eq: (v, x) => v === x || (v != null && x != null && String(v) === String(x)),
  neq: (v, x) => !SUZGEC.eq(v, x),
  gt: (v, x) => v > x,
  gte: (v, x) => v >= x,
  lt: (v, x) => v < x,
  lte: (v, x) => v <= x,
  like: (v, x) => typeof v === "string" && likeRegex(x, false).test(v),
  ilike: (v, x) => typeof v === "string" && likeRegex(x, true).test(v),
  is: (v, x) => (x === null ? v == null : v === x),
  in: (v, x) => Array.isArray(x) && x.some((y) => SUZGEC.eq(v, y)),
  contains: (v, x) => (Array.isArray(v) && Array.isArray(x) ? x.every((y) => v.includes(y)) : false),
  overlaps: (v, x) => Array.isArray(v) && Array.isArray(x) && x.some((y) => v.includes(y)),
};

class Sorgu {
  constructor(tablo) {
    this.tablo = tablo;
    this.islem = "select";
    this.suzgecler = [];
    this.siralar = [];
    this.aralik = null;
    this.sinir = null;
    this.tek = null; // "single" | "maybe"
    this.sayim = false;
    this.kafa = false;
  }
  select(_kolonlar, secenek) {
    if (this.islem === "select") {
      this.sayim = !!secenek?.count;
      this.kafa = !!secenek?.head;
    } // insert/update(...).select() zincirinde işlem yazma olarak kalır
    return this;
  }
  insert() { this.islem = "insert"; return this; }
  update() { this.islem = "update"; return this; }
  upsert() { this.islem = "upsert"; return this; }
  delete() { this.islem = "delete"; return this; }
  order(kol, o = {}) { this.siralar.push({ kol, artan: o.ascending !== false }); return this; }
  range(a, b) { this.aralik = [a, b]; return this; }
  limit(n) { this.sinir = n; return this; }
  single() { this.tek = "single"; return this; }
  maybeSingle() { this.tek = "maybe"; return this; }
  abortSignal() { return this; }
  or() { return this; } // karmaşık "or" süzgeçleri demoda yok sayılır
  not(kol, op, x) { this.suzgecler.push((s) => !SUZGEC[op]?.(deger(s, kol), x)); return this; }
  match(nesne) { for (const [k, x] of Object.entries(nesne || {})) this.eq(k, x); return this; }
  filter(kol, op, x) { if (SUZGEC[op]) this.suzgecler.push((s) => SUZGEC[op](deger(s, kol), x)); return this; }
  textSearch() { return this; }

  then(coz, red) { return this.calistir().then(coz, red); }
  catch(red) { return this.calistir().catch(red); }

  async calistir() {
    if (this.islem !== "select") {
      demoBildir();
      return { data: null, error: demoHatasi(), count: null, status: 403, statusText: "DEMO_READONLY" };
    }
    const { tabloSatirlari } = await veri();
    let satirlar = await tabloSatirlari(this.tablo);
    for (const f of this.suzgecler) satirlar = satirlar.filter(f);
    const toplam = satirlar.length;
    for (const { kol, artan } of [...this.siralar].reverse()) {
      satirlar.sort((a, b) => (artan ? 1 : -1) * trKarsilastir(deger(a, kol) ?? (kol === "ad_sira" ? a.ad : null), deger(b, kol) ?? (kol === "ad_sira" ? b.ad : null)));
    }
    if (this.aralik) satirlar = satirlar.slice(this.aralik[0], this.aralik[1] + 1);
    if (this.sinir != null) satirlar = satirlar.slice(0, this.sinir);
    if (this.tek) {
      if (satirlar.length === 1 || (this.tek === "maybe" && satirlar.length <= 1)) {
        return { data: satirlar[0] ?? null, error: null, count: toplam, status: 200 };
      }
      if (this.tek === "maybe") return { data: null, error: null, count: toplam, status: 200 };
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, count: null, status: 406 };
    }
    return { data: this.kafa ? null : satirlar, error: null, count: this.sayim ? toplam : null, status: 200 };
  }
}
for (const ad of Object.keys(SUZGEC)) {
  Sorgu.prototype[ad] = function (kol, x) {
    this.suzgecler.push((s) => SUZGEC[ad](deger(s, kol), x));
    return this;
  };
}

/* ----------------------------------- rpc ----------------------------------- */
// Salt-okunur sayılan rpc adları: boş/varsayılan yanıt (toast YOK). Geri kalan tanımsız rpc'ler yazma sayılır.
const OKUMA_RPC = /(_var_mi|_yetkili|_yetkilerim|^is_|_getir$|_listesi$|_ozet$|_durumu$|_ara$|_kota|^r2_kota|^arsiv_|^uye_onay)/i;

function rpcCagir(ad, args) {
  return (async () => {
    const { rpcYaniti } = await veri();
    const y = await rpcYaniti(ad, args);
    if (y !== undefined) return { data: y, error: null, status: 200 };
    if (OKUMA_RPC.test(ad)) return { data: null, error: null, status: 200 };
    demoBildir();
    return { data: null, error: demoHatasi(), status: 403 };
  })();
}

/* ----------------------------------- auth ----------------------------------- */
const engelliAuth = async () => {
  demoBildir();
  return { data: { user: null, session: null }, error: { message: demoHatasi().message, name: "AuthDemoError", status: 403 } };
};

const auth = {
  getSession: async () => ({ data: { session: OTURUM }, error: null }),
  getUser: async () => ({ data: { user: OTURUM.user }, error: null }),
  refreshSession: async () => ({ data: { session: OTURUM, user: OTURUM.user }, error: null }),
  getUserIdentities: async () => ({ data: { identities: [] }, error: null }),
  onAuthStateChange(cb) {
    // INITIAL_SESSION'ı asenkron bildir (gerçek SDK gibi); abonelik iptal edilebilir.
    let iptal = false;
    setTimeout(() => !iptal && typeof cb === "function" && cb("INITIAL_SESSION", OTURUM), 0);
    return { data: { subscription: { id: "demo", callback: cb, unsubscribe() { iptal = true; } } } };
  },
  async signOut() {
    // "Demodan çık": bayrağı sil; 'demo' rollü GERÇEK hesapsa onun gerçek oturumunu da kapat (bkz. demoCikisYap).
    // supabase-client.js bu dosyayı import ettiği için sabitler burada tembel (dinamik) alınır — döngüsel import yok.
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("../core/supabase-client.js");
    await demoCikisYap(SUPABASE_URL, SUPABASE_ANON_KEY);
    return { error: null };
  },
  mfa: {
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] }, error: null }),
    listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
  },
  signInWithPassword: engelliAuth,
  signInWithOAuth: engelliAuth,
  signInWithOtp: engelliAuth,
  signUp: engelliAuth,
  updateUser: engelliAuth,
  resetPasswordForEmail: engelliAuth,
  verifyOtp: engelliAuth,
  resend: engelliAuth,
  linkIdentity: engelliAuth,
  unlinkIdentity: engelliAuth,
  setSession: engelliAuth,
  reauthenticate: engelliAuth,
};

/* -------------------------- storage / functions / realtime -------------------------- */
const engelliDepo = () => ({
  upload: async () => (demoBildir(), { data: null, error: demoHatasi() }),
  download: async () => (demoBildir(), { data: null, error: demoHatasi() }),
  remove: async () => (demoBildir(), { data: null, error: demoHatasi() }),
  list: async () => ({ data: [], error: null }),
  createSignedUrl: async () => (demoBildir(), { data: null, error: demoHatasi() }),
  getPublicUrl: () => ({ data: { publicUrl: "" } }),
});

const kanal = () => {
  const k = { on: () => k, subscribe: () => k, unsubscribe: async () => "ok", send: async () => "ok" };
  return k;
};

export const demoSupabase = {
  supabaseUrl: "https://demo.invalid",
  supabaseKey: "demo",
  auth,
  from: (tablo) => new Sorgu(tablo),
  rpc: (ad, args) => ({
    then: (coz, red) => rpcCagir(ad, args).then(coz, red),
    catch: (red) => rpcCagir(ad, args).catch(red),
    single() { return this; },
    maybeSingle() { return this; },
  }),
  storage: { from: engelliDepo },
  functions: { invoke: async () => (demoBildir(), { data: null, error: demoHatasi() }) },
  channel: kanal,
  removeChannel: async () => "ok",
  removeAllChannels: async () => [],
};

/* ============================================================================================================
 * DEMO ÜYESİ (GERÇEK 'demo' rollü hesap) — HİBRİT istemci
 * ------------------------------------------------------------------------------------------------------------
 * "Tamamen saf demo olmasın": demo üyesi KENDİ hesabını gerçekten yönetebilir (ad-soyad, e-posta, şifre, 2FA, oturumlar,
 * KVKK, hesabı silme). Bu yüzden hesap ile ilgili çağrılar GERÇEK istemciye gider; veri sekmeleri (notlar, arşiv,
 * kütüphane, metrikler…) hâlâ sahte veriyle çalışır ve veritabanı tarafı (0083 restrictive RLS) bu hesaba başka hiçbir
 * satır vermez. Ağ kalkanı (demo-ag-kalkani.js) açık kalır: gerçek istemci kendi (kalkan öncesi yakalanmış) fetch'ini
 * kullanır, bu yüzden yalnızca Supabase Auth/PostgREST'e gider; Worker/R2'ye hiçbir istek çıkmaz.
 *   • auth.*                 → GERÇEK (signOut: gerçek oturumu kapatır + demo bayrağını siler)
 *   • from("profiles")       → select GERÇEK (yalnızca kendi satırı: 0086); update → dar RPC demo_profil_ad_guncelle (0087)
 *   • from("site_ayarlari")  → select GERÇEK (herkese açık veri; KVKK sürüm kontrolü için); yazma engelli
 *   • rpc(<hesap RPC'leri>)  → GERÇEK (aşağıdaki liste); diğer her rpc → sahte/engelli
 *   • geri kalan her şey     → sahte (Sorgu / mock) — salt-okunur
 * ============================================================================================================ */
const UYE_GERCEK_RPC = new Set([
  "is_demo",
  "demo_profil_ad_guncelle",
  "kvkk_onayini_ver",
  "guncel_onay_surumleri", // migration 0089: KVKK/Açık Rıza sürüm kontrolü (demo üyesi de yeni sürümü onaylamak zorunda)
  "kendi_onay_gecmisim",
  "yedek_kod_durumu",
  "yedek_kodlar_olustur",
  "yedek_kodlar_temizle",
  "oturumlarimi_listele",
  "oturum_sonlandir",
  "kullanici_email_identity_ekle",
]);

const engelliSonuc = () => {
  demoBildir();
  return { data: null, error: demoHatasi(), count: null, status: 403, statusText: "DEMO_READONLY" };
};

/** profiles.update({first_name,last_name}).eq("id", …).select().single() → RPC demo_profil_ad_guncelle (başka kolon yok). */
class UyeProfilGuncelle {
  constructor(gercek, yuk) {
    this.gercek = gercek;
    this.yuk = yuk || {};
    this.tek = false;
  }
  eq() { return this; }
  select() { return this; }
  single() { this.tek = true; return this; }
  maybeSingle() { this.tek = true; return this; }
  then(coz, red) { return this.calistir().then(coz, red); }
  catch(red) { return this.calistir().catch(red); }
  async calistir() {
    const anahtarlar = Object.keys(this.yuk);
    if (!anahtarlar.length || anahtarlar.some((k) => k !== "first_name" && k !== "last_name")) return engelliSonuc();
    const { data, error } = await this.gercek.rpc("demo_profil_ad_guncelle", {
      p_first_name: this.yuk.first_name ?? null,
      p_last_name: this.yuk.last_name ?? null,
    });
    if (error) return { data: null, error, count: null, status: 400 };
    return { data: this.tek ? data : [data], error: null, count: null, status: 200 };
  }
}

export function demoUyeSupabaseKur(gercek) {
  const engelliYazma = (tablo) => ({
    insert: () => new Sorgu(tablo).insert(),
    upsert: () => new Sorgu(tablo).upsert(),
    update: () => new Sorgu(tablo).update(),
    delete: () => new Sorgu(tablo).delete(),
  });

  const auth = new Proxy(gercek.auth, {
    get(hedef, ad) {
      if (ad === "signOut") {
        return async () => {
          let sonuc = { error: null };
          try { sonuc = await hedef.signOut({ scope: "local" }); } catch { /* ağ yok: yerel temizlik aşağıda */ }
          demoBitir();
          try { localStorage.removeItem("aea_auth_hint"); } catch { /* yok say */ }
          return { error: sonuc?.error && /session/i.test(sonuc.error.message || "") ? null : sonuc?.error ?? null };
        };
      }
      const v = hedef[ad];
      return typeof v === "function" ? v.bind(hedef) : v;
    },
  });

  return {
    ...demoSupabase,
    supabaseUrl: gercek.supabaseUrl,
    supabaseKey: gercek.supabaseKey,
    auth,
    from(tablo) {
      if (tablo === "profiles") {
        const { insert, upsert, delete: sil } = engelliYazma("profiles");
        return { select: (...a) => gercek.from("profiles").select(...a), update: (yuk) => new UyeProfilGuncelle(gercek, yuk), insert, upsert, delete: sil };
      }
      if (tablo === "site_ayarlari") {
        const { insert, upsert, update, delete: sil } = engelliYazma("site_ayarlari");
        return { select: (...a) => gercek.from("site_ayarlari").select(...a), insert, upsert, update, delete: sil };
      }
      return new Sorgu(tablo);
    },
    rpc(ad, args) {
      return UYE_GERCEK_RPC.has(ad) ? gercek.rpc(ad, args) : demoSupabase.rpc(ad, args);
    },
  };
}
