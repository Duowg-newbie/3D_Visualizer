HƯỚNG DẪN CẤU TRÚC THƯ MỤC TRONG 'data/':
=========================================

Mỗi khuôn mặt hoặc vật thể 3D nên nằm trong 1 thư mục riêng.
Ảnh đại diện gốc nằm trong thư mục con tên là 'images'.

Ví dụ:
data/
  khuon_mat_01/
    images/
      anh_goc.jpg     <-- Ảnh đại diện gốc
    mo_hinh.obj       <-- File 3D (OBJ, PLY, GLB, SPLAT...)
    mo_hinh.mtl       <-- (Nếu có)
    texture.png       <-- (Nếu có)
  
  khuon_mat_02/
    images/
      chan_dung.png   <-- Ảnh đại diện gốc
    face.ply

LƯU Ý:
Mỗi khi bạn thêm, sửa hoặc xoá thư mục 3D:
-> Chỉ cần nhấp đúp chuột vào file 'build_data.bat' ở thư mục ngoài để tự động cập nhật danh mục!
