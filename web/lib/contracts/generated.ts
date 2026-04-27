//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ClaimVerifier
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const claimVerifierAbi = [
  {
    type: "constructor",
    inputs: [
      {name: "pinnedMeasurement", internalType: "bytes32", type: "bytes32"},
      {name: "signer", internalType: "address", type: "address"},
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "attestationSigner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "pinnedTdxMeasurement",
    outputs: [{name: "", internalType: "bytes32", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "attestationData", internalType: "bytes", type: "bytes"},
      {name: "signature", internalType: "bytes", type: "bytes"},
    ],
    name: "verifyAttestation",
    outputs: [
      {name: "user", internalType: "address", type: "address"},
      {name: "marketId", internalType: "uint256", type: "uint256"},
      {name: "outcome", internalType: "uint8", type: "uint8"},
      {name: "payoutCommitment", internalType: "bytes32", type: "bytes32"},
      {name: "timestamp", internalType: "uint256", type: "uint256"},
      {name: "recipient", internalType: "address", type: "address"},
      {name: "nonce", internalType: "uint256", type: "uint256"},
    ],
    stateMutability: "view",
  },
  {type: "error", inputs: [], name: "ECDSAInvalidSignature"},
  {
    type: "error",
    inputs: [{name: "length", internalType: "uint256", type: "uint256"}],
    name: "ECDSAInvalidSignatureLength",
  },
  {
    type: "error",
    inputs: [{name: "s", internalType: "bytes32", type: "bytes32"}],
    name: "ECDSAInvalidSignatureS",
  },
  {
    type: "error",
    inputs: [{name: "length", internalType: "uint256", type: "uint256"}],
    name: "InvalidSignatureLength",
  },
  {
    type: "error",
    inputs: [
      {name: "recovered", internalType: "address", type: "address"},
      {name: "expected", internalType: "address", type: "address"},
    ],
    name: "InvalidSigner",
  },
  {
    type: "error",
    inputs: [
      {name: "attested", internalType: "bytes32", type: "bytes32"},
      {name: "pinned", internalType: "bytes32", type: "bytes32"},
    ],
    name: "MeasurementMismatch",
  },
] as const;

export const claimVerifierAddress = "0x5Cc49763703656FeC4Be672e254F7f024de2b82A" as const;

export const claimVerifierConfig = {address: claimVerifierAddress, abi: claimVerifierAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ConfidentialUSDC
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const confidentialUsdcAbi = [
  {
    type: "constructor",
    inputs: [
      {name: "underlying_", internalType: "contract IERC20", type: "address"},
      {name: "name_", internalType: "string", type: "string"},
      {name: "symbol_", internalType: "string", type: "string"},
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "confidentialBalanceOf",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "confidentialTotalSupply",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "to", internalType: "address", type: "address"},
      {name: "encryptedAmount", internalType: "externalEuint256", type: "bytes32"},
      {name: "inputProof", internalType: "bytes", type: "bytes"},
    ],
    name: "confidentialTransfer",
    outputs: [{name: "transferred", internalType: "euint256", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "to", internalType: "address", type: "address"},
      {name: "amount", internalType: "euint256", type: "bytes32"},
    ],
    name: "confidentialTransfer",
    outputs: [{name: "transferred", internalType: "euint256", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "from", internalType: "address", type: "address"},
      {name: "to", internalType: "address", type: "address"},
      {name: "encryptedAmount", internalType: "externalEuint256", type: "bytes32"},
      {name: "inputProof", internalType: "bytes", type: "bytes"},
    ],
    name: "confidentialTransferFrom",
    outputs: [{name: "transferred", internalType: "euint256", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "from", internalType: "address", type: "address"},
      {name: "to", internalType: "address", type: "address"},
      {name: "amount", internalType: "euint256", type: "bytes32"},
    ],
    name: "confidentialTransferFrom",
    outputs: [{name: "transferred", internalType: "euint256", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "decimals",
    outputs: [{name: "", internalType: "uint8", type: "uint8"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "requestId", internalType: "bytes32", type: "bytes32"},
      {name: "decryptionProof", internalType: "bytes", type: "bytes"},
    ],
    name: "finalizeUnwrap",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "holder", internalType: "address", type: "address"},
      {name: "operator", internalType: "address", type: "address"},
    ],
    name: "isOperator",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "name",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "requestId", internalType: "bytes32", type: "bytes32"}],
    name: "pendingUnwrap",
    outputs: [
      {name: "user", internalType: "address", type: "address"},
      {name: "amount", internalType: "uint256", type: "uint256"},
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "amount", internalType: "uint256", type: "uint256"}],
    name: "requestUnwrap",
    outputs: [{name: "requestId", internalType: "bytes32", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "operator", internalType: "address", type: "address"},
      {name: "until", internalType: "uint48", type: "uint48"},
    ],
    name: "setOperator",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "symbol",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "underlying",
    outputs: [{name: "", internalType: "contract IERC20", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "amount", internalType: "uint256", type: "uint256"},
      {name: "encryptedAmount", internalType: "externalEuint256", type: "bytes32"},
      {name: "inputProof", internalType: "bytes", type: "bytes"},
    ],
    name: "wrap",
    outputs: [{name: "newBalance", internalType: "euint256", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "from", internalType: "address", type: "address", indexed: true},
      {name: "to", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "euint256", type: "bytes32", indexed: true},
    ],
    name: "ConfidentialTransfer",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "holder", internalType: "address", type: "address", indexed: true},
      {name: "operator", internalType: "address", type: "address", indexed: true},
      {name: "until", internalType: "uint48", type: "uint48", indexed: false},
    ],
    name: "OperatorSet",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "requestId", internalType: "bytes32", type: "bytes32", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "UnwrapRequested",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "requestId", internalType: "bytes32", type: "bytes32", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Unwrapped",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
      {name: "newBalance", internalType: "euint256", type: "bytes32", indexed: false},
    ],
    name: "Wrapped",
  },
  {type: "error", inputs: [], name: "InvalidAmount"},
  {
    type: "error",
    inputs: [{name: "operator", internalType: "address", type: "address"}],
    name: "InvalidOperator",
  },
  {type: "error", inputs: [{name: "to", internalType: "address", type: "address"}], name: "InvalidReceiver"},
  {type: "error", inputs: [{name: "from", internalType: "address", type: "address"}], name: "InvalidSender"},
  {type: "error", inputs: [], name: "InvalidUnderlying"},
  {
    type: "error",
    inputs: [{name: "data", internalType: "bytes", type: "bytes"}],
    name: "MalformedDecryptedData",
  },
  {type: "error", inputs: [], name: "ReentrancyGuardReentrantCall"},
  {
    type: "error",
    inputs: [{name: "token", internalType: "address", type: "address"}],
    name: "SafeERC20FailedOperation",
  },
  {
    type: "error",
    inputs: [
      {name: "from", internalType: "address", type: "address"},
      {name: "spender", internalType: "address", type: "address"},
    ],
    name: "UnauthorizedSpender",
  },
  {
    type: "error",
    inputs: [
      {name: "amount", internalType: "euint256", type: "bytes32"},
      {name: "user", internalType: "address", type: "address"},
    ],
    name: "UnauthorizedUseOfEncryptedAmount",
  },
  {
    type: "error",
    inputs: [{name: "requestId", internalType: "bytes32", type: "bytes32"}],
    name: "UnknownUnwrapRequest",
  },
  {
    type: "error",
    inputs: [{name: "requestId", internalType: "bytes32", type: "bytes32"}],
    name: "UnwrapBurnFailed",
  },
] as const;

