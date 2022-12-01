import { isMainnet, isTestnet } from './network'

export function getMultisigAddress(networkName: string): string {
  if (isMainnet(networkName)) return '0xe3010e0a0f1a8e8Ac58BF2Cd83B7FaCAee4821Af'
  if (isTestnet(networkName)) return '0xf6C02E15187c9b466E81B3aC72cCf32569EB19eD'
  throw 'Unsupported Network'
}
