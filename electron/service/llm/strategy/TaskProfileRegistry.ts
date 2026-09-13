import { TASK_PROFILE_CONFIGS, type TaskProfileConfig } from '../config/taskProfiles';

export type TaskProfile = TaskProfileConfig;

export class TaskProfileRegistry {
  resolve(taskProfileId?: string, operation?: string, source?: string): TaskProfile | null {
    const normalizedTaskProfileId = taskProfileId?.trim().toLowerCase();
    const normalizedOperation = operation?.trim().toLowerCase();
    const normalizedSource = source?.trim().toLowerCase();

    if (normalizedTaskProfileId) {
      const profileById = TASK_PROFILE_CONFIGS.find((profile) => profile.id.toLowerCase() === normalizedTaskProfileId);
      if (profileById) {
        return profileById;
      }
    }

    return TASK_PROFILE_CONFIGS.find((profile) => {
      const operationMatches = profile.operation
        ? profile.operation.toLowerCase() === normalizedOperation
        : true;
      const sourceMatches = profile.source
        ? profile.source.toLowerCase() === normalizedSource
        : true;
      return operationMatches && sourceMatches;
    }) ?? null;
  }
}

export const taskProfileRegistry = new TaskProfileRegistry();
