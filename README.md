## Инструкции по деплою нет, поскольку нет сервера и домена

## Локальный запуск

```bash
# 1. Установить зависимости
npm install

# 2. Скопировать env
cp .env.example .env

# 3. Заполнить в .env
SMTP_USER=адрес_почты_для_входа
SMTP_PASSWORD=пароль_приложения
SMTP_FROM=почта_отправителя

# 4. Запуск Postgres + Redis
npm run db:up

# 5. Генерация миграций
npm run db:generate
npm run db:migrate

# 6. Запуск
npm run dev
```