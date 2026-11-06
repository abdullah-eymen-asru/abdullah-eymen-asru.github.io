/* assets/js/r2-arsiv/depolama.js — R2 depolama göstergesi (X GB / 10 GB), %85 / %95 uyarıları, Cloudflare klasör görünümü eşitleme ve "Taşı" iletişim kutusu (tur 20). */
import { supabase } from "../core/supabase-client.js";
import { worker } from "./ortak.js";

const GB = 1024 ** 3;
const gbYaz = (b) => `${(Number(b || 0) / GB).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`;
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }

export async function depolamaGostergesiKur(kap, { esitle = false, sahip = false } = {}) {
  const kutu = el("section", "ra-depo"); kutu.setAttribute("aria-label", "R2 depolama durumu"); kap.prepend(kutu);
  async function ciz() {
    const { data, error } = await supabase.rpc("r2_depolama_ozeti");
    if (error) { kutu.replaceChildren(el("p", "ra-meta", /r2_depolama_ozeti/.test(error.message) ? "Depolama göstergesi için veritabanı güncellemesi (0135) gerekli." : error.message)); return; }
    const o = data?.[0]; if (!o) return;
    const oran = Math.min(100, (Number(o.kullanilan_bayt) / Number(o.limit_bayt)) * 100), yuzde = Math.round(oran * 10) / 10;
    const ust = el("div", "ra-depo-ust"); ust.append(el("strong", null, `☁ R2 depolama: ${gbYaz(o.kullanilan_bayt)} / ${gbYaz(o.limit_bayt)}`), el("span", "ra-meta", `%${yuzde.toLocaleString("tr-TR")} · ${o.dosya_sayisi} dosya`));
    const p = document.createElement("progress"); p.max = 100; p.value = oran; p.className = oran >= 95 ? "ra-depo-kritik" : oran >= 85 ? "ra-depo-uyari" : "ra-depo-iyi"; p.setAttribute("aria-label", "Depolama doluluğu");
    kutu.replaceChildren(ust, p);
    if (oran >= 85) {
      const u = el("div", `ra-depo-kart ${oran >= 95 ? "kritik" : "uyari"}`); u.setAttribute("role", "alert");
      u.append(el("strong", null, oran >= 95 ? "⛔ Depolama neredeyse DOLU (%95+)" : "⚠️ Depolama dolmak üzere (%85+)"),
        el("span", null, " Yer açmak için gereksiz dosyaları sil ya da Cloudflare R2 ücretli plana geçip aşağıdan sınırı artır; yeni yüklemeler sınıra ulaşınca durabilir."));
      kutu.append(u);
    }
    const alt = el("div", "ra-depo-alt");
    if (sahip) { const b = el("button", "ra-btn ra-btn-kucuk", "⚙ Sınırı değiştir"); b.type = "button"; b.addEventListener("click", async () => {
      const g = window.prompt("Yeni depolama sınırı (GB). Ücretsiz plan 10 GB; ücretli plana geçtiysen artır:", String(Math.round(Number(o.limit_bayt) / GB)));
      if (g === null) return; const n = Number(String(g).replace(",", ".")); if (!(n >= 1)) { window.alert("En az 1 GB olmalı."); return; }
      const r = await supabase.rpc("r2_depolama_limit_ayarla", { p_bayt: Math.round(n * GB) }); if (r.error) window.alert(r.error.message); else ciz(); }); alt.append(b); }
    if (esitle && Number(o.esitlenecek) > 0) {
      const d = el("p", "ra-meta", `Cloudflare panelinde klasör ağacının görünmesi için ${o.esitlenecek} dosyanın R2 anahtarı eşitlenecek.`), b = el("button", "ra-btn ra-btn-kucuk ra-btn-birincil", "☁ Cloudflare klasör görünümünü eşitle"); b.type = "button";
      b.addEventListener("click", async () => {
        if (!window.confirm("Dosyalar R2'de klasör yoluna göre yeniden adlandırılacak (kopyala → anahtarı güncelle → eskiyi sil). İçerik değişmez; birkaç dakika sürebilir. Devam?")) return;
        b.disabled = true; let toplam = 0, hata = 0, tur = 0;
        try { for (;;) { const r = await worker("/anahtar-esitle", { limit: 10 }); toplam += r.tamam || 0; hata += (r.hatalar || []).length; d.textContent = `Eşitleniyor… ${toplam} dosya tamam${hata ? `, ${hata} hata` : ""}`;
          if (!r.denenen || r.tamam === 0 || ++tur > 400) break; } d.textContent = `✔ ${toplam} dosya eşitlendi${hata ? `; ${hata} dosyada hata (tekrar dene)` : ""}.`; }
        catch (e) { d.textContent = e.message || "Eşitleme durdu."; } finally { b.disabled = false; ciz(); } });
      alt.append(d, b);
    }
    if (alt.childNodes.length) kutu.append(alt);
  }
  await ciz(); return { yenile: ciz };
}

/** Taşı iletişim kutusu: hedef klasörü seçtirir. Dönüş: "Klasör/Alt/" | "" (ana) | null (vazgeçti). haric: taşınan klasörlerin tam yolları (kendi altına taşımayı önler). */
export async function klasorSec({ haric = [] } = {}) {
  const { data } = await supabase.from("r2_arsiv").select("klasor_yolu,ad").eq("tur", "klasor").limit(3000);
  const yollar = ["", ...(data || []).map((k) => `${k.klasor_yolu}${k.ad}/`).filter((y) => !y.startsWith(".ozel") && !haric.some((h) => y.startsWith(h)))].sort((a, b) => a.localeCompare(b, "tr"));
  return new Promise((coz) => {
    const d = document.createElement("dialog"); d.className = "ra-dlg"; const f = el("div", "ra-dlg-form");
    const sec = el("select", "ra-secim"); sec.setAttribute("aria-label", "Hedef klasör"); yollar.forEach((y) => { const o = el("option", null, y ? `📁 /${y.replace(/\/$/, "")}` : "🏠 Ana klasör"); o.value = y; sec.append(o); });
    const tamam = el("button", "ra-btn ra-btn-birincil", "Buraya taşı"), iptal = el("button", "ra-btn", "Vazgeç"); tamam.type = iptal.type = "button";
    const bit = (v) => { d.close(); d.remove(); coz(v); };
    tamam.addEventListener("click", () => bit(sec.value)); iptal.addEventListener("click", () => bit(null)); d.addEventListener("cancel", () => bit(null));
    const sat = el("div", "ra-dlg-alt"); sat.append(iptal, tamam); f.append(el("h3", null, "Nereye taşınsın?"), sec, sat); d.append(f); document.body.append(d); d.showModal();
  });
}
