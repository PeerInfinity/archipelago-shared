# archipelago-shared

Shared JavaScript utilities used by [Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC) and its substrate modules.

This repository is consumed as a git submodule at `frontend/modules/shared/` in the parent Archipelago-CC tree.

**AI disclosure:** The code and documentation in this repository are predominantly AI-generated, written with [Claude Code](https://claude.ai/code), as part of the [Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC) project.

## Contents

Utilities here are deliberately small, dependency-free where possible, and designed to work both inside the host frontend and inside standalone substrate iframes. Notable modules:

- `ruleEngine.js`, `snapshotInterface.js` — rule evaluation against state snapshots
- `sharedLogger.js`, `loggerService.js` — logging that works in both host and iframe contexts
- `adapterClient.js`, `communicationProtocol.js` — host↔iframe postMessage protocol
- `procgen/` — procedural generation primitives shared between substrates
- `gameLogic/` — per-game helper functions; `gameLogicRegistry.js` is the registry of game-specific logic

## History

This repository was extracted from [Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC) using `git filter-repo` on its `procgen` branch. Per-file history is preserved.
