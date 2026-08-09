// Cloudflare Worker — GitHub Projects verisini ANLIK olarak çeker.
//
// Bu kod, GitHub Actions'daki scripts/fetch-projects.js ile AYNI GraphQL
// mantığını kullanır — tek fark, sonucu bir dosyaya yazmak yerine doğrudan
// HTTP cevabı olarak (JSON) döndürmesi. Token burada, Cloudflare'in kendi
// güvenli secret sisteminde saklanır — ziyaretçinin tarayıcısına ASLA gitmez.
//
// Nasıl çalışır:
//   1. Ziyaretçi izlediklerim.html'i açar
//   2. Sayfa bu Worker'a fetch() ile istek atar (örn. ?project=izleme)
//   3. Worker, GITHUB_TOKEN secret'ını kullanarak GitHub'a GraphQL sorgusu yapar
//   4. Sonucu JSON olarak ziyaretçiye döner — token hiçbir zaman görünmez
//
// Cloudflare Dashboard'da "Settings > Variables and Secrets" kısmından
// GITHUB_TOKEN adında bir secret eklemen gerekiyor (Classic PAT, "project" izniyle).

const GITHUB_LOGIN = "abdullah-eymen-asru";

// İki proje: İzleme (projects/2) ve Okuma (projects/3).
// URL'de ?project=izleme ya da ?project=okuma parametresiyle seçilir.
//
// "sutunSirasi": GitHub Projects panosunda bir VIEW içinde sütunları
// sürükleyip yer değiştirmek, o field'ların GitHub API'sindeki temel
// tanım/oluşturulma sırasını DEĞİŞTİRMEZ — bu yalnızca o view'a özel
// görsel bir ayardır ve API bunu döndürmez. Bu yüzden site normalde
// her zaman "field'ı panoya EKLEME sırasını" gösterir, view'daki
// sürükle-bırak sırasını değil.
//
// Panodaki görünümle site arasında sütun sırasının birebir eşleşmesini
// istiyorsan, o projenin GitHub'da görünen sütun adlarını SOLDAN SAĞA,
// istediğin sırayla buraya BİREBİR (büyük/küçük harf dahil) yaz. Boş
// dizi ([]) bırakırsan eski davranış (GitHub'daki field oluşturma
// sırası) kullanılmaya devam eder.
const PROJECTS = {
  izleme: { number: 2, sutunSirasi: ["Durum", "Tür", "Puan", "Sezon/Bölüm", "Başlama Tarihi", "Bitiş Tarihi"] },
  okuma: { number: 3, sutunSirasi: ["Yazar", "Okuma Durumu", "Tür", "Puan", "Sayfa Sayısı", "Başlama Tarihi", "Bitiş Tarihi"] },
};

