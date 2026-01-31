from pywinauto import Desktop

def get_element_index():
    try:
        # 1. Подключаемся
        windows = Desktop(backend="uia").windows(title_re=".*rekordbox.*")
        target_window = next((w for w in windows if w.is_visible()), None)
        
        if not target_window:
            print("Rekordbox window not found.")
            return

        targets = ["China Town", "Дети RAVE"]
        
        # 2. Ищем тот самый контейнер-родитель
        # Мы знаем, что в нем лежит текст "2Deck Horizontal" (из твоего лога)
        # Это поможет найти именно тот контейнер среди других
        parent_container = None
        
        # Перебираем, чтобы найти родителя
        for element in target_window.descendants():
            if element.window_text() == "4Deck Horizontal":
                parent_container = element.parent()
                break
        
        if not parent_container:
            print("Could not isolate the main container.")
            return

        print(f"Container Found. Scanning {len(parent_container.children())} children...")
        print("-" * 40)

        # 3. Перебираем детей по порядку и ищем совпадения
        found_count = 0
        children = parent_container.children()
        
        for index, child in enumerate(children):
            text = child.window_text()
            rect = child.rectangle()
            
            if text in targets:
                # Определяем Деку по координате X (Левая или Правая часть экрана)
                # Чем меньше left, тем левее элемент
                deck_pos = "Left/Deck1" if rect.left < (target_window.rectangle().mid_point().x) else "Right/Deck2"
                
                print(f"Match: '{text}'")
                print(f"INDEX: {index}")  # <--- ЭТО САМОЕ ВАЖНОЕ
                print(f"Pos:   {deck_pos} (Coords: {rect.left}, {rect.top})")
                print("-" * 20)
                found_count += 1

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_element_index()

sdf = input()
