r"""
import_dataset.py — Tự động đồng bộ các mô hình 3D và ảnh gốc từ results_dataset vào Web
Cấu trúc mới hỗ trợ ĐA MÔ HÌNH (Multi-Model Benchmark):
- Kho ảnh gốc 2D dùng chung : data/images/<ID>.<ext>
- Kết quả của từng model AI : data/models/<tên_model>/<ID>/<file_3d>
- Tự động bỏ qua rác: high_stage, low_stage, timing.json
- Tự động tạo manifest.json
- Tùy chọn tự động git commit & push lên GitHub Pages
"""

import sys
import os
import shutil
import json
import subprocess
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DEFAULT_SOURCE = Path(r"D:\Dataset\results_dataset")

MODEL_EXTS = {".ply", ".obj", ".glb", ".gltf", ".splat", ".ksplat", ".spz", ".fbx", ".stl"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}

def build_manifest():
    """Tạo file manifest.json chuẩn đa mô hình từ thư mục data/"""
    print("-> Đang cập nhật data/manifest.json...")
    images_dir = DATA_DIR / "images"
    models_dir = DATA_DIR / "models"
    
    models_list = []
    if models_dir.is_dir():
        models_list = sorted([d.name for d in models_dir.iterdir() if d.is_dir()])
    
    files = []
    
    # 1. Thêm ảnh gốc
    if images_dir.is_dir():
        for f in sorted(images_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                files.append(f"data/images/{f.name}")
                
    # 2. Thêm file 3D của từng model
    if models_dir.is_dir():
        for m_dir in sorted(models_dir.iterdir()):
            if not m_dir.is_dir():
                continue
            model_name = m_dir.name
            for id_dir in sorted(m_dir.iterdir()):
                if not id_dir.is_dir():
                    continue
                id_name = id_dir.name
                for f in sorted(id_dir.iterdir()):
                    if f.is_file() and f.suffix.lower() in (MODEL_EXTS | VIDEO_EXTS):
                        files.append(f"data/models/{model_name}/{id_name}/{f.name}")

    manifest_data = {
        "version": 2,
        "models": models_list,
        "files": files
    }
    
    manifest_path = DATA_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, ensure_ascii=False, indent=2)
        
    print(f"✓ Đã lưu manifest.json ({len(files)} files, {len(models_list)} model: {', '.join(models_list) or 'Chưa có'})")
    return manifest_data

def sync_data(source_path: Path):
    if not source_path.exists():
        print(f"[!] Không tìm thấy thư mục nguồn: {source_path}")
        return

    print("=" * 65)
    print(f"   ĐỒNG BỘ DỮ LIỆU ĐA MÔ HÌNH VÀO WEB")
    print(f"   Nguồn : {source_path}")
    print(f"   Đích  : {DATA_DIR}")
    print("=" * 65)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    images_dst = DATA_DIR / "images"
    images_dst.mkdir(parents=True, exist_ok=True)
    models_dst = DATA_DIR / "models"
    models_dst.mkdir(parents=True, exist_ok=True)

    # 1. Đồng bộ kho ảnh gốc images/
    images_src = source_path / "images"
    copied_images = 0
    if images_src.is_dir():
        print("-> Đang kiểm tra kho ảnh gốc (images/)...")
        for img in images_src.iterdir():
            if img.is_file() and img.suffix.lower() in IMAGE_EXTS:
                dst = images_dst / img.name
                if not dst.exists() or dst.stat().st_size != img.stat().st_size:
                    shutil.copy2(img, dst)
                    copied_images += 1
        print(f"   ✓ Đã đồng bộ {copied_images} ảnh mới/cập nhật vào data/images/")
    else:
        print("   [!] Không thấy thư mục images/ trong nguồn.")

    # 2. Quét các thư mục model AI (mọi folder khác images)
    detected_models = []
    for item in sorted(source_path.iterdir()):
        if not item.is_dir() or item.name.lower() in {"images", "videos"}:
            continue
        detected_models.append(item)

    total_models_copied = 0
    for m_folder in detected_models:
        model_name = m_folder.name
        target_model_dir = models_dst / model_name
        target_model_dir.mkdir(parents=True, exist_ok=True)
        print(f"-> Đang xử lý model: [{model_name}]...")
        
        m_copied = 0
        for id_folder in m_folder.iterdir():
            if not id_folder.is_dir():
                continue
            id_name = id_folder.name
            
            # Tìm file 3D ở cấp 1 (bỏ qua high_stage, low_stage)
            model_files = [f for f in id_folder.iterdir() if f.is_file() and f.suffix.lower() in MODEL_EXTS]
            if not model_files:
                continue
                
            dst_id_dir = target_model_dir / id_name
            dst_id_dir.mkdir(parents=True, exist_ok=True)
            
            for mf in model_files:
                dst_mf = dst_id_dir / mf.name
                if not dst_mf.exists() or dst_mf.stat().st_size != mf.stat().st_size:
                    shutil.copy2(mf, dst_mf)
                    m_copied += 1
                    
        print(f"   ✓ Model [{model_name}]: đã đồng bộ {m_copied} file 3D mới/cập nhật.")
        total_models_copied += m_copied

    print("-" * 65)
    # Cập nhật manifest
    build_manifest()
    print("=" * 65)
    print(" HOÀN TẤT ĐỒNG BỘ DỮ LIỆU CỤC BỘ!")
    print("=" * 65)

    # 3. Hỏi người dùng có muốn tự động đẩy lên GitHub không
    if sys.stdin.isatty():
        try:
            ans = input("\n[?] Bạn có muốn tự động đẩy lên GitHub Pages ngay bây giờ không? (y/n) [mặc định: y]: ").strip().lower()
            if ans in {"", "y", "yes"}:
                push_to_github()
        except KeyboardInterrupt:
            pass

def push_to_github():
    print("\n-> Đang tự động commit và đẩy lên GitHub Pages...")
    try:
        subprocess.run(["git", "add", "data/"], check=True)
        # Kiểm tra xem có gì thay đổi để commit không
        diff = subprocess.run(["git", "diff", "--cached", "--quiet"])
        if diff.returncode != 0:
            subprocess.run(["git", "commit", "-m", "chore: Cập nhật dữ liệu 3D và manifest mới"], check=True)
            print("-> Đang đẩy code lên branch main...")
            subprocess.run(["git", "push", "origin", "main"], check=True)
            print("\n[✓] THÀNH CÔNG! Dữ liệu đã được cập nhật lên GitHub Pages.")
            print("    Thầy cô và người khác có thể xem link online sau khoảng 1–2 phút.\n")
        else:
            print("[i] Dữ liệu trên git đã là mới nhất, không có thay đổi để commit.")
    except Exception as e:
        print(f"[!] Lỗi khi đẩy lên GitHub: {e}")
        print("    Bạn có thể tự gõ: git add data/ && git commit -m 'update' && git push origin main")

if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    sync_data(src)
