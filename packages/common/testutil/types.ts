import { BigNumberish } from 'ethers'
import { expect } from 'chai'

export interface Position {
  _maker: BigNumberish
  _taker: BigNumberish
  _makerNext: BigNumberish
  _takerNext: BigNumberish
}

export interface Accumulator {
  _maker: BigNumberish
  _taker: BigNumberish
}

export interface ProgramInfo {
  coordinatorId: BigNumberish
  token: string
  amount: {
    maker: BigNumberish
    taker: BigNumberish
  }
  start: BigNumberish
  duration: BigNumberish
}

export function expectAccumulatorEq(a: Accumulator, b: Accumulator): void {
  expect(a._maker).to.equal(b._maker)
  expect(a._taker).to.equal(b._taker)
}

export function expectPositionEq(a: Position, b: Position): void {
  expect(a._maker).to.equal(b._maker)
  expect(a._taker).to.equal(b._taker)
  expect(a._makerNext).to.equal(b._makerNext)
  expect(a._takerNext).to.equal(b._takerNext)
}

export function expectProgramInfoEq(a: ProgramInfo, b: ProgramInfo): void {
  expect(a.coordinatorId).to.equal(b.coordinatorId)
  expect(a.token).to.equal(b.token)
  expect(a.amount.maker).to.equal(b.amount.maker)
  expect(a.amount.taker).to.equal(b.amount.taker)
  expect(a.start).to.equal(b.start)
  expect(a.duration).to.equal(b.duration)
}

export function createPayoffDefinition({
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
