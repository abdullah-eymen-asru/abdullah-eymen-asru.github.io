/*
 * assets/js/sistem-yedek/depolama.js — Depolama Durumu kartları (Supabase DB + Cloudflare R2).
 * Veri: sistem_depolama_durumu() RPC'si (yalnızca toplamlar). Owner ayrıca Worker'dan R2'yi GERÇEKTEN
 * tarayabilir (DB'de izi olmayan artık dosyalar dahil). %80 → uyarı, %90 → kritik rozeti.
 * innerHTML YOK, inline stil YOK (CSP): çubuklar <progress> ile çizilir.
 * -----------------------------------------------------------------------
 */
import { supabase } from "../core/supabase-client.js";
import { el, bayt, hataMetni, workerFetch, VARSAYILAN_DB_KOTA, VARSAYILAN_R2_KOTA } from "./ortak.js";

const KAYNAK_ADLARI = { arsiv: "Dosya Yöneticisi", akademik: "Akademik Kütüphane", notek: "Not ekleri" };

export function durumSeviyesi(oran) {
  if (oran >= 0.9) return { sinif: "kritik", etiket: "Kritik · %90+" };
  if (oran >= 0.8) return { sinif: "uyari", etiket: "Uyarı · %80+" };
  return { sinif: "iyi", etiket: "Normal" };
}

function kota(baslik, ikon, kullanilan, toplam, altSatirlar) {
  const oran = toplam > 0 ? Math.min(kullanilan / toplam, 1) : 0;
  const s = durumSeviyesi(oran);
  const cubuk = el("progress", { class: `sy-cubuk sy-cubuk--${s.sinif}`, max: "100", value: String(Math.round(oran * 1000) / 10), "aria-label": `${baslik} doluluk` });
  return el("article", { class: `sy-kart sy-kota sy-kota--${s.sinif}` },
    el("div", { class: "sy-kota-ust" },
      el("h3", { text: `${ikon} ${baslik}` }),
      el("span", { class: `sy-rozet sy-rozet--${s.sinif}`, text: s.etiket })
    ),
    el("p", { class: "sy-kota-deger" }, el("strong", { text: bayt(kullanilan) }), ` / ${bayt(toplam)}`, el("span", { class: "muted", text: `  (%${(oran * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })})` })),
    cubuk,
    ...altSatirlar
  );
}

export async function depolamaCiz(kok) {
  kok.replaceChildren(el("p", { class: "muted", text: "Depolama durumu yükleniyor…" }));
  const { data: d, error } = await supabase.rpc("sistem_depolama_durumu");
  if (error) {
    kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) }));
    return;
  }

  const dbKota = Number(d.db_kota_bayt) || VARSAYILAN_DB_KOTA;
  const r2Kota = Number(d.r2_kota_bayt) || VARSAYILAN_R2_KOTA;
  let r2Adet = 0;
  let r2Bayt = 0;
  const r2Satirlar = [];
  for (const [k, v] of Object.entries(d.r2 || {})) {
    r2Adet += Number(v.adet) || 0;
    r2Bayt += Number(v.bayt) || 0;
    r2Satirlar.push(el("li", {}, el("span", { text: KAYNAK_ADLARI[k] || k }), el("span", { class: "muted", text: `${Number(v.adet).toLocaleString("tr-TR")} dosya · ${bayt(v.bayt)}` })));
  }

  const dbAlt = [];
  if (d.owner && Array.isArray(d.en_buyuk_tablolar) && d.en_buyuk_tablolar.length) {
    dbAlt.push(el("details", { class: "sy-detay" },
      el("summary", { text: "En büyük tablolar" }),
      el("ul", { class: "sy-liste" }, d.en_buyuk_tablolar.map((t) => el("li", {}, el("code", { text: t.tablo }), el("span", { class: "muted", text: bayt(t.bayt) }))))
    ));
  }
  dbAlt.push(el("p", { class: "muted sy-not", text: "Boyut, PostgreSQL veritabanının anlık toplam boyutudur (Supabase ücretsiz plan kotası: 500 MB)." }));

  const tarananKutu = el("div", { class: "sy-taranan", "aria-live": "polite" });
  const r2Alt = [
    el("ul", { class: "sy-liste" }, r2Satirlar),
    el("p", { class: "muted sy-not", text: `Toplam ${r2Adet.toLocaleString("tr-TR")} dosya (veritabanı kayıtlarından hesaplanır; ücretsiz katman referansı: 10 GB).` }),
  ];
  if (d.owner) {
    const dugme = el("button", { type: "button", class: "btn sy-ikincil", text: "R2'yi gerçekten tara (Worker)" });
    dugme.addEventListener("click", async () => {
      dugme.disabled = true;
      tarananKutu.replaceChildren(el("p", { class: "muted", text: "R2 kovaları taranıyor…" }));
      try {
        const r = await workerFetch("/depolama");
        const g = await r.json();
        if (!r.ok) throw new Error(g.error || `HTTP ${r.status}`);
        tarananKutu.replaceChildren(
          el("ul", { class: "sy-liste" }, Object.entries(g.kaynaklar).map(([k, v]) =>
            el("li", {}, el("span", { text: KAYNAK_ADLARI[k] || k }),
              el("span", { class: "muted", text: v.bagli ? `${v.adet.toLocaleString("tr-TR")} nesne · ${bayt(v.bayt)}${v.kismi ? " (kısmi tarama)" : ""}` : "binding bağlı değil" })))),
          el("p", { class: "muted sy-not", text: "Bu sayılar R2'nin kendisinden gelir; veritabanında kaydı olmayan artık dosyaları da içerir." })
        );
      } catch (h) {
        tarananKutu.replaceChildren(el("p", { class: "auth-message error", text: `Tarama başarısız: ${h.message || h}` }));
      } finally {
        dugme.disabled = false;
      }
    });
    r2Alt.push(dugme, tarananKutu);
  }

  kok.replaceChildren(
    el("div", { class: "sy-izgara" },
      kota("Supabase Veritabanı", "🗄️", Number(d.db_bayt) || 0, dbKota, dbAlt),
      kota("Cloudflare R2 Depolama", "☁️", r2Bayt, r2Kota, r2Alt)
    )
  );
}
