import { BigNumberish } from 'ethers'
import { expect } from 'chai'

export interface Position {
  maker: BigNumberish
  taker: BigNumberish
}

export interface PrePosition {
  oracleVersion: BigNumberish
  openPosition: Position
  closePosition: Position
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

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.maker).to.equal(b.maker)
  expect(a.taker).to.equal(b.taker)
}

export function expectPrePositionEq(a: PrePosition, b: PrePosition): void {
  expect(a.oracleVersion).to.equal(b.oracleVersion)
  expectPositionEq(a.openPosition, b.openPosition)
  expectPositionEq(a.closePosition, b.closePosition)
}

export function expectProgramInfoEq(a: ProgramInfo, b: ProgramInfo): void {
  expect(a.coordinatorId).to.equal(b.coordinatorId)
  expect(a.token).to.equal(b.token)
  expect(a.amount.maker).to.equal(b.amount.maker)
  expect(a.amount.taker).to.equal(b.amount.taker)
  expect(a.start).to.equal(b.start)
  expect(a.duration).to.equal(b.duration)
}
