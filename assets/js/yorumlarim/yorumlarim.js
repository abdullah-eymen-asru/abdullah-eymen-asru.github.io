/*
 * assets/js/yorumlarim/yorumlarim.js — Hesabım › Yorumlarım (0137/0138)
 * Üstte sekmeler: [Yorumlarım] ve (yönetici/Site Sahibi için, "Yorum yönetimi" yetkisi açıksa) [Yorum yönetimi]. Her sekmede alt sekmeler: Blog · Akademik projeler · Diğer.
 * Yorumlar KENDİ YAZI BAŞLIĞI altında gruplanır (katlanır). Arama: yorum metni, yorumu yapanın adı VE yazı/proje başlığı — tüm üyeler için aynı.
 * Kendi yorumunu herkes düzenler/siler; yönetim yalnızca gizler/siler. CSP: inline stil/olay yok; innerHTML yok.
 */
import { supabase } from "../core/supabase-client.js";
import { hata as trHata } from "../core/hata-metni.js";
const kok = document.getElementById("yy-kok");
function el(t, c, m) { const e = document.createElement(t); if (c) e.className = c; if (m != null) e.textContent = m; return e; }
function dg(m, c, f) { const b = el("button", `yk-btn ${c || ""}`.trim(), m); b.type = "button"; if (f) b.addEventListener("click", f); return b; }
const tarih = (t) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${t}T00:00:00Z`)); } catch { return String(t || ""); } };
const norm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/[ıİ]/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const TURLER = [["blog", "📝 Blog"], ["proje", "📚 Akademik projeler"], ["diger", "📄 Diğer"]];

async function kur() {
  if (!kok) return;
  const indeks = new Map();
  try { const r = await fetch("/assets/data/yazilar.json", { cache: "no-cache" }); if (r.ok) (await r.json()).forEach((y) => { if (y.url && y.url !== "/") indeks.set(y.url, y); }); } catch { /* başlıksız devam: adres gösterilir */ }
  const turBul = (a) => indeks.get(a)?.tur || (/^\/projects?\//.test(a) ? "proje" : /^\/blog\//.test(a) ? "blog" : "diger");
  const baslikBul = (a) => indeks.get(a)?.baslik || a.replace(/\/+$/, "").split("/").pop().replace(/-/g, " ") || a;
  const moderator = (await supabase.rpc("_yorum_moderator")).data === true;
  const mesaj = el("p", "yk-mesaj"); mesaj.setAttribute("role", "status");
  const bildir = (m, h = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("yk-hata", !!h); };
  const durum = { ana: "benim", tur: "blog", ara: "", sira: "baslik" };
  const anaCubuk = el("div", "yk-sekmeler"), turCubuk = el("div", "yk-sekmeler"), ara = el("input", "yk-girdi"), alan = el("div", "yk-liste");
  ara.type = "search"; ara.placeholder = "Ara: yorum metni, yorumu yapan, yazı/proje başlığı…"; ara.setAttribute("aria-label", "Yorumlarda ara");
  const sira = el("select", "yk-girdi"); sira.setAttribute("aria-label", "Sırala");
  [["baslik", "Sırala: yazı başlığı (A–Z)"], ["yeni", "Sırala: en yeni önce"], ["eski", "Sırala: en eski önce"], ["cok", "Sırala: en çok yorum"]].forEach(([v, ad]) => { const o = el("option", null, ad); o.value = v; sira.append(o); });
  sira.addEventListener("change", () => { durum.sira = sira.value; ciz(); });
  const arac = el("div", "yk-arac"); arac.append(ara, sira);
  let veri = [];

  function sekmeCiz() {
    anaCubuk.replaceChildren(); if (!moderator) anaCubuk.hidden = true;
    [["benim", "💬 Yorumlarım"], ...(moderator ? [["yonetim", "🛡 Yorum yönetimi"]] : [])].forEach(([id, ad]) => { const b = dg(ad, "yk-sekme", () => { durum.ana = id; durum.tur = "blog"; sekmeCiz(); yukle(); }); b.setAttribute("aria-pressed", String(durum.ana === id)); anaCubuk.append(b); });
    turCubuk.replaceChildren(...TURLER.map(([id, ad]) => { const b = dg(ad, "yk-sekme", () => { durum.tur = id; sekmeCiz(); ciz(); }); b.setAttribute("aria-pressed", String(durum.tur === id)); return b; }));
  }
  async function yukle() {
    alan.replaceChildren(el("p", "yk-soluk", "Yükleniyor…")); bildir("");
    const q = norm(durum.ara).trim(), eslesen = q ? [...indeks.values()].filter((y) => norm(y.baslik).includes(q)).map((y) => y.url) : [];
    const arg = { p_ara: durum.ara || null, p_anahtarlar: eslesen.length ? eslesen : null };
    const { data, error } = durum.ana === "benim" ? await supabase.rpc("yorumlarim_listele", arg) : await supabase.rpc("yorum_yonetim_listele", arg);
    if (error) { alan.replaceChildren(el("p", "yk-soluk", trHata(error))); veri = []; return; }
    veri = data || []; ciz();
  }
  function yorumSatiri(y) {
    const k = el("article", `yk-yorum${y.gizli ? " yk-gizli" : ""}`), m = el("p", "yk-metin", y.metin), e = el("div", "yk-eylem");
    k.append(el("div", "yk-ust", `${durum.ana === "yonetim" ? `${y.ad}${y.anonim ? " (anonim yazdı)" : ""}${y.rumuz ? " (takma ad)" : ""} · ` : ""}${tarih(y.tarih)}${y.duzenlendi ? ` (Düzenlendi - ${y.duzenlendi})` : ""}${y.ust_id ? " · ↳ yanıt" : ""}${y.gizli ? " · 🙈 gizli" : ""}`), m, e);
    const git = el("a", "yk-btn yk-kucuk", "↗ Yoruma git"); git.href = `${y.icerik_anahtari}#yorum-${y.id}`; e.append(git);
    if (durum.ana === "benim") {
      e.append(dg("✏️ Düzenle", "yk-kucuk", () => { const t = el("textarea", "yk-girdi"); t.value = y.metin; t.rows = 4; m.replaceWith(t); e.replaceChildren(dg("Kaydet", "yk-birincil yk-kucuk", async () => { const r = await supabase.rpc("yorum_duzenle", { p_id: y.id, p_metin: t.value }); if (r.error) bildir(trHata(r.error), true); else { bildir("✔ Güncellendi."); await yukle(); } }), dg("Vazgeç", "yk-kucuk", ciz)); }),
        dg("🗑 Sil", "yk-kucuk yk-tehlike", async () => { if (!window.confirm("Yorumun silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }));
    } else {
      e.append(dg(y.gizli ? "👁 Göster" : "🙈 Gizle", "yk-kucuk", async () => { const r = await supabase.rpc("yorum_gizle", { p_id: y.id, p_gizli: !y.gizli }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }),
        dg("🗑 Sil", "yk-kucuk yk-tehlike", async () => { if (!window.confirm("Bu yorum kalıcı olarak silinsin mi?")) return; const r = await supabase.rpc("yorum_sil", { p_id: y.id }); if (r.error) bildir(trHata(r.error), true); else await yukle(); }));
    }
    return k;
  }
  function ciz() {
    alan.replaceChildren();
    const say = { blog: 0, proje: 0, diger: 0 }; veri.forEach((y) => { say[turBul(y.icerik_anahtari)]++; });
    [...turCubuk.children].forEach((b, i) => { b.textContent = `${TURLER[i][1]} (${say[TURLER[i][0]]})`; });
    const secili = veri.filter((y) => turBul(y.icerik_anahtari) === durum.tur), gruplar = new Map();
    secili.forEach((y) => { if (!gruplar.has(y.icerik_anahtari)) gruplar.set(y.icerik_anahtari, []); gruplar.get(y.icerik_anahtari).push(y); });
    if (!gruplar.size) { alan.append(el("p", "yk-soluk", durum.ara ? "Aramaya uyan yorum yok." : "Bu bölümde yorum yok.")); return; }
    const enYeni = (l) => l.reduce((m, y) => (y.tarih > m ? y.tarih : m), "");
    const enEski = (l) => l.reduce((m, y) => (!m || y.tarih < m ? y.tarih : m), "");
    const gSira = { baslik: (a, b) => baslikBul(a[0]).localeCompare(baslikBul(b[0]), "tr"), yeni: (a, b) => enYeni(b[1]).localeCompare(enYeni(a[1])), eski: (a, b) => enEski(a[1]).localeCompare(enEski(b[1])), cok: (a, b) => b[1].length - a[1].length || baslikBul(a[0]).localeCompare(baslikBul(b[0]), "tr") }[durum.sira];
    [...gruplar.entries()].sort(gSira).forEach(([adres, liste]) => {
      liste = [...liste].sort((a, b) => (durum.sira === "eski" ? a.tarih.localeCompare(b.tarih) : b.tarih.localeCompare(a.tarih)));
      const d = el("details", "yk-grup"); d.open = gruplar.size <= 3 || !!durum.ara;
      const s = el("summary", null, `${baslikBul(adres)} (${liste.length})`), a = el("a", "yk-link", " ↗ yazıya git"); a.href = adres; s.append(a); d.append(s);
      const g = el("div", "yk-grup-liste"); liste.forEach((y) => g.append(yorumSatiri(y))); d.append(g); alan.append(d);
    });
  }
  let z; ara.addEventListener("input", () => { clearTimeout(z); z = setTimeout(() => { durum.ara = ara.value.trim(); yukle(); }, 300); });
  const kutu = el("details", "yk-kutu"); kutu.append(el("summary", null, "🏷 Takma ad"));
  const takma = el("input", "yk-girdi"); takma.type = "text"; takma.maxLength = 40; takma.placeholder = "Yeni takma ad (boş = adıma dön)"; takma.setAttribute("aria-label", "Takma ad");
  const takmaBtn = dg("🏷 Takma adı uygula", "yk-kucuk", async () => { const r = await supabase.rpc("yorum_takma_ad_degistir", { p_ad: takma.value }); if (r.error) bildir(trHata(r.error), true); else { bildir(`✔ ${r.data} yorumda görünen ad güncellendi (anonim yorumlar değişmez).`); await yukle(); } });
  const arac2 = el("div", "yk-arac"); arac2.append(takma, takmaBtn);
  kutu.append(el("p", "yk-soluk", "Takma adın, anonim olmayan tüm yorumlarında görünür; istediğin zaman değiştirebilirsin. Yorumlarını yedeklemek/geri yüklemek için Yedekleme & Verilerim bölümünü kullan."), arac2);
  sekmeCiz(); kok.replaceChildren(anaCubuk, kutu, turCubuk, arac, alan, mesaj); await yukle();
}
kur().catch((h) => { console.error("yorumlarim.js:", h); if (kok) kok.textContent = "Yorumlar yüklenemedi."; });
