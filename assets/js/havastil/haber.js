/**
 * haber.js — "Haber Doğrulama & Taktik Motoru" orkestrasyonu.
 *   Worker (/haberler) → ham resmî/genel başlıklar (herkese AYNI ulusal liste; konum Worker'a GİTMEZ)
 *   → İSTEMCİDE: clickbait → zaman → konum filtreleri (haber-filtre.js) → kural motoru (taktik.js).
 * KATMANLI KAYNAK (Tiered Sourcing):
 *   Tier-1 (MGM, AFAD, AA, TRT Haber): son 24 saat. Filtreden geçen VE giyime dönük kuralı olan ("kritik") haber varsa SADECE bunlar kullanılır.
 *   Tier-2 (genel haber): yalnızca Tier-1'den kritik haber çıkmazsa devreye girer; pencere daha sıkıdır (son 12 saat).
 * LLM ÇAĞRISI YOK: bu dosya hiçbir yapay zekâ isteği yapmaz (Mod B ayrıca arayuz.js → /stilist, yalnızca temiz başlık id'siyle).
 */
import { supabase } from "../core/supabase-client.js";
import { suz } from "./haber-filtre.js";
import { kurallariCikar, seviyePuani } from "./taktik.js";

export const HAVASTIL_WORKER_URL = "https://havastil-worker.aeymena.workers.dev";
export const TIER1_PENCERE_SAAT = 24;
export const TIER2_PENCERE_SAAT = 12;
const ONBELLEK = "hv_haber";
const ONBELLEK_OMRU_MS = 10 * 60 * 1000;     // taze
const ESKI_KABUL_MS = 2 * 60 * 60 * 1000;    // ağ yokken en çok 2 saatlik veri

const oku = () => { try { return JSON.parse(localStorage.getItem(ONBELLEK) || "null"); } catch { return null; } };

/** Worker'dan ham haber listesi. @returns {{ok:true,veri,eski?:boolean}|{ok:false,durum:string}} */
export async function haberAl() {
  const k = oku();
  if (k && Date.now() - k.t < ONBELLEK_OMRU_MS) return { ok: true, veri: k.veri, eski: false };
  try {
    const { data } = await supabase.auth.getSession();
    const jeton = data?.session?.access_token;
    if (!jeton) return { ok: false, durum: "oturum_yok" };
    const kontrol = new AbortController();
    const z = setTimeout(() => kontrol.abort(), 15000);
    let r;
    try { r = await fetch(`${HAVASTIL_WORKER_URL}/haberler`, { headers: { Authorization: `Bearer ${jeton}` }, signal: kontrol.signal }); } finally { clearTimeout(z); }
    if (r.status === 503) return { ok: false, durum: "worker_kapali" };
    if (r.status === 401 || r.status === 403) return { ok: false, durum: "yetkisiz" };
    if (r.status === 429) { if (k && Date.now() - k.t < ESKI_KABUL_MS) return { ok: true, veri: k.veri, eski: true }; return { ok: false, durum: "hiz_siniri" }; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const veri = await r.json();
    if (!Array.isArray(veri.haberler)) throw new Error("bozuk yanıt");
    try { localStorage.setItem(ONBELLEK, JSON.stringify({ t: Date.now(), veri })); } catch { /* depo kapalı */ }
    return { ok: true, veri, eski: false };
  } catch {
    if (k && Date.now() - k.t < ESKI_KABUL_MS) return { ok: true, veri: k.veri, eski: true };
    return { ok: false, durum: "ulasilamadi" };
  }
}

function katmaniDegerlendir(liste, il, simdi, pencereSaat) {
  const s = suz(liste, { il, simdi, pencereSaat });
  const kritik = [], kuralsiz = [];
  for (const h of s.gecenler) { const kurallar = kurallariCikar(h); (kurallar.length ? kritik : kuralsiz).push({ ...h, kurallar }); }
  kritik.sort((a, b) => seviyePuani(b.kurallar) - seviyePuani(a.kurallar) || new Date(b.yayin) - new Date(a.yayin));
  return { elenen: s.elenen, ayrinti: s.ayrinti, kritik, kuralsiz: kuralsiz.length, toplam: liste.length };
}

/**
 * @param {{il:object, simdi?:Date}} g
 * @returns {Promise<{durum:'ok'|'bos'|string, katman?:1|2, secilen?:Array, istatistik?:object, kaynaklar?:Array, eski?:boolean}>}
 */
export async function haberTaktigi({ il, simdi = new Date() }) {
  if (!il) return { durum: "turkiye_disi" };
  const a = await haberAl();
  if (!a.ok) return { durum: a.durum };
  const { haberler, kaynaklar = [] } = a.veri;
  const t1 = haberler.filter((h) => h.tier === 1), t2 = haberler.filter((h) => h.tier === 2);

  const d1 = katmaniDegerlendir(t1, il, simdi, TIER1_PENCERE_SAAT);
  let katman = 1, secili = d1, d2 = null;
  if (!d1.kritik.length) { d2 = katmaniDegerlendir(t2, il, simdi, TIER2_PENCERE_SAAT); katman = 2; secili = d2; }
  const topla = (f) => (d1.elenen[f] || 0) + (d2?.elenen[f] || 0);
  const istatistik = {
    cekilen: t1.length + (d2 ? t2.length : 0),
    tier1: d1.toplam, tier2Kullanildi: !!d2,
    clickbait: topla("clickbait"), zaman: topla("zaman"), konum: topla("konum"),
    kuralsiz: d1.kuralsiz + (d2?.kuralsiz || 0),
    ayrinti: [...d1.ayrinti, ...(d2?.ayrinti || [])].slice(0, 40),
  };
  if (!secili.kritik.length) return { durum: "bos", katman, istatistik, kaynaklar, eski: a.eski };
  return { durum: "ok", katman, secilen: secili.kritik.slice(0, 3), istatistik, kaynaklar, eski: a.eski };
}
