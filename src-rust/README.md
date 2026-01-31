# rkbx_osc - Rekordbox to OSC Bridge

Мост между Rekordbox и OSC для синхронизации караоке-текста в RekordKaraoke.

Основан на [fjel/rkbx_os2l](https://github.com/fjel/rkbx_os2l) с заменой os2l протокола на OSC.

## Возможности

- Чтение данных напрямую из памяти Rekordbox (не влияет на работу программы)
- Отправка времени трека в миллисекундах для точной синхронизации текста
- Отправка информации о треке (название, исполнитель) для автопоиска текста
- Поддержка Rekordbox 7.2.8, 6.8.5, 6.8.4

## Установка

### Сборка из исходников (Windows)

```bash
# Требуется Rust toolchain
cargo build --release
```

Бинарник будет в `target/release/rkbx_osc.exe`

### Готовый бинарник

Скачай из Releases и положи рядом с файлом `offsets`.

## Использование

```bash
# Запуск с настройками по умолчанию (Rekordbox 7.2.8, OSC на 127.0.0.1:4460)
rkbx_osc.exe

# Указать версию Rekordbox
rkbx_osc.exe -v 6.8.5

# Указать адрес OSC назначения
rkbx_osc.exe -o 192.168.1.100:4460

# Справка
rkbx_osc.exe -h
```

### Флаги

| Флаг | Описание | По умолчанию |
|------|----------|--------------|
| `-v <ver>` | Версия Rekordbox | 7.2.8 |
| `-o <addr>` | OSC destination (host:port) | 127.0.0.1:4460 |
| `-s <addr>` | OSC source (host:port) | 127.0.0.1:4450 |
| `-p <rate>` | Частота опроса в Hz | 60 |
| `-u` | Обновить offsets с GitHub | - |
| `-h` | Справка | - |

### Горячие клавиши

- `c` — выход
- `r` — переотправить информацию о текущем треке

## OSC сообщения

| Адрес | Тип | Описание |
|-------|-----|----------|
| `/time/master` | float | Позиция в треке (секунды) |
| `/bpm/master/current` | float | Текущий BPM |
| `/beat/master` | int | Номер бита |
| `/track/master/title` | string | Название трека |
| `/track/master/artist` | string | Исполнитель |
| `/track/master/path` | string | Путь к файлу |
| `/deck/master` | int | Активная дека (0 или 1) |

## Интеграция с RekordKaraoke

В `config.json` RekordKaraoke настрой OSC:

```json
{
  "osc": {
    "host": "127.0.0.1",
    "port": 4460
  }
}
```

Затем запусти:
1. Rekordbox
2. rkbx_osc.exe
3. RekordKaraoke сервер

## Поддерживаемые версии Rekordbox

| Версия | Статус |
|--------|--------|
| 7.2.8 | ✅ Работает |
| 6.8.5 | ✅ Работает |
| 6.8.4 | ✅ Работает |

## Добавление новых версий

Offsets для новых версий Rekordbox можно найти с помощью Cheat Engine. 
См. документацию в [оригинальном репозитории](https://github.com/fjel/rkbx_os2l#updating).

## Формат файла offsets

```
# Версия Rekordbox
7.2.8
05B75C38 8 50 1CD8    # Deck 1 Bar
05B75C38 8 50 1CDC    # Deck 1 Beat
05B75C38 8 58 1CD8    # Deck 2 Bar
05B75C38 8 58 1CDC    # Deck 2 Beat
05BEB280 90 1B0 0 B50 # Masterdeck BPM
05C9FBF0 28 2C0 124   # Masterdeck index
05D0EDF8 1FC          # track_id deck1
05D0EDF8 200          # track_id deck2
05CF3760 0            # bearer
05AD0988 20 2A8 48 234 # time deck 1
05AD0988 20 2A8 50 234 # time deck 2
```

## Лицензия

GPL-3.0 (как и оригинальный rkbx_os2l)

## Благодарности

- [fjel](https://github.com/fjel) — автор rkbx_os2l и offsets для 7.2.8
- [grufkork](https://github.com/grufkork) — автор оригинального rkbx_link
