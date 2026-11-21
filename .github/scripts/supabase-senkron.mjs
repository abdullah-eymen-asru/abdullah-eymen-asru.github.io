/*
 * .github/scripts/supabase-senkron.mjs
 *
 * "Sadece Supabase'te Yayınla" ile yayınlanan yazı/projeleri, GitHub'a commit edilmiş içerikle AYNI biçimde (Jekyll Markdown dosyası) repoya yazar.
 * Böylece Supabase yazıları da: temiz adres (/blog/<slug>/, /projects/<slug>/), sunucuda çizilmiş HTML (JavaScript gerektirmez),
 * Google Scholar/Highwire + Dublin Core + JSON-LD etiketleri, jekyll-sitemap kaydı, feed.xml ve içindekiler/PDF/görsel desteği alır —
 * yani GitHub commit'iyle yayınlanan yazıdan HİÇBİR farkı kalmaz. Supabase çalışmasa bile bu dosyalar repoda durur ve site yayında kalır.
 *
 * Yalnızca HERKESE AÇIK (anon) RPC'ler çağrılır: sadece_supabase_sitemap_listele() ve sadece_supabase_yazi_getir(tur, slug) —
 * yani zaten yayında olan içerik. service_role anahtarı KULLANILMAZ. Taslak/gizli içerik buraya hiç gelmez.
 *
 * Ortam: SUPABASE_URL, SUPABASE_ANON_KEY. Çıktı: _posts/<yıl>/<tarih>-<slug>.md ya da _projects/<yıl>/<slug>.md ("supabase_senkron: true" işaretli).
 * Çıkış kodu 0; değişiklik varsa GITHUB_OUTPUT'a degisti=true yazar.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
if (!URL_ || !ANON) { console.error("SUPABASE_URL / SUPABASE_ANON_KEY tanımlı değil."); process.exit(1); }

const rpc = async (ad, govde) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${ad}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify(govde || {}) });
  if (!r.ok) throw new Error(`RPC ${ad}: HTTP ${r.status}`);
  return r.json();
};

const q = (v) => JSON.stringify(String(v));                      // YAML çift tırnaklı dize (JSON ⊂ YAML)
const satir = (k, v, ciplak = false) => (v === null || v === undefined || v === "" ? null : `${k}: ${ciplak ? v : q(v)}`);
const gun = (v) => (v ? String(v).slice(0, 10) : "");
const guvenliSlug = (s) => /^[a-z0-9][a-z0-9-]{0,119}$/.test(s);

function dosyaIcerigi(tur, k, slug) {
  const f = ["---"];
  f.push(satir("title", k.baslik));
  f.push(satir("date", gun(k.tarih), true));
  f.push(satir("guncelleme_tarihi", gun(k.guncelleme_tarihi), true));
  if (k.akademik === true) f.push("akademik: true");
  f.push(satir("last_modified_at", gun(k.last_modified_at), true));
  f.push(satir("author", k.yazar_adi));
  if (k.reklam === false) f.push("reklam: false");
  if (k.toc === true) f.push("toc: true");
  f.push(satir("pdf_url", k.pdf_url));
  f.push(satir("veri_url", k.veri_url));
  f.push(satir("summary", k.ozet));
  if (tur === "proje") {
    f.push(satir("venue", k.venue));
    f.push(satir("status", k.durum));
    f.push(satir("link", k.link));
    f.push(satir("link_label", k.link_etiket));
  }
  f.push("yayinda: true", "sitemap: true", "supabase_senkron: true", `supabase_slug: ${q(slug)}`, "---");
  return `${f.filter(Boolean).join("\n")}\n\n${String(k.govde || "").trim()}\n`;
}

async function dosyalariTara(kok) {
  const sonuc = [];
  const yururu = async (d) => {
    let ogeler = [];
    try { ogeler = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const o of ogeler) { const y = path.join(d, o.name); if (o.isDirectory()) await yururu(y); else if (/\.md$/i.test(o.name)) sonuc.push(y); }
  };
  await yururu(kok);
  return sonuc;
}
const slugDosyadan = (ad, tur) => path.basename(ad, ".md").replace(tur === "blog" ? /^\d{4}-\d{2}-\d{2}-/ : /^\d{4}-\d{2}-\d{2}-/, "");

const liste = (await rpc("sadece_supabase_sitemap_listele")).filter((y) => (y.tur === "blog" || y.tur === "proje") && guvenliSlug(y.slug));
const KOK = { blog: "_posts", proje: "_projects" };
let degisti = 0;
const korunan = new Set();

for (const tur of ["blog", "proje"]) {
  const mevcut = await dosyalariTara(KOK[tur]);
  const elle = new Set(), senkron = new Map();                      // elle: GitHub'a commit edilmiş slug'lar; senkron: bizim ürettiğimiz dosyalar
  for (const d of mevcut) {
    const ic = await fs.readFile(d, "utf8");
    (/^supabase_senkron:\s*true\s*$/m.test(ic) ? senkron.set(d, ic) : elle.add(slugDosyadan(d, tur)));
  }
  for (const y of liste.filter((x) => x.tur === tur)) {
    if (elle.has(y.slug)) { console.log(`atla (GitHub'da zaten var): ${tur}/${y.slug}`); continue; }
    let k;
    try { [k] = await rpc("sadece_supabase_yazi_getir", { p_tur: tur, p_slug: y.slug }); } catch (h) { console.error(`getirilemedi ${tur}/${y.slug}: ${h.message}`); korunan.add(`${tur}/${y.slug}`); continue; }
    if (!k || !k.baslik) { korunan.add(`${tur}/${y.slug}`); continue; }
    const yil = gun(k.tarih).slice(0, 4) || String(new Date().getFullYear());
    const ad = tur === "blog" ? `${gun(k.tarih)}-${y.slug}.md` : `${y.slug}.md`;
    const hedef = path.join(KOK[tur], yil, ad);
    const icerik = dosyaIcerigi(tur, k, y.slug);
    // aynı slug için tarih değişmişse eski dosyayı kaldır
    for (const [d] of senkron) if (d !== hedef && slugDosyadan(d, tur) === y.slug) { await fs.rm(d); senkron.delete(d); degisti++; console.log(`taşındı/silindi: ${d}`); }
    let eski = null; try { eski = await fs.readFile(hedef, "utf8"); } catch { /* yeni */ }
    if (eski !== icerik) { await fs.mkdir(path.dirname(hedef), { recursive: true }); await fs.writeFile(hedef, icerik, "utf8"); degisti++; console.log(`yazıldı: ${hedef}`); }
    korunan.add(`${tur}/${y.slug}`); senkron.delete(hedef);
  }
  // artık Supabase'te yayında olmayan (silinmiş/yayından kaldırılmış/GitHub'a taşınmış) senkron dosyalarını kaldır
  for (const [d] of senkron) {
    if (korunan.has(`${tur}/${slugDosyadan(d, tur)}`)) continue;
    await fs.rm(d); degisti++; console.log(`kaldırıldı (artık yayında değil): ${d}`);
  }
}

console.log(`Bitti. Değişen dosya: ${degisti}`);
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `degisti=${degisti > 0}\n`);
