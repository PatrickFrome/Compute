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
