# AccessMap VN — Frontend Applications

Hệ thống giao diện người dùng (Frontend) của dự án **AccessMap VN** — Nền tảng bản đồ và thu thập dữ liệu tiếp cận cho người khuyết tật và người gặp khó khăn trong vận động tại Việt Nam.

Kho lưu trữ này được cấu trúc theo dạng Monorepo, quản lý hai ứng dụng giao diện chính:
1. **`web-admin/`**: Cổng thông tin quản trị và kiểm duyệt đóng góp (Next.js 16 + React 19 + Tailwind CSS).
2. **`mobile/`**: Ứng dụng di động tìm kiếm địa điểm và đóng góp hiện trường (Expo SDK 57 + React Native 0.86 + React 19).

---

## 🏛 Cấu trúc Thư mục

```text
AccessMapVN-FE/
├── web-admin/              # Next.js App Router (Admin Portal & Moderation)
│   ├── app/                # App router routes & pages (/admin, /login, ...)
│   ├── src/                # Feature-Sliced Design (entities, features, shared, widgets)
│   ├── public/             # Static assets, branding & mock evidence
│   └── package.json
├── mobile/                 # Expo React Native App (Cross-platform Android / iOS)
│   ├── src/
│   │   ├── app/            # Expo Router file-based navigation
│   │   ├── features/       # Feature modules (discovery, contribution, community, auth, ...)
│   │   ├── entities/       # Domain models, place data & mock repositories
│   │   └── shared/         # Reusable UI, theme, API client & utilities
│   ├── assets/             # Icons, splash screen & branding
│   └── package.json
├── package.json            # Root workspace scripts
└── README.md
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### Yêu cầu môi trường
- **Node.js**: Phiên bản 22.13.0 trở lên (khuyên dùng Node 22 LTS).
- **npm**: Phiên bản 10.x hoặc 11.x.
- **Expo Go**: Cài sẵn trên điện thoại (từ Google Play hoặc App Store) nếu muốn xem ứng dụng di động trên thiết bị thật.

---

### 1. Web Admin (`web-admin`)

Cổng quản trị dành cho kiểm duyệt viên và ban quản trị AccessMapVN.

```bash
# Di chuyển vào thư mục web-admin
cd web-admin

# Cài đặt thư viện (nếu chưa cài)
npm install

# Khởi chạy môi trường phát triển
npm run dev
```
- Mở trình duyệt tại: [http://localhost:3000](http://localhost:3000).
- Nhấn **Đăng nhập** ở màn hình đăng nhập demo để vào thẳng Dashboard quản trị.
- **Dữ liệu mẫu có sẵn**: Danh sách hồ sơ đóng góp (`/admin/ho-so-dong-gop`), chi tiết hồ sơ với ảnh hiện trường và bảng đối chiếu quy chuẩn QCVN 10:2024/BXD, thống kê biểu đồ hoạt động.

---

### 2. Ứng dụng Di động (`mobile`)

Ứng dụng di động dành cho người dùng tìm kiếm địa điểm tiếp cận và gửi ảnh/video đóng góp hiện trường.

```bash
# Di chuyển vào thư mục mobile
cd mobile

# Cài đặt thư viện (nếu chưa cài)
npm install

# Khởi chạy Metro Bundler
npm start
```

#### A. Trải nghiệm trên Điện thoại thật:
1. Đảm bảo điện thoại và máy tính kết nối cùng một mạng Wi-Fi.
2. Mở ứng dụng **Expo Go** (Android) hoặc Camera (iOS) quét mã QR hiển thị ở terminal.
> *Mẹo*: Nếu máy tính và điện thoại dùng mạng khác nhau (hoặc 4G), hãy chạy: `npx expo start --tunnel`.

#### B. Xem trước nhanh trên Trình duyệt Web (Desktop):
```bash
npm run web
```
*(Hoặc nhấn phím `w` trong cửa sổ terminal đang chạy `npm start`)*.

---

## 🛠 Lệnh Tiện ích từ Thư mục Gốc (`AccessMapVN-FE`)

Tại thư mục gốc, bạn có thể điều khiển cả hai ứng dụng một cách nhanh chóng:

| Lệnh | Ý nghĩa |
| :--- | :--- |
| `npm run web` | Khởi chạy Web Admin trên cổng 3000 |
| `npm run mobile` | Khởi chạy ứng dụng Mobile với Expo |
| `npm run mobile:web` | Khởi chạy bản xem trước Web của ứng dụng Mobile |
| `npm run check` | Kiểm tra lỗi kiểu TypeScript (`tsc --noEmit`) toàn bộ dự án |
| `npm run build:web` | Tạo bản build production tối ưu cho Web Admin |
| `npm run test:mobile` | Chạy bộ kiểm thử unit test cho ứng dụng Mobile |

---

## ⚙️ Cấu hình Biến Môi trường (Environment Variables)

Mỗi ứng dụng có sẵn file `.env.example` làm mẫu:
- **`web-admin/.env.local`**: Cấu hình URL của Supabase và Backend API.
- **`mobile/.env`**: Cấu hình `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_API_URL`.

*Lưu ý: Ứng dụng được thiết kế với cơ chế **Graceful Fallback** và in-memory mock repository, cho phép xem và duyệt thử toàn bộ giao diện ngay cả khi không kết nối Backend API.*

---

## 📄 Bản quyền
Dự án được phát triển phục vụ cộng đồng người khuyết tật Việt Nam.
