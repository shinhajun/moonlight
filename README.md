# Moonlight

Sell the models running on your own computer. Buyers call one OpenAI-compatible (and System-1 `systemone`) API; Moonlight routes each call to a seller's machine, meters it, pays the seller, and verifies that the seller really runs the model they listed.

- `gateway/`: public API, seller WebSocket, routing, metering, ledger, verification (runs on GCE)
- `agent/`: seller CLI that connects local Ollama / Laya to the network
- `laya-runner/`: serves the open Laya decision model locally on `/v1/systemone`
- `web/`: marketplace, playground, buyer and seller dashboards

See [PROTOCOL.md](PROTOCOL.md) for the contract between the parts.
