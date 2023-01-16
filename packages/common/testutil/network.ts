export const ALL_CHAINS = [
  'mainnet',
  'arbitrum',
  'optimism',
  'goerli',
  'optimismGoerli',
  'arbitrumGoerli',
  'hardhat',
  'localhost',
] as const

export type SupportedChains = typeof ALL_CHAINS
export type SupportedChain = SupportedChains[number]

export const MAINNETS: SupportedChain[] = ['mainnet', 'arbitrum', 'optimism']
export const TESTNETS: SupportedChain[] = ['goerli', 'arbitrumGoerli', 'optimismGoerli']
export const DEVNETS: SupportedChain[] = ['hardhat', 'localhost']
export const ETHEREUM_NETS: SupportedChain[] = ['mainnet', 'goerli']
export const ARBITRUM_NETS: SupportedChain[] = ['arbitrum', 'arbitrumGoerli']
export const OPTIMISM_NETS: SupportedChain[] = ['optimism', 'optimismGoerli']

export function isSupported(networkName: string): networkName is SupportedChain {
  return ALL_CHAINS.includes(networkName as SupportedChain)
}

export function getChainId(networkName: string): number {
  if (!isSupported(networkName)) throw 'Unsupported Network'
  switch (networkName) {
    case 'mainnet':
      return 1
    case 'arbitrum':
      return 42161
    case 'optimism':
      return 10
    case 'goerli':
      return 5
    case 'optimismGoerli':
      return 420
    case 'arbitrumGoerli':
      return 421613
    case 'hardhat':
      return 31337
    default:
      throw 'Unsupported Network'
  }
}

export function isEthereum(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && ETHEREUM_NETS.includes(process.env.FORK_NETWORK as SupportedChain)
    default:
      return ETHEREUM_NETS.includes(networkName)
  }
}
export function isOptimism(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && OPTIMISM_NETS.includes(process.env.FORK_NETWORK as SupportedChain)
    default:
      return OPTIMISM_NETS.includes(networkName)
  }
}

export function isArbitrum(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && ARBITRUM_NETS.includes(process.env.FORK_NETWORK as SupportedChain)
    default:
      return ARBITRUM_NETS.includes(networkName)
  }
}

export function isTestnet(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && TESTNETS.includes(process.env.FORK_NETWORK as SupportedChain)
    default:
      return TESTNETS.includes(networkName)
  }
}

export function isMainnet(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'localhost':
      return process.env.FORK_ENABLED === 'true' && MAINNETS.includes(process.env.FORK_NETWORK as SupportedChain)
    default:
      return MAINNETS.includes(networkName)
  }
}

export function isLocalhost(networkName: string): boolean {
  if (!isSupported(networkName)) return false
  switch (networkName) {
    case 'hardhat':
    case 'localhost':
      return true
    default:
      return false
  }
}
