import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Agent worktrees live at .claude/worktrees/<id>/ inside this repo, each a
    // full checkout with its own tests/. Without this, `npm test` collects every
    // worktree's suite as well as this one — 1484 tests instead of 306, failing
    // on whichever branch happens to disagree with this one about the registry.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
