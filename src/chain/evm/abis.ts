export const ERC20_ABI = [
  { "name": "name", "outputs": [{ "type": "string" }], "stateMutability": "view", "type": "function" },
  { "name": "symbol", "outputs": [{ "type": "string" }], "stateMutability": "view", "type": "function" },
  { "name": "decimals", "outputs": [{ "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "name": "totalSupply", "outputs": [{ "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "name": "balanceOf", "inputs": [{ "type": "address" }], "outputs": [{ "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "name": "allowance", "inputs": [{ "type": "address" }, { "type": "address" }], "outputs": [{ "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "name": "approve", "inputs": [{ "type": "address" }, { "type": "uint256" }], "outputs": [{ "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "name": "transfer", "inputs": [{ "type": "address" }, { "type": "uint256" }], "outputs": [{ "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "name": "transferFrom", "inputs": [{ "type": "address" }, { "type": "address" }, { "type": "uint256" }], "outputs": [{ "type": "bool" }], "stateMutability": "nonpayable", "type": "function" }
]
export const LIDO_ABI = [
  {
    "name": "submit",
    "inputs": [{ "name": "_referral", "type": "address" }],
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  // EIP-2612 Permit for stETH
  {
    "name": "permit",
    "inputs": [
      { "name": "owner", "type": "address" },
      { "name": "spender", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "deadline", "type": "uint256" },
      { "name": "v", "type": "uint8" },
      { "name": "r", "type": "bytes32" },
      { "name": "s", "type": "bytes32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "nonces",
    "inputs": [{ "name": "owner", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "DOMAIN_SEPARATOR",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  }
]

// Lido Withdrawal Queue ABI
export const LIDO_WITHDRAWAL_QUEUE_ABI = [
  {
    "name": "requestWithdrawals",
    "inputs": [
      { "name": "_amounts", "type": "uint256[]" },
      { "name": "_owner", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256[]" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "requestWithdrawalsWithPermit",
    "inputs": [
      { "name": "_amounts", "type": "uint256[]" },
      { "name": "_owner", "type": "address" },
      {
        "name": "_permit",
        "type": "tuple",
        "components": [
          { "name": "value", "type": "uint256" },
          { "name": "deadline", "type": "uint256" },
          { "name": "v", "type": "uint8" },
          { "name": "r", "type": "bytes32" },
          { "name": "s", "type": "bytes32" }
        ]
      }
    ],
    "outputs": [{ "name": "", "type": "uint256[]" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claimWithdrawals",
    "inputs": [
      { "name": "_requestIds", "type": "uint256[]" },
      { "name": "_hints", "type": "uint256[]" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "getWithdrawalStatus",
    "inputs": [{ "name": "_requestIds", "type": "uint256[]" }],
    "outputs": [
      { "name": "", "type": "tuple[]", "components": [
        { "name": "amountOfStETH", "type": "uint256" },
        { "name": "amountOfShares", "type": "uint256" },
        { "name": "owner", "type": "address" },
        { "name": "timestamp", "type": "uint256" },
        { "name": "isFinalized", "type": "bool" },
        { "name": "isClaimed", "type": "bool" }
      ]}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "getClaimableEther",
    "inputs": [
      { "name": "_requestIds", "type": "uint256[]" },
      { "name": "_hints", "type": "uint256[]" }
    ],
    "outputs": [{ "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "claimWithdrawal",
    "inputs": [{ "name": "_requestId", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "getWithdrawalRequests",
    "inputs": [{ "name": "_owner", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "findCheckpointHints",
    "inputs": [
      { "name": "_requestIds", "type": "uint256[]" },
      { "name": "_firstIndex", "type": "uint256" },
      { "name": "_lastIndex", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "getLastCheckpointIndex",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const

// ERC20 Permit (EIP-2612) Type Definition - for Lido unstake
// eIP712Domain for stETH needs to contain version: '2'
export const ERC20_PERMIT_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ],
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const
export const WSTETH_ABI = [
  {
    "name": "wrap",
    "inputs": [{ "type": "uint256" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "unwrap",
    "inputs": [{ "type": "uint256" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
// WETH ABI (wrap ETH to WETH)
export const WETH_ABI = [
  {
    "name": "deposit",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "name": "withdraw",
    "inputs": [{ "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
export const WEETH_ABI = [
  {
    "name": "wrap",
    "inputs": [{ "type": "uint256" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "unwrap",
    "inputs": [{ "type": "uint256" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    // 1 weETH Redeemable eETH quantity (1e18 accuracy)
    "name": "getRate",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]

// ether.fi WeETH Liquidity Pool: ETH → weETH (depositETHForWeETH, payable)
export const ETHERFI_WEETH_POOL_ABI = [
  {
    "name": "depositETHForWeETH",
    "inputs": [{ "name": "_receiver", "type": "address" }],
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
]

// ether.fi WeETH withdrawal contract: requestWithdraw (weETH quantity, recipient) - in reverse order of parameters from eETH version
export const ETHERFI_WEETH_WITHDRAWAL_ABI = [
  {
    "name": "requestWithdraw",
    "inputs": [
      { "name": "_weETHAmount", "type": "uint256" },
      { "name": "_receiver", "type": "address" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
export const ROCKETPOOL_DEPOSIT_ABI = [
  {
    "name": "deposit",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    // Excess ETH in the deposit pool (deposited but not yet staked) available for rETH burns.
    "name": "getExcessBalance",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]
export const ROCKETPOOL_RETH_ABI = [
  {
    "name": "getExchangeRate",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    // burn (uint256) - burn rETH to get ETH
    // Official Transaction Selector: 0x42966c68
    "name": "burn",
    "inputs": [{ "name": "_rethAmount", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    // ETH value of a given rETH amount at the current exchange rate (used by burn).
    "name": "getEthValue",
    "inputs": [{ "name": "_rethAmount", "type": "uint256" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    // Total ETH collateral available for burns: depositPool.getExcessBalance() + address(this).balance
    "name": "getTotalCollateral",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]
export const ETHERFI_POOL_ABI = [
  {
    "name": "deposit",
    "stateMutability": "payable",
    "inputs": [],
    "outputs": [],
    "type": "function"
  },
  {
    "name": "requestWithdraw",
    "inputs": [
      { "name": "receiver", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claimWithdraw",
    "inputs": [{ "name": "_tokenId", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
export const STAKEWISE_VAULT_ABI = [
  {
    "name": "deposit",
    "inputs": [{ "type": "uint256" }, { "type": "address" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "redeem",
    "inputs": [{ "type": "uint256" }, { "type": "address" }, { "type": "address" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    // convertToShares (uint256 assets) - Convert ETH assets to Vault shares
    "name": "convertToShares",
    "inputs": [{ "name": "assets", "type": "uint256" }],
    "outputs": [{ "name": "shares", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    // convertToAssets (uint256 shares) - Convert Vault/osToken shares to ETH assets
    "name": "convertToAssets",
    "inputs": [{ "name": "shares", "type": "uint256" }],
    "outputs": [{ "name": "assets", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    // maxRedeem (address owner) - Maximum redeemable shares (queued, claimable)
    "name": "maxRedeem",
    "inputs": [{ "name": "owner", "type": "address" }],
    "outputs": [{ "name": "maxShares", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    // maxWithdraw (address owner) - maximum withdrawable ETH (queued, claimable)
    "name": "maxWithdraw",
    "inputs": [{ "name": "owner", "type": "address" }],
    "outputs": [{ "name": "maxAssets", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]
// StakeWise osETH Exchange Rate ABI
export const STAKEWISE_OSETH_ABI = [
  {
    "name": "exchangeRate",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]
export const STADER_ABI = [
  {
    "name": "deposit",
    "stateMutability": "payable",
    "inputs": [
      { "name": "_receiver", "type": "address" },
      { "name": "_referralId", "type": "string" }
    ],
    "outputs": [],
    "type": "function"
  },
  {
    "name": "requestWithdraw",
    "inputs": [
      { "name": "_ethXAmount", "type": "uint256" },
      { "name": "_owner", "type": "address" },
      { "name": "_referralId", "type": "string" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claimRewards",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
// Stader unstakeManager Contract ABI (0x9F0491B32DBce587c50c4C43AB303b06478193A7)
export const STADER_UNSTAKE_ABI = [
  {
    "name": "getRequestIdsByUser",
    "inputs": [{ "name": "user", "type": "address" }],
    "outputs": [{ "name": "requestIds", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "userWithdrawRequests",
    "inputs": [{ "name": "requestId", "type": "uint256" }],
    "outputs": [
      { "name": "owner", "type": "address" },
      { "name": "amountOfETHX", "type": "uint256" },
      // amountOfETH = ethExpected (ETH frozen at request time, ALWAYS > 0 for a live request) — NOT claimability.
      { "name": "amountOfETH", "type": "uint256" },
      // ethFinalized = actual ETH allocated once finalized; a request is claimable iff ethFinalized > 0.
      { "name": "ethFinalized", "type": "uint256" },
      { "name": "blockNumber", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "claim",
    "inputs": [{ "name": "requestId", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
export const METH_ABI = [
  {
    "name": "stake",
    "stateMutability": "payable",
    "inputs": [{ "type": "uint256", "name": "minMETHAmount" }],
    "outputs": [],
    "type": "function"
  },
  {
    "name": "requestWithdraw",
    "inputs": [{ "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "unstakeRequestWithPermit",
    "inputs": [
      { "type": "uint128", "name": "methAmount" },
      { "type": "uint128", "name": "minEthAmount" },
      { "type": "uint256", "name": "deadline" },
      { "type": "uint8", "name": "v" },
      { "type": "bytes32", "name": "r" },
      { "type": "bytes32", "name": "s" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "nonces",
    "inputs": [{ "type": "address", "name": "owner" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "DOMAIN_SEPARATOR",
    "inputs": [],
    "outputs": [{ "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  }
]

// mETH EIP-712 Permit Signature Type Definition
export const METH_PERMIT_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ],
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const

// Multicall3 ABI for preview calls
export const MULTICALL3_ABI = [
  {
    name: 'aggregate3',
    inputs: [{
      type: 'tuple[]',
      components: [
        { type: 'address', name: 'target' },
        { type: 'bool', name: 'allowFailure' },
        { type: 'bytes', name: 'callData' }
      ],
      name: 'calls'
    }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { type: 'bool', name: 'success' },
        { type: 'bytes', name: 'returnData' }
      ]
    }],
    stateMutability: 'view',
    type: 'function'
  }
]

// mETH Token ABI for exchange rate and preview
export const METH_TOKEN_ABI = [
  {
    "name": "exchangeRate",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "type": "function"
  },
  {
    "name": "convertToShares",
    "stateMutability": "view",
    "inputs": [{ "type": "uint256", "name": "assets" }],
    "outputs": [{ "type": "uint256", "name": "shares" }],
    "type": "function"
  },
  {
    "name": "convertToAssets",
    "stateMutability": "view",
    "inputs": [{ "type": "uint256", "name": "shares" }],
    "outputs": [{ "type": "uint256", "name": "assets" }],
    "type": "function"
  },
  {
    "name": "previewDeposit",
    "stateMutability": "view",
    "inputs": [{ "type": "uint256", "name": "assets" }],
    "outputs": [{ "type": "uint256", "name": "shares" }],
    "type": "function"
  },
  {
    "name": "previewMint",
    "stateMutability": "view",
    "inputs": [{ "type": "uint256", "name": "shares" }],
    "outputs": [{ "type": "uint256", "name": "assets" }],
    "type": "function"
  }
]
export const ETHENA_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "order", type: "bytes" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "order", type: "bytes" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const
export const STABLECOIN_ABIS = {
  erc20: [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ],

  ethena: [
    "function mint(bytes order, bytes signature) external returns (uint256)",
    "function redeem(bytes order, bytes signature) external returns (uint256)",
    "function USDe() view returns (address)",
  ],

  mETH: [
    // Assume mETH is ERC20
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ],
};
export const SUSDE_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" }
    ],
    outputs: [{ name: "shares", type: "uint256" }]
  },
  {
    type: "function",
    name: "cooldownShares",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "unstake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" }
    ],
    outputs: [{ name: "assets", type: "uint256" }]
  },
  {
    type: "function",
    name: "cooldownDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "cooldowns",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" }
    ],
    outputs: [
      { name: "cooldownEnd", type: "uint104" },
      { name: "underlyingAmount", type: "uint152" }
    ]
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" }
    ],
    outputs: [{ name: "shares", type: "uint256" }]
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" }
    ],
    outputs: [{ name: "assets", type: "uint256" }]
  },
  {
    type: "function",
    name: "previewRedeem",
    stateMutability: "view",
    inputs: [
      { name: "shares", type: "uint256" }
    ],
    outputs: [{ name: "assets", type: "uint256" }]
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [
      { name: "shares", type: "uint256" }
    ],
    outputs: [{ name: "assets", type: "uint256" }]
  }
] as const

// Permit2 ABI (Uniswap Permit2 Contract)
export const PERMIT2_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" }
    ],
    outputs: []
  },
  {
    name: "permit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      {
        name: "permitSingle",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" }
            ]
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" }
        ]
      },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  },
  {
    name: "permitTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ]
          },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        name: "transferDetails",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "requestedAmount", type: "uint256" }
        ]
      },
      { name: "owner", type: "address" },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  }
] as const

// Permit2 EIP-712 Type Definition
export const PERMIT2_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" }
  ],
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" }
  ]
} as const
export const AAVE_POOL_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint16" }
    ],
    outputs: []
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint16" },
      { type: "address" }
    ],
    outputs: []
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "setUserUseReserveAsCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "bool" }
    ],
    outputs: []
  },
  {
    name: "getUserAccountData",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "uint256" }, // totalCollateralBase
      { type: "uint256" }, // totalDebtBase
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" }
    ]
  }
] as const

export const COMPOUND_ABI = [
  { name: "mint", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "redeemUnderlying", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "borrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "repayBorrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] }
]
export const WETH_GATEWAY_ABI = [
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" }
    ],
    outputs: []
  },
  {
    name: "withdrawETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" }
    ],
    outputs: []
  },
  {
    name: "borrowETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" }
    ],
    outputs: []
  },
  {
    name: "repayETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" }
    ],
    outputs: []
  }
] as const
// StakeWise Stake ABI (Direct Stake ETH)
// StakeWise V3 Vault ABI (ERC1967Proxy)
export const STAKEWISE_STAKE_ABI = [
  {
    "name": "depositAndMintOsToken",
    "inputs": [
      { "type": "address", "name": "receiver" },
      { "type": "uint256", "name": "osTokenShares" },
      { "type": "address", "name": "referral" }
    ],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "name": "burnOsToken",
    "inputs": [
      { "name": "osTokenShares", "type": "uint128" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "enterExitQueue",
    "inputs": [
      { "name": "shares", "type": "uint256" },
      { "name": "recipient", "type": "address" }
    ],
    "outputs": [{ "name": "positionTicket", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "transferOsTokenPositionToEscrow",
    "inputs": [
      { "name": "osTokenShares", "type": "uint256" }
    ],
    "outputs": [{ "name": "positionTicket", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "multicall",
    "inputs": [
      { "name": "data", "type": "bytes[]" }
    ],
    "outputs": [{ "name": "results", "type": "bytes[]" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claimExitedAssets",
    "inputs": [
      { "name": "positionTicket", "type": "uint256" },
      { "name": "deadline", "type": "uint256" },
      { "name": "referral", "type": "uint256" }
    ],
    "outputs": [{ "name": "assets", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claimRewards",
    "inputs": [
      { "type": "address", "name": "receiver" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]

// StakeWise osTokenController ABI (Find Exchange Rates)
export const OS_TOKEN_CONTROLLER_ABI = [
  {
    "name": "convertToAssets",
    "inputs": [{ "name": "shares", "type": "uint256" }],
    "outputs": [{ "name": "assets", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "convertToShares",
    "inputs": [{ "name": "assets", "type": "uint256" }],
    "outputs": [{ "name": "shares", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]

// Stader ETHx ABI (wrap)
export const STADER_ETHX_ABI = [
  {
    "name": "wrap",
    "inputs": [{ "type": "uint256", "name": "amount" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]

// Stader ETHx exchange rate ABI (getExchangeRate returns 1 ETHx = rate/1e18 ETH, read from StaderOracle)
export const STADER_ETHX_RATE_ABI = [
  {
    "name": "getExchangeRate",
    "inputs": [],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
]

// Curve 3pool ABI
export const CURVE_POOL_ABI = [
  {
    "name": "add_liquidity",
    "inputs": [
      { "type": "uint256[3]", "name": "amounts" },
      { "type": "uint256", "name": "min_mint_amount" }
    ],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "remove_liquidity",
    "inputs": [
      { "type": "uint256", "name": "_amount" },
      { "type": "uint256[3]", "name": "min_amounts" }
    ],
    "outputs": [{ "type": "uint256[3]" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "remove_liquidity_one_coin",
    "inputs": [
      { "type": "uint256", "name": "_token_amount" },
      { "type": "int128", "name": "i" },
      { "type": "uint256", "name": "_min_amount" }
    ],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "name": "claim_rewards",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // Query Method
  {
    "name": "balances",
    "inputs": [{ "type": "int128", "name": "i" }],
    "outputs": [{ "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "name": "coins",
    "inputs": [{ "type": "int128", "name": "i" }],
    "outputs": [{ "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
]


// MetaMorpho Vault multicall ABI
export const METAMORPHO_MULTICALL_ABI = [{
  name: "multicall",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{
    type: "tuple[]",
    components: [
      { type: "address", name: "target" },
      { type: "bytes", name: "callData" },
      { type: "uint256", name: "value" },
      { type: "bool", name: "requireSuccess" },
      { type: "bytes32", name: "salt" }
    ]
  }],
  outputs: [{ type: "bytes[]" }]
}] as const

// Morpho BatchRouter erc20TransferFrom ABI
export const BATCH_ROUTER_TRANSFER_ABI = [{
  name: "erc20TransferFrom",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "token" },
    { type: "address", name: "to" },
    { type: "uint256", name: "amount" }
  ],
  outputs: []
}] as const

// Morpho BatchRouter erc4626Deposit ABI
export const BATCH_ROUTER_DEPOSIT_ABI = [{
  name: "erc4626Deposit",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "asset" },
    { type: "uint256", name: "assets" },
    { type: "uint256", name: "shares" },
    { type: "address", name: "receiver" }
  ],
  outputs: []
}] as const

// USDC/ERC20 permit ABI (on-chain call)
export const ERC20_PERMIT_ABI = [{
  name: "permit",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "owner" },
    { type: "address", name: "spender" },
    { type: "uint256", name: "value" },
    { type: "uint256", name: "deadline" },
    { type: "uint8", name: "v" },
    { type: "bytes32", name: "r" },
    { type: "bytes32", name: "s" }
  ],
  outputs: []
}] as const

// Morpho GeneralAdapter1 ABI (Subcall Target Contract for Bundler3)
// permit2TransferFrom: Pull token from user via Permit2
// erc4626Deposit: Deposit tokens into ERC-4626 vault (e.g. Sky USDT Savings)
export const GENERAL_ADAPTER1_ABI = [{
  name: "permit2TransferFrom",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "token" },
    { type: "address", name: "to" },
    { type: "uint256", name: "amount" }
  ],
  outputs: []
}, {
  name: "erc20TransferFrom",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "token" },
    { type: "address", name: "to" },
    { type: "uint256", name: "amount" }
  ],
  outputs: []
}, {
  name: "erc4626Deposit",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "vault" },
    { type: "uint256", name: "assets" },
    { type: "uint256", name: "minShares" },
    { type: "address", name: "receiver" }
  ],
  outputs: []
}, {
  // Transfer tokens held by Bundler3 to (for returning excess tokens to users at the end of multicall)
  name: "erc20Transfer",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { type: "address", name: "token" },
    { type: "address", name: "to" },
    { type: "uint256", name: "amount" }
  ],
  outputs: []
}, {
  // Morpho Blue Borrowing (via Bundler3/GeneralAdapter1)
  // Consistent with official app: morphoBorrow (marketParams, assets, shares, slippageAmount, onBehalf)
  // when assets > 0, borrow according to the precise asset; slippageAmount is the upper limit of borrowShares out of mint (maxUint256 = no limit)
  name: "morphoBorrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple", name: "marketParams",
        components: [
          { type: "address", name: "loanToken" },
          { type: "address", name: "collateralToken" },
          { type: "address", name: "oracle" },
          { type: "address", name: "irm" },
          { type: "uint256", name: "lltv" }
        ]
      },
      { type: "uint256", name: "assets" },
      { type: "uint256", name: "shares" },
      { type: "uint256", name: "slippageAmount" },
      { type: "address", name: "onBehalf" }
    ],
    outputs: []
  },
  // Transfer out of native tokens (ETH) held by Bundler3/Adapter
  // Called at the end of the multicall to return excess ETH to the user
  {
    name: "nativeTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "to" },
      { type: "uint256", name: "amount" }
    ],
    outputs: []
  },
  // Morpho Blue repayment via Bundler3/GeneralAdapter1
  // 4th param (slippageAmount) is forwarded to Morpho Blue as maxSharePriceE27 — the borrow share price
  // cap scaled by 1e27 (pool totalBorrowAssets×1e27/totalBorrowShares, +tolerance). NOT an asset amount.
  {
    name: "morphoRepay",
  type: "function",
  stateMutability: "payable",
  inputs: [
    {
      type: "tuple", name: "marketParams",
      components: [
        { type: "address", name: "loanToken" },
        { type: "address", name: "collateralToken" },
        { type: "address", name: "oracle" },
        { type: "address", name: "irm" },
        { type: "uint256", name: "lltv" }
      ]
    },
    { type: "uint256", name: "assets" },
    { type: "uint256", name: "shares" },
    { type: "uint256", name: "slippageAmount" },
    { type: "address", name: "onBehalf" },
    { type: "bytes", name: "data" }
  ],
  outputs: []
}] as const

// Morpho Bundler3 multicall ABI
// Call struct: (address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)
export const BUNDLER3_MULTICALL_ABI = [{
  name: "multicall",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{
    type: "tuple[]",
    components: [
      { type: "address", name: "to" },
      { type: "bytes", name: "data" },
      { type: "uint256", name: "value" },
      { type: "bool", name: "skipRevert" },
      { type: "bytes32", name: "callbackHash" }
    ]
  }],
  outputs: [{ type: "bytes[]" }]
}] as const

// ERC-4626 previewDeposit ABI (used to calculate the expected number of shares)
export const ERC4626_PREVIEW_ABI = [{
  name: "previewDeposit",
  type: "function",
  stateMutability: "view",
  inputs: [{ type: "uint256", name: "assets" }],
  outputs: [{ type: "uint256", name: "shares" }]
}] as const
