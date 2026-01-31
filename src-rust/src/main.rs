use std::{
    io::{stdout, Write},
    path::Path,
    process::Command,
    thread::{sleep},
    time::{Duration, Instant},
};
use winapi::um::consoleapi::{GetConsoleMode, SetConsoleMode};
use winapi::um::processenv::GetStdHandle;
use winapi::um::winbase::STD_INPUT_HANDLE;

mod offsets;
use offsets::{RekordboxOffsets, Pointer};

mod osc;
use osc::OscSender;

// === НЕОБХОДИМЫЕ СТРУКТУРЫ ===
use std::marker::PhantomData;
use toy_arms::external::{read, Process};
use winapi::um::winnt::HANDLE;

struct Value<T> {
    address: usize,
    handle: HANDLE,
    _marker: PhantomData<T>,
}

impl<T> Value<T> {
    fn new(h: HANDLE, base: usize, offsets: Pointer) -> Option<Value<T>> {
        let mut address = base;
        for offset in offsets.offsets {
            address = match read::<usize>(h, address + offset) {
                Ok(addr) => addr,
                Err(_) => return None,
            };
        }
        address += offsets.final_offset;
        Some(Value::<T> { address, handle: h, _marker: PhantomData::<T> })
    }
    fn read(&self) -> Option<T> {
        read::<T>(self.handle, self.address).ok()
    }
}

pub struct Rekordbox {
    handle: HANDLE,
    base: usize,
    offsets: RekordboxOffsets,
    
    // Ридеры памяти
    master_bpm_val: Option<Value<f32>>,
    bar1_val: Option<Value<i32>>,
    beat1_val: Option<Value<i32>>,
    bar2_val: Option<Value<i32>>,
    beat2_val: Option<Value<i32>>,
    masterdeck_index_val: Option<Value<u8>>,
    deck1_time_val: Option<Value<i32>>,
    deck2_time_val: Option<Value<i32>>,

    // Публичное состояние
    pub beats1: i32,
    pub beats2: i32,
    pub master_bpm: f32,
    pub masterdeck_index: u8,
    pub deck1_time: i32,
    pub deck2_time: i32,
    pub master_beats: i32,
    pub master_time: i32,
}

impl Rekordbox {
    fn new(offsets: RekordboxOffsets) -> Result<Self, String> {
        let rb = match Process::from_process_name("rekordbox.exe") {
            Ok(p) => p,
            Err(e) => return Err(format!("Rekordbox process not found: {:?}", e)),
        };
        let h = rb.process_handle;
        let base = match rb.get_module_base("rekordbox.exe") {
            Ok(b) => b,
            Err(e) => return Err(format!("Base address error: {:?}", e)),
        };

        Ok(Self {
            handle: h,
            base,
            offsets: offsets.clone(),
            master_bpm_val: Value::new(h, base, offsets.master_bpm.clone()),
            bar1_val: Value::new(h, base, offsets.deck1bar.clone()),
            beat1_val: Value::new(h, base, offsets.deck1beat.clone()),
            bar2_val: Value::new(h, base, offsets.deck2bar.clone()),
            beat2_val: Value::new(h, base, offsets.deck2beat.clone()),
            masterdeck_index_val: Value::new(h, base, offsets.masterdeck_index.clone()),
            deck1_time_val: Value::new(h, base, offsets.deck1_time.clone()),
            deck2_time_val: Value::new(h, base, offsets.deck2_time.clone()),
            
            beats1: -1, beats2: -1, master_bpm: 120.0, masterdeck_index: 0,
            deck1_time: 0, deck2_time: 0, master_beats: 0, master_time: 0,
        })
    }

