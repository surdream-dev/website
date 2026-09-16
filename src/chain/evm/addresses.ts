export const ADDRESSES = {
  lido: {
    stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    wstETH: "0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0",
    withdrawalQueue: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"
  },

  rocketpool: {
    rETH: "0xae78736Cd615f374D3085123A210448E74Fc6393",
    depositPool: "0xCE15294273CFb9D9b628F4D61636623decDF4fdC"
  },

  etherfi: {
    liquidityPool: "0x308861A430be4cce5502d0A12724771Fc6DaF216",
    liquidityPoolWeETH: "0xcfC6d9Bd7411962Bfe7145451A7EF71A24b6A7A2",
    liquidityPoolWeETHWithdrawal: "0xFbfe6b9cEe0E555Bad7e2E7309EFFC75200cBE38",
    redemptionManager: "0xDadEf1fFBFeaAB4f68A9fD181395F68b4e4E7Ae0",
    eETH: "0x35fA164735182de50811E8e2E824cFb9B6118ac2",
    weETH: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
    withdrawalNFT: "0x7d5706f6ef3F89B3951E23e557CDFBC3239D4E2c"
  },

  stakewise: {
    vault: "0x15639E82d2072Fa510E5d2b5F0db361c823bCad3",
    osETH: "0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38",
    wosETH: "0xD6E8bF5C0F2a3dA9e6B8cE23bD1Efa4C8d9aA123",
    osTokenVaultController: "0x2A261e60FB14586B474C208b1B7AC6D0f5000306"
  },

  stader: {
    stakeManager: "0xcf5EA1b38380f6aF39068375516Daf40Ed70D299",
    ethx: "0xA35b1B31CE002FBF2058D22F30F95D405200A15B",
    unstakeManager: "0x9F0491B32DBce587c50c4C43AB303b06478193A7"
  },

  meth: {
    stakingContract: "0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f",
    unstakeRequestsManager: "0x38fDF7b489316e03eD8754ad339cb5c4483FDcf9",
    mETH: "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa",
    wmETH: "0xB9f7838F5C461f8d2e52B7bAFb2eA1E6fF8d5678"
  },

  stablecoin: {
    ethena: {
      USDe: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
      sUSDe: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
      mintRedeem: "0xe3490297a08d6fC8Da46Edb7B6142E4F461b62D3",
    },
    mETH: {
      mETH: "0xd5f7838F5C461fEfF7FE49ea5ebAF7728Bb0ADfa",
    },
  },
  tokens: {
    // USD Stablecoins

    USDC: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    FDUSD:"0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",
    TUSD: "0x0000000000085d4780B73119b644AE5ecd22b376",
    FRAX: "0x853d955aCEf822Db058eb8505911ED77F175b99e",
    LUSD: "0x5f98805A4E8be255a32880FDeC7f6728C6568Ba0",
    crvUSD:"0xf939e0a03fb07f59a73314e73794be0e57ac1b4e",

    // ETH Series

    WETH:  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    wstETH:"0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    rETH:  "0xae78736Cd615f374D3085123A210448E74Fc6393",
    cbETH: "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704",
    sfrxETH:"0xac3E018457B222d93114458476f3E3416Abbe38F",

    // BTC Series (BTC on Ethereum)

    WBTC:  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    tBTC:  "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
    renBTC:"0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D",
    sBTC:  "0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6"
  },
  lending: {

    // Aave V3

    aave: {
      pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      dataProvider: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
      WETH_GATEWAY: "0xd01607c3C5eCABa394D8be377a08590149325722",
      // Aave V3 aTokens (receipt tokens, on-chain verification passed)
      aUSDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
      aUSDT: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a",
      aWETH: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8"
    },

    // SparkLend (Aave fork)

    sparklend: {
      pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987",
      // SparkLend approve spender (different from pool)
      spenderUSDC: "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d",
      spenderUSDT: "0xe2e7a17dFf93280dec073C995595155283e3C372",
      spenderWETH: "0xfE6eb3b609a7C8352A241f7F3A21CEA4e9209B8f",
      WETH_GATEWAY: "0xBD7D6a9ad7865463DE44B05F04559f65e3B11704",
      // SparkLend aTokens (receipt tokens, on-chain verification passed)
      aUSDC: "0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815",
      aUSDT: "0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f",
      aWETH: "0x59cD1C87501baa753d0B5B5Ab5D8416A45cD71DB",
      aWBTC: "0x4197ba364AE6698015AE5c1468f54087602715b2",
      aWstETH: "0x12B54025C112Aa61fAce2CDB7118740875A566E9",
    },

    // Compound V3 (Comet)

    compound: {
      comptroller: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B",

      // Compound V3 (Comet) markets
      cometUSDC: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
      cometUSDT: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
      cometWETH: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
      cometWBTC: "0xe85Dc543813B8c2CFEaAc371517b925a166a9293",

      // Compound V3 WETH comet manager (for allow operation)
      cometWETHManager: "0xa397a8C2086C554B531c02E29f3291c9704B00c7",

      // Legacy V2 cTokens (Keep Compatible)
      cETH:  "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5",
      cUSDT: "0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9",
      cUSDC: "0x39AA39c021dfbaE8faC545936693aC917d5E7563",
      cDAI:  "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643",
      cWBTC: "0xC11b1268C1A384e55C48c2391d8d480264A3A7F4"
    },

    // Morpho

    morpho: {
      morpho: "0x33333aea097c193e66081E930c33020272b33333",
      // Morpho approve wrapper - approve Interactive Contract (to address)
      approveWrapperUSDT: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      approveWrapperUSDC: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      // Morpho Vault - approve spender parameter + supply call contract
      spenderUSDT: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
      spenderUSDC: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      // Vault alias (for supply calls)
      vaultUSDT: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
      vaultUSDC: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
            // Morpho BatchRouter (for USDC EIP-2612 + multicall supply)
            batchRouter: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
            // USDC MetaMorpho Vault (Target Contract to initiate multicall)
            vaultUSDCAddress: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      // MetaMorpho Vault (for withdraw, ERC-4626)
      withdrawVaultUSDT: "0x23f5e9c35820f4bab695ac1f19c203cc3f8e1e11", // sky.money USDT Savings

      // Morpho Bundler3 — multicall entrance contract
      bundler3: "0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245",
      // GeneralAdapter1 (USDT) — with permit2TransferFrom/erc4626Deposit
      adapterUSDT: "0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0",
      // Sky (MakerDAO) USDT Savings — Actual interest accrual vault
      skyUSDT: "0x23f5e9c35820f4bab695ac1f19c203cc3f8e1e11",
      withdrawVaultUSDC: "0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0", // Gauntlet USDC Prime
      // Morpho Blue — Borrowing Market (borrow/repay)
      blue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFcB",
    },

    // Curve Lend

    curve: {
      pool: "0xA5407eAE9Ba41422680e2e00537571bcC53efBfD"
    },

    // Fluid

    fluid: {
      // Fluid wrapping tokens (old fToken path, remain compatible)
      FUSDT: "0x5C20B550819128074FD538Edf79791733ccEdd18",
      FUSDC: "0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33",
      FWETH: "0x90551c1795392094FE6D29B758EcCD233cFAa260",
      pool: "0x5C20B550819128074FD538Edf79791733ccEdd18",
      supplyRecipient: "0x612efd8a9bab0a857eb2089fd57b9a7d198d6b73",

      // Fluid Liquidity Layer
      liquidity: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497",
      // Fluid Resolver (getOverallTokenData)
      resolver: "0xF82111c4354622AB12b9803cD3F6164FCE52e847",

      // T1 Vault addresses (per pair)
      vaults: {
        "eth-usdc": "0x0c8c77b7ff4c2af7f6cebbe67350a490e3dd6cb3",
        "eth-usdt": "0xe16a6f5359abb1f61ce71e25dd0932e3e00b00eb",
        "wsteth-eth": "0x82B27fA821419F5689381b565a8B0786aA2548De",
      },
      // VaultFactory (ERC-721, for position NFT discovery)
      vaultFactory: "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d",
      // VaultResolver (vaultByNftId, positionByNftId)
      vaultResolver: "0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC",
      // VaultPositionsResolver (positionsByUser)
      vaultPositionsResolver: "0xaA21a86030EAa16546A759d2d10fd3bF9D053Bc7",
    }
  },
  curve: {
    threePool: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    lpToken: "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
  },
}
