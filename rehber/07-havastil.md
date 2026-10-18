[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · **🌦️ HavaStil**

---

# 🌦️ HavaStil — Hava Durumu ve Giyim Danışmanı (v3)

Panelde **Araçlar › 🌦️ HavaStil** ve telefona kurulabilir bağımsız sayfa **`/panel/havastil/`** (PWA). Varsayılan **tüm roller kapalı**, yalnızca Site Sahibi kullanır; açma: **Yetki Ayarları › Özellikler › HavaStil**.

## 1. Kurulum (sırayla)
1. Supabase: `0099_havastil.sql` → `0100_havastil_konum_etiket.sql`.
2. Cloudflare Worker: [rehber/04 § 4.11](./04-cloudflare-secretlar.md) (`GROQ_API_KEY` Secret). Worker olmadan da hava, kombin ve uyarılar çalışır; yalnızca resmî uyarı sekmesi ve yapay zekâ yorumu devre dışı kalır.
3. Siteyi yayınla (`_headers` içinde `geolocation=(self)` şart — aksi halde tarayıcı konumu hiç sormaz).
4. HavaStil › Ayarlar › Yapay zekâ › **Bağlantıyı test et**.

## 2. Sekmeler (v3: "İkili Katman")
Arayüz iki algı düzeyine bölündü: **sıradan kullanıcı** 3 saniyede karar alır, **meteoroloji meraklısı** ayrı sekmede sayıları görür.

| Sekme | İçerik |
|---|---|
| **Bugün** (sade) | Tek bakışta hüküm (ör. “Şemsiyesiz çıkabilirsin…”) + **4 kademeli yağış çubuğu** (Kurak/Sakin → Hafif çisenti (zararsız) → Sürekli yağmur → Tehlikeli/ani sağanak) + günlük hayat benzetmesi (“m²’ye yarım su bardağı”). **Bugünün Zırhı**: iç kat · çıkarılabilir orta kat · koruyucu dış kabuk, alt giyim, ayakkabı/zemin taktiği, çantaya atılacaklar, renk. **Gün içi kritik an** (stilist), saatlik akış, kapalı “Planın ve tercihlerin” kutusu |
| **Derin analiz** (uzman) | **CAPE** (J/kg + 0–4 fırtına skalası) · **yağışın fiziği** (konvektif showers / geniş cephe rain) · **beklenen efektif yağış E = PoP × P** ve 3 karar kuralının tetik durumu · **mikro-iklim** (hamle, çiğ noktası, basınç 3/12 sa eğilimi, UV, yüzey ozonu, görüş, AQI) · **CLO bütçesi**, gün içi katman planı, tüm öneriler · **48 saatlik saat saat matris** (yağış türü, mm/E, CAPE, hamle, yalıtım ihtiyacı) |
| **10 gün** | Günlük min–max, aynı 4 kademeli yağış etiketi, rüzgâr, UV, giyim ipucu |
| **Uyarılar** | Bugün **bu konum** için giyimi etkileyen resmî/güvenilir hava uyarıları |
| **Ayarlar** | Saat bazlı uyarılar, yapay zekâ + bağlantı testi, bulut senkronu, haber doğrulama, gizlilik, teşhis |

Eski sekme adları (`ozet`, `saatlik`, `kombin`) tarayıcıda otomatik yeni sekmelere eşlenir. Önceki “Saatlik” ve “Kombin” içeriği Derin analiz ve Bugünün Zırhı içine taşındı.

## 2A. Yağış ve fırtına dinamikleri (`yagis-fizigi.js`, saf JS)
Open-Meteo’dan saatlik `precipitation_probability, precipitation, rain, showers, cape, wind_gusts_10m, weather_code` okunur. Karar kuralları (eşikler dosyada `ESIK` altında tek yerde):

| # | Kural | Koşul | Sonuç |
|---|---|---|---|
| 1 | Sahte alarm engelleyici | PoP ≥ %70 **ve** E = PoP × P < 0,8 mm | “Zararsız çisenti”; şemsiye ve ağır bot önerilmez |
| 2 | Sürpriz sağanak dedektörü | PoP ≤ %45, `showers` > 0, CAPE > 1000 J/kg | “Atmosfer patlamaya hazır” uyarısı, su geçirmez kabuk + bot |
| 3 | Fırtına / şemsiye kırıcı | CAPE > 1500 J/kg **veya** hamle > 40 km/s | Şemsiye sistemden çıkar; kapüşonlu teknik kabuk |

**Seviye:** 0 kurak · 1 hafif çisenti (zararsız) · 2 sürekli yağmur (saatlik ≥ 1 mm ya da E ≥ 0,8) · 3 tehlikeli/ani sağanak (kural 2, CAPE > 1500 + yağış, ≥ 4 mm/sa, `showers` ≥ 2 mm/sa, gök gürültülü fırtına kodu). Bilerek eklenen güvenlik: zararsız saatler birikip pencerede toplam ≥ 3 mm yaparsa seviye 2’ye çıkar; dondurucu çise/yağmur ve kar “zararsız” sayılmaz. Pencere: şimdiden 22:00’ye (akşam 21’den sonra yarın 07–22).

Motor çıktısı `cekirdek.js`’e **kısıt** olarak girer (yama değil): seviye 1 → yağış kısıtı yok; seviye 2–3 → su geçirmez kat/ayakkabı; kural 3 → rüzgâr seviyesi 2 + şemsiye yasağı.

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

## 5. Yapay zekâ — “Taktik Stilist” (Mod A / Mod B)
Varsayılan **Mod A: hiçbir yapay zekâ isteği yok**; “Gün içi kritik an” satırı yerel ve deterministik üretilir (`krizSatiri`). Kural motoru kararları (şemsiye, kabuk, bot) zaten arayüzde olduğundan yapay zekâ onları **tekrarlamaz**.

**Kritik an** (`krizAniBul`): planına göre dışarıda olduğun saatler içinde çelişkinin en büyük olduğu saat bulunur (ofis/araçtan çıkış sıcaklık farkı, ani soğuma, hamle, yağış başlangıcı, konvektif enerji). Kritik an yoksa Groq’a hiç sorulmaz.

**Mod B** (isteğe bağlı) Worker’a `v:3` JSON gönderir: sıcaklık, ΔT, hamle, CAPE skoru, yağış seviyesi/türü, beklenen mm, plan, tolerans, çanta, kombin katalog id’leri, bayraklar ve `kriz` (saat, tür, öncesi/sonrası sıcaklık, hamle, mm). Serbest metin, konum ve kimlik gitmez; Worker her alanı aralık/enum olarak doğrular. Doğrulanmış haberin `haberId`’si varsa Worker başlığı kendi havuzundan ekler. **Çıktı standardı:** selam/genel tavsiye yok, tam 2 cümle (1: kriz anı, 2: katmanların nasıl taşınacağı); sunucu 2 cümleye kırpar. **Model:** `openai/gpt-oss-20b` → `-120b` zinciri. Hata olursa arayüz sebebini yazar; ayrıntı için **Bağlantıyı test et**.

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
`yagis-fizigi.js` (**yağış & fırtına motoru, kriz anı**) · `cekirdek.js` (CLO motoru) · `katalog.js` (parçalar) · `veri.js` (hava/geocoding; rain, showers, cape, ozon) · `hava-kodlari.js` · `iller.js` · `haber-filtre.js` · `taktik.js` · `haber.js` · `izin-yardim.js` · `bildirim.js` · `konumlar.js` · `bulut.js` · `ui-temel.js` · `ui-konum.js` · `ui-sade.js` (**Bugün**) · `ui-uzman.js` (**Derin analiz**) · `ui-kombin.js` (CLO/plan/öneri blokları) · `ui-hava.js` (10 gün) · `ui-haber.js` · `ui-ayar.js` · `arayuz.js` (kabuk) · `panel.js` / `sayfa.js` (girişler).
