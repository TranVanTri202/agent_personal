# HƯỚNG DẪN TRIỂN KHAI PRODUCTION LÊN VPS (VPS DEPLOYMENT GUIDE)

Khi bạn muốn đưa Agent lên VPS chạy 24/7 (cấu hình khuyến nghị: 2-3 vCPU, 3-4 GB RAM, 30 GB SSD Ubuntu):

---

## 1. Chuẩn bị kiến trúc
- **Database & Redis**: Chạy bằng Docker Compose trên mạng nội bộ `internal`, không bind cổng 5432 và 6379 ra ngoài Internet.
- **Web Server & HTTPS**: Sử dụng Caddy hoặc Nginx + Let's Encrypt tự động cấp phát SSL certificate.
- **Chế độ Zalo**: Chuyển sang `ZALO_MODE=webhook` để nhận sự kiện tức thì và tiết kiệm tài nguyên CPU.

---

## 2. Dockerfile Multi-stage Production

Tạo `Dockerfile` tối ưu dung lượng:
```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER node
EXPOSE 3000
CMD ["node", "dist/main"]
```

---

## 3. Cấu hình Caddy làm Reverse Proxy HTTPS

File `/etc/caddy/Caddyfile`:
```caddy
your-domain.com {
    reverse_proxy 127.0.0.1:3000

    # Giới hạn kích thước payload
    request_body {
        max_size 10MB
    }
}
```

---

## 4. Thiết lập Webhook Zalo trên VPS

1. Cập nhật `.env` trên VPS:
   ```env
   ZALO_MODE=webhook
   ZALO_WEBHOOK_URL=https://your-domain.com/api/webhooks/zalo
   ZALO_WEBHOOK_SECRET=your_super_secret_token_at_least_16_chars
   ```

2. Khởi động ứng dụng bằng Docker hoặc systemd.

3. Kích hoạt Webhook với Zalo Bot API:
   ```bash
   npm run zalo:webhook:set
   ```

4. Kiểm tra trạng thái:
   ```bash
   npm run zalo:webhook:info
   ```

---

## 5. Sao lưu dữ liệu (Backup & Restore)

### Sao lưu PostgreSQL:
```bash
docker exec -t personal_agent_postgres pg_dump -U personal_agent personal_agent > backup_$(date +%Y%m%d).sql
```

### Phục hồi (Restore):
```bash
cat backup_20261028.sql | docker exec -i personal_agent_postgres psql -U personal_agent -d personal_agent
```
