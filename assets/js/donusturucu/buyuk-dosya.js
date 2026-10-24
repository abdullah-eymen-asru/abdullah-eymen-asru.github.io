/*
 * assets/js/donusturucu/buyuk-dosya.js — Büyük dosya eşikleri ve YEREL KOMUT SATIRI yönergeleri (Dönüştürücü + Belge Tarayıcı).
 * DÜRÜST MİMARİ NOTU: PDF/Word/görsel kütüphaneleri (pdf-lib, mammoth, canvas) belgenin TAMAMINI bellekte işler; bu yüzden bu iki araçta
 * sınır 250 MB'tır ve akış (Streams/OPFS) ile aşılamaz. Akışlı, belleğe okumayan işlem yalnızca Metadata Temizleyici'dedir
 * (metadata-temizleyici/motor.js). Bu dosya, sınırı aşan dosya için kullanıcıya doğru yerel aracı söyler; sessizce reddetmez.
 */
export const UYARI_ESIGI = 100 * 1024 * 1024;   // bu boyuttan büyük dosya: "tek tek işle" uyarısı

export function buyukDosyaUyarisi(ad, boyutMetni) {
  return `${ad} (${boyutMetni}) büyük: tarayıcı belleğini zorlayabilir. Tek tek işle; takılırsa “Belleği Güvenli Sıfırla”ya bas.`;
}

/** Dosya uzantısına göre sınırı aşan dosya için yerel komut önerisi (tek cümle). */
export function yerelYonerge(ad) {
  const u = (String(ad).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (["mp4", "mov", "m4v", "mkv", "avi", "webm", "m4a", "mp3", "wav", "flac"].includes(u)) return "Yerel araç: ffmpeg -i GIRIS -map_metadata -1 -c copy CIKIS (üst veri) · ffmpeg ile biçim dönüştürme.";
  if (u === "pdf") return "Yerel araç: qpdf --empty --pages a.pdf b.pdf -- birlesik.pdf (birleştirme) · gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -o kucuk.pdf giris.pdf (küçültme).";
  if (["doc", "docx", "odt", "rtf", "xls", "xlsx", "ppt", "pptx"].includes(u)) return "Yerel araç: soffice --headless --convert-to pdf DOSYA (LibreOffice).";
  if (["tif", "tiff", "png", "jpg", "jpeg", "webp", "bmp", "heic"].includes(u)) return "Yerel araç: vips copy GIRIS CIKIS.pdf  ya da  magick GIRIS -resize 50% CIKIS (libvips/ImageMagick).";
  return "Dosyayı yerel bir araçla (LibreOffice, qpdf, ffmpeg, ImageMagick) işle ya da parçalara böl.";
}
