## [Unreleased]

### Added

- Schema migration framework: `migrateTimelineData` with version-based routing (v0→v1), applied on both `loadTimeline` and `loadEpisodeTimeline` paths.
- Migration fixture tests (14 cases): version detection, v0→v1 legacy conversion, corrupted data filtering, edge cases.
- Export rendering regression tests: non-transition region full opacity, no-transition track full opacity.
- Capability stability tests: empty transitions, plain clips, mixed features classification, pure transition project.
- Phase 3 evaluation document (`docs/transition-phase3-evaluation.md`): Gate E/F/G status, new effects feasibility, pre-research boundary conditions.

### Fixed

- `validateTransitions` non-video track early return now includes `clampedIds` field, fixing TS2741.
- `useAutoSave.ts` and `manju.ts` replaced phantom `Timeline` type with real `TimelineData`.
- `saveTimeline` ensures `version` field before writing (fallback to `CURRENT_TIMELINE_VERSION`).
- Test fixture `ClipTransition` property corrected from `type` to `effectId`.

### Changed

- `loadTimeline` and `loadEpisodeTimeline` now run `migrateTimelineData` on load, ensuring old project files are automatically migrated.
- `saveTimeline` parameter type corrected from phantom `Timeline` to `TimelineData`.
- `store/project/index.ts` re-exports `TimelineData` instead of non-existent `Timeline` type.
- Refined Phase 2 transition workflow: extracted overlay and handlers, aligned resolver constraints, and improved drag/cleanup behavior for transition-heavy timeline editing.
- Added focused transition regression coverage for resolver, overlay, export compatibility, and bulk add/delete handlers to protect the Phase 2 review fixes.
