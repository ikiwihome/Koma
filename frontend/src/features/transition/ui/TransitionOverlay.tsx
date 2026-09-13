import React, { useMemo } from 'react';
import { cssVars } from '../../../theme/runtime';
import type { Track, Transition } from '../../../types/editor';
import type { ResolvedClipWindow } from '../core/types';
import { MIN_VISIBLE_DURATION, DEFAULT_TRANSITION_DURATION, MAX_TRANSITION_DURATION } from '../core/constants';
import {
  findTransitionByClipPair,
  getAddableTransitionDuration,
  batchChainAwareMaxDurations,
  getMaxTransitionDuration,
  getSortedTrackClips,
  normalizeTrackTransitions,
} from '../core/transitionResolver';
import styles from './TransitionOverlay.module.scss';

interface TransitionOverlayProps {
  track: Track;
  resolvedClipWindows: Map<string, ResolvedClipWindow>;
  pixelsPerSecond: number;
  selectedTransitionId: string | null;
  invalidTransitions?: Transition[];
  isDragging?: boolean;
  onSelectTransition?: (id: string | null) => void;
  onAddTransition?: (trackId: string, fromClipId: string, toClipId: string) => void;
  onUpdateTransitionDuration?: (trackId: string, transitionId: string, duration: number) => void;
  onDeleteTransition?: (trackId: string, transitionId: string) => void;
}

