/*
 * assets/js/github-yonetim/onizleme.js — /onizleme/?tur=blog|proje&kod=XXXXXXXX
 *
 * "Yayında değil" (gizli) blog yazıları ve akademik projeler artık GitHub
 * deposuna hiç commit edilmiyor, sadece Supabase'teki `taslak_icerikler`
 * tablosunda duruyor (bkz. supabase/migrations/0013_...sql). Bu sayfa,
 * URL'deki tur+kod'u bilen HERKESİN (giriş yapması gerekmez) içeriği
 * görebilmesini sağlıyor — ama SADECE tam eşleşen tek bir satırı döndüren
 * `taslak_onizleme_getir` RPC'si üzerinden; tabloyu doğrudan listeleyemez.
 *
 * Not: requireAuth() BİLEREK kullanılmıyor — bu link, siteye hiç kayıtlı
 * olmayan biriyle bile paylaşılabilmeli (tıpkı eski permalink yöntemindeki
 * gibi). Güvenlik, kodun tahmin edilemezliğinden (8 karakter, rastgele)
 * geliyor.
 */
import { supabase, escapeHtml, guvenliDisUrlMi } from "../core/supabase-client.js";
import { okumaSuresiHesapla, kaynakButonlariHtml, tocOlustur } from "../okuma-araclari/okuma-meta-yardimci.js";

async function init() {
  const govdeEl = document.getElementById("onizleme-govde");
  const uyariEl = document.getElementById("onizleme-durum-uyarisi");

  const params = new URLSearchParams(window.location.search);
  const tur = params.get("tur");
  const kod = params.get("kod");

  if (!tur || !kod || !["blog", "proje"].includes(tur)) {
    if (uyariEl) uyariEl.hidden = true;
    govdeEl.innerHTML = `<h1>Geçersiz bağlantı</h1><p>Bu linkte gerekli bilgiler eksik ya da hatalı.</p>`;
    return;
  }

  try {
    const { data, error } = await supabase.rpc("taslak_onizleme_getir", {
      p_tur: tur,
      p_kod: kod,
    });

    const kayit = Array.isArray(data) ? data[0] : data;

    if (error || !kayit) {
      if (uyariEl) uyariEl.hidden = true;
      govdeEl.innerHTML = `
        <h1>İçerik bulunamadı</h1>
        <p>Bu link artık geçerli değil — içerik yayına alınmış, silinmiş
        ya da linkin kodu değiştirilmiş olabilir. Doğru linke sahip
        olduğundan emin değilsen içeriği paylaşan kişiyle iletişime geç.</p>`;
      return;
    }

    document.title = `${kayit.baslik} · Ön İzleme`;

    const okumaSuresiMetni = okumaSuresiHesapla(kayit.govde);

    let metaHtml = "";
    if (tur === "proje") {
      const parcalar = [];
      if (kayit.venue) parcalar.push(escapeHtml(kayit.venue));
      if (kayit.tarih) parcalar.push(new Date(kayit.tarih).getFullYear());
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      if (kayit.durum) parcalar.push(`<span class="tag">${escapeHtml(kayit.durum)}</span>`);
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    } else {
      const parcalar = [];
      if (kayit.tarih) {
        parcalar.push(
          new Date(kayit.tarih).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })
        );
      }
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    }

    let html = `<h1>${escapeHtml(kayit.baslik)}</h1>${metaHtml}`;
    html += kaynakButonlariHtml(kayit.pdf_url, kayit.veri_url, escapeHtml);
    html += `<div class="project-body">${basitMarkdown(kayit.govde || "")}</div>`;
    // GÜVENLİK: href'e basmadan önce şema kontrolü (bkz. guvenliDisUrlMi
    // yorumu) — "javascript:" gibi bir URI hiç render edilmez.
    if (tur === "proje" && kayit.link && guvenliDisUrlMi(kayit.link)) {
      html += `<p class="proje-baglanti-alani"><a href="${escapeHtml(kayit.link)}" target="_blank" rel="noopener noreferrer">→ ${escapeHtml(
        kayit.link_etiket || "Bağlantıyı görüntüle"
      )}</a></p>`;
    }

    govdeEl.innerHTML = html;

    // İÇİNDEKİLER: bkz. supabase-yazi.js'deki AYNI mantık — gövde DOM'a
    // yazıldıktan SONRA üretilip .project-body'nin hemen önüne eklenir.
    const tocElementi = tocOlustur(govdeEl.querySelector(".project-body"), kayit.toc === true);
    if (tocElementi) {
      govdeEl.querySelector(".project-body").before(tocElementi);
    }
  } catch (err) {
    console.error("onizleme.js init hatası:", err);
    if (uyariEl) uyariEl.hidden = true;
    govdeEl.innerHTML = `<p>Bir şeyler ters gitti, sayfayı yenilemeyi dene.</p>`;
  }
}

