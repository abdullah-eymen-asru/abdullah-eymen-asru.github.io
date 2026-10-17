/**
 * ui-hava.js — Hava durumu sekmeleri: Özet, Saatlik (48 sa), 10 Gün. MGM/Apple/Google Hava Durumu'ndaki başlıca veriler:
 * anlık durum, hissedilen, saatlik/10 günlük tahmin, 15 dk'lık yağış, rüzgâr (yön+hamle), nem, çiğ noktası, görüş, basınç (+eğilim), UV,
 * hava kalitesi, güneş doğuş/batış, gün uzunluğu, ay evresi, bulutluluk ve toplam yağış.
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, cipGrubu, olcek, saatlikGrafik, isoZamanOnce, zamanOnce, olay } from "./ui-temel.js";
import { havaKodu, ruzgarYonu, ruzgarOkAcisi, uvSeviye, aqiSeviye, gorusSeviye, nemSeviye, cigNoktasiKonfor, ayEvresi, saatMetni, gunAdi, sureMetni } from "./hava-kodlari.js";
import { SENARYOLAR, TOLERANSLAR, CANTA_SECENEKLERI, hedefClo } from "./cekirdek.js";
import { seviyeAdi } from "./taktik.js";

/** Apple Hava Durumu tarzı tek cümlelik özet */
export function yagisOzeti(h) {
  const sl = (h.saatListe || []).slice(0, 24);
  const yagmurlu = (x) => x.yagisOlasi >= 50 || x.yagis >= 0.3;
  if (h.dakikalik?.length && h.dakikalik.slice(0, 8).some((x) => x.mm > 0.05)) {
    const ilk = h.dakikalik.findIndex((x) => x.mm > 0.05);
    if (ilk === 0) return "Şu an yağış var; saatlik tahmine göre gelişimi aşağıda.";
    return `Yaklaşık ${ilk * 15} dk içinde yağış başlıyor.`;
  }
  const i0 = sl.findIndex(yagmurlu);
  if (i0 < 0) return "Önümüzdeki 24 saatte belirgin yağış beklenmiyor.";
  let i1 = i0; while (i1 + 1 < sl.length && yagmurlu(sl[i1 + 1])) i1++;
  const p = (x) => `${String(x.saat).padStart(2, "0")}:00`;
  if (i0 === 0) return i1 + 1 >= sl.length ? "Yağış gün boyu sürecek." : `Yağış şu an sürüyor; ${p(sl[Math.min(i1 + 1, sl.length - 1)])} civarında dinmesi bekleniyor.`;
  return i1 === i0 ? `${p(sl[i0])} civarında kısa süreli yağış bekleniyor.` : `${p(sl[i0])} – ${p(sl[Math.min(i1 + 1, sl.length - 1)])} arasında yağış bekleniyor.`;
}

const gunEtiketi = (tarih, i) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : gunAdi(tarih));

function metrik(ikon, baslik, deger, alt, ek) {
  return el("div", { class: "hv-metrik" }, el("span", { class: "hv-metrik-baslik", text: `${ikon} ${baslik}` }), el("strong", { text: deger }), alt ? el("small", { text: alt }) : null, ek || null);
}

function detayGrid(h) {
  const uv = uvSeviye(h.uv), aq = aqiSeviye(h.aqi);
  const ay = ayEvresi(new Date());
  const ok = el("span", { class: "hv-ok", "aria-hidden": "true", text: "➤" });
  ok.style.transform = `rotate(${ruzgarOkAcisi(h.ruzgarYon) - 90}deg)`;
  const g0 = h.gunluk?.[0];
  return el("div", { class: "hv-detay-grid" },
    metrik("💨", "Rüzgâr", `${h.wind} km/s`, `Hamle ${h.gust} km/s · ${ruzgarYonu(h.ruzgarYon)} yönünden`, ok),
    metrik("💧", "Nem", `%${h.hum}`, `${nemSeviye(h.hum)} · Çiğ noktası ${h.cigNoktasi}° (${cigNoktasiKonfor(h.cigNoktasi)})`),
    metrik("☀️", "UV indeksi", `${h.uv}`, `${uv.ad} · ${uv.oneri}`, olcek(h.uv / 11, uv.sinif)),
    metrik("🌫️", "Hava kalitesi", h.aqi != null ? `${h.aqi} · ${aq.ad}` : "Veri yok", h.kalite ? `PM2.5 ${h.kalite.pm25} · PM10 ${h.kalite.pm10} · Toz ${h.kalite.dust} µg/m³` : "Bu bölge için ölçüm yok", h.aqi != null ? olcek(Math.min(1, h.aqi / 120), aq.sinif) : null),
    metrik("👁️", "Görüş", h.gorus != null ? gorusSeviye(h.gorus) : "—", ""),
    metrik("🧭", "Basınç", `${h.basinc} hPa`, `Eğilim: ${h.basincEgilim}`),
    metrik("☁️", "Bulutluluk", `%${h.cloud}`, h.rad ? `Güneş ışınımı en çok ${h.rad} W/m²` : ""),
    metrik("🌧️", "Yağış", g0 ? `${g0.yagisToplam} mm` : "—", `Bugün toplam · son 6 saat ${h.recentPrecip} mm${h.snow ? ` · kar ${h.snow} cm` : ""}`),
    metrik("🌅", "Güneş", g0?.dogus ? `${saatMetni(g0.dogus)} – ${saatMetni(g0.batis)}` : "—", g0 ? `Gün uzunluğu ${sureMetni(g0.gunUzunlugu)}` : ""),
    metrik(ay.ikon, "Ay", ay.ad, `Aydınlık %${ay.aydinlik}`));
}

