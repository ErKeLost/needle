//! The colours of a cover, for tinting the record. Sampled on the device so
//! every side presses its own vinyl.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};

static CACHE: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

fn hex(rgb: (u8, u8, u8)) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb.0, rgb.1, rgb.2)
}

/// A dark, dusty cover still has a hue worth pressing. Lift saturation and
/// lightness so the vinyl takes the colour instead of staying grey.
fn lively(rgb: (u8, u8, u8)) -> (u8, u8, u8) {
    let (r, g, b) = (
        rgb.0 as f32 / 255.0,
        rgb.1 as f32 / 255.0,
        rgb.2 as f32 / 255.0,
    );
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    let d = max - min;
    let mut h = 0.0f32;
    let mut s = if d == 0.0 {
        0.0
    } else {
        d / (1.0 - (2.0 * l - 1.0).abs())
    };
    if d != 0.0 {
        h = if max == r {
            ((g - b) / d) % 6.0
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        } * 60.0;
        if h < 0.0 {
            h += 360.0;
        }
    }
    s = s.clamp(0.42, 0.86);
    let l = l.clamp(0.36, 0.56);

    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    let (r1, g1, b1) = match h {
        h if h < 60.0 => (c, x, 0.0),
        h if h < 120.0 => (x, c, 0.0),
        h if h < 180.0 => (0.0, c, x),
        h if h < 240.0 => (0.0, x, c),
        h if h < 300.0 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (
        ((r1 + m) * 255.0).round() as u8,
        ((g1 + m) * 255.0).round() as u8,
        ((b1 + m) * 255.0).round() as u8,
    )
}

#[tauri::command]
pub async fn cover_palette(url: String) -> Result<Value, String> {
    if url.is_empty() {
        return Ok(json!({ "colors": [] }));
    }
    if let Some(cache) = CACHE.lock().unwrap().as_ref() {
        if let Some(colors) = cache.get(&url) {
            return Ok(json!({ "colors": colors }));
        }
    }

    let bytes = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
        .header("Referer", "https://music.163.com/")
        .send()
        .await
        .map_err(|error| format!("封面下载失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("封面下载失败：{error}"))?
        .bytes()
        .await
        .map_err(|error| format!("封面读取失败：{error}"))?;

    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("封面解不开：{error}"))?
        .resize(48, 48, image::imageops::FilterType::Triangle);
    let rgb = image.to_rgb8();

    // Bucket to a coarse palette, then take the most common, distinct buckets.
    let mut buckets: HashMap<(u8, u8, u8), (u32, (u64, u64, u64))> = HashMap::new();
    for pixel in rgb.pixels() {
        let (r, g, b) = (pixel[0] as u32, pixel[1] as u32, pixel[2] as u32);
        // Skip near-black and near-white: they say nothing about the art.
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        if max < 26 || min > 236 {
            continue;
        }
        let key = ((r / 48) as u8 * 48, (g / 48) as u8 * 48, (b / 48) as u8 * 48);
        let entry = buckets.entry(key).or_insert((0, (0, 0, 0)));
        entry.0 += 1;
        entry.1 .0 += r as u64;
        entry.1 .1 += g as u64;
        entry.1 .2 += b as u64;
    }
    let mut ranked: Vec<(u32, (u8, u8, u8))> = buckets
        .into_iter()
        .map(|(_, (count, (r, g, b)))| {
            let n = count as u64;
            (count, ((r / n) as u8, (g / n) as u8, (b / n) as u8))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));

    let mut colors: Vec<(u8, u8, u8)> = Vec::new();
    for (_, color) in ranked {
        let distinct = colors.iter().all(|seen| {
            let dr = seen.0 as i32 - color.0 as i32;
            let dg = seen.1 as i32 - color.1 as i32;
            let db = seen.2 as i32 - color.2 as i32;
            dr * dr + dg * dg + db * db > 2600
        });
        if distinct {
            colors.push(color);
        }
        if colors.len() == 3 {
            break;
        }
    }
    if colors.len() < 3 {
        for extra in [(88u8, 44u8, 96u8), (204, 88, 66), (58, 74, 128)] {
            if colors.len() == 3 {
                break;
            }
            colors.push(extra);
        }
    }

    let hexes: Vec<String> = colors
        .iter()
        .enumerate()
        .map(|(index, color)| {
            // Keep one quieter tone for depth, lift the other two.
            if index == 2 {
                hex(*color)
            } else {
                hex(lively(*color))
            }
        })
        .collect();
    let mut cache = CACHE.lock().unwrap();
    cache.get_or_insert_with(HashMap::new).insert(url, hexes.clone());
    Ok(json!({ "colors": hexes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn reads_a_cover_palette() {
        let url = std::env::var("COVER_URL").expect("COVER_URL");
        let answer = cover_palette(url).await;
        println!("{answer:?}");
    }
}
