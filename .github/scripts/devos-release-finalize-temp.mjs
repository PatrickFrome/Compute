import fs from 'node:fs';

function replaceExact(source, before, after, label, expected = 1) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`${label}_anchor_count:${count}`);
  return expected > 1 ? source.replaceAll(before, after) : source.replace(before, after);
}

const mainPath = 'apps/metaengine-browser/src/main.mjs';
let main = fs.readFileSync(mainPath, 'utf8');
const oldPreconnect = "  try { userSession.preconnect({ url: 'https://chatgpt.com/', numSockets: 2 }); } catch {}";
const newPreconnect = `  let chatgptPreconnectArmed = false;
  try {
    userSession.preconnect({ url: 'https://chatgpt.com/', numSockets: 2 });
    chatgptPreconnectArmed = true;
  } catch {}
  console.log(JSON.stringify({
    schema: 'metaengine.browser.chat-preconnect.v1',
    state: chatgptPreconnectArmed ? 'ARMED' : 'UNAVAILABLE',
    origin: 'https://chatgpt.com/',
    sockets: 2,
    persistent_partition: SECURITY_POLICY.user_space_partition,
    authority_effect: false,
  }));`;
main = replaceExact(main, oldPreconnect, newPreconnect, 'preconnect');
const staleDirect = "    devos_sources: projectDevOSDevelopmentSources({ development_plane: developmentPlaneSnapshot, startup_logs: startupDegradedSnapshot() }),\n";
main = replaceExact(main, staleDirect, '', 'stale_direct_source');
fs.writeFileSync(mainPath, main);

const fastPath = 'apps/metaengine-browser/test/browser-chatgpt-fast-open.test.mjs';
let fast = fs.readFileSync(fastPath, 'utf8');
const fastAnchor = "  assert.match(main, /userSession\\.preconnect\\(\\{ url: 'https:\\/\\/chatgpt\\.com\\/', numSockets: 2 \\}\\)/);\n";
const fastInsert = fastAnchor
  + "  assert.match(main, /schema: 'metaengine\\.browser\\.chat-preconnect\\.v1'/);\n"
  + "  assert.match(main, /state: chatgptPreconnectArmed \\? 'ARMED' : 'UNAVAILABLE'/);\n"
  + "  assert.match(main, /initialTab = await runDegradableStartupStep\\('INITIAL_TAB_CREATE', \\(\\) => createTab\\('https:\\/\\/chatgpt\\.com\\/', \\{ select: true, load: false \\}\\)\\)/);\n";
fast = replaceExact(fast, fastAnchor, fastInsert, 'fast_open');
fs.writeFileSync(fastPath, fast);

const releasePath = 'apps/metaengine-browser/test/browser-devos-multisurface-release-contract.test.mjs';
let release = fs.readFileSync(releasePath, 'utf8');
const releaseAnchor = "  assert.equal((source.match(/devos_sources: devosSourceSnapshot,/g) || []).length, 3);\n";
release = replaceExact(release, releaseAnchor, releaseAnchor + "  assert.equal((source.match(/devos_sources: projectDevOSDevelopmentSources/g) || []).length, 0);\n", 'release_source');
fs.writeFileSync(releasePath, release);

const workflowPath = '.github/workflows/browser-windows-package-smoke.yml';
let workflow = fs.readFileSync(workflowPath, 'utf8');
const pathAnchor = "      - 'apps/metaengine-browser/test/browser-startup-observability.test.mjs'\n";
workflow = replaceExact(workflow, pathAnchor, pathAnchor + "      - 'apps/metaengine-browser/test/browser-chatgpt-fast-open.test.mjs'\n", 'package_path', 2);

const testAnchor = `      - name: Prove startup observability reducer before packaging
        working-directory: apps/metaengine-browser
        run: node --test test/browser-startup-observability.test.mjs
`;
const testInsert = testAnchor + `
      - name: Prove immediate ChatGPT connection source contract before packaging
        working-directory: apps/metaengine-browser
        run: node --test test/browser-chatgpt-fast-open.test.mjs
`;
workflow = replaceExact(workflow, testAnchor, testInsert, 'package_test');

const proofAnchor = "            runtime_import_observability_verified=$false\n";
workflow = replaceExact(workflow, proofAnchor, proofAnchor + "            chatgpt_preconnect_armed=$false\n            initial_chatgpt_surface_exposed=$false\n", 'package_proof');

const stableAnchor = "            $stableSequence = [int64]$stableEvent.sequence\n";
const installedProof = `            $normalLines = @(Get-Content $normalOut -ErrorAction Stop)
            $preconnectIndex = -1
            $initialChatIndex = -1
            for ($i = 0; $i -lt $normalLines.Count; $i++) {
              $line = [string]$normalLines[$i]
              if (-not $line.Trim().StartsWith('{')) { continue }
              try { $runtimeEvent = $line | ConvertFrom-Json } catch { continue }
              if ($runtimeEvent.schema -eq 'metaengine.browser.chat-preconnect.v1' \
                  -and $runtimeEvent.state -eq 'ARMED' \
                  -and $runtimeEvent.origin -eq 'https://chatgpt.com/' \
                  -and [int]$runtimeEvent.sockets -eq 2 \
                  -and $runtimeEvent.authority_effect -eq $false) {
                $preconnectIndex = $i
              }
              if ($runtimeEvent.schema -eq 'metaengine.browser-startup-subsystem.v1' \
                  -and $runtimeEvent.state -eq 'SUBSYSTEM_READY' \
                  -and $runtimeEvent.subsystem -eq 'INITIAL_TAB_CREATE' \
                  -and $runtimeEvent.authority_effect -eq $false) {
                $initialChatIndex = $i
              }
            }
            if ($preconnectIndex -lt 0) {
              Get-Content $normalOut -ErrorAction SilentlyContinue
              throw 'installed_chatgpt_preconnect_not_armed'
            }
            if ($initialChatIndex -lt 0) {
              Get-Content $normalOut -ErrorAction SilentlyContinue
              throw 'installed_initial_chatgpt_surface_not_exposed'
            }
            if ($preconnectIndex -ge $initialChatIndex) { throw 'installed_chatgpt_connection_order_invalid' }
            $proof.chatgpt_preconnect_armed = $true
            $proof.initial_chatgpt_surface_exposed = $true
            $proof | Add-Member -NotePropertyName chatgpt_connect_origin -NotePropertyValue 'https://chatgpt.com/' -Force
            $proof | Add-Member -NotePropertyName chatgpt_connect_evidence_source -NotePropertyValue 'INSTALLED_NORMAL_UI_STDOUT' -Force
`;
workflow = replaceExact(workflow, stableAnchor, stableAnchor + installedProof, 'package_stable');

const unchangedAnchor = 'apps/metaengine-browser/test/browser-startup-observability.test.mjs apps/metaengine-browser/test/browser-shell-visual-evidence.mjs';
workflow = replaceExact(workflow, unchangedAnchor, 'apps/metaengine-browser/test/browser-startup-observability.test.mjs apps/metaengine-browser/test/browser-chatgpt-fast-open.test.mjs apps/metaengine-browser/test/browser-shell-visual-evidence.mjs', 'package_unchanged');
fs.writeFileSync(workflowPath, workflow);

console.log(JSON.stringify({ schema: 'metaengine.devos.release-finalize-patch.v1', ok: true, authority_effect: false }));
