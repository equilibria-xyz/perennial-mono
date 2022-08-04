import { BigNumber } from '@ethersproject/bignumber'

export function buildRoundId(phaseId: number, aggregatorRoundId: number): BigNumber {
  return BigNumber.from(16).pow(16).mul(phaseId).add(aggregatorRoundId)
}
