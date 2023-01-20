import { isArbitrum, isEthereum, isMainnet, isTestnet } from './network'

export function getMultisigAddress(networkName: string): string | null {
  if (isMainnet(networkName)) {
    if (isEthereum(networkName)) return '0x589CDCf60aea6B961720214e80b713eB66B89A4d'
    if (isArbitrum(networkName)) return '0x8074583B0F9CFA345405320119D4B6937C152304'
  } else if (isTestnet(networkName)) {
    if (isEthereum(networkName)) return '0xf6C02E15187c9b466E81B3aC72cCf32569EB19eD'
  }
  return null
}
