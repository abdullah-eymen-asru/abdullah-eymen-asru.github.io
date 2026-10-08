/*
 * assets/js/akademik/kutuphane.js — "Akademik Kütüphane" panel modülü.
 * dashboard.js bu dosyayı tembel yükler (MODULES.kutuphane); dosya yüklenince, sayfada bulunan
 *   #ak-kok        → "Kütüphanem" sekmesi (herkes kendi kaynaklarını yönetir; paylaşılanları okur)
 *   #ak-owner-kok  → "Tüm Kullanıcıların Kaynakları" sekmesi (yalnızca owner; salt okuma + denetim)
 * alanlarına kendini kurar. Güvenlik sınırı burası DEĞİL: RLS (0072) + akademik-kutuphane-worker.
 */
import { supabase, esc, el, toast, tarih, bayt, debounce, dosyaIndir, panoyaKopyala, workerFetch, workerJson, pdfYukle } from "./ortak.js";
import { TURLER, BICIMLER, atifUret, atifKutusuHtml, markdownKaynakca, alintiMarkdown, bibtexUret, bibtexAyristir, risUret, risAyristir, icerikBicimiTahmin, yazarMetniAyristir, yazarlariMetneCevir } from "./atif.js";
import { kunyeGetir } from "./kunye.js";
import { okuyucuAc } from "./okuyucu.js";
import { motorAyarlari, yayimlananSurumler, surumuDene, surumuSabitle } from "./motor.js";

const GORUNURLUK = { ozel: "Özel", ekip: "Ekip", herkese_acik: "Herkese açık" };
const KAP_ETIKET = { makale: "Dergi adı", kitap: "Yayınevi", kitap_bolumu: "Yayınevi", bildiri: "Bildiri / kongre adı", tez: "Üniversite", rapor: "Kurum / yayıncı", web: "Site adı", diger: "Yayıncı / kaynak" };

const kisaYazar = (yazarlar) => {
  const y = (yazarlar || []).map((a) => a.kurum || a.soyadi).filter(Boolean);
  return y.length <= 2 ? y.join(" & ") : `${y[0]} vd.`;
};
const kayitBaslik = (k) => `${k.baslik}`;
const bugunDamga = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

async function profilAl() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  return { id: user.id, role: data?.role || "user", ad: data?.full_name || user.email || "" };
}

/* ============================ bir kütüphane örneği ============================ */

