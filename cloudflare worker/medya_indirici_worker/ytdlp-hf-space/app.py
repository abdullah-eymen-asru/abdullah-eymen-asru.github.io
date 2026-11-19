"""
Medya çözümleyici (yt-dlp + ffmpeg) + Belge dönüştürücü (LibreOffice) — açık kaynak, KAYIT TUTMAZ (günlük/depolama yok).
Çalışır: Render.com (ücretsiz Docker Web Service) ya da Hugging Face Space (Docker). Port: ortam değişkeni PORT (yoksa 7860).
Sözleşme (Worker ile):  POST /  {url, mod:"video"|"ses", kalite:"2160"|"1080"|"720", ses_bicimi:"mp3"|"m4a", ses_kbps:"320"|"128"}
   Authorization: Bearer <API_KEY>  →  200 {url, dosya_adi} | 4xx {hata}
   url, bu servisin imzalı ve kısa ömürlü /akis adresidir (medya bu servis üzerinden akar; YouTube adresleri IP'ye bağlı olduğu için doğrudan verilemez).
Secret: API_KEY (zorunlu; Worker'daki YTDLP_API_KEY ile aynı). İsteğe bağlı: IZINLI_ORIGIN (yoksa CORS kapalı).
"""
import asyncio, base64, hashlib, hmac, json, os, re, shutil, subprocess, tempfile, time, uuid
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
import yt_dlp

API_KEY = os.environ.get("API_KEY", "")
ULTIMATE = 20 * 60              # imzalı adresin geçerlilik süresi (sn)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

def hata(kod, m): return JSONResponse({"hata": m}, status_code=kod)

def temel_adres(istek: Request) -> str:
    """Render/HF ters vekilin ardında istek.base_url http görünür; karışık içerik olmasın diye yerel dışında HER ZAMAN https."""
    host = (istek.headers.get("x-forwarded-host") or istek.headers.get("host") or "").split(",")[0].strip()
    yerel = host.startswith(("localhost", "127.", "0.0.0.0"))
    return f"{'http' if yerel else 'https'}://{host}"

def url_gecerli(u: str) -> bool:
    try: p = urlparse(u)
    except Exception: return False
    h = (p.hostname or "").lower()
    return p.scheme in ("http", "https") and "." in h and not re.fullmatch(r"[\d.]+", h) and h not in ("localhost",) and not h.endswith((".local", ".internal")) and ":" not in h

def imza(veri: str) -> str:
    return hmac.new(API_KEY.encode(), veri.encode(), hashlib.sha256).hexdigest()

def guvenli_ad(t: str, uzanti: str) -> str:
    t = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", t or "medya").strip()[:90] or "medya"
    return f"{t}.{uzanti}"

def secici(mod, kalite, bicim):
    if mod == "ses": return "bestaudio[ext=m4a]/bestaudio/best"
    k = int(kalite) if kalite in ("2160", "1080", "720") else 1080
    return f"bv*[ext=mp4][height<={k}]+ba[ext=m4a]/b[ext=mp4][height<={k}]/bv*[height<={k}]+ba/b[height<={k}]/b"

def cozumle(url, mod, kalite, bicim):
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True, "format": secici(mod, kalite, bicim), "socket_timeout": 20}
    with yt_dlp.YoutubeDL(opts) as y:
        return y.extract_info(url, download=False)

