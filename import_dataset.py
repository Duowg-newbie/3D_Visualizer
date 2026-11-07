r"""
Tự động đồng bộ dữ liệu từ thư mục kết quả infer (ví dụ D:\Dataset\results_dataset)
vào thư mục data/ của trang web:
- Tự động lấy file 3D (pc.ply, obj, glb,...) của từng mô hình
- Tự động lấy ảnh gốc tương ứng trong thư mục images/
- Tự động lấy video tương ứng trong thư mục videos/ (nếu có)
- Tự động bỏ qua các file thừa (high_stage, low_stage, timing.json)
- Tự động cập nhật data/manifest.json
"""

import sys
import shutil
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

# Đường dẫn mặc định đến bộ kết quả infer của bạn
DEFAULT_SOURCE = Path(r"D:\Dataset\results_dataset")

# Các đuôi file được hỗ trợ
MODEL_EXTS = {".ply", ".obj", ".glb", ".gltf", ".splat", ".ksplat", ".spz", ".fbx", ".stl"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}

def sync_data(source_path: Path):
    if not source_path.exists():
        print(f"[!] Khong tim thay thu muc nguon: {source_path}")
        return

    print("=" * 60)
    print(f" DONG BO DU LIEU TU: {source_path}")
    print(f" DEN THU MUC WEB   : {DATA_DIR}")
    print("=" * 60)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    images_dst = DATA_DIR / "images"
    images_dst.mkdir(parents=True, exist_ok=True)
    videos_dst = DATA_DIR / "videos"
    videos_dst.mkdir(parents=True, exist_ok=True)

    images_src = source_path / "images"
    has_images_src = images_src.is_dir()

    videos_src = source_path / "videos"
    has_videos_src = videos_src.is_dir()

    copied_models = 0
    copied_images = 0
    copied_videos = 0
    skipped_folders = 0

    # Duyệt qua các thư mục con trong results_dataset
    for item in sorted(source_path.iterdir()):
        if not item.is_dir():
            continue
        if item.name.lower() in {"images", "videos"}:
            continue

        model_id = item.name
        # Tìm file 3D trong thư mục (ưu tiên pc.ply, sau đó là bất kỳ file 3D nào ở cấp 1)
        model_files = [f for f in item.iterdir() if f.is_file() and f.suffix.lower() in MODEL_EXTS]
        if not model_files:
            skipped_folders += 1
            continue

        target_dir = DATA_DIR / model_id
        target_dir.mkdir(parents=True, exist_ok=True)

        for mf in model_files:
            dst_file = target_dir / mf.name
            if not dst_file.exists() or dst_file.stat().st_size != mf.stat().st_size:
                shutil.copy2(mf, dst_file)
            copied_models += 1

        # Tìm ảnh đại diện gốc trong images/ khớp với model_id
        if has_images_src:
            for ext in IMAGE_EXTS:
                img_candidate = images_src / f"{model_id}{ext}"
                if img_candidate.exists():
                    dst_img = images_dst / img_candidate.name
                    if not dst_img.exists() or dst_img.stat().st_size != img_candidate.stat().st_size:
                        shutil.copy2(img_candidate, dst_img)
                    copied_images += 1
                    break

        # Tìm video gốc trong videos/ khớp với model_id (nếu có)
        if has_videos_src:
            for ext in VIDEO_EXTS:
                vid_candidate = videos_src / f"{model_id}{ext}"
                if vid_candidate.exists():
                    dst_vid = videos_dst / vid_candidate.name
                    if not dst_vid.exists() or dst_vid.stat().st_size != vid_candidate.stat().st_size:
                        shutil.copy2(vid_candidate, dst_vid)
                    copied_videos += 1
                    break

    print(f"[OK] Da xu ly thanh cong:")
    print(f"     - So file 3D da lay : {copied_models}")
    print(f"     - So anh dai dien goc: {copied_images}")
    if copied_videos > 0:
        print(f"     - So file video da lay: {copied_videos}")
    if skipped_folders > 0:
        print(f"     - Bo qua {skipped_folders} thu muc khong co file 3D.")
    print("     - Da bo qua toan bo high_stage, low_stage, timing.json.")
    print("=" * 60)

    # Chạy cập nhật manifest.json
    import build_data
    build_data.main()

if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    sync_data(src)
