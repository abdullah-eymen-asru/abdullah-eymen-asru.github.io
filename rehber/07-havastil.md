[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · **🌦️ HavaStil**

---

# 🌦️ HavaStil — Hava Durumu ve Giyim Danışmanı (v2)

Panelde **Araçlar › 🌦️ HavaStil** ve telefona kurulabilir bağımsız sayfa **`/panel/havastil/`** (PWA). Varsayılan **tüm roller kapalı**, yalnızca Site Sahibi kullanır; açma: **Yetki Ayarları › Özellikler › HavaStil**.

## 1. Kurulum (sırayla)
1. Supabase: `0099_havastil.sql` → `0100_havastil_konum_etiket.sql`.
2. Cloudflare Worker: [rehber/04 § 4.11](./04-cloudflare-secretlar.md) (`GROQ_API_KEY` Secret). Worker olmadan da hava, kombin ve uyarılar çalışır; yalnızca resmî uyarı sekmesi ve yapay zekâ yorumu devre dışı kalır.
3. Siteyi yayınla (`_headers` içinde `geolocation=(self)` şart — aksi halde tarayıcı konumu hiç sormaz).
4. HavaStil › Ayarlar › Yapay zekâ › **Bağlantıyı test et**.

## 2. Sekmeler
| Sekme | İçerik |
|---|---|
| **Özet** | Anlık durum (WMO kodu), hissedilen, en yüksek/düşük, Apple tarzı yağış cümlesi, **bugünün kararı**, resmî uyarı bandı, plan (senaryo/algı/çanta), 15 dk'lık yağış, saatlik şerit, kombin özeti, ayrıntılar (rüzgâr+yön+hamle, nem+çiğ noktası, UV, hava kalitesi, görüş, basınç+eğilim, bulut, yağış toplamı, güneş doğuş/batış+gün uzunluğu, ay evresi), günlük ipuçları |
| **Saatlik** | 48 saat: sıcaklık/hissedilen/yağış grafiği + saat saat liste |
| **10 Gün** | Günlük min–max, yağış, rüzgâr, UV ve her gün için giyim ipucu |
| **Kombin** | Ana + 2 alternatif kombin, **CLO bütçe çubuğu**, “neden bu kombin?”, gün içi plan (sabah/öğle/akşam), gruplu **ek öneriler**, kaçınılacaklar, kumaş, renk, ayakkabı, stilist yorumu |
| **Uyarılar** | Bugün **bu konum** için giyimi etkileyen resmî/güvenilir hava uyarıları: kim söylüyor, ne zaman, ne yapmalı, hava verisi teyit ediyor mu |
| **Ayarlar** | Saat bazlı uyarılar + bildirim izni, yapay zekâ + bağlantı testi, bulut senkronu, haber doğrulama anahtarı, gizlilik (her şey **Opsiyonel** rozetli), teşhis |

## 3. CLO motoru (`cekirdek.js`, `katalog.js`)
- `Hedef CLO = (33 − T_etkin)/15 − aktivite`; `T_etkin = hissedilen + kişisel tolerans (−3/0/+3) + küçük nem/ıslaklık düzeltmesi` (hissedilen sıcaklık rüzgâr, nem ve güneşi zaten içerir; çift sayılmaz).
- Kombin **~70 gerçek parçadan** (çekirdek, modüler, kabuk, alt giyim, ayakkabı) seçilir; toplam = `0,10 + 0,85 × Σ parça CLO`. Her parçanın **uygun sıcaklık aralığı** ve özel koşulu vardır (kar pantolonu yalnız karda…).
- **Kısıtlar:** yağış düzeyi (hafif/orta/şiddetli → su itici/geçirmez), rüzgâr/hamle (rüzgâr geçirmez), buz/kar (kaymaz taban), sıcak ofis (**kabuk & çekirdek**: iç kat ≤ 0,80 CLO, kalın yün yasak), modüler gün (Δ ≥ 8 °C → çıkarılabilir ara kat), sıcak hava (ara/dış kat yok), UV, **çanta durumu** (çantan yoksa şemsiye yerine kapüşonlu yağmurluk; çıkardığın katman cebe/bele sığmalı), spor (hızlı kuruyan).
- **Çeşitlilik:** günün tarihinden türeyen tohum öncelikli stili ve eşit parçalar arasındaki seçimi döndürür; her seferinde 3 farklı kombin; tarz seçici (klasik/sportif/sokak/minimalist/dış mekân) ve “🎲 başka kombinler”.
- **Senaryolar:** yaya/toplu · yürüyüş+sıcak ofis · gün boyu dışarıda · araç · gün boyu gezi · koşu/spor.
- **Ek öneriler** (gruplu, öncelikli, ağırlıklı, “cebe sığar”): yağmurluk/şemsiye, yedek çorap, telefon kılıfı, sırt çantası yağmur kılıfı, bere/eldiven/boyunluk/yün çorap, el ısıtıcı, termos, dudak/el kremi, powerbank, SPF/gözlük/şapka/su, elektrolit, maske, görünürlük, araç için buz kazıyıcı/kış lastiği, gün içi çanta…

## 4. Haber doğrulama (sade)
- **Havuz mantığı:** Worker yalnızca hava olaylarıyla ilgili başlıkları iki havuzda (Türkiye, Dünya) toplar (10 dk taze, 90 dk bayat-ama-anında). Tarayıcı havuzu 15 dk saklar. **Tüm konumlar (il, ilçe, mahalle, sokak, kayıtlı yerler) aynı havuzu kullanır → konum değiştirmek ağ isteği doğurmaz.** Konum Worker'a gitmez.
- **Yer eşleşmesi** (tarayıcıda): sokak → mahalle → ilçe → il/şehir → bölge → ülke sırasıyla en özel eşleşme bulunur. Dünya için şehir/bölge/ülke İngilizce adlarıyla.
- **Süzgeçler:** tık tuzağı (soru işareti/sansasyonel kalıp) → yalnızca bugün (konumun saat dilimine göre; gelecek gün/geçmiş/eski haber elenir) → yer → giyim kuralına dönüşebilir mi.
- **Güvenilirlik:** metinde resmî kurum atfı (Meteoroloji, AFAD, Valilik…) → *resmî kurum*; AA/TRT/BBC… → *haber ajansı*; diğer → *haber sitesi*.
- **Veriyle çapraz teyit:** haberdeki olay Open-Meteo verisiyle karşılaştırılır (fırtına↔hamle, sağanak↔yağış ihtimali, don↔en düşük sıcaklık, kar, sıcak, çöl tozu↔toz/PM10, sis↔görüş). Resmî kurum → uygulanır (veri farklıysa not düşülür); ajans → veriyle çelişmiyorsa; genel haber → veriyle uyuşmalı ya da ≥2 kaynak.
- **Uygulama:** doğrulanan uyarılar yama olarak değil, CLO motoruna **kısıt** olarak girer (fırtına → şemsiye yok + rüzgâr geçirmez kat; çöl tozu → açık renk yasak + maske; don → kaymaz kauçuk bot; sağanak → su geçirmez kat…). Mod A'da LLM yoktur.

## 5. Yapay zekâ (Mod A / Mod B)
Varsayılan **Mod A: hiçbir yapay zekâ isteği yok**. Mod B (isteğe bağlı) yalnızca sayılar + katalog id'leri (+ doğrulanmış haberin `haberId`'si) gönderir; Worker başlığı kendi havuzundan bulur. **Model:** `openai/gpt-oss-20b` → `-120b` zinciri (Llama 3.1/3.3 Groq'ta 16.08.2026'da kaldırıldı). Hata olursa arayüz sebebini yazar; ayrıntı için **Bağlantıyı test et**.

