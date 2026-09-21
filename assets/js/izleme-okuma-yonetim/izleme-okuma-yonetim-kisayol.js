/*
 * assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js
 *
 * icerik/izlediklerim.md ve icerik/okuduklarim.md sayfalarının ikisine de
 * eklenen KÜÇÜK bir yardımcı: ziyaretçi 'owner' (Site Sahibi) olarak giriş
 * yapmışsa, tablonun üstüne "Buradan yeni kayıt ekle" butonunu gösterir.
 *
 * ÖNEMLİ: Bu script sadece bir KOLAYLIK/UX katmanıdır, güvenlik sınırı
 * DEĞİLDİR — buton görünmese bile URL'yi bilen biri doğrudan
 * /panel/dashboard.html#media-izleme adresine gidebilir, ama o sayfa kendi
 * requireAuth({role:'owner'}) kontrolünden geçer (bkz. izleme-okuma-
 * yonetim.js) ve arkasındaki Worker de AYRICA sunucu tarafında owner
 * kontrolü yapar (bkz. cloudflare worker/izleme_okuma_yonetim_worker/
 * worker.js). Yani owner olmayan biri bu butonu hiçbir şekilde göremez VE
 * URL'yi elle yazsa bile içeri giremez.
 *
 * Giriş yapmamış ya da owner olmayan ziyaretçiler için bu script hiçbir
 * DOM değişikliği yapmaz — sayfa öncekiyle birebir aynı kalır.
 *
 * BUG FİX (eski panel linki): bu buton eskiden bağımsız
 * /panel/izleme-okuma-yonetim.html sayfasına gidiyordu. O sayfa panel
 * birleştirmesiyle (bkz. panel/izleme-okuma-yonetim.md) SİLİNMEDİ, sadece
 * /panel/dashboard.html#media-izleme'ye yönlendiren ince bir yönlendirme
 * sayfasına dönüştü — yani eski link hâlâ ÇALIŞIR ama kullanıcıyı
 * gereksiz bir ara yönlendirme adımından geçirir. Buton artık doğrudan
 * birleşik panelin "İzleme ve Okuma Yönetimi" sekmesine gidiyor.
 */
import { supabase } from "../core/supabase-client.js";

async function init() {
  const container = document.getElementById("izleme-okuma-yonetim-kisayol");
  if (!container) return;

  // WEBVIEW UYUMLULUĞU: bu script sadece EKLEMELİ bir kolaylık katmanı —
  // hata durumunda sayfanın geri kalanını etkilememesi, sadece butonun
  // görünmemesiyle sonuçlanması gerekiyor (unhandled promise rejection
  // yerine).
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role !== "owner") return;

    const base = document.documentElement.dataset.baseurl || "";
    const a = document.createElement("a");
    a.href = base + "/panel/dashboard.html#media-izleme";
    // BUG FİX (CSP style-src ihlali): "Refused to apply a stylesheet..."
    // — a.style.cssText de, style="..." ATTRIBUTE'unu ayarlamakla AYNI
    // şeydir (CSP açısından ikisi de "inline style", plugin bunu
    // GÖREMEZ/hash'leyemez çünkü çalışma zamanında JS ile ekleniyor).
    // Sabit değerler artık assets/style.css'teki ".izleme-kisayol-btn"
    // sınıfına taşındı.
    a.className = "btn-primary izleme-kisayol-btn";
    a.textContent = "➕ Yeni Kayıt Ekle (Site Sahibi)";
    container.appendChild(a);
  } catch (err) {
    console.error("izleme-okuma-yonetim-kisayol.js başarısız (buton gösterilmeyecek):", err);
  }
}

init();
