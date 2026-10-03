/*
 * assets/js/r2-arsiv/izin-paneli.js — Yetki Ayarları > "R2 Erişim İzni" (SADECE owner)
 *
 * Gerçek yetki sunucuda: r2_arsiv_izin_ayarla / r2_arsiv_izin_kaldir RPC'leri
 * is_owner() ister; Worker her işlemde r2_arsiv_yetkisi() ile 403 üretir.
 * Bu dosya yalnızca arayüzdür. Kural: kullanıcıya özel kayıt rol kaydının önüne geçer;
 * kayıt yoksa varsayılan: owner tam, admin tam, diğer roller YOK.
 */
import { supabase } from "../core/supabase-client.js";
import { aliciSeciciKur } from "./alici-secici.js";

const ROLLER = [
  ["admin", "Admin"], ["manager", "İçerik Sorumlusu"], ["editor", "İçerik Editörü"],
  ["special_user", "Özel Üye"], ["user", "Üye"],
];
const ISLEMLER = [["oku", "Görüntüle/İndir"], ["yukle", "Yükle/Klasör"], ["sil", "Sil"]];
const VARSAYILAN = (rol) => (rol === "admin" ? { oku: true, yukle: true, sil: true } : { oku: false, yukle: false, sil: false });

function el(t, s, m) { const e = document.createElement(t); if (s) e.className = s; if (m != null) e.textContent = m; return e; }

async function basla() {
  const kok = document.getElementById("ra-izin-kok");
  if (!kok || kok.dataset.hazir) return;
  kok.dataset.hazir = "1";
  const mesaj = document.getElementById("ra-izin-mesaj");
  const goster = (m, hata = true) => { mesaj.textContent = m; mesaj.hidden = !m; mesaj.className = `auth-message ${hata ? "error" : "success"}`; };

  async function ciz() {
    const { data, error } = await supabase.rpc("r2_arsiv_izinlerini_getir");
    if (error) { kok.replaceChildren(el("p", "muted", "İzinler alınamadı (yalnızca Site Sahibi görebilir).")); return; }
    const roller = new Map(data.filter((s) => s.hedef_tur === "rol").map((s) => [s.hedef, s]));
    const kullanicilar = data.filter((s) => s.hedef_tur === "kullanici");

    const tablo = el("table", "ra-izin-tablo");
    const bas = el("tr"); bas.appendChild(el("th", "", "Rol / Kullanıcı"));
    ISLEMLER.forEach(([, e]) => bas.appendChild(el("th", "", e))); bas.appendChild(el("th", "", ""));
    const thead = el("thead"); thead.appendChild(bas); tablo.appendChild(thead);
    const tbody = el("tbody");

    const satir = (tur, hedef, etiket, deger, kayitVar) => {
      const tr = el("tr");
      const ilk = el("td", "", etiket);
      if (!kayitVar) ilk.appendChild(el("span", "ra-etiket-varsayilan", "  (varsayılan)"));
      tr.appendChild(ilk);
      const kutular = {};
      ISLEMLER.forEach(([anahtar, e]) => {
        const td = el("td"); const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!deger[anahtar]; cb.setAttribute("aria-label", `${etiket}: ${e}`);
        kutular[anahtar] = cb; td.appendChild(cb); tr.appendChild(td);
        cb.addEventListener("change", async () => {
          cb.disabled = true;
          const { error: hata } = await supabase.rpc("r2_arsiv_izin_ayarla", {
            p_tur: tur, p_hedef: hedef, p_oku: kutular.oku.checked, p_yukle: kutular.yukle.checked, p_sil: kutular.sil.checked,
          });
          cb.disabled = false;
          if (hata) { cb.checked = !cb.checked; return goster(hata.message || "Kaydedilemedi."); }
          goster("Kaydedildi.", false); ciz();
        });
      });
      const son = el("td");
      if (kayitVar) {
        const b = el("button", "ra-btn", tur === "rol" ? "Varsayılana dön" : "Kaldır"); b.type = "button";
        b.addEventListener("click", async () => {
          const { error: hata } = await supabase.rpc("r2_arsiv_izin_kaldir", { p_tur: tur, p_hedef: hedef });
          if (hata) return goster(hata.message || "Kaldırılamadı.");
          goster("Kaldırıldı.", false); ciz();
        });
        son.appendChild(b);
      }
      tr.appendChild(son); tbody.appendChild(tr);
    };

    ROLLER.forEach(([rol, etiket]) => {
      const kayit = roller.get(rol);
      satir("rol", rol, etiket, kayit || VARSAYILAN(rol), !!kayit);
    });
    kullanicilar.forEach((u) => satir("kullanici", u.hedef, `👤 ${u.ad}`, u, true));
    tablo.appendChild(tbody);

    // kullanıcı ekleme (ortak alıcı seçici: Türkçe-duyarsız, öneri listeli)
    const ekle = el("div", "ra-izin-ekle");
    ekle.appendChild(el("p", "ra-yardim", "Tek bir kişiye özel izin vermek ya da onu kısıtlamak için ara:"));
    aliciSeciciKur({
      kok: ekle, yerTutucu: "Kullanıcı ara (isim)…", anahtarGerekli: false,
      haric: () => new Set(kullanicilar.map((x) => x.hedef)),
      sec: async (u) => {
        if (u.rol === "owner") return goster("Site Sahibi zaten tam yetkilidir; kısıtlanamaz.");
        const { error: h } = await supabase.rpc("r2_arsiv_izin_ayarla", { p_tur: "kullanici", p_hedef: u.id, p_oku: true, p_yukle: false, p_sil: false });
        if (h) return goster(h.message || "Eklenemedi.");
        goster(`${u.ad} için kayıt eklendi (varsayılan: yalnızca görüntüleme).`, false); ciz();
      },
    });

    const kaydirma = el("div", "ra-izin-kaydirma"); kaydirma.appendChild(tablo);
    kok.replaceChildren(kaydirma, ekle);
  }
  ciz();
}

basla().catch((e) => console.error("izin-paneli.js:", e));
