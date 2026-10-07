# AMECC · Quản lý vật tư & dự án

Ứng dụng quản lý vật tư từ workbook PL và tiến độ từ workbook QLDA. Frontend là static site trên GitHub Pages; API chạy bằng Supabase Edge Functions và dữ liệu đặt trong Supabase PostgreSQL.

> **Dữ liệu thật không thuộc repository.** Thư mục `Data/` và `QLDA/` vẫn được giữ trên máy và bị ignore. Excel được đọc trong trình duyệt admin hoặc trong Google Apps Script cá nhân; chỉ các trường được ứng dụng cho phép mới được gửi qua HTTPS lên API. Workbook gốc và JSON tạm không được commit, đưa lên GitHub Pages hay lưu trong Supabase. PostgreSQL chỉ lưu những trường được ứng dụng cho phép.

## Chạy giao diện

1. Cài Node.js 20+ và Supabase CLI.
2. Cài thư viện: `npm install`.
3. Tạo project Supabase Free, rồi đăng nhập CLI và liên kết project `ymewopsgearpdsvzyaxb`:

   ```powershell
   npx supabase login
   npx supabase link --project-ref ymewopsgearpdsvzyaxb
   ```

4. Áp dụng schema và deploy API:

   ```powershell
   npx supabase db push
   npx supabase functions deploy amecc-api
   ```

   Đặt `ADMIN_SETUP_KEY` bằng một chuỗi ngẫu nhiên mạnh trong Supabase Function Secrets, không commit giá trị này. `public/config.js` chứa URL project và publishable key; publishable key được thiết kế để công khai.

   Nút **Làm mới** ở góc giao diện yêu cầu mật khẩu riêng phía máy chủ, sau đó xếp yêu cầu cho Apps Script kiểm tra các thư mục Drive. Apps Script chỉ đồng bộ các workbook mới, bị sửa, đổi tên hoặc đang lỗi; file không thay đổi được bỏ qua. Cấu hình hoặc đổi mật khẩu bằng Supabase Function Secret (không đặt trong `public/config.js`):

   ```powershell
   npx supabase secrets set AMECC_REFRESH_PASSWORD="<MAT_KHAU_MOI>" MANUAL_REFRESH_COOLDOWN_SECONDS="60"
   ```

   Mật khẩu phải có ít nhất 8 ký tự. Thời gian chống spam áp dụng chung cho mọi người dùng; mặc định 60 giây, có thể đặt từ 10 đến 3.600 giây. Apps Script chạy bằng quyền Drive của chủ script, nên người xem khác chỉ cần mở website và nhập mật khẩu làm mới; họ không cần được chia sẻ thư mục Drive.

5. Tạo project GitHub Pages tên `Amecc` cho tài khoản `nguyenduchieu1208`, sau đó bật Pages với source **GitHub Actions**. Workflow trong `.github/workflows/pages.yml` deploy nội dung `public/`.
6. Mở `https://nguyenduchieu1208.github.io/Amecc/` để xem dữ liệu dự án công khai; trang này không yêu cầu đăng nhập. Trang quản trị riêng tại `https://nguyenduchieu1208.github.io/Amecc/admin.html` yêu cầu tài khoản admin để đăng nhập, nhập workbook và xóa file. Edge Function chỉ cho phép đúng **origin** URL Pages (origin chỉ gồm scheme + host, không path). `public/config.js` là cấu hình public, không chứa secret.
7. Nếu database chưa có admin sau khi khôi phục, khởi tạo admin đúng một lần bằng request HTTPS:

   ```powershell
   $body = @{ setup_key = $env:AMECC_ADMIN_SETUP_KEY; username = "ameccadmin"; password = $env:AMECC_INITIAL_ADMIN_PASSWORD } | ConvertTo-Json
   $headers = @{ apikey = $env:SUPABASE_PUBLISHABLE_KEY }
   Invoke-RestMethod -Uri "https://ymewopsgearpdsvzyaxb.supabase.co/functions/v1/amecc-api/api/auth/setup" -Method Post -Headers $headers -ContentType "application/json" -Body $body
   ```

   Đặt hai biến môi trường thành các giá trị mạnh trước khi chạy; không ghi password hoặc setup key vào file/repository. Nếu chuyển dữ liệu từ bản SQLite, admin hiện có cũng được chuyển nên không cần chạy bước setup. Endpoint setup bị khóa khi đã tồn tại admin. Sau khi tạo admin mới, xóa `ADMIN_SETUP_KEY` khỏi Supabase Function Secrets bằng `npx supabase secrets unset ADMIN_SETUP_KEY`.