## 6. Konumlar ve izinler
- **Arama:** önce internetsiz il eşleşmesi (“Ank” → Ankara), sonra dünya geneli Open-Meteo. **Listeden seçmeden hiçbir konum seçilmez** (önceki sürümde kısmi yazım yanlış yere düşebiliyordu). Sokak/adres yalnızca kullanıcı isterse (OpenStreetMap).
- **Kaydetme:** her sonucun yanındaki ☆ ile tek dokunuş; ad + simge (Ev, İş, Okul…) seçilir; kartlar yatay şeritte, son sıcaklıkla.
- **GPS:** izin yoksa/reddedildiyse ya da site başlığı engelliyorsa **neden** ve **tarayıcıya/cihaza özel adımlar** gösterilir (Chrome, Edge, Firefox, Safari, Samsung Internet, Opera, Brave; macOS/Windows/Android/iOS).
- **Saat bazlı uyarılar:** birden çok uyarı; saat + gün + tür (günlük öneri / yalnızca uyarı varsa). Bildirim izni yalnızca düğmeyle istenir; reddedilirse tarayıcıya özel “nasıl açılır” kartı çıkar.

## 7. Gizlilik / KVKK
Amaç hava + CLO ile giyim kararıdır; **konum toplamak amaç değildir**. GPS, kaydetme, hesapta saklama, haber doğrulama, yapay zekâ — hepsi **opsiyoneldir** (arayüzde “Opsiyonel” rozetli). Aydınlatma metni `kurumsal/kvkk-aydinlatma-metni.md › § 7/A` olarak eklendi (taslak; hukuki danışmanla gözden geçir). Üyelere HavaStil açılırken KVKK sürümünü (v1.1 → v1.2) yükseltmek isteyebilirsin (KVKK sürüm panelinden).

## 8. Bilinen sınırlar
- **Arka plan push yok:** saat bazlı uyarılar HavaStil açıkken (arka planda sekme açık olsa bile) saatinde çalışır; kapalıyken sonraki açılışta 3 saat içindeyse “kaçırılan uyarı” olarak gösterilir. Kesin saatte kapalıyken bildirim için sunucu Web Push (VAPID + abonelik tablosu + zamanlanmış Worker) gerekir.
- Dünya haberleri yalnızca büyük olayları kapsar (uluslararası İngilizce kaynaklar); yerel dilde uyarılar için ulusal meteoroloji kurumuna bak.
- MGM/AFAD için doğrulanmış resmî RSS yok; atıf yoluyla (AA/TRT) görünür.
- Open-Meteo ücretsiz API ticari olmayan kullanım içindir. 15 dakikalık yağış bölgeye göre yoktur (yoksa gizlenir). Polen verisi eklenmedi (Avrupa kapsamlı; Türkiye için güvenilir değil).
- Servis çalışanı yalnızca `/panel/havastil/` kapsamındadır.

## 9. Dosya haritası (`assets/js/havastil/`)
`cekirdek.js` (motor) · `katalog.js` (parçalar) · `veri.js` (hava/geocoding) · `hava-kodlari.js` (WMO, UV/AQI, ay) · `iller.js` · `haber-filtre.js` · `taktik.js` · `haber.js` · `izin-yardim.js` · `bildirim.js` · `konumlar.js` · `bulut.js` · `ui-temel.js` · `ui-konum.js` · `ui-hava.js` · `ui-kombin.js` · `ui-haber.js` · `ui-ayar.js` · `arayuz.js` (kabuk) · `panel.js` / `sayfa.js` (girişler).
