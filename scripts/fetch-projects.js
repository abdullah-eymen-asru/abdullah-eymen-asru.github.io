// scripts/fetch-projects.js
//
// Bu script GitHub Actions üzerinde (build-time) çalışır, tarayıcıda ÇALIŞMAZ.
// GitHub Projects (v2) panolarındaki tüm satırları ve custom field'ları
// GraphQL API üzerinden çeker, sitenin okuyacağı temiz JSON dosyalarına yazar.
//
// Neden dinamik field parse ediyoruz:
// Projede yeni bir sütun (custom field) eklediğinde bu script'e HİÇ dokunmana
// gerek kalmasın diye, "Tür", "Puan" gibi alan isimlerini kodun içine sabit
// yazmıyoruz. Onun yerine GraphQL'den gelen fieldValues listesini olduğu gibi
// geziyor, her field'ın adını ve değerini kendi tipine göre (metin, sayı,
// tarih, seçenek listesi) otomatik ayrıştırıp bir JS objesine döküyoruz.

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.PROJECTS_TOKEN;
const GITHUB_LOGIN = process.env.GITHUB_LOGIN || "abdullah-eymen-asru";

if (!TOKEN) {
  console.error("HATA: PROJECTS_TOKEN ortam değişkeni bulunamadı. Bu script sadece GitHub Actions içinde, secret tanımlıyken çalışır.");
  process.exit(1);
}

// İki proje: İzleme (projects/2) ve Okuma (projects/3)
const PROJECTS = [
  { number: 2, outputFile: "izlenenler.json" },
  { number: 3, outputFile: "okunanlar.json" },
];

// Tek bir GraphQL sorgusu — ProjectV2'nin item'larını, her item'ın tüm
// fieldValues'ini (hangi tip olursa olsun) çeker. "... on X" sözdizimi
// GraphQL'in "union type" (birleşik tip) sorgulama yöntemi: bir field
// metin mi, sayı mı, tarih mi, tekli seçim mi olabilir — hangisiyse
// o bloktan veri gelir, diğerleri boş kalır.
const QUERY = `
query($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) {
    projectV2(number: $number) {
      title
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on DraftIssue { title }
            ... on Issue {
              title
              url
              state
            }
          }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

async function graphqlRequest(variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "portfolyo-site-build-script",
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API hatası: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error("GraphQL hatası: " + JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

// Bir item'ın fieldValues listesini { "Tür": "Roman", "Puan": 8, ... }
// şeklinde düz bir objeye çevirir. Field tipine göre doğru değeri seçer.
// Bu fonksiyon hangi field isimlerinin var olduğunu HİÇ bilmiyor — GraphQL'den
// ne gelirse onu işliyor. Yeni bir sütun eklediğinde otomatik yakalanır.
//
// "Title" ve "Status" alanlarını dışarıda bırakıyoruz: GitHub Projects'te
// her item'ın yerleşik "Title" ve "Status" (Todo/In Progress/Done gibi)
// field'ları vardır. "Title" bizim zaten ayrı tuttuğumuz content.title ile
// aynı bilgiyi tekrarlar. "Status" da GitHub'ın kendi iş akışı alanı —
// senin kendi tanımladığın "Durum" custom field'ından FARKLI bir şeydir.
const YERLESIK_ALANLAR = new Set(["Title", "Status"]);

function fieldValuesToObject(fieldValues) {
  const obj = {};
  for (const fv of fieldValues.nodes) {
    if (!fv || !fv.field || !fv.field.name) continue;
    const key = fv.field.name;
    if (YERLESIK_ALANLAR.has(key)) continue;

    if (fv.text !== undefined) obj[key] = fv.text;
    else if (fv.number !== undefined) obj[key] = fv.number;
    else if (fv.date !== undefined) obj[key] = fv.date;
    else if (fv.name !== undefined) obj[key] = fv.name; // single-select
  }
  return obj;
}

async function fetchAllItems(projectNumber) {
  let items = [];
  let cursor = null;
  let hasNextPage = true;
  let projectTitle = "";

  while (hasNextPage) {
    const data = await graphqlRequest({
      login: GITHUB_LOGIN,
      number: projectNumber,
      cursor,
    });

    const project = data.user.projectV2;
    if (!project) {
      throw new Error(`Proje bulunamadı: number=${projectNumber}. Proje numarasını ve token yetkisini kontrol et.`);
    }

    projectTitle = project.title;
    const pageItems = project.items.nodes
      .filter(node => node.content) // içeriği silinmiş/boş satırları atla
      .map(node => {
        const fields = fieldValuesToObject(node.fieldValues);
        return {
          id: node.id,
          title: node.content.title || "(başlıksız)",
          url: node.content.url || null,
          state: node.content.state || null,
          ...fields,
        };
      });

    items = items.concat(pageItems);
    hasNextPage = project.items.pageInfo.hasNextPage;
    cursor = project.items.pageInfo.endCursor;
  }

  return { projectTitle, items };
}

async function main() {
  const outDir = path.join(__dirname, "..", "assets", "data");
  fs.mkdirSync(outDir, { recursive: true });

  let hadError = false;

  for (const proj of PROJECTS) {
    console.log(`Çekiliyor: proje #${proj.number} (${proj.outputFile})...`);
    try {
      const { projectTitle, items } = await fetchAllItems(proj.number);

      const payload = {
        generatedAt: new Date().toISOString(),
        projectTitle,
        count: items.length,
        items,
      };

      const outPath = path.join(outDir, proj.outputFile);
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
      console.log(`  ✓ ${items.length} kayıt yazıldı: ${outPath}`);
    } catch (err) {
      console.error(`  ✗ Proje #${proj.number} çekilemedi:`, err.message);
      hadError = true; // hata olsa bile diğer projeyi denemeye devam et
    }
  }

  if (hadError) process.exitCode = 1;
}

main();
