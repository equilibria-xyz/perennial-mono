export function getChainId(networkName: string): number {
  switch (networkName) {
    case 'mainnet':
    case 'mainnet-fork':
      return 1
    case 'ropsten':
      return 3
    case 'rinkeby':
      return 4
    case 'goerli':
      return 5
    case 'kovan':
      return 42
    case 'hardhat':
      return 31337
    default:
      throw 'Unsupported Network'
  }
}

export function isTestnet(networkName: string): boolean {
  switch (networkName) {
    case 'ropsten':
    case 'kovan':
    case 'goerli':
    case 'rinkeby':
      return true
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && ['goerli, kovan'].indexOf(process.env.FORK_NETWORK || '') >= 0
    default:
      return false
  }
}

export function isMainnet(networkName: string): boolean {
  switch (networkName) {
    case 'mainnet':
    case 'mainnet-fork':
      return true
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && process.env.FORK_NETWORK === 'mainnet'
    default:
      return false
  }
}

export function isLocalhost(networkName: string): boolean {
  switch (networkName) {
    case 'hardhat':
    case 'localhost':
    case 'ganache':
      return true
    default:
      return false
  }
}
