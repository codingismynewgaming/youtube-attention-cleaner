"""Run integration checks in an isolated Firefox profile. No account is used."""
import json
import re
import tempfile
import time
import zipfile
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
ADDON_ID = "youtube-attention-cleaner@codingismynewgaming.github"
SEARCH = "https://www.youtube.com/results?search_query=synthwave"


def run():
    options = Options()
    options.add_argument("-headless")
    options.set_preference("media.autoplay.default", 5)
    options.set_preference("media.volume_scale", "0.0")
    with tempfile.TemporaryDirectory(prefix="yac-integration-") as scratch:
        package = Path(scratch) / "extension.xpi"
        with zipfile.ZipFile(package, "w") as archive:
            for source in (ROOT / "app-files/firefox").rglob("*"):
                if source.is_file():
                    archive.write(source, source.relative_to(ROOT / "app-files/firefox").as_posix())
        driver = webdriver.Firefox(
            options=options, service=Service(service_args=["--allow-system-access"])
        )
        driver.set_page_load_timeout(30)
        driver.set_script_timeout(10)
        wait = WebDriverWait(driver, 10)
        results = []

        def record(name, details=None):
            results.append({"check": name, "details": details, "passed": True})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)

        try:
            driver.set_window_size(1500, 1000)
            driver.install_addon(str(package), temporary=True)
            driver.get(SEARCH)
            time.sleep(2)
            for button in driver.find_elements(By.TAG_NAME, "button"):
                if button.text.strip() in ("Alle ablehnen", "Reject all"):
                    button.click()
                    time.sleep(1)
                    break
            wait.until(lambda d: d.execute_script("return !!document.getElementById('seen-videos-styles')"))
            youtube_handle = driver.current_window_handle
            real_id = driver.execute_script("""
                const a=document.querySelector('ytd-video-renderer a[href*="/watch?"]');
                return a ? new URL(a.href).searchParams.get('v') : null;
            """)
            assert real_id and re.fullmatch(r"[A-Za-z0-9_-]{11}", real_id)
            driver.set_context("chrome")
            extension_uuid = json.loads(driver.execute_script(
                "return Services.prefs.getStringPref('extensions.webextensions.uuids')"
            ))[ADDON_ID]
            driver.execute_script("""
                const tab=gBrowser.addTab(arguments[0], {
                    triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()
                });
                gBrowser.selectedTab=tab;
            """, f"moz-extension://{extension_uuid}/popup/popup.html")
            driver.set_context("content")
            popup_handle = next(h for h in driver.window_handles if h != youtube_handle)
            driver.switch_to.window(popup_handle)
            wait.until(lambda d: d.find_element(By.ID, "strength-input").get_attribute("value") == "75")

            def popup_request(message):
                driver.switch_to.window(popup_handle)
                result = driver.execute_async_script("""
                    const done=arguments[arguments.length-1];
                    browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));
                """, message)
                assert result and result.get("ok"), result
                return result

            def snapshot():
                result = popup_request({"type": "GET_STATE"})
                driver.switch_to.window(youtube_handle)
                return result

            def fixture(right_id=real_id):
                driver.switch_to.window(youtube_handle)
                driver.execute_script("""
                    window.scrollTo(0,0);
                    const create=(tag,attrs={},text='')=>{
                      const el=document.createElement(tag);
                      for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
                      if(text)el.textContent=text;
                      return el;
                    };
                    const style=create('style');
                    style.textContent=`
                      body{margin:0!important;min-height:2600px!important;background:#fff!important}
                      #fixture{display:flex;gap:30px;position:relative;padding:140px 20px 0}
                      yt-lockup-view-model{display:block!important;flex:none;width:400px!important;height:260px!important;overflow:visible!important}
                      .yt-lockup-view-model-wiz{height:260px;background:#ccc;position:relative}
                      #fixture img{width:300px;height:170px;display:block}
                      #fixture a{display:block;color:#000}
                      #fixture-menu{display:none;position:absolute;left:350px;top:20px;width:250px;height:160px;background:#0f0;z-index:2202}
                      #fixture-menu button{margin:50px}
                    `;
                    const main=create('main',{id:'fixture'});
                    for(const [name,id] of [['left','LEFT0000001'],['right',arguments[0]]]){
                      const tile=create('yt-lockup-view-model',{id:'card-'+name});
                      const content=create('div',{class:'yt-lockup-view-model-wiz'});
                      const link=create('a',{href:'/watch?v='+id},name+' video');
                      link.addEventListener('click',event=>event.preventDefault());
                      link.append(create('img',{alt:''}));
                      content.append(link);tile.append(content);main.append(tile);
                      if(name==='left'){
                        const toggle=create('button',{id:'fixture-menu-toggle'},'Menu');
                        const menu=create('div',{id:'fixture-menu'});
                        const choice=create('button',{id:'fixture-choice'},'Choose');
                        toggle.addEventListener('click',()=>menu.style.display='block');
                        choice.addEventListener('click',()=>document.body.dataset.choice='yes');
                        menu.append(choice);content.append(toggle,menu);
                      }
                    }
                    document.body.replaceChildren(style,main);
                """, right_id)
                time.sleep(.25)

            def count():
                return driver.execute_script("return document.querySelectorAll('.seen-video-overlay').length")

            def scroll_past():
                time.sleep(2.15)
                driver.execute_script("window.scrollTo(0,1100)")
                time.sleep(2.2)
                driver.execute_script("window.scrollTo(0,0)")
                time.sleep(.25)

            popup_request({"type": "RESET_SEEN_VIDEOS"})
            fixture()
            scroll_past()
            assert count() == 2, count()
            assert set(snapshot()["seenVideoIds"]) == {"LEFT0000001", real_id}
            record("two-second visibility and outside timers persist two videos")
            driver.find_element(By.CSS_SELECTOR, "#card-left a").click()
            wait.until(lambda d: count() == 1)
            state = snapshot()
            assert "LEFT0000001" not in state["seenVideoIds"]
            assert "LEFT0000001" in state["watchIntentVideoIds"]
            record("watch intent removes the old seen mark and prevents greying")

            driver.find_element(By.ID, "fixture-menu-toggle").click()
            menu_visible = driver.execute_script("""
                const menu=document.getElementById('fixture-menu');
                const overlay=document.querySelector('.seen-video-overlay');
                const r=menu.getBoundingClientRect();
                overlay.style.setProperty('pointer-events','auto','important');
                const hit=document.elementFromPoint(r.x+150,r.y+80);
                overlay.style.removeProperty('pointer-events');
                return !!hit?.closest('#fixture-menu');
            """)
            assert menu_visible
            driver.find_element(By.ID, "fixture-choice").click()
            assert driver.execute_script("return document.body.dataset.choice") == "yes"
            assert count() == 1
            record("menu paints above neighbouring overlay and remains clickable")

            driver.switch_to.window(popup_handle)
            strength = driver.find_element(By.ID, "strength-input")
            strength.send_keys(Keys.CONTROL, "a")
            strength.send_keys("0")
            time.sleep(.3)
            driver.switch_to.window(youtube_handle)
            try:
                wait.until(lambda d: count() == 0)
            except Exception:
                print('ZERO_DEBUG', snapshot(), flush=True)
                print('OVERLAY_DEBUG', driver.execute_script("return Array.from(document.querySelectorAll('.seen-video-overlay')).map(e=>e.style.opacity)"), flush=True)
                driver.switch_to.window(popup_handle)
                print('POPUP_DEBUG', driver.find_element(By.TAG_NAME, 'body').text, flush=True)
                raise
            driver.switch_to.window(popup_handle)
            strength = driver.find_element(By.ID, "strength-input")
            strength.send_keys(Keys.CONTROL, "a")
            strength.send_keys("40")
            time.sleep(.3)
            driver.switch_to.window(youtube_handle)
            wait.until(lambda d: count() == 1)
            assert driver.execute_script("return document.querySelector('.seen-video-overlay').style.opacity") == "0.4"
            record("popup strength zero removes dimming and 40 percent is applied")

            driver.switch_to.window(popup_handle)
            driver.find_element(By.ID, "enabled-toggle").click()
            time.sleep(.3)
            assert driver.find_element(By.ID, "reset-btn").is_enabled()
            driver.find_element(By.ID, "reset-btn").click()
            wait.until(lambda d: d.find_element(By.ID, "status-message").text == "History reset.")
            assert popup_request({"type": "GET_STATE"})["seenVideoIds"] == []
            driver.find_element(By.ID, "enabled-toggle").click()
            time.sleep(.2)
            driver.switch_to.window(youtube_handle)
            assert count() == 0
            record("reset works while disabled and does not restore old history")

            # The active tab becomes eligible, then is hidden during the outside timer.
            driver.execute_script("window.scrollTo(0,0)")
            time.sleep(2.15)
            driver.execute_script("window.scrollTo(0,1100)")
            time.sleep(.3)
            driver.switch_to.window(popup_handle)
            time.sleep(2.3)
            assert popup_request({"type": "GET_STATE"})["seenVideoIds"] == []
            driver.switch_to.window(youtube_handle)
            record("inactive tab cancels the outside timer")

            driver.execute_script("window.scrollTo(0,0)")
            time.sleep(2.15)
            driver.execute_script("""
                document.querySelector('#card-right a').href='/watch?v=RECYCLED001';
                window.scrollTo(0,1100);
            """)
            time.sleep(2.2)
            assert "RECYCLED001" not in snapshot()["seenVideoIds"]
            record("a recycled card cannot inherit another video's eligibility")

            driver.execute_script("""
                history.pushState({},'', '/shorts/SHORTTEST01');
                document.dispatchEvent(new Event('yt-navigate-finish'));
            """)
            time.sleep(2.2)
            assert "SHORTTEST01" in snapshot()["seenVideoIds"]
            record("Shorts route commits once after two active seconds")

            # Re-mark the real result ID, then exercise YouTube's native menu.
            driver.execute_script("""
                history.pushState({},'', '/results?search_query=synthwave');
                document.dispatchEvent(new Event('yt-navigate-finish'));
            """)
            fixture()
            scroll_past()
            assert real_id in snapshot()["seenVideoIds"]
            driver.get(SEARCH)
            wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".seen-video-overlay")) > 0)
            cards = driver.find_elements(By.CSS_SELECTOR, "ytd-video-renderer")
            card = next(c for c in cards if any(
                real_id in (a.get_attribute("href") or "")
                for a in c.find_elements(By.CSS_SELECTOR, "a[href]")
            ))
            driver.execute_script("arguments[0].scrollIntoView({block:'center'})", card)
            ActionChains(driver).move_to_element(card).perform()
            menu_button = wait.until(lambda d: next(iter(card.find_elements(By.CSS_SELECTOR,
                'ytd-menu-renderer button, button[aria-label="Aktionsmenü"], button[aria-label="Action menu"]')), None))
            menu_button.click()
            wait.until(lambda d: any(e.is_displayed() for e in d.find_elements(By.CSS_SELECTOR, "ytd-menu-popup-renderer")))
            items = driver.find_elements(By.CSS_SELECTOR,
                "ytd-menu-popup-renderer ytd-menu-service-item-renderer, ytd-menu-popup-renderer ytd-menu-navigation-item-renderer")
            share = next(e for e in items if e.text.strip() in ("Teilen", "Share"))
            share.click()
            wait.until(lambda d: any(e.is_displayed() for e in d.find_elements(By.CSS_SELECTOR, "tp-yt-paper-dialog")))
            record("native YouTube action menu opens its Share dialog")

            driver.set_context("chrome")
            errors = driver.execute_script("""
                const uuid=arguments[0];
                return Services.console.getMessageArray()
                  .filter(m=>(m.sourceName||'').includes(uuid) && (m.flags===0 || m.errorMessage))
                  .map(m=>({message:m.errorMessage||m.message,source:m.sourceName}));
            """, extension_uuid)
            assert not errors, errors
            record("no extension errors in Firefox console", {"browser": driver.capabilities["browserVersion"]})
            print(json.dumps({"passed": len(results), "checks": results}, ensure_ascii=False), flush=True)
        finally:
            driver.quit()


if __name__ == "__main__":
    run()
