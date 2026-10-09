/*
 * assets/js/sistem-yedek/yetki-paneli.js — Yetki Ayarları > "📦 Sistem Yedekleme" sekmesi (SADECE owner).
 * can_export_system anahtarı: owner her zaman yetkilidir; admin / manager / editor için buradan açılır/kapanır.
 * VARSAYILAN KAPALI. Gerçek sınır veritabanındadır (migration 0074 / 0075); bu dosya yalnızca arayüzdür.
 * innerHTML YOK, inline stil YOK (CSP).
 * -----------------------------------------------------------------------
 */
import { supabase, showMessage } from "../core/supabase-client.js";
import { el, hataMetni, tarihMetni } from "./ortak.js";

const ROLLER = {
  admin: { ad: "Yönetici (admin)", not: "Yalnızca KENDİ verilerini ve içerik/kod bileşenlerini alabilir." },
  manager: { ad: "İçerik Sorumlusu (manager)", not: "Yalnızca KENDİ verilerini ve içerik/kod bileşenlerini alabilir." },
  editor: { ad: "Yazar (editor)", not: "Yalnızca KENDİ verilerini ve içerik/kod bileşenlerini alabilir." },
};

async function kur() {
  const kok = document.getElementById("sy-izin-kok");
  const mesaj = document.getElementById("sy-izin-mesaj");
  if (!kok) return;

  const yukle = async () => {
    const { data, error } = await supabase.rpc("owner_sistem_export_yetkilerini_getir");
    if (error) {
      kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) }));
      return;
    }
    kok.replaceChildren(
      el("div", { class: "sy-kart" },
        el("div", { class: "sy-izin-satir" },
          el("div", {}, el("strong", { text: "Site Sahibi (owner)" }), el("p", { class: "muted", text: "Her zaman yetkili. Tüm sistemin felaket yedeğini alabilir." })),
          el("span", { class: "sy-rozet sy-rozet--iyi", text: "Her zaman açık" })
        ),
        ...(data || []).map((r) => {
          const kutu = el("input", { type: "checkbox", role: "switch", id: `sy-izin-${r.rol}`, "aria-label": `${ROLLER[r.rol]?.ad} için can_export_system` });
          kutu.checked = !!r.can_export_system;
          kutu.addEventListener("change", async () => {
            kutu.disabled = true;
            const { error: e } = await supabase.rpc("owner_sistem_export_yetkisi_ayarla", { p_rol: r.rol, p_izinli: kutu.checked });
            kutu.disabled = false;
            if (e) {
              kutu.checked = !kutu.checked;
              if (mesaj) showMessage(mesaj, hataMetni(e), "error");
              return;
            }
            if (mesaj) showMessage(mesaj, `${ROLLER[r.rol]?.ad}: dışa aktarma yetkisi ${kutu.checked ? "AÇILDI" : "kapatıldı"}.`, "success");
          });
          return el("div", { class: "sy-izin-satir" },
            el("label", { for: `sy-izin-${r.rol}` },
              el("strong", { text: ROLLER[r.rol]?.ad || r.rol }),
              el("p", { class: "muted", text: `${ROLLER[r.rol]?.not || ""}${r.updated_at ? ` · son değişiklik: ${tarihMetni(r.updated_at)}` : ""}` })
            ),
            kutu
          );
        })
      ),
      el("p", { class: "muted sy-not", text: "Yetki açık olsa bile veri izolasyonu veritabanında zorlanır: yönetici yalnızca KENDİ verilerini alabilir. Başka üyelerin verisini (seçili üyeler ya da 'Tüm sistem' yedeği) her koşulda yalnızca Site Sahibi alabilir; hiç kimse başkasının notlarını indiremez." })
    );
  };
  await yukle();
}

kur().catch((h) => {
  console.error("sistem-yedek/yetki-paneli.js:", h);
  const m = document.getElementById("sy-izin-mesaj");
  if (m) showMessage(m, `Panel yüklenemedi: ${h.message || h}`, "error");
});
