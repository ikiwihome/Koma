import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AssetImageDrawModal, {
  generateImageDrawCandidates,
  getImageDrawVariation,
  type AssetImageDrawCandidate,
  type AssetImageDrawIdentitySpec,
  type AssetImageDrawVariation,
} from './AssetImageDrawModal';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const index = params?.index ?? '';
      const current = params?.current ?? '';
      const total = params?.total ?? '';
      const translations: Record<string, string> = {
        'asset.imageDrawTitle': 'Choose an image candidate',
        'asset.imageDrawHint': 'Choose a candidate.',
        'asset.imageCandidatePreviewHint': 'Click a candidate to select it; use Preview for the large image.',
        'asset.imageCandidateSelectAlt': `Select image candidate ${index}`,
        'asset.imageCandidatePreviewAlt': `Preview image candidate ${index}`,
        'asset.imageCandidateAlt': `Image candidate ${index}`,
        'asset.imageCandidatePreviewTitle': 'Image candidate preview',
        'asset.characterDirectionSelectAlt': `Select character direction ${index}`,
        'asset.characterDirectionPreviewAlt': `Preview character direction ${index}`,
        'asset.characterDirectionAlt': `Character direction ${index}`,
        'asset.characterDirectionCardTitle': `Character direction ${current}/${total}`,
        'asset.previewImage': 'Preview',
        'asset.drawImageCandidates': 'Generating 9 image candidates...',
        'asset.drawCharacterDirections': 'Drawing 9 character directions...',
        'asset.noImageCandidates': 'No image candidates',
        'asset.redrawCandidates': 'Redraw 9 candidates',
        'asset.useSelectedImage': 'Use selected image',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
      };
      return translations[key] ?? key;
    },
  }),
}));

beforeAll(() => {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: (element: Element) => originalGetComputedStyle(element),
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
});

afterEach(() => {
  cleanup();
});

const IDENTITY_SPEC_SHAPE = {
  faceShape: expect.any(String),
  eyes: expect.any(String),
  browsNoseMouth: expect.any(String),
  jawline: expect.any(String),
  apparentAge: expect.any(String),
  temperament: expect.any(String),
  hairlineAndSilhouette: expect.any(String),
};

function expectCharacterIdentityVariation(variation: AssetImageDrawVariation): void {
  expect(variation.identityDirection).toBeTruthy();
  expect(variation.identitySpec).toEqual(expect.objectContaining(IDENTITY_SPEC_SHAPE));
  expect(variation.prompt).toContain('Character identity direction candidate');
  expect(variation.prompt).toContain('Keep the exact same story role');
  expect(variation.prompt).toContain('structured gender and age lock');
  expect(variation.prompt).toContain('must stay inside the locked gender and age class');
  expect(variation.prompt).toContain('Do not change the profession');
}

describe('asset image draw character identity metadata', () => {
  it('defines 9 distinct character identity directions with identity specs', () => {
    const variations = Array.from({ length: 9 }, (_, index) => getImageDrawVariation('character', index));

    expect(new Set(variations.map((variation) => variation.label)).size).toBe(9);
    expect(new Set(variations.map((variation) => variation.identityDirection)).size).toBe(9);

    for (const variation of variations) {
      expectCharacterIdentityVariation(variation);
    }
  });

  it('persists variation prompt and identity metadata on generated candidates', async () => {
    const identitySpec: AssetImageDrawIdentitySpec = {
      faceShape: 'oval test face',
      eyes: 'sharp test eyes',
      browsNoseMouth: 'test brows nose mouth',
      jawline: 'test jawline',
      apparentAge: 'test age range',
      temperament: 'test temperament',
      hairlineAndSilhouette: 'test hairline silhouette',
    };

    const result = await generateImageDrawCandidates({
      count: 1,
      sessionId: 'draw_character_char-1_session',
      ownerType: 'character',
      ownerId: 'char-1',
      projectId: 'project-1',
      getCandidatePath: async (seed, index) => `/tmp/candidate-${index}-${seed}.png`,
      getVariation: () => ({
        label: 'Test Direction',
        prompt: 'Test variation prompt',
        identityDirection: 'test_direction',
        identitySpec,
        metadata: { candidateKind: 'characterIdentityDirection' },
      }),
      generate: async (_seed, _index, destPath) => ({
        success: true,
        path: destPath,
      }),
    });

    expect(result.failed).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      variationLabel: 'Test Direction',
      variationPrompt: 'Test variation prompt',
      identityDirection: 'test_direction',
      identitySpec,
      metadata: { candidateKind: 'characterIdentityDirection' },
    }));
  });
});

