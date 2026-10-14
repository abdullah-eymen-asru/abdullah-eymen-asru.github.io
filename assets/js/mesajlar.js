/*
 * assets/js/mesajlar.js — /panel/dashboard.html "Sohbet / Mesajlar" sekmesi (ve eski /panel/mesajlar.html).
 * 2026-10 YENİLEME: arayüz assets/js/mesajlasma/ altına taşındı (E2EE, çöp kutusu, arama, sabitleme, okunmamış rozeti).
 * Eski chat.js'te wireAdminChat İKİ KEZ tanımlıydı → modül SyntaxError ile hiç yüklenmiyor, sekme "açılmıyor"du.
 * Üye ve yönetici artık AYNI birleşik arayüzü kullanır; rol farkı yalnızca "yeni sohbet" akışındadır.
 */
import { requireAuthOrShowError } from "./auth/auth-guard.js";
import { mesajlasmaKur } from "./mesajlasma/arayuz.js";

async function init() {
  const { session, profile } = await requireAuthOrShowError({ role: null });
  document.getElementById("loading")?.setAttribute("hidden", "");
  const app = document.getElementById("app"); if (app) app.hidden = false;

  const icerik = document.getElementById("mesajlar-icerik");
  const aciklama = document.getElementById("mesajlar-aciklama");
  const adminMi = profile.role === "admin" || profile.role === "owner";
  if (aciklama) aciklama.textContent = adminMi
    ? "Üyelerin sana gönderdiği tüm konuşmalar burada. Mesajlar uçtan uca şifrelidir; “Yeni mesaj” ile gruptan kişi seçebilirsin."
    : "Site yöneticisiyle yazışabilirsin — farklı konularda istediğin kadar ayrı sohbet açabilirsin. Mesajların uçtan uca şifrelidir.";

  // Bağımsız /panel/mesajlar.html'de admin için "Admin Paneline Dön" bağlantısı (dashboard içinde gösterilmez).
  if (adminMi && !document.querySelector(".dash-shell")) {
    const baslikWrap = document.querySelector(".mesajlar-baslik");
    if (baslikWrap && !document.getElementById("mesajlar-admin-geri-btn")) {
      const a = document.createElement("a");
      a.id = "mesajlar-admin-geri-btn"; a.className = "btn-secondary uya-geri-btn"; a.href = "/panel/admin.html"; a.textContent = "← Admin Paneline Dön";
      baslikWrap.appendChild(a);
    }
  }

  const konuOnDolgu = new URLSearchParams(window.location.search).get("konu") || "";
  try {
    await mesajlasmaKur(icerik, { profile: { ...profile, id: session.user.id }, adminMi, konuOnDolgu });
  } catch (err) {
    console.error("mesajlar.js: arayüz kurulamadı:", err);
    const p = document.createElement("p");
    p.className = "msj-bos";
    p.textContent = "Sohbetler yüklenemedi. Sayfayı yenilemeyi dene.";
    icerik.replaceChildren(p);
  }
}
init();
