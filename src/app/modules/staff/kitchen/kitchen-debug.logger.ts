/** Kitchen SSE debug — re-exports shared agent logger. */
import { agentDebugLog } from '../../../core/debug/agent-debug.logger';

export function kitchenDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = 'pre-fix',
): void {
  agentDebugLog(hypothesisId, location, message, data, runId);
}
