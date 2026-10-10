# TESR Board — Work Planning & Tracking

ระบบติดตามงานแบบการ์ด (สไตล์ Trello) + แดชบอร์ดวัดผลทีม ของ TESR Co., Ltd.

| ส่วน | ใช้อะไร |
|---|---|
| หน้าเว็บ | `index.html` ไฟล์เดียว บน GitHub Pages · ธีม Dark/Light ตาม CI TESR |
| ฐานข้อมูล | Google Sheet **TESR Board DB** (แท็บ Members / Boards / Lists / Cards / Activity) |
| ไฟล์แนบ | Google Drive โฟลเดอร์ **TESR Board / ไฟล์แนบ** |
| API | Google Apps Script `Code.gs` (Web App) |
| ล็อกอิน | อีเมล + เบอร์โทร จาก Sheet ระบบลงเวลา (Work tracking log › Employees) · Admin ใช้บัญชี admin ของระบบลงเวลา |

## ติดตั้ง
1. เปิด Sheet *TESR Board DB* → Extensions → Apps Script → วางโค้ดจาก `Code.gs`
2. เลือกฟังก์ชัน `setup` → Run → อนุญาตสิทธิ์
3. Deploy → New deployment → Web app · Execute as **Me** · Who has access **Anyone** → คัดลอก URL
4. ใส่ URL ใน `CONFIG.API_URL` ของ `index.html`
5. GitHub → Settings → Pages → Branch `main` / root

## การ์ด 2 ประเภท
- 📌 **งาน** — ต้องมีกำหนดส่ง · สี: 🟢 ตามแผน · 🟡 ใกล้กำหนด (≤2 วัน) · 🔴 เลยกำหนด · นับใน KPI
- 📁 **ข้อมูล / ฝากไฟล์** — ไม่ต้องมีกำหนดส่ง · ไม่นับใน KPI

## สิทธิ์
- **พนักงาน / เด็กฝึกงาน** — เห็นแดชบอร์ดและหน้าทีมเฉพาะของตัวเอง
- **Admin** — เห็นทั้งทีม และเลือกดูแดชบอร์ดรายบุคคลได้
