export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type RoleKind = "IMPLEMENTER" | "ANALYST" | "SUPERVISOR";

export interface AopWake { id: string; reason: string; source?: string; payload?: JsonObject; }
export interface RoleConfig { branch?: string; issue?: number; authority?: string; }

export interface AopLease {
  schema: string; leased: boolean; run_id?: string; role_key?: string; role_kind?: RoleKind;
  role_config?: RoleConfig; milestone_key?: string | null; mutation_domains?: string[];
  executor_profile?: string; lease_generation?: number; lease_expires_at?: string;
  input?: JsonObject; expected_github_sha?: string | null; base_checkpoint_id?: string | null;
  base_head_drift?: boolean; roadmap_status?: JsonObject; supervisor_snapshot?: JsonObject;
  claim?: JsonObject | null; directive?: JsonObject | null;
}

export interface ModelOutcome {
  result_code: "CONTINUE"|"EVIDENCE_READY"|"FAILED"|"ACCEPT"|"ACCEPT_WITH_REBASE"|"REQUEST_CHANGES"|"HOLD"|"REJECT"|"RETURN"|"WAIT"|"VERIFIED";
  output: JsonObject; github_sha?: string | null; wake_condition?: string | null;
}
export interface WorkflowParams { wake: AopWake; workerId: string; }
export interface Env {
  SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; AOP_WAKE_SECRET: string;
  AOP_SUPERVISOR_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  CF_ACCOUNT_ID?: string; CF_AI_TOKEN?: string; AOP_MODEL?: string; AOP_AI_GATEWAY_ID?: string;
  AOP_SUPERVISOR: DurableObjectNamespace; AOP_RUN_WORKFLOW: WorkflowBinding; AOP_WAKE_QUEUE: QueueBinding<AopWake>;
}
export interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { wake(message: AopWake): Promise<{ accepted: boolean }> }; }
export interface WorkflowBinding { create(options: { id?: string; params: WorkflowParams }): Promise<unknown>; }
export interface QueueBinding<T> { send(message: T): Promise<void>; }
export interface QueueMessage<T> { body: T; ack(): void; retry(options?: { delaySeconds?: number }): void; }
export interface MessageBatch<T> { messages: Array<QueueMessage<T>>; }
