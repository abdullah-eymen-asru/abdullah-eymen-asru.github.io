// Cloudflare Worker — İzlediklerim/Okuduklarım panosuna YAZMA (yeni kayıt
// ekleme, arama, güncelleme) yetkisi verir. `izleme_okuma_worker/worker.js`
// ile KARIŞTIRMA: o Worker sadece OKUR (herkese açık, siteyi besler) ve
// GITHUB_TOKEN'ı "project" okuma izniyle yeterlidir. BU Worker ise GERÇEK
// bir yazma işlemi yapar (yeni issue açar, panoya ekler, alanlarını
// doldurur, mevcut kayıtları arayıp günceller), bu yüzden:
//
//   1) SADECE 'owner' (Site Sahibi) rolüne izin verir — editor/manager/admin
//      bile DAHİL DEĞİLDİR (github_icerik_yonetim_worker'daki gibi geniş bir
//      "içerik yöneticisi" kümesi burada BİLİNÇLİ OLARAK kullanılmıyor,
//      çünkü bu panonun içeriği site sahibinin KİŞİSEL izleme/okuma
//      kaydıdır, bir editöre devredilebilecek bir "site içeriği" değildir).
//   2) GITHUB_TOKEN'ın bu repo için "Issues: Read and write" ve
//      "Projects: Read and write" (Classic PAT ise "repo" + "project")
//      izinlerine ihtiyacı vardır — izleme_okuma_worker'ınkinden DAHA
//      GENİŞ bir izin seti. Bu yüzden İKİ Worker'ın secret'ını AYNI PAT
//      olarak paylaşmak yerine ayrı bir PAT kullanman önerilir (en az
//      ayrıcalık ilkesi — okuma Worker'ı asla yazma yapamamalı).
//
// Nasıl çalışır (bkz. panel/izleme-okuma-yonetim.md +
// assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js):
//   1. Owner, panelde formu doldurup gönderir.
//   2. Sayfa bu Worker'a kendi Supabase oturum token'ını Authorization
//      header'ında göndererek POST atar.
//   3. Worker: (a) token'ı Supabase'te doğrular, (b) rolün 'owner' olduğunu
//      kontrol eder, (c) GitHub'da yeni bir Issue açar (başlık + açıklama),
//      (d) o Issue'yu ilgili Projects panosuna (izleme=2, okuma=3) ekler,
//      (e) formda doldurulan alanları (Durum, Tür, Puan, ... ) panodaki
//      ilgili custom field'lara yazar.
//   4. Sonuç JSON olarak panele döner; PAT hiçbir zaman tarayıcıya gitmez.
//
// UÇ NOKTALAR:
//   GET  /alanlar?project=izleme|okuma        -> panodaki field tanımları
//   GET  /liste?project=...&q=...&sayfa=1     -> mevcut issue'ları ara/listele
//   GET  /kayit/:number?project=...           -> tek bir kaydın güncel alan değerleri
//   POST /kayit-ekle                          -> yeni issue aç + panoya ekle + alan doldur
//   POST /kayit-guncelle                      -> mevcut issue'nun başlık/açıklama/alanlarını güncelle

const GITHUB_LOGIN = "abdullah-eymen-asru";
const REPO_OWNER = "abdullah-eymen-asru";
const REPO_NAME = "izleme-okuma-listem";

// İki proje + her birine atanan label. Kullanıcı bu repoda issue'ları
// "izleme" ve "okuma" diye iki ayrı label ile ayırıp yönetiyor — bu Worker
// da yeni issue'yu AÇARKEN aynı label'ı otomatik ekler, panel tarafında
// ayrıca elle işaretlemeye gerek kalmaz.
const PROJECTS = {
  izleme: { number: 2, label: "izleme" },
  okuma: { number: 3, label: "okuma" },
};

