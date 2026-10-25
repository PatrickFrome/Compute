import path from 'node:path';

const root = 'C:\\Windows';
const contextKeys = new Set(['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
// Win32 reserved names also apply to directory components and extensions:
// https://learn.microsoft.com/windows/win32/fileio/naming-a-file
// Console input/output aliases: https://learn.microsoft.com/windows/console/console-handles
const dosDevice = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
const consoleAlias = /^(?:CONIN|CONOUT)\$$/i;
const deviceComponent = part => dosDevice.test(part.split('.')[0].replace(/ +$/, '')) || consoleAlias.test(part);
const invalid = () => { throw Error('windows_native_read_environment_context_invalid'); };
function localContextPath(value) {
  if (typeof value !== 'string' || value.length > 2047 || !/^[A-Za-z]:[\\/]/.test(value)
    || /[\x00-\x1f\x7f<>:"|?*]/.test(value.slice(2))
    || value.slice(3).split(/[\\/]/).some(part => part === '.' || part === '..' || /[. ]$/.test(part) || deviceComponent(part))) invalid();
  return path.win32.normalize(value);
}

// Runtime context only, never path/ACL/image/identity authority. Preserve the
// same narrow profile/temp context needed by clean-image WinPS/.NET discovery
// (see private-windows-storage-acl), without inheriting executable/module paths,
// credentials, proxies, mirrors, NODE_OPTIONS or PowerShell startup settings.
export function fixedWindowsNativeReadEnvironment(source = process.env) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) invalid();
  const context = {};
  for (const key of Object.keys(source)) {
    const name = key.toUpperCase();
    if (!contextKeys.has(name)) continue;
    const validated = localContextPath(source[key]);
    if (Object.hasOwn(context, name) && context[name] !== validated) invalid();
    context[name] = validated;
  }
  return Object.freeze({...context,
    TEMP: context.TEMP ?? path.win32.join(root, 'Temp'),
    TMP: context.TMP ?? path.win32.join(root, 'Temp'),
    USERPROFILE: context.USERPROFILE ?? root,
    SystemRoot: root, SYSTEMROOT: root, WINDIR: root,
    PATH: path.win32.join(root, 'System32'),
    PSModulePath: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  });
}
