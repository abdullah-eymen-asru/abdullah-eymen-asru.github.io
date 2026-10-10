/*
 * assets/js/donusturucu/belge-ir.js — Belge ara temsili (IR) + Markdown / düz metin üreticileri.
 * -----------------------------------------------------------------------
 *  Mimari: her belge türü önce TEMİZ HTML'e (pivot) çevrilir; HTML → IR (bu dosya) → hedef (docx/pdf/md/txt/epub).
 *  Böylece N×N dönüşüm yerine N okuyucu + M yazıcı yeterli olur.
 *
 *  IR blokları:
 *   {t:"h", lv:1-6, runs, align}      {t:"p", runs, align}        {t:"list", ordered, start, items:[{blocks}]}
 *   {t:"table", baslik:bool, rows:[[{blocks, th, colspan, rowspan}]]}
 *   {t:"quote", blocks}               {t:"code", text}            {t:"hr"}        {t:"img", src, alt}
 *  run: {text, b, i, u, s, code, sup, sub, href} | {br:true}
 * -----------------------------------------------------------------------
 */

const BLOK_ETIKETLER = new Set(["address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);

function stilEkle(stil, ad, d) {
  const s = { ...stil };
  switch (ad) {
    case "strong": case "b": s.b = true; break;
    case "em": case "i": case "cite": case "var": s.i = true; break;
    case "u": case "ins": s.u = true; break;
    case "s": case "strike": case "del": s.s = true; break;
    case "code": case "kbd": case "samp": case "tt": s.code = true; break;
    case "sup": s.sup = true; break;
    case "sub": s.sub = true; break;
    case "mark": s.mark = true; break;
    case "a": { const h = d.getAttribute("href"); if (h) s.href = h; break; }
    default: break;
  }
  return s;
}

export function htmlDenIR(html) {
  const doc = new DOMParser().parseFromString(/<body[\s>]/i.test(html) ? html : `<!doctype html><body>${html}`, "text/html");
  return bloklar(doc.body.childNodes, false);
}

function runlaraTopla(dugumler, stil, runs, gorselCikti, pre) {
  for (const d of dugumler) {
    if (d.nodeType === 3) {
      let t = d.nodeValue;
      if (!pre) t = t.replace(/[ \t\r\n\f]+/g, " ");
      if (t) runs.push({ text: t, ...stil });
    } else if (d.nodeType === 1) {
      const ad = d.localName;
      if (ad === "br") runs.push({ br: true });
      else if (ad === "img") gorselCikti.push({ t: "img", src: d.getAttribute("src") || "", alt: d.getAttribute("alt") || "" });
      else if (BLOK_ETIKETLER.has(ad)) continue; // satır içi bağlamda iç içe blok: çağıran taraf ayırır
      else runlaraTopla(d.childNodes, stilEkle(stil, ad, d), runs, gorselCikti, pre);
    }
  }
}

function runKirp(runs) {
  // baştaki/sondaki boşluklar ve ardışık <br> temizliği
  while (runs.length && runs[0].text !== undefined && /^\s*$/.test(runs[0].text)) runs.shift();
  while (runs.length && runs[runs.length - 1].text !== undefined && /^\s*$/.test(runs[runs.length - 1].text)) runs.pop();
  while (runs.length && runs[runs.length - 1].br) runs.pop();
  while (runs.length && runs[0].br) runs.shift();
  if (runs.length && runs[0].text !== undefined) runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, "") };
  const son = runs.length - 1;
  if (son >= 0 && runs[son].text !== undefined) runs[son] = { ...runs[son], text: runs[son].text.replace(/\s+$/, "") };
  return runs.filter((r) => r.br || r.text);
}

const hiza = (d) => { const a = d.getAttribute?.("align"); return a && a !== "left" ? a : undefined; };