/* ------------------------------ ÖZET ------------------------------ */
export function ozetSekmesi(d, kb) {
  const h = d.hava, s = d.sonuc;
  if (!h || !s) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  const hk = havaKodu(h.kod, h.isDay);
  const g0 = h.gunluk?.[0];

  // --- hero ---
  const yenileBtn = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", "aria-label": "Hava durumunu yenile", text: "↻" }), "click", () => kb.yenile(true));
  const hero = kart("hv-hero",
    el("div", { class: "hv-hero-ust" }, el("div", {}, etiket(d.konum.ad), el("small", { class: "hv-ipucu", text: `${h.onbellek ? "Önbellek · " : ""}${zamanOnce(h.alinma || Date.now())}${h.eski ? " · ÇEVRİMDIŞI son bilinen veri" : ""}` })), yenileBtn),
    el("div", { class: "hv-hero-orta" },
      el("span", { class: "hv-hero-ikon", "aria-hidden": "true", text: hk.ikon }),
      el("div", {}, el("div", { class: "hv-hero-sicaklik" }, el("span", { class: "hv-buyuk", text: `${h.apparent}°` }), el("span", { class: "hv-hero-ek", text: `Ölçülen ${h.raw}°` })),
        el("div", { class: "hv-hero-durum", text: hk.ad }), g0 ? el("small", { class: "hv-ipucu", text: `En yüksek ${g0.max}° · en düşük ${g0.min}°` }) : null)),
    el("p", { class: "hv-hero-ozet", text: yagisOzeti(h) }),
    h.yesterdayDiff == null ? null : ipucu(h.yesterdayDiff > 2 ? `Dün bu saatten ${h.yesterdayDiff}° daha ılık.` : h.yesterdayDiff < -2 ? `Dün bu saatten ${Math.abs(h.yesterdayDiff)}° daha soğuk.` : "Dünle hemen hemen aynı."),
    h.modelFarki ? el("p", { class: "hv-uyari", text: `⚠ Hava modelleri yağışta ayrışıyor (${h.yagisVerenModel}/${h.modelSayisi} model yağış gösteriyor). Riskten kaçınıldı.` }) : null,
    el("div", { class: "hv-hukum" }, el("span", { class: "hv-hukum-ikon", "aria-hidden": "true", text: s.ikon }), el("div", {}, etiket("Bugünün kararı"), el("p", { class: "hv-hukum-metin", text: s.hukum }), el("small", { class: "hv-ipucu", text: `Hedef ${s.clo.hedef.toFixed(2)} CLO · kombin ${s.clo.toplam.toFixed(2)} CLO` }))));

  // --- haber uyarı bandı ---
  const hb = d.haber;
  let uyari = null;
  if (hb?.durum === "ok" && hb.uygulananlar.length) {
    uyari = kart("hv-uyari-bandi", ...hb.uygulananlar.slice(0, 2).map((u) => el("div", { class: "hv-band-satir" }, el("span", { class: "hv-band-ikon", text: u.kurallar[0].ikon }), el("div", {}, el("strong", { text: u.baslik }), el("small", { text: `${u.kurum || u.kaynakAd} · ${u.kurallar[0].etiket} · ${kapsamMetni(u)}` })))),
      olay(el("button", { type: "button", class: "hv-baglanti", text: "Ayrıntı ve ne yapmalı →" }), "click", () => kb.sekmeGit("haber")));
  } else if (!hb) uyari = kart("hv-kucuk", ipucu("🛰️ Resmî uyarılar kontrol ediliyor…"));

  // --- plan ---
  const plan = kart("hv-kucuk hv-plan",
    cipGrubu({ baslik: "Bugünkü planın", secenekler: Object.entries(SENARYOLAR).map(([k, v]) => [k, v.ad]), aktif: () => d.tercih.sen, onSec: (v) => kb.tercihDegis({ sen: v }) }).kok,
    ipucu(SENARYOLAR[d.tercih.sen].ipucu),
    el("div", { class: "hv-iki-sutun" },
      cipGrubu({ baslik: "Sıcaklık algın", secenekler: Object.entries(TOLERANSLAR).map(([k, v]) => [Number(k), v]), aktif: () => d.tercih.tol, onSec: (v) => kb.tercihDegis({ tol: v }), kucuk: true }).kok,
      cipGrubu({ baslik: "Çantan", secenekler: Object.entries(CANTA_SECENEKLERI), aktif: () => d.tercih.canta, onSec: (v) => kb.tercihDegis({ canta: v }), kucuk: true }).kok));

  // --- 15 dk yağış ---
  let dakika = null;
  if (h.dakikalik?.length >= 4) {
    const mx = Math.max(0.3, ...h.dakikalik.map((x) => x.mm));
    const barlar = h.dakikalik.map((x) => { const b = el("span", { class: `hv-dakika${x.mm > 0.05 ? " var" : ""}`, title: `${x.t.slice(11, 16)} · ${x.mm} mm` }); b.style.height = `${Math.max(6, (x.mm / mx) * 100)}%`; return b; });
    dakika = kart("hv-kucuk", etiket("🌧️ Önümüzdeki 2 saat (15 dk adımlarla)"), el("div", { class: "hv-dakikalar" }, ...barlar), ipucu(h.dakikalik.some((x) => x.mm > 0.05) ? "Yağış var/başlıyor." : "Yağış beklenmiyor."));
  }

  // --- saatlik şerit ---
  const seritSaat = (h.saatListe || []).slice(0, 25).map((x, i) => {
    const k = havaKodu(x.kod, x.gunduz);
    return el("div", { class: "hv-saat" }, el("small", { text: i === 0 ? "Şimdi" : `${String(x.saat).padStart(2, "0")}:00` }), el("span", { class: "hv-saat-ikon", "aria-hidden": "true", text: k.ikon }), el("strong", { text: `${x.temp}°` }),
      el("small", { class: x.yagisOlasi >= 30 ? "hv-mavi" : "", text: x.yagisOlasi >= 10 ? `%${x.yagisOlasi}` : "" }));
  });
  const serit = kart("hv-kucuk", bolumBasligi("Saatlik", olay(el("button", { type: "button", class: "hv-baglanti", text: "48 saat →" }), "click", () => kb.sekmeGit("saatlik"))), el("div", { class: "hv-saat-serit" }, ...seritSaat));

  // --- kombin özeti ---
  const ana = s.kombinler[0];
  const kombinOzet = kart("hv-kucuk",
    bolumBasligi("Bugün ne giyeyim?", olay(el("button", { type: "button", class: "hv-baglanti", text: "Tüm kombinler →" }), "click", () => kb.sekmeGit("kombin"))),
    el("div", { class: "hv-parca-cipleri" }, ...Object.values(ana.parcalar).filter(Boolean).map((p) => rozet(p.ad))),
    s.ekstralar.filter((x) => x.oncelik === "sart").length ? el("div", { class: "hv-parca-cipleri" }, ...s.ekstralar.filter((x) => x.oncelik === "sart").slice(0, 3).map((x) => rozet(`${x.ikon} ${x.ad}`, "hv-rozet-onemli"))) : null);

  const ipuclari = s.ipuclari.length ? kart("hv-kucuk", etiket("💡 Bugün için ipuçları"), el("ul", { class: "hv-liste" }, ...s.ipuclari.map((t) => el("li", { text: t })))) : null;
  return el("div", { class: "hv-sekme-govde" }, hero, uyari, plan, dakika, serit, kombinOzet, bolumBasligi("Ayrıntılar"), detayGrid(h), ipuclari);
}
function kapsamMetni(u) { return u.kapsam === "sokak" ? `${u.kapsamAd} sokağı` : u.kapsam === "mahalle" ? `${u.kapsamAd} mahallesi` : u.kapsam === "ilce" ? `${u.kapsamAd} ilçesi` : u.kapsam === "il" ? `${u.kapsamAd}` : u.kapsam === "bolge" ? `${u.kapsamAd} bölgesi` : `${u.kapsamAd} geneli`; }

