# Карта поездов

## Описание проекта

Интерактивная карта поездов. Для демонстрации были взяты Московские Центральные Диаметры и поезда дальнего следования. Местоположение поезда определяется по Яндекс расписаниям, все поезда отображаются на карте. Для каждого поезда показывается пройденный маршрут.
Реализованы предупреждения об опозданиях и отменах поездов. Сделан поиск по номеру поезда/названию станции, для каждой станции отображаются ее фото и расписание поездов на ближайший час. Поезда на участке Красный Строитель - Подольск имеют демо-видео из кабины машиниста.
Сделана светлая/темная тема.

Демонстрация проекта доступна по адресу [rzd.sherstd.ru](https://rzd.sherstd.ru)

## Стек

- Next.js
- React + TypeScript
- Leaflet + React-Leaflet (карта)
- Tailwind CSS
- Zustand
- ESLint + Prettier

## Требования

- Node.js 22+
- npm 10+
- Docker (необязательно, для запуска в контейнере)

## Переменные окружения

Для исходящих запросов к `rzd.ru` и Яндекс Расписаниям можно указать HTTP proxy в `.env`.

Вариант 1, одной строкой:

```env
UPSTREAM_HTTP_PROXY_URL=http://LOGIN:PASSWORD@HOST:PORT
```

Если в логине или пароле есть специальные символы (`@`, `:`, `/`, `#`), их нужно URL-encode-ить.
Например, пароль `pa:ss@word` должен быть записан как `pa%3Ass%40word`.

Вариант 2, отдельными полями:

```env
UPSTREAM_PROXY_PROTOCOL=http
UPSTREAM_PROXY_HOST=proxy.example.com
UPSTREAM_PROXY_PORT=8080
UPSTREAM_PROXY_USERNAME=my-login
UPSTREAM_PROXY_PASSWORD=my-password
```

Поддерживаются и стандартные переменные `HTTP_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY_URL`, но приоритет у `UPSTREAM_HTTP_PROXY_URL`.

## Локальный запуск

1. Установить зависимости:

```bash
npm ci
```

2. Запустить dev-сервер:

```bash
npm run dev
```

3. Открыть в браузере:

```text
http://localhost:3000
```

## Сборка и запуск в продакшене

1. Собрать приложение:

```bash
npm run build
```

2. Запустить production-сервер:

```bash
npm start
```

Дополнительно:

- проверка типов: `npm run typecheck`
- линт: `npm run lint`

## Docker

### Вариант 1: собрать и запустить локально через Dockerfile

```bash
docker build -t rzd-viewer:local .
docker run --rm -p 3000:3000 --name rzd-viewer rzd-viewer:local
```

После запуска приложение будет доступно на `http://localhost:3000`.

### Вариант 2: запуск через docker-compose

Текущий `docker-compose.yml` использует готовый образ `sherstnew/rzd-viewer:latest`:

```bash
docker compose up -d
```

Остановить:

```bash
docker compose down
```