export const confidentialUsdcAddress = "0xaF1ACDf0B031080D4fAD75129E74d89eaD450c4D" as const;

export const confidentialUsdcConfig = {address: confidentialUsdcAddress, abi: confidentialUsdcAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Faucet
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const faucetAbi = [
  {
    type: "constructor",
    inputs: [
      {name: "tokenAddress", internalType: "address", type: "address"},
      {name: "initialOwner", internalType: "address", type: "address"},
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "CLAIM_AMOUNT",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "COOLDOWN",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "claim", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [{name: "user", internalType: "address", type: "address"}],
    name: "claimableAt",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "pause", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "paused",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "amount", internalType: "uint256", type: "uint256"}],
    name: "refill",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {type: "function", inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "token",
    outputs: [{name: "", internalType: "contract IERC20", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "newOwner", internalType: "address", type: "address"}],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {type: "function", inputs: [], name: "unpause", outputs: [], stateMutability: "nonpayable"},
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
      {name: "nextClaimAt", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Claimed",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previousOwner", internalType: "address", type: "address", indexed: true},
      {name: "newOwner", internalType: "address", type: "address", indexed: true},
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [{name: "account", internalType: "address", type: "address", indexed: false}],
    name: "Paused",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "by", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Refilled",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [{name: "account", internalType: "address", type: "address", indexed: false}],
    name: "Unpaused",
  },
  {
    type: "error",
    inputs: [{name: "nextAt", internalType: "uint256", type: "uint256"}],
    name: "CooldownActive",
  },
  {type: "error", inputs: [], name: "EnforcedPause"},
  {type: "error", inputs: [], name: "ExpectedPause"},
  {
    type: "error",
    inputs: [
      {name: "available", internalType: "uint256", type: "uint256"},
      {name: "required", internalType: "uint256", type: "uint256"},
    ],
    name: "InsufficientFaucetBalance",
  },
  {type: "error", inputs: [], name: "InvalidAmount"},
  {type: "error", inputs: [], name: "InvalidToken"},
  {
    type: "error",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "OwnableInvalidOwner",
  },
  {
    type: "error",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "OwnableUnauthorizedAccount",
  },
  {type: "error", inputs: [], name: "ReentrancyGuardReentrantCall"},
  {
    type: "error",
    inputs: [{name: "token", internalType: "address", type: "address"}],
    name: "SafeERC20FailedOperation",
  },
] as const;

export const faucetAddress = "0xcB8e251CD6EB0BB797c0721CAB84f41C8CD359A5" as const;

export const faucetConfig = {address: faucetAddress, abi: faucetAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FeeVault
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const feeVaultAbi = [
  {
    type: "constructor",
    inputs: [{name: "initialOwner", internalType: "address", type: "address"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "market", internalType: "address", type: "address"}],
    name: "isRegisteredMarket",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "amount", internalType: "uint256", type: "uint256"}],
    name: "receiveFee",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {type: "function", inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [
      {name: "market", internalType: "address", type: "address"},
      {name: "registered", internalType: "bool", type: "bool"},
    ],
    name: "setMarketRegistered",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "totalFees",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "newOwner", internalType: "address", type: "address"}],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "token", internalType: "address", type: "address"},
      {name: "to", internalType: "address", type: "address"},
      {name: "amount", internalType: "uint256", type: "uint256"},
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "market", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "FeeReceived",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "token", internalType: "address", type: "address", indexed: true},
      {name: "to", internalType: "address", type: "address", indexed: true},
      {name: "amount", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "FeeWithdrawn",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "market", internalType: "address", type: "address", indexed: true},
      {name: "registered", internalType: "bool", type: "bool", indexed: false},
    ],
    name: "MarketRegistered",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previousOwner", internalType: "address", type: "address", indexed: true},
      {name: "newOwner", internalType: "address", type: "address", indexed: true},
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "error",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "OwnableInvalidOwner",
  },
  {
    type: "error",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "OwnableUnauthorizedAccount",
  },
  {
    type: "error",
    inputs: [{name: "token", internalType: "address", type: "address"}],
    name: "SafeERC20FailedOperation",
  },
  {
    type: "error",
    inputs: [{name: "market", internalType: "address", type: "address"}],
    name: "UnknownMarket",
  },
] as const;

