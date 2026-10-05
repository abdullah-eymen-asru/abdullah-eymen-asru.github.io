/*
 * assets/js/notlar/bicim.js
 * -----------------------------------------------------------------------
 * Not editörünün "biçim" katmanı — DOM dışında hiçbir şeye bağlı olmayan yardımcılar.
 *
 *  - guvenliKur / htmlKur / duzenleyiciHtml : HTML'i BEYAZ LİSTEYLE yeniden kurar.
 *    Not içeriği güvenilmeyen girdi sayılır: ham HTML hiçbir zaman innerHTML ile basılmaz;
 *    DOMParser ile (script çalıştırmayan, kapalı bir belgede) ayrıştırılır, izinli etiketler
 *    createElement ile yeniden üretilir. Satır içi style / on* öznitelikleri taşınmaz
 *    (sitenin CSP'si de style="" özniteliğini engelliyor).
 *  - htmlMarkdown : yayın hattı ("Yazıya dönüştür") ve okunur yedek için Markdown üretir.
 *  - markdownKur  : eski (Markdown gövdeli) notları editörde açabilmek için.
 *  - duzMetinHtml : arama ve özet için düz metin.
 * -----------------------------------------------------------------------
 */

const SATIR_ICI = new Set(["strong", "em", "u", "s", "mark", "br", "img"]);
const BLOK_SECICI = "p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,hr";

const ETIKET = {
  b: "strong", strong: "strong", i: "em", em: "em", u: "u", s: "s", strike: "s", del: "s", mark: "mark",
  br: "br", hr: "hr", h1: "h2", h2: "h2", h3: "h3", h4: "h3", h5: "h3", h6: "h3",
  p: "p", div: "p", ul: "ul", ol: "ol", li: "li", blockquote: "blockquote", img: "img",
};
const ATLA = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "head", "title", "link", "meta"]);

const yap = (ad) => document.createElement(ad);

/* ------------------------------------------------------------------ */
/* 1) Güvenli yeniden kurma                                            */
/* ------------------------------------------------------------------ */

export function guvenliKur(kaynak, hedef) {
  for (const d of [...kaynak.childNodes]) dugumuKur(d, hedef);
}

function dugumuKur(d, hedef) {
  if (d.nodeType === 3) {
    if (d.nodeValue) hedef.append(d.nodeValue);
    return;
  }
  if (d.nodeType !== 1) return;
  const ad = d.localName;
  if (ATLA.has(ad)) return;
  const yeni = ETIKET[ad];
  if (!yeni) return void guvenliKur(d, hedef); // bilinmeyen etiket: sarmalayıcıyı at, içeriği koru

  if (yeni === "br" || yeni === "hr") return void hedef.append(yap(yeni));

  if (yeni === "img") {
    const id = (d.getAttribute("data-ek") || "").slice(0, 64);
    if (!id) return; // yalnızca nota eklenmiş (şifreli) görseller
    const i = yap("img");
    i.setAttribute("data-ek", id);
    i.setAttribute("alt", (d.getAttribute("alt") || "").slice(0, 200));
    return void hedef.append(i);
  }

  // Satır içi sarmalayıcıda blok varsa sarmalayıcıyı at (yapı bozulmasın)
  if (SATIR_ICI.has(yeni) && d.querySelector(BLOK_SECICI)) return void guvenliKur(d, hedef);
  // div/p içinde başka blok varsa (ör. <div><p>…</p></div>) sarmalayıcıyı at
  if (yeni === "p" && d.querySelector(BLOK_SECICI)) return void guvenliKur(d, hedef);

  if (yeni === "li") {
    const li = yap("li");
    if (d.hasAttribute("data-yapildi")) li.setAttribute("data-yapildi", "1");
    guvenliKur(d, li);
    return void hedef.append(li);
  }

  if (yeni === "ul" || yeni === "ol") {
    const liste = yap(yeni);
    if (yeni === "ul" && d.classList.contains("nt-gorev")) liste.className = "nt-gorev";
    for (const c of [...d.childNodes]) {
      if (c.nodeType === 1 && c.localName === "li") {
        dugumuKur(c, liste);
      } else if (c.nodeType === 1 && (c.localName === "ul" || c.localName === "ol")) {
        // iç içe liste <li> dışına yazılmışsa son maddenin içine al
        let son = liste.lastElementChild;
        if (!son) {
          son = yap("li");
          liste.append(son);
        }
        dugumuKur(c, son);
      } else if (c.nodeType === 3 ? c.nodeValue.trim() : c.nodeType === 1) {
        const li = yap("li");
        dugumuKur(c, li);
        if (li.childNodes.length) liste.append(li);
      }
    }
    return void hedef.append(liste);
  }

  const k = yap(yeni);
  guvenliKur(d, k);
  hedef.append(k);
}