function bloklar(dugumler, pre) {
  const cikti = [];
  let bekleyen = [];
  let bekleyenGorsel = [];
  const bosalt = (align) => {
    const r = runKirp(bekleyen);
    if (r.length) cikti.push({ t: "p", runs: r, ...(align ? { align } : {}) });
    for (const g of bekleyenGorsel) cikti.push(g);
    bekleyen = [];
    bekleyenGorsel = [];
  };

  for (const d of dugumler) {
    if (d.nodeType === 3) { runlaraTopla([d], {}, bekleyen, bekleyenGorsel, pre); continue; }
    if (d.nodeType !== 1) continue;
    const ad = d.localName;
    if (!BLOK_ETIKETLER.has(ad)) { runlaraTopla([d], stilEkle({}, ad, d), bekleyen, bekleyenGorsel, pre); continue; }
    bosalt();
    if (/^h[1-6]$/.test(ad)) {
      const runs = [];
      const g = [];
      runlaraTopla(d.childNodes, {}, runs, g, false);
      const r = runKirp(runs);
      if (r.length) cikti.push({ t: "h", lv: Number(ad[1]), runs: r, ...(hiza(d) ? { align: hiza(d) } : {}) });
      cikti.push(...g);
    } else if (ad === "p" || ad === "dt" || ad === "figcaption" || ad === "dd") {
      const runs = [];
      const g = [];
      runlaraTopla(d.childNodes, ad === "dt" ? { b: true } : {}, runs, g, false);
      const r = runKirp(runs);
      if (r.length) cikti.push({ t: "p", runs: r, ...(hiza(d) ? { align: hiza(d) } : {}) });
      cikti.push(...g);
    } else if (ad === "ul" || ad === "ol") {
      const ogeler = [...d.children].filter((c) => c.localName === "li").map((li) => ({ blocks: bloklar(li.childNodes, false) }));
      if (ogeler.length) cikti.push({ t: "list", ordered: ad === "ol", start: parseInt(d.getAttribute("start"), 10) || 1, items: ogeler });
    } else if (ad === "table") {
      const t = tabloIR(d);
      if (t) cikti.push(t);
    } else if (ad === "blockquote") {
      const b = bloklar(d.childNodes, false);
      if (b.length) cikti.push({ t: "quote", blocks: b });
    } else if (ad === "pre") {
      let metin = d.textContent.replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
      cikti.push({ t: "code", text: metin });
    } else if (ad === "hr") {
      cikti.push({ t: "hr" });
    } else if (ad === "li") {
      cikti.push(...bloklar(d.childNodes, false));
    } else {
      // div, section, figure, dl vb.: blok içeriyorsa özyinele; yalnızca satır içiyse paragraf
      const icerikBlok = [...d.childNodes].some((c) => c.nodeType === 1 && (BLOK_ETIKETLER.has(c.localName) || c.localName === "img"));
      if (icerikBlok) cikti.push(...bloklar(d.childNodes, pre));
      else {
        const runs = [];
        const g = [];
        runlaraTopla(d.childNodes, {}, runs, g, pre);
        const r = runKirp(runs);
        if (r.length) cikti.push({ t: "p", runs: r, ...(hiza(d) ? { align: hiza(d) } : {}) });
        cikti.push(...g);
      }
    }
  }
  bosalt();
  return cikti;
}

function tabloIR(tablo) {
  const satirlar = [...tablo.querySelectorAll("tr")].filter((tr) => tr.closest("table") === tablo);
  if (!satirlar.length) return null;
  let baslik = false;
  const rows = satirlar.map((tr, ri) => {
    const hucreler = [...tr.children].filter((c) => c.localName === "td" || c.localName === "th");
    if (ri === 0 && (tr.parentElement?.localName === "thead" || (hucreler.length && hucreler.every((c) => c.localName === "th")))) baslik = true;
    return hucreler.map((c) => ({
      blocks: bloklar(c.childNodes, false),
      th: c.localName === "th",
      colspan: Math.max(1, parseInt(c.getAttribute("colspan"), 10) || 1),
      rowspan: Math.max(1, parseInt(c.getAttribute("rowspan"), 10) || 1),
    }));
  }).filter((r) => r.length);
  return rows.length ? { t: "table", baslik, rows } : null;
}

/* ------------------------------------ düz metin ------------------------------------ */

export const runMetni = (runs) => runs.map((r) => (r.br ? "\n" : r.text)).join("");

function irMetinSatirlari(bl, girinti = "") {
  const out = [];
  for (const b of bl) {
    switch (b.t) {
      case "h": out.push(girinti + runMetni(b.runs), ""); break;
      case "p": out.push(girinti + runMetni(b.runs).replace(/\n/g, `\n${girinti}`), ""); break;
      case "list": {
        b.items.forEach((it, i) => {
          const isaret = b.ordered ? `${b.start + i}. ` : "• ";
          const ic = irMetinSatirlari(it.blocks, "").join("\n").replace(/\n+$/, "").split("\n");
          out.push(girinti + isaret + (ic[0] || ""));
          for (const s of ic.slice(1)) out.push(s ? `${girinti}${" ".repeat(isaret.length)}${s}` : "");
        });
        out.push("");
        break;
      }
      case "table":
        for (const r of b.rows) out.push(girinti + r.map((h) => irMetinSatirlari(h.blocks).join(" ").replace(/\s+/g, " ").trim()).join("\t"));
        out.push("");
        break;
      case "quote": out.push(...irMetinSatirlari(b.blocks, `${girinti}    `)); break;
      case "code": out.push(...b.text.split("\n").map((s) => girinti + s), ""); break;
      case "hr": out.push(`${girinti}${"─".repeat(24)}`, ""); break;
      case "img": out.push(`${girinti}[Görsel${b.alt ? `: ${b.alt}` : ""}]`, ""); break;
      default: break;
    }
  }
  return out;
}