function kutuphaneKur(kok, profil, owner) {
  const d = {
    kayitlar: [], kapsam: "benim", gorunum: "kart", bicim: "apa", dil: "tr",
    f: { ara: "", tur: "", etiket: "", yazar: "", yilBas: "", yilSon: "", gorunurluk: "", pdfli: false, sira: "guncel" },
    uye: "", uyeler: [],
  };

  kok.innerHTML = `
    <div class="ak-kutu">
      <header class="ak-ust">
        <div><h2>${owner ? "🛡️ Tüm Kullanıcıların Kaynakları" : "📚 Akademik Kütüphane"}</h2>
          <p class="ak-alt">${owner ? "Üyelerin eklediği kaynakları, PDF'leri ve notları <strong>salt okunur</strong> incele." : "Kaynaklarını, PDF'lerini, vurgularını ve atıflarını tek yerde yönet."}</p></div>
        <div class="ak-ust-sag">
          ${owner ? "" : `<button type="button" class="ak-btn ak-btn-birincil" data-act="ekle">＋ Kaynak ekle</button>
          <button type="button" class="ak-btn" data-act="ice-aktar">⇪ İçe aktar (.bib / .ris)</button>
          <input type="file" class="ak-gizli-alan" data-ak-ice accept=".bib,.bibtex,.ris,.txt" aria-label="BibTeX / RIS dosyası">`}
          <span class="ak-menu"><button type="button" class="ak-btn" data-act="disa-aktar" aria-haspopup="true">⇩ Dışa aktar</button></span>
        </div>
      </header>
      ${owner ? `<div class="ak-owner-bar"><label>Üye: <select data-f="uye" aria-label="Üyeye göre süz"><option value="">Tüm üyeler</option></select></label></div><div class="ak-motor" data-ak-motor></div>` : `
      <nav class="ak-sekmeler" role="tablist" aria-label="Kapsam">
        <button type="button" role="tab" class="aktif" data-kapsam="benim" aria-selected="true">Kütüphanem</button>
        <button type="button" role="tab" data-kapsam="paylasilan" aria-selected="false">Benimle paylaşılanlar</button>
      </nav>
      <div class="ak-dropzone" data-ak-dz tabindex="0" role="button" aria-label="PDF yüklemek için tıkla ya da sürükle">
        <strong>PDF'leri buraya sürükle</strong> <span>ya da seçmek için tıkla — her PDF için bir kaynak oluşturulur. Boyut sınırı yok.</span>
        <input type="file" class="ak-gizli-alan" data-ak-pdf accept="application/pdf,.pdf" multiple aria-label="PDF dosyaları">
        <ul class="ak-yukleme" data-ak-yukleme></ul>
      </div>`}
      <section class="ak-filtre" aria-label="Süzgeçler">
        <input type="search" data-f="ara" placeholder="Başlık, yazar, etiket, DOI, özet ara…" aria-label="Ara">
        <select data-f="tur" aria-label="Tür"><option value="">Tüm türler</option>${Object.entries(TURLER).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select data-f="etiket" aria-label="Etiket"><option value="">Tüm etiketler</option></select>
        <select data-f="yazar" aria-label="Yazar"><option value="">Tüm yazarlar</option></select>
        <input type="number" data-f="yilBas" placeholder="Yıl ≥" min="0" max="3000" aria-label="Başlangıç yılı">
        <input type="number" data-f="yilSon" placeholder="Yıl ≤" min="0" max="3000" aria-label="Bitiş yılı">
        <select data-f="gorunurluk" aria-label="Görünürlük"><option value="">Tüm görünürlükler</option>${Object.entries(GORUNURLUK).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <label class="ak-onay"><input type="checkbox" data-f="pdfli"> Yalnız PDF'li</label>
        <select data-f="sira" aria-label="Sırala"><option value="guncel">Son güncellenen</option><option value="baslik">Başlık (A–Z)</option><option value="yil-yeni">Yıl (yeni → eski)</option><option value="yil-eski">Yıl (eski → yeni)</option><option value="yazar">Yazar (A–Z)</option></select>
        <span class="ak-gorunum" role="group" aria-label="Görünüm"><button type="button" data-gorunum="kart" class="aktif" title="Kart görünümü" aria-label="Kart görünümü">▦</button><button type="button" data-gorunum="liste" title="Liste görünümü" aria-label="Liste görünümü">☰</button></span>
        <span class="ak-bicim"><select data-ak-bicim aria-label="Atıf biçimi">${BICIMLER.map((b) => `<option value="${b.anahtar}">${b.etiket}</option>`).join("")}</select><select data-ak-dil aria-label="Atıf dili"><option value="tr">TR</option><option value="en">EN</option></select></span>
      </section>
      <p class="ak-ozet" data-ak-ozet aria-live="polite"></p>
      <div class="ak-liste ak-kart-gorunum" data-ak-liste></div>
      <dialog class="ak-dlg" data-dlg="detay" aria-label="Kaynak ayrıntısı"></dialog>
      <dialog class="ak-dlg ak-dlg-genis" data-dlg="form" aria-label="Kaynak formu"></dialog>
      <dialog class="ak-dlg" data-dlg="disa" aria-label="Dışa aktar"></dialog>
    </div>`;

  const q = (s) => kok.querySelector(s);
  const dlg = (n) => q(`[data-dlg="${n}"]`);
  const kayit = (id) => d.kayitlar.find((k) => k.id === id);
  const benim = (k) => k.user_id === profil.id;

  /* ------------------------------ veri ------------------------------ */
  async function yukle() {
    q("[data-ak-ozet]").textContent = "Yükleniyor…";
    let veri = [], hata = null;
    if (owner) {
      const r = await supabase.rpc("owner_akademik_kaynaklari_getir", { p_user_id: d.uye || null });
      veri = r.data || []; hata = r.error;
    } else {
      let s = supabase.from("akademik_kaynaklar").select("*").order("guncelleme_tarihi", { ascending: false });
      s = d.kapsam === "benim" ? s.eq("user_id", profil.id) : s.neq("user_id", profil.id);
      const r = await s;
      veri = r.data || []; hata = r.error;
    }
    if (hata) {
      q("[data-ak-ozet]").textContent = "";
      q("[data-ak-liste]").innerHTML = `<p class="ak-bos ak-hata">Kaynaklar yüklenemedi: ${esc(hata.message)}. Migration 0072'nin uygulandığından ve bu özelliğin rolün için açık olduğundan emin ol.</p>`;
      return;
    }
    d.kayitlar = veri;
    facetleriDoldur();
    ciz();
  }

  function facetleriDoldur() {
    const sec = (ad, secenekler, ilk) => {
      const e = q(`[data-f="${ad}"]`);
      const onceki = e.value;
      e.innerHTML = `<option value="">${ilk}</option>` + secenekler.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
      e.value = secenekler.includes(onceki) ? onceki : "";
      d.f[ad] = e.value;
    };
    sec("etiket", [...new Set(d.kayitlar.flatMap((k) => k.etiketler || []))].sort((a, b) => a.localeCompare(b, "tr")), "Tüm etiketler");
    sec("yazar", [...new Set(d.kayitlar.flatMap((k) => (k.yazarlar || []).map((y) => y.kurum || y.soyadi).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "tr")), "Tüm yazarlar");
  }

  function suzulmus() {
    const f = d.f;
    const ara = f.ara.trim().toLocaleLowerCase("tr");
    let s = d.kayitlar.filter((k) => {
      if (f.tur && k.tur !== f.tur) return false;
      if (f.etiket && !(k.etiketler || []).includes(f.etiket)) return false;
      if (f.yazar && !(k.yazarlar || []).some((y) => (y.kurum || y.soyadi) === f.yazar)) return false;
      if (f.yilBas && !(k.yayin_yili >= Number(f.yilBas))) return false;
      if (f.yilSon && !(k.yayin_yili <= Number(f.yilSon))) return false;
      if (f.gorunurluk && k.gorunurluk !== f.gorunurluk) return false;
      if (f.pdfli && !k.pdf_r2_yolu) return false;
      if (ara) {
        const havuz = [k.baslik, k.doi, k.isbn, k.dergi_veya_yayinevi, k.ozet, (k.etiketler || []).join(" "), (k.yazarlar || []).map((y) => `${y.adi || ""} ${y.soyadi || ""} ${y.kurum || ""}`).join(" "), k.sahip_ad, k.sahip_eposta].join(" ").toLocaleLowerCase("tr");
        if (!havuz.includes(ara)) return false;
      }
      return true;
    });
    const tr = (a, b) => String(a || "").localeCompare(String(b || ""), "tr");
    const sirala = { baslik: (a, b) => tr(a.baslik, b.baslik), "yil-yeni": (a, b) => (b.yayin_yili || 0) - (a.yayin_yili || 0), "yil-eski": (a, b) => (a.yayin_yili || 9999) - (b.yayin_yili || 9999), yazar: (a, b) => tr(kisaYazar(a.yazarlar), kisaYazar(b.yazarlar)), guncel: (a, b) => String(b.guncelleme_tarihi).localeCompare(String(a.guncelleme_tarihi)) };
    return s.sort(sirala[f.sira] || sirala.guncel);
  }

  /* ----------------------------- liste çizimi ----------------------------- */
  function ciz() {
    const s = suzulmus();
    q("[data-ak-ozet]").textContent = `${s.length} / ${d.kayitlar.length} kaynak${d.kayitlar.length ? ` · toplam PDF: ${bayt(d.kayitlar.reduce((t, k) => t + Number(k.pdf_boyut_bayt || 0), 0))}` : ""}`;
    const liste = q("[data-ak-liste]");
    liste.className = `ak-liste ak-${d.gorunum}-gorunum`;
    if (!s.length) { liste.innerHTML = `<p class="ak-bos">${d.kayitlar.length ? "Süzgeçlere uyan kaynak yok." : owner ? "Henüz hiçbir üye kaynak eklememiş." : d.kapsam === "benim" ? "Henüz kaynak yok. PDF sürükle, “Kaynak ekle” de ya da .bib/.ris içe aktar." : "Seninle paylaşılmış kaynak yok."}</p>`; return; }
    liste.innerHTML = s.map((k) => {
      const yazarMeta = [kisaYazar(k.yazarlar), k.yayin_yili, k.dergi_veya_yayinevi].filter(Boolean).map(esc).join(" · ");
      return `<article class="ak-kart" data-id="${esc(k.id)}">
        <div class="ak-kart-ust"><span class="ak-rozet">${esc(TURLER[k.tur] || k.tur)}</span><span class="ak-rozet ak-g-${esc(k.gorunurluk)}">${esc(GORUNURLUK[k.gorunurluk])}</span>${k.pdf_r2_yolu ? `<span class="ak-rozet ak-pdf">PDF · ${bayt(k.pdf_boyut_bayt)}</span>` : ""}${owner ? `<span class="ak-rozet ak-sahip" title="${esc(k.sahip_eposta)}">${esc(k.sahip_ad || k.sahip_eposta)}${k.not_sayisi ? ` · ${k.not_sayisi} not` : ""}</span>` : ""}${!owner && d.kapsam === "paylasilan" ? '<span class="ak-rozet">Salt okunur</span>' : ""}</div>
        <h3 class="ak-kart-baslik">${esc(kayitBaslik(k))}</h3>
        <p class="ak-kart-yazar">${yazarMeta || "—"}</p>
        ${(k.etiketler || []).length ? `<div class="ak-etiketler">${k.etiketler.map((e) => `<button type="button" class="ak-etiket" data-etiket="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : ""}
        <div class="ak-kart-eylem">
          ${k.pdf_r2_yolu ? `<button type="button" class="ak-btn ak-btn-birincil" data-act="ac">📖 Oku</button>` : ""}
          <button type="button" class="ak-btn" data-act="atif" title="Seçili biçimde atıfı panoya kopyala">❝ Atıf</button>
          <button type="button" class="ak-btn" data-act="detay">Ayrıntı</button>
          ${benim(k) ? `<button type="button" class="ak-btn" data-act="duzenle">Düzenle</button>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  /* ------------------------------- eylemler ------------------------------- */
  async function pdfAc(k) {
    if (!k.pdf_r2_yolu) { toast("Bu kaynağın PDF'i yok.", "uyari"); return; }
    await okuyucuAc({ kaynak: { ...k }, salt: !benim(k), kullaniciAdi: profil.ad, kapaninca: () => yukle() });
  }
  async function atifKopyala(k) {
    const o = atifUret(k, d.bicim, { dil: d.dil });
    await panoyaKopyala(o.text, `<p>${o.html}</p>`);
    toast(`${BICIMLER.find((b) => b.anahtar === d.bicim).etiket} atfı kopyalandı.`, "basari");
  }

  function atifPaneli(k) {
    const o = atifUret(k, d.bicim, { dil: d.dil });
    return `<div class="ak-atif">
      <div class="ak-atif-baslik"><strong>Atıf</strong>
        <select data-ak-d-bicim aria-label="Biçim">${BICIMLER.map((b) => `<option value="${b.anahtar}"${b.anahtar === d.bicim ? " selected" : ""}>${b.etiket}</option>`).join("")}</select>
        <select data-ak-d-dil aria-label="Dil"><option value="tr"${d.dil === "tr" ? " selected" : ""}>Türkçe</option><option value="en"${d.dil === "en" ? " selected" : ""}>English</option></select></div>
      <p class="ak-atif-metin">${o.html}</p>
      <div class="ak-atif-eylem">
        <button type="button" class="ak-btn" data-kop="text">Düz metin</button>
        <button type="button" class="ak-btn" data-kop="md" title="Blog Markdown'una yapıştırılacak kaynakça maddesi">Markdown (blog)</button>
        <button type="button" class="ak-btn" data-kop="html" title="_includes/atif-kutusu.html ile aynı işaretleme">HTML (atıf kutusu)</button>
        <button type="button" class="ak-btn" data-kop="bib">BibTeX</button>
        <button type="button" class="ak-btn" data-kop="ris">RIS</button>
      </div></div>`;
  }

  async function detayAc(id) {
    const k = kayit(id);
    if (!k) return;
    const dl = dlg("detay");
    const yazarlar = (k.yazarlar || []).map((y) => y.kurum || [y.adi, y.soyadi].filter(Boolean).join(" ")).join(", ");
    const ek = k.ek_alanlar || {};
    const satir = (e, v) => (v ? `<dt>${e}</dt><dd>${v}</dd>` : "");
    dl.innerHTML = `
      <form method="dialog" class="ak-dlg-ic">
        <header class="ak-dlg-ust"><h3>${esc(k.baslik)}</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
        <div class="ak-dlg-govde">
          <dl class="ak-kunye">
            ${satir("Tür", esc(TURLER[k.tur]))}${satir("Yazarlar", esc(yazarlar))}${satir("Yıl", esc(k.yayin_yili))}
            ${satir(esc(KAP_ETIKET[k.tur] || "Yayın"), esc(k.dergi_veya_yayinevi))}
            ${satir("Cilt / Sayı / Sayfa", esc([ek.cilt, ek.sayi, ek.sayfa].filter(Boolean).join(" / ")))}
            ${satir("DOI", k.doi ? `<a href="https://doi.org/${esc(k.doi)}" target="_blank" rel="noopener noreferrer">${esc(k.doi)}</a>` : "")}
            ${satir("ISBN", esc(k.isbn))}${satir("Bağlantı", k.url && /^https?:/i.test(k.url) ? `<a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${esc(k.url)}</a>` : esc(k.url))}
            ${satir("Etiketler", (k.etiketler || []).map(esc).join(", "))}${satir("Görünürlük", esc(GORUNURLUK[k.gorunurluk]))}
            ${owner ? satir("Sahibi", esc(`${k.sahip_ad || ""} <${k.sahip_eposta || ""}> (${k.sahip_rol})`)) : ""}
            ${k.pdf_r2_yolu ? satir("PDF", esc(`${k.pdf_dosya_adi || ""} · ${bayt(k.pdf_boyut_bayt)} · sürüm ${k.pdf_rev}`)) : ""}
            ${satir("Eklenme", tarih(k.olusturma_tarihi))}
          </dl>
          ${k.ozet ? `<details class="ak-ozet-kutu"><summary>Özet</summary><p>${esc(k.ozet)}</p></details>` : ""}
          <div data-ak-atif-yer>${atifPaneli(k)}</div>
          <section class="ak-notlar"><h4>Notlar ve alıntılar</h4><div data-ak-notlar>Yükleniyor…</div></section>
        </div>
        <footer class="ak-dlg-alt">
          ${k.pdf_r2_yolu ? `<button type="button" class="ak-btn ak-btn-birincil" data-d="ac">📖 PDF'i oku</button><button type="button" class="ak-btn" data-d="indir">⬇ PDF'i indir</button>` : ""}
          ${benim(k) ? `<button type="button" class="ak-btn" data-d="duzenle">Düzenle</button><button type="button" class="ak-btn ak-tehlike" data-d="sil">Sil</button>` : ""}
        </footer>
      </form>`;
    dl.dataset.id = id;
    dl.showModal();
    notlariYukle(k);
  }

  async function notlariYukle(k) {
    const yer = dlg("detay").querySelector("[data-ak-notlar]");
    const { data, error } = await supabase.from("akademik_notlar").select("*").eq("kaynak_id", k.id).order("sayfa", { nullsFirst: true }).order("created_at");
    if (error) { yer.textContent = `Notlar yüklenemedi: ${error.message}`; return; }
    const hepsi = data || [];
    const serbest = hepsi.filter((n) => !n.ek_id);
    const aciklama = hepsi.filter((n) => n.ek_id);
    const ad = { vurgu: "Vurgu", altcizgi: "Altı çizili", ustcizgi: "Üstü çizili", cizim: "Çizim", sekil: "Şekil", yapiskan: "Not", metin: "Metin" };
    const oge = (n, serbestMi) => `<article class="ak-not" data-nid="${esc(n.id)}">
      ${n.renk ? `<span class="ak-not-renk" data-renk="${esc(n.renk)}"></span>` : ""}
      <div class="ak-not-ic"><div class="ak-not-ust"><span>${esc(serbestMi ? (n.tur === "alinti" ? "Alıntı" : "Not") : ad[n.tur] || n.tur)}${n.sayfa ? ` · s. ${n.sayfa}` : ""}</span>
        <span><button type="button" class="ak-btn" data-n="md" title="Markdown kopyala">❝</button>${serbestMi && benim(k) ? '<button type="button" class="ak-btn" data-n="duzenle">Düzenle</button><button type="button" class="ak-btn ak-tehlike" data-n="sil">Sil</button>' : ""}</span></div>
        ${n.metin ? `<blockquote>${esc(n.metin)}</blockquote>` : ""}${n.yorum ? `<p>${esc(n.yorum)}</p>` : ""}</div></article>`;
    yer.innerHTML = `
      ${benim(k) ? `<div class="ak-not-yeni"><select data-nt="tur" aria-label="Tür"><option value="not">Not</option><option value="alinti">Alıntı</option></select>
        <input type="number" min="1" data-nt="sayfa" placeholder="Sayfa" aria-label="Sayfa">
        <textarea data-nt="metin" rows="2" placeholder="Not / alıntı metni (Markdown olabilir)" aria-label="Not metni"></textarea>
        <button type="button" class="ak-btn ak-btn-birincil" data-n="ekle">Ekle</button></div>` : ""}
      ${serbest.length ? `<h5>Serbest notlar (${serbest.length})</h5>${serbest.map((n) => oge(n, true)).join("")}` : ""}
      ${aciklama.length ? `<h5>PDF açıklamaları (${aciklama.length}) <button type="button" class="ak-btn" data-n="md-tumu">Hepsini Markdown kopyala</button></h5>${aciklama.map((n) => oge(n, false)).join("")}` : ""}
      ${!hepsi.length ? '<p class="ak-bos">Henüz not ya da PDF açıklaması yok.</p>' : ""}`;
    yer.querySelectorAll(".ak-not-renk").forEach((n) => { n.style.background = n.dataset.renk; });
    yer._notlar = hepsi;
  }

  /* detay penceresi olayları */
  dlg("detay").addEventListener("click", async (e) => {
    const dl = dlg("detay");
    const k = kayit(dl.dataset.id);
    if (!k) return;
    const kopya = e.target.closest("[data-kop]")?.dataset.kop;
    if (kopya) {
      const o = atifUret(k, d.bicim, { dil: d.dil });
      if (kopya === "text") await panoyaKopyala(o.text, `<p>${o.html}</p>`);
      else if (kopya === "md") await panoyaKopyala(`- ${o.md}`);
      else if (kopya === "html") await panoyaKopyala(atifKutusuHtml(k, d.bicim, { dil: d.dil }));
      else if (kopya === "bib") await panoyaKopyala(bibtexUret([k]));
      else if (kopya === "ris") await panoyaKopyala(risUret([k]));
      toast("Panoya kopyalandı.", "basari");
      return;
    }
    const a = e.target.closest("[data-d]")?.dataset.d;
    if (a === "ac") { dl.close(); pdfAc(k); }
    else if (a === "indir") {
      try {
        const r = await workerFetch(`/pdf/${k.id}?indir=1`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
        dosyaIndir(k.pdf_dosya_adi || "belge.pdf", await r.blob());
      } catch (h) { toast(`İndirilemedi: ${h.message}`, "hata"); }
    } else if (a === "duzenle") { dl.close(); formAc(k); }
    else if (a === "sil") { dl.close(); await kaynakSil(k); }

    const nB = e.target.closest("[data-n]");
    if (nB) {
      const yer = dl.querySelector("[data-ak-notlar]");
      const n = nB.closest("[data-nid]") ? yer._notlar.find((x) => x.id === nB.closest("[data-nid]").dataset.nid) : null;
      const t = nB.dataset.n;
      if (t === "md" && n) { await panoyaKopyala(alintiMarkdown(n, k)); toast("Markdown alıntısı kopyalandı.", "basari"); }
      else if (t === "md-tumu") { await panoyaKopyala(yer._notlar.filter((x) => x.ek_id && (x.metin || x.yorum)).map((x) => alintiMarkdown(x, k)).join("\n\n")); toast("Tüm açıklamalar Markdown olarak kopyalandı.", "basari"); }
      else if (t === "ekle") {
        const metin = yer.querySelector('[data-nt="metin"]').value.trim();
        if (!metin) { toast("Not metni boş.", "uyari"); return; }
        const sayfa = Number(yer.querySelector('[data-nt="sayfa"]').value) || null;
        const tur = yer.querySelector('[data-nt="tur"]').value;
        const { error } = await supabase.from("akademik_notlar").insert(tur === "alinti" ? { kaynak_id: k.id, tur, sayfa, metin } : { kaynak_id: k.id, tur, sayfa, yorum: metin });
        if (error) toast(`Eklenemedi: ${error.message}`, "hata"); else notlariYukle(k);
      } else if (t === "sil" && n) {
        if (!confirm("Bu not silinsin mi?")) return;
        const { error } = await supabase.from("akademik_notlar").delete().eq("id", n.id);
        if (error) toast(error.message, "hata"); else notlariYukle(k);
      } else if (t === "duzenle" && n) {
        const yeni = prompt("Notu düzenle:", n.metin || n.yorum || "");
        if (yeni === null) return;
        const { error } = await supabase.from("akademik_notlar").update(n.tur === "alinti" ? { metin: yeni } : { yorum: yeni }).eq("id", n.id);
        if (error) toast(error.message, "hata"); else notlariYukle(k);
      }
    }
  });
  dlg("detay").addEventListener("change", (e) => {
    const k = kayit(dlg("detay").dataset.id);
    if (!k) return;
    if (e.target.matches("[data-ak-d-bicim]")) d.bicim = e.target.value;
    else if (e.target.matches("[data-ak-d-dil]")) d.dil = e.target.value;
    else return;
    dlg("detay").querySelector("[data-ak-atif-yer]").innerHTML = atifPaneli(k);
    q("[data-ak-bicim]").value = d.bicim;
    q("[data-ak-dil]").value = d.dil;
  });

  async function kaynakSil(k) {
    if (!confirm(`“${k.baslik}” kaynağı, PDF'i ve notları kalıcı olarak silinsin mi?`)) return;
    try {
      if (k.pdf_r2_yolu) await workerJson(`/pdf/${k.id}`, { method: "DELETE" });
      const { error } = await supabase.from("akademik_kaynaklar").delete().eq("id", k.id);
      if (error) throw new Error(error.message);
      toast("Kaynak silindi.", "basari");
      yukle();
    } catch (h) { toast(`Silinemedi: ${h.message}`, "hata"); }
  }

  /* --------------------------- ekle / düzenle formu --------------------------- */
  function formAc(k = null, ilkPdf = null) {
    const ek = k?.ek_alanlar || {};
    const v = (x) => esc(x ?? "");
    const dl = dlg("form");
    dl.innerHTML = `
      <form class="ak-dlg-ic ak-form" novalidate>
        <header class="ak-dlg-ust"><h3>${k ? "Kaynağı düzenle" : "Yeni kaynak"}</h3><button type="button" class="ak-btn" data-x="kapat" aria-label="Kapat">✕</button></header>
        <div class="ak-dlg-govde">
          <div class="ak-otodoldur"><label>DOI, ISBN ya da makale bağlantısı<input type="text" name="girdi" placeholder="10.1000/xyz123 · 978-… · https://…" autocomplete="off"></label>
            <button type="button" class="ak-btn ak-btn-birincil" data-x="getir">Künyeyi getir</button><span class="ak-kunye-durum" data-ak-kd aria-live="polite"></span></div>
          <div class="ak-grid">
            <label>Tür<select name="tur">${Object.entries(TURLER).map(([a, b]) => `<option value="${a}"${(k?.tur || "makale") === a ? " selected" : ""}>${b}</option>`).join("")}</select></label>
            <label>Yıl<input type="number" name="yayin_yili" min="0" max="3000" value="${v(k?.yayin_yili)}"></label>
            <label class="ak-tam">Başlık *<input type="text" name="baslik" required maxlength="1000" value="${v(k?.baslik)}"></label>
            <label class="ak-tam">Yazarlar <small>(her satıra bir yazar: “Soyad, Ad”; kurum için {Kurum Adı})</small><textarea name="yazarlar" rows="3">${v(yazarlariMetneCevir(k?.yazarlar))}</textarea></label>
            <label class="ak-tam"><span data-ak-kap-etiket>${KAP_ETIKET[k?.tur || "makale"]}</span><input type="text" name="dergi_veya_yayinevi" maxlength="500" value="${v(k?.dergi_veya_yayinevi)}"></label>
            <label data-tur="makale">Cilt<input type="text" name="cilt" value="${v(ek.cilt)}"></label>
            <label data-tur="makale">Sayı<input type="text" name="sayi" value="${v(ek.sayi)}"></label>
            <label data-tur="makale kitap_bolumu bildiri">Sayfa aralığı<input type="text" name="sayfa" placeholder="45-67" value="${v(ek.sayfa)}"></label>
            <label data-tur="kitap kitap_bolumu rapor">Baskı<input type="text" name="baski" value="${v(ek.baski)}"></label>
            <label data-tur="kitap kitap_bolumu rapor">Yayın yeri (şehir)<input type="text" name="sehir" value="${v(ek.sehir)}"></label>
            <label data-tur="kitap_bolumu" class="ak-tam">Kitap adı<input type="text" name="kitap_adi" value="${v(ek.kitap_adi)}"></label>
            <label data-tur="kitap_bolumu bildiri">Yayınevi<input type="text" name="yayinevi" value="${v(ek.yayinevi)}"></label>
            <label data-tur="kitap_bolumu" class="ak-tam">Editör(ler) <small>(satır başına bir kişi)</small><textarea name="editor" rows="2">${v(ek.editor)}</textarea></label>
            <label data-tur="tez">Tez türü<input type="text" name="tez_turu" placeholder="Doktora tezi" value="${v(ek.tez_turu)}"></label>
            <label data-tur="rapor">Rapor no<input type="text" name="rapor_no" value="${v(ek.rapor_no)}"></label>
            <label>DOI<input type="text" name="doi" placeholder="10.1000/xyz123" value="${v(k?.doi)}"></label>
            <label>ISBN<input type="text" name="isbn" value="${v(k?.isbn)}"></label>
            <label class="ak-tam">Bağlantı (URL)<input type="url" name="url" value="${v(k?.url)}"></label>
            <label class="ak-tam">Özet<textarea name="ozet" rows="4">${v(k?.ozet)}</textarea></label>
            <label class="ak-tam">Etiketler <small>(virgülle ayır)</small><input type="text" name="etiketler" value="${v((k?.etiketler || []).join(", "))}"></label>
            <label>Görünürlük<select name="gorunurluk">${Object.entries(GORUNURLUK).map(([a, b]) => `<option value="${a}"${(k?.gorunurluk || "ozel") === a ? " selected" : ""}>${b}</option>`).join("")}</select>
              <small>Özel: sadece sen · Ekip: editör/yönetici rolleri okuyabilir · Herkese açık: kütüphane kullanan her üye okuyabilir. (Site sahibi her zaman inceleyebilir.)</small></label>
            <label>${k?.pdf_r2_yolu ? "PDF'i değiştir" : "PDF ekle"}<input type="file" name="pdf" accept="application/pdf,.pdf"></label>
          </div>
        </div>
        <footer class="ak-dlg-alt"><span class="ak-form-durum" data-ak-fd aria-live="polite"></span>
          <button type="button" class="ak-btn" data-x="kapat">Vazgeç</button><button type="submit" class="ak-btn ak-btn-birincil">${k ? "Kaydet" : "Ekle"}</button></footer>
      </form>`;
    const f = dl.querySelector("form");
    const turGuncelle = () => {
      const t = f.tur.value;
      f.querySelectorAll("[data-tur]").forEach((n) => { n.hidden = !n.dataset.tur.split(" ").includes(t); });
      f.querySelector("[data-ak-kap-etiket]").textContent = KAP_ETIKET[t];
    };
    turGuncelle();
    f.tur.addEventListener("change", turGuncelle);
    if (ilkPdf) { const dt = new DataTransfer(); dt.items.add(ilkPdf); f.pdf.files = dt.files; }

    const doldur = (kn) => {
      const set = (ad, val) => { if (val !== null && val !== undefined && val !== "" && f[ad]) f[ad].value = val; };
      set("tur", kn.tur); turGuncelle();
      set("baslik", kn.baslik); set("yayin_yili", kn.yayin_yili); set("dergi_veya_yayinevi", kn.dergi_veya_yayinevi);
      set("doi", kn.doi); set("isbn", kn.isbn); set("url", kn.url); set("ozet", kn.ozet);
      if (kn.yazarlar?.length) f.yazarlar.value = yazarlariMetneCevir(kn.yazarlar);
      const e2 = kn.ek_alanlar || {};
      for (const a of ["cilt", "sayi", "sayfa", "baski", "sehir", "kitap_adi", "yayinevi", "editor", "tez_turu", "rapor_no"]) set(a, e2[a]);
    };
    dl.onclick = async (e) => { // onclick: form her açıldığında dinleyici birikmesin
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (x === "kapat") dl.close();
      else if (x === "getir") {
        const durum = dl.querySelector("[data-ak-kd]");
        durum.textContent = "Aranıyor…";
        try {
          const { kunye, kaynak } = await kunyeGetir(f.girdi.value);
          doldur(kunye);
          durum.textContent = `✓ ${kaynak} üzerinden dolduruldu. Kontrol et.`;
        } catch (h) { durum.textContent = `✗ ${h.message}`; }
      }
    };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const durum = dl.querySelector("[data-ak-fd]");
      const baslik = f.baslik.value.trim();
      if (!baslik) { durum.textContent = "Başlık zorunlu."; f.baslik.focus(); return; }
      const doi = f.doi.value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
      if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) { durum.textContent = "DOI biçimi geçersiz (10.xxxx/…)."; return; }
      const isbn = f.isbn.value.trim();
      if (isbn && !/^[0-9Xx-]{10,17}$/.test(isbn)) { durum.textContent = "ISBN biçimi geçersiz."; return; }
      const ekA = {};
      for (const a of ["cilt", "sayi", "sayfa", "baski", "sehir", "kitap_adi", "yayinevi", "editor", "tez_turu", "rapor_no"]) {
        const el0 = f[a];
        if (el0 && !el0.closest("[data-tur]")?.hidden && el0.value.trim()) ekA[a] = el0.value.trim();
      }
      const satir = {
        baslik, tur: f.tur.value,
        yazarlar: yazarMetniAyristir(f.yazarlar.value),
        yayin_yili: f.yayin_yili.value ? Number(f.yayin_yili.value) : null,
        dergi_veya_yayinevi: f.dergi_veya_yayinevi.value.trim() || null,
        doi: doi || null, isbn: isbn || null, url: f.url.value.trim() || null, ozet: f.ozet.value.trim() || null,
        etiketler: [...new Set(f.etiketler.value.split(",").map((t) => t.trim()).filter(Boolean))],
        ek_alanlar: ekA, gorunurluk: f.gorunurluk.value,
      };
      const btn = f.querySelector('[type="submit"]');
      btn.disabled = true;
      durum.textContent = "Kaydediliyor…";
      try {
        const sonuc = k ? await supabase.from("akademik_kaynaklar").update(satir).eq("id", k.id).select().single() : await supabase.from("akademik_kaynaklar").insert(satir).select().single();
        if (sonuc.error) throw new Error(sonuc.error.code === "23505" ? "Bu DOI kütüphanende zaten kayıtlı." : sonuc.error.message);
        const pdf = f.pdf.files[0];
        if (pdf) {
          durum.textContent = "PDF yükleniyor… %0";
          await pdfYukle(sonuc.data.id, pdf, { dosyaAdi: pdf.name, ilerleme: (o) => { durum.textContent = `PDF yükleniyor… %${Math.round(o * 100)}`; } });
        }
        dl.close();
        toast(k ? "Kaynak güncellendi." : "Kaynak eklendi.", "basari");
        yukle();
      } catch (h) {
        durum.textContent = `✗ ${h.message}`;
      } finally { btn.disabled = false; }
    });
    dl.showModal();
  }

  /* ----------------------- sürükle-bırak PDF yükleme ----------------------- */
  async function pdfDosyalariniYukle(dosyalar) {
    const pdfler = [...dosyalar].filter((f0) => f0.type === "application/pdf" || /\.pdf$/i.test(f0.name));
    if (!pdfler.length) { toast("Yalnızca PDF dosyaları yüklenebilir.", "uyari"); return; }
    if (pdfler.length === 1) { formAc(null, pdfler[0]); return; } // tek dosya: künyeyi birlikte tamamla
    const liste = q("[data-ak-yukleme]");
    let basarili = 0;
    for (const dosya of pdfler) {
      const li = el("li", {}, `${dosya.name} (${bayt(dosya.size)}) — bekliyor…`);
      liste.append(li);
      try {
        const baslik = dosya.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim().slice(0, 900) || "Başlıksız";
        const { data, error } = await supabase.from("akademik_kaynaklar").insert({ baslik, tur: "makale" }).select().single();
        if (error) throw new Error(error.message);
        await pdfYukle(data.id, dosya, { dosyaAdi: dosya.name, ilerleme: (o) => { li.textContent = `${dosya.name} — %${Math.round(o * 100)}`; } });
        li.textContent = `✓ ${dosya.name}`;
        basarili++;
      } catch (h) { li.textContent = `✗ ${dosya.name}: ${h.message}`; li.classList.add("ak-hata"); }
    }
    toast(`${basarili}/${pdfler.length} PDF yüklendi. Künyeleri “Düzenle” ile tamamlayabilirsin.`, basarili ? "basari" : "hata");
    yukle();
  }

  /* --------------------------- içe / dışa aktarma --------------------------- */
  async function iceAktar(dosya) {
    const metin = await dosya.text();
    const bicim = icerikBicimiTahmin(dosya.name, metin);
    if (!bicim) { toast("Dosya BibTeX ya da RIS olarak tanınmadı.", "hata"); return; }
    let kayitlar;
    try { kayitlar = bicim === "bib" ? bibtexAyristir(metin) : risAyristir(metin); } catch (h) { toast(`Dosya çözümlenemedi: ${h.message}`, "hata"); return; }
    if (!kayitlar.length) { toast("Dosyada kaynak bulunamadı.", "uyari"); return; }
    if (!confirm(`${kayitlar.length} kaynak bulundu (${bicim === "bib" ? "BibTeX" : "RIS"}). Kütüphaneye eklensin mi?`)) return;
    const mevcutDoi = new Set(d.kayitlar.filter(benim).map((k) => (k.doi || "").toLowerCase()).filter(Boolean));
    const goruldu = new Set();
    const yeni = kayitlar.filter((k) => {
      if (!k.doi) return true;
      const x = k.doi.toLowerCase();
      if (mevcutDoi.has(x) || goruldu.has(x)) return false;
      goruldu.add(x);
      return true;
    });
    const atlanan = kayitlar.length - yeni.length;
    let eklenen = 0, hatali = 0;
    for (let i = 0; i < yeni.length; i += 50) {
      const parca = yeni.slice(i, i + 50);
      const { error } = await supabase.from("akademik_kaynaklar").insert(parca);
      if (!error) { eklenen += parca.length; continue; }
      for (const k of parca) { // toplu eklemede hata → tek tek dene, sorunluyu atla
        const r = await supabase.from("akademik_kaynaklar").insert(k);
        if (r.error) hatali++; else eklenen++;
      }
    }
    toast(`${eklenen} kaynak eklendi${atlanan ? `, ${atlanan} yinelenen DOI atlandı` : ""}${hatali ? `, ${hatali} kayıt eklenemedi` : ""}.`, hatali ? "uyari" : "basari", 7000);
    yukle();
  }

  function disaAktarAc() {
    const s = suzulmus();
    const dl = dlg("disa");
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>Dışa aktar</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><p>${s.length} kaynak (şu anki süzgece göre).</p>
        <div class="ak-atif-eylem"><button type="button" class="ak-btn ak-btn-birincil" data-o="bib">BibTeX (.bib) indir</button><button type="button" class="ak-btn ak-btn-birincil" data-o="ris">RIS (.ris) indir</button></div>
        <h4>Kaynakça (${BICIMLER.find((b) => b.anahtar === d.bicim).etiket}, ${d.dil.toUpperCase()})</h4>
        <div class="ak-atif-eylem"><button type="button" class="ak-btn" data-o="md">Markdown olarak kopyala</button><button type="button" class="ak-btn" data-o="html">HTML (atıf kutusu) olarak kopyala</button><button type="button" class="ak-btn" data-o="txt">Düz metin kopyala</button></div></div></form>`;
    dl.onclick = async (e) => {
      const o = e.target.closest("[data-o]")?.dataset.o;
      if (!o) return;
      if (!s.length) { toast("Aktarılacak kaynak yok.", "uyari"); return; }
      const adBase = `akademik-kutuphane-${bugunDamga()}`;
      if (o === "bib") dosyaIndir(`${adBase}.bib`, bibtexUret(s), "application/x-bibtex;charset=utf-8");
      else if (o === "ris") dosyaIndir(`${adBase}.ris`, risUret(s), "application/x-research-info-systems;charset=utf-8");
      else {
        const sec = { dil: d.dil };
        const metin = o === "md" ? markdownKaynakca(s, d.bicim, sec) : o === "html" ? s.map((k) => atifKutusuHtml(k, d.bicim, sec)).join("\n") : s.map((k) => atifUret(k, d.bicim, sec).text).sort((a, b) => a.localeCompare(b, d.dil)).join("\n\n");
        await panoyaKopyala(metin);
        toast("Kaynakça panoya kopyalandı.", "basari");
      }
    };
    dl.showModal();
  }

  /* ------------------------ owner: okuyucu motoru kartı ------------------------ */
  async function motorKarti() {
    const yer = q("[data-ak-motor]");
    if (!yer) return;
    yer.innerHTML = '<p class="ak-bos">Okuyucu motoru bilgisi alınıyor…</p>';
    const ayar = await motorAyarlari();
    let surumler = [];
    try { surumler = await yayimlananSurumler(); } catch { /* çevrimdışı olabilir */ }
    const son = surumler[0];
    const guncel = son && son !== ayar.pdfjs;
    yer.innerHTML = `<details class="ak-motor-kutu"${guncel ? " open" : ""}><summary>⚙️ Okuyucu motoru: PDF.js <strong>${esc(ayar.pdfjs)}</strong> · pdf-lib ${esc(ayar.pdflib)}${guncel ? ` <span class="ak-rozet ak-yeni">Yeni sürüm: ${esc(son)}</span>` : ""}</summary>
      <p>Tüm kullanıcılar bu sürümü kullanır (resmi PDF.js, jsDelivr CDN). Yeni sürümü önce dene, sonra sabitle; sorun çıkarsa eski sürüme dönebilirsin. Okuyucu hiçbir zaman açılamazsa sınanmış varsayılan sürüme düşer.</p>
      <div class="ak-motor-satir"><label>Sürüm <select data-m="surum">${(surumler.length ? surumler : [ayar.pdfjs]).map((s) => `<option value="${esc(s)}"${s === ayar.pdfjs ? " selected" : ""}>${esc(s)}${s === ayar.pdfjs ? " (aktif)" : ""}${s === son ? " — en yeni" : ""}</option>`).join("")}</select></label>
        <button type="button" class="ak-btn" data-m="dene">Dene</button>
        <button type="button" class="ak-btn ak-btn-birincil" data-m="sabitle">Bu sürümü sabitle</button>
        ${guncel ? '<button type="button" class="ak-btn ak-btn-birincil" data-m="son">Okuyucu Motorunu Güncelle (en yeni)</button>' : ""}
        <span data-m-durum aria-live="polite"></span></div></details>`;
    const durum = yer.querySelector("[data-m-durum]");
    yer.onclick = async (e) => {
      const t = e.target.closest("[data-m]")?.dataset.m;
      if (!t || t === "surum") return;
      const secili = t === "son" ? son : yer.querySelector('[data-m="surum"]').value;
      durum.textContent = `PDF.js ${secili} deneniyor…`;
      const sonuc = await surumuDene(secili);
      if (!sonuc.ok) { durum.textContent = `✗ ${secili} yüklenemedi; sabitlenmedi.`; return; }
      if (t === "dene") { durum.textContent = `✓ ${secili} yüklenebiliyor (henüz aktif değil).`; return; }
      try {
        await surumuSabitle(secili);
        durum.textContent = `✓ ${secili} sabitlendi. Kullanıcılar sayfayı yenileyince geçer.`;
        toast(`Okuyucu motoru PDF.js ${secili} olarak sabitlendi.`, "basari");
      } catch (h) { durum.textContent = `✗ ${h.message}`; }
    };
  }

  /* ------------------------------- olay bağlama ------------------------------- */
  kok.addEventListener("click", (e) => {
    const kart = e.target.closest(".ak-kart");
    const act = e.target.closest("[data-act]")?.dataset.act;
    const k = kart ? kayit(kart.dataset.id) : null;
    if (e.target.closest("[data-etiket]")) { const t = e.target.closest("[data-etiket]").dataset.etiket; q('[data-f="etiket"]').value = t; d.f.etiket = t; ciz(); return; }
    if (act === "ac" && k) pdfAc(k);
    else if (act === "atif" && k) atifKopyala(k);
    else if (act === "detay" && k) detayAc(k.id);
    else if (act === "duzenle" && k) formAc(k);
    else if (act === "ekle") formAc();
    else if (act === "ice-aktar") q("[data-ak-ice]").click();
    else if (act === "disa-aktar") disaAktarAc();
    else if (kart && !e.target.closest("button, a")) detayAc(kart.dataset.id);
    const g = e.target.closest("[data-gorunum]")?.dataset.gorunum;
    if (g) { d.gorunum = g; kok.querySelectorAll("[data-gorunum]").forEach((b) => b.classList.toggle("aktif", b.dataset.gorunum === g)); ciz(); }
    const ks = e.target.closest("[data-kapsam]")?.dataset.kapsam;
    if (ks) { d.kapsam = ks; kok.querySelectorAll("[data-kapsam]").forEach((b) => { b.classList.toggle("aktif", b.dataset.kapsam === ks); b.setAttribute("aria-selected", String(b.dataset.kapsam === ks)); }); q("[data-ak-dz]").hidden = ks !== "benim"; yukle(); }
    if (e.target.closest("[data-ak-dz]") && !e.target.closest("input, li")) q("[data-ak-pdf]").click();
  });
  const filtreDegisti = (e) => {
    const ad = e.target.dataset?.f;
    if (!ad) return;
    if (ad === "uye") { d.uye = e.target.value; yukle(); return; }
    d.f[ad] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    ciz();
  };
  kok.addEventListener("change", filtreDegisti);
  kok.addEventListener("input", debounce((e) => { if (e.target.dataset?.f === "ara" || e.target.dataset?.f === "yilBas" || e.target.dataset?.f === "yilSon") filtreDegisti(e); }, 180));
  q("[data-ak-bicim]").addEventListener("change", (e) => { d.bicim = e.target.value; });
  q("[data-ak-dil]").addEventListener("change", (e) => { d.dil = e.target.value; });
  q("[data-ak-ice]")?.addEventListener("change", (e) => { const f0 = e.target.files[0]; e.target.value = ""; if (f0) iceAktar(f0); });
  q("[data-ak-pdf]")?.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; if (fl.length) pdfDosyalariniYukle(fl); });
  const dz = q("[data-ak-dz]");
  if (dz) {
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); q("[data-ak-pdf]").click(); } });
    ["dragenter", "dragover"].forEach((ad) => dz.addEventListener(ad, (e) => { e.preventDefault(); dz.classList.add("surukle"); }));
    ["dragleave", "drop"].forEach((ad) => dz.addEventListener(ad, (e) => { e.preventDefault(); dz.classList.remove("surukle"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) pdfDosyalariniYukle(e.dataTransfer.files); });
  }
  kok.querySelectorAll("dialog").forEach((dl) => dl.addEventListener("click", (e) => { if (e.target === dl) dl.close(); }));

  if (owner) {
    supabase.rpc("owner_akademik_uyeleri_getir").then(({ data }) => {
      d.uyeler = data || [];
      q('[data-f="uye"]').innerHTML = `<option value="">Tüm üyeler (${d.uyeler.length})</option>` + d.uyeler.map((u) => `<option value="${esc(u.user_id)}">${esc(u.ad || u.eposta)} — ${u.kaynak_sayisi} kaynak · ${bayt(u.toplam_bayt)}</option>`).join("");
    });
    motorKarti();
  }
  return { yukle };
}

/* ================================= başlatma ================================= */

async function basla() {
  const kendi = document.getElementById("ak-kok");
  const sahip = document.getElementById("ak-owner-kok");
  if (!kendi && !sahip) return;
  const profil = await profilAl();
  if (!profil) return;
  if (kendi) kutuphaneKur(kendi, profil, false).yukle();
  if (sahip && profil.role === "owner") kutuphaneKur(sahip, profil, true).yukle();
}

basla().catch((h) => console.error("kutuphane.js:", h));
