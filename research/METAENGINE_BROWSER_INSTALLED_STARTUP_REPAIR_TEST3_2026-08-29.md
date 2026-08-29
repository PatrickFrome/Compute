# METAENGINE Browser installed startup repair — 0.5.0-test.3

## Incident

The NSIS installer completed successfully, but the user reported that shortcuts were created while the browser window did not appear.

## Reproduction improvement

The original installer gate only proved that the installed EXE existed. A later external Windows `MainWindowHandle` gate reproduced a missing-window symptom, but that OS-level property is not a reliable Electron/Chromium truth source on hosted runners.

## Repair

- Normalize package identity to `metaengine-browser-test`.
- Packaged boot defers exactly one initial ChatGPT navigation to `about:blank`, removing remote-network success from the critical application startup path.
- Add a bootstrap layer that explicitly calls `show()`/`focus()` on live Electron `BaseWindow` instances.
- Persist `metaengine.browser.startup-receipt.v1` from inside the installed runtime.
- Gate the installer on `window_count >= 1`, `visible_window_count >= 1`, `window_visible=true`, `app_packaged=true`, `status=READY`, and `authority_effect=false`.

## Authority boundary

This is packaging/lifecycle repair only. It does not add page, browser, sandbox-execution, gateway-dispatch, or promotion authority.