/* ------------------------------ SAATLİK ------------------------------ */
export function saatlikSekmesi(d) {
  const h = d.hava;
  if (!h) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  const sl = h.saatListe || [];
  const satirlar = sl.map((x, i) => {
    const k = havaKodu(x.kod, x.gunduz);
    const yeniGun = i === 0 || x.saat === 0;
    const ok = el("span", { class: "hv-ok hv-ok-kucuk", "aria-hidden": "true", text: "➤" });
    ok.style.transform = `rotate(${ruzgarOkAcisi(x.yon) - 90}deg)`;
    const yagBar = el("span", { class: "hv-yagisbar" }, (() => { const ic = el("span"); ic.style.width = `${Math.min(100, x.yagisOlasi)}%`; return ic; })());
    return el("div", { class: `hv-satir${yeniGun ? " yeni-gun" : ""}` },
      el("div", { class: "hv-satir-saat" }, el("strong", { text: `${String(x.saat).padStart(2, "0")}:00` }), yeniGun ? el("small", { text: i === 0 ? "Şimdi" : gunAdi(x.t) }) : null),
      el("span", { class: "hv-saat-ikon", "aria-hidden": "true", title: k.ad, text: k.ikon }),
      el("div", { class: "hv-satir-sic" }, el("strong", { text: `${x.temp}°` }), el("small", { text: `his. ${x.app}°` })),
      el("div", { class: "hv-satir-yagis" }, yagBar, el("small", { text: `%${x.yagisOlasi}${x.yagis >= 0.1 ? ` · ${x.yagis.toFixed(1)} mm` : ""}` })),
      el("div", { class: "hv-satir-ruzgar" }, ok, el("small", { text: `${x.ruzgar}–${x.hamle} km/s` })),
      el("small", { class: "hv-satir-nem", text: `%${x.nem} nem` }));
  });
  return el("div", { class: "hv-sekme-govde" },
    kart("", bolumBasligi("48 saatlik tahmin"), saatlikGrafik(sl.slice(0, 49)), ipucu("Çizgi: sıcaklık · kesikli: hissedilen · mavi çubuklar: yağış ihtimali")),
    kart("hv-satirlar", ...satirlar));
}

