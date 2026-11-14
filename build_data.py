#!/usr/bin/env python3
"""
build_data.py — Quét thư mục data/ và tạo file data/manifest.json
Hỗ trợ cấu trúc đa mô hình:
- data/images/<ID>.<ext>
- data/models/<model_name>/<ID>/<file_3d>
"""

import sys
import json
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

SUPPORTED_EXT = {
    # 3D
    "obj", "ply", "glb", "gltf", "fbx", "stl", "pcd", "xyz", "splat", "ksplat", "spz",
    # Ảnh
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "avif",
    # Video
    "mp4", "webm", "mov", "m4v", "mkv", "ogv", "avi",
    # Phụ trợ
    "mtl", "bin"
}

IGNORED_PARTS = {"high_stage", "low_stage", "__pycache__", ".git", ".vscode"}

def main():
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[!] Thư mục 'data' chưa tồn tại. Đã tự động tạo: {DATA_DIR}")
        return

    images_dir = DATA_DIR / "images"
    models_dir = DATA_DIR / "models"
    
    models_list = []
    if models_dir.is_dir():
        models_list = sorted([d.name for d in models_dir.iterdir() if d.is_dir()])
    
    files_list = []
    model_count = 0
    image_count = 0

    # 1. Quét kho ảnh gốc
    if images_dir.is_dir():
        for f in sorted(images_dir.iterdir()):
            if f.is_file() and f.suffix.lstrip(".").lower() in {"jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"}:
                files_list.append(f"data/images/{f.name}")
                image_count += 1

    # 2. Quét các model
    if models_dir.is_dir():
        for m_dir in sorted(models_dir.iterdir()):
            if not m_dir.is_dir():
                continue
            for id_dir in sorted(m_dir.iterdir()):
                if not id_dir.is_dir():
                    continue
                for f in sorted(id_dir.iterdir()):
                    if f.is_file():
                        ext = f.suffix.lstrip(".").lower()
                        if ext in SUPPORTED_EXT:
                            rel_path = f.relative_to(ROOT).as_posix()
                            files_list.append(rel_path)
                            model_count += 1

    # Hỗ trợ cả trường hợp thư mục dạng cũ phẳng nếu có
    for path in sorted(DATA_DIR.iterdir()):
        if path.is_dir() and path.name not in {"images", "models"}:
            for f in sorted(path.iterdir()):
                if f.is_file():
                    ext = f.suffix.lstrip(".").lower()
                    if ext in SUPPORTED_EXT:
                        rel_path = f.relative_to(ROOT).as_posix()
                        files_list.append(rel_path)
                        model_count += 1

    manifest_data = {
        "version": 2,
        "models": models_list,
        "files": files_list
    }

    manifest_path = DATA_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, ensure_ascii=False, indent=2)

    print("=" * 55)
    print(" CẬP NHẬT MANIFEST.JSON THÀNH CÔNG CHO GITHUB PAGES")
    print("=" * 55)
    print(f"- Tổng số file          : {len(files_list)}")
    print(f"- Số lượng file 3D      : {model_count}")
    print(f"- Số lượng ảnh gốc 2D   : {image_count}")
    print(f"- Danh sách Model AI    : {', '.join(models_list) or 'Chưa có'}")
    print("=" * 55)

if __name__ == "__main__":
    main()