export function irDenMetin(bl) {
  return `${irMetinSatirlari(bl).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ------------------------------------ Markdown ------------------------------------ */

function mdKacis(t) {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/([`*[\]<])/g, "\\$1")
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace("_", "\\_"))
    .replace(/^(\s*)([#>+-])(?=\s)/, "$1\\$2")
    .replace(/^(\s*)(\d+)\.(?=\s)/, "$1$2\\.");
}

function birlestir(runs) {
  const o = [];
  for (const r of runs) {
    const son = o[o.length - 1];
    if (son && !r.br && !son.br && ["b", "i", "u", "s", "code", "sup", "sub", "href", "mark"].every((k) => son[k] === r[k])) son.text += r.text;
    else o.push({ ...r });
  }
  return o;
}

export function runlarMd(runs) {
  let s = "";
  for (const r of birlestir(runs)) {
    if (r.br) { s += "  \n"; continue; }
    let t = r.text;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
    const bas = m[1];
    const cekirdek = m[2];
    const son = m[3];
    if (!cekirdek) { s += t; continue; }
    let x;
    if (r.code) {
      const f = "`".repeat((cekirdek.match(/`+/g) || [""]).reduce((a, b) => Math.max(a, b.length), 0) + 1);
      x = `${f}${/^`|`$/.test(cekirdek) ? ` ${cekirdek} ` : cekirdek}${f}`;
    } else x = mdKacis(cekirdek);
    if (r.sup) x = `<sup>${x}</sup>`;
    if (r.sub) x = `<sub>${x}</sub>`;
    if (r.u) x = `<u>${x}</u>`;
    if (r.s) x = `~~${x}~~`;
    if (r.i) x = `*${x}*`;
    if (r.b) x = `**${x}**`;
    if (r.href) x = `[${x}](${r.href.replace(/\)/g, "%29").replace(/ /g, "%20")})`;
    s += bas + x + son;
  }
  return s;
}

function mdBloklar(bl, secenek, siki = false) {
  const parcalar = [];
  for (const b of bl) {
    switch (b.t) {
      case "h": parcalar.push(`${"#".repeat(b.lv)} ${runlarMd(b.runs).replace(/\n/g, " ")}`); break;
      case "p": parcalar.push(runlarMd(b.runs)); break;
      case "list": {
        const satir = [];
        const gevsek = b.items.some((it) => it.blocks.filter((x) => x.t !== "list").length > 1);
        b.items.forEach((it, i) => {
          const isaret = b.ordered ? `${b.start + i}. ` : "- ";
          const ic = mdBloklar(it.blocks, secenek, !gevsek).split("\n");
          satir.push(isaret + (ic[0] ?? ""));
          for (const s of ic.slice(1)) satir.push(s ? " ".repeat(isaret.length) + s : "");
          if (gevsek && i < b.items.length - 1) satir.push("");
        });
        parcalar.push(satir.join("\n"));
        break;
      }
      case "table": {
        const hucre = (h) => mdBloklar(h.blocks, secenek).replace(/\n{2,}/g, "<br>").replace(/\n/g, "<br>").replace(/\|/g, "\\|") || " ";
        const sutun = Math.max(...b.rows.map((r) => r.reduce((a, h) => a + h.colspan, 0)));
        const duz = b.rows.map((r) => {
          const o = [];
          for (const h of r) { o.push(hucre(h)); for (let k = 1; k < h.colspan; k++) o.push(" "); }
          while (o.length < sutun) o.push(" ");
          return `| ${o.join(" | ")} |`;
        });
        duz.splice(1, 0, `| ${Array(sutun).fill("---").join(" | ")} |`);
        parcalar.push(duz.join("\n"));
        break;
      }
      case "quote": parcalar.push(mdBloklar(b.blocks, secenek).split("\n").map((s) => (s ? `> ${s}` : ">")).join("\n")); break;
      case "code": {
        const f = "`".repeat(Math.max(3, (b.text.match(/`+/g) || [""]).reduce((a, x) => Math.max(a, x.length), 0) + 1));
        parcalar.push(`${f}\n${b.text}\n${f}`);
        break;
      }
      case "hr": parcalar.push("---"); break;
      case "img": {
        const url = secenek?.gorsel ? secenek.gorsel(b.src, b.alt) : b.src;
        if (url) parcalar.push(`![${(b.alt || "").replace(/[[\]]/g, "")}](${url})`);
        break;
      }
      default: break;
    }
  }
  return parcalar.join(siki ? "\n" : "\n\n");
}

/** secenek.gorsel(src, alt) → bağlantı adresi (ör. "gorseller/gorsel-1.png"); verilmezse data URI aynen kalır. */
export function irDenMd(bl, secenek = {}) {
  return `${mdBloklar(bl, secenek).replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** İlk başlığı ya da ilk satırı belge başlığı olarak önerir. */
export function irBaslik(bl, yedek = "Belge") {
  const h = bl.find((b) => b.t === "h");
  const p = bl.find((b) => b.t === "p");
  const t = runMetni((h || p)?.runs || []).replace(/\s+/g, " ").trim();
  return (t || yedek).slice(0, 100);
}
