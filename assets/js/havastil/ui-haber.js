/**
 * ui-haber.js — "Resmî uyarılar" sekmesi. SADE: kullanıcıya teknik süzgeç/kaynak ayrıntısı değil, şu üç şey gösterilir:
 *   (1) Bugün BURASI için giyimi etkileyen bir uyarı var mı?  (2) Kim söylüyor, ne zaman?  (3) Ne yapmalı + hava verisi teyit ediyor mu?
 * Teknik ayrıntı (hangi kaynak çalıştı, kaç haber elendi) yalnızca Ayarlar › Teşhis'tedir.
 */
import { el, rozet, etiket, ipucu, kart, bolumBasligi, olay, isoZamanOnce, zamanOnce } from "./ui-temel.js";
import { seviyeAdi } from "./taktik.js";

const HATA_METNI = {
  worker_kapali: "Haber servisi şu an kapalı (kota koruması). Hava ve giyim önerisi etkilenmez.",
  yetkisiz: "Haber servisine erişim yetkin yok.",
  oturum_yok: "Oturum bulunamadı; haber kontrolü yapılamadı.",
  hiz_siniri: "Haber servisi çok sık istendi; birazdan kendiliğinden yenilenecek.",
  ulasilamadi: "Haber servisine şu an ulaşılamıyor. Hava ve giyim önerisi etkilenmez.",
};
const GUVEN = { resmi: ["🏛️", "Resmî kurum"], ajans: ["📰", "Haber ajansı"], genel: ["🗞️", "Haber sitesi"] };
const VERI = { uyusuyor: ["✅", "Hava verisi de bunu gösteriyor"], celisiyor: ["⚠️", "Hava verisi farklı gösteriyor"], belirsiz: ["〰️", "Hava verisi kısmen destekliyor"], olculemiyor: ["➖", "Hava verisiyle kıyaslanamadı"] };

function kapsamMetni(u) {
  const a = u.kapsamAd;
  return u.kapsam === "sokak" ? `${a} sokağını anıyor` : u.kapsam === "mahalle" ? `${a} mahallesini anıyor` : u.kapsam === "ilce" ? `${a} ilçesini anıyor` : u.kapsam === "il" ? `${a} için` : u.kapsam === "bolge" ? `${a} bölgesi için` : `${a} geneli için`;
}

