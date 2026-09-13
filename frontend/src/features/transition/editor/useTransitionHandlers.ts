import React, { useCallback, useRef } from 'react';
import type { Track, Transition } from '../../../types/editor';
import type { MessageInstance } from 'antd/es/message/interface';
import { generateId } from '../../../utils/generateId';
import { TRANSITION_TYPE_FADE, DEFAULT_TRANSITION_DURATION, MAX_TRANSITION_DURATION, MAX_TRANSITIONS_PER_TRACK } from '../core/constants';
import {
  findTransitionByClipPair,
  getAddableTransitionDuration,
  getChainAwareMaxDuration,
  getSortedTrackClips,
} from '../core/transitionResolver';

interface UseTransitionHandlersParams {
  updateTracks: (updater: (prev: Track[]) => Track[]) => void;
  selectedTransitionId: string | null;
  setSelectedTransitionId: (id: string | null) => void;
  setSelectedClipId: (id: string | null) => void;
  setSelectedKeyframeId: (id: string | null) => void;
  message: MessageInstance;
  isUserDeletingRef: React.MutableRefObject<boolean>;
  defaultDuration?: number;
}

export function useTransitionHandlers({
  updateTracks,
  selectedTransitionId,
  setSelectedTransitionId,
  setSelectedClipId,
  setSelectedKeyframeId,
  message,
  isUserDeletingRef,
  defaultDuration = DEFAULT_TRANSITION_DURATION,
}: UseTransitionHandlersParams) {
  const selectedTransitionIdRef = useRef(selectedTransitionId);
  selectedTransitionIdRef.current = selectedTransitionId;

  const handleSelectTransition = useCallback((id: string | null) => {
    setSelectedTransitionId(id);
    setSelectedClipId(null);
    setSelectedKeyframeId(null);
  }, [setSelectedTransitionId, setSelectedClipId, setSelectedKeyframeId]);

  const handleAddTransition = useCallback((trackId: string, fromClipId: string, toClipId: string) => {
    let createdTransitionId: string | null = null;

    updateTracks((prev) =>
      prev.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        const addableDuration = getAddableTransitionDuration(track, fromClipId, toClipId);
        if (addableDuration <= 0) {
          return track;
        }

        createdTransitionId = generateId();
        return {
          ...track,
          transitions: [
            ...(track.transitions ?? []),
            {
              id: createdTransitionId,
              fromClipId,
              toClipId,
              type: TRANSITION_TYPE_FADE,
              duration: Math.min(defaultDuration, addableDuration, MAX_TRANSITION_DURATION),
            },
          ],
        };
      })
    );

    if (createdTransitionId) {
      setSelectedTransitionId(createdTransitionId);
      message.success('已添加淡变转场');
    } else {
      message.warning('当前切点不满足添加转场条件');
    }
  }, [message, updateTracks, setSelectedTransitionId, defaultDuration]);

  const handleUpdateTransitionDuration = useCallback((
    trackId: string,
    transitionId: string,
    duration: number
  ) => {
    updateTracks((prev) =>
      prev.map((track) => {
        if (track.id !== trackId) {
          return track;
        }

        return {
          ...track,
          transitions: (track.transitions ?? []).map((transition) => {
            if (transition.id !== transitionId) {
              return transition;
            }

            const maxDuration = getChainAwareMaxDuration(
              track,
              transition.id
            );

            return {
              ...transition,
              duration: Math.min(Math.max(0.1, duration), maxDuration, MAX_TRANSITION_DURATION),
            };
          }),
        };
      })
    );
  }, [updateTracks]);

  const handleDeleteTransition = useCallback((trackId: string, transitionId: string) => {
    isUserDeletingRef.current = true;
    updateTracks((prev) =>
      prev.map((track) =>
        track.id === trackId
          ? {
              ...track,
              transitions: (track.transitions ?? []).filter(
                (transition) => transition.id !== transitionId
              ),
            }
          : track
      )
    );
    if (selectedTransitionIdRef.current === transitionId) {
      setSelectedTransitionId(null);
    }
    message.success('已删除转场');
  }, [message, updateTracks, setSelectedTransitionId, isUserDeletingRef]);

  const handleAddAllTransitions = useCallback((trackId: string) => {
    let addedCount = 0;
    const candidateTransitions: Transition[] = [];

    updateTracks((prev) => {
      const track = prev.find(t => t.id === trackId);
      if (!track) return prev;

      const sortedClips = getSortedTrackClips(track);
      if (sortedClips.length <= 1) return prev;

      const existingCount = track.transitions?.length ?? 0;

      for (let i = 0; i < sortedClips.length - 1; i++) {
        if (existingCount + candidateTransitions.length >= MAX_TRANSITIONS_PER_TRACK) break;
        const fromClip = sortedClips[i];
        const toClip = sortedClips[i + 1];
        if (findTransitionByClipPair(track, fromClip.id, toClip.id)) continue;

        const addableDuration = getAddableTransitionDuration(track, fromClip.id, toClip.id);
        if (addableDuration <= 0) continue;

        candidateTransitions.push({
          id: generateId(),
          fromClipId: fromClip.id,
          toClipId: toClip.id,
          type: TRANSITION_TYPE_FADE,
          duration: Math.min(defaultDuration, addableDuration, MAX_TRANSITION_DURATION),
        });
      }

      addedCount = candidateTransitions.length;
      if (addedCount === 0) return prev;

      return prev.map(t =>
        t.id === trackId
          ? { ...t, transitions: [...(t.transitions ?? []), ...candidateTransitions] }
          : t
      );
    });

    if (addedCount > 0) {
      message.success(`已为 ${addedCount} 个切点添加淡变转场`);
    } else {
      message.info('所有切点已有转场');
    }
  }, [message, updateTracks, defaultDuration]);

  const handleDeleteAllTransitions = useCallback((trackId: string) => {
    isUserDeletingRef.current = true;

    updateTracks((prev) => {
      const track = prev.find(t => t.id === trackId);
      const count = track?.transitions?.length ?? 0;
      if (count === 0) return prev;

      queueMicrotask(() => {
        message.success(`已清除全部 ${count} 个转场`);
      });

      return prev.map(t =>
        t.id === trackId ? { ...t, transitions: [] } : t
      );
    });

    if (selectedTransitionIdRef.current) {
      setSelectedTransitionId(null);
    }
  }, [message, updateTracks, setSelectedTransitionId, isUserDeletingRef]);

  return {
    handleSelectTransition,
    handleAddTransition,
    handleUpdateTransitionDuration,
    handleDeleteTransition,
    handleAddAllTransitions,
    handleDeleteAllTransitions,
  };
}
