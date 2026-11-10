"""
Generate 1280x800 store screenshots without alpha transparency for Chrome Web Store, Edge Add-ons and AMO.
"""
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 800px;
    background: #0f0f0f;
    color: #f1f1f1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    overflow: hidden;
    position: relative;
    user-select: none;
  }
  /* Top Nav */
  header.yt-nav {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #0f0f0f;
    border-bottom: 1px solid #272727;
  }
  .yt-logo {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.5px;
  }
  .yt-logo svg { fill: #ff0000; width: 28px; height: 28px; }
  .yt-search {
    display: flex;
    align-items: center;
    width: 540px;
  }
  .yt-search-input {
    flex: 1;
    height: 40px;
    background: #121212;
    border: 1px solid #303030;
    border-radius: 20px 0 0 20px;
    padding: 0 16px;
    color: #fff;
    font-size: 15px;
    outline: none;
  }
  .yt-search-btn {
    width: 64px;
    height: 40px;
    background: #222;
    border: 1px solid #303030;
    border-left: none;
    border-radius: 0 20px 20px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #aaa;
  }
  .yt-user {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ff416c, #ff4b2b);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
  }

  /* Layout */
  .main-layout {
    display: flex;
    height: calc(800px - 56px);
  }
  aside.sidebar {
    width: 216px;
    padding: 12px;
    border-right: 1px solid #222;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    color: #aaa;
  }
  .sidebar-item.active {
    background: #272727;
    color: #fff;
    font-weight: 600;
  }
  .feed-content {
    flex: 1;
    padding: 24px 28px;
    overflow: hidden;
  }
  .feed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .feed-title {
    font-size: 20px;
    font-weight: 600;
  }
  .banner-pill {
    background: #212121;
    border: 1px solid #383838;
    color: #2ecc71;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .video-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .video-card {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    background: #181818;
    display: flex;
    flex-direction: column;
    transition: opacity 0.2s;
  }
  .thumb-container {
    width: 100%;
    height: 175px;
    position: relative;
    overflow: hidden;
  }
  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .duration {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0,0,0,0.8);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .video-meta {
    padding: 12px;
    display: flex;
    gap: 12px;
  }
  .channel-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .meta-text {
    flex: 1;
  }
  .video-title {
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.35;
    margin-bottom: 4px;
    color: #fff;
  }
  .channel-name {
    font-size: 12.5px;
    color: #aaa;
    margin-bottom: 2px;
  }
  .views-date {
    font-size: 12px;
    color: #717171;
  }

  /* Dimmed Effect Overlay */
  .video-card.dimmed {
    opacity: 0.28;
    filter: grayscale(80%);
  }
  .dimmed-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(20, 20, 20, 0.9);
    border: 1px solid #555;
    color: #aaa;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Extension Popup Overlay */
  .popup-frame {
    position: absolute;
    top: 52px;
    right: 28px;
    width: 330px;
    background: #1e1e1e;
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.7), 0 0 0 1px #333;
    z-index: 9999;
    padding: 16px;
    font-size: 14px;
  }
  .tabs {
    display: flex;
    background: #252525;
    border-bottom: 2px solid #333;
    margin: -16px -16px 16px -16px;
    border-radius: 10px 10px 0 0;
  }
  .tab-button {
    flex: 1;
    padding: 12px 16px;
    background: transparent;
    border: none;
    font-size: 14px;
    font-weight: 600;
    color: #888;
    text-align: center;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
  }
  .tab-button.active {
    color: #fff;
    border-bottom-color: #2ecc71;
  }
  .popup-header {
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  .popup-header h1 {
    font-size: 17px;
    font-weight: 700;
    color: #ff4444;
    margin-bottom: 2px;
  }
  .popup-header .subtitle {
    font-size: 12px;
    color: #888;
  }
  .control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .control-row label {
    font-weight: 500;
    color: #ddd;
    font-size: 13.5px;
  }
  .toggle-box {
    width: 44px;
    height: 24px;
    background: #ff4444;
    border-radius: 12px;
    position: relative;
  }
  .toggle-knob {
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    top: 2px;
    left: 22px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }
  .slider-box {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .fake-slider {
    width: 100px;
    height: 6px;
    background: #444;
    border-radius: 3px;
    position: relative;
  }
  .fake-thumb {
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ff4444;
    top: -5px;
    left: 72px;
  }
  .fake-input {
    width: 48px;
    height: 26px;
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    line-height: 24px;
  }
  .strength-badge {
    color: #ff4444;
    font-weight: 700;
    font-size: 13px;
  }
  .reset-btn {
    width: 100%;
    padding: 9px 14px;
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    color: #ccc;
    font-size: 13px;
    font-weight: 500;
    text-align: center;
    margin: 6px 0 14px 0;
  }
  .status-box {
    background: #252525;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .status-row {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    padding: 3px 0;
    color: #bbb;
  }
  .status-row span:last-child {
    font-weight: 700;
    color: #ff4444;
  }
  .donation-msg {
    font-size: 12.5px;
    line-height: 1.45;
    color: #bbb;
    margin-bottom: 14px;
    text-align: center;
  }
  .btn-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .ext-btn {
    display: block;
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
  }
  .btn-green { background: #27ae60; color: #fff; }
  .btn-yellow { background: #f1c40f; color: #111; }
  .btn-blue { background: #0070ba; color: #fff; }
  .btn-dark { background: #2d333b; color: #f0f6fc; border: 1px solid #444c56; }
</style>
</head>
<body>
  <header class="yt-nav">
    <div class="yt-logo">
      <svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
      <span>YouTube</span>
    </div>
    <div class="yt-search">
      <input class="yt-search-input" value="synthwave lofi live" readonly>
      <div class="yt-search-btn">🔍</div>
    </div>
    <div class="yt-user">
      <div class="avatar">U</div>
    </div>
  </header>

  <div class="main-layout">
    <aside class="sidebar">
      <div class="sidebar-item active">🏠 Home</div>
      <div class="sidebar-item">⚡ Shorts</div>
      <div class="sidebar-item">📺 Subscriptions</div>
      <div class="sidebar-item">🕒 History</div>
      <div class="sidebar-item">🎵 Music</div>
    </aside>

    <main class="feed-content">
      <div class="feed-header">
        <h2 class="feed-title">Recommended Videos</h2>
        <div class="banner-pill">
          <span>✓</span>
          <span>Dim + Filter: Scrolled videos are dimmed automatically</span>
        </div>
      </div>

      <div class="video-grid">
        <!-- Card 1: Dimmed -->
        <div class="video-card dimmed">
          <div class="dimmed-badge">Seen / Scrolled Past</div>
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1e3c72"/><stop offset="100%" stop-color="#2a5298"/></linearGradient></defs><rect width="400" height="225" fill="url(#g1)"/><circle cx="200" cy="112" r="45" fill="#f39c12"/><path d="M0 160 Q200 120 400 170 L400 225 L0 225 Z" fill="#111"/></svg>
            <span class="duration">1:42:15</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#3498db"></div>
            <div class="meta-text">
              <div class="video-title">Midnight Cyberpunk Synthwave - Deep Focus Session</div>
              <div class="channel-name">Retro Beats</div>
              <div class="views-date">480K views • 2 weeks ago</div>
            </div>
          </div>
        </div>

        <!-- Card 2: Dimmed -->
        <div class="video-card dimmed">
          <div class="dimmed-badge">Seen / Scrolled Past</div>
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8e2de2"/><stop offset="100%" stop-color="#4a00e0"/></linearGradient></defs><rect width="400" height="225" fill="url(#g2)"/><polygon points="200,40 280,180 120,180" fill="#e74c3c" opacity="0.8"/></svg>
            <span class="duration">28:10</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#9b59b6"></div>
            <div class="meta-text">
              <div class="video-title">Building a High Performance Extension in Manifest V3</div>
              <div class="channel-name">CodeCraft</div>
              <div class="views-date">125K views • 5 days ago</div>
            </div>
          </div>
        </div>

        <!-- Card 3: New / Fresh -->
        <div class="video-card">
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff416c"/><stop offset="100%" stop-color="#ff4b2b"/></linearGradient></defs><rect width="400" height="225" fill="url(#g3)"/><circle cx="200" cy="112" r="40" fill="#fff" opacity="0.9"/><polygon points="190,95 220,112 190,129" fill="#ff416c"/></svg>
            <span class="duration">14:20</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#e74c3c"></div>
            <div class="meta-text">
              <div class="video-title">✨ NEW: Discovering Rare 80s Japanese City Pop</div>
              <div class="channel-name">Vinyl Odyssey</div>
              <div class="views-date">18K views • 3 hours ago</div>
            </div>
          </div>
        </div>

        <!-- Card 4: New / Fresh -->
        <div class="video-card">
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#11998e"/><stop offset="100%" stop-color="#38ef7d"/></linearGradient></defs><rect width="400" height="225" fill="url(#g4)"/><rect x="120" y="60" width="160" height="100" rx="8" fill="#fff" opacity="0.85"/></svg>
            <span class="duration">45:00</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#2ecc71"></div>
            <div class="meta-text">
              <div class="video-title">✨ NEW: Ambient Coding Stream - Relaxing Lofi Vibes</div>
              <div class="channel-name">Dev Chill</div>
              <div class="views-date">54K views • 1 day ago</div>
            </div>
          </div>
        </div>

        <!-- Card 5: New / Fresh -->
        <div class="video-card">
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g5" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f857a6"/><stop offset="100%" stop-color="#ff5858"/></linearGradient></defs><rect width="400" height="225" fill="url(#g5)"/><circle cx="150" cy="110" r="50" fill="#f1c40f"/><circle cx="250" cy="110" r="50" fill="#3498db" opacity="0.8"/></svg>
            <span class="duration">18:45</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#e67e22"></div>
            <div class="meta-text">
              <div class="video-title">✨ NEW: Future Funk & French House Mix 2026</div>
              <div class="channel-name">Groove Central</div>
              <div class="views-date">32K views • 2 days ago</div>
            </div>
          </div>
        </div>

        <!-- Card 6: New / Fresh -->
        <div class="video-card">
          <div class="thumb-container">
            <svg class="thumb-img" viewBox="0 0 400 225"><defs><linearGradient id="g6" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2c3e50"/><stop offset="100%" stop-color="#3498db"/></linearGradient></defs><rect width="400" height="225" fill="url(#g6)"/><path d="M50 180 L200 70 L350 180 Z" fill="#2ecc71" opacity="0.7"/></svg>
            <span class="duration">32:18</span>
          </div>
          <div class="video-meta">
            <div class="channel-avatar" style="background:#34495e"></div>
            <div class="meta-text">
              <div class="video-title">✨ NEW: Exploring Synthetic Landscapes in 4K</div>
              <div class="channel-name">Visual Drift</div>
              <div class="views-date">9.2K views • 4 hours ago</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- POPUP OVERLAY (Toggled via JS) -->
  <div id="popup-wrapper" style="display:none;">
    <div class="popup-frame">
      <nav class="tabs">
        <button id="tab-btn-settings" class="tab-button active">Settings</button>
        <button id="tab-btn-info" class="tab-button">Info</button>
      </nav>

      <!-- Settings Panel -->
      <div id="panel-settings-box">
        <header class="popup-header">
          <h1>🧹 Dim + Filter</h1>
          <p class="subtitle">Reduce YouTube feed fatigue</p>
        </header>

        <div class="control-row">
          <label>Enable Extension</label>
          <div class="toggle-box"><div class="toggle-knob"></div></div>
        </div>

        <div class="control-row">
          <label>Grey Strength</label>
          <div class="slider-box">
            <div class="fake-slider"><div class="fake-thumb"></div></div>
            <div class="fake-input">75</div>
            <span class="strength-badge">75%</span>
          </div>
        </div>

        <div class="reset-btn">🗑️ Reset History</div>

        <div class="status-box">
          <div class="status-row">
            <span>Greyed on this page:</span>
            <span>2</span>
          </div>
          <div class="status-row">
            <span>Total seen videos:</span>
            <span>48</span>
          </div>
        </div>
      </div>

      <!-- Info Panel -->
      <div id="panel-info-box" style="display:none;">
        <p class="donation-msg">Enjoying this extension? Instead of sending me your Bitcoins, just buy me a coffee or send a donation via PayPal.</p>
        <div class="btn-list">
          <div class="ext-btn btn-green">Submit issue / request feature</div>
          <div class="ext-btn btn-yellow">Buy me a coffee</div>
          <div class="ext-btn btn-blue">Donate via PayPal</div>
          <div class="ext-btn btn-dark">GitHub</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
"""

def generate():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.set_content(HTML_CONTENT)

        # 1. Screenshot 1: Feed only
        p1 = OUT_DIR / "screenshot-1-dimmed-feed.png"
        page.screenshot(path=str(p1))
        # Ensure 24-bit RGB (no alpha)
        im = Image.open(p1).convert("RGB")
        im.save(p1, format="PNG")
        print(f"Generated {p1} ({im.size}, mode={im.mode})")

        # 2. Screenshot 2: Popup Settings
        page.evaluate("""
            document.getElementById('popup-wrapper').style.display = 'block';
            document.getElementById('tab-btn-settings').className = 'tab-button active';
            document.getElementById('tab-btn-info').className = 'tab-button';
            document.getElementById('panel-settings-box').style.display = 'block';
            document.getElementById('panel-info-box').style.display = 'none';
        """)
        p2 = OUT_DIR / "screenshot-2-popup-settings.png"
        page.screenshot(path=str(p2))
        im = Image.open(p2).convert("RGB")
        im.save(p2, format="PNG")
        print(f"Generated {p2} ({im.size}, mode={im.mode})")

        # 3. Screenshot 3: Popup Info
        page.evaluate("""
            document.getElementById('popup-wrapper').style.display = 'block';
            document.getElementById('tab-btn-settings').className = 'tab-button';
            document.getElementById('tab-btn-info').className = 'tab-button active';
            document.getElementById('panel-settings-box').style.display = 'none';
            document.getElementById('panel-info-box').style.display = 'block';
        """)
        p3 = OUT_DIR / "screenshot-3-popup-info.png"
        page.screenshot(path=str(p3))
        im = Image.open(p3).convert("RGB")
        im.save(p3, format="PNG")
        print(f"Generated {p3} ({im.size}, mode={im.mode})")

        browser.close()

if __name__ == "__main__":
    generate()
