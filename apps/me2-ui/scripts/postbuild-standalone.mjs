#!/usr/bin/env node
/**
 * R77: кросс-платформенный postbuild для standalone-контракта pack-me2-ui.
 * Заменяет POSIX `cp -r` из build-скрипта (ломался на Windows-раннерах CI):
 * копирует .next/static и public внутрь .next/standalone и честно asserts
 * наличие server.js (exit≠0 при нарушении контракта сборки).
 */
import { cpSync, existsSync } from 'node:fs';

const fail = (msg) => {
  console.error(`[postbuild-standalone] FAIL: ${msg}`);
  process.exit(1);
};

if (!existsSync('.next/standalone/server.js')) fail('.next/standalone/server.js отсутствует — сборка неполна');
if (!existsSync('.next/static')) fail('.next/static отсутствует');
if (!existsSync('.next/standalone/.next')) fail('.next/standalone/.next отсутствует');

cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true });

if (!existsSync('.next/standalone/.next/static')) fail('static не скопирован в standalone');
console.log('[postbuild-standalone] OK: static+public в standalone, server.js на месте');
