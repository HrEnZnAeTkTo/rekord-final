import time
import threading
from pywinauto import Desktop
from pythonosc import dispatcher, osc_server, udp_client

# === КОНФИГУРАЦИЯ ===
RUST_PORT = 4455       # Порт, куда Rust шлет инфу о деке
NODE_PORT = 4460       # Порт RekordKaraoke (Node.js)
POLL_INTERVAL = 0.1    # Как часто проверять экран (сек)

# Глобальные переменные
current_master_deck = 0 
last_sent_track_info = ""

# Клиент для отправки в Node.js
sender = udp_client.SimpleUDPClient("127.0.0.1", NODE_PORT)

# === ЧТЕНИЕ ЭКРАНА ===
class UIReader:
    def __init__(self):
        self.app_title = ".*rekordbox.*"
        self.anchor = "4Deck Horizontal"
        self.d1_indices = (131, 133) 
        self.d2_indices = (155, 157)
        self.window = None
        self.container = None

    def connect(self):
        try:
            desktop = Desktop(backend="uia")
            # Ищем окна, соответствующие названию
            windows = desktop.windows(title_re=self.app_title)
            
            # Берем первое, которое существует (даже если не visible в данный момент)
            self.window = next((w for w in windows), None)
            
            if self.window:
                # Если свернуто при запуске — разворачиваем, чтобы найти контейнер
                if self.window.is_minimized():
                    print("[UI] Window is minimized. Restoring to find elements...")
                    self.window.restore()
                    time.sleep(0.5) # Ждем отрисовку

                for el in self.window.descendants():
                    if el.window_text() == self.anchor:
                        self.container = el.parent()
                        print("[UI] Connected to Rekordbox Window")
                        return True
            return False
        except Exception as e:
            print(f"[Connection Error] {e}")
            return False

    def check_window_state(self):
        """Проверяет, живо ли окно и не свернуто ли оно"""
        if not self.window:
            return False
        try:
            # Если окно свернуто, приложение перестает обновлять UI-дерево.
            # Нам нужно принудительно его восстановить (Restore).
            if self.window.is_minimized():
                print("[UI] Detect minimized window -> Restoring to keep data alive...")
                self.window.restore()
                # Небольшая пауза, чтобы интерфейс успел прорисоваться
                time.sleep(0.2)
            return True
        except Exception:
            # Если окно закрыли или оно крашнулось
            self.window = None
            self.container = None
            return False

    def get_track_info(self, deck_index):
        # 1. Проверяем состояние окна перед чтением
        if not self.check_window_state():
            if not self.connect(): return None
        
        # 2. Если контейнер потерян (например, перезапуск приложения)
        if not self.container:
            if not self.connect(): return None
        
        try:
            children = self.container.children()
            
            # Проверка верстки
            if len(children) < 160: 
                print("[UI] Layout changed or incomplete. Reconnecting...")
                self.connect()
                return None
            
            indices = self.d1_indices if deck_index == 0 else self.d2_indices
            
            # ВАЖНО: Иногда при свернутом окне текст возвращается пустым ""
            track = children[indices[0]].window_text()
            artist = children[indices[1]].window_text()
            
            return artist, track
        except Exception as e:
            # print(f"[Read Error] {e}") # Раскомментируй для отладки
            self.container = None # Сброс кеша
            return None

reader = UIReader()

# === ПОТОК 1: СЛУШАЕМ RUST ===
def handle_deck_change(address, *args):
    global current_master_deck
    try:
        new_deck = int(args[0])
        if new_deck in [0, 1]:
            if current_master_deck != new_deck:
                print(f"[OSC] Rust switched master to Deck {new_deck + 1}")
                current_master_deck = new_deck
                
                # ХАК: При смене деки сразу сбрасываем текст в караоке,
                # чтобы не висел старый трек, пока мы читаем новый (убирает рассинхрон)
                sender.send_message("/track/master/title", "")
                sender.send_message("/track/master/artist", "Loading...")
                
    except ValueError:
        pass

def start_osc_listener():
    dp = dispatcher.Dispatcher()
    dp.map("/deck/master", handle_deck_change)
    server = osc_server.ThreadingOSCUDPServer(("0.0.0.0", RUST_PORT), dp)
    print(f"[Proxy] Listening for Deck Info on {RUST_PORT}...")
    server.serve_forever()

# === ПОТОК 2: ПРОВЕРЯЕМ ЭКРАН (POLLING) ===
def start_polling():
    global last_sent_track_info
    print(f"[Poller] Started checking UI every {POLL_INTERVAL}s...")
    
    while True:
        try:
            res = reader.get_track_info(current_master_deck)
            
            if res:
                artist, title = res
                combined = f"{artist} - {title}"
                
                # Если текст изменился и он валидный (не пустой)
                if combined != last_sent_track_info and artist and title:
                    print(f">>> DETECTED NEW TRACK: {combined}")
                    
                    sender.send_message("/track/master/artist", artist)
                    sender.send_message("/track/master/title", title)
                    
                    last_sent_track_info = combined
            
        except Exception as e:
            print(f"[Poller Error] {e}")
            
        time.sleep(POLL_INTERVAL)

# === MAIN ===
if __name__ == "__main__":
    t = threading.Thread(target=start_osc_listener, daemon=True)
    t.start()
    start_polling()