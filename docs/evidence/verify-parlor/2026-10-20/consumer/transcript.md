# verify-parlor consumer

- feature: consumer
- startedAt: 2026-10-20T22:32:44.519Z
- head: 443991cb548865d2ba9460422b78ac08683936e3
- dirty: false
- target: this checkout's source packages
- result: PASS

| Step | Result | Observed |
| --- | --- | --- |
| build the source packages | PASS | pnpm build:packages exit 0 |
| generated consumer on a real local Convex backend | PASS | ok on precompiled-2026-08-25-7cce8fb; proved 9: verified guest identity; idempotent join; atomic game/match composition; immutable roster and late-join rematch; same-player token renewal; deadline enforcement before sweeping; rejected completion leaves game score unchanged; registered scheduled abandonment; room closure |
| import the skill into a game with a pinned vendor checkout | PASS | SKILL.md, reference.md, SOURCE.json pinned to 443991c; re-import 'Unchanged' |
| importer refuses the Parlor repository itself | PASS | refused with 'Choose a consuming game repository…' |
