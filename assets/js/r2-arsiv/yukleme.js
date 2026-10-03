/*
 * assets/js/r2-arsiv/yukleme.js — yükleme hattı: dosya/klasör toplama (sürükle-bırak dahil),
 * klasör ağacını önceden oluşturma, 2'li eşzamanlı kuyruk, ilerleme, yeniden deneme,
 * ad çakışmasında otomatik "(2)" eki, isteğe bağlı uçtan uca şifreleme.
 *
 * R2 işlemleri: dosya başına 1 PUT (Class A) + 1 HEAD (Class B). Klasör oluşturma = yalnızca DB.
 */
import { supabase } from "../core/supabase-client.js";
import { E2EE_MAX_BAYT, anahtarlariHazirla, aliciAnahtarlariniGetir, sifreliBoyut, dosyaSifrele, anahtariZarfla } from "./e2ee.js";
import { el, btn, boyutYaz, worker, adGecerli } from "./ortak.js";

const ESZAMANLI = 2;
const MAKS_DOSYA = 500;       // tek seferde en çok dosya
const MAKS_DERINLIK = 10;     // r2_arsiv.klasor_yolu kuralıyla aynı

const temizAd = (s) => s.normalize("NFC").replace(/[\/\\\u0000-\u001f\u007f]/g, "_").trim();   // NFC: Mac (NFD) adlarındaki "ö" gibi harfleri tek parçaya çevirir

/* ------------------------------ dosya toplama ------------------------------ */
function girisOku(entry) {
  return new Promise((coz) => entry.file((f) => coz(f), () => coz(null)));
}
async function dizinOku(entry) {
  const okuyucu = entry.createReader();
  const hepsi = [];
  for (;;) {                                         // readEntries 100'erli döner; boşalana dek oku
    const parca = await new Promise((coz) => okuyucu.readEntries(coz, () => coz([])));
    if (!parca.length) break;
    hepsi.push(...parca);
  }
  return hepsi;
}
async function entryGez(entry, altYol, cikti) {
  if (cikti.length >= MAKS_DOSYA) return;
  if (entry.isFile) {
    const f = await girisOku(entry);
    if (f) cikti.push({ file: f, altYol });
  } else if (entry.isDirectory) {
    const yeni = `${altYol}${temizAd(entry.name)}/`;
    for (const c of await dizinOku(entry)) await entryGez(c, yeni, cikti);
  }
}

/** DataTransfer (sürükle-bırak) VEYA FileList (input) -> [{file, altYol}]. İLK await'ten önce çağır. */
export async function dosyalariTopla(girdi) {
  const cikti = [];
  // DİKKAT: aşağıdaki iki satır SENKRON çalışmalı (bırakma olayı bitince DataTransfer boşalır).
  const duzDosyalar = [...(girdi?.files || [])];
  const girisler = girdi?.items && typeof girdi.items[0]?.webkitGetAsEntry === "function"
    ? [...girdi.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry()).filter(Boolean)
    : [];

  if (girisler.length) {
    for (const g of girisler) await entryGez(g, "", cikti);        // klasörler de gezilir
  }
  if (!cikti.length) {                                              // klasör seçici ya da entry desteği yoksa
    for (const f of duzDosyalar) {
      const rel = f.webkitRelativePath || "";                       // "A/B/dosya.txt"
      const parcalar = rel ? rel.split("/").slice(0, -1).map(temizAd) : [];
      cikti.push({ file: f, altYol: parcalar.length ? parcalar.join("/") + "/" : "" });
      if (cikti.length >= MAKS_DOSYA) break;
    }
  }
  return cikti;
}

/* --------------------------- klasör ağacını hazırla --------------------------- */
async function klasorleriHazirla(kokYol, altYollar) {
  const tum = new Set();
  altYollar.forEach((y) => {
    const p = y.split("/").filter(Boolean);
    for (let i = 1; i <= p.length; i++) tum.add(p.slice(0, i).join("/") + "/");
  });
  const sirali = [...tum].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const yol of sirali) {
    const p = yol.split("/").filter(Boolean);
    const ad = p[p.length - 1];
    const ust = kokYol + p.slice(0, -1).map((x) => x + "/").join("");
    if (!adGecerli(ad)) throw new Error(`Geçersiz klasör adı: "${ad}"`);
    const { error } = await supabase.rpc("r2_arsiv_klasor_olustur", { p_klasor_yolu: ust, p_ad: ad });
    if (error && !/zaten var/i.test(error.message || "")) throw new Error(error.message || "Klasör oluşturulamadı.");
  }
}

