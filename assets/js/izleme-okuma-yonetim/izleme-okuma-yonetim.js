/*
 * assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js — /panel/izleme-okuma-yonetim.html
 *
 * İzlediklerim/Okuduklarım GitHub Projects panolarına panelin içinden yeni
 * kayıt (issue) eklemeyi VE mevcut kayıtları arayıp güncellemeyi sağlar.
 * `github-yonetim.js`'in izlediği AYNI güvenlik mimarisini kullanır:
 * GitHub'a DOĞRUDAN değil, bir Cloudflare Worker üzerinden (bkz.
 * cloudflare worker/izleme_okuma_yonetim_worker/worker.js) konuşur; kimlik
 * kanıtı olarak kullanıcının Supabase oturum token'ını gönderir, PAT
 * tarayıcıya hiç girmez.
 *
 * ÖNEMLİ — BU SAYFA SADECE 'owner' (Site Sahibi) İÇİNDİR: hem bu dosya
 * requireAuth({role:'owner'}) ile (bkz. auth-guard.js — 'owner' zaten
 * "her zaman geçer" kuralına sahip, ayrıca hiçbir alt-rol onun yerine
 * geçmez), HEM DE Worker kendi tarafında Supabase'ten taze rolü okuyup
 * AYNI kısıtlamayı sunucu tarafında ZORUNLU kılıyor (bkz. Worker dosyası).
 * Bu ikisi birbirinden bağımsız iki kontrol — biri sadece "sayfayı
 * gösterme/gizleme" (kullanıcı deneyimi), diğeri GERÇEK güvenlik sınırı.
 *
 * Form alanları SABİT KODLANMAZ: sayfa açıldığında Worker'ın /alanlar
 * uç noktasından ilgili projenin (izleme=2, okuma=3) o anki custom
 * field'ları (isim + tip + varsa single-select seçenekleri) çekilir ve
 * hem "Yeni Kayıt Ekle" hem "Mevcut Kayıtlar > Düzenle" formu buna göre
 * dinamik olarak kurulur — panoya yeni bir sütun eklendiğinde bu dosyaya
 * hiç dokunmaya gerek kalmaz (koleksiyon-tablo.js'nin okuma tarafında
 * izlediği AYNI "dinamik şema" felsefesi, burada yazma tarafında).
 *
 * İKİ MOD: "ekle" (yeni kayıt) ve "mevcut" (ara + düzenle) — bkz.
 * #iy-mod-nav. İkisi de aynı aktif koleksiyona (izleme/okuma) göre çalışır.
 */
import { requireAuth } from "../auth/auth-guard.js";
import { showMessage, kucukHarfeCevirTr, supabase } from "../core/supabase-client.js";

// ---- BURAYI DOLDUR: Worker deploy edildikten sonra aldığın URL ----
const IZLEME_OKUMA_WORKER_URL = "https://izleme-okuma-yonetim-worker.aeymena.workers.dev";
// ---------------------------------------------------------------------

const KOLEKSIYONLAR = {
  izleme: { baslikEtiketi: "İzlediklerim", placeholderBaslik: "örn. Dune: Part Two" },
  okuma: { baslikEtiketi: "Okuduklarım", placeholderBaslik: "örn. Suç ve Ceza" },
};

let aktifKoleksiyon = "izleme";
let aktifMod = "ekle"; // "ekle" | "mevcut"
let aktifAlanlar = []; // Worker'ın /alanlar uç noktasından gelen [{name, dataType, options?}]
let sonListe = []; // /liste'den gelen son sonuç kümesi (arama filtresi client-side)
let duzenlenenKayit = null; // { number, title, body, alanlar } — şu an düzenleme formunda açık olan kayıt