## Upload workbook nguồn

- Không cần đăng nhập để xem danh sách dự án, BOM/vật tư PL theo sheet, BTP theo sheet và ngày nhận, cùng tiến độ QLDA tại trang chính. BTP có tab riêng; bộ lọc và nút xuất nằm trên bảng chi tiết duy nhất, cột mã cấu kiện và bản vẽ được giữ cố định khi cuộn ngang. Đăng nhập tại `/admin.html` chỉ khi cần cập nhật workbook, tạo viewer hoặc quản trị file.
- Admin mở trang `/admin.html` để nhập workbook và xem danh sách file PL/BTP đang lưu theo dự án. Có thể xóa từng file trước khi tải file khác vào; thao tác xóa gỡ cả dữ liệu PL và BTP cùng tên file nhưng không ảnh hưởng workbook QLDA hoặc file PL khác.
- **PL/BTP:** `.xlsx`, tên file kết thúc bằng `PL.xlsx`, ví dụ `A290PL.xlsx`; mã dự án tự lấy từ tên file. File PL/BTP tối đa 20 MB. Tải lại cùng tên sẽ thay dữ liệu của file đó; sheet/loại dữ liệu không có dòng mới được dọn để không giữ dữ liệu cũ. Bộ đọc nhận diện sheet PL qua header `AS Symbol`/`Symbol` và các sheet `BTP*` qua header chi tiết `Part No.1` (hoặc alias mã chi tiết), lưu hai tập riêng. Tab **BOM & Vật tư PL** lọc theo từng sheet/hạng mục. Tab **Bán thành phẩm** lọc theo toàn bộ hoặc một sheet BTP, ngày nhận, trạng thái và từ khóa; lịch nhận giữ đủ mọi ngày có số lượng. Bảng đối chiếu ghép BTP với dòng BOM con và cấu kiện cha trong đúng file/sheet, đồng thời đánh dấu dòng chưa khớp. Nút xuất tạo bản sao từ `List_thieu_mau.xlsx`, ghi các dòng còn thiếu vào sheet `Bieu mau check tinh trang BTP` và kèm thông số cùng nguồn dòng BOM/QLDA để kiểm tra. Ngày giao PL được nhận diện theo header `Ngày giao`/`Delivery Date`; các cột `Date Issue` lưu riêng. `Delivery item` không được coi là ngày giao khi chưa xác nhận ý nghĩa. Marker `x`/`×`/✓ tạo cấu kiện chính; các dòng sau thuộc cấu kiện gần nhất trong cùng sheet. PL/BTP được gửi bằng các phần an toàn vào staging; chỉ khi đủ dữ liệu và kiểm tra toàn bộ, transaction mới thay dữ liệu hiện hành theo file/loại dữ liệu. Upload lỗi trước commit không thay dữ liệu. Phiên nhập hết hạn sau một giờ.
- **QLDA:** `.xlsx`, bắt buộc sheet `Progress`; header hàng 3, dữ liệu hàng 4 trở đi. Chỉ các cột B, E–S, AJ–AR và AT–BA được lưu. A, C–D, T–AI, AS, BB trở đi (kể cả AG–AI) và mọi trường không cho phép không được lưu/gửi ra API. Hàng đầu của upload thay thế bộ dữ liệu QLDA cũ của dự án.
- QLDA tối đa 10 MB; workbook được đọc trong trình duyệt, và chỉ JSON của các cột được cho phép gửi qua HTTPS theo từng phần 100 dòng. Dữ liệu cũ chỉ được thay sau khi đủ các phần và commit transaction thành công. File Excel gốc không được gửi lên API, GitHub hay Supabase Storage.
- Muốn tự đồng bộ PL/BTP từ thư mục Drive riêng tư, xem hướng dẫn [Drive sync](drive-sync/README.md). Apps Script đọc workbook và gửi các trường PL/BTP đã phân tích; token đồng bộ chỉ cấp quyền vào tuyến nhập PL/BTP. Trigger chạy mỗi phút và chỉ nhập file thay đổi; lần đầu có thể cần nhiều lượt chạy.
- Dữ liệu đọc qua giao diện/API dự án là công khai, không yêu cầu đăng nhập. Các thao tác tạo tài khoản, nhập workbook và xóa file vẫn yêu cầu admin; tài khoản viewer chỉ có quyền đọc. Admin tạo viewer trong giao diện quản trị.