// Panelin yazabildiği/gösterebildiği TEK field tipleri bunlar. GitHub'ın
// "yerleşik" (built-in) alanları — Assignees, Labels, Reviewers, Milestone,
// Repository, Linked pull requests, Parent issue, Sub-issues progress,
// Created/Updated/Closed (tarih meta verisi), Title vb. — updateProjectV2ItemFieldValue
// mutasyonu ile YAZILAMAZ (GitHub bunları "currently not supported"
// hatasıyla reddeder) ve/veya tamamen farklı bir API gerektirir (ör.
// Assignees issue'nun kendisine, addAssigneesToAssignable ile atanır). Bu
// yüzden hem form kurulumunda (/alanlar) hem de değer yazarken
// (alanlariDoldur) SADECE bu 4 dataType'a izin veriyoruz — isim bazlı bir
// kara liste tutmak yerine (kırılgan: kullanıcı özel bir alana "Milestone"
// adını verirse ya da GitHub yeni bir yerleşik tip eklerse çalışmaz), TİP
// bazlı bir beyaz liste kullanmak GitHub'ın API'sinin kendi
// sınıflandırmasına dayandığı için çok daha güvenilir.
const YAZILABILIR_DATATYPE_SETI = new Set(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT"]);

const corsHeadersOlustur = (origin) => {
  const allowedOrigins = [
    "https://abdullah-eymen-asru.github.io",
    "https://abdullah-eymen-asru.pages.dev",
    "http://localhost:4000",
    "http://127.0.0.1:5500",
  ];
  // GÜVENLİK: github_icerik_yonetim_worker'daki AYNI kural — TAM (===)
  // eşleşme şart, startsWith/includes ile önek/parça eşleşmesi YOK. Bu
  // Worker da gerçek bir GitHub yazma yetkisi verdiği için aynı titizlik
  // gerekiyor.
  const isAllowed = allowedOrigins.includes(origin);
  return {
    headers: {
      "Access-Control-Allow-Origin": isAllowed ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    },
    isAllowed,
  };
};

function jsonYanit(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function githubGraphql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "portfolyo-site-izleme-okuma-yonetim-worker",
    },
    body: JSON.stringify({ query, variables }),
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

async function githubRest(token, path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "portfolyo-site-izleme-okuma-yonetim-worker",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const bodyText = await res.text();
  const body = bodyText ? JSON.parse(bodyText) : null;
  if (!res.ok) {
    const mesaj = body?.message || `GitHub REST hatası: ${res.status}`;
    throw new Error(mesaj);
  }
  return body;
}

// Bir repoda verilen isimde bir label var mı diye bakar, yoksa oluşturur.
// Kullanıcı zaten "izleme"/"okuma" adında iki label'ı elle oluşturmuş
// olabilir — bu durumda var olanı bozmadan sadece kullanır. Yoksa (ör.
// repo daha yeni kurulduysa) makul bir renkle otomatik oluşturur.
async function labelGarantiEt(token, labelAdi) {
  try {
    await githubRest(token, `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(labelAdi)}`);
    return; // zaten var
  } catch (_err) {
    // yok say, aşağıda oluşturmayı dene
  }
  try {
    await githubRest(token, `/repos/${REPO_OWNER}/${REPO_NAME}/labels`, {
      method: "POST",
      body: JSON.stringify({
        name: labelAdi,
        color: labelAdi === "izleme" ? "1f6feb" : "8250df",
        description: labelAdi === "izleme" ? "İzlediklerim panosu kaydı" : "Okuduklarım panosu kaydı",
      }),
    });
  } catch (_err) {
    // Yarış durumu (aynı anda oluşturulmuş olabilir) ya da izin sorunu —
    // issue açma işlemini bu yüzden durdurmuyoruz, label olmadan da issue
    // açılabilir; sadece etiketlenmemiş kalır.
  }
}

// Projenin node ID'sini + tüm field'larını (id, ad, tip, single-select
// seçenekleri) tek sorguda getirir. Bu bilgi olmadan updateProjectV2ItemFieldValue
// çağrısı yapılamaz — GraphQL, field'ı isimle değil ID ile ister.
const PROJE_FIELDS_QUERY = `
query($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name }
          }
        }
      }
    }
  }
}
`;

async function projeBilgisiGetir(token, projectNumber) {
  const data = await githubGraphql(token, PROJE_FIELDS_QUERY, {
    login: GITHUB_LOGIN,
    number: projectNumber,
  });
  const project = data.user?.projectV2;
  if (!project) throw new Error(`Proje bulunamadı: number=${projectNumber}`);
  return project;
}

const CREATE_ISSUE_MUTATION = `
mutation($repositoryId: ID!, $title: String!, $body: String, $labelIds: [ID!]) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, labelIds: $labelIds }) {
    issue { id number url }
  }
}
`;

const ADD_ITEM_MUTATION = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}
`;

const SET_TEXT_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { text: $text } }) {
    projectV2Item { id }
  }
}
`;

