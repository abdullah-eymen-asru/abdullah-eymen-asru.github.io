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
import { motorPaneliKur } from "./motor-paneli.js";
import { eklentiPaneliKur } from "./eklenti-paneli.js";
import { aciklamalariIceAl } from "./aciklama-ice.js";
import { rdfAyristir, dosyaBul } from "./ice-zotero.js";
import { bekleyenleriGonder } from "./taslak.js";
import { ayarYukle, ayarKaydet } from "./eklentiler.js";

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
    uye: "", uyeler: [], uyelerYuklu: "",
    klasorler: [], ogeler: new Map(), klasor: "", acik: new Set(), klasorHata: "", notlar: new Map(),
    secili: new Set(), secimModu: false, aramalar: [], uyeIcin: "",
  };
  try { d.bicim = localStorage.getItem("aea_ak_bicim") || d.bicim; d.dil = localStorage.getItem("aea_ak_dil") || d.dil; } catch { /* yok say */ }

  kok.innerHTML = `
    <div class="ak-kutu">
      <header class="ak-ust">
        <div><h2>${owner ? "🛡️ Tüm Kullanıcıların Kaynakları" : "📚 Akademik Kütüphane"}</h2>
          <p class="ak-alt">${owner ? "Önce bir üye seç; kaynakları o üyenin kendi klasör düzeniyle görürsün. Her şey <strong>salt okunurdur</strong>." : "Kaynaklarını, PDF'lerini, vurgularını ve atıflarını klasörlerle düzenle. Değişiklikler otomatik kaydedilir."}</p></div>
        <div class="ak-ust-sag">
          ${owner ? `<button type="button" class="ak-btn" data-act="disa-aktar">⇩ Dışa aktar</button>` : `
          <span class="ak-menu">
            <button type="button" class="ak-btn ak-btn-birincil" data-act="menu-ekle" aria-haspopup="true" aria-expanded="false">＋ Ekle ▾</button>
            <div class="ak-menu-liste" data-ak-menu-ekle role="menu" hidden>
              <button type="button" role="menuitem" data-act="pdf-sec">📄 PDF yükle <small>(açıklamalarıyla birlikte)</small></button>
              <button type="button" role="menuitem" data-act="ekle">✍ Kaynağı elle / DOI ile ekle</button>
              <button type="button" role="menuitem" data-act="ice-aktar">⇪ BibTeX / RIS / Zotero RDF dosyası</button>
              <button type="button" role="menuitem" data-act="zotero-klasor">🗂 Zotero dışa aktarma klasörü <small>(klasörler + PDF'ler)</small></button>
              <button type="button" role="menuitem" data-act="klasor-yeni">📁 Yeni klasör</button>
            </div>
          </span>
          <button type="button" class="ak-btn" data-act="disa-aktar">⇩ Dışa aktar</button>
          <input type="file" class="ak-gizli-alan" data-ak-ice accept=".bib,.bibtex,.ris,.rdf,.txt" aria-label="BibTeX / RIS / RDF dosyası">
          <input type="file" class="ak-gizli-alan" data-ak-zotero webkitdirectory multiple aria-label="Zotero dışa aktarma klasörü">
          <input type="file" class="ak-gizli-alan" data-ak-pdf accept="application/pdf,.pdf" multiple aria-label="PDF dosyaları">`}
        </div>
      </header>
      ${owner ? "" : `
      <nav class="ak-sekmeler" role="tablist" aria-label="Bölümler">
        <button type="button" role="tab" class="aktif" data-kapsam="benim" aria-selected="true">Kütüphanem</button>
        <button type="button" role="tab" data-kapsam="paylasilan" aria-selected="false">Benimle paylaşılanlar</button>
        <button type="button" role="tab" data-kapsam="paylasim" aria-selected="false">🔗 Paylaş</button>
        <button type="button" role="tab" data-kapsam="ayarlar" aria-selected="false">⚙ Ayarlar</button>
      </nav>`}
      <div class="ak-owner-bar" data-ak-uyeler hidden>
        <div class="ak-uye-ust">
          <input type="search" class="ak-uye-ara" data-uye-ara placeholder="${owner ? "Üye adı veya e-posta ara…" : "Üye adı ara…"}" aria-label="Üye ara" autocomplete="off">
          <button type="button" class="ak-btn" data-act="uye-geri" hidden>← Tüm üyeler</button>
          <strong class="ak-uye-secili" data-ak-secili-uye></strong>
        </div>
        <ul class="ak-uye-liste" data-ak-uye-liste></ul>
        <div class="ak-uye-pz" data-ak-uye-pz hidden></div>
      </div>

      <div class="ak-paylasim" data-ak-paylasim hidden></div>
      <div class="ak-ayarlar" data-ak-ayarlar hidden>
        <section class="ak-ayar-kart">
          <h3>Atıf</h3>
          <div class="ak-ayar-satir"><label>Varsayılan biçim <select data-ak-bicim aria-label="Atıf biçimi">${BICIMLER.map((b) => `<option value="${b.anahtar}">${b.etiket}</option>`).join("")}</select></label>
          <label>Dil <select data-ak-dil aria-label="Atıf dili"><option value="tr">Türkçe</option><option value="en">English</option></select></label></div>
          <p class="ak-alt">Kaynak kartındaki “❝ Atıf” bu biçimde panoya kopyalar.</p>
        </section>
        <section class="ak-ayar-kart">
          <h3>Kayıt</h3>
          <p class="ak-alt">Vurgu, yorum ve çizimlerin her değişiklikte <strong>otomatik</strong> hesabına kaydedilir (Kaydet'e basmana gerek yok). PDF dosyasının kendisi ise okuyucuyu kapatırken tek seferde güncellenir; böylece depolama (R2) işlem kotası boşa harcanmaz.</p>
        </section>
        <div class="ak-motor" data-ak-motor></div>
        <div class="ak-motor ak-eklentiler" data-ak-eklentiler></div>
      </div>

      <div class="ak-zot" data-ak-zot>
        <aside class="ak-agac" aria-label="Klasörler">
          <button type="button" class="ak-agac-ac" data-act="agac-ac" aria-expanded="false">📁 <span data-ak-agac-ad>Tüm kaynaklar</span> <span aria-hidden="true">▾</span></button>
          <div class="ak-agac-ic"><div data-ak-agac></div><div data-ak-aramalar></div></div>
        </aside>
        <section class="ak-orta">
          <div class="ak-arama-satiri">
            <div class="ak-arama">
              <span aria-hidden="true">🔍</span>
              <input type="search" data-f="ara" placeholder="Başlık, yazar, etiket, DOI, özet ve notlarda ara…" aria-label="Ara" autocomplete="off">
              <button type="button" class="ak-btn ak-filtre-dugme" data-act="filtre-ac" aria-expanded="false" aria-controls="ak-filtre-pop">Filtreler <span class="ak-say" data-ak-filtre-say hidden></span></button>
              ${owner ? "" : '<button type="button" class="ak-btn ak-ikon-dugme" data-act="arama-kaydet" title="Bu aramayı/filtreyi kaydet" aria-label="Aramayı kaydet">🔖</button>'}
            </div>
            <select data-f="sira" aria-label="Sırala"><option value="guncel">Son güncellenen</option><option value="baslik">Başlık (A–Z)</option><option value="yil-yeni">Yıl (yeni → eski)</option><option value="yil-eski">Yıl (eski → yeni)</option><option value="yazar">Yazar (A–Z)</option></select>
            <button type="button" class="ak-btn" data-act="secim-modu" title="Birden çok kaynak seç" aria-pressed="false">☑ Seç</button>
            ${owner ? "" : `<span class="ak-menu"><button type="button" class="ak-btn" data-act="menu-arac" aria-haspopup="true" aria-expanded="false">⋯ Araçlar</button><div class="ak-menu-liste" data-ak-menu-arac role="menu" hidden><button type="button" role="menuitem" data-act="etiket-yonet">🏷 Etiketleri yönet</button><button type="button" role="menuitem" data-act="yinelenen">🧩 Yinelenenleri bul ve birleştir</button><button type="button" role="menuitem" data-act="tarayici-dugmesi">🔖 Tarayıcı düğmesi (sayfadan ekle)</button></div></span>`}
            <span class="ak-gorunum" role="group" aria-label="Görünüm"><button type="button" data-gorunum="kart" class="aktif" title="Kart görünümü" aria-label="Kart görünümü">▦</button><button type="button" data-gorunum="liste" title="Liste görünümü" aria-label="Liste görünümü">≡</button></span>
          </div>
          <section class="ak-filtre-pop" id="ak-filtre-pop" data-ak-filtre aria-label="Filtreler" hidden>
            <label>Tür <select data-f="tur"><option value="">Tümü</option>${Object.entries(TURLER).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
            <label>Etiket <select data-f="etiket"><option value="">Tümü</option></select></label>
            <label>Yazar <select data-f="yazar"><option value="">Tümü</option></select></label>
            <label>Yıl (başlangıç) <input type="number" data-f="yilBas" min="0" max="3000" inputmode="numeric"></label>
            <label>Yıl (bitiş) <input type="number" data-f="yilSon" min="0" max="3000" inputmode="numeric"></label>
            <label>Görünürlük <select data-f="gorunurluk"><option value="">Tümü</option>${Object.entries(GORUNURLUK).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
            <label class="ak-onay"><input type="checkbox" data-f="pdfli"> Yalnız PDF'li</label>
            <button type="button" class="ak-btn" data-act="filtre-temizle">Filtreleri temizle</button>
          </section>
          <div class="ak-cipler" data-ak-cipler></div>
          <div class="ak-toplu" data-ak-toplu hidden></div>
          <p class="ak-ozet" data-ak-ozet aria-live="polite"></p>
          <div class="ak-liste ak-kart-gorunum" data-ak-liste></div>
          ${owner ? "" : `<div class="ak-dropzone ak-dropzone-ince" data-ak-dz tabindex="0" role="button" aria-label="PDF yüklemek için tıkla ya da sürükle">
            <strong>PDF'leri buraya sürükle</strong> <span>ya da tıkla — içindeki vurgu ve yorumlar aynen gelir${"" }.</span>
            <ul class="ak-yukleme" data-ak-yukleme></ul>
          </div>`}
        </section>
      </div>
      <dialog class="ak-dlg" data-dlg="detay" aria-label="Kaynak ayrıntısı"></dialog>
      <dialog class="ak-dlg ak-dlg-genis" data-dlg="form" aria-label="Kaynak formu"></dialog>
      <dialog class="ak-dlg" data-dlg="disa" aria-label="Dışa aktar"></dialog>
      <dialog class="ak-dlg" data-dlg="klasor" aria-label="Klasörlere ekle"></dialog>
    </div>`;

  const q = (s) => kok.querySelector(s);
  const dlg = (n) => q(`[data-dlg="${n}"]`);
  const kayit = (id) => d.kayitlar.find((k) => k.id === id);
  const benim = (k) => k.user_id === profil.id;

  /* ------------------------------ veri ------------------------------ */
  async function yukle() {
    if (d.kapsam === "ayarlar") return;
    q("[data-ak-ozet]").textContent = "Yükleniyor…";
    uyeGorunumu();
    if (uyeModu() && !d.uye) { d.kayitlar = []; d.klasorler = []; d.ogeler = new Map(); return; }   // önce üye seçilir; kaynaklar topluca çekilmez
    const hedef = uyeModu() ? d.uye : profil.id;
    let veri = [], hata = null;
    if (owner) {
      const r = await supabase.rpc("owner_akademik_kaynaklari_getir", { p_user_id: d.uye || null });
      veri = r.data || []; hata = r.error;
    } else {
      const r = await hepsiniAl(() => supabase.from("akademik_kaynaklar").select("*").eq("user_id", hedef).order("guncelleme_tarihi", { ascending: false }));
      veri = r.data; hata = r.error;
    }
    if (hata) {
      q("[data-ak-ozet]").textContent = "";
      q("[data-ak-liste]").innerHTML = `<p class="ak-bos ak-hata">Kaynaklar yüklenemedi: ${esc(hata.message)}. Migration 0072'nin uygulandığından ve bu özelliğin rolün için açık olduğundan emin ol.</p>`;
      return;
    }
    await klasorYukle(hedef);
    d.kayitlar = veri;
    facetleriDoldur();
    agacCiz();
    ciz();
    aramaNotlariniYukle().catch(() => {});
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
    const belirtec = tokenlar(f.ara);
    const kume = d.klasor && d.klasor !== "__yok" ? klasorKumesi(d.klasor) : null;
    const dosyali = d.klasor === "__yok" ? dosyaliKume() : null;
    let s = d.kayitlar.filter((k) => {
      k._notEslesme = false;
      if (kume && !kume.has(k.id)) return false;
      if (dosyali && dosyali.has(k.id)) return false;
      if (f.tur && k.tur !== f.tur) return false;
      if (f.etiket && !(k.etiketler || []).includes(f.etiket)) return false;
      if (f.yazar && !(k.yazarlar || []).some((y) => (y.kurum || y.soyadi) === f.yazar)) return false;
      if (f.yilBas && !(k.yayin_yili >= Number(f.yilBas))) return false;
      if (f.yilSon && !(k.yayin_yili <= Number(f.yilSon))) return false;
      if (f.gorunurluk && k.gorunurluk !== f.gorunurluk) return false;
      if (f.pdfli && !k.pdf_r2_yolu) return false;
      if (belirtec.length) {
        const havuz = [k.baslik, k.doi, k.isbn, k.dergi_veya_yayinevi, k.ozet, (k.etiketler || []).join(" "), (k.yazarlar || []).map((y) => `${y.adi || ""} ${y.soyadi || ""} ${y.kurum || ""}`).join(" "), k.yayin_yili, k.aciklama_metni].join(" ").toLocaleLowerCase("tr");
        const notMetni = d.notlar.get(k.id) || "";
        // Her sözcük künyede YA DA vurgu/yorum metinlerinde geçmeli (tüm sözcükler birlikte aranır)
        if (!belirtec.every((b) => havuz.includes(b) || notMetni.includes(b))) return false;
        k._notEslesme = !belirtec.every((b) => havuz.includes(b));
      }
      return true;
    });
    const tr = (a, b) => String(a || "").localeCompare(String(b || ""), "tr");
    const sirala = { baslik: (a, b) => tr(a.baslik, b.baslik), "yil-yeni": (a, b) => (b.yayin_yili || 0) - (a.yayin_yili || 0), "yil-eski": (a, b) => (a.yayin_yili || 9999) - (b.yayin_yili || 9999), yazar: (a, b) => tr(kisaYazar(a.yazarlar), kisaYazar(b.yazarlar)), guncel: (a, b) => String(b.guncelleme_tarihi).localeCompare(String(a.guncelleme_tarihi)) };
    return s.sort(sirala[f.sira] || sirala.guncel);
  }

  /* ----------------------------- liste çizimi ----------------------------- */
  function ciz() {
    cipCiz();
    const s = suzulmus();
    const topPdf = d.kayitlar.reduce((x, k) => x + Number(k.pdf_boyut_bayt || 0), 0);
    q("[data-ak-ozet]").textContent = `${s.length === d.kayitlar.length ? `${s.length} kaynak` : `${s.length} / ${d.kayitlar.length} kaynak`}${d.kayitlar.length ? ` · toplam PDF: ${bayt(topPdf)}` : ""}`;
    const liste = q("[data-ak-liste]");
    liste.className = `ak-liste ak-${d.gorunum}-gorunum`;
    const bosMetin = d.kayitlar.length ? "Aramaya / filtrelere / klasöre uyan kaynak yok." : owner ? "Bu üyenin kaynağı yok." : d.kapsam === "benim" ? "Henüz kaynak yok. “＋ Ekle” menüsünden PDF yükle ya da PDF'leri aşağıdaki alana sürükle." : "Bu üyenin sana görünen kaynağı yok.";
    if (!s.length) { liste.innerHTML = `<p class="ak-bos">${bosMetin}</p>`; return; }
    const surukle = duzenlenebilir();
    liste.innerHTML = s.map((k) => {
      const yazarMeta = [kisaYazar(k.yazarlar), k.yayin_yili, k.dergi_veya_yayinevi].filter(Boolean).map(esc).join(" · ");
      const kl = duzenlenebilir() ? d.klasorler.filter((x) => d.ogeler.get(x.id)?.has(k.id)).map((x) => x.ad) : [];
      return `<article class="ak-kart${d.secili.has(k.id) ? " secili" : ""}" data-id="${esc(k.id)}"${surukle ? ' draggable="true"' : ""}>
        <label class="ak-sec" title="Seç"><input type="checkbox" data-sec value="${esc(k.id)}" ${d.secili.has(k.id) ? "checked" : ""} aria-label="Seç: ${esc(kayitBaslik(k))}"></label>
        <div class="ak-kart-ust"><span class="ak-rozet">${esc(TURLER[k.tur] || k.tur)}</span>${benim(k) && !owner ? `<span class="ak-rozet ak-g-${esc(k.gorunurluk)}">${esc(GORUNURLUK[k.gorunurluk])}</span>` : ""}${k.pdf_r2_yolu ? `<span class="ak-rozet ak-pdf">PDF · ${bayt(k.pdf_boyut_bayt)}</span>` : ""}${owner && k.not_sayisi ? `<span class="ak-rozet">${k.not_sayisi} not</span>` : ""}${k._notEslesme ? '<span class="ak-rozet ak-notta" title="Aradığın sözcükler bu kaynağın vurgu/yorumlarında geçiyor">💬 notlarda geçiyor</span>' : ""}</div>
        <h3 class="ak-kart-baslik">${esc(kayitBaslik(k))}</h3>
        <p class="ak-kart-yazar">${yazarMeta || "—"}</p>
        ${(k.etiketler || []).length ? `<div class="ak-etiketler">${k.etiketler.map((e) => `<button type="button" class="ak-etiket" data-etiket="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : ""}
        ${kl.length ? `<p class="ak-kart-klasor">📁 ${kl.map(esc).join(" · ")}</p>` : ""}
        <div class="ak-kart-eylem">
          ${k.pdf_r2_yolu ? `<button type="button" class="ak-btn ak-btn-birincil" data-act="ac">📖 Oku</button>` : ""}
          <button type="button" class="ak-btn" data-act="atif" title="Atıfı panoya kopyala (biçim: Ayarlar)">❝ Atıf</button>
          <button type="button" class="ak-btn" data-act="detay">Ayrıntı</button>
          ${benim(k) && !owner && d.kapsam === "benim" ? `<button type="button" class="ak-btn" data-act="klasor-ata" title="Klasörlere ekle / çıkar">📁</button><button type="button" class="ak-btn" data-act="duzenle">Düzenle</button>` : ""}
        </div>
      </article>`;
    }).join("");
    topluCiz();
  }

  /* ------------------------------ yardımcılar ------------------------------ */
  const uyeModu = () => owner || d.kapsam === "paylasilan";
  const duzenlenebilir = () => !owner && d.kapsam === "benim";
  const tokenlar = (s) => String(s || "").toLocaleLowerCase("tr").split(/\s+/).filter(Boolean);

  /** PostgREST sayfa sınırını (≈1000) aşan tabloları sayfa sayfa toplar. */
  async function hepsiniAl(kur) {
    const hepsi = [];
    for (let bas = 0; bas < 50000; bas += 1000) {
      const { data, error } = await kur().range(bas, bas + 999);
      if (error) return { data: hepsi, error };
      hepsi.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { data: hepsi, error: null };
  }

  /* ------------------------------ klasörler (Zotero koleksiyonları) ------------------------------ */
  async function klasorYukle(uid) {
    d.klasorHata = "";
    const [k, o] = await Promise.all([
      hepsiniAl(() => supabase.from("akademik_koleksiyonlar").select("id,ust_id,ad,sira,user_id").eq("user_id", uid).order("ad")),
      hepsiniAl(() => supabase.from("akademik_koleksiyon_ogeleri").select("koleksiyon_id,kaynak_id").eq("user_id", uid)),
    ]);
    if (k.error || o.error) { d.klasorler = []; d.ogeler = new Map(); d.klasorHata = (k.error || o.error).message; return; }
    d.klasorler = k.data;
    d.ogeler = new Map();
    for (const r of o.data) { if (!d.ogeler.has(r.koleksiyon_id)) d.ogeler.set(r.koleksiyon_id, new Set()); d.ogeler.get(r.koleksiyon_id).add(r.kaynak_id); }
    if (d.klasor && d.klasor !== "__yok" && !d.klasorler.some((x) => x.id === d.klasor)) d.klasor = "";
  }
  const altKlasorler = (id) => { const s = [id]; for (const k of d.klasorler) if (k.ust_id === id) s.push(...altKlasorler(k.id)); return s; };
  const klasorKumesi = (id) => { const kume = new Set(); for (const kid of altKlasorler(id)) for (const s of d.ogeler.get(kid) || []) kume.add(s); return kume; };
  const dosyaliKume = () => { const kume = new Set(); for (const s of d.ogeler.values()) for (const x of s) kume.add(x); return kume; };
  const klasorYolu = (id) => { const p = []; let k = d.klasorler.find((x) => x.id === id), n = 0; while (k && n++ < 20) { p.unshift(k.ad); k = d.klasorler.find((x) => x.id === k.ust_id); } return p.join(" › "); };

  function agacCiz() {
    const alan = q("[data-ak-agac]"); if (!alan) return;
    const edit = duzenlenebilir();
    const mevcut = new Set(d.kayitlar.map((k) => k.id));
    const sayi = (id) => { let n = 0; for (const s of klasorKumesi(id)) if (mevcut.has(s)) n++; return n; };
    const dosyali = dosyaliKume();
    const yok = d.kayitlar.filter((k) => !dosyali.has(k.id)).length;
    const cocuklar = (ust) => d.klasorler.filter((k) => (k.ust_id || null) === ust).sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
    const dal = (ust, seviye) => cocuklar(ust).map((k) => {
      const alt = cocuklar(k.id).length, acik = d.acik.has(k.id);
      return `<li role="treeitem" aria-expanded="${alt ? acik : "false"}"><div class="ak-kl${d.klasor === k.id ? " aktif" : ""}" data-kl="${esc(k.id)}" style="--sev:${seviye}">
        ${alt ? `<button type="button" class="ak-kl-ok${acik ? " acik" : ""}" data-kl-ac="${esc(k.id)}" aria-label="${esc(k.ad)} klasörünü ${acik ? "kapat" : "aç"}">▸</button>` : `<span class="ak-kl-ok bos"></span>`}
        <button type="button" class="ak-kl-ad" data-klasor="${esc(k.id)}" title="${esc(klasorYolu(k.id))}"><span aria-hidden="true">${acik && alt ? "📂" : "📁"}</span> <span class="ak-kl-metin">${esc(k.ad)}</span> <span class="ak-kl-say">${sayi(k.id)}</span></button>
        ${edit ? `<button type="button" class="ak-kl-dis" data-kl-menu="${esc(k.id)}" title="Klasör ayarları" aria-label="${esc(k.ad)} klasör ayarları" aria-haspopup="true">⚙</button>` : ""}
      </div>${alt && acik ? `<ul role="group">${dal(k.id, seviye + 1)}</ul>` : ""}</li>`;
    }).join("");
    alan.innerHTML = `<ul role="tree" class="ak-agac-liste">
      <li role="treeitem"><div class="ak-kl${d.klasor === "" ? " aktif" : ""}" style="--sev:0"><span class="ak-kl-ok bos"></span><button type="button" class="ak-kl-ad" data-klasor=""><span aria-hidden="true">🗂</span> <span class="ak-kl-metin">Tüm kaynaklar</span> <span class="ak-kl-say">${d.kayitlar.length}</span></button></div></li>
      ${dal(null, 0)}
      <li role="treeitem"><div class="ak-kl${d.klasor === "__yok" ? " aktif" : ""}" data-kl="__yok" style="--sev:0"><span class="ak-kl-ok bos"></span><button type="button" class="ak-kl-ad" data-klasor="__yok"><span aria-hidden="true">📥</span> <span class="ak-kl-metin">Klasörsüz</span> <span class="ak-kl-say">${yok}</span></button></div></li>
    </ul>
    ${edit ? `<button type="button" class="ak-btn ak-agac-yeni" data-act="klasor-yeni">＋ Yeni klasör</button>` : ""}
    ${d.klasorHata ? `<p class="ak-bos ak-hata">Klasörler yüklenemedi: ${esc(d.klasorHata)}. Migration 0117'nin uygulandığından emin ol.</p>` : ""}`;
    const ad = d.klasor === "" ? "Tüm kaynaklar" : d.klasor === "__yok" ? "Klasörsüz" : klasorYolu(d.klasor) || "Tüm kaynaklar";
    q("[data-ak-agac-ad]").textContent = ad;
  }
  async function klasorIslem(islem, id) {
    try {
      if (islem === "yeni" || islem === "alt") {
        const ad = (prompt(islem === "alt" ? `“${d.klasorler.find((k) => k.id === id)?.ad}” içine yeni klasör adı:` : "Yeni klasör adı:") || "").trim();
        if (!ad) return;
        const { data, error } = await supabase.from("akademik_koleksiyonlar").insert({ ad: ad.slice(0, 120), ust_id: islem === "alt" ? id : null, user_id: profil.id }).select().single();
        if (error) throw new Error(error.message);
        if (islem === "alt") d.acik.add(id);
        d.klasorler.push(data); d.klasor = data.id;
      } else if (islem === "ad") {
        const k = d.klasorler.find((x) => x.id === id); const ad = (prompt("Klasör adı:", k?.ad || "") || "").trim();
        if (!ad || ad === k?.ad) return;
        const { error } = await supabase.from("akademik_koleksiyonlar").update({ ad: ad.slice(0, 120) }).eq("id", id);
        if (error) throw new Error(error.message);
        k.ad = ad.slice(0, 120);
      } else if (islem === "sil") {
        const k = d.klasorler.find((x) => x.id === id);
        if (!confirm(`“${k?.ad}” klasörü ve alt klasörleri silinsin mi?\nİçindeki kaynaklar SİLİNMEZ; yalnızca klasörden çıkarılır.`)) return;
        const { error } = await supabase.from("akademik_koleksiyonlar").delete().eq("id", id);
        if (error) throw new Error(error.message);
        await klasorYukle(profil.id); if (d.klasor === id) d.klasor = "";
      }
      agacCiz(); ciz();
    } catch (h) { toast(`Klasör işlemi başarısız: ${h.message}`, "hata"); }
  }
  async function klasoreEkleCikar(kaynakId, klasorId, ekle) {
    const { error } = ekle
      ? await supabase.from("akademik_koleksiyon_ogeleri").upsert({ koleksiyon_id: klasorId, kaynak_id: kaynakId, user_id: profil.id }, { onConflict: "koleksiyon_id,kaynak_id", ignoreDuplicates: true })
      : await supabase.from("akademik_koleksiyon_ogeleri").delete().eq("koleksiyon_id", klasorId).eq("kaynak_id", kaynakId);
    if (error) throw new Error(error.message);
    if (!d.ogeler.has(klasorId)) d.ogeler.set(klasorId, new Set());
    if (ekle) d.ogeler.get(klasorId).add(kaynakId); else d.ogeler.get(klasorId).delete(kaynakId);
  }
  function klasorDialogu(kaynakId) {
    const k = kayit(kaynakId); const dl = dlg("klasor");
    const dalCiz = (ust, sev) => d.klasorler.filter((x) => (x.ust_id || null) === ust).sort((a, b) => a.ad.localeCompare(b.ad, "tr")).map((x) => `<label class="ak-kd-satir" style="--sev:${sev}"><input type="checkbox" data-kd="${esc(x.id)}" ${d.ogeler.get(x.id)?.has(kaynakId) ? "checked" : ""}> <span>📁 ${esc(x.ad)}</span></label>${dalCiz(x.id, sev + 1)}`).join("");
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><h3>Klasörlere ekle</h3><p class="ak-alt">${esc(k?.baslik || "")}</p>
      <div class="ak-kd-liste">${dalCiz(null, 0) || '<p class="ak-bos">Henüz klasör yok. Önce “＋ Yeni klasör” ile oluştur.</p>'}</div>
      <p class="ak-alt">Bir kaynak birden çok klasörde olabilir. Değişiklikler anında kaydedilir.</p>
      <div class="ak-dlg-eylem"><button class="ak-btn ak-btn-birincil" value="kapat">Tamam</button></div></form>`;
    dl.onchange = async (e) => {
      const kd = e.target.dataset?.kd; if (!kd) return;
      try { await klasoreEkleCikar(kaynakId, kd, e.target.checked); agacCiz(); ciz(); } catch (h) { e.target.checked = !e.target.checked; toast(`Kaydedilemedi: ${h.message}`, "hata"); }
    };
    dl.showModal();
  }

  /* ------------------------------ notlarda arama ------------------------------ */
  // Vurgu metinleri ve yorumlar da aramaya katılır (kaynak kartında "notlarda geçiyor" etiketi çıkar). Tek seferde, küçük sütunlarla yüklenir.
  async function aramaNotlariniYukle() {
    const idler = d.kayitlar.map((k) => k.id); d.notlar = new Map();
    for (let i = 0; i < idler.length; i += 150) {
      const { data } = await supabase.from("akademik_notlar").select("kaynak_id,metin,yorum").in("kaynak_id", idler.slice(i, i + 150)).limit(5000);
      for (const r of data || []) d.notlar.set(r.kaynak_id, `${d.notlar.get(r.kaynak_id) || ""} ${r.metin || ""} ${r.yorum || ""}`.toLocaleLowerCase("tr"));
    }
    if (tokenlar(d.f.ara).length) ciz();
  }

  /* ------------------------------ filtre çipleri ------------------------------ */
  function filtreSay() { const f = d.f; return [f.tur, f.etiket, f.yazar, f.yilBas, f.yilSon, f.gorunurluk, f.pdfli].filter(Boolean).length; }
  function cipCiz() {
    const f = d.f, c = [];
    if (d.klasor === "__yok") c.push(["klasor", "📥 Klasörsüz"]); else if (d.klasor) c.push(["klasor", `📁 ${klasorYolu(d.klasor)}`]);
    if (f.tur) c.push(["tur", TURLER[f.tur]]); if (f.etiket) c.push(["etiket", `# ${f.etiket}`]); if (f.yazar) c.push(["yazar", `✍ ${f.yazar}`]);
    if (f.yilBas) c.push(["yilBas", `≥ ${f.yilBas}`]); if (f.yilSon) c.push(["yilSon", `≤ ${f.yilSon}`]);
    if (f.gorunurluk) c.push(["gorunurluk", GORUNURLUK[f.gorunurluk]]); if (f.pdfli) c.push(["pdfli", "PDF'li"]);
    q("[data-ak-cipler]").innerHTML = c.map(([k, m]) => `<button type="button" class="ak-cip" data-cip="${k}" title="Kaldır">${esc(m)} <span aria-hidden="true">✕</span></button>`).join("");
    const n = filtreSay(), s = q("[data-ak-filtre-say]"); s.hidden = !n; s.textContent = n;
  }

  /* --------------------------- üye listesi (owner + paylaşılan) --------------------------- */
  const trKucuk = (s) => String(s || "").toLocaleLowerCase("tr");
  function uyeGorunumu() {
    const kapali = !uyeModu();
    q("[data-ak-uyeler]").hidden = kapali;
    const zot = q("[data-ak-zot]"); if (d.kapsam === "ayarlar" || d.kapsam === "paylasim") { zot.hidden = true; q("[data-ak-uyeler]").hidden = true; return; }
    const icerikGizle = uyeModu() && !d.uye;
    zot.hidden = icerikGizle;
    if (kapali) return;
    const secili = d.uyeler.find((u) => u.user_id === d.uye);
    q("[data-uye-ara]").hidden = !!d.uye; q("[data-ak-uye-liste]").hidden = !!d.uye; q('[data-act="uye-geri"]').hidden = !d.uye;
    const pzYer = q("[data-ak-uye-pz]");
    if (pzYer) { pzYer.hidden = !d.uye || owner; if (d.uye && !owner && d.uyeIcin !== d.uye) uyePaylasimlariniYukle(d.uye); }
    q("[data-ak-secili-uye]").textContent = secili ? `${secili.ad || secili.eposta} · ${secili.kaynak_sayisi} kaynak${secili.toplam_bayt != null ? ` · ${bayt(secili.toplam_bayt)}` : ""}` : "";
    if (d.uye) return;
    const a = tokenlar(q("[data-uye-ara]").value);
    const uyeler = d.uyeler.filter((u) => { const h = trKucuk(`${u.ad} ${owner ? u.eposta : ""}`); return a.every((t) => h.includes(t)); });
    q("[data-ak-uye-liste]").innerHTML = uyeler.length
      ? uyeler.map((u) => `<li><button type="button" class="ak-uye-kart" data-uye-sec="${esc(u.user_id)}"><strong>${esc(u.ad || u.eposta || "Üye")}</strong>${owner ? `<small>${esc(u.ad ? u.eposta : "")}${u.ad && u.eposta ? " · " : ""}${esc(u.rol)}</small>` : ""}<span>${u.paylasim_sayisi ? `${u.paylasim_sayisi} paylaşım · ` : ""}${u.kaynak_sayisi} kaynak${u.toplam_bayt != null ? ` · ${bayt(u.toplam_bayt)}` : ""}</span></button></li>`).join("")
      : `<li class="ak-bos">${d.uyeler.length ? "Aramaya uyan üye yok." : owner ? "Henüz hiçbir üye kaynak eklememiş." : "Seninle paylaşılmış kaynak yok."}</li>`;
  }
  /** Seçili üyenin paylaştığı kütüphaneler (herkese açık / üyelere): her biri ayrı sayfada açılır. */
  async function uyePaylasimlariniYukle(uid) {
    d.uyeIcin = uid; const yer = q("[data-ak-uye-pz]"); if (!yer) return;
    const { data } = await supabase.rpc("akademik_uye_paylasimlari", { p_uye: uid });
    if (d.uye !== uid) return;
    yer.innerHTML = data?.length ? `<h4>Paylaştığı kütüphaneler</h4><ul class="ak-uye-liste">${data.map((x) => `<li><a class="ak-uye-kart" href="${esc(paylasimAdresi(x.token))}" target="_blank" rel="noopener"><strong>${esc(x.baslik)}</strong><small>${esc(x.kapsam === "klasor" ? "Klasör" : "Tüm kütüphane")}${x.aciklama ? ` · ${esc(x.aciklama).slice(0, 60)}` : ""}</small><span>${x.kaynak_sayisi} kaynak ↗</span></a></li>`).join("")}</ul>` : "";
  }
  async function uyeleriYukle() {
    if (!uyeModu() || d.uyelerYuklu === d.kapsam) return;
    const { data, error } = await supabase.rpc(owner ? "owner_akademik_uyeleri_getir" : "akademik_paylasilan_uyeler");
    d.uyeler = data || []; d.uyelerYuklu = d.kapsam;
    if (error) q("[data-ak-uye-liste]").innerHTML = `<li class="ak-bos ak-hata">Üyeler yüklenemedi: ${esc(error.message)}${owner ? "" : ". Migration 0117 uygulanmış olmalı."}</li>`;
    else uyeGorunumu();
  }

  /* --------------------------- PDF yüklendikten sonra --------------------------- */
  async function yuklemeSonrasi(kaynakId, dosya) {
    let ice = 0;
    try { ice = await aciklamalariIceAl(kaynakId, dosya); } catch { /* PDF yine de eklendi */ }
    if (d.klasor && d.klasor !== "__yok") { try { await klasoreEkleCikar(kaynakId, d.klasor, true); } catch { /* klasör atanamadı: kaynak yine de eklendi */ } }
    return ice;
  }

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
  function formAc(k = null, ilkPdf = null, onDoldur = null) {
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
          { const ice = await yuklemeSonrasi(sonuc.data.id, pdf); if (ice) toast(`PDF içindeki ${ice} açıklama (vurgu/yorum) aynen içe alındı.`, "basari"); }
        }
        dl.close();
        toast(k ? "Kaynak güncellendi." : "Kaynak eklendi.", "basari");
        yukle();
      } catch (h) {
        durum.textContent = `✗ ${h.message}`;
      } finally { btn.disabled = false; }
    });
    if (onDoldur) onDoldur(dl.querySelector("form"));
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
        const ice = await yuklemeSonrasi(data.id, dosya);
        li.textContent = `✓ ${dosya.name}${ice ? ` — ${ice} açıklama içe alındı` : ""}`;
        basarili++;
      } catch (h) { li.textContent = `✗ ${dosya.name}: ${h.message}`; li.classList.add("ak-hata"); }
    }
    toast(`${basarili}/${pdfler.length} PDF yüklendi. Künyeleri “Düzenle” ile tamamlayabilirsin.`, basarili ? "basari" : "hata");
    yukle();
  }

  /* --------------------------- içe / dışa aktarma --------------------------- */
  /** Klasör yolunu (["Tez","Bölüm 1"]) oluşturur/bulur; son klasörün kimliğini döndürür. Aynı ad+üst klasör varsa yenisi açılmaz. */
  async function klasorYoluGarantile(yol, onbellek) {
    let ust = null;
    for (const ad of yol) {
      const anahtar = `${ust || ""}\u0001${ad.toLocaleLowerCase("tr")}`;
      let id = onbellek.get(anahtar) || d.klasorler.find((k) => (k.ust_id || null) === ust && k.ad.toLocaleLowerCase("tr") === ad.toLocaleLowerCase("tr"))?.id;
      if (!id) {
        const { data, error } = await supabase.from("akademik_koleksiyonlar").insert({ ad: ad.slice(0, 120), ust_id: ust, user_id: profil.id }).select().single();
        if (error) throw new Error(error.message);
        d.klasorler.push(data); id = data.id;
      }
      onbellek.set(anahtar, id); ust = id;
    }
    return ust;
  }

  /** İçe aktarma: BibTeX / RIS / Zotero RDF (+ Zotero dışa aktarma klasörü: PDF'ler ve klasör ağacı). */
  async function iceAktar(dosyalar) {
    const liste = Array.isArray(dosyalar) ? dosyalar : [dosyalar];
    const ana = liste.find((f) => /\.rdf$/i.test(f.name)) || liste.find((f) => /\.(bib|bibtex|ris|txt)$/i.test(f.name)) || liste[0];
    const metin = await ana.text();
    const bicim = icerikBicimiTahmin(ana.name, metin);
    if (!bicim) { toast("Dosya BibTeX, RIS ya da Zotero RDF olarak tanınmadı.", "hata"); return; }
    let kayitlar, rdfKlasor = 0;
    try {
      if (bicim === "rdf") { const r = rdfAyristir(metin); kayitlar = r.kayitlar; rdfKlasor = r.klasorSayisi; }
      else kayitlar = bicim === "bib" ? bibtexAyristir(metin) : risAyristir(metin);
    } catch (h) { toast(`Dosya çözümlenemedi: ${h.message}`, "hata"); return; }
    if (!kayitlar.length) { toast("Dosyada kaynak bulunamadı.", "uyari"); return; }
    const yoluDizi = (k) => (bicim === "rdf" ? k._klasor : k._klasor) || [];
    const pdfler = new Map();
    for (const k of kayitlar) for (const g of k._dosya || []) { const f = dosyaBul(liste, g); if (f && !pdfler.has(g)) pdfler.set(g, f); }
    const klasorYolSayisi = new Set(kayitlar.flatMap((k) => yoluDizi(k).map((y) => y.join("\u0001")))).size;
    if (!confirm(`${kayitlar.length} kaynak bulundu (${bicim === "bib" ? "BibTeX" : bicim === "ris" ? "RIS" : "Zotero RDF"}).\n${klasorYolSayisi ? `${klasorYolSayisi} klasör yolu${rdfKlasor ? ` (Zotero'da ${rdfKlasor} koleksiyon)` : ""} aynen kurulacak.\n` : ""}${pdfler.size ? `${pdfler.size} PDF dosyası yüklenecek.\n` : ""}Kütüphaneye eklensin mi?`)) return;

    const mevcutDoi = new Set(d.kayitlar.filter(benim).map((k) => (k.doi || "").toLowerCase()).filter(Boolean));
    const goruldu = new Set();
    const yeni = kayitlar.filter((k) => { if (!k.doi) return true; const x = k.doi.toLowerCase(); if (mevcutDoi.has(x) || goruldu.has(x)) return false; goruldu.add(x); return true; });
    const atlanan = kayitlar.length - yeni.length;
    const temiz = (k) => { const { _klasor, _dosya, _notlar, ...kalan } = k; return kalan; };
    const ozetYaz = (m) => { q("[data-ak-ozet]").textContent = m; };
    const eklenenler = []; let hatali = 0;
    for (let i = 0; i < yeni.length; i += 50) {
      ozetYaz(`Künyeler ekleniyor… ${Math.min(i + 50, yeni.length)}/${yeni.length}`);
      const parca = yeni.slice(i, i + 50);
      const { data, error } = await supabase.from("akademik_kaynaklar").insert(parca.map(temiz)).select("id");
      if (!error && data?.length === parca.length) { parca.forEach((k, n) => eklenenler.push({ k, id: data[n].id })); continue; }
      for (const k of parca) { const r = await supabase.from("akademik_kaynaklar").insert(temiz(k)).select("id").single(); if (r.error) hatali++; else eklenenler.push({ k, id: r.data.id }); }
    }
    // klasörler + ilişkiler
    let klasorHata = 0; const onbellek = new Map(); const bag = [];
    for (const { k, id } of eklenenler) {
      for (const yol of yoluDizi(k)) {
        try { const kid = await klasorYoluGarantile(yol, onbellek); if (kid) bag.push({ koleksiyon_id: kid, kaynak_id: id, user_id: profil.id }); } catch { klasorHata++; }
      }
    }
    for (let i = 0; i < bag.length; i += 200) await supabase.from("akademik_koleksiyon_ogeleri").upsert(bag.slice(i, i + 200), { onConflict: "koleksiyon_id,kaynak_id", ignoreDuplicates: true });
    // Zotero notları → kaynağa bağlı serbest notlar
    let notSayisi = 0;
    for (const { k, id } of eklenenler) for (const nt of k._notlar || []) { const { error } = await supabase.from("akademik_notlar").insert({ kaynak_id: id, user_id: profil.id, tur: "not", metin: nt.slice(0, 190000) }); if (!error) notSayisi++; }
    // PDF'ler (+ içlerindeki açıklamalar)
    let pdfOk = 0, pdfHata = 0, aciklama = 0, sira = 0;
    const toplamPdf = eklenenler.reduce((n, { k }) => n + ((k._dosya || []).some((g) => pdfler.has(g)) ? 1 : 0), 0);
    for (const { k, id } of eklenenler) {
      const g = (k._dosya || []).find((x) => pdfler.has(x)); if (!g) continue;
      const f = pdfler.get(g); sira++;
      try {
        ozetYaz(`PDF yükleniyor (${sira}/${toplamPdf}): ${f.name}`);
        await pdfYukle(id, f, { dosyaAdi: f.name });
        aciklama += await aciklamalariIceAl(id, f); pdfOk++;
      } catch { pdfHata++; }
    }
    toast(`${eklenenler.length} kaynak eklendi${atlanan ? `, ${atlanan} yinelenen DOI atlandı` : ""}${klasorYolSayisi ? `, klasör yapısı kuruldu` : ""}${notSayisi ? `, ${notSayisi} not` : ""}${pdfOk ? `, ${pdfOk} PDF yüklendi${aciklama ? ` (${aciklama} açıklama)` : ""}` : ""}${hatali || pdfHata || klasorHata ? ` · sorunlu: ${hatali} kaynak, ${pdfHata} PDF, ${klasorHata} klasör` : ""}.`, hatali || pdfHata || klasorHata ? "uyari" : "basari", 9000);
    await yukle();
  }

  /* --------------------------- klasörü taşı --------------------------- */
  function klasorTasiDialogu(id) {
    const k = d.klasorler.find((x) => x.id === id); if (!k) return;
    const yasak = new Set(altKlasorler(id)); const dl = dlg("klasor");
    const dalCiz = (ust, sev) => d.klasorler.filter((x) => (x.ust_id || null) === ust && !yasak.has(x.id)).sort((a, b) => a.ad.localeCompare(b.ad, "tr")).map((x) => `<label class="ak-kd-satir" style="--sev:${sev}"><input type="radio" name="yeniust" value="${esc(x.id)}" ${k.ust_id === x.id ? "checked" : ""}> <span>📁 ${esc(x.ad)}</span></label>${dalCiz(x.id, sev + 1)}`).join("");
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><h3>“${esc(k.ad)}” klasörünü taşı</h3>
      <div class="ak-kd-liste"><label class="ak-kd-satir"><input type="radio" name="yeniust" value="" ${!k.ust_id ? "checked" : ""}> <span>🗂 En üst düzey</span></label>${dalCiz(null, 0)}</div>
      <div class="ak-dlg-eylem"><button class="ak-btn" value="iptal">Vazgeç</button><button class="ak-btn ak-btn-birincil" value="tamam" data-tasi>Taşı</button></div></form>`;
    dl.onchange = null;
    dl.onclick = async (e) => {
      if (!e.target.closest("[data-tasi]")) return;
      e.preventDefault();
      const yeni = dl.querySelector('input[name="yeniust"]:checked')?.value || null;
      try {
        const { error } = await supabase.from("akademik_koleksiyonlar").update({ ust_id: yeni }).eq("id", id);
        if (error) throw new Error(error.message);
        k.ust_id = yeni; if (yeni) d.acik.add(yeni);
        dl.close(); agacCiz(); ciz();
      } catch (h) { toast(`Taşınamadı: ${h.message}`, "hata"); }
    };
    dl.showModal();
  }

  /* --------------------------- paylaşım (sade, 3 adım) --------------------------- */
  const paylasimAdresi = (token) => `${location.origin}/kutuphane/?t=${token}`;
  const ERISIM = {
    link: ["🔗", "Bağlantıyı bilen herkes", "Üye olmak gerekmez. Bağlantıyı sosyal medyada paylaşabilirsin."],
    herkes: ["🌍", "Herkese açık", "Bağlantı + site üyelerinin “Benimle paylaşılanlar” listesinde de görünür."],
    uyeler: ["👥", "Yalnızca site üyeleri", "Açmak için giriş yapmak gerekir."],
  };
  function paylasilacakSayisi(kapsam, klasorId, ozelDahil) {
    const benimkiler = d.kayitlar.filter(benim);
    const kume = kapsam === "klasor" && klasorId ? klasorKumesi(klasorId) : null;
    return benimkiler.filter((k) => (!kume || kume.has(k.id)) && (ozelDahil || k.gorunurluk !== "ozel")).length;
  }
  async function paylasimCiz(onSecilenKlasor = null) {
    const alan = q("[data-ak-paylasim]");
    alan.innerHTML = '<p class="ak-alt">Yükleniyor…</p>';
    if (!d.kayitlar.length) await yukle();
    const { data, error } = await supabase.from("akademik_paylasimlari").select("*").order("created_at", { ascending: false });
    if (error) { alan.innerHTML = `<p class="ak-bos ak-hata">Paylaşımlar yüklenemedi: ${esc(error.message)}. Migration 0118 ve 0119 uygulanmış olmalı.</p>`; return; }
    const durum = { kapsam: onSecilenKlasor ? "klasor" : "kutuphane", klasor: onSecilenKlasor || null, erisim: "link" };
    alan.innerHTML = `
      <section class="ak-pz-yeni">
        <h3>Bağlantı ile paylaş</h3>
        <p class="ak-alt">Bağlantıyı sosyal medyada bile paylaşabilirsin; açan kişi üye olmak zorunda değil. Alıcılar kaynak bilgilerini (başlık, yazar, DOI, özet, atıf) ve klasör ağacını görür.</p>
        <div class="ak-pz-adim"><span class="ak-pz-no">1</span><div><strong>Ne paylaşılsın?</strong>
          <div class="ak-segment" role="group" aria-label="Paylaşılacak kapsam"><button type="button" data-pz-kapsam="kutuphane">Tüm kütüphanem</button><button type="button" data-pz-kapsam="klasor">Bir klasör</button></div>
          <button type="button" class="ak-btn ak-pz-klasor-sec" data-pz-klasor hidden></button>
          <p class="ak-pz-sayi" data-pz-sayi role="status"></p></div></div>
        <div class="ak-pz-adim"><span class="ak-pz-no">2</span><div><strong>Kim açabilsin?</strong>
          <div class="ak-kart-secim" role="radiogroup" aria-label="Erişim">${Object.entries(ERISIM).map(([k, [ik, b, a]]) => `<label class="ak-secenek"><input type="radio" name="erisim" value="${k}" ${k === "link" ? "checked" : ""}><span class="ak-secenek-ic"><span class="ak-secenek-ik" aria-hidden="true">${ik}</span><span><strong>${b}</strong><small>${a}</small></span></span></label>`).join("")}</div></div></div>
        <div class="ak-pz-adim"><span class="ak-pz-no">3</span><div><label class="ak-anahtar"><input type="checkbox" data-pz-pdf checked> <span><strong>PDF'ler okunabilsin</strong><small>Okuma Cloudflare R2'den yapılır; depolama alanını büyütmez, çıkış (egress) ücretsizdir. Yalnızca okuma işlemi sayılır; ücretsiz kotalar çok yüksektir.</small></span></label>
          <details class="ak-pz-gelismis"><summary>Gelişmiş</summary>
            <label>Başlık <input data-pz-baslik maxlength="120" value="${esc(profil.ad ? `${profil.ad} — Akademik Kütüphane` : "Akademik kütüphanem")}"></label>
            <label>Açıklama <textarea data-pz-aciklama maxlength="600" rows="2" placeholder="Bu koleksiyon ne hakkında? (isteğe bağlı)"></textarea></label>
            <label class="ak-anahtar"><input type="checkbox" data-pz-ozel checked> <span><strong>“Özel” işaretli kaynakları da göster</strong><small>Kapatırsan yalnızca “Özel” dışı kaynaklar paylaşılır.</small></span></label>
            <label>Bitiş tarihi (isteğe bağlı) <input type="date" data-pz-bitis></label></details></div></div>
        <button type="button" class="ak-btn ak-btn-birincil ak-pz-olustur" data-pz-olustur>Bağlantı oluştur</button>
      </section>
      <section class="ak-pz-listebolum"><h3>Paylaşımlarım <span class="ak-say">${data.length}</span></h3>
        ${data.length ? `<ul class="ak-pz-liste">${data.map((p) => `<li class="ak-pz${p.aktif ? "" : " pasif"}" data-pz="${esc(p.id)}">
          <div class="ak-pz-ust"><div><strong>${esc(p.baslik)}</strong>
            <div class="ak-pz-chip">${p.kapsam === "klasor" ? `📁 ${esc(klasorYolu(p.klasor_id) || "silinmiş klasör")}` : "🗂 Tüm kütüphane"} · ${ERISIM[p.erisim][0]} ${esc(ERISIM[p.erisim][1])} · ${p.pdf_okuma ? "PDF okunabilir" : "yalnız künye"}${p.aktif ? "" : " · <b>durduruldu</b>"}${p.bitis ? ` · bitiş ${esc(new Date(p.bitis).toLocaleDateString("tr-TR"))}` : ""}</div></div></div>
          <div class="ak-pz-link"><input class="ak-pz-adres" readonly value="${esc(paylasimAdresi(p.token))}" aria-label="Paylaşım bağlantısı"><button type="button" class="ak-btn ak-btn-birincil" data-pz-islem="kopya">Kopyala</button><a class="ak-btn" href="${esc(paylasimAdresi(p.token))}" target="_blank" rel="noopener">Aç ↗</a></div>
          <details class="ak-pz-ayar"><summary>Ayarlar</summary><div class="ak-pz-ayar-ic">
            <label>Kim açabilir? <select data-pz-islem="erisim">${Object.entries(ERISIM).map(([k, [ik, b]]) => `<option value="${k}" ${k === p.erisim ? "selected" : ""}>${ik} ${b}</option>`).join("")}</select></label>
            <button type="button" class="ak-btn" data-pz-islem="pdf">${p.pdf_okuma ? "PDF okumayı kapat" : "PDF okumayı aç"}</button>
            <button type="button" class="ak-btn" data-pz-islem="ozel">${p.ozel_dahil ? "“Özel” kaynakları gizle" : "“Özel” kaynakları da göster"}</button>
            <button type="button" class="ak-btn" data-pz-islem="aktif">${p.aktif ? "Paylaşımı durdur" : "Yeniden aç"}</button>
            <button type="button" class="ak-btn" data-pz-islem="yenile" title="Eski bağlantı çalışmaz olur">Bağlantıyı yenile</button>
            <button type="button" class="ak-btn ak-tehlike" data-pz-islem="sil">Sil</button></div></details></li>`).join("")}</ul>` : '<p class="ak-bos">Henüz paylaşım yok. Yukarıdan ilk bağlantını oluştur.</p>'}
      </section>`;
    const guncelle = () => {
      alan.querySelectorAll("[data-pz-kapsam]").forEach((b) => b.classList.toggle("aktif", b.dataset.pzKapsam === durum.kapsam));
      const kb = alan.querySelector("[data-pz-klasor]"); kb.hidden = durum.kapsam !== "klasor";
      kb.textContent = durum.klasor ? `📁 ${klasorYolu(durum.klasor)} — değiştir` : "📁 Klasör seç…";
      const ozel = alan.querySelector("[data-pz-ozel]").checked;
      const n = paylasilacakSayisi(durum.kapsam, durum.klasor, ozel);
      const s = alan.querySelector("[data-pz-sayi]");
      s.className = `ak-pz-sayi${n ? "" : " bos"}`;
      s.textContent = durum.kapsam === "klasor" && !durum.klasor ? "Önce bir klasör seç." : n ? `${n} kaynak paylaşılacak.` : "Bu seçimde paylaşılacak kaynak yok — önce kaynak ekle ya da klasöre kaynak koy.";
    };
    alan.onclick = async (e) => {
      const kap = e.target.closest("[data-pz-kapsam]");
      if (kap) { durum.kapsam = kap.dataset.pzKapsam; if (durum.kapsam === "klasor" && !durum.klasor && d.klasorler.length) klasorSec({ baslik: "Hangi klasör paylaşılsın?", onSec: (id) => { durum.klasor = id; guncelle(); } }); guncelle(); return; }
      if (e.target.closest("[data-pz-klasor]")) { klasorSec({ baslik: "Hangi klasör paylaşılsın?", onSec: (id) => { durum.klasor = id; guncelle(); } }); return; }
      if (e.target.closest("[data-pz-olustur]")) {
        if (durum.kapsam === "klasor" && !durum.klasor) { toast("Bir klasör seç.", "uyari"); return; }
        const erisim = alan.querySelector('input[name="erisim"]:checked').value, bitis = alan.querySelector("[data-pz-bitis]").value;
        const { error: e2 } = await supabase.from("akademik_paylasimlari").insert({ user_id: profil.id, kapsam: durum.kapsam, klasor_id: durum.kapsam === "klasor" ? durum.klasor : null, erisim, baslik: alan.querySelector("[data-pz-baslik]").value.trim() || "Akademik kütüphanem", aciklama: alan.querySelector("[data-pz-aciklama]").value.trim() || null, pdf_okuma: alan.querySelector("[data-pz-pdf]").checked, ozel_dahil: alan.querySelector("[data-pz-ozel]").checked, bitis: bitis ? new Date(`${bitis}T23:59:59`).toISOString() : null });
        if (e2) { toast(`Oluşturulamadı: ${e2.message}`, "hata"); return; }
        toast("Bağlantı hazır — aşağıdan kopyalayabilirsin.", "basari"); paylasimCiz(); return;
      }
      const b = e.target.closest("[data-pz-islem]"); if (!b || b.tagName === "SELECT") return;
      const p = data.find((x) => x.id === b.closest("[data-pz]").dataset.pz), islem = b.dataset.pzIslem;
      try {
        let yama = null;
        if (islem === "kopya") { await panoyaKopyala(paylasimAdresi(p.token)); toast("Bağlantı kopyalandı.", "basari"); return; }
        if (islem === "sil") { if (!confirm("Bu paylaşım silinsin mi? Bağlantı çalışmaz olur.")) return; const { error: e3 } = await supabase.from("akademik_paylasimlari").delete().eq("id", p.id); if (e3) throw new Error(e3.message); }
        else if (islem === "aktif") yama = { aktif: !p.aktif };
        else if (islem === "pdf") yama = { pdf_okuma: !p.pdf_okuma };
        else if (islem === "ozel") yama = { ozel_dahil: !p.ozel_dahil };
        else if (islem === "yenile") { if (!confirm("Bağlantı yenilensin mi? Eski bağlantıyı kullananlar erişimi kaybeder.")) return; yama = { token: (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40) }; }
        if (yama) { const { error: e3 } = await supabase.from("akademik_paylasimlari").update(yama).eq("id", p.id); if (e3) throw new Error(e3.message); }
        paylasimCiz();
      } catch (h) { toast(`İşlem başarısız: ${h.message}`, "hata"); }
    };
    alan.onchange = async (e) => {
      if (e.target.matches("[data-pz-ozel], input[name='erisim'], [data-pz-pdf]")) { guncelle(); return; }
      const s = e.target.closest('select[data-pz-islem="erisim"]'); if (!s) return;
      const { error: e3 } = await supabase.from("akademik_paylasimlari").update({ erisim: s.value }).eq("id", s.closest("[data-pz]").dataset.pz);
      if (e3) toast(`Güncellenemedi: ${e3.message}`, "hata"); else { toast("Erişim düzeyi güncellendi.", "basari"); paylasimCiz(); }
    };
    guncelle();
  }

  /* ============================ v3: klasör menüsü · seçici · toplu işlem · Zotero eşdeğerleri ============================ */
  const trSirala = (a, b) => String(a).localeCompare(String(b), "tr");

  /* ---------- klasör ⚙ menüsü (tek düğme; işlemler menüde) ---------- */
  function klasorMenuAc(id, dugme) {
    klasorMenuKapat();
    const k = d.klasorler.find((x) => x.id === id); if (!k) return;
    const m = document.createElement("div"); m.className = "ak-kl-menu"; m.setAttribute("role", "menu"); m.dataset.klMenu = id;
    m.innerHTML = `<button type="button" role="menuitem" data-kl-islem="alt" data-id="${esc(id)}">📁 Alt klasör ekle</button>
      <button type="button" role="menuitem" data-kl-islem="ad" data-id="${esc(id)}">✎ Yeniden adlandır</button>
      <button type="button" role="menuitem" data-kl-islem="tasi" data-id="${esc(id)}">↳ Başka klasörün içine taşı</button>
      <button type="button" role="menuitem" data-kl-islem="paylas" data-id="${esc(id)}">🔗 Bu klasörü paylaş</button>
      <button type="button" role="menuitem" data-kl-islem="sil" data-id="${esc(id)}" class="tehlike">🗑 Klasörü sil</button>`;
    document.body.append(m);
    const r = dugme.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth))}px`;
    m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)}px`;
    m.querySelector("button")?.focus();
  }
  function klasorMenuKapat() { document.querySelectorAll(".ak-kl-menu").forEach((x) => x.remove()); }
  document.addEventListener("click", (e) => { if (!e.target.closest(".ak-kl-menu, [data-kl-menu]")) klasorMenuKapat(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") klasorMenuKapat(); });
  window.addEventListener("scroll", klasorMenuKapat, { passive: true, capture: true });

  /* ---------- aranabilir klasör seçici (çok klasörde de rahat) ---------- */
  function klasorSec({ baslik = "Klasör seç", kok: kokSecenek = null, dislanan = new Set(), onSec }) {
    const dl = dlg("klasor");
    const tumu = d.klasorler.filter((k) => !dislanan.has(k.id)).map((k) => ({ id: k.id, yol: klasorYolu(k.id) })).sort((a, b) => trSirala(a.yol, b.yol));
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>${esc(baslik)}</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><input type="search" class="ak-ks-ara" placeholder="Klasör ara…" aria-label="Klasör ara" autocomplete="off">
      <ul class="ak-ks-liste" role="listbox"></ul></div></form>`;
    const liste = dl.querySelector(".ak-ks-liste"), ara = dl.querySelector(".ak-ks-ara");
    const ciz2 = () => {
      const t = tokenlar(ara.value);
      const oge = [...(kokSecenek ? [{ id: "", yol: kokSecenek }] : []), ...tumu].filter((x) => t.every((s) => trKucuk(x.yol).includes(s)));
      liste.innerHTML = oge.length ? oge.map((x) => `<li><button type="button" class="ak-ks-oge" data-ks="${esc(x.id)}" role="option">${x.id === "" ? "🗂" : "📁"} ${esc(x.yol)}</button></li>`).join("") : '<li class="ak-bos">Eşleşen klasör yok.</li>';
    };
    ara.addEventListener("input", ciz2); ciz2();
    dl.onclick = (e) => { const b = e.target.closest("[data-ks]"); if (!b) return; dl.close(); onSec(b.dataset.ks || null); };
    dl.showModal(); setTimeout(() => ara.focus(), 30);
  }

  /* ---------- toplu seçim ---------- */
  const seciliKayitlar = () => d.kayitlar.filter((k) => d.secili.has(k.id));
  function topluCiz() {
    const alan = q("[data-ak-toplu]"); if (!alan) return;
    const n = d.secili.size; alan.hidden = !n && !d.secimModu;
    if (alan.hidden) return;
    const edit = duzenlenebilir();
    alan.innerHTML = `<span class="ak-toplu-say"><strong>${n}</strong> seçili</span>
      <button type="button" class="ak-btn" data-tp="hepsi">Görünenlerin tümünü seç</button>
      ${n ? `${edit ? `<button type="button" class="ak-btn" data-tp="klasor">📁 Klasöre ekle</button><button type="button" class="ak-btn" data-tp="etiket">🏷 Etiket ekle</button>` : ""}
      <button type="button" class="ak-btn ak-btn-birincil" data-tp="kaynakca">Kaynakça kopyala</button>
      <button type="button" class="ak-btn" data-tp="bib">BibTeX</button><button type="button" class="ak-btn" data-tp="ris">RIS</button>
      ${edit && n >= 2 ? '<button type="button" class="ak-btn" data-tp="birlestir">Birleştir</button>' : ""}${edit ? '<button type="button" class="ak-btn ak-tehlike" data-tp="sil">Sil</button>' : ""}` : ""}
      <button type="button" class="ak-btn" data-tp="kapat">✕ Seçimi bitir</button>`;
  }
  async function zenginKopya(liste) {
    const sirali = [...liste].sort((a, b) => trSirala(kisaYazar(a.yazarlar) + a.baslik, kisaYazar(b.yazarlar) + b.baslik));
    const parcalar = sirali.map((k) => atifUret(k, d.bicim, { dil: d.dil }));
    const html = parcalar.map((p) => `<p style="margin:0 0 .6em 2em;text-indent:-2em">${p.html}</p>`).join("");
    const metin = parcalar.map((p) => p.text).join("\n\n");
    try {
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([metin], { type: "text/plain" }) })]);
      else await navigator.clipboard.writeText(metin);
      toast(`${sirali.length} kaynak kaynakça olarak kopyalandı — Word/Docs'a yapıştır (italikler korunur).`, "basari");
    } catch { await panoyaKopyala(metin); toast("Kaynakça düz metin olarak kopyalandı.", "bilgi"); }
  }
  const klasorBilgili = (liste) => liste.map((k) => ({ ...k, _klasor: d.klasorler.filter((x) => d.ogeler.get(x.id)?.has(k.id)).map((x) => klasorYolu(x.id).replaceAll(" › ", "/")).join("; ") }));
  async function topluIslem(is) {
    const liste = seciliKayitlar();
    if (is === "kapat") { d.secili.clear(); d.secimModu = false; topluCiz(); ciz(); return; }
    if (is === "hepsi") { for (const k of suzulmus()) d.secili.add(k.id); topluCiz(); ciz(); return; }
    if (!liste.length) return;
    try {
      if (is === "kaynakca") await zenginKopya(liste);
      else if (is === "bib") dosyaIndir("secili.bib", bibtexUret(klasorBilgili(liste)), "application/x-bibtex;charset=utf-8");
      else if (is === "ris") dosyaIndir("secili.ris", risUret(klasorBilgili(liste)), "application/x-research-info-systems;charset=utf-8");
      else if (is === "klasor") klasorSec({ baslik: `${liste.length} kaynağı klasöre ekle`, onSec: async (kid) => { for (const k of liste) await klasoreEkleCikar(k.id, kid, true); toast("Klasöre eklendi.", "basari"); agacCiz(); ciz(); } });
      else if (is === "etiket") {
        const girdi = (prompt("Eklenecek etiket(ler) — virgülle ayır:") || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!girdi.length) return;
        for (const k of liste) { const yeni = [...new Set([...(k.etiketler || []), ...girdi])]; const { error } = await supabase.from("akademik_kaynaklar").update({ etiketler: yeni }).eq("id", k.id); if (error) throw new Error(error.message); k.etiketler = yeni; }
        facetleriDoldur(); ciz(); toast("Etiketler eklendi.", "basari");
      } else if (is === "sil") {
        if (!confirm(`${liste.length} kaynak, PDF'leri ve notlarıyla kalıcı olarak silinsin mi?`)) return;
        for (const k of liste) await kaynakSilSessiz(k);
        d.secili.clear(); toast(`${liste.length} kaynak silindi.`, "basari"); await yukle(); topluCiz();
      } else if (is === "birlestir") birlestirDialogu([liste]);
    } catch (h) { toast(`İşlem başarısız: ${h.message}`, "hata"); }
  }
  async function kaynakSilSessiz(k) {
    if (k.pdf_r2_yolu) await workerJson(`/pdf/${k.id}`, { method: "DELETE" });
    const { error } = await supabase.from("akademik_kaynaklar").delete().eq("id", k.id);
    if (error) throw new Error(error.message);
  }

  /* ---------- yinelenenleri bul + birleştir (Zotero "Yinelenen Eserler") ---------- */
  const normBaslik = (s) => String(s || "").toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function yinelenenGruplar() {
    const harita = new Map(); const ekle = (anahtar, k) => { if (!anahtar) return; if (!harita.has(anahtar)) harita.set(anahtar, new Set()); harita.get(anahtar).add(k.id); };
    for (const k of d.kayitlar.filter(benim)) { ekle(k.doi && `doi:${k.doi.toLowerCase()}`, k); ekle(k.isbn && `isbn:${k.isbn.replace(/-/g, "").toLowerCase()}`, k); ekle(normBaslik(k.baslik).length > 12 && `b:${normBaslik(k.baslik)}|${k.yayin_yili || ""}`, k); }
    const gorulen = new Set(), gruplar = [];
    for (const kume of harita.values()) { if (kume.size < 2) continue; const ids = [...kume].filter((i) => !gorulen.has(i)); if (ids.length < 2) continue; ids.forEach((i) => gorulen.add(i)); gruplar.push(ids.map((i) => kayit(i))); }
    return gruplar;
  }
  function yinelenenDialogu() { const g = yinelenenGruplar(); if (!g.length) { toast("Yinelenen kaynak bulunamadı. 👍", "basari"); return; } birlestirDialogu(g); }
  function birlestirDialogu(gruplar) {
    const dl = dlg("klasor");
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>${gruplar.length} grup birleştirilecek</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><p class="ak-alt">Her grupta <strong>asıl</strong> kaynağı seç. Diğerlerinin etiketleri, klasörleri, notları ve eksik künye alanları asıl kaynağa taşınır; PDF yoksa PDF de taşınır. Sonra kopyalar silinir.</p>
      ${gruplar.map((g, i) => `<fieldset class="ak-yin-grup"><legend>Grup ${i + 1}</legend>${g.map((k, j) => `<label class="ak-yin-satir"><input type="radio" name="asil${i}" value="${esc(k.id)}" ${j === 0 || (k.pdf_r2_yolu && !g[0].pdf_r2_yolu) ? "checked" : ""}> <span><strong>${esc(kayitBaslik(k))}</strong><small>${esc([kisaYazar(k.yazarlar), k.yayin_yili, k.doi].filter(Boolean).join(" · "))}${k.pdf_r2_yolu ? " · PDF var" : ""}</small></span></label>`).join("")}</fieldset>`).join("")}</div>
      <div class="ak-dlg-eylem"><button class="ak-btn" value="iptal">Vazgeç</button><button class="ak-btn ak-btn-birincil" value="tamam" data-birlestir>Birleştir</button></div></form>`;
    dl.onclick = async (e) => {
      if (!e.target.closest("[data-birlestir]")) return; e.preventDefault();
      let sayi = 0;
      try {
        for (let i = 0; i < gruplar.length; i++) {
          const asilId = dl.querySelector(`input[name="asil${i}"]:checked`)?.value; const asil = kayit(asilId); if (!asil) continue;
          for (const dg of gruplar[i].filter((x) => x.id !== asilId)) { await birlestir(asil, dg); sayi++; }
        }
        dl.close(); toast(`${sayi} kopya birleştirildi.`, "basari"); await yukle();
      } catch (h) { toast(`Birleştirilemedi: ${h.message}`, "hata"); }
    };
    dl.showModal();
  }
  async function birlestir(asil, dg) {
    const yama = {};
    for (const alan of ["doi", "isbn", "url", "ozet", "dergi_veya_yayinevi", "yayin_yili"]) if (!asil[alan] && dg[alan]) yama[alan] = dg[alan];
    const et = [...new Set([...(asil.etiketler || []), ...(dg.etiketler || [])])]; if (et.length !== (asil.etiketler || []).length) yama.etiketler = et;
    const ek = { ...(dg.ek_alanlar || {}), ...(asil.ek_alanlar || {}) }; if (JSON.stringify(ek) !== JSON.stringify(asil.ek_alanlar || {})) yama.ek_alanlar = ek;
    if (!asil.pdf_r2_yolu && dg.pdf_r2_yolu) {
      // PDF işaretçisini taşı (dosya R2'de aynı kalır, kopyalanmaz) — kopyadaki işaretçi önce temizlenir ki silme R2 nesnesini götürmesin
      const e1 = await supabase.from("akademik_kaynaklar").update({ pdf_r2_yolu: null, pdf_dosya_adi: null, pdf_boyut_bayt: null }).eq("id", dg.id); if (e1.error) throw new Error(e1.error.message);
      Object.assign(yama, { pdf_r2_yolu: dg.pdf_r2_yolu, pdf_dosya_adi: dg.pdf_dosya_adi, pdf_boyut_bayt: dg.pdf_boyut_bayt, pdf_rev: dg.pdf_rev });
    }
    if (Object.keys(yama).length) { const { error } = await supabase.from("akademik_kaynaklar").update(yama).eq("id", asil.id); if (error) throw new Error(error.message); Object.assign(asil, yama); }
    const { data: og } = await supabase.from("akademik_koleksiyon_ogeleri").select("koleksiyon_id").eq("kaynak_id", dg.id).eq("user_id", profil.id);
    if (og?.length) await supabase.from("akademik_koleksiyon_ogeleri").upsert(og.map((o) => ({ koleksiyon_id: o.koleksiyon_id, kaynak_id: asil.id, user_id: profil.id })), { onConflict: "koleksiyon_id,kaynak_id", ignoreDuplicates: true });
    await supabase.from("akademik_notlar").update({ kaynak_id: asil.id }).eq("kaynak_id", dg.id).is("ek_id", null);
    const { error } = await supabase.from("akademik_kaynaklar").delete().eq("id", dg.id); if (error) throw new Error(error.message);
  }

  /* ---------- etiket yöneticisi ---------- */
  function etiketYoneticisi() {
    const dl = dlg("klasor");
    const say = new Map(); for (const k of d.kayitlar.filter(benim)) for (const e of k.etiketler || []) say.set(e, (say.get(e) || 0) + 1);
    const liste = [...say.entries()].sort((a, b) => trSirala(a[0], b[0]));
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>Etiketleri yönet (${liste.length})</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><input type="search" class="ak-ks-ara" placeholder="Etiket ara…" aria-label="Etiket ara" autocomplete="off"><p class="ak-alt">Yeniden adlandırırken var olan bir etiketin adını yazarsan ikisi birleşir.</p>
      <ul class="ak-ks-liste ak-et-liste">${liste.map(([e, n]) => `<li data-et="${esc(e)}"><span class="ak-et-ad"># ${esc(e)} <small>${n}</small></span><span><button type="button" class="ak-btn" data-eti="ad">Adını değiştir</button><button type="button" class="ak-btn ak-tehlike" data-eti="sil">Sil</button></span></li>`).join("") || '<li class="ak-bos">Henüz etiket yok.</li>'}</ul></div></form>`;
    dl.querySelector(".ak-ks-ara").addEventListener("input", (e) => { const t = tokenlar(e.target.value); dl.querySelectorAll("[data-et]").forEach((li) => { li.hidden = !t.every((s) => trKucuk(li.dataset.et).includes(s)); }); });
    dl.onclick = async (e) => {
      const b = e.target.closest("[data-eti]"); if (!b) return; e.preventDefault();
      const eski = b.closest("[data-et]").dataset.et; let yeni = null;
      if (b.dataset.eti === "ad") { yeni = (prompt(`“${eski}” etiketinin yeni adı:`, eski) || "").trim(); if (!yeni || yeni === eski) return; }
      else if (!confirm(`“${eski}” etiketi tüm kaynaklardan kaldırılsın mı?`)) return;
      try {
        for (const k of d.kayitlar.filter((x) => benim(x) && (x.etiketler || []).includes(eski))) {
          const dizi = [...new Set((k.etiketler || []).flatMap((t) => (t === eski ? (yeni ? [yeni] : []) : [t])))];
          const { error } = await supabase.from("akademik_kaynaklar").update({ etiketler: dizi }).eq("id", k.id); if (error) throw new Error(error.message); k.etiketler = dizi;
        }
        facetleriDoldur(); ciz(); dl.close(); etiketYoneticisi();
      } catch (h) { toast(`İşlem başarısız: ${h.message}`, "hata"); }
    };
    dl.showModal();
  }

  /* ---------- kayıtlı aramalar (Zotero "Kayıtlı Aramalar") ---------- */
  async function aramalariYukle() { try { const a = await ayarYukle(); d.aramalar = a.aramalar || []; } catch { d.aramalar = []; } aramalarCiz(); }
  function aramalarCiz() {
    const yer = q("[data-ak-aramalar]"); if (!yer) return;
    yer.innerHTML = d.aramalar.length ? `<h4 class="ak-agac-baslik">🔎 Kayıtlı aramalar</h4><ul class="ak-agac-liste">${d.aramalar.map((a, i) => `<li><div class="ak-kl"><span class="ak-kl-ok bos"></span><button type="button" class="ak-kl-ad" data-ara-uygula="${i}"><span class="ak-kl-metin">${esc(a.ad)}</span></button><span class="ak-kl-islem" style="display:inline-flex"><button type="button" data-ara-sil="${i}" title="Sil" aria-label="Aramayı sil">✕</button></span></div></li>`).join("")}</ul>` : "";
  }
  async function aramaKaydet() {
    if (!tokenlar(d.f.ara).length && !filtreSay() && !d.klasor) { toast("Önce bir arama yaz ya da filtre seç.", "bilgi"); return; }
    const ad = (prompt("Bu aramaya bir ad ver:", d.f.ara || "Aramam") || "").trim(); if (!ad) return;
    d.aramalar = [...d.aramalar, { ad: ad.slice(0, 60), ara: d.f.ara, f: { ...d.f, ara: "" }, klasor: d.klasor }].slice(-30);
    await aramaDepola(); aramalarCiz(); toast("Arama kaydedildi (sol tarafta).", "basari");
  }
  async function aramaDepola() { try { const a = await ayarYukle(); await ayarKaydet({ ...a, aramalar: d.aramalar }); } catch { /* yerel yedek ayarKaydet içinde */ } }
  function aramaUygula(a) {
    d.klasor = a.klasor || ""; Object.assign(d.f, { tur: "", etiket: "", yazar: "", yilBas: "", yilSon: "", gorunurluk: "", pdfli: false }, a.f || {}, { ara: a.ara || "" });
    q('[data-f="ara"]').value = d.f.ara;
    q("[data-ak-filtre]").querySelectorAll("[data-f]").forEach((x) => { const v = d.f[x.dataset.f]; if (x.type === "checkbox") x.checked = !!v; else x.value = v ?? ""; });
    agacCiz(); ciz();
  }

  /* ---------- tarayıcı düğmesi (Zotero Connector benzeri bookmarklet) ---------- */
  function tarayiciDugmesiDialogu() {
    const hedef = `${location.origin}/panel/dashboard.html`;
    const kod = `javascript:(function(){var M=function(n){var e=document.querySelector('meta[name="'+n+'" i],meta[property="'+n+'" i]');return e?e.content:''},A=function(n){return Array.prototype.map.call(document.querySelectorAll('meta[name="'+n+'" i]'),function(e){return e.content})};var a=A('citation_author');if(!a.length)a=A('dc.creator');var o={t:M('citation_title')||M('dc.title')||M('og:title')||document.title,a:a,y:(M('citation_publication_date')||M('citation_date')||M('dc.date')||M('article:published_time')||'').slice(0,4),j:M('citation_journal_title')||M('citation_conference_title')||M('og:site_name'),v:M('citation_volume'),i:M('citation_issue'),p:[M('citation_firstpage'),M('citation_lastpage')].filter(Boolean).join('-'),doi:M('citation_doi')||M('dc.identifier'),u:location.href,ab:M('citation_abstract')||M('og:description')||M('description')};location.href='${hedef}?ekle='+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))))+'#lib-kutuphane';})();`;
    const dl = dlg("klasor");
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>🔖 Tarayıcı düğmesi</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><p>Herhangi bir makale/haber sayfasındayken tek tıkla kütüphanene eklemek için:</p>
      <ol><li>Aşağıdaki düğmeyi tarayıcının <strong>yer imleri çubuğuna sürükle</strong> (tıklama; sürükle).</li><li>Bir makale sayfasında bu yer imine tıkla.</li><li>Künye (başlık, yazar, yıl, dergi, DOI, özet) otomatik dolu formda açılır; kaydet.</li></ol>
      <p><a class="ak-btn ak-btn-birincil ak-yerimi" data-yerimi>📚 Kütüphaneme ekle</a></p>
      <p class="ak-alt">Sayfadaki standart künye etiketlerini (citation_*, Dublin Core, Open Graph) okur; hiçbir veri üçüncü tarafa gitmez. Mobilde: bu sayfayı yer imi olarak ekleyip adresini yukarıdaki kodla değiştirebilirsin; ya da Ekle ▸ “Elle / DOI ile” kullan.</p></div></form>`;
    dl.querySelector("[data-yerimi]").setAttribute("href", kod);
    dl.querySelector("[data-yerimi]").addEventListener("click", (e) => e.preventDefault());
    dl.showModal();
  }
  function ekleParametresiniIsle() {
    const p = new URLSearchParams(location.search).get("ekle"); if (!p || owner) return;
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(p))));
      history.replaceState(null, "", `${location.pathname}${location.hash || "#lib-kutuphane"}`);
      const doi = String(o.doi || "").replace(/^doi:\s*/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      formAc(null, null, (form) => {
        const set = (ad, v) => { const e = form.elements[ad]; if (e && v) e.value = v; };
        set("baslik", o.t); set("yazarlar", (o.a || []).join("\n")); set("yayin_yili", o.y); set("dergi_veya_yayinevi", o.j); set("cilt", o.v); set("sayi", o.i); set("sayfa", o.p);
        set("doi", /^10\.\d{4,9}\//.test(doi) ? doi : ""); set("url", o.u); set("ozet", o.ab); set("girdi", /^10\.\d{4,9}\//.test(doi) ? doi : o.u);
      });
    } catch { toast("Tarayıcı düğmesinden gelen veri okunamadı.", "uyari"); }
  }

  function disaAktarAc() {
    const s = suzulmus();
    const dl = dlg("disa");
    const konum = d.klasor === "__yok" ? "Klasörsüz" : d.klasor ? klasorYolu(d.klasor) : "Tüm kaynaklar";
    const bic = BICIMLER.find((b) => b.anahtar === d.bicim).etiket;
    dl.innerHTML = `<form method="dialog" class="ak-dlg-ic"><header class="ak-dlg-ust"><h3>Dışa aktar</h3><button class="ak-btn" value="x" aria-label="Kapat">✕</button></header>
      <div class="ak-dlg-govde"><p><strong>${s.length} kaynak</strong> · ${esc(konum)}${filtreSay() || tokenlar(d.f.ara).length ? " · arama/filtre uygulanmış" : ""}</p>
        <h4>Başka bir programa taşı</h4>
        <p class="ak-alt">Zotero, Mendeley, EndNote gibi programlara aktarmak için.</p>
        <div class="ak-atif-eylem"><button type="button" class="ak-btn ak-btn-birincil" data-o="bib">BibTeX (.bib)</button><button type="button" class="ak-btn ak-btn-birincil" data-o="ris">RIS (.ris)</button></div>
        <h4>Kaynakça olarak yapıştır</h4>
        <p class="ak-alt">Biçim: <strong>${esc(bic)}</strong> (${d.dil.toUpperCase()}) — Ayarlar sekmesinden değiştirilir.</p>
        <div class="ak-atif-eylem"><button type="button" class="ak-btn" data-o="metin">Düz metin kopyala</button><button type="button" class="ak-btn" data-o="md">Markdown kopyala</button><button type="button" class="ak-btn" data-o="html">HTML kopyala</button></div>
      </div></form>`;
    dl.onclick = async (e) => {
      const o = e.target.closest("[data-o]")?.dataset.o;
      if (!o) return;
      if (!s.length) { toast("Aktarılacak kaynak yok.", "uyari"); return; }
      const adBase = `akademik-kutuphane-${bugunDamga()}`;
      // Klasör bilgisi dosyaya yazılır (BibTeX: klasor = {Tez/Bölüm 1; Okuma} · RIS: C1) → bu site ve Zotero/Mendeley içe aktarırken klasörleri kurar.
      const klasorlu = s.map((k) => ({ ...k, _klasor: d.klasorler.filter((x) => d.ogeler.get(x.id)?.has(k.id)).map((x) => klasorYolu(x.id).replaceAll(" › ", "/")).join("; ") }));
      if (o === "bib") dosyaIndir(`${adBase}.bib`, bibtexUret(klasorlu), "application/x-bibtex;charset=utf-8");
      else if (o === "ris") dosyaIndir(`${adBase}.ris`, risUret(klasorlu), "application/x-research-info-systems;charset=utf-8");
      else {
        const sec = { dil: d.dil };
        const metin = o === "md" ? markdownKaynakca(s, d.bicim, sec) : o === "html" ? s.map((k) => atifKutusuHtml(k, d.bicim, sec)).join("\n") : s.map((k) => atifUret(k, d.bicim, sec).text).sort((a, b) => a.localeCompare(b, d.dil)).join("\n\n");
        await panoyaKopyala(metin);
        toast("Kaynakça panoya kopyalandı.", "basari");
      }
    };
    dl.showModal();
  }

  /* ------------------------ okuyucu motoru paneli (herkes: kişisel tercih; owner: + site varsayılanı) ------------------------ */
  // Panelin kendisi motor-paneli.js'tedir; burada yalnızca kutusuna bağlanır. Hata olursa kütüphane yine çalışır.
  function motorKarti() {
    if (owner) return null;                                   // "Tüm Kullanıcıların Kaynakları"nda motor paneli YOK: tek motor, yalnızca Kütüphanem'de
    return motorPaneliKur(q("[data-ak-motor]"), { owner: profil.role === "owner" }).catch((h) => {
      console.error("motor-paneli.js:", h);
      const yer = q("[data-ak-motor]");
      if (yer) yer.replaceChildren(el("p", { class: "ak-bos" }, "Okuyucu motoru paneli yüklenemedi."));
    });
  }

  /* ------------------------------- olay bağlama ------------------------------- */
  const menuKapat = () => { for (const s of ["[data-ak-menu-ekle]", "[data-ak-menu-arac]"]) { const m = q(s); if (m) m.hidden = true; } q('[data-act="menu-ekle"]')?.setAttribute("aria-expanded", "false"); };
  function kapsamDegistir(ks, arg = null) {
    d.kapsam = ks; d.uye = ""; d.klasor = ""; d.f.ara = ""; q('[data-f="ara"]').value = "";
    kok.querySelectorAll("[data-kapsam]").forEach((b) => { b.classList.toggle("aktif", b.dataset.kapsam === ks); b.setAttribute("aria-selected", String(b.dataset.kapsam === ks)); });
    q("[data-ak-ayarlar]").hidden = ks !== "ayarlar";
    q("[data-ak-paylasim]").hidden = ks !== "paylasim";
    const dz = q("[data-ak-dz]"); if (dz) dz.hidden = ks !== "benim";
    q("[data-ak-zot]").hidden = ks === "ayarlar" || ks === "paylasim";
    uyeGorunumu();
    if (ks === "paylasim") { paylasimCiz(arg); return; }
    if (ks === "ayarlar") return;
    uyeleriYukle().then(() => uyeGorunumu());
    yukle();
  }
  kok.addEventListener("click", (e) => {
    if (!e.target.closest(".ak-menu")) menuKapat();
    const kart = e.target.closest(".ak-kart");
    const uyeSec = e.target.closest("[data-uye-sec]")?.dataset.uyeSec;
    if (uyeModu() && uyeSec) { d.uye = uyeSec; d.klasor = ""; d.f.etiket = ""; uyeGorunumu(); yukle(); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (uyeModu() && act === "uye-geri") { d.uye = ""; d.kayitlar = []; d.klasor = ""; uyeGorunumu(); return; }
    const k = kart ? kayit(kart.dataset.id) : null;
    // --- klasör ağacı ---
    const klSec = e.target.closest("[data-klasor]");
    if (klSec) { d.klasor = klSec.dataset.klasor; agacCiz(); ciz(); q(".ak-agac").classList.remove("ak-agac-acik"); q('[data-act="agac-ac"]').setAttribute("aria-expanded", "false"); return; }
    const klAc = e.target.closest("[data-kl-ac]")?.dataset.klAc;
    if (klAc) { if (d.acik.has(klAc)) d.acik.delete(klAc); else d.acik.add(klAc); agacCiz(); return; }
    const klIslem = e.target.closest("[data-kl-islem]");
    const klMenu = e.target.closest("[data-kl-menu]");
    if (klMenu) { klasorMenuAc(klMenu.dataset.klMenu, klMenu); return; }
    const tp = e.target.closest("[data-tp]")?.dataset.tp; if (tp) { topluIslem(tp); return; }
    const araUyg = e.target.closest("[data-ara-uygula]")?.dataset.araUygula; if (araUyg !== undefined) { aramaUygula(d.aramalar[Number(araUyg)]); return; }
    const araSil = e.target.closest("[data-ara-sil]")?.dataset.araSil; if (araSil !== undefined) { d.aramalar.splice(Number(araSil), 1); aramaDepola(); aramalarCiz(); return; }
    if (klIslem) { if (klIslem.dataset.klIslem === "tasi") klasorTasiDialogu(klIslem.dataset.id); else if (klIslem.dataset.klIslem === "paylas") { kapsamDegistir("paylasim", klIslem.dataset.id); } else klasorIslem(klIslem.dataset.klIslem, klIslem.dataset.id); return; }
    const cip = e.target.closest("[data-cip]")?.dataset.cip;
    if (cip) { if (cip === "klasor") d.klasor = ""; else { d.f[cip] = cip === "pdfli" ? false : ""; const el0 = q(`[data-f="${cip}"]`); if (el0) { if (el0.type === "checkbox") el0.checked = false; else el0.value = ""; } } agacCiz(); ciz(); return; }
    if (e.target.closest("[data-etiket]")) { const tg = e.target.closest("[data-etiket]").dataset.etiket; q('[data-f="etiket"]').value = tg; d.f.etiket = tg; ciz(); return; }
    if (act === "ac" && k) pdfAc(k);
    else if (act === "atif" && k) atifKopyala(k);
    else if (act === "detay" && k) detayAc(k.id);
    else if (act === "duzenle" && k) formAc(k);
    else if (act === "klasor-ata" && k) klasorDialogu(k.id);
    else if (act === "ekle") { menuKapat(); formAc(); }
    else if (act === "menu-ekle") { const m = q("[data-ak-menu-ekle]"); m.hidden = !m.hidden; e.target.closest("[data-act]").setAttribute("aria-expanded", String(!m.hidden)); }
    else if (act === "pdf-sec") { menuKapat(); q("[data-ak-pdf]").click(); }
    else if (act === "klasor-yeni") { menuKapat(); klasorIslem("yeni"); }
    else if (act === "arama-kaydet") aramaKaydet();
    else if (act === "secim-modu") { d.secimModu = !d.secimModu; if (!d.secimModu) d.secili.clear(); e.target.closest("[data-act]").setAttribute("aria-pressed", String(d.secimModu)); kok.classList.toggle("ak-secim-modu", d.secimModu); topluCiz(); ciz(); }
    else if (act === "menu-arac") { const m = q("[data-ak-menu-arac]"); m.hidden = !m.hidden; }
    else if (act === "etiket-yonet") { menuKapat(); etiketYoneticisi(); }
    else if (act === "yinelenen") { menuKapat(); yinelenenDialogu(); }
    else if (act === "tarayici-dugmesi") { menuKapat(); tarayiciDugmesiDialogu(); }
    else if (act === "ice-aktar") { menuKapat(); q("[data-ak-ice]").click(); }
    else if (act === "zotero-klasor") { menuKapat(); q("[data-ak-zotero]").click(); }
    else if (act === "disa-aktar") disaAktarAc();
    else if (act === "agac-ac") { const a = q(".ak-agac"); a.classList.toggle("ak-agac-acik"); e.target.closest("[data-act]").setAttribute("aria-expanded", String(a.classList.contains("ak-agac-acik"))); }
    else if (act === "filtre-ac") { const f = q("[data-ak-filtre]"); f.hidden = !f.hidden; e.target.closest("[data-act]").setAttribute("aria-expanded", String(!f.hidden)); }
    else if (act === "filtre-temizle") { Object.assign(d.f, { tur: "", etiket: "", yazar: "", yilBas: "", yilSon: "", gorunurluk: "", pdfli: false }); q("[data-ak-filtre]").querySelectorAll("[data-f]").forEach((x) => { if (x.type === "checkbox") x.checked = false; else x.value = ""; }); ciz(); }
    else if (kart && !e.target.closest("button, a")) detayAc(kart.dataset.id);
    const g = e.target.closest("[data-gorunum]")?.dataset.gorunum;
    if (g) { d.gorunum = g; kok.querySelectorAll("[data-gorunum]").forEach((b) => b.classList.toggle("aktif", b.dataset.gorunum === g)); ciz(); }
    const ks = e.target.closest("[data-kapsam]")?.dataset.kapsam;
    if (ks && ks !== d.kapsam) kapsamDegistir(ks);
    if (e.target.closest("[data-ak-dz]") && !e.target.closest("input, li")) q("[data-ak-pdf]").click();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menuKapat(); });
  q("[data-uye-ara]").addEventListener("input", debounce(() => uyeGorunumu(), 120));
  const filtreDegisti = (e) => {
    const ad = e.target.dataset?.f;
    if (!ad) return;
    d.f[ad] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    ciz();
  };
  kok.addEventListener("change", (e) => {
    if (e.target.matches("[data-sec]")) { if (e.target.checked) d.secili.add(e.target.value); else d.secili.delete(e.target.value); e.target.closest(".ak-kart")?.classList.toggle("secili", e.target.checked); topluCiz(); return; }
    filtreDegisti(e);
  });
  kok.addEventListener("input", debounce((e) => { if (e.target.dataset?.f === "ara" || e.target.dataset?.f === "yilBas" || e.target.dataset?.f === "yilSon") filtreDegisti(e); }, 160));
  const bicimSel = q("[data-ak-bicim]"), dilSel = q("[data-ak-dil]");
  bicimSel.value = d.bicim; dilSel.value = d.dil;
  bicimSel.addEventListener("change", (e) => { d.bicim = e.target.value; try { localStorage.setItem("aea_ak_bicim", d.bicim); } catch { /* yok say */ } });
  dilSel.addEventListener("change", (e) => { d.dil = e.target.value; try { localStorage.setItem("aea_ak_dil", d.dil); } catch { /* yok say */ } });
  q("[data-ak-ice]")?.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; if (fl.length) iceAktar(fl); });
  q("[data-ak-zotero]")?.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; if (fl.length) iceAktar(fl); });
  q("[data-ak-pdf]")?.addEventListener("change", (e) => { const fl = [...e.target.files]; e.target.value = ""; if (fl.length) pdfDosyalariniYukle(fl); });
  const dz = q("[data-ak-dz]");
  if (dz) {
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); q("[data-ak-pdf]").click(); } });
    ["dragenter", "dragover"].forEach((ad) => dz.addEventListener(ad, (e) => { e.preventDefault(); dz.classList.add("surukle"); }));
    ["dragleave", "drop"].forEach((ad) => dz.addEventListener(ad, (e) => { e.preventDefault(); dz.classList.remove("surukle"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) pdfDosyalariniYukle(e.dataTransfer.files); });
  }
  // Kartı klasöre sürükle-bırak (masaüstü). Dokunmatikte kart üzerindeki 📁 düğmesi aynı işi yapar.
  kok.addEventListener("dragstart", (e) => { const kart = e.target.closest?.(".ak-kart[draggable]"); if (!kart) return; e.dataTransfer.setData("text/x-ak-kaynak", kart.dataset.id); e.dataTransfer.effectAllowed = "copyMove"; });
  kok.addEventListener("dragover", (e) => { const h = e.target.closest?.("[data-kl]"); if (h && e.dataTransfer?.types?.includes("text/x-ak-kaynak")) { e.preventDefault(); h.classList.add("hedef"); } });
  kok.addEventListener("dragleave", (e) => e.target.closest?.("[data-kl]")?.classList.remove("hedef"));
  kok.addEventListener("drop", async (e) => {
    const h = e.target.closest?.("[data-kl]"); const id = e.dataTransfer?.getData("text/x-ak-kaynak");
    if (!h || !id) return;
    e.preventDefault(); h.classList.remove("hedef");
    try {
      if (h.dataset.kl === "__yok") { for (const [kid, s] of d.ogeler) if (s.has(id)) await klasoreEkleCikar(id, kid, false); toast("Kaynak klasörlerden çıkarıldı.", "bilgi"); }
      else { await klasoreEkleCikar(id, h.dataset.kl, true); toast(`“${klasorYolu(h.dataset.kl)}” klasörüne eklendi.`, "basari"); }
      agacCiz(); ciz();
    } catch (x) { toast(`Taşınamadı: ${x.message}`, "hata"); }
  });
  kok.querySelectorAll("dialog").forEach((dl) => dl.addEventListener("click", (e) => { if (e.target === dl) dl.close(); }));

  uyeGorunumu();
  if (!owner) { aramalariYukle(); ekleParametresiniIsle(); }
  if (!owner) { bekleyenleriGonder(supabase).then((n) => { if (n) toast(`Çevrimdışıyken kalan ${n} kaynağın açıklamaları kaydedildi.`, "basari"); }); window.addEventListener("online", () => bekleyenleriGonder(supabase)); }
  if (owner) uyeleriYukle();
  motorKarti();
  if (!owner) eklentiPaneliKur(q("[data-ak-eklentiler]")).catch((h) => console.error("eklenti-paneli.js:", h));
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
