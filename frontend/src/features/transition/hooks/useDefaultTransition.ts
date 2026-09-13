import { useState, useEffect } from 'react';
import { DEFAULT_TRANSITION_DURATION } from '../core/constants';

const STORAGE_KEY = 'koma-default-transition-duration';

export function useDefaultTransition() {
  const [defaultDuration, setDefaultDuration] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : DEFAULT_TRANSITION_DURATION;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(defaultDuration));
  }, [defaultDuration]);

  return { defaultDuration, setDefaultDuration };
}
