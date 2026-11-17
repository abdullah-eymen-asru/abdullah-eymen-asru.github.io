"""
Medya çözümleyici (yt-dlp + ffmpeg) — açık kaynak, KAYIT TUTMAZ (günlük/depolama yok).
Sözleşme (Worker ile):  POST /  {url, mod:"video"|"ses", kalite:"2160"|"1080"|"720", ses_bicimi:"mp3"|"m4a", ses_kbps:"320"|"128"}
   Authorization: Bearer <API_KEY>  →  200 {url, dosya_adi} | 4xx {hata}
   url, bu servisin imzalı ve kısa ömürlü /akis adresidir (medya bu servis üzerinden akar; YouTube adresleri IP'ye bağlı olduğu için doğrudan verilemez).
Secret: API_KEY (zorunlu; Worker'daki YTDLP_API_KEY ile aynı). İsteğe bağlı: IZINLI_ORIGIN (yoksa CORS kapalı).
"""
import base64, hashlib, hmac, json, os, re, subprocess, time
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
import yt_dlp

API_KEY = os.environ.get("API_KEY", "")
ULTIMATE = 20 * 60              # imzalı adresin geçerlilik süresi (sn)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

def hata(kod, m): return JSONResponse({"hata": m}, status_code=kod)

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
        if re.search(r"login|sign in|private video|confirm your age|age[- ]restrict", m, re.I): return hata(422, "İçerik oturum gerektiriyor (özel/yaş kısıtlı).")
        if re.search(r"unsupported url", m, re.I): return hata(422, "Bu site desteklenmiyor.")
        return hata(422, "İçerik çözülemedi.")
    uzanti = "mp3" if (mod == "ses" and bicim == "mp3") else ("m4a" if mod == "ses" else "mp4")
    ad = guvenli_ad(bilgi.get("title"), uzanti)
    bitis = int(time.time()) + ULTIMATE
    yuk = base64.urlsafe_b64encode(json.dumps({"u": url, "m": mod, "k": kalite, "b": bicim, "r": kbps, "e": bitis, "a": ad}, ensure_ascii=False).encode()).decode()
    return {"url": f"{str(istek.base_url).rstrip('/')}/akis?p={yuk}&s={imza(yuk)}", "dosya_adi": ad}

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
    return StreamingResponse(uret(), media_type=tip, headers={"Content-Disposition": "attachment; filename*=UTF-8''" + __import__("urllib.parse").parse.quote(ad), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

@app.get("/")
def saglik(): return {"durum": "hazir"}
