import { isArbitrum, isBase, isEthereum, isMainnet, isTestnet } from './network'

export function getMultisigAddress(networkName: string): string | null {
  if (isMainnet(networkName)) {
    if (isEthereum(networkName)) return '0xe3010e0a0f1a8e8Ac58BF2Cd83B7FaCAee4821Af'
    if (isArbitrum(networkName)) return '0x8074583B0F9CFA345405320119D4B6937C152304'
    if (isBase(networkName)) return '0x63716C3656C7C3937981ccE3D4F0451b40302429' // Pnl Labs
  } else if (isTestnet(networkName)) {
    if (isEthereum(networkName)) return '0xf6C02E15187c9b466E81B3aC72cCf32569EB19eD'
  }
  return null
}
