/**
 * bildirim.js — Saat bazlı HavaStil uyarıları.
 * Kullanıcı birden çok uyarı tanımlar: saat + gün(ler) + tür ("günlük öneri" ya da "yalnızca uyarı varsa").
 * ÇALIŞMA MODELİ (dürüst sınır): statik sitede sunucusuz arka plan push YOKTUR. Uyarılar HavaStil sekmesi/PWA açıkken (arka planda açık kalsa bile)
 * saatinde, kapalıyken uygulama bir sonraki açılışta "kaçırılan uyarı" olarak (3 saat içindeyse) gösterilir. Kesin saatte kapalıyken bildirim için
 * sunucu tarafı Web Push gerekir (rehber/07 › Bilinen sınırlar).
 */
const LS_UYARI = "hv_uyarilar", LS_SON = "hv_uyari_son";
export const GUN_ADLARI = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];   // ISO 1..7
const OKU = (k, v) => { try { return JSON.parse(localStorage.getItem(k)) ?? v; } catch { return v; } };
const YAZ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depo kapalı */ } };

export const uyarilariOku = () => OKU(LS_UYARI, []).filter((u) => u && /^\d{2}:\d{2}$/.test(u.saat)).slice(0, 8);
export const uyarilariKaydet = (l) => YAZ(LS_UYARI, l.slice(0, 8));
export const yeniUyari = (saat = "07:30") => ({ id: `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`, saat, gunler: [1, 2, 3, 4, 5, 6, 7], tur: "oneri", acik: true });

export function bildirimDestegi() {
  if (typeof Notification === "undefined") return { destek: false, sebep: "Bu tarayıcı bildirimleri desteklemiyor." };
  return { destek: true, izin: Notification.permission };
}
export async function izinIste() { try { return await Notification.requestPermission(); } catch { return Notification.permission; } }

export async function bildirimGoster(baslik, govde, etiket = "havastil") {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) return void (await reg.showNotification(baslik, { body: govde, icon: "/panel/havastil/ikon-192.png", badge: "/panel/havastil/ikon-192.png", tag: etiket }));
  } catch { /* düşer */ }
  try { new Notification(baslik, { body: govde, tag: etiket }); } catch { /* yok say */ }
}

const pad = (n) => String(n).padStart(2, "0");
const yerelTarih = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoGun = (d) => (d.getDay() === 0 ? 7 : d.getDay());

/** Şu an tetiklenmesi gereken (bugün, saati geçmiş, 3 saat içinde, henüz gösterilmemiş) uyarılar */
export function vadesiGelenler(liste, simdi = new Date(), son = OKU(LS_SON, {})) {
  const bugun = yerelTarih(simdi), dk = simdi.getHours() * 60 + simdi.getMinutes();
  return liste.filter((u) => {
    if (!u.acik || !u.gunler.includes(isoGun(simdi)) || son[u.id] === bugun) return false;
    const [h, m] = u.saat.split(":").map(Number), hedef = h * 60 + m;
    return dk >= hedef && dk - hedef <= 180;
  }).map((u) => ({ ...u, gecikmeDk: dk - (Number(u.saat.slice(0, 2)) * 60 + Number(u.saat.slice(3))) }));
}
export function gosterildiIsaretle(id, simdi = new Date()) { const s = OKU(LS_SON, {}); s[id] = yerelTarih(simdi); YAZ(LS_SON, s); }

/** Bir sonraki uyarının zamanı (ekranda "Sonraki: yarın 07:30" için) */
export function sonrakiUyari(liste, simdi = new Date()) {
  let en = null;
  for (let g = 0; g < 8; g++) {
    const gun = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate() + g);
    for (const u of liste.filter((x) => x.acik && x.gunler.includes(isoGun(gun)))) {
      const [h, m] = u.saat.split(":").map(Number);
      const t = new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), h, m);
      if (t > simdi && (!en || t < en.t)) en = { u, t };
    }
    if (en) break;
  }
  return en;
}
export function zamanEtiketi(t, simdi = new Date()) {
  const fark = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate())) / 864e5);
  return `${fark === 0 ? "bugün" : fark === 1 ? "yarın" : ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"][t.getDay()]} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/**
 * Zamanlayıcı: 30 sn'de bir ve sekme görünür olunca kontrol eder.
 * @param {() => ({baslik:string, govde:string, uyariVar:boolean}|null)} icerikUret  güncel kombin/uyarıdan metin (veri yoksa null)
 * @returns {() => void} durdur
 */
export function zamanlayiciBaslat(icerikUret) {
  let bitti = false;
  const kontrol = async () => {
    if (bitti || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const liste = uyarilariOku();
    if (!liste.length) return;
    const gelenler = vadesiGelenler(liste);
    if (!gelenler.length) return;
    const ic = icerikUret();
    if (!ic) return;
    for (const u of gelenler) {
      gosterildiIsaretle(u.id);
      if (u.tur === "yalniz_uyari" && !ic.uyariVar) continue;
      await bildirimGoster(`${u.gecikmeDk > 5 ? "⏰ Kaçırılan uyarı · " : ""}${ic.baslik}`, ic.govde, `havastil-${u.id}`);
    }
  };
  const aralik = setInterval(kontrol, 30000);
  const gorunur = () => { if (!document.hidden) kontrol(); };
  document.addEventListener("visibilitychange", gorunur);
  setTimeout(kontrol, 3000);
  return () => { bitti = true; clearInterval(aralik); document.removeEventListener("visibilitychange", gorunur); };
}
