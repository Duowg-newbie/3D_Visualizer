#!/usr/bin/env python3
"""
Tự động quét thư mục data/ và tạo file data/manifest.json
để trang web GitHub Pages tự động hiển thị tất cả các 3D object và ảnh.

Cách dùng:
  Chỉ cần chạy lệnh: python build_data.py
  (hoặc nhấp đúp chuột vào file build_data.bat)
"""

import sys
import json
from pathlib import Path

# Đảm bảo in tiếng Việt trên console Windows không lỗi
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

# Các đuôi file được hỗ trợ
SUPPORTED_EXT = {
    # 3D
    "obj", "ply", "glb", "gltf", "fbx", "stl", "pcd", "xyz", "splat", "ksplat", "spz",
    # Ảnh
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "avif",
    # Video
    "mp4", "webm", "mov", "m4v", "mkv", "ogv", "avi",
    # Phụ trợ (vật liệu, nhị phân)
    "mtl", "bin"
}

def main():
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[!] Thu muc 'data' chua ton tai. Da tu dong tao: {DATA_DIR}")
        print("    Vui long copy cac thu muc 3D va images vao trong thu muc 'data', sau do chay lai script nay.")
        return

    files_list = []
    model_count = 0
    image_count = 0

    for path in sorted(DATA_DIR.rglob("*")):
        if path.is_file():
            # Bỏ qua file manifest chính nó và các file ẩn
            if path.name.lower() in {"manifest.json", ".ds_store", "thumbs.db"} or path.name.startswith("."):
                continue
            ext = path.suffix.lstrip(".").lower()
            if ext in SUPPORTED_EXT:
                # Đường dẫn tương đối từ thư mục gốc web, dùng dấu gạch chéo xuôi
                rel_path = path.relative_to(ROOT).as_posix()
                files_list.append(rel_path)

                if ext in {"obj", "ply", "glb", "gltf", "fbx", "stl", "pcd", "xyz", "splat", "ksplat", "spz"}:
                    model_count += 1
                elif ext in {"jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"}:
                    image_count += 1

    manifest_path = DATA_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(files_list, f, ensure_ascii=False, indent=2)

    print("=" * 55)
    print(" CAP NHAT DU LIEU THANH CONG CHO GITHUB PAGES")
    print("=" * 55)
    print(f"- Tong so file tim thay : {len(files_list)}")
    print(f"- So luong file 3D      : {model_count}")
    print(f"- So luong anh          : {image_count}")
    print(f"- File danh muc da luu  : data/manifest.json")
    print("=" * 55)
    if len(files_list) == 0:
        print("[LUU Y] Hien chua co file nao trong thu muc 'data'.")
        print("Hay copy cac folder chua 3D va thu muc images vao 'data' roi chay lai nhe!")

if __name__ == "__main__":
    main()