export const feeVaultAddress = "0x4FC729a98824Bf2E6da4BBA903eAd73432aFa351" as const;

export const feeVaultConfig = {address: feeVaultAddress, abi: feeVaultAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Market
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const marketAbi = [
  {
    type: "function",
    inputs: [],
    name: "BATCH_INTERVAL",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "CLAIM_OPEN_DELAY",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "CLAIM_WINDOW",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "MAX_FEE_BPS",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "admin",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "batchCount",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "claimWindowDeadline",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "claimWindowOpensAt",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "claimWinnings", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [{name: "user", internalType: "address", type: "address"}],
    name: "claimed",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "closeMarket", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "confidentialUSDC",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "expiryTs",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "yesPoolDecryptionProof", internalType: "bytes", type: "bytes"},
      {name: "noPoolDecryptionProof", internalType: "bytes", type: "bytes"},
    ],
    name: "freezePool",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "user", internalType: "address", type: "address"}],
    name: "hasClaimed",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "id",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "id_", internalType: "uint256", type: "uint256"},
      {name: "question_", internalType: "string", type: "string"},
      {name: "resolutionCriteria_", internalType: "string", type: "string"},
      {name: "oracleType_", internalType: "uint8", type: "uint8"},
      {name: "expiryTs_", internalType: "uint256", type: "uint256"},
      {name: "protocolFeeBps_", internalType: "uint256", type: "uint256"},
      {name: "confidentialUSDC_", internalType: "address", type: "address"},
      {name: "resolutionOracle_", internalType: "address", type: "address"},
      {name: "admin_", internalType: "address", type: "address"},
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "lastBatchTs",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "markInvalid", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [{name: "user", internalType: "address", type: "address"}],
    name: "noBet",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "noPoolFrozen",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "noPoolPublishedHandle",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "oracleType",
    outputs: [{name: "", internalType: "uint8", type: "uint8"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "outcome",
    outputs: [{name: "", internalType: "uint8", type: "uint8"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "pendingBatchBetCount",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "side", internalType: "uint8", type: "uint8"},
      {name: "encryptedAmount", internalType: "externalEuint256", type: "bytes32"},
      {name: "inputProof", internalType: "bytes", type: "bytes"},
    ],
    name: "placeBet",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "poolFrozenTs",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "protocolFeeBps",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "publishBatch", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "question",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "refundIfInvalid",
    outputs: [{name: "refundHandle", internalType: "bytes32", type: "bytes32"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "resolutionCriteria",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "resolutionOracle",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "resolutionTs",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "winningOutcome", internalType: "uint8", type: "uint8"}],
    name: "resolveAdmin",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {type: "function", inputs: [], name: "resolveOracle", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "state",
    outputs: [{name: "", internalType: "enum IMarket.State", type: "uint8"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "totalBetCount",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "user", internalType: "address", type: "address"}],
    name: "yesBet",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "yesPoolFrozen",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "yesPoolPublishedHandle",
    outputs: [{name: "", internalType: "euint256", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "batchId", internalType: "uint256", type: "uint256", indexed: true},
      {name: "betsInBatch", internalType: "uint256", type: "uint256", indexed: false},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "BatchPublished",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "side", internalType: "uint8", type: "uint8", indexed: false},
      {name: "handle", internalType: "bytes32", type: "bytes32", indexed: false},
      {name: "batchId", internalType: "uint256", type: "uint256", indexed: true},
    ],
    name: "BetPlaced",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "winningSide", internalType: "uint8", type: "uint8", indexed: false},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "ClaimRecorded",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "outcome", internalType: "uint8", type: "uint8", indexed: false},
      {name: "payoutHandle", internalType: "bytes32", type: "bytes32", indexed: false},
      {name: "feeHandle", internalType: "bytes32", type: "bytes32", indexed: false},
    ],
    name: "ClaimSettled",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [{name: "timestamp", internalType: "uint256", type: "uint256", indexed: false}],
    name: "ClaimWindowOpened",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "id", internalType: "uint256", type: "uint256", indexed: true},
      {name: "expiryTs", internalType: "uint256", type: "uint256", indexed: false},
      {name: "protocolFeeBps", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Initialized",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [{name: "timestamp", internalType: "uint256", type: "uint256", indexed: false}],
    name: "MarketClosed",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [{name: "timestamp", internalType: "uint256", type: "uint256", indexed: false}],
    name: "MarketInvalidated",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "outcome", internalType: "uint8", type: "uint8", indexed: false},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "MarketResolved",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "yesPoolPlaintext", internalType: "uint256", type: "uint256", indexed: false},
      {name: "noPoolPlaintext", internalType: "uint256", type: "uint256", indexed: false},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "PoolFrozen",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "user", internalType: "address", type: "address", indexed: true},
      {name: "refundHandle", internalType: "bytes32", type: "bytes32", indexed: false},
    ],
    name: "Refunded",
  },
  {
    type: "error",
    inputs: [
      {name: "user", internalType: "address", type: "address"},
      {name: "side", internalType: "uint8", type: "uint8"},
    ],
    name: "AlreadyBetThisSide",
  },
  {type: "error", inputs: [], name: "AlreadyClaimed"},
  {type: "error", inputs: [], name: "AlreadyInitialized"},
  {
    type: "error",
    inputs: [{name: "nextAt", internalType: "uint256", type: "uint256"}],
    name: "BatchIntervalNotElapsed",
  },
  {
    type: "error",
    inputs: [{name: "deadline", internalType: "uint256", type: "uint256"}],
    name: "ClaimWindowNotElapsed",
  },
  {
    type: "error",
    inputs: [{name: "opensAt", internalType: "uint256", type: "uint256"}],
    name: "ClaimWindowNotOpen",
  },
  {type: "error", inputs: [], name: "InvalidAdmin"},
  {type: "error", inputs: [], name: "InvalidConfidentialUSDC"},
  {type: "error", inputs: [], name: "InvalidExpiry"},
  {type: "error", inputs: [], name: "InvalidFee"},
  {
    type: "error",
    inputs: [{name: "oracleType", internalType: "uint8", type: "uint8"}],
    name: "InvalidOracleType",
  },
  {type: "error", inputs: [{name: "outcome", internalType: "uint8", type: "uint8"}], name: "InvalidOutcome"},
  {type: "error", inputs: [], name: "InvalidResolutionOracle"},
  {type: "error", inputs: [{name: "side", internalType: "uint8", type: "uint8"}], name: "InvalidSide"},
  {
    type: "error",
    inputs: [{name: "data", internalType: "bytes", type: "bytes"}],
    name: "MalformedDecryptedData",
  },
  {type: "error", inputs: [], name: "MarketExpired"},
  {type: "error", inputs: [], name: "MarketNotExpired"},
  {type: "error", inputs: [], name: "NoBetToRefund"},
  {type: "error", inputs: [], name: "NoWinningPosition"},
  {type: "error", inputs: [], name: "NotInResolvableState"},
  {type: "error", inputs: [], name: "NotInvalid"},
  {type: "error", inputs: [], name: "OnlyAdmin"},
  {type: "error", inputs: [], name: "OracleNotReady"},
  {type: "error", inputs: [], name: "ReentrancyGuardReentrantCall"},
  {
    type: "error",
    inputs: [
      {name: "expected", internalType: "enum IMarket.State", type: "uint8"},
      {name: "actual", internalType: "enum IMarket.State", type: "uint8"},
    ],
    name: "WrongState",
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MarketRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const marketRegistryAbi = [
  {
    type: "constructor",
    inputs: [
      {name: "marketImplementation_", internalType: "address", type: "address"},
      {name: "confidentialUSDC_", internalType: "address", type: "address"},
      {name: "resolutionOracle_", internalType: "address", type: "address"},
      {name: "initialOwner", internalType: "address", type: "address"},
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "confidentialUSDC",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "question_", internalType: "string", type: "string"},
      {name: "resolutionCriteria", internalType: "string", type: "string"},
      {name: "oracleType", internalType: "uint8", type: "uint8"},
      {name: "expiryTs", internalType: "uint256", type: "uint256"},
      {name: "protocolFeeBps", internalType: "uint256", type: "uint256"},
    ],
    name: "createMarket",
    outputs: [
      {name: "id", internalType: "uint256", type: "uint256"},
      {name: "market", internalType: "address", type: "address"},
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "marketImplementation",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "id", internalType: "uint256", type: "uint256"}],
    name: "markets",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "nextMarketId",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "resolutionOracle",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "newImpl", internalType: "address", type: "address"}],
    name: "setMarketImplementation",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "newOracle", internalType: "address", type: "address"}],
    name: "setResolutionOracle",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "newOwner", internalType: "address", type: "address"}],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "id", internalType: "uint256", type: "uint256", indexed: true},
      {name: "market", internalType: "address", type: "address", indexed: false},
      {name: "question", internalType: "string", type: "string", indexed: false},
      {name: "expiryTs", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "MarketCreated",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previous", internalType: "address", type: "address", indexed: true},
      {name: "next", internalType: "address", type: "address", indexed: true},
    ],
    name: "MarketImplementationUpdated",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previousOwner", internalType: "address", type: "address", indexed: true},
      {name: "newOwner", internalType: "address", type: "address", indexed: true},
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previous", internalType: "address", type: "address", indexed: true},
      {name: "next", internalType: "address", type: "address", indexed: true},
    ],
    name: "ResolutionOracleSet",
  },
  {type: "error", inputs: [], name: "FailedDeployment"},
  {
    type: "error",
    inputs: [
      {name: "balance", internalType: "uint256", type: "uint256"},
      {name: "needed", internalType: "uint256", type: "uint256"},
    ],
    name: "InsufficientBalance",
  },
  {type: "error", inputs: [], name: "InvalidConfidentialUSDC"},
  {type: "error", inputs: [], name: "InvalidExpiry"},
  {type: "error", inputs: [], name: "InvalidImplementation"},
  {type: "error", inputs: [], name: "InvalidResolutionOracle"},
  {
    type: "error",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "OwnableInvalidOwner",
  },
  {
    type: "error",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "OwnableUnauthorizedAccount",
  },
] as const;

