import { tokenBudgeter } from '../budget/TokenBudgeter';
import { contextManager } from '../context/ContextManager';
import { resolveProviderCapability } from '../providers/ProviderCapabilityRegistry';
import { taskClassifier } from './TaskClassifier';
import type { LLMQueryRequest, StrategyDecision } from '../types';

export class StrategyPlanner {
  plan(request: LLMQueryRequest): StrategyDecision {
    const taskClassification = taskClassifier.classify(request);
    const taskKind = taskClassification.taskKind;
    const capability = resolveProviderCapability(request.config);
    const budget = tokenBudgeter.snapshot(request.messages, request.config);

    if (budget.estimatedInputTokens <= budget.inputBudget || request.options?.disableChunking) {
      return {
        strategy: 'direct',
        taskKind,
        taskProfileMatched: taskClassification.matchedProfile,
        taskClassificationSource: taskClassification.source,
        capability,
        budget,
      };
    }

    const compactedRequest = contextManager.compactMessagesForBudget(request);
    const compactedEstimatedTokens = tokenBudgeter.estimateMessageTokens(compactedRequest.messages, compactedRequest.config.modelProvider);
    const collapseApplied = compactedRequest.messages.some(
      message => message.content.includes('【历史上下文折叠摘要】'),
    );

    const shouldPreferCompaction = taskKind === 'rewrite' || taskKind === 'generate' || taskKind === 'chat';
    const shouldPreferChunking = taskKind === 'extract' || taskKind === 'analyze' || taskKind === 'structured';

    if ((shouldPreferCompaction || !shouldPreferChunking)
      && compactedEstimatedTokens < budget.estimatedInputTokens
      && compactedEstimatedTokens <= budget.inputBudget) {
      return {
        strategy: 'compact-first',
        taskKind,
        taskProfileMatched: taskClassification.matchedProfile,
        taskClassificationSource: taskClassification.source,
        capability,
        budget,
        compactedRequest,
        compactedEstimatedTokens,
        collapseApplied,
      };
    }

    return {
      strategy: 'chunked',
      taskKind,
      taskProfileMatched: taskClassification.matchedProfile,
      taskClassificationSource: taskClassification.source,
      capability,
      budget,
      compactedRequest,
      compactedEstimatedTokens,
      collapseApplied,
    };
  }
}

export const strategyPlanner = new StrategyPlanner();
