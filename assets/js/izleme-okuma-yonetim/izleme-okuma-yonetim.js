/*
 * assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js — /panel/izleme-okuma-yonetim.html
 *
 * İzlediklerim/Okuduklarım GitHub Projects panolarına panelin içinden yeni
 * kayıt (issue) eklemeyi sağlar. `github-yonetim.js`'in izlediği AYNI
 * güvenlik mimarisini kullanır: GitHub'a DOĞRUDAN değil, bir Cloudflare
 * Worker üzerinden (bkz. cloudflare worker/izleme_okuma_yonetim_worker/worker.js)
 * konuşur; kimlik kanıtı olarak kullanıcının Supabase oturum token'ını
 * gönderir, PAT tarayıcıya hiç girmez.
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
 * form buna göre dinamik olarak kurulur — panoya yeni bir sütun eklendiğinde
 * bu dosyaya hiç dokunmaya gerek kalmaz (koleksiyon-tablo.js'nin okuma
 * tarafında izlediği AYNI "dinamik şema" felsefesi, burada yazma tarafında).
 */
import { requireAuth } from "../auth/auth-guard.js";
import { showMessage, supabase } from "../core/supabase-client.js";

// ---- BURAYI DOLDUR: Worker deploy edildikten sonra aldığın URL ----
const IZLEME_OKUMA_WORKER_URL = "https://izleme-okuma-yonetim-worker.aeymena.workers.dev";
// ---------------------------------------------------------------------

const KOLEKSIYONLAR = {
  izleme: { baslikEtiketi: "İzlediklerim", placeholderBaslik: "örn. Dune: Part Two" },
  okuma: { baslikEtiketi: "Okuduklarım", placeholderBaslik: "örn. Suç ve Ceza" },
};

let aktifKoleksiyon = "izleme";
let aktifAlanlar = []; // Worker'ın /alanlar uç noktasından gelen [{name, dataType, options?}]

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

function alanGirdiElemaniOlustur(alan) {
  const wrap = document.createElement("div");
  wrap.className = "form-field";

  const label = document.createElement("label");
  const inputId = `iy-alan-${alan.name.replace(/[^a-zA-Z0-9]/g, "-")}`;
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
    wrap.appendChild(input);
  }

  return wrap;
}

async function formuKoleksiyonaGoreKur() {
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
    const { fields } = await workerRequest(`/alanlar?project=${aktifKoleksiyon}`);
    aktifAlanlar = fields || [];
    container.innerHTML = "";
    if (aktifAlanlar.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Panoda özel bir alan bulunamadı — sadece başlıkla kayıt eklenecek.";
      container.appendChild(p);
      return;
    }
    aktifAlanlar.forEach((alan) => container.appendChild(alanGirdiElemaniOlustur(alan)));
  } catch (err) {
    container.innerHTML = "";
    showMessage(messageEl, "Alanlar yüklenemedi: " + err.message, "error");
  }
}

function formdanAlanlariTopla() {
  const container = document.getElementById("iy-alanlar-container");
  const alanlar = {};
  container.querySelectorAll("[data-alan-adi]").forEach((el) => {
    const deger = el.value;
    if (deger !== "" && deger !== null && deger !== undefined) {
      alanlar[el.dataset.alanAdi] = deger;
    }
  });
  return alanlar;
}

function sekmeleriBagla() {
  const nav = document.getElementById("iy-nav");
  nav.querySelectorAll(".gy-klasor-tur-sekme").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.koleksiyon === aktifKoleksiyon) return;
      nav.querySelectorAll(".gy-klasor-tur-sekme").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      aktifKoleksiyon = btn.dataset.koleksiyon;
      document.getElementById("iy-title").value = "";
      formuKoleksiyonaGoreKur();
    });
  });
}

function formGonderimiBagla() {
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

    const alanlar = formdanAlanlariTopla();

    submitBtn.disabled = true;
    submitBtn.textContent = "Ekleniyor…";
    try {
      const sonuc = await workerRequest("/kayit-ekle", {
        method: "POST",
        body: JSON.stringify({ project: aktifKoleksiyon, title, alanlar }),
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
      // Reset sonrası select'lerin "— Seçilmedi —" durumuna dönmesi için
      // formu olduğu gibi bırakıyoruz; alan listesini yeniden çekmeye
      // gerek yok, aynı pano aynı alanlarla kalmaya devam ediyor.
    } catch (err) {
      showMessage(messageEl, "Kayıt eklenemedi: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "➕ Kaydı Ekle";
    }
  });
}

async function init() {
  // SADECE owner — bkz. dosya başındaki mimari notu. requireAuth,
  // yetkisiz kullanıcıyı zaten /panel/panel.html?hata=yetkisiz adresine
  // yönlendirir, bu satırdan sonrası owner olmayan biri için hiç çalışmaz.
  await requireAuth({ role: "owner" });

  document.getElementById("loading").remove();
  document.getElementById("app").hidden = false;

  sekmeleriBagla();
  formGonderimiBagla();
  await formuKoleksiyonaGoreKur();
}

init();