/** ozel-icerik.js ile aynı, bağımlılıksız basit markdown->HTML dönüşümü (bkz. o dosyadaki açıklama).
 *
 * BUG FİX ("### şeklinde kalıyor" / H3-H4 içindekilere girmiyor): bu
 * fonksiyon önceden SADECE "# ", "## ", "### " (H1-H3) kalıplarını
 * tanıyordu — editördeki "H4" araç çubuğu düğmesiyle ("#### metin", bkz.
 * panel/github-yonetim.md) eklenen bir alt-alt başlık hiç yakalanmıyor,
 * "#### ..." METNİ olarak kalıyordu (GitHub'a commit edilip Jekyll/
 * kramdown ile derlenen yazılarda bu sorun hiç yaşanmaz — kramdown H1-H6
 * arası tüm seviyeleri zaten doğru işler; bu basit dönüştürücü SADECE
 * Jekyll'i hiç görmeyen üç yol için kullanılır: önizleme, "sadece
 * Supabase'te yayınla" ve "özel içerik"). Artık "#" sayısını (1-4 arası,
 * editörün üretebildiği azami seviye) SAYIP ona göre h1..h4 üretiyor —
 * assets/js/okuma-araclari/okuma-meta-yardimci.js'teki tocOlustur() da
 * (bkz. o dosyadaki AYNI bugfix notu) artık h4'ü İçindekiler'e dahil
 * ediyor, ikisi birlikte çalışır.
 */
/**
 * KRAMDOWN DİPNOT (FOOTNOTE) DESTEĞİ:
 * Bu önizleme motoru Jekyll/kramdown'ı hiç görmediği için (bkz. yukarıdaki
 * H1-H4 bugfix notu) kramdown'ın YERLEŞİK "[^etiket]" / "[^etiket]:
 * açıklama" söz dizimini KENDİSİ tanımak zorunda — aksi halde GitHub'a
 * commit edilince düzgün görünecek bir dipnot, burada sadece ham "[^1]"
 * metni olarak kalırdı.
 *
 * Üretilen HTML, kramdown'ın KENDİ ürettiği sınıf/kimlik adlarıyla
 * (`sup[id^="fnref:"] > a.footnote`, `div.footnotes`, `li[id^="fn:"]`,
 * `a.reversefootnote`) BİREBİR AYNI — böylece assets/style.css'teki TEK
 * bir kural seti hem gerçek (GitHub'a commit edilmiş, kramdown'ın
 * ürettiği) yazılarda hem burada, tarayıcıda üretilen önizlemede AYNI
 * görünümü verir; iki ayrı stil seti bakımı gerekmez.
 *
 * `md` PARAMETRESİ ZATEN escapeHtml() İLE KAÇIRILMIŞ metindir (bkz.
 * basitMarkdown) — bu güvenli, çünkü escapeHtml sadece & < > " '
 * karakterlerini değiştirir, "[", "]", "^", ":" karakterlerine hiç
 * dokunmaz; bu yüzden aşağıdaki regex'ler kaçırılmış metin üzerinde de
 * sorunsuz çalışır ve kullanıcının dipnot AÇIKLAMASINDA yazdığı
 * < > & gibi karakterler zaten güvenle kaçırılmış olarak HTML'e girer
 * (ekstra bir escape adımına gerek YOK, çift-kaçırma riski de yok).
 */