export const marketRegistryAddress = "0xe66B2f638F5Db738243A44f7aEB1cCcc18906DD1" as const;

export const marketRegistryConfig = {address: marketRegistryAddress, abi: marketRegistryAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ResolutionOracle
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const resolutionOracleAbi = [
  {
    type: "constructor",
    inputs: [{name: "initialOwner", internalType: "address", type: "address"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "marketId", internalType: "uint256", type: "uint256"}],
    name: "adapterOf",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "marketId", internalType: "uint256", type: "uint256"}],
    name: "isReady",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {type: "function", inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [{name: "marketId", internalType: "uint256", type: "uint256"}],
    name: "resolve",
    outputs: [{name: "outcome", internalType: "uint8", type: "uint8"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "marketId", internalType: "uint256", type: "uint256"},
      {name: "adapter", internalType: "address", type: "address"},
    ],
    name: "setAdapter",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "newOwner", internalType: "address", type: "address"}],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "marketId", internalType: "uint256", type: "uint256", indexed: true},
      {name: "adapter", internalType: "address", type: "address", indexed: true},
    ],
    name: "AdapterSet",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previousOwner", internalType: "address", type: "address", indexed: true},
      {name: "newOwner", internalType: "address", type: "address", indexed: true},
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "marketId", internalType: "uint256", type: "uint256", indexed: true},
      {name: "outcome", internalType: "uint8", type: "uint8", indexed: false},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "ResolutionFulfilled",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "marketId", internalType: "uint256", type: "uint256", indexed: true},
      {name: "adapter", internalType: "address", type: "address", indexed: true},
      {name: "timestamp", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "ResolutionRequested",
  },
  {
    type: "error",
    inputs: [{name: "marketId", internalType: "uint256", type: "uint256"}],
    name: "AdapterNotSet",
  },
  {type: "error", inputs: [], name: "InvalidAdapter"},
  {
    type: "error",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "OwnableInvalidOwner",
  },
  {
    type: "error",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "OwnableUnauthorizedAccount",
  },
] as const;