const SET_NUMBER_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { number: $number } }) {
    projectV2Item { id }
  }
}
`;

const SET_DATE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { date: $date } }) {
    projectV2Item { id }
  }
}
`;

const SET_SINGLE_SELECT_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) {
    projectV2Item { id }
  }
}
`;

// Bir single-select alana YENİ bir seçenek ekler. GitHub'ın API'si
// (updateProjectV2SingleSelectField) bir "ekle" mutasyonu SUNMUYOR —
// alanın TÜM seçenek listesini olduğu gibi geri gönderip sonuna yeni
// seçeneği eklemen gerekiyor, yoksa var olan seçenekler silinir. Bu
// yüzden `mevcutSecenekler`i (id+name+color) olduğu gibi koruyup sadece
// sona bir tane daha ekliyoruz. Renk için basit, döngüsel bir palet
// kullanılıyor — GitHub'ın renk zorunluluğu var ama hangi renk olduğu
// önemli değil, panelin kendisi renk göstermiyor.
const RENK_PALETI = ["GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE"];

const ADD_SINGLE_SELECT_OPTION_MUTATION = `
mutation($projectId: ID!, $fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2SingleSelectField(input: { projectId: $projectId, fieldId: $fieldId, options: $options }) {
    projectV2SingleSelectField { id name options { id name } }
  }
}
`;

async function tekSecimAlaninaYeniSecenekEkle(token, projectDbId, field, yeniSecenekAdi) {
  const mevcutSecenekler = (field.options || []).map((o, i) => ({
    name: o.name,
    color: RENK_PALETI[i % RENK_PALETI.length],
    description: "",
  }));
  // Yarış/tekrar durumunda aynı isimde ikinci bir seçenek oluşturmayalım.
  const zatenVarMi = mevcutSecenekler.find((o) => o.name === yeniSecenekAdi);
  if (zatenVarMi) return field.options.find((o) => o.name === yeniSecenekAdi);

  const guncelListe = [
    ...mevcutSecenekler,
    { name: yeniSecenekAdi, color: RENK_PALETI[mevcutSecenekler.length % RENK_PALETI.length], description: "" },
  ];
  const data = await githubGraphql(token, ADD_SINGLE_SELECT_OPTION_MUTATION, {
    projectId: projectDbId,
    fieldId: field.id,
    options: guncelListe,
  });
  const guncelField = data.updateProjectV2SingleSelectField.projectV2SingleSelectField;
  // field.options'ı da bellekte güncelle ki aynı istekte aynı alana ikinci
  // bir yeni seçenek daha eklenirse (teoride olası değil ama savunma
  // amaçlı) tekrar API'ye gitmeden bulunabilsin.
  field.options = guncelField.options;
  return guncelField.options.find((o) => o.name === yeniSecenekAdi);
}

// `alanlar`: panelden gelen { "Durum": "İzleniyor", "Puan": 7, ... } gibi
// düz bir obje. Her anahtar projedeki field adıyla BİREBİR eşleşmeli
// (panel formu bu adları projeBilgisiGetir() sonucundan zaten dinamik
// olarak üretiyor, bkz. ilgili JS). Tip (text/number/date/singleSelect)
// projenin kendi field tanımından okunuyor — panel tarafında ayrıca tip
// belirtmeye gerek yok. Single-select bir alan için değer "__yeni__:<isim>"
// formatındaysa (bkz. panelin "+ Yeni seçenek ekle" seçeneği), önce panoya
// yeni bir seçenek eklenir, sonra o seçenek kayda uygulanır.
async function alanlariDoldur(token, project, projectDbId, itemId, alanlar) {
  const sonuclar = [];
  for (const [alanAdi, ham] of Object.entries(alanlar)) {
    if (ham === undefined || ham === null || ham === "") continue;
    const field = project.fields.nodes.find((f) => f && f.name === alanAdi);
    if (!field) {
      sonuclar.push({ alan: alanAdi, basarili: false, hata: "Panoda bu isimde bir alan yok." });
      continue;
    }
    if (!YAZILABILIR_DATATYPE_SETI.has(field.dataType)) {
      // Savunma amaçlı ikinci kontrol — /alanlar zaten bu tipleri forma
      // hiç koymuyor, ama panelin gönderdiği isteğe güvenmek yerine burada
      // da doğruluyoruz (bkz. YAZILABILIR_DATATYPE_SETI tanımındaki not).
      sonuclar.push({ alan: alanAdi, basarili: false, hata: "Bu alan türü (" + field.dataType + ") panel üzerinden yazılamıyor." });
      continue;
    }
    try {
      if (field.dataType === "SINGLE_SELECT") {
        const YENI_SECENEK_ONEKI = "__yeni__:";
        let secenek;
        if (typeof ham === "string" && ham.startsWith(YENI_SECENEK_ONEKI)) {
          const yeniAd = ham.slice(YENI_SECENEK_ONEKI.length).trim();
          if (!yeniAd) {
            sonuclar.push({ alan: alanAdi, basarili: false, hata: "Yeni seçenek adı boş olamaz." });
            continue;
          }
          secenek = await tekSecimAlaninaYeniSecenekEkle(token, projectDbId, field, yeniAd);
        } else {
          secenek = field.options?.find((o) => o.name === ham);
        }
        if (!secenek) {
          sonuclar.push({ alan: alanAdi, basarili: false, hata: `"${ham}" seçeneği panoda tanımlı değil.` });
          continue;
        }
        await githubGraphql(token, SET_SINGLE_SELECT_MUTATION, {
          projectId: projectDbId,
          itemId,
          fieldId: field.id,
          optionId: secenek.id,
        });
      } else if (field.dataType === "NUMBER") {
        await githubGraphql(token, SET_NUMBER_MUTATION, {
          projectId: projectDbId,
          itemId,
          fieldId: field.id,
          number: Number(ham),
        });
      } else if (field.dataType === "DATE") {
        await githubGraphql(token, SET_DATE_MUTATION, {
          projectId: projectDbId,
          itemId,
          fieldId: field.id,
          date: ham,
        });
      } else {
        await githubGraphql(token, SET_TEXT_MUTATION, {
          projectId: projectDbId,
          itemId,
          fieldId: field.id,
          text: String(ham),
        });
      }
      sonuclar.push({ alan: alanAdi, basarili: true });
    } catch (err) {
      sonuclar.push({ alan: alanAdi, basarili: false, hata: err.message });
    }
  }
  return sonuclar;
}

// ---- ARAMA / LİSTELEME / TEKİL KAYIT OKUMA ----
//
// Not: Bu Worker'ın OKUMA amacıyla `izleme_okuma_worker/worker.js`'i
// (herkese açık, salt okuma) TEKRAR KULLANMASI yerine burada AYRI, kendi
// GraphQL sorgusu var — çünkü panelin ihtiyacı FARKLI: (a) issue'nun kendi
// numarası + açıklaması (body) da lazım (herkese açık Worker'da bu YOK,
// çünkü site sadece "Title"ı gösteriyor), (b) sonucun panoda GÖRÜNMEYEN
// (henüz projeye eklenmemiş) issue'ları da kapsaması gerekebilir — ama bu
// ilk sürümde basitlik için SADECE panoya eklenmiş item'lar listeleniyor,
// tıpkı herkese açık tabloda olduğu gibi.
const PROJE_ITEMS_QUERY = `
query($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) {
    projectV2(number: $number) {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue { number title url body state }
          }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}
