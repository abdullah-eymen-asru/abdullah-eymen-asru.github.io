/**
 * assets/js/duyuru/duyuru-panel.js — Panelde (dashboard) ÜYELERE gösterilen kalıcı ama rahatsız etmeyen duyuru şeridi (migration 0113).
 * • Aktif duyurular panelin en üstünde ince şerit olarak durur; üye "Okudum" ile kapatana kadar kalır (sticky DEĞİL, içeriği örtmez; mobil uyumlu).
 * • Kapatma, oturum açık üye için DB'ye "okundu" olarak yazılır (kim, ne zaman → site sahibi görür). Oturumsuz/demo ziyaretçide yalnızca bu tarayıcıya.
 * • Duyuru içeriği düzenlenirse (sürüm artar) daha önce kapatanlara yeniden görünür.
 * • Ucuz RPC; 5 dk'da bir ve sekme öne gelince yenilenir (gizli sekmede istek yok). innerHTML YOK.
 */
import { supabase } from "../core/supabase-client.js";

const YENILE_MS = 5 * 60 * 1000;
let kap = null, oturumVar = false, sonSorgu = 0;
const yerelAnahtar = (d) => `aea_duy_uye_${d.id}_${d.surum}`;
const yerelKapali = (d) => { try { return localStorage.getItem(yerelAnahtar(d)) === "1"; } catch { return false; } };

function guvenliBaglanti(u) { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } }

function seritCiz(d) {
  const metin = document.createElement("p"); metin.className = "dy-serit-metin"; metin.textContent = d.metin;
  const uzun = d.metin.length > 160 || d.metin.includes("\n");
  const baslik = document.createElement("strong"); baslik.className = "dy-serit-baslik"; baslik.textContent = d.baslik;
  // ✕ yerine açık etiketli "Okudum" düğmesi (ne işe yaradığı belli; bağlantıdan ayrı bir eylem sütununda durur).
  const kapat = document.createElement("button"); kapat.type = "button"; kapat.className = "dy-serit-okudum"; kapat.setAttribute("aria-label", `Okudum, duyuruyu kapat: ${d.baslik}`); kapat.textContent = "Okudum";
  const govde = document.createElement("div"); govde.className = "dy-serit-govde"; govde.append(baslik, metin);
  const href = d.baglanti_url ? guvenliBaglanti(d.baglanti_url) : null;
  if (href) { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "dy-serit-baglanti"; a.textContent = `${d.baglanti_metin || "Ayrıntılar"} ↗`; govde.append(a); }
  const kutu = document.createElement("section");
  kutu.className = `dy-serit dy-tur-${d.tur}${uzun ? " dy-kisa" : ""}`; kutu.setAttribute("role", d.tur === "kritik" ? "alert" : "status"); kutu.dataset.id = d.id;
  if (uzun) {
    const ac = document.createElement("button"); ac.type = "button"; ac.className = "dy-serit-ac"; ac.textContent = "Devamı"; ac.setAttribute("aria-expanded", "false");
    ac.addEventListener("click", () => { const k = kutu.classList.toggle("dy-kisa"); ac.textContent = k ? "Devamı" : "Daralt"; ac.setAttribute("aria-expanded", String(!k)); });
    govde.append(ac);
  }
  kutu.append(govde, kapat);
  kapat.addEventListener("click", async () => {
    kapat.disabled = true; kapat.textContent = "Kaydediliyor…";
    try {
      if (oturumVar) { const { error } = await supabase.rpc("duyuru_okundu_isaretle", { p_id: d.id, p_surum: d.surum }); if (error) throw error; }
      else { try { localStorage.setItem(yerelAnahtar(d), "1"); } catch { /* yok say */ } }
      kutu.remove();
    } catch {
      kapat.disabled = false; kapat.textContent = "Tekrar dene"; kapat.title = "Okundu olarak kaydedilemedi, tekrar dene";
    }
  });
  return kutu;
}

async function yenile() {
  if (!kap) return;
  sonSorgu = Date.now();
  try {
    const { data } = await supabase.auth.getSession(); oturumVar = !!data?.session;
    const { data: liste, error } = await supabase.rpc("aktif_duyurular", { p_hedef: "uye" });
    if (error) return;                                   // tablo yok / ağ: sessizce hiçbir şey gösterme
    const gorunecek = (liste || []).filter((d) => oturumVar || !yerelKapali(d));
    const mevcut = new Map([...kap.children].map((n) => [n.dataset.id, n]));
    const idler = new Set(gorunecek.map((d) => d.id));
    for (const [id, n] of mevcut) if (!idler.has(id)) n.remove();
    for (const d of gorunecek) if (!mevcut.has(d.id)) kap.append(seritCiz(d));
  } catch { /* ağ hatası: sessiz */ }
}

export function duyuruSeridiKur() {
  const ana = document.getElementById("dash-main");
  if (!ana || kap) return;
  kap = document.createElement("div"); kap.id = "dy-seridi"; kap.className = "dy-seridi"; kap.setAttribute("role", "region"); kap.setAttribute("aria-label", "Site duyuruları");
  ana.prepend(kap);
  yenile();
  setInterval(() => { if (!document.hidden) yenile(); }, YENILE_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - sonSorgu > 60000) yenile(); });
}
