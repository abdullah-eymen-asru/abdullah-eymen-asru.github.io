/*
 * assets/js/akademik/paylasim-goruntule.js — /kutuphane/?t=<token> : PAYLAŞILAN akademik kütüphane görüntüleyici (giriş gerekmez; 'uyeler' paylaşımında gerekir).
 * Ziyaretçi: künyeleri (yazar, yıl, DOI, ISBN, özet, etiket), klasör ağacını görür; paylaşım izin veriyorsa PDF'leri okur; atıf alır; BibTeX/RIS indirir.
 * Güvenlik: veri YALNIZCA akademik_paylasim_getir() işlevinden gelir (kapsam dışı hiçbir kayıt dönmez); PDF Worker'daki /paylasim/pdf/ yolundan, token + izin
 * veritabanında doğrulanarak okunur. Ziyaretçi hiçbir şeyi değiştiremez (okuyucu salt-okunur modda açılır).
 */
import { supabase } from "../core/supabase-client.js";
import { esc } from "./ortak.js";
import { BICIMLER, atifUret, bibtexUret, risUret } from "./atif.js";

const kok = document.getElementById("pz-kok");
const token = new URLSearchParams(location.search).get("t") || "";
const TURLER = { makale: "Makale", kitap: "Kitap", kitap_bolumu: "Kitap bölümü", bildiri: "Bildiri", tez: "Tez", rapor: "Rapor", web: "Web", diger: "Diğer" };
const kucuk = (s) => String(s || "").toLocaleLowerCase("tr");
const yazarKisa = (y = []) => y.length ? (y.length > 2 ? `${y[0].kurum || y[0].soyadi} vd.` : y.map((a) => a.kurum || [a.adi, a.soyadi].filter(Boolean).join(" ")).join(", ")) : "";

