/**
 * katalog-esitle.mjs — assets/js/havastil/katalog.js içindeki giysi kataloğundan Worker'daki yapay zekâ sözlüğünü (KATALOG:BASLA…BITIS) üretir.
 * Kullanım (repo kökünden):  node "cloudflare worker/havastil_worker/katalog-esitle.mjs"
 * Katalogda parça ekleyip/çıkardığında bir kez çalıştır; Worker yalnızca bilinen id'leri kabul eder (serbest metin YOK).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const kok = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { ETIKET_SOZLUGU } = await import(pathToFileURL(path.join(kok, "assets/js/havastil/katalog.js")).href);
const dosya = path.join(kok, "cloudflare worker/havastil_worker/worker.js");
let src = readFileSync(dosya, "utf8");
const satirlar = Object.entries(ETIKET_SOZLUGU).map(([id, ad]) => `  ${id}: ${JSON.stringify(ad)},`).join("\n");
const yeni = `/* KATALOG:BASLA (katalog-esitle.mjs üretir; elle düzenleme) */\nconst KATALOG_ETIKET = {\n${satirlar}\n};\n/* KATALOG:BITIS */`;
if (!/\/\* KATALOG:BASLA[\s\S]*?KATALOG:BITIS \*\//.test(src)) throw new Error("Worker'da KATALOG:BASLA/BITIS işaretleri yok.");
src = src.replace(/\/\* KATALOG:BASLA[\s\S]*?KATALOG:BITIS \*\//, yeni);
writeFileSync(dosya, src);
console.log(`Worker sözlüğü güncellendi: ${Object.keys(ETIKET_SOZLUGU).length} parça.`);