function dipnotTanimlariniAyikla(escKacirilmisMd) {
  const tanimlar = new Map(); // etiket -> açıklama HTML'i (zaten esc edilmiş)
  const govde = escKacirilmisMd.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.+)$/gm, (_tam, etiket, aciklama) => {
    tanimlar.set(etiket, aciklama.trim());
    return ""; // tanım satırını gövdeden çıkar — ayrıca render edilmeyecek
  });
  return { govde, tanimlar };
}

/**
 * `html` (bloklara ayrılıp render edildikten SONRAKİ tam sayfa HTML'i)
 * içindeki "[^etiket]" işaretlerini kramdown'ınkiyle AYNI görünür
 * numaralandırmayla (belgede İLK GEÇTİĞİ sıraya göre 1, 2, 3…) satır
 * içi bağlantılara çevirir ve sayfanın SONUNA ↩ geri dönüş
 * bağlantılı bir "Dipnotlar" listesi ekler. Tanımı OLMAYAN bir "[^x]"
 * işaretine DOKUNULMAZ (kullanıcı henüz tanımını yazmamış olabilir —
 * ham metin olarak kalması, sessizce kaybolmasından daha faydalıdır).
 */
function dipnotlariRenderla(html, tanimlar) {
  if (tanimlar.size === 0) return html;

  const siraNo = new Map(); // etiket -> görünür numara (ilk geçiş sırası)
  const isaretliHtml = html.replace(/\[\^([^\]\s]+)\]/g, (tamEslesme, etiket) => {
    if (!tanimlar.has(etiket)) return tamEslesme;
    if (!siraNo.has(etiket)) siraNo.set(etiket, siraNo.size + 1);
    const no = siraNo.get(etiket);
    return `<sup id="fnref:${etiket}"><a href="#fn:${etiket}" class="footnote">${no}</a></sup>`;
  });

  if (siraNo.size === 0) return isaretliHtml; // hiç kullanılan (referans verilen) tanım yok

  const maddeler = [...siraNo.keys()]
    .map(
      (etiket) =>
        `<li id="fn:${etiket}">${tanimlar.get(etiket)} <a href="#fnref:${etiket}" class="reversefootnote">↩</a></li>`
    )
    .join("");

  return `${isaretliHtml}<div class="footnotes"><ol>${maddeler}</ol></div>`;
}

function basitMarkdown(md) {
  const esc = escapeHtml(md);
  // Dipnot TANIMLARI ("[^N]: açıklama" satırları), paragraf bloklarına
  // ayrılmadan ÖNCE metinden çıkarılır — aksi halde "## " gibi bir
  // başlık kalıbıyla YANLIŞLIKLA eşleşmez ve kendi (istenmeyen) <p>
  // bloğu olarak render edilmez.
  const { govde, tanimlar } = dipnotTanimlariniAyikla(esc);
  const anaHtml = govde
    .split(/\n{2,}/)
    .map((blok) => {
      if (blok.trim() === "") return "";
      const baslikEslesme = blok.match(/^(#{1,4})[ \t]+(.+)$/);
      if (baslikEslesme) {
        const seviye = baslikEslesme[1].length;
        return `<h${seviye}>${baslikEslesme[2]}</h${seviye}>`;
      }
      let satir = blok
        .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replaceAll(/\*(.+?)\*/g, "<em>$1</em>")
        .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replaceAll(/\n/g, "<br>");
      return `<p>${satir}</p>`;
    })
    // Dipnot tanım satırı silinince geride kalabilecek BOŞ blokları at
    // (ör. tanım tek başına kendi paragrafındaysa) — yoksa boş bir
    // "<p></p>" olarak sayfada gereksiz bir boşluk bırakırdı.
    .filter((parca) => parca !== "")
    .join("\n");
  return dipnotlariRenderla(anaHtml, tanimlar);
}

init();