export const TransitionOverlay: React.FC<TransitionOverlayProps> = React.memo(({
  track,
  resolvedClipWindows,
  pixelsPerSecond,
  selectedTransitionId,
  invalidTransitions,
  isDragging = false,
  onSelectTransition,
  onAddTransition,
  onUpdateTransitionDuration,
  onDeleteTransition,
}) => {
  const sortedClips = getSortedTrackClips(track);
  const normalizedTrack = useMemo(() => normalizeTrackTransitions(track), [track]);

  const chainMaxDurations = useMemo(
    () => batchChainAwareMaxDurations(normalizedTrack),
    [normalizedTrack],
  );

  const invalidIds = useMemo(
    () => new Set((invalidTransitions ?? []).map((transition) => transition.id)),
    [invalidTransitions],
  );

  return (
    <>
      {sortedClips.slice(1).map((toClip, clipIndex) => {
        const fromClip = sortedClips[clipIndex];
        const explicitTransition = findTransitionByClipPair(track, fromClip.id, toClip.id);
        const normalizedTransition = findTransitionByClipPair(normalizedTrack, fromClip.id, toClip.id);
        const transition = explicitTransition ?? normalizedTransition;
        const isInvalid = transition ? invalidIds.has(transition.id) : false;
        const addableDuration = getAddableTransitionDuration(normalizedTrack, fromClip.id, toClip.id);
        const maxDuration = getMaxTransitionDuration(normalizedTrack, fromClip.id, toClip.id);
        const chainMaxDuration = transition
          ? (chainMaxDurations.get(transition.id) ?? maxDuration)
          : maxDuration;
        const sliderMin = Math.min(MIN_VISIBLE_DURATION, chainMaxDuration);
        const sliderMax = Math.min(MAX_TRANSITION_DURATION, Math.max(chainMaxDuration, sliderMin));
        const fromWindow = resolvedClipWindows.get(fromClip.id);
        const toWindow = resolvedClipWindows.get(toClip.id);
        const cutPointTime = fromWindow?.resolvedEnd ?? toClip.start;

        return (
          <div
            key={`transition-${fromClip.id}-${toClip.id}`}
            className={`${styles.cutPoint} absolute top-1 z-20 -translate-x-1/2`}
            style={cssVars({ '--transition-cut-left': `${cutPointTime * pixelsPerSecond}px` })}
          >
            {transition ? (
              <div className="relative flex flex-col items-center gap-1">
                {!isInvalid && (() => {
                  const transitionStartTime = toWindow?.resolvedStart ?? (cutPointTime - transition.duration);
                  return (
                    <div
                      className={`${styles.region} absolute top-0 h-full border-x border-status-info/40 bg-status-info/12 pointer-events-none`}
                      style={cssVars({
                        '--transition-region-left': `${(transitionStartTime - cutPointTime) * pixelsPerSecond}px`,
                        '--transition-region-width': `${transition.duration * pixelsPerSecond}px`,
                      })}
                    />
                  );
                })()}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isInvalid) {
                      onSelectTransition?.(
                        selectedTransitionId === transition.id ? null : transition.id,
                      );
                    }
                  }}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium shadow ${
                    isInvalid
                      ? isDragging
                        ? 'border border-status-warning/50 bg-status-warning/20 text-status-warning opacity-60 pointer-events-none transition-colors duration-200 delay-200'
                        : 'border border-status-warning/45 bg-status-warning/15 text-status-warning pointer-events-none transition-colors duration-200'
                      : selectedTransitionId === transition.id
                        ? 'bg-status-info text-on-status'
                        : 'bg-bg-elevated/90 text-status-info hover:bg-bg-hover'
                  }`}
                  title={isInvalid ? '失效转场' : '编辑转场'}
                >
                  {isInvalid ? `⚠ 无效 ${transition.duration.toFixed(1)}s` : `淡变 ${transition.duration.toFixed(1)}s`}
                </button>
                {selectedTransitionId === transition.id && !isInvalid && (() => {
                  const computedWidth = chainMaxDuration * pixelsPerSecond * 0.8;
                  const useButtons = computedWidth < 60;

                  return (
                    <div className="flex items-center gap-1 rounded-full bg-black/85 px-2 py-1">
                      {useButtons ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newDuration = Math.max(sliderMin, transition.duration - 0.1);
                              onUpdateTransitionDuration?.(track.id, transition.id, newDuration);
                            }}
                            className="rounded bg-bg-hover px-1 text-[10px] text-text-primary hover:bg-bg-elevated"
                            title="减少 0.1s"
                          >
                            −
                          </button>
                          <span className="min-w-[2rem] text-center text-[10px] text-text-secondary">
                            {transition.duration.toFixed(1)}s
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newDuration = Math.min(sliderMax, transition.duration + 0.1);
                              onUpdateTransitionDuration?.(track.id, transition.id, newDuration);
                            }}
                            className="rounded bg-bg-hover px-1 text-[10px] text-text-primary hover:bg-bg-elevated"
                            title="增加 0.1s"
                          >
                            +
                          </button>
                        </>
                      ) : (
                        <>
                          <input
                            type="range"
                            min={sliderMin}
                            max={sliderMax}
                            step={0.1}
                            value={transition.duration}
                            onChange={(e) => {
                              e.stopPropagation();
                              onUpdateTransitionDuration?.(track.id, transition.id, Number(e.target.value));
                            }}
                            className="h-1 w-16 accent-status-info"
                            title={`转场时长: ${transition.duration.toFixed(1)}s`}
                          />
                          <span className="min-w-[2rem] text-center text-[10px] text-text-secondary">
                            {transition.duration.toFixed(1)}s
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTransition?.(track.id, transition.id);
                        }}
                        className="rounded bg-status-error px-1 text-[10px] text-on-status hover:bg-status-error"
                        title="删除转场"
                      >
                        ×
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              addableDuration > 0 && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddTransition?.(track.id, fromClip.id, toClip.id);
                  }}
                  className="rounded-full bg-bg-elevated/80 px-2 py-0.5 text-[10px] text-text-secondary hover:bg-status-info hover:text-on-status"
                  title={`添加淡变（默认 ${DEFAULT_TRANSITION_DURATION.toFixed(1)}s）`}
                >
                  + 转场
                </button>
              )
            )}
          </div>
        );
      })}
    </>
  );
});

TransitionOverlay.displayName = 'TransitionOverlay';
