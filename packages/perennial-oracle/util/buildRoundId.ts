import { BigNumber } from 'ethers'

export function buildRoundId(phaseId: number, aggregatorRoundId: number): BigNumber {
  return BigNumber.from(16).pow(16).mul(phaseId).add(aggregatorRoundId)
}
