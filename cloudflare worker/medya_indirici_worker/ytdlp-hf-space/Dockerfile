# Medya çözümleyici (yt-dlp + ffmpeg + deno) + Belge dönüştürücü (LibreOffice) — açık kaynak.
# Çalışır: Render.com (ücretsiz Docker Web Service) ya da Hugging Face Space (SDK: Docker). Bulutta derlenir; bilgisayarına Docker kurmana gerek yok.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
# YouTube için yt-dlp'nin JavaScript çalışma zamanı (deno) gerekir; yoksa YouTube indirmeleri sessizce başarısız olur.
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh -s -- -y && deno --version
RUN useradd -m -u 1000 kullanici
USER kullanici
WORKDIR /home/kullanici/uygulama
COPY --chown=kullanici requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=kullanici app.py .
# Render'da ortam değişkeni PORT verilir (kendi komutunu yazarsan --port 7860 + PORT=7860 değişkeni); Hugging Face'te 7860.
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "python3 -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