async function workerRequest(path, options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Oturum bulunamadı, tekrar giriş yapmayı dene.");

  const res = await fetch(`${IZLEME_OKUMA_WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message || `İstek başarısız (${res.status}).`);
  }
  return body;
}

function alanGirdiElemaniOlustur(alan, idOneki, mevcutDeger) {
  const wrap = document.createElement("div");
  wrap.className = "form-field";

  const label = document.createElement("label");
  const inputId = `${idOneki}-${alan.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
  label.setAttribute("for", inputId);
  label.textContent = alan.name;
  wrap.appendChild(label);

  if (alan.dataType === "SINGLE_SELECT") {
    const select = document.createElement("select");
    select.id = inputId;
    select.dataset.alanAdi = alan.name;

    const bosOption = document.createElement("option");
    bosOption.value = "";
    bosOption.textContent = "— Seçilmedi —";
    select.appendChild(bosOption);

    (alan.options || []).forEach((secenek) => {
      const opt = document.createElement("option");
      opt.value = secenek;
      opt.textContent = secenek;
      if (mevcutDeger !== undefined && String(mevcutDeger) === secenek) opt.selected = true;
      select.appendChild(opt);
    });
    wrap.appendChild(select);
  } else {
    const input = document.createElement("input");
    input.id = inputId;
    input.dataset.alanAdi = alan.name;
    if (alan.dataType === "NUMBER") input.type = "number";
    else if (alan.dataType === "DATE") input.type = "date";
    else input.type = "text";
    if (mevcutDeger !== undefined) input.value = mevcutDeger;
    wrap.appendChild(input);
  }

  return wrap;
}

async function alanlariGetir() {
  const { fields } = await workerRequest(`/alanlar?project=${aktifKoleksiyon}`);
  aktifAlanlar = fields || [];
  return aktifAlanlar;
}

function formdanAlanlariTopla(containerId) {
  const container = document.getElementById(containerId);
  const alanlar = {};
  container.querySelectorAll("[data-alan-adi]").forEach((el) => {
    const deger = el.value;
    if (deger !== "" && deger !== null && deger !== undefined) {
      alanlar[el.dataset.alanAdi] = deger;
    }
  });
  return alanlar;
}

// ---------------- MOD: YENİ KAYIT EKLE ----------------

async function ekleFormunuKoleksiyonaGoreKur() {
  const container = document.getElementById("iy-alanlar-container");
  const baslikInput = document.getElementById("iy-title");
  const formBaslik = document.getElementById("iy-form-baslik");
  const { baslikEtiketi, placeholderBaslik } = KOLEKSIYONLAR[aktifKoleksiyon];

  formBaslik.textContent = `Yeni Kayıt Ekle — ${baslikEtiketi}`;
  baslikInput.placeholder = placeholderBaslik;

  container.innerHTML = "";
  const yukleniyor = document.createElement("p");
  yukleniyor.className = "muted";
  yukleniyor.textContent = "Alanlar yükleniyor…";
  container.appendChild(yukleniyor);

  document.getElementById("iy-basari-kutu").hidden = true;
  const messageEl = document.getElementById("iy-message");
  messageEl.hidden = true;

  try {
    const fields = await alanlariGetir();
    container.innerHTML = "";
    if (fields.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Panoda özel bir alan bulunamadı — sadece başlık/açıklamayla kayıt eklenecek.";
      container.appendChild(p);
      return;
    }
    fields.forEach((alan) => container.appendChild(alanGirdiElemaniOlustur(alan, "iy-alan")));
  } catch (err) {
    container.innerHTML = "";
    showMessage(messageEl, "Alanlar yüklenemedi: " + err.message, "error");
  }
}

function ekleFormGonderimiBagla() {
  const form = document.getElementById("iy-form");
  const submitBtn = document.getElementById("iy-submit-btn");
  const messageEl = document.getElementById("iy-message");
  const basariKutu = document.getElementById("iy-basari-kutu");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    messageEl.hidden = true;
    basariKutu.hidden = true;

    const title = document.getElementById("iy-title").value.trim();
    if (!title) {
      showMessage(messageEl, "Başlık zorunludur.", "error");
      return;
    }
    const aciklama = document.getElementById("iy-aciklama").value;
    const alanlar = formdanAlanlariTopla("iy-alanlar-container");

    submitBtn.disabled = true;
    submitBtn.textContent = "Ekleniyor…";
    try {
      const sonuc = await workerRequest("/kayit-ekle", {
        method: "POST",
        body: JSON.stringify({ project: aktifKoleksiyon, title, aciklama, alanlar }),
      });

      const basarisizAlanlar = (sonuc.alanSonuclari || []).filter((a) => !a.basarili);
      if (basarisizAlanlar.length > 0) {
        showMessage(
          messageEl,
          "Kayıt eklendi ama bazı alanlar yazılamadı: " +
            basarisizAlanlar.map((a) => `${a.alan} (${a.hata})`).join(", "),
          "error"
        );
      } else {
        messageEl.hidden = true;
      }

      document.getElementById("iy-basari-metin").textContent =
        `"${title}" başlığıyla #${sonuc.issue.number} numaralı kayıt ${KOLEKSIYONLAR[aktifKoleksiyon].baslikEtiketi} panosuna eklendi.`;
      const issueLink = document.getElementById("iy-basari-issue-link");
      issueLink.href = sonuc.issue.url;
      basariKutu.hidden = false;

      form.reset();
    } catch (err) {
      showMessage(messageEl, "Kayıt eklenemedi: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "➕ Kaydı Ekle";
    }
  });
}

// ---------------- MOD: MEVCUT KAYITLAR (ARA + DÜZENLE) ----------------

function listeyiCiz(items) {
  const container = document.getElementById("iy-liste");
  const sonucYokEl = document.getElementById("iy-liste-sonuc-yok");
  container.innerHTML = "";

  if (items.length === 0) {
    sonucYokEl.hidden = false;
    return;
  }
  sonucYokEl.hidden = true;

  items.forEach((item) => {
    const kart = document.createElement("div");
    kart.className = "gy-icerik-kart";

    const bilgi = document.createElement("div");
    bilgi.className = "gy-icerik-kart-bilgi";

    const baslik = document.createElement("div");
    baslik.className = "gy-icerik-kart-baslik";
    baslik.textContent = `#${item.number} — ${item.title}`;
    bilgi.appendChild(baslik);

    const meta = document.createElement("div");
    meta.className = "gy-icerik-kart-meta";
    const metaBits = Object.entries(item.alanlar || {})
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`);
    meta.textContent = metaBits.join(" · ");
    bilgi.appendChild(meta);

    if (item.body) {
      const ozet = document.createElement("div");
      ozet.className = "gy-icerik-kart-ozet";
      ozet.textContent = item.body.length > 140 ? item.body.slice(0, 140) + "…" : item.body;
      bilgi.appendChild(ozet);
    }

    kart.appendChild(bilgi);

    const aksiyonlar = document.createElement("div");
    aksiyonlar.className = "gy-icerik-kart-aksiyonlar";
    const duzenleBtn = document.createElement("button");
    duzenleBtn.type = "button";
    duzenleBtn.textContent = "✏️ Düzenle";
    duzenleBtn.addEventListener("click", () => duzenlemeFormunuAc(item));
    aksiyonlar.appendChild(duzenleBtn);
    kart.appendChild(aksiyonlar);

    container.appendChild(kart);
  });
}

function listeyiFiltreleVeCiz() {
  const q = kucukHarfeCevirTr(document.getElementById("iy-liste-arama").value.trim());
  if (!q) {
    listeyiCiz(sonListe);
    return;
  }
  const filtreli = sonListe.filter((item) => {
    const metin = kucukHarfeCevirTr(
      [item.title, item.body, ...Object.values(item.alanlar || {})].filter(Boolean).join(" ")
    );
    return metin.includes(q);
  });
  listeyiCiz(filtreli);
}

async function listeyiYukle() {
  const container = document.getElementById("iy-liste");
  container.innerHTML = '<p class="muted">Yükleniyor…</p>';
  document.getElementById("iy-liste-sonuc-yok").hidden = true;
  try {
    const { items } = await workerRequest(`/liste?project=${aktifKoleksiyon}`);
    sonListe = items || [];
    listeyiFiltreleVeCiz();
  } catch (err) {
    container.innerHTML = "";
    showMessage(document.getElementById("iy-duzenle-message"), "Liste yüklenemedi: " + err.message, "error");
    document.getElementById("iy-duzenle-message").hidden = false;
  }
}

async function duzenlemeFormunuAc(item) {
  duzenlenenKayit = item;
  const kutu = document.getElementById("iy-duzenle-kutu");
  const messageEl = document.getElementById("iy-duzenle-message");
  messageEl.hidden = true;

  document.getElementById("iy-duzenle-baslik").textContent = `Kaydı Düzenle — #${item.number}`;
  document.getElementById("iy-duzenle-title").value = item.title || "";
  document.getElementById("iy-duzenle-aciklama").value = item.body || "";

  const alanlarContainer = document.getElementById("iy-duzenle-alanlar-container");
  alanlarContainer.innerHTML = '<p class="muted">Alanlar yükleniyor…</p>';
  kutu.hidden = false;
  kutu.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    // Alanlar zaten "ekle" modunda çekilmiş olabilir ama koleksiyon
    // değişmiş olabileceğinden (ör. kullanıcı sekme değiştirip geri
    // döndüyse) burada da güvenli olması için tekrar çekiyoruz — Worker
    // tarafında ayrıca bir maliyeti yok, tek bir GraphQL sorgusu.
    const fields = await alanlariGetir();
    alanlarContainer.innerHTML = "";
    fields.forEach((alan) => {
      const mevcutDeger = item.alanlar ? item.alanlar[alan.name] : undefined;
      alanlarContainer.appendChild(alanGirdiElemaniOlustur(alan, "iy-duzenle-alan", mevcutDeger));
    });
  } catch (err) {
    alanlarContainer.innerHTML = "";
    showMessage(messageEl, "Alanlar yüklenemedi: " + err.message, "error");
  }
}

function duzenlemeFormunuKapat() {
  duzenlenenKayit = null;
  document.getElementById("iy-duzenle-kutu").hidden = true;
}

function duzenlemeFormGonderimiBagla() {
  const form = document.getElementById("iy-duzenle-form");
  const submitBtn = document.getElementById("iy-duzenle-submit-btn");
  const messageEl = document.getElementById("iy-duzenle-message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!duzenlenenKayit) return;
    messageEl.hidden = true;

    const title = document.getElementById("iy-duzenle-title").value.trim();
    if (!title) {
      showMessage(messageEl, "Başlık zorunludur.", "error");
      return;
    }
    const aciklama = document.getElementById("iy-duzenle-aciklama").value;
    const alanlar = formdanAlanlariTopla("iy-duzenle-alanlar-container");

    submitBtn.disabled = true;
    submitBtn.textContent = "Güncelleniyor…";
    try {
      const sonuc = await workerRequest("/kayit-guncelle", {
        method: "POST",
        body: JSON.stringify({
          project: aktifKoleksiyon,
          number: duzenlenenKayit.number,
          title,
          aciklama,
          alanlar,
        }),
      });

      const basarisizAlanlar = (sonuc.alanSonuclari || []).filter((a) => !a.basarili);
      if (basarisizAlanlar.length > 0) {
        showMessage(
          messageEl,
          "Kayıt güncellendi ama bazı alanlar yazılamadı: " +
            basarisizAlanlar.map((a) => `${a.alan} (${a.hata})`).join(", "),
          "error"
        );
      } else {
        showMessage(messageEl, "Kayıt güncellendi.", "success");
      }

      // Listeyi ve düzenlenen kaydı taze veriyle güncelle.
      await listeyiYukle();
      duzenlemeFormunuKapat();
    } catch (err) {
      showMessage(messageEl, "Kayıt güncellenemedi: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "💾 Güncelle";
    }
  });

  document.getElementById("iy-duzenle-iptal-btn").addEventListener("click", duzenlemeFormunuKapat);
}

function mevcutModunuKoleksiyonaGoreKur() {
  const { baslikEtiketi } = KOLEKSIYONLAR[aktifKoleksiyon];
  document.getElementById("iy-liste-baslik").textContent = `Mevcut Kayıtlar — ${baslikEtiketi}`;
  document.getElementById("iy-liste").innerHTML = '<p class="muted">Henüz yüklenmedi.</p>';
  document.getElementById("iy-liste-sonuc-yok").hidden = true;
  document.getElementById("iy-liste-arama").value = "";
  sonListe = [];
  duzenlemeFormunuKapat();
}

function aramaKutusunuBagla() {
  const aramaInput = document.getElementById("iy-liste-arama");
  const temizleBtn = document.getElementById("iy-liste-arama-temizle");

  aramaInput.addEventListener("input", () => {
    temizleBtn.hidden = aramaInput.value === "";
    listeyiFiltreleVeCiz();
  });
  temizleBtn.addEventListener("click", () => {
    aramaInput.value = "";
    temizleBtn.hidden = true;
    listeyiFiltreleVeCiz();
    aramaInput.focus();
  });
  document.getElementById("iy-liste-yenile-btn").addEventListener("click", listeyiYukle);
}

// ---------------- ÜST SEKMELER: İZLEME/OKUMA + EKLE/MEVCUT ----------------

function koleksiyonSekmeleriniBagla() {
  const nav = document.getElementById("iy-nav");
  nav.querySelectorAll(".gy-klasor-tur-sekme").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.koleksiyon === aktifKoleksiyon) return;
      nav.querySelectorAll(".gy-klasor-tur-sekme").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      aktifKoleksiyon = btn.dataset.koleksiyon;
      document.getElementById("iy-title").value = "";

      if (aktifMod === "ekle") {
        await ekleFormunuKoleksiyonaGoreKur();
      } else {
        mevcutModunuKoleksiyonaGoreKur();
      }
    });
  });
}

