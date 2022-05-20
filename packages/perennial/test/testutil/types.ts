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

export function expectPositionEq(a: Position, b: Position): void {
  expect(a.maker).to.equal(b.maker)
  expect(a.taker).to.equal(b.taker)
}

export function expectPrePositionEq(a: PrePosition, b: PrePosition): void {
  expect(a.oracleVersion).to.equal(b.oracleVersion)
  expectPositionEq(a.openPosition, b.openPosition)
  expectPositionEq(a.closePosition, b.closePosition)
}