@app.post("/")
async def kok(istek: Request):
    if not API_KEY: return hata(500, "API_KEY tanımlı değil.")
    if not hmac.compare_digest(istek.headers.get("authorization", ""), f"Bearer {API_KEY}"): return hata(401, "Yetkisiz.")
    try: g = await istek.json()
    except Exception: return hata(400, "Geçersiz gövde.")
    url = str(g.get("url", ""))
    if not url_gecerli(url): return hata(400, "Geçersiz bağlantı.")
    mod = "ses" if g.get("mod") == "ses" else "video"
    kalite = str(g.get("kalite", "1080")); bicim = "m4a" if g.get("ses_bicimi") == "m4a" else "mp3"; kbps = "128" if str(g.get("ses_kbps")) == "128" else "320"
    try: bilgi = cozumle(url, mod, kalite, bicim)
    except Exception as e:
        m = str(e)
        if re.search(r"not a bot|confirm you.re not|bot", m, re.I) and re.search(r"sign in|confirm", m, re.I): return hata(422, "YouTube bu sunucunun IP adresini robot şüphesiyle engelledi (ücretsiz bulut sunucularında sık olur). Birkaç dakika sonra yeniden dene; sürerse yt-dlp sürümünü güncelle (Render: Clear build cache & deploy) ya da kendi çözümleyicini kullan.")
        if re.search(r"confirm your age|age[- ]restrict|age-gate|inappropriate for some users", m, re.I): return hata(422, "Bu içerik yaş kısıtlı; oturum açılmadan indirilemez.")
        if re.search(r"private video|this video is private", m, re.I): return hata(422, "İçerik özel; herkese açık değil.")
        if re.search(r"members-only|join this channel", m, re.I): return hata(422, "İçerik yalnızca kanal üyelerine açık.")
        if re.search(r"not available in your country|geo|region", m, re.I): return hata(422, "İçerik bu bölgede kullanılamıyor.")
        if re.search(r"login|sign in|authentication|cookies", m, re.I): return hata(422, "İçerik oturum gerektiriyor; indirilemez.")
        if re.search(r"unsupported url", m, re.I): return hata(422, "Bu site desteklenmiyor.")
        if re.search(r"video unavailable|removed|does not exist|404", m, re.I): return hata(422, "İçerik bulunamadı ya da kaldırılmış.")
        if re.search(r"live event|is live|premiere", m, re.I): return hata(422, "Canlı yayınlar/prömiyerler indirilemez.")
        return hata(422, "İçerik çözülemedi.")
    uzanti = "mp3" if (mod == "ses" and bicim == "mp3") else ("m4a" if mod == "ses" else "mp4")
    ad = guvenli_ad(bilgi.get("title"), uzanti)
    bitis = int(time.time()) + ULTIMATE
    yuk = base64.urlsafe_b64encode(json.dumps({"u": url, "m": mod, "k": kalite, "b": bicim, "r": kbps, "e": bitis, "a": ad}, ensure_ascii=False).encode()).decode()
    return {"url": f"{temel_adres(istek)}/akis?p={yuk}&s={imza(yuk)}", "dosya_adi": ad}

def basliklar(f):
    h = f.get("http_headers") or {}
    return "".join(f"{k}: {v}\r\n" for k, v in h.items() if k.lower() in ("user-agent", "referer", "origin", "accept", "cookie"))

@app.get("/akis")
def akis(p: str = "", s: str = ""):
    if not API_KEY or not hmac.compare_digest(imza(p), s): return hata(403, "İmza geçersiz.")
    try: v = json.loads(base64.urlsafe_b64decode(p.encode()))
    except Exception: return hata(400, "Geçersiz yük.")
    if int(v.get("e", 0)) < time.time(): return hata(410, "Bağlantının süresi doldu; yeniden hazırla.")
    if not url_gecerli(v["u"]): return hata(400, "Geçersiz bağlantı.")
    try: bilgi = cozumle(v["u"], v["m"], v["k"], v["b"])
    except Exception: return hata(422, "İçerik çözülemedi.")
    kaynaklar = bilgi.get("requested_formats") or [bilgi]
    girdiler = []
    for f in kaynaklar:
        girdiler += ["-headers", basliklar(f), "-i", f["url"]] if basliklar(f) else ["-i", f["url"]]
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error"] + girdiler
    if v["m"] == "ses":
        cmd += ["-vn"] + (["-c:a", "libmp3lame", "-b:a", f"{v['r']}k", "-f", "mp3"] if v["b"] == "mp3" else ["-c:a", "copy", "-movflags", "frag_keyframe+empty_moov", "-f", "ipod"]) + ["pipe:1"]
        tip = "audio/mpeg" if v["b"] == "mp3" else "audio/mp4"
    else:
        cmd += ["-c", "copy", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]; tip = "video/mp4"
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    def uret():
        try:
            while (b := proc.stdout.read(65536)): yield b
        finally:
            proc.kill()
    ad = v.get("a") or "medya"
    return StreamingResponse(uret(), media_type=tip, headers={"Content-Disposition": "attachment; filename*=UTF-8''" + __import__("urllib.parse").parse.quote(ad), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                                         "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Disposition"})

@app.get("/")
def saglik(): return {"durum": "hazir"}