const satirIciMi = (n) => n.nodeType === 3 || (n.nodeType === 1 && SATIR_ICI.has(n.localName));

/** Kökte dolaşan çıplak metin / satır içi öğeleri <p> içine toplar. */
export function kokuDuzenle(kap) {
  let grup = null;
  for (const n of [...kap.childNodes]) {
    if (satirIciMi(n)) {
      if (n.nodeType === 3 && !n.nodeValue.trim() && !grup) {
        n.remove();
        continue;
      }
      if (!grup) {
        grup = yap("p");
        kap.insertBefore(grup, n);
      }
      grup.append(n);
    } else {
      grup = null;
    }
  }
}

const bosParagrafMi = (n) => n.localName === "p" && !n.textContent.trim() && !n.querySelector("img");

function sondakiBoslariAt(kap) {
  while (kap.lastElementChild && bosParagrafMi(kap.lastElementChild)) kap.lastElementChild.remove();
}

/** HTML metnini (kayıtlı not) hedef kapsayıcıya GÜVENLİ biçimde kurar. */
export function htmlKur(htmlMetni, hedef) {
  const belge = new DOMParser().parseFromString(String(htmlMetni || ""), "text/html");
  hedef.replaceChildren();
  guvenliKur(belge.body, hedef);
  kokuDuzenle(hedef);
}

/** Editör (contenteditable) → temiz, kaydedilecek HTML metni. */
export function duzenleyiciHtml(kok) {
  const gecici = yap("div");
  guvenliKur(kok, gecici);
  kokuDuzenle(gecici);
  sondakiBoslariAt(gecici);
  return gecici.innerHTML; // yalnızca OKUMA: içerik az önce beyaz listeyle kurulan ağaçtan geliyor
}

/* ------------------------------------------------------------------ */
/* 2) Düz metin (arama, özet)                                          */
/* ------------------------------------------------------------------ */

export function duzMetinHtml(htmlMetni) {
  const belge = new DOMParser().parseFromString(String(htmlMetni || ""), "text/html");
  let s = "";
  const gez = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.localName === "img") continue;
        if (c.localName === "br") s += "\n";
        gez(c);
        if (/^(p|h2|h3|li|blockquote|hr)$/.test(c.localName)) s += "\n";
      }
    }
  };
  gez(belge.body);
  return s.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* 3) HTML → Markdown (yayın hattı / okunur yedek)                     */
/* ------------------------------------------------------------------ */

