/*
 * assets/js/chat.js — GERİYE UYUMLULUK KATMANI.
 * Eski sürüm 1000+ satırdı ve wireAdminChat İKİ KEZ tanımlıydı (SyntaxError → mesajlaşma hiç açılmıyordu).
 * Tüm mantık assets/js/mesajlasma/ altına taşındı. Bu dosya yalnızca eski import'ların kırılmaması için kalır.
 */
export { rolEtiketi } from "./mesajlasma/veri.js";
export { mesajlasmaKur } from "./mesajlasma/arayuz.js";
import { mesajlasmaKur } from "./mesajlasma/arayuz.js";

export const wireUserChat = (profile, kok = document.getElementById("mesajlar-icerik")) => mesajlasmaKur(kok, { profile, adminMi: false });
export const wireAdminChat = (profile, kok = document.getElementById("mesajlar-icerik")) => mesajlasmaKur(kok, { profile: typeof profile === "object" ? profile : { id: profile, role: "admin" }, adminMi: true });