const QUERY = `
query($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) {
    projectV2(number: $number) {
      title
      fields(first: 50) {
        nodes {
          ... on ProjectV2Field { name }
          ... on ProjectV2SingleSelectField { name }
        }
      }
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

// GitHub, bir Issue'yu Projects panosuna eklediğinde onunla birlikte
// GitHub'ın KENDİ yerleşik (built-in) sistem alanlarını da otomatik olarak
// panonun field listesine ekler — bunlar senin oluşturduğun custom field'lar
// (Tür, Puan, Durum, Yazar, Sezon/Bölüm vs.) DEĞİLDİR ve neredeyse her zaman
// boştur, çünkü bu site issue'ları görev takibi için değil, film/kitap
// kataloğu için kullanıyor. Bu yüzden hepsi tabloda gösterilmeden eleniyor.
// "Title" ve "Status" ayrıca content.title ile ve senin kendi "Durum"
// alanınla karışmasın diye burada tutuluyor.
const YERLESIK_ALANLAR = new Set([
  "Title",
  "Status",
  "Assignees",
  "Labels",
  "Linked pull requests",
  "Milestone",
  "Repository",
  "Reviewers",
  "Parent issue",
  "Sub-issues progress",
  "Created",
  "Updated",
  "Closed",
]);

function fieldValuesToObject(fieldValues) {
  const obj = {};
  for (const fv of fieldValues.nodes) {
    if (!fv || !fv.field || !fv.field.name) continue;
    const key = fv.field.name;
    if (YERLESIK_ALANLAR.has(key)) continue;

    if (fv.text !== undefined) obj[key] = fv.text;
    else if (fv.number !== undefined) obj[key] = fv.number;
    else if (fv.date !== undefined) obj[key] = fv.date;
    else if (fv.name !== undefined) obj[key] = fv.name;
  }
  return obj;
}

async function graphqlRequest(token, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "portfolyo-site-worker",
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API hatası: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error("GraphQL hatası: " + JSON.stringify(json.errors));
  }
  return json.data;
}

async function fetchAllItems(token, projectNumber, manuelSutunSirasi) {
  let items = [];
  let cursor = null;
  let hasNextPage = true;
  let projectTitle = "";
  let fieldOrder = []; // GitHub Projects'teki sütun sırasının aynısı

  while (hasNextPage) {
    const data = await graphqlRequest(token, {
      login: GITHUB_LOGIN,
      number: projectNumber,
      cursor,
    });

    const project = data.user.projectV2;
    if (!project) {
      throw new Error(`Proje bulunamadı: number=${projectNumber}`);
    }

    projectTitle = project.title;

    // Field sırasını SADECE ilk sayfada topluyoruz (her sayfada aynı, tekrar
    // toplamaya gerek yok). "Title" ve "Status" burada da eleniyor çünkü
    // fieldValuesToObject de onları eliyor — tutarlı kalmalı.
    //
    // Eğer PROJECTS içinde bu proje için elle bir "sutunSirasi" tanımlıysa
    // (boş olmayan bir dizi), GitHub'ın field oluşturma sırası yerine
    // BUNU kullanıyoruz — sitede panodaki view sırasıyla birebir eşleşsin
    // diye. Listede olmayan ama panoda var olan bir field varsa (örn.
    // sonradan eklenmiş yeni bir custom field), o da listenin sonuna
    // otomatik eklenir; hiçbir alan sessizce kaybolmaz.
    if (fieldOrder.length === 0) {
      const gercekFieldler = project.fields.nodes
        .filter(f => f && f.name && !YERLESIK_ALANLAR.has(f.name))
        .map(f => f.name);

      if (Array.isArray(manuelSutunSirasi) && manuelSutunSirasi.length > 0) {
        const eklenenler = new Set();
        fieldOrder = manuelSutunSirasi.filter(ad => gercekFieldler.includes(ad));
        fieldOrder.forEach(ad => eklenenler.add(ad));
        gercekFieldler.forEach(ad => {
          if (!eklenenler.has(ad)) fieldOrder.push(ad);
        });
      } else {
        fieldOrder = gercekFieldler;
      }
    }

    const pageItems = project.items.nodes
      .filter(node => node.content)
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

  return { projectTitle, items, fieldOrder };
}

// Cloudflare Worker'ın giriş noktası — her HTTP isteğinde bu çalışır.
export default {
  async fetch(request, env, ctx) {
    // CORS: GitHub Pages'teki sitenden bu Worker'a istek atılabilmesi için
    // gerekli izin başlıkları. "*" herkese izin verir — bu Worker sadece
    // OKUMA yaptığı (yazma/silme yapmadığı), kimlik doğrulama/cookie
    // kullanmadığı ve döndürdüğü veri zaten herkese açık (film/kitap
    // listesi) olduğu için bunun bir sakıncası yok.
    //
    // X-Content-Type-Options: tarayıcının Content-Type header'ını görmezden
    // gelip içeriği "koklayarak" (sniffing) farklı yorumlamasını engeller —
    // ekstra bir MIME-sniffing tabanlı saldırı yüzeyi kapatılıyor.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
    };

    // Tarayıcılar bazı isteklerden önce "preflight" (OPTIONS) isteği atar,
    // buna boş ama izinli bir cevap vermemiz gerekiyor.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const projectKey = url.searchParams.get("project"); // "izleme" ya da "okuma"

    const projectConfig = PROJECTS[projectKey];
    if (!projectConfig) {
      // Parametre hiç verilmemiş ya da yanlışsa: çıplak bir JSON hatası yerine,
      // bu adrese doğrudan girenler için (örn. tarayıcıdan test ederken) daha
      // anlaşılır, HTML bir bilgi sayfası döndürüyoruz. Site zaten her zaman
      // ?project=izleme veya ?project=okuma ile geldiği için ziyaretçi bu
      // sayfayı normal kullanımda hiç görmez.
      const bilgiSayfasi = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>İzleme/Okuma API</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 560px; margin: 60px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
    a { color: #2b5797; }
  </style>
</head>
<body>
  <h1>Bu bir API adresidir</h1>
  <p>
    Bu Worker, portfolyo sitesindeki İzlediklerim/Okuduklarım tablolarını
    beslemek için kullanılır. Doğrudan tarayıcıdan görüntülenmek üzere
    tasarlanmadı.
  </p>
  <p>Geçerli kullanım şekli:</p>
  <ul>
    <li><code>${url.origin}?project=izleme</code></li>
    <li><code>${url.origin}?project=okuma</code></li>
  </ul>
  <p><a href="https://abdullah-eymen-asru.github.io">← Portfolyo sitesine dön</a></p>
</body>
</html>`;

      return new Response(bilgiSayfasi, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=UTF-8", ...corsHeaders },
      });
    }

    if (!env.GITHUB_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Sunucu yapılandırma hatası: GITHUB_TOKEN secret'ı tanımlı değil." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // GÜVENLİK / DAYANIKLILIK: Bu Worker'a gelen her istek GitHub API'sine
    // Bearer token ile bir GraphQL isteği yapıyor. Sınırsız/art arda istek
    // atılırsa (kasıtlı ya da kasıtsız) GITHUB_TOKEN'ın GitHub tarafındaki
    // rate limiti hızla tükenebilir ve site geçici olarak veri gösteremez
    // hale gelebilir. Cloudflare'in kendi edge cache'ini (caches.default)
    // KULLANARAK aynı ?project= isteğini 60 saniye boyunca GitHub'a hiç
    // gitmeden, önbellekten cevaplıyoruz — bu hem performansı artırır hem
    // de rate-limit tüketme saldırılarına karşı gerçek bir koruma sağlar
    // (önceden sadece tarayıcıya öneri niteliğinde bir Cache-Control
    // header'ı gönderiliyordu, edge'de fiilen önbelleğe alınmıyordu).
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const { projectTitle, items, fieldOrder } = await fetchAllItems(env.GITHUB_TOKEN, projectConfig.number, projectConfig.sutunSirasi);

      const payload = {
        generatedAt: new Date().toISOString(),
        projectTitle,
        count: items.length,
        fieldOrder,
        items,
      };

      const response = new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          ...corsHeaders,
        },
      });

      // Cevabı edge cache'e yaz (arka planda, isteği yavaşlatmadan).
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    } catch (err) {
      // GÜVENLİK: GitHub API'sinden veya GraphQL'den gelen ham hata mesajını
      // (err.message) DOĞRUDAN ziyaretçiye döndürmüyoruz. Bu mesaj bazen
      // GitHub'ın iç sorgu yapısı, token izin/scope detayları veya başka
      // teşhis bilgisi içerebilir — bunları dışarı sızdırmak saldırgana
      // fazladan bilgi (reconnaissance) sağlar. Teşhis için Worker'ın kendi
      // loglarına (Cloudflare Dashboard > Logs) yazıyoruz, ziyaretçiye ise
      // sabit, genel bir mesaj dönüyoruz.
      console.error("Worker hatası:", err);
      return new Response(
        JSON.stringify({ error: "Veri şu anda alınamadı. Lütfen daha sonra tekrar dene." }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
};
