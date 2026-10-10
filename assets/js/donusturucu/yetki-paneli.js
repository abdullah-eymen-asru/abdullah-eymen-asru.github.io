/*
 * assets/js/donusturucu/yetki-paneli.js — Yetki Ayarları > "🔄 Dönüştürücü" sekmesi (SADECE owner; dashboard.js yükler).
 * innerHTML YOK, inline stil YOK (CSP).
 */
import { showMessage } from "../core/supabase-client.js";
import { yetkiPaneliniKur } from "./yetki-ortak.js";

const kok = document.getElementById("dn-izin-kok");
const mesaj = document.getElementById("dn-izin-mesaj");
if (kok) {
  yetkiPaneliniKur(kok, mesaj).catch((h) => {
    console.error("donusturucu/yetki-paneli.js:", h);
    if (mesaj) showMessage(mesaj, `Panel yüklenemedi: ${h.message || h}`, "error");
  });
}
