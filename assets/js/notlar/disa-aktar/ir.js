/*
 * assets/js/notlar/disa-aktar/ir.js
 * -----------------------------------------------------------------------
 * Dışa aktarma için ortak yardımcılar:
 *  - htmlBloklari(): not HTML'ini (bicim.js'in beyaz listesinden geçmiş) biçim-bağımsız
 *    bir "blok listesi"ne çevirir; PDF, Word ve düz metin aynı listeden üretilir.
 *  - dosya/klasör adı temizleme, yerel zaman damgası, Türkçe tarih yazımı.
 * innerHTML KULLANMAZ; yalnızca DOMParser ile okur.
 * -----------------------------------------------------------------------
 */

/* ---------- adlar ve zaman ---------- */

const YASAK = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const WINDOWS_ADLARI = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** İşletim sistemlerinde güvenli dosya/klasör adı. Türkçe karakterler KORUNUR. */
export function adTemizle(ad, yedek = "Adsız", enFazla = 80) {
  let s = String(ad ?? "").replace(YASAK, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  if (s.length > enFazla) s = s.slice(0, enFazla).trim();
  if (!s || WINDOWS_ADLARI.test(s)) s = yedek;
  return s;
}

const iki = (n) => String(n).padStart(2, "0");

/** 2026-10-04_17-01 (yerel saat) — dosya adlarının başına konur, ada göre sıralama = zamana göre sıralama. */
export function zamanDamgasi(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "0000-00-00_00-00";
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}_${iki(d.getHours())}-${iki(d.getMinutes())}`;
}

/** 2026-10-04T17:01:22+03:00 */
export function yerelIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const of = -d.getTimezoneOffset();
  const isaret = of >= 0 ? "+" : "-";
  const a = Math.abs(of);
  return (
    `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}T${iki(d.getHours())}:${iki(d.getMinutes())}:${iki(d.getSeconds())}` +
    `${isaret}${iki(Math.floor(a / 60))}:${iki(a % 60)}`
  );
}

export const insanTarih = (iso, saatli = true) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("tr-TR", saatli ? { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" });
};

export function dosyaAdi(kayit, uzanti) {
  return `${zamanDamgasi(kayit.olusturma)}_${adTemizle(kayit.baslik, "Başlıksız not", 70)}.${uzanti}`;
}

/* ---------- HTML → blok listesi ---------- */

const YER_TUTUCU = /\{\{alinti:\d+\}\}/g;

/**
 * Blok türleri:
 *  {t:"h", s:1|2, runs}   başlık
 *  {t:"p", runs}          paragraf
 *  {t:"li", d, isaret, runs}  liste maddesi (d: girinti düzeyi, isaret: "•" | "3." | "☐" | "☑")
 *  {t:"q", runs}          alıntı paragrafı
 *  {t:"hr"}
 *  {t:"img", ek, alt}     nota eklenmiş görsel (ek = ek kimliği)
 * run: {text, b, i, u, s, mark} ya da {br:true}
 */
export function htmlBloklari(htmlMetni) {
  const belge = new DOMParser().parseFromString(String(htmlMetni || ""), "text/html");
  const bloklar = [];

  const satirIci = (dugum, stil, cikti, resimler) => {
    for (const c of dugum.childNodes) {
      if (c.nodeType === 3) {
        const t = c.nodeValue.replace(YER_TUTUCU, "");
        if (t) cikti.push({ text: t, ...stil });
      } else if (c.nodeType === 1) {
        const ad = c.localName;
        if (ad === "br") cikti.push({ br: true });
        else if (ad === "img") {
          const id = c.getAttribute("data-ek");
          if (id) resimler.push({ ek: id, alt: c.getAttribute("alt") || "" });
        } else if (ad === "ul" || ad === "ol") continue;
        else {
          const s = { ...stil };
          if (ad === "strong") s.b = true;
          if (ad === "em") s.i = true;
          if (ad === "u") s.u = true;
          if (ad === "s") s.s = true;
          if (ad === "mark") s.mark = true;
          satirIci(c, s, cikti, resimler);
        }
      }
    }
  };

  const bosMu = (runs) => !runs.length || runs.every((r) => !r.br && !r.text.trim());
  const resimleriBas = (r) => r.forEach((x) => bloklar.push({ t: "img", ek: x.ek, alt: x.alt }));

  const liste = (ul, derinlik) => {
    const sirali = ul.localName === "ol";
    const gorev = ul.classList.contains("nt-gorev");
    let n = 0;
    for (const li of ul.children) {
      if (li.localName !== "li") continue;
      n++;
      const runs = [];
      const resimler = [];
      satirIci(li, {}, runs, resimler);
      const isaret = gorev ? (li.hasAttribute("data-yapildi") ? "☑" : "☐") : sirali ? `${n}.` : "•";
      bloklar.push({ t: "li", d: derinlik, isaret, runs });
      resimleriBas(resimler);
      for (const alt of li.children) if (alt.localName === "ul" || alt.localName === "ol") liste(alt, derinlik + 1);
    }
  };

  const blok = (d) => {
    if (d.nodeType === 3) {
      const t = d.nodeValue.replace(YER_TUTUCU, "").trim();
      if (t) bloklar.push({ t: "p", runs: [{ text: t }] });
      return;
    }
    if (d.nodeType !== 1) return;
    switch (d.localName) {
      case "h1":
      case "h2":
      case "h3": {
        const runs = [];
        satirIci(d, {}, runs, []);
        if (!bosMu(runs)) bloklar.push({ t: "h", s: d.localName === "h3" ? 2 : 1, runs });
        return;
      }
      case "ul":
      case "ol":
        return liste(d, 0);
      case "hr":
        return void bloklar.push({ t: "hr" });
      case "blockquote": {
        const ic = [...d.children].filter((c) => ["p", "ul", "ol"].includes(c.localName));
        if (!ic.length) {
          const runs = [];
          const resimler = [];
          satirIci(d, {}, runs, resimler);
          if (!bosMu(runs)) bloklar.push({ t: "q", runs });
          resimleriBas(resimler);
        } else {
          for (const c of ic) {
            const runs = [];
            const resimler = [];
            satirIci(c, {}, runs, resimler);
            if (!bosMu(runs)) bloklar.push({ t: "q", runs });
            resimleriBas(resimler);
          }
        }
        return;
      }
      case "img": {
        const id = d.getAttribute("data-ek");
        if (id) bloklar.push({ t: "img", ek: id, alt: d.getAttribute("alt") || "" });
        return;
      }
      default: {
        const runs = [];
        const resimler = [];
        satirIci(d, {}, runs, resimler);
        if (!bosMu(runs)) bloklar.push({ t: "p", runs });
        resimleriBas(resimler);
      }
    }
  };

  for (const d of belge.body.childNodes) blok(d);
  return bloklar;
}

/** Blok listesi → okunur düz metin. */
export function bloklariMetneCevir(bloklar, resimAdi = (ek) => `[Görsel: ${ek}]`) {
  const duz = (runs) => runs.map((r) => (r.br ? "\n" : r.text)).join("");
  const satirlar = [];
  for (const b of bloklar) {
    if (b.t === "h") satirlar.push("", b.s === 1 ? duz(b.runs).toUpperCase() : duz(b.runs), "");
    else if (b.t === "p") satirlar.push(duz(b.runs), "");
    else if (b.t === "li") satirlar.push(`${"    ".repeat(b.d)}${b.isaret === "☐" ? "[ ]" : b.isaret === "☑" ? "[x]" : b.isaret} ${duz(b.runs)}`);
    else if (b.t === "q") satirlar.push(...duz(b.runs).split("\n").map((s) => `  | ${s}`), "");
    else if (b.t === "hr") satirlar.push("", "-".repeat(40), "");
    else if (b.t === "img") satirlar.push(resimAdi(b.ek), "");
  }
  return satirlar.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Kaydın "künye" satırları: PDF/Word/metin/HTML başlığında kullanılır. */
export function kunyeSatirlari(k, { turAdi, durumAdi }) {
  const s = [];
  if (k.klasorYolu.length) s.push(["Klasör", k.klasorYolu.join(" / ")]);
  if (turAdi) s.push(["Tür", turAdi]);
  if (durumAdi) s.push(["Durum", durumAdi]);
  if (k.tarih) s.push(["Konu tarihi", insanTarih(k.tarih + "T12:00:00", false)]);
  if (k.etiketler.length) s.push(["Etiketler", k.etiketler.join(", ")]);
  s.push(["Oluşturma", insanTarih(k.olusturma)]);
  s.push(["Son güncelleme", insanTarih(k.guncelleme)]);
  return s;
}
