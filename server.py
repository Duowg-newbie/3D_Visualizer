"""
Face 3D Viewer — Server (Flask)
  python server.py [port]

Thư mục lưu trữ: ./data/
  data/<tên_dataset>/<các file 3D, ảnh, ...>

API:
  GET  /api/datasets          → danh sách dataset đã upload
  GET  /api/files/<dataset>   → cây file của dataset
  POST /api/upload            → upload nhiều file (giữ đường dẫn tương đối)
  GET  /data/<path>           → phục vụ file tĩnh từ thư mục data/
  GET  /                      → trang chính (index.html)
"""

import os
import sys
import json
import mimetypes
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file, abort

PORT   = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8000)
ROOT   = Path(__file__).resolve().parent
DATA   = ROOT / "data"
DATA.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")

# Đảm bảo MIME đúng (đặc biệt trên Windows)
mimetypes.add_type("text/javascript",   ".js")
mimetypes.add_type("text/javascript",   ".mjs")
mimetypes.add_type("application/wasm",  ".wasm")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/obj",         ".obj")
mimetypes.add_type("model/stl",         ".stl")


# ─────────────────────────── Static frontend ────────────────────────────────

@app.route("/")
def index():
    return send_file(ROOT / "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    """Phục vụ JS/CSS/... của frontend."""
    safe = ROOT / filename
    if safe.is_file() and not str(safe).startswith(str(DATA)):
        resp = send_file(safe)
        resp.headers["Cache-Control"] = "no-cache"
        return resp
    abort(404)


# ─────────────────────────── Phục vụ file data ──────────────────────────────

@app.route("/data/<path:filepath>")
def serve_data(filepath):
    """Trả về file trong thư mục data/ (ảnh, model 3D, …)."""
    full = (DATA / filepath).resolve()
    if not str(full).startswith(str(DATA.resolve())):
        abort(403)
    if not full.is_file():
        abort(404)
    mime, _ = mimetypes.guess_type(str(full))
    resp = send_file(full, mimetype=mime or "application/octet-stream")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# ─────────────────────────── API ────────────────────────────────────────────

@app.route("/api/datasets")
def api_datasets():
    """Danh sách dataset (thư mục con trực tiếp trong data/)."""
    datasets = sorted(
        d.name for d in DATA.iterdir() if d.is_dir()
    )
    return jsonify(datasets)


@app.route("/api/files/<dataset>")
def api_files(dataset):
    """Cây file của một dataset, trả về danh sách đường dẫn tương đối."""
    base = (DATA / dataset).resolve()
    if not str(base).startswith(str(DATA.resolve())) or not base.is_dir():
        abort(404)
    files = []
    for p in sorted(base.rglob("*")):
        if p.is_file():
            rel = p.relative_to(DATA).as_posix()   # vd. "mydata/ID/images/face.jpg"
            files.append(rel)
    return jsonify(files)


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """
    Upload nhiều file, giữ nguyên đường dẫn tương đối.
    Form field: files[] (multipart) + mỗi file có filename = đường dẫn tương đối.
    Frontend gửi: formData.append('files[]', file, file.webkitRelativePath)
    """
    uploaded_files = request.files.getlist("files[]")
    if not uploaded_files:
        return jsonify({"error": "Không có file nào được gửi"}), 400

    saved = []
    errors = []
    for f in uploaded_files:
        rel = f.filename.replace("\\", "/").lstrip("/")
        if not rel:
            continue
        # Chống path traversal
        dest = (DATA / rel).resolve()
        if not str(dest).startswith(str(DATA.resolve())):
            errors.append(f"Bị chặn: {rel}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        f.save(str(dest))
        saved.append(rel)

    return jsonify({"saved": len(saved), "files": saved, "errors": errors})


@app.route("/api/delete/<dataset>", methods=["DELETE"])
def api_delete(dataset):
    """Xoá toàn bộ một dataset."""
    import shutil
    base = (DATA / dataset).resolve()
    if not str(base).startswith(str(DATA.resolve())) or not base.is_dir():
        abort(404)
    shutil.rmtree(base)
    return jsonify({"deleted": dataset})


# ─────────────────────────── Chạy ───────────────────────────────────────────

if __name__ == "__main__":
    import webbrowser, threading
    url = f"http://localhost:{PORT}/"
    print(f"Face 3D Viewer: {url}  (Ctrl+C để dừng)")
    print(f"Dữ liệu lưu tại: {DATA}")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
