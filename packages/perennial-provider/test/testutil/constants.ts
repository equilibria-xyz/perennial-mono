import { isMainnet, isTestnet } from './network'

export function getMultisigAddress(networkName: string): string | null {
  if (isMainnet(networkName)) return '0x589CDCf60aea6B961720214e80b713eB66B89A4d'
  if (isTestnet(networkName)) return '0xf6C02E15187c9b466E81B3aC72cCf32569EB19eD'
  return null
}
