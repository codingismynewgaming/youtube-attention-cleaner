"""Check Chrome and Edge source in existing Playwright Chromium, using temporary profiles."""
import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def run():
    for variant in ("chrome", "edge"):
        channel = "msedge" if variant == "edge" else "chromium"
        with sync_playwright() as playwright:
            with tempfile.TemporaryDirectory(prefix=f"yac-{variant}-") as profile:
                source = str(ROOT / "app-files" / variant)
                try:
                    context = playwright.chromium.launch_persistent_context(
                        profile, channel=channel, headless=True,
                        args=[f"--disable-extensions-except={source}", f"--load-extension={source}"]
                    )
                except Exception as ex:
                    print(f"Warning: Channel {channel} failed ({ex}), falling back to chromium", flush=True)
                    channel = "chromium"
                    context = playwright.chromium.launch_persistent_context(
                        profile, channel=channel, headless=True,
                        args=[f"--disable-extensions-except={source}", f"--load-extension={source}"]
                    )
                try:
                    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=10000)
                    popup = context.new_page()
                    popup.goto(worker.url.replace("background.js", "popup/popup.html"))
                    popup.wait_for_function("document.getElementById('strength-input').value === '75'")
                    popup.wait_for_timeout(300)
                    assert popup.locator("#status-message").inner_text() == ""
                    popup.locator("#strength-input").fill("37")
                    popup.wait_for_timeout(300)
                    assert worker.evaluate('chrome.storage.local.get("prefs")')["prefs"]["greyStrength"] == 37
                    popup.locator("#enabled-toggle").uncheck()
                    popup.wait_for_timeout(300)
                    assert popup.locator("#reset-btn").is_enabled()
                    popup.locator("#reset-btn").click()
                    popup.wait_for_function("document.getElementById('status-message').textContent === 'History reset.'")
                    popup.locator("#enabled-toggle").check()
                    popup.wait_for_timeout(250)
                    page = context.new_page()
                    extension_errors = []
                    page.on("console", lambda message: extension_errors.append(message.text)
                            if message.type == "error" and "[YAC]" in message.text else None)
                    page.goto("https://www.youtube.com/results?search_query=synthwave",
                              wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_selector("#seen-videos-styles", state="attached", timeout=15000)
                    assert not extension_errors, extension_errors
                    print(json.dumps({
                        "variant": variant, "channel": channel, "browser": context.browser.version,
                        "popup": "passed", "settings": "passed", "reset": "passed",
                        "contentLoaded": True, "extensionErrors": extension_errors
                    }), flush=True)
                finally:
                    context.close()


if __name__ == "__main__":
    run()
