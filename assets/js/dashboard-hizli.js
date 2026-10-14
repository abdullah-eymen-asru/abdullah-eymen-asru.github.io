/*
 * assets/js/dashboard-hizli.js — panel hızlı erişim: görünür "Hemen Çıkış Yap" + canlı okunmamış mesaj rozetleri.
 * dashboard.js tarafından, profil yüklendikten sonra TEK sefer çağrılır (hizliKur). Menü yeniden çizilirse rozetler
 * MutationObserver ile otomatik yeniden uygulanır. İstek maliyeti: okunmamis.js (1 RPC + 1 realtime kanalı).
 */
import { supabase } from "./core/supabase-client.js";
import { okunmamisBaslat, okunmamisDinle } from "./mesajlasma/okunmamis.js";

const MESAJ_ID = "users-mesajlar";

async function cikisYap(btn) {
  btn.disabled = true;
  try { await supabase.auth.signOut(); } catch (e) { console.error("signOut hatası (yine de yönlendiriliyor):", e); }
  finally { window.location.href = "/"; }
}

function cikisButonu(sinif) {
  const b = document.createElement("button");
  b.type = "button"; b.className = sinif; b.textContent = "⏻ Hemen Çıkış Yap";
  b.setAttribute("aria-label", "Oturumu hemen kapat");
  b.addEventListener("click", () => cikisYap(b));
  return b;
}

function rozet(sayi) {
  const s = document.createElement("span");
  s.className = "dash-rozet"; s.dataset.msjRozet = "1";
  s.textContent = sayi > 99 ? "99+" : String(sayi);
  s.setAttribute("aria-label", `${sayi} okunmamış mesaj`);
  return s;
}

function uygula(sayi) {
  document.querySelectorAll("[data-msj-rozet]").forEach((e) => e.remove());
  const nokta = document.getElementById("dash-nav-toggle-nokta");
  if (nokta) nokta.hidden = sayi === 0;
  if (!sayi) return;
  // Menüdeki "Sohbet / Mesajlar" satırı + (kapalıysa bile görünsün diye) bağlı grup başlığı
  const link = document.querySelector(`#dash-nav a[data-view-id="${MESAJ_ID}"]`);
  link?.append(rozet(sayi));
  const grup = link?.closest(".dash-nav-group-items")?.previousElementSibling;
  grup?.querySelector(".dash-nav-group-label")?.append(rozet(sayi));
  // Ana Ekran kartı + Hızlı erişimdeki tekrarlar
  document.querySelectorAll(`.hub-kart[data-hub-id="${MESAJ_ID}"] strong, .hub-kart[data-hub-id="${MESAJ_ID}"] .hub-kart-baslik`).forEach((e) => e.append(rozet(sayi)));
}

export function hizliKur() {
  // 1) Kenar çubuğu: ad/rol'ün hemen altında, menünün DIŞINDA, her zaman görünür.
  const head = document.querySelector(".dash-sidebar-head");
  if (head && !head.querySelector(".dash-hizli-cikis")) head.append(cikisButonu("dash-hizli-cikis"));
  // 2) Mobil üst şerit: kenar çubuğu kapalıyken de tek dokunuşla çıkış.
  const bar = document.getElementById("dash-topbar");
  if (bar && !bar.querySelector(".dash-hizli-cikis")) bar.append(cikisButonu("dash-hizli-cikis dash-hizli-cikis--bar"));
  // 3) Hamburger üstünde okunmamış noktası (menü kapalıyken bile dikkat çeksin)
  const tog = document.getElementById("dash-nav-toggle");
  if (tog && !document.getElementById("dash-nav-toggle-nokta")) {
    const n = document.createElement("span"); n.id = "dash-nav-toggle-nokta"; n.className = "dash-nokta"; n.hidden = true; n.setAttribute("aria-hidden", "true");
    tog.classList.add("dash-nav-toggle--rozetli"); tog.append(n);
  }
  okunmamisBaslat().catch(() => {});
  let son = 0;
  okunmamisDinle((s) => { son = s; uygula(s); });
  // Menü/Ana Ekran yeniden çizildiğinde rozetleri geri koy (çizim bitince tek sefer).
  let t = null;
  new MutationObserver((kayit) => {
    if (kayit.every((k) => [...k.addedNodes, ...k.removedNodes].every((n) => n.nodeType === 1 && n.matches?.("[data-msj-rozet]")))) return;
    clearTimeout(t); t = setTimeout(() => uygula(son), 120);
  }).observe(document.querySelector(".dash-shell") || document.body, { childList: true, subtree: true });
}
