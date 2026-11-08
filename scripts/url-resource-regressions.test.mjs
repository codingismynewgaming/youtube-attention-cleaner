import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

for (const browserName of ["firefox", "chrome", "edge"]) {
  const urls = await import(pathToFileURL(resolve(`app-files/${browserName}/lib/urls.js`)).href);

  test(`${browserName}: supported video URLs and invalid IDs are classified safely`, () => {
    assert.equal(urls.extractVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
    assert.equal(urls.extractVideoId("https://youtube.com/shorts/abcdefghijk"), "abcdefghijk");
    assert.equal(urls.extractVideoId("https://youtu.be/abcdefghijk?t=12"), "abcdefghijk");
    assert.equal(urls.extractVideoId("/watch?v=abcdefghijk"), "abcdefghijk");
    assert.equal(urls.extractVideoId("https://youtube.com/watch?v=short"), null);
    assert.equal(urls.extractVideoId("https://www.youtube.com/watch?v=abcdefghijk&v=bad"),
      "abcdefghijk");
    assert.equal(urls.extractVideoId("https://youtube.com.evil.example/watch?v=abcdefghijk"), null);
    assert.equal(urls.extractVideoId("https://example.com/watch?v=abcdefghijk"), null);
    assert.equal(urls.extractVideoId("https://youtu.be/abcdefghijk/extra"), "abcdefghijk");
    assert.equal(urls.extractVideoId(null), null);
  });

  test(`${browserName}: allowed YouTube routes and primary/sidebar classification hold`, () => {
    assert.equal(urls.classifyPage("/"), "home");
    assert.equal(urls.classifyPage("/feed/subscriptions"), "subscriptions");
    assert.equal(urls.classifyPage("/results"), "search");
    assert.equal(urls.classifyPage("/watch"), "watch");
    assert.equal(urls.classifyPage("/shorts/abcdefghijk"), "shorts");
    assert.equal(urls.classifyPage("/channel/example"), "other");

    for (const route of ["/", "/feed/subscriptions", "/results", "/watch", "/shorts/abcdefghijk"]) {
      assert.equal(urls.shouldGreyOnPage(route), true, `${route} should be active`);
    }
    for (const route of ["/channel/example", "/playlist"]) {
      assert.equal(urls.shouldGreyOnPage(route), false, `${route} should stay inactive`);
    }

    assert.equal(urls.isAllowedURL("www.youtube.com"), true);
    assert.equal(urls.isAllowedURL("youtube.com"), true);
    assert.equal(urls.isAllowedURL("m.youtube.com"), false);
    assert.equal(urls.isAllowedURL("www.youtube.com.evil.example"), false);

    const player = {
      tagName: "YTD-VIDEO-RENDERER",
      closest(selector) { return selector === "ytd-player" ? this : null; }
    };
    const sidebar = {
      tagName: "YTD-COMPACT-VIDEO-RENDERER",
      closest() { return null; }
    };
    const feed = {
      tagName: "YTD-VIDEO-RENDERER",
      closest() { return null; }
    };
    assert.equal(urls.isPrimaryVideo(player), true);
    assert.equal(urls.isPrimaryVideo(sidebar), false);
    assert.equal(urls.isPrimaryVideo(feed), false);
  });
}

test("resource regression: no interval polling in any content script", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const browserName of ["firefox", "chrome", "edge"]) {
    const source = await readFile(`app-files/${browserName}/content.js`, "utf8");
    assert.doesNotMatch(source, /\bsetInterval\s*\(/, `${browserName} should not poll whole pages`);
    assert.match(source, /IntersectionObserver/, `${browserName} should observe visibility`);
    assert.match(source, /document\.hidden/, `${browserName} should pause in hidden tabs`);
  }
});
