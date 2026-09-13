import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  destroyMock,
  onMock,
  pauseMock,
  playerConstructorMock,
} = vi.hoisted(() => {
  const destroy = vi.fn();
  const on = vi.fn();
  const pause = vi.fn();
  return {
    destroyMock: destroy,
    onMock: on,
    pauseMock: pause,
    playerConstructorMock: vi.fn(() => ({
      destroy,
      on,
      pause,
      currentTime: 0,
    })),
  };
});

vi.mock('xgplayer', () => ({
  default: playerConstructorMock,
}));

vi.mock('../../services/electronService', () => ({
  electronService: {
    fs: {
      toLocalUrl: (value: string) => {
        const normalized = value.replace(/\\/g, '/');
        const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
        return `koma-local://files${withSlash}`;
      },
    },
  },
}));

vi.mock('../../store/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { StagePlayer } from './StagePlayer';

describe('StagePlayer', () => {
  beforeEach(() => {
    playerConstructorMock.mockClear();
    destroyMock.mockClear();
    onMock.mockClear();
    pauseMock.mockClear();
  });

  it('uses native video for local koma-local media sources', () => {
    const onTimeUpdate = vi.fn();
    const onEnded = vi.fn();

    render(
      <StagePlayer
        source="/tmp/example.mp4"
        poster="/tmp/poster.png"
        autoPlay
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    );

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('koma-local://files/tmp/example.mp4');
    expect(video?.getAttribute('poster')).toBe('koma-local://files/tmp/poster.png');
    expect(playerConstructorMock).not.toHaveBeenCalled();

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 2.5 });
    fireEvent.timeUpdate(video!);
    fireEvent.ended(video!);

    expect(onTimeUpdate).toHaveBeenCalledWith(2.5);
    expect(onEnded).toHaveBeenCalled();
  });

  it('keeps xgplayer for remote media sources', () => {
    render(
      <StagePlayer source="https://cdn.example.com/video.mp4" />
    );

    expect(playerConstructorMock).toHaveBeenCalledTimes(1);
    expect(playerConstructorMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.com/video.mp4',
      controls: true,
      videoInit: true,
    }));
    expect(document.querySelector('video')).toBeFalsy();
  });

  it('prefers local videoPath over remote videoUrl when both are provided', () => {
    render(
      <StagePlayer
        videoPath="/tmp/local-video.mp4"
        videoUrl="https://cdn.example.com/video.mp4"
      />
    );

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('koma-local://files/tmp/local-video.mp4');
    expect(playerConstructorMock).not.toHaveBeenCalled();
  });
});
