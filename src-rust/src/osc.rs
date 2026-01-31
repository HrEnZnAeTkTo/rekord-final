use std::net::UdpSocket;
use rosc::{OscMessage, OscPacket, OscType};
use rosc::encoder;

pub struct OscSender {
    socket: UdpSocket,
    destination: String,
}

impl OscSender {
    pub fn new(source: &str, destination: &str) -> Result<Self, std::io::Error> {
        let socket = UdpSocket::bind(source)?;
        socket.set_nonblocking(true)?;
        println!("[OSC] Sending {} -> {}", source, destination);
        Ok(OscSender {
            socket,
            destination: destination.to_string(),
        })
    }

    fn send_message(&self, address: &str, args: Vec<OscType>) {
        let msg = OscPacket::Message(OscMessage {
            addr: address.to_string(),
            args,
        });
        
        if let Ok(buf) = encoder::encode(&msg) {
            let _ = self.socket.send_to(&buf, &self.destination);
        }
    }

    /// Отправка текущего времени трека в секундах (конвертируем из мс)
    pub fn send_time(&self, time_ms: i32) {
        let time_sec = time_ms as f32 / 1000.0;
        self.send_message("/time/master", vec![OscType::Float(time_sec)]);
    }

    /// Отправка BPM (адрес /bpm/master/current для совместимости с rkbx_link)
    pub fn send_bpm(&self, bpm: f32) {
        self.send_message("/bpm/master/current", vec![OscType::Float(bpm)]);
    }

    /// Отправка номера бита
    pub fn send_beat(&self, beat: i32) {
        self.send_message("/beat/master", vec![OscType::Int(beat)]);
    }

    /// Отправка информации о треке
    pub fn send_track_info(&self, title: &str, artist: &str, path: &str) {
        self.send_message("/track/master/title", vec![OscType::String(title.to_string())]);
        self.send_message("/track/master/artist", vec![OscType::String(artist.to_string())]);
        self.send_message("/track/master/path", vec![OscType::String(path.to_string())]);
    }

    /// Отправка только названия трека
    pub fn send_track_title(&self, title: &str) {
        self.send_message("/track/master/title", vec![OscType::String(title.to_string())]);
    }

    /// Отправка индекса мастер-деки (0 или 1)
    pub fn send_master_deck(&self, deck_index: u8) {
        self.send_message("/deck/master", vec![OscType::Int(deck_index as i32)]);
    }

    /// Комплексная отправка всех данных одним пакетом (для оптимизации)
    pub fn send_state(&self, time_ms: i32, bpm: f32, beat: i32) {
        // Отправляем время в секундах - самое важное для синхронизации текста
        let time_sec = time_ms as f32 / 1000.0;
        self.send_message("/time/master", vec![OscType::Float(time_sec)]);
        
        // BPM и beat менее критичны, но полезны
        self.send_message("/bpm/master/current", vec![OscType::Float(bpm)]);
        self.send_message("/beat/master", vec![OscType::Int(beat)]);
    }
}
