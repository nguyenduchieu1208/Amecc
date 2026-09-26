# AMECC Local Data Prototype

## Chạy trên localhost

1. Cài Python 3.10 trở lên.
2. Mở PowerShell/Command Prompt tại thư mục dự án và cài thư viện:

   ```powershell
   python -m pip install -r requirements.txt
   ```

3. Chạy `run_local.bat`, hoặc chạy lệnh:

   ```powershell
   python -m uvicorn app:app --host 127.0.0.1 --port 8000
   ```

4. Mở <http://127.0.0.1:8000>.

Ứng dụng mặc định chỉ bind vào localhost. Workbook có sẵn được đọc để hiển thị; tải workbook mới lên cần phiên đăng nhập quản trị. File tải lên hợp lệ được lưu vào thư mục `Data` hoặc `QLDA` tương ứng.

## Quản trị và tải workbook

Trước khi chạy ứng dụng, cấu hình mật khẩu admin trong PowerShell (không commit mật khẩu vào mã nguồn):

```powershell
$env:AMECC_ADMIN_PASSWORD = "mat-khau-quan-tri-cua-ban"
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Có thể đặt thêm `AMECC_ADMIN_SESSION_SECRET` để dùng khóa ký cookie phiên riêng. Nếu không đặt, mật khẩu admin được dùng làm khóa ký. Đăng nhập trong mục **Quản trị**; cookie phiên HttpOnly hết hạn sau 8 giờ. Không cấu hình ứng dụng ra mạng công cộng nếu chưa triển khai HTTPS và các biện pháp bảo mật production phù hợp.

- PL: chỉ nhận `.xlsx` hợp lệ, tối đa 25 MB, tên file phải kết thúc bằng `PL.xlsx` (ví dụ `A290PL.xlsx`). File được lưu trong `Data`.
- QLDA: chỉ nhận `.xlsx` hợp lệ có sheet `Progress`, tối đa 25 MB. File được lưu trong `QLDA`.
- Các API upload được bảo vệ phía server; đăng nhập giao diện không phải là biện pháp bảo vệ duy nhất.
- Dashboard là trang mở đầu; trang cấu kiện lọc sẵn dự án `A290`. Bảng QLDA hiển thị 50 dòng/trang và có vùng cuộn riêng để vừa với màn hình.

## Lưu ý về dữ liệu

- Nhận diện cấu kiện chính dựa trên tiêu đề `AS Symbol` hoặc `Symbol`; marker `x` được đánh dấu là cấu kiện chính.
- Mỗi marker `x` trong `AS Symbol`/`Symbol` mở một cấu kiện chính; các dòng kế tiếp thuộc nhóm đó cho đến marker `x` tiếp theo trong cùng sheet.
- Vòng tròn tiến độ trên cấu kiện chính tính bằng tổng số lượng đã nhận của các dòng con chia tổng TQty của các dòng con. Nếu workbook không có dữ liệu đủ để tính thì hiển thị `—`.
- Cột O (`Scope of Steel Work`) được hiển thị như phạm vi công việc, ví dụ `AMC2`; đây là trường nguồn được đọc, không phải kết luận hay quy tắc phân loại AMECC.
- Trạng thái số lượng chỉ kết luận khi tìm thấy giá trị nhận/thiếu phù hợp; trường hợp khác hiển thị `chưa xác định`.
- QLDA đọc sheet `Progress`, header hàng 3 và dữ liệu từ hàng 4. Các cột bị loại chỉ ẩn khỏi đầu ra ứng dụng, không thay đổi workbook nguồn.
- Cột AG–AI được parse cho thông tin nhận phôi nhưng ẩn khỏi báo cáo theo yêu cầu.
- Đây là prototype local, chưa triển khai GitHub Pages và không có xác thực người dùng.