#!/usr/bin/env bash
# Phase F2 deployer.
#
# The public Arbitrum Sepolia RPC is non-archive: forge script's pre-flight
# tries to read account state at older blocks and fails with "missing trie
# node". We sidestep that by using forge create per contract — direct, no
# fork simulation.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "[deploy-f2] .env not found. Run 'pnpm exec tsx tools/genkey.ts' first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY missing in .env}"
: "${ARB_SEPOLIA_RPC_URL:=https://sepolia-rollup.arbitrum.io/rpc}"

DEPLOYER=$(cast wallet address "$DEPLOYER_PRIVATE_KEY")
echo "[deploy-f2] Deployer: $DEPLOYER"
echo "[deploy-f2] RPC:      $ARB_SEPOLIA_RPC_URL"

cd contracts

# Fresh-build first so verification can pin the same compiled artifacts.
forge build

VERIFIER_FLAGS=(--verify --verifier blockscout --verifier-url 'https://arbitrum-sepolia.blockscout.com/api/')

echo
echo "[deploy-f2] Deploying TestUSDC..."
TESTUSDC_OUT=$(forge create src/TestUSDC.sol:TestUSDC \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$DEPLOYER" \
  "${VERIFIER_FLAGS[@]}" \
  --json 2>&1)
echo "$TESTUSDC_OUT"
TESTUSDC_ADDR=$(echo "$TESTUSDC_OUT" | grep -oE '"deployedTo":"0x[0-9a-fA-F]+"' | head -1 | cut -d'"' -f4)

if [[ -z "$TESTUSDC_ADDR" ]]; then
  echo "[deploy-f2] FATAL: could not parse TestUSDC address" >&2
  exit 1
fi
echo "[deploy-f2] TestUSDC: $TESTUSDC_ADDR"

echo
echo "[deploy-f2] Deploying ConfidentialUSDC..."
CUSDC_OUT=$(forge create src/ConfidentialUSDC.sol:ConfidentialUSDC \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$TESTUSDC_ADDR" "Confidential tUSDC" "ctUSDC" \
  "${VERIFIER_FLAGS[@]}" \
  --json 2>&1)
echo "$TESTUSDC_OUT"
CUSDC_ADDR=$(echo "$CUSDC_OUT" | grep -oE '"deployedTo":"0x[0-9a-fA-F]+"' | head -1 | cut -d'"' -f4)

if [[ -z "$CUSDC_ADDR" ]]; then
  echo "[deploy-f2] FATAL: could not parse ConfidentialUSDC address" >&2
  exit 1
fi
echo "[deploy-f2] ConfidentialUSDC: $CUSDC_ADDR"

echo
echo "[deploy-f2] Writing deployments/arb-sepolia.json..."
TS=$(date +%s)
mkdir -p deployments
cat > deployments/arb-sepolia.json <<EOF
{
  "chainId": 421614,
  "contracts": {
    "TestUSDC": "$TESTUSDC_ADDR",
    "ConfidentialUSDC": "$CUSDC_ADDR",
    "NoxProtocol": "0xd464B198f06756a1d00be223634b85E0a731c229"
  },
  "deployer": "$DEPLOYER",
  "deployedAt": $TS,
  "blockscout": {
    "TestUSDC": "https://arbitrum-sepolia.blockscout.com/address/$TESTUSDC_ADDR",
    "ConfidentialUSDC": "https://arbitrum-sepolia.blockscout.com/address/$CUSDC_ADDR"
  }
}
EOF

echo "[deploy-f2] Done."
echo "[deploy-f2] TestUSDC:         https://arbitrum-sepolia.blockscout.com/address/$TESTUSDC_ADDR"
echo "[deploy-f2] ConfidentialUSDC: https://arbitrum-sepolia.blockscout.com/address/$CUSDC_ADDR"
