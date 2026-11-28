/*
 * assets/js/auth/turnstile-merkez.js — Merkezi Turnstile durumu (Kontrol Merkezi'nde yönetilir; migration 0157).
 * Tek kaynak: public.turnstile_durum_getir() (herkese açık, hafif). Sonuç tarayıcıda ÖNBELLEKTE tutulur
 * (en çok 5 dk, planlı bir geçiş yaklaşıyorsa daha kısa) → normal gezintide ek istek YOKTUR.
 * Ulaşılamazsa son bilinen değer, o da yoksa VARSAYILAN (mevcut davranış: korumalar açık, Bot Kalkanı kapalı).
 * Önbellek anahtarı bot-kalkani.js ile ORTAKTIR. Zamanlama UTC'dir ve sunucuda hesaplanır (istemci saati kullanılmaz).
 */
const ANAHTAR = "aea_ts_durum_v1";
const EN_FAZLA_MS = 300000;

export const VARSAYILAN = Object.freeze({
  etkin: true,
  moduller: Object.freeze({ giris: true, kayit: true, sifre_sifirlama: true, dogrulama: true, diger: true }),
  kalkan: false,
  hata_modu: "acik",
  dogrulama_dk: 30,
  gecerlilik_sn: 60,
});

function meta(ad) {
  try { return document.querySelector(`meta[name="${ad}"]`)?.content?.trim() || ""; } catch { return ""; }
}

export function durumOnbellek() {
  try {
    const o = JSON.parse(localStorage.getItem(ANAHTAR) || "null");
    return o && typeof o.t === "number" && o.v ? o : null;
  } catch { return null; }
}
function onbellekYaz(v) {
  try { localStorage.setItem(ANAHTAR, JSON.stringify({ t: Date.now(), v })); } catch { /* özel pencere */ }
}
function tazeMi(o) {
  const omur = Math.min(EN_FAZLA_MS, Math.max(1, Number(o?.v?.gecerlilik_sn) || 60) * 1000);
  return o && Date.now() - o.t < omur;
}

async function baglanti() {
  let url = meta("aea-sb-url"), anahtar = meta("aea-sb-key");
  if (!url || !anahtar) {
    const m = await import("../core/supabase-client.js");
    url = m.SUPABASE_URL; anahtar = m.SUPABASE_ANON_KEY;
  }
  return { url, anahtar };
}

let uctaki = null;
/** Güncel durumu döndürür (hiç fırlatmaz). */
export async function turnstileDurum({ zorla = false } = {}) {
  const o = durumOnbellek();
  if (!zorla && o && tazeMi(o)) return o.v;
  if (uctaki) return uctaki;
  uctaki = (async () => {
    const kd = new AbortController();
    const z = setTimeout(() => kd.abort(), 4000);
    try {
      const { url, anahtar } = await baglanti();
      const r = await fetch(`${url}/rest/v1/rpc/turnstile_durum_getir`, {
        method: "POST", signal: kd.signal,
        headers: { apikey: anahtar, Authorization: `Bearer ${anahtar}`, "Content-Type": "application/json" }, body: "{}",
      });
      if (!r.ok) throw new Error(`durum ${r.status}`);
      const v = await r.json();
      if (!v || typeof v !== "object" || !v.moduller) throw new Error("durum biçimi");
      onbellekYaz(v);
      return v;
    } catch (h) {
      console.warn("Turnstile durumu okunamadı; son bilinen değer kullanılıyor.", h);
      return o?.v || VARSAYILAN;
    } finally { clearTimeout(z); uctaki = null; }
  })();
  return uctaki;
}

/** Sayaç (kişisel veri yok): en çok 'gecti' | 'engellendi' | 'hata'. Sessiz, sayfayı bekletmez. */
export async function olayKaydet(tur, sonuc) {
  try {
    const { url, anahtar } = await baglanti();
    fetch(`${url}/rest/v1/rpc/turnstile_olay_kaydet`, {
      method: "POST", keepalive: true,
      headers: { apikey: anahtar, Authorization: `Bearer ${anahtar}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_tur: tur, p_sonuc: sonuc }),
    }).catch(() => {});
  } catch { /* sayaç kritik değil */ }
}