async function baslat() {
  if (!/^[0-9a-f]{40}$/.test(token)) { kok.innerHTML = '<p class="ak-bos">Geçerli bir paylaşım bağlantısı gerekli.</p>'; return; }
  const { data, error } = await supabase.rpc("akademik_paylasim_getir", { p_token: token });
  if (error || !data) {
    const { data: oturum } = await supabase.auth.getSession();
    kok.innerHTML = `<div class="ak-bos"><h2>Bu kütüphaneye erişilemiyor</h2><p>Bağlantı geçersiz, paylaşım durdurulmuş ya da süresi dolmuş olabilir.${oturum?.session ? "" : ` Paylaşım yalnızca site üyelerine açıksa <a href="/hesap/giris.html">giriş yapman</a> gerekir.`}</p></div>`;
    return;
  }
  const d = { ...data, klasor: "", ara: "", bicim: "apa", dil: "tr", acik: new Set(), sira: "baslik" };
  try { d.bicim = localStorage.getItem("aea_ak_bicim") || "apa"; d.dil = localStorage.getItem("aea_ak_dil") || "tr"; } catch { /* yok say */ }
  document.title = `${d.baslik} — Akademik Kütüphane`;
  kok.innerHTML = `
    <header class="ak-ust"><div><h2>📚 ${esc(d.baslik)}</h2><p class="ak-alt">${esc(d.sahip)} · ${d.kaynaklar.length} kaynak${d.klasorler.length ? ` · ${d.klasorler.length} klasör` : ""} · ${d.erisim === "uyeler" ? "yalnızca site üyeleri" : d.erisim === "herkes" ? "herkese açık" : "bağlantıyla paylaşıldı"}</p>
      ${d.aciklama ? `<p>${esc(d.aciklama)}</p>` : ""}</div>
      <div class="ak-ust-sag"><button type="button" class="ak-btn ak-btn-birincil" data-ekle hidden>＋ Kütüphaneme ekle</button><button type="button" class="ak-btn" data-bib>⇩ BibTeX</button><button type="button" class="ak-btn" data-ris>⇩ RIS</button></div></header>
    <div class="ak-zot">
      <aside class="ak-agac" aria-label="Klasörler"><button type="button" class="ak-agac-ac" data-agac-ac aria-expanded="false">📁 <span data-agac-ad>Tüm kaynaklar</span> ▾</button><div class="ak-agac-ic" data-agac></div></aside>
      <section class="ak-orta">
        <div class="ak-arama-satiri"><div class="ak-arama"><span aria-hidden="true">🔍</span><input type="search" data-ara placeholder="Başlık, yazar, etiket, DOI, özet ve notlarda ara…" aria-label="Ara" autocomplete="off"></div>
          <select data-sira aria-label="Sırala"><option value="baslik">Başlık (A–Z)</option><option value="yil-yeni">Yıl (yeni → eski)</option><option value="yil-eski">Yıl (eski → yeni)</option><option value="yazar">Yazar (A–Z)</option></select>
          <select data-bicim aria-label="Atıf biçimi">${BICIMLER.map((b) => `<option value="${b.anahtar}">${b.etiket}</option>`).join("")}</select></div>
        <p class="ak-ozet" data-ozet></p><div class="ak-liste ak-kart-gorunum" data-liste></div>
      </section></div>`;
  const q = (s) => kok.querySelector(s);
  q("[data-bicim]").value = d.bicim;
  // Giriş yapmış üye: künyeleri + klasör ağacını kendi kütüphanesine kopyalayabilir (PDF kopyalanmaz → depolama kotası harcanmaz)
  supabase.auth.getSession().then(({ data: o }) => { if (o?.session) q("[data-ekle]").hidden = false; });

  const altlar = (id) => [id, ...d.klasorler.filter((k) => k.ust_id === id).flatMap((k) => altlar(k.id))];
  const kume = (id) => { const s = new Set(); for (const kid of altlar(id)) for (const o of d.ogeler) if (o.k === kid) s.add(o.s); return s; };
  const yol = (id) => { const p = []; let k = d.klasorler.find((x) => x.id === id), n = 0; while (k && n++ < 20) { p.unshift(k.ad); k = d.klasorler.find((x) => x.id === k.ust_id); } return p.join(" › "); };
  const sayi = (id) => kume(id).size;

  function agacCiz() {
    const dal = (ust, sev) => d.klasorler.filter((k) => (k.ust_id || null) === ust).sort((a, b) => a.ad.localeCompare(b.ad, "tr")).map((k) => {
      const alt = d.klasorler.some((x) => x.ust_id === k.id), ac = d.acik.has(k.id);
      return `<li><div class="ak-kl${d.klasor === k.id ? " aktif" : ""}" style="--sev:${sev}">${alt ? `<button type="button" class="ak-kl-ok${ac ? " acik" : ""}" data-ac="${esc(k.id)}" aria-label="${esc(k.ad)} aç/kapat">▸</button>` : '<span class="ak-kl-ok bos"></span>'}
        <button type="button" class="ak-kl-ad" data-klasor="${esc(k.id)}"><span aria-hidden="true">${ac && alt ? "📂" : "📁"}</span> <span class="ak-kl-metin">${esc(k.ad)}</span> <span class="ak-kl-say">${sayi(k.id)}</span></button></div>${alt && ac ? `<ul>${dal(k.id, sev + 1)}</ul>` : ""}</li>`;
    }).join("");
    q("[data-agac]").innerHTML = `<ul class="ak-agac-liste"><li><div class="ak-kl${d.klasor === "" ? " aktif" : ""}" style="--sev:0"><span class="ak-kl-ok bos"></span><button type="button" class="ak-kl-ad" data-klasor=""><span aria-hidden="true">🗂</span> <span class="ak-kl-metin">Tüm kaynaklar</span> <span class="ak-kl-say">${d.kaynaklar.length}</span></button></div></li>${dal(null, 0)}</ul>`;
    q("[data-agac-ad]").textContent = d.klasor ? yol(d.klasor) : "Tüm kaynaklar";
  }
  const suzulmus = () => {
    const bel = kucuk(d.ara).split(/\s+/).filter(Boolean); const ks = d.klasor ? kume(d.klasor) : null;
    const s = d.kaynaklar.filter((k) => {
      if (ks && !ks.has(k.id)) return false;
      if (!bel.length) return true;
      const h = kucuk([k.baslik, k.doi, k.isbn, k.dergi_veya_yayinevi, k.ozet, (k.etiketler || []).join(" "), (k.yazarlar || []).map((y) => `${y.adi || ""} ${y.soyadi || ""} ${y.kurum || ""}`).join(" "), k.yayin_yili, k.aciklama_metni].join(" "));
      return bel.every((b) => h.includes(b));
    });
    const tr = (a, b) => String(a || "").localeCompare(String(b || ""), "tr");
    s.sort((a, b) => d.sira === "yil-yeni" ? (b.yayin_yili || 0) - (a.yayin_yili || 0) : d.sira === "yil-eski" ? (a.yayin_yili || 9999) - (b.yayin_yili || 9999) : d.sira === "yazar" ? tr(yazarKisa(a.yazarlar), yazarKisa(b.yazarlar)) : tr(a.baslik, b.baslik));
    return s;
  };
  function ciz() {
    const s = suzulmus();
    q("[data-ozet]").textContent = `${s.length === d.kaynaklar.length ? s.length : `${s.length} / ${d.kaynaklar.length}`} kaynak${d.klasor ? ` · 📁 ${yol(d.klasor)}` : ""}`;
    q("[data-liste]").innerHTML = s.length ? s.map((k) => `<article class="ak-kart" data-id="${esc(k.id)}">
      <div class="ak-kart-ust"><span class="ak-rozet">${esc(TURLER[k.tur] || k.tur)}</span>${k.pdf_var ? `<span class="ak-rozet ak-pdf">PDF</span>` : ""}</div>
      <h3 class="ak-kart-baslik">${esc(k.baslik)}</h3>
      <p class="ak-kart-yazar">${[yazarKisa(k.yazarlar), k.yayin_yili, k.dergi_veya_yayinevi].filter(Boolean).map(esc).join(" · ") || "—"}</p>
      <p class="ak-kart-yazar">${k.doi ? `DOI: <a href="https://doi.org/${esc(k.doi)}" target="_blank" rel="noopener">${esc(k.doi)}</a>` : ""}${k.doi && (k.isbn || k.url) ? " · " : ""}${k.isbn ? `ISBN: ${esc(k.isbn)}` : ""}${k.isbn && k.url ? " · " : ""}${k.url ? `<a href="${esc(/^https?:\/\//i.test(k.url) ? k.url : "#")}" target="_blank" rel="noopener noreferrer">Bağlantı ↗</a>` : ""}</p>
      ${(k.etiketler || []).length ? `<div class="ak-etiketler">${k.etiketler.map((e) => `<button type="button" class="ak-etiket" data-etiket="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : ""}
      ${k.ozet ? `<details class="ak-ozet-detay"><summary>Özet</summary><p>${esc(k.ozet)}</p></details>` : ""}
      <div class="ak-kart-eylem">${k.pdf_var ? `<button type="button" class="ak-btn ak-btn-birincil" data-act="oku">📖 Oku</button>` : ""}<button type="button" class="ak-btn" data-act="atif">❝ Atıf</button></div></article>`).join("") : '<p class="ak-bos">Eşleşen kaynak yok.</p>';
  }
  const klasorlu = () => suzulmus().map((k) => ({ ...k, _klasor: d.klasorler.filter((x) => d.ogeler.some((o) => o.k === x.id && o.s === k.id)).map((x) => yol(x.id).replaceAll(" › ", "/")).join("; ") }));
  const indir = (ad, metin, tip) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([metin], { type: tip })); a.download = ad; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };

  kok.addEventListener("click", async (e) => {
    const kl = e.target.closest("[data-klasor]"); if (kl) { d.klasor = kl.dataset.klasor; agacCiz(); ciz(); q(".ak-agac").classList.remove("ak-agac-acik"); return; }
    const ac = e.target.closest("[data-ac]")?.dataset.ac; if (ac) { d.acik.has(ac) ? d.acik.delete(ac) : d.acik.add(ac); agacCiz(); return; }
    if (e.target.closest("[data-agac-ac]")) { q(".ak-agac").classList.toggle("ak-agac-acik"); return; }
    const et = e.target.closest("[data-etiket]")?.dataset.etiket; if (et) { q("[data-ara]").value = et; d.ara = et; ciz(); return; }
    if (e.target.closest("[data-ekle]")) {
      const b = e.target.closest("[data-ekle]"); b.disabled = true;
      const { data: s, error: h } = await supabase.rpc("akademik_paylasimi_kutuphaneme_ekle", { p_token: token });
      b.disabled = false;
      if (h) { alert(`Eklenemedi: ${h.message}`); return; }
      b.textContent = `✓ ${s.eklenen} kaynak eklendi`; if (confirm(`${s.eklenen} kaynak eklendi${s.atlanan ? ` (${s.atlanan} yinelenen DOI atlandı)` : ""}. Kütüphaneni açmak ister misin?`)) location.href = "/panel/dashboard.html#lib-kutuphane";
      return;
    }
    if (e.target.closest("[data-bib]")) { indir("kutuphane.bib", bibtexUret(klasorlu()), "application/x-bibtex;charset=utf-8"); return; }
    if (e.target.closest("[data-ris]")) { indir("kutuphane.ris", risUret(klasorlu()), "application/x-research-info-systems;charset=utf-8"); return; }
    const kart = e.target.closest(".ak-kart"); const k = kart && d.kaynaklar.find((x) => x.id === kart.dataset.id); const act = e.target.closest("[data-act]")?.dataset.act;
    if (!k) return;
    if (act === "atif") { try { await navigator.clipboard.writeText(atifUret(k, d.bicim, { dil: d.dil }).text); e.target.textContent = "✓ Kopyalandı"; setTimeout(() => { e.target.textContent = "❝ Atıf"; }, 1500); } catch { alert("Panoya kopyalanamadı."); } }
    else if (act === "oku") {
      e.target.disabled = true;
      try { const { okuyucuAc } = await import("./okuyucu.js"); await okuyucuAc({ kaynak: { ...k, pdf_rev: 0 }, salt: true, kullaniciAdi: "", paylasimToken: token }); }
      catch (h) { alert(`PDF açılamadı: ${h.message || h}`); } finally { e.target.disabled = false; }
    }
  });
  q("[data-ara]").addEventListener("input", (e) => { clearTimeout(baslat.z); baslat.z = setTimeout(() => { d.ara = e.target.value; ciz(); }, 150); });
  q("[data-sira]").addEventListener("change", (e) => { d.sira = e.target.value; ciz(); });
  q("[data-bicim]").addEventListener("change", (e) => { d.bicim = e.target.value; try { localStorage.setItem("aea_ak_bicim", d.bicim); } catch { /* yok say */ } });
  agacCiz(); ciz();
}
baslat().catch((h) => { console.error(h); kok.innerHTML = `<p class="ak-bos ak-hata">Yüklenemedi: ${esc(h.message || h)}</p>`; });
