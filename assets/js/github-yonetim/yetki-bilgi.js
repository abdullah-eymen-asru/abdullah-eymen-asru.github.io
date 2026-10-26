/*
 * assets/js/github-yonetim/yetki-bilgi.js — Yetki Ayarları matrisi: her özellik için bilgilendirme kartı.
 * Satırdaki ⓘ düğmesine tıklayınca (ya da üzerine gelince/odaklanınca) açılır: ne işe yarar, neyi açar/kapatır, kime verilmeli, riskleri.
 * Bu metinler YALNIZCA açıklamadır; yetkinin gerçek denetimi sunucuda (RLS/RPC) yapılır.
 * Yeni özellik katalogu eklenince buraya da bir girdi ekle (yoksa genel bir kart gösterilir).
 */
export const YETKI_BILGI = {
  profil_fotografi: { ne: "Anasayfadaki profil fotoğrafını yükleme ve silme.", acar: "Panelde profil fotoğrafı yükleme/silme düğmeleri; fotoğraf deposuna yazma.", kime: "Yalnızca Yönetici (Admin). Site kimliğini temsil ettiği için başka role gerek yok.", risk: "Yanlış/uygunsuz fotoğraf herkese açık anasayfada görünür." },
  hakkimda_duzenleme: { ne: "Anasayfadaki TR/EN “Hakkımda” metni ve üst başlığı düzenleme.", acar: "Hakkımda düzenleme formu ve kaydet düğmesi.", kime: "Yalnızca Yönetici (Admin).", risk: "Herkese açık içerik değişir; hatalı kayıt anasayfada hemen görünür." },
  baglanti_yonetimi: { ne: "Anasayfadaki sosyal/akademik bağlantı düğmelerini (GitHub, LinkedIn, Google Scholar, ORCID…) ekleme, düzenleme, silme.", acar: "Bağlantılar yönetim bölümü.", kime: "Yalnızca Yönetici (Admin).", risk: "Kötü niyetli/yanlış bir bağlantı ziyaretçileri yönlendirir (kimlik avı riski)." },
  cv_yonetimi: { ne: "CV PDF’i yükleme, dış bağlantı kaydetme ve kaldırma.", acar: "CV yönetim kartı ve yükleme düğmeleri.", kime: "Yalnızca Yönetici (Admin).", risk: "CV’deki kişisel bilgiler herkese açıktır; eski sürüm kalabilir." },
  ozel_icerik_yonetimi: { ne: "Özel (gizli) içerik ekleme/düzenleme/silme ve üyelere erişim atama/kaldırma.", acar: "“Özel İçerik Ekle/Düzenle”, “Mevcut Özel İçerikler” (silme dahil) ve erişim atama bölümleri.", kime: "Güvenilen yönetim/içerik ekibi (Yönetici, İçerik Sorumlusu, Yazar). Üye/Özel Üye için KAPALI kalmalı.", risk: "Gizli içeriğe kimin erişeceğini belirler; yanlış atama gizli içeriği sızdırır." },
  dosya_paylasimi_yonetimi: { ne: "R2 dosyaları için paylaşım bağlantısı oluşturma.", acar: "Dosya yöneticisindeki “paylaş” eylemleri.", kime: "Yalnızca tam güvenilen roller. Bağlantı, erişim ataması aranmadan HERHANGİ bir dosyaya erişim sağlayabilir.", risk: "YÜKSEK: yanlış dosya paylaşılırsa bağlantıya sahip herkes görebilir." },
  yazi_ekleme: { ne: "Yeni yazı/proje oluşturma.", acar: "Yeni içerik ekle formu ve yayın düğmesi.", kime: "Yönetici, İçerik Sorumlusu, Yazar.", risk: "Yanlış içerik herkese açık sitede yayımlanabilir; GitHub deposuna commit atılır." },
  yazi_duzenleme: { ne: "Mevcut yazı/projeleri düzenleme.", acar: "Tüm yazılar listesindeki düzenle eylemi.", kime: "Yönetici, İçerik Sorumlusu; Yazar yalnızca güvenilirse.", risk: "Başkasının içeriğini bozma ihtimali; geri almak için depo geçmişi gerekir." },
  yazi_silme: { ne: "Yazı/proje silme.", acar: "Silme düğmeleri ve toplu silme.", kime: "Yalnızca Yönetici / İçerik Sorumlusu. Yazara genelde verilmez.", risk: "YÜKSEK: içerik depodan kalkar; geri dönüş yalnızca depo geçmişinden olur." },
  klasor_yonetimi: { ne: "Klasör oluşturma ve silme.", acar: "Klasör ekle/sil eylemleri.", kime: "Yönetici, İçerik Sorumlusu.", risk: "Klasör silme içindeki dosyaları etkileyebilir; önce yedek alın." },
  notlar_modulu: { ne: "Notlarım: uçtan uca şifreli kişisel not sistemi.", acar: "Notlarım menüsü, not kasası, alıntı ve ekler.", kime: "Güvendiğiniz üyeler. Notlar kullanıcıya özeldir; yönetici okuyamaz.", risk: "Kasa parolası unutulursa notlar kurtarılamaz; depolama kotası kullanılır." },
  akademik_kutuphane: { ne: "Akademik Kütüphane: kaynaklar, PDF’ler ve akademik notlar.", acar: "Kütüphane ve ilgili alt araçlar.", kime: "Akademik çalışma yapan güvenilir üyeler/ekip.", risk: "PDF’ler depolama (R2) kotasını tüketir; telifli dosya yükleme sorumluluğu doğar." },
  akademik_eklentiler: { ne: "Akademik okuyucu eklentileri: PDF'te metin seçince çeviri, sözlük, Vikipedi özeti, künye bulma ve arama bağlantıları.", acar: "Okuyucu seçim balonunda eklenti düğmeleri ve Kütüphane'de “Okuyucu eklentileri” ayar paneli.", kime: "Akademik kütüphaneyi kullanan herkes.", risk: "Düşük: dış kod çalıştırmaz, depolama kotası kullanmaz. Seçili metin, ücretsiz genel servislere (çeviri/sözlük/Vikipedi/Crossref) gönderilir; gizli belgelerde kapatılabilir." },
  donusturucu: { ne: "Dönüştürücü, Belge Tarayıcı ve sıkıştırma araçları (tamamen tarayıcıda çalışır).", acar: "Araçlar menüsündeki Dönüştürücü & Editör ile Belge Tarayıcı & Birleştirici.", kime: "Genelde tüm güvenilir roller; sunucu maliyeti yoktur.", risk: "Düşük: işlem kullanıcının cihazında yapılır; çok büyük dosyada tarayıcı belleği zorlanabilir." },
  sistem_yedek: { ne: "Sistem Yedekleme: veritabanı, dosyalar ve içeriğin dışa aktarılması.", acar: "Yedekleme & Verilerim ekranında sistem/tam yedek seçenekleri.", kime: "Yalnızca Yönetici. Tam yedek tüm kullanıcıların verisini (şifreli mesajlar dahil) içerir.", risk: "YÜKSEK: yedek dosyası sızarsa tüm kullanıcı verisi risk altına girer; güvenli saklayın." },
  havastil: { ne: "HavaStil: hava durumu (saatlik, 10 günlük, hava kalitesi), CLO tabanlı kombin/ek öneri, saat bazlı uyarılar ve isteğe bağlı resmî uyarı doğrulaması.", acar: "Araçlar menüsünde HavaStil sekmesi ve /panel/havastil/ (telefona kurulabilir) sayfası; haber havuzu ve isteğe bağlı yapay zekâ yorumu (havastil-worker).", kime: "Varsayılan KAPALI; yalnızca Site Sahibi. Gerekli görülen güvenilir rollere açılır.", risk: "Düşük–orta: hava verisi tarayıcıdan Open-Meteo’ya gider (IP görünür). Konum kaydetme/hesapta saklama üyenin isteğine bağlıdır (varsayılan kapalı; KVKK § 7/A). Yapay zekâ modu (varsayılan kapalı) Groq kotası kullanır." },
  havastil_groq_kota: { ne: "HavaStil yapay zekâ (Groq) kota ve istek sayacını görüntüleme: bugün/ay kaç istek, kalan kota yüzdesi, harcanan token.", acar: "HavaStil › Veri Doğrulama sayfasının en altında “🤖 Groq AI Kota & İstek Takibi” kutusu.", kime: "Varsayılan KAPALI. Site Sahibi her zaman görür; yalnızca Yönetici için açılabilir. Normal kullanıcı, demo ve misafir göremez.", risk: "Düşük: yalnızca sayısal kullanım verisidir; anahtar veya kullanıcı verisi içermez." },
  hesap_silme_onayi: { ne: "Silinen hesapların artık verisini (dosya/kayıt) inceleme ve temizleme.", acar: "“Silinen Hesap Verileri” ekranı ve temizleme eylemleri.", kime: "Yalnızca Site Sahibi/Yönetici.", risk: "YÜKSEK: yanlış temizleme geri döndürülemez; KVKK silme taleplerini etkiler." },
};

