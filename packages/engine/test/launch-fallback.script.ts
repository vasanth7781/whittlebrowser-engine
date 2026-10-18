// Run by launch.test.ts in a child process with an empty PLAYWRIGHT_BROWSERS_PATH (as on a machine that never downloaded Chromium).
import { launch } from '../src/driver/launch.js';
try {
  const b = await launch({ headless: true, profileDir: null });
  const p = await b.context.newPage();
  await p.goto('about:blank');
  console.log('LAUNCHED');
  await b.close();
} catch (e) {
  console.log('ERROR ' + (e as Error).message);
}
process.exit(0);