export function haberSekmesi(d, kb) {
  const h = d.haber;
  const yenile = olay(el("button", { type: "button", class: "hv-btn hv-btn-ince", text: "↻ Yenile" }), "click", () => kb.haberYenile(true));
  if (!d.haberAcik) return el("div", { class: "hv-sekme-govde" }, kart("", bolumBasligi("Resmî uyarılar"), ipucu("Haber doğrulama kapalı. Ayarlar'dan açabilirsin; açmak konumunu sunucuya göndermez.")));
  if (!h) return el("div", { class: "hv-sekme-govde" }, kart("", bolumBasligi("Resmî uyarılar", yenile), ipucu("🛰️ Haberler kontrol ediliyor…")));
  if (h.durum !== "ok" && h.durum !== "temiz") return el("div", { class: "hv-sekme-govde" }, kart("", bolumBasligi("Resmî uyarılar", yenile), ipucu(HATA_METNI[h.durum] || "Haberler kontrol edilemedi.")));

  const uygulanan = h.uygulananlar.length;
  const yer = d.konum.ilce || d.konum.il || d.konum.adEn || d.konum.ad;
  const durum = h.durum === "temiz"
    ? ["✅", `${yer} için bugün giyimi etkileyen bir uyarı yok`, "Resmî kurum ve haber kaynaklarında bu konuma ait güncel bir hava uyarısı bulunamadı."]
    : uygulanan ? ["⚠️", `${yer} için ${uygulanan} uyarı kombinine uygulandı`, "Aşağıdaki uyarılar seçimini ve önerileri şimdiden etkiliyor."]
      : ["ℹ️", `${yer} için haber var ama uygulanmadı`, "Haberler hava verisiyle uyuşmadığı için kombinine yansıtılmadı."];
  const ust = kart("hv-haber-durum",
    el("span", { class: "hv-haber-durum-ikon", "aria-hidden": "true", text: durum[0] }),
    el("div", {}, el("strong", { text: durum[1] }), el("p", { class: "hv-ipucu", text: durum[2] }), el("small", { class: "hv-ipucu", text: `${zamanOnce(h.guncelleme)} güncellendi${h.eski ? " · çevrimdışı, son bilinen" : ""}` })),
    yenile);

  const kartlar = h.uyarilar.map((u) => {
    const [gi, ga] = GUVEN[u.guvenilirlik];
    const ana = u.dogrulamalar.find((x) => x.durum === u.veriDurumu) || u.dogrulamalar[0];
    const [vi, va] = VERI[u.veriDurumu] || VERI.olculemiyor;
    return kart(`hv-haber-kart${u.uygulandi ? " uygulandi" : ""}`,
      el("div", { class: "hv-haber-ust" }, rozet(`${gi} ${ga}: ${u.kurum || u.kaynakAd}`), el("small", { class: "hv-ipucu", text: isoZamanOnce(u.yayin) })),
      el("p", { class: "hv-haber-baslik" }, u.link ? el("a", { href: u.link, target: "_blank", rel: "noopener noreferrer", text: u.baslik }) : el("span", { text: u.baslik })),
      el("p", { class: "hv-ipucu", text: `📍 ${kapsamMetni(u)}${u.kismenGelecek ? " · yarına da sarkıyor" : ""}` }),
      el("div", { class: "hv-parca-cipleri" }, ...u.kurallar.map((k) => rozet(`${k.ikon} ${k.etiket}${k.seviye !== "uyari" ? ` · ${seviyeAdi(k.seviye)}` : ""}`, k.seviye === "kirmizi" ? "hv-rozet-yasak" : "hv-rozet-onemli"))),
      el("div", { class: "hv-ne-yapmali" }, etiket("Ne yapmalı?"), el("p", { text: u.kurallar.map((k) => kb.kuralKisa(k.id)).join(" ") })),
      el("p", { class: "hv-ipucu", text: `${vi} ${va}${ana?.metin ? ` — ${ana.metin.replace(/^Hava verisi(yle uyuşuyor| farklı gösteriyor)?\s*/, "")}` : ""}` }),
      u.kaynakSayisi >= 2 ? el("p", { class: "hv-ipucu", text: `🔁 ${u.kaynakSayisi} farklı kaynak aynı olayı bildiriyor.` }) : null,
      rozet(u.uygulandi ? "✔ Kombine uygulandı" : "Uygulanmadı", u.uygulandi ? "hv-rozet-ok" : ""));
  });

  const notlar = el("div", { class: "hv-kucuk-not" },
    h.havuz === "dunya" ? ipucu("🌍 Türkiye dışı konumlarda yalnızca büyük hava olayları (BBC, Al Jazeera, DW vb. uluslararası kaynaklardan) görünür; yerel uyarılar için ulusal meteoroloji kurumuna bak.") : null,
    d.konum.gps && !d.konum.ulke && !d.konum.il ? ipucu("Cihaz konumunun ilini/şehrini bulamadım; haber eşleştirmesi için üstteki arama kutusundan şehri seç.") : null,
    ipucu("Burada yalnızca BUGÜNÜ ilgilendiren, bulunduğun yeri anan ve giyimi etkileyen haberler gösterilir. Soru işaretli/sansasyonel başlıklar ve eski ya da gelecek günlere ait haberler otomatik ayıklanır. Konumun hiçbir sunucuya gönderilmez."));
  return el("div", { class: "hv-sekme-govde" }, ust, ...kartlar, notlar);
}
