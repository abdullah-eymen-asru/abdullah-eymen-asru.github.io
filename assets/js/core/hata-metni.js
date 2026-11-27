/* assets/js/core/hata-metni.js — Kullanıcıya gösterilecek hata metnini KAYNAKTA Türkçeleştirir.
 * Kullanım: catch (h) { bildir(hata(h, "Kaydedilemedi.")); }
 *  • Ham/teknik ayrıntı yalnızca konsola gider (console.error); ekrana asla ham İngilizce/SQL metni çıkmaz.
 *  • Veritabanı/RPC'nin bilerek yazılmış kısa Türkçe mesajları (ör. "Yetkisiz işlem.") olduğu gibi gösterilir.
 *  • Başka her şey için sade bir Türkçe karşılık (ya da verilen varsayılan metin) döner. */
const KURALLAR = [
  [/failed to fetch|networkerror|load failed|network request failed|err_internet|fetch failed/i, "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene."],
  [/user aborted a request|signal is aborted|aborterror|aborted without reason|timeout|timed out/i, "Sunucu geç yanıt verdi. Lütfen tekrar dene."],
  [/row-level security|permission denied|\b42501\b|not authorized|unauthorized|forbidden|insufficient.?privilege|new row violates/i, "Bu işlem için yetkin yok."],
  [/jwt expired|invalid jwt|jwt (is )?malformed|invalid refresh token|refresh token not found|not authenticated|invalid login/i, "Oturumun süresi dolmuş olabilir. Yeniden giriş yap."],
  [/duplicate key value|violates unique constraint|\b23505\b|already exists|already registered/i, "Bu kayıt zaten var."],
  [/violates foreign key|\b23503\b/i, "Bu kayıt başka bir kayda bağlı olduğu için işlem yapılamadı."],
  [/could not find the function|schema cache|\bPGRST\d+\b|\b42P01\b|\b42883\b|\b42703\b|relation .* does not exist|column .* does not exist|function .* does not exist|migration/i, "Bu özellik şu an kullanılamıyor. Lütfen daha sonra tekrar dene."],
  [/internal server error|bad gateway|service unavailable|\b(status|http|error)[ :]*5\d\d\b/i, "Sunucuda geçici bir sorun var. Biraz sonra tekrar dene."],
  [/not found|\b404\b/i, "İstenen içerik bulunamadı."],
  [/too many requests|rate limit|\b429\b/i, "Çok fazla istek gönderdin. Biraz bekleyip tekrar dene."],
  [/unexpected token|is not valid json|unexpected end of json|json/i, "Sunucudan beklenmeyen bir yanıt geldi. Tekrar dene."],
  [/\bundefined\b|\[object object\]|\bnull\b is not|cannot read propert|is not a function|is not defined/i, "İşlem tamamlanamadı. Lütfen tekrar dene."]
];
const TR_KARAKTER = /[çğıöşüÇĞİÖŞÜ]/;
const TR_KELIME = /\b(yetkisiz|işlem|lütfen|geçersiz|bulunamadı|gerekli|başarısız|kullanıcı|dosya|yönetici|değil|için|yok|kadar|olamaz|olmalı|seç|yaz|gir|boş|zaten|önce|sonra|tekrar|oturum|hata)\b/i;
const VARSAYILAN = "İşlem tamamlanamadı. Lütfen tekrar dene.";

export function hata(h, varsayilan) {
  const ham = typeof h === "string" ? h : String((h && (h.kullaniciMesaji || h.message)) || "");
  try { console.error("Teknik ayrıntı:", h); } catch (_) { /* yok say */ }
  if (h && h.kullaniciMesaji) return String(h.kullaniciMesaji);
  const ad = h && h.name;
  if (ad === "AbortError" || ad === "TimeoutError") return "Sunucu geç yanıt verdi. Lütfen tekrar dene.";
  if (ham && ham.length <= 220 && !/[{}<>]|\bat\s+\S+:\d+/.test(ham) && (TR_KARAKTER.test(ham) || TR_KELIME.test(ham)) && !/relation|column|function|schema|\bPGRST|row-level|violates|migration/i.test(ham)) return ham;
  for (const [re, tr] of KURALLAR) if (re.test(ham)) return tr;
  return varsayilan || VARSAYILAN;
}
export default hata;