## Supabase PostgreSQL và khôi phục dữ liệu

Supabase Edge Function dùng lại tuyến API, đăng nhập admin/viewer và xử lý workbook hiện tại. PostgreSQL chạy trong project Supabase; GitHub Pages tiếp tục giữ giao diện. Publishable key trong `public/config.js` là key công khai, còn database password và khóa khởi tạo admin chỉ được đưa vào biến môi trường/Function Secrets.

Để khôi phục bản sao dữ liệu D1 đã có trên máy quản trị, trước tiên áp dụng migration PostgreSQL bằng `npx supabase db push`. Sau đó đặt biến môi trường kết nối database với mật khẩu đã URL-encode (ký tự `@` cần thành `%40`) và chạy:

```powershell
$env:AMECC_SUPABASE_DB_URL = "postgresql://postgres.ymewopsgearpdsvzyaxb:<MAT_KHAU_URL_ENCODED>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
npm run db:import:supabase
Remove-Item Env:AMECC_SUPABASE_DB_URL
```

Script đọc `Data/amecc-migrated.sqlite`, chỉ nhập khi các bảng đích còn trống, và chuyển dữ liệu theo lô trong transaction. Cơ sở dữ liệu SQLite và workbook ở `Data/` bị Git ignore. Dùng URI **Session pooler** IPv4 trong Supabase Connect panel; mật khẩu có ký tự đặc biệt phải URL-encode.

Sau khi schema và dữ liệu đã có, deploy Edge Function. Trước khi đổi giao diện production, kiểm tra trực tiếp endpoint `/api/health`, đăng nhập admin, danh sách dự án, BTP, QLDA, thao tác xuất và một lần nhập thử. Chỉ sau khi các bước đó qua mới deploy `public/config.js` trỏ sang Supabase; giữ nguyên backend cũ cho tới khi xác minh xong.

## Quyền riêng tư & vận hành

- Trước khi cho phép người dùng production, cần xác nhận Supabase schema, Edge Function, URL Pages và migration dữ liệu; không đưa database password hoặc khóa setup vào repo.
- Frontend không có dữ liệu mẫu hoặc fallback fake. Nếu chưa cấu hình Supabase Edge Function hoặc chưa nhập workbook, UI thể hiện trạng thái rỗng/lỗi một cách rõ ràng.
- CORS được giới hạn theo origin GitHub Pages; session bearer token chỉ lưu trong `sessionStorage` và bản băm token lưu ở PostgreSQL, hết hạn sau 8 giờ; mật khẩu lưu PBKDF2-SHA-256. Luôn dùng HTTPS.
- Mặc định một workbook nhập vào thay thế bảng cùng loại của dự án đó. Nhập PL không xóa QLDA và ngược lại. Sao lưu dữ liệu Supabase trước khi cập nhật dữ liệu vận hành quan trọng.
- Quy tắc ẩn QLDA loại A, C–D, T–AI, AS và BB–FG; chỉ trường được liệt kê trong `worker/index.js` được đưa vào database/API. Xác minh với quản trị dữ liệu trước khi mở rộng danh sách xuất.
- Mật khẩu viewer được gửi một lần cho người tạo; thiết lập kênh bàn giao an toàn và chính sách đổi mật khẩu khi vận hành thực tế.

## Kiểm tra

```powershell
npm test
npm run dev
```

`npm run dev` vẫn chạy Worker/API và SQLite trên localhost. Khi chạy Supabase Edge Function local, dùng `npx supabase functions serve amecc-api` cùng local Supabase stack.

Tests kiểm tra schema QLDA, loại trường ẩn, nhận diện header PL và gán dòng vào cấu kiện; nếu có các workbook A290 thật tại `Data/A290PL.xlsx` và `QLDA/A290.xlsx`, cùng một test sẽ đọc file tại chỗ nhưng không xuất nội dung workbook ra log hoặc đưa file vào Git.

Git ignore `Data/`, `QLDA/`, `.dev.vars`, `.env`, `.wrangler`, `supabase/.temp`, SQLite/database và `node_modules`.
