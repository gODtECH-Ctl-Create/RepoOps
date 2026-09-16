# Pull request timing

`src/core/pr-timing.mjs` provides a pure helper for PR queue/reporting features. It consumes explicit state-transition timestamps and does not call GitHub.

## Timers

- **Review age** starts when the PR enters `waiting-for-review` or `ready-for-maintainer` and resets when it enters an author-waiting state, `blocked`, `waiting-for-ci`, or `unknown`.
- **Author wait age** starts when the PR enters `waiting-for-author` or `changes-requested` and resets when it enters a maintainer-waiting state, `blocked`, `waiting-for-ci`, or `unknown`.
- **Maintainer response latency** is the duration from a maintainer-waiting state to the next author-waiting state.
- **Author response latency** is the duration from an author-waiting state to the next maintainer-waiting state.

The helper normalizes timestamps through `Date` and returns durations in milliseconds. Callers should supply GitHub timestamps directly; calculations are therefore based on UTC instants rather than local timezone settings.

Malformed event timestamps are ignored. A malformed observation timestamp produces safe null timing values instead of throwing.

The returned shape is intentionally reusable by PR classifiers and queue features:

```js
{
  currentState,
  currentStateSince,
  reviewAge,
  authorWaitAge,
  responseLatency: {
    maintainer: { milliseconds, startedAt, endedAt } | null,
    author: { milliseconds, startedAt, endedAt } | null
  },
  invalidNow
}
```