export const resolutionOracleAddress = "0x27Dc556b9e6c1a031bd779E9524936F70b66b96c" as const;

export const resolutionOracleConfig = {address: resolutionOracleAddress, abi: resolutionOracleAbi} as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// TestUSDC
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const testUsdcAbi = [
  {
    type: "constructor",
    inputs: [{name: "initialOwner", internalType: "address", type: "address"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [{name: "", internalType: "bytes32", type: "bytes32"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "owner", internalType: "address", type: "address"},
      {name: "spender", internalType: "address", type: "address"},
    ],
    name: "allowance",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "spender", internalType: "address", type: "address"},
      {name: "value", internalType: "uint256", type: "uint256"},
    ],
    name: "approve",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "balanceOf",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "decimals",
    outputs: [{name: "", internalType: "uint8", type: "uint8"}],
    stateMutability: "pure",
  },
  {
    type: "function",
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {name: "fields", internalType: "bytes1", type: "bytes1"},
      {name: "name", internalType: "string", type: "string"},
      {name: "version", internalType: "string", type: "string"},
      {name: "chainId", internalType: "uint256", type: "uint256"},
      {name: "verifyingContract", internalType: "address", type: "address"},
      {name: "salt", internalType: "bytes32", type: "bytes32"},
      {name: "extensions", internalType: "uint256[]", type: "uint256[]"},
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "to", internalType: "address", type: "address"},
      {name: "amount", internalType: "uint256", type: "uint256"},
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [],
    name: "name",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "nonces",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "owner",
    outputs: [{name: "", internalType: "address", type: "address"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "owner", internalType: "address", type: "address"},
      {name: "spender", internalType: "address", type: "address"},
      {name: "value", internalType: "uint256", type: "uint256"},
      {name: "deadline", internalType: "uint256", type: "uint256"},
      {name: "v", internalType: "uint8", type: "uint8"},
      {name: "r", internalType: "bytes32", type: "bytes32"},
      {name: "s", internalType: "bytes32", type: "bytes32"},
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {type: "function", inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable"},
  {
    type: "function",
    inputs: [],
    name: "symbol",
    outputs: [{name: "", internalType: "string", type: "string"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [],
    name: "totalSupply",
    outputs: [{name: "", internalType: "uint256", type: "uint256"}],
    stateMutability: "view",
  },
  {
    type: "function",
    inputs: [
      {name: "to", internalType: "address", type: "address"},
      {name: "value", internalType: "uint256", type: "uint256"},
    ],
    name: "transfer",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [
      {name: "from", internalType: "address", type: "address"},
      {name: "to", internalType: "address", type: "address"},
      {name: "value", internalType: "uint256", type: "uint256"},
    ],
    name: "transferFrom",
    outputs: [{name: "", internalType: "bool", type: "bool"}],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    inputs: [{name: "newOwner", internalType: "address", type: "address"}],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "owner", internalType: "address", type: "address", indexed: true},
      {name: "spender", internalType: "address", type: "address", indexed: true},
      {name: "value", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Approval",
  },
  {type: "event", anonymous: false, inputs: [], name: "EIP712DomainChanged"},
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "previousOwner", internalType: "address", type: "address", indexed: true},
      {name: "newOwner", internalType: "address", type: "address", indexed: true},
    ],
    name: "OwnershipTransferred",
  },
  {
    type: "event",
    anonymous: false,
    inputs: [
      {name: "from", internalType: "address", type: "address", indexed: true},
      {name: "to", internalType: "address", type: "address", indexed: true},
      {name: "value", internalType: "uint256", type: "uint256", indexed: false},
    ],
    name: "Transfer",
  },
  {type: "error", inputs: [], name: "ECDSAInvalidSignature"},
  {
    type: "error",
    inputs: [{name: "length", internalType: "uint256", type: "uint256"}],
    name: "ECDSAInvalidSignatureLength",
  },
  {
    type: "error",
    inputs: [{name: "s", internalType: "bytes32", type: "bytes32"}],
    name: "ECDSAInvalidSignatureS",
  },
  {
    type: "error",
    inputs: [
      {name: "spender", internalType: "address", type: "address"},
      {name: "allowance", internalType: "uint256", type: "uint256"},
      {name: "needed", internalType: "uint256", type: "uint256"},
    ],
    name: "ERC20InsufficientAllowance",
  },
  {
    type: "error",
    inputs: [
      {name: "sender", internalType: "address", type: "address"},
      {name: "balance", internalType: "uint256", type: "uint256"},
      {name: "needed", internalType: "uint256", type: "uint256"},
    ],
    name: "ERC20InsufficientBalance",
  },
  {
    type: "error",
    inputs: [{name: "approver", internalType: "address", type: "address"}],
    name: "ERC20InvalidApprover",
  },
  {
    type: "error",
    inputs: [{name: "receiver", internalType: "address", type: "address"}],
    name: "ERC20InvalidReceiver",
  },
  {
    type: "error",
    inputs: [{name: "sender", internalType: "address", type: "address"}],
    name: "ERC20InvalidSender",
  },
  {
    type: "error",
    inputs: [{name: "spender", internalType: "address", type: "address"}],
    name: "ERC20InvalidSpender",
  },
  {
    type: "error",
    inputs: [{name: "deadline", internalType: "uint256", type: "uint256"}],
    name: "ERC2612ExpiredSignature",
  },
  {
    type: "error",
    inputs: [
      {name: "signer", internalType: "address", type: "address"},
      {name: "owner", internalType: "address", type: "address"},
    ],
    name: "ERC2612InvalidSigner",
  },
  {
    type: "error",
    inputs: [
      {name: "account", internalType: "address", type: "address"},
      {name: "currentNonce", internalType: "uint256", type: "uint256"},
    ],
    name: "InvalidAccountNonce",
  },
  {type: "error", inputs: [], name: "InvalidShortString"},
  {
    type: "error",
    inputs: [{name: "owner", internalType: "address", type: "address"}],
    name: "OwnableInvalidOwner",
  },
  {
    type: "error",
    inputs: [{name: "account", internalType: "address", type: "address"}],
    name: "OwnableUnauthorizedAccount",
  },
  {type: "error", inputs: [{name: "str", internalType: "string", type: "string"}], name: "StringTooLong"},
] as const;

export const testUsdcAddress = "0xf02C982D19184c11b86BC34672441C45fBF0f93E" as const;

export const testUsdcConfig = {address: testUsdcAddress, abi: testUsdcAbi} as const;