# ----------------------------------------------------------------------------------------------------------------
# BELGE DÖNÜŞTÜRÜCÜ (LibreOffice, açık kaynak): Word / Excel / PowerPoint / OpenDocument / RTF / HTML / TXT / CSV / PDF arasında dönüşüm
# POST /belge?hedef=<biçim>&ad=dosya.docx    gövde = ham dosya baytları    Authorization: Bearer <API_KEY>
# POST /temizle  (Bearer)  → bu servisin geçici klasörlerini HEMEN siler.   GET /saglik → sürüm/özellik bilgisi (gizli değer yok)
# Dosya YALNIZCA istek süresince geçici klasörde tutulur ve yanıt bitince SİLİNİR (ayrıca 10 dk'dan eski artıklar temizlenir); günlük/depolama yoktur.
# ----------------------------------------------------------------------------------------------------------------
YAZI = {"doc", "docx", "odt", "rtf", "txt", "html", "htm"}
TABLO = {"xls", "xlsx", "ods", "csv"}
SUNUM = {"ppt", "pps", "pot", "pptx", "ppsx", "potx", "odp"}
HEDEFLER = {
    "yazi":  {"pdf", "docx", "doc", "odt", "rtf", "txt", "html"},
    "tablo": {"pdf", "xlsx", "xls", "ods", "csv", "html"},
    "sunum": {"pdf", "pptx", "ppt", "odp"},
    "pdf":   {"docx", "odt", "rtf", "html", "pptx", "odp"}   # pdf→txt LibreOffice'te boş çıkar; tarayıcı yöntemi (PDF.js) kullanılır,
}
MIME = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "doc": "application/msword", "odt": "application/vnd.oasis.opendocument.text",
        "rtf": "application/rtf", "txt": "text/plain; charset=utf-8", "html": "text/html; charset=utf-8", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel", "ods": "application/vnd.oasis.opendocument.spreadsheet", "csv": "text/csv; charset=utf-8",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "ppt": "application/vnd.ms-powerpoint", "odp": "application/vnd.oasis.opendocument.presentation"}
FILTRE = {
    ("yazi", "pdf"): "pdf:writer_pdf_Export", ("yazi", "docx"): "docx:MS Word 2007 XML", ("yazi", "doc"): "doc:MS Word 97", ("yazi", "odt"): "odt:writer8", ("yazi", "rtf"): "rtf:Rich Text Format",
    ("yazi", "txt"): "txt:Text (encoded):UTF8", ("yazi", "html"): "html:HTML (StarWriter)",
    ("tablo", "pdf"): "pdf:calc_pdf_Export", ("tablo", "xlsx"): "xlsx:Calc MS Excel 2007 XML", ("tablo", "xls"): "xls:MS Excel 97", ("tablo", "ods"): "ods:calc8",
    ("tablo", "csv"): "csv:Text - txt - csv (StarCalc):44,34,76,1", ("tablo", "html"): "html:HTML (StarCalc)",
    ("sunum", "pdf"): "pdf:impress_pdf_Export", ("sunum", "pptx"): "pptx:Impress MS PowerPoint 2007 XML", ("sunum", "ppt"): "ppt:MS PowerPoint 97", ("sunum", "odp"): "odp:impress8",
    ("pdf", "docx"): "docx:MS Word 2007 XML", ("pdf", "odt"): "odt:writer8", ("pdf", "rtf"): "rtf:Rich Text Format", ("pdf", "txt"): "txt:Text (encoded):UTF8", ("pdf", "html"): "html:HTML (StarWriter)",
    ("pdf", "pptx"): "pptx:Impress MS PowerPoint 2007 XML", ("pdf", "odp"): "odp:impress8",
}
GIRIS_FILTRE = {("pdf", "docx"): "writer_pdf_import", ("pdf", "odt"): "writer_pdf_import", ("pdf", "rtf"): "writer_pdf_import", ("pdf", "txt"): "writer_pdf_import", ("pdf", "html"): "writer_pdf_import",
                ("pdf", "pptx"): "impress_pdf_import", ("pdf", "odp"): "impress_pdf_import"}
BELGE_MAX = 60 * 1024 * 1024
BELGE_SIRA = asyncio.Semaphore(1)          # ücretsiz 512 MB sunucuda aynı anda 1 dönüştürme (bellek koruması)
TEMP_ONEK = "belge_"