const GENEL = { ne: "Bu özellik için ayrıntılı açıklama henüz yazılmadı.", acar: "Satırın açıklamasındaki modül ve düğmeler.", kime: "Yalnızca güvendiğiniz roller.", risk: "Yetkiyi vermeden önce satır açıklamasını okuyun." };

/** @param {HTMLElement} kok  Matrisi içeren kapsayıcı (olay yetkilendirme: yeniden çizimde tekrar bağlamaya gerek yok). */
export function yetkiBilgiKur(kok, katalog) {
  if (kok._yaBilgiKuruldu) return; kok._yaBilgiKuruldu = true;
  let kart = null; let acikBtn = null; let sabit = false; let zaman = null;
  const kapat = () => { kart?.remove(); kart = null; acikBtn?.setAttribute("aria-expanded", "false"); acikBtn = null; sabit = false; };
  const satir = (b, ad, metin) => { const p = document.createElement("p"); const s = document.createElement("strong"); s.textContent = ad + " "; p.append(s, document.createTextNode(metin)); b.append(p); };
  function ac(btn) {
    clearTimeout(zaman);
    if (acikBtn === btn && kart) return;
    kapat();
    const anahtar = btn.dataset.yaBilgi;
    const o = katalog.find((x) => x.anahtar === anahtar);
    const b = YETKI_BILGI[anahtar] || GENEL;
    kart = document.createElement("div");
    kart.className = "ya-bilgi-karti"; kart.setAttribute("role", "dialog"); kart.setAttribute("aria-label", `${o?.baslik || anahtar} hakkında bilgi`);
    const bas = document.createElement("h4"); bas.textContent = o?.baslik || anahtar; kart.append(bas);
    satir(kart, "Bu yetki ne işe yarar?", b.ne);
    satir(kart, "Neyi açar/kapatır?", b.acar);
    satir(kart, "Kime verilmesi uygun?", b.kime);
    satir(kart, "Riskleri:", b.risk);
    const kpt = document.createElement("button"); kpt.type = "button"; kpt.className = "ya-bilgi-kapat"; kpt.textContent = "Kapat"; kpt.addEventListener("click", kapat); kart.append(kpt);
    kart.addEventListener("mouseenter", () => clearTimeout(zaman));
    kart.addEventListener("mouseleave", () => { if (!sabit) zaman = setTimeout(kapat, 250); });
    document.body.append(kart);
    const r = btn.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    kart.style.width = w + "px";
    const sol = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    let ust = r.bottom + 8;
    kart.style.left = sol + "px"; kart.style.top = ust + "px";
    const yuk = kart.offsetHeight;
    if (ust + yuk > window.innerHeight - 12) kart.style.top = Math.max(12, r.top - yuk - 8) + "px";
    btn.setAttribute("aria-expanded", "true"); acikBtn = btn;
  }
  kok.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-ya-bilgi]"); if (!btn) return;
    e.preventDefault();
    if (acikBtn === btn && sabit) return kapat();
    ac(btn); sabit = true;
  });
  kok.addEventListener("mouseover", (e) => { const btn = e.target.closest?.("[data-ya-bilgi]"); if (btn && !sabit) { clearTimeout(zaman); zaman = setTimeout(() => ac(btn), 200); } });
  kok.addEventListener("mouseout", (e) => { if (e.target.closest?.("[data-ya-bilgi]") && !sabit) { clearTimeout(zaman); zaman = setTimeout(kapat, 250); } });
  kok.addEventListener("focusin", (e) => { const btn = e.target.closest?.("[data-ya-bilgi]"); if (btn) ac(btn); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && kart) { const b = acikBtn; kapat(); b?.focus(); } });
  document.addEventListener("click", (e) => { if (kart && !kart.contains(e.target) && !e.target.closest?.("[data-ya-bilgi]")) kapat(); });
  window.addEventListener("scroll", () => { if (kart && !sabit) kapat(); }, { passive: true, capture: true });
}
