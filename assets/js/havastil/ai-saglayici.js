/**
 * ai-saglayici.js — HavaStil v8 · çok sağlayıcılı yapay zekâ istemcisi (kendi API anahtarını getir, BYOK).
 * Gemini · OpenAI (ChatGPT API) · Anthropic (Claude API) · OpenRouter. İstekler TARAYICIDAN doğrudan sağlayıcıya gider:
 * anahtar HavaStil sunucusundan / Worker'dan / veritabanından DÜZ METİN olarak asla geçmez (CSP connect-src https: izin verir).
 * Anahtar hiçbir hata mesajına, günlüğe ya da URL'ye yazılmaz (Gemini dâhil: anahtar URL'de değil, başlıkta gider).
 * Her istek yalnızca kullanıcı bir düğmeye bastığında yapılır; burada otomatik/arka plan çağrı YOKTUR.
 */
export const SAGLAYICILAR = Object.freeze({
  gemini: { ad: "Google Gemini", kisa: "Gemini", oneri: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"], varsayilan: "gemini-flash-latest", anahtarIpucu: "AIza… ile başlar (Google AI Studio)", yardim: "https://aistudio.google.com/apikey" },
  openai: { ad: "OpenAI (ChatGPT API)", kisa: "OpenAI", oneri: ["gpt-4o-mini", "gpt-4o"], varsayilan: "gpt-4o-mini", anahtarIpucu: "sk-… ile başlar", yardim: "https://platform.openai.com/api-keys" },
  anthropic: { ad: "Anthropic (Claude API)", kisa: "Claude", oneri: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"], varsayilan: "claude-sonnet-5-5", anahtarIpucu: "sk-ant-… ile başlar", yardim: "https://console.anthropic.com/settings/keys" },
  openrouter: { ad: "OpenRouter (yüzlerce model)", kisa: "OpenRouter", oneri: ["openrouter/auto"], varsayilan: "openrouter/auto", anahtarIpucu: "sk-or-… ile başlar", yardim: "https://openrouter.ai/keys" },
});
export const SAGLAYICI_SIRASI = Object.keys(SAGLAYICILAR);

const ZAMAN_ASIMI_MS = 90000;

class AiHatasi extends Error { constructor(m, durum) { super(m); this.name = "AiHatasi"; this.durum = durum; } }

function hataMetni(durum, govde, sag) {
  const ad = SAGLAYICILAR[sag].kisa;
  let ayrinti = "";
  try { const j = JSON.parse(govde); ayrinti = String(j?.error?.message || j?.error || j?.message || "").slice(0, 200); } catch { /* json değil */ }
  ayrinti = ayrinti.replace(/(sk-[\w-]{6})[\w-]+/gi, "$1…").replace(/AIza[\w-]{6}[\w-]+/g, "AIza…");     // olası sızıntıyı kırp
  if (durum === 401 || durum === 403) return `${ad} anahtarı geçersiz ya da bu modele yetkisi yok. Anahtarı kontrol et.${ayrinti ? ` (${ayrinti})` : ""}`;
  if (durum === 404) return `${ad}: seçili model artık kullanılamıyor ve güncel bir model otomatik bulunamadı. “Doğrula / modelleri getir” ile listeden yeni bir model seç.${ayrinti ? ` (${ayrinti})` : ""}`;
  if (durum === 429) return `${ad} istek/kota sınırına ulaştın (sağlayıcı tarafı). Biraz bekleyip tekrar dene ya da hesabındaki kotayı kontrol et.${ayrinti ? ` (${ayrinti})` : ""}`;
  if (durum === 400) return `${ad} isteği reddetti: ${ayrinti || "geçersiz istek"}`;
  if (durum >= 500) return `${ad} geçici olarak yanıt vermiyor (${durum}). Sonra tekrar dene.`;
  return `${ad} hatası (${durum}).${ayrinti ? ` ${ayrinti}` : ""}`;
}

async function istek(sag, url, init, sinyal) {
  const k = new AbortController(); const z = setTimeout(() => k.abort(), ZAMAN_ASIMI_MS);
  sinyal?.addEventListener?.("abort", () => k.abort(), { once: true });
  let r;
  try { r = await fetch(url, { ...init, signal: k.signal, credentials: "omit", referrerPolicy: "no-referrer" }); }
  catch (h) {
    if (h?.name === "AbortError") throw new AiHatasi(sinyal?.aborted ? "İstek iptal edildi." : "Yanıt zaman aşımına uğradı (90 sn).");
    throw new AiHatasi(`${SAGLAYICILAR[sag].kisa} sunucusuna ulaşılamadı (ağ ya da tarayıcı engeli).`);
  } finally { clearTimeout(z); }
  const govde = await r.text();
  if (!r.ok) throw new AiHatasi(hataMetni(r.status, govde, sag), r.status);
  try { return JSON.parse(govde); } catch { throw new AiHatasi(`${SAGLAYICILAR[sag].kisa} beklenmeyen bir yanıt verdi.`); }
}

/**
 * @param {{saglayici:string, model:string, anahtar:string, sistem:string, kullanici:string, sinyal?:AbortSignal, maksToken?:number}} o
 * @returns {Promise<{metin:string, model:string, kullanim:object|null}>}
 */
/* ---------------------------- OTOMATİK GÜNCEL MODEL SEÇİMİ ---------------------------- */
// Sağlayıcılar eski modelleri sık kaldırır ("no longer available to new users"). Böyle bir hata gelirse sağlayıcının CANLI model listesi
// çekilir, istenen modelle AYNI sınıftan (flash / flash-lite / pro, mini, sonnet…) en yeni kararlı model seçilir ve istek bir kez yinelenir.
const SURUM_RE = /(\d+(?:[.-]\d+)*)/;
function surumDizisi(ad) { const m = String(ad).match(SURUM_RE); return m ? m[1].split(/[.-]/).map(Number) : [0]; }
function surumKarsilastir(a, b) { const x = surumDizisi(a), y = surumDizisi(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; }   // büyük sürüm önce
const KARARSIZ = /(preview|exp|experimental|tts|image|live|embedding|robotics|computer|audio|vision|thinking|latest|\d{4}-\d{2}-\d{2}|-\d{3,}$)/i;

/** İstenen modelin sınıfına göre listeden en iyi (en yeni kararlı) modeli seçer; uygun yoksa null. */
export function enIyiModel(saglayici, liste, istenen = "") {
  const ad = String(istenen).toLowerCase();
  let aday = [];
  if (saglayici === "gemini") {
    const sinif = /lite/.test(ad) ? "flash-lite" : /pro/.test(ad) ? "pro" : "flash";
    aday = liste.filter((n) => new RegExp(`^gemini-\\d+(?:\\.\\d+)?-${sinif}$`, "i").test(n));
    if (!aday.length) aday = liste.filter((n) => n.toLowerCase().includes(sinif) && !KARARSIZ.test(n) && (sinif !== "flash" || !/lite/i.test(n)));
    if (!aday.length) aday = liste.filter((n) => /^gemini-\d/i.test(n) && !KARARSIZ.test(n));
  } else if (saglayici === "openai") {
    const sinif = /nano/.test(ad) ? "nano" : /mini/.test(ad) ? "mini" : "";
    aday = liste.filter((n) => new RegExp(`^gpt-\\d+(?:\\.\\d+)?${sinif ? `-${sinif}` : ""}$`, "i").test(n));
    if (!aday.length) aday = liste.filter((n) => /^gpt-\d/i.test(n) && !KARARSIZ.test(n));
  } else if (saglayici === "anthropic") {
    const sinif = /haiku/.test(ad) ? "haiku" : /opus/.test(ad) ? "opus" : "sonnet";
    aday = liste.filter((n) => new RegExp(`^claude-${sinif}-\\d`, "i").test(n) || new RegExp(`^claude-\\d.*${sinif}`, "i").test(n));
    if (!aday.length) aday = liste.filter((n) => /^claude-/i.test(n));
  } else return null;
  const tarihsiz = aday.filter((n) => !/-\d{8}$/.test(n)); if (tarihsiz.length) aday = tarihsiz;   // "…-20260101" gibi tarihli takma adlardan çok sade ad
  aday.sort((a, b) => surumKarsilastir(a, b) || a.length - b.length);
  return aday[0] || null;
}
const MODEL_YOK_RE = /(no longer available|not found|is not supported|not available|deprecated|does not exist|decommission|model_not_found|unsupported model|invalid model)/i;
const modelHatasiMi = (h) => h instanceof AiHatasi && (h.durum === 404 || ((h.durum === 400 || h.durum === 403) && MODEL_YOK_RE.test(h.message)));

export async function yorumIste(o) {
  try { return await yorumIsteTek(o); }
  catch (h) {
    if (!modelHatasiMi(h) || o.model_denendi || o.saglayici === "openrouter") throw h;
    const l = await modelleriListele({ saglayici: o.saglayici, anahtar: o.anahtar, sinyal: o.sinyal });
    const yeni = l.canli ? enIyiModel(o.saglayici, l.liste, o.model) : null;
    if (!yeni || yeni === String(o.model || "").replace(/^models\//, "")) throw h;
    const r = await yorumIsteTek({ ...o, model: yeni, model_denendi: true });
    return { ...r, modelDegisti: { eski: o.model, yeni } };
  }
}

async function yorumIsteTek({ saglayici, model, anahtar, sistem, kullanici, sinyal, maksToken = 2500 }) {
  if (!SAGLAYICILAR[saglayici]) throw new AiHatasi("Bilinmeyen sağlayıcı.");
  if (!anahtar) throw new AiHatasi("API anahtarı yok.");
  model = (model || SAGLAYICILAR[saglayici].varsayilan).trim();
  if (saglayici === "gemini") {
    const j = await istek(saglayici, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": anahtar },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sistem }] }, contents: [{ role: "user", parts: [{ text: kullanici }] }], generationConfig: { temperature: 0.3, maxOutputTokens: maksToken } }) }, sinyal);
    const metin = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!metin) throw new AiHatasi(j.promptFeedback?.blockReason ? `Gemini yanıtı engelledi (${j.promptFeedback.blockReason}).` : "Gemini boş yanıt verdi.");
    return { metin, model, kullanim: j.usageMetadata || null };
  }
  if (saglayici === "anthropic") {
    const j = await istek(saglayici, "https://api.anthropic.com/v1/messages",
      { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": anahtar, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model, max_tokens: maksToken, temperature: 0.3, system: sistem, messages: [{ role: "user", content: kullanici }] }) }, sinyal);
    const metin = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!metin) throw new AiHatasi("Claude boş yanıt verdi.");
    return { metin, model: j.model || model, kullanim: j.usage || null };
  }
  // OpenAI ve OpenRouter: sohbet tamamlama biçimi
  const url = saglayici === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const basliklar = { "Content-Type": "application/json", Authorization: `Bearer ${anahtar}` };
  if (saglayici === "openrouter") { basliklar["HTTP-Referer"] = location.origin; basliklar["X-Title"] = "HavaStil"; }
  const j = await istek(saglayici, url, { method: "POST", headers: basliklar,
    body: JSON.stringify({ model, max_completion_tokens: saglayici === "openai" ? maksToken : undefined, max_tokens: saglayici === "openrouter" ? maksToken : undefined,
      messages: [{ role: "system", content: sistem }, { role: "user", content: kullanici }] }) }, sinyal);
  const metin = String(j.choices?.[0]?.message?.content || "").trim();
  if (!metin) throw new AiHatasi(`${SAGLAYICILAR[saglayici].kisa} boş yanıt verdi.`);
  return { metin, model: j.model || model, kullanim: j.usage || null };
}

/** Kullanılabilir model adları (anahtar doğrulaması da yapar). Başarısızsa önerilen liste döner (hata atmaz). */
export async function modelleriListele({ saglayici, anahtar, sinyal }) {
  const oneri = SAGLAYICILAR[saglayici].oneri;
  try {
    let adlar = [];
    if (saglayici === "gemini") {
      const j = await istek(saglayici, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": anahtar } }, sinyal);
      adlar = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name).replace(/^models\//, "")).filter((n) => /^gemini/i.test(n));
    } else if (saglayici === "openai") {
      const j = await istek(saglayici, "https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${anahtar}` } }, sinyal);
      adlar = (j.data || []).map((m) => m.id).filter((n) => /^(gpt|o\d|chatgpt)/i.test(n) && !/(embedding|whisper|tts|audio|realtime|image|moderation|transcribe|search)/i.test(n));
    } else if (saglayici === "anthropic") {
      const j = await istek(saglayici, "https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": anahtar, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } }, sinyal);
      adlar = (j.data || []).map((m) => m.id);
    } else {
      const j = await istek(saglayici, "https://openrouter.ai/api/v1/models", {}, sinyal);
      adlar = ["openrouter/auto", ...(j.data || []).map((m) => m.id)];
    }
    adlar = [...new Set(adlar)].sort();
    return { liste: adlar.length ? adlar : oneri, canli: adlar.length > 0 };
  } catch (h) { return { liste: oneri, canli: false, hata: h.message }; }
}

export { AiHatasi };