    fn update(&mut self) {
        // Ленивая инициализация (если указатели слетели)
        if self.master_bpm_val.is_none() { self.master_bpm_val = Value::new(self.handle, self.base, self.offsets.master_bpm.clone()); }
        if self.masterdeck_index_val.is_none() { self.masterdeck_index_val = Value::new(self.handle, self.base, self.offsets.masterdeck_index.clone()); }
        if self.deck1_time_val.is_none() { self.deck1_time_val = Value::new(self.handle, self.base, self.offsets.deck1_time.clone()); }
        if self.deck2_time_val.is_none() { self.deck2_time_val = Value::new(self.handle, self.base, self.offsets.deck2_time.clone()); }

        // Чтение значений
        self.master_bpm = self.master_bpm_val.as_ref().and_then(|v| v.read()).unwrap_or(120.0);
        self.masterdeck_index = self.masterdeck_index_val.as_ref().and_then(|v| v.read()).unwrap_or(0);
        self.deck1_time = self.deck1_time_val.as_ref().and_then(|v| v.read()).unwrap_or(0);
        self.deck2_time = self.deck2_time_val.as_ref().and_then(|v| v.read()).unwrap_or(0);

        // Расчет битов (упрощенно)
        if let (Some(bar), Some(beat)) = (&self.bar1_val, &self.beat1_val) {
             if let (Some(b), Some(bt)) = (bar.read(), beat.read()) { self.beats1 = b * 4 + bt; }
        }
        if let (Some(bar), Some(beat)) = (&self.bar2_val, &self.beat2_val) {
             if let (Some(b), Some(bt)) = (bar.read(), beat.read()) { self.beats2 = b * 4 + bt; }
        }

        // Определение Master Deck
        if self.masterdeck_index == 0 {
            self.master_beats = self.beats1;
            self.master_time = self.deck1_time;
        } else {
            self.master_beats = self.beats2;
            self.master_time = self.deck2_time;
        }
    }
}

fn disable_quick_edit() {
    unsafe {
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        if !handle.is_null() {
            let mut mode: u32 = 0;
            if GetConsoleMode(handle, &mut mode) != 0 {
                SetConsoleMode(handle, (mode & !0x0040) | 0x0080);
            }
        }
    }
}

fn main() {
    disable_quick_edit();
    println!("=== RKBX Splitter v3 ===");
    println!("> Time/BPM -> 4460 (Node.js)");
    println!("> Deck Info -> 4455 (Python)");

    if !Path::new("./offsets").exists() {
        let _ = Command::new("curl").args(["-o", "offsets", "https://raw.githubusercontent.com/fjel/rkbx_os2l/master/offsets"]).output();
    }

    let version_offsets = RekordboxOffsets::from_file("offsets");
    let target_version = version_offsets.keys().max().unwrap().clone();
    let offsets = version_offsets.get(&target_version).expect("Offsets error");
    println!("Target: Rekordbox v{}", target_version);

    // 1. Сокет для Караоке (Node.js) - Порт 4460
    let osc_karaoke = OscSender::new("127.0.0.1:4450", "127.0.0.1:4460").expect("Bind Error 4450");
    
    // 2. Сокет для Питона (Master Deck Info) - Порт 4455
    let osc_python = OscSender::new("127.0.0.1:4451", "127.0.0.1:4455").expect("Bind Error 4451");

    let mut rb = match Rekordbox::new(offsets.clone()) {
        Ok(r) => r,
        Err(e) => { println!("Error: {}", e); return; }
    };

    let mut last_time = -1;
    let mut last_beat = -1;
    let mut last_bpm = 0.0;
    let mut last_deck = 255; 

    let period = Duration::from_micros(1000000 / 60); // 60 Hz

    loop {
        let start = Instant::now();
        rb.update();

        // --- ОТПРАВКА В NODE.JS (4460) ---
        if rb.master_time != last_time {
            osc_karaoke.send_time(rb.master_time);
            last_time = rb.master_time;
        }
        if (rb.master_bpm - last_bpm).abs() > 0.01 {
            osc_karaoke.send_bpm(rb.master_bpm);
            last_bpm = rb.master_bpm;
        }
        if rb.master_beats != last_beat {
            osc_karaoke.send_beat(rb.master_beats);
            last_beat = rb.master_beats;
        }

        // --- ОТПРАВКА В PYTHON (4455) ---
        // Отправляем ТОЛЬКО если дека сменилась.
        // Питон сам запомнит текущую деку.
        if rb.masterdeck_index != last_deck {
            // println!("Deck changed: {}", rb.masterdeck_index + 1);
            osc_python.send_master_deck(rb.masterdeck_index);
            last_deck = rb.masterdeck_index;
        }

        let elapsed = start.elapsed();
        if elapsed < period {
            sleep(period - elapsed);
        }
    }
}