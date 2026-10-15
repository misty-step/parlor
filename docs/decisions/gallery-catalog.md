# Gallery catalog and live Kindred game

Status: accepted for implementation, 2026-10-14. Owner direction: Kaylee on task t_4c69e952.

## Decision

`apps/site/src/data/games.json` is the only advertised-game catalog. The homepage, featured game and footer consume it. README and guides point to the gallery instead of copying Play and Source URLs. Add and change games there, including both links.

Linejam uses its current Misty Step deployment; the retired external domain is no longer a visitor destination.

Keep Kindred because its party-game deployment is live, following Kaylee's instruction to link a live deployment or otherwise delist. The main Kindred hostname now serves a different product (family-tree); HTTP 200 alone is not game identity proof. The catalog therefore points to the verified **legacy party-game deployment** and explicitly to **kindred-game-legacy**, its archived source, instead of the renamed repository redirect. The archived repository does not imply an active maintenance commitment. Browser verification must show the same-brain game's Start/Join screen before shipping.

## Check and limits

`pnpm check:gallery-links` GETs every Play and Source link, follows redirects, requires HTTP 200, and fails nonzero on DNS, TLS, timeout or HTTP failure. It is separate from offline/deterministic `pnpm check:all`. The dedicated Gallery links workflow runs on every PR, master push, manual dispatch and every six hours. Failures include the game, link kind and URL in red annotations and the job summary. Existing fleet GitHub alarm intake owns loud incident routing; this repository does not add another notification service.

Availability checks cannot establish game identity, backend readiness or ownership of a domain that later changes hands. Review the destination in a real browser when changing a catalog link. The isolated DNS mutation is verification evidence, not a production outage drill.

CD remains owned by the existing Parlor CD card t_36b0ba90; this decision adds no competing deploy workflow and does not change credentials, DNS or registrars.
