/*
 * assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js
 *
 * icerik/izlediklerim.md ve icerik/okuduklarim.md sayfalarının ikisine de
 * eklenen KÜÇÜK bir yardımcı: ziyaretçi 'owner' (Site Sahibi) olarak giriş
 * yapmışsa, tablonun üstüne "Buradan yeni kayıt ekle" butonunu gösterir.
 *
 * ÖNEMLİ: Bu script sadece bir KOLAYLIK/UX katmanıdır, güvenlik sınırı
 * DEĞİLDİR — buton görünmese bile URL'yi bilen biri doğrudan
 * /panel/izleme-okuma-yonetim.html adresine gidebilir, ama o sayfa kendi
 * requireAuth({role:'owner'}) kontrolünden geçer (bkz. o dosya) ve
 * arkasındaki Worker de AYRICA sunucu tarafında owner kontrolü yapar
 * (bkz. cloudflare worker/izleme_okuma_yonetim_worker/worker.js). Yani
 * owner olmayan biri bu butonu hiçbir şekilde göremez VE URL'yi elle
 * yazsa bile içeri giremez.
 *
 * Giriş yapmamış ya da owner olmayan ziyaretçiler için bu script hiçbir
 * DOM değişikliği yapmaz — sayfa öncekiyle birebir aynı kalır.
 */
import { supabase } from "../core/supabase-client.js";

async function init() {
  const container = document.getElementById("izleme-okuma-yonetim-kisayol");
  if (!container) return;

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
  a.href = base + "/panel/izleme-okuma-yonetim.html";
  a.className = "btn-primary";
  a.style.cssText = "width:auto; display:inline-block; text-decoration:none; margin-bottom:14px;";
  a.textContent = "➕ Yeni Kayıt Ekle (Site Sahibi)";
  container.appendChild(a);
}

init();
