# TESR Board — Work Planning & Tracking

ระบบติดตามงานแบบการ์ด (สไตล์ Trello) + แดชบอร์ดวัดผลทีม ของ TESR Co., Ltd.

- เว็บไฟล์เดียว `index.html` รันบน GitHub Pages
- ฐานข้อมูล: Supabase project **TESR Time Clock** (ตาราง `tb_*` แยกจากข้อมูลลงเวลา)
- ล็อกอิน: อีเมล + เบอร์โทรศัพท์ (ดึงจากระบบลงเวลา) · Admin ใช้บัญชี admin ของระบบลงเวลา
- ธีม Dark / Light ตาม CI TESR (ดำ–ทอง–แดง)

## ติดตั้งครั้งแรก
1. Supabase → project *TESR Time Clock* → SQL Editor → รัน `setup.sql`
2. GitHub → Settings → Pages → Branch `main` / root
