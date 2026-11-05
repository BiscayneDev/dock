# Independent maintenance candidate

Source-only worker and systemd unit, not installed or enabled. Controller endpoint
must be separately activated with exact lifecycle grants, retained-instance IDs,
and durable cleanup deadlines. A maintenance-only secret is not a provider key
or create credential. The worker runs outside every execution workload.

Worker calls only the fixed HTTPS maintenance endpoint every30seconds, refuses
redirects and requires a fresh successful durable maintenance receipt. Endpoint
runs cleanup before result reconciliation. Heartbeat persistence failure is an
unconfirmed sweep, not cleanup success. Worker failure/unresolved deletions emit
an alert for the supervisor. Service restart is configured, not evidence of a
running independent supervisor.

Deployment must supply an independent missing-heartbeat alert and prove it fires
when this service stops and when Dock cannot persist receipts. Stdout/stderr are
not that alert by themselves. No live cleanup guarantee is claimed until those
checks and exact lifecycle authorization are in place. A controller or database
outage can still prevent deletion; do not sell the cadence as a provider hard
spend cap. Retained phone remains protected by the endpoint's explicit list.
