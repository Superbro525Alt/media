mod analyse;
mod types;

use analyse::analyse_single;
use log::info;
use types::{LoadedFile, MediaAnalysis};

#[tauri::command]
async fn analyse_file(files: Vec<LoadedFile>) -> Vec<MediaAnalysis> {
    info!("ANALYSE BEGIN");
    let ana: Vec<MediaAnalysis> = files
        .into_iter()
        .map(|f| analyse_single(f).unwrap())
        .collect();
    println!("ANALYSE END");
    ana
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![analyse_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
