/*
 * assets/js/donusturucu/vurgu.js — Hafif sözdizimi vurgulayıcı (bağımlılıksız). Her fonksiyon HTML-kaçışlı <span class="dn-t-*"> üretir.
 * Diller: md, json, xml (html dahil), csv, yaml, py, css, sh, sql, kod (js/ts/c-benzeri genel), duz.
 */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sp = (sinif, t) => `<span class="dn-t-${sinif}">${esc(t)}</span>`;

/** Sıralı kural tabanlı tarayıcı: ilk eşleşen kural kazanır (sticky regex). */
function tara(metin, kurallar) {
  let cikti = "";
  let i = 0;
  const n = metin.length;
  const duz = [];
  const duzBosalt = () => { if (duz.length) { cikti += esc(duz.join("")); duz.length = 0; } };
  while (i < n) {
    let eslesti = false;
    for (const [sinif, re] of kurallar) {
      re.lastIndex = i;
      const m = re.exec(metin);
      if (m && m.index === i && m[0].length) {
        duzBosalt();
        cikti += sinif ? sp(sinif, m[0]) : esc(m[0]);
        i += m[0].length;
        eslesti = true;
        break;
      }
    }
    if (!eslesti) { duz.push(metin[i]); i += 1; }
  }
  duzBosalt();
  return cikti;
}

const y = (re) => new RegExp(re, "y");

const JSON_KURAL = [
  ["anahtar", y('"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)')],
  ["dize", y('"(?:[^"\\\\\\n]|\\\\.)*"?')],
  ["sayi", y("-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?")],
  ["anahtarkelime", y("\\b(?:true|false|null)\\b")],
  ["noktalama", y("[{}\\[\\],:]")],
];

const XML_KURAL = [
  ["yorum", y("<!--[\\s\\S]*?(?:-->|$)")],
  ["meta", y("<[?!][^>]*>?")],
  ["etiket", y("</?[A-Za-z_][\\w:.-]*")],
  ["etiket", y("/?>")],
  ["oznitelik", y("[\\w:.-]+(?==)")],
  ["dize", y("\"[^\"]*\"|'[^']*'")],
  ["varlik", y("&[#\\w]+;")],
];

const CSV_KURAL = [
  ["dize", y('"(?:[^"]|"")*"?')],
  ["noktalama", y("[,;|\\t]")],
  ["sayi", y("-?\\d+(?:[.,]\\d+)?(?=[,;|\\t\\r\\n]|$)")],
];

const YAML_KURAL = [
  ["yorum", y("#[^\\n]*")],
  ["anahtar", y("^[ \\t-]*[\\w.\\-/\"']+(?=\\s*:)")],
  ["dize", y("\"(?:[^\"\\\\\\n]|\\\\.)*\"?|'[^'\\n]*'?")],
  ["sayi", y("-?\\d+(?:\\.\\d+)?\\b")],
  ["anahtarkelime", y("\\b(?:true|false|null|yes|no|on|off)\\b")],
];

const KELIME = {
  kod: "abstract async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of package private protected public return static super switch this throw true try typeof undefined var void while with yield int long float double char bool string struct union namespace using fn mut impl pub match loop go func defer select chan range",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
  css: "important",
  sh: "if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk exit set unset source",
  sql: "select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset and or not null as distinct union all primary key foreign references index view case when then else end like in between exists count sum avg min max",
};

function kodKurallari(dil) {
  const kel = new Set((KELIME[dil] || KELIME.kod).split(" "));
  const yorum = dil === "py" || dil === "sh" ? y("#[^\\n]*") : dil === "sql" ? y("--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)") : y("//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)");
  const kurallar = [
    ["yorum", yorum],
    ["dize", y("\"\"\"[\\s\\S]*?(?:\"\"\"|$)|\"(?:[^\"\\\\\\n]|\\\\.)*\"?|'(?:[^'\\\\\\n]|\\\\.)*'?|`(?:[^`\\\\]|\\\\.)*`?")],
    ["sayi", y("\\b0x[\\da-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b")],
  ];
  const kelimeRe = new RegExp(`\\b(?:${[...kel].join("|")})\\b`, dil === "sql" ? "yi" : "y");
  kurallar.push(["anahtarkelime", kelimeRe]);
  if (dil === "css") kurallar.push(["oznitelik", y("[-\\w]+(?=\\s*:)")], ["etiket", y("[.#]?[A-Za-z_][\\w-]*(?=[^{;}]*\\{)")]);
  return kurallar;
}

function mdSatirIci(s) {
  return tara(s, [
    ["kod", y("`[^`\\n]*`?")],
    ["kalin", y("\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__")],
    ["italik", y("\\*[^*\\n]+\\*|(?<![\\w])_[^_\\n]+_(?![\\w])")],
    ["baglanti", y("!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)")],
    ["etiket", y("</?[A-Za-z][^>\\n]*>")],
  ]);
}

function markdown(metin) {
  const satirlar = metin.split("\n");
  let citi = false;
  return satirlar.map((s) => {
    if (/^\s*(```|~~~)/.test(s)) { citi = !citi; return sp("kod", s); }
    if (citi) return sp("kod", s);
    let m;
    if ((m = /^(#{1,6})(\s.*)?$/.exec(s))) return sp("baslik", s);
    if (/^\s*(?:[-*_]\s*){3,}$/.test(s)) return sp("noktalama", s);
    if ((m = /^(\s*>+\s?)(.*)$/.exec(s))) return sp("noktalama", m[1]) + mdSatirIci(m[2]);
    if ((m = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(.*)$/.exec(s))) return sp("noktalama", m[1]) + mdSatirIci(m[2]);
    if (/^\s*\|.*\|\s*$/.test(s)) return tara(s, [["noktalama", y("[|:-]+")]]);
    return mdSatirIci(s);
  }).join("\n");
}

/** @param {string} dil md|json|xml|csv|yaml|py|css|sh|sql|kod|duz */
export function vurgula(dil, metin) {
  switch (dil) {
    case "md": return markdown(metin);
    case "json": return tara(metin, JSON_KURAL);
    case "xml": return tara(metin, XML_KURAL);
    case "csv": return tara(metin, CSV_KURAL);
    case "yaml": return tara(metin, YAML_KURAL.map(([s, r]) => [s, new RegExp(r.source, "ym")]));
    case "py": case "css": case "sh": case "sql": case "kod": return tara(metin, kodKurallari(dil));
    default: return esc(metin);
  }
}
