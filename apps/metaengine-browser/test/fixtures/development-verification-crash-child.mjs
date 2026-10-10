import fs from 'node:fs/promises';
import { createDevelopmentVerificationSqliteJournal } from '../../src/development-verification-sqlite-journal.mjs';
import { DevelopmentVerificationRuntime } from '../../src/development-verification-runtime.mjs';
import { trustedFixtureExecutor } from './development-verification-trusted-executor.mjs';

const configuration = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const journal = createDevelopmentVerificationSqliteJournal({ filePath: configuration.filePath });
const executor = trustedFixtureExecutor({ workingRoot: configuration.workingRoot, markerPath: configuration.markerPath, crashAfterBuild: true });
const runtime = new DevelopmentVerificationRuntime({ ...configuration.options, executor, journal });
await runtime.run(configuration.request);
throw new Error('fixture_crash_not_triggered');
