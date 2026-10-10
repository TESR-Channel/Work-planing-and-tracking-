# TESR Board — Work Planning & Tracking

ระบบติดตามงานแบบการ์ด (สไตล์ Trello) + แดชบอร์ดวัดผลทีม ของ TESR Co., Ltd.

| ส่วน | ใช้อะไร |
|---|---|
| หน้าเว็บ | `index.html` ไฟล์เดียว บน GitHub Pages · ธีม Dark/Light ตาม CI TESR |
| ฐานข้อมูล | Google Sheet **TESR Board DB** (แท็บ Members / Boards / Lists / Cards / Activity) |
| ไฟล์แนบ | Google Drive โฟลเดอร์ **TESR Board / ไฟล์แนบ** |
| API | Google Apps Script `Code.gs` (Web App) |
| ล็อกอิน | อีเมล + เบอร์โทร จากระบบลงเวลา TESR Time Clock · Admin ใช้บัญชี admin ของระบบลงเวลา |

## ติดตั้ง
1. เปิด Sheet *TESR Board DB* → Extensions → Apps Script → วางโค้ดจาก `Code.gs`
2. Project Settings → Script Properties → เพิ่ม `SUPABASE_SERVICE_KEY` (service_role key ของ TESR Time Clock)
   - สำรอง: `ADMIN_EMAIL` + `ADMIN_PASSWORD` ถ้าต้องการบัญชี admin แยก
3. เลือกฟังก์ชัน `setup` → Run → อนุญาตสิทธิ์
4. Deploy → New deployment → Web app · Execute as **Me** · Who has access **Anyone** → คัดลอก URL
5. ใส่ URL ใน `CONFIG.API_URL` ของ `index.html` (หรือหน้า ⚙️ ขั้นสูง)
6. GitHub → Settings → Pages → Branch `main` / root