describe('asset image draw batch generation helper', () => {
  it('character candidates request one 9-image batch and skip single generation when batch succeeds', async () => {
    const generate = vi.fn();
    const generateBatch = vi.fn(async ({ batchSize, seeds, destPaths, variations }: {
      batchSize: number;
      seeds: number[];
      destPaths: string[];
      variations: Array<AssetImageDrawVariation | undefined>;
    }) => {
      expect(batchSize).toBe(9);
      expect(seeds).toHaveLength(9);
      expect(destPaths).toHaveLength(9);
      expect(variations).toHaveLength(9);
      return destPaths.map((destPath, index) => ({
        success: true,
        path: destPath,
        index,
      }));
    });

    const result = await generateImageDrawCandidates({
      count: 9,
      sessionId: 'draw_character_char-1_session',
      ownerType: 'character',
      ownerId: 'char-1',
      projectId: 'project-1',
      getCandidatePath: async (seed, index) => `/tmp/candidate-${index}-${seed}.png`,
      getVariation: (index) => ({
        label: `Variation ${index + 1}`,
        prompt: `Variation prompt ${index + 1}`,
      }),
      generate,
      generateBatch,
    });

    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.candidates).toHaveLength(9);
  });

  it('retries missing batch outputs with a follow-up batch before using single generation', async () => {
    const generate = vi.fn(async (seed: number, index: number, destPath: string) => ({
      success: true,
      path: `${destPath}-single-${seed}-${index}`,
    }));
    let batchCallCount = 0;
    const generateBatch = vi.fn(async ({
      startIndex,
      batchSize,
      seeds,
      destPaths,
      variations,
    }: {
      startIndex: number;
      batchSize: number;
      seeds: number[];
      destPaths: string[];
      variations: Array<AssetImageDrawVariation | undefined>;
    }) => {
      batchCallCount += 1;
      expect(seeds).toHaveLength(batchSize);
      expect(destPaths).toHaveLength(batchSize);
      expect(variations).toHaveLength(batchSize);

      if (batchCallCount === 1) {
        expect(startIndex).toBe(0);
        expect(batchSize).toBe(3);
        return [
          {
            success: true,
            path: `${destPaths[0]}-batch-0`,
            index: 0,
          },
          {
            success: true,
            path: `${destPaths[1]}-batch-1`,
            index: 1,
          },
        ];
      }

      expect(startIndex).toBe(2);
      expect(batchSize).toBe(1);
      return [
        {
          success: true,
          path: `${destPaths[0]}-batch-retry-2`,
          index: startIndex,
        },
      ];
    });

    const result = await generateImageDrawCandidates({
      count: 3,
      sessionId: 'draw_character_char-1_session',
      ownerType: 'character',
      ownerId: 'char-1',
      projectId: 'project-1',
      getCandidatePath: async (seed, index) => `/tmp/candidate-${index}-${seed}.png`,
      generate,
      generateBatch,
    });

    expect(generateBatch).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[2].localPath).toContain('-batch-retry-2');
  });

  it('retries the 9th invalid batch result with a one-image batch when validator rejects it', async () => {
    const generate = vi.fn(async (seed: number, index: number, destPath: string) => ({
      success: true,
      path: `${destPath}-single-${seed}-${index}`,
    }));
    let batchCallCount = 0;
    const generateBatch = vi.fn(async ({
      startIndex,
      batchSize,
      seeds,
      destPaths,
      variations,
    }: {
      startIndex: number;
      batchSize: number;
      seeds: number[];
      destPaths: string[];
      variations: Array<AssetImageDrawVariation | undefined>;
    }) => {
      batchCallCount += 1;
      expect(seeds).toHaveLength(batchSize);
      expect(destPaths).toHaveLength(batchSize);
      expect(variations).toHaveLength(batchSize);

      if (batchCallCount === 1) {
        expect(startIndex).toBe(0);
        expect(batchSize).toBe(9);
        return destPaths.map((destPath, index) => ({
          success: true,
          path: `${destPath}-batch-initial-${index}`,
          index,
        }));
      }

      expect(startIndex).toBe(8);
      expect(batchSize).toBe(1);
      expect(variations[0]).toEqual(expect.objectContaining({ label: 'Variation 9' }));
      return [
        {
          success: true,
          path: `${destPaths[0]}-batch-retry-8`,
          index: startIndex,
        },
      ];
    });
    const validateCandidateResult = vi.fn(async ({ index, phase, result }: {
      index: number;
      phase: 'batch' | 'single';
      result: { path?: string };
    }) => {
      if (phase === 'batch' && index === 8 && result.path?.includes('-batch-initial-8')) {
        return 'Detected likely visual noise/static output';
      }
      return true;
    });

    const result = await generateImageDrawCandidates({
      count: 9,
      sessionId: 'draw_character_char-1_session',
      ownerType: 'character',
      ownerId: 'char-1',
      projectId: 'project-1',
      getCandidatePath: async (seed, index) => `/tmp/candidate-${index}-${seed}.png`,
      getVariation: (index) => ({
        label: `Variation ${index + 1}`,
        prompt: `Variation prompt ${index + 1}`,
      }),
      generate,
      generateBatch,
      validateCandidateResult,
    });

    expect(generateBatch).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(validateCandidateResult).toHaveBeenCalledTimes(10);
    expect(result.failed).toBe(0);
    expect(result.candidates).toHaveLength(9);
    expect(result.candidates[8].localPath).toContain('-batch-retry-8');
  });
});

