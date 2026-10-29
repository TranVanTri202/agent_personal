# Hướng dẫn Quản lý & Sử dụng Sticker (Zalo Official Bot)

## 1. Giới thiệu
Personal AI Agent hỗ trợ gửi sticker thông minh theo ngữ cảnh cảm xúc thông qua Zalo Official Bot API (`sendSticker`) qua SDK `zalo-bot-js`. 

Danh sách ID sticker được lưu trữ bền vững trong cơ sở dữ liệu **PostgreSQL** (`StickerItem`), đồng thời đồng bộ hai chiều với file cấu hình `config/stickers.json` và phân loại theo 11 nhóm cảm xúc:
- `hello` (chào hỏi)
- `happy` (vui vẻ, khen ngợi)
- `funny` (hài hước, dí dỏm)
- `thanks` (cảm ơn)
- `sorry` (xin lỗi nhẹ nhàng)
- `celebrate` (chúc mừng)
- `encourage` (động viên)
- `love` (yêu thích)
- `surprised` (bất ngờ)
- `thinking` (suy nghĩ)
- `goodbye` (tạm biệt)

---

## 2. Thu thập Sticker trực tiếp qua tin nhắn Zalo (`Sticker Collector`)

Chủ sở hữu có thể thêm sticker mới trực tiếp từ điện thoại/máy tính mà không cần phải tra cứu ID thủ công:

1. **Bắt đầu phiên**: Gõ `/sticker-add <nhóm>` (ví dụ: `/sticker-add sorry` hoặc `/sticker-add hello`).
2. **Gửi sticker**: Bạn chỉ cần chọn và gửi liên tiếp các sticker mong muốn vào khung chat.
   - Bot sẽ tự động trích xuất `stickerId`, chống trùng lặp và phản hồi số lượng đã nhận trong phiên.
   - Các tin nhắn sticker trong lúc mở phiên được xử lý thu thập riêng, **không bị nạp vào AI loop**.
3. **Kiểm tra tiến độ**: Nhắn `/sticker-status` để xem số sticker đã ghi nhận trong phiên hiện tại.
4. **Lưu lại**: Nhắn `/sticker-done` khi gửi xong.
   - Dữ liệu được lưu bền vững vào PostgreSQL và đồng bộ sang `config/stickers.json`.
5. **Hủy phiên**: Nếu không muốn lưu, nhắn `/sticker-cancel`.

---

## 3. Cách thêm thủ công vào `config/stickers.json`

File [config/stickers.json](file:///home/tritv/project/agent_personal/config/stickers.json):
```json
{
  "hello": ["id_chao_1", "id_chao_2"],
  "happy": ["id_vui_1", "id_vui_2", "id_vui_3"],
  "sorry": ["id_xin_loi_1"],
  ...
}
```
Sau khi sửa file bằng tay, gõ `/sticker-reload` trên Zalo hoặc chạy lại bot, hệ thống sẽ tự động gộp (merge) danh sách từ file và database mà không bị mất dữ liệu.

---

## 4. Cơ chế hoạt động & Chống lặp (Anti-Repetition)
- **Tự động theo ngữ cảnh:** AI quyết định có gửi sticker hay không dựa trên nội dung hội thoại, không dùng xác suất ngẫu nhiên vô tội vạ.
- **Không gửi trong tình huống nhạy cảm:** Bot tuyệt đối không gửi sticker khi thông báo lỗi hệ thống/bảo mật, khi gửi email quan trọng hoặc khi chờ phê duyệt bảo mật.
- **Random & Giảm lặp:** Backend chọn ngẫu nhiên sticker ID bằng `crypto.randomInt`. Trong cùng một cuộc hội thoại, nếu nhóm có nhiều ID, hệ thống tự động loại trừ các ID vừa gửi để không bị lặp lại.
- **Nếu nhóm rỗng hoặc có 1 ID:** Nếu nhóm chỉ có 1 ID, bot sẽ dùng ID đó bình thường. Nếu nhóm chưa có ID, bot tự động bỏ qua sticker mà không gây lỗi hội thoại.

---

## 5. Tổng hợp các lệnh Sticker (Owner Only)
- **/sticker-add <nhóm>**: Mở phiên thu thập sticker mới cho nhóm cảm xúc chỉ định.
- **/sticker-done**: Kết thúc phiên thu thập và lưu vào thư viện.
- **/sticker-status**: Xem số sticker đã thu thập trong phiên đang mở.
- **/sticker-cancel**: Hủy phiên thu thập hiện tại.
- **/sticker-list** hoặc **/stickers**: Thống kê danh sách 11 nhóm cảm xúc và số lượng sticker hiện có.
- **/sticker-test <nhóm> [số lượng]** (hoặc **/sticker <nhóm> [số lượng]**): Test gửi sticker từ nhóm chỉ định.
- **/sticker-reload**: Nạp lại file `config/stickers.json` và database ngay lập tức.
- **/sticker-help**: Hiển thị hướng dẫn các lệnh quản lý sticker.