const kacis = (s) => s.replace(/\\/g, "\\\\").replace(/([*_`])/g, "\\$1").replace(/</g, "&lt;");

function satirDugum(n) {
  if (n.nodeType === 3) return kacis(n.nodeValue.replace(/\s+/g, " "));
  if (n.nodeType !== 1) return "";
  const a = n.localName;
  if (a === "br") return "  \n";
  if (a === "img") return `![${(n.getAttribute("alt") || "").replace(/[[\]]/g, "")}](ek:${n.getAttribute("data-ek")})`;
  const ic = satirIci(n);
  const [, bas, orta, son] = ic.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!orta) return ic;
  const sar = { strong: "**", em: "*", s: "~~" }[a];
  if (sar) return `${bas}${sar}${orta}${sar}${son}`;
  if (a === "u" || a === "mark") return `${bas}<${a}>${orta}</${a}>${son}`;
  return ic;
}
const satirIci = (kap) => [...kap.childNodes].map(satirDugum).join("");

const blokVarMi = (n) => !!n.querySelector(":scope > p, :scope > ul, :scope > ol, :scope > h2, :scope > h3, :scope > blockquote");
const icerik = (n) => (blokVarMi(n) ? bloklar(n) : satirIci(n));

function liste(kap, d) {
  const sirali = kap.localName === "ol";
  const gorev = kap.classList.contains("nt-gorev");
  let sira = 1;
  let s = "";
  for (const li of kap.children) {
    if (li.localName !== "li") continue;
    let metin = "";
    let alt = "";
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.localName === "ul" || c.localName === "ol")) alt += liste(c, d + 1);
      else if (c.nodeType === 1 && c.localName === "p") metin += satirIci(c) + " ";
      else metin += satirDugum(c);
    }
    const isaret = gorev ? (li.hasAttribute("data-yapildi") ? "- ☑ " : "- ☐ ") : sirali ? `${sira++}. ` : "- ";
    s += `${"    ".repeat(d)}${isaret}${metin.trim()}\n${alt}`;
  }
  return s;
}

function bloklar(kap) {
  let cikti = "";
  for (const n of kap.childNodes) {
    if (n.nodeType === 3) {
      if (n.nodeValue.trim()) cikti += kacis(n.nodeValue.trim()) + "\n\n";
      continue;
    }
    if (n.nodeType !== 1) continue;
    const a = n.localName;
    if (a === "p") {
      const t = satirIci(n).trim();
      if (t) cikti += t + "\n\n";
    } else if (a === "h2" || a === "h3") {
      const t = satirIci(n).trim();
      if (t) cikti += `${a === "h2" ? "##" : "###"} ${t}\n\n`;
    } else if (a === "hr") {
      cikti += "---\n\n";
    } else if (a === "blockquote") {
      const t = icerik(n).trim();
      if (t) cikti += t.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") + "\n\n";
    } else if (a === "ul" || a === "ol") {
      cikti += liste(n, 0) + "\n";
    } else if (SATIR_ICI.has(a)) {
      cikti += satirDugum(n);
    }
  }
  return cikti;
}

export function htmlMarkdown(htmlMetni) {
  const belge = new DOMParser().parseFromString(String(htmlMetni || ""), "text/html");
  const md = bloklar(belge.body).replace(/\n{3,}/g, "\n\n").trim();
  return md ? md + "\n" : "";
}

/* ------------------------------------------------------------------ */
/* 4) Markdown → DOM (eski notları editörde açmak için)                */
/* ------------------------------------------------------------------ */

function satirIciKur(s, hedef) {
  const re = /!\[([^\]]*)\]\(ek:([^)]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let son = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > son) hedef.append(s.slice(son, m.index));
    if (m[2]) {
      const i = yap("img");
      i.setAttribute("data-ek", m[2].slice(0, 64));
      i.setAttribute("alt", m[1].slice(0, 200));
      hedef.append(i);
    } else if (m[3]) {
      const b = yap("strong");
      b.textContent = m[3];
      hedef.append(b);
    } else {
      const e = yap("em");
      e.textContent = m[4];
      hedef.append(e);
    }
    son = m.index + m[0].length;
  }
  if (son < s.length) hedef.append(s.slice(son));
}

export function markdownKur(md, hedef) {
  hedef.replaceChildren();
  let para = [];
  let liste = null;
  let listeTur = null;
  let alinti = null;

  const bosalt = () => {
    if (!para.length) return;
    const p = yap("p");
    para.forEach((s, k) => {
      if (k) p.append(yap("br"));
      satirIciKur(s, p);
    });
    hedef.append(p);
    para = [];
  };
  const sifirla = () => {
    liste = null;
    alinti = null;
  };

  for (const satir of String(md || "").replace(/\r\n?/g, "\n").split("\n")) {
    let m;
    if (!satir.trim()) {
      bosalt();
      sifirla();
    } else if ((m = satir.match(/^(#{1,6})\s+(.*)$/))) {
      bosalt();
      sifirla();
      const h = yap(m[1].length <= 2 ? "h2" : "h3");
      satirIciKur(m[2], h);
      hedef.append(h);
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(satir)) {
      bosalt();
      sifirla();
      hedef.append(yap("hr"));
    } else if ((m = satir.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      bosalt();
      alinti = null;
      const tur = /\d/.test(m[1]) ? "ol" : "ul";
      if (!liste || listeTur !== tur) {
        liste = yap(tur);
        listeTur = tur;
        hedef.append(liste);
      }
      const li = yap("li");
      satirIciKur(m[2], li);
      liste.append(li);
    } else if ((m = satir.match(/^>\s?(.*)$/))) {
      bosalt();
      liste = null;
      if (!alinti) {
        alinti = yap("blockquote");
        hedef.append(alinti);
      } else alinti.append(yap("br"));
      satirIciKur(m[1], alinti);
    } else {
      sifirla();
      para.push(satir);
    }
  }
  bosalt();
}

/* ------------------------------------------------------------------ */
/* 5) Hazır iskeletler (isteğe bağlı; klasör/başlık adı DAYATMAZ)      */
/* ------------------------------------------------------------------ */

export const SABLONLAR = {
  ders: { ad: "Ders notu", tur: "ders", parcalar: [["h3", "Konu"], ["p", ""], ["h3", "Anahtar kavramlar"], ["ul", ["", ""]], ["h3", "Notlar"], ["p", ""], ["h3", "Anlamadıklarım"], ["ul", [""]], ["h3", "Kısa özet"], ["p", ""]] },
  sunum: { ad: "Sunum", tur: "sunum", parcalar: [["h3", "Amaç ve dinleyici"], ["p", ""], ["h3", "Akış"], ["ol", ["", "", ""]], ["h3", "Ana mesajlar"], ["ul", ["", ""]], ["h3", "Konuşma notları"], ["p", ""], ["h3", "Kaynaklar"], ["ul", [""]], ["h3", "Hazırlık"], ["gorev", ["Slaytları bitir", "Prova yap"]]] },
  proje: { ad: "Proje", tur: "proje", parcalar: [["h3", "Özet"], ["p", ""], ["h3", "Hedefler"], ["ul", ["", ""]], ["h3", "Aşamalar"], ["gorev", ["", ""]], ["h3", "Kaynaklar ve literatür"], ["ul", [""]], ["h3", "Açık sorular"], ["ul", [""]], ["h3", "Kararlar"], ["ul", [""]]] },
  etkinlik: { ad: "Panel / etkinlik", tur: "etkinlik", parcalar: [["h3", "Konuşmacı ve konu"], ["p", ""], ["h3", "Öne çıkanlar"], ["ul", ["", ""]], ["h3", "Not alınacak cümleler"], ["quote", ""], ["h3", "Takip"], ["gorev", [""]]] },
  toplanti: { ad: "Toplantı", tur: "toplanti", parcalar: [["h3", "Katılımcılar"], ["p", ""], ["h3", "Konuşulanlar"], ["ul", [""]], ["h3", "Kararlar"], ["ul", [""]], ["h3", "Yapılacaklar"], ["gorev", [""]]] },
  kaynak: { ad: "Kitap / makale", tur: "kaynak", parcalar: [["h3", "Künye"], ["p", ""], ["h3", "Ana argüman"], ["p", ""], ["h3", "Önemli alıntılar"], ["quote", ""], ["h3", "Kendi yorumum"], ["p", ""]] },
  fikir: { ad: "Fikir", tur: "fikir", parcalar: [["h3", "Fikir"], ["p", ""], ["h3", "Neden önemli?"], ["p", ""], ["h3", "Dayanak ve kaynaklar"], ["ul", [""]], ["h3", "Sonraki adım"], ["gorev", [""]]] },
};

export function sablonDugumleri(anahtar) {
  const s = SABLONLAR[anahtar];
  if (!s) return [];
  return s.parcalar.map(([tur, icerikDegeri]) => {
    if (tur === "ul" || tur === "ol" || tur === "gorev") {
      const u = yap(tur === "ol" ? "ol" : "ul");
      if (tur === "gorev") u.className = "nt-gorev";
      for (const m of icerikDegeri) {
        const li = yap("li");
        li.append(m || yap("br"));
        u.append(li);
      }
      return u;
    }
    const e = yap(tur === "quote" ? "blockquote" : tur);
    if (icerikDegeri) e.textContent = icerikDegeri;
    else e.append(yap("br"));
    return e;
  });
}
