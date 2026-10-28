export type GoalSubmissionMode = {
  schema: "metaengine.client.goal-submission-mode.v1";
  kind: "NATIVE_CODING" | "BROWSER" | "UNAVAILABLE";
  state: "HOST_VERIFICATION_REQUIRED" | "HOLD";
  reason: string | null;
  project_id?: string | null;
  automatic_retry_allowed: false;
  authority_effect: false;
};

export function createGoalSubmissionModeObserver(options: {
  read: () => Promise<unknown>;
  publish: (mode: GoalSubmissionMode) => void;
}): Readonly<{
  start(): () => void;
  refresh(options?: { fresh?: boolean }): Promise<GoalSubmissionMode>;
}>;

export function goalSubmissionModeText(mode: GoalSubmissionMode | null): {
  label: string;
  detail: string;
};

export function shouldPollClientGoal(entry: {
  request_id?: string;
  kind?: string;
  state?: string;
  last_error?: string | null;
  native_rejection?: { schema?: string; state?: string } | null;
  progress?: { terminal?: boolean; task_state?: string | null } | null;
  execution_proof?: { user_goal_to_result_readback?: boolean } | null;
} | null, receipt: { request_id?: string } | null): boolean;