async function modSekmeleriniBagla() {
  const nav = document.getElementById("iy-mod-nav");
  const ekleBolum = document.getElementById("iy-mod-ekle");
  const mevcutBolum = document.getElementById("iy-mod-mevcut");

  nav.querySelectorAll("a[data-mod]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const mod = a.dataset.mod;
      if (mod === aktifMod) return;
      aktifMod = mod;

      nav.querySelectorAll("a[data-mod]").forEach((el) => el.classList.remove("active"));
      a.classList.add("active");

      if (mod === "ekle") {
        ekleBolum.hidden = false;
        mevcutBolum.hidden = true;
        await ekleFormunuKoleksiyonaGoreKur();
      } else {
        ekleBolum.hidden = true;
        mevcutBolum.hidden = false;
        mevcutModunuKoleksiyonaGoreKur();
      }
    });
  });
}

async function init() {
  // SADECE owner — bkz. dosya başındaki mimari notu. requireAuth,
  // yetkisiz kullanıcıyı zaten /panel/panel.html?hata=yetkisiz adresine
  // yönlendirir, bu satırdan sonrası owner olmayan biri için hiç çalışmaz.
  await requireAuth({ role: "owner" });

  document.getElementById("loading").remove();
  document.getElementById("app").hidden = false;

  koleksiyonSekmeleriniBagla();
  await modSekmeleriniBagla();
  ekleFormGonderimiBagla();
  duzenlemeFormGonderimiBagla();
  aramaKutusunuBagla();

  await ekleFormunuKoleksiyonaGoreKur();
}

init();
