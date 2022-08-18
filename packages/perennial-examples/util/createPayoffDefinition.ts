export default function createPayoffDefinition({
  contractAddress,
  short,
}: { contractAddress?: string; short?: boolean } = {}): {
  payoffType: number
  payoffDirection: number
  data: string
} {
  const definition = {
    payoffType: 0,
    payoffDirection: 0,
    data: '0x'.padEnd(62, '0'),
  }

  if (short) {
    definition.payoffDirection = 1
  }
  if (contractAddress) {
    definition.payoffType = 1
    definition.data = `0x${contractAddress.substring(2).padStart(60, '0')}`.toLowerCase()
  }

  return definition
}

export { createPayoffDefinition }
