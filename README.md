# SQ Vault

A self custody wallet Swissquote could launch for its clients. Built for the Swissquote track of the BSA EPFL Hackathon 2026.

Your keys, your control, one tap from your Swissquote account.

**Live demo:** https://rayenanane1.github.io/sq-vault/
**Network:** Base Sepolia testnet

## What it does

| Lifecycle step | How it works | Status |
|---|---|---|
| Create | A passkey (Face ID, Touch ID, Windows Hello) is created in the device secure enclave. It becomes the owner of an ERC 4337 smart account (Coinbase Smart Wallet v1.1). No seed phrase. | Real |
| Authenticate | Every signature needs a biometric check. The P256 passkey signature is verified on chain by the wallet contract (WebAuthn). | Real |
| Sign and send | USDC and ETH transfers as UserOperations through a bundler. | Real, on chain |
| Gasless | A paymaster pays the network fee, so the client sends USDC without owning ETH. | Real (Pimlico paymaster, needs an API key) |
| Lose access | The device is gone. Funds stay in the smart account on chain. | Simulated loss |
| Recover | 2 of 3 guardians (Swissquote, a trusted contact, an offline recovery kit) approve a new passkey. A security delay (48 h in production) starts. The real owner can cancel at any moment. After the delay the new passkey is added as owner. | Real, on chain |
| Compliance | Sanctions screening, dApp allowlist, calldata decoding (unlimited approvals blocked), simulation before signing, step up confirmation and beneficiary declaration above a limit. | Real logic, mocked data sources |
| Ownership proof | The client signs a declaration with the wallet. Swissquote verifies it on chain (ERC 1271 or ERC 6492) before allowing withdrawals to it. | Real |

## Custody model

Non custodial. Only the client's passkeys can sign transactions.

| Who | Holds | Can do | Cannot do |
|---|---|---|---|
| Client device | P256 passkey in the secure enclave | Sign any transaction, cancel a recovery, remove lost devices, change guardians | |
| Swissquote | One guardian key (HSM in production) | Approve a recovery after video identification, sponsor fees, screen transactions in the app | Move funds, sign payments, recover alone, skip the delay |
| Trusted contact | One guardian key on their phone | Approve a recovery | Same limits as Swissquote |
| Recovery kit | 12 words offline, one guardian key | Approve a recovery | Same limits |
| Recovery module | Owner slot on the wallet | Add a new passkey after 2 approvals and the delay | Anything else. Its code has a single path that calls the wallet. |

Swissquote has no power of disposal over client assets. This is the basis for the wallet being non custodial.

## Architecture

```
 Client device                         Base Sepolia
 ┌───────────────────────────┐         ┌──────────────────────────────────────┐
 │ Web app (React, viem)     │  UserOp │ EntryPoint v0.6                      │
 │  passkey in secure enclave├────────►│  └─ Coinbase Smart Wallet (proxy)    │
 │  compliance engine        │ Pimlico │       owners: passkey(s), module     │
 └───────────────────────────┘ bundler │  SQRecoveryModule (CREATE2, shared)  │
                               +paymstr│       guardians, threshold, delay    │
 Guardians sign EIP 191 approvals      │  USDC (Circle)                       │
 (Swissquote HSM, contact, kit) ──────►└──────────────────────────────────────┘
```

* `contracts/src/SQRecoveryModule.sol` holds the recovery logic. One shared deployment at a deterministic CREATE2 address. The first wallet that activates deploys it in its setup batch.
* Guardians sign `keccak256(module, chainId, wallet, newX, newY, nonce)`. Approvals are bound to one wallet, one new key and one nonce. They cannot be replayed or reused for another key.
* `initiateRecovery` checks 2 distinct guardian signatures and starts the delay. `cancelRecovery` can only be called by the wallet itself, so only a holder of a current passkey can veto. `executeRecovery` adds the new passkey after the delay.

## Threat model

| Threat | Mitigation |
|---|---|
| Stolen phone | Passkey needs biometrics or device PIN. The thief cannot sign. |
| Stolen phone and hacked email | Email is not a guardian. Recovery needs Swissquote video identification plus the contact or the kit. |
| Attacker convinces 2 guardians | 48 h delay with alerts on the old device. The owner cancels. |
| Rogue Swissquote employee or hacked Swissquote | Swissquote is 1 of 3 and cannot sign payments. Its approval alone does nothing. |
| Phishing dApp or wallet drainer | dApp allowlist, unlimited approvals blocked, simulation before signing. |
| Sending to sanctioned addresses | Screening before signing. |
| Replay of old guardian approvals | Nonce in the signed message, bumped on every initiation and guardian change. |
| Lost phone and owner wants the old key gone | After recovery, the new device removes the lost passkey from the wallet. |
| Bug in the module | Single purpose contract, 11 Foundry tests against the real Coinbase Smart Wallet code. Production would need an audit. |

## Swiss regulatory notes

* Non custodial design. Swissquote never holds a key that can move funds, so the wallet assets are not held in custody by the bank. This needs confirmation by legal counsel and FINMA.
* Travel rule. For transfers between a Swissquote account and an external wallet, Swiss practice asks the institution to verify that the client owns that wallet. The app does this with a signed declaration checked on chain.
* Sanctions screening and beneficiary declaration for larger transfers are built in the app flow. The data providers are mocked.

## What is mocked

Clearly separated from the real parts:

* Swissquote core banking (client record, CHF balance) and the login during recovery. `src/lib/bank.ts`
* The Swissquote guardian HSM and the video identification. The back office at `#/bank` uses a key stored in the browser.
* The trusted contact's phone. The guardian app at `#/guardian` uses a key stored in the browser.
* The recovery coordination server. Requests live in browser storage.
* Sanctions list and dApp review. `src/lib/compliance.ts`
* Security delay is 120 seconds in the demo, 48 hours in production (configurable in Settings).

## Run it

```bash
npm install
npm run dev            # http://localhost:5173 (passkeys work on localhost)
```

Optional, for gasless transfers: get a free key at https://dashboard.pimlico.io and paste it in Settings, or set `VITE_PIMLICO_API_KEY`.

Test USDC: https://faucet.circle.com (Base Sepolia).

Contracts:

```bash
./scripts/setup-foundry.sh
cd contracts && forge test
npm run compile:contracts   # regenerates src/lib/recoveryArtifact.ts
```

## Stack

React, Vite, TypeScript, viem account abstraction, permissionless (Pimlico), Coinbase Smart Wallet v1.1, OpenZeppelin ECDSA, Foundry. No custom cryptography.