`;

function fieldValuesToObject(fieldValues) {
  const obj = {};
  for (const fv of fieldValues.nodes) {
    if (!fv || !fv.field || !fv.field.name) continue;
    const key = fv.field.name;
    if (fv.text !== undefined) obj[key] = fv.text;
    else if (fv.number !== undefined) obj[key] = fv.number;
    else if (fv.date !== undefined) obj[key] = fv.date;
    else if (fv.name !== undefined) obj[key] = fv.name;
  }
  return obj;
}

// Projedeki TÜM item'ları (issue + alan değerleri) çeker — sayfalama
// dahil. Küçük/orta ölçekli bir kişisel koleksiyon için (yüzlerce kayıt)
// bu maliyetsiz; binlerce kayda çıkarsa ileride sunucu taraflı arama
// (GitHub'ın `search` sorgusu) tercih edilebilir.
async function projeItemleriGetir(token, projectNumber) {
  let items = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await githubGraphql(token, PROJE_ITEMS_QUERY, {
      login: GITHUB_LOGIN,
      number: projectNumber,
      cursor,
    });
    const project = data.user?.projectV2;
    if (!project) throw new Error(`Proje bulunamadı: number=${projectNumber}`);
    const sayfaItems = project.items.nodes
      .filter((node) => node.content)
      .map((node) => ({
        itemId: node.id,
        number: node.content.number,
        title: node.content.title,
        url: node.content.url,
        body: node.content.body || "",
        state: node.content.state,
        alanlar: fieldValuesToObject(node.fieldValues),
      }));
    items = items.concat(sayfaItems);
    hasNextPage = project.items.pageInfo.hasNextPage;
    cursor = project.items.pageInfo.endCursor;
  }
  return items;
}

const UPDATE_ISSUE_MUTATION = `
mutation($issueId: ID!, $title: String, $body: String) {
  updateIssue(input: { id: $issueId, title: $title, body: $body }) {
    issue { id number title body url }
  }
}
`;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const { headers: corsHeaders, isAllowed } = corsHeadersOlustur(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!isAllowed && origin !== "") {
      return jsonYanit(
        { message: "Erişim reddedildi: Yetkisiz Origin.", alinanOrigin: origin },
        403,
        corsHeaders
      );
    }

    if (!env.GITHUB_TOKEN) {
      return jsonYanit({ message: "Sunucu yapılandırma hatası: GITHUB_TOKEN tanımlı değil." }, 500, corsHeaders);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonYanit({ message: "Sunucu yapılandırma hatası: Supabase ortam değişkenleri eksik." }, 500, corsHeaders);
    }

    // 1) Supabase JWT doğrulama — github_icerik_yonetim_worker ile AYNI teknik.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonYanit({ message: "Bu işlem için giriş yapmalısın." }, 401, corsHeaders);
    }
    const token = authHeader.split(" ")[1];
    let userId = null;
    try {
      const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
      });
      if (!userRes.ok) throw new Error("Geçersiz veya süresi dolmuş oturum.");
      const userData = await userRes.json();
      userId = userData.id;
    } catch (err) {
      return jsonYanit({ message: "Oturum doğrulanamadı: " + err.message }, 401, corsHeaders);
    }

    // 2) ROL KONTROLÜ — SADECE 'owner'. Dosya başındaki mimari notuna bak:
    //    bu, github_icerik_yonetim_worker'dan FARKLI ve KASITLI olarak dar
    //    bir kural — editor/manager/admin bu Worker'a hiç giremez.
    let rol = null;
    try {
      const profilRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      const profilData = profilRes.ok ? await profilRes.json() : [];
      rol = profilData?.[0]?.role || null;
    } catch (_err) {
      return jsonYanit({ message: "Rol bilgisi okunamadı." }, 500, corsHeaders);
    }
    if (rol !== "owner") {
      return jsonYanit({ message: "Bu işlem sadece Site Sahibi (owner) tarafından yapılabilir." }, 403, corsHeaders);
    }

    const url = new URL(request.url);

    // GET /alanlar?project=izleme|okuma — panelin formu dinamik olarak
    // kurabilmesi için projedeki field adlarını/tiplerini/seçeneklerini
    // döner (yazma yapmaz, sadece okur). SADECE panelin yazabildiği 4
    // dataType (TEXT/NUMBER/DATE/SINGLE_SELECT) döner — Assignees, Labels,
    // Reviewers, Milestone, Repository gibi GitHub'ın yerleşik alanları
    // (updateProjectV2ItemFieldValue ile yazılamadıkları için) forma hiç
    // girmez, bkz. YAZILABILIR_DATATYPE_SETI tanımının üstündeki not.
    if (request.method === "GET" && url.pathname === "/alanlar") {
      const projectKey = url.searchParams.get("project");
      const projectConfig = PROJECTS[projectKey];
      if (!projectConfig) return jsonYanit({ message: "Geçersiz 'project' parametresi." }, 400, corsHeaders);
      try {
        const project = await projeBilgisiGetir(env.GITHUB_TOKEN, projectConfig.number);
        const fields = project.fields.nodes
          .filter((f) => f && f.name && f.name !== "Title" && YAZILABILIR_DATATYPE_SETI.has(f.dataType))
          .map((f) => ({
            name: f.name,
            dataType: f.dataType,
            options: f.dataType === "SINGLE_SELECT" ? (f.options || []).map((o) => o.name) : undefined,
          }));
        return jsonYanit({ fields }, 200, corsHeaders);
      } catch (err) {
        console.error("Worker hatası (/alanlar):", err);
        return jsonYanit({ message: "Alan bilgisi alınamadı." }, 502, corsHeaders);
      }
    }

    // POST /kayit-ekle — asıl işlem: issue oluştur + panoya ekle + alanları doldur.
    if (request.method === "POST" && url.pathname === "/kayit-ekle") {
      let body;
      try {
        body = await request.json();
      } catch (_err) {
        return jsonYanit({ message: "Geçersiz istek gövdesi (JSON bekleniyor)." }, 400, corsHeaders);
      }

      const { project: projectKey, title, aciklama, alanlar } = body || {};
      const projectConfig = PROJECTS[projectKey];
      if (!projectConfig) {
        return jsonYanit({ message: "Geçersiz 'project' değeri (izleme|okuma bekleniyor)." }, 400, corsHeaders);
      }
      if (!title || typeof title !== "string" || !title.trim()) {
        return jsonYanit({ message: "Başlık zorunludur." }, 400, corsHeaders);
      }

      try {
        // a) Repo node ID'sini al (issue oluşturmak için gerekli).
        const repoData = await githubGraphql(
          env.GITHUB_TOKEN,
          `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }`,
          { owner: REPO_OWNER, name: REPO_NAME }
        );
        const repositoryId = repoData.repository?.id;
        if (!repositoryId) throw new Error("Repo bulunamadı: " + REPO_OWNER + "/" + REPO_NAME);

        // b) Label'ın var olduğundan emin ol, id'sini al.
        await labelGarantiEt(env.GITHUB_TOKEN, projectConfig.label);
        let labelIds;
        try {
          const labelData = await githubGraphql(
            env.GITHUB_TOKEN,
            `query($owner: String!, $name: String!, $label: String!) {
              repository(owner: $owner, name: $name) { label(name: $label) { id } }
            }`,
            { owner: REPO_OWNER, name: REPO_NAME, label: projectConfig.label }
          );
          const labelId = labelData.repository?.label?.id;
          labelIds = labelId ? [labelId] : undefined;
        } catch (_err) {
          labelIds = undefined; // label alınamazsa issue'yu etiketsiz açmaya devam et
        }

        // c) Issue'yu oluştur (açıklama/body opsiyonel).
        const issueData = await githubGraphql(env.GITHUB_TOKEN, CREATE_ISSUE_MUTATION, {
          repositoryId,
          title: title.trim(),
          body: typeof aciklama === "string" && aciklama.trim() ? aciklama : undefined,
          labelIds,
        });
        const issue = issueData.createIssue.issue;

        // d) Proje bilgisini (field'lar dahil) al ve issue'yu panoya ekle.
        const project = await projeBilgisiGetir(env.GITHUB_TOKEN, projectConfig.number);
        const addData = await githubGraphql(env.GITHUB_TOKEN, ADD_ITEM_MUTATION, {
          projectId: project.id,
          contentId: issue.id,
        });
        const itemId = addData.addProjectV2ItemById.item.id;

        // e) Formda doldurulan alanları panoya yaz.
        const alanSonuclari = alanlar && typeof alanlar === "object"
          ? await alanlariDoldur(env.GITHUB_TOKEN, project, project.id, itemId, alanlar)
          : [];

        return jsonYanit(
          {
            basarili: true,
            issue: { number: issue.number, url: issue.url },
            alanSonuclari,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error("Worker hatası (/kayit-ekle):", err);
        return jsonYanit({ message: "Kayıt eklenemedi: " + err.message }, 502, corsHeaders);
      }
    }

    // GET /liste?project=izleme|okuma&q=arama-metni — mevcut kayıtları
    // arayıp listeler (issue numarası, başlık, açıklama, alan değerleri).
    // "q" verilmezse projedeki TÜM kayıtları döner; verilirse başlık VEYA
    // açıklama VEYA herhangi bir alan değeri içinde (büyük/küçük harf
    // duyarsız) arama yapar — panelin arama kutusu tam olarak bunu
    // kullanıyor (bkz. ilgili JS).
    if (request.method === "GET" && url.pathname === "/liste") {
      const projectKey = url.searchParams.get("project");
      const projectConfig = PROJECTS[projectKey];
      if (!projectConfig) return jsonYanit({ message: "Geçersiz 'project' parametresi." }, 400, corsHeaders);

      const q = (url.searchParams.get("q") || "").trim().toLocaleLowerCase("tr");

      try {
        const tumItems = await projeItemleriGetir(env.GITHUB_TOKEN, projectConfig.number);
        const items = q
          ? tumItems.filter((it) => {
              const arananMetin = [it.title, it.body, ...Object.values(it.alanlar || {})]
                .filter((v) => v !== undefined && v !== null)
                .join(" ")
                .toLocaleLowerCase("tr");
              return arananMetin.includes(q);
            })
          : tumItems;

        // En yeni (en yüksek issue numarası) en üstte görünsün.
        items.sort((a, b) => (b.number || 0) - (a.number || 0));

        return jsonYanit({ count: items.length, items }, 200, corsHeaders);
      } catch (err) {
        console.error("Worker hatası (/liste):", err);
        return jsonYanit({ message: "Liste alınamadı: " + err.message }, 502, corsHeaders);
      }
    }

    // POST /kayit-guncelle — mevcut bir issue'nun başlığını/açıklamasını
    // ve/veya panodaki alan değerlerini günceller. `number` GitHub issue
    // numarasıdır (panelin "Mevcut Kayıtlar" listesinden seçilir).
    if (request.method === "POST" && url.pathname === "/kayit-guncelle") {
      let body;
      try {
        body = await request.json();
      } catch (_err) {
        return jsonYanit({ message: "Geçersiz istek gövdesi (JSON bekleniyor)." }, 400, corsHeaders);
      }

      const { project: projectKey, number, title, aciklama, alanlar } = body || {};
      const projectConfig = PROJECTS[projectKey];
      if (!projectConfig) {
        return jsonYanit({ message: "Geçersiz 'project' değeri (izleme|okuma bekleniyor)." }, 400, corsHeaders);
      }
      if (!number || typeof number !== "number") {
        return jsonYanit({ message: "Güncellenecek kaydın issue numarası ('number') zorunludur." }, 400, corsHeaders);
      }

      try {
        // a) Issue'nun node ID'sini bul (updateIssue mutasyonu ID ister, numara değil).
        const issueData = await githubGraphql(
          env.GITHUB_TOKEN,
          `query($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) { issue(number: $number) { id } }
          }`,
          { owner: REPO_OWNER, name: REPO_NAME, number }
        );
        const issueId = issueData.repository?.issue?.id;
        if (!issueId) throw new Error(`#${number} numaralı issue bulunamadı.`);

        // b) Başlık ve/veya açıklama verildiyse güncelle (ikisi de opsiyonel
        //    — sadece alan değerlerini güncellemek isteyen bir istek de
        //    geçerlidir, bu durumda updateIssue'ya hiç gitmeyiz).
        let guncelIssue = null;
        const yeniBaslik = typeof title === "string" && title.trim() ? title.trim() : undefined;
        const yeniAciklama = typeof aciklama === "string" ? aciklama : undefined;
        if (yeniBaslik !== undefined || yeniAciklama !== undefined) {
          const updateData = await githubGraphql(env.GITHUB_TOKEN, UPDATE_ISSUE_MUTATION, {
            issueId,
            title: yeniBaslik,
            body: yeniAciklama,
          });
          guncelIssue = updateData.updateIssue.issue;
        }

        // c) Proje bilgisini al, issue'nun panodaki item ID'sini bul.
        const project = await projeBilgisiGetir(env.GITHUB_TOKEN, projectConfig.number);
        const tumItems = await projeItemleriGetir(env.GITHUB_TOKEN, projectConfig.number);
        const hedefItem = tumItems.find((it) => it.number === number);
        if (!hedefItem) {
          throw new Error(`#${number} numaralı kayıt bu panoda bulunamadı (panoya eklenmemiş olabilir).`);
        }

        // d) Alan değerlerini güncelle.
        const alanSonuclari = alanlar && typeof alanlar === "object"
          ? await alanlariDoldur(env.GITHUB_TOKEN, project, project.id, hedefItem.itemId, alanlar)
          : [];

        return jsonYanit(
          {
            basarili: true,
            issue: {
              number,
              url: guncelIssue?.url || hedefItem.url,
              title: guncelIssue?.title || hedefItem.title,
            },
            alanSonuclari,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error("Worker hatası (/kayit-guncelle):", err);
        return jsonYanit({ message: "Kayıt güncellenemedi: " + err.message }, 502, corsHeaders);
      }
    }

    return jsonYanit({ message: "Bilinmeyen uç nokta." }, 404, corsHeaders);
  },
};
