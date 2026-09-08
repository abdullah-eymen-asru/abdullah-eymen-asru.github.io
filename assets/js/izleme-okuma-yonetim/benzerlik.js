/*
 * assets/js/izleme-okuma-yonetim/benzerlik.js
 *
 * İzlediklerim/Okuduklarım panosuna yeni kayıt eklerken, panoda ZATEN var
 * olan (ve belki eski/hatalı yazılmış) bir kaydı yanlışlıkla tekrar
 * eklemeyi önlemek için kullanılan BULANIK (fuzzy) başlık benzerliği
 * yardımcıları. Harici kütüphane YOK — proje ilkesi gereği (bkz.
 * asru-website mimari notları) sade/vanilla/bağımlılıksız kalıyor.
 *
 * Neden tam metin (===) ya da basit substring (includes) YETMEZ:
 * eski kayıt "Düne" ya da "Dune 2021" diye hatalı/eksik yazılmış olabilir,
 * yeni girilen "Dune (2021)" onunla harfi harfine ya da alt-dize olarak
 * eşleşmez ama AÇIKÇA aynı kayıttır. Bu yüzden:
 *   1) normallestir(): noktalama/parantez/fazla boşluk gibi "gürültüyü"
 *      atıp iki başlığı adil şekilde karşılaştırılabilir hale getirir.
 *   2) diceBenzerligi(): normalize edilmiş iki metnin 2-karakterlik
 *      (bigram) kümeleri arasındaki Sørensen–Dice katsayısını (0..1)
 *      hesaplar — küçük yazım farklarına (eksik/fazla harf, farklı sıra)
 *      Levenshtein kadar hassas ama çok daha az kod ile dayanıklıdır.
 *
 * Bu iki fonksiyon HEM "ekle" formundaki canlı yakın-kayıt uyarısında HEM
 * DE "Mevcut Kayıtlar" arama kutusunun (tam eşleşme bulamadığında düşen)
 * bulanık son çare aramasında kullanılıyor — tek bir yerde tanımlanıp iki
 * yerde de AYNI davranış garanti ediliyor (kucukHarfeCevirTr'nin site
 * genelinde tek yerden paylaşılmasıyla aynı mantık).
 */
import { kucukHarfeCevirTr } from "../core/supabase-client.js";

/**
 * Karşılaştırma için bir başlığı normalize eder: küçük harfe çevirir
 * (Türkçe kurallarına göre), parantez içini ("(2021)", "(Sezon 1)" gibi
 * ek bilgileri) atar, noktalama işaretlerini boşluğa çevirir, fazla
 * boşlukları teke indirir. Harfler ve rakamlar (Türkçe ç/ş/ğ/ü/ö/ı dahil)
 * korunur — bunlar gürültü değil, kelimenin kendisidir.
 */
export function normallestir(metin) {
  if (!metin) return "";
  let s = kucukHarfeCevirTr(String(metin)).trim();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function bigramlariCikar(normalizeMetin) {
  const bitisik = normalizeMetin.replace(/\s+/g, "");
  const bigramlar = [];
  for (let i = 0; i < bitisik.length - 1; i++) {
    bigramlar.push(bitisik.slice(i, i + 2));
  }
  return bigramlar;
}

/**
 * İki başlık arasındaki benzerliği 0 (alakasız) ile 1 (aynı) arasında
 * döner. Girdiler önce normallestir() ile temizlenir, sonra bigram
 * kümelerinin Sørensen–Dice katsayısı hesaplanır (multiset kesişimi —
 * aynı bigram iki kez geçiyorsa iki kez sayılır, bu yüzden basit bir
 * Set kesişiminden daha doğru sonuç verir).
 */
export function diceBenzerligi(a, b) {
  const na = normallestir(a);
  const nb = normallestir(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ba = bigramlariCikar(na);
  const bb = bigramlariCikar(nb);
  if (ba.length === 0 || bb.length === 0) {
    // Tek karakterlik başlıklar gibi uç durumlarda bigram çıkmaz —
    // o zaman doğrudan eşitliğe düş.
    return na === nb ? 1 : 0;
  }

  const sayac = new Map();
  bb.forEach((g) => sayac.set(g, (sayac.get(g) || 0) + 1));
  let ortak = 0;
  ba.forEach((g) => {
    const kalan = sayac.get(g) || 0;
    if (kalan > 0) {
      ortak++;
      sayac.set(g, kalan - 1);
    }
  });
  return (2 * ortak) / (ba.length + bb.length);
}

/**
 * Verilen başlığa, bir kayıt listesi (`{ title, ... }` nesneleri) içinde
 * en çok benzeyenleri bulur. `esik` altında kalanlar elenir, kalanlar
 * benzerlik oranına göre azalan sırada döner, `limit` ile sınırlanır.
 * Dönen her öge: { kayit, oran }.
 */
export function enBenzerKayitlariBul(baslik, kayitlar, esik = 0.55, limit = 3) {
  if (!baslik || !Array.isArray(kayitlar) || kayitlar.length === 0) return [];
  return kayitlar
    .map((kayit) => ({ kayit, oran: diceBenzerligi(baslik, kayit.title) }))
    .filter((x) => x.oran >= esik)
    .sort((a, b) => b.oran - a.oran)
    .slice(0, limit);
}