/* ------------------------------ 10 GÜN ------------------------------ */
export function giyimIpucu(g, tercih) {
  const ort = (g.appMax + g.appMin) / 2;
  const c = hedefClo({ apparent: ort, raw: ort }, tercih.tol, tercih.sen).clo;
  const ana = c < 0.5 ? "Kısa kollu, hafif" : c < 0.8 ? "İnce uzun kollu / hafif ceket" : c < 1.1 ? "Ceket veya hırka" : c < 1.5 ? "Mont / kaban" : "Kalın mont, bere, eldiven";
  return `${ana}${g.yagisOlasi >= 50 ? " + yağmurluk/şemsiye" : ""}${g.uv >= 6 ? " + güneş koruması" : ""}`;
}
export function gunlukSekmesi(d) {
  const h = d.hava;
  if (!h?.gunluk?.length) return kart("hv-bos", ipucu("Günlük tahmin yükleniyor…"));
  const mn = Math.min(...h.gunluk.map((g) => g.min)), mx = Math.max(...h.gunluk.map((g) => g.max));
  const satirlar = h.gunluk.map((g, i) => {
    const k = havaKodu(g.kod, true);
    const aralik = el("span", { class: "hv-aralik" }, (() => { const ic = el("span"); ic.style.left = `${((g.min - mn) / (mx - mn || 1)) * 100}%`; ic.style.width = `${Math.max(6, ((g.max - g.min) / (mx - mn || 1)) * 100)}%`; return ic; })());
    return el("div", { class: "hv-gun" },
      el("div", { class: "hv-gun-ad" }, el("strong", { text: gunEtiketi(g.tarih, i) }), el("small", { text: g.tarih.slice(8, 10) + "." + g.tarih.slice(5, 7) })),
      el("span", { class: "hv-saat-ikon", "aria-hidden": "true", title: k.ad, text: k.ikon }),
      el("div", { class: "hv-gun-yagis" }, el("small", { class: g.yagisOlasi >= 40 ? "hv-mavi" : "", text: `%${g.yagisOlasi}` }), g.yagisToplam >= 0.1 ? el("small", { text: `${g.yagisToplam} mm` }) : null),
      el("div", { class: "hv-gun-aralik" }, el("small", { text: `${g.min}°` }), aralik, el("small", { text: `${g.max}°` })),
      el("small", { class: "hv-gun-ek", text: `💨 ${g.ruzgar}–${g.hamle} · UV ${g.uv}` }),
      el("small", { class: "hv-gun-giyim", text: giyimIpucu(g, d.tercih) }));
  });
  return el("div", { class: "hv-sekme-govde" }, kart("", bolumBasligi("10 günlük tahmin"), ipucu("Her günün altındaki öneri, o günün ortalama hissedilen sıcaklığı ve senin tercihlerinle hesaplanır."), ...satirlar));
}
