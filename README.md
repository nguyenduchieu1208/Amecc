# AMECC · Quản lý vật tư & dự án

Ứng dụng quản lý vật tư từ workbook PL và tiến độ từ workbook QLDA. Frontend là static site phù hợp với GitHub Pages; API, đăng nhập/phân quyền và cơ sở dữ liệu chạy trên Cloudflare Worker + D1.

> **Dữ liệu thật không thuộc repository.** Thư mục `Data/` và `QLDA/` vẫn được giữ trên máy và bị ignore. Excel được đọc trong trình duyệt admin; chỉ các trường được ứng dụng cho phép mới được gửi qua HTTPS lên API. Workbook gốc và JSON tạm không được commit, đưa lên GitHub Pages hay lưu trên Worker. D1 chỉ lưu những trường được ứng dụng cho phép.

## Chạy giao diện

1. Cài Node.js 20+.
2. Cài thư viện: `npm install`.
3. Tạo database Cloudflare D1 và lấy database ID; cập nhật `database_id` trong `wrangler.toml`.
4. Chạy migration local: `npm run db:migrate:local` (bao gồm các migration tới `0006_btp_bom_details.sql`).
5. Deploy Worker và cấu hình CORS/API:

   ```powershell
   npx wrangler secret put ADMIN_SETUP_KEY
   npm run db:migrate:remote
   npm run deploy:worker
   ```

   Đặt `ADMIN_SETUP_KEY` bằng một chuỗi ngẫu nhiên mạnh (không commit). Sau khi Worker deploy, sửa `public/config.js`, thay `https://REPLACE_WITH_YOUR_WORKER.workers.dev` bằng URL Worker thật.

6. Tạo project GitHub Pages tên `Amecc` cho tài khoản `nguyenduchieu1208`, sau đó bật Pages với source **GitHub Actions**. Workflow trong `.github/workflows/pages.yml` deploy nội dung `public/`.
7. Mở `https://nguyenduchieu1208.github.io/Amecc/` để xem dữ liệu dự án công khai; trang này không yêu cầu đăng nhập. Trang quản trị riêng tại `https://nguyenduchieu1208.github.io/Amecc/admin.html` yêu cầu tài khoản admin để đăng nhập, nhập workbook và xóa file. Endpoint Worker trong `wrangler.toml` phải cho phép đúng **origin** URL Pages (origin chỉ gồm scheme + host, không path). `public/config.js` là cấu hình public, không chứa secret.
8. Khởi tạo admin đúng một lần bằng request HTTPS:

   ```powershell
   $body = @{ setup_key = $env:AMECC_ADMIN_SETUP_KEY; username = "ameccadmin"; password = $env:AMECC_INITIAL_ADMIN_PASSWORD } | ConvertTo-Json
   Invoke-RestMethod -Uri "https://YOUR-WORKER.workers.dev/api/auth/setup" -Method Post -ContentType "application/json" -Body $body
   ```

   Đặt hai biến môi trường thành các giá trị mạnh trước khi chạy; không ghi password hoặc setup key vào file/repository. Endpoint setup bị khóa khi đã tồn tại admin. Sau khi tạo admin, xóa `ADMIN_SETUP_KEY` khỏi Worker bằng `npx wrangler secret delete ADMIN_SETUP_KEY`.

## Upload workbook nguồn

- Không cần đăng nhập để xem danh sách dự án, BOM/vật tư PL theo sheet, BTP theo sheet và ngày nhận, cùng tiến độ QLDA tại trang chính. BTP có tab riêng; bộ lọc và nút xuất nằm trên bảng chi tiết duy nhất, cột mã cấu kiện và bản vẽ được giữ cố định khi cuộn ngang. Đăng nhập tại `/admin.html` chỉ khi cần cập nhật workbook, tạo viewer hoặc quản trị file.
- Admin mở trang `/admin.html` để nhập workbook và xem danh sách file PL/BTP đang lưu theo dự án. Có thể xóa từng file trước khi tải file khác vào; thao tác xóa gỡ cả dữ liệu PL và BTP cùng tên file nhưng không ảnh hưởng workbook QLDA hoặc file PL khác.
- **PL/BTP:** `.xlsx`, tên file kết thúc bằng `PL.xlsx`, ví dụ `A290PL.xlsx`; mã dự án tự lấy từ tên file. File PL/BTP tối đa 20 MB. Tải lại cùng tên sẽ thay dữ liệu của file đó; sheet/loại dữ liệu không có dòng mới được dọn để không giữ dữ liệu cũ. Bộ đọc nhận diện sheet PL qua header `AS Symbol`/`Symbol` và các sheet `BTP*` qua header chi tiết `Part No.1` (hoặc alias mã chi tiết), lưu hai tập riêng. Tab **BOM & Vật tư PL** lọc theo từng sheet/hạng mục. Tab **Bán thành phẩm** lọc theo toàn bộ hoặc một sheet BTP, ngày nhận, trạng thái và từ khóa; lịch nhận giữ đủ mọi ngày có số lượng. Bảng đối chiếu ghép BTP với dòng BOM con và cấu kiện cha trong đúng file/sheet, đồng thời đánh dấu dòng chưa khớp. Nút xuất tạo bản sao từ `List_thieu_mau.xlsx`, ghi các dòng còn thiếu vào sheet `Bieu mau check tinh trang BTP` và kèm thông số cùng nguồn dòng BOM/QLDA để kiểm tra. Ngày giao PL được nhận diện theo header `Ngày giao`/`Delivery Date`; các cột `Date Issue` lưu riêng. `Delivery item` không được coi là ngày giao khi chưa xác nhận ý nghĩa. Marker `x`/`×`/✓ tạo cấu kiện chính; các dòng sau thuộc cấu kiện gần nhất trong cùng sheet. Upload PL/BTP được gửi thành các phần 100 dòng vào staging; chỉ khi đã đủ và kiểm tra toàn bộ, transaction thay dữ liệu theo file/loại dữ liệu. Upload lỗi trước commit không thay dữ liệu hiện hành. Phiên nhập hết hạn sau một giờ.
- **QLDA:** `.xlsx`, bắt buộc sheet `Progress`; header hàng 3, dữ liệu hàng 4 trở đi. Chỉ các cột B, E–S, AJ–AR và AT–BA được lưu. A, C–D, T–AI, AS, BB trở đi (kể cả AG–AI) và mọi trường không cho phép không được lưu/gửi ra API. Hàng đầu của upload thay thế bộ dữ liệu QLDA cũ của dự án.
- QLDA tối đa 10 MB. Với PL/BTP, trình duyệt phân tích workbook tới 20 MB và chỉ gửi JSON các trường được phép; QLDA tiếp tục gửi workbook qua HTTPS để Worker phân tích. File gốc và JSON tạm không lưu trên Worker, GitHub, R2 hay D1.
- Dữ liệu đọc qua giao diện/API dự án là công khai, không yêu cầu đăng nhập. Các thao tác tạo tài khoản, nhập workbook và xóa file vẫn yêu cầu admin; tài khoản viewer chỉ có quyền đọc. Admin có thể tạo viewer trong giao diện. Có thể tạo user qua script, password được nhập qua biến môi trường, ví dụ:

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