/* ------------------------------- R2'ye PUT ------------------------------- */
function r2yePutla(url, basliklar, govde, ilerleme) {
  return new Promise((coz, red) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    Object.entries(basliklar).forEach(([a, v]) => x.setRequestHeader(a, v));
    x.upload.addEventListener("progress", (e) => e.lengthComputable && ilerleme(e.loaded / e.total));
    x.addEventListener("load", () => (x.status >= 200 && x.status < 300 ? coz() : red(new Error(`R2 yüklemeyi reddetti (${x.status}).`))));
    x.addEventListener("error", () => red(new Error("R2'ye ulaşılamadı (ağ ya da bucket CORS ayarı).")));
    x.send(govde);
  });
}

function ekliAd(ad, n) {
  const i = ad.lastIndexOf(".");
  return i > 0 ? `${ad.slice(0, i)} (${n})${ad.slice(i)}` : `${ad} (${n})`;
}

/* --------------------------------- kuyruk --------------------------------- */
export function kuyrukKur({ liste, ozet, temizleBtn, baglam, bitti }) {
  const bekleyen = [];
  let aktif = 0, toplam = 0, tamam = 0, hata = 0;

  function ozetYaz() {
    if (!toplam) { ozet.textContent = ""; ozet.hidden = true; temizleBtn.hidden = true; return; }
    ozet.hidden = false;
    ozet.textContent = `${tamam}/${toplam} tamamlandı${hata ? ` · ${hata} hata` : ""}`;
    temizleBtn.hidden = aktif > 0 || bekleyen.length > 0 ? true : false;
  }

  temizleBtn.addEventListener("click", () => {
    [...liste.children].forEach((li) => { if (li.dataset.bitti === "1") li.remove(); });
    if (!liste.children.length) { toplam = 0; tamam = 0; hata = 0; }
    ozetYaz();
  });

  function isle() {
    while (aktif < ESZAMANLI && bekleyen.length) {
      const is = bekleyen.shift();
      aktif++;
      yukle(is)
        .then(() => { tamam++; })
        .catch((e) => { hata++; is.hataYaz(e.message || "Yükleme başarısız."); })
        .finally(() => {
          aktif--; ozetYaz(); isle();
          if (!aktif && !bekleyen.length) bitti();
        });
    }
    ozetYaz();
  }

  function satirKur(is) {
    const li = el("li", "ra-kuyruk-oge");
    const ust = el("div", "ra-kuyruk-ust");
    const ad = el("span", "ra-kuyruk-ad", (is.altYol ? is.altYol : "") + is.file.name);
    const durum = el("span", "ra-meta", "Sırada");
    ust.append(ad, durum);
    const ilerleme = document.createElement("progress"); ilerleme.max = 1; ilerleme.value = 0;
    li.append(ust, ilerleme);
    liste.appendChild(li);
    is.durumYaz = (m) => { durum.textContent = m; };
    is.ilerlemeYaz = (o) => { ilerleme.value = o; };
    is.bitirYaz = (m) => { durum.textContent = m; durum.className = "ra-meta ra-durum-tamam"; ilerleme.value = 1; li.dataset.bitti = "1"; };
    is.hataYaz = (m) => {
      durum.textContent = m; durum.className = "ra-meta ra-durum-hata"; li.dataset.bitti = "1";
      if (!li.querySelector(".ra-yeniden")) {
        const b = btn("Tekrar dene", "ra-btn ra-btn-kucuk ra-yeniden", () => {
          hata = Math.max(0, hata - 1); toplam++; li.dataset.bitti = "0"; b.remove();
          durum.className = "ra-meta"; durum.textContent = "Sırada"; ilerleme.value = 0;
          bekleyen.push(is); isle();
        });
        ust.appendChild(b);
      }
    };
  }

  async function yukle(is) {
    const { file, sifreli, klasor } = is;
    if (sifreli && file.size > E2EE_MAX_BAYT) throw new Error(`Şifreli yüklemede en fazla ${E2EE_MAX_BAYT / 1048576} MB desteklenir (${boyutYaz(file.size)}).`);

    let anahtarlar = null;
    if (sifreli) {
      is.durumYaz("Anahtarlar hazırlanıyor…");
      const ben = await anahtarlariHazirla();
      const { uid, alicilar } = is.sifre;
      const hepsi = [...new Set([uid, ...alicilar])];
      const { harita, eksik } = await aliciAnahtarlariniGetir(hepsi);
      if (eksik.length) throw new Error("Bazı alıcılar panele hiç girmediği için anahtarları yok. Onlar giriş yapınca tekrar dene.");
      harita.set(uid, ben.acik);
      anahtarlar = { harita, uid };
    }

    is.durumYaz("Hazırlanıyor…");
    const dosyaAdi = file.name.normalize("NFC");
    let ad = dosyaAdi, baslat = null;
    for (let n = 1; n <= 6; n++) {                     // ad çakışırsa "ad (2).ext" dene
      try {
        baslat = await worker("/yukle-baslat", {
          ad, klasor_yolu: klasor, mime: file.type || "application/octet-stream",
          boyut: sifreli ? sifreliBoyut(file.size) : file.size, sifreli,
        });
        break;
      } catch (e) {
        if (!/aynı ada/i.test(e.message) || n === 6) throw e;
        ad = ekliAd(dosyaAdi, n + 1);
      }
    }

    try {
      let govde = file, ham = null;
      if (sifreli) { is.durumYaz("Şifreleniyor…"); const s = await dosyaSifrele(file, baslat.id); govde = s.blob; ham = s.hamAnahtar; }
      is.durumYaz("Yükleniyor…");
      await r2yePutla(baslat.url, baslat.basliklar, govde, is.ilerlemeYaz);
      is.durumYaz("Doğrulanıyor…");
      await worker("/yukle-bitir", { id: baslat.id });
      if (sifreli) {
        const satirlar = [];
        for (const [kid, acik] of anahtarlar.harita) {
          satirlar.push({ dosya_id: baslat.id, alici_id: kid, sarili_dosya_anahtari: await anahtariZarfla(ham, acik) });
        }
        const { error } = await supabase.from("ozel_icerik_anahtarlar").insert(satirlar);
        if (error) throw new Error("Şifre zarfları kaydedilemedi.");
      }
      is.bitirYaz(sifreli ? "Şifrelendi ve yüklendi ✓" : (ad !== dosyaAdi ? `Yüklendi ✓ (adı "${ad}" oldu)` : "Yüklendi ✓"));
    } catch (e) {
      await worker("/sil", { id: baslat.id }).catch(() => {});   // yarım kaydı/nesneyi temizle
      throw e;
    }
  }

  /**
   * girdiler: dosyalariTopla() çıktısı. Arşiv yüklemesinde klasörler önce oluşturulur, sonra dosyalar
   * kuyruğa girer. ÖZEL (şifreli) gönderimde klasör kavramı yoktur: alt klasörler düzleştirilir.
   * Dönüş: { kisaltildi, duzlestirildi }
   */
  async function ekle(girdiler) {
    const b = baglam();
    if (!b.yukleyebilir) throw new Error("Yükleme yetkin yok.");
    if (!girdiler.length) throw new Error("Yüklenecek dosya bulunamadı.");
    const kisaltildi = girdiler.length >= MAKS_DOSYA;
    let duzlestirildi = false;

    if (b.sifreli) {
      duzlestirildi = girdiler.some((g) => g.altYol);
      girdiler = girdiler.map((g) => ({ file: g.file, altYol: "" }));
    } else {
      const derinlik = (y) => y.split("/").filter(Boolean).length;
      if (girdiler.some((g) => derinlik(b.klasor) + derinlik(g.altYol) > MAKS_DERINLIK))
        throw new Error(`Klasör derinliği en fazla ${MAKS_DERINLIK} olabilir.`);
      await klasorleriHazirla(b.klasor, new Set(girdiler.map((g) => g.altYol).filter(Boolean)));
    }

    girdiler.forEach((g) => {
      const is = { file: g.file, altYol: g.altYol, sifreli: b.sifreli, klasor: b.klasor + g.altYol, sifre: { uid: b.uid, alicilar: [...b.alicilar] } };
      satirKur(is); toplam++; bekleyen.push(is);
    });
    isle();
    return { kisaltildi, duzlestirildi };
  }

  return { ekle };
}
