# BurstFlow

PWA local-first ép đúng workflow **sprint/burst** (đã luận cho lá Thiên): dồn theo đợt, **1 việc + 1 deliverable mỗi block**, **xoay vòng 2–3 dự án**, **WIP-lock** chặn việc mới chen ngang.

## Chạy
```bash
npm install
npm run dev      # phát triển
npm run build    # đóng gói dist/
npm run preview  # chạy thử bản build
```
Mở trên điện thoại/desktop → trình duyệt hiện nút **Cài đặt** (PWA). Dữ liệu nằm hẳn ở máy (IndexedDB), không server.

## 5 tính năng MVP
1. **Block timer** 60/90/120′ — còn giờ tính ngược, hết giờ nhấp nháy nhắc chốt.
2. **Deliverable gate** — bắt nhập "xong là gì" trước khi start; kết block hỏi *"đã ra artifact chưa?"*.
3. **1 việc/block + gợi ý xoay dự án** — chỉ chọn 1 task; app gợi ý dự án khác block trước.
4. **WIP-lock** — đang chạy block thì không mở block thứ 2; việc mới ghi nhanh rơi vào **Inbox**, triage sau.
5. **Nhật ký ngày** — số block, phút tập trung, tỷ lệ ra deliverable, theo dự án + ô ghi chú cuối ngày.

## Stack
Vite + React (JSX) + Dexie/IndexedDB + vite-plugin-pwa. Không backend, không TS.

## Chưa làm (đợt sau, đừng làm trước khi dùng thử 1 tuần)
- Nhắc triage theo lịch cố định (push notification).
- Đồng bộ nhiều thiết bị (thêm 1 lớp Supabase).
- Thống kê tuần/tháng, streak.
