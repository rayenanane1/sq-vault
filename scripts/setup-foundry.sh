#!/usr/bin/env bash
# Fetches the Coinbase Smart Wallet sources used by the Foundry tests.
set -e
cd "$(dirname "$0")/../contracts"
if [ ! -d lib/smart-wallet ]; then
  git clone --depth 1 https://github.com/coinbase/smart-wallet lib/smart-wallet
  (cd lib/smart-wallet && git submodule update --init --depth 1 lib/solady lib/account-abstraction lib/webauthn-sol lib/forge-std lib/openzeppelin-contracts && cd lib/webauthn-sol && git submodule update --init --depth 1)
fi
echo "Run: cd contracts && forge test"
