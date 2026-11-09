#!/usr/bin/env bash
# No production secrets, network integrations or persistent volumes.
set -euo pipefail
name="hawk-smoke-${RANDOM}-${RANDOM}"
# shellcheck disable=SC2329
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
key=$(printf '%s' '{"type":"service_account","client_email":"fixture@example.invalid","private_key":"fixture"}' | base64 | tr -d '\n')
args=(-e HAWK_SUITE_TRUST_PROXY=true -e HAWK_SUITE_TEAM_ID=TFIXTURE -e HAWK_SUITE_ISSUER=https://apps.fixture.example.org/
      -e SLACK_SIGNING_SECRET=fixture -e SLACK_CLIENT_ID=fixture -e SLACK_CLIENT_SECRET=fixture
      -e SLACK_STATE_SECRET=fixture-state-secret -e PUBLIC_URL=https://fixture.example.org
      -e TOKEN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      -e "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=$key" -e ONSHAPE_ACCESS_KEY=fixture
      -e ONSHAPE_SECRET_KEY=fixture -e APP_URL=https://fixture.example.org)
docker run --rm --network none "${args[@]}" --entrypoint node "$IMAGE" scripts/deploy-check.mjs
docker run -d --name "$name" --network none "${args[@]}" "$IMAGE" >/dev/null
for _attempt in $(seq 1 60); do
  state=$(docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$name")
  if [[ $state == 'running healthy' ]]; then exit 0; fi
  if [[ $state == exited* || $state == dead* ]]; then break; fi
  sleep 2
done
docker logs --tail=40 "$name"
echo 'Candidate image failed readiness' >&2
exit 1
