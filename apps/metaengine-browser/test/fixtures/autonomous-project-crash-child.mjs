import { AutonomousProjectTaskRuntime } from '../../src/autonomous-project-task-runtime.mjs';
import { createAutonomousProjectJournal } from '../../src/autonomous-project-journal.mjs';
import { createAutonomousProjectProviderFixture } from './autonomous-project-provider.mjs';

const [journalPath, providerPath, projectId, rootJson] = process.argv.slice(2);
const rootTask = JSON.parse(rootJson);
const provider = createAutonomousProjectProviderFixture({ filePath: providerPath, projectId, rootTask,
  afterCommit: () => process.exit(66) });
const runtime = new AutonomousProjectTaskRuntime({ journal: createAutonomousProjectJournal({ filePath: journalPath }),
  request: input => provider.request(input), materializeProject: async () => ({ state: 'PROVEN' }) });
await runtime.serveToolRequests({ lease: rootTask, requests: [{ request_id: 'fixture:spawn:crash', action: 'PROJECT_SPAWN',
  payload: { children: [{ role: 'CODER', objective: 'Implement one useful child task with independent evidence' }] } }] });
