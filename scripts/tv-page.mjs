// The packaged TV app's page and over-the-air settings, shared by scripts/package-tv.mjs
// (the widget) and scripts/ota-update.mjs (the Worker's /tv-app/ copy) so both produce
// the same build. config.js (the Worker address) and Samsung's webapis stay in the
// widget: the loader keeps them ahead of the build it starts (ota/build.mjs preHead).
export const UPDATES_ORIGIN = 'https://tv.codeboxhk.com';
export const LOCAL_FILES = ['config.js'];
export const PRE_HEAD = '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  <script src="config.js"></script>';

export function tvPage(html) {
  return html.replace(/\s*<link rel="icon" href="..\/favicon.svg">/, '').replace(/\s*<script src="config.js"><\/script>/, '');
}
