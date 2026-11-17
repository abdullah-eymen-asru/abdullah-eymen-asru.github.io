---
title: Medya Cozumleyici
sdk: docker
app_port: 7860
pinned: false
---
# Medya çözümleyici (yt-dlp) — ücretsiz Hugging Face Space

Kendi bilgisayarına HİÇBİR şey kurmadan, tamamen tarayıcıdan:
1. huggingface.co → New Space → **SDK: Docker** → Blank → **Private ya da Public** (Public önerilir; adres imzalıdır).
2. Bu klasördeki 4 dosyayı (`README.md`, `Dockerfile`, `app.py`, `requirements.txt`) Space'e yükle ("Files" → "Add file").
3. Space › Settings › **Variables and secrets** → Secret: `API_KEY` = uzun rastgele bir değer.
4. Space adresi: `https://KULLANICI-SPACEADI.hf.space` → Cloudflare Worker `medya-indirici-worker` için: `YTDLP_API_URL` = bu adres + `/` , `YTDLP_API_KEY` = aynı `API_KEY`.
Notlar: ücretsiz Space bir süre kullanılmazsa uyur (ilk istek ~30 sn sürebilir). YouTube bazı bulut IP'lerini engelleyebilir; çalışmazsa Space'i yeniden başlat / Cobalt kullan.
Kayıt tutulmaz: günlük/depolama yok. Yalnızca indirme hakkın olan içeriklerde kullan.
