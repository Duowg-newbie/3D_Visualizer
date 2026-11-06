"""
Face 3D Viewer — Máy chủ chạy thử nghiệm cục bộ (Pure Python, không cần cài thư viện)
Cách dùng:
    python server.py [cổng]
    (hoặc nhấp đúp vào start.bat)
"""

import sys
import http.server
import socketserver
import webbrowser
import threading
from pathlib import Path

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8000)
ROOT = Path(__file__).resolve().parent

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".ply": "application/octet-stream",
        ".obj": "text/plain",
        ".mtl": "text/plain",
        ".splat": "application/octet-stream",
        ".ksplat": "application/octet-stream",
        ".spz": "application/octet-stream",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

def main():
    with socketserver.ThreadingTCPServer(("", PORT), CustomHandler) as httpd:
        url = f"http://localhost:{PORT}/"
        print("=" * 60)
        print(f" FACE 3D VIEWER DANG CHAY TAI: {url}")
        print(" Nhan Ctrl+C de dung server.")
        print("=" * 60)
        if "--no-browser" not in sys.argv:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDa dung server.")

if __name__ == "__main__":
    main()
