// Compatibility entry: tests the website in Chrome only, not the desktop application.
import('./light-browser-smoke.mjs').catch(error=>{console.error(error);process.exitCode=1;});