def aile(uz: str):
    return "yazi" if uz in YAZI else "tablo" if uz in TABLO else "sunum" if uz in SUNUM else "pdf" if uz == "pdf" else None

def eski_temizle(yas_sn=600):
    n = 0
    for d in os.listdir(tempfile.gettempdir()):
        if d.startswith(TEMP_ONEK):
            yol = os.path.join(tempfile.gettempdir(), d)
            try:
                if yas_sn <= 0 or time.time() - os.path.getmtime(yol) > yas_sn: shutil.rmtree(yol, ignore_errors=True); n += 1
            except OSError: pass
    return n

def _lo_calistir(girdi: str, klasor: str, filtre: str, giris_filtre: str | None):
    profil = os.path.join(klasor, "profil")
    cmd = ["soffice", f"-env:UserInstallation=file://{profil}", "--headless", "--norestore", "--nologo", "--nodefault"]
    if giris_filtre: cmd += [f"--infilter={giris_filtre}"]
    cmd += ["--convert-to", filtre, "--outdir", klasor, girdi]
    return subprocess.run(cmd, capture_output=True, timeout=170, cwd=klasor)

@app.get("/saglik")
def saglik():
    ver = getattr(yt_dlp.version, "__version__", None)
    return {"ok": True, "yt_dlp": ver, "deno": bool(shutil.which("deno")), "ffmpeg": bool(shutil.which("ffmpeg")), "soffice": bool(shutil.which("soffice")), "api_key": bool(API_KEY)}

@app.post("/temizle")
async def temizle(istek: Request):
    if not API_KEY: return hata(500, "API_KEY tanımlı değil.")
    if not hmac.compare_digest(istek.headers.get("authorization", ""), f"Bearer {API_KEY}"): return hata(401, "Yetkisiz.")
    return {"silinen": eski_temizle(0)}

@app.post("/belge")
async def belge(istek: Request, hedef: str = "pdf", ad: str = "belge.docx"):
    if not API_KEY: return hata(500, "API_KEY tanımlı değil.")
    if not hmac.compare_digest(istek.headers.get("authorization", ""), f"Bearer {API_KEY}"): return hata(401, "Yetkisiz.")
    uz = (ad.rsplit(".", 1)[-1] if "." in ad else "").lower(); hedef = hedef.lower()
    fam = aile(uz)
    if not fam or hedef not in HEDEFLER[fam] or hedef == uz: return hata(400, "Desteklenmeyen dönüşüm.")
    try:
        if int(istek.headers.get("content-length", "0")) > BELGE_MAX: return hata(413, "Dosya çok büyük (en fazla 60 MB).")
    except ValueError: return hata(400, "Geçersiz istek.")
    eski_temizle()
    klasor = tempfile.mkdtemp(prefix=TEMP_ONEK)
    temizle_fn = lambda: shutil.rmtree(klasor, ignore_errors=True)
    try:
        girdi = os.path.join(klasor, f"{uuid.uuid4().hex}.{uz}"); boyut = 0
        with open(girdi, "wb") as f:
            async for parca in istek.stream():
                boyut += len(parca)
                if boyut > BELGE_MAX: temizle_fn(); return hata(413, "Dosya çok büyük (en fazla 60 MB).")
                f.write(parca)
        if boyut < 16: temizle_fn(); return hata(400, "Dosya boş ya da bozuk.")
        filtre = FILTRE[(fam, hedef)]
        async with BELGE_SIRA:
            try: await asyncio.to_thread(_lo_calistir, girdi, klasor, filtre, GIRIS_FILTRE.get((fam, hedef)))
            except subprocess.TimeoutExpired: temizle_fn(); return hata(504, "Dönüştürme zaman aşımına uğradı (dosya çok karmaşık olabilir).")
        cikti = os.path.splitext(girdi)[0] + "." + hedef
        if not os.path.exists(cikti) or os.path.getsize(cikti) < 20: temizle_fn(); return hata(422, "Dosya dönüştürülemedi (bozuk ya da parola korumalı olabilir).")
        return FileResponse(cikti, media_type=MIME.get(hedef, "application/octet-stream"), background=BackgroundTask(temizle_fn), headers={"Cache-Control": "no-store"})
    except Exception:
        temizle_fn(); return hata(500, "Dönüştürme sırasında hata oluştu.")
