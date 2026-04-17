# Contributing

## Where to start
- Product/architecture overview: `index.md`
- Protocol and timing constraints: `protocol.md`

## Documentation rules (this repo)
- Keep `README.md` marketing-focused: what it is, current status, quick start, links.
- Keep `architecture.md` high-level; put deep dives in `architecture/`.
- Keep raw protocol notes and captures in `protocol.md` and `scan_result.md`.
- Naming: use **Action** for pose timelines, and **Routine** for Blockly procedures/functions.

## Recommended workflow
- For protocol changes: add/adjust a probe in `../probe/` first, then update `../jimu/`, then update docs.
- When adding a new capability, document:
  - command bytes + payload format
  - timing/backpressure behavior
  - example usage in SDK + app
