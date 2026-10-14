# Frontend (React 19 + TypeScript)

`main.tsx` renders `App` (main window) or `Hud` (`?hud=1`, the floating HUD window). Features live in `features/`, shared UI in `components/`, pure logic in `library.ts` and `services.ts` (unit-tested in `tests/`).

## React

- Function components and hooks only; no state library. App-wide state stays in `App.tsx`, feature state in its component.
- Effects need stable dependencies: derive a string/id key instead of depending on arrays that are recreated on every scan (see `useCategories`).
- Async work must not restart when the language changes: read the translator through `tRef.current` instead of listing `t` as a dependency.
- Backend data goes through TanStack Query (`QueryClient` in `main.tsx`): `useQuery(commandQuery<T>("command", args))` for reads, `refetchInterval` for polling, `staleTime` for cache, and `useMutation` for writes that `invalidateQueries` what they change. Map failures with `queryError(query.error)`. Don't hand-roll `alive`/`setTimeout` loops or busy refs.
- The library scan and Steam owned games still use manual effects in `App.tsx`; move them to queries when you touch them.

## Controller-first UI

- Every action must be reachable with the gamepad: `useInput` actions, `navigateSpatial` / `navigateControls`, `useFeatureInput` for pages and dialogs. Never rely on hover. Test new UI with the controller before touch; the controller is the primary input.
- Native `<select>` dropdowns can't be opened by the controller (the gamepad click isn't a user activation). `navigateSpatial` / `navigateControls` make A and RB step to the next option and LB to the previous; prefer buttons or segmented controls for new choices.
- Set focus on purpose: `data-initial-focus` in dialogs, move focus to the trigger before unmounting a focused element.
- View + Start is reserved for the native HUD toggle; `useInput` fires View/Start on release so the chord doesn't trigger them.

## Text, errors and accessibility

- All UI text goes through `t(key)`; add the key to all three dictionaries in `i18n.ts` (the `Dict` type enforces it). Brand names (Steam, CPU Boost) are the only literals.
- Backend errors are i18n keys. Map them with `serviceError(e, known?)`, which returns a typed `MessageKey`; never show raw error text (it can contain URLs or tokens). Store errors as `MessageKey | ""`.
- Call the backend through `desktop<T>(command, args)`; it throws `desktopRequired` in the browser preview. `?demo` gives a demo library in dev.
- Icon-only buttons need `aria-label`; status messages use `role="status"`; toggles and selections use `aria-pressed` / `aria-expanded` (CSS styles off those attributes).

## Tooling

- Biome lints and formats (`npm run lint`, `npm run format`). Fix findings; when a rule is wrong for a line, suppress it there with `biome-ignore <rule>: <reason>`.
- Each window is code-split (`lazy` in `main.tsx`): keep the HUD free of main-window imports.

## CSS

- One stylesheet, `App.css`. Reuse `--accent` and `--muted`; HUD rules are scoped under `.floating-hud`.
- When you remove a component, remove its rules too, including copies inside `@media` blocks. Class names that are substrings of others (`account-connect` vs `library-account-connected`) need an exact search.
