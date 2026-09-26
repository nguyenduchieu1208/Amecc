# AMECC · Quản lý vật tư & dự án

Ứng dụng quản lý vật tư từ workbook PL và tiến độ từ workbook QLDA. Frontend là static site phù hợp với GitHub Pages; API, đăng nhập/phân quyền và cơ sở dữ liệu chạy trên Cloudflare Worker + D1.

> **Dữ liệu thật không thuộc repository.** Thư mục `Data/` và `QLDA/` vẫn được giữ trên máy và bị ignore. Excel chỉ được tải từ trình duyệt admin lên API bảo mật; workbook gốc không được commit, đưa lên GitHub Pages hay công khai thành JSON. D1 chỉ lưu những trường được ứng dụng cho phép.

## Chạy giao diện

1. Cài Node.js 20+.
2. Cài thư viện: `npm install`.
3. Tạo database Cloudflare D1 và lấy database ID; cập nhật `database_id` trong `wrangler.toml`.
4. Chạy migration local: `npm run db:migrate:local`.
5. Deploy Worker và cấu hình CORS/API:

   ```powershell
   npx wrangler secret put ADMIN_SETUP_KEY
   npm run db:migrate:remote
   npm run deploy:worker
   ```

   Đặt `ADMIN_SETUP_KEY` bằng một chuỗi ngẫu nhiên mạnh (không commit). Sau khi Worker deploy, sửa `public/config.js`, thay `https://REPLACE_WITH_YOUR_WORKER.workers.dev` bằng URL Worker thật.

6. Tạo project GitHub Pages tên `Amecc` cho tài khoản `nguyenduchieu1208`, sau đó bật Pages với source **GitHub Actions**. Workflow trong `.github/workflows/pages.yml` deploy nội dung `public/`.
7. Mở `https://nguyenduchieu1208.github.io/Amecc/`; endpoint Worker trong `wrangler.toml` phải cho phép đúng **origin** URL Pages (origin chỉ gồm scheme + host, không path). `public/config.js` là cấu hình public, không chứa secret.
8. Khởi tạo admin đúng một lần bằng request HTTPS:

   ```powershell
   $body = @{ setup_key = $env:AMECC_ADMIN_SETUP_KEY; username = "ameccadmin"; password = $env:AMECC_INITIAL_ADMIN_PASSWORD } | ConvertTo-Json
   Invoke-RestMethod -Uri "https://YOUR-WORKER.workers.dev/api/auth/setup" -Method Post -ContentType "application/json" -Body $body
   ```

   Đặt hai biến môi trường thành các giá trị mạnh trước khi chạy; không ghi password hoặc setup key vào file/repository. Endpoint setup bị khóa khi đã tồn tại admin. Sau khi tạo admin, xóa `ADMIN_SETUP_KEY` khỏi Worker bằng `npx wrangler secret delete ADMIN_SETUP_KEY`.

## Upload workbook nguồn

- Đăng nhập bằng admin, mở **Quản trị tài khoản & dữ liệu**, chọn mã dự án và tải từng workbook.
- **PL:** `.xlsx`, tên file kết thúc bằng `PL.xlsx`, ví dụ `A290PL.xlsx`. Bộ đọc dò từng sheet, tìm header `AS Symbol` hoặc `Symbol`, bỏ qua `Cover`, sheet bắt đầu `BTP` và sheet `backup`. Lấy Drawing Number, Assembly No., Description, Part No., Size, T.Q'ty, T.Weight, Scope of Steel Work, đã nhận/còn thiếu. Marker `x`/`×`/✓ tạo cấu kiện chính; các dòng sau thuộc cấu kiện gần nhất trong cùng sheet. Hàng đầu của upload cho dự án thay thế bộ dữ liệu PL cũ của chính dự án đó.
- **QLDA:** `.xlsx`, bắt buộc sheet `Progress`; header hàng 3, dữ liệu hàng 4 trở đi. Chỉ các cột B, E–S, AJ–AR và AT–BA được lưu. A, C–D, T–AI, AS, BB trở đi (kể cả AG–AI) và mọi trường không cho phép không được lưu/gửi ra API. Hàng đầu của upload thay thế bộ dữ liệu QLDA cũ của dự án.
- Mỗi workbook tối đa 10 MB. File gốc chỉ đi qua HTTPS trong lúc upload; không lưu trên Worker, GitHub, R2 hay D1.
- Tài khoản viewer chỉ được xem. Admin có thể tạo viewer trong giao diện. Có thể tạo user qua script, password được nhập qua biến môi trường, ví dụ:

  ```powershell
  $env:AMECC_USER_PASSWORD = "mat-khau-nguoi-dung-rat-manh"
  npm run user:create -- nguyenvana viewer
  Remove-Item Env:AMECC_USER_PASSWORD
  ```

  Script CLI dùng cùng PBKDF2-SHA-256 với Worker. Admin đầu tiên nên được khởi tạo qua endpoint setup ở trên.

## Quyền riêng tư & vận hành

- Trước khi cho phép người dùng production, cần điền đúng Cloudflare `database_id`, deploy Worker/D1/migration, URL Worker, URL Pages thật và bí mật setup; không đưa secret vào repo.
- Frontend không có dữ liệu mẫu hoặc fallback fake. Nếu chưa cấu hình Worker hoặc chưa nhập workbook, UI thể hiện trạng thái rỗng/lỗi một cách rõ ràng.
- CORS được giới hạn theo `ALLOWED_ORIGIN`; session bearer token chỉ lưu trong `sessionStorage` và bản băm token lưu ở D1, hết hạn sau 8 giờ; mật khẩu lưu PBKDF2-SHA-256. Luôn dùng HTTPS.
- Mặc định một workbook nhập vào thay thế bảng cùng loại của dự án đó. Nhập PL không xóa QLDA và ngược lại. Sao lưu D1 trước khi cập nhật dữ liệu vận hành quan trọng.
- Quy tắc ẩn QLDA loại A, C–D, T–AI, AS và BB–FG; chỉ trường được liệt kê trong `worker/index.js` được đưa vào database/API. Xác minh với quản trị dữ liệu trước khi mở rộng danh sách xuất.
- Mật khẩu viewer được gửi một lần cho người tạo; thiết lập kênh bàn giao an toàn và chính sách đổi mật khẩu khi vận hành thực tế.

## Kiểm tra

```powershell
npm test
npm run dev
```

`npm run dev` chạy Worker/API kèm static assets trên localhost. Mở URL Wrangler in ra; đổi `apiBaseUrl` trong `public/config.js` sang URL Worker local khi cần test login end-to-end.

Tests kiểm tra schema QLDA, loại trường ẩn, nhận diện header PL và gán dòng vào cấu kiện; nếu có các workbook A290 thật tại `Data/A290PL.xlsx` và `QLDA/A290.xlsx`, cùng một test sẽ đọc file tại chỗ nhưng không xuất nội dung workbook ra log hoặc đưa file vào Git.

Git ignore `Data/`, `QLDA/`, `.dev.vars`, `.env`, `.wrangler`, SQLite/database và `node_modules`.