describe('AssetImageDrawModal interactions', () => {
  const candidates: AssetImageDrawCandidate[] = [
    {
      id: 'candidate-1',
      sessionId: 'session-1',
      ownerType: 'scene',
      ownerId: 'scene-1',
      localPath: 'candidate-1.png',
      seed: 101,
    },
    {
      id: 'candidate-2',
      sessionId: 'session-1',
      ownerType: 'scene',
      ownerId: 'scene-1',
      localPath: 'candidate-2.png',
      seed: 202,
    },
  ];

  it('keeps selection and preview separate while showing redraw progress over existing candidates', () => {
    const onUseSelected = vi.fn();
    const baseProps = {
      open: true,
      candidates,
      onCancel: vi.fn(),
      onRedraw: vi.fn(),
      onUseSelected,
    };

    const { rerender } = render(React.createElement(AssetImageDrawModal, {
      ...baseProps,
      generating: true,
      progress: 33,
      progressStep: 'Drawing 3/9 · Calling TTI service...',
    }));

    expect(screen.getByRole('status')).toHaveTextContent('Drawing 3/9 · Calling TTI service...');
    expect(screen.getByRole('status')).toHaveTextContent('33%');

    rerender(React.createElement(AssetImageDrawModal, {
      ...baseProps,
      generating: false,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Select image candidate 2' }));
    expect(screen.queryByText('Image candidate preview')).not.toBeInTheDocument();

    const previewButton = screen.getByRole('button', { name: 'Preview image candidate 1' });
    fireEvent.click(previewButton);

    expect(screen.getByText('Image candidate preview')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use selected image' }));

    expect(onUseSelected).toHaveBeenCalledTimes(1);
    expect(onUseSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'candidate-2' }));
  });
});